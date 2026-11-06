import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, chmodSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { startMockOidc } from './mock-oidc.mjs';
import { vendorState } from '../vendor.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT = join(HERE, '..');
const OUT = process.argv[2] || join(HERE, 'out-mcp-http');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.PORT) || 5191;
const MPORT = Number(process.env.MOCK_PORT) || 5192;
const EPORT = Number(process.env.ENGINE_PORT) || 5189;
const CPORT = Number(process.env.CHROME_PORT) || 9391;
const DPORT = Number(process.env.ENGINE_DEBUG_PORT) || 9392;
const BASE = `http://localhost:${PORT}`;
const RESOURCE = BASE + '/mcp';
const REDIRECT = 'http://127.0.0.1:5188/callback';

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (label, cond, detail = '') => { results.push(`${cond ? 'PASS' : 'FAIL'} ${label}${cond || !detail ? '' : ' :: ' + String(detail).slice(0, 600)}`); console.log(results.at(-1)); };
const until = async (fn, ms = 5000, step = 100) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return Date.now() - t0; } catch { } await sleep(step); }
  return -1;
};
const b64 = b => Buffer.from(b).toString('base64url');
const secrets = new Set();

const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, c]);
};
const png = (w, h, [r, g, b]) => {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 4);
    for (let x = 0; x < w; x++) {
      const inside = (x - w / 2) ** 2 + (y - h / 2) ** 2 < (w * 0.42) ** 2;
      row[1 + x * 4] = r; row[2 + x * 4] = g; row[3 + x * 4] = b; row[4 + x * 4] = inside ? 255 : 0;
    }
    rows.push(row);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
};

{
  const b = spawnSync(process.execPath, [join(KIT, 'build.mjs')], { encoding: 'utf8' });
  ok('build page', b.status === 0, b.stderr || b.stdout);
  if (!vendorState().every(v => v.ok)) spawnSync(process.execPath, [join(KIT, 'vendor.mjs')], { stdio: 'inherit' });
  ok('vendor files present', vendorState().every(v => v.ok));
}

const ART = join(OUT, 'art');
mkdirSync(ART, { recursive: true });
writeFileSync(join(ART, 'high_1.png'), png(220, 220, [230, 60, 60]));
writeFileSync(join(ART, 'low_1.png'), png(200, 200, [60, 120, 230]));
writeFileSync(join(ART, 'evil.png'), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'));

const WRAP = join(OUT, 'chrome-wrap.sh');
writeFileSync(WRAP, `#!/bin/sh\necho $$ > '${join(OUT, 'chrome.pid')}'\nprintf '%s\\n' "$@" > '${join(OUT, 'chrome.args')}'\nexec '${CHROME}' "$@" --remote-debugging-port=${DPORT}\n`);
chmodSync(WRAP, 0o755);

const mock = await startMockOidc({ port: MPORT, clientSecret: 'mcp-secret' });
let logs = '';
const kit = spawn(process.execPath, [join(KIT, 'serve.mjs')], {
  cwd: KIT,
  env: { ...process.env, AUTH: 'oidc', HOST: '127.0.0.1', PORT: String(PORT), PUBLIC_URL: BASE, DATA_DIR: join(OUT, 'data'), OIDC_ISSUER: mock.issuer, OIDC_CLIENT_ID: mock.clientId, OIDC_CLIENT_SECRET: 'mcp-secret', ALLOWED_EMAIL_DOMAINS: 'test.dev', RATE_AUTH_PER_MIN: '1000', CHROME_PATH: WRAP, ENGINE_PORT: String(EPORT), ENGINE_IDLE_MIN: '0.3' },
  stdio: ['ignore', 'pipe', 'pipe']
});
kit.stdout.on('data', d => { logs += d; });
const children = [kit];
process.on('exit', () => { for (const c of children) { try { c.kill('SIGTERM'); } catch { } } });
kit.stderr.on('data', d => { logs += d; process.stderr.write('[kit] ' + d); });
ok('kit server starts (oidc + engine)', await until(async () => (await fetch(BASE + '/healthz')).ok, 8000) >= 0);

const jar = () => new Map();
const keep = (j, res) => {
  for (const sc of res.headers.getSetCookie()) {
    const kv = sc.split(';')[0];
    const i = kv.indexOf('=');
    const k = kv.slice(0, i), v = kv.slice(i + 1);
    if (v) secrets.add(v);
    if (!v || /Max-Age=0\b/i.test(sc)) j.delete(k); else j.set(k, v);
  }
};
const cookieHdr = j => [...j].map(([k, v]) => `${k}=${v}`).join('; ');
const walk = async (j, start) => {
  let url = start, res;
  for (let hop = 0; hop < 10; hop++) {
    const own = url.startsWith(BASE);
    res = await fetch(url, { redirect: 'manual', headers: own && j.size ? { cookie: cookieHdr(j) } : {} });
    if (own) keep(j, res);
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc && !/^http:\/\/127\.0\.0\.1:(5188|6123)\//.test(loc)) { url = new URL(loc, url).href; continue; }
    break;
  }
  return { status: res.status, url, text: await res.text(), headers: res.headers };
};
const form = (path, body, headers = {}) => fetch(BASE + path, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(body).toString() });
const pkce = () => { const v = b64(randomBytes(40)); return { v, c: createHash('sha256').update(v).digest('base64url') }; };

const register = async (name, uris = [REDIRECT]) => {
  const r = await fetch(BASE + '/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: name, redirect_uris: uris, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }) });
  return { status: r.status, body: await r.json() };
};
const authorize = async (j, user, clientId, opts = {}) => {
  mock.user = user;
  const p = pkce();
  const state = b64(randomBytes(12));
  const redirect = opts.redirect || REDIRECT;
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirect, code_challenge: p.c, code_challenge_method: 'S256', state, scope: 'kit', resource: RESOURCE });
  const page = await walk(j, `${BASE}/oauth/authorize?${q}`);
  const req = /name="req" value="([^"]+)"/.exec(page.text);
  const csrf = /name="csrf" value="([^"]+)"/.exec(page.text);
  if (!req || !csrf) return { page };
  const res = await form('/oauth/authorize', { req: req[1], csrf: opts.csrf || csrf[1], decision: opts.deny ? 'deny' : 'allow' }, { cookie: cookieHdr(j), origin: BASE });
  const loc = res.headers.get('location') || '';
  const u = loc ? new URL(loc) : null;
  const code = u && u.searchParams.get('code');
  if (code) secrets.add(code);
  return { page, status: res.status, loc, code, state, gotState: u && u.searchParams.get('state'), iss: u && u.searchParams.get('iss'), error: u && u.searchParams.get('error'), verifier: p.v, redirect };
};
const exchange = async (clientId, a, verifier = a.verifier) => {
  const r = await form('/oauth/token', { grant_type: 'authorization_code', code: a.code, redirect_uri: a.redirect, client_id: clientId, code_verifier: verifier, resource: RESOURCE });
  const body = await r.json();
  if (body.access_token) { secrets.add(body.access_token); secrets.add(body.refresh_token); }
  return { status: r.status, body };
};

const client = token => {
  const c = { token, sid: null, n: 0, pv: null };
  c.raw = async (msg, extra = {}) => {
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    if (c.token) headers.authorization = 'Bearer ' + c.token;
    if (c.sid) headers['mcp-session-id'] = c.sid;
    if (c.pv) headers['mcp-protocol-version'] = c.pv;
    Object.assign(headers, extra);
    const r = await fetch(BASE + '/mcp', { method: 'POST', headers, body: JSON.stringify(msg) });
    const type = r.headers.get('content-type') || '';
    const text = await r.text();
    let body = null;
    if (/event-stream/.test(type)) {
      const ev = text.split('\n\n').find(b => /^event: message$/m.test(b));
      body = ev ? JSON.parse(ev.split('\n').find(l => l.startsWith('data: ')).slice(6)) : null;
    } else { try { body = JSON.parse(text); } catch { body = text; } }
    return { status: r.status, headers: r.headers, type, body, text };
  };
  c.rpc = (method, params) => c.raw({ jsonrpc: '2.0', id: ++c.n, method, params });
  c.init = async () => {
    const r = await c.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'check-mcp-http', version: '1' } });
    c.sid = r.headers.get('mcp-session-id');
    c.pv = r.body?.result?.protocolVersion || null;
    await c.raw({ jsonrpc: '2.0', method: 'notifications/initialized' });
    return r;
  };
  c.tool = async (name, args = {}) => {
    const r = await c.rpc('tools/call', { name, arguments: args });
    const res = r.body?.result || {};
    const text = (res.content || []).filter(x => x.type === 'text').map(x => x.text).join('\n');
    let json = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: r.status, type: r.type, error: !!res.isError, text, json, images: (res.content || []).filter(x => x.type === 'image') };
  };
  return c;
};

const ANYA = { email: 'anya@test.dev', name: 'Аня' };
const BORYS = { email: 'borys@test.dev', name: 'Борис' };
const OLYA = { email: 'olya@test.dev', name: 'Оля' };

{
  const r = await client(null).rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } });
  const wa = r.headers.get('www-authenticate') || '';
  ok('1. /mcp without token → 401 with resource_metadata', r.status === 401 && wa.includes(`resource_metadata="${BASE}/.well-known/oauth-protected-resource"`) && !/error=/.test(wa), `${r.status} ${wa}`);
  const bad = await client('ska_nope').rpc('initialize', {});
  ok('bad token → 401 error="invalid_token"', bad.status === 401 && /error="invalid_token"/.test(bad.headers.get('www-authenticate') || ''), bad.headers.get('www-authenticate'));
  const q = await fetch(BASE + '/mcp?access_token=whatever', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  ok('token in query is not accepted', q.status === 401);
  const prm = await (await fetch(BASE + '/.well-known/oauth-protected-resource')).json();
  const prm2 = await (await fetch(BASE + '/.well-known/oauth-protected-resource/mcp')).json();
  ok('protected resource metadata (RFC 9728)', prm.resource === RESOURCE && prm.authorization_servers[0] === BASE && prm.bearer_methods_supported.includes('header') && prm.scopes_supported.includes('kit') && prm2.resource === RESOURCE, JSON.stringify(prm));
  const as = await (await fetch(prm.authorization_servers[0] + '/.well-known/oauth-authorization-server')).json();
  ok('authorization server metadata (RFC 8414)', as.issuer === BASE && as.authorization_endpoint === BASE + '/oauth/authorize' && as.token_endpoint === BASE + '/oauth/token' && as.registration_endpoint === BASE + '/oauth/register' && as.revocation_endpoint === BASE + '/oauth/revoke' && as.code_challenge_methods_supported.join() === 'S256' && as.token_endpoint_auth_methods_supported.join() === 'none' && as.grant_types_supported.includes('refresh_token') && !('client_id_metadata_document_supported' in as), JSON.stringify(as));
}

const anyaReg = await register('Claude Code (spine-kit)');
ok('2. DCR registers a public client', anyaReg.status === 201 && /^mcp_/.test(anyaReg.body.client_id) && anyaReg.body.token_endpoint_auth_method === 'none', JSON.stringify(anyaReg.body));
{
  const evil = await register('evil', ['https://evil.example/cb']);
  ok('DCR refuses non-loopback redirect_uri', evil.status === 400 && evil.body.error === 'invalid_redirect_uri', JSON.stringify(evil.body));
  const sec = await fetch(BASE + '/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'c', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'client_secret_basic' }) });
  const secBody = await sec.json();
  ok('DCR makes every client public (token_endpoint_auth_method: none)', sec.status === 201 && secBody.token_endpoint_auth_method === 'none' && !secBody.client_secret, JSON.stringify(secBody));
}
const CID = anyaReg.body.client_id;
const anyaJar = jar();
let anyaTokens;
{
  const a = await authorize(anyaJar, ANYA, CID);
  ok('authorize: SSO login via mock OIDC, then consent page', a.page.status === 200 && /хоче працювати зі Spine Draft Kit від імені/.test(a.page.text) && a.page.text.includes('anya@test.dev') && a.page.text.includes('Claude Code (spine-kit)'), `${a.page.status} ${a.page.url} ${a.page.text.slice(0, 200)}`);
  const csp = a.page.headers.get('content-security-policy') || '';
  ok('consent page: frame-ancestors none, form-action only self + redirect origin', /frame-ancestors 'none'/.test(csp) && csp.includes("form-action 'self' http://127.0.0.1:5188"), csp);
  ok('consent → redirect with code, state, iss', a.status === 303 && a.loc.startsWith(REDIRECT + '?') && a.code && a.gotState === a.state && a.iss === BASE, a.loc);
  const wrong = await exchange(CID, a, pkce().v);
  ok('token with wrong PKCE verifier → invalid_grant', wrong.status === 400 && wrong.body.error === 'invalid_grant', JSON.stringify(wrong.body));
  const b = await authorize(anyaJar, ANYA, CID);
  ok('second authorize reuses the SSO session (no login)', b.page.url.startsWith(BASE + '/oauth/authorize') && !!b.code);
  const t = await exchange(CID, b);
  ok('token with PKCE → access + refresh', t.status === 200 && /^ska_/.test(t.body.access_token) && /^skr_/.test(t.body.refresh_token) && t.body.token_type === 'Bearer' && t.body.expires_in === 3600, JSON.stringify(t.body).slice(0, 200));
  anyaTokens = t.body;
  const again = await exchange(CID, b);
  ok('code is single-use', again.status === 400 && again.body.error === 'invalid_grant');
  const st = await client(anyaTokens.access_token).rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } });
  ok('reusing a code revokes what it issued', st.status === 401, String(st.status));
  const c = await authorize(anyaJar, ANYA, CID, { redirect: 'http://127.0.0.1:6123/callback' });
  ok('loopback redirect with another port is accepted (RFC 8252)', !!c.code && c.loc.startsWith('http://127.0.0.1:6123/callback?'), c.loc);
  const t2 = await exchange(CID, c);
  ok('token for the loopback-port code', t2.status === 200);
  anyaTokens = t2.body;
  const d = await authorize(anyaJar, ANYA, CID, { redirect: 'http://127.0.0.1:5188/other' });
  ok('other redirect path is refused (no redirect)', !d.code && d.page.status === 400, String(d.page.status));
  const e = await authorize(anyaJar, ANYA, CID, { deny: true });
  ok('«Скасувати» → error=access_denied', e.error === 'access_denied' && e.gotState === e.state, e.loc);
  const f = await authorize(anyaJar, ANYA, CID, { csrf: 'wrong' });
  ok('consent with wrong csrf is refused', !f.code && f.status === 400, String(f.status));
  const noPkce = await walk(anyaJar, `${BASE}/oauth/authorize?` + new URLSearchParams({ response_type: 'code', client_id: CID, redirect_uri: REDIRECT, state: 's' }));
  ok('authorize without PKCE → error back to client', noPkce.status === 303 && /error=invalid_request/.test(noPkce.headers.get('location') || ''), `${noPkce.status} ${noPkce.headers.get('location')}`);
  const badRes = await walk(anyaJar, `${BASE}/oauth/authorize?` + new URLSearchParams({ response_type: 'code', client_id: CID, redirect_uri: REDIRECT, state: 's', code_challenge: pkce().c, code_challenge_method: 'S256', resource: 'http://evil.example/mcp' }));
  ok('authorize with a foreign resource → invalid_target', /error=invalid_target/.test(badRes.headers.get('location') || ''));
}

const A = client(anyaTokens.access_token);
{
  const i = await A.init();
  ok('3. initialize → Mcp-Session-Id', i.status === 200 && !!A.sid && i.body.result.protocolVersion === '2025-06-18' && /upload_files/.test(i.body.result.instructions) && /Claude · <person>/.test(i.body.result.instructions), JSON.stringify(i.body).slice(0, 200));
  const n = await A.raw({ jsonrpc: '2.0', method: 'notifications/initialized' });
  ok('notification → 202 without body', n.status === 202 && n.text === '');
  const l = await A.rpc('tools/list', {});
  const names = (l.body.result?.tools || []).map(t => t.name);
  ok('tools/list: HTTP set', ['upload_files', 'get_history', 'restore_version', 'save_version', 'set_symbols', 'export_drafts'].every(x => names.includes(x)) && !names.includes('open_kit') && !names.includes('scan_art') && l.type.startsWith('application/json'), names.join(','));
  const img = l.body.result.tools.find(t => t.name === 'set_symbols').inputSchema.properties.symbols.items.properties.image.description;
  ok('image fields take upload:<id> refs', /upload:<id>/.test(img), img);
  const g = await fetch(BASE + '/mcp', { headers: { authorization: 'Bearer ' + A.token, accept: 'text/event-stream' } });
  ok('GET /mcp → 405', g.status === 405);
  const unknown = await A.raw({ jsonrpc: '2.0', id: 99, method: 'tools/list' }, { 'mcp-session-id': 'nope' });
  ok('unknown session → 404', unknown.status === 404);
  const noSid = await fetch(BASE + '/mcp', { method: 'POST', headers: { authorization: 'Bearer ' + A.token, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
  ok('no session header → 400', noSid.status === 400);
  const evil = await A.raw({ jsonrpc: '2.0', id: 98, method: 'tools/list' }, { origin: 'http://evil.example' });
  ok('foreign Origin → 403', evil.status === 403);
  const pv = await A.raw({ jsonrpc: '2.0', id: 97, method: 'tools/list' }, { 'mcp-protocol-version': '1999-01-01' });
  ok('unsupported MCP-Protocol-Version → 400', pv.status === 400);
  const st = await A.tool('kit_status');
  ok('kit_status: user, no project yet', st.json?.user?.email === 'anya@test.dev' && st.json.project === null && /open_project/.test(st.json.hint || ''), st.text);
  const none = await A.tool('get_project');
  ok('engine tool without a project → clear error', none.error && /open_project або create_project/.test(none.text), none.text);
}

let PID = null;
{
  const t0 = Date.now();
  const cp = await A.tool('create_project', { name: 'mcp-http-test', reels: 5, rows: 3, symbols: [] });
  PID = cp.json?.project?.id;
  ok('create_project (engine tab) → id + url', !cp.error && !!PID && cp.json.url === `${BASE}/p/${PID}` && cp.type.startsWith('text/event-stream'), cp.text.slice(0, 300));
  console.log(`   create_project took ${Date.now() - t0} ms`);
  const lp = await A.tool('list_projects');
  ok('list_projects marks the session project', lp.json?.projects?.some(p => p.id === PID && p.open && p.updated_by), lp.text.slice(0, 300));
}

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CPORT}`, `--user-data-dir=${join(OUT, 'profile')}`, '--no-first-run', '--no-default-browser-check', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1320,940', 'about:blank'], { stdio: 'ignore' });
children.push(chrome);
const devtools = async port => {
  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) { await sleep(200); try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; } catch { } }
  const ws = new WebSocket(wsUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let mid = 0;
  const waiting = new Map();
  const errors = [];
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  });
  const cdp = (method, params = {}, sessionId) => new Promise(res => { const i = ++mid; waiting.set(i, res); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
  const attach = async targetId => {
    const { result: { sessionId } } = await cdp('Target.attachToTarget', { targetId, flatten: true });
    await cdp('Runtime.enable', {}, sessionId);
    const t = { sessionId, targetId };
    t.ev = async expr => {
      const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
      if (r.result?.exceptionDetails) throw new Error(`eval: ${expr.slice(0, 100)} -> ${r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text}`);
      return r.result?.result?.value;
    };
    return t;
  };
  return { ws, cdp, attach, errors, close: () => ws.close() };
};
const H = await devtools(CPORT);
mock.user = OLYA;
const hctx = (await H.cdp('Target.createBrowserContext')).result.browserContextId;
const htab = await H.attach((await H.cdp('Target.createTarget', { url: `${BASE}/p/${PID}`, browserContextId: hctx })).result.targetId);
await H.cdp('Emulation.setDeviceMetricsOverride', { width: 1320, height: 940, deviceScaleFactor: 1, mobile: false }, htab.sessionId);
ok('human tab (Оля) opens the project', await until(() => htab.ev(`!!(window.SpineKitSync && SpineKitSync.status().pid === ${JSON.stringify(PID)} && SpineKitSync.status().live)`), 20000) >= 0);

let refs;
{
  const up = await A.tool('upload_files', { files: [{ name: 'high_1.png', path: join(ART, 'high_1.png') }, { name: 'low_1.png', path: join(ART, 'low_1.png') }] });
  refs = up.json?.files || [];
  for (const f of refs) secrets.add(f.url.split('/u/')[1]);
  ok('upload_files → refs, one-time urls, one curl', refs.length === 2 && refs.every(f => /^upload:/.test(f.ref) && f.url.startsWith(BASE + '/u/')) && up.json.expires_in === 900 && /^curl -fsS -T /.test(up.json.curl), up.text.slice(0, 400));
  const c = spawnSync('sh', ['-c', up.json.curl], { encoding: 'utf8' });
  ok('curl uploads both files', c.status === 0 && (c.stdout.match(/"ok":true/g) || []).length === 2, c.stdout + c.stderr);
  const again = spawnSync('sh', ['-c', up.json.curl], { encoding: 'utf8' });
  ok('upload link works only once', again.status !== 0, again.stdout);
  const get = await fetch(refs[0].url);
  ok('upload link: GET → 405', get.status === 405);
  const ev = await A.tool('upload_files', { files: [{ name: 'evil.png', path: join(ART, 'evil.png') }] });
  secrets.add(ev.json.files[0].url.split('/u/')[1]);
  const ec = spawnSync('sh', ['-c', ev.json.curl.replace('-fsS', '-sS')], { encoding: 'utf8' });
  ok('fake PNG (SVG) upload is refused', /PNG, JPEG або WebP/.test(ec.stdout), ec.stdout);
  const bad = await A.tool('upload_files', { files: [{ name: 'run.sh' }] });
  ok('upload_files refuses other file types', bad.error, bad.text);
  const path = await A.tool('set_symbols', { symbols: [{ name: 'x', image: '/Users/me/x.png' }] });
  ok('local path instead of ref → hint to upload_files', path.error && /upload_files/.test(path.text), path.text);
  const s = await A.tool('set_symbols', { symbols: [{ name: 'high_1', image: refs[0].ref }, { name: 'low_1', image: refs[1].ref }] });
  ok('set_symbols with refs', !s.error && s.json?.symbols?.length === 2 && s.json.symbols.every(x => x.image === x.name + '.png'), s.text.slice(0, 300));
  const live = await until(() => htab.ev(`(() => { const st = SpineKitSync.app().state; const c = st.s.components.find(c => c.type === 'symbols'); return c.symbols.map(s => s.name).join() === 'high_1,low_1' && !!st.images['sym:high_1'] && st.images['sym:high_1'].w === 220; })()`), 8000);
  ok('human tab sees the symbols with images live', live >= 0, String(live));
  const chip = await until(() => htab.ev(`[...document.querySelectorAll('#sk-pres .sk-claude')].some(x => x.getAttribute('aria-label') === 'Claude · Аня')`), 5000);
  ok('human tab shows the «Claude · Аня» chip', chip >= 0, await htab.ev(`document.getElementById('sk-pres').textContent`));
}

{
  const sh = await A.tool('screenshot', { target: 'grid' });
  const img = sh.images[0];
  ok('4. screenshot returns a PNG', !sh.error && img && img.mimeType === 'image/png' && Buffer.from(img.data, 'base64').subarray(1, 4).toString() === 'PNG' && img.data.length > 2000, sh.text.slice(0, 200));
  const sp = await A.tool('spin', { quick: true });
  ok('spin works', !sp.error && sp.json?.done === true && sp.images.length === 1, sp.text.slice(0, 300));
}

{
  const ex = await A.tool('export_drafts', {});
  const url = ex.json?.download;
  if (url) secrets.add(url.split('/d/')[1]);
  ok('5. export_drafts → download link + curl', !ex.error && url && url.startsWith(BASE + '/d/') && ex.json.expires_in === 900 && ex.json.spines > 3 && /^curl -fsS -o '<folder>\//.test(ex.json.curl), ex.text.slice(0, 400));
  const dir = join(OUT, 'download');
  mkdirSync(dir, { recursive: true });
  const c = spawnSync('sh', ['-c', ex.json.curl.replace('<folder>', dir)], { encoding: 'utf8' });
  const zip = join(dir, ex.json.name);
  ok('curl downloads the zip', c.status === 0 && existsSync(zip) && statSync(zip).size === ex.json.bytes, c.stderr);
  const u = spawnSync('unzip', ['-o', '-q', zip, '-d', join(dir, 'x')], { encoding: 'utf8' });
  const all = [];
  const walkDir = d => { for (const e of readdirSync(d, { withFileTypes: true })) { if (e.isDirectory()) walkDir(join(d, e.name)); else all.push(e.name); } };
  if (u.status === 0) walkDir(join(dir, 'x'));
  ok('zip unpacks with json, atlas, png of the symbols', u.status === 0 && all.some(n => n === 'animation_symbol_high_1.json') && all.some(n => n.endsWith('.atlas')) && all.some(n => n.endsWith('.png')), `${u.status} ${u.stderr} ${all.slice(0, 12).join(',')}`);
  const post = await fetch(url, { method: 'POST' });
  ok('download link: POST → 405', post.status === 405);
}

let BORYS_TOKENS;
const B = client(null);
{
  const reg = await register('Claude Code (Борис)');
  const bj = jar();
  const a = await authorize(bj, BORYS, reg.body.client_id);
  const t = await exchange(reg.body.client_id, a);
  BORYS_TOKENS = { ...t.body, client_id: reg.body.client_id };
  B.token = t.body.access_token;
  await B.init();
  const stolen = await B.raw({ jsonrpc: '2.0', id: 50, method: 'tools/list' }, { 'mcp-session-id': A.sid });
  ok('session of Аня with Борис token → 404', stolen.status === 404);
  const r = await B.tool('set_symbols', { symbols: [{ name: 'high_9', image: refs[0].ref }] });
  ok('ref of Аня does not work for Борис', r.error && /ref/.test(r.text), r.text);
  const op = await B.tool('open_project', { id: 'mcp-http-test' });
  ok('Борис: open_project by name', !op.error && op.json?.project?.id === PID, op.text.slice(0, 300));
}

{
  const t0 = Date.now();
  const [a1, b1, a2, b2] = await Promise.all([
    A.tool('update_game', { name: 'mcp-http-renamed' }),
    B.tool('add_component', { template: 'logo' }),
    A.tool('set_symbols', { symbols: [{ name: 'wild_1' }] }),
    B.tool('update_component', { id: 'frame_under', on: false })
  ]);
  ok('two people: four concurrent calls on one project all succeed', [a1, b1, a2, b2].every(x => !x.error), [a1, b1, a2, b2].map(x => x.text.slice(0, 120)).join(' | '));
  console.log(`   4 concurrent calls took ${Date.now() - t0} ms`);
  const seen = await until(() => htab.ev(`(() => { const s = SpineKitSync.app().state.s; return s.game === 'mcp-http-renamed' && s.components.some(c => c.name === 'animation_game_logo') && s.components.find(c => c.type === 'frame_under').on === false && s.components.find(c => c.type === 'symbols').symbols.some(x => x.name === 'wild_1'); })()`), 8000);
  ok('human tab sees both people\'s changes live', seen >= 0);
  const chips = await until(() => htab.ev(`(() => { const t = [...document.querySelectorAll('#sk-pres .sk-claude')].map(x => x.getAttribute('aria-label')); return t.includes('Claude · Аня') && t.includes('Claude · Борис'); })()`), 5000);
  ok('human tab shows both Claude chips', chips >= 0, await htab.ev(`document.getElementById('sk-pres').textContent`));
  const h = await A.tool('get_history', { scope: 'drafts', limit: 30 });
  const es = h.json?.entries || [];
  console.log('   history: ' + es.map(e => `${e.by}: ${e.label}`).join(' | '));
  const byA = es.filter(e => e.by === 'Claude · Аня'), byB = es.filter(e => e.by === 'Claude · Борис');
  ok('6. get_history shows «Claude · Аня» and «Claude · Борис»', byA.length >= 2 && byB.length >= 1, es.map(e => e.by).join(','));
  ok('authors are right per change', byB.some(e => /logo|лого/i.test(e.label)) && !byA.some(e => /logo|лого/i.test(e.label)) && byA.some(e => /high_1|Символ|символ/i.test(e.label)), es.map(e => `${e.by}: ${e.label}`).join(' | '));
  const created = es.filter(e => e.label === 'Створено').at(-1);
  const r = await A.tool('restore_version', { entry: created && created.id, scope: 'drafts' });
  ok('restore_version works', !r.error && r.json?.restored === true, r.text);
  const back = await until(() => htab.ev(`(() => { const s = SpineKitSync.app().state.s; return s.game === 'mcp-http-test' && s.components.find(c => c.type === 'symbols').symbols.length === 0 && !s.components.some(c => c.name === 'animation_game_logo'); })()`), 8000);
  ok('human tab rolls back live', back >= 0);
  const h2 = await A.tool('get_history', { scope: 'drafts', limit: 3 });
  ok('rollback is in the history by «Claude · Аня»', h2.json?.entries?.[0]?.by === 'Claude · Аня' && /^Відкат/.test(h2.json.entries[0].label), h2.text.slice(0, 300));
  const gp = await A.tool('get_project');
  ok('engine tab follows the rollback', !gp.error && gp.json?.settings?.game === 'mcp-http-test', gp.text.slice(0, 200));
  const sv = await A.tool('save_version', { label: 'перед ротацією' });
  ok('save_version', !sv.error && sv.json?.saved, sv.text);
}

{
  const E = await devtools(DPORT);
  const pages = async () => (await E.cdp('Target.getTargets')).result.targetInfos.filter(t => t.type === 'page' && t.url.startsWith(`http://127.0.0.1:${EPORT}/`));
  ok('engine has a kit tab for the project', (await pages()).some(t => t.url.endsWith('/p/' + PID)), JSON.stringify((await pages()).map(t => t.url)));
  const args = readFileSync(join(OUT, 'chrome.args'), 'utf8').split('\n');
  ok('engine Chromium flags: pipe, headless, network lock', args.includes('--remote-debugging-pipe') && args.includes('--headless=new') && args.includes('--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1') && args.some(a => a.startsWith('--user-data-dir=')), args.join(' '));
  const kitTab = await E.attach((await pages())[0].targetId);
  const ext = await kitTab.ev(`Promise.all(['http://example.com/', 'http://93.184.215.14/', 'https://cdn.jsdelivr.net/npm/x'].map(async u => { try { await fetch(u, { mode: 'no-cors' }); return 'loaded'; } catch (e) { return 'blocked'; } }))`);
  ok('engine kit page cannot fetch external URLs', ext.every(x => x === 'blocked'), ext.join());
  const ctx = (await E.cdp('Target.createBrowserContext')).result.browserContextId;
  const probe = (await E.cdp('Target.createTarget', { url: 'about:blank', browserContextId: ctx })).result.targetId;
  const ps = (await E.cdp('Target.attachToTarget', { targetId: probe, flatten: true })).result.sessionId;
  const navs = [];
  for (const u of ['http://example.com/', 'http://93.184.215.14/', 'https://www.google.com/']) navs.push((await E.cdp('Page.navigate', { url: u }, ps)).result?.errorText || 'loaded');
  ok('engine browser cannot open external URLs (DNS lock, IP literals too)', navs.every(x => x === 'net::ERR_NAME_NOT_RESOLVED'), navs.join());
  await E.cdp('Target.disposeBrowserContext', { browserContextId: ctx });
  const direct = await fetch(`http://127.0.0.1:${EPORT}/p/${PID}`);
  ok('engine listener refuses requests without the engine cookie', direct.status === 403, String(direct.status));
  const wrongHost = await fetch(`http://localhost:${EPORT}/healthz`);
  ok('engine listener checks Host', wrongHost.status === 421, String(wrongHost.status));
  const closed = await until(async () => (await pages()).length === 0, 60000, 1000);
  ok('engine tab closes after idle (ENGINE_IDLE_MIN)', closed >= 0, JSON.stringify((await pages()).map(t => t.url)));
  console.log(`   tab closed after ${closed} ms more`);
  E.close();
  const pid1 = Number(readFileSync(join(OUT, 'chrome.pid'), 'utf8'));
  process.kill(pid1, 'SIGKILL');
  await until(() => { try { process.kill(pid1, 0); return false; } catch { return true; } }, 5000);
  await sleep(300);
  const sh = await A.tool('screenshot', { target: 'grid' });
  const pid2 = Number(readFileSync(join(OUT, 'chrome.pid'), 'utf8'));
  ok('killed Chromium comes back on the next call', !sh.error && sh.images.length === 1 && pid2 !== pid1, `${pid1} → ${pid2} ${sh.text.slice(0, 200)}`);
}

{
  const old = anyaTokens;
  const r = await form('/oauth/token', { grant_type: 'refresh_token', refresh_token: old.refresh_token, client_id: CID });
  const n = await r.json();
  if (n.access_token) { secrets.add(n.access_token); secrets.add(n.refresh_token); }
  ok('7. refresh rotates both tokens', r.status === 200 && n.access_token !== old.access_token && n.refresh_token !== old.refresh_token, JSON.stringify(n).slice(0, 200));
  const oldUse = await client(old.access_token).rpc('initialize', {});
  A.token = n.access_token;
  const newUse = await A.rpc('tools/list', {});
  ok('old access token stops, new one keeps the session', oldUse.status === 401 && newUse.status === 200, `${oldUse.status} ${newUse.status}`);
  const replay = await form('/oauth/token', { grant_type: 'refresh_token', refresh_token: old.refresh_token, client_id: CID });
  ok('replayed refresh token → invalid_grant', replay.status === 400 && (await replay.json()).error === 'invalid_grant');
  const after = await A.rpc('tools/list', {});
  ok('replay revokes the whole family (new token → 401)', after.status === 401 && /error="invalid_token"/.test(after.headers.get('www-authenticate') || ''), String(after.status));
  const rv = await form('/oauth/revoke', { token: BORYS_TOKENS.access_token, client_id: BORYS_TOKENS.client_id });
  const bu = await B.rpc('tools/list', {});
  ok('revoked token → 401', rv.status === 200 && bu.status === 401, `${rv.status} ${bu.status}`);
}

{
  mock.user = OLYA;
  const j = jar();
  await walk(j, `${BASE}/auth/login?next=/`);
  const s = await (await fetch(BASE + '/api/session', { headers: { cookie: cookieHdr(j) } })).json();
  secrets.add(s.csrf);
  const h = { cookie: cookieHdr(j), origin: BASE, 'x-kit-csrf': s.csrf, 'content-type': 'application/json' };
  const mk = await (await fetch(BASE + '/api/mcp/tokens', { method: 'POST', headers: h, body: '{}' })).json();
  secrets.add(mk.token);
  ok('personal token: created once with the command', /^skp_/.test(mk.token) && mk.command === `claude mcp add --transport http spine-kit ${RESOURCE} --header "Authorization: Bearer ${mk.token}"`, JSON.stringify(mk).slice(0, 200));
  const P = client(mk.token);
  const pi = await P.init();
  const ps = await P.tool('kit_status');
  ok('personal token works for /mcp', pi.status === 200 && ps.json?.user?.email === 'olya@test.dev');
  const api = await fetch(BASE + '/api/projects', { headers: { authorization: 'Bearer ' + mk.token } });
  ok('personal token does not open /api', api.status === 401);
  await sleep(2100);
  const burst = await Promise.all(Array.from({ length: 40 }, () => P.rpc('ping', {})));
  const n429 = burst.filter(r => r.status === 429).length;
  ok('MCP over 10/s → 429', n429 >= 10 && burst.filter(r => r.status === 200).length >= 15, `429×${n429}`);
  await sleep(2100);
  const del0 = await fetch(BASE + '/mcp', { method: 'DELETE', headers: { authorization: 'Bearer ' + mk.token, 'mcp-session-id': P.sid } });
  const gone = await P.rpc('tools/list', {});
  ok('DELETE /mcp closes the session (then 404)', del0.status === 204 && gone.status === 404, `${del0.status} ${gone.status}`);
  await P.init();
  const list = await (await fetch(BASE + '/api/mcp/clients', { headers: { cookie: h.cookie } })).json();
  ok('Connect list shows the token', list.some(c => c.id === mk.id && c.kind === 'personal' && c.exp > Date.now()), JSON.stringify(list));
  const del = await fetch(BASE + '/api/mcp/clients/' + mk.id, { method: 'DELETE', headers: { cookie: h.cookie, origin: BASE, 'x-kit-csrf': s.csrf } });
  const pu = await P.rpc('tools/list', {});
  ok('«Відключити» revokes it', del.status === 200 && pu.status === 401, `${del.status} ${pu.status}`);
  const noCsrf = await fetch(BASE + '/api/mcp/tokens', { method: 'POST', headers: { cookie: h.cookie, origin: BASE, 'content-type': 'application/json' }, body: '{}' });
  ok('creating a token needs CSRF', noCsrf.status === 403);
}

{
  await htab.ev(`document.getElementById('link-btn').click(), true`);
  const txt = await until(() => htab.ev(`(() => { const b = document.getElementById('link-body'); return b && /claude mcp add --transport http spine-kit ${BASE.replace(/[/.]/g, '\\$&')}\\/mcp/.test(b.textContent) && /Authenticate/.test(b.textContent) && /Підключені клієнти/.test(b.textContent) && /Персональний токен/.test(b.textContent) && !/Завантаження/.test(b.textContent); })()`), 5000);
  ok('Connect dialog (server mode): command, Authenticate, clients, personal token', txt >= 0, await htab.ev(`(document.getElementById('link-body') || {}).textContent`));
  ok('Connect button visible in server mode', await htab.ev(`!document.getElementById('link-btn').hidden`));
  await htab.ev(`document.getElementById('sk-token-new').click(), true`);
  const shown = await until(() => htab.ev(`/Authorization: Bearer skp_/.test(document.getElementById('sk-token').textContent)`), 5000);
  ok('Connect dialog creates a personal token and shows it once', shown >= 0);
  const tk = await htab.ev(`(/skp_[A-Za-z0-9_-]+/.exec(document.getElementById('sk-token').textContent) || [''])[0]`);
  secrets.add(tk);
  const rows = await until(() => htab.ev(`[...document.querySelectorAll('#sk-clients .sk-t')].some(li => /Персональний токен/.test(li.textContent))`), 5000);
  ok('Connect dialog lists it with «Відключити»', rows >= 0);
  ok('human tab: no page errors', H.errors.length === 0, H.errors.slice(0, 3).join(' || '));
}

{
  const regs = [];
  for (let i = 0; i < 10; i++) regs.push((await register('flood ' + i)).status);
  ok('client registration over 10/h per IP → 429', regs.includes(429) && regs.indexOf(429) <= 6, regs.join(','));
}

H.close();
chrome.kill();
kit.kill('SIGTERM');
await sleep(800);
await mock.close();
{
  const leaked = [...secrets].filter(s => s && s.length >= 16 && logs.includes(s));
  ok('logs: no tokens, codes, cookies or one-time links', leaked.length === 0 && secrets.size > 15, `${leaked.length} of ${secrets.size}: ${leaked.slice(0, 3).map(s => s.slice(0, 10) + '…').join(', ')}`);
  ok('logs: /u/ and /d/ routes without the tail', !/"route":"\/[ud]\/[A-Za-z0-9]/.test(logs));
  writeFileSync(join(OUT, 'server.log'), logs);
}
const bad = results.filter(r => r.startsWith('FAIL'));
console.log('\n' + bad.join('\n'));
console.log(`\n${results.length - bad.length}/${results.length} passed`);
process.exit(bad.length ? 1 : 0);
