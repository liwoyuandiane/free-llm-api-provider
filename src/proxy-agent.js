/**
 * Proxy Agent — Zero-dependency proxy tunnel for fetch()
 *
 * Routes outbound HTTPS requests through SOCKS5 or HTTP CONNECT proxy.
 * Reads config from: HTTPS_PROXY / HTTP_PROXY / NO_PROXY env vars.
 * Zero deps — uses node:net, node:tls, node:http, node:https.
 */

const net = require('net');
const tls = require('tls');

function getProxyUrl() {
  return process.env.HTTPS_PROXY || process.env.https_proxy ||
         process.env.HTTP_PROXY || process.env.http_proxy || '';
}

function getBypassHosts() {
  const noProxy = process.env.NO_PROXY || process.env.no_proxy || '';
  const hosts = noProxy.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  hosts.push('localhost', '127.0.0.1', '::1', '0.0.0.0');
  return new Set(hosts);
}

function shouldBypass(hostname) {
  const host = hostname.toLowerCase();
  if (getBypassHosts().has(host)) return true;
  if (host.endsWith('.local') || host.endsWith('.localhost')) return true;
  if (host.startsWith('10.') || host.startsWith('192.168.') || host.startsWith('172.')) return true;
  return false;
}

// ─── SOCKS5 CONNECT ─────────────────────────────────────────────────

function socks5Connect(proxyHost, proxyPort, targetHost, targetPort, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const socket = net.connect(proxyPort, proxyHost);
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('SOCKS5 timeout')); }, 30000);
    const done = () => { clearTimeout(timer); if (signal) signal.removeEventListener('abort', onAbort); };
    const onAbort = () => { done(); socket.destroy(); reject(new DOMException('Aborted', 'AbortError')); };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    let step = 0, buf = Buffer.alloc(0);
    socket.on('data', (data) => {
      buf = Buffer.concat([buf, data]);
      if (step === 0 && buf.length >= 2) {
        if (buf[1] !== 0) { done(); socket.destroy(); reject(new Error('SOCKS5 auth failed')); return; }
        step = 1;
        const hb = Buffer.from(targetHost);
        const req = Buffer.alloc(4 + 1 + hb.length + 2);
        req[0] = 5; req[1] = 1; req[2] = 0; req[3] = 3;
        req[4] = hb.length; hb.copy(req, 5); req.writeUInt16BE(targetPort, 5 + hb.length);
        socket.write(req); buf = Buffer.alloc(0);
      } else if (step === 1 && buf.length >= 4) {
        if (buf[1] !== 0) { done(); socket.destroy(); reject(new Error(`SOCKS5 fail: code ${buf[1]}`)); return; }
        done(); socket.removeAllListeners('data'); resolve(socket);
      }
    });
    socket.write(Buffer.from([0x05, 0x01, 0x00]));
    socket.on('error', (err) => { done(); reject(err); });
  });
}

// ─── HTTP CONNECT ──────────────────────────────────────────────────

function httpConnectTunnel(proxyHost, proxyPort, targetHost, targetPort, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const socket = net.connect(proxyPort, proxyHost);
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('CONNECT timeout')); }, 30000);
    const done = () => { clearTimeout(timer); if (signal) signal.removeEventListener('abort', onAbort); };
    const onAbort = () => { done(); socket.destroy(); reject(new DOMException('Aborted', 'AbortError')); };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    let buf = '';
    socket.once('connect', () => {
      socket.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n\r\n`);
    });
    socket.on('data', (chunk) => {
      buf += chunk.toString();
      const idx = buf.indexOf('\r\n\r\n');
      if (idx === -1) return;
      done();
      if (buf.includes('200')) {
        socket.removeAllListeners('data'); resolve(socket);
      } else {
        socket.destroy(); reject(new Error(`CONNECT fail: ${buf.substring(0, idx).split('\n')[0]}`));
      }
    });
    socket.on('error', (err) => { done(); reject(err); });
  });
}

// ─── Tunneled HTTPS request → Response ────────────────────────────

async function tunneledFetch(urlStr, init = {}) {
  const url = new URL(urlStr);
  const targetPort = url.port || 443;
  const proxyUrl = getProxyUrl();
  if (!proxyUrl) return fetch(urlStr, init);
  if (shouldBypass(url.hostname)) return fetch(urlStr, init);

  const isSocks = proxyUrl.startsWith('socks5://') || proxyUrl.startsWith('socks4://');
  const proxy = new URL(proxyUrl);

  // Create tunnel
  const tunnel = isSocks
    ? await socks5Connect(proxy.hostname, proxy.port || 1080, url.hostname, targetPort, init.signal)
    : await httpConnectTunnel(proxy.hostname, proxy.port || 1080, url.hostname, targetPort, init.signal);

  // TLS wrap
  const tlsSock = await new Promise((resolve, reject) => {
    const s = tls.connect({ socket: tunnel, servername: url.hostname, rejectUnauthorized: true }, () => resolve(s));
    s.on('error', reject);
  });

  // Send HTTP request
  const body = init.body || '';
  const method = init.method || 'GET';
  const headers = { ...init.headers };
  // Remove headers that conflict with raw HTTP
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === 'content-length' || k.toLowerCase() === 'host' || k.toLowerCase() === 'connection') {
      delete headers[k];
    }
  }
  if (body) headers['Content-Length'] = String(Buffer.byteLength(body));
  headers['Host'] = url.hostname;

  let reqStr = `${method} ${url.pathname}${url.search} HTTP/1.1\r\n`;
  for (const [k, v] of Object.entries(headers)) {
    reqStr += `${k}: ${v}\r\n`;
  }
  reqStr += '\r\n';
  if (body) reqStr += body;

  tlsSock.write(reqStr);

  // Parse HTTP response headers first, then stream body
  return new Promise((resolve, reject) => {
    let raw = '';
    let parsed = false;
    let statusCode = 0;
    let statusText = '';
    const respHeaders = {};
    let bodyStart = 0;
    let contentLength = -1;
    let isStreaming = false;

    const onData = (chunk) => {
      raw += chunk.toString();
      if (parsed) return;
      const idx = raw.indexOf('\r\n\r\n');
      if (idx === -1) return;

      parsed = true;
      tlsSock.removeListener('data', onData); // Remove ourselves first

      const [statusLine, ...headerLines] = raw.substring(0, idx).split('\r\n');
      const sp = statusLine.split(' ');
      statusCode = parseInt(sp[1]);
      statusText = sp.slice(2).join(' ') || '';
      for (const line of headerLines) {
        const c = line.indexOf(':');
        if (c > 0) respHeaders[line.substring(0, c).toLowerCase()] = line.substring(c + 2);
      }
      bodyStart = idx + 4;
      contentLength = parseInt(respHeaders['content-length'] || '-1');
      isStreaming = (respHeaders['content-type'] || '').includes('text/event-stream');

      const remainder = raw.substring(bodyStart);
      raw = ''; // Don't reuse raw after this point

      // Create a ReadableStream
      let controllerRef = null;
      const webBody = new ReadableStream({
        start(controller) {
          controllerRef = controller;
          if (remainder.length > 0) {
            try { controller.enqueue(Buffer.from(remainder)); } catch (e) {}
          }
        },
        cancel() {
          tlsSock.removeAllListeners('data');
          tlsSock.destroy();
        },
      });

      if (isStreaming || contentLength < 0) {
        // Stream mode: pipe data as it arrives
        tlsSock.on('data', (newChunk) => {
          if (controllerRef) {
            try { controllerRef.enqueue(newChunk); } catch (e) { /* ignore if closed */ }
          }
        });
        tlsSock.on('end', () => {
          if (controllerRef) try { controllerRef.close(); } catch (e) {}
        });
        tlsSock.on('error', (err) => {
          if (controllerRef) try { controllerRef.error(err); } catch (e) {}
        });
        resolve(new Response(webBody, { status: statusCode, statusText, headers: respHeaders }));
      } else {
        // Non-streaming: buffer entire body then resolve
        let bodyBuf = remainder; // Start with already-received data
        tlsSock.on('data', (newChunk) => { bodyBuf += newChunk.toString(); });
        tlsSock.on('end', () => {
          if (controllerRef) {
            try { controllerRef.enqueue(Buffer.from(bodyBuf)); controllerRef.close(); } catch (e) {}
          }
        });
        resolve(new Response(webBody, { status: statusCode, statusText, headers: respHeaders }));
      }
    };

    tlsSock.on('data', onData);
    tlsSock.on('error', reject);
  });
}

// ─── Public API ─────────────────────────────────────────────────────

async function proxyFetch(urlStr, init = {}) {
  const proxyUrl = getProxyUrl();
  if (!proxyUrl) return fetch(urlStr, init);

  const url = new URL(urlStr);
  if (url.protocol !== 'https:') return fetch(urlStr, init);

  try {
    return await tunneledFetch(urlStr, init);
  } catch (err) {
    console.warn(`[Proxy] ${url.hostname}: ${err.message}, fallback direct`);
    return fetch(urlStr, init);
  }
}

module.exports = { proxyFetch, getProxyUrl, shouldBypass };
