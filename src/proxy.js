/**
 * Proxy Server with Automatic Failover
 * 
 * Self-contained Node.js proxy that routes LLM requests across configured providers.
 * When one provider fails, automatically tries the next in priority order.
 */

const http = require('http');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { loadConfig, getEnabledProviders, getAllApiKeys, getServerApiKey } = require('./config');
const { sources, getModelsByProvider, ENV_VAR_NAMES, getModelLimits, isProviderShutdown } = require('./models');
const { validateSession } = require('./db');
const { proxyFetch } = require('./proxy-agent');

const TIER_ALIAS_MAP = { 'tier-splus': 'S+', 'tier-s': 'S', 'tier-aplus': 'A+', 'tier-a': 'A', 'tier-aminus': 'A-', 'tier-bplus': 'B+', 'tier-b': 'B', 'tier-c': 'C' };

// Tier fallback chain: if exact tier not available, try the next lower tier
const TIER_FALLBACK = {
  'tier-splus': ['tier-s', 'tier-aplus', 'tier-a', 'tier-bplus', 'tier-b'],
  'tier-s': ['tier-aplus', 'tier-a', 'tier-bplus', 'tier-b'],
  'tier-aplus': ['tier-a', 'tier-bplus', 'tier-b'],
  'tier-a': ['tier-bplus', 'tier-b'],
  'tier-aminus': ['tier-bplus', 'tier-b'],
  'tier-bplus': ['tier-b'],
  'tier-b': ['tier-c'],
  'tier-c': ['tier-b', 'tier-bplus', 'tier-a', 'tier-aplus', 'tier-s'],
};

// Token estimation (rough: ~4 chars per token for English, ~2 for CJK)
function isStreaming(body) {
  return body.stream === true || body.stream === 'true' || body.stream === 1;
}

// Extract session ID from request for sticky sessions
function getSessionId(reqBody) {
  // Use X-Session-Id or hash of first user message
  if (reqBody.session_id) return reqBody.session_id;
  if (reqBody.messages && reqBody.messages.length > 0) {
    const first = reqBody.messages[0].content;
    // Handle array content (vision messages) and string content
    let str;
    if (Array.isArray(first)) {
      str = first.filter(p => p.type === 'text').map(p => p.text || '').join('').substring(0, 200);
    } else {
      str = String(first || '').substring(0, 200);
    }
    let hash = 0;
    for (let i = 0; i < str.length; i++) { hash = ((hash << 5) - hash) + str.charCodeAt(i); hash |= 0; }
    return 's' + Math.abs(hash).toString(36);
  }
  return null;
}

// Check if request contains vision/image input
function hasVisionInput(reqBody) {
  if (!reqBody.messages) return false;
  for (const msg of reqBody.messages) {
    if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'image_url') return true;
      }
    }
  }
  return false;
}

function estimateTokens(messages) {
  if (!Array.isArray(messages)) return 0;
  let chars = 0;
  for (const msg of messages) {
    if (msg.content) {
      // Handle array content (vision messages with text + image_url parts)
      if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'text' && part.text) chars += part.text.length;
          else if (part.type === 'image_url') chars += 100; // rough estimate for image tokens
        }
      } else {
        chars += String(msg.content).length;
      }
    }
    if (msg.role) chars += String(msg.role).length;
  }
  return Math.ceil(chars / 3.5) + messages.length * 4;
}

// Check if conversation fits in provider's model context (checks best model)
function checkContextFit(provider, reqBody) {
  const estimatedTokens = estimateTokens(reqBody.messages);
  // Try models in order until one fits
  for (const modelId of provider.models) {
    const limits = getModelLimits(modelId);
    if (estimatedTokens <= limits.context) {
      return { fits: true, tokens: estimatedTokens, limit: limits.context, model: modelId };
    }
  }
  // None fit — report the first model's limit
  const firstLimits = getModelLimits(provider.models[0] || '');
  return { fits: false, tokens: estimatedTokens, limit: firstLimits.context, model: provider.models[0] || '' };
}
const { getHealthyProviders } = require('./health-checker');
const { handleAdminRequest, discoverProviderModels } = require('./admin');
const { initDatabase, getDisabledModels, getCustomProviders, getCustomProviderModels, getServerApiKey: dbGetServerApiKey, getModelsWithTier, getAllModelTiers, isRateLimited, recordRateLimit, setCooldown, cleanRateLimits, getStickyProvider, setStickyProvider, isVisionModel, logRequest, getAllProviderPriorities, getDiscoveredModelsByProvider, getProviderLimits } = require('./db');

/** 代理端口，默认 4002，可通过环境变量 FLAP_PORT 或 PORT 覆盖 */
const PROXY_PORT = parseInt(process.env.FLAP_PORT || process.env.PORT || '4002', 10);

// Read version from package.json
let APP_VERSION = '1.0.0';
try {
  const pkg = require(path.join(__dirname, '..', 'package.json'));
  if (pkg.version) APP_VERSION = pkg.version;
} catch (err) {
  console.warn('[Proxy] Failed to read package.json:', err.message);
} // fallback to default

/**
 * API Key 常量时间比较，防时序攻击
 */
function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  if (bufA.length === 0) return true; // both empty
  return crypto.timingSafeEqual(bufA, bufB);
}

// Server API key — cached after first resolution
let _cachedServerKey = null;
function getServerKey() {
  if (_cachedServerKey) return _cachedServerKey;
  const envKey = process.env.FLAP_API_KEY;
  if (envKey && envKey.startsWith('sk-')) { _cachedServerKey = envKey; return envKey; }
  try {
    const dbKey = dbGetServerApiKey();
    if (dbKey && dbKey.startsWith('sk-')) { _cachedServerKey = dbKey; return dbKey; }
  } catch (err) {
    console.warn('[Proxy] getServerKey db error:', err.message);
  }
  try {
    const config = loadConfig();
    if (config.generatedApiKey && config.generatedApiKey.startsWith('sk-')) return config.generatedApiKey;
  } catch (err) {
    console.warn('[Proxy] getServerKey config error:', err.message);
  }
  // Last resort: generate a new key
  return 'sk-' + crypto.randomBytes(32).toString('hex');
}

function invalidateServerKeyCache() { _cachedServerKey = null; }

// Standard JSON error response helper
function jsonError(res, status, error, provider) {
  const body = { error };
  if (provider) body.provider = provider;
  res.writeHead(status, { 'Content-Type': 'application/json', ...(provider ? { 'X-Provider': provider } : {}) });
  res.end(JSON.stringify(body));
}

// Simple cookie parser
function parseCookies(req) {
  const cookieHeader = req.headers.cookie || '';
  const cookies = {};
  for (const pair of cookieHeader.split(';')) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) cookies[key] = decodeURIComponent(val);
  }
  return cookies;
}

// Request timeout per provider (ms)
const PROVIDER_TIMEOUT = 10000;

// Circuit breaker state
const circuitBreaker = new Map(); // providerKey -> { failures, lastFailure, open, openedAt, halfOpen }
const CIRCUIT_THRESHOLD = 3;
const CIRCUIT_RESET_MS = 30000;
/** 速率限制冷却时间 (ms) */
const RATE_LIMIT_COOLDOWN_MS = 60000;

// Request stats
const stats = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  providerUsage: new Map(),
};

// Active provider tracking - per-session to avoid concurrent race conditions
const activeProviders = new Map(); // sessionId -> { key, apiKey, name, url, models, ts }
const ACTIVE_PROVIDER_TTL = 300000; // 5 minutes

function getActiveProvider(sessionId) {
  const key = sessionId || '__default__';
  const entry = activeProviders.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > ACTIVE_PROVIDER_TTL) {
    activeProviders.delete(key);
    return null;
  }
  return entry;
}

function setActiveProvider(sessionId, provider) {
  const key = sessionId || '__default__';
  activeProviders.set(key, { ...provider, ts: Date.now() });
}

function clearActiveProvider(sessionId) {
  const key = sessionId || '__default__';
  activeProviders.delete(key);
}

// Key rotation counters per provider (round-robin across multiple keys)
const keyRotationCounters = new Map(); // providerKey -> number

/**
 * Add custom providers from SQLite to the providers list.
 */
function addCustomProviders(providers, config) {
  try {
    const customs = getCustomProviders();
    for (const cp of customs) {
      if (!cp.enabled) continue;

      // Validate URL — prevent SSRF
      let parsedUrl;
      try { parsedUrl = new URL(cp.base_url); } catch { continue; }
      if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') continue;
      // Block private/reserved IP ranges when not localhost
      const hostname = parsedUrl.hostname.toLowerCase();
      if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '::1') {
        // Check for private IPs (IPv4 + IPv6-mapped)
        const isPrivate = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|0\.|169\.254\.)/.test(hostname) ||
          hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal') ||
          /^::ffff:(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.)/.test(hostname) ||
          /^(fe80:|fc00:|fd00:|::1)/.test(hostname);
        if (isPrivate) continue;
      }

      const cpModels = getCustomProviderModels(cp.name);
      if (cpModels.length === 0) continue;

      const allKeys = [];
      if (cp.api_key) allKeys.push(cp.api_key);
      // Also check env var for custom provider
      const envVarName = 'CUSTOM_' + cp.name.toUpperCase().replace(/[^a-zA-Z0-9]/g, '_') + '_API_KEY';
      if (process.env[envVarName]) allKeys.push(process.env[envVarName]);

      const key = 'custom_' + cp.name;
      for (let i = 0; i < allKeys.length; i++) {
        const enabledModels = cpModels.filter(m => m.enabled).map(m => m.model_id);
        if (enabledModels.length === 0) continue;

        providers.push({
          key,
          name: cp.name + ' (自定义)',
          url: cp.base_url.endsWith('/chat/completions') ? cp.base_url : cp.base_url.replace(/\/$/, '') + '/v1/chat/completions',
          apiKey: allKeys[i],
          keyIndex: i,
          totalKeys: allKeys.length,
          envVar: envVarName,
          priority: 98, // Custom providers are lower priority than built-in B-tier
          healthScore: -1,
          healthLatency: Infinity,
          models: enabledModels,
        });
      }
    }
  } catch (err) {
    console.warn('[Proxy] Failed to load custom providers:', err.message);
  }
}

/**
 * Get providers ordered by health score (best first), falling back to tier priority
 * @param {object} config - Config object
 * @param {object} [opts] - Optional filters
 * @param {boolean} [opts.visionOnly] - Only include providers with vision-capable models
 */
function getPrioritizedProviders(config, opts = {}) {
  const enabled = getEnabledProviders(config);
  const providers = [];
  
  const tierPriority = { 'S+': 0, 'S': 1, 'A+': 2, 'A': 3, 'A-': 4, 'B+': 5, 'B': 6, 'C': 7, 'discovered': 8 };
  
  // Get health data if available
  const healthyProviders = getHealthyProviders();
  const healthMap = new Map();
  for (const hp of healthyProviders) {
    healthMap.set(hp.key, hp);
  }
  
  for (const key of enabled) {
    // Skip providers past their shutdown date
    if (isProviderShutdown(key)) continue;
    // Skip zen-only providers (require special auth)
    if (sources[key]?.zenOnly) continue;

    // Check if sync has an updated URL for this provider
    let provider = sources[key];
    let providerUrl = provider ? provider.url : null;
    try {
      const { getSyncedProviderUrl } = require('./sync');
      const syncUrl = getSyncedProviderUrl(key);
      if (syncUrl && syncUrl.url) {
        providerUrl = syncUrl.url;
        // Update rate limits from sync data
        try {
          const providerLimits = getProviderLimits(key);
          if (providerLimits) {
            const updatedLimits = { rpm: syncUrl.limits_rpm || 30, rpd: syncUrl.limits_rpd || 5000 };
            providerLimits.rpm = updatedLimits.rpm;
            providerLimits.rpd = updatedLimits.rpd;
          }
        } catch (err) {
          console.warn('[Proxy] 更新同步速率限制失败:', err.message);
        }
      }
    } catch (err) {
      console.warn('[Proxy] 获取同步提供商 URL 失败:', err.message);
    }
    if (!providerUrl) continue;
    
    let models = getModelsByProvider(key);
    // Append discovered models
    try {
      const discovered = getDiscoveredModelsByProvider(key);
      for (const dm of discovered) {
        if (!models.find(m => m[0] === dm.model_id)) {
          models.push([dm.model_id, dm.model_id, 'discovered', '', '128k']);
        }
      }
    } catch {}
    // Apply manually assigned tiers (overrides default tier)
    const tieredModels = getModelsWithTier(key);
    for (const tm of tieredModels) {
      const existing = models.find(m => m[0] === tm.model_id);
      if (existing) {
        existing[2] = tm.tier; // Override tier
      } else {
        models.push([tm.model_id, tm.model_id, tm.tier, '', '128k']);
      }
    }
    // Sort models by tier (S+ first, discovered last)
    const modelTierOrder = { 'S+': 0, 'S': 1, 'A+': 2, 'A': 3, 'A-': 4, 'B+': 5, 'B': 6, 'C': 7, 'discovered': 8 };
    models.sort((a, b) => {
      const ta = modelTierOrder[a[2]] ?? 9;
      const tb = modelTierOrder[b[2]] ?? 9;
      return ta - tb;
    });
    // Filter out disabled models
    const disabledIds = getDisabledModels(key);
    if (disabledIds.length > 0) {
      models = models.filter(m => !disabledIds.includes(m[0]));
    }
    if (models.length === 0) continue;

    // Vision filter: only include providers with vision-capable models
    if (opts.visionOnly) {
      const hasVision = models.some(m => isVisionModel(m[0]));
      if (!hasVision) continue;
    }
    
    const bestTier = models.length > 0 ? models[0][2] : 'B';
    const tierPriorityVal = tierPriority[bestTier] || 99;
    
    // Get health score if available
    const health = healthMap.get(key);
    const healthScore = health ? health.score : -1;
    const healthLatency = health && health.avgLatency > 0 ? health.avgLatency : Infinity;
    
    // Get ALL API keys for this provider (supports multiple keys)
    let allKeys = getAllApiKeys(config, key);
    // No-key-required providers (Pollinations, LLM7) use a placeholder
    if (allKeys.length === 0 && provider?.noKeyRequired) {
      allKeys = ['no-key'];
    }
    if (allKeys.length === 0) continue;

    // Round-robin key rotation: start from the current rotation index
    const rotationIdx = keyRotationCounters.get(key) || 0;
    const rotatedKeys = [];
    for (let i = 0; i < allKeys.length; i++) {
      rotatedKeys.push(allKeys[(rotationIdx + i) % allKeys.length]);
    }
    // Advance counter for next request
    keyRotationCounters.set(key, (rotationIdx + 1) % allKeys.length);

    // Create an entry for each key (skip rate-limited keys)
    for (let i = 0; i < rotatedKeys.length; i++) {
      const apiKey = rotatedKeys[i];
      if (!provider?.noKeyRequired && isRateLimited(key, apiKey)) continue;
      providers.push({
        key,
        name: provider ? provider.name : key,
        url: providerUrl,
        apiKey,
        keyIndex: i,
        totalKeys: allKeys.length,
        envVar: ENV_VAR_NAMES[key],
        priority: tierPriorityVal,
        healthScore,
        healthLatency,
        models: models.map(m => m[0]),
        modelTiers: (() => {
          try {
            const dbTiers = getAllModelTiers();
            const prefix = key + '/';
            const merged = {};
            for (const m of models) {
              merged[m[0]] = dbTiers[prefix + m[0]] || (m[2] && m[2] !== '' ? m[2] : 'B');
            }
            return merged;
          } catch {
            const fallback = {};
            for (const m of models) {
              fallback[m[0]] = m[2] && m[2] !== '' ? m[2] : 'B';
            }
            return fallback;
          }
        })(),
        anthropicFormat: !!provider?.anthropicFormat,
      });
    }
  }

  // Add custom providers from SQLite
  addCustomProviders(providers, config);

  // Get custom provider priorities (user-defined ordering)
  let customPriorities = {};
  try { customPriorities = getAllProviderPriorities(); } catch {}

  // Sort: custom priority first, then health score, then tier priority
  providers.sort((a, b) => {
    const aCustom = customPriorities[a.key];
    const bCustom = customPriorities[b.key];
    const aHasCustom = aCustom !== undefined && aCustom !== null;
    const bHasCustom = bCustom !== undefined && bCustom !== null;

    // Both have custom priority → sort by custom (lower = higher priority)
    if (aHasCustom && bHasCustom) {
      if (aCustom !== bCustom) return aCustom - bCustom;
    }
    // Only one has custom priority → prefer it
    else if (aHasCustom) return -1;
    else if (bHasCustom) return 1;

    // No custom priority → use health score + tier
    if (a.healthScore >= 0 && b.healthScore >= 0) {
      if (b.healthScore !== a.healthScore) return b.healthScore - a.healthScore;
      if (a.healthLatency > 0 && b.healthLatency > 0) return a.healthLatency - b.healthLatency;
    }
    if (a.healthScore >= 0 && b.healthScore < 0) return -1;
    if (b.healthScore >= 0 && a.healthScore < 0) return 1;
    return a.priority - b.priority;
  });

  return providers;
}

/**
 * Check if circuit breaker is open for a provider
 */
function isCircuitOpen(providerKey) {
  const state = circuitBreaker.get(providerKey);
  if (!state) return false;
  if (!state.open && !state.halfOpen) return false;
  // If halfOpen, allow the probe request through
  if (state.halfOpen) return false;
  // Check if reset time elapsed — enter halfOpen state (allow probe)
  if (Date.now() - (state.openedAt || state.lastFailure) > CIRCUIT_RESET_MS) {
    state.halfOpen = true;
    state.open = false;
    return false;
  }
  return true;
}

/**
 * Record failure for circuit breaker
 */
function recordFailure(providerKey) {
  let state = circuitBreaker.get(providerKey);
  if (!state) {
    state = { failures: 0, lastFailure: 0, open: false, openedAt: 0, halfOpen: false };
    circuitBreaker.set(providerKey, state);
  }
  state.failures++;
  state.lastFailure = Date.now();
  // If halfOpen probe failed, re-open immediately
  if (state.halfOpen) {
    state.open = true;
    state.halfOpen = false;
    state.openedAt = Date.now();
    return;
  }
  if (state.failures >= CIRCUIT_THRESHOLD && !state.open) {
    state.open = true;
    state.openedAt = Date.now();
  }
}

/**
 * Record success for circuit breaker
 */
function recordSuccess(providerKey) {
  const state = circuitBreaker.get(providerKey);
  if (state) {
    state.failures = 0;
    state.open = false;
    state.openedAt = 0;
    state.halfOpen = false;
  }
}

/**
 * Extract thinking blocks from text.
 * Handles streaming where tags may be split across chunks.
 */
class ThinkingExtractor {
  constructor() {
    this.buffer = '';
    this.inThinking = false;
    this.thinkingContent = '';
  }

  processChunk(text) {
    this.buffer += text;
    const results = [];

    while (this.buffer.length > 0) {
      if (this.inThinking) {
        const closeIndex = this.buffer.indexOf('</thought>');
        if (closeIndex !== -1) {
          // Close tag found
          this.thinkingContent += this.buffer.substring(0, closeIndex);
          this.buffer = this.buffer.substring(closeIndex + 10);
          this.inThinking = false;
          results.push({ type: 'thinking', content: this.thinkingContent });
          this.thinkingContent = '';
        } else {
          // No close tag yet - check if we have partial close tag at end
          const partialClose = this.getPartialCloseTagLength();
          if (partialClose > 0) {
            // Keep partial close tag in buffer
            this.thinkingContent += this.buffer.substring(0, this.buffer.length - partialClose);
            this.buffer = this.buffer.substring(this.buffer.length - partialClose);
          } else {
            this.thinkingContent += this.buffer;
            this.buffer = '';
          }
          break;
        }
      } else {
        const openIndex = this.buffer.indexOf('<thought>');
        if (openIndex !== -1) {
          // Content before thought
          const beforeThought = this.buffer.substring(0, openIndex);
          if (beforeThought) {
            results.push({ type: 'content', content: beforeThought });
          }
          this.buffer = this.buffer.substring(openIndex + 9);
          this.inThinking = true;
          this.thinkingContent = '';
        } else {
          // No open tag - check if we have partial open tag at end
          const partialOpen = this.getPartialOpenTagLength();
          if (partialOpen > 0) {
            const content = this.buffer.substring(0, this.buffer.length - partialOpen);
            if (content) {
              results.push({ type: 'content', content: content });
            }
            this.buffer = this.buffer.substring(this.buffer.length - partialOpen);
          } else {
            if (this.buffer) {
              results.push({ type: 'content', content: this.buffer });
            }
            this.buffer = '';
          }
          break;
        }
      }
    }

    return results;
  }

  getPartialOpenTagLength() {
    // Check if buffer ends with partial '<thought>'
    const tag = '<thought>';
    for (let i = 1; i <= Math.min(this.buffer.length, tag.length); i++) {
      if (tag.startsWith(this.buffer.substring(this.buffer.length - i))) {
        return i;
      }
    }
    return 0;
  }

  getPartialCloseTagLength() {
    // Check if buffer ends with partial '</thought>'
    const tag = '</thought>';
    for (let i = 1; i <= Math.min(this.buffer.length, tag.length); i++) {
      if (tag.startsWith(this.buffer.substring(this.buffer.length - i))) {
        return i;
      }
    }
    return 0;
  }

  flush() {
    const results = [];
    if (this.inThinking) {
      results.push({ type: 'thinking', content: this.thinkingContent + this.buffer });
    } else if (this.buffer) {
      results.push({ type: 'content', content: this.buffer });
    }
    this.buffer = '';
    this.thinkingContent = '';
    this.inThinking = false;
    return results;
  }
}

/**
 * Clean response: extract thinking blocks and separate reasoning_content.
 */
function cleanResponseBody(bodyStr) {
  try {
    const obj = JSON.parse(bodyStr);
    if (obj.choices && Array.isArray(obj.choices)) {
      for (const choice of obj.choices) {
        if (choice.message && choice.message.content) {
          const extractor = new ThinkingExtractor();
          const parts = extractor.processChunk(choice.message.content);
          const thinking = parts.filter(p => p.type === 'thinking').map(p => p.content).join('\n\n');
          const content = parts.filter(p => p.type === 'content').map(p => p.content).join('');
          
          choice.message.content = content;
          if (thinking) {
            choice.message.reasoning_content = thinking;
          }
        }
      }
    }
    return JSON.stringify(obj);
  } catch {
    return bodyStr;
  }
}

/**
 * Forward request to a provider using fetch (supports HTTP/2, fixes NVIDIA ECONNRESET)
 */
async function forwardToProvider(provider, requestBody, onChunk = null) {
  /** 请求开始时间 */
  const startTime = Date.now();
  /** 原始请求中的模型名 */
  const originalModel = requestBody.model || '';
  // Build target URL - provider.url already includes full endpoint path
  let targetUrl = provider.url.includes('/chat/completions')
    ? provider.url
    : provider.url.replace(/\/$/, '') + '/v1/chat/completions';
  // Resolve Cloudflare {account_id} placeholder
  if (targetUrl.includes('{account_id}')) {
    const accountId = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
    targetUrl = targetUrl.replace('{account_id}', accountId || 'missing-account-id');
  }

  // Determine which models to try (multi-model failover within provider)
  let modelsToTry = [provider.models[0]]; // default: first model
  if (requestBody.model && requestBody.model.startsWith('tier-')) {
    // For tier requests, filter models by the requested tier level
    const requestedTier = TIER_ALIAS_MAP[requestBody.model];
    if (requestedTier && provider.modelTiers) {
      modelsToTry = provider.models.filter(mid => provider.modelTiers[mid] === requestedTier);
    } else {
      modelsToTry = provider.models;
    }
    if (modelsToTry.length === 0) {
      throw { status: 404, error: `No ${requestedTier || requestBody.model} models available for ${provider.key}`, provider: provider.key };
    }
  } else if (requestBody.model === 'auto' || !requestBody.model) {
    modelsToTry = provider.models;
  }

  let lastError = null;
  // Deep clone once before the loop to avoid repeated serialization
  const baseBody = JSON.parse(JSON.stringify(requestBody));

  for (let modelIdx = 0; modelIdx < modelsToTry.length; modelIdx++) {
  const body = { ...baseBody };
  let selectedModelId = modelsToTry[modelIdx];

  /**
   * model=auto 或 tier-* 模式：使用当前尝试的模型
   * 否则，去除 provider/ 前缀得到实际模型名
   */
  if (body.model === 'auto' || !body.model || body.model.startsWith('tier-')) {
    body.model = selectedModelId;
  } else if (body.model.startsWith(provider.key + '/')) {
    body.model = body.model.slice(provider.key.length + 1);
  }

  // Get model limits and sanitize request body (remove Google/Gemini format fields)
  const limits = getModelLimits(selectedModelId);
  delete body.maxOutputTokens;
  delete body.responseModalities;
  delete body.safetySettings;
  delete body.generationConfig;

  // Set max_tokens — respect user's value if lower than limit
  if (body.max_tokens === undefined || body.max_tokens >= limits.output) {
    body.max_tokens = limits.output;
  }

  const bodyStr = JSON.stringify(body);
  if (modelIdx === 0) {
    console.log(`[Proxy] Using model limits: context=${limits.context}, output=${limits.output} for ${selectedModelId}`);
  }

  const isStream = isStreaming(body);

  const keyInfo = provider.totalKeys > 1 ? ` [key ${provider.keyIndex + 1}/${provider.totalKeys}]` : '';
  const modelInfo = modelsToTry.length > 1 ? ` (model ${modelIdx + 1}/${modelsToTry.length}: ${selectedModelId})` : '';
  console.log(`[Proxy] Trying provider: ${provider.key} (${provider.name})${keyInfo}${modelInfo} ${isStream ? '(streaming)' : ''}`);

  try {
    const headers = { 'Content-Type': 'application/json' };
    let requestBodyStr = bodyStr;
    let isAnthropic = provider.anthropicFormat;

    // System prompt compatibility shim
    // Convert system role to first user message for providers that don't support it
    if (provider.noSystemRole) {
      const parsed = JSON.parse(bodyStr);
      if (parsed.messages && Array.isArray(parsed.messages)) {
        // Check all messages for system role (not just first)
        const hasSystem = parsed.messages.some(m => m.role === 'system');
        if (hasSystem) {
          const systemContents = parsed.messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
          parsed.messages = parsed.messages.filter(m => m.role !== 'system');
          if (systemContents && parsed.messages.length > 0) {
            // Insert as first user message with a marker
            parsed.messages.unshift({ role: 'user', content: '[System Instruction]\n' + systemContents + '\n[/System Instruction]\n\n' + parsed.messages[0].content });
          }
          requestBodyStr = JSON.stringify(parsed);
        }
      }
    }

    if (isAnthropic) {
      // Anthropic uses x-api-key header instead of Bearer
      headers['x-api-key'] = provider.apiKey;
      headers['anthropic-version'] = '2023-06-01';
      // Convert OpenAI format to Anthropic format
      try {
        const openaiBody = JSON.parse(bodyStr);
        const anthropicBody = {
          model: openaiBody.model,
          max_tokens: openaiBody.max_tokens || 4096,
          messages: openaiBody.messages || [],
          stream: openaiBody.stream || false,
        };
        // Extract system prompt if present (Anthropic uses top-level "system" field)
        if (openaiBody.messages && openaiBody.messages.length > 0 && openaiBody.messages[0].role === 'system') {
          anthropicBody.system = openaiBody.messages[0].content;
          anthropicBody.messages = openaiBody.messages.slice(1);
        }
        requestBodyStr = JSON.stringify(anthropicBody);
      } catch { /* fall through to original body */ }
    } else {
      headers['Authorization'] = `Bearer ${provider.apiKey}`;
    }

    const response = await proxyFetch(targetUrl, {
      method: 'POST',
      headers,
      body: requestBodyStr,
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT),
    });

    // Handle HTTP errors (status >= 400)
    if (!response.ok) {
      console.log(`[Proxy] ❌ ${provider.key} error (${response.status}) for ${selectedModelId}`);
      let errorData = '';
      try { errorData = await response.text(); } catch {}
      logRequest({ provider: provider.key, model: selectedModelId, latencyMs: Date.now() - startTime, success: false, tokensIn: 0, tokensOut: 0, requestModel: originalModel });

      // 404/410 = model not found, try next model in same provider
      if ((response.status === 404 || response.status === 410) && modelIdx < modelsToTry.length - 1) {
        lastError = { status: response.status, error: `Model ${selectedModelId} not found`, provider: provider.key };
        continue; // try next model
      }

      if (response.status === 429) {
        throw { status: 429, error: 'Rate limited', provider: provider.key };
      }
      throw { status: response.status, error: errorData || `HTTP ${response.status}`, provider: provider.key };
    }
    
    // STREAMING MODE: forward chunks via SSE
    if (isStream && onChunk) {
      console.log(`[Proxy] ✅ ${provider.key} streaming started (${response.status})`);
      recordSuccess(provider.key);
      
      const extractor = new ThinkingExtractor();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        
        // Process complete lines from buffer, keep incomplete last line
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        const completeLines = lines.filter(line => line.trim());
        
        for (const line of completeLines) {
          if (line.startsWith('data:')) {
            const jsonPayload = line.substring(5).trim();
            try {
              const parsed = JSON.parse(jsonPayload);
              if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta) {
                const delta = parsed.choices[0].delta;
                const content = delta.content || '';
                const toolCalls = delta.tool_calls;

                // If this is a tool_calls response, pass it through directly
                if (toolCalls) {
                  // Rewrite model name in tool_calls if needed
                  const newDelta = { ...delta };
                  parsed.choices[0].delta = newDelta;
                  onChunk('data: ' + JSON.stringify(parsed) + '\n\n', false, provider.key);
                  continue;
                }

                // Extract thinking blocks from content
                const parts = extractor.processChunk(content);
                
                for (const part of parts) {
                  const newDelta = { ...delta };
                  if (part.type === 'thinking') {
                    newDelta.reasoning_content = part.content;
                    delete newDelta.content;
                  } else {
                    newDelta.content = part.content;
                  }
                  parsed.choices[0].delta = newDelta;
                  onChunk('data: ' + JSON.stringify(parsed) + '\n\n', false, provider.key);
                }
              } else {
                onChunk(line + '\n\n', false, provider.key);
              }
            } catch {
              onChunk(line + '\n\n', false, provider.key);
            }
          } else {
            // Wrap raw JSON lines in SSE format
            onChunk('data: ' + line + '\n\n', false, provider.key);
          }
        }
      }
      
      // Process any remaining data in buffer
      if (buffer.trim()) {
        const line = buffer.trim();
        if (line.startsWith('data:')) {
          onChunk(line + '\n\n', false, provider.key);
        } else {
          onChunk('data: ' + line + '\n\n', false, provider.key);
        }
      }
      
      // Flush any remaining thinking content
      const finalParts = extractor.flush();
      for (const part of finalParts) {
        if (part.type === 'thinking') {
          const parsed = {
            choices: [{ delta: { reasoning_content: part.content } }]
          };
          onChunk('data: ' + JSON.stringify(parsed) + '\n\n', false, provider.key);
        } else if (part.content) {
          const parsed = {
            choices: [{ delta: { content: part.content } }]
          };
          onChunk('data: ' + JSON.stringify(parsed) + '\n\n', false, provider.key);
        }
      }
      
      onChunk(null, true, provider.key);
      logRequest({ provider: provider.key, model: selectedModelId, latencyMs: Date.now() - startTime, success: true, tokensIn: estimateTokens(requestBody.messages), tokensOut: 0, requestModel: originalModel });
      return { status: response.status, body: '', provider: provider.key, streaming: true };
    }
    
    // NON-STREAMING MODE: collect full response
    const data = await response.text();

    // Convert Anthropic response format to OpenAI format
    let responseData = data;
    if (isAnthropic) {
      try {
        const anthroResp = JSON.parse(data);
        // Anthropic format → OpenAI format
        const textContent = (anthroResp.content || [])
          .filter(p => p.type === 'text')
          .map(p => p.text)
          .join('');
        const openaiResp = {
          id: 'chatcmpl-' + anthroResp.id?.replace('msg_', '') || Date.now().toString(36),
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: 'anthropic/' + (anthroResp.model || selectedModelId),
          choices: [{
            index: 0,
            message: { role: 'assistant', content: textContent || null },
            finish_reason: anthroResp.stop_reason === 'end_turn' ? 'stop' : (anthroResp.stop_reason || 'stop'),
          }],
          usage: {
            prompt_tokens: anthroResp.usage?.input_tokens || 0,
            completion_tokens: anthroResp.usage?.output_tokens || 0,
            total_tokens: (anthroResp.usage?.input_tokens || 0) + (anthroResp.usage?.output_tokens || 0),
          },
        };
        responseData = JSON.stringify(openaiResp);
      } catch (e) {
        console.warn('[Proxy] Anthropic response parse error:', e.message);
      }
    }

    console.log(`[Proxy] ✅ ${provider.key} succeeded (${response.status})`);
    recordSuccess(provider.key);

    const cleanedData = cleanResponseBody(responseData);
    // 尝试从响应中解析 token 用量
    let tokensIn = 0;
    let tokensOut = 0;
    try {
      const parsedResp = JSON.parse(data);
      if (parsedResp.usage) {
        tokensIn = parsedResp.usage.prompt_tokens || 0;
        tokensOut = parsedResp.usage.completion_tokens || 0;
      }
    } catch {}
    logRequest({ provider: provider.key, model: selectedModelId, latencyMs: Date.now() - startTime, success: true, tokensIn, tokensOut, requestModel: originalModel });
    return { status: response.status, body: cleanedData, provider: provider.key };
    
  } catch (error) {
    // If error already has status property, it's our formatted error (HTTP error)
    if (error.status !== undefined) {
      // Degrade all same-tier models on auth errors (401/403/500+) only
      if (error.status === 401 || error.status === 403 || error.status >= 500) {
        try {
          const { setModelTier, getAllModelTiers } = require('./db');
          const allTiers = getAllModelTiers();
          const failedTier = allTiers[provider.key + '/' + selectedModelId];
          if (failedTier && ['S+','S','A+','A','A-','B+','B'].includes(failedTier)) {
            const prefix = provider.key + '/';
            let degraded = 0;
            for (const [key, tier] of Object.entries(allTiers)) {
              if (!key.startsWith(prefix) || tier !== failedTier) continue;
              try { setModelTier(key.substring(prefix.length), provider.key, 'C'); degraded++; } catch {}
            }
            if (degraded > 0) console.log(`[Proxy] Degraded ${degraded} ${failedTier} models for ${provider.key} to C (HTTP ${error.status})`);
          }
        } catch {}
      }
      if (error.status !== 404 && error.status !== 410) throw error;
      // For 404/410, try next model
      lastError = error;
      continue;
    }

    // Network errors (ECONNRESET, DNS failures, timeouts)
    const isTimeout = error instanceof DOMException && error.name === 'AbortError';
    const errorMsg = isTimeout ? 'Timeout' : error.message;
    console.log(`[Proxy] ❌ ${provider.key} network error: ${errorMsg} for ${selectedModelId}`);
    logRequest({ provider: provider.key, model: selectedModelId, latencyMs: Date.now() - startTime, success: false, tokensIn: 0, tokensOut: 0, requestModel: originalModel });

    // Timeout/network error → try next model in same provider (if available)
    if (modelIdx < modelsToTry.length - 1) {
      lastError = { status: 0, error: errorMsg, provider: provider.key };
      continue; // try next model
    }

    // Degrade all same-tier models on network errors
    try {
      const { setModelTier, getAllModelTiers } = require('./db');
      const allTiers = getAllModelTiers();
      const failedTier = allTiers[provider.key + '/' + selectedModelId];
      if (failedTier && ['S+','S','A+','A','A-','B+','B'].includes(failedTier)) {
        const prefix = provider.key + '/';
        let degraded = 0;
        for (const [key, tier] of Object.entries(allTiers)) {
          if (!key.startsWith(prefix) || tier !== failedTier) continue;
          try { setModelTier(key.substring(prefix.length), provider.key, 'C'); degraded++; } catch {}
        }
        if (degraded > 0) console.log(`[Proxy] Degraded ${degraded} ${failedTier} models for ${provider.key} to C (timeout)`);
      }
    } catch {}

    recordFailure(provider.key);
    throw { status: 0, error: errorMsg, provider: provider.key };
  }
  } // end for loop

  // All models exhausted
  if (lastError) throw lastError;
  throw { status: 0, error: 'No models available', provider: provider.key };
}

/**
 * Handle chat completions with failover
 * Strategy: Sticky sessions + rate-aware routing + vision detection
 */
async function handleChatCompletions(reqBody, onStreamChunk = null) {
  const isStream = isStreaming(reqBody);
  const config = loadConfig();
  
  // Track fallback attempts for response headers
  let fallbackCount = 0;
  // Save original model before tier routing modifies it
  const originalModel = reqBody.model;
  // Track tried tiers to prevent fallback loops (tier-c → tier-b → tier-c)
  const triedTiers = new Set();
  // Detect vision requests and filter providers
  const visionOnly = hasVisionInput(reqBody);
  let providers = getPrioritizedProviders(config, { visionOnly });
  
  if (providers.length === 0) {
    throw new Error(visionOnly ? 'No vision-capable providers available' : 'No providers configured');
  }
  
  // Clean up old rate limit data periodically
  cleanRateLimits();

  // Get session early for sticky session management
  const sessionId = getSessionId(reqBody);
  
  // Filter providers based on tier-* request with fallback chain
  const requestedTierAlias = reqBody.model && TIER_ALIAS_MAP[reqBody.model];
  if (requestedTierAlias) {
    // Clear sticky/active so tier-* gets fresh routing (not history)
    if (sessionId) {
      clearActiveProvider(sessionId);
      try { setStickyProvider(sessionId, { key: '', apiKey: '', expires: 0 }); } catch {}
    }
    // Try exact tier, then fallback chain (e.g. A+ → A → B+ → B)
    const tiersToTry = [reqBody.model, ...(TIER_FALLBACK[reqBody.model] || [])];
    let resolvedAlias = null;
    for (const tierAlias of tiersToTry) {
      const tier = TIER_ALIAS_MAP[tierAlias];
      const matching = providers.filter(p => p.models.some(mid => p.modelTiers?.[mid] === tier));
      if (matching.length > 0) {
        providers = matching;
        resolvedAlias = tierAlias;
        break;
      }
    }
    if (!resolvedAlias || !providers.length) {
      // Last resort: use all non-circuit-broken providers
      providers = providers.filter(p => !isCircuitOpen(p.key));
      if (providers.length === 0) {
        throw new Error(`No providers with ${requestedTierAlias} tier models available`);
      }
    }
    // Override request model to resolved tier so forwardToProvider filters correctly
    reqBody.model = resolvedAlias;
  }
  
  const errors = [];
  let chosenProvider = null;
  
  // 0. Sticky session: try the same provider as last time
  if (sessionId) {
    const sticky = getStickyProvider(sessionId);
    if (sticky && !isCircuitOpen(sticky.key)) {
      const match = providers.find(p => p.key === sticky.key && p.apiKey === sticky.apiKey);
      if (match) {
        const contextCheck = checkContextFit(match, reqBody);
        if (contextCheck.fits) {
          chosenProvider = match;
        }
      }
    }
  }
  
  // 1. If no sticky hit, try the active provider for this session
  const currentActive = getActiveProvider(sessionId);
  if (!chosenProvider && currentActive && !isCircuitOpen(currentActive.key)) {
    const stillConfigured = providers.find(p => p.key === currentActive.key && p.apiKey === currentActive.apiKey);
    if (stillConfigured) {
      const contextCheck = checkContextFit(stillConfigured, reqBody);
      if (contextCheck.fits) {
        chosenProvider = stillConfigured;
      } else {
        console.log(`[Proxy] ⚠️ Active provider ${currentActive.key} model ${contextCheck.model} context too small (${contextCheck.tokens} > ${contextCheck.limit}), skipping...`);
        errors.push({ provider: currentActive.key, error: `Context too small: ${contextCheck.tokens} > ${contextCheck.limit}` });
        clearActiveProvider(sessionId);
      }
    } else {
      clearActiveProvider(sessionId);
    }
  }
  
  // 2. If chosen from sticky/active, try it first
  if (chosenProvider) {
    // Context handoff: if provider changed from previous session, inject handoff message
    if (sessionId && process.env.FLAP_CONTEXT_HANDOFF === 'true') {
      const prevSticky = getStickyProvider(sessionId);
      if (prevSticky && prevSticky.key !== chosenProvider.key) {
        const handoffMsg = {
          role: 'system',
          content: `[Context Handoff]\nYou are continuing a conversation that was started with another model (${prevSticky.key}). Continue the user's task using the conversation context provided in this request. Do not restart the task or re-ask already answered questions.\n[/Context Handoff]`
        };
        reqBody.messages = [handoffMsg, ...(reqBody.messages || [])];
        console.log(`[Proxy] Context handoff: ${prevSticky.key} → ${chosenProvider.key}`);
      }
    }
    try {
      console.log(`[Proxy] Using ${sessionId ? 'sticky' : 'active'} provider: ${chosenProvider.key}`);
      const result = await forwardToProvider(chosenProvider, reqBody, onStreamChunk);
      if (result.streaming) return result;
      
      stats.totalRequests++; stats.successfulRequests++;
      stats.providerUsage.set(chosenProvider.key, (stats.providerUsage.get(chosenProvider.key) || 0) + 1);
      recordRateLimit(chosenProvider.key, chosenProvider.apiKey);
      if (sessionId) setStickyProvider(sessionId, chosenProvider);
      
      try {
        const responseObj = JSON.parse(result.body);
        if (responseObj.model) responseObj.model = `${chosenProvider.key}/${responseObj.model}`;
        const limits = getModelLimits(responseObj.model?.replace(chosenProvider.key + '/', '') || chosenProvider.models[0]);
        return { status: result.status, body: JSON.stringify(responseObj), provider: chosenProvider.key, limits, fallbackCount };
      } catch {
        return { ...result, limits: getModelLimits(chosenProvider.models[0]), fallbackCount };
      }
    } catch (err) {
      console.log(`[Proxy] ${sessionId ? 'Sticky' : 'Active'} provider ${chosenProvider.key} failed, failover...`);
      errors.push({ provider: chosenProvider.key, error: err.error || err.message });
      fallbackCount++;
      if (err.status === 429) setCooldown(chosenProvider.key, chosenProvider.apiKey, RATE_LIMIT_COOLDOWN_MS);
      // Remove failed provider from failover list so it isn't retried immediately
      providers = providers.filter(p => !(p.key === chosenProvider.key && p.apiKey === chosenProvider.apiKey));
      if (!sessionId) clearActiveProvider(sessionId);
    }
  }
  
  // 3. Failover: try providers in priority order
  for (const provider of providers) {
    if (isCircuitOpen(provider.key)) {
      errors.push({ provider: provider.key, error: 'Circuit breaker open' });
      continue;
    }
    
    const contextCheck = checkContextFit(provider, reqBody);
    if (!contextCheck.fits) {
      console.log(`[Proxy] ⚠️ Provider ${provider.key} model ${contextCheck.model} context too small (${contextCheck.tokens} > ${contextCheck.limit}), skipping...`);
      errors.push({ provider: provider.key, error: `Context too small: ${contextCheck.tokens} > ${contextCheck.limit}` });
      continue;
    }
    
    try {
      console.log(`[Proxy] Trying provider: ${provider.key} (${contextCheck.tokens} tokens / ${contextCheck.limit} limit)`);
      const result = await forwardToProvider(provider, reqBody, onStreamChunk);
      
      if (result.streaming) return result;
      
      stats.totalRequests++; stats.successfulRequests++;
      stats.providerUsage.set(provider.key, (stats.providerUsage.get(provider.key) || 0) + 1);
      recordRateLimit(provider.key, provider.apiKey);
      
      setActiveProvider(sessionId, { key: provider.key, apiKey: provider.apiKey, name: provider.name, url: provider.url, models: provider.models });
      if (sessionId) setStickyProvider(sessionId, { key: provider.key, apiKey: provider.apiKey, name: provider.name, url: provider.url, models: provider.models });
      console.log(`[Proxy] Set active provider: ${provider.key}`);
      
      try {
        const responseObj = JSON.parse(result.body);
        if (responseObj.model) responseObj.model = `${provider.key}/${responseObj.model}`;
        const limits = getModelLimits(responseObj.model?.replace(provider.key + '/', '') || provider.models[0]);
        return { status: result.status, body: JSON.stringify(responseObj), provider: provider.key, limits, fallbackCount };
      } catch {
        return { ...result, limits: getModelLimits(provider.models[0]), fallbackCount };
      }
    } catch (err) {
      errors.push({ provider: provider.key, error: err.error || err.message });
      fallbackCount++;
      if (err.status === 429) setCooldown(provider.key, provider.apiKey, RATE_LIMIT_COOLDOWN_MS);
    }
  }
  
  // All providers failed — try fallback to next tier if this was a tier-* request
  const requestedTier = originalModel && TIER_ALIAS_MAP[originalModel];
  if (requestedTier && reqBody.model) {
    triedTiers.add(reqBody.model); // Mark current tier as tried
    const fallbacks = TIER_FALLBACK[reqBody.model] || [];
    for (const fb of fallbacks) {
      if (!triedTiers.has(fb)) {
        triedTiers.add(fb);
        reqBody.model = fb;
        console.log(`[Proxy] ⬇ Tier fallback: ${originalModel} → ${fb}`);
        return handleChatCompletions(reqBody, onStreamChunk);
      }
    }
  }
  
  // All fallbacks exhausted
  stats.totalRequests++;
  stats.failedRequests++;
  
  const errorTypes = errors.map(e => `${e.provider}: ${e.error}`).join('; ');
  console.log(`[Proxy] 💥 All ${providers.length} providers failed. Errors: ${errorTypes}`);
  throw new Error(`All providers failed. Errors: ${errorTypes}`);
}

/**
 * Create HTTP server
 */
function createServer() {
  const server = http.createServer(async (req, res) => {
    try {
      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      
      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }
      
      // Parse URL
      const reqUrl = new URL(req.url, 'http://127.0.0.1');
      const pathname = reqUrl.pathname;
      const parsedUrl = { pathname, query: Object.fromEntries(reqUrl.searchParams) };
    
    // Health check
    if (pathname === '/health' && req.method === 'GET') {
      const config = loadConfig();
      const providers = getPrioritizedProviders(config);
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'healthy',
        version: APP_VERSION,
        providers: providers.length,
        total_requests: stats.totalRequests,
        successful_requests: stats.successfulRequests,
        failed_requests: stats.failedRequests,
        healthy_endpoints: providers.filter(p => !isCircuitOpen(p.key)).map(p => p.name),
        circuit_breaker: Array.from(circuitBreaker.entries()).map(([k, v]) => ({
          provider: k,
          open: v.open,
          failures: v.failures,
        })),
      }));
      return;
    }
    
    // Stats endpoint
    if (pathname === '/stats' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        total_requests: stats.totalRequests,
        successful_requests: stats.successfulRequests,
        failed_requests: stats.failedRequests,
        provider_usage: Object.fromEntries(stats.providerUsage),
      }));
      return;
    }
    
    // Chat completions
    if (pathname === '/v1/chat/completions' && req.method === 'POST') {
      // Validate API key (case-insensitive Bearer prefix per HTTP spec)
      // Also accept admin session cookie for same-origin requests
      const authHeader = req.headers.authorization || '';
      const bearerMatch = authHeader.match(/^bearer\s+(.+)$/i);
      const apiKey = bearerMatch ? bearerMatch[1].trim() : authHeader.trim();

      let isAuthed = false;

      // 1. Check Bearer token against server key
      if (apiKey && timingSafeEqual(apiKey, getServerKey())) {
        isAuthed = true;
      }

      // 2. Check session cookie (for admin UI playground requests)
      if (!isAuthed) {
        try {
          const cookies = parseCookies(req);
          if (cookies.flap_session) {
            const session = validateSession(cookies.flap_session);
            if (session) isAuthed = true;
          }
        } catch {}
      }

      if (!isAuthed) {
        jsonError(res, 401, 'Invalid API key or session');
        return;
      }
      
      // Read body (with size limit to prevent memory exhaustion)
      let body = '';
      let bodyDestroyed = false;
      const MAX_PROXY_BODY = 1024 * 1024; // 1MB
      req.on('data', chunk => {
        if (bodyDestroyed) return;
        body += chunk;
        if (body.length > MAX_PROXY_BODY) {
          bodyDestroyed = true;
          req.pause();
          if (!res.headersSent) {
            jsonError(res, 413, 'Request body too large');
          }
        }
      });
      req.on('end', async () => {
        if (bodyDestroyed) return;
        try {
          const requestBody = JSON.parse(body);
          const isStream = isStreaming(requestBody);
          
          if (isStream) {
            // STREAMING MODE: Try providers without sending headers first
            let providerName = 'unknown';
            let headersSent = false;

            const onChunk = (chunk, isDone, provider) => {
              if (provider && providerName === 'unknown') {
                providerName = provider;
              }
              
              if (isDone) {
                if (!headersSent) {
                  // Provider succeeded but no chunks arrived before done
                  // This shouldn't happen, but handle it
                  headersSent = true;
                  res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    'X-Provider': providerName,
                  });
                }
                // Send final [DONE] marker
                res.write('data: [DONE]\n\n');
                res.end();
              } else if (chunk) {
                if (!headersSent) {
                  // First successful chunk - send headers now
                  headersSent = true;
                  res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    'X-Provider': providerName,
                  });
                }
                res.write(chunk);
              }
            };
            
            try {
              await handleChatCompletions(requestBody, onChunk);
            } catch (err) {
              console.log(`[Proxy] Streaming error: ${err.message}`);
              if (!res.writableEnded) {
                if (!headersSent) {
                  // No chunks sent yet — send proper 502 error
                  headersSent = true;
                  const errMsg = err.error || err.message || 'All providers failed';
                  jsonError(res, 502, errMsg, providerName !== 'unknown' ? providerName : '');
                } else {
                  // Partial stream started — send error via SSE (can't change status)
                  try {
                    res.write('data: {"error":"' + (err.error || 'All providers failed') + '"}\n\n');
                    res.write('data: [DONE]\n\n');
                    res.end();
                  } catch {}
                }
              }
            }
          } else {
            // NON-STREAMING MODE
            const result = await handleChatCompletions(requestBody);
            
            const headers = {
              'Content-Type': 'application/json',
              'X-Provider': result.provider,
            };
            if (result.fallbackCount > 0) headers['X-Fallback-Attempts'] = String(result.fallbackCount);
            
            if (result.limits) {
              headers['X-Model-Limit-Context'] = String(result.limits.context);
              headers['X-Model-Limit-Output'] = String(result.limits.output);
            }
            
            res.writeHead(result.status, headers);
            res.end(result.body);
          }
        } catch (err) {
          const isJsonError = err instanceof SyntaxError && err.message.includes('JSON');
          if (isJsonError) {
            jsonError(res, 400, 'Invalid request body');
          } else if (err.error) {
            jsonError(res, err.code || 502, err.error, err.provider);
          } else {
            jsonError(res, 502, err.message || 'All providers failed');
          }
        }
      });
      return;
    }

    // ============================================================
    // Anthropic-compatible /v1/messages endpoint
    // ============================================================
    if (pathname === '/v1/messages' && req.method === 'POST') {
      const authHeader = req.headers.authorization || '';
      const bearerMatch = authHeader.match(/^bearer\s+(.+)$/i);
      const apiKey = bearerMatch ? bearerMatch[1].trim() : authHeader.trim();

      let isAuthed = false;
      if (apiKey && timingSafeEqual(apiKey, getServerKey())) { isAuthed = true; }
      if (!isAuthed) {
        // Also accept x-api-key (Anthropic native auth)
        const xApiKey = req.headers['x-api-key'];
        if (xApiKey && timingSafeEqual(xApiKey, getServerKey())) { isAuthed = true; }
      }
      if (!isAuthed) {
        try {
          const cookies = parseCookies(req);
          if (cookies.flap_session && validateSession(cookies.flap_session)) isAuthed = true;
        } catch {}
      }
      if (!isAuthed) { jsonError(res, 401, 'Invalid API key'); return; }

      let body = '';
      let bodyDestroyed = false;
      req.on('data', chunk => {
        if (bodyDestroyed) return;
        body += chunk;
        if (body.length > 1024 * 1024) { bodyDestroyed = true; req.pause(); if (!res.headersSent) jsonError(res, 413, 'Request body too large'); }
      });
      req.on('end', async () => {
        if (bodyDestroyed) return;
        try {
          const anthroBody = JSON.parse(body);
          // Convert Anthropic request → OpenAI internal format
          const openaiBody = {
            model: anthroBody.model || 'tier-b',
            messages: [],
            max_tokens: anthroBody.max_tokens || 4096,
            stream: !!anthroBody.stream,
          };
          if (anthroBody.system) openaiBody.messages.push({ role: 'system', content: anthroBody.system });
          if (Array.isArray(anthroBody.messages)) {
            for (const m of anthroBody.messages) {
              let content = '';
              if (typeof m.content === 'string') content = m.content;
              else if (Array.isArray(m.content)) content = m.content.filter(p => p.type === 'text').map(p => p.text).join('\n');
              openaiBody.messages.push({ role: m.role || 'user', content });
            }
          }
          if (!openaiBody.messages.length) { jsonError(res, 400, 'Missing messages'); return; }

          const isStream = openaiBody.stream;
          if (isStream) {
            let providerName = 'unknown', headersSent = false, started = false;
            const onChunk = (chunk, done, prov) => {
              if (prov) providerName = prov;
              if (!headersSent) {
                headersSent = true;
                res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Provider': providerName });
              }
              if (done) {
                if (started) res.write('event: message_stop\ndata: {"type":"message_stop"}\n\n');
                res.end();
              } else if (chunk) {
                try {
                  const line = chunk.replace(/^data: /, '').trim();
                  if (line === '[DONE]' || !line) return;
                  const parsed = JSON.parse(line);
                  const delta = parsed.choices?.[0]?.delta?.content || '';
                  if (delta && !started) {
                    started = true;
                    res.write('event: message_start\ndata: ' + JSON.stringify({ type: 'message_start', message: { id: 'msg_' + Date.now().toString(36), type: 'message', role: 'assistant', content: [], model: 'flap/' + providerName, stop_reason: null, usage: { input_tokens: 0, output_tokens: 0 } } }) + '\n\n');
                  }
                  if (delta) res.write('event: content_block_delta\ndata: ' + JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: delta } }) + '\n\n');
                } catch {}
              }
            };
            try {
              await handleChatCompletions(openaiBody, onChunk);
              if (!headersSent) {
                headersSent = true;
                res.writeHead(200, { 'Content-Type': 'text/event-stream' });
                res.write('event: message_start\ndata: ' + JSON.stringify({ type: 'message_start', message: { id: 'msg_' + Date.now().toString(36), type: 'message', role: 'assistant', content: [], model: 'flap/' + providerName, stop_reason: null, usage: { input_tokens: 0, output_tokens: 0 } } }) + '\n\n');
                res.write('event: message_stop\ndata: {"type":"message_stop"}\n\n');
                res.end();
              }
            } catch (err) {
              if (!res.writableEnded) {
                const e = err.error || err.message || 'All providers failed';
                if (!headersSent) { headersSent = true; jsonError(res, 502, e); }
                else { try { res.write('event: error\ndata: {"error":"' + e + '"}\n\n'); res.end(); } catch {} }
              }
            }
          } else {
            const result = await handleChatCompletions(openaiBody);
            const resp = JSON.parse(result.body);
            const content = resp.choices?.[0]?.message?.content || '';
            const modelName = resp.model || 'flap/' + result.provider;
            const fr = resp.choices?.[0]?.finish_reason || 'stop';
            const anthroResp = {
              id: 'msg_' + Date.now().toString(36), type: 'message', role: 'assistant',
              content: [{ type: 'text', text: content }], model: modelName,
              stop_reason: fr === 'stop' ? 'end_turn' : (fr || 'end_turn'), stop_sequence: null,
              usage: { input_tokens: resp.usage?.prompt_tokens || 0, output_tokens: resp.usage?.completion_tokens || 0 },
            };
            res.writeHead(200, { 'Content-Type': 'application/json', 'X-Provider': result.provider });
            res.end(JSON.stringify(anthroResp));
          }
        } catch (err) {
          const isJson = err instanceof SyntaxError && err.message.includes('JSON');
          if (isJson) jsonError(res, 400, 'Invalid request body');
          else if (err.error) jsonError(res, 502, err.error, err.provider);
          else jsonError(res, 502, err.message || 'All providers failed');
        }
      });
      return;
    }

    // ============================================================
    // OpenAI-compatible /v1/embeddings endpoint
    // ============================================================
    if (pathname === '/v1/embeddings' && req.method === 'POST') {
      const authHeader = req.headers.authorization || '';
      const bearerMatch = authHeader.match(/^bearer\s+(.+)$/i);
      const apiKey = bearerMatch ? bearerMatch[1].trim() : authHeader.trim();
      let isAuthed = false;
      if (apiKey && timingSafeEqual(apiKey, getServerKey())) isAuthed = true;
      if (!isAuthed) {
        try { const cookies = parseCookies(req); if (cookies.flap_session) { const s = validateSession(cookies.flap_session); if (s) isAuthed = true; } } catch {}
      }
      if (!isAuthed) { jsonError(res, 401, 'Invalid API key'); return; }

      let body = '';
      req.on('data', chunk => { body += chunk; if (body.length > 1024 * 1024) { req.destroy(); body = ''; } });
      req.on('end', async () => {
        try {
          const reqBody = JSON.parse(body);
          const modelId = reqBody.model || '';
          const input = reqBody.input;
          if (!input) { jsonError(res, 400, 'Missing required field: input'); return; }
          if (!modelId) { jsonError(res, 400, 'Missing required field: model'); return; }

          // Find provider from model ID (provider/model_id format)
          const config = loadConfig();
          const providers = getPrioritizedProviders(config);
          const parts = modelId.split('/');
          const providerKey = parts.length > 1 ? parts[0] : null;

          let chosenProvider = null;
          if (providerKey) {
            chosenProvider = providers.find(p => p.key === providerKey && p.apiKey);
          }
          if (!chosenProvider) {
            chosenProvider = providers.find(p => p.apiKey && !isCircuitOpen(p.key));
          }
          if (!chosenProvider) {
            jsonError(res, 503, 'No available provider for embeddings');
            return;
          }

          // Forward request (OpenAI embeddings API format)
          // Use provider's base URL: replace /chat/completions with /embeddings or use /v1/embeddings
          let embedUrl = chosenProvider.url;
          if (embedUrl.includes('/chat/completions')) {
            embedUrl = embedUrl.replace('/chat/completions', '/embeddings');
          } else {
            embedUrl = embedUrl.replace(/\/+$/, '') + '/embeddings';
          }

          const forwardBody = {
            model: parts.length > 1 ? parts.slice(1).join('/') : modelId,
            input: input,
          };
          if (reqBody.encoding_format) forwardBody.encoding_format = reqBody.encoding_format;

          const resp = await fetch(embedUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${chosenProvider.apiKey}`,
            },
            body: JSON.stringify(forwardBody),
            signal: AbortSignal.timeout(30000),
          });

          const data = await resp.json();
          // Fix model name in response to include provider prefix
          if (data.model && providerKey && !data.model.startsWith(providerKey + '/')) {
            data.model = providerKey + '/' + data.model;
          }
          res.writeHead(resp.status, { 'Content-Type': 'application/json', 'X-Provider': chosenProvider.key });
          res.end(JSON.stringify(data));
        } catch (err) {
          jsonError(res, 502, err.message || 'Embeddings failed');
        }
      });
      return;
    }

    // Models list — tier aliases + synced models + discovered models
    if (pathname === '/v1/models' && req.method === 'GET') {
      const { getAllDiscoveredModels } = require('./admin');
      const { getAllSyncedModels } = require('./sync');
      
      // Tier alias models
      const tiers = [
        { id: 'tier-splus', name: 'S+ Tier (Elite)', desc: '70%+ SWE-bench - Best for complex refactors' },
        { id: 'tier-s', name: 'S Tier (Excellent)', desc: '60-70% SWE-bench - Reliable for most tasks' },
        { id: 'tier-aplus', name: 'A+ Tier (Very Capable)', desc: '50-60% SWE-bench - Great alternatives' },
        { id: 'tier-a', name: 'A Tier (Solid)', desc: '40-50% SWE-bench - Good general use' },
        { id: 'tier-aminus', name: 'A- Tier (Decent)', desc: '35-40% SWE-bench - Simpler tasks' },
        { id: 'tier-bplus', name: 'B+ Tier (Capable)', desc: '30-35% SWE-bench - Small tasks' },
        { id: 'tier-b', name: 'B Tier (Entry)', desc: '20-30% SWE-bench - Default fallback' },
        { id: 'tier-c', name: 'C Tier (Basic)', desc: '<20% SWE-bench - Last resort' },
      ];
      
      const data = tiers.map(t => ({
        id: t.id,
        object: 'model',
        owned_by: 'free-llm-api-provider',
        created: 1700000000,
      }));

      // Append synced models (from litellm catalog)
      const synced = getAllSyncedModels();
      for (const m of synced) {
        data.push({
          id: m.id,
          object: 'model',
          owned_by: m.provider || 'synced',
          created: 1700000000,
        });
      }

      // Append discovered models
      const discovered = getAllDiscoveredModels();
      for (const m of discovered) {
        data.push({
          id: m.id,
          object: m.object || 'model',
          owned_by: m.owned_by || m.provider || 'discovered',
          created: Math.floor((m.discoveredAt || Date.now()) / 1000),
        });
      }

      // Append static models from models.js (for providers not in litellm)
      const syncedIds = new Set(synced.map(m => m.id));
      const staticModels = [];
      for (const [key, s] of Object.entries(sources)) {
        for (const m of (s.models || [])) {
          const mid = key + '/' + m[0];
          if (!syncedIds.has(mid)) {
            staticModels.push({ id: mid, provider: key });
          }
        }
      }
      for (const m of staticModels) {
        data.push({
          id: m.id,
          object: 'model',
          owned_by: m.provider || 'static',
          created: 1700000000,
        });
      }
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        object: 'list',
        data,
      }));
      return;
    }
    
    // Favicon
    if (pathname === '/favicon.ico') {
      res.writeHead(204); res.end();
      return;
    }

    // Admin web UI and API
    if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) {
      const handled = await handleAdminRequest(parsedUrl, req, res);
      if (handled) return;
    }
    
    // 404 — only if response hasn't been sent yet
    if (!res.headersSent) {
      jsonError(res, 404, 'Not found');
    }
    } catch (err) {
      console.error('[Proxy] Unhandled error:', err instanceof Error ? err.stack : String(err));
      if (!res.headersSent) {
        try { jsonError(res, 500, 'Internal server error'); } catch(e) {}
      }
    }
  });
  
  return server;
}

/**
 * Start proxy server
 */
function startProxyServer(port = PROXY_PORT) {
  // Initialize SQLite database (creates tables, migrates data, ensures admin user)
  try { initDatabase(); } catch (err) { console.error('[DB] Init error:', err instanceof Error ? err.message : String(err)); }

  // Auto-discover models from all configured providers on startup
  autoDiscoverModelsOnStartup();

  
  const server = createServer();
  
  server.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Proxy server running on http://localhost:${port}`);
    console.log(`   Health: http://localhost:${port}/health`);
    console.log(`   API:    http://localhost:${port}/v1/chat/completions`);
  });
  
  return server;
}

function autoDiscoverModelsOnStartup() {
  const config = loadConfig();
  const { sources } = require('./models');
  const enabled = Object.keys(sources).filter(k => sources[k]?.url && !sources[k]?.cliOnly);
  const { getAllApiKeys } = require('./config');
  for (const key of enabled) {
    if (sources[key]?.noKeyRequired) {
      discoverProviderModels(key, '').catch(() => {});
    } else {
      const keys = getAllApiKeys(config, key);
      if (keys.length > 0) {
        discoverProviderModels(key, keys[0]).catch(() => {});
      }
    }
  }
  console.log('[Auto] 模型自动发现已启动（后台运行）');
}

module.exports = {
  createServer,
  startProxyServer,
  PROXY_PORT,
  invalidateServerKeyCache,
};

// If run directly
if (require.main === module) {
  startProxyServer();
}
