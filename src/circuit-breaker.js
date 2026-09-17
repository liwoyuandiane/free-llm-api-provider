/**
 * Circuit Breaker - Model-level circuit breaking with smart error classification
 * 
 * Two-level circuit breaker pattern:
 * - Provider-level: Blocks entire provider (for auth errors 401/403)
 * - Model-level: Blocks only specific model (for model errors 404/410)
 * 
 * Error classification:
 * - auth (401/403): Fatal → Block entire provider
 * - model (404/410): Non-fatal → Block only the model, provider stays available
 * - rateLimit (429): Non-fatal → Don't block, just cooldown
 * - connection/network: Provider-level failure
 * - unknown: Provider-level failure
 */

class CircuitBreaker {
  /**
   * Create a CircuitBreaker instance
   * @param {object} options - Configuration options
   * @param {number} options.threshold - Failure count to open circuit (default: 5)
   * @param {number} options.resetTimeout - Time in ms to wait before half-open (default: 30000)
   * @param {number} options.halfOpenMaxProbes - Max probe requests in half-open state (default: 1)
   */
  constructor(options = {}) {
    this.threshold = options.threshold || 5;
    this.resetTimeout = options.resetTimeout || 30000;
    this.halfOpenMaxProbes = options.halfOpenMaxProbes || 1;
    
    // Provider-level states: Map<providerKey, CircuitState>
    // Used for auth errors (401/403) - blocks entire provider
    this.states = new Map();
    
    // Model-level states: Map<"providerKey:modelName", CircuitState>
    // Used for model errors (404/410) - blocks only specific model
    this.modelStates = new Map();
    
    // Statistics: Map<providerKey, Stats>
    this.stats = new Map();
    
    // Model statistics: Map<"providerKey:modelName", ModelStats>
    this.modelStats = new Map();
  }

  /**
   * Get or create state for a provider
   * @param {string} providerKey - Provider identifier
   * @returns {object} Circuit state
   */
  getState(providerKey) {
    if (!this.states.has(providerKey)) {
      this.states.set(providerKey, {
        state: 'closed', // closed, open, half-open
        failures: 0,
        lastFailure: 0,
        openedAt: 0,
        halfOpenProbes: 0,
        successSinceOpen: 0,
      });
    }
    return this.states.get(providerKey);
  }

  /**
   * Get or create state for a specific model
   * @param {string} providerKey - Provider identifier
   * @param {string} modelName - Model name
   * @returns {object} Circuit state
   */
  getModelState(providerKey, modelName) {
    const key = `${providerKey}:${modelName}`;
    if (!this.modelStates.has(key)) {
      this.modelStates.set(key, {
        state: 'closed',
        failures: 0,
        lastFailure: 0,
        openedAt: 0,
        halfOpenProbes: 0,
        successSinceOpen: 0,
      });
    }
    return this.modelStates.get(key);
  }

  /**
   * Get statistics for a provider
   * @param {string} providerKey - Provider identifier
   * @returns {object} Statistics
   */
  getStats(providerKey) {
    if (!this.stats.has(providerKey)) {
      this.stats.set(providerKey, {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        consecutiveFailures: 0,
        lastSuccess: 0,
        lastFailure: 0,
        circuitOpenCount: 0,
        totalDowntime: 0,
        lastStateChange: Date.now(),
      });
    }
    return this.stats.get(providerKey);
  }

  /**
   * Get statistics for a specific model
   * @param {string} providerKey - Provider identifier
   * @param {string} modelName - Model name
   * @returns {object} Model statistics
   */
  getModelStats(providerKey, modelName) {
    const key = `${providerKey}:${modelName}`;
    if (!this.modelStats.has(key)) {
      this.modelStats.set(key, {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        lastSuccess: 0,
        lastFailure: 0,
        circuitOpenCount: 0,
        lastStateChange: Date.now(),
      });
    }
    return this.modelStats.get(key);
  }

  /**
   * Classify an error into categories
   * @param {object} err - Error object with status/code
   * @returns {string} Error type: 'auth', 'model', 'rateLimit', 'connection', 'unknown'
   */
  classifyError(err) {
    if (!err) return 'unknown';
    
    const status = err.status || err.statusCode;
    
    // Auth errors → Block entire provider
    if (status === 401 || status === 403) return 'auth';
    
    // Model not found → Block only the model
    if (status === 404 || status === 410) return 'model';
    
    // Rate limit → Don't block, just cooldown
    if (status === 429) return 'rateLimit';
    
    // Connection errors → Provider-level
    const code = err.code || '';
    if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT' || 
        code === 'ECONNRESET' || code === 'EPIPE' || code.includes('timeout')) {
      return 'connection';
    }
    
    // Server errors (5xx) → Provider-level
    if (status >= 500) return 'connection';
    
    return 'unknown';
  }

  /**
   * Check if a request is allowed for a provider (provider-level check)
   * @param {string} providerKey - Provider identifier
   * @returns {boolean} True if request is allowed
   */
  canRequest(providerKey) {
    const state = this.getState(providerKey);
    
    switch (state.state) {
      case 'closed':
        return true;
        
      case 'open':
        // Check if reset timeout has elapsed
        if (Date.now() - state.openedAt > this.resetTimeout) {
          state.state = 'half-open';
          state.halfOpenProbes = 0;
          state.successSinceOpen = 0;
          this.recordStateChange(providerKey, 'half-open');
          return true;
        }
        return false;
        
      case 'half-open':
        // Allow probe requests up to max
        return state.halfOpenProbes < this.halfOpenMaxProbes;
        
      default:
        return true;
    }
  }

  /**
   * Check if a specific model is allowed (model-level check)
   * @param {string} providerKey - Provider identifier
   * @param {string} modelName - Model name
   * @returns {boolean} True if model request is allowed
   */
  canRequestModel(providerKey, modelName) {
    const key = `${providerKey}:${modelName}`;
    const state = this.modelStates.get(key);
    
    // No state = never failed = allowed
    if (!state) return true;
    
    switch (state.state) {
      case 'closed':
        return true;
        
      case 'open':
        if (Date.now() - state.openedAt > this.resetTimeout) {
          state.state = 'half-open';
          state.halfOpenProbes = 0;
          state.successSinceOpen = 0;
          console.log(`[CircuitBreaker] ${key}: open -> half-open (timeout elapsed)`);
          return true;
        }
        return false;
        
      case 'half-open':
        return state.halfOpenProbes < this.halfOpenMaxProbes;
        
      default:
        return true;
    }
  }

  /**
   * Record a successful request
   * @param {string} providerKey - Provider identifier
   * @param {string} [modelName] - Model name (optional, for model-level success)
   */
  recordSuccess(providerKey, modelName) {
    // Provider-level success
    const state = this.getState(providerKey);
    const stats = this.getStats(providerKey);
    
    stats.totalRequests++;
    stats.successfulRequests++;
    stats.consecutiveFailures = 0;
    stats.lastSuccess = Date.now();
    
    switch (state.state) {
      case 'closed':
        state.failures = 0;
        break;
        
      case 'half-open':
        state.successSinceOpen++;
        if (state.successSinceOpen >= this.halfOpenMaxProbes) {
          state.state = 'closed';
          state.failures = 0;
          state.openedAt = 0;
          state.halfOpenProbes = 0;
          state.successSinceOpen = 0;
          this.recordStateChange(providerKey, 'closed');
        }
        break;
    }
    
    // Model-level success (if model provided)
    if (modelName) {
      const modelKey = `${providerKey}:${modelName}`;
      constModelState = this.modelStates.get(modelKey);
      const modelStats = this.getModelStats(providerKey, modelName);
      
      modelStats.totalRequests++;
      modelStats.successfulRequests++;
      modelStats.lastSuccess = Date.now();
      
      if (modelState) {
        switch (modelState.state) {
          case 'closed':
            modelState.failures = 0;
            break;
            
          case 'half-open':
            modelState.successSinceOpen++;
            if (modelState.successSinceOpen >= this.halfOpenMaxProbes) {
              modelState.state = 'closed';
              modelState.failures = 0;
              modelState.openedAt = 0;
              modelState.halfOpenProbes = 0;
              modelState.successSinceOpen = 0;
              console.log(`[CircuitBreaker] ${modelKey}: half-open -> closed`);
            }
            break;
        }
      }
    }
  }

  /**
   * Record a failed request with smart error classification
   * @param {string} providerKey - Provider identifier
   * @param {string} [modelName] - Model name (optional)
   * @param {object} [err] - Error object for classification
   */
  recordFailure(providerKey, modelName, err) {
    const errorType = this.classifyError(err);
    
    // Auth errors → Block entire provider
    if (errorType === 'auth') {
      this._recordProviderFailure(providerKey, true);
      return;
    }
    
    // Model errors → Block only the model
    if (errorType === 'model' && modelName) {
      this._recordModelFailure(providerKey, modelName);
      return;
    }
    
    // Rate limit → Don't block circuit, just record stats
    if (errorType === 'rateLimit') {
      const stats = this.getStats(providerKey);
      stats.totalRequests++;
      stats.failedRequests++;
      stats.lastFailure = Date.now();
      if (modelName) {
        const modelStats = this.getModelStats(providerKey, modelName);
        modelStats.totalRequests++;
        modelStats.failedRequests++;
        modelStats.lastFailure = Date.now();
      }
      return;
    }
    
    // Connection/unknown errors → Provider-level failure
    this._recordProviderFailure(providerKey, false);
  }

  /**
   * Record provider-level failure
   * @private
   */
  _recordProviderFailure(providerKey, isFatal) {
    const state = this.getState(providerKey);
    const stats = this.getStats(providerKey);
    
    stats.totalRequests++;
    stats.failedRequests++;
    stats.consecutiveFailures++;
    stats.lastFailure = Date.now();
    
    switch (state.state) {
      case 'closed':
        state.failures++;
        state.lastFailure = Date.now();
        
        if (state.failures >= this.threshold || isFatal) {
          state.state = 'open';
          state.openedAt = Date.now();
          stats.circuitOpenCount++;
          this.recordStateChange(providerKey, 'open');
        }
        break;
        
      case 'half-open':
        state.halfOpenProbes++;
        if (state.halfOpenProbes >= this.halfOpenMaxProbes) {
          state.state = 'open';
          state.openedAt = Date.now();
          state.halfOpenProbes = 0;
          state.successSinceOpen = 0;
          stats.circuitOpenCount++;
          this.recordStateChange(providerKey, 'open');
        }
        break;
        
      case 'open':
        state.lastFailure = Date.now();
        break;
    }
  }

  /**
   * Record model-level failure
   * @private
   */
  _recordModelFailure(providerKey, modelName) {
    const key = `${providerKey}:${modelName}`;
    const state = this.getModelState(providerKey, modelName);
    const stats = this.getModelStats(providerKey, modelName);
    
    stats.totalRequests++;
    stats.failedRequests++;
    stats.lastFailure = Date.now();
    
    state.failures++;
    state.lastFailure = Date.now();
    
    // Model errors don't have threshold - block immediately on 404/410
    // because if a model doesn't exist, it won't suddenly appear
    if (state.state === 'closed' && state.failures >= 1) {
      state.state = 'open';
      state.openedAt = Date.now();
      stats.circuitOpenCount++;
      console.log(`[CircuitBreaker] ${key}: closed -> open (model not found)`);
    } else if (state.state === 'half-open') {
      state.state = 'open';
      state.openedAt = Date.now();
      state.halfOpenProbes = 0;
      state.successSinceOpen = 0;
      stats.circuitOpenCount++;
      console.log(`[CircuitBreaker] ${key}: half-open -> open (model not found)`);
    }
  }

  /**
   * Record a state change for logging/metrics
   * @param {string} providerKey - Provider identifier
   * @param {string} newState - New state
   */
  recordStateChange(providerKey, newState) {
    const stats = this.getStats(providerKey);
    const oldState = this.states.get(providerKey)?.state || 'unknown';
    
    if (oldState === 'open' && newState !== 'open') {
      const state = this.getState(providerKey);
      const downtime = Date.now() - state.openedAt;
      stats.totalDowntime += downtime;
    }
    
    stats.lastStateChange = Date.now();
    console.log(`[CircuitBreaker] ${providerKey}: ${oldState} -> ${newState}`);
  }

  /**
   * Get the current state of a provider's circuit
   * @param {string} providerKey - Provider identifier
   * @returns {string} 'closed', 'open', or 'half-open'
   */
  get circuitState() {
    return (providerKey) => {
      const state = this.getState(providerKey);
      return state.state;
    };
  }

  /**
   * Get all provider states
   * @returns {object} Map of provider states
   */
  getAllStates() {
    const result = {};
    for (const [key, state] of this.states.entries()) {
      result[key] = {
        ...state,
        stats: this.getStats(key),
      };
    }
    return result;
  }

  /**
   * Get all model-level states
   * @returns {object} Map of model states
   */
  getAllModelStates() {
    const result = {};
    for (const [key, state] of this.modelStates.entries()) {
      const [providerKey, ...modelParts] = key.split(':');
      const modelName = modelParts.join(':');
      result[key] = {
        ...state,
        providerKey,
        modelName,
        stats: this.getModelStats(providerKey, modelName),
      };
    }
    return result;
  }

  /**
   * Reset circuit for a provider
   * @param {string} providerKey - Provider identifier
   */
  reset(providerKey) {
    const state = this.getState(providerKey);
    state.state = 'closed';
    state.failures = 0;
    state.lastFailure = 0;
    state.openedAt = 0;
    state.halfOpenProbes = 0;
    state.successSinceOpen = 0;
    
    this.recordStateChange(providerKey, 'closed');
    
    // Also reset all models for this provider
    for (const [key, state] of this.modelStates.entries()) {
      if (key.startsWith(providerKey + ':')) {
        state.state = 'closed';
        state.failures = 0;
        state.lastFailure = 0;
        state.openedAt = 0;
        state.halfOpenProbes = 0;
        state.successSinceOpen = 0;
        console.log(`[CircuitBreaker] ${key}: reset (provider reset)`);
      }
    }
  }

  /**
   * Reset circuit for a specific model
   * @param {string} providerKey - Provider identifier
   * @param {string} modelName - Model name
   */
  resetModel(providerKey, modelName) {
    const key = `${providerKey}:${modelName}`;
    const state = this.modelStates.get(key);
    if (state) {
      state.state = 'closed';
      state.failures = 0;
      state.lastFailure = 0;
      state.openedAt = 0;
      state.halfOpenProbes = 0;
      state.successSinceOpen = 0;
      console.log(`[CircuitBreaker] ${key}: reset`);
    }
  }

  /**
   * Reset all circuits
   */
  resetAll() {
    for (const providerKey of this.states.keys()) {
      this.reset(providerKey);
    }
    // Also clear all model states
    for (const [key, state] of this.modelStates.entries()) {
      state.state = 'closed';
      state.failures = 0;
      state.lastFailure = 0;
      state.openedAt = 0;
      state.halfOpenProbes = 0;
      state.successSinceOpen = 0;
    }
  }

  /**
   * Get circuit breaker summary statistics
   * @returns {object} Summary statistics
   */
  getSummary() {
    let openCount = 0;
    let halfOpenCount = 0;
    let closedCount = 0;
    let totalFailures = 0;
    let totalRequests = 0;
    
    for (const [key, state] of this.states.entries()) {
      const stats = this.getStats(key);
      
      switch (state.state) {
        case 'open': openCount++; break;
        case 'half-open': halfOpenCount++; break;
        case 'closed': closedCount++; break;
      }
      
      totalFailures += stats.failedRequests;
      totalRequests += stats.totalRequests;
    }
    
    // Model-level stats
    let modelOpenCount = 0;
    let modelHalfOpenCount = 0;
    let modelClosedCount = 0;
    
    for (const [key, state] of this.modelStates.entries()) {
      switch (state.state) {
        case 'open': modelOpenCount++; break;
        case 'half-open': modelHalfOpenCount++; break;
        case 'closed': modelClosedCount++; break;
      }
    }
    
    return {
      providers: {
        open: openCount,
        halfOpen: halfOpenCount,
        closed: closedCount,
      },
      models: {
        open: modelOpenCount,
        halfOpen: modelHalfOpenCount,
        closed: modelClosedCount,
        total: modelOpenCount + modelHalfOpenCount + modelClosedCount,
      },
      requests: {
        total: totalRequests,
        failed: totalFailures,
        successRate: totalRequests > 0 ? ((totalRequests - totalFailures) / totalRequests * 100).toFixed(2) + '%' : '0%',
      },
      config: {
        threshold: this.threshold,
        resetTimeout: this.resetTimeout,
        halfOpenMaxProbes: this.halfOpenMaxProbes,
      },
    };
  }
}

// Export singleton instance
module.exports = new CircuitBreaker();

// Also export class for testing
module.exports.CircuitBreaker = CircuitBreaker;