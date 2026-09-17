/**
 * Metrics Module for Free LLM API Provider
 * 
 * Provides Prometheus-compatible metrics collection and export.
 * Tracks request counts, latencies, provider usage, and system metrics.
 * 
 * Usage:
 *   const metrics = require('./metrics');
 *   metrics.recordRequest({ provider, model, latencyMs, success, tokensIn, tokensOut });
 *   metrics.getPrometheusMetrics(); // returns Prometheus text format
 */

const { performance } = require('perf_hooks');

class Metrics {
  constructor() {
    this.counters = new Map();
    this.histograms = new Map();
    this.gauges = new Map();
    this.startTime = Date.now();
  }

  // Counter methods
  incrementCounter(name, labels = {}, value = 1) {
    const key = this._buildKey(name, labels);
    this.counters.set(key, (this.counters.get(key) || 0) + value);
  }

  getCounter(name, labels = {}) {
    const key = this._buildKey(name, labels);
    return this.counters.get(key) || 0;
  }

  // Histogram methods (for latency tracking)
  observeHistogram(name, value, labels = {}) {
    const key = this._buildKey(name, labels);
    if (!this.histograms.has(key)) {
      this.histograms.set(key, {
        values: [],
        sum: 0,
        count: 0,
        min: Infinity,
        max: -Infinity,
      });
    }
    const hist = this.histograms.get(key);
    hist.values.push(value);
    hist.sum += value;
    hist.count++;
    hist.min = Math.min(hist.min, value);
    hist.max = Math.max(hist.max, value);
    
    // Keep only last 1000 values to prevent memory issues
    if (hist.values.length > 1000) {
      hist.values.shift();
    }
  }

  getHistogram(name, labels = {}) {
    const key = this._buildKey(name, labels);
    return this.histograms.get(key) || { values: [], sum: 0, count: 0, min: Infinity, max: -Infinity };
  }

  // Gauge methods (for current values)
  setGauge(name, value, labels = {}) {
    const key = this._buildKey(name, labels);
    this.gauges.set(key, value);
  }

  getGauge(name, labels = {}) {
    const key = this._buildKey(name, labels);
    return this.gauges.get(key) || 0;
  }

  incrementGauge(name, labels = {}, value = 1) {
    const key = this._buildKey(name, labels);
    this.gauges.set(key, (this.gauges.get(key) || 0) + value);
  }

  decrementGauge(name, labels = {}, value = 1) {
    const key = this._buildKey(name, labels);
    this.gauges.set(key, (this.gauges.get(key) || 0) - value);
  }

  // High-level request recording
  recordRequest(data) {
    const { provider, model, latencyMs, success, tokensIn = 0, tokensOut = 0, statusCode = 200 } = data;
    
    // Request counts
    this.incrementCounter('flap_requests_total', { provider, model, success: success ? 'true' : 'false' });
    this.incrementCounter('flap_requests_by_status', { provider, status: String(statusCode) });
    
    // Latency
    this.observeHistogram('flap_request_latency_ms', latencyMs, { provider, model });
    
    // Tokens
    if (tokensIn > 0) this.incrementCounter('flap_tokens_input_total', { provider, model }, tokensIn);
    if (tokensOut > 0) this.incrementCounter('flap_tokens_output_total', { provider, model }, tokensOut);
    
    // Success rate tracking
    const successKey = `${provider}:success`;
    const failKey = `${provider}:fail`;
    if (success) {
      this.incrementCounter('flap_provider_success_total', { provider });
    } else {
      this.incrementCounter('flap_provider_fail_total', { provider });
    }
  }

  // Provider health recording
  recordProviderHealth(provider, healthy, latencyMs) {
    this.setGauge('flap_provider_healthy', healthy ? 1 : 0, { provider });
    if (latencyMs !== undefined) {
      this.observeHistogram('flap_provider_health_latency_ms', latencyMs, { provider });
    }
  }

  // Circuit breaker recording
  recordCircuitBreakerState(provider, state) {
    const stateMap = { open: 2, halfOpen: 1, closed: 0 };
    this.setGauge('flap_circuit_breaker_state', stateMap[state] || 0, { provider });
  }

  // Active connections
  incrementActiveConnections(provider) {
    this.incrementGauge('flap_active_connections', { provider });
  }

  decrementActiveConnections(provider) {
    this.decrementGauge('flap_active_connections', { provider });
  }

  // System metrics
  recordSystemMetrics() {
    const memUsage = process.memoryUsage();
    this.setGauge('flap_memory_rss_bytes', memUsage.rss);
    this.setGauge('flap_memory_heap_used_bytes', memUsage.heapUsed);
    this.setGauge('flap_memory_heap_total_bytes', memUsage.heapTotal);
    this.setGauge('flap_uptime_seconds', (Date.now() - this.startTime) / 1000);
  }

  // Prometheus text format export
  getPrometheusMetrics() {
    this.recordSystemMetrics(); // Update system metrics before export
    
    let output = '';
    
    // Counters
    for (const [key, value] of this.counters.entries()) {
      const { name, labels } = this._parseKey(key);
      const labelsStr = this._formatLabels(labels);
      output += `# HELP ${name} Total count of ${name.replace(/_/g, ' ')}\n`;
      output += `# TYPE ${name} counter\n`;
      output += `${name}${labelsStr} ${value}\n\n`;
    }
    
    // Histograms
    for (const [key, hist] of this.histograms.entries()) {
      const { name, labels } = this._parseKey(key);
      const labelsStr = this._formatLabels(labels);
      output += `# HELP ${name} Histogram of ${name.replace(/_/g, ' ')}\n`;
      output += `# TYPE ${name} histogram\n`;
      
      // Calculate percentiles
      const sorted = [...hist.values].sort((a, b) => a - b);
      const p50 = this._percentile(sorted, 0.5);
      const p90 = this._percentile(sorted, 0.9);
      const p95 = this._percentile(sorted, 0.95);
      const p99 = this._percentile(sorted, 0.99);
      
      output += `${name}_sum${labelsStr} ${hist.sum}\n`;
      output += `${name}_count${labelsStr} ${hist.count}\n`;
      output += `${name}_min${labelsStr} ${hist.min === Infinity ? 0 : hist.min}\n`;
      output += `${name}_max${labelsStr} ${hist.max === -Infinity ? 0 : hist.max}\n`;
      output += `${name}_p50${labelsStr} ${p50}\n`;
      output += `${name}_p90${labelsStr} ${p90}\n`;
      output += `${name}_p95${labelsStr} ${p95}\n`;
      output += `${name}_p99${labelsStr} ${p99}\n\n`;
    }
    
    // Gauges
    for (const [key, value] of this.gauges.entries()) {
      const { name, labels } = this._parseKey(key);
      const labelsStr = this._formatLabels(labels);
      output += `# HELP ${name} Current value of ${name.replace(/_/g, ' ')}\n`;
      output += `# TYPE ${name} gauge\n`;
      output += `${name}${labelsStr} ${value}\n\n`;
    }
    
    return output;
  }

  // JSON format export
  getJsonMetrics() {
    this.recordSystemMetrics();
    
    const result = {
      counters: {},
      histograms: {},
      gauges: {},
    };
    
    for (const [key, value] of this.counters.entries()) {
      const { name, labels } = this._parseKey(key);
      if (!result.counters[name]) result.counters[name] = [];
      result.counters[name].push({ labels, value });
    }
    
    for (const [key, hist] of this.histograms.entries()) {
      const { name, labels } = this._parseKey(key);
      const sorted = [...hist.values].sort((a, b) => a - b);
      result.histograms[name] = result.histograms[name] || [];
      result.histograms[name].push({
        labels,
        count: hist.count,
        sum: hist.sum,
        min: hist.min === Infinity ? 0 : hist.min,
        max: hist.max === -Infinity ? 0 : hist.max,
        p50: this._percentile(sorted, 0.5),
        p90: this._percentile(sorted, 0.9),
        p95: this._percentile(sorted, 0.95),
        p99: this._percentile(sorted, 0.99),
      });
    }
    
    for (const [key, value] of this.gauges.entries()) {
      const { name, labels } = this._parseKey(key);
      if (!result.gauges[name]) result.gauges[name] = [];
      result.gauges[name].push({ labels, value });
    }
    
    return result;
  }

  // Helper methods
  _buildKey(name, labels) {
    const sortedLabels = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
    const labelsStr = sortedLabels.map(([k, v]) => `${k}="${v}"`).join(',');
    return `${name}{${labelsStr}}`;
  }

  _parseKey(key) {
    const match = key.match(/^([^{}]+)(?:\{(.*)\})?$/);
    if (!match) return { name: key, labels: {} };
    
    const name = match[1];
    const labelsStr = match[2] || '';
    const labels = {};
    
    if (labelsStr) {
      const pairs = labelsStr.split(',');
      for (const pair of pairs) {
        const [k, v] = pair.split('=');
        if (k && v) labels[k] = v.replace(/^"|"$/g, '');
      }
    }
    
    return { name, labels };
  }

  _formatLabels(labels) {
    const entries = Object.entries(labels);
    if (entries.length === 0) return '';
    const pairs = entries.map(([k, v]) => `${k}="${v}"`);
    return `{${pairs.join(',')}}`;
  }

  _percentile(sorted, p) {
    if (sorted.length === 0) return 0;
    const index = Math.ceil(p * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  // Reset all metrics
  reset() {
    this.counters.clear();
    this.histograms.clear();
    this.gauges.clear();
    this.startTime = Date.now();
  }
}

// Singleton instance
const metrics = new Metrics();

module.exports = metrics;
module.exports.Metrics = Metrics;
