/**
 * Catalog Sync — auto-update models, provider URLs, and rate limits
 *
 * Supports TWO input formats:
 * 1. Our custom format (exported via `flap export-catalog`)
 * 2. litellm's model_prices_and_context_window.json (2874 models!)
 *
 * Set CATALOG_URL to point to either format.
 * Default: litellm's catalog (auto-updates daily).
 */

const { getMeta, setMeta, getDb } = require('./db');
const fs = require('fs');
const path = require('path');

/** 项目根目录下的 .data 文件夹作为默认数据存储路径 */
const DATA_DIR_DEFAULT = path.resolve(__dirname, '..', '.data');
const DB_DIR = process.env.DATA_DIR || DATA_DIR_DEFAULT;

// litellm's community-maintained model catalog — updated almost daily
// Contains 2800+ models across 100+ providers with context windows, vision flags, etc.
const LITELLM_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

// litellm_provider → our internal provider key mapping
// PROVIDER_MAP intentionally empty — only 29 static best models by default
const PROVIDER_MAP = {};

// Last sync tracking
const SYNC_META_KEY = 'last_catalog_sync';
const CATALOG_URL_KEY = 'catalog_url';
const SYNC_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

function getCatalogUrl() {
  // Priority: env var > stored in DB > litellm default
  if (process.env.CATALOG_URL) return process.env.CATALOG_URL;
  try {
    const stored = getMeta(CATALOG_URL_KEY);
    if (stored) return stored;
  } catch {}
  return LITELLM_URL; // Default to litellm's catalog!
}

function setCatalogUrl(url) {
  try {
    setMeta(CATALOG_URL_KEY, url || '');
    return true;
  } catch { return false; }
}

function getLastSync() {
  try {
    const val = getMeta(SYNC_META_KEY);
    return val ? parseInt(val, 10) : 0;
  } catch { return 0; }
}

function setLastSync(time) {
  try {
    setMeta(SYNC_META_KEY, String(time || Date.now()));
  } catch {}
}

/**
 * Fetch catalog from remote URL
 */
async function fetchCatalog(url) {
  if (!url) return null;
  try {
    // Support file:// URLs for local testing
    if (url.startsWith('file://')) {
      const filePath = path.resolve(url.slice(7).replace(/^\/([a-zA-Z]:)/, '$1'));
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(raw);
      }
      throw new Error('File not found: ' + filePath);
    }
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (err) {
    console.log('[Catalog] Fetch failed:', err.message);
    return null;
  }
}

/**
 * Sync SWE-bench model scores from a JSON URL into sync_models.
 * Uses the shared DB connection (getDb) and UPSERT for atomicity.
 * @param {string} url - JSON URL with format: {"models":[{"id":"p/m","tier":"S+","swe_score":"...","ctx":"..."}]}
 * @returns {number} Number of models synced
 */
async function syncSweBenchScores(url) {
  if (!url) return 0;
  // Restrict to HTTPS for SSRF protection
  if (!url.startsWith('https://')) {
    console.log('[SWE-bench] Only HTTPS URLs allowed');
    return 0;
  }
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    const models = data.models || [];
    if (!Array.isArray(models)) throw new Error('Invalid format: expected models array');

    const db = getDb();
    // Ensure sync_models table with consistent schema
    db.exec(`CREATE TABLE IF NOT EXISTS sync_models (
      provider TEXT NOT NULL, model_id TEXT NOT NULL,
      label TEXT DEFAULT '', tier TEXT DEFAULT 'B',
      swe_score TEXT DEFAULT '', ctx TEXT DEFAULT '128k',
      PRIMARY KEY (provider, model_id)
    )`);
    db.exec("CREATE INDEX IF NOT EXISTS idx_sync_models_provider ON sync_models(provider)");

    let count = 0;
    for (const m of models) {
      if (!m.id || !m.tier) continue;
      const parts = m.id.split('/');
      const provider = parts.length > 1 ? parts[0] : '';
      const modelId = parts.length > 1 ? parts.slice(1).join('/') : m.id;
      if (!provider) continue;
      // UPSERT: insert if new, update tier/swe_score if exists
      db.prepare(
        "INSERT INTO sync_models (provider, model_id, tier, swe_score, ctx, label) VALUES (?, ?, ?, ?, ?, '') " +
        "ON CONFLICT(provider, model_id) DO UPDATE SET tier = excluded.tier, swe_score = excluded.swe_score, ctx = excluded.ctx"
      ).run(provider, modelId, m.tier, m.swe_score || '', m.ctx || '');
      count++;
    }

    setMeta('swe_bench_last_sync', String(Date.now()));
    console.log(`[SWE-bench] Synced ${count} model scores`);
    return count;
  } catch (err) {
    console.log('[SWE-bench] Sync failed:', err.message);
    return 0;
  }
}

/**
 * Detect if a JSON object is litellm's format (model_id → metadata)
 * vs our format ({ providers: {...} })
 */
function isLitellmFormat(data) {
  if (!data || typeof data !== 'object') return false;
  if (data.providers) return false; // Our format
  // litellm format: keys are model IDs, values have litellm_provider
  const keys = Object.keys(data).filter(k => k !== 'sample_spec');
  if (keys.length === 0) return false;
  const firstVal = data[keys[0]];
  return firstVal && typeof firstVal === 'object' && firstVal.litellm_provider;
}

/**
 * Apply litellm's catalog format to our sync tables
 * Converts: { "gpt-4o": { litellm_provider: "openai", mode: "chat", ... } }
 *     Into: our sync_models table with provider mapping
 */
function applyLitellmCatalog(data) {
  const db = getDb();
  let count = 0;
  const stats = {};

  try {
    ensureSyncTables(db);
    db.exec('BEGIN');
    // Clear existing synced models for our providers (deduplicate)
    const uniqueProviders = [...new Set(Object.values(PROVIDER_MAP))];
    for (const ourKey of uniqueProviders) {
      db.prepare('DELETE FROM sync_models WHERE provider = ?').run(ourKey);
    }

    const entries = Object.entries(data).filter(([k]) => k !== 'sample_spec');

    for (const [modelId, info] of entries) {
      // Only import chat models
      if (info.mode && info.mode !== 'chat') continue;

      const litellmProv = info.litellm_provider;
      const ourProvider = PROVIDER_MAP[litellmProv];
      if (!ourProvider) continue; // Unknown provider, skip

      // Extract context window
      let ctx = '128k';
      if (info.max_input_tokens) {
        const t = info.max_input_tokens;
        if (t >= 1000000) ctx = Math.round(t / 1000000) + 'M';
        else if (t >= 1000) ctx = Math.round(t / 1000) + 'k';
        else ctx = String(t);
      } else if (info.max_tokens) {
        const t = info.max_tokens;
        if (t >= 1000000) ctx = Math.round(t / 1000000) + 'M';
        else if (t >= 1000) ctx = Math.round(t / 1000) + 'k';
        else ctx = String(t);
      }

      // Build a human-readable label from the model ID
      const label = modelId.split('/').pop().split(':')[0].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

      // Estimate tier based on model name patterns and context window
      let tier = 'B'; // Default
      const lowerId = modelId.toLowerCase();
      const namePart = modelId.split('/').pop()?.toLowerCase() || '';
      
      // S+ tier: known frontier models
      if (/claude.*(?:opus|sonnet|4|3\.5)/.test(lowerId) || 
          /gpt-4(?:o|\.)?(?!.*mini)/.test(lowerId) ||
          /gemini.*(?:ultra|2\.0|2\.5)/.test(lowerId) ||
          /deepseek.*(?:v3|r1)/.test(lowerId) ||
          /qwen.*(?:3|max|plus|480|235)/.test(lowerId) ||
          /kimi.*(?:k2|k2\.5)/.test(lowerId) ||
          /minimax.*(?:m2|m2\.5)/.test(lowerId)) {
        if (/mini|tiny|small|nano/.test(namePart)) tier = 'A+';
        else if (/flash|lite|fast/.test(namePart)) tier = 'A';
        else tier = 'S+';
      } 
      // S tier: strong models
      else if (/claude|gpt-4|gemini|deepseek|qwen|kimi|mistral-large|llama.*(?:70|90|405)/.test(lowerId) ||
               /nemotron|command.*r|ministral.*large/.test(lowerId)) {
        tier = 'S';
      }
      // A+ tier: capable models
      else if (/llama|mistral|mixtral|qwen|glm|yandex|phi-3|command/.test(lowerId) ||
               /gemma.*(?:2|27|4)/.test(lowerId)) {
        if (/mini|tiny|small|nano/.test(namePart)) tier = 'B+';
        else tier = 'A';
      }
      // B+ tier: good for small tasks
      else if (/gemma|phi|granite|falcon|dbrx|solar|aya/.test(lowerId)) {
        tier = 'B+';
      }

      // Context window bonus: models with large context are likely more capable
      if (info.max_input_tokens) {
        const ctx = info.max_input_tokens;
        if (ctx >= 1000000 && tier === 'B') tier = 'A-';
        else if (ctx >= 128000 && tier === 'B') tier = 'B+';
      }

      // Store
      try {
        db.prepare(
          'INSERT OR REPLACE INTO sync_models (provider, model_id, label, tier, swe_score, ctx) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(ourProvider, modelId, label, tier, '', ctx);
        count++;
        stats[ourProvider] = (stats[ourProvider] || 0) + 1;
      } catch {}
    }

    db.exec('COMMIT');
    setLastSync(Date.now());
    
    // Print summary
    const provCounts = Object.entries(stats).sort((a, b) => b[1] - a[1]);
    console.log(`[Catalog] Synced ${count} models from litellm catalog`);
    for (const [p, c] of provCounts) {
      console.log(`  ${p}: ${c} models`);
    }
    return true;
  } catch (err) {
    console.log('[Catalog] Apply litellm catalog failed:', err.message);
    try { db.exec('ROLLBACK'); } catch {}
    return false;
  }
}

/**
 * Apply our custom catalog format to SQLite
 */
function applyCustomCatalog(catalog) {
  if (!catalog || !catalog.providers) return false;

  const db = getDb();
  let count = 0;

  try {
    ensureSyncTables(db);
    db.exec('BEGIN');
    for (const [providerKey, providerData] of Object.entries(catalog.providers)) {
      if (!providerData.models || !Array.isArray(providerData.models)) continue;

      for (const model of providerData.models) {
        if (!Array.isArray(model) || model.length < 3) continue;
        const [modelId, label, tier, sweScore, ctx] = model;

        try {
          db.prepare(
            'INSERT OR REPLACE INTO sync_models (provider, model_id, label, tier, swe_score, ctx) VALUES (?, ?, ?, ?, ?, ?)'
          ).run(providerKey, modelId, label || modelId, tier || 'B', sweScore || '', ctx || '128k');
          count++;
        } catch {}
      }

      if (providerData.url) {
        try {
          db.prepare(
            'INSERT OR REPLACE INTO sync_provider_urls (provider, url, limits_rpm, limits_rpd) VALUES (?, ?, ?, ?)'
          ).run(providerKey, providerData.url, providerData.limits?.rpm || 30, providerData.limits?.rpd || 5000);
        } catch {}
      }
    }

    db.exec('COMMIT');
    setLastSync(Date.now());
    console.log(`[Catalog] Synced ${count} models from custom catalog`);
    return true;
  } catch (err) {
    console.log('[Catalog] Apply custom catalog failed:', err.message);
    try { db.exec('ROLLBACK'); } catch {}
    return false;
  }
}

/**
 * Ensure tables exist for sync data
 */
function ensureSyncTables(db) {
  if (!db) db = getDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sync_models (
        provider TEXT NOT NULL, model_id TEXT NOT NULL,
        label TEXT DEFAULT '', tier TEXT DEFAULT 'B',
        swe_score TEXT DEFAULT '', ctx TEXT DEFAULT '128k',
        PRIMARY KEY (provider, model_id)
      )
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS sync_provider_urls (
        provider TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        limits_rpm INTEGER DEFAULT 30,
        limits_rpd INTEGER DEFAULT 5000
      )
    `);
  } catch {}
}

/**
 * Get sync'ed models for a provider (merges with static catalog)
 */
function getSyncedModels(providerKey) {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT model_id, label, tier, swe_score, ctx FROM sync_models WHERE provider = ? ORDER BY rowid').all(providerKey);
    return rows.map(r => [r.model_id, r.label, r.tier, r.swe_score, r.ctx]);
  } catch { return []; }
}

/**
 * Get all sync'ed models across all providers
 */
function getAllSyncedModels() {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT provider, model_id, label, tier, swe_score, ctx FROM sync_models ORDER BY provider, rowid').all();
    return rows.map(r => ({ provider: r.provider, id: r.model_id, label: r.label, tier: r.tier, swe_score: r.swe_score, ctx: r.ctx }));
  } catch { return []; }
}

/**
 * Get sync'ed provider URL (overrides static URL)
 */
function getSyncedProviderUrl(providerKey) {
  try {
    const db = getDb();
    const row = db.prepare('SELECT url, limits_rpm, limits_rpd FROM sync_provider_urls WHERE provider = ?').get(providerKey);
    return row || null;
  } catch { return null; }
}

/**
 * Main sync function — called on startup and via CLI
 */
async function syncCatalog(force = false, url) {
  const catalogUrl = url || getCatalogUrl();
  if (!catalogUrl) {
    if (force) console.log('[Catalog] No CATALOG_URL configured. Set env CATALOG_URL or use flap sync --url <url>');
    return false;
  }

  // Check if we need to sync
  if (!force) {
    const lastSync = getLastSync();
    if (lastSync && (Date.now() - lastSync < SYNC_INTERVAL)) {
      return true; // Already synced recently
    }
  }

  ensureSyncTables();
  const catalog = await fetchCatalog(catalogUrl);
  if (!catalog) return false;
  
  // Auto-detect format: litellm's format or our custom format
  if (isLitellmFormat(catalog)) {
    return applyLitellmCatalog(catalog);
  } else {
    return applyCustomCatalog(catalog);
  }
}

/**
 * Export current static models as a catalog JSON file
 */
function exportCatalog(outputPath) {
  const { sources, MODELS, ENV_VAR_NAMES } = require('./models');
  const catalog = {
    version: 1,
    generated: new Date().toISOString(),
    providers: {},
  };

  for (const [key, source] of Object.entries(sources)) {
    if (!source.models || !source.url) continue;
    catalog.providers[key] = {
      name: source.name,
      url: source.url,
      env_var: ENV_VAR_NAMES[key] || null,
      limits: null, // Will be filled by the sync
      models: source.models.map(m => [m[0], m[1], m[2], m[3], m[4]]),
    };
  }

  const json = JSON.stringify(catalog, null, 2);
  if (outputPath) {
    fs.writeFileSync(outputPath, json);
    console.log(`[Catalog] Exported ${Object.keys(catalog.providers).length} providers to ${outputPath}`);
  }
  return catalog;
}

module.exports = {
  syncCatalog,
  exportCatalog,
  getSyncedModels,
  getAllSyncedModels,
  getSyncedProviderUrl,
  getCatalogUrl,
  setCatalogUrl,
  ensureSyncTables,
  applyLitellmCatalog,
  syncSweBenchScores,
};
