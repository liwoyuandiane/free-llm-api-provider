/**
 * Load Balancer - Multiple load balancing strategies
 * 
 * Provides various load balancing algorithms for provider selection:
 * - Round Robin: Sequential rotation
 * - Weighted Round Robin: Based on provider weights/capacity
 * - Least Connections: Routes to provider with fewest active connections
 * - Latency-Aware: Routes based on response latency
 * - Consistent Hashing: Sticky routing based on request hash
 */

class LoadBalancer {
  /**
   * Create a LoadBalancer instance
   * @param {object} options - Configuration options
   * @param {string} options.strategy - Default strategy (default: 'round-robin')
   * @param {boolean} options.healthAware - Consider health scores (default: true)
   */
  constructor(options = {}) {
    this.strategy = options.strategy || 'round-robin';
    this.healthAware = options.healthAware !== false;
    
    // Round-robin counter
    this.roundRobinIndex = 0;
    
    // Connection tracking: Map<providerKey, number>
    this.connections = new Map();
    
    // Latency tracking: Map<providerKey, {sum, count, last}>
    this.latency = new Map();
    
    // Weight/capacity: Map<providerKey, number>
    this.weights = new Map();
    
    // Request history for consistent hashing
    this.requestHistory = new Map();
  }

  /**
   * Select a provider from the list
   * @param {Array<object>} providers - List of providers
   * @param {object} context - Request context
   * @param {string} context.sessionId - Session ID for sticky routing
   * @param {string} context.model - Model name for consistent hashing
   * @param {string} context.strategy - Override strategy for this request
   * @returns {object} Selected provider
   */
  select(providers, context = {}) {
    if (!providers || providers.length === 0) {
      return null;
    }
    
    if (providers.length === 1) {
      return providers[0];
    }
    
    const strategy = context.strategy || this.strategy;
    
    // Filter healthy providers if health-aware
    let candidates = providers;
    if (this.healthAware) {
      candidates = providers.filter(p => p.healthScore >= 0);
      if (candidates.length === 0) {
        // Fallback to all providers if none are healthy
        candidates = providers;
      }
    }
    
    switch (strategy) {
      case 'round-robin':
        return this.roundRobin(candidates);
      case 'weighted':
        return this.weighted(candidates, context);
      case 'least-connections':
        return this.leastConnections(candidates);
      case 'latency-aware':
        return this.latencyAware(candidates);
      case 'consistent-hash':
        return this.consistentHash(candidates, context);
      default:
        return this.roundRobin(candidates);
    }
  }

  /**
   * Round-robin selection
   * @param {Array<object>} providers - List of providers
   * @returns {object} Selected provider
   */
  roundRobin(providers) {
    const index = this.roundRobinIndex % providers.length;
    this.roundRobinIndex = (this.roundRobinIndex + 1) % providers.length;
    return providers[index];
  }

  /**
   * Weighted round-robin selection
   * @param {Array<object>} providers - List of providers
   * @param {object} context - Request context
   * @returns {object} Selected provider
   */
  weighted(providers, context) {
    // Calculate total weight
    let totalWeight = 0;
    const weights = [];
    
    for (const provider of providers) {
      const weight = this.getWeight(provider.key);
      weights.push(weight);
      totalWeight += weight;
    }
    
    if (totalWeight === 0) {
      return this.roundRobin(providers);
    }
    
    // Random weighted selection
    let random = Math.random() * totalWeight;
    for (let i = 0; i < providers.length; i++) {
      random -= weights[i];
      if (random <= 0) {
        return providers[i];
      }
    }
    
    return providers[providers.length - 1];
  }

  /**
   * Least connections selection
   * @param {Array<object>} providers - List of providers
   * @returns {object} Selected provider
   */
  leastConnections(providers) {
    let minConnections = Infinity;
    let selected = providers[0];
    
    for (const provider of providers) {
      const connections = this.getConnections(provider.key);
      if (connections < minConnections) {
        minConnections = connections;
        selected = provider;
      }
    }
    
    return selected;
  }

  /**
   * Latency-aware selection
   * @param {Array<object>} providers - List of providers
   * @returns {object} Selected provider
   */
  latencyAware(providers) {
    let bestScore = -Infinity;
    let selected = providers[0];
    
    for (const provider of providers) {
      // Calculate score based on latency and health
      const latency = this.getAverageLatency(provider.key);
      const health = provider.healthScore || 0;
      
      // Higher score is better (lower latency, higher health)
      // Normalize latency to 0-1 range (assuming max 5000ms)
      const latencyScore = Math.max(0, 1 - latency / 5000);
      const score = latencyScore * 0.7 + (health / 100) * 0.3;
      
      if (score > bestScore) {
        bestScore = score;
        selected = provider;
      }
    }
    
    return selected;
  }

  /**
   * Consistent hashing selection
   * @param {Array<object>} providers - List of providers
   * @param {object} context - Request context
   * @returns {object} Selected provider
   */
  consistentHash(providers, context) {
    const key = context.sessionId || context.model || Math.random().toString();
    
    // Simple hash function
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      hash = ((hash << 5) - hash) + key.charCodeAt(i);
      hash |= 0;
    }
    hash = Math.abs(hash);
    
    // Select provider based on hash
    const index = hash % providers.length;
    return providers[index];
  }

  /**
   * Get weight for a provider
   * @param {string} providerKey - Provider key
   * @returns {number} Weight (default: 1)
   */
  getWeight(providerKey) {
    return this.weights.get(providerKey) || 1;
  }

  /**
   * Set weight for a provider
   * @param {string} providerKey - Provider key
   * @param {number} weight - Weight value
   */
  setWeight(providerKey, weight) {
    this.weights.set(providerKey, Math.max(1, weight));
  }

  /**
   * Get active connections for a provider
   * @param {string} providerKey - Provider key
   * @returns {number} Connection count
   */
  getConnections(providerKey) {
    return this.connections.get(providerKey) || 0;
  }

  /**
   * Record a new connection for a provider
   * @param {string} providerKey - Provider key
   */
  recordConnection(providerKey) {
    const current = this.getConnections(providerKey);
    this.connections.set(providerKey, current + 1);
  }

  /**
   * Release a connection for a provider
   * @param {string} providerKey - Provider key
   */
  releaseConnection(providerKey) {
    const current = this.getConnections(providerKey);
    if (current > 0) {
      this.connections.set(providerKey, current - 1);
    }
  }

  /**
   * Record latency for a provider
   * @param {string} providerKey - Provider key
   * @param {number} latencyMs - Latency in milliseconds
   */
  recordLatency(providerKey, latencyMs) {
    const current = this.latency.get(providerKey) || { sum: 0, count: 0, last: 0 };
    current.sum += latencyMs;
    current.count++;
    current.last = latencyMs;
    this.latency.set(providerKey, current);
  }

  /**
   * Get average latency for a provider
   * @param {string} providerKey - Provider key
   * @returns {number} Average latency in milliseconds
   */
  getAverageLatency(providerKey) {
    const data = this.latency.get(providerKey);
    if (!data || data.count === 0) {
      return 0;
    }
    return data.sum / data.count;
  }

  /**
   * Get last latency for a provider
   * @param {string} providerKey - Provider key
   * @returns {number} Last latency in milliseconds
   */
  getLastLatency(providerKey) {
    const data = this.latency.get(providerKey);
    return data ? data.last : 0;
  }

  /**
   * Get all load balancer statistics
   * @returns {object} Statistics
   */
  getStats() {
    const stats = {
      strategy: this.strategy,
      healthAware: this.healthAware,
      roundRobinIndex: this.roundRobinIndex,
      providers: {},
    };
    
    // Collect stats for all tracked providers
    const allProviders = new Set([
      ...this.connections.keys(),
      ...this.latency.keys(),
      ...this.weights.keys(),
    ]);
    
    for (const providerKey of allProviders) {
      stats.providers[providerKey] = {
        connections: this.getConnections(providerKey),
        weight: this.getWeight(providerKey),
        averageLatency: this.getAverageLatency(providerKey),
        lastLatency: this.getLastLatency(providerKey),
      };
    }
    
    return stats;
  }

  /**
   * Reset all statistics
   */
  reset() {
    this.roundRobinIndex = 0;
    this.connections.clear();
    this.latency.clear();
    this.weights.clear();
    this.requestHistory.clear();
  }
}

// Export singleton instance
module.exports = new LoadBalancer();

// Also export class for testing and custom instances
module.exports.LoadBalancer = LoadBalancer;