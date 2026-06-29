/**
 * Health Checker - Real-time provider health monitoring
 * 
 * Replicated from free-coding-models ping.js + analysis.js
 * Periodically pings all configured providers with actual chat completion requests.
 * Extracts quota from rate limit headers. Stores health scores for routing.
 */

const { getAllApiKeys } = require('./config');
const { sources } = require('./models');

// Constants
const PING_TIMEOUT = 15000;
const HEALTH_CHECK_INTERVAL = 30000;

// Health state per provider-key combo
const healthState = new Map(); // providerKey -> { keys: [{key, latency, status, quota, lastCheck, pings, score}], bestModel }

function getHealthState() {
  const state = {};
  for (const [key, value] of healthState.entries()) {
    state[key] = {
      keys: value.keys.map(k => ({...k})),
      bestModel: value.bestModel,
      overallScore: value.overallScore,
      overallStatus: value.overallStatus,
    };
  }
  return state;
}

function resolveCloudflareUrl(url) {
  const accountId = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  if (!url.includes('{account_id}')) return url;
  if (!accountId) return url.replace('{account_id}', 'missing-account-id');
  return url.replace('{account_id}', encodeURIComponent(accountId));
}

function buildPingRequest(apiKey, modelId, providerKey, url) {
  const apiModelId = providerKey === 'zai' ? modelId.replace(/^zai\//, '') : modelId;

  if (providerKey === 'cloudflare') {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    return {
      url: resolveCloudflareUrl(url),
      headers,
      body: { model: apiModelId, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 },
    };
  }

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (providerKey === 'openrouter') {
    headers['HTTP-Referer'] = 'https://github.com/alexjm19/free-llm-api-provider';
    headers['X-Title'] = 'free-llm-api-provider';
  }

  return {
    url,
    headers,
    body: { model: apiModelId, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 },
  };
}

function getHeaderValue(headers, key) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(key);
  return headers[key] ?? headers[key.toLowerCase()] ?? null;
}

function extractQuotaPercent(headers) {
  const variants = [
    ['x-ratelimit-remaining', 'x-ratelimit-limit'],
    ['x-ratelimit-remaining-requests', 'x-ratelimit-limit-requests'],
    ['ratelimit-remaining', 'ratelimit-limit'],
    ['ratelimit-remaining-requests', 'ratelimit-limit-requests'],
  ];

  for (const [remainingKey, limitKey] of variants) {
    const remainingRaw = getHeaderValue(headers, remainingKey);
    const limitRaw = getHeaderValue(headers, limitKey);
    const remaining = parseFloat(remainingRaw);
    const limit = parseFloat(limitRaw);
    if (Number.isFinite(remaining) && Number.isFinite(limit) && limit > 0) {
      const pct = Math.round((remaining / limit) * 100);
      return Math.max(0, Math.min(100, pct));
    }
  }

  return null;
}

async function ping(apiKey, modelId, providerKey, url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PING_TIMEOUT);
  const t0 = performance.now();
  
  try {
    const req = buildPingRequest(apiKey, modelId, providerKey, url);
    const resp = await fetch(req.url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: req.headers,
      body: JSON.stringify(req.body),
    });
    
    const code = resp.status >= 200 && resp.status < 300 ? '200' : String(resp.status);
    return {
      code,
      ms: Math.round(performance.now() - t0),
      quotaPercent: extractQuotaPercent(resp.headers),
    };
  } catch (err) {
    const isTimeout = err.name === 'AbortError';
    return {
      code: isTimeout ? '000' : 'ERR',
      ms: isTimeout ? PING_TIMEOUT : Math.round(performance.now() - t0),
      quotaPercent: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function pingProvider(providerKey, apiKey, modelId) {
  const provider = sources[providerKey];
  if (!provider || !provider.url) {
    return { provider: providerKey, status: 'no_endpoint', latency: -1, code: 'ERR', quotaPercent: null };
  }

  const result = await ping(apiKey, modelId, providerKey, provider.url);
  
  let status;
  if (result.code === '200') status = 'up';
  else if (result.code === '000') status = 'timeout';
  else if (result.code === '401') status = 'auth_error';
  else if (result.code === '429') status = 'rate_limited';
  else if (result.code === 'ERR') status = 'offline';
  else status = 'error';

  return {
    provider: providerKey,
    status,
    latency: result.ms,
    code: result.code,
    quotaPercent: result.quotaPercent,
  };
}

async function runHealthCheck(config) {
  const checks = [];
  const providerModels = new Map();
  
  for (const [providerKey, provider] of Object.entries(sources)) {
    if (!provider.url || provider.cliOnly || provider.zenOnly) continue;
    
    const keys = getAllApiKeys(config, providerKey);
    if (keys.length === 0) continue;
    
    // Get best model for this provider (first S+ or S or first available)
    const models = require('./models').getModelsByProvider(providerKey);
    const bestModel = models.find(m => m[2] === 'S+') || models.find(m => m[2] === 'S') || models[0];
    const modelId = bestModel ? bestModel[0] : null;
    providerModels.set(providerKey, { modelId, modelName: bestModel ? bestModel[1] : 'Unknown' });
    
    if (!modelId) continue;
    
    // Check each key
    for (const key of keys) {
      const keySuffix = key.slice(-8);
      checks.push(pingProvider(providerKey, key, modelId).then(r => ({...r, modelId, keySuffix})));
    }
  }
  
  const results = await Promise.all(checks);
  
  // Group results by provider
  const byProvider = new Map();
  for (const result of results) {
    if (!byProvider.has(result.provider)) {
      byProvider.set(result.provider, []);
    }
    byProvider.get(result.provider).push(result);
  }
  
  // Update health state per provider
  for (const [providerKey, providerResults] of byProvider) {
    const existing = healthState.get(providerKey) || {
      keys: [],
      bestModel: providerModels.get(providerKey)?.modelName || 'Unknown',
      overallScore: 0,
      overallStatus: 'unknown',
    };
    
    // Update per-key stats
    for (const result of providerResults) {
      const keyId = result.provider + '_' + result.keySuffix;
      let keyState = existing.keys.find(k => k.id === keyId);
      if (!keyState) {
        keyState = {
          id: keyId,
          apiKey: result.keySuffix || 'unknown',
          latency: -1,
          status: 'unknown',
          lastCheck: 0,
          failures: 0,
          successes: 0,
          avgLatency: -1,
          score: 0,
          quotaPercent: null,
          pings: [],
        };
        existing.keys.push(keyState);
      }
      
      // `up` = real success; `auth_error` = server reachable but key wrong (don't count as success)
      const isUp = result.status === 'up';
      const isReachable = isUp || result.status === 'auth_error';

      if (isUp) {
        keyState.successes++;
        keyState.failures = Math.max(0, keyState.failures - 1);
      } else if (!isReachable) {
        // Only count true failures (offline/timeout/error), not auth_error
        keyState.failures++;
        keyState.successes = Math.max(0, keyState.successes - 1);
      }
      
      keyState.status = result.status;
      keyState.latency = result.latency;
      keyState.lastCheck = Date.now();
      keyState.quotaPercent = result.quotaPercent;
      keyState.pings.push({ latency: result.latency, code: result.code, time: Date.now() });
      
      // Keep last 10 pings
      if (keyState.pings.length > 10) keyState.pings.shift();
      
      // Calculate avg latency (exponential moving average)
      if (keyState.avgLatency < 0 && result.latency > 0) {
        keyState.avgLatency = result.latency;
      } else if (result.latency > 0) {
        keyState.avgLatency = keyState.avgLatency * 0.7 + result.latency * 0.3;
      }
      
      // Calculate score
      const totalChecks = keyState.successes + keyState.failures;
      const successRate = totalChecks > 0 ? (keyState.successes / totalChecks) : 0;
      
      let latencyScore = 100;
      if (keyState.avgLatency > 0) {
        if (keyState.avgLatency < 500) latencyScore = 100;
        else if (keyState.avgLatency < 1000) latencyScore = 80;
        else if (keyState.avgLatency < 2000) latencyScore = 60;
        else if (keyState.avgLatency < 5000) latencyScore = 40;
        else latencyScore = 20;
      }
      
      // Quota bonus
      let quotaScore = 100;
      if (keyState.quotaPercent !== null) {
        quotaScore = keyState.quotaPercent;
      }
      
      keyState.score = Math.round(successRate * 50 + latencyScore * 0.25 + quotaScore * 0.15 + 10);
      keyState.score = Math.min(100, Math.max(0, keyState.score));
    }
    
    // Calculate overall provider score (best key)
    const bestKey = existing.keys.length > 0
      ? existing.keys.reduce((best, current) => current.score > best.score ? current : best, existing.keys[0])
      : null;
    existing.overallScore = bestKey ? bestKey.score : 0;
    existing.overallStatus = bestKey ? bestKey.status : 'unknown';
    
    healthState.set(providerKey, existing);
  }
  
  return results;
}

function startHealthChecker(config) {
  runHealthCheck(config).catch(err => console.error('[Health] Initial check error:', err instanceof Error ? err.message : String(err)));
  const interval = setInterval(() => {
    // Cleanup stale entries (providers no longer in sources)
    for (const key of healthState.keys()) {
      if (!sources[key] || !sources[key].url || sources[key].cliOnly) {
        healthState.delete(key);
      }
    }
    runHealthCheck(config).catch(err => console.error('[Health] Interval check error:', err instanceof Error ? err.message : String(err)));
  }, HEALTH_CHECK_INTERVAL);
  return interval;
}

function getHealthyProviders() {
  const providers = [];
  for (const [key, state] of healthState.entries()) {
    const validKeys = state.keys.filter(k => k.avgLatency > 0);
    const avgLatency = validKeys.length > 0
      ? validKeys.reduce((sum, k) => sum + k.avgLatency, 0) / validKeys.length
      : -1;
    const latency = validKeys.length > 0
      ? Math.min(...validKeys.map(k => k.avgLatency))
      : -1;

    providers.push({
      key,
      score: state.overallScore,
      status: state.overallStatus,
      latency,
      avgLatency,
      quota: state.keys.length > 0 ? state.keys[0].quotaPercent : null,
      bestModel: state.bestModel,
      keys: state.keys.length,
    });
  }
  
  providers.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.avgLatency > 0 && b.avgLatency > 0) return a.avgLatency - b.avgLatency;
    return 0;
  });
  
  return providers;
}

function isProviderHealthy(providerKey) {
  const state = healthState.get(providerKey);
  if (!state) return true;
  return state.overallScore > 30;
}

function getProviderHealth(providerKey) {
  return healthState.get(providerKey) || null;
}

module.exports = {
  startHealthChecker,
  getHealthState,
  getHealthyProviders,
  isProviderHealthy,
  getProviderHealth,
  runHealthCheck,
  PING_TIMEOUT,
};
