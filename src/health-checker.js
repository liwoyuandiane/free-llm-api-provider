/**
 * Health Checker
 * 
 * Periodically pings all configured providers to check latency and availability.
 * Stores health scores that the proxy uses for routing decisions.
 */

const https = require('https');
const http = require('http');
const url = require('url');
const { getAllApiKeys } = require('./config');
const { sources, ENV_VAR_NAMES } = require('./models');

// Health check interval (ms)
const HEALTH_CHECK_INTERVAL = 30000; // 30 seconds
const HEALTH_CHECK_TIMEOUT = 10000;  // 10 seconds per provider

// Health state per provider
const healthState = new Map(); // providerKey -> { latency, status, lastCheck, failures, score }

function getHealthState() {
  const state = {};
  for (const [key, value] of healthState.entries()) {
    state[key] = { ...value };
  }
  return state;
}

/**
 * Ping a single provider
 */
function pingProvider(providerKey, apiKey) {
  return new Promise((resolve) => {
    const provider = sources[providerKey];
    if (!provider || !provider.url) {
      resolve({ provider: providerKey, status: 'no_endpoint', latency: -1 });
      return;
    }

    const targetUrl = provider.url;
    const parsedUrl = url.parse(targetUrl);
    const isHttps = parsedUrl.protocol === 'https:';
    const client = isHttps ? https : http;

    const startTime = Date.now();
    
    // Build a small health check request
    // Try to hit the models endpoint or just do a HEAD request
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.path.replace('/chat/completions', '/models'),
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      timeout: HEALTH_CHECK_TIMEOUT,
    };

    // If models endpoint fails, try a minimal POST to chat completions
    const req = client.request(options, (res) => {
      const latency = Date.now() - startTime;
      
      if (res.statusCode === 200 || res.statusCode === 401) {
        // 200 = working, 401 = working but key issue (still alive)
        resolve({ 
          provider: providerKey, 
          status: res.statusCode === 200 ? 'healthy' : 'auth_error',
          latency,
          apiKey: apiKey.substring(0, 8) + '...'
        });
      } else if (res.statusCode === 429) {
        resolve({ provider: providerKey, status: 'rate_limited', latency, apiKey: apiKey.substring(0, 8) + '...' });
      } else {
        resolve({ provider: providerKey, status: 'error', latency, code: res.statusCode, apiKey: apiKey.substring(0, 8) + '...' });
      }
      
      res.resume(); // Consume response
    });

    req.on('error', () => {
      resolve({ provider: providerKey, status: 'offline', latency: -1, apiKey: apiKey.substring(0, 8) + '...' });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ provider: providerKey, status: 'timeout', latency: HEALTH_CHECK_TIMEOUT, apiKey: apiKey.substring(0, 8) + '...' });
    });

    req.end();
  });
}

/**
 * Run health check for all configured providers
 */
async function runHealthCheck(config) {
  const checks = [];
  
  for (const [providerKey, provider] of Object.entries(sources)) {
    if (!provider.url || provider.cliOnly) continue;
    
    const keys = getAllApiKeys(config, providerKey);
    if (keys.length === 0) continue;
    
    // Check each key
    for (const key of keys) {
      checks.push(pingProvider(providerKey, key));
    }
  }
  
  const results = await Promise.all(checks);
  
  // Update health state
  for (const result of results) {
    const existing = healthState.get(result.provider) || {
      latency: -1,
      status: 'unknown',
      lastCheck: 0,
      failures: 0,
      successes: 0,
      avgLatency: -1,
      score: 0,
    };
    
    const isHealthy = result.status === 'healthy' || result.status === 'auth_error';
    const isRateLimited = result.status === 'rate_limited';
    
    if (isHealthy) {
      existing.successes++;
      existing.failures = Math.max(0, existing.failures - 1);
    } else {
      existing.failures++;
      existing.successes = Math.max(0, existing.successes - 1);
    }
    
    existing.status = result.status;
    existing.latency = result.latency;
    existing.lastCheck = Date.now();
    
    // Calculate average latency (exponential moving average)
    if (existing.avgLatency < 0) {
      existing.avgLatency = result.latency;
    } else if (result.latency > 0) {
      existing.avgLatency = existing.avgLatency * 0.7 + result.latency * 0.3;
    }
    
    // Calculate health score (0-100)
    // Factors: success rate (60%), latency (30%), recency (10%)
    const totalChecks = existing.successes + existing.failures;
    const successRate = totalChecks > 0 ? (existing.successes / totalChecks) : 0;
    
    let latencyScore = 100;
    if (existing.avgLatency > 0) {
      if (existing.avgLatency < 500) latencyScore = 100;
      else if (existing.avgLatency < 1000) latencyScore = 80;
      else if (existing.avgLatency < 2000) latencyScore = 60;
      else if (existing.avgLatency < 5000) latencyScore = 40;
      else latencyScore = 20;
    }
    
    // Rate limited providers get penalized
    if (isRateLimited) {
      latencyScore *= 0.5;
    }
    
    existing.score = Math.round(successRate * 60 + latencyScore * 0.3 + 10);
    existing.score = Math.min(100, Math.max(0, existing.score));
    
    healthState.set(result.provider, existing);
  }
  
  return results;
}

/**
 * Start periodic health checks
 */
function startHealthChecker(config) {
  // Run immediately
  runHealthCheck(config);
  
  // Then periodically
  const interval = setInterval(() => {
    runHealthCheck(config).catch(console.error);
  }, HEALTH_CHECK_INTERVAL);
  
  return interval;
}

/**
 * Get best providers sorted by health score
 */
function getHealthyProviders() {
  const providers = [];
  for (const [key, state] of healthState.entries()) {
    providers.push({ key, ...state });
  }
  
  // Sort by score (descending), then by latency (ascending)
  providers.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.avgLatency > 0 && b.avgLatency > 0) return a.avgLatency - b.avgLatency;
    return 0;
  });
  
  return providers;
}

/**
 * Check if provider is healthy enough to use
 */
function isProviderHealthy(providerKey) {
  const state = healthState.get(providerKey);
  if (!state) return true; // Unknown = give it a try
  return state.score > 30; // Score > 30 is acceptable
}

module.exports = {
  startHealthChecker,
  getHealthState,
  getHealthyProviders,
  isProviderHealthy,
  runHealthCheck,
};
