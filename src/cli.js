#!/usr/bin/env node
/**
 * free-llm-api-provider CLI
 * ========================
 * Standalone LLM proxy with automatic fallback between free AI providers.
 * 
 * Self-contained - no external dependencies needed.
 * Replicates free-coding-models core functionality internally.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const readline = require('readline');

// Our internal modules
const { loadConfig, saveConfig, getApiKey, isProviderEnabled, addApiKey, getEnabledProviders, ensureServerApiKey, getServerApiKey, CONFIG_PATH } = require('./config');
const { sources, MODELS, ENV_VAR_NAMES, TIER_ORDER, getModelsByTier, getModelsByProvider, getApiProviders } = require('./models');
const { startProxyServer, PROXY_PORT } = require('./proxy');
const { startDashboard } = require('./status-dashboard');
const { runHealthCheck, getHealthyProviders } = require('./health-checker');
const { syncCatalog, exportCatalog, getCatalogUrl } = require('./sync');
const { getMeta } = require('./db');

// Global error handlers to prevent crashes, then exit to undefined state
process.on('uncaughtException', err => { console.error('[FATAL] Uncaught exception:', err instanceof Error ? err.stack : String(err)); process.exit(1); });
process.on('unhandledRejection', (reason, promise) => { console.error('[FATAL] Unhandled rejection:', reason instanceof Error ? reason.stack : String(reason)); process.exit(1); });

// ============================================================================
// CONSTANTS
// ============================================================================
const APP_NAME = 'free-llm-api-provider';

function getKey() { return getServerApiKey(loadConfig()); }

// ============================================================================
// INTERACTIVE CONFIG WIZARD
// ============================================================================

function question(rl, prompt) {
  return new Promise(resolve => {
    rl.question(prompt, answer => resolve(answer.trim()));
  });
}

/**
 * Interactive setup wizard - configure API keys for providers
 */
async function configWizard() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
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
      const change = await question(rl, 'Update key? (y/N/skip): ');
      if (change.toLowerCase() === 'y') {
        const newKey = await question(rl, `Enter ${provider.name} API key: `);
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
        const key = await question(rl, `Enter ${provider.name} API key (or press Enter to skip): `);
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
    console.log('✅ Configuration saved to ' + CONFIG_PATH);
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

Config file: ${CONFIG_PATH}

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
      master_key: getKey(),
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

// SIGINT 优雅关闭 — 确保 Ctrl+C 时服务器正常停止
process.on('SIGINT', async () => {
  console.log('\n⚠️ 正在关闭 free-llm-api-provider...');
  if (proxyServer) {
    proxyServer.close(() => {
      console.log('✅ 代理已停止');
      process.exit(0);
    });
    // 强制超时：2秒后强制退出
    setTimeout(() => process.exit(1), 2000);
  } else {
    process.exit(0);
  }
});

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
  // Ensure server API key exists (generates on first run)
  const cfg = loadConfig();
  ensureServerApiKey(cfg);
  
  console.log('🚀 Starting free-llm-api-provider proxy...');
  
  const config = loadConfig();
  const enabled = getEnabledProviders(config);
  
  if (enabled.length === 0) {
    console.log('⚠️  暂无配置的提供商，管理后台仍可访问以添加密钥。');
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
    console.log('✅ Proxy started on http://localhost:4002');
    console.log('   🌐 Admin UI:  http://localhost:4002/admin');
    console.log(`   🔑 API Key:   ${getServerApiKey(loadConfig())}`);
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
        // PowerShell 兼容的端口进程查找和终止
        try {
          execSync(`netstat -ano | Select-String ":${PROXY_PORT} " | ForEach-Object { $_.ToString().TrimEnd() -split '\\s+' | Select-Object -Last 1 } | ForEach-Object { taskkill /F /PID $_ }`, { stdio: 'ignore', shell: 'powershell.exe' });
        } catch { /* 无进程需要终止 */ }
      } else {
        execSync(`lsof -ti:${PROXY_PORT} | xargs -r kill -9 2>/dev/null || true`, { stdio: 'ignore' });
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
    const req = http.get(`http://localhost:${PROXY_PORT}/health`, { agent: false }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          req.destroy();
          resolve(json);
        } catch {
          req.destroy();
          resolve(null);
        }
      });
    });
    req.on('error', () => {
      req.destroy();
      resolve(null);
    });
    req.setTimeout(3000, () => {
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
// FIABLE MODE - 10s reliability analysis
// ============================================================================

async function runFiableMode() {
  console.log('\n⚡ Analyzing providers for reliability (10 seconds)...\n');
  
  const config = loadConfig();
  const enabled = getEnabledProviders(config);
  
  if (enabled.length === 0) {
    console.log('❌ No providers configured. Run: free-llm-api-provider --config');
    return;
  }
  
  // Run health check to get initial data
  await runHealthCheck(config);
  
  const startTime = Date.now();
  const analysisDuration = 10000;
  
  // Wait for analysis duration, re-checking every 2 seconds
  while (Date.now() - startTime < analysisDuration) {
    await runHealthCheck(config);
    const remaining = Math.max(0, analysisDuration - (Date.now() - startTime));
    if (remaining > 0) {
      await new Promise(resolve => setTimeout(resolve, Math.min(2000, remaining)));
    }
  }
  
  // Get final results
  const providers = getHealthyProviders();
  
  if (providers.length === 0 || providers[0].score === 0) {
    console.log('❌ No reliable provider found');
    return;
  }
  
  const best = providers[0];
  const provider = sources[best.key];
  
  console.log('\n✅ Most reliable provider:');
  console.log(`   ${provider?.name || best.key}`);
  console.log(`   Score: ${best.score}/100`);
  console.log(`   Avg Latency: ${best.avgLatency > 0 ? Math.round(best.avgLatency) + 'ms' : 'N/A'}`);
  console.log(`   Status: ${best.status === 'up' ? '✅ UP' : '❌ ' + best.status}`);
  console.log(`   Best Model: ${best.bestModel || 'Unknown'}`);
  console.log();
  
  // Show top 5
  console.log('Top 5 providers:');
  for (let i = 0; i < Math.min(5, providers.length); i++) {
    const p = providers[i];
    const src = sources[p.key];
    console.log(`  ${i + 1}. ${src?.name || p.key} - Score: ${p.score}, Latency: ${p.avgLatency > 0 ? Math.round(p.avgLatency) + 'ms' : 'N/A'}, Status: ${p.status}`);
  }
  console.log();
}

// ============================================================================
// OPENCODE CONFIG INTEGRATION
// ============================================================================

function findOpencodeConfig() {
  const homedir = process.env.HOME || process.env.USERPROFILE || '/tmp';
  const candidates = [
    path.join(homedir, '.opencode', 'config.json'),
    path.join(homedir, 'AppData', 'Roaming', 'opencode', 'config.json'),
    path.join(homedir, '.config', 'opencode', 'config.json'),
    path.join(homedir, 'opencode.json'),
  ];
  
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  
  // Default to create in ~/.opencode/config.json
  return candidates[0];
}

async function addOpencodeConfig() {
  console.log('🔧 Configuring OpenCode integration...\n');
  
  const configPath = findOpencodeConfig();
  const configDir = path.dirname(configPath);
  
  // Ensure directory exists
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  
  // Read existing config or create new
  let opencodeConfig = {};
  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, 'utf8');
      opencodeConfig = JSON.parse(content);
      console.log(`📄 Found existing config: ${configPath}`);
    } catch (err) {
      console.log(`⚠️  Could not parse existing config, creating fresh one`);
      opencodeConfig = {};
    }
  } else {
    console.log(`📄 Creating new config: ${configPath}`);
  }
  
  // Ensure $schema exists
  if (!opencodeConfig.$schema) {
    opencodeConfig.$schema = "https://opencode.ai/config.json";
  }
  
  // Ensure provider section exists
  if (!opencodeConfig.provider) {
    opencodeConfig.provider = {};
  }
  
  // Add our provider
  opencodeConfig.provider.flap = {
    npm: "@ai-sdk/openai-compatible",
    name: "free-llm-api-provider",
    options: {
      baseURL: "http://localhost:4002/v1",
      apiKey: getKey(),
    },
    models: {
      "tier-splus": {
        name: "S+ Tier (Elite)",
        limit: { context: 256000, output: 8192 }
      },
      "tier-s": {
        name: "S Tier (Excellent)",
        limit: { context: 256000, output: 8192 }
      },
      "tier-aplus": {
        name: "A+ Tier (Very Capable)",
        limit: { context: 131000, output: 8192 }
      },
      "tier-a": {
        name: "A Tier (Solid)",
        limit: { context: 128000, output: 8192 }
      },
      "tier-aminus": {
        name: "A- Tier (Decent)",
        limit: { context: 128000, output: 4096 }
      },
      "tier-bplus": {
        name: "B+ Tier (Capable)",
        limit: { context: 64000, output: 4096 }
      },
      "tier-b": {
        name: "B Tier (Entry)",
        limit: { context: 32000, output: 4096 }
      },
      "tier-c": {
        name: "C Tier (Basic)",
        limit: { context: 8000, output: 2048 }
      }
    }
  };
  
  // Write config back
  fs.writeFileSync(configPath, JSON.stringify(opencodeConfig, null, 2));
  
  console.log('✅ Provider added to OpenCode config!');
  console.log(`   File: ${configPath}`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Restart OpenCode completely');
  console.log('  2. Run /connect');
  console.log('  3. Select "flap" provider');
  console.log('  4. Choose your tier (e.g., tier-b)');
  console.log('');
  console.log('Note: Existing providers in config are preserved.');
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const firstArg = args[0]?.toLowerCase();
  
  // --help
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
${APP_NAME} - Local LLM proxy with automatic fallback

Usage:
  free-llm-api-provider              Start the proxy (default)
  free-llm-api-provider start        Start the proxy
  free-llm-api-provider --config          Configure API keys (interactive wizard)
  free-llm-api-provider config            Alias for --config
  free-llm-api-provider --opencode-config Add provider to OpenCode config
  free-llm-api-provider opencode-config   Alias for --opencode-config
  free-llm-api-provider --status          Real-time provider health dashboard
  free-llm-api-provider status            Alias for --status
  free-llm-api-provider --fiable          10s reliability analysis (best provider)
  free-llm-api-provider fiable            Alias for --fiable
  free-llm-api-provider stop              Stop the proxy
  free-llm-api-provider --stop            Alias for stop
  free-llm-api-provider restart           Restart the proxy
  free-llm-api-provider --restart         Alias for restart
  free-llm-api-provider --logs            Show logs
  free-llm-api-provider logs              Alias for --logs
  free-llm-api-provider --test            Test connection
  free-llm-api-provider test              Alias for --test
  free-llm-api-provider --show            Show configuration
  free-llm-api-provider show              Alias for --show
  free-llm-api-provider --models          List all available models
  free-llm-api-provider models            Alias for --models
  free-llm-api-provider --models --tier S+   List S+ tier models
  free-llm-api-provider --models --provider groq   List Groq models
  free-llm-api-provider --sync                  Sync model catalog from remote
  free-llm-api-provider sync --url <url>        Sync from custom URL
  free-llm-api-provider --export-catalog        Export current models as JSON
  free-llm-api-provider export-catalog --output ./catalog.json

Admin Web UI (requires running proxy):
  open http://localhost:4002/admin              Browser-based provider management

Shortcuts (flap alias):
  flap status                        Same as free-llm-api-provider --status
  flap test                          Same as free-llm-api-provider --test
  flap stop                          Same as free-llm-api-provider stop
  flap restart                       Same as free-llm-api-provider restart

Environment Variables:
  API Keys (highest priority, overrides config file):
  NVIDIA_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY, etc.
  
  Runtime:
  DATA_DIR=<path>     Custom data directory (default: <project>/.data/)
  FLAP_PORT=<port>    Proxy port (default: 4002, also reads PORT env var)
  FLAP_API_KEY=<key>  Override server API key (must start with sk-)
  FLAP_ADMIN_PASSWORD=<pw>  Set admin panel password

Data Directory: ${path.dirname(CONFIG_PATH)}
API Key: ${getKey()}
Port: ${PROXY_PORT}
`);
    process.exit(0);
  }
  
  // --config
  if (args.includes('--config')) {
    await configWizard();
    process.exit(0);
  }
  
  // --show
  if (args.includes('--show')) {
    showConfig();
    process.exit(0);
  }
  
  // --status / status (real-time health dashboard) - stays open
  if (args.includes('--status') || firstArg === 'status') {
    await startDashboard();
    return;
  }
  
  // --fiable / fiable (10s reliability analysis)
  if (args.includes('--fiable') || firstArg === 'fiable') {
    await runFiableMode();
    process.exit(0);
  }
  
  // --models / models
  if (args.includes('--models') || firstArg === 'models') {
    const tierIdx = args.indexOf('--tier');
    const providerIdx = args.indexOf('--provider');
    const filter = {};
    if (tierIdx !== -1 && args[tierIdx + 1]) filter.tier = args[tierIdx + 1];
    if (providerIdx !== -1 && args[providerIdx + 1]) filter.provider = args[providerIdx + 1];
    showModels(filter);
    process.exit(0);
  }
  
  // --stop / stop
  if (args.includes('--stop') || firstArg === 'stop') {
    await stopProxy();
    process.exit(0);
  }
  
  // --restart / restart
  if (args.includes('--restart') || firstArg === 'restart') {
    await stopProxy();
    await startProxy();
    return;
  }
  
  // --logs / logs
  if (args.includes('--logs') || firstArg === 'logs') {
    showLogs();
    process.exit(0);
  }
  
  // --test / test
  if (args.includes('--test') || firstArg === 'test') {
    const health = await checkHealth();
    if (health) {
      console.log('✅ Proxy is healthy');
      console.log(`   Endpoints: ${health.healthy_endpoints?.length || 0}`);
    } else {
      console.log('❌ Proxy not responding');
      console.log('   Run: free-llm-api-provider');
    }
    process.exit(0);
  }
  
  // show (bare word)
  if (firstArg === 'show') {
    showConfig();
    process.exit(0);
  }
  
  // config (bare word)
  if (firstArg === 'config') {
    await configWizard();
    process.exit(0);
  }
  
  // --opencode-config / opencode-config
  if (args.includes('--opencode-config') || firstArg === 'opencode-config') {
    await addOpencodeConfig();
    process.exit(0);
  }
  
  // --admin / admin (show admin URL)
  if (args.includes('--admin') || firstArg === 'admin') {
    console.log(`
Admin Web UI: http://localhost:4002/admin

Make sure the proxy is running (flap / free-llm-api-provider).
`);
    process.exit(0);
  }
  
  // --sync / sync (catalog sync)
  if (args.includes('--sync') || firstArg === 'sync') {
    const urlIdx = args.indexOf('--url');
    if (urlIdx !== -1 && args[urlIdx + 1]) {
      process.env.CATALOG_URL = args[urlIdx + 1];
    }
    syncCatalog(true).then(ok => {
      if (ok) console.log('✅ Catalog synced successfully');
      else console.log('❌ Catalog sync failed. Set CATALOG_URL env var or use --url <url>');
      process.exit(ok ? 0 : 1);
    }).catch(err => {
      console.error('❌ Sync error:', err.message);
      process.exit(1);
    });
    return;
  }
  
  // --export-catalog / export-catalog (export static catalog to JSON)
  if (args.includes('--export-catalog') || firstArg === 'export-catalog') {
    const outputIndex = args.indexOf('--output');
    const outputPath = outputIndex !== -1 && outputIndex + 1 < args.length ? args[outputIndex + 1] : 'catalog.json';
    exportCatalog(outputPath);
    process.exit(0);
  }
  
  // Default: start proxy (no args or "start")
  if (args.length === 0 || firstArg === 'start') {
    // Auto-sync catalog on startup
    syncCatalog().catch(err => console.warn('[CLI] Catalog sync 失败:', err.message));
    
    // Auto-sync SWE-bench scores if URL configured (use repo default if none)
    try {
      const sweUrl = getMeta('swe_bench_url') || 'https://raw.githubusercontent.com/liwoyuandiane/free-llm-api-provider/main/swe-bench.json';
      if (sweUrl) {
        const { handleSweBenchSync } = require('./admin');
        const http = require('http');
        handleSweBenchSync({ body: { url: sweUrl } }, { _status: 0, _data: null, writeHead(s,h) { this._status = s; }, end(d) { try { this._data = JSON.parse(d); } catch { this._data = d; } } }).catch(() => {});
      }
    } catch {}
    
    // Periodic auto-sync every 6 hours (respects SYNC_INTERVAL from sync.js = 24h)
    const SYNC_CHECK_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours
    setInterval(() => {
      syncCatalog().catch(err => console.warn('[CLI] Periodic sync 失败:', err.message));
    }, SYNC_CHECK_INTERVAL);
    
    const config = loadConfig();
    const enabled = getEnabledProviders(config);
    
    if (enabled.length === 0) {
      console.log(`
⚠️  没有配置 API 密钥。
   启动管理后台，请通过 http://localhost:4002/admin 添加密钥。
`);
    }
    
    const health = await checkHealth();
    if (health) {
      console.log(`✅ ${APP_NAME} is already running on port ${PROXY_PORT}`);
      console.log(`   Health: ${health.healthy_endpoints?.length || 0} endpoints`);
      console.log();
      console.log('🔑 API Key:', getKey());
      console.log('🌐 Endpoint: http://localhost:4002/v1');
      process.exit(0);
    } else {
      await startProxy();
    }
    return;
  }
  
  // Unknown command
  console.log(`❌ Unknown command: ${args.join(' ')}`);
  console.log('Run free-llm-api-provider --help for usage');
  process.exit(1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
