/**
 * SQLite Database Manager
 *
 * Uses Node.js built-in `node:sqlite` (available in Node 22.5+).
 * Zero external dependencies. Stores all data in <project-root>/.data/
 */

const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ============================================================================
// AES-256-GCM Encryption configuration for API Key storage
// ============================================================================
/** AES-256-GCM 加密算法标识 */
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
/** GCM 认证标签长度（16 字节） */
const ENCRYPTION_AUTH_TAG_LENGTH = 16;

// ============================================================================
// Paths — DATA_DIR env var overrides default <project-root>/.data
// ============================================================================
/** 项目根目录下的 .data 文件夹作为默认数据存储路径 */
const DATA_DIR_DEFAULT = path.resolve(__dirname, '..', '.data');
const DB_DIR = process.env.DATA_DIR || DATA_DIR_DEFAULT;
const DB_PATH = path.join(DB_DIR, 'data.db');
const CONFIG_PATH = process.env.DATA_DIR
  ? path.join(process.env.DATA_DIR, 'config.json')
  : path.join(DATA_DIR_DEFAULT, 'config.json');
const ENV_PATH = path.join(DB_DIR, '.env');

// ============================================================================
// .env file loader — loads .data/.env into process.env
// ============================================================================

/**
 * 从 .data/.env 文件加载环境变量到 process.env。
 * 格式：KEY=VALUE，# 开头为注释，空行忽略。
 * 不覆盖已有的环境变量（环境变量优先级最高）。
 */
function loadEnvFile() {
  try {
    if (!fs.existsSync(ENV_PATH)) return;
    const content = fs.readFileSync(ENV_PATH, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 1) continue;
      const key = trimmed.substring(0, eqIdx).trim();
      const value = trimmed.substring(eqIdx + 1).trim();
      // 不覆盖已有的环境变量
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch (err) {
    // .env 文件不存在或读取失败，忽略
  }
}

/**
 * 将环境变量写入 .data/.env 文件。
 * @param {string} key - 环境变量名
 * @param {string} value - 值
 */
function saveEnvVar(key, value) {
  try {
    let lines = [];
    if (fs.existsSync(ENV_PATH)) {
      lines = fs.readFileSync(ENV_PATH, 'utf8').split('\n');
    }
    // 查找已有的 key
    let found = false;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith(key + '=')) {
        lines[i] = key + '=' + value;
        found = true;
        break;
      }
    }
    if (!found) {
      lines.push(key + '=' + value);
    }
    fs.writeFileSync(ENV_PATH, lines.join('\n'), 'utf8');
    process.env[key] = value;
  } catch (err) {
    console.warn('[DB] 写入 .env 文件失败:', err.message);
  }
}

// Load .env file at module startup
loadEnvFile();

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
// AES-256-GCM Encryption for API Keys
// ============================================================================

/**
 * 获取或创建加密密钥。
 * - 优先从环境变量 ENCRYPTION_KEY 读取（包括 .data/.env 中的）
 * - 其次从 meta 表读取（兼容旧数据）
 * - 如果都没有，生成新密钥并保存到 .data/.env 文件
 * @returns {Buffer} 32 字节的加密密钥
 */
function getOrCreateEncryptionKey() {
  // 优先使用环境变量中的密钥（.data/.env 已在模块加载时读入 process.env）
  const envKey = process.env.ENCRYPTION_KEY;
  if (envKey) {
    if (!/^[0-9a-f]{64}$/i.test(envKey)) {
      console.warn('[DB] ENCRYPTION_KEY 格式错误，需要 64 个 hex 字符（32 字节）');
    } else {
      return Buffer.from(envKey, 'hex');
    }
  }

  // 兼容旧数据：从 meta 表读取已有密钥
  let stored = getMeta('encryption_key');
  if (stored) {
    // 迁移到 .env 文件
    saveEnvVar('ENCRYPTION_KEY', stored);
    console.log('[DB] 加密密钥已从数据库迁移到 .env 文件');
    return Buffer.from(stored, 'hex');
  }

  // 生成新密钥并保存到 .env 文件
  const keyHex = crypto.randomBytes(32).toString('hex');
  saveEnvVar('ENCRYPTION_KEY', keyHex);
  console.log('[DB] 已生成新的 AES-256-GCM 加密密钥，保存到 .env 文件');
  return Buffer.from(keyHex, 'hex');
}

/**
 * 使用 AES-256-GCM 加密 API Key。
 * 生成随机 16 字节 IV，加密后返回 JSON 字符串。
 * 加密失败时返回 null（不降级到明文）。
 * @param {string} plaintext - 明文 API Key
 * @returns {string|null} JSON 格式密文，加密失败返回 null
 */
function encryptApiKey(plaintext) {
  if (!plaintext) return plaintext;
  try {
    const key = getOrCreateEncryptionKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv, { authTagLength: ENCRYPTION_AUTH_TAG_LENGTH });
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    return JSON.stringify({ iv: iv.toString('hex'), tag, data: encrypted });
  } catch (err) {
    console.error('[DB] 加密 API Key 失败:', err.message);
    return null;
  }
}

/**
 * 解密 AES-256-GCM 加密的 API Key。
 * 输入为 JSON 字符串 { iv, tag, data }，均为 hex 编码。
 * 如果输入不是有效 JSON 格式，视为旧明文数据直接返回。
 * 解密失败时也返回原始字符串（兼容旧数据）。
 * @param {string} encryptedStr - 加密的 JSON 字符串或旧明文
 * @returns {string} 解密后的明文 API Key
 */
function decryptApiKey(encryptedStr) {
  if (!encryptedStr) return encryptedStr;
  // 支持对象输入（config.json 读取的已解析对象）和字符串输入
  let parsed;
  if (typeof encryptedStr === 'object') {
    parsed = encryptedStr; // 已经是解析后的对象
  } else {
    try {
      parsed = JSON.parse(encryptedStr);
    } catch {
      // 不是 JSON，说明是旧明文数据，直接返回
      return encryptedStr;
    }
  }
  if (!parsed.iv || !parsed.tag || !parsed.data) {
    // JSON 对象但不包含加密字段，视为明文数据
    return encryptedStr;
  }
  try {
    const key = getOrCreateEncryptionKey();
    const decipher = crypto.createDecipheriv(
      ENCRYPTION_ALGORITHM,
      key,
      Buffer.from(parsed.iv, 'hex'),
      { authTagLength: ENCRYPTION_AUTH_TAG_LENGTH }
    );
    decipher.setAuthTag(Buffer.from(parsed.tag, 'hex'));
    let decrypted = decipher.update(parsed.data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.warn('[DB] 解密 API Key 失败，返回原始字符串：' + err.message);
    return encryptedStr;
  }
}

/**
 * 迁移所有未加密的 API Key 为加密存储。
 * 查找 api_key 字段不包含 '{"iv":' 前缀的记录，逐个加密并更新。
 * 通过 meta 表 'encryption_key_migrated' 标记确保只执行一次。
 */
function encryptAllExistingKeys() {
  try {
    // 检查是否已经迁移过
    const migrated = getMeta('encryption_key_migrated');
    if (migrated) return;

    // 获取所有明文（未加密）的 key
    const rows = db.prepare(
      "SELECT rowid, provider, api_key, notes FROM api_keys WHERE api_key NOT LIKE '{\"iv\":%'"
    ).all();

    if (rows.length === 0) {
      // 没有需要迁移的 key，直接标记完成
      setMeta('encryption_key_migrated', '1');
      return;
    }

    const update = db.prepare('UPDATE api_keys SET api_key = ? WHERE rowid = ?');
    let count = 0;
    for (const row of rows) {
      const encrypted = encryptApiKey(row.api_key);
      if (encrypted !== row.api_key) {
        update.run(encrypted, row.rowid);
        count++;
      }
    }

    setMeta('encryption_key_migrated', '1');
    if (count > 0) {
      console.log(`[DB] 已迁移 ${count} 个 API Key 为加密存储`);
    }
  } catch (err) {
    console.warn('[DB] API Key 加密迁移失败：' + err.message);
  }
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
  encryptAllExistingKeys();

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
      is_default_pw INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  // 迁移：为已有数据库添加 is_default_pw 列
  try { db.exec('ALTER TABLE admin_users ADD COLUMN is_default_pw INTEGER NOT NULL DEFAULT 0'); } catch {}

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
      notes TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  // 迁移：为已有数据库添加 notes 列（如果不存在）
  try { db.exec('ALTER TABLE custom_providers ADD COLUMN notes TEXT NOT NULL DEFAULT \'\''); } catch {}

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

  // Provider priority (custom ordering by user)
  db.exec(`
    CREATE TABLE IF NOT EXISTS provider_priority (
      provider TEXT PRIMARY KEY,
      priority INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Analytics tables for request logging
  createAnalyticsTables();
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
/** 默认密码常量 — 首次登录时检测并提示修改 */
const DEFAULT_ADMIN_PASSWORD = 'admin123';

function ensureAdminUser() {
  const existing = db.prepare('SELECT id FROM admin_users LIMIT 1').get();
  if (existing) return null; // Already has an admin user

  const envPassword = process.env.FLAP_ADMIN_PASSWORD;
  let password;

  if (envPassword && envPassword.length >= 6) {
    password = envPassword;
    console.log('[DB] Admin user configured via FLAP_ADMIN_PASSWORD environment variable');
  } else {
    password = DEFAULT_ADMIN_PASSWORD;
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║           Admin Panel - Initial Setup                       ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log('║  Username: admin                                            ║');
    console.log('║  Password: admin123                                         ║');
    console.log('║                                                              ║');
    console.log('║  ⚠️  首次登录后请立即修改密码！                              ║');
    console.log('║  Set FLAP_ADMIN_PASSWORD env var to customize.              ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');
  }

  const hash = hashPassword(password);
  db.prepare('INSERT INTO admin_users (username, password_hash, is_default_pw) VALUES (?, ?, 1)').run('admin', hash);

  return { username: 'admin', password };
}

/** 检查当前密码是否为默认密码 */
function isUsingDefaultPassword(username) {
  const row = db.prepare('SELECT is_default_pw FROM admin_users WHERE username = ?').get(username);
  return row ? row.is_default_pw === 1 : false;
}

/** 标记已修改密码（非默认密码） */
function markPasswordChanged(username) {
  try {
    db.prepare('UPDATE admin_users SET is_default_pw = 0 WHERE username = ?').run(username);
  } catch {}
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

function updateSessionUsername(token, newUsername) {
  if (!token || !newUsername) return false;
  try {
    db.prepare('UPDATE sessions SET username = ? WHERE id = ?').run(newUsername, token);
    return true;
  } catch { return false; }
}

// ============================================================================
// API Key management
// ============================================================================
function getProviderKeys(provider) {
  const rows = db.prepare('SELECT api_key, notes FROM api_keys WHERE provider = ? ORDER BY rowid').all(provider);
  return rows.map(r => ({ key: decryptApiKey(r.api_key), notes: r.notes || '' }));
}

function getAllProviderKeys() {
  const result = {};

  // 1. 从 SQLite 读取（最优先）
  const rows = db.prepare('SELECT provider, api_key, notes FROM api_keys ORDER BY provider, rowid').all();
  for (const row of rows) {
    if (!result[row.provider]) result[row.provider] = [];
    result[row.provider].push({ key: decryptApiKey(row.api_key), notes: row.notes || '' });
  }

  // 2. 从 config.json 合并（作为 SQLite 的补充/回退）
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8').trim();
      if (raw) {
        const cfg = JSON.parse(raw);
        if (cfg.apiKeys && typeof cfg.apiKeys === 'object') {
          for (const [provider, keys] of Object.entries(cfg.apiKeys)) {
            // 只合并 SQLite 中没有的提供商密钥
            if (!result[provider] || result[provider].length === 0) {
              const keyList = Array.isArray(keys) ? keys : [keys];
              const decryptedList = [];
              for (const k of keyList) {
                if (typeof k === 'string' && k.trim()) {
                  decryptedList.push({ key: decryptApiKey(k.trim()), notes: '' });
                }
              }
              if (decryptedList.length > 0) {
                result[provider] = decryptedList;
              }
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('[DB] getAllProviderKeys error:', err.message);
  }

  return result;
}

function addProviderKey(provider, apiKey, notes) {
  try {
    // Check if key already exists (avoid duplicates)
    const existing = db.prepare('SELECT 1 FROM api_keys WHERE provider = ?').all(provider);
    const existingKeys = existing.length > 0 ? getProviderKeys(provider) : [];
    if (existingKeys.some(k => k.key === apiKey)) return true; // already exists

    const encrypted = encryptApiKey(apiKey);
    if (!encrypted && apiKey) {
      console.error('[DB] 加密失败，Key 未存储:', provider);
      return false;
    }
    db.prepare('INSERT OR IGNORE INTO api_keys (provider, api_key, notes) VALUES (?, ?, ?)').run(provider, encrypted || apiKey, notes || '');

    // 同步更新 JSON config 中的备份（同样是加密后写入）
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
        if (raw.trim()) {
          const config = JSON.parse(raw);
          if (!config.apiKeys) config.apiKeys = {};
          if (!config.apiKeys[provider]) config.apiKeys[provider] = [];
          if (Array.isArray(config.apiKeys[provider])) {
            // Check for duplicates in config.json too
            const alreadyInConfig = config.apiKeys[provider].some(k => decryptApiKey(k) === apiKey);
            if (!alreadyInConfig) config.apiKeys[provider].push(encrypted);
          } else {
            config.apiKeys[provider] = [encrypted];
          }
          fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
        }
      }
    } catch (configErr) {
      console.warn('[DB] 同步更新 JSON config 失败：' + configErr.message);
    }

    return true;
  } catch (err) {
    console.warn('[DB] addProviderKey 失败:', err.message);
    return false;
  }
}

function updateProviderKeyNotes(provider, apiKey, notes) {
  // API Key 存储时已加密（AES-256-GCM 使用随机 IV），
  // 不能直接 WHERE api_key = plaintext，需要遍历解密匹配
  try {
    const rows = db.prepare('SELECT rowid, api_key FROM api_keys WHERE provider = ?').all(provider);
    for (const row of rows) {
      const decrypted = decryptApiKey(row.api_key);
      if (decrypted === apiKey) {
        db.prepare('UPDATE api_keys SET notes = ? WHERE rowid = ?').run(notes || '', row.rowid);
        return true;
      }
    }
  } catch (err) {
    console.warn('[DB] updateProviderKeyNotes 失败:', err.message);
  }
  return false;
}

function removeProviderKey(provider, apiKey) {
  // API Key 存储时已加密，需要遍历解密匹配
  try {
    const rows = db.prepare('SELECT rowid, api_key FROM api_keys WHERE provider = ?').all(provider);
    for (const row of rows) {
      const decrypted = decryptApiKey(row.api_key);
      if (decrypted === apiKey) {
        db.prepare('DELETE FROM api_keys WHERE rowid = ?').run(row.rowid);

        // 同步清理 config.json 中的对应 key
        try {
          if (fs.existsSync(CONFIG_PATH)) {
            const raw = fs.readFileSync(CONFIG_PATH, 'utf8').trim();
            if (raw) {
              const config = JSON.parse(raw);
              if (config.apiKeys && config.apiKeys[provider]) {
                const keys = Array.isArray(config.apiKeys[provider]) ? config.apiKeys[provider] : [config.apiKeys[provider]];
                const filtered = keys.filter(k => decryptApiKey(k) !== apiKey);
                if (filtered.length === 0) {
                  delete config.apiKeys[provider];
                } else {
                  config.apiKeys[provider] = filtered.length === 1 ? filtered[0] : filtered;
                }
                fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
              }
            }
          }
        } catch (configErr) {
          console.warn('[DB] 同步清理 config.json 失败：' + configErr.message);
        }

        return true;
      }
    }
  } catch (err) {
    console.warn('[DB] removeProviderKey 失败:', err.message);
  }
  return false;
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
  console.warn('[DB] 未找到已保存的 Server API Key，自动生成新密钥');
  return doGenerateServerApiKey();
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
  } catch (err) {
    console.warn('[DB] 同步 API Key 到 config.json 失败:', err.message);
  }

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
  } catch (err) {
    console.warn('[DB] saveDiscoveredModels 事务失败:', err.message);
    try { db.prepare('ROLLBACK').run(); } catch {}
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

function saveCustomProvider(name, baseUrl, apiKey, notes) {
  db.prepare('INSERT OR REPLACE INTO custom_providers (name, base_url, api_key, notes) VALUES (?, ?, ?, ?)').run(name, baseUrl, apiKey || '', notes || '');
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
// Password & Username change
// ============================================================================
function changeAdminPassword(username, newPassword) {
  if (!newPassword || newPassword.length < 6) return false;
  const hash = hashPassword(newPassword);
  db.prepare('UPDATE admin_users SET password_hash = ?, is_default_pw = 0 WHERE username = ?').run(hash, username);
  return true;
}

function changeAdminUsername(oldUsername, newUsername) {
  if (!newUsername || newUsername.length < 3 || newUsername.length > 32) return false;
  if (!/^[a-zA-Z0-9_]+$/.test(newUsername)) return false;
  const existing = db.prepare('SELECT id FROM admin_users WHERE username = ?').get(newUsername);
  if (existing) return false; // 用户名已存在
  db.prepare('UPDATE admin_users SET username = ? WHERE username = ?').run(newUsername, oldUsername);
  return true;
}

function getAdminUsername() {
  const row = db.prepare('SELECT username FROM admin_users LIMIT 1').get();
  return row ? row.username : 'admin';
}

// ============================================================================
// Provider priority (custom ordering)
// ============================================================================

/**
 * 获取所有提供商优先级设置
 * @returns {object} { providerName: priorityNumber }
 */
function getAllProviderPriorities() {
  const rows = db.prepare('SELECT provider, priority FROM provider_priority').all();
  const result = {};
  for (const row of rows) result[row.provider] = row.priority;
  return result;
}

/**
 * 设置提供商优先级
 * @param {string} provider - 提供商名称
 * @param {number} priority - 优先级数字（越小越优先，0 = 最高）
 */
function setProviderPriority(provider, priority) {
  db.prepare('INSERT OR REPLACE INTO provider_priority (provider, priority, updated_at) VALUES (?, ?, datetime(\'now\'))').run(provider, priority);
}

/**
 * 删除提供商优先级设置（恢复默认）
 * @param {string} provider - 提供商名称
 */
function deleteProviderPriority(provider) {
  db.prepare('DELETE FROM provider_priority WHERE provider = ?').run(provider);
}

// ============================================================================
// Rate limiting (per-key RPM / RPD)
// ============================================================================

const ONE_MINUTE_MS = 60000;
const ONE_DAY_MS = 86400000;

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
  github: { rpm: 15, rpd: 150 },
  cohere: { rpm: 20, rpd: 1000 },
  reka: { rpm: 10, rpd: 500 },
  pollinations: { rpm: 60, rpd: 10000 },
  llm7: { rpm: 30, rpd: 1000 },
};

function getProviderLimits(provider) {
  const limits = PROVIDER_LIMITS[provider];
  // Return a copy to prevent mutation of the original object
  return limits ? { rpm: limits.rpm, rpd: limits.rpd } : { rpm: 30, rpd: 5000 };
}

function getRateLimitBucket() {
  const now = Date.now();
  const min = Math.floor(now / ONE_MINUTE_MS);
  const day = Math.floor(now / ONE_DAY_MS);
  return { min: 'min_' + min, day: 'day_' + day };
}

function recordRateLimit(provider, apiKey) {
  const b = getRateLimitBucket();
  try {
    const upsert = (bucket) => {
      // Atomic UPSERT - no SELECT-then-UPDATE race condition
      db.prepare(
        'INSERT INTO rate_limits (provider, api_key, bucket, count) VALUES (?, ?, ?, 1) ' +
        'ON CONFLICT(provider, api_key, bucket) DO UPDATE SET count = count + 1'
      ).run(provider, apiKey, bucket);
    };
    upsert(b.min);
    upsert(b.day);
    return true;
  } catch (err) {
    console.warn('[DB] recordRateLimit 失败:', err.message);
    return false;
  }
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
  } catch (err) {
    console.warn('[DB] isRateLimited 查询异常，保守返回受限:', err.message);
    return true;
  }
}

function setCooldown(provider, apiKey, ms) {
  try {
    db.prepare('INSERT OR REPLACE INTO cooldowns (provider, api_key, until) VALUES (?, ?, ?)').run(provider, apiKey, Date.now() + ms);
  } catch (err) {
    console.warn('[DB] setCooldown error:', err.message);
  }
}

// [Fix 2026-06-24] 添加调用频率限制，避免每次代理请求都全表扫描
let _lastCleanup = 0;
const CLEANUP_INTERVAL_MS = 60000;

function cleanRateLimits() {
  const now = Date.now();
  if (now - _lastCleanup < CLEANUP_INTERVAL_MS) return;
  _lastCleanup = now;
  try {
    const min = Math.floor(now / ONE_MINUTE_MS - 60);
    const day = Math.floor(now / ONE_DAY_MS - 2);
    db.prepare("DELETE FROM rate_limits WHERE bucket < ?").run('day_' + day);
    db.prepare("DELETE FROM rate_limits WHERE bucket < ? AND bucket LIKE 'min\\_%' ESCAPE '\\'").run('min_' + min);
    // Remove expired cooldowns
    db.prepare('DELETE FROM cooldowns WHERE until < ?').run(now);
  } catch (err) {
    console.warn('[DB] cleanRateLimits 失败:', err.message);
  }
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
  // Clean old analytics data (keep 90 days)
  cleanupOldAnalytics();
  // 迁移 config.json 中的遗留密钥到 SQLite
  migrateConfigJsonKeys();
  return { adminInfo, apiKey };
}

/**
 * 将 config.json 中尚不在 SQLite 中的 apiKeys 迁移到 SQLite。
 * 解决管理面板 API Keys 显示为空的问题。
 */
function migrateConfigJsonKeys() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return;
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8').trim();
    if (!raw) return;
    const cfg = JSON.parse(raw);
    if (!cfg.apiKeys || typeof cfg.apiKeys !== 'object') return;

    for (const [provider, keys] of Object.entries(cfg.apiKeys)) {
      // 检查 SQLite 中是否已有该提供商的密钥
      const existing = getProviderKeys(provider);
      if (existing.length > 0) continue; // 已有密钥，跳过

      const keyList = Array.isArray(keys) ? keys : [keys];
      for (const k of keyList) {
        if (typeof k === 'string' && k.trim()) {
          // decryptApiKey 会处理加密/明文，迁移到 SQLite 时 addProviderKey 会重新加密
          const decrypted = decryptApiKey(k.trim());
          if (decrypted) {
            try { addProviderKey(provider, decrypted); } catch (err) {
              console.warn('[DB] migrateConfigJsonKeys add key failed:', err.message);
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('[DB] 迁移 config.json 密钥失败：' + err.message);
  }
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
// Request analytics
// ============================================================================

/** 创建分析数据表（request_log）以及相关索引 */
function createAnalyticsTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS request_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT '',
      latency_ms INTEGER NOT NULL DEFAULT 0,
      success INTEGER NOT NULL DEFAULT 1,
      tokens_in INTEGER NOT NULL DEFAULT 0,
      tokens_out INTEGER NOT NULL DEFAULT 0,
      request_model TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  // 索引，加速按时间查询
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_request_log_created ON request_log(created_at)'); } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_request_log_provider ON request_log(provider)'); } catch {}
}

/**
 * 记录一次请求日志
 * @param {object} params - 日志参数
 * @param {string} params.provider - 提供商名称
 * @param {string} params.model - 使用的模型名
 * @param {number} params.latencyMs - 延迟（毫秒）
 * @param {boolean} params.success - 是否成功
 * @param {number} params.tokensIn - 输入 token 数
 * @param {number} params.tokensOut - 输出 token 数
 * @param {string} params.requestModel - 原始请求中的模型名
 */
function logRequest({ provider, model, latencyMs, success, tokensIn, tokensOut, requestModel }) {
  try {
    db.prepare('INSERT INTO request_log (provider, model, latency_ms, success, tokens_in, tokens_out, request_model) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(provider || '', model || '', latencyMs || 0, success ? 1 : 0, tokensIn || 0, tokensOut || 0, requestModel || '');
  } catch (err) {
    console.warn('[DB] logRequest 失败:', err.message);
  }
}

/**
 * 获取分析概览
 * @param {number} [hours=24] - 统计时间范围（小时）
 * @returns {object} 统计概览
 */
function getAnalyticsSummary(hours = 24) {
  const rows = db.prepare(`
    SELECT 
      COUNT(*) as total_requests,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful,
      AVG(CASE WHEN success = 1 THEN latency_ms ELSE NULL END) as avg_latency,
      SUM(tokens_in) as total_tokens_in,
      SUM(tokens_out) as total_tokens_out
    FROM request_log 
    WHERE created_at > datetime('now', '-' || ? || ' hours')
  `).get(hours);
  return rows || {};
}

/**
 * 按提供商分组统计
 * @param {number} [hours=24] - 统计时间范围（小时）
 * @returns {Array} 按提供商统计的结果
 */
function getAnalyticsByProvider(hours = 24) {
  const rows = db.prepare(`
    SELECT 
      provider,
      COUNT(*) as count,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success,
      ROUND(AVG(CASE WHEN success = 1 THEN latency_ms ELSE NULL END), 1) as avg_latency,
      SUM(tokens_in) as total_tokens_in,
      SUM(tokens_out) as total_tokens_out
    FROM request_log 
    WHERE created_at > datetime('now', '-' || ? || ' hours')
    GROUP BY provider
    ORDER BY count DESC
  `).all(hours);
  return rows;
}

/**
 * 获取时间序列数据（按小时）
 * @param {number} [hours=24] - 统计时间范围（小时）
 * @returns {Array} 时间序列数据
 */
function getAnalyticsTimeSeries(hours = 24) {
  const rows = db.prepare(`
    SELECT 
      strftime('%Y-%m-%d %H:00', created_at) as hour,
      COUNT(*) as count,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success,
      ROUND(AVG(CASE WHEN success = 1 THEN latency_ms ELSE NULL END), 1) as avg_latency
    FROM request_log 
    WHERE created_at > datetime('now', '-' || ? || ' hours')
    GROUP BY hour
    ORDER BY hour ASC
  `).all(hours);
  return rows;
}

/**
 * 获取最常用模型排行
 * @param {number} [hours=24] - 统计时间范围（小时）
 * @param {number} [limit=10] - 返回数量限制
 * @returns {Array} 模型排行
 */
function getTopModels(hours = 24, limit = 10) {
  const rows = db.prepare(`
    SELECT 
      COALESCE(NULLIF(model, ''), request_model) as model_name,
      COUNT(*) as count
    FROM request_log 
    WHERE created_at > datetime('now', '-' || ? || ' hours')
    GROUP BY model_name
    ORDER BY count DESC
    LIMIT ?
  `).all(hours, limit);
  return rows;
}

/**
 * 清理旧的分析日志
 * @param {number} [retentionDays=90] - 保留天数
 */
function cleanupOldAnalytics(retentionDays = 90) {
  try {
    db.prepare("DELETE FROM request_log WHERE created_at < datetime('now', '-' || ? || ' days')").run(retentionDays);
  } catch (err) {
    console.warn('[DB] cleanupOldAnalytics 失败:', err.message);
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
  getOrCreateEncryptionKey,
  encryptApiKey,
  decryptApiKey,
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
  updateSessionUsername,
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
  changeAdminUsername,
  getAdminUsername,
  isUsingDefaultPassword,
  markPasswordChanged,
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
  logRequest,
  getAnalyticsSummary,
  getAnalyticsByProvider,
  getAllProviderPriorities,
  setProviderPriority,
  deleteProviderPriority,
  getAnalyticsTimeSeries,
  getTopModels,
  cleanupOldAnalytics,
  loadEnvFile,
  saveEnvVar,
};
