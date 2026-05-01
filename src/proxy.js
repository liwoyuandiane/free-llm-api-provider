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
const { sources, getModelsByProvider, ENV_VAR_NAMES, getModelLimits } = require('./models');

// Token estimation (rough: ~4 chars per token for English, ~2 for CJK)
function estimateTokens(messages) {
  if (!Array.isArray(messages)) return 0;
  let chars = 0;
  for (const msg of messages) {
    if (msg.content) {
      chars += String(msg.content).length;
    }
    if (msg.role) {
      chars += String(msg.role).length;
    }
  }
  // Add overhead for message formatting
  return Math.ceil(chars / 3.5) + messages.length * 4;
}

// Check if conversation fits in provider's model context
function checkContextFit(provider, reqBody) {
  const modelId = provider.models[0];
  if (!modelId) return { fits: true, tokens: 0, limit: 0 };
  
  const limits = getModelLimits(modelId);
  const estimatedTokens = estimateTokens(reqBody.messages);
  const fits = estimatedTokens <= limits.context;
  
  return { fits, tokens: estimatedTokens, limit: limits.context, model: modelId };
}
const { getHealthyProviders, isProviderHealthy } = require('./health-checker');

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
 * Get providers ordered by health score (best first), falling back to tier priority
 */
function getPrioritizedProviders(config) {
  const enabled = getEnabledProviders(config);
  const providers = [];
  
  const tierPriority = { 'S+': 0, 'S': 1, 'A+': 2, 'A': 3, 'A-': 4, 'B+': 5, 'B': 6, 'C': 7 };
  
  // Get health data if available
  const healthyProviders = getHealthyProviders();
  const healthMap = new Map();
  for (const hp of healthyProviders) {
    healthMap.set(hp.key, hp);
  }
  
  for (const key of enabled) {
    const provider = sources[key];
    if (!provider || !provider.url) continue;
    
    const models = getModelsByProvider(key);
    const bestTier = models.length > 0 ? models[0][2] : 'B';
    const tierPriorityVal = tierPriority[bestTier] || 99;
    
    // Get health score if available
    const health = healthMap.get(key);
    const healthScore = health ? health.score : -1;
    const healthLatency = health && health.avgLatency > 0 ? health.avgLatency : Infinity;
    
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
        priority: tierPriorityVal,
        healthScore,
        healthLatency,
        models: models.map(m => m[0]),
      });
    }
  }
  
  // Sort by health score first (if available), then by tier priority
  providers.sort((a, b) => {
    // If both have health scores, sort by score desc, then latency asc
    if (a.healthScore >= 0 && b.healthScore >= 0) {
      if (b.healthScore !== a.healthScore) return b.healthScore - a.healthScore;
      if (a.healthLatency > 0 && b.healthLatency > 0) return a.healthLatency - b.healthLatency;
    }
    // If only one has health score, prefer the one with health data
    if (a.healthScore >= 0 && b.healthScore < 0) return -1;
    if (b.healthScore >= 0 && a.healthScore < 0) return 1;
    // Fall back to tier priority
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
 * Forward request to a provider
 */
function forwardToProvider(provider, requestBody, onChunk = null) {
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
    
    // DEBUG: Log complete received body
    console.log(`[Proxy] DEBUG Received body keys: ${Object.keys(body).join(', ')}`);
    if (body.maxOutputTokens !== undefined) {
      console.log(`[Proxy] DEBUG maxOutputTokens=${body.maxOutputTokens} (type: ${typeof body.maxOutputTokens})`);
    }
    
    // Map model names FIRST to know the actual model
    let selectedModelId = body.model;
    if (body.model && body.model.startsWith('tier-')) {
      const targetModel = provider.models[0];
      if (targetModel) {
        body.model = targetModel;
        selectedModelId = targetModel;
      }
    }
    
    // Get model limits
    const limits = getModelLimits(selectedModelId);
    
    // ALWAYS use model's real limits, ignore whatever the IDE sends
    // Remove IDE-specific params that providers don't understand
    delete body.maxOutputTokens;  // Google/Gemini format
    delete body.responseModalities;
    delete body.safetySettings;
    
    // Also check nested objects for maxOutputTokens (some SDKs nest params)
    if (body.generationConfig) {
      delete body.generationConfig.maxOutputTokens;
    }
    
    // Always set max_tokens to the model's maximum output capability
    body.max_tokens = limits.output;
    
    const bodyStr = JSON.stringify(body);
    console.log(`[Proxy] Using model limits: context=${limits.context}, output=${limits.output} for ${selectedModelId}`);
    console.log(`[Proxy] DEBUG Forwarding body keys: ${Object.keys(body).join(', ')}`);
    
    const isStreaming = body.stream === true;
    
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
    console.log(`[Proxy] Trying provider: ${provider.key} (${provider.name})${keyInfo} ${isStreaming ? '(streaming)' : ''}`);
    
    const req = client.request(options, (res) => {
      // Check for error status even in streaming mode
      if (res.statusCode >= 400) {
        console.log(`[Proxy] ❌ ${provider.key} error (${res.statusCode}) in streaming mode`);
        recordFailure(provider.key);
        let errorData = '';
        res.on('data', chunk => errorData += chunk);
        res.on('end', () => {
          reject({ status: res.statusCode, error: errorData, provider: provider.key });
        });
        return;
      }
      
      // STREAMING MODE: forward chunks directly
      if (isStreaming && onChunk) {
        console.log(`[Proxy] ✅ ${provider.key} streaming started (${res.statusCode})`);
        recordSuccess(provider.key);
        
        const extractor = new ThinkingExtractor();
        
        res.on('data', (chunk) => {
          const chunkStr = chunk.toString();
          // Ensure proper SSE format: lines must start with "data: " and end with "\n\n"
          const lines = chunkStr.split('\n').filter(line => line.trim());
          for (const line of lines) {
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
        });
        
        res.on('end', () => {
          // Flush any remaining thinking content
          const finalParts = extractor.flush();
          for (const part of finalParts) {
            if (part.type === 'thinking') {
              const parsed = {
                choices: [{
                  delta: {
                    reasoning_content: part.content
                  }
                }]
              };
              onChunk('data: ' + JSON.stringify(parsed) + '\n\n', false, provider.key);
            } else if (part.content) {
              const parsed = {
                choices: [{
                  delta: {
                    content: part.content
                  }
                }]
              };
              onChunk('data: ' + JSON.stringify(parsed) + '\n\n', false, provider.key);
            }
          }
          
          onChunk(null, true, provider.key);
          resolve({ status: res.statusCode, body: '', provider: provider.key, streaming: true });
        });
        
        res.on('error', (err) => {
          console.log(`[Proxy] ❌ ${provider.key} streaming error: ${err.message}`);
          recordFailure(provider.key);
          reject({ status: 0, error: err.message, provider: provider.key });
        });
        
        return;
      }
      
      // NON-STREAMING MODE: collect full response
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`[Proxy] ✅ ${provider.key} succeeded (${res.statusCode})`);
          recordSuccess(provider.key);
          const cleanedData = cleanResponseBody(data);
          resolve({ status: res.statusCode, body: cleanedData, provider: provider.key });
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
async function handleChatCompletions(reqBody, onStreamChunk = null) {
  const isStreaming = reqBody.stream === true;
  const config = loadConfig();
  const providers = getPrioritizedProviders(config);
  
  if (providers.length === 0) {
    throw new Error('No providers configured');
  }
  
  const errors = [];
  
  // First, try the active provider if we have one and it's still valid
  if (activeProvider && !isCircuitOpen(activeProvider.key)) {
    const stillConfigured = providers.find(p => p.key === activeProvider.key && p.apiKey === activeProvider.apiKey);
    if (stillConfigured) {
      const contextCheck = checkContextFit(stillConfigured, reqBody);
      if (!contextCheck.fits) {
        console.log(`[Proxy] ⚠️ Active provider ${activeProvider.key} model ${contextCheck.model} context too small (${contextCheck.tokens} > ${contextCheck.limit}), skipping...`);
        errors.push({ provider: activeProvider.key, error: `Context too small: ${contextCheck.tokens} > ${contextCheck.limit}` });
        activeProvider = null;
      } else {
        try {
          console.log(`[Proxy] Using active provider: ${activeProvider.key} (${contextCheck.tokens} tokens / ${contextCheck.limit} limit)`);
          const result = await forwardToProvider(stillConfigured, reqBody, onStreamChunk);
          
          if (result.streaming) {
            return result;
          }
          
          stats.totalRequests++;
          stats.successfulRequests++;
          stats.providerUsage.set(activeProvider.key, (stats.providerUsage.get(activeProvider.key) || 0) + 1);
          lastProviderSuccess.set(activeProvider.key, Date.now());
          
          try {
            const responseObj = JSON.parse(result.body);
            if (responseObj.model) {
              responseObj.model = `${activeProvider.key}/${responseObj.model}`;
            }
            const limits = getModelLimits(responseObj.model?.replace(activeProvider.key + '/', '') || stillConfigured.models[0]);
            return { status: result.status, body: JSON.stringify(responseObj), provider: activeProvider.key, limits };
          } catch {
            return { ...result, limits: getModelLimits(stillConfigured.models[0]) };
          }
        } catch (err) {
          console.log(`[Proxy] Active provider ${activeProvider.key} failed, initiating failover...`);
          errors.push({ provider: activeProvider.key, error: err.error || err.message });
          stats.providerUsage.set(activeProvider.key, (stats.providerUsage.get(activeProvider.key) || 0) + 1);
          activeProvider = null;
        }
      }
    } else {
      activeProvider = null;
    }
  }
  
  // Failover: try providers in priority order
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
      
      if (result.streaming) {
        return result;
      }
      
      stats.totalRequests++;
      stats.successfulRequests++;
      stats.providerUsage.set(provider.key, (stats.providerUsage.get(provider.key) || 0) + 1);
      
      activeProvider = {
        key: provider.key,
        apiKey: provider.apiKey,
        name: provider.name,
        url: provider.url,
        models: provider.models,
      };
      lastProviderSuccess.set(provider.key, Date.now());
      console.log(`[Proxy] Set active provider: ${provider.key}`);
      
      try {
        const responseObj = JSON.parse(result.body);
        if (responseObj.model) {
          responseObj.model = `${provider.key}/${responseObj.model}`;
        }
        const limits = getModelLimits(responseObj.model?.replace(provider.key + '/', '') || provider.models[0]);
        return { status: result.status, body: JSON.stringify(responseObj), provider: provider.key, limits };
      } catch {
        return { ...result, limits: getModelLimits(provider.models[0]) };
      }
    } catch (err) {
      errors.push({ provider: provider.key, error: err.error || err.message });
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
          const isStreaming = requestBody.stream === true;
          
          if (isStreaming) {
            // STREAMING MODE: Try providers without sending headers first
            let providerName = 'unknown';
            let headersSent = false;
            const chunkBuffer = [];
            
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
                  // Flush any buffered chunks
                  for (const buffered of chunkBuffer) {
                    res.write(buffered);
                  }
                  chunkBuffer.length = 0;
                }
                res.write(chunk);
              }
            };
            
            try {
              await handleChatCompletions(requestBody, onChunk);
            } catch (err) {
              console.log(`[Proxy] Streaming error: ${err.message}`);
              res.write(`data: {"error": "${err.message}"}\n\n`);
              res.end();
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
    
    // Models list - expose tier aliases only
    if (parsedUrl.pathname === '/v1/models' && req.method === 'GET') {
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
      
      const models = tiers.map(t => ({
        id: t.id,
        object: 'model',
        owned_by: 'free-llm-api-provider',
        created: 1700000000,
      }));
      
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
