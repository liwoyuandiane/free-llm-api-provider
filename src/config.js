/**
 * Config Manager
 * 
 * Replicated from free-coding-models src/config.js
 * Manages <project-root>/.data/config.json with API keys, provider states, and router settings.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getProviderKeys, addProviderKey, removeAllProviderKeys, isProviderEnabled: dbIsProviderEnabled, setProviderEnabled, getServerApiKey: dbGetServerApiKey, ensureServerApiKey: dbEnsureServerApiKey, getMeta, setMeta, encryptApiKey, decryptApiKey } = require('./db');

/** 项目根目录下的 .data 文件夹作为默认数据存储路径 */
const DATA_DIR_DEFAULT = path.resolve(__dirname, '..', '.data');

const CONFIG_PATH = process.env.DATA_DIR
  ? path.join(process.env.DATA_DIR, 'config.json')
  : path.join(DATA_DIR_DEFAULT, 'config.json');
const CONFIG_DIR = process.env.DATA_DIR || DATA_DIR_DEFAULT;
const BACKUP_DIR = path.join(process.env.DATA_DIR || DATA_DIR_DEFAULT, 'backups');

/** 配置文件内存缓存，500ms TTL 避免频繁磁盘读取 */
const CONFIG_CACHE_TTL = 500;
let _configCache = { data: null, ts: 0 };

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
  github: 'GITHUB_TOKEN',
  cohere: 'COHERE_API_KEY',
  reka: 'REKA_API_KEY',
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function _emptyConfig() {
  return {
    apiKeys: {},
    providers: {},
    generatedApiKey: null,
    settings: {
      hideUnconfiguredModels: true,
      theme: 'auto',
    },
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

function normalizeSettingsSection(settings) {
  const safe = isPlainObject(settings) ? settings : {};
  return {
    hideUnconfiguredModels: typeof safe.hideUnconfiguredModels === 'boolean' ? safe.hideUnconfiguredModels : true,
    theme: ['dark', 'light', 'auto'].includes(safe.theme) ? safe.theme : 'auto',
  };
}

function normalizeConfigShape(config) {
  const safe = isPlainObject(config) ? config : {};
  return {
    apiKeys: normalizeApiKeysSection(safe.apiKeys),
    providers: normalizeProvidersSection(safe.providers),
    generatedApiKey: typeof safe.generatedApiKey === 'string' && safe.generatedApiKey.startsWith('sk-') ? safe.generatedApiKey : null,
    settings: normalizeSettingsSection(safe.settings),
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
  const now = Date.now();
  if (_configCache.data && (now - _configCache.ts) < CONFIG_CACHE_TTL) {
    return _configCache.data;
  }
  _configCache.data = readStoredConfigSnapshot();
  _configCache.ts = Date.now();
  return _configCache.data;
}

function saveConfig(config) {
  _configCache = { data: null, ts: 0 }; // 立即失效缓存
  const backupCreated = createBackup();
  const tempPath = `${CONFIG_PATH}.tmp-${process.pid}-${Date.now()}`;
  
  try {
    const latest = readStoredConfigSnapshot();
    const merged = {
      ...latest,
      ...normalizeConfigShape(config),
      apiKeys: { ...latest.apiKeys, ...normalizeApiKeysSection(config.apiKeys) },
    };

    // 加密明文 apiKeys 后再写入磁盘（config.json 只存储密文）
    for (const [provider, keys] of Object.entries(merged.apiKeys)) {
      if (Array.isArray(keys)) {
        merged.apiKeys[provider] = keys.map(k => {
          if (typeof k === 'string' && k.trim()) {
            const encrypted = encryptApiKey(k);
            if (!encrypted) { console.error('[Config] 加密失败，Key 未写入备份:', provider); return null; }
            try { return JSON.parse(encrypted); } catch { return null; }
          }
          return k; // 已为加密对象 {iv, tag, data}，无需重复加密
        }).filter(k => k !== null); // 过滤掉加密失败的 Key
      } else if (typeof keys === 'string' && keys.trim()) {
        const encrypted = encryptApiKey(keys);
        if (encrypted) try { merged.apiKeys[provider] = JSON.parse(encrypted); } catch {}
      }
    }

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
  // 1. Check env vars (highest priority)
  const envVar = ENV_VARS[providerKey];
  const candidates = Array.isArray(envVar) ? envVar : [envVar];
  for (const candidate of candidates) {
    if (candidate && process.env[candidate]) return process.env[candidate];
  }

  // 2. Check SQLite database
  const dbKeys = getProviderKeys(providerKey);
  if (dbKeys.length > 0) return dbKeys[0].key;

  // 3. Check JSON config (legacy)
  const jsonKey = config?.apiKeys?.[providerKey] || null;
  if (jsonKey) {
    // Config.json 存储加密密钥，需要解密
    if (typeof jsonKey === 'string' && jsonKey.trim()) return decryptApiKey(jsonKey);
    if (typeof jsonKey === 'object' && jsonKey.iv) return decryptApiKey(jsonKey);
    if (Array.isArray(jsonKey) && jsonKey.length > 0) {
      const first = jsonKey[0];
      if (typeof first === 'string' && first.trim()) return decryptApiKey(first);
      if (typeof first === 'object' && first.iv) return decryptApiKey(first);
    }
  }
  return null;
}

function getAllApiKeys(config, providerKey) {
  const keys = [];

  // 1. Check env vars (highest priority)
  const envVar = ENV_VARS[providerKey];
  const candidates = Array.isArray(envVar) ? envVar : [envVar];
  for (const candidate of candidates) {
    if (candidate && process.env[candidate]) {
      keys.push(process.env[candidate]);
    }
  }

  // 2. Check SQLite database
  const dbKeys = getProviderKeys(providerKey);
  for (const entry of dbKeys) {
    if (!keys.includes(entry.key)) keys.push(entry.key);
  }

  // 3. Check JSON config (legacy) — 需要解密存储的加密密钥
  const configKeys = config?.apiKeys?.[providerKey];
  if (configKeys) {
    const processKey = (k) => {
      if (typeof k === 'string' && k.trim()) return decryptApiKey(k);
      if (typeof k === 'object' && k && k.iv) return decryptApiKey(k);
      return null;
    };
    if (typeof configKeys === 'string' || (typeof configKeys === 'object' && configKeys.iv)) {
      const decrypted = processKey(configKeys);
      if (decrypted && !keys.includes(decrypted)) keys.push(decrypted);
    } else if (Array.isArray(configKeys)) {
      for (const k of configKeys) {
        const decrypted = processKey(k);
        if (decrypted && !keys.includes(decrypted)) keys.push(decrypted);
      }
    }
  }

  return keys;
}

function isProviderEnabled(config, providerKey) {
  // Check SQLite first
  try { return dbIsProviderEnabled(providerKey); } catch {}

  // Fall back to JSON config
  if (!config?.providers) return true;
  return config.providers[providerKey]?.enabled !== false;
}

function addApiKey(config, providerKey, key, notes) {
  const trimmed = typeof key === 'string' ? key.trim() : '';
  if (!trimmed) return false;

  // Write to SQLite (with optional notes)
  try { addProviderKey(providerKey, trimmed, notes || ''); } catch {}

  // Also write to JSON config for backward compatibility
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
  // Remove from SQLite
  try { removeAllProviderKeys(providerKey); } catch {}

  // Also remove from JSON config
  if (!config.apiKeys) return false;
  const current = config.apiKeys[providerKey];
  if (!current) return false;
  delete config.apiKeys[providerKey];
  return true;
}

function listApiKeys(config, providerKey) {
  // Prefer SQLite
  try {
    const dbKeys = getProviderKeys(providerKey);
    if (dbKeys.length > 0) return dbKeys;
  } catch {}

  // Fall back to JSON config
  const raw = config?.apiKeys?.[providerKey];
  if (Array.isArray(raw)) return raw.filter(k => typeof k === 'string' && k.length > 0);
  if (typeof raw === 'string' && raw.length > 0) return [raw];
  return [];
}

function getEnabledProviders(config) {
  const enabled = [];
  const { sources } = require('./models');
  for (const key of Object.keys(sources)) {
    const src = sources[key];
    // Skip zen-only, CLI-only, and shutdown providers
    if (src?.zenOnly || src?.cliOnly || !src?.url) continue;
    if (!isProviderEnabled(config, key)) continue;
    // No-key-required providers (Pollinations, LLM7) are always enabled
    if (src?.noKeyRequired) { enabled.push(key); continue; }
    // Normal providers need an API key
    if (getApiKey(config, key)) enabled.push(key);
  }
  return enabled;
}

// ============================================================================
// Server API Key management (delegates to SQLite)
// ============================================================================

function generateServerApiKey() {
  const random = crypto.randomBytes(32).toString('hex');
  return 'sk-' + random;
}

function getServerApiKey(config) {
  // Priority: env var > SQLite > JSON config > auto-generate
  const envKey = process.env.FLAP_API_KEY;
  if (envKey && envKey.startsWith('sk-')) return envKey;
  try {
    const dbKey = dbGetServerApiKey();
    if (dbKey && dbKey.startsWith('sk-')) return dbKey;
  } catch (err) {
    console.warn('[Config] dbGetServerApiKey 失败:', err.message);
  }
  if (config && config.generatedApiKey && config.generatedApiKey.startsWith('sk-')) return config.generatedApiKey;
  const generated = generateServerApiKey();
  try { dbEnsureServerApiKey(generated); } catch (err) {
    console.warn('[Config] 持久化服务器 API Key 失败:', err.message);
  }
  console.warn('[Config] 未配置 FLAP_API_KEY，已自动生成服务器 API Key');
  return generated;
}

function ensureServerApiKey(config) {
  try { return dbEnsureServerApiKey(); } catch {}
  // Fallback to JSON config logic
  if (process.env.FLAP_API_KEY) return process.env.FLAP_API_KEY;
  if (config.generatedApiKey && config.generatedApiKey.startsWith('sk-')) return config.generatedApiKey;
  const newKey = generateServerApiKey();
  config.generatedApiKey = newKey;
  saveConfig(config);
  return newKey;
}

module.exports = {
  CONFIG_PATH,
  CONFIG_DIR,
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
  generateServerApiKey,
  getServerApiKey,
  ensureServerApiKey,
};
