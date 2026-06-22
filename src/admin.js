/**
 * Admin Web UI — browser-based provider management
 *
 * Serves a single-page admin panel at /admin and REST API at /api/admin/*
 */

const { loadConfig, saveConfig, addApiKey, removeApiKey, getAllApiKeys, getServerApiKey } = require('./config');
const { sources, MODELS, getModelsByProvider } = require('./models');
const { runHealthCheck, getHealthyProviders } = require('./health-checker');
const { verifyAdminLogin, createSession, validateSession, deleteSession, getDiscoveredModels: dbGetDiscoveredModels, saveDiscoveredModels, getAllProviderKeys, addProviderKey, updateProviderKeyNotes, removeProviderKey, removeAllProviderKeys, setProviderEnabled, isProviderEnabled, regenerateServerApiKey, setModelEnabled, getAllModelStates, getCustomProviders, saveCustomProvider, deleteCustomProvider, setCustomProviderEnabled, getCustomProviderModels, saveCustomProviderModel, deleteCustomProviderModel, changeAdminPassword, changeAdminUsername, getAdminUsername, getProviderTestModel, setProviderTestModel, setModelTier, getAllModelTiers, getServerApiKey: dbGetServerApiKey } = require('./db');

function getAdminInitialData() {
  const config = loadConfig();
  const allProviders = Object.entries(sources)
    .filter(([_, v]) => v.url && !v.cliOnly)
    .map(([k, v]) => ({ key: k, name: v.name, url: v.url }));
  const serverApiKey = getServerApiKey(config);
  // Embed enabled states
  const enabledProviders = {};
  for (const [k, v] of Object.entries(sources)) {
    if (v.url && !v.cliOnly) {
      try { enabledProviders[k] = isProviderEnabled(k); }
      catch { enabledProviders[k] = config.providers?.[k]?.enabled !== false; }
    }
  }
  // Embed API keys (masked for safety)
  const apiKeys = getAllProviderKeys();
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
  } catch {
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
    req.on('data', chunk => { body += chunk; if (body.length > MAX_BODY_SIZE) { req.destroy(); resolve({}); } });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve({}); }
    });
  });
}

// ============================================================================
// Admin HTML page
// ============================================================================
function getAdminHtml() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>free-llm-api-provider</title>
<style>
  :root {
    --bg: #0d1117;
    --card: #161b22;
    --hover: #1c2333;
    --border: #30363d;
    --b2: #21262d;
    --text: #e6edf3;
    --dim: #8b949e;
    --mut: #6e7681;
    --blue: #58a6ff;
    --blue-bg: rgba(56,139,253,0.08);
    --green: #3fb950;
    --green-bg: rgba(63,185,80,0.08);
    --red: #f85149;
    --red-bg: rgba(248,81,73,0.08);
    --yellow: #d29922;
    --sidebar-w: 220px;
  }
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    background:var(--bg); color:var(--text);
    font-size:15px; line-height:1.5;
    -webkit-font-smoothing:antialiased;
  }

  /* Sidebar */
  .side {
    position:fixed; top:0; left:0; width:var(--sidebar-w); height:100vh;
    background:var(--card); border-right:1px solid var(--border);
    display:flex; flex-direction:column; z-index:50;
  }
  .side-head {
    padding:20px 16px 14px; border-bottom:1px solid var(--border);
    display:flex; align-items:center; gap:10px;
  }
  .side-head .d { width:10px; height:10px; border-radius:50%; background:var(--blue); }
  .side-head h1 { font-size:16px; font-weight:700; letter-spacing:-0.3px; }
  .side-nav { flex:1; padding:8px; overflow-y:auto; }
  .side-nav button {
    display:flex; align-items:center; gap:10px; width:100%;
    padding:9px 12px; border:none; border-radius:6px;
    background:transparent; color:var(--dim); font-size:14px;
    cursor:pointer; transition:0.12s; text-align:left;
  }
  .side-nav button:hover { background:var(--hover); color:var(--text); }
  .side-nav button.active { background:var(--blue-bg); color:var(--blue); font-weight:600; }
  .side-nav .ni { width:18px; text-align:center; flex-shrink:0; font-size:15px; }
  .side-nav .nb {
    margin-left:auto; font-size:11px; padding:1px 8px; border-radius:10px;
    background:var(--border); color:var(--dim);
  }
  .side-foot {
    padding:12px 14px; border-top:1px solid var(--border);
  }
  .side-foot .kl {
    font-size:10px; color:var(--mut); text-transform:uppercase;
    letter-spacing:.6px; margin-bottom:6px;
  }
  .side-foot .kv {
    font-family:'SF Mono','Fira Code',monospace; font-size:11px;
    color:var(--dim); word-break:break-all;
    background:var(--bg); padding:5px 8px; border-radius:4px;
    border:1px solid var(--b2); margin-bottom:6px; line-height:1.4;
  }
  .side-foot .ka { display:flex; gap:6px; }
  .side-foot .ka button {
    flex:1; padding:5px; border:1px solid var(--border); border-radius:4px;
    background:var(--bg); color:var(--dim); font-size:11px; cursor:pointer;
  }
  .side-foot .ka button:hover { background:var(--hover); color:var(--text); }

  /* Main */
  .main { flex:1; margin-left:var(--sidebar-w); min-height:100vh; padding:28px 32px; }
  .page { display:none; }
  .page.active { display:block; }
  .pt { font-size:22px; font-weight:700; margin-bottom:4px; letter-spacing:-0.3px; }
  .pd { color:var(--dim); font-size:14px; margin-bottom:24px; }

  /* Cards */
  .c {
    background:var(--card); border:1px solid var(--border); border-radius:10px;
    padding:18px 20px; margin-bottom:16px;
  }
  .ch {
    display:flex; justify-content:space-between; align-items:center;
    margin-bottom:14px; flex-wrap:wrap; gap:8px;
  }
  .ct { font-size:15px; font-weight:600; }

  /* Status dot */
  .dot {
    display:inline-block; width:8px; height:8px; border-radius:50%;
    margin-right:6px; flex-shrink:0;
  }
  .dot.up { background:var(--green); box-shadow:0 0 6px var(--green); }
  .dot.down,.dot.error { background:var(--red); }
  .dot.unknown { background:var(--mut); }
  .dot.auth_error,.dot.rate_limited { background:var(--yellow); }

  /* Provider row */
  .row {
    display:flex; align-items:flex-start; gap:10px;
    padding:12px 0; border-bottom:1px solid var(--b2);
  }
  .row:last-child { border-bottom:none; }
  .pn { font-weight:600; font-size:14px; min-width:110px; padding-top:2px; }
  .pi { display:flex; flex-direction:column; gap:6px; flex:1; min-width:0; }
  .pi-top { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .pi-status { font-size:13px; color:var(--dim); }

  /* Key entry */
  .ke {
    display:flex; align-items:center; gap:6px; padding:4px 8px;
    background:var(--bg); border:1px solid var(--b2); border-radius:6px;
    flex-wrap:wrap; margin:3px 0;
  }
  .ke .kid {
    font-family:'SF Mono','Fira Code',monospace; font-size:12px;
    color:var(--dim); min-width:130px;
  }
  .ke input {
    background:var(--bg); border:1px solid var(--b2); border-radius:4px;
    color:var(--text); font-size:12px; padding:3px 6px; width:80px;
  }
  .ke input:focus { outline:none; border-color:var(--blue); }
  .ke .ke-actions { display:flex; gap:4px; }
  .ke .ke-actions button {
    padding:2px 8px; border:1px solid var(--b2); border-radius:4px;
    background:var(--card); color:var(--dim); font-size:11px; cursor:pointer;
  }
  .ke .ke-actions button:hover { background:var(--hover); color:var(--text); }
  .ke .ke-actions .ke-del:hover { border-color:var(--red); color:var(--red); }

  /* Buttons */
  .btn {
    padding:6px 14px; border-radius:6px; border:1px solid var(--border);
    background:var(--card); color:var(--text); cursor:pointer;
    font-size:13px; transition:0.12s;
  }
  .btn:hover { background:var(--hover); border-color:var(--dim); }
  .btn-p { background:var(--blue); color:#fff; border-color:var(--blue); font-weight:500; }
  .btn-p:hover { opacity:.9; }
  .btn-d { background:var(--red); color:#fff; border-color:var(--red); }
  .btn-d:hover { opacity:.9; }
  .btn-sm { padding:4px 10px; font-size:12px; }
  .bg { display:flex; gap:6px; flex-wrap:wrap; }

  /* Toggle */
  .tog { position:relative; width:34px; height:20px; display:inline-block; flex-shrink:0; margin-top:1px; }
  .tog input { opacity:0; width:0; height:0; }
  .tog .sl {
    position:absolute; inset:0; background:var(--border);
    border-radius:20px; transition:.2s; cursor:pointer;
  }
  .tog .sl::before {
    content:''; position:absolute; width:14px; height:14px;
    left:3px; bottom:3px; background:var(--text);
    border-radius:50%; transition:.2s;
  }
  .tog input:checked + .sl { background:var(--blue); }
  .tog input:checked + .sl::before { transform:translateX(14px); }

  /* Forms */
  .fr { display:flex; gap:10px; align-items:center; margin-bottom:8px; flex-wrap:wrap; }
  .fr label { font-size:13px; min-width:70px; color:var(--dim); }
  input,select,textarea {
    background:var(--bg); border:1px solid var(--border); border-radius:6px;
    padding:6px 10px; color:var(--text); font-size:13px;
  }
  input:focus,select:focus,textarea:focus { outline:none; border-color:var(--blue); }
  textarea { resize:vertical; font-family:inherit; }

  /* Tables */
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th {
    text-align:left; padding:8px 10px; border-bottom:2px solid var(--border);
    color:var(--dim); font-weight:600; font-size:11px;
    text-transform:uppercase; letter-spacing:.5px;
  }
  td { padding:7px 10px; border-bottom:1px solid var(--b2); vertical-align:middle; }
  tr:hover td { background:var(--hover); }
  .ts {
    background:var(--bg); border:1px solid var(--b2); border-radius:4px;
    color:var(--text); font-size:12px; padding:3px 5px;
  }

  /* Health cards */
  .hg { display:grid; grid-template-columns:repeat(auto-fill,minmax(230px,1fr)); gap:10px; }
  .hc {
    background:var(--card); border:1px solid var(--border); border-radius:8px;
    padding:14px 16px; transition:.12s;
  }
  .hc:hover { border-color:var(--mut); }
  .hc .nm { font-weight:600; font-size:14px; margin-bottom:8px; }
  .hc .sc { font-size:28px; font-weight:700; line-height:1; margin-bottom:6px; }
  .hc .sc.gd { color:var(--green); }
  .hc .sc.ok { color:var(--yellow); }
  .hc .sc.bd { color:var(--red); }
  .hc .st { font-size:12px; color:var(--dim); }

  /* Stats cards */
  .stat-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); gap:10px; margin-bottom:14px; }
  .stat-card {
    background:var(--card); border:1px solid var(--border); border-radius:8px;
    padding:14px 16px;
  }
  .stat-card .lbl { font-size:11px; color:var(--dim); text-transform:uppercase; letter-spacing:.5px; margin-bottom:4px; }
  .stat-card .val { font-size:24px; font-weight:700; }

  /* Toast */
  .toast {
    position:fixed; bottom:20px; right:20px;
    background:var(--card); border:1px solid var(--border); border-radius:8px;
    padding:10px 18px; font-size:13px;
    box-shadow:0 8px 24px rgba(0,0,0,.5); z-index:100;
    display:none; max-width:400px;
  }
  .toast.show { display:block; }
  .toast.succ { border-color:var(--green); }
  .toast.err { border-color:var(--red); }

  .load {
    display:inline-block; width:16px; height:16px;
    border:2px solid var(--border); border-top-color:var(--blue);
    border-radius:50%; animation:spin .6s linear infinite;
  }
  @keyframes spin { to{transform:rotate(360deg)} }
  .empty { text-align:center; padding:40px 20px; color:var(--dim); font-size:14px; }

  /* Modal */
  .modal-o { position:fixed; inset:0; background:rgba(0,0,0,.6); z-index:99; display:none; align-items:center; justify-content:center; }
  .modal-o.show { display:flex; }
  .modal {
    background:var(--card); border:1px solid var(--border); border-radius:12px;
    padding:24px; min-width:420px; max-width:90vw; max-height:80vh; overflow-y:auto;
  }
  .modal h3 { font-size:16px; margin-bottom:12px; }

  /* Playground */
  .pg-chat { display:flex; flex-direction:column; gap:10px; max-height:450px; overflow-y:auto; padding:4px 0; }
  .pg-msg { padding:12px 16px; border-radius:8px; font-size:14px; line-height:1.6; white-space:pre-wrap; }
  .pg-msg.user { background:var(--blue-bg); border:1px solid rgba(88,166,255,.15); align-self:flex-end; max-width:80%; }
  .pg-msg.assistant { background:var(--bg); border:1px solid var(--border); }
  .pg-msg .pg-meta { font-size:11px; color:var(--mut); margin-top:6px; padding-top:6px; border-top:1px solid var(--b2); }
  .pg-inp { display:flex; gap:10px; margin-top:4px; }
  .pg-inp textarea { flex:1; min-height:50px; max-height:130px; font-size:14px; }
  .pg-inp button { align-self:flex-end; }

  /* Scrollbar */
  ::-webkit-scrollbar { width:6px; height:6px; }
  ::-webkit-scrollbar-track { background:transparent; }
  ::-webkit-scrollbar-thumb { background:var(--border); border-radius:3px; }
  ::-webkit-scrollbar-thumb:hover { background:var(--dim); }

  @media (max-width:768px) {
    :root { --sidebar-w: 52px; }
    .side-head h1,.side-nav button span,.side-nav .nb,.side-foot .kl,.side-foot .kv,.side-foot .ka { display:none; }
    .side-head { padding:12px; justify-content:center; }
    .side-nav button { justify-content:center; padding:8px; }
    .main { margin-left:52px; padding:16px; }
    .hg,.stat-grid { grid-template-columns:1fr; }
    .modal { min-width:unset; margin:10px; }
    .ke { flex-direction:column; align-items:stretch; }
    .ke .kid { min-width:auto; }
  }
</style>
</head>
<body>
<div class="app" style="display:flex">
  <!-- Sidebar -->
  <aside class="side">
    <div class="side-head"><span class="d"></span><h1>flap</h1></div>
    <nav class="side-nav" id="sideNav">
      <button class="active" data-p="providers" onclick="sp('providers')"><span class="ni">⚡</span><span>提供商</span></button>
      <button data-p="models" onclick="sp('models')"><span class="ni">⊞</span><span>模型</span><span class="nb" id="mb">238</span></button>
      <button data-p="playground" onclick="sp('playground')"><span class="ni">▶</span><span>测试</span></button>
      <button data-p="health" onclick="sp('health')"><span class="ni">♥</span><span>健康</span></button>
      <button data-p="stats" onclick="sp('stats')"><span class="ni">📊</span><span>统计</span></button>
      <button data-p="custom" onclick="sp('custom')"><span class="ni">+</span><span>自定义</span></button>
      <button data-p="settings" onclick="sp('settings')"><span class="ni">⚙</span><span>设置</span></button>
    </nav>
    <div class="side-foot">
      <div class="kl">API Key</div>
      <div class="kv" id="serverKey">loading...</div>
      <div class="ka"><button onclick="copyKey()">复制</button><button onclick="logout()" style="color:var(--red)">退出</button></div>
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
        <div class="ct" style="margin-bottom:10px">添加 API Key</div>
        <div class="fr"><label>提供商</label><select id="nkp" style="flex:1"><option value="">选择...</option></select></div>
        <div class="fr"><label>Key</label><input type="password" id="nkv" placeholder="sk-..." style="flex:1"></div>
        <button class="btn btn-p" onclick="aPK()">添加</button>
      </div>
    </div>

    <!-- Page: Models -->
    <div class="page" id="p-models">
      <div class="pt">模型目录</div>
      <div class="pd">启用/禁用模型，设置等级影响 tier 路由</div>
      <div class="c">
        <div class="ch"><span class="ct">所有模型</span><span style="font-size:11px;color:var(--dim)" id="mc"></span></div>
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
            <option value="tier-splus">tier-splus</option>
            <option value="tier-s">tier-s</option>
            <option value="tier-aplus">tier-aplus</option>
            <option value="tier-a">tier-a</option>
            <option value="tier-b" selected>tier-b</option>
          </select>
          <label style="min-width:auto;margin-left:4px">流式</label>
          <label class="tog"><input type="checkbox" id="pgStream" checked><span class="sl"></span></label>
        </div>
        <div id="pgChat" class="pg-chat" style="min-height:200px;max-height:500px;overflow-y:auto;margin-bottom:10px"></div>
        <div class="pg-inp">
          <textarea id="pgInput" placeholder="输入消息..." rows="2"></textarea>
          <button class="btn btn-p" onclick="pgSend()">发送</button>
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

    <!-- Page: Custom -->
    <div class="page" id="p-custom">
      <div class="pt">自定义提供商</div>
      <div class="pd">添加私有或自建的 OpenAI 兼容 API</div>
      <div class="c">
        <div class="ch"><span class="ct">列表</span><button class="btn btn-sm" onclick="rCP()">刷新</button></div>
        <div id="cpList"><p class="empty">暂无自定义提供商</p></div>
      </div>
      <div class="c">
        <div class="ct" style="margin-bottom:10px">添加</div>
        <div class="fr"><label>名称</label><input type="text" id="cpN" placeholder="my-proxy" style="flex:1"></div>
        <div class="fr"><label>URL</label><input type="text" id="cpU" placeholder="https://api.example.com" style="flex:1"></div>
        <div class="fr"><label>Key</label><input type="password" id="cpK" placeholder="可选" style="flex:1"></div>
        <button class="btn btn-p" onclick="aCP()">添加</button>
      </div>
    </div>

    <!-- Page: Settings -->
    <div class="page" id="p-settings">
      <div class="pt">设置</div>
      <div class="pd">API Key 管理、密码修改</div>
      <div class="c">
        <div class="ct" style="margin-bottom:4px">重新生成 API Key</div>
        <p style="font-size:12px;color:var(--dim);margin-bottom:10px">生成新 Key 后旧 Key 即时失效</p>
        <button class="btn btn-d" onclick="rK()">重新生成</button>
      </div>
      <div class="c">
        <div class="ct" style="margin-bottom:4px">修改密码</div>
        <p style="font-size:12px;color:var(--dim);margin-bottom:10px">修改管理员登录密码</p>
        <div class="fr"><label>当前</label><input type="password" id="curPw" placeholder="当前密码" style="flex:1"></div>
        <div class="fr"><label>新密码</label><input type="password" id="newPw" placeholder="至少6位" style="flex:1"></div>
        <button class="btn btn-p" onclick="cPw()">修改</button>
      </div>
      <div class="c">
        <div class="ct" style="margin-bottom:4px">修改用户名</div>
        <p style="font-size:12px;color:var(--dim);margin-bottom:10px">当前用户名: <span id="curUser" style="font-weight:600"></span></p>
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

<script id="initData" type="application/json">${JSON.stringify(getAdminInitialData())}</script>
<script>
// Debug: show script is running
document.getElementById('providerList').innerHTML = '<div style="padding:20px;color:#58a6ff">JS 已加载，正在初始化...</div>';

window.onerror = function(msg, url, line) { 
  document.getElementById('providerList').innerHTML = '<div style="padding:20px;color:#f85149">JS 错误: ' + msg + ' (行 ' + line + ')</div>';
  console.error('JS Error:', msg, 'line:', line); 
};
window.addEventListener('unhandledrejection', function(e) { 
  console.error('Unhandled Rejection:', e.reason); 
});
const A = '/api/admin';
const TIERS = ['discovered','S+','S','A+','A','A-','B+','B','C'];

// Read initial data embedded in the page (no server call needed!)
const initData = JSON.parse(document.getElementById('initData').textContent);

function sp(n) {
  document.querySelectorAll('.side-nav button').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelector('.side-nav button[data-p="'+n+'"]').classList.add('active');
  document.getElementById('p-'+n).classList.add('active');
  if(n==='models') rM();
  if(n==='health') rH();
  if(n==='stats') rS();
  if(n==='custom') rCP();
  if(n==='providers') rP();
}

async function api(p,o={}) {
  const key=document.getElementById('serverKey').textContent;
  const h={'Content-Type':'application/json'};
  if(key&&key!=='sk-free-llm-api-provider')h['Authorization']='Bearer '+key;
  const opts={credentials:'same-origin',...o};
  opts.headers={...h,...(o.headers||{})};
  opts.body=opts.body?JSON.stringify(opts.body):undefined;
  const r=await fetch(A+p,opts);
  const ct=r.headers.get('content-type')||'';
  if(ct.includesc('json')) return r.json();
  const text=await r.text();
  try{return JSON.parse(text);}catch{return {};}
}
function t(m,tp='succ'){const e=document.getElementById('toast');e.textContent=m;e.className='toast show '+tp;clearTimeout(e._t);e._t=setTimeout(()=>e.classList.remove('show'),3000);}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function copyKey(){const k=document.getElementById('serverKey').textContent;navigator.clipboard.writeText(k).then(()=>t('Key 已复制'));}
function logout(){fetch('/api/admin/logout',{method:'POST'}).then(()=>window.location.href='/admin/login').catch(()=>window.location.href='/admin/login');}

async function loadSK(){
  document.getElementById('serverKey').textContent = initData.serverApiKey || 'sk-free-llm-api-provider';
  const userEl = document.getElementById('curUser');
  if (userEl) userEl.textContent = initData.adminUsername || 'admin';
}

// Providers
async function rP() {
  const el = document.getElementById('providerList');
  if (!el) return;
  try {
    el.innerHTML = '<div class="load" style="margin:24px auto"></div>';
    const pr = initData.allProviders || [];
    const em = initData.enabledProviders || {};
    const km = initData.apiKeys || {};
    const tm = initData.testModels || {};
    const hl = await api('/health').catch(()=>({}));
    const hm = {}; if (hl.providers) for (const p of hl.providers) hm[p.key] = p;
    el.innerHTML = pr.map(p => {
      const en = em[p.key] !== false;
      const ks = km[p.key] || [];
      const h = hm[p.key];
      const st = h ? h.status : 'unknown';
      const sl = h ? (h.status === 'up' ? '在线' : h.status) : '未检测';
      const tmtm = tm[p.key] || '';
      return '<div class="row">' +
        '<label class="tog"><input type="checkbox" ' + (en ? 'checked' : '') + ' onchange="togP(\\'' + p.key + '\\',this.checked)"><span class="sl"></span></label>' +
        '<div class="pi"><div class="pi-top">' +
          '<span class="pn">' + esc(p.name) + '</span>' +
          '<span class="dot ' + st + '"></span><span class="pi-status">' + sl + '</span>' +
          '<div class="bg" style="margin-left:auto">' +
            '<button class="btn btn-sm" onclick="tP(\\'' + p.key + '\\')">测试</button>' +
            '<button class="btn btn-sm" onclick="dP(\\'' + p.key + '\\')">发现模型</button>' +
          '</div></div>' +
        ((Array.isArray(ks) ? ks : [ks]).map(k => {
          const ks2 = typeof k === 'string' ? k : (k.key || k);
          const nt = typeof k === 'object' && k.notes ? k.notes : '';
          return '<div class="ke">' +
            '<span class="kid">' + esc(ks2.slice(0,8)) + '...' + esc(ks2.slice(-4)) + '</span>' +
            '<input type="text" value="' + esc(nt) + '" placeholder="备注" onchange="skn(\\'' + esc(p.key) + '\\',\\'' + esc(ks2) + '\\',this.value)">' +
            '<div class="ke-actions">' +
              '<button onclick="tsk(\\'' + esc(p.key) + '\\',\\'' + esc(ks2) + '\\')">测</button>' +
              '<button class="ke-del" onclick="dk(\\'' + esc(p.key) + '\\',\\'' + esc(ks2) + '\\')">删</button>' +
            '</div></div>';
        }).join('')) +
        '<div style="display:flex;gap:6px;align-items:center;margin-top:4px">' +
          '<span style="font-size:12px;color:var(--dim)">测试模型:</span>' +
          '<input type="text" value="' + esc(tmtm) + '" placeholder="模型ID" style="flex:1;max-width:200px;font-size:12px" onchange="stm(\\'' + p.key + '\\',this.value)">' +
        '</div></div></div>';
    }).join('') || '<div class="empty">没有配置的提供商</div>';
    const sel = document.getElementById('nkp');
    if (sel) sel.innerHTML = '<option value="">选择...</option>' + pr.map(p => '<option value="' + p.key + '">' + esc(p.name) + '</option>').join('');
  } catch(e) {
    el.innerHTML = '<div class="empty">加载失败: ' + e.message + '</div>';
    console.error('rP error:', e.message, e.stack);
  }
}
async function togP(k,e){await api('/config',{method:'PUT',body:{toggleProvider:{key:k,enabled:e}}});t((e?'启用':'禁用')+' '+k);}
async function tP(k){t('测试中...');const r=await api('/providers/'+k+'/test',{method:'POST'});t(r.success?(k+' ✅ '+r.latency+'ms'):(k+' ❌ '+(r.error||'失败')),r.success?'succ':'err');setTimeout(rP,2000);}
async function dP(k){
  document.getElementById('discoverModal').classList.add('show');
  document.getElementById('dr').innerHTML='<p style="color:var(--dim)">查询中...</p>';
  const r=await api('/providers/'+k+'/discover',{method:'POST'}),ms=r.models||[];
  document.getElementById('dr').innerHTML=ms.length===0?'<p style="color:var(--dim)">未发现模型</p>':'<p>发现 '+ms.length+' 个</p><table><thead><tr><th>ID</th><th>所有者</th></tr></thead><tbody>'+ms.map(m=>'<tr><td style="font-family:monospace;font-size:11px">'+esc(m.id)+'</td><td>'+esc(m.owned_by||'-')+'</td></tr>').join('')+'</tbody></table>';
}
function cDM(){document.getElementById('discoverModal').classList.remove('show');}
async function aPK(){const p=document.getElementById('nkp').value,k=document.getElementById('nkv').value;if(!p||!k){t('请选择提供商并输入Key','err');return;}await api('/provider-key',{method:'POST',body:{provider:p,key:k}});document.getElementById('nkv').value='';t('Key 已添加');rP();}
async function stm(prov,mid){await api('/test-model',{method:'POST',body:{provider:prov,testModel:mid}});}

// Per-key operations
async function dk(prov,key){if(!confirm('删除此 Key?'))return;await api('/provider-key/delete',{method:'POST',body:{provider:prov,key}});t('Key 已删除');rP();}
async function skn(prov,key,notes){await api('/provider-key/notes',{method:'POST',body:{provider:prov,key,notes}});}
async function tsk(prov,key){t('测试中...');const r=await api('/provider-key/test',{method:'POST',body:{provider:prov,key}});t(r.success?'✅ '+r.latency+'ms':'❌ '+(r.error||'失败'),r.success?'succ':'err');rP();}

// Models
async function rM(){
  const d=await api('/config'),sm=d.allStaticModels||[],disc=d.discoveredModels||[],ms=d.modelStates||{},mt=d.modelTiers||{};
  const gk=m=>{const p=m.provider||m[5]||'',id=m.id||m[0]||'';return p?p+'/'+id:id;};
  const ie=m=>ms[gk(m)]!==false,gt=m=>mt[gk(m)]||m.tier||m[2]||'';
  const all=[...sm.map(m=>({id:m[0],name:m[1],tier:m[2],provider:m[5],source:'静态'})),...disc.map(m=>({id:m.id,name:m.id,tier:'discovered',provider:m.provider,source:'发现'}))];
  document.getElementById('mc').textContent='共 '+all.length+' 个';
  document.getElementById('mtb').innerHTML=all.map(m=>{const t=gt(m),en=ie(m),p=m.provider||m[5]||'';return '<tr><td><label class="tog"><input type="checkbox" '+(en?'checked':'')+' onchange="tM(\\''+esc(m.id||m[0])+'\\',\\''+esc(p)+'\\',this.checked)"><span class="sl"></span></label></td><td style="font-family:monospace;font-size:10.5px">'+esc(m.id||m[0])+'</td><td>'+esc(m.name||m[1])+'</td><td><select class="ts" onchange="sT(\\''+esc(m.id||m[0])+'\\',\\''+esc(p)+'\\',this.value)">'+TIERS.map(t2=>'<option value="'+t2+'" '+(t===t2?'selected':'')+'>'+t2+'</option>').join('')+'</select></td><td>'+esc(p)+'</td><td style="color:var(--dim)">'+m.source+'</td></tr>';}).join('');
}
async function tM(mid,prov,en){await api('/model-state',{method:'POST',body:{modelId:mid,provider:prov,enabled:en}});}
async function sT(mid,prov,t){await api('/model-tier',{method:'POST',body:{modelId:mid,provider:prov,tier:t}});}

// Playground
async function pgSend(){
  const inp=document.getElementById('pgInput'),chat=document.getElementById('pgChat');
  const msg=inp.value.trim();if(!msg)return;
  const model=document.getElementById('pgModel').value,stream=document.getElementById('pgStream').checked;
  const apiKey=document.getElementById('serverKey').textContent;
  chat.innerHTML+='<div class="pg-msg user">'+esc(msg)+'</div>';
  inp.value='';chat.scrollTop=chat.scrollHeight;

  const msgDiv=document.createElement('div');msgDiv.className='pg-msg assistant';msgDiv.innerHTML='<div class="load" style="margin:4px 0"></div>';chat.appendChild(msgDiv);chat.scrollTop=chat.scrollHeight;

  try{
    const resp=await fetch('/v1/chat/completions',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+apiKey},
      body:JSON.stringify({model,messages:[{role:'user',content:msg}],stream,max_tokens:1024})
    });
    if(!resp.ok){msgDiv.innerHTML='<span style="color:var(--red)">HTTP '+resp.status+'</span>';chat.scrollTop=chat.scrollHeight;return;}
    
    if(stream){
      const reader=resp.body.getReader();const decoder=new TextDecoder();let done=false,buffer='';
      while(!done){const {value,done:dn}=await reader.read();done=dn;buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});}
      const lines=buffer.split('\\n').filter(l=>l.startsWith('data:')&&l!=='data: [DONE]');
      const contents=lines.map(l=>{try{const d=JSON.parse(l.slice(5));return d.choices?.[0]?.delta?.content||'';}catch{return '';}}).join('');
      msgDiv.innerHTML=esc(contents||'(无内容)')+'<div class="pg-meta">流式: '+esc(model)+'</div>';
    }else{
      const d=await resp.json();
      if(d.error) { msgDiv.innerHTML='<span style="color:var(--red)">'+esc(d.error)+'</span>'; }
      else {
        const c=d.choices?.[0]?.message?.content||'(无响应)';
        msgDiv.innerHTML=esc(c)+'<div class="pg-meta">模型: '+esc(d.model||model)+'</div>';
      }
    }
  }catch(e){msgDiv.innerHTML='<span style="color:var(--red)">请求失败: '+esc(e.message)+'</span>';}
  chat.scrollTop=chat.scrollHeight;
}

// Health
async function rH(){
  const g=document.getElementById('healthGrid');g.innerHTML='<div class="load" style="margin:18px auto"></div>';
  const d=await api('/health'),pr=d.providers||[];
  if(!pr.length){g.innerHTML='<div class="empty">无数据，请先运行健康检查</div>';return;}
  g.innerHTML=pr.map(p=>{const cls=p.score>=70?'gd':(p.score>=40?'ok':'bd'),lat=p.avgLatency>0?Math.round(p.avgLatency)+'ms':'--';return '<div class="hc"><div class="nm"><span class="dot '+p.status+'"></span>'+esc(p.name)+'</div><div class="sc '+cls+'">'+p.score+'</div><div class="st">'+(p.status==='up'?'在线':p.status)+' · '+lat+'</div></div>';}).join('');
}
async function rHC(){t('健康检查中...');await api('/health',{method:'POST'});t('完成');rH();}

// Stats
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

// Custom Providers
async function rCP(){
  const d=await api('/custom-provider'),el=document.getElementById('cpList'),pr=d.providers||[];
  if(!pr.length){el.innerHTML='<p class="empty">暂无自定义提供商</p>';return;}
  el.innerHTML=pr.map(p=>{
    const ms=p.models.map(m=>'<span class="kt" style="cursor:pointer" onclick="tM(\\''+esc(m.modelId)+'\\',\\''+esc(p.name)+'\\','+(!m.enabled)+');rCP()">'+esc(m.modelId)+(m.enabled?'':' ✕')+'</span>').join(' ');
    return '<div class="row"><label class="tog"><input type="checkbox" '+(p.enabled?'checked':'')+' onchange="tc(\\''+esc(p.name)+'\\',this.checked)"><span class="sl"></span></label><div class="pi"><span class="pn">'+esc(p.name)+'</span><span class="kt">'+esc(p.base_url)+'</span></div><div style="margin:4px 0;width:100%">'+ms+'</div><button class="btn btn-sm btn-d" onclick="dc(\\''+esc(p.name)+'\\')">删除</button></div>';
  }).join('');
}
async function aCP(){const n=document.getElementById('cpN').value.trim(),u=document.getElementById('cpU').value.trim(),k=document.getElementById('cpK').value.trim();if(!n||!u){t('请填写名称和URL','err');return;}await api('/custom-provider',{method:'POST',body:{name:n,baseUrl:u,apiKey:k}});document.getElementById('cpN').value='';document.getElementById('cpU').value='';document.getElementById('cpK').value='';t('已添加');rCP();rP();}
async function tc(n,e){await api('/custom-provider/toggle',{method:'POST',body:{name:n,enabled:e}});}
async function dc(n){await api('/custom-provider',{method:'DELETE',body:{name:n}});t('已删除');rCP();rP();}

// Settings
async function rK(){if(!confirm('确定重新生成 API Key？'))return;const r=await api('/key/regenerate',{method:'POST'});if(r.key){document.getElementById('serverKey').textContent=r.key;t('新 Key: '+r.key.slice(0,12)+'...');}}
async function cPw(){const c=document.getElementById('curPw').value,p=document.getElementById('newPw').value;if(!c||!p){t('请填写所有字段','err');return;}if(p.length<6){t('至少6位','err');return;}const r=await api('/change-password',{method:'POST',body:{currentPassword:c,newPassword:p}});if(r.success){document.getElementById('curPw').value='';document.getElementById('newPw').value='';t('密码已修改');}else{t(r.error||'修改失败','err');}}
async function cU(){const n=document.getElementById('newUser').value;if(!n){t('请输入新用户名','err');return;}if(n.length<2){t('用户名至少2位','err');return;}const r=await api('/change-username',{method:'POST',body:{newUsername:n}});if(r.success){document.getElementById('curUser').textContent=n;document.getElementById('newUser').value='';t('用户名已修改');}else{t(r.error||'修改失败','err');}}

// Init
loadSK().then(()=>{rP();rCP();}).catch(()=>{setTimeout(()=>{rP();rCP();},2000);});
document.addEventListener('keydown',e=>{if(e.key==='Escape')cDM();});
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

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `flap_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'flap_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}

/**
 * Check if the request has a valid admin session.
 * Returns the session object if valid, null otherwise.
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
      enabled: p.enabled === 1,
      created_at: p.created_at,
      models: models.map(m => ({ modelId: m.model_id, enabled: m.enabled === 1 })),
    });
  }
  jsonResponse(res, 200, { providers: result });
}

async function handleSaveCustomProvider(req, res) {
  const body = await readJsonBody(req);
  const { name, baseUrl, apiKey } = body;
  if (!name || !baseUrl) return jsonResponse(res, 400, { error: 'Missing name or baseUrl' });
  saveCustomProvider(name, baseUrl, apiKey || '');
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
  jsonResponse(res, 200, { success: true, message: '密码已修改' });
}

// Username change
async function handleChangeUsername(req, res) {
  const body = await readJsonBody(req);
  const { newUsername } = body;
  if (!newUsername) return jsonResponse(res, 400, { error: 'Missing username' });
  if (newUsername.length < 2) return jsonResponse(res, 400, { error: '用户名至少2位' });

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

async function handleGetConfig(res) {
  const config = loadConfig();
  const allProviders = Object.entries(sources)
    .filter(([_, v]) => v.url && !v.cliOnly)
    .map(([k, v]) => ({ key: k, name: v.name, url: v.url }));

  // Build enabled providers map (use SQLite)
  const enabledProviders = {};
  for (const [k, v] of Object.entries(sources)) {
    if (v.url && !v.cliOnly) {
      try { enabledProviders[k] = isProviderEnabled(k); }
      catch { enabledProviders[k] = config.providers?.[k]?.enabled !== false; }
    }
  }

  // Get all static models in flat format
  const allStaticModels = MODELS.filter(m => {
    const src = sources[m[5]];
    return src && src.url && !src.cliOnly;
  });

  // Get API keys from SQLite
  let apiKeys = {};
  try { apiKeys = getAllProviderKeys(); } catch {}

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
  const { provider, key } = body;
  if (!provider || !key) {
    return jsonResponse(res, 400, { error: 'Missing provider or key' });
  }
  const config = loadConfig();
  addApiKey(config, provider, key);
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

async function runKeyTest(res, url, provider, apiKey) {
  const modelId = getProviderTestModel(provider) || 'gpt-3.5-turbo';
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

  // Use configured test model, or first model from catalog, or a generic test model
  let modelId = getProviderTestModel(providerKey) || '';
  if (!modelId) {
    const models = getModelsByProvider(providerKey);
    modelId = models.length > 0 ? models[0][0] : 'gpt-3.5-turbo';
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
// Auth-protected route checker
// ============================================================================
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
  // Also check Bearer token against server API key
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    try {
      const { getServerApiKey: dbKey } = require('./db');
      const key = dbKey();
      if (key && token === key) return { username: 'admin', auth: 'apikey' };
    } catch {}
  }
  jsonResponse(res, 401, { error: 'Unauthorized', message: '请先登录' });
  return null;
}

// ============================================================================
// Route dispatcher
// ============================================================================
async function handleAdminRequest(parsedUrl, req, res) {
  const path = parsedUrl.pathname;

  // ---- Public routes (no auth required) ----

  // Login page
  if (path === '/admin/login') {
    // Already logged in? Redirect to admin
    if (checkAuth(req)) {
      res.writeHead(302, { 'Location': '/admin' });
      res.end();
      return true;
    }
    // For POST, redirect to API handler
    if (req.method === 'POST') {
      res.writeHead(302, { 'Location': '/admin/login' });
      res.end();
      return true;
    }
    // Show login page (with error if redirected from failed login)
    const error = parsedUrl.query?.error ? '用户名或密码错误' : null;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getLoginHtml(error));
    return true;
  }

  // Login API endpoint
  if (path === '/api/admin/login' && req.method === 'POST') {
    const form = await parseFormBody(req);
    const username = form.username || 'admin';
    const password = form.password || '';
    const user = verifyAdminLogin(username, password);
    if (user) {
      const token = createSession(user.username);
      setSessionCookie(res, token);
      // Redirect to admin after successful login
      res.writeHead(302, { 'Location': '/admin' });
      res.end();
    } else {
      // For form POST, redirect back to login with error
      res.writeHead(302, { 'Location': '/admin/login?error=1' });
      res.end();
    }
    return true;
  }

  // Logout API endpoint
  if (path === '/api/admin/logout' && req.method === 'POST') {
    const cookies = parseCookies(req);
    if (cookies.flap_session) {
      try { deleteSession(cookies.flap_session); } catch {}
    }
    clearSessionCookie(res);
    res.writeHead(302, { 'Location': '/admin/login' });
    res.end();
    return true;
  }

  // ---- Protected routes (auth required) ----

  // Serve admin HTML
  if (path === '/admin' || path === '/admin/' || path === '/admin/index.html') {
    const session = requireAuth(req, res);
    if (!session) return true;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getAdminHtml());
    return true;
  }

  // Admin API routes
  if (!path.startsWith('/api/admin/')) return false;

  const apiPath = path.slice('/api/admin'.length) || '/';

  // Require auth for all API endpoints (except login which is handled above)
  const session = requireAuthApi(req, res);
  if (!session) return true;
  req._session = session;

  try {
    if (apiPath === '/config' && req.method === 'GET') {
      await handleGetConfig(res);
      return true;
    }
    if (apiPath === '/config' && req.method === 'PUT') {
      await handleUpdateConfig(req, res);
      return true;
    }
    if (apiPath === '/key/regenerate' && req.method === 'POST') {
      await handleRegenerateKey(res);
      return true;
    }
    if (apiPath === '/health' && (req.method === 'GET' || req.method === 'POST')) {
      await handleHealth(req, res);
      return true;
    }
    if (apiPath === '/provider-key' && req.method === 'POST') {
      await handleAddProviderKey(req, res);
      return true;
    }
    if (apiPath === '/provider-key' && req.method === 'DELETE') {
      await handleRemoveProviderKey(req, res);
      return true;
    }
    if (apiPath === '/provider-key/delete' && req.method === 'POST') {
      await handleRemoveSingleProviderKey(req, res);
      return true;
    }
    if (apiPath === '/provider-key/notes' && req.method === 'POST') {
      await handleUpdateKeyNotes(req, res);
      return true;
    }
    if (apiPath === '/provider-key/test' && req.method === 'POST') {
      await handleTestSingleKey(req, res);
      return true;
    }

    // Model state toggle
    if (apiPath === '/model-state' && req.method === 'POST') {
      await handleModelState(req, res);
      return true;
    }

    // Test model configuration
    if (apiPath === '/test-model' && req.method === 'POST') {
      await handleSetTestModel(req, res);
      return true;
    }

    // Model tier assignment
    if (apiPath === '/model-tier' && req.method === 'POST') {
      await handleSetModelTier(req, res);
      return true;
    }

    // Custom provider management
    if (apiPath === '/custom-provider' && req.method === 'GET') {
      await handleGetCustomProviders(res);
      return true;
    }
    if (apiPath === '/custom-provider' && req.method === 'POST') {
      await handleSaveCustomProvider(req, res);
      return true;
    }
    if (apiPath === '/custom-provider' && req.method === 'DELETE') {
      await handleDeleteCustomProvider(req, res);
      return true;
    }
    if (apiPath === '/custom-provider/toggle' && req.method === 'POST') {
      await handleToggleCustomProvider(req, res);
      return true;
    }
    if (apiPath === '/custom-provider/model' && req.method === 'POST') {
      await handleAddCustomProviderModel(req, res);
      return true;
    }
    if (apiPath === '/custom-provider/model' && req.method === 'DELETE') {
      await handleDeleteCustomProviderModel(req, res);
      return true;
    }

    // Password change
    if (apiPath === '/change-password' && req.method === 'POST') {
      await handleChangePassword(req, res);
      return true;
    }

    // Username change
    if (apiPath === '/change-username' && req.method === 'POST') {
      await handleChangeUsername(req, res);
      return true;
    }

    // Dynamic routes: /providers/:key/test, /providers/:key/discover
    const testMatch = apiPath.match(/^\/providers\/([\w-]+)\/test$/);
    if (testMatch && req.method === 'POST') {
      await handleTestProvider(req, res, testMatch[1]);
      return true;
    }
    const discoverMatch = apiPath.match(/^\/providers\/([\w-]+)\/discover$/);
    if (discoverMatch && req.method === 'POST') {
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

module.exports = {
  handleAdminRequest,
  discoverProviderModels,
  getAllDiscoveredModels,
};
