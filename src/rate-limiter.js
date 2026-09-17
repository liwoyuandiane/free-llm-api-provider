/**
 * Rate Limiter Module for Free LLM API Provider
 * 
 * Provides multiple rate limiting algorithms:
 * - Token Bucket: Allows bursts up to bucket capacity, refills at constant rate
 * - Sliding Window: Counts requests in rolling time window
 * - Leaky Bucket: Processes requests at constant rate, queues excess
 * 
 * Singleton instance for global rate limiting across all providers.
 * 
 * Usage:
 *   const rateLimiter = require('./rate-limiter');
 *   const allowed = rateLimiter.checkLimit(providerKey, { algorithm: 'token-bucket', maxTokens: 10 });
 */

class TokenBucket {
  constructor(maxTokens = 10, refillRate = 1) {
    this.maxTokens = maxTokens;
    this.refillRate = refillRate; // tokens per second
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  tryConsume(tokens = 1) {
    this.refill();
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return { allowed: true, remaining: Math.floor(this.tokens), retryAfter: 0 };
    }
    const deficit = tokens - this.tokens;
    const retryAfter = Math.ceil((deficit / this.refillRate) * 1000);
    return { allowed: false, remaining: Math.floor(this.tokens), retryAfter };
  }
}

class SlidingWindow {
  constructor(maxRequests = 60, windowMs = 60000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.requests = []; // timestamps
  }

  cleanup() {
    const cutoff = Date.now() - this.windowMs;
    while (this.requests.length > 0 && this.requests[0] < cutoff) {
      this.requests.shift();
    }
  }

  tryConsume() {
    this.cleanup();
    if (this.requests.length < this.maxRequests) {
      this.requests.push(Date.now());
      return { allowed: true, remaining: this.maxRequests - this.requests.length, retryAfter: 0 };
    }
    const oldestInWindow = this.requests[0];
    const retryAfter = oldestInWindow + this.windowMs - Date.now();
    return { allowed: false, remaining: 0, retryAfter: Math.max(0, retryAfter) };
  }
}

class LeakyBucket {
  constructor(capacity = 10, leakRate = 1) {
    this.capacity = capacity;
    this.leakRate = leakRate; // requests per second
    this.water = 0;
    this.lastLeak = Date.now();
  }

  leak() {
    const now = Date.now();
    const elapsed = (now - this.lastLeak) / 1000;
    this.water = Math.max(0, this.water - elapsed * this.leakRate);
    this.lastLeak = now;
  }

  tryEnqueue() {
    this.leak();
    if (this.water < this.capacity) {
      this.water += 1;
      return { allowed: true, remaining: Math.floor(this.capacity - this.water), retryAfter: 0 };
    }
    const deficit = this.water - this.capacity + 1;
    const retryAfter = Math.ceil((deficit / this.leakRate) * 1000);
    return { allowed: false, remaining: 0, retryAfter };
  }
}

class RateLimiter {
  constructor() {
    this.limits = new Map(); // key -> { algorithm, limiter }
    this.defaultLimits = {
      'token-bucket': { maxTokens: 60, refillRate: 1 }, // 60 req/min
      'sliding-window': { maxRequests: 60, windowMs: 60000 },
      'leaky-bucket': { capacity: 60, leakRate: 1 },
    };
  }

  getLimiter(key, options = {}) {
    const algorithm = options.algorithm || 'token-bucket';
    const limiterKey = `${key}:${algorithm}`;
    
    if (!this.limits.has(limiterKey)) {
      let limiter;
      const defaults = this.defaultLimits[algorithm] || {};
      
      switch (algorithm) {
        case 'token-bucket':
          limiter = new TokenBucket(
            options.maxTokens || defaults.maxTokens,
            options.refillRate || defaults.refillRate
          );
          break;
        case 'sliding-window':
          limiter = new SlidingWindow(
            options.maxRequests || defaults.maxRequests,
            options.windowMs || defaults.windowMs
          );
          break;
        case 'leaky-bucket':
          limiter = new LeakyBucket(
            options.capacity || defaults.capacity,
            options.leakRate || defaults.leakRate
          );
          break;
        default:
          limiter = new TokenBucket();
      }
      
      this.limits.set(limiterKey, { algorithm, limiter });
    }
    
    return this.limits.get(limiterKey);
  }

  checkLimit(key, options = {}) {
    const { algorithm, limiter } = this.getLimiter(key, options);
    
    switch (algorithm) {
      case 'token-bucket':
        return limiter.tryConsume(options.tokens || 1);
      case 'sliding-window':
        return limiter.tryConsume();
      case 'leaky-bucket':
        return limiter.tryEnqueue();
      default:
        return { allowed: true, remaining: 0, retryAfter: 0 };
    }
  }

  getStats(key) {
    const stats = {};
    for (const [limiterKey, { algorithm, limiter }] of this.limits.entries()) {
      if (!limiterKey.startsWith(key + ':')) continue;
      
      switch (algorithm) {
        case 'token-bucket':
          limiter.refill();
          stats[algorithm] = {
            remaining: Math.floor(limiter.tokens),
            maxTokens: limiter.maxTokens,
            refillRate: limiter.refillRate,
          };
          break;
        case 'sliding-window':
          limiter.cleanup();
          stats[algorithm] = {
            currentRequests: limiter.requests.length,
            maxRequests: limiter.maxRequests,
            windowMs: limiter.windowMs,
          };
          break;
        case 'leaky-bucket':
          limiter.leak();
          stats[algorithm] = {
            currentWater: Math.floor(limiter.water),
            capacity: limiter.capacity,
            leakRate: limiter.leakRate,
          };
          break;
      }
    }
    return stats;
  }

  reset(key) {
    for (const limiterKey of this.limits.keys()) {
      if (limiterKey.startsWith(key + ':')) {
        this.limits.delete(limiterKey);
      }
    }
  }

  resetAll() {
    this.limits.clear();
  }

  getSummary() {
    const summary = {};
    for (const [limiterKey, { algorithm, limiter }] of this.limits.entries()) {
      const [key] = limiterKey.split(':');
      if (!summary[key]) summary[key] = {};
      summary[key][algorithm] = this.getStats(key)[algorithm];
    }
    return summary;
  }
}

// Singleton instance
const rateLimiter = new RateLimiter();

module.exports = rateLimiter;
module.exports.RateLimiter = RateLimiter;
module.exports.TokenBucket = TokenBucket;
module.exports.SlidingWindow = SlidingWindow;
module.exports.LeakyBucket = LeakyBucket;
