#!/usr/bin/env node
/**
 * Deep E2E Test Suite for free-llm-api-provider
 * Covers: connectivity, admin panel, key CRUD, proxy forwarding, config persistence, analytics
 * Usage: node deep_test_v5.js
 */

const http = require('http');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = process.env.FLAP_PORT || 4002;
const BASE = `http://localhost:${PORT}`;
let passed = 0;
let failed = 0;
let skipped = 0;
const errors = [];

// ============================================================================
// HTTP helpers
// ============================================================================
function req(method, urlPath, { body, headers = {}, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { ...headers },
    };
    if (cookie) opts.headers['Cookie'] = cookie;
    if (body) {
      const data = typeof body === 'string' ? body : JSON.stringify(body);
      opts.headers['Content-Type'] = opts.headers['Content-Type'] || 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(data);
    }

    const r = http.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        const setCookie = res.headers['set-cookie'] || [];
        resolve({ status: res.statusCode, body: d, headers: res.headers, setCookie });
      });
    });
    r.on('error', reject);
    r.setTimeout(10000, () => { r.destroy(); reject(new Error('timeout')); });
    if (body) r.write(typeof body === 'string' ? body : JSON.stringify(body));
    r.end();
  });
}

function assert(cond, name) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); errors.push(name); }
}

function skip(name) { skipped++; console.log(`  ⏭️  ${name} (skipped)`); }

// ============================================================================
// Stage 1: Connectivity
// ============================================================================
async function testConnectivity() {
  console.log('\n📡 Stage 1: Connectivity');

  const health = await req('GET', '/health');
  assert(health.status === 200, 'GET /health returns 200');
  assert(health.body.includes('"healthy"'), 'Health status is healthy');

  const stats = await req('GET', '/stats');
  assert(stats.status === 200, 'GET /stats returns 200');

  const models = await req('GET', '/v1/models');
  assert(models.status === 200, 'GET /v1/models returns 200');
  const modelsData = JSON.parse(models.body);
  assert(modelsData.data && modelsData.data.length > 0, `Models list has ${modelsData.data.length} entries`);
  assert(modelsData.data.some(m => m.id === 'tier-splus'), 'Has tier-splus model');
  assert(modelsData.data.some(m => m.id === 'tier-b'), 'Has tier-b model');
}

// ============================================================================
// Stage 2: Admin Panel
// ============================================================================
async function testAdminPanel() {
  console.log('\n🔧 Stage 2: Admin Panel');

  // Login page
  const loginPage = await req('GET', '/admin/login');
  assert(loginPage.status === 200, 'GET /admin/login returns 200');
  assert(loginPage.body.includes('login-box'), 'Login page has login form');

  // Login with wrong password
  const badLogin = await req('POST', '/api/admin/login', { body: 'username=admin&password=wrong', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert(badLogin.status === 302, 'Bad login returns 302');
  assert(badLogin.headers.location?.includes('error'), 'Bad login redirects with error');

  // Login with correct password
  const goodLogin = await req('POST', '/api/admin/login', { body: 'username=admin&password=admin123', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert(goodLogin.status === 302, 'Good login returns 302');

  // Extract session cookie
  const sessionCookie = goodLogin.setCookie.find(c => c.startsWith('flap_session='));
  let cookie = '';
  if (sessionCookie) {
    cookie = sessionCookie.split(';')[0];
  }
  assert(!!cookie, 'Session cookie set');

  // Admin page with session
  const adminPage = await req('GET', '/admin', { cookie });
  assert(adminPage.status === 200, 'GET /admin returns 200 with session');
  assert(adminPage.body.length > 10000, `Admin page is ${adminPage.body.length} bytes`);
  assert(adminPage.body.includes('<script>'), 'Admin page has inline script');

  // Check for known bugs
  assert(!adminPage.body.includes("stm(''"), 'No stm(\'\' template escaping bug');

  // Admin config API
  const config = await req('GET', '/api/admin/config', { cookie });
  assert(config.status === 200, 'GET /api/admin/config returns 200');
  const configData = JSON.parse(config.body);
  assert(configData.serverApiKey, 'Config has serverApiKey');
  assert(configData.allProviders, 'Config has allProviders');

  return cookie;
}

// ============================================================================
// Stage 3: Key CRUD
// ============================================================================
async function testKeyCRUD(cookie) {
  console.log('\n🔑 Stage 3: Key CRUD');

  // Add a test key
  const addKey = await req('POST', '/api/admin/provider-key', {
    cookie,
    body: { provider: 'groq', key: 'gsk_test_key_12345', notes: 'Test key' },
  });
  assert(addKey.status === 200, 'POST /api/admin/provider-key adds key');

  // Get config to verify key was added
  const config = await req('GET', '/api/admin/config', { cookie });
  const configData = JSON.parse(config.body);
  const groqKeys = configData.apiKeys?.groq || [];
  assert(groqKeys.length > 0, 'Groq key was added');
  assert(groqKeys.some(k => k.notes === 'Test key'), 'Key has notes');

  // Update key notes
  const updateNotes = await req('POST', '/api/admin/provider-key/notes', {
    cookie,
    body: { provider: 'groq', key: 'gsk_test_key_12345', notes: 'Updated notes' },
  });
  assert(updateNotes.status === 200, 'POST /api/admin/provider-key/notes updates notes');

  // Delete the test key
  const deleteKey = await req('POST', '/api/admin/provider-key/delete', {
    cookie,
    body: { provider: 'groq', key: 'gsk_test_key_12345' },
  });
  assert(deleteKey.status === 200, 'POST /api/admin/provider-key/delete removes key');

  // Verify key was removed
  const config2 = await req('GET', '/api/admin/config', { cookie });
  const configData2 = JSON.parse(config2.body);
  const groqKeys2 = configData2.apiKeys?.groq || [];
  assert(!groqKeys2.some(k => k.key?.includes('test_key')), 'Test key was removed');
}

// ============================================================================
// Stage 4: Proxy Forwarding
// ============================================================================
async function testProxyForwarding(cookie) {
  console.log('\n🔄 Stage 4: Proxy Forwarding');

  // Get server API key from admin config
  let apiKey = process.env.FLAP_API_KEY || '';
  if (!apiKey && cookie) {
    try {
      const config = await req('GET', '/api/admin/config', { cookie });
      const data = JSON.parse(config.body);
      if (data.serverApiKey) apiKey = data.serverApiKey;
    } catch {}
  }

  if (!apiKey) {
    skip('Non-streaming chat (no API key)');
    skip('Streaming chat (no API key)');
    skip('Invalid key rejection');
    return;
  }

  // Invalid key
  const badKey = await req('POST', '/v1/chat/completions', {
    headers: { 'Authorization': 'Bearer sk-invalid' },
    body: { model: 'tier-b', messages: [{ role: 'user', content: 'hi' }] },
  });
  assert(badKey.status === 401, 'Invalid API key returns 401');

  // Non-streaming (may fail if no provider key configured — that's OK)
  const chat = await req('POST', '/v1/chat/completions', {
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: { model: 'tier-b', messages: [{ role: 'user', content: 'Say hello' }], max_tokens: 10 },
  });
  assert(chat.status === 200 || chat.status === 503, `Chat returns ${chat.status} (200=success, 503=no provider key)`);
  if (chat.status === 200) {
    const data = JSON.parse(chat.body);
    assert(data.choices && data.choices.length > 0, 'Chat has choices');
    assert(chat.headers['x-provider'], 'Response has X-Provider header');
  }

  // Streaming
  const stream = await req('POST', '/v1/chat/completions', {
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: { model: 'tier-b', messages: [{ role: 'user', content: 'Say hi' }], max_tokens: 10, stream: true },
  });
  assert(stream.status === 200 || stream.status === 503, `Streaming returns ${stream.status}`);
  if (stream.status === 200) {
    assert(stream.headers['content-type']?.includes('text/event-stream'), 'Streaming has correct content type');
    assert(stream.body.includes('data:'), 'Streaming has SSE data');
  }
}

// ============================================================================
// Stage 5: Config Persistence
// ============================================================================
async function testConfigPersistence() {
  console.log('\n💾 Stage 5: Config Persistence');

  const dataDir = path.resolve(__dirname, '.data');
  assert(fs.existsSync(dataDir), '.data directory exists');
  assert(fs.existsSync(path.join(dataDir, 'data.db')), 'data.db exists');

  // Check config.json exists and is valid
  const configPath = path.join(dataDir, 'config.json');
  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, 'utf8');
      JSON.parse(raw);
      assert(true, 'config.json is valid JSON');
    } catch {
      assert(false, 'config.json is valid JSON');
    }
  } else {
    skip('config.json exists (may not be created yet)');
  }
}

// ============================================================================
// Stage 6: Password Change
// ============================================================================
async function testPasswordChange(cookie) {
  console.log('\n🔒 Stage 6: Password Change');

  // Change password
  const change = await req('POST', '/api/admin/change-password', {
    cookie,
    body: { currentPassword: 'admin123', newPassword: 'admin123' },
  });
  assert(change.status === 200, 'Change password returns 200');

  // Change username
  const changeUser = await req('POST', '/api/admin/change-username', {
    cookie,
    body: { newUsername: 'admin' },
  });
  assert(changeUser.status === 200 || changeUser.status === 400, 'Change username returns 200 or 400 (already exists)');
}

// ============================================================================
// Stage 7: Analytics
// ============================================================================
async function testAnalytics(cookie) {
  console.log('\n📊 Stage 7: Analytics');

  // These endpoints are accessed via the admin page JS, not directly
  // Check that the admin page loads analytics data
  const adminPage = await req('GET', '/admin', { cookie });
  assert(adminPage.body.includes('request_log') || adminPage.body.includes('analytics') || adminPage.body.includes('统计'), 'Admin page references analytics');
}

// ============================================================================
// Stage 8: Custom Providers
// ============================================================================
async function testCustomProviders(cookie) {
  console.log('\n🌐 Stage 8: Custom Providers');

  // Get custom providers
  const getCustom = await req('GET', '/api/admin/custom-provider', { cookie });
  assert(getCustom.status === 200, 'GET /api/admin/custom-provider returns 200');

  // Add a custom provider
  const addCustom = await req('POST', '/api/admin/custom-provider', {
    cookie,
    body: { name: 'test-provider', baseUrl: 'https://api.example.com/v1/chat/completions', key: 'test-key', notes: 'Test' },
  });
  assert(addCustom.status === 200, 'POST /api/admin/custom-provider adds provider');

  // Delete the custom provider
  const deleteCustom = await req('POST', '/api/admin/custom-provider/delete', {
    cookie,
    body: { name: 'test-provider' },
  });
  assert(deleteCustom.status === 200, 'POST /api/admin/custom-provider/delete removes provider');
}

// ============================================================================
// Stage 9: Model Management
// ============================================================================
async function testModelManagement(cookie) {
  console.log('\n📋 Stage 9: Model Management');

  // Toggle model state
  const toggle = await req('POST', '/api/admin/model-state', {
    cookie,
    body: { modelId: 'llama-3.3-70b-versatile', provider: 'groq', enabled: false },
  });
  assert(toggle.status === 200, 'POST /api/admin/model-state toggles model');

  // Restore
  const restore = await req('POST', '/api/admin/model-state', {
    cookie,
    body: { modelId: 'llama-3.3-70b-versatile', provider: 'groq', enabled: true },
  });
  assert(restore.status === 200, 'POST /api/admin/model-state restores model');

  // Set model tier
  const setTier = await req('POST', '/api/admin/model-tier', {
    cookie,
    body: { modelId: 'test-model', provider: 'test', tier: 'S+' },
  });
  assert(setTier.status === 200, 'POST /api/admin/model-tier sets tier');
}

// ============================================================================
// Main
// ============================================================================
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  free-llm-api-provider — Deep E2E Test Suite v5            ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  // Check if proxy is running
  try {
    await req('GET', '/health');
  } catch {
    console.error('\n❌ Proxy not running. Start with: node src/cli.js\n');
    process.exit(1);
  }

  await testConnectivity();
  const cookie = await testAdminPanel();
  await testKeyCRUD(cookie);
  await testProxyForwarding(cookie);
  await testConfigPersistence();
  await testPasswordChange(cookie);
  await testAnalytics(cookie);
  await testCustomProviders(cookie);
  await testModelManagement(cookie);

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log(`  Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  if (errors.length > 0) {
    console.log('\n  Failed tests:');
    for (const e of errors) console.log(`    • ${e}`);
  }
  console.log('═'.repeat(60));

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
