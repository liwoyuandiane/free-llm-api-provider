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
const { handleAdminRequest } = require('./admin');
const { initDatabase, getDisabledModels, getCustomProviders, getCustomProviderModels, getServerApiKey: dbGetServerApiKey, getModelsWithTier, isRateLimited, recordRateLimit, setCooldown, cleanRateLimits, getStickyProvider, setStickyProvider, isVisionModel, logRequest, getAllProviderPriorities, getDiscoveredModelsByProvider } = require('./db');

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
  return crypto.timingSafeEqual(bufA, bufB);
}

// Server API key — resolved from env var > SQLite > JSON config > auto-generate
function getServerKey() {
  const envKey = process.env.FLAP_API_KEY;
  if (envKey && envKey.startsWith('sk-')) return envKey;
  try {
    const dbKey = dbGetServerApiKey();
    if (dbKey && dbKey.startsWith('sk-')) return dbKey;
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

// Request timeout per provider (ms)
const PROVIDER_TIMEOUT = 15000;

// Circuit breaker state
const circuitBreaker = new Map(); // providerKey -> { failures, lastFailure, open }
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

// Active provider tracking - stick to what works until it fails
let activeProvider = null; // { key, apiKey, name, url, models }

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
        // Check for private IPs
        const isPrivate = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|0\.|169\.254\.)/.test(hostname) ||
          hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal');
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
          const providerLimits = require('./db').getProviderLimits(key);
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
  if (!state.open) return false;
  if (Date.now() - state.lastFailure > CIRCUIT_RESET_MS) {
    state.open = false;
    state.failures = 0;
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
    state = { failures: 0, lastFailure: 0, open: false };
    circuitBreaker.set(providerKey, state);
  }
  state.failures++;
  state.lastFailure = Date.now();
  if (state.failures >= CIRCUIT_THRESHOLD) {
    state.open = true;
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
  const targetUrl = provider.url.includes('/chat/completions')
    ? provider.url
    : provider.url.replace(/\/$/, '') + '/v1/chat/completions';

  // Determine which models to try (multi-model failover within provider)
  let modelsToTry = [provider.models[0]]; // default: first model
  if (requestBody.model && requestBody.model.startsWith('tier-')) {
    // For tier requests, try all models in this provider (best tier first)
    modelsToTry = provider.models;
  } else if (requestBody.model === 'auto' || !requestBody.model) {
    modelsToTry = provider.models;
  }

  let lastError = null;

  for (let modelIdx = 0; modelIdx < modelsToTry.length; modelIdx++) {
  // Prepare request body - deep clone to avoid mutating original
  let body = JSON.parse(JSON.stringify(requestBody));
  let selectedModelId = modelsToTry[modelIdx];

  /**
   * model=auto 或 tier-* 模式：使用当前尝试的模型
   */
  if (body.model === 'auto' || !body.model || body.model.startsWith('tier-')) {
    body.model = selectedModelId;
  }

  // Get model limits and sanitize request body
  const limits = getModelLimits(selectedModelId);
  delete body.maxOutputTokens;
  delete body.responseModalities;
  delete body.safetySettings;
  if (body.generationConfig) {
    delete body.generationConfig.maxOutputTokens;
  }

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
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`,
      },
      body: bodyStr,
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
    console.log(`[Proxy] ✅ ${provider.key} succeeded (${response.status})`);
    recordSuccess(provider.key);
    
    const cleanedData = cleanResponseBody(data);
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
      // For 429 and other non-404 errors, throw immediately
      if (error.status !== 404 && error.status !== 410) throw error;
      // For 404/410, try next model
      lastError = error;
      continue;
    }

    // Network errors (ECONNRESET, DNS failures, timeouts)
    const isTimeout = error instanceof DOMException && error.name === 'AbortError';
    const errorMsg = isTimeout ? 'Timeout' : error.message;
    console.log(`[Proxy] ❌ ${provider.key} network error: ${errorMsg}`);
    recordFailure(provider.key);
    logRequest({ provider: provider.key, model: selectedModelId, latencyMs: Date.now() - startTime, success: false, tokensIn: 0, tokensOut: 0, requestModel: originalModel });
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
  
  // Detect vision requests and filter providers
  const visionOnly = hasVisionInput(reqBody);
  const providers = getPrioritizedProviders(config, { visionOnly });
  
  if (providers.length === 0) {
    throw new Error(visionOnly ? 'No vision-capable providers available' : 'No providers configured');
  }
  
  // Clean up old rate limit data periodically
  cleanRateLimits();
  
  const errors = [];
  let chosenProvider = null;
  
  // 0. Sticky session: try the same provider as last time
  const sessionId = getSessionId(reqBody);
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
  
  // 1. If no sticky hit, try the active provider
  if (!chosenProvider && activeProvider && !isCircuitOpen(activeProvider.key)) {
    const stillConfigured = providers.find(p => p.key === activeProvider.key && p.apiKey === activeProvider.apiKey);
    if (stillConfigured) {
      const contextCheck = checkContextFit(stillConfigured, reqBody);
      if (contextCheck.fits) {
        chosenProvider = stillConfigured;
      } else {
        console.log(`[Proxy] ⚠️ Active provider ${activeProvider.key} model ${contextCheck.model} context too small (${contextCheck.tokens} > ${contextCheck.limit}), skipping...`);
        errors.push({ provider: activeProvider.key, error: `Context too small: ${contextCheck.tokens} > ${contextCheck.limit}` });
        activeProvider = null;
      }
    } else {
      activeProvider = null;
    }
  }
  
  // 2. If chosen from sticky/active, try it first
  if (chosenProvider) {
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
        return { status: result.status, body: JSON.stringify(responseObj), provider: chosenProvider.key, limits };
      } catch {
        return { ...result, limits: getModelLimits(chosenProvider.models[0]) };
      }
    } catch (err) {
      console.log(`[Proxy] ${sessionId ? 'Sticky' : 'Active'} provider ${chosenProvider.key} failed, failover...`);
      errors.push({ provider: chosenProvider.key, error: err.error || err.message });
      if (err.status === 429) setCooldown(chosenProvider.key, chosenProvider.apiKey, RATE_LIMIT_COOLDOWN_MS);
      stats.providerUsage.set(chosenProvider.key, (stats.providerUsage.get(chosenProvider.key) || 0) + 1);
      if (!sessionId) activeProvider = null;
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
      
      activeProvider = { key: provider.key, apiKey: provider.apiKey, name: provider.name, url: provider.url, models: provider.models };
      if (sessionId) setStickyProvider(sessionId, activeProvider);
      console.log(`[Proxy] Set active provider: ${provider.key}`);
      
      try {
        const responseObj = JSON.parse(result.body);
        if (responseObj.model) responseObj.model = `${provider.key}/${responseObj.model}`;
        const limits = getModelLimits(responseObj.model?.replace(provider.key + '/', '') || provider.models[0]);
        return { status: result.status, body: JSON.stringify(responseObj), provider: provider.key, limits };
      } catch {
        return { ...result, limits: getModelLimits(provider.models[0]) };
      }
    } catch (err) {
      errors.push({ provider: provider.key, error: err.error || err.message });
      if (err.status === 429) setCooldown(provider.key, provider.apiKey, RATE_LIMIT_COOLDOWN_MS);
      stats.providerUsage.set(provider.key, (stats.providerUsage.get(provider.key) || 0) + 1);
    }
  }
  
  // All providers failed
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
      // Validate API key
      const authHeader = req.headers.authorization || '';
      const apiKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim();
      
      if (!timingSafeEqual(apiKey, getServerKey())) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid API key' }));
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
          req.destroy();
          if (!res.headersSent) {
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Request body too large' }));
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
                  headersSent = true;
                  res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                  });
                }
                try {
                  res.write('data: {"error":"All providers failed"}\n\n');
                  res.write('data: [DONE]\n\n');
                  res.end();
                } catch {}
              }
            }
          } else {
            // NON-STREAMING MODE
            const result = await handleChatCompletions(requestBody);
            
            const headers = {
              'Content-Type': 'application/json',
              'X-Provider': result.provider,
            };
            
            if (result.limits) {
              headers['X-Model-Limit-Context'] = String(result.limits.context);
              headers['X-Model-Limit-Output'] = String(result.limits.output);
            }
            
            res.writeHead(result.status, headers);
            res.end(result.body);
          }
        } catch (err) {
          const isJsonError = err instanceof SyntaxError && err.message.includes('JSON');
          res.writeHead(isJsonError ? 400 : 502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: isJsonError ? 'Invalid request body' : 'All providers failed',
            message: isJsonError ? '请求体 JSON 格式错误' : 'All providers failed. Check your API keys.',
            suggestion: 'Add more providers or check your API keys',
          }));
        }
      });
      return;
    }
    
    // Models list — tier aliases + discovered models
    if (pathname === '/v1/models' && req.method === 'GET') {
      const { getAllDiscoveredModels } = require('./admin');
      
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
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        object: 'list',
        data,
      }));
      return;
    }
    
    // Admin web UI and API
    if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) {
      const handled = await handleAdminRequest(parsedUrl, req, res);
      if (handled) return;
    }
    
    // 404 — only if response hasn't been sent yet
    if (!res.headersSent) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
    } catch (err) {
      console.error('[Proxy] Unhandled error:', err instanceof Error ? err.stack : String(err));
      if (!res.headersSent) {
        try { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Internal server error' })); } catch(e) {}
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
  
  const server = createServer();
  
  server.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Proxy server running on http://localhost:${port}`);
    console.log(`   Health: http://localhost:${port}/health`);
    console.log(`   API:    http://localhost:${port}/v1/chat/completions`);
  });
  
  return server;
}

module.exports = {
  createServer,
  startProxyServer,
  PROXY_PORT,
};

// If run directly
if (require.main === module) {
  startProxyServer();
}
