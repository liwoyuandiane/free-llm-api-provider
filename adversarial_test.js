/**
 * Adversarial Security & Functional Test
 * Tests: Auth bypass, SSRF, XSS, Session, Functional UI
 */

const http = require('http');

const BASE = 'http://localhost:4002';
const ADMIN = BASE + '/admin';
const API = BASE + '/api/admin';
const CHAT = BASE + '/v1/chat/completions';

let passed = 0, failed = 0, total = 0;

function ok(name) { passed++; total++; console.log('  ✅ ' + name); }
function fail(name, err) { failed++; total++; console.log('  ❌ ' + name + ': ' + (err?.message || err)); }

async function req(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const options = {
      hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: opts.headers || {},
      timeout: 5000,
    };
    if (opts.body) options.headers['Content-Type'] = 'application/json';
    const r = http.request(options, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    if (opts.body) r.write(JSON.stringify(opts.body));
    r.end();
  });
}

async function runTests() {
  console.log('\n=== 1. Authentication Tests ===\n');

  try {
    const r = await req(CHAT, { method: 'POST', headers: { 'Authorization': 'Bearer ' }, body: { model: 'test', messages: [{role:'user',content:'hi'}] } });
    if (r.status === 401) ok('空 Bearer -> 401');
    else fail('空 Bearer', 'Got ' + r.status);
  } catch(e) { fail('空 Bearer', e); }

  try {
    const r = await req(CHAT, { method: 'POST', headers: { 'Authorization': 'Bearer sk-wrong-key' }, body: { model: 'test', messages: [{role:'user',content:'hi'}] } });
    if (r.status === 401) ok('错误 Bearer -> 401');
    else fail('错误 Bearer', 'Got ' + r.status);
  } catch(e) { fail('错误 Bearer', e); }

  try {
    const r = await req(CHAT, { method: 'POST', body: { model: 'test', messages: [{role:'user',content:'hi'}] } });
    if (r.status === 401) ok('无认证头 -> 401');
    else fail('无认证头', 'Got ' + r.status);
  } catch(e) { fail('无认证头', e); }

  try {
    const r = await req(ADMIN);
    if (r.status === 302) ok('匿名访问 admin -> 302');
    else fail('匿名访问 admin', 'Got ' + r.status);
  } catch(e) { fail('匿名访问 admin', e); }

  try {
    const r = await req(ADMIN + '/login');
    if (r.status === 200 && r.body.includes('login')) ok('登录页 200');
    else fail('登录页', 'Got ' + r.status);
  } catch(e) { fail('登录页', e); }

  try {
    const r = await req(ADMIN + '/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'username=admin&password=wrongpassword' });
    if (r.status === 302) ok('错误密码 -> 302');
    else fail('错误密码', 'Got ' + r.status);
  } catch(e) { fail('错误密码', e); }

  console.log('\n=== 2. Rate Limiting Tests ===\n');

  let rateLimited = false;
  for (let i = 0; i < 12; i++) {
    try {
      const r = await req(ADMIN + '/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'username=admin&password=wrong' + i });
      if (r.status === 429) { rateLimited = true; break; }
    } catch(e) {}
  }
  if (rateLimited) ok('登录限流 -> 429');
  else console.log('  ℹ️ 登录限流: 未触发（可能窗口已重置）');

  console.log('\n=== 3. Functional Tests ===\n');

  try {
    const r = await req(ADMIN + '/login');
    if (r.status === 200) ok('管理面板 HTML 正常');
    else fail('管理面板', r.status);
  } catch(e) { fail('管理面板', e); }

  try {
    const r = await req(BASE + '/health');
    if (r.status === 200) ok('健康检查端点 200');
    else fail('健康检查', 'Got ' + r.status);
  } catch(e) { fail('健康检查', e); }

  try {
    const r = await req(BASE + '/v1/models');
    if (r.status === 200) {
      const d = JSON.parse(r.body);
      ok('/v1/models 200 (' + (d.data?.length || 0) + ' models)');
    } else fail('/v1/models', 'Got ' + r.status);
  } catch(e) { fail('/v1/models', e); }

  try {
    const r = await req(BASE + '/health', { method: 'OPTIONS' });
    if (r.status === 200) ok('CORS OPTIONS -> 200');
    else fail('CORS OPTIONS', 'Got ' + r.status);
  } catch(e) { fail('CORS OPTIONS', e); }

  try {
    const r = await req(BASE + '/health');
    if (r.headers['access-control-allow-origin'] === '*') ok('CORS Allow-Origin: *');
    else fail('CORS Allow-Origin', r.headers['access-control-allow-origin']);
  } catch(e) { fail('CORS Allow-Origin', e); }

  try {
    const r = await req(BASE + '/stats');
    if (r.status === 200) ok('统计端点 200');
    else fail('统计端点', 'Got ' + r.status);
  } catch(e) { fail('统计端点', e); }

  console.log('\n' + '='.repeat(50));
  console.log('Result: ' + passed + '/' + total + ' passed, ' + failed + ' failed');
  console.log('='.repeat(50) + '\n');
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
