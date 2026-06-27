/**
 * Admin Web UI — browser-based provider management
 *
 * Serves a single-page admin panel at /admin and REST API at /api/admin/*
 */

const { loadConfig, saveConfig, addApiKey, removeApiKey, getAllApiKeys, getServerApiKey } = require('./config');
const { sources, MODELS, getModelsByProvider } = require('./models');
const { runHealthCheck, getHealthyProviders } = require('./health-checker');
const { verifyAdminLogin, createSession, validateSession, deleteSession, getDiscoveredModels: dbGetDiscoveredModels, saveDiscoveredModels, getAllProviderKeys, addProviderKey, updateProviderKeyNotes, removeProviderKey, removeAllProviderKeys, setProviderEnabled, isProviderEnabled, regenerateServerApiKey, setModelEnabled, getAllModelStates, getCustomProviders, saveCustomProvider, deleteCustomProvider, setCustomProviderEnabled, getCustomProviderModels, saveCustomProviderModel, deleteCustomProviderModel, changeAdminPassword, changeAdminUsername, getAdminUsername, getProviderTestModel, setProviderTestModel, setModelTier, getAllModelTiers, getServerApiKey: dbGetServerApiKey, isUsingDefaultPassword, markPasswordChanged, getAllProviderPriorities, setProviderPriority, deleteProviderPriority } = require('./db');

/**
 * getAdminInitialData — 获取管理面板初始数据
 * 从 config.json 读取配置、API Key、启用提供商、模型状态等信息，供前端 HTML 页面使用
 * @returns {object} 包含 allProviders, enabledProviders, apiKeys, modelStates, modelTiers, 
 *   allStaticModels, testModels, serverApiKey, adminUsername 等字段的对象
 */
function getAdminInitialData() {
  const config = loadConfig();
  const allProviders = Object.entries(sources)
    .filter(([_, v]) => v.url && !v.cliOnly && !v.zenOnly)
    .map(([k, v]) => ({ key: k, name: v.name, url: v.url }));
  const serverApiKey = getServerApiKey(config);
  // Embed enabled states
  const enabledProviders = {};
  for (const [k, v] of Object.entries(sources)) {
    if (v.url && !v.cliOnly && !v.zenOnly) {
      try { enabledProviders[k] = isProviderEnabled(k); }
      catch { enabledProviders[k] = config.providers?.[k]?.enabled !== false; }
    }
  }
  // Embed API keys (masked for safety — full keys only via /api/admin/config)
  // Include BOTH database keys AND environment variable keys
  const rawKeys = getAllProviderKeys();
  const allApiKeys = getAllApiKeys(config, '');
  const apiKeys = {};
  // Database keys
  for (const [prov, keys] of Object.entries(rawKeys)) {
    apiKeys[prov] = (Array.isArray(keys) ? keys : [keys]).map(k => {
      const ks = typeof k === 'string' ? k : (k.key || '');
      return { key: ks.length > 12 ? ks.slice(0, 8) + '...' + ks.slice(-4) : ks, notes: typeof k === 'object' ? (k.notes || '') : '' };
    });
  }
  // Environment variable keys (add if not already in database)
  for (const [prov, src] of Object.entries(sources)) {
    if (!src.url || src.cliOnly || src.zenOnly) continue;
    if (apiKeys[prov] && apiKeys[prov].length > 0) continue;
    const envKeys = getAllApiKeys(config, prov);
    if (envKeys.length > 0) {
      apiKeys[prov] = envKeys.map(k => ({
        key: k.length > 12 ? k.slice(0, 8) + '...' + k.slice(-4) : k,
        notes: '(环境变量)',
      }));
    }
  }
  // Embed test models
  const testModels = {};
  for (const [k] of Object.entries(sources)) {
    try { const tm = getProviderTestModel(k); if (tm) testModels[k] = tm; } catch {}
  }
  const adminUsername = getAdminUsername();
  return { serverApiKey, allProviders, enabledProviders, apiKeys, testModels, adminUsername };
}

// ============================================================================
// Discovered models (persisted in SQLite, cached in memory)
// ============================================================================

function getAllDiscoveredModels() {
  try { return dbGetDiscoveredModels(); } catch { return []; }
}

// ============================================================================
// Model discovery via provider's /v1/models endpoint
// ============================================================================
async function discoverProviderModels(providerKey, apiKey) {
  // Check static catalog first, then custom providers
  const provider = sources[providerKey];
  let url = provider ? provider.url : null;
  if (!url) {
    // Check custom providers
    const cp = getCustomProviders().find(p => p.name === providerKey);
    if (cp) url = cp.base_url;
  }
  if (!url) return [];

  // Build base URL from chat completions endpoint
  const baseUrl = url.replace('/chat/completions', '').replace(/\/$/, '');
  const modelsUrl = baseUrl + '/models';

  try {
    const resp = await fetch(modelsUrl, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) return [];

    const data = await resp.json();
    const list = (data.data || []).map(m => ({
      id: m.id,
      owned_by: m.owned_by || providerKey,
      object: m.object || 'model',
      discoveredAt: Date.now(),
    }));

    if (list.length > 0) {
      saveDiscoveredModels(providerKey, list);
    }
    return list;
  } catch (err) {
    console.warn('[Admin] Discover models failed for ' + providerKey + ':', err.message);
    return [];
  }
}

// ============================================================================
// Read JSON body from request (with size limit)
// ============================================================================
const MAX_BODY_SIZE = 1024 * 512; // 512KB

function readJsonBody(req) {
  return new Promise(resolve => {
    let body = '';
    let resolved = false;
    const done = v => { if (!resolved) { resolved = true; resolve(v); } };
    req.on('data', chunk => { body += chunk; if (body.length > MAX_BODY_SIZE) { req.destroy(); done({}); } });
    req.on('end', () => { try { done(JSON.parse(body)); } catch { done({}); } });
    req.on('error', () => done({}));
    req.on('close', () => done({}));
  });
}

// ============================================================================
// Admin HTML page
// ============================================================================
/**
 * getAdminHtml — 生成管理面板 HTML 页面
 * 返回完整的管理面板前端 HTML，包含 CSS 样式、侧边栏导航、各功能页面和内联 JavaScript
 * @returns {string} 完整的管理面板 HTML 字符串
 */
function getAdminHtml() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>free-llm-api-provider</title>
<style>
/* ═══════════════════════════════════════════════
   Design System — Inspired by Linear/Vercel/Raycast
   ═══════════════════════════════════════════════ */
:root {
  --bg: #09090b;
  --bg-subtle: #0f0f12;
  --card: #18181b;
  --card-hover: #1e1e22;
  --border: #27272a;
  --border-subtle: #1e1e22;
  --text: #fafafa;
  --text-secondary: #a1a1aa;
  --text-muted: #71717a;
  --accent: #3b82f6;
  --accent-hover: #2563eb;
  --accent-bg: rgba(59,130,246,0.08);
  --success: #22c55e;
  --success-bg: rgba(34,197,94,0.08);
  --danger: #ef4444;
  --danger-bg: rgba(239,68,68,0.08);
  --warning: #eab308;
  --warning-bg: rgba(234,179,8,0.08);
  --sidebar-w: 260px;
  --font-xs: 12px;
  --font-sm: 13px;
  --font-base: 14px;
  --font-md: 16px;
  --font-lg: 20px;
  --font-xl: 24px;
  --font-2xl: 30px;
  --radius: 8px;
  --radius-lg: 12px;
  --radius-sm: 6px;
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.3);
  --shadow: 0 2px 8px rgba(0,0,0,0.4);
  --shadow-lg: 0 8px 24px rgba(0,0,0,0.5);
  --transition: 0.15s ease;
  --sidebar-bg: #111113;
}
.light {
  --bg: #ffffff;
  --bg-subtle: #f9f9fb;
  --card: #ffffff;
  --card-hover: #f4f4f6;
  --border: #e4e4e7;
  --border-subtle: #f0f0f2;
  --text: #09090b;
  --text-secondary: #52525b;
  --text-muted: #a1a1aa;
  --accent: #2563eb;
  --accent-hover: #1d4ed8;
  --accent-bg: rgba(37,99,235,0.06);
  --success: #16a34a;
  --success-bg: rgba(22,163,74,0.06);
  --danger: #dc2626;
  --danger-bg: rgba(220,38,38,0.06);
  --warning: #ca8a04;
  --warning-bg: rgba(202,138,4,0.06);
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
  --shadow: 0 2px 8px rgba(0,0,0,0.06);
  --shadow-lg: 0 8px 24px rgba(0,0,0,0.1);
  --sidebar-bg: #fafafa;
}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;background:var(--bg);color:var(--text);font-size:var(--font-base);line-height:1.5;-webkit-font-smoothing:antialiased;letter-spacing:-0.01em}

/* ── Sidebar ── */
.side{position:fixed;top:0;left:0;width:var(--sidebar-w);height:100vh;background:var(--sidebar-bg);border-right:1px solid var(--border);display:flex;flex-direction:column;z-index:50}
.side-head{padding:20px 20px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px}
.side-head .logo{width:28px;height:28px;border-radius:var(--radius-sm);background:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;color:#fff}
.side-head h1{font-size:var(--font-md);font-weight:700;letter-spacing:-0.3px}
.side-nav{flex:1;padding:8px;overflow-y:auto}
.side-nav button{display:flex;align-items:center;gap:12px;width:100%;padding:10px 14px;border:none;border-radius:var(--radius-sm);background:transparent;color:var(--text-muted);font-size:var(--font-base);cursor:pointer;transition:var(--transition);text-align:left;margin-bottom:2px;font-weight:500}
.side-nav button:hover{background:var(--card-hover);color:var(--text)}
.side-nav button.active{background:var(--accent-bg);color:var(--accent);font-weight:600}
.side-nav .ni{width:20px;height:20px;flex-shrink:0;display:flex;align-items:center;justify-content:center}
.side-nav .ni svg{width:18px;height:18px;fill:currentColor}
.side-nav .nb{margin-left:auto;font-size:var(--font-xs);padding:2px 8px;border-radius:10px;background:var(--border);color:var(--text-muted);font-weight:600}
.side-foot{padding:12px;border-top:1px solid var(--border)}
.side-foot .ka{display:flex;gap:6px}
.side-foot .ka button{flex:1;padding:7px;border:1px solid var(--border);border-radius:var(--radius-sm);background:transparent;color:var(--text-secondary);font-size:var(--font-sm);cursor:pointer;transition:var(--transition)}
.side-foot .ka button:hover{background:var(--card-hover);color:var(--text)}

/* ── Main ── */
.main{flex:1;margin-left:var(--sidebar-w);min-height:100vh;padding:32px 40px;max-width:calc(100vw - var(--sidebar-w))}
.page{display:none}.page.active{display:block;animation:fadeSlideIn .15s ease}
@keyframes fadeSlideIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
.pt{font-size:var(--font-xl);font-weight:700;margin-bottom:4px;letter-spacing:-0.4px}
.pd{color:var(--text-secondary);font-size:var(--font-base);margin-bottom:28px}

/* ── Card ── */
.c{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:20px 24px;margin-bottom:16px}
.ch{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px}
.ct{font-size:var(--font-md);font-weight:600;color:var(--text)}

/* ── Status dots ── */
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:8px;flex-shrink:0;position:relative}
.dot.up{background:var(--success);box-shadow:0 0 6px var(--success)}
.dot.up::after{content:'';position:absolute;inset:-2px;border-radius:50%;animation:pulse 2s ease-out infinite;border:2px solid var(--success);opacity:0}
@keyframes pulse{0%{transform:scale(1);opacity:.6}100%{transform:scale(2);opacity:0}}
.dot.down,.dot.error{background:var(--danger)}.dot.unknown{background:var(--text-muted)}.dot.auth_error,.dot.rate_limited{background:var(--warning)}

/* ── Provider row ── */
.row{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:18px 22px;margin-bottom:12px;transition:var(--transition)}
.row:hover{border-color:var(--accent);box-shadow:var(--shadow)}
.row:last-child{margin-bottom:0}
.pn{font-weight:600;font-size:var(--font-base);display:flex;align-items:center;gap:8px}
.pi{display:flex;flex-direction:column;gap:8px;flex:1;min-width:0}
.pi-top{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding-bottom:10px;border-bottom:1px solid var(--border-subtle)}
.pi-actions{display:flex;align-items:center;gap:6px;margin-left:auto;flex-shrink:0}
.pi-actions .btn{white-space:nowrap}
.pi-count{font-size:var(--font-sm);color:var(--text-muted);margin-left:auto;white-space:nowrap}

/* ── Key list ── */
.kl{display:flex;flex-direction:column;gap:0}
.ke{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border-subtle);font-size:var(--font-base)}
.ke:last-child{border-bottom:none}
.ke .kid{font-family:'SF Mono','Fira Code',Consolas,monospace;font-size:var(--font-sm);color:var(--text-muted);white-space:nowrap;min-width:150px}
.ke .kn{flex:1;color:var(--text);font-size:var(--font-base);min-width:0;cursor:pointer;padding:4px 8px;border-radius:var(--radius-sm);transition:var(--transition)}
.ke .kn:hover{background:var(--card-hover)}.ke .kn-empty{color:var(--text-muted);font-style:italic}
.ke .kt{font-size:var(--font-sm);color:var(--text-muted);white-space:nowrap}
.ke .ka{display:flex;gap:6px;flex-shrink:0}
.ke .ka button{padding:4px 10px;border:none;border-radius:var(--radius-sm);background:transparent;color:var(--text-muted);font-size:var(--font-sm);cursor:pointer;white-space:nowrap;transition:var(--transition)}
.ke .ka button:hover{color:var(--text);background:var(--card-hover)}
.ke .ka .ka-del:hover{color:var(--danger)}.ke .ka .ka-edit{font-size:var(--font-base)}
.ke input.kn-input{flex:1;background:var(--bg);border:1px solid var(--accent);border-radius:var(--radius-sm);color:var(--text);font-size:var(--font-sm);padding:6px 10px;outline:none;min-width:0}

/* ── Buttons ── */
.btn{padding:8px 18px;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--card);color:var(--text);cursor:pointer;font-size:var(--font-base);transition:var(--transition);font-weight:500;line-height:1.4}
.btn:hover{background:var(--card-hover);border-color:var(--text-muted)}
.btn-p{background:var(--accent);color:#fff;border-color:var(--accent);font-weight:600}
.btn-p:hover{background:var(--accent-hover);border-color:var(--accent-hover)}
.btn-d{background:var(--danger);color:#fff;border-color:var(--danger)}
.btn-d:hover{opacity:.9}
.btn-sm{padding:5px 12px;font-size:var(--font-sm)}

/* ── Toggle ── */
.tog{position:relative;width:40px;height:22px;display:inline-block;flex-shrink:0}
.tog input{opacity:0;width:0;height:0}
.tog .sl{position:absolute;inset:0;background:var(--border);border-radius:22px;transition:.2s cubic-bezier(.4,0,.2,1);cursor:pointer}
.tog .sl::before{content:'';position:absolute;width:16px;height:16px;left:3px;top:3px;background:var(--text-muted);border-radius:50%;transition:.2s cubic-bezier(.4,0,.2,1)}
.tog input:checked+.sl{background:var(--accent)}
.tog input:checked+.sl::before{transform:translateX(18px);background:#fff}
.tog input:focus-visible+.sl{outline:2px solid var(--accent);outline-offset:2px}

/* ── Form ── */
.fr{display:flex;gap:12px;align-items:center;margin-bottom:10px;flex-wrap:wrap}
.fr label{font-size:var(--font-base);min-width:80px;color:var(--text-secondary);font-weight:500}
input,select,textarea{background:var(--bg-subtle);border:1px solid var(--border);border-radius:var(--radius-sm);padding:9px 13px;color:var(--text);font-size:var(--font-base);transition:var(--transition);font-family:inherit}
input:focus,select:focus,textarea:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-bg)}
textarea{resize:vertical}

/* ── Table ── */
table{width:100%;border-collapse:collapse;font-size:var(--font-base)}
th{text-align:left;padding:10px 14px;border-bottom:1px solid var(--border);color:var(--text-muted);font-weight:600;font-size:var(--font-xs);text-transform:uppercase;letter-spacing:.6px}
td{padding:10px 14px;border-bottom:1px solid var(--border-subtle);vertical-align:middle}
tr:hover td{background:var(--card-hover)}
.ts{background:var(--bg-subtle);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-size:var(--font-sm);padding:5px 8px;transition:var(--transition)}
.ts.ts-modified{border-color:var(--warning);background:var(--warning-bg);font-weight:600}

/* ── Health grid ── */
.hg{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.hc{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:16px 18px;transition:var(--transition)}
.hc:hover{border-color:var(--accent)}
.hc .nm{font-weight:600;font-size:var(--font-base);margin-bottom:8px;color:var(--text)}
.hc .sc{font-size:28px;font-weight:700;line-height:1;margin-bottom:6px}
.hc .sc.gd{color:var(--success)}.hc .sc.ok{color:var(--warning)}.hc .sc.bd{color:var(--danger)}
.hc .st{font-size:var(--font-sm);color:var(--text-secondary)}

/* ── Stats ── */
.stat-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:16px}
.stat-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:16px 18px}
.stat-card .lbl{font-size:var(--font-xs);color:var(--text-muted);text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px;font-weight:600}
.stat-card .val{font-size:24px;font-weight:700;color:var(--text)}

/* ── Toast ── */
.toast{position:fixed;bottom:20px;right:20px;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:12px 20px;font-size:var(--font-base);box-shadow:var(--shadow-lg);z-index:100;display:none;max-width:380px;animation:toastIn .2s ease}
@keyframes toastIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.toast.show{display:block}.toast.succ{border-color:var(--success);border-left:3px solid var(--success)}.toast.err{border-color:var(--danger);border-left:3px solid var(--danger)}

/* ── Loading & Empty ── */
.load{display:inline-block;width:18px;height:18px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .6s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.empty{text-align:center;padding:48px 20px;color:var(--text-muted);font-size:var(--font-base)}

/* ── Modal ── */
.modal-o{position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:99;display:none;align-items:center;justify-content:center;backdrop-filter:blur(4px)}
.modal-o.show{display:flex}
.modal{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:28px;min-width:400px;max-width:90vw;max-height:80vh;overflow-y:auto;box-shadow:var(--shadow-lg);animation:fadeSlideIn .15s ease}
.modal h3{font-size:var(--font-lg);margin-bottom:14px}

/* ── Playground ── */
.pg-chat{display:flex;flex-direction:column;gap:10px;max-height:400px;overflow-y:auto;padding:6px 0}
.pg-msg{padding:14px 18px;border-radius:var(--radius-lg);font-size:var(--font-base);line-height:1.6;white-space:pre-wrap}
.pg-msg.user{background:var(--accent-bg);border:1px solid rgba(59,130,246,0.12);align-self:flex-end;max-width:80%}
.pg-msg.assistant{background:var(--bg-subtle);border:1px solid var(--border)}
.pg-msg .pg-meta{font-size:var(--font-sm);color:var(--text-muted);margin-top:8px;padding-top:8px;border-top:1px solid var(--border-subtle)}
.pg-cursor{color:var(--accent);animation:blink .8s step-end infinite;font-weight:300}
@keyframes blink{50%{opacity:0}}
.pg-inp{display:flex;gap:8px;margin-top:6px}
.pg-inp textarea{flex:1;min-height:48px;max-height:120px;font-size:var(--font-base)}
.pg-inp button{align-self:flex-end}

/* ── Scrollbar ── */
::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}::-webkit-scrollbar-thumb:hover{background:var(--text-muted)}

/* ── Responsive ── */
@media(max-width:768px){
  :root{--sidebar-w:52px}
  .side-head h1,.side-nav button span,.side-nav .nb,.side-foot .ka{display:none}
  .side-head{padding:12px;justify-content:center}
  .side-nav button{justify-content:center;padding:10px}
  .side-nav .ni{width:20px;height:20px}
  .main{margin-left:52px;padding:16px}
  .hg,.stat-grid{grid-template-columns:1fr}
  .modal{min-width:unset;margin:10px;padding:16px}
  .ke{flex-direction:column;align-items:stretch}.ke .kid{min-width:auto}
  .c{padding:14px 16px}
}
</style>
</head>
<body>
<div class="app" style="display:flex">
  <!-- Sidebar -->
  <aside class="side">
    <div class="side-head"><span class="logo">F</span><h1>flap</h1></div>
    <nav class="side-nav" id="sideNav">
      <button class="active" data-p="providers" onclick="sp('providers')"><span class="ni"><svg viewBox="0 0 24 24"><path d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z"/></svg></span><span>提供商</span></button>
      <button data-p="models" onclick="sp('models')"><span class="ni"><svg viewBox="0 0 24 24"><path d="M21 3H3v18h18V3zm-2 16H5V5h14v14z"/><path d="M9 7h2v10H9V7zm4 0h2v10h-2V7z"/></svg></span><span>模型</span><span class="nb" id="mb"></span></button>
      <button data-p="playground" onclick="sp('playground')"><span class="ni"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7L8 5z"/></svg></span><span>测试</span></button>
      <button data-p="health" onclick="sp('health')"><span class="ni"><svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg></span><span>健康</span></button>
      <button data-p="stats" onclick="sp('stats')"><span class="ni"><svg viewBox="0 0 24 24"><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/></svg></span><span>统计</span></button>
      <button data-p="settings" onclick="sp('settings')"><span class="ni"><svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.488.488 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1115.6 12 3.611 3.611 0 0112 15.6z"/></svg></span><span>设置</span></button>
    </nav>
    <div class="side-foot">
      <div class="ka"><button onclick="logout()" style="color:var(--red)">退出</button><button onclick="themeToggle()" title="切换主题" style="flex:none;width:32px;padding:4px"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9zm0 16c-3.86 0-7-3.14-7-7s3.14-7 7-7 7 3.14 7 7-3.14 7-7 7z"/><path d="M12 7v10c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg></button></div>
    </div>
  </aside>

  <main class="main">

    <!-- Page: Providers -->
    <div class="page active" id="p-providers">
      <div class="pt">提供商</div>
      <div class="pd">管理 API Key、测试连接、设置测试模型</div>
      <div class="c">
        <div class="ch"><span class="ct">已配置的提供商</span><button class="btn btn-sm" onclick="rP()">刷新</button></div>
        <div id="providerList"><div class="load" style="margin:18px auto"></div></div>
      </div>
      <div class="c">
        <div class="ct" style="margin-bottom:4px">提供商优先级</div>
        <p style="font-size:14px;color:var(--dim);margin-bottom:10px">数字越小优先级越高（0 = 最高）。相同模型时优先使用高优先级提供商。</p>
        <div id="priorityList"><div class="load" style="margin:8px 0"></div></div>
      </div>
      <div class="c">
        <div class="ct" style="margin-bottom:10px">添加 API Key</div>
        <div class="fr"><label>提供商</label><select id="nkp" style="flex:1" onchange="onNKPChange()"><option value="">选择...</option></select></div>
        <div id="customProviderFields" style="display:none">
          <div class="fr"><label>名称</label><input type="text" id="cpName" placeholder="任意名称" style="flex:1"></div>
          <div class="fr"><label>URL</label><input type="text" id="cpUrl" placeholder="https://api.example.com/v1/chat/completions" style="flex:1"></div>
        </div>
        <div class="fr"><label>Key</label><input type="password" id="nkv" placeholder="sk-..." style="flex:1"></div>
        <div class="fr"><label>备注</label><input type="text" id="nkNotes" placeholder="可选备注" style="flex:1"></div>
        <button class="btn btn-p" onclick="aPK()">添加</button>
      </div>
    </div>

    <!-- Page: Models -->
    <div class="page" id="p-models">
      <div class="pt">模型目录</div>
      <div class="pd">启用/禁用模型，设置等级影响 tier 路由</div>
      <div class="c">
        <div class="ch"><span class="ct">所有模型</span><span style="font-size:13px;color:var(--dim)" id="mc"></span><button class="btn btn-p btn-sm" id="saveTiersBtn" onclick="saveTiers()" style="display:none">保存等级</button></div>
        <div style="margin-bottom:12px"><input type="text" id="modelSearch" placeholder="搜索模型名称或提供商..." oninput="filterModels(this.value)" style="width:100%;padding:8px 12px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-size:var(--font-base)"></div>
        <div style="overflow-x:auto">
        <table><thead><tr><th style="width:34px">启用</th><th>模型 ID</th><th>名称</th><th style="width:85px">等级</th><th>提供商</th><th style="width:50px">来源</th></tr></thead>
        <tbody id="mtb"></tbody></table>
        </div>
      </div>
    </div>

    <!-- Page: Playground -->
    <div class="page" id="p-playground">
      <div class="pt">测试</div>
      <div class="pd">发送测试消息，查看路由结果</div>
      <div class="c">
        <div class="fr"><label>模型</label>
          <select id="pgModel" style="flex:1">
            <option value="tier-splus" selected>tier-splus</option>
            <option value="tier-s">tier-s</option>
            <option value="tier-aplus">tier-aplus</option>
            <option value="tier-a">tier-a</option>
            <option value="tier-b">tier-b</option>
          </select>
          <div style="display:flex;align-items:center;gap:10px;margin-left:8px">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:var(--font-sm);color:var(--text-secondary);user-select:none">
              <input type="checkbox" id="pgStream" checked style="width:16px;height:16px;accent-color:var(--accent);cursor:pointer">
              流式
            </label>
          </div>
        </div>
        <div id="pgChat" class="pg-chat" style="min-height:200px;max-height:500px;overflow-y:auto;margin-bottom:10px"></div>
        <div class="pg-inp">
          <textarea id="pgInput" placeholder="输入消息... (Enter 发送, Ctrl+Enter 换行)" rows="2" onkeydown="if(event.key==='Enter'&&!event.ctrlKey&&!event.shiftKey){event.preventDefault();pgSend()}"></textarea>
          <div style="display:flex;flex-direction:column;gap:6px">
            <button class="btn btn-p" onclick="pgSend()">发送</button>
            <button class="btn btn-sm" onclick="pgClear()" style="font-size:12px;color:var(--text-muted)">清除</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Page: Health -->
    <div class="page" id="p-health">
      <div class="pt">健康状态</div>
      <div class="pd">提供商实时延迟、配额和健康评分</div>
      <div class="c">
        <div class="ch"><span class="ct">健康检查</span><button class="btn btn-sm" onclick="rHC()">运行检查</button></div>
        <div class="hg" id="healthGrid"><div class="load" style="margin:18px auto"></div></div>
      </div>
    </div>

    <!-- Page: Stats -->
    <div class="page" id="p-stats">
      <div class="pt">统计</div>
      <div class="pd">请求量、成功率、提供商使用分布</div>
      <div class="c">
        <div class="ch"><span class="ct">请求统计</span><button class="btn btn-sm" onclick="rS()">刷新</button></div>
        <div id="statsContent"><div class="load" style="margin:18px auto"></div></div>
      </div>
    </div>

    <!-- Page: Settings -->
    <div class="page" id="p-settings">
      <div class="pt">设置</div>
      <div class="pd">API Key 管理、密码修改</div>
      <div class="c">
        <div class="ct" style="margin-bottom:4px">服务器 API Key</div>
        <p style="font-size:14px;color:var(--dim);margin-bottom:10px">AI 客户端连接代理时使用此 Key</p>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px">
          <code id="serverKey" style="flex:1;font-family:'SF Mono','Fira Code',Consolas,monospace;font-size:var(--font-sm);color:var(--dim);word-break:break-all;background:var(--bg);padding:8px 12px;border-radius:var(--radius-sm);border:1px solid var(--b2)">loading...</code>
          <button class="btn btn-sm" onclick="copyKey()">复制</button>
        </div>
        <div class="ct" style="margin-bottom:4px">重新生成 API Key</div>
        <p style="font-size:14px;color:var(--dim);margin-bottom:10px">生成新 Key 后旧 Key 即时失效</p>
        <button class="btn btn-d" onclick="rK()">重新生成</button>
      </div>
      <div class="c">
        <div class="ct" style="margin-bottom:4px">修改密码</div>
        <p style="font-size:14px;color:var(--dim);margin-bottom:10px">修改管理员登录密码</p>
        <div class="fr"><label>当前</label><input type="password" id="curPw" placeholder="当前密码" style="flex:1"></div>
        <div class="fr"><label>新密码</label><input type="password" id="newPw" placeholder="至少6位" style="flex:1"></div>
        <button class="btn btn-p" onclick="cPw()">修改</button>
      </div>
      <div class="c">
        <div class="ct" style="margin-bottom:4px">修改用户名</div>
        <p style="font-size:14px;color:var(--dim);margin-bottom:10px">当前用户名: <span id="curUser" style="font-weight:600"></span></p>
        <div class="fr"><label>新用户名</label><input type="text" id="newUser" placeholder="新用户名" style="flex:1"></div>
        <button class="btn btn-p" onclick="cU()">修改</button>
      </div>
    </div>

  </main>
</div>

<div class="toast" id="toast"></div>
<div class="modal-o" id="discoverModal">
  <div class="modal"><h3>发现模型</h3><div id="dr"></div><div style="margin-top:12px;text-align:right"><button class="btn" onclick="cDM()">关闭</button></div></div>
</div>

<script id="initData" type="application/json">${JSON.stringify(getAdminInitialData()).replace(/<\//g, '<\\/')}</script>
<script>
const A = '/api/admin';
const TIERS = ['discovered','S+','S','A+','A','A-','B+','B','C'];

// Read initial data embedded in the page (no server call needed!)
const initData = JSON.parse(document.getElementById('initData').textContent);

/**
 * sp — 切换页面选项卡
 * 点击侧边栏按钮时调用，显示对应页面并触发数据加载
 */
function sp(n) {
  document.querySelectorAll('.side-nav button').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelector('.side-nav button[data-p="'+n+'"]').classList.add('active');
  document.getElementById('p-'+n).classList.add('active');
  if(n==='models') rM();
  if(n==='health') rH();
  if(n==='stats') rS();
  if(n==='providers'){rP();rPP();}
}

/**
 * api — 调用管理后台 API
 * @param {string} p - API 路径后缀
 * @param {object} o - fetch 选项
 * @returns {Promise<object>} 解析后的 JSON 响应
 */
async function api(p,o={}) {
  // [Fix 2026-06-24] 移除硬编码 'sk-free-llm-api-provider' 字符串比对 — 之前 db.js 已修复硬编码默认值
  const keyEl = document.getElementById('serverKey');
  const key = keyEl ? keyEl.textContent : '';
  const h={'Content-Type':'application/json'};
  if(key && key.startsWith('sk-')) h['Authorization']='Bearer '+key;
  const opts={credentials:'same-origin',...o};
  opts.headers={...h,...(o.headers||{})};
  opts.body=opts.body?JSON.stringify(opts.body):undefined;
  const r=await fetch(A+p,opts);
  const ct=r.headers.get('content-type')||'';
  if(ct.includes('json')) return r.json();
  const text=await r.text();
  try{return JSON.parse(text);}catch{return {};}
}
/**
 * t — 显示 Toast 通知
 * @param {string} m - 消息文本
 * @param {string} tp - 类型：'succ' 或 'err'
 */
function t(m,tp='succ'){const e=document.getElementById('toast');e.textContent=m;e.className='toast show '+tp;clearTimeout(e._t);e._t=setTimeout(()=>e.classList.remove('show'),3000);}
/**
 * esc — HTML 转义，防止 XSS
 * @param {*} s - 输入字符串
 * @returns {string} 转义后的安全 HTML
 */
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
/**
 * jsesc — JavaScript 字符串转义（用于内联事件处理器）
 * @param {*} s - 输入字符串
 * @returns {string} 转义后的安全 JS 字符串
 */
function jsesc(s){return String(s).replace(/\\\\/g,'\\\\\\\\').replace(/'/g,"\\'").replace(/"/g,'\\\\u0022').replace(/\\\\n/g,'\\\\\\\\n').replace(/\\\\r/g,'\\\\\\\\r');}
/**
 * copyKey — 复制服务器 API Key 到剪贴板
 */
function copyKey(){const k=document.getElementById('serverKey').textContent;navigator.clipboard.writeText(k).then(()=>t('Key 已复制')).catch(()=>t('复制失败'));}
/**
 * logout — 登出管理后台，跳转到登录页
 */
function logout(){fetch('/api/admin/logout',{method:'POST'}).then(()=>window.location.href='/admin/login').catch(()=>window.location.href='/admin/login');}

/**
 * loadSK — 加载服务器 Key 和当前用户名到页面元素中
 */
async function loadSK(){
  document.getElementById('serverKey').textContent = initData.serverApiKey || '(not configured)';
  const userEl = document.getElementById('curUser');
  if (userEl) userEl.textContent = initData.adminUsername || 'admin';
}

// ── 提供商页面 ──

/**
 * rP — 渲染提供商列表
 * 获取配置、健康状态、测试模型后，渲染所有提供商的卡片布局
 */
async function rP() {
  const el = document.getElementById('providerList');
  if (!el) return;
  // [Fix 2026-06-24] 启动时立即替换 loading 占位符，并添加错误显示调试信息
  el.innerHTML = '<div class="empty" id="rpDebug">加载中…</div>';
  try {
    // 从服务端获取最新配置
    const cfg = await api('/config');
    const pr = cfg.allProviders || initData.allProviders || [];
    const em = cfg.enabledProviders || initData.enabledProviders || {};
    // 从 API 获取完整 Key（initData 中的 Key 已掩码）
    if (cfg.apiKeys) _fullKeyCache = cfg.apiKeys;
    const km = cfg.apiKeys || initData.apiKeys || {};
    const hl = await api('/health').catch(()=>({}));
    const hm = {}; if (hl.providers) for (const p of hl.providers) hm[p.key] = p;
    // 获取测试模型配置
    const tm = cfg.testModels || initData.testModels || {};
    // 只渲染有 API Key 的提供商
    const providersWithKeys = pr.filter(p => {
      const ks = km[p.key] || [];
      return (Array.isArray(ks) ? ks : [ks]).length > 0;
    });
    el.innerHTML = providersWithKeys.map(p => {
      const en = em[p.key] !== false;
      const ks = km[p.key] || [];
      const h = hm[p.key];
      const st = h ? h.status : 'unknown';
      const stColor = st === 'up' ? 'var(--green)' : st === 'down' ? 'var(--red)' : 'var(--mut)';
      const keyCount = (Array.isArray(ks) ? ks : [ks]).length;
      return '<div class="row">' +
        '<div class="pi">' +
          '<div class="pi-top">' +
            '<label class="tog"><input type="checkbox" ' + (en ? 'checked' : '') + ' onchange="togP(\\'' + jsesc(p.key) + '\\',this.checked)"><span class="sl"></span></label>' +
            '<span class="pn">' + esc(p.name) + '</span>' +
            '<span class="dot ' + st + '"></span>' +
            '<span class="pi-count">' + keyCount + ' 个密钥</span>' +
            '<div class="pi-actions">' +
              '<button class="btn btn-sm" onclick="tP(\\'' + jsesc(p.key) + '\\')">测试</button>' +
              '<button class="btn btn-sm" onclick="dP(\\'' + jsesc(p.key) + '\\')">发现模型</button>' +
            '</div>' +
          '</div>' +
          '<div class="kl">' +
            ((Array.isArray(ks) ? ks : [ks]).map(k => {
              const ks2 = typeof k === 'string' ? k : (k.key || k);
              const nt = typeof k === 'object' && k.notes ? k.notes : '';
              const shortKey = ks2.slice(0,8) + '...' + ks2.slice(-4);
              const dotColor = st === 'up' ? 'var(--green)' : st === 'down' ? 'var(--red)' : 'var(--mut)';
              const stText = st === 'up' ? '健康' : st === 'down' ? '无效' : '未知';
              return '<div class="ke">' +
                '<span class="dot" style="background:' + dotColor + ';width:8px;height:8px;border-radius:50%;flex-shrink:0"></span>' +
                '<span class="kid">' + esc(shortKey) + '</span>' +
                '<span class="kn' + (!nt ? ' kn-empty' : '') + '" onclick="edn(this,\\'' + jsesc(p.key) + '\\',\\'' + jsesc(ks2) + '\\')">' + (esc(nt) || '添加备注...') + '</span>' +
                '<span class="kt">' + stText + '</span>' +
                '<span class="ka">' +
                  '<button class="ka-edit" onclick="edn(this.closest(\\'.ke\\').querySelector(\\'.kn\\'),\\'' + jsesc(p.key) + '\\',\\'' + jsesc(ks2) + '\\')">✏️</button>' +
                  '<button onclick="tsk(\\'' + jsesc(p.key) + '\\',\\'' + jsesc(ks2) + '\\')">检查</button>' +
                  '<button class="ka-del" onclick="dk(\\'' + jsesc(p.key) + '\\',\\'' + jsesc(ks2) + '\\')">移除</button>' +
                '</span></div>';
            }).join('')) +
          '</div>' +
          '<div style="display:flex;gap:6px;align-items:center;margin-top:6px">' +
            '<span style="font-size:13px;color:var(--mut)">测试模型:</span>' +
            '<input type="text" value="' + esc(tm[p.key] || '') + '" placeholder="auto" style="flex:1;max-width:200px;font-size:13px;background:var(--bg);border:1px solid var(--b2);border-radius:4px;color:var(--text);padding:2px 6px" onchange="stm(\\'' + jsesc(p.key) + '\\',this.value)">' +
          '</div>' +
        '</div></div>';
    }).join('') || '<div class="empty">没有配置的提供商</div>';
    const sel = document.getElementById('nkp');
    if (sel) {
      let opts = '<option value="">选择...</option>' + pr.map(p => '<option value="' + p.key + '">' + esc(p.name) + '</option>').join('');
      // 底部固定显示"自定义供应商"选项
      opts += '<option value="__custom__">自定义供应商</option>';
      sel.innerHTML = opts;
    }
    // 更新侧边栏模型 badge（静态 + 发现，去重）
    const mb = document.getElementById('mb');
    if (mb) {
      const modelIds = new Set();
      const allSm = cfg.allStaticModels || [];
      const allDisc = cfg.discoveredModels || [];
      for (const [k, v] of Object.entries(km)) {
        if (Array.isArray(v) && v.length > 0) {
          for (const m of allSm.filter(m => m[5] === k)) modelIds.add(m[0]);
          for (const m of allDisc.filter(m => m.provider === k)) modelIds.add(m.id);
        }
      }
      mb.textContent = modelIds.size > 0 ? String(modelIds.size) : '';
    }
  } catch(e) {
    // [Fix 2026-06-24] 显示更详细的错误信息
    el.innerHTML = '<div class="empty" style="color:var(--red)">加载失败: ' + (e?.message || e) + '<br><small style="color:var(--mut)">请按 F12 打开开发者工具查看 Network 标签</small></div>';
    console.error('[rP] error:', e?.message, e?.stack);
    t('加载失败: ' + (e?.message || e), 'err');
  }
}
/**
 * togP — 切换提供商启用/禁用状态
 * @param {string} k - 提供商 key
 * @param {boolean} e - 是否启用
 */
async function togP(k,e){await api('/config',{method:'PUT',body:{toggleProvider:{key:k,enabled:e}}});t((e?'启用':'禁用')+' '+k);}
/**
 * rPP — 渲染提供商优先级列表
 */
async function rPP(){
  const el=document.getElementById('priorityList');if(!el)return;
  try{
    const cfg=await api('/config');
    const pr=cfg.allProviders||[];
    const pp=cfg.providerPriorities||{};
    const ak=cfg.apiKeys||{};
    // 只显示有 API Key 的提供商
    const withKeys=pr.filter(p=>{const k=ak[p.key];return Array.isArray(k)&&k.length>0;});
    if(withKeys.length===0){el.innerHTML='<div style="color:var(--dim);font-size:14px">暂无已配置的提供商</div>';return;}
    el.innerHTML=withKeys.map(p=>{
      const val=pp[p.key]!==undefined?pp[p.key]:'';
      return '<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--b2)">'+
        '<span style="flex:1;font-weight:500">'+esc(p.name)+'</span>'+
        '<input type="number" min="0" max="999" value="'+val+'" placeholder="默认"'+
        ' style="width:70px;padding:4px 8px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-size:14px;text-align:center"'+
        ' onchange="setPP(\\''+jsesc(p.key)+'\\',this.value)"'+
        ' onkeydown="if(event.key===\\'Enter\\')this.blur()">'+
        (val!==''?'<button class="btn btn-sm" onclick="delPP(\\''+jsesc(p.key)+'\\')" title="恢复默认" style="padding:2px 8px;font-size:12px">✕</button>':'')+
        '</div>';
    }).join('');
  }catch(e){el.innerHTML='<div style="color:var(--red)">加载失败</div>';}
}
/**
 * setPP — 设置提供商优先级
 */
async function setPP(k,v){const n=v===''?null:Number(v);if(n!==null&&(isNaN(n)||n<0))return;if(n===null){await delPP(k);return;}await api('/provider-priority',{method:'POST',body:{provider:k,priority:n}});t('优先级已设置');}
/**
 * delPP — 删除提供商优先级（恢复默认）
 */
async function delPP(k){await api('/provider-priority',{method:'DELETE',body:{provider:k}});t('已恢复默认');rPP();}
/**
 * tP — 测试提供商连接
 * @param {string} k - 提供商 key
 */
async function tP(k){t('测试中...');const r=await api('/providers/'+k+'/test',{method:'POST'});t(r.success?(k+' ✅ '+r.latency+'ms'):(k+' ❌ '+(r.error||'失败')),r.success?'succ':'err');setTimeout(rP,2000);}
/**
 * dP — 发现提供商下的可用模型
 * @param {string} k - 提供商 key
 */
async function dP(k){
  document.getElementById('discoverModal').classList.add('show');
  document.getElementById('dr').innerHTML='<p style="color:var(--dim)">查询中...</p>';
  const r=await api('/providers/'+k+'/discover',{method:'POST'}),ms=r.models||[];
  document.getElementById('dr').innerHTML=ms.length===0?'<p style="color:var(--dim)">未发现模型</p>':'<p>发现 '+ms.length+' 个</p><table><thead><tr><th>ID</th><th>所有者</th></tr></thead><tbody>'+ms.map(m=>'<tr><td style="font-family:monospace;font-size:13px">'+esc(m.id)+'</td><td>'+esc(m.owned_by||'-')+'</td></tr>').join('')+'</tbody></table>';
}
/**
 * cDM — 关闭发现模型模态框
 */
function cDM(){document.getElementById('discoverModal').classList.remove('show');}
/**
 * aPK — 添加提供商 API Key
 * 从下拉框和输入框中读取提供商和 Key 值，调用 API 添加
 */
/**
 * aPK — 添加 API Key 或自定义供应商
 * 选择"自定义供应商"时，创建自定义提供商 + 添加 Key
 */
async function aPK(){const p=document.getElementById('nkp').value,k=document.getElementById('nkv').value,n=document.getElementById('nkNotes').value;if(p==='__custom__'){const name=document.getElementById('cpName').value.trim();const url=document.getElementById('cpUrl').value.trim();if(!name||!url){t('请填写自定义供应商的名称和 URL','err');return;}if(!k){t('请填写 Key','err');return;}await api('/custom-provider',{method:'POST',body:{name,baseUrl:url,apiKey:k,notes:n}});document.getElementById('cpName').value='';document.getElementById('cpUrl').value='';document.getElementById('nkv').value='';document.getElementById('nkNotes').value='';t('自定义供应商已添加');rP();return;}if(!p||!k){t('请选择提供商并输入Key','err');return;}await api('/provider-key',{method:'POST',body:{provider:p,key:k,notes:n}});document.getElementById('nkv').value='';document.getElementById('nkNotes').value='';t('Key 已添加');rP();}
/**
 * onNKPChange — 选择自定义供应商时显示额外字段
 */
function onNKPChange(){const el=document.getElementById('customProviderFields');if(!el)return;el.style.display=document.getElementById('nkp').value==='__custom__'?'':'none';}
/**
 * stm — 设置提供商的测试模型
 * @param {string} prov - 提供商 key
 * @param {string} mid - 模型 ID（空值表示自动选择）
 */
async function stm(prov,mid){await api('/test-model',{method:'POST',body:{provider:prov,testModel:mid}});}

// ── Key 级操作 ──

/**
 * dk — 删除指定提供商的 API Key
 * @param {string} prov - 提供商 key
 * @param {string} key - API Key（可以是掩码后的）
 */
async function dk(prov,key){const fk=_resolveKey(prov,key);if(!confirm('删除此 Key?'))return;await api('/provider-key/delete',{method:'POST',body:{provider:prov,key:fk}});t('Key 已删除');rP();}
/**
 * skn — 更新 API Key 的备注信息（内部自动解析完整 Key）
 * @param {string} prov - 提供商 key
 * @param {string} key - API Key（可以是掩码后的）
 * @param {string} notes - 备注文本
 */
async function skn(prov,key,notes){const fk=_resolveKey(prov,key);await api('/provider-key/notes',{method:'POST',body:{provider:prov,key:fk,notes}});}
/**
 * tsk — 测试单个 API Key 的连接性
 * @param {string} prov - 提供商 key
 * @param {string} key - API Key（可以是掩码后的）
 */
async function tsk(prov,key){const fk=_resolveKey(prov,key);t('测试中...');const r=await api('/provider-key/test',{method:'POST',body:{provider:prov,key:fk}});t(r.success?'✅ '+r.latency+'ms':'❌ '+(r.error||'失败'),r.success?'succ':'err');rP();}

// ── 备注编辑 ──

/**
 * edn — 启用备注内联编辑
 * 将备注文本替换为可编辑输入框
 * @param {HTMLElement} el - 被点击的备注元素
 * @param {string} prov - 提供商 key
 * @param {string} key - API Key
 */
function edn(el,prov,key){
  if(el.tagName==='INPUT')return;
  const cur=el.textContent==='添加备注...'?'':el.textContent;
  const inp=document.createElement('input');
  inp.className='kn-input';
  inp.value=cur;
  inp.onblur=function(){svkn(prov,key,this);};
  inp.onkeydown=function(e){if(e.key==='Enter')this.blur();if(e.key==='Escape'){this.dataset.cancel='1';this.blur();}};
  el.replaceWith(inp);
  inp.focus();
  inp.select();
}
/**
 * svkn — 保存备注内容到服务器
 * @param {string} prov - 提供商 key
 * @param {string} key - API Key
 * @param {HTMLInputElement} inp - 输入框元素
 */
async function svkn(prov,key,inp){
  if(inp.dataset.cancel==='1'){inp.dataset.cancel='';ednRestore(inp,prov,key);return;}
  const val=inp.value.trim();
  await skn(prov,key,val);
  // 更新 initData 以便下次渲染时显示新备注
  const km=initData.apiKeys||{};
  const pks=km[prov]||[];
  let found=false;
  for(let i=0;i<pks.length;i++){
    const k=pks[i];
    const k2=typeof k==='string'?k:(k.key||k);
    if(k2===key){
      if(typeof k==='object'){k.notes=val;found=true;}
      else{pks[i]={key,notes:val};found=true;}
      break;
    }
  }
  if(!found){pks.push({key,notes:val});}
  ednRestore(inp,prov,key);
}
/**
 * ednRestore — 恢复备注编辑为只读文本
 * @param {HTMLInputElement} inp - 输入框元素
 * @param {string} prov - 提供商 key
 * @param {string} key - API Key
 */
function ednRestore(inp,prov,key){
  const span=document.createElement('span');
  const km=initData.apiKeys||{};
  const pks=km[prov]||[];
  let nt='';
  for(const k of pks){
    const k2=typeof k==='string'?k:(k.key||k);
    if(k2===key){nt=typeof k==='object'&&k.notes?k.notes:'';break;}
  }
  span.className='kn'+(!nt?' kn-empty':'');
  span.textContent=nt||'添加备注...';
  span.onclick=function(){edn(this,prov,key);};
  inp.replaceWith(span);
}

// ── 模型页面 ──

/**
 * rM — 渲染模型列表
 * 获取静态模型和发现模型，渲染带开关和分级下拉框的表格
 */
async function rM(){
  const d=await api('/config'),sm=d.allStaticModels||[],disc=d.discoveredModels||[],ms=d.modelStates||{},mt=d.modelTiers||{},ak=d.apiKeys||{};
  // 只显示已配置 API Key 的提供商的模型
  const keyedProviders=new Set(Object.keys(ak).filter(k=>Array.isArray(ak[k])&&ak[k].length>0));
  const gk=m=>{const p=m.provider||m[5]||'',id=m.id||m[0]||'';return p?p+'/'+id:id;};
  const ie=m=>ms[gk(m)]!==false,gt=m=>mt[gk(m)]||m.tier||m[2]||'';
  // 静态模型 + 发现模型，按 model ID 去重（静态优先）
  const seenIds=new Set();
  const all=[];
  for(const m of sm){const id=m[0];if(!seenIds.has(id)){seenIds.add(id);all.push({id,name:m[1],tier:m[2],provider:m[5],source:'静态'});}}
  for(const m of disc){const id=m.id;if(!seenIds.has(id)){seenIds.add(id);all.push({id,name:m.id,tier:'discovered',provider:m.provider,source:'发现'});}}
  const filtered=all.filter(m=>keyedProviders.has(m.provider));
  // 按等级排序（S+ 在最前，C 在最后）
  const tierOrder={'S+':0,'S':1,'A+':2,'A':3,'A-':4,'B+':5,'B':6,'C':7,'discovered':8,'':9};
  filtered.sort((a,b)=>{
    const ta=mt[gk(a)]||a.tier||a[2]||'';
    const tb=mt[gk(b)]||b.tier||b[2]||'';
    const oa=tierOrder[ta]??9,ob=tierOrder[tb]??9;
    if(oa!==ob)return oa-ob;
    return (a.id||a[0]||'').localeCompare(b.id||b[0]||'');
  });
  // 更新侧边栏 badge
  const badge=document.getElementById('mb');
  if(badge) badge.textContent=filtered.length>0?String(filtered.length):'';
  // 更新页眉文案
  document.getElementById('mc').textContent=filtered.length>0?'已配置 '+filtered.length+' 个（共 '+all.length+'）':'暂无配置';
  document.getElementById('mtb').innerHTML=filtered.length>0?filtered.map(m=>{const t=gt(m),en=ie(m),p=m.provider||m[5]||'';return '<tr><td><label class="tog"><input type="checkbox" '+(en?'checked':'')+' onchange="tM(\\''+jsesc(m.id||m[0])+'\\',\\''+jsesc(p)+'\\',this.checked)"><span class="sl"></span></label></td><td style="font-family:monospace;font-size:var(--font-sm)">'+esc(m.id||m[0])+'</td><td>'+esc(m.name||m[1])+'</td><td><select class="ts" onchange="sT(\\''+jsesc(m.id||m[0])+'\\',\\''+jsesc(p)+'\\',this.value)">'+TIERS.map(t2=>'<option value="'+t2+'" '+(t===t2?'selected':'')+'>'+t2+'</option>').join('')+'</select></td><td>'+esc(p)+'</td><td style="color:var(--dim)">'+m.source+'</td></tr>';}).join(''):'<tr><td colspan="6" class="empty">暂无模型，请先在「提供商」页签添加 API Key</td></tr>';
}
/**
 * tM — 切换单个模型的启用/禁用状态
 * @param {string} mid - 模型 ID
 * @param {string} prov - 提供商
 * @param {boolean} en - 是否启用
 */
async function tM(mid,prov,en){await api('/model-state',{method:'POST',body:{modelId:mid,provider:prov,enabled:en}});}
/**
 * sT — 设置模型的分级（tier）
 * @param {string} mid - 模型 ID
 * @param {string} prov - 提供商
 * @param {string} t - 分级名称
 */
/**
 * 待保存的等级变更 { 'provider/modelId': tier }
 */
const _pendingTiers={};
/**
 * sT — 记录模型等级变更（不立即保存）
 */
function sT(mid,prov,t){
  const key=prov+'/'+mid;
  _pendingTiers[key]={modelId:mid,provider:prov,tier:t};
  // 标记为已修改（黄色边框）
  const sel=event?.target;if(sel)sel.classList.add('ts-modified');
  const btn=document.getElementById('saveTiersBtn');
  if(btn)btn.style.display='';
}
/**
 * saveTiers — 批量保存所有待提交的等级变更
 */
async function saveTiers(){
  const entries=Object.values(_pendingTiers);
  if(entries.length===0)return;
  let ok=0,fail=0;
  for(const e of entries){
    try{await api('/model-tier',{method:'POST',body:{modelId:e.modelId,provider:e.provider,tier:e.tier}});ok++;}
    catch{fail++;}
  }
  // 移除所有已修改标记
  document.querySelectorAll('.ts-modified').forEach(el=>el.classList.remove('ts-modified'));
  // 清空待保存列表
  for(const k of Object.keys(_pendingTiers))delete _pendingTiers[k];
  const btn=document.getElementById('saveTiersBtn');
  if(btn)btn.style.display='none';
  t('等级已保存: '+ok+' 个'+(fail>0?', 失败 '+fail+' 个':''));
}
/**
 * filterModels — 按关键词过滤模型列表
 * @param {string} q - 搜索关键词（匹配模型 ID、名称、提供商）
 */
function filterModels(q){
  const query=(q||'').toLowerCase().trim();
  const rows=document.querySelectorAll('#mtb tr');
  for(const row of rows){
    if(!query){row.style.display='';continue;}
    const text=row.textContent.toLowerCase();
    row.style.display=text.includes(query)?'':'none';
  }
}

// ── Playground 测试页面 ──

/**
 * pgSend — 发送 Playground 聊天消息（支持流式和非流式）
 */
/**
 * pgClear — 清空测试页签聊天记录
 */
/** 对话历史（保持上下文） */
let _pgHistory=[];
function pgClear(){document.getElementById('pgChat').innerHTML='';_pgHistory=[];}
async function pgSend(){
  const inp=document.getElementById('pgInput'),chat=document.getElementById('pgChat');
  const msg=inp.value.trim();if(!msg)return;
  const model=document.getElementById('pgModel').value,stream=document.getElementById('pgStream').checked;
  const apiKey=document.getElementById('serverKey').textContent;
  chat.innerHTML+='<div class="pg-msg user">'+esc(msg)+'</div>';
  inp.value='';chat.scrollTop=chat.scrollHeight;

  const msgDiv=document.createElement('div');msgDiv.className='pg-msg assistant';
  if(stream){msgDiv.innerHTML='<span class="pg-cursor">▊</span>';}
  else{msgDiv.innerHTML='<div class="load" style="margin:4px 0"></div>';}
  chat.appendChild(msgDiv);chat.scrollTop=chat.scrollHeight;

  // 构建带上下文的 messages
  _pgHistory.push({role:'user',content:msg});
  const messages=[..._pgHistory];

  try{
    const resp=await fetch('/v1/chat/completions',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+apiKey},
      body:JSON.stringify({model,messages,stream,max_tokens:1024})
    });
    const provider=resp.headers.get('X-Provider')||'unknown';
    if(!resp.ok){msgDiv.innerHTML='<span style="color:var(--red)">HTTP '+resp.status+'</span>';chat.scrollTop=chat.scrollHeight;return;}

    if(stream){
      const reader=resp.body.getReader();const decoder=new TextDecoder();let done=false,buffer='',contents='',streamModel='',streamError='';
      while(!done){
        const {value,done:dn}=await reader.read();done=dn;
        buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});
        const lines=buffer.split('\\n');
        buffer=lines.pop()||'';
        for(const line of lines){
          if(!line.startsWith('data:')||line==='data: [DONE]')continue;
          try{
            const d=JSON.parse(line.slice(5));
            if(d.error)streamError=d.error;
            if(d.model)streamModel=d.model;
            const delta=d.choices?.[0]?.delta?.content||'';
            if(delta){contents+=delta;msgDiv.innerHTML=esc(contents)+'<span class="pg-cursor">▊</span>';chat.scrollTop=chat.scrollHeight;}
          }catch{}
        }
      }
      if(streamError)msgDiv.innerHTML='<span style="color:var(--red)">'+esc(streamError)+'</span>';
      else{msgDiv.innerHTML=esc(contents||'(无内容)')+'<div class="pg-meta"><span style="color:var(--blue)">'+esc(provider)+'</span> · '+esc(streamModel||model)+'</div>';if(contents)_pgHistory.push({role:'assistant',content:contents});}
    }else{
      const d=await resp.json();
      if(d.error){msgDiv.innerHTML='<span style="color:var(--red)">'+esc(d.error)+'</span>';}
      else{
        const c=d.choices?.[0]?.message?.content||'(无响应)';
        msgDiv.innerHTML=esc(c)+'<div class="pg-meta"><span style="color:var(--blue)">'+esc(provider)+'</span> · '+esc(d.model||model)+'</div>';
        if(c&&c!=='(无响应)')_pgHistory.push({role:'assistant',content:c});
      }
    }
  }catch(e){msgDiv.innerHTML='<span style="color:var(--red)">请求失败: '+esc(e.message)+'</span>';}
  chat.scrollTop=chat.scrollHeight;
}

// ── 健康页面 ──

/**
 * rH — 渲染健康检查结果卡片网格
 * 根据提供商评分（70+/40+）显示不同颜色状态
 */
async function rH(){
  const g=document.getElementById('healthGrid');g.innerHTML='<div class="load" style="margin:18px auto"></div>';
  const d=await api('/health'),pr=d.providers||[];
  if(!pr.length){g.innerHTML='<div class="empty">无数据，请先运行健康检查</div>';return;}
  g.innerHTML=pr.map(p=>{const cls=p.score>=70?'gd':(p.score>=40?'ok':'bd'),lat=p.avgLatency>0?Math.round(p.avgLatency)+'ms':'--';return '<div class="hc"><div class="nm"><span class="dot '+p.status+'"></span>'+esc(p.name)+'</div><div class="sc '+cls+'">'+p.score+'</div><div class="st">'+(p.status==='up'?'在线':p.status)+' · '+lat+'</div></div>';}).join('');
}
/**
 * rHC — 手动触发一次健康检查
 */
async function rHC(){t('健康检查中...');await api('/health',{method:'POST'});t('完成');rH();}

// ── 统计页面 ──

/**
 * rS — 渲染使用统计数据
 * 显示总请求数、成功/失败数量、成功率和各提供商使用分布
 */
async function rS(){
  const el=document.getElementById('statsContent');el.innerHTML='<div class="load" style="margin:18px auto"></div>';
  try{
    const r=await fetch('/stats');const d=await r.json();
    const total=d.total_requests||0,succ=d.successful_requests||0,fail=d.failed_requests||0,rate=total>0?Math.round(succ/total*100):0;
    const usage=d.provider_usage||{};
    el.innerHTML='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-bottom:12px">'+
      '<div class="hc"><div class="st">总请求</div><div style="font-size:22px;font-weight:700">'+total+'</div></div>'+
      '<div class="hc"><div class="st">成功</div><div style="font-size:22px;font-weight:700;color:var(--green)">'+succ+'</div></div>'+
      '<div class="hc"><div class="st">失败</div><div style="font-size:22px;font-weight:700;color:var(--red)">'+fail+'</div></div>'+
      '<div class="hc"><div class="st">成功率</div><div style="font-size:22px;font-weight:700;color:'+(rate>=80?'var(--green)':(rate>=50?'var(--yellow)':'var(--red)'))+'">'+rate+'%</div></div>'+
    '</div>'+
    (Object.keys(usage).length?'<table><thead><tr><th>提供商</th><th>使用次数</th></tr></thead><tbody>'+Object.entries(usage).map(([k,v])=>'<tr><td>'+esc(k)+'</td><td>'+v+'</td></tr>').join('')+'</tbody></table>':'<div class="empty">暂无使用数据</div>');
  }catch(e){el.innerHTML='<div class="empty">无法获取统计: '+esc(e.message)+'</div>';}
}

// ── 设置页面 ──

/**
 * rK — 重新生成服务器 API Key
 */
async function rK(){if(!confirm('确定重新生成 API Key？'))return;const r=await api('/key/regenerate',{method:'POST'});if(r.key){document.getElementById('serverKey').textContent=r.key;t('新 Key: '+r.key.slice(0,12)+'...');}}
/**
 * cPw — 修改管理员密码
 */
async function cPw(){const c=document.getElementById('curPw').value,p=document.getElementById('newPw').value;if(!c||!p){t('请填写所有字段','err');return;}if(p.length<6){t('至少6位','err');return;}const r=await api('/change-password',{method:'POST',body:{currentPassword:c,newPassword:p}});if(r.success){document.getElementById('curPw').value='';document.getElementById('newPw').value='';t('密码已修改');}else{t(r.error||'修改失败','err');}}
/**
 * cU — 修改管理员用户名
 */
async function cU(){const n=document.getElementById('newUser').value;if(!n){t('请输入新用户名','err');return;}if(n.length<3||n.length>32){t('用户名长度 3-32 位','err');return;}if(!/^[a-zA-Z0-9_]+$/.test(n)){t('用户名只能包含字母、数字和下划线','err');return;}const r=await api('/change-username',{method:'POST',body:{newUsername:n}});if(r.success){document.getElementById('curUser').textContent=n;document.getElementById('newUser').value='';t('用户名已修改');}else{t(r.error||'修改失败','err');}}

/**
 * themeToggle — 切换深色/亮色主题
 */
function themeToggle(){const b=document.body;b.classList.toggle('light');localStorage.setItem('flapTheme',b.classList.contains('light')?'light':'dark');}

// ── 全局缓存 ──

/** initData 中的 Key 已掩码，需要从 API 获取完整 Key 用于操作 */
let _fullKeyCache = {};

/**
 * _resolveKey — 从缓存中查找完整 API Key
 * @param {string} prov - 提供商 key
 * @param {string} maskedKey - 掩码后的 Key (sk-abc123...xyz9)
 * @returns {string} 完整 Key
 */
function _resolveKey(prov, maskedKey) {
  const keys = _fullKeyCache[prov] || [];
  for (const k of (Array.isArray(keys) ? keys : [keys])) {
    const ks = typeof k === 'string' ? k : (k.key || '');
    const masked = ks.length > 12 ? ks.slice(0, 8) + '...' + ks.slice(-4) : ks;
    if (masked === maskedKey) return ks;
  }
  return maskedKey; // fallback: 若未找到则用原值
}

// Init
// 恢复上次选择的主题
if(localStorage.getItem('flapTheme')==='light')document.body.classList.add('light');
// [Fix 2026-06-24] 立即同步填充 serverKey（不要等 async loadSK），避免一直显示 "loading..."
(function initServerKey(){
  const k = initData.serverApiKey;
  if (k) document.getElementById('serverKey').textContent = k;
})();
if (initData.adminUsername) {
  const userEl = document.getElementById('curUser');
  if (userEl) userEl.textContent = initData.adminUsername;
}
loadSK().catch(err => console.warn('[Admin] loadSK 失败:', err));
rP().catch(err => console.warn('[Admin] rP 失败:', err));
rPP().catch(err => console.warn('[Admin] rPP 失败:', err));
document.addEventListener('keydown',e=>{if(e.key==='Escape')cDM();});
</script>

<!-- 修改密码弹窗（默认密码登录后强制显示） -->
<div id="changePwModal" class="modal-o">
  <div class="modal" style="min-width:380px;max-width:420px">
    <h3>⚠️ 请修改默认密码</h3>
    <p style="color:var(--text-secondary);margin-bottom:18px;font-size:var(--font-sm)">您正在使用默认密码登录，为了安全请立即修改。</p>
    <div style="margin-bottom:10px">
      <label style="font-size:var(--font-sm);color:var(--dim);display:block;margin-bottom:4px">当前密码</label>
      <input id="cpwCur" type="password" value="admin123" style="width:100%;padding:8px 12px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-size:var(--font-base)">
    </div>
    <div style="margin-bottom:10px">
      <label style="font-size:var(--font-sm);color:var(--dim);display:block;margin-bottom:4px">新密码（至少 6 位）</label>
      <input id="cpwNew" type="password" placeholder="输入新密码" style="width:100%;padding:8px 12px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-size:var(--font-base)">
    </div>
    <div style="margin-bottom:18px">
      <label style="font-size:var(--font-sm);color:var(--dim);display:block;margin-bottom:4px">确认新密码</label>
      <input id="cpwConfirm" type="password" placeholder="再次输入新密码" style="width:100%;padding:8px 12px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-size:var(--font-base)">
    </div>
    <div id="cpwErr" style="color:var(--red);font-size:var(--font-sm);margin-bottom:12px;display:none"></div>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button onclick="closeChangePwModal()" class="btn">稍后再说</button>
      <button onclick="doChangeDefaultPw()" class="btn btn-p">确认修改</button>
    </div>
  </div>
</div>
<script>
// 检测默认密码提示（弹窗 DOM 已就绪）
if(new URLSearchParams(window.location.search).get('change_password')==='1'){
  document.getElementById('changePwModal').classList.add('show');
}
function closeChangePwModal(){document.getElementById('changePwModal').classList.remove('show');history.replaceState(null,'',location.pathname);}
async function doChangeDefaultPw(){
  const cur=document.getElementById('cpwCur').value;
  const pw=document.getElementById('cpwNew').value;
  const cf=document.getElementById('cpwConfirm').value;
  const errEl=document.getElementById('cpwErr');
  errEl.style.display='none';
  if(!pw||pw.length<6){errEl.textContent='新密码至少 6 位';errEl.style.display='block';return;}
  if(pw===cur){errEl.textContent='新密码不能与默认密码相同';errEl.style.display='block';return;}
  if(pw!==cf){errEl.textContent='两次输入的密码不一致';errEl.style.display='block';return;}
  const r=await fetch('/api/admin/change-password',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({currentPassword:cur,newPassword:pw})});
  const d=await r.json();
  if(d.success){
    document.getElementById('changePwModal').classList.remove('show');
    history.replaceState(null,'',location.pathname);
  }else{
    errEl.textContent=d.error||'修改失败';errEl.style.display='block';
  }
}
// 回车提交
document.getElementById('cpwNew').addEventListener('keydown',e=>{if(e.key==='Enter')doChangeDefaultPw();});
document.getElementById('cpwConfirm').addEventListener('keydown',e=>{if(e.key==='Enter')doChangeDefaultPw();});
</script>
</body>
</html>`;
}

// ============================================================================
// Admin API Handlers
// ============================================================================

// ============================================================================
// Auth helpers
// ============================================================================

/**
 * parseCookies — 解析 HTTP 请求中的 Cookie 头
 * @param {import('http').IncomingMessage} req - HTTP 请求对象
 * @returns {object} 键值对形式的 cookies
 */
function parseCookies(req) {
  const cookieHeader = req.headers.cookie || '';
  const cookies = {};
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.substring(0, eq).trim();
    const val = part.substring(eq + 1).trim();
    cookies[key] = val;
  }
  return cookies;
}

function setSessionCookie(req, res, token) {
  const isHttps = req.socket && req.socket.encrypted;
  res.setHeader('Set-Cookie', `flap_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400${isHttps ? '; Secure' : ''}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'flap_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}

/**
 * checkAuth — 验证请求是否具有有效的管理员 Session
 * 返回 session 对象（有效）或 null（无效）
 * @param {import('http').IncomingMessage} req - HTTP 请求对象
 * @returns {object|null} session 对象或 null
 */
function checkAuth(req) {
  const cookies = parseCookies(req);
  const token = cookies.flap_session;
  if (!token) return null;
  try {
    return validateSession(token);
  } catch {
    return null;
  }
}

// ============================================================================
// Login page HTML
// ============================================================================
/**
 * getLoginHtml — 生成登录页面 HTML
 * @param {string} [error=''] - 可选的错误消息
 * @returns {string} 登录页 HTML 字符串
 */
function getLoginHtml(error) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>登录 — free-llm-api-provider Admin</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0d1117; color: #c9d1d9;
    display: flex; align-items: center; justify-content: center;
    min-height: 100vh;
  }
  .login-box {
    background: #161b22; border: 1px solid #30363d; border-radius: 12px;
    padding: 40px; width: 380px; max-width: 90vw;
  }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .subtitle { color: #8b949e; font-size: 13px; margin-bottom: 28px; }
  label { display: block; font-size: 13px; color: #8b949e; margin-bottom: 4px; }
  input[type="text"], input[type="password"] {
    width: 100%; padding: 10px 12px; margin-bottom: 16px;
    background: #0d1117; border: 1px solid #30363d; border-radius: 6px;
    color: #c9d1d9; font-size: 14px;
  }
  input:focus { outline: none; border-color: #58a6ff; }
  button {
    width: 100%; padding: 10px; border: none; border-radius: 6px;
    background: #58a6ff; color: #fff; font-size: 14px; font-weight: 600;
    cursor: pointer;
  }
  button:hover { opacity: 0.9; }
  .error {
    background: #3a1a1a; border: 1px solid #f85149; border-radius: 6px;
    padding: 10px 14px; margin-bottom: 16px; color: #f85149; font-size: 13px;
  }
  .hint { color: #8b949e; font-size: 12px; margin-top: 16px; text-align: center; }
</style>
</head>
<body>
<div class="login-box">
  <h1>free-llm-api-provider</h1>
  <p class="subtitle">管理面板登录</p>
  ${error ? '<div class="error">' + error + '</div>' : ''}
  <form method="POST" action="/api/admin/login">
    <label for="username">用户名</label>
    <input type="text" id="username" name="username" placeholder="admin" required autofocus>
    <label for="password">密码</label>
    <input type="password" id="password" name="password" placeholder="密码" required>
    <button type="submit">登录</button>
  </form>
  <p class="hint">默认用户名: admin | 密码见启动日志</p>
</div>
</body>
</html>`;
}

function jsonResponse(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// ============================================================================
// Model state toggle
// ============================================================================
async function handleModelState(req, res) {
  const body = await readJsonBody(req);
  const { modelId, provider, enabled } = body;
  if (!modelId) return jsonResponse(res, 400, { error: 'Missing modelId' });
  setModelEnabled(modelId, provider || '', enabled !== false);
  jsonResponse(res, 200, { success: true });
}

// ============================================================================
// Custom provider management
// ============================================================================
async function handleGetCustomProviders(res) {
  const providers = getCustomProviders();
  const result = [];
  for (const p of providers) {
    const models = getCustomProviderModels(p.name);
    result.push({
      name: p.name,
      base_url: p.base_url,
      api_key: p.api_key ? p.api_key.substring(0, 8) + '...' : '',
      notes: p.notes || '',
      enabled: p.enabled === 1,
      created_at: p.created_at,
      models: models.map(m => ({ modelId: m.model_id, enabled: m.enabled === 1 })),
    });
  }
  jsonResponse(res, 200, { providers: result });
}

async function handleSaveCustomProvider(req, res) {
  const body = await readJsonBody(req);
  const { name, baseUrl, apiKey, notes } = body;
  if (!name || !baseUrl) return jsonResponse(res, 400, { error: 'Missing name or baseUrl' });
  // Validate name format (alphanumeric, underscore, hyphen, dot)
  if (!/^[a-zA-Z0-9_.\-]{1,64}$/.test(name)) {
    return jsonResponse(res, 400, { error: '名称只能包含字母、数字、下划线、连字符和点，最长 64 位' });
  }
  // Validate URL protocol
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return jsonResponse(res, 400, { error: 'URL 必须以 http:// 或 https:// 开头' });
    }
  } catch {
    return jsonResponse(res, 400, { error: 'URL 格式无效' });
  }
  saveCustomProvider(name, baseUrl, apiKey || '', notes || '');
  jsonResponse(res, 200, { success: true });
}

async function handleDeleteCustomProvider(req, res) {
  const body = await readJsonBody(req);
  if (!body.name) return jsonResponse(res, 400, { error: 'Missing name' });
  deleteCustomProvider(body.name);
  jsonResponse(res, 200, { success: true });
}

async function handleToggleCustomProvider(req, res) {
  const body = await readJsonBody(req);
  if (!body.name) return jsonResponse(res, 400, { error: 'Missing name' });
  setCustomProviderEnabled(body.name, body.enabled !== false);
  jsonResponse(res, 200, { success: true });
}

async function handleAddCustomProviderModel(req, res) {
  const body = await readJsonBody(req);
  const { providerName, modelId } = body;
  if (!providerName || !modelId) return jsonResponse(res, 400, { error: 'Missing providerName or modelId' });
  saveCustomProviderModel(providerName, modelId, body.enabled !== false);
  jsonResponse(res, 200, { success: true });
}

async function handleDeleteCustomProviderModel(req, res) {
  const body = await readJsonBody(req);
  if (!body.providerName || !body.modelId) return jsonResponse(res, 400, { error: 'Missing providerName or modelId' });
  deleteCustomProviderModel(body.providerName, body.modelId);
  jsonResponse(res, 200, { success: true });
}

// ============================================================================
// Password change
// ============================================================================
async function handleChangePassword(req, res) {
  const body = await readJsonBody(req);
  const { currentPassword, newPassword } = body;
  if (!currentPassword || !newPassword) return jsonResponse(res, 400, { error: 'Missing password fields' });
  if (newPassword.length < 6) return jsonResponse(res, 400, { error: '密码至少6位' });

  const username = (req._session && req._session.username) || 'admin';

  const user = verifyAdminLogin(username, currentPassword);
  if (!user) return jsonResponse(res, 403, { error: '当前密码错误' });

  changeAdminPassword(username, newPassword);
  markPasswordChanged(username);
  jsonResponse(res, 200, { success: true, message: '密码已修改' });
}

// Username change
async function handleChangeUsername(req, res) {
  const body = await readJsonBody(req);
  const { newUsername } = body;
  if (!newUsername) return jsonResponse(res, 400, { error: 'Missing username' });
  if (newUsername.length < 3 || newUsername.length > 32) return jsonResponse(res, 400, { error: '用户名长度 3-32 位' });
  if (!/^[a-zA-Z0-9_]+$/.test(newUsername)) return jsonResponse(res, 400, { error: '用户名只能包含字母、数字和下划线' });

  const oldUsername = (req._session && req._session.username) || 'admin';

  const ok = changeAdminUsername(oldUsername, newUsername);
  if (!ok) return jsonResponse(res, 400, { error: '用户名已存在' });

  jsonResponse(res, 200, { success: true, message: '用户名已修改' });
}

// ============================================================================
// Test model configuration
// ============================================================================
async function handleSetTestModel(req, res) {
  const body = await readJsonBody(req);
  const { provider, testModel } = body;
  if (!provider) return jsonResponse(res, 400, { error: 'Missing provider' });
  setProviderTestModel(provider, testModel || '');
  jsonResponse(res, 200, { success: true });
}

// ============================================================================
// Model tier assignment
// ============================================================================
async function handleSetModelTier(req, res) {
  const body = await readJsonBody(req);
  const { modelId, provider, tier } = body;
  if (!modelId) return jsonResponse(res, 400, { error: 'Missing modelId' });
  setModelTier(modelId, provider || '', tier || '');
  jsonResponse(res, 200, { success: true });
}

async function handleGetProviderPriorities(res) {
  const priorities = getAllProviderPriorities();
  jsonResponse(res, 200, { priorities });
}

async function handleSetProviderPriority(req, res) {
  const body = await readJsonBody(req);
  const { provider, priority } = body;
  if (!provider) return jsonResponse(res, 400, { error: 'Missing provider' });
  if (priority === undefined || priority === null) return jsonResponse(res, 400, { error: 'Missing priority' });
  setProviderPriority(provider, Number(priority));
  jsonResponse(res, 200, { success: true });
}

async function handleDeleteProviderPriority(req, res) {
  const body = await readJsonBody(req);
  if (!body.provider) return jsonResponse(res, 400, { error: 'Missing provider' });
  deleteProviderPriority(body.provider);
  jsonResponse(res, 200, { success: true });
}

async function handleGetConfig(res) {
  const config = loadConfig();
  const allProviders = Object.entries(sources)
    .filter(([_, v]) => v.url && !v.cliOnly && !v.zenOnly)
    .map(([k, v]) => ({ key: k, name: v.name, url: v.url }));

  // Build enabled providers map (use SQLite)
  const enabledProviders = {};
  for (const [k, v] of Object.entries(sources)) {
    if (v.url && !v.cliOnly && !v.zenOnly) {
      try { enabledProviders[k] = isProviderEnabled(k); }
      catch { enabledProviders[k] = config.providers?.[k]?.enabled !== false; }
    }
  }

  // Get all static models in flat format
  const allStaticModels = MODELS.filter(m => {
    const src = sources[m[5]];
    return src && src.url && !src.cliOnly;
  });

  // Get API keys from SQLite + environment variables
  let apiKeys = {};
  try { apiKeys = getAllProviderKeys(); } catch {}
  // Add environment variable keys if not in database
  for (const [k, src] of Object.entries(sources)) {
    if (!src.url || src.cliOnly || src.zenOnly) continue;
    if (apiKeys[k] && apiKeys[k].length > 0) continue;
    const envKeys = getAllApiKeys(config, k);
    if (envKeys.length > 0) {
      apiKeys[k] = envKeys.map(key => ({ key, notes: '(环境变量)' }));
    }
  }

  // Get model states and custom providers
  let modelStates = {};
  let customProviders = [];
  let modelTiers = {};
  try { modelStates = getAllModelStates(); } catch {}
  try { customProviders = getCustomProviders(); } catch {}
  try { modelTiers = getAllModelTiers(); } catch {}

  // Get test model configs
  let testModels = {};
  for (const [k] of Object.entries(sources)) {
    try { const tm = getProviderTestModel(k); if (tm) testModels[k] = tm; } catch {}
  }

  // Get provider priorities
  let providerPriorities = {};
  try { providerPriorities = getAllProviderPriorities(); } catch {}

  jsonResponse(res, 200, {
    serverApiKey: getServerApiKey(config),
    adminUsername: getAdminUsername(),
    apiKeys,
    enabledProviders,
    allProviders,
    allStaticModels,
    discoveredModels: getAllDiscoveredModels(),
    modelStates,
    customProviders,
    modelTiers,
    testModels,
    providerPriorities,
  });
}

async function handleUpdateConfig(req, res) {
  const body = await readJsonBody(req);

  // Toggle provider enabled/disabled
  if (body.toggleProvider) {
    const { key, enabled } = body.toggleProvider;
    try { setProviderEnabled(key, enabled); } catch {}
    // Also update JSON config for sync
    const config = loadConfig();
    if (!config.providers) config.providers = {};
    if (!config.providers[key]) config.providers[key] = {};
    config.providers[key].enabled = enabled;
    saveConfig(config);
    return jsonResponse(res, 200, { success: true });
  }

  jsonResponse(res, 400, { error: 'Unknown action' });
}

async function handleAddProviderKey(req, res) {
  const body = await readJsonBody(req);
  const { provider, key, notes } = body;
  if (!provider || !key) {
    return jsonResponse(res, 400, { error: 'Missing provider or key' });
  }
  const config = loadConfig();
  addApiKey(config, provider, key, notes);
  saveConfig(config);
  jsonResponse(res, 200, { success: true });
}

async function handleRemoveProviderKey(req, res) {
  const body = await readJsonBody(req);
  const { provider } = body;
  if (!provider) {
    return jsonResponse(res, 400, { error: 'Missing provider' });
  }
  const config = loadConfig();
  removeApiKey(config, provider);
  saveConfig(config);
  jsonResponse(res, 200, { success: true });
}

async function handleRemoveSingleProviderKey(req, res) {
  const body = await readJsonBody(req);
  const { provider, key } = body;
  if (!provider || !key) return jsonResponse(res, 400, { error: 'Missing provider or key' });
  removeProviderKey(provider, key);
  jsonResponse(res, 200, { success: true });
}

async function handleUpdateKeyNotes(req, res) {
  const body = await readJsonBody(req);
  const { provider, key, notes } = body;
  if (!provider || !key) return jsonResponse(res, 400, { error: 'Missing provider or key' });
  updateProviderKeyNotes(provider, key, notes || '');
  jsonResponse(res, 200, { success: true });
}

async function handleTestSingleKey(req, res) {
  const body = await readJsonBody(req);
  const { provider, key } = body;
  if (!provider || !key) return jsonResponse(res, 400, { error: 'Missing provider or key' });

  const source = sources[provider];
  if (!source || !source.url) {
    if (provider.startsWith('custom_')) {
      const cp = getCustomProviders().find(p => ('custom_' + p.name) === provider);
      if (!cp || !cp.base_url) return jsonResponse(res, 400, { error: 'Unknown provider' });
      return runKeyTest(res, cp.base_url, provider, key);
    }
    return jsonResponse(res, 400, { error: 'Unknown provider' });
  }
  
  await runKeyTest(res, source.url, provider, key);
}


// [Fix 2026-06-24] 共享默认测试模型映射，供 "测试" 和 "检查" 两个按钮使用
const DEFAULT_TEST_MODELS = {
  nvidia: 'meta/llama-3.1-8b-instruct',
  groq: 'llama-3.1-8b-instant',
  cerebras: 'llama3.1-8b',
  googleai: 'gemma-3-27b-it',
  deepinfra: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
  codestral: 'codestral-latest',
  zai: 'zai/glm-4.5-flash',
  sambanova: 'Meta-Llama-3.1-8B-Instruct',
  openrouter: 'meta-llama/llama-3.1-8b-instruct:free',
  together: 'meta-llama/Llama-3.1-8B-Instruct-Turbo',
  fireworks: 'accounts/fireworks/models/llama-v3-8b',
  hyperbolic: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
  scaleway: 'llama-3.1-8b-instruct',
  qwen: 'qwen2.5-coder-32b-instruct',
  siliconflow: 'Qwen/Qwen2.5-Coder-32B-Instruct',
  chutes: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
  iflow: 'qwen3-32b',
  opencode: 'llama-3.1-8b-instant',
};

async function runKeyTest(res, url, provider, apiKey) {
  let modelId = getProviderTestModel(provider) || DEFAULT_TEST_MODELS[provider] || '';
  // Fallback: use first model from provider's model list
  if (!modelId) {
    const models = getModelsByProvider(provider);
    modelId = models.length > 0 ? models[0][0] : '';
  }
  if (!modelId) {
    return jsonResponse(res, 200, { success: false, error: 'No test model configured for this provider' });
  }
  const t0 = performance.now();
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: modelId, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
      signal: AbortSignal.timeout(15000),
    });
    const ms = Math.round(performance.now() - t0);
    jsonResponse(res, 200, { success: resp.ok || resp.status === 429, latency: ms, status: resp.status });
  } catch (err) {
    jsonResponse(res, 200, { success: false, error: err.message, latency: Math.round(performance.now() - t0) });
  }
}

async function handleRegenerateKey(res) {
  const newKey = regenerateServerApiKey();
  jsonResponse(res, 200, { key: newKey });
}

async function handleTestProvider(req, res, providerKey) {
  const config = loadConfig();
  let url = '';
  let apiKeys = [];

  // Check if it's a custom provider
  if (providerKey.startsWith('custom_')) {
    const cpName = providerKey.slice(7);
    const cp = getCustomProviders().find(p => p.name === cpName);
    if (!cp || !cp.base_url) return jsonResponse(res, 400, { error: 'Unknown custom provider' });
    url = cp.base_url;
    if (cp.api_key) apiKeys.push(cp.api_key);
  } else {
    const source = sources[providerKey];
    if (!source || !source.url) return jsonResponse(res, 400, { error: 'Unknown provider' });
    url = source.url;
    apiKeys = getAllApiKeys(config, providerKey);
  }

  if (apiKeys.length === 0) {
    return jsonResponse(res, 400, { error: 'No API key configured' });
  }

  let modelId = getProviderTestModel(providerKey) || DEFAULT_TEST_MODELS[providerKey] || '';
  if (!modelId) {
    const models = getModelsByProvider(providerKey);
    modelId = models.length > 0 ? models[0][0] : '';
  }
  if (!modelId) {
    return jsonResponse(res, 200, { success: false, error: 'No test model configured for this provider' });
  }

  const t0 = performance.now();

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKeys[0]}`,
      },
      body: JSON.stringify({ model: modelId, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
      signal: AbortSignal.timeout(15000),
    });

    const ms = Math.round(performance.now() - t0);
    // Trigger health check in background so status shows in UI
    runHealthCheck(config).catch(() => {});
    
    if (resp.ok || resp.status === 429) {
      return jsonResponse(res, 200, { success: true, latency: ms, status: resp.status });
    }
    return jsonResponse(res, 200, { success: false, error: `HTTP ${resp.status}`, latency: ms });
  } catch (err) {
    runHealthCheck(config).catch(() => {});
    return jsonResponse(res, 200, { success: false, error: err.message, latency: Math.round(performance.now() - t0) });
  }
}

async function handleDiscoverModels(req, res, providerKey) {
  let apiKey = '';
  let realProviderKey = providerKey;

  if (providerKey.startsWith('custom_')) {
    const cpName = providerKey.slice(7);
    const cp = getCustomProviders().find(p => p.name === cpName);
    if (cp && cp.api_key) apiKey = cp.api_key;
    // For custom providers, use the name as the provider key for discovery
    realProviderKey = cpName;
  } else {
    const keys = getAllApiKeys(loadConfig(), providerKey);
    if (keys.length > 0) apiKey = keys[0];
  }

  if (!apiKey) return jsonResponse(res, 200, { models: [] });

  const models = await discoverProviderModels(realProviderKey, apiKey);
  jsonResponse(res, 200, { models });
}

async function handleHealth(req, res) {
  if (req.method === 'POST') {
    const config = loadConfig();
    await runHealthCheck(config);
  }

  const healthy = getHealthyProviders();
  const providers = healthy.map(h => ({
    key: h.key,
    name: sources[h.key]?.name || h.key,
    score: h.score,
    status: h.status,
    avgLatency: h.avgLatency,
    quota: h.quota,
  }));

  jsonResponse(res, 200, { providers });
}

// ============================================================================
// Route dispatcher
// ============================================================================
// ============================================================================
// Parse URL-encoded form body
// ============================================================================
function parseFormBody(req) {
  return new Promise(resolve => {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > MAX_BODY_SIZE) { req.destroy(); resolve({}); } });
    req.on('end', () => {
      const params = {};
      for (const part of body.split('&')) {
        const eq = part.indexOf('=');
        if (eq === -1) continue;
        params[decodeURIComponent(part.substring(0, eq))] = decodeURIComponent(part.substring(eq + 1).replace(/\+/g, ' '));
      }
      resolve(params);
    });
  });
}

// ============================================================================
/**
 * requireAuth — 中间件：请求页面须经过身份验证
 * 若验证通过则返回 session，否则返回 401 并显示登录页
 * @param {import('http').IncomingMessage} req - HTTP 请求对象
 * @param {import('http').ServerResponse} res - HTTP 响应对象
 * @returns {object|null} session 对象或 null
 */
function requireAuth(req, res) {
  const session = checkAuth(req);
  if (session) return session;
  // For page requests, redirect to login
  res.writeHead(302, { 'Location': '/admin/login' });
  res.end();
  return null;
}

function requireAuthApi(req, res) {
  // Accept session cookie OR server API key (for fetch() compatibility)
  const session = checkAuth(req);
  if (session) return session;
  // Also check Bearer token against server API key (constant-time comparison)
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    try {
      const key = dbGetServerApiKey();
      if (key && token.length === key.length) {
        const crypto = require('crypto');
        if (crypto.timingSafeEqual(Buffer.from(token), Buffer.from(key))) {
          return { username: 'admin', auth: 'apikey' };
        }
      }
    } catch {}
  }
  jsonResponse(res, 401, { error: 'Unauthorized', message: '请先登录' });
  return null;
}

/**
 * handleAdminRequest — 管理面板请求路由分发器
 * 使用路由表模式替代 if-else 链，将路径-方法-处理三元组集中定义
 * @param {URL} parsedUrl - 解析后的 URL 对象
 * @param {import('http').IncomingMessage} req - HTTP 请求对象
 * @param {import('http').ServerResponse} res - HTTP 响应对象
 * @returns {Promise<boolean>} 是否已处理该请求（true = 已处理，false = 非本模块路由）
 */
async function handleAdminRequest(parsedUrl, req, res) {
  const path = parsedUrl.pathname;
  const method = req.method;

  // ------------------------------------------------------------------
  // 路由表辅助：匹配请求方法与路径
  // ------------------------------------------------------------------
  const match = (routeMethod, reqMethod, routePath) => {
    if (routeMethod !== reqMethod) return false;
    if (typeof routePath === 'string') return routePath === path;
    if (routePath instanceof RegExp) return routePath.test(path);
    return false;
  };

  // ------------------------------------------------------------------
  // 公用路由表（无需身份验证）
  // ------------------------------------------------------------------
  const publicRoutes = [
    { method: 'GET', path: '/admin/login', handler: async () => {
      // 已登录则重定向到管理面板
      if (checkAuth(req)) {
        res.writeHead(302, { 'Location': '/admin' }); res.end();
        return true;
      }
      // POST 重定向到登录页自身
      if (req.method === 'POST') {
        res.writeHead(302, { 'Location': '/admin/login' }); res.end();
        return true;
      }
      // 显示登录页（含错误提示）
      const error = parsedUrl.query?.error ? '用户名或密码错误' : null;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getLoginHtml(error));
      return true;
    }},
    { method: 'POST', path: '/api/admin/login', handler: async () => {
      const ct = (req.headers['content-type'] || '').toLowerCase();
      let username, password;
      if (ct.includes('json')) {
        const json = await readJsonBody(req);
        username = json.username || 'admin';
        password = json.password || '';
      } else {
        const form = await parseFormBody(req);
        username = form.username || 'admin';
        password = form.password || '';
      }
      const user = verifyAdminLogin(username, password);
      if (user) {
        const token = createSession(user.username);
        setSessionCookie(req, res, token);
        // 默认密码登录时在 URL 中标记，前端显示提醒弹窗（可关闭）
        const redirect = isUsingDefaultPassword(user.username) ? '/admin?change_password=1' : '/admin';
        res.writeHead(302, { 'Location': redirect }); res.end();
      } else {
        res.writeHead(302, { 'Location': '/admin/login?error=1' }); res.end();
      }
      return true;
    }},
    { method: 'POST', path: '/api/admin/logout', handler: async () => {
      const cookies = parseCookies(req);
      if (cookies.flap_session) {
        try { deleteSession(cookies.flap_session); } catch {}
      }
      clearSessionCookie(res);
      res.writeHead(302, { 'Location': '/admin/login' }); res.end();
      return true;
    }},
  ];

  // 执行公用路由匹配
  for (const route of publicRoutes) {
    if (match(route.method, method, route.path)) {
      return await route.handler();
    }
  }

  // ------------------------------------------------------------------
  // 受保护页面路由（需身份验证）
  // ------------------------------------------------------------------
  const protectedPageRoutes = [
    { methods: ['GET'], paths: ['/admin', '/admin/', '/admin/index.html'], handler: async () => {
      const session = requireAuth(req, res);
      if (!session) return true;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getAdminHtml());
      return true;
    }},
  ];

  for (const route of protectedPageRoutes) {
    if (route.methods.includes(method) && route.paths.includes(path)) {
      return await route.handler();
    }
  }

  // ------------------------------------------------------------------
  // Admin API 路由（需要 API 身份验证）
  // ------------------------------------------------------------------
  if (path.startsWith('/api/admin/')) {
    const apiPath = path.slice('/api/admin'.length) || '/';

    const session = requireAuthApi(req, res);
    if (!session) return true;
    req._session = session;

    try {
      const apiRoutes = [
        { method: 'GET',   path: '/config',              handler: () => handleGetConfig(res) },
        { method: 'PUT',   path: '/config',              handler: () => handleUpdateConfig(req, res) },
        { method: 'POST',  path: '/key/regenerate',      handler: () => handleRegenerateKey(res) },
        { method: 'ALL',   path: '/health',              handler: () => handleHealth(req, res) },
        { method: 'POST',  path: '/provider-key',        handler: () => handleAddProviderKey(req, res) },
        { method: 'DELETE',path: '/provider-key',        handler: () => handleRemoveProviderKey(req, res) },
        { method: 'POST',  path: '/provider-key/delete', handler: () => handleRemoveSingleProviderKey(req, res) },
        { method: 'POST',  path: '/provider-key/notes',  handler: () => handleUpdateKeyNotes(req, res) },
        { method: 'POST',  path: '/provider-key/test',   handler: () => handleTestSingleKey(req, res) },
        { method: 'POST',  path: '/model-state',         handler: () => handleModelState(req, res) },
        { method: 'POST',  path: '/test-model',          handler: () => handleSetTestModel(req, res) },
        { method: 'POST',  path: '/model-tier',          handler: () => handleSetModelTier(req, res) },
        { method: 'GET',   path: '/custom-provider',     handler: () => handleGetCustomProviders(res) },
        { method: 'POST',  path: '/custom-provider',     handler: () => handleSaveCustomProvider(req, res) },
        { method: 'DELETE',path: '/custom-provider',     handler: () => handleDeleteCustomProvider(req, res) },
        { method: 'POST',  path: '/custom-provider/delete', handler: () => handleDeleteCustomProvider(req, res) },
        { method: 'POST',  path: '/custom-provider/toggle', handler: () => handleToggleCustomProvider(req, res) },
        { method: 'POST',  path: '/custom-provider/model',  handler: () => handleAddCustomProviderModel(req, res) },
        { method: 'DELETE',path: '/custom-provider/model',  handler: () => handleDeleteCustomProviderModel(req, res) },
        { method: 'POST',  path: '/custom-provider/model/delete', handler: () => handleDeleteCustomProviderModel(req, res) },
        { method: 'POST',  path: '/change-password',     handler: () => handleChangePassword(req, res) },
        { method: 'POST',  path: '/change-username',     handler: () => handleChangeUsername(req, res) },
        { method: 'GET',   path: '/provider-priority',   handler: () => handleGetProviderPriorities(res) },
        { method: 'POST',  path: '/provider-priority',   handler: () => handleSetProviderPriority(req, res) },
        { method: 'DELETE', path: '/provider-priority',  handler: () => handleDeleteProviderPriority(req, res) },
      ];

      // 精确路径匹配
      for (const route of apiRoutes) {
        const methodOk = route.method === 'ALL' || route.method === method;
        if (methodOk && route.path === apiPath) {
          return await route.handler();
        }
      }

      // 动态路由：/providers/:key/test, /providers/:key/discover
      const testMatch = apiPath.match(/^\/providers\/([\w-]+)\/test$/);
      if (testMatch && method === 'POST') {
        await handleTestProvider(req, res, testMatch[1]);
        return true;
      }
      const discoverMatch = apiPath.match(/^\/providers\/([\w-]+)\/discover$/);
      if (discoverMatch && method === 'POST') {
        await handleDiscoverModels(req, res, discoverMatch[1]);
        return true;
      }

      jsonResponse(res, 404, { error: 'Admin API endpoint not found' });
      return true;
    } catch (err) {
      console.error('[Admin] Error:', err.message);
      jsonResponse(res, 500, { error: err.message });
      return true;
    }
  }

  return false;
}

module.exports = {
  handleAdminRequest,
  discoverProviderModels,
  getAllDiscoveredModels,
};
