#!/usr/bin/env node
/**
 * free-llm-api-provider CLI
 * ========================
 * Standalone LLM proxy with automatic fallback between free AI providers.
 * 
 * Self-contained - no external dependencies needed.
 * Replicates free-coding-models core functionality internally.
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const readline = require('readline');
const os = require('os');

// Our internal modules
const { loadConfig, saveConfig, getApiKey, isProviderEnabled, addApiKey, getEnabledProviders } = require('./config');
const { sources, MODELS, ENV_VAR_NAMES, TIER_ORDER, getModelsByTier, getModelsByProvider, getApiProviders } = require('./models');
const { startProxyServer, PROXY_PORT } = require('./proxy');

// ============================================================================
// CONSTANTS
// ============================================================================
const APP_NAME = 'free-llm-api-provider';
const DEFAULT_KEY = 'sk-free-llm-api-provider';

// ============================================================================
// INTERACTIVE CONFIG WIZARD
// ============================================================================

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise(resolve => {
    rl.question(prompt, answer => resolve(answer.trim()));
  });
}

/**
 * Interactive setup wizard - configure API keys for providers
 */
async function configWizard() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║     ${APP_NAME} - Configuration Wizard                      ║
╚══════════════════════════════════════════════════════════════╝

This wizard helps you configure API keys for free LLM providers.
You only need ONE key to get started. More providers = better failover.

Recommended (easiest to get started):
  1. Groq      - https://console.groq.com/keys (30 RPM, no CC)
  2. NVIDIA    - https://build.nvidia.com (40 RPM, no CC)
  3. Cerebras  - https://cloud.cerebras.ai (1M tokens/day, no CC)

Press Ctrl+C at any time to exit.
`);

  const config = loadConfig();
  const apiProviders = getApiProviders();
  
  // Show currently configured providers
  const configured = apiProviders.filter(p => getApiKey(config, p));
  if (configured.length > 0) {
    console.log('✅ Already configured providers:');
    for (const p of configured) {
      const key = getApiKey(config, p);
      const masked = key.substring(0, 4) + '...' + key.substring(key.length - 4);
      console.log(`   • ${sources[p]?.name || p}: ${masked}`);
    }
    console.log();
  }

  // Configure each provider
  for (const providerKey of apiProviders) {
    const provider = sources[providerKey];
    if (!provider) continue;
    
    const existingKey = getApiKey(config, providerKey);
    const envVar = ENV_VAR_NAMES[providerKey];
    
    console.log(`─`.repeat(60));
    console.log(`Provider: ${provider.name}`);
    console.log(`Website:  ${getSignupUrl(providerKey)}`);
    console.log(`Free tier: ${getFreeTierInfo(providerKey)}`);
    
    if (existingKey) {
      const masked = existingKey.substring(0, 4) + '...' + existingKey.substring(existingKey.length - 4);
      console.log(`Current:  ${masked}`);
      const change = await question('Update key? (y/N/skip): ');
      if (change.toLowerCase() === 'y') {
        const newKey = await question(`Enter ${provider.name} API key: `);
        if (newKey) {
          addApiKey(config, providerKey, newKey);
          console.log('✅ Key updated');
        }
      }
    } else {
      const hasEnv = envVar && process.env[envVar];
      if (hasEnv) {
        console.log(`✅ Found via environment variable ${envVar}`);
      } else {
        const key = await question(`Enter ${provider.name} API key (or press Enter to skip): `);
        if (key) {
          addApiKey(config, providerKey, key);
          console.log('✅ Key saved');
        } else {
          console.log('⏭️  Skipped');
        }
      }
    }
    console.log();
  }

  // Save config
  const result = saveConfig(config);
  if (result.success) {
    console.log('✅ Configuration saved to ~/.free-llm-api-provider.json');
  } else {
    console.error('❌ Failed to save config:', result.error);
  }
  
  const enabled = getEnabledProviders(config);
  console.log(`\n📊 ${enabled.length} provider(s) configured and enabled`);
  if (enabled.length === 0) {
    console.log('⚠️  No providers configured. Run free-llm-api-provider --config again.');
  }
  
  rl.close();
}

function getSignupUrl(providerKey) {
  const urls = {
    nvidia: 'https://build.nvidia.com',
    groq: 'https://console.groq.com/keys',
    cerebras: 'https://cloud.cerebras.ai',
    sambanova: 'https://cloud.sambanova.ai/apis',
    openrouter: 'https://openrouter.ai/keys',
    huggingface: 'https://huggingface.co/settings/tokens',
    replicate: 'https://replicate.com/account/api-tokens',
    deepinfra: 'https://deepinfra.com/login',
    fireworks: 'https://fireworks.ai',
    codestral: 'https://codestral.mistral.ai',
    hyperbolic: 'https://app.hyperbolic.ai/settings',
    scaleway: 'https://console.scaleway.com/iam/api-keys',
    googleai: 'https://aistudio.google.com/apikey',
    siliconflow: 'https://cloud.siliconflow.cn/account/ak',
    together: 'https://api.together.ai/settings/api-keys',
    cloudflare: 'https://dash.cloudflare.com',
    perplexity: 'https://www.perplexity.ai/settings/api',
    qwen: 'https://modelstudio.console.alibabacloud.com',
    zai: 'https://z.ai',
    iflow: 'https://platform.iflow.cn',
    chutes: 'https://chutes.ai',
    ovhcloud: 'https://endpoints.ai.cloud.ovh.net',
  };
  return urls[providerKey] || 'N/A';
}

function getFreeTierInfo(providerKey) {
  const info = {
    nvidia: '40 RPM (no credit card)',
    groq: '30-50 RPM (no credit card)',
    cerebras: '1M tokens/day (no credit card)',
    sambanova: 'Dev tier generous quota',
    openrouter: '50 req/day free, 1K/day with $10',
    huggingface: '~$0.10/month free credits',
    replicate: '6 req/min free',
    deepinfra: '200 concurrent requests',
    fireworks: '$1 free credits',
    codestral: '30 RPM, 2K/day',
    hyperbolic: '$1 free trial credits',
    scaleway: '1M free tokens',
    googleai: '14.4K req/day',
    siliconflow: '100 req/day + $1 credits',
    together: 'Credits/promos vary',
    cloudflare: '10K neurons/day',
    perplexity: '~50 RPM (tiered)',
    qwen: '1M tokens/model (90 days)',
    zai: 'Generous free quota',
    iflow: 'Free for individuals',
    chutes: 'Free community GPU',
    ovhcloud: '2 req/min/IP free, 400 RPM with key',
  };
  return info[providerKey] || 'See provider website';
}

// ============================================================================
// CONFIG DISPLAY
// ============================================================================

function showConfig() {
  const config = loadConfig();
  const enabled = getEnabledProviders(config);
  
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║           ${APP_NAME} - Configuration                         ║
╚══════════════════════════════════════════════════════════════╝

Config file: ~/.free-llm-api-provider.json

Enabled providers: ${enabled.length}
`);

  if (enabled.length > 0) {
    console.log('Configured providers:');
    for (const key of enabled) {
      const provider = sources[key];
      const models = getModelsByProvider(key);
      const tierS = models.filter(m => m[2] === 'S+' || m[2] === 'S').length;
      console.log(`  • ${provider?.name || key} (${models.length} models, ${tierS} S-tier)`);
    }
  }
  
  console.log(`\nTotal models available: ${MODELS.length}`);
  console.log('Run --models to see all available models');
}

// ============================================================================
// MODEL DISPLAY
// ============================================================================

function showModels(filter) {
  let models = [...MODELS];
  
  // Filter by tier if specified
  if (filter?.tier) {
    models = models.filter(m => m[2] === filter.tier || m[2].startsWith(filter.tier));
  }
  
  // Filter by provider if specified
  if (filter?.provider) {
    models = models.filter(m => m[5] === filter.provider);
  }
  
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║              Available Models (${models.length})                          ║
╚══════════════════════════════════════════════════════════════╝
`);

  // Group by tier
  const byTier = {};
  for (const model of models) {
    const tier = model[2];
    if (!byTier[tier]) byTier[tier] = [];
    byTier[tier].push(model);
  }
  
  for (const tier of TIER_ORDER) {
    if (!byTier[tier] || byTier[tier].length === 0) continue;
    console.log(`\n── ${tier} Tier (${byTier[tier].length} models) ──`);
    for (const [id, label, _, swe, ctx, provider] of byTier[tier].slice(0, 10)) {
      const pName = sources[provider]?.name || provider;
      console.log(`  ${label.padEnd(25)} | ${pName.padEnd(15)} | ${swe} | ${ctx}`);
    }
    if (byTier[tier].length > 10) {
      console.log(`  ... and ${byTier[tier].length - 10} more`);
    }
  }
}

// ============================================================================
// LITELLM CONFIG GENERATOR
// ============================================================================

function generateLitellmConfig() {
  const config = loadConfig();
  const enabled = getEnabledProviders(config);
  
  if (enabled.length === 0) {
    throw new Error('No providers configured. Run: free-llm-api-provider --config');
  }
  
  const modelList = [];
  
  // For each enabled provider, add their top models per tier
  for (const providerKey of enabled) {
    const provider = sources[providerKey];
    if (!provider || !provider.url) continue;
    
    const models = getModelsByProvider(providerKey);
    const tiers = ['S+', 'S', 'A+', 'A', 'A-', 'B+', 'B'];
    
    for (const tier of tiers) {
      const tierModels = models.filter(m => m[2] === tier);
      if (tierModels.length === 0) continue;
      
      // Pick first model of this tier
      const [modelId] = tierModels[0];
      
      modelList.push({
        model_name: `tier-${tier.toLowerCase().replace('+', 'plus')}`,
        litellm_params: {
          model: `${providerKey}/${modelId}`,
          api_key: `os.environ/${ENV_VAR_NAMES[providerKey] || providerKey.toUpperCase() + '_API_KEY'}`,
          api_base: provider.url.replace('/chat/completions', ''),
        }
      });
      
      // Also add as provider-specific model
      modelList.push({
        model_name: `${providerKey}/${modelId}`,
        litellm_params: {
          model: `${providerKey}/${modelId}`,
          api_key: `os.environ/${ENV_VAR_NAMES[providerKey] || providerKey.toUpperCase() + '_API_KEY'}`,
          api_base: provider.url.replace('/chat/completions', ''),
        }
      });
    }
  }
  
  return {
    general_settings: {
      master_key: DEFAULT_KEY,
      disable_spend_logs: true,
    },
    litellm_settings: {
      drop_params: true,
      request_timeout: 90,
      fallback_dict: buildFallbackDict(enabled),
    },
    model_list: modelList,
  };
}

function buildFallbackDict(enabledProviders) {
  // Build fallback chain: S+ -> S -> A+ -> A -> A- -> B+ -> B
  const fallbacks = {};
  const tiers = ['splus', 's', 'aplus', 'a', 'aminus', 'bplus', 'b'];
  
  for (let i = 0; i < tiers.length - 1; i++) {
    fallbacks[`tier-${tiers[i]}`] = [`tier-${tiers[i+1]}`];
  }
  
  return fallbacks;
}

function writeLitellmConfig() {
  const config = generateLitellmConfig();
  const configPath = path.join(__dirname, '..', 'litellm_proxy.yaml');
  
  let yaml = '';
  yaml += 'general_settings:\n';
  yaml += `  master_key: ${config.general_settings.master_key}\n`;
  yaml += '  disable_spend_logs: true\n';
  yaml += '\nlitellm_settings:\n';
  yaml += '  drop_params: true\n';
  yaml += '  request_timeout: 90\n';
  yaml += '\nmodel_list:\n';
  
  for (const model of config.model_list) {
    yaml += '- model_name: ' + model.model_name + '\n';
    yaml += '  litellm_params:\n';
    yaml += '    model: ' + model.litellm_params.model + '\n';
    yaml += '    api_key: ' + model.litellm_params.api_key + '\n';
    if (model.litellm_params.api_base) {
      yaml += '    api_base: ' + model.litellm_params.api_base + '\n';
    }
  }
  
  fs.writeFileSync(configPath, yaml);
  return configPath;
}

// ============================================================================
// PROXY MANAGEMENT (Node.js - No Docker)
// ============================================================================

let proxyServer = null;
let proxyProcess = null;

function isPortInUse(port) {
  const net = require('net');
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(true));
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    server.listen(port);
  });
}

async function startProxy() {
  console.log('🚀 Starting free-llm-api-provider proxy...');
  
  const config = loadConfig();
  const enabled = getEnabledProviders(config);
  
  if (enabled.length === 0) {
    console.log('❌ No providers configured.');
    console.log('   Run: free-llm-api-provider --config');
    return false;
  }
  
  if (await isPortInUse(PROXY_PORT)) {
    console.log(`⚠️  Port ${PROXY_PORT} already in use.`);
    return false;
  }
  
  console.log(`📡 ${enabled.length} provider(s) configured:`);
  for (const key of enabled) {
    console.log(`   • ${sources[key]?.name || key}`);
  }
  
  // Start Node.js proxy server
  try {
    proxyServer = startProxyServer(PROXY_PORT);
    console.log('✅ Proxy started on http://localhost:4000');
    return true;
  } catch (err) {
    console.error('❌ Failed to start proxy:', err.message);
    return false;
  }
}

async function stopProxy() {
  console.log('🛑 Stopping free-llm-api-provider proxy...');
  
  if (proxyServer) {
    proxyServer.close(() => {
      console.log('✅ Proxy stopped');
    });
    proxyServer = null;
  } else {
    // Try to kill any process on the port
    try {
      if (process.platform === 'win32') {
        execSync(`FOR /F "tokens=5" %a IN ('netstat -ano ^| findstr :${PROXY_PORT}') DO taskkill /F /PID %a`, { stdio: 'ignore' });
      } else {
        execSync(`lsof -ti:${PROXY_PORT} | xargs kill -9 2>/dev/null || true`, { stdio: 'ignore' });
      }
      console.log('✅ Proxy stopped');
    } catch {
      console.log('ℹ️  No proxy running');
    }
  }
  
  return true;
}

function checkHealth() {
  return new Promise(resolve => {
    const req = http.get(`http://localhost:${PROXY_PORT}/health`, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(5000, () => {
      req.destroy();
      resolve(null);
    });
  });
}

function showLogs() {
  console.log('📋 Proxy logs: Console output (Ctrl+C to exit)...');
  console.log('   The proxy runs in the foreground. Press Ctrl+C to stop.');
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  
  // --help
  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    console.log(`
${APP_NAME} - Local LLM proxy with automatic fallback

Usage:
  free-llm-api-provider              Start the proxy
  free-llm-api-provider --config     Configure API keys (interactive wizard)
  free-llm-api-provider --stop       Stop the proxy
  free-llm-api-provider --restart    Restart the proxy
  free-llm-api-provider --logs       Show logs
  free-llm-api-provider --test       Test connection
  free-llm-api-provider --show       Show configuration
  free-llm-api-provider --models     List all available models
  free-llm-api-provider --models --tier S+   List S+ tier models
  free-llm-api-provider --models --provider groq   List Groq models

Environment Variables:
  You can also set API keys via environment variables:
  NVIDIA_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY, etc.

API Key: ${DEFAULT_KEY}
Port: ${PROXY_PORT}
`);
    return;
  }
  
  // --config
  if (args.includes('--config')) {
    await configWizard();
    return;
  }
  
  // --show / --status
  if (args.includes('--show') || args.includes('--status')) {
    showConfig();
    return;
  }
  
  // --models
  if (args.includes('--models')) {
    const tierIdx = args.indexOf('--tier');
    const providerIdx = args.indexOf('--provider');
    const filter = {};
    if (tierIdx !== -1 && args[tierIdx + 1]) filter.tier = args[tierIdx + 1];
    if (providerIdx !== -1 && args[providerIdx + 1]) filter.provider = args[providerIdx + 1];
    showModels(filter);
    return;
  }
  
  // --stop
  if (args.includes('--stop')) {
    await stopProxy();
    return;
  }
  
  // --restart
  if (args.includes('--restart')) {
    await stopProxy();
    await startProxy();
    return;
  }
  
  // --logs
  if (args.includes('--logs')) {
    showLogs();
    return;
  }
  
  // --test
  if (args.includes('--test')) {
    const health = await checkHealth();
    if (health) {
      console.log('✅ Proxy is healthy');
      console.log(`   Endpoints: ${health.healthy_endpoints?.length || 0}`);
    } else {
      console.log('❌ Proxy not responding');
      console.log('   Run: free-llm-api-provider');
    }
    return;
  }
  
  // Default: start proxy
  const config = loadConfig();
  const enabled = getEnabledProviders(config);
  
  if (enabled.length === 0) {
    console.log(`
❌ No API keys configured.

Run the configuration wizard first:
  free-llm-api-provider --config

Or set environment variables:
  export GROQ_API_KEY=your_key_here
  export NVIDIA_API_KEY=your_key_here
`);
    process.exit(1);
  }
  
  const health = await checkHealth();
  if (health) {
    console.log(`✅ ${APP_NAME} is already running on port ${PROXY_PORT}`);
    console.log(`   Health: ${health.healthy_endpoints?.length || 0} endpoints`);
    console.log();
    console.log('🔑 API Key:', DEFAULT_KEY);
    console.log('🌐 Endpoint: http://localhost:4000/v1');
  } else {
    await startProxy();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
