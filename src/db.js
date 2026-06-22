/**
 * SQLite Database Manager
 *
 * Uses Node.js built-in `node:sqlite` (available in Node 22.5+).
 * Zero external dependencies. Stores all data in ~/.free-llm-api-provider/data.db
 */

const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// ============================================================================
// Paths — DATA_DIR env var overrides default ~/.free-llm-api-provider
// ============================================================================
const DB_DIR = process.env.DATA_DIR || path.join(os.homedir(), '.free-llm-api-provider');
const DB_PATH = path.join(DB_DIR, 'data.db');
const CONFIG_PATH = process.env.DATA_DIR
  ? path.join(process.env.DATA_DIR, 'config.json')
  : path.join(os.homedir(), '.free-llm-api-provider.json');

// ============================================================================
// Singleton
// ============================================================================
let db = null;

// Initialize database on module load
getDb();

// ============================================================================
// Password hashing (using Node.js built-in crypto.scryptSync)
// ============================================================================
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(password, stored) {
  const parts = stored.split(':');
  if (parts.length !== 2) return false;
  const [salt, hash] = parts;
  const verify = crypto.scryptSync(password, salt, 64).toString('hex');
  // Constant-time comparison
  if (hash.length !== verify.length) return false;
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(verify));
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ============================================================================
// Initialize and get database
// ============================================================================
function getDb() {
  if (db) return db;

  // Ensure directory exists
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { mode: 0o700, recursive: true });
  }

  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode=WAL');
  db.exec('PRAGMA busy_timeout=5000');
  // Periodic WAL checkpoint to keep WAL file slim
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch {}

  createTables();
  migrateFromJson();

  return db;
}

function createTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      provider TEXT NOT NULL,
      api_key TEXT NOT NULL,
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(provider, api_key)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS provider_settings (
      provider TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1,
      test_model TEXT DEFAULT ''
    )
  `);

  // Model tiers (manual assignment for discovered/static models)
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_tiers (
      model_id TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT '',
      tier TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (model_id, provider)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS discovered_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      model_id TEXT NOT NULL,
      owned_by TEXT DEFAULT '',
      discovered_at TEXT DEFAULT (datetime('now')),
      UNIQUE(provider, model_id)
    )
  `);

  // Model enable/disable tracking (for both static catalog and discovered models)
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_states (
      model_id TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (model_id, provider)
    )
  `);

  // Custom providers
  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_providers (
      name TEXT PRIMARY KEY,
      base_url TEXT NOT NULL,
      api_key TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_provider_models (
      provider_name TEXT NOT NULL,
      model_id TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      UNIQUE(provider_name, model_id)
    )
  `);

  // Rate limit tracking (per-key, per-minute, per-day)
  db.exec(`
    CREATE TABLE IF NOT EXISTS rate_limits (
      provider TEXT NOT NULL,
      api_key TEXT NOT NULL,
      bucket TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (provider, api_key, bucket)
    )
  `);

  // Cooldown tracking (per provider key)
  db.exec(`
    CREATE TABLE IF NOT EXISTS cooldowns (
      provider TEXT NOT NULL,
      api_key TEXT NOT NULL,
      until INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (provider, api_key)
    )
  `);
}

// ============================================================================
// Migrate from JSON config file to SQLite
// ============================================================================
function migrateFromJson() {
  // Add test_model column to existing provider_settings table
  try { db.exec('ALTER TABLE provider_settings ADD COLUMN test_model TEXT DEFAULT \'\''); } catch {}
  // Add notes column to existing api_keys table
  try { db.exec('ALTER TABLE api_keys ADD COLUMN notes TEXT DEFAULT \'\''); } catch {}

  // Skip if already migrated
  const migrated = db.prepare("SELECT value FROM meta WHERE key = 'migrated'").get();
  if (migrated) return;

  // Check if JSON config exists
  if (!fs.existsSync(CONFIG_PATH)) {
    // Mark as migrated (nothing to migrate)
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('migrated', '1')").run();
    return;
  }

  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8').trim();
    if (!raw) {
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('migrated', '1')").run();
      return;
    }

    const config = JSON.parse(raw);

    // Migrate generatedApiKey
    if (config.generatedApiKey) {
      const existing = db.prepare("SELECT value FROM meta WHERE key = 'generated_api_key'").get();
      if (!existing) {
        db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('generated_api_key', ?)").run(config.generatedApiKey);
      }
    }

    // Migrate API keys
    if (config.apiKeys && typeof config.apiKeys === 'object') {
      const insertKey = db.prepare('INSERT OR IGNORE INTO api_keys (provider, api_key) VALUES (?, ?)');
      for (const [provider, keys] of Object.entries(config.apiKeys)) {
        const keyList = Array.isArray(keys) ? keys : [keys];
        for (const key of keyList) {
          if (typeof key === 'string' && key.trim()) {
            insertKey.run(provider, key.trim());
          }
        }
      }
    }

    // Migrate provider settings
    if (config.providers && typeof config.providers === 'object') {
      const upsert = db.prepare('INSERT OR REPLACE INTO provider_settings (provider, enabled) VALUES (?, ?)');
      for (const [provider, settings] of Object.entries(config.providers)) {
        const enabled = settings && settings.enabled !== false ? 1 : 0;
        upsert.run(provider, enabled);
      }
    }

    // Mark as migrated
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('migrated', '1')").run();
    console.log('[DB] Migrated config from ' + CONFIG_PATH);
  } catch (err) {
    console.error('[DB] Migration error:', err.message);
    // Mark as migrated anyway to avoid repeated attempts
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('migrated', '1')").run();
  }
}

// ============================================================================
// Admin user management
// ============================================================================
function ensureAdminUser() {
  const existing = db.prepare('SELECT id FROM admin_users LIMIT 1').get();
  if (existing) return null; // Already has an admin user

  const envPassword = process.env.FLAP_ADMIN_PASSWORD;
  let password;

  if (envPassword && envPassword.length >= 6) {
    password = envPassword;
    console.log('[DB] Admin user configured via FLAP_ADMIN_PASSWORD environment variable');
  } else {
    password = generateToken().substring(0, 16);
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║           Admin Panel - Initial Setup                       ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log('║  Username: admin                                            ║');
    console.log('║  Password: ' + password.padEnd(46) + '║');
    console.log('║                                                              ║');
    console.log('║  Set FLAP_ADMIN_PASSWORD env var to customize.              ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');
  }

  const hash = hashPassword(password);
  db.prepare('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)').run('admin', hash);

  return { username: 'admin', password };
}

function verifyAdminLogin(username, password) {
  const user = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username);
  if (!user) return null;
  if (!verifyPassword(password, user.password_hash)) return null;
  return { id: user.id, username: user.username };
}

// ============================================================================
// Session management
// ============================================================================
function createSession(username) {
  // Clean expired sessions
  db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();

  const token = generateToken();
  // Sessions expire after 24 hours
  db.prepare(
    "INSERT INTO sessions (id, username, expires_at) VALUES (?, ?, datetime('now', '+24 hours'))"
  ).run(token, username);

  return token;
}

function validateSession(token) {
  if (!token) return null;
  const session = db.prepare(
    "SELECT * FROM sessions WHERE id = ? AND expires_at > datetime('now')"
  ).get(token);
  return session || null;
}

function deleteSession(token) {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(token);
}

// ============================================================================
// API Key management
// ============================================================================
function getProviderKeys(provider) {
  const rows = db.prepare('SELECT api_key, notes FROM api_keys WHERE provider = ? ORDER BY rowid').all(provider);
  return rows.map(r => ({ key: r.api_key, notes: r.notes || '' }));
}

function getAllProviderKeys() {
  const rows = db.prepare('SELECT provider, api_key, notes FROM api_keys ORDER BY provider, rowid').all();
  const result = {};
  for (const row of rows) {
    if (!result[row.provider]) result[row.provider] = [];
    result[row.provider].push({ key: row.api_key, notes: row.notes || '' });
  }
  return result;
}

function addProviderKey(provider, apiKey, notes) {
  try {
    db.prepare('INSERT OR IGNORE INTO api_keys (provider, api_key, notes) VALUES (?, ?, ?)').run(provider, apiKey, notes || '');
    return true;
  } catch {
    return false;
  }
}

function updateProviderKeyNotes(provider, apiKey, notes) {
  db.prepare('UPDATE api_keys SET notes = ? WHERE provider = ? AND api_key = ?').run(notes || '', provider, apiKey);
}

function removeProviderKey(provider, apiKey) {
  db.prepare('DELETE FROM api_keys WHERE provider = ? AND api_key = ?').run(provider, apiKey);
}

function removeAllProviderKeys(provider) {
  db.prepare('DELETE FROM api_keys WHERE provider = ?').run(provider);
}

// ============================================================================
// Provider settings
// ============================================================================
function isProviderEnabled(provider) {
  const row = db.prepare('SELECT enabled FROM provider_settings WHERE provider = ?').get(provider);
  if (!row) return true; // Default: enabled
  return row.enabled === 1;
}

function setProviderEnabled(provider, enabled) {
  db.prepare('INSERT OR REPLACE INTO provider_settings (provider, enabled) VALUES (?, ?)').run(provider, enabled ? 1 : 0);
}

function getAllProviderSettings() {
  const rows = db.prepare('SELECT * FROM provider_settings').all();
  const result = {};
  for (const row of rows) {
    result[row.provider] = { enabled: row.enabled === 1, testModel: row.test_model || '' };
  }
  return result;
}

function getProviderTestModel(provider) {
  const row = db.prepare('SELECT test_model FROM provider_settings WHERE provider = ?').get(provider);
  return row ? (row.test_model || '') : '';
}

function setProviderTestModel(provider, testModel) {
  db.prepare('INSERT OR REPLACE INTO provider_settings (provider, enabled, test_model) VALUES (?, COALESCE((SELECT enabled FROM provider_settings WHERE provider = ?), 1), ?)').run(provider, provider, testModel || '');
}

// ============================================================================
// Meta (key-value store)
// ============================================================================
function getMeta(key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setMeta(key, value) {
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value);
}

// ============================================================================
// Server API key
// ============================================================================
function getServerApiKey() {
  // First check env var
  const envKey = process.env.FLAP_API_KEY;
  if (envKey && envKey.startsWith('sk-')) return envKey;

  // Then check DB
  const dbKey = getMeta('generated_api_key');
  if (dbKey) return dbKey;

  // Then check JSON config (legacy)
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8').trim();
      if (raw) {
        const config = JSON.parse(raw);
        if (config.generatedApiKey) {
          // Sync to DB
          setMeta('generated_api_key', config.generatedApiKey);
          return config.generatedApiKey;
        }
      }
    }
  } catch {}

  return 'sk-free-llm-api-provider';
}

function ensureServerApiKey() {
  const envKey = process.env.FLAP_API_KEY;
  if (envKey && envKey.startsWith('sk-')) return envKey;

  const existing = getMeta('generated_api_key');
  if (existing) return existing;

  return doGenerateServerApiKey();
}

/**
 * Force-regenerate the server API key and save to both SQLite and JSON config.
 */
function regenerateServerApiKey() {
  const envKey = process.env.FLAP_API_KEY;
  if (envKey && envKey.startsWith('sk-')) return envKey;
  return doGenerateServerApiKey();
}

function doGenerateServerApiKey() {
  const token = generateToken();
  const newKey = 'sk-' + token;
  setMeta('generated_api_key', newKey);

  // Also write to JSON config for backward compatibility
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
      const config = JSON.parse(raw);
      config.generatedApiKey = newKey;
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
    }
  } catch {}

  return newKey;
}

// ============================================================================
// Discovered models
// ============================================================================
function saveDiscoveredModels(provider, models) {
  const insert = db.prepare('INSERT OR IGNORE INTO discovered_models (provider, model_id, owned_by) VALUES (?, ?, ?)');
  const enable = db.prepare('INSERT OR IGNORE INTO model_states (model_id, provider, enabled) VALUES (?, ?, 1)');
  const tx = db.prepare('BEGIN');
  const commit = db.prepare('COMMIT');
  try {
    tx.run();
    for (const m of models) {
      insert.run(provider, m.id, m.owned_by || '');
      enable.run(m.id, provider);
    }
    commit.run();
  } catch {
    db.prepare('ROLLBACK').run();
  }
}

function getDiscoveredModels() {
  const rows = db.prepare('SELECT * FROM discovered_models ORDER BY provider, model_id').all();
  return rows.map(r => ({
    id: r.model_id,
    provider: r.provider,
    owned_by: r.owned_by,
    discoveredAt: r.discovered_at,
  }));
}

function getDiscoveredModelsByProvider(provider) {
  return db.prepare('SELECT model_id, owned_by FROM discovered_models WHERE provider = ? ORDER BY model_id').all(provider);
}

// ============================================================================
// Model enable/disable states
// ============================================================================
function setModelEnabled(modelId, provider, enabled) {
  db.prepare('INSERT OR REPLACE INTO model_states (model_id, provider, enabled) VALUES (?, ?, ?)').run(modelId, provider || '', enabled ? 1 : 0);
}

function isModelEnabled(modelId, provider) {
  const row = db.prepare('SELECT enabled FROM model_states WHERE model_id = ? AND provider = ?').get(modelId, provider || '');
  if (!row) return true; // Default: enabled
  return row.enabled === 1;
}

function getDisabledModels(provider) {
  // Returns list of model IDs that are disabled for this provider
  const disabled = db.prepare('SELECT model_id FROM model_states WHERE provider = ? AND enabled = 0').all(provider || '');
  return disabled.map(r => r.model_id);
}

function getAllModelStates() {
  const rows = db.prepare('SELECT * FROM model_states').all();
  const result = {};
  for (const row of rows) {
    const key = row.provider ? row.provider + '/' + row.model_id : row.model_id;
    result[key] = row.enabled === 1;
  }
  return result;
}

// ============================================================================
// Model tier assignment
// ============================================================================
function setModelTier(modelId, provider, tier) {
  db.prepare('INSERT OR REPLACE INTO model_tiers (model_id, provider, tier) VALUES (?, ?, ?)').run(modelId, provider || '', tier || '');
}

function getModelTier(modelId, provider) {
  const row = db.prepare('SELECT tier FROM model_tiers WHERE model_id = ? AND provider = ?').get(modelId, provider || '');
  return row ? row.tier : '';
}

function getAllModelTiers() {
  const rows = db.prepare('SELECT * FROM model_tiers').all();
  const result = {};
  for (const row of rows) {
    const key = row.provider ? row.provider + '/' + row.model_id : row.model_id;
    result[key] = row.tier;
  }
  return result;
}

function getModelsWithTier(provider) {
  return db.prepare("SELECT model_id, tier FROM model_tiers WHERE provider = ? AND tier != '' ORDER BY model_id").all(provider);
}

// ============================================================================
// Custom providers
// ============================================================================
function getCustomProviders() {
  return db.prepare('SELECT * FROM custom_providers ORDER BY name').all();
}

function getCustomProvider(name) {
  return db.prepare('SELECT * FROM custom_providers WHERE name = ?').get(name);
}

function saveCustomProvider(name, baseUrl, apiKey) {
  db.prepare('INSERT OR REPLACE INTO custom_providers (name, base_url, api_key) VALUES (?, ?, ?)').run(name, baseUrl, apiKey || '');
}

function deleteCustomProvider(name) {
  db.prepare('DELETE FROM custom_providers WHERE name = ?').run(name);
  db.prepare('DELETE FROM custom_provider_models WHERE provider_name = ?').run(name);
  db.prepare('DELETE FROM discovered_models WHERE provider = ?').run(name);
  db.prepare('DELETE FROM model_states WHERE provider = ?').run(name);
}

function setCustomProviderEnabled(name, enabled) {
  db.prepare('UPDATE custom_providers SET enabled = ? WHERE name = ?').run(enabled ? 1 : 0, name);
}

function getCustomProviderModels(providerName) {
  return db.prepare('SELECT * FROM custom_provider_models WHERE provider_name = ? ORDER BY model_id').all(providerName);
}

function saveCustomProviderModel(providerName, modelId, enabled) {
  db.prepare('INSERT OR REPLACE INTO custom_provider_models (provider_name, model_id, enabled) VALUES (?, ?, ?)').run(providerName, modelId, enabled !== false ? 1 : 0);
}

function deleteCustomProviderModel(providerName, modelId) {
  db.prepare('DELETE FROM custom_provider_models WHERE provider_name = ? AND model_id = ?').run(providerName, modelId);
}

// ============================================================================
// Password change
// ============================================================================
function changeAdminPassword(username, newPassword) {
  const hash = hashPassword(newPassword);
  db.prepare('UPDATE admin_users SET password_hash = ? WHERE username = ?').run(hash, username);
  return true;
}

// ============================================================================
// Rate limiting (per-key RPM / RPD)
// ============================================================================

// Provider default rate limits (RPM = requests per minute, RPD = requests per day)
const PROVIDER_LIMITS = {
  nvidia: { rpm: 40, rpd: 57600 },
  groq: { rpm: 30, rpd: 14400 },
  cerebras: { rpm: 30, rpd: 1000000 },
  sambanova: { rpm: 30, rpd: 10000 },
  openrouter: { rpm: 50, rpd: 1000 },
  huggingface: { rpm: 30, rpd: 5000 },
  replicate: { rpm: 6, rpd: 1000 },
  deepinfra: { rpm: 30, rpd: 5000 },
  fireworks: { rpm: 30, rpd: 5000 },
  codestral: { rpm: 30, rpd: 2000 },
  hyperbolic: { rpm: 30, rpd: 5000 },
  scaleway: { rpm: 30, rpd: 5000 },
  googleai: { rpm: 30, rpd: 14400 },
  siliconflow: { rpm: 100, rpd: 100 },
  together: { rpm: 30, rpd: 5000 },
  cloudflare: { rpm: 50, rpd: 10000 },
  perplexity: { rpm: 50, rpd: 1000 },
  qwen: { rpm: 30, rpd: 5000 },
  zai: { rpm: 30, rpd: 10000 },
  iflow: { rpm: 30, rpd: 5000 },
  chutes: { rpm: 10, rpd: 1000 },
  ovhcloud: { rpm: 10, rpd: 400 },
};

function getProviderLimits(provider) {
  return PROVIDER_LIMITS[provider] || { rpm: 30, rpd: 5000 };
}

function getRateLimitBucket() {
  const now = Date.now();
  const min = Math.floor(now / 60000);
  const day = Math.floor(now / 86400000);
  return { min: 'min_' + min, day: 'day_' + day };
}

function recordRateLimit(provider, apiKey) {
  const b = getRateLimitBucket();
  try {
    const upsert = (bucket) => {
      const existing = db.prepare('SELECT count FROM rate_limits WHERE provider=? AND api_key=? AND bucket=?').get(provider, apiKey, bucket);
      if (existing) {
        db.prepare('UPDATE rate_limits SET count = count + 1 WHERE provider=? AND api_key=? AND bucket=?').run(provider, apiKey, bucket);
      } else {
        db.prepare('INSERT INTO rate_limits (provider, api_key, bucket, count) VALUES (?, ?, ?, 1)').run(provider, apiKey, bucket);
      }
    };
    upsert(b.min);
    upsert(b.day);
    return true;
  } catch { return false; }
}

function isRateLimited(provider, apiKey) {
  try {
    const b = getRateLimitBucket();
    const limits = getProviderLimits(provider);

    // Check cooldown first
    const cd = db.prepare('SELECT until FROM cooldowns WHERE provider=? AND api_key=?').get(provider, apiKey);
    if (cd && cd.until > Date.now()) return true;

    const minRow = db.prepare('SELECT count FROM rate_limits WHERE provider=? AND api_key=? AND bucket=?').get(provider, apiKey, b.min);
    const dayRow = db.prepare('SELECT count FROM rate_limits WHERE provider=? AND api_key=? AND bucket=?').get(provider, apiKey, b.day);
    
    if (minRow && minRow.count >= limits.rpm) return true;
    if (dayRow && dayRow.count >= limits.rpd) return true;
    return false;
  } catch { return false; }
}

function setCooldown(provider, apiKey, ms) {
  try {
    db.prepare('INSERT OR REPLACE INTO cooldowns (provider, api_key, until) VALUES (?, ?, ?)').run(provider, apiKey, Date.now() + ms);
  } catch {}
}

function cleanRateLimits() {
  try {
    const day = Math.floor(Date.now() / 86400000);
    // Remove old minute buckets (>60 min old)
    db.prepare("DELETE FROM rate_limits WHERE bucket LIKE 'min\\_%' AND bucket < ?").run('min_' + Math.floor(Date.now() / 60000 - 60));
    // Remove old day buckets (>2 days old)
    db.prepare("DELETE FROM rate_limits WHERE bucket LIKE 'day\\_%' AND bucket < ?").run('day_' + (day - 2));
    // Remove expired cooldowns
    db.prepare('DELETE FROM cooldowns WHERE until < ?').run(Date.now());
  } catch {}
}

// ============================================================================
// Sticky sessions (in-memory cache with DB persistence)
// ============================================================================
const stickySessions = new Map(); // sessionId -> { provider, key, name, expires }
const STICKY_TTL = 30 * 60 * 1000; // 30 minutes

function getStickyProvider(sessionId) {
  const entry = stickySessions.get(sessionId);
  if (!entry) return null;
  if (Date.now() > entry.expires) { stickySessions.delete(sessionId); return null; }
  return entry;
}

function setStickyProvider(sessionId, provider) {
  stickySessions.set(sessionId, { ...provider, expires: Date.now() + STICKY_TTL });
}

// ============================================================================
// Vision-capable models
// ============================================================================
const VISION_MODEL_PREFIXES = [
  'gemma-', 'gemini-', 'llama-4', 'qwen/qwen3', 'kimi', 'glm-4.6v',
  'nemotron-nano-12b-vl', 'gpt-4o', 'gpt-4.1', 'claude-3',
];

function isVisionModel(modelId) {
  const id = modelId.toLowerCase();
  return VISION_MODEL_PREFIXES.some(pref => id.includes(pref));
}

// ============================================================================
// Initialize
// ============================================================================
function initDatabase() {
  getDb();
  const adminInfo = ensureAdminUser();
  const apiKey = ensureServerApiKey();
  // Clean old rate limit data
  cleanRateLimits();
  return { adminInfo, apiKey };
}

// ============================================================================
// Cleanup
// ============================================================================
function closeDb() {
  if (db) {
    try { db.close(); } catch {}
    db = null;
  }
}

// ============================================================================
// Exports
// ============================================================================
module.exports = {
  initDatabase,
  closeDb,
  getServerApiKey,
  ensureServerApiKey,
  regenerateServerApiKey,
  getProviderKeys,
  getAllProviderKeys,
  addProviderKey,
  updateProviderKeyNotes,
  removeProviderKey,
  removeAllProviderKeys,
  isProviderEnabled,
  setProviderEnabled,
  getAllProviderSettings,
  verifyAdminLogin,
  createSession,
  validateSession,
  deleteSession,
  saveDiscoveredModels,
  getDiscoveredModels,
  getDiscoveredModelsByProvider,
  getMeta,
  setMeta,
  setModelEnabled,
  isModelEnabled,
  getDisabledModels,
  getAllModelStates,
  getCustomProviders,
  getCustomProvider,
  saveCustomProvider,
  deleteCustomProvider,
  setCustomProviderEnabled,
  getCustomProviderModels,
  saveCustomProviderModel,
  deleteCustomProviderModel,
  changeAdminPassword,
  getProviderTestModel,
  setProviderTestModel,
  setModelTier,
  getModelTier,
  getAllModelTiers,
  getModelsWithTier,
  recordRateLimit,
  isRateLimited,
  setCooldown,
  cleanRateLimits,
  getProviderLimits,
  getStickyProvider,
  setStickyProvider,
  isVisionModel,
};
