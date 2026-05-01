/**
 * Config Manager
 * 
 * Replicated from free-coding-models src/config.js
 * Manages ~/.free-llm-api-provider.json with API keys, provider states, and router settings.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_PATH = path.join(os.homedir(), '.free-llm-api-provider.json');
const CONFIG_DIR = path.join(os.homedir(), '.config', 'free-llm-api-provider');
const BACKUP_DIR = path.join(os.homedir(), '.free-llm-api-provider.backups');

// Environment variable names per provider
const ENV_VARS = {
  nvidia: 'NVIDIA_API_KEY',
  groq: 'GROQ_API_KEY',
  cerebras: 'CEREBRAS_API_KEY',
  sambanova: 'SAMBANOVA_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  huggingface: ['HUGGINGFACE_API_KEY', 'HF_TOKEN'],
  replicate: 'REPLICATE_API_TOKEN',
  deepinfra: ['DEEPINFRA_API_KEY', 'DEEPINFRA_TOKEN'],
  fireworks: 'FIREWORKS_API_KEY',
  codestral: 'CODESTRAL_API_KEY',
  hyperbolic: 'HYPERBOLIC_API_KEY',
  scaleway: 'SCALEWAY_API_KEY',
  googleai: 'GOOGLE_API_KEY',
  siliconflow: 'SILICONFLOW_API_KEY',
  together: 'TOGETHER_API_KEY',
  cloudflare: ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY'],
  perplexity: ['PERPLEXITY_API_KEY', 'PPLX_API_KEY'],
  qwen: 'DASHSCOPE_API_KEY',
  zai: 'ZAI_API_KEY',
  iflow: 'IFLOW_API_KEY',
  chutes: 'CHUTES_API_KEY',
  ovhcloud: 'OVH_AI_ENDPOINTS_ACCESS_TOKEN',
};

// Default router settings
const DEFAULT_ROUTER_SETTINGS = Object.freeze({
  enabled: false,
  port: 19280,
  activeSet: 'fast-coding',
  probeMode: 'balanced',
  sets: {
    'fast-coding': {
      name: 'fast-coding',
      models: [],
      created: new Date().toISOString(),
    },
  },
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function _emptyConfig() {
  return {
    apiKeys: {},
    providers: {},
    favorites: [],
    telemetry: {
      enabled: null,
      consentVersion: 0,
      anonymousId: null,
    },
    settings: {
      hideUnconfiguredModels: true,
      theme: 'auto',
    },
    router: { ...DEFAULT_ROUTER_SETTINGS },
  };
}

function normalizeApiKeyValue(value) {
  if (Array.isArray(value)) {
    const normalized = [...new Set(value.filter(k => typeof k === 'string' && k.trim()))];
    if (normalized.length === 0) return null;
    if (normalized.length === 1) return normalized[0];
    return normalized;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeApiKeysSection(apiKeys) {
  if (!isPlainObject(apiKeys)) return {};
  const normalized = {};
  for (const [providerKey, value] of Object.entries(apiKeys)) {
    const normalizedValue = normalizeApiKeyValue(value);
    if (normalizedValue !== null) normalized[providerKey] = normalizedValue;
  }
  return normalized;
}

function normalizeProvidersSection(providers) {
  if (!isPlainObject(providers)) return {};
  const normalized = {};
  for (const [providerKey, value] of Object.entries(providers)) {
    if (typeof value === 'boolean') {
      normalized[providerKey] = { enabled: value !== false };
      continue;
    }
    if (!isPlainObject(value)) continue;
    normalized[providerKey] = { ...value, enabled: value.enabled !== false };
  }
  return normalized;
}

function normalizeFavoriteList(favorites) {
  if (!Array.isArray(favorites)) return [];
  return [...new Set(favorites.filter(f => typeof f === 'string' && f.trim()).map(f => f.trim()))];
}

function normalizeTelemetrySection(telemetry) {
  const safe = isPlainObject(telemetry) ? telemetry : {};
  return {
    enabled: typeof safe.enabled === 'boolean' ? safe.enabled : null,
    consentVersion: typeof safe.consentVersion === 'number' ? safe.consentVersion : 0,
    anonymousId: typeof safe.anonymousId === 'string' && safe.anonymousId.trim() ? safe.anonymousId : null,
  };
}

function normalizeSettingsSection(settings) {
  const safe = isPlainObject(settings) ? settings : {};
  return {
    hideUnconfiguredModels: typeof safe.hideUnconfiguredModels === 'boolean' ? safe.hideUnconfiguredModels : true,
    theme: ['dark', 'light', 'auto'].includes(safe.theme) ? safe.theme : 'auto',
  };
}

function normalizeRouterConfig(router) {
  if (!isPlainObject(router)) return { ...DEFAULT_ROUTER_SETTINGS };
  return {
    enabled: router.enabled === true,
    port: typeof router.port === 'number' && router.port > 0 && router.port <= 65535 ? router.port : DEFAULT_ROUTER_SETTINGS.port,
    activeSet: typeof router.activeSet === 'string' ? router.activeSet : DEFAULT_ROUTER_SETTINGS.activeSet,
    probeMode: ['eco', 'balanced', 'aggressive'].includes(router.probeMode) ? router.probeMode : DEFAULT_ROUTER_SETTINGS.probeMode,
    sets: isPlainObject(router.sets) ? router.sets : { ...DEFAULT_ROUTER_SETTINGS.sets },
  };
}

function normalizeConfigShape(config) {
  const safe = isPlainObject(config) ? config : {};
  return {
    apiKeys: normalizeApiKeysSection(safe.apiKeys),
    providers: normalizeProvidersSection(safe.providers),
    favorites: normalizeFavoriteList(safe.favorites),
    telemetry: normalizeTelemetrySection(safe.telemetry),
    settings: normalizeSettingsSection(safe.settings),
    router: normalizeRouterConfig(safe.router),
  };
}

function readStoredConfigSnapshot() {
  if (!fs.existsSync(CONFIG_PATH)) return _emptyConfig();
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8').trim();
    if (!raw) return _emptyConfig();
    return normalizeConfigShape(JSON.parse(raw));
  } catch {
    return _emptyConfig();
  }
}

// Backup functions
function createBackup() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return false;
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { mode: 0o700, recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, -5) + 'Z';
    const backupPath = path.join(BACKUP_DIR, `config.${timestamp}.json`);
    const content = fs.readFileSync(CONFIG_PATH, 'utf8');
    fs.writeFileSync(backupPath, content, { mode: 0o600 });
    
    // Keep only last 5 backups
    const backups = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('config.') && f.endsWith('.json'))
      .map(f => ({
        path: path.join(BACKUP_DIR, f),
        time: fs.statSync(path.join(BACKUP_DIR, f)).mtime.getTime(),
      }))
      .sort((a, b) => b.time - a.time);
    
    if (backups.length > 5) {
      for (const old of backups.slice(5)) {
        try { fs.unlinkSync(old.path); } catch {}
      }
    }
    return true;
  } catch (error) {
    console.error(`Warning: Backup creation failed: ${error.message}`);
    return false;
  }
}

function restoreFromBackup() {
  if (!fs.existsSync(BACKUP_DIR)) throw new Error('No backup directory');
  const backups = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('config.') && f.endsWith('.json'))
    .map(f => ({
      path: path.join(BACKUP_DIR, f),
      time: fs.statSync(path.join(BACKUP_DIR, f)).mtime.getTime(),
    }))
    .sort((a, b) => b.time - a.time);
  
  if (backups.length === 0) throw new Error('No backups available');
  const latest = fs.readFileSync(backups[0].path, 'utf8');
  JSON.parse(latest); // Validate
  fs.writeFileSync(CONFIG_PATH, latest, { mode: 0o600 });
}

// Main config functions
function loadConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8').trim();
      return normalizeConfigShape(JSON.parse(raw));
    } catch {
      return _emptyConfig();
    }
  }
  return _emptyConfig();
}

function saveConfig(config) {
  const backupCreated = createBackup();
  const tempPath = `${CONFIG_PATH}.tmp-${process.pid}-${Date.now()}`;
  
  try {
    const latest = readStoredConfigSnapshot();
    const merged = {
      ...latest,
      ...normalizeConfigShape(config),
      apiKeys: { ...latest.apiKeys, ...normalizeApiKeysSection(config.apiKeys) },
    };
    
    const json = JSON.stringify(merged, null, 2);
    fs.writeFileSync(tempPath, json, { mode: 0o600 });
    fs.renameSync(tempPath, CONFIG_PATH);
    
    // Verify
    try {
      const parsed = readStoredConfigSnapshot();
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Written config is not valid');
      }
      return { success: true, backupCreated };
    } catch (verifyError) {
      let errorMsg = `Config verification failed: ${verifyError.message}`;
      if (backupCreated) {
        try {
          restoreFromBackup();
          errorMsg += ' (Restored from backup)';
        } catch (e) {
          errorMsg += ` (Backup restore failed: ${e.message})`;
        }
      }
      return { success: false, error: errorMsg, backupCreated };
    }
  } catch (writeError) {
    let errorMsg = `Failed to write config: ${writeError.message}`;
    try { fs.unlinkSync(tempPath); } catch {}
    if (backupCreated) {
      try {
        restoreFromBackup();
        errorMsg += ' (Restored from backup)';
      } catch (e) {
        errorMsg += ` (Backup restore failed: ${e.message})`;
      }
    }
    return { success: false, error: errorMsg, backupCreated };
  }
}

function getApiKey(config, providerKey) {
  const envVar = ENV_VARS[providerKey];
  const candidates = Array.isArray(envVar) ? envVar : [envVar];
  for (const candidate of candidates) {
    if (candidate && process.env[candidate]) return process.env[candidate];
  }
  return config?.apiKeys?.[providerKey] || null;
}

function getAllApiKeys(config, providerKey) {
  const keys = [];
  
  // First check env vars
  const envVar = ENV_VARS[providerKey];
  const candidates = Array.isArray(envVar) ? envVar : [envVar];
  for (const candidate of candidates) {
    if (candidate && process.env[candidate]) {
      keys.push(process.env[candidate]);
    }
  }
  
  // Then check config (can be string or array)
  const configKeys = config?.apiKeys?.[providerKey];
  if (typeof configKeys === 'string') {
    keys.push(configKeys);
  } else if (Array.isArray(configKeys)) {
    keys.push(...configKeys);
  }
  
  return keys;
}

function isProviderEnabled(config, providerKey) {
  if (!config?.providers) return true;
  return config.providers[providerKey]?.enabled !== false;
}

function addApiKey(config, providerKey, key) {
  const trimmed = typeof key === 'string' ? key.trim() : '';
  if (!trimmed) return false;
  if (!config.apiKeys) config.apiKeys = {};
  const current = config.apiKeys[providerKey];
  if (!current) {
    config.apiKeys[providerKey] = trimmed;
    return true;
  }
  if (typeof current === 'string') {
    if (current === trimmed) return false;
    config.apiKeys[providerKey] = [current, trimmed];
    return true;
  }
  if (Array.isArray(current)) {
    if (current.includes(trimmed)) return false;
    current.push(trimmed);
    return true;
  }
  config.apiKeys[providerKey] = trimmed;
  return true;
}

function removeApiKey(config, providerKey) {
  if (!config.apiKeys) return false;
  const current = config.apiKeys[providerKey];
  if (!current) return false;
  delete config.apiKeys[providerKey];
  return true;
}

function listApiKeys(config, providerKey) {
  const raw = config?.apiKeys?.[providerKey];
  if (Array.isArray(raw)) return raw.filter(k => typeof k === 'string' && k.length > 0);
  if (typeof raw === 'string' && raw.length > 0) return [raw];
  return [];
}

function getEnabledProviders(config) {
  const enabled = [];
  for (const key of Object.keys(ENV_VARS)) {
    if (isProviderEnabled(config, key) && getApiKey(config, key)) {
      enabled.push(key);
    }
  }
  return enabled;
}

module.exports = {
  CONFIG_PATH,
  CONFIG_DIR,
  DEFAULT_ROUTER_SETTINGS,
  ENV_VARS,
  loadConfig,
  saveConfig,
  getApiKey,
  getAllApiKeys,
  isProviderEnabled,
  addApiKey,
  removeApiKey,
  listApiKeys,
  getEnabledProviders,
  normalizeConfigShape,
};
