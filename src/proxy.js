/**
 * Proxy Server with Automatic Failover
 * 
 * Self-contained Node.js proxy that routes LLM requests across configured providers.
 * When one provider fails, automatically tries the next in priority order.
 */

const http = require('http');
const https = require('https');
const url = require('url');
const { loadConfig, getEnabledProviders, getAllApiKeys } = require('./config');
const { sources, getModelsByProvider, ENV_VAR_NAMES } = require('./models');

const PROXY_PORT = 4000;
const DEFAULT_KEY = 'sk-free-llm-api-provider';

// Request timeout per provider (ms)
const PROVIDER_TIMEOUT = 15000;

// Circuit breaker state
const circuitBreaker = new Map(); // providerKey -> { failures, lastFailure, open }
const CIRCUIT_THRESHOLD = 3;
const CIRCUIT_RESET_MS = 30000;

// Request stats
const stats = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  providerUsage: new Map(),
  errors: new Map(),
};

// Active provider tracking - stick to what works until it fails
let activeProvider = null; // { key, apiKey, name, url, models }
let lastProviderSuccess = new Map(); // providerKey -> timestamp of last success

/**
 * Get providers ordered by tier priority (best first)
 */
function getPrioritizedProviders(config) {
  const enabled = getEnabledProviders(config);
  const providers = [];
  
  const tierPriority = { 'S+': 0, 'S': 1, 'A+': 2, 'A': 3, 'A-': 4, 'B+': 5, 'B': 6, 'C': 7 };
  
  for (const key of enabled) {
    const provider = sources[key];
    if (!provider || !provider.url) continue;
    
    const models = getModelsByProvider(key);
    const bestTier = models.length > 0 ? models[0][2] : 'B';
    const priority = tierPriority[bestTier] || 99;
    
    // Get ALL API keys for this provider (supports multiple keys)
    const allKeys = getAllApiKeys(config, key);
    
    // Create an entry for each key
    for (let i = 0; i < allKeys.length; i++) {
      providers.push({
        key,
        name: provider.name,
        url: provider.url,
        apiKey: allKeys[i],
        keyIndex: i,
        totalKeys: allKeys.length,
        envVar: ENV_VAR_NAMES[key],
        priority,
        models: models.map(m => m[0]),
      });
    }
  }
  
  // Sort by priority (lower number = better tier)
  providers.sort((a, b) => a.priority - b.priority);
  
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
 * Forward request to a provider
 */
function forwardToProvider(provider, requestBody) {
  return new Promise((resolve, reject) => {
    // Use provider.url directly - already includes full endpoint path
    const targetUrl = provider.url.includes('/chat/completions') 
      ? provider.url 
      : provider.url.replace(/\/$/, '') + '/v1/chat/completions';
    
    const parsedUrl = url.parse(targetUrl);
    const isHttps = parsedUrl.protocol === 'https:';
    const client = isHttps ? https : http;
    
    // Prepare request body - replace model if needed
    let body = JSON.parse(JSON.stringify(requestBody));
    
    // Map model names
    if (body.model && body.model.startsWith('tier-')) {
      // Pick first available model for this provider
      const targetModel = provider.models[0];
      if (targetModel) {
        body.model = targetModel;
      }
    }
    
    const bodyStr = JSON.stringify(body);
    
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`,
        'Content-Length': Buffer.byteLength(bodyStr),
      },
      timeout: PROVIDER_TIMEOUT,
    };
    
    const keyInfo = provider.totalKeys > 1 ? ` [key ${provider.keyIndex + 1}/${provider.totalKeys}]` : '';
    console.log(`[Proxy] Trying provider: ${provider.key} (${provider.name})${keyInfo}`);
    
    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`[Proxy] ✅ ${provider.key} succeeded (${res.statusCode})`);
          recordSuccess(provider.key);
          resolve({ status: res.statusCode, body: data, provider: provider.key });
        } else if (res.statusCode === 429) {
          console.log(`[Proxy] ❌ ${provider.key} rate limited (429)`);
          recordFailure(provider.key);
          reject({ status: 429, error: 'Rate limited', provider: provider.key });
        } else if (res.statusCode >= 500) {
          console.log(`[Proxy] ❌ ${provider.key} server error (${res.statusCode})`);
          recordFailure(provider.key);
          reject({ status: res.statusCode, error: `Server error ${res.statusCode}`, provider: provider.key });
        } else {
          console.log(`[Proxy] ❌ ${provider.key} HTTP error (${res.statusCode}): ${data.substring(0, 200)}`);
          recordFailure(provider.key);
          reject({ status: res.statusCode, error: `HTTP ${res.statusCode}`, provider: provider.key });
        }
      });
    });
    
    req.on('error', (err) => {
      console.log(`[Proxy] ❌ ${provider.key} network error: ${err.message}`);
      recordFailure(provider.key);
      reject({ status: 0, error: err.message, provider: provider.key });
    });
    
    req.on('timeout', () => {
      console.log(`[Proxy] ❌ ${provider.key} timeout`);
      req.destroy();
      recordFailure(provider.key);
      reject({ status: 0, error: 'Timeout', provider: provider.key });
    });
    
    req.write(bodyStr);
    req.end();
  });
}

/**
 * Handle chat completions with failover
 * Strategy: Stick to the active provider until it fails, then failover
 */
async function handleChatCompletions(reqBody) {
  const config = loadConfig();
  const providers = getPrioritizedProviders(config);
  
  if (providers.length === 0) {
    throw new Error('No providers configured');
  }
  
  const errors = [];
  
  // First, try the active provider if we have one and it's still valid
  if (activeProvider && !isCircuitOpen(activeProvider.key)) {
    // Verify the active provider is still in our configured list
    const stillConfigured = providers.find(p => p.key === activeProvider.key && p.apiKey === activeProvider.apiKey);
    if (stillConfigured) {
      try {
        console.log(`[Proxy] Using active provider: ${activeProvider.key}`);
        const result = await forwardToProvider(stillConfigured, reqBody);
        
        // Update stats
        stats.totalRequests++;
        stats.successfulRequests++;
        stats.providerUsage.set(activeProvider.key, (stats.providerUsage.get(activeProvider.key) || 0) + 1);
        lastProviderSuccess.set(activeProvider.key, Date.now());
        
        // Parse and modify response
        try {
          const responseObj = JSON.parse(result.body);
          if (responseObj.model) {
            responseObj.model = `${activeProvider.key}/${responseObj.model}`;
          }
          return {
            status: result.status,
            body: JSON.stringify(responseObj),
            provider: activeProvider.key,
          };
        } catch {
          return result;
        }
      } catch (err) {
        console.log(`[Proxy] Active provider ${activeProvider.key} failed, initiating failover...`);
        errors.push({ provider: activeProvider.key, error: err.error || err.message });
        stats.providerUsage.set(activeProvider.key, (stats.providerUsage.get(activeProvider.key) || 0) + 1);
        // Clear active provider since it failed
        activeProvider = null;
      }
    } else {
      // Provider no longer configured, clear it
      activeProvider = null;
    }
  }
  
  // Failover: try providers in priority order
  for (const provider of providers) {
    // Skip if circuit breaker is open
    if (isCircuitOpen(provider.key)) {
      errors.push({ provider: provider.key, error: 'Circuit breaker open' });
      continue;
    }
    
    try {
      const result = await forwardToProvider(provider, reqBody);
      
      // Update stats
      stats.totalRequests++;
      stats.successfulRequests++;
      stats.providerUsage.set(provider.key, (stats.providerUsage.get(provider.key) || 0) + 1);
      
      // Set this provider as active since it worked
      activeProvider = {
        key: provider.key,
        apiKey: provider.apiKey,
        name: provider.name,
        url: provider.url,
        models: provider.models,
      };
      lastProviderSuccess.set(provider.key, Date.now());
      console.log(`[Proxy] Set active provider: ${provider.key}`);
      
      // Parse and modify response to show which provider served it
      try {
        const responseObj = JSON.parse(result.body);
        if (responseObj.model) {
          responseObj.model = `${provider.key}/${responseObj.model}`;
        }
        return {
          status: result.status,
          body: JSON.stringify(responseObj),
          provider: provider.key,
        };
      } catch {
        return result;
      }
    } catch (err) {
      errors.push({ provider: provider.key, error: err.error || err.message });
      
      // Update stats
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
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }
    
    // Parse URL
    const parsedUrl = url.parse(req.url, true);
    
    // Health check
    if (parsedUrl.pathname === '/health' && req.method === 'GET') {
      const config = loadConfig();
      const providers = getPrioritizedProviders(config);
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'healthy',
        version: '1.0.0',
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
    if (parsedUrl.pathname === '/stats' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        total_requests: stats.totalRequests,
        successful_requests: stats.successfulRequests,
        failed_requests: stats.failedRequests,
        provider_usage: Object.fromEntries(stats.providerUsage),
        errors: Object.fromEntries(stats.errors),
      }));
      return;
    }
    
    // Chat completions
    if (parsedUrl.pathname === '/v1/chat/completions' && req.method === 'POST') {
      // Validate API key
      const authHeader = req.headers.authorization || '';
      const apiKey = authHeader.replace('Bearer ', '').trim();
      
      if (apiKey !== DEFAULT_KEY) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid API key' }));
        return;
      }
      
      // Read body
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const requestBody = JSON.parse(body);
          
          const result = await handleChatCompletions(requestBody);
          
          res.writeHead(result.status, { 
            'Content-Type': 'application/json',
            'X-Provider': result.provider,
          });
          res.end(result.body);
        } catch (err) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'All providers failed',
            message: err.message,
            suggestion: 'Add more providers or check your API keys',
          }));
        }
      });
      return;
    }
    
    // Models list
    if (parsedUrl.pathname === '/v1/models' && req.method === 'GET') {
      const config = loadConfig();
      const providers = getPrioritizedProviders(config);
      
      const models = [];
      for (const provider of providers) {
        for (const modelId of provider.models.slice(0, 5)) {
          models.push({
            id: `${provider.key}/${modelId}`,
            object: 'model',
            owned_by: provider.key,
          });
        }
      }
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        object: 'list',
        data: models,
      }));
      return;
    }
    
    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });
  
  return server;
}

/**
 * Start proxy server
 */
function startProxyServer(port = PROXY_PORT) {
  const server = createServer();
  
  server.listen(port, () => {
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
