import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { startMockOidc } from './mock-oidc.mjs';
import { vendorState } from '../vendor.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT = join(HERE, '..');
const OUT = process.argv[2] || join(HERE, 'out-auth');
const SRC_PROJECTS = process.argv[3] || join(KIT, 'projects');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.PORT) || 5193;
const MPORT = Number(process.env.MOCK_PORT) || 5194;
const RPORT = Number(process.env.RATE_PORT) || 5195;
const CPORT = Number(process.env.CHROME_PORT) || 9395;
const BASE = `http://localhost:${PORT}`;
const RBASE = `http://localhost:${RPORT}`;
const PID = 'cmw3e9k1l1';
const SECRET = 'kit-secret-' + randomBytes(6).toString('hex');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (label, cond, detail = '') => { results.push(`${cond ? 'PASS' : 'FAIL'} ${label}${cond || !detail ? '' : ' :: ' + detail}`); console.log(results.at(-1)); };
const until = async (fn, ms = 5000, step = 50) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return Date.now() - t0; } catch { } await sleep(step); }
  return -1;
};
const runExit = (env, args = []) => new Promise(res => {
  const p = spawn(process.execPath, [join(KIT, 'serve.mjs'), ...args], { cwd: KIT, env: { ...process.env, DATA_DIR: join(OUT, 'refuse'), PORT: String(RPORT), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', d => out += d);
  p.stderr.on('data', d => out += d);
  const t = setTimeout(() => p.kill('SIGKILL'), 6000);
  p.on('close', code => { clearTimeout(t); res({ code, out }); });
});

{
  const b = spawnSync(process.execPath, [join(KIT, 'build.mjs')], { encoding: 'utf8' });
  ok('build page', b.status === 0, b.stderr || b.stdout);
  if (!vendorState().every(v => v.ok)) spawnSync(process.execPath, [join(KIT, 'vendor.mjs')], { stdio: 'inherit' });
  ok('vendor files present with sha256', vendorState().every(v => v.ok), vendorState().map(v => v.file + ':' + (v.why || 'ok')).join(', '));
}

{
  const a = await runExit({ AUTH: 'dev', HOST: '0.0.0.0', PUBLIC_URL: `http://localhost:${RPORT}` });
  ok('AUTH=dev on 0.0.0.0 refuses to start', a.code !== 0 && /loopback/.test(a.out), `${a.code} ${a.out}`);
  const b = await runExit({ HOST: '0.0.0.0' }, ['--dev']);
  ok('--dev on 0.0.0.0 refuses to start', b.code !== 0 && /loopback/.test(b.out), `${b.code} ${b.out}`);
  const c = await runExit({ AUTH: 'oidc', HOST: '127.0.0.1', PUBLIC_URL: `http://localhost:${RPORT}`, OIDC_ISSUER: 'http://127.0.0.1:1', OIDC_CLIENT_ID: 'x', OIDC_CLIENT_SECRET: 'y', ALLOWED_EMAIL_DOMAINS: '', ALLOWED_GROUPS: '' });
  ok('OIDC without ALLOWED_* refuses to start', c.code !== 0 && /ALLOWED_EMAIL_DOMAINS/.test(c.out), `${c.code} ${c.out}`);
  const d = await runExit({ AUTH: 'oidc', HOST: '127.0.0.1', PUBLIC_URL: 'http://kit.example.com', OIDC_ISSUER: 'http://127.0.0.1:1', OIDC_CLIENT_ID: 'x', ALLOWED_EMAIL_DOMAINS: 'test.dev' });
  ok('http PUBLIC_URL (not localhost) refuses to start', d.code !== 0 && /https/.test(d.out), `${d.code} ${d.out}`);
}

const DATA = join(OUT, 'data');
{
  const dir = readdirSync(SRC_PROJECTS).find(n => n.endsWith('--' + PID));
  cpSync(join(SRC_PROJECTS, dir), join(OUT, 'projects-copy', dir), { recursive: true });
  const imp = spawnSync(process.execPath, [join(KIT, 'serve.mjs'), 'import', join(OUT, 'projects-copy')], { cwd: KIT, env: { ...process.env, DATA_DIR: DATA }, encoding: 'utf8' });
  ok('import dice project', imp.status === 0 && /Імпортовано 1 з 1/.test(imp.stdout), imp.stdout + imp.stderr);
}

const mock = await startMockOidc({ port: MPORT, clientSecret: SECRET });
writeFileSync(join(OUT, 'oidc-secret'), SECRET + '\n');
const logs = { main: '', rate: '' };
const spawnKit = (env, key) => {
  const p = spawn(process.execPath, [join(KIT, 'serve.mjs')], { cwd: KIT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', d => logs[key] += d);
  p.stderr.on('data', d => { logs[key] += d; process.stderr.write(`[${key}] ` + d); });
  return p;
};
const kit = spawnKit({ AUTH: 'oidc', HOST: '127.0.0.1', PORT: String(PORT), PUBLIC_URL: BASE, DATA_DIR: DATA, OIDC_ISSUER: mock.issuer, OIDC_CLIENT_ID: mock.clientId, OIDC_CLIENT_SECRET: '', OIDC_CLIENT_SECRET_FILE: join(OUT, 'oidc-secret'), ALLOWED_EMAIL_DOMAINS: 'test.dev', ALLOWED_GROUPS: 'kit-users', ADMIN_EMAILS: 'boss@test.dev', RATE_AUTH_PER_MIN: '1000', MAX_IMAGE_MB: '2' }, 'main');
ok('oidc server starts', await until(async () => (await fetch(BASE + '/healthz')).ok, 8000, 100) >= 0);

const secrets = new Set([SECRET]);
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
const walk = async (j, start, base = BASE) => {
  let url = start, res;
  for (let hop = 0; hop < 10; hop++) {
    const own = url.startsWith(base);
    res = await fetch(url, { redirect: 'manual', headers: own && j.size ? { cookie: cookieHdr(j) } : {} });
    if (own) keep(j, res);
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) { url = new URL(loc, url).href; continue; }
    break;
  }
  return { status: res.status, url, text: await res.text() };
};
const login = async (user, opts = {}) => {
  mock.user = user;
  mock.claims = opts.claims || {};
  mock.alg = opts.alg || 'RS256';
  mock.tamper = opts.tamper || null;
  const j = jar();
  const r = await walk(j, `${BASE}/auth/login?next=${encodeURIComponent(opts.next || '/')}`);
  mock.tamper = null;
  mock.alg = 'RS256';
  mock.claims = {};
  return { j, ...r };
};
const sessionOf = async j => {
  const r = await fetch(BASE + '/api/session', { headers: { cookie: cookieHdr(j) } });
  if (!r.ok) return { status: r.status };
  const s = await r.json();
  secrets.add(s.csrf);
  return { status: r.status, ...s };
};
const call = async (j, method, path, body, opts = {}) => {
  const s = opts.csrf === undefined ? await sessionOf(j) : { csrf: opts.csrf };
  const headers = { cookie: cookieHdr(j) };
  if (opts.origin !== null) headers.origin = opts.origin || BASE;
  if (opts.csrf !== null && s.csrf) headers['x-kit-csrf'] = s.csrf;
  if (body !== undefined && !(body instanceof Buffer)) headers['content-type'] = 'application/json';
  const r = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : body instanceof Buffer ? body : JSON.stringify(body) });
  let out = null;
  const text = await r.text();
  try { out = JSON.parse(text); } catch { out = text; }
  return { status: r.status, body: out, headers: r.headers };
};

const anya = await login({ email: 'anya@test.dev', name: 'Аня' });
{
  const s = await sessionOf(anya.j);
  ok('OIDC login works', anya.status === 200 && anya.url === BASE + '/' && s.status === 200 && s.user.email === 'anya@test.dev' && s.role === 'editor', `${anya.status} ${anya.url} ${JSON.stringify(s)}`);
  ok('session cookie is kit_sid (http) and flow cookie cleared', anya.j.has('kit_sid') && !anya.j.has('kit_oidc'), [...anya.j.keys()].join(','));
}
{
  const g = await login({ email: 'ola@partner.example', name: 'Оля' }, { claims: { groups: ['kit-users'] } });
  ok('ALLOWED_GROUPS lets in another domain', g.status === 200 && (await sessionOf(g.j)).status === 200, `${g.status} ${g.text.slice(0, 120)}`);
  const x = await login({ email: 'x@evil.example', name: 'X' });
  ok('foreign domain sees «Немає доступу»', x.status === 403 && /Немає доступу/.test(x.text) && x.text.includes('x@evil.example') && /Вийти/.test(x.text) && !x.j.has('kit_sid'), `${x.status} ${x.text.slice(0, 200)}`);
  const v = await login({ email: 'unverified@test.dev', name: 'U' }, { claims: { email_verified: false } });
  ok('email_verified=false is denied', v.status === 403 && /Немає доступу/.test(v.text) && !v.j.has('kit_sid'), String(v.status));
  const pu = await login({ email: '', name: 'P' }, { claims: { email: undefined, preferred_username: 'petro@test.dev' } });
  ok('email from preferred_username', pu.status === 200 && (await sessionOf(pu.j)).user?.email === 'petro@test.dev', `${pu.status} ${pu.text.slice(0, 120)}`);
  const es = await login({ email: 'es@test.dev', name: 'Ес' }, { alg: 'ES256' });
  ok('ES256 ID token accepted', es.status === 200 && (await sessionOf(es.j)).status === 200, `${es.status} ${es.text.slice(0, 160)}`);
  for (const t of ['sig', 'aud', 'iss', 'exp', 'nonce', 'none']) {
    const r = await login({ email: 'anya@test.dev', name: 'Аня' }, { tamper: t });
    ok(`tampered ID token (${t}) rejected`, r.status === 400 && /Вхід не вдався/.test(r.text) && !r.j.has('kit_sid'), `${r.status} ${r.text.slice(0, 160)}`);
  }
  mock.deny = true;
  const dn = await login({ email: 'anya@test.dev', name: 'Аня' });
  mock.deny = false;
  ok('SSO error=access_denied handled', dn.status === 400 && /access_denied/.test(dn.text), `${dn.status} ${dn.text.slice(0, 160)}`);
  const ev = await login({ email: 'anya@test.dev', name: 'Аня' }, { next: '//evil.example/x' });
  const ev2 = await login({ email: 'anya@test.dev', name: 'Аня' }, { next: 'https://evil.example/' });
  ok('next is only a relative path', ev.url === BASE + '/' && ev2.url === BASE + '/', `${ev.url} ${ev2.url}`);
}
{
  mock.user = { email: 'anya@test.dev', name: 'Аня' };
  const j = jar();
  const r1 = await fetch(`${BASE}/auth/login?next=/`, { redirect: 'manual' });
  keep(j, r1);
  const r2 = await fetch(r1.headers.get('location'), { redirect: 'manual' });
  const cb = r2.headers.get('location');
  const stranger = await fetch(cb, { redirect: 'manual' });
  ok('callback without the flow cookie fails (login CSRF)', stranger.status === 400, String(stranger.status));
  const j2 = jar();
  const s1 = await fetch(`${BASE}/auth/login?next=/`, { redirect: 'manual' });
  keep(j2, s1);
  const s2 = await fetch(s1.headers.get('location'), { redirect: 'manual' });
  const cb2 = s2.headers.get('location');
  const flowCookie = cookieHdr(j2);
  const first = await fetch(cb2, { redirect: 'manual', headers: { cookie: flowCookie } });
  keep(j2, first);
  const again = await fetch(cb2, { redirect: 'manual', headers: { cookie: flowCookie } });
  ok('callback state is single-use', first.status === 303 && again.status === 400, `${first.status} ${again.status}`);
}

const boss = await login({ email: 'boss@test.dev', name: 'Бос' });
{
  ok('ADMIN_EMAILS gives admin role', (await sessionOf(boss.j)).role === 'admin');
  const t1 = await call(anya.j, 'GET', '/api/trash');
  ok('editor cannot open trash (403)', t1.status === 403, String(t1.status));
  const cr = await call(anya.j, 'POST', '/api/projects', { settings: { game: 'trash-me', reels: 5, rows: 3, components: [] } });
  const id = cr.body?.id;
  const del = await call(anya.j, 'DELETE', `/api/projects/${id}`);
  const tr = await call(boss.j, 'GET', '/api/trash');
  ok('admin sees deleted project in trash', del.status === 200 && tr.status === 200 && tr.body.some(p => p.id === id && p.deleted?.by?.email === 'anya@test.dev'), JSON.stringify(tr.body).slice(0, 200));
  const un1 = await call(anya.j, 'POST', `/api/projects/${id}/undelete`, {});
  const un2 = await call(boss.j, 'POST', `/api/projects/${id}/undelete`, {});
  const list = await call(anya.j, 'GET', '/api/projects');
  ok('only admin restores from trash', un1.status === 403 && un2.status === 200 && list.body.some(p => p.id === id), `${un1.status} ${un2.status}`);
  const au = await call(boss.j, 'GET', '/api/audit?limit=500');
  const types = new Set((au.body || []).map(e => e.type));
  ok('audit has login, denied, failed, create, delete, undelete', ['login', 'login.denied', 'login.failed', 'project.create', 'project.delete', 'project.undelete'].every(t => types.has(t)), [...types].join(','));
  ok('editor cannot read audit (403)', (await call(anya.j, 'GET', '/api/audit')).status === 403);
}

{
  const body = { settings: { game: 'csrf', reels: 5, rows: 3, components: [] } };
  const noOrigin = await call(anya.j, 'POST', '/api/projects', body, { origin: null });
  const badOrigin = await call(anya.j, 'POST', '/api/projects', body, { origin: 'http://evil.example' });
  const noCsrf = await call(anya.j, 'POST', '/api/projects', body, { csrf: null });
  const wrongCsrf = await call(anya.j, 'POST', '/api/projects', body, { csrf: 'nope' });
  const del = await call(anya.j, 'DELETE', `/api/projects/${PID}`, undefined, { csrf: null });
  ok('POST without Origin → 403', noOrigin.status === 403, String(noOrigin.status));
  ok('POST with foreign Origin → 403', badOrigin.status === 403, String(badOrigin.status));
  ok('POST without X-Kit-Csrf → 403 (x-kit-error: csrf)', noCsrf.status === 403 && noCsrf.headers.get('x-kit-error') === 'csrf', String(noCsrf.status));
  ok('POST with wrong X-Kit-Csrf → 403', wrongCsrf.status === 403, String(wrongCsrf.status));
  ok('DELETE without X-Kit-Csrf → 403', del.status === 403, String(del.status));
  const raw = (host, path) => new Promise(res => {
    const r = request({ host: '127.0.0.1', port: PORT, path, headers: { host, cookie: cookieHdr(anya.j) } }, x => { x.resume(); x.on('end', () => res(x.statusCode)); });
    r.on('error', () => res(0));
    r.end();
  });
  ok('foreign Host → 421', await raw(`evil.example:${PORT}`, '/') === 421 && await raw(`127.0.0.1:${PORT}`, '/api/session') === 421);
  ok('/healthz answers any Host', await raw('evil.example', '/healthz') === 200);
  const lo1 = await fetch(BASE + '/auth/logout', { method: 'POST', redirect: 'manual', headers: { cookie: cookieHdr(boss.j), origin: BASE, 'content-type': 'application/x-www-form-urlencoded' }, body: '' });
  ok('logout without csrf → 403', lo1.status === 403, String(lo1.status));
}

{
  const r = await fetch(BASE + '/', { headers: { cookie: cookieHdr(anya.j) } });
  const html = await r.text();
  const csp = r.headers.get('content-security-policy') || '';
  const want = [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)].filter(m => !(m[1] && /src=/.test(m[1]))).map(m => `'sha256-${createHash('sha256').update(m[2]).digest('base64')}'`);
  ok('page CSP lists hashes of every inline script', want.length >= 8 && want.every(h => csp.includes(h)), `${want.length} scripts; ${csp.slice(0, 160)}`);
  ok('page CSP directives', ["default-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' blob: data:", "connect-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'"].every(d => csp.includes(d)) && !/unsafe-eval/.test(csp), csp);
  ok('security headers', r.headers.get('x-content-type-options') === 'nosniff' && r.headers.get('referrer-policy') === 'same-origin' && r.headers.get('cross-origin-opener-policy') === 'same-origin' && r.headers.get('cross-origin-resource-policy') === 'same-origin' && /camera=\(\)/.test(r.headers.get('permissions-policy') || '') && !r.headers.get('strict-transport-security'));
  ok('page uses /vendor instead of CDN', html.includes("'/vendor/spine-player-4.1.55.min.js'") && html.includes("'/vendor/jszip-3.10.1.min.js'") && !html.includes('https://cdn.jsdelivr.net/npm/') && !html.includes('https://cdnjs.cloudflare.com/ajax/'));
  const v = await fetch(BASE + '/vendor/spine-player-4.1.55.min.js');
  const vb = Buffer.from(await v.arrayBuffer());
  ok('/vendor serves pinned file', v.status === 200 && /javascript/.test(v.headers.get('content-type')) && createHash('sha256').update(vb).digest('hex') === vendorState()[0].sha256);
  ok('/vendor unknown file → 404', (await fetch(BASE + '/vendor/../serve.mjs')).status === 404 && (await fetch(BASE + '/vendor/evil.js')).status === 404);
  const lp = await fetch(BASE + '/auth/bye');
  ok('auth pages get strict CSP', /default-src 'none'/.test(lp.headers.get('content-security-policy') || ''));
}

const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, c]);
};
const png = (w, h, pad = 0) => {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const rows = Math.min(h, 4), raw = Buffer.alloc((Math.min(w, 4) * 4 + 1) * rows, 0x7f);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), pad ? chunk('tEXt', randomBytes(pad)) : Buffer.alloc(0), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};
const shaOf = b => createHash('sha256').update(b).digest('hex');
const put = async buf => (await call(anya.j, 'PUT', '/api/blobs/' + shaOf(buf), buf)).status;
{
  const good = png(4, 4);
  ok('valid PNG accepted', await put(good) === 200);
  const g = await fetch(BASE + '/api/blobs/' + shaOf(good), { headers: { cookie: cookieHdr(anya.j) } });
  ok('blob served with nosniff + sandbox CSP', g.headers.get('content-type') === 'image/png' && g.headers.get('x-content-type-options') === 'nosniff' && /sandbox/.test(g.headers.get('content-security-policy') || ''));
  ok('SVG rejected', await put(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="10" height="10"/></svg>')) === 415);
  ok('GIF rejected', await put(Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(40)])) === 415);
  ok('HTML named .png rejected', await put(Buffer.from('<!doctype html><script>alert(1)</script>')) === 415);
  ok('PNG header + HTML (forged PNG) rejected', await put(Buffer.concat([good.subarray(0, 33), Buffer.from('<html><script>alert(1)</script></html>')])) === 415);
  ok('PNG with junk after IEND rejected', await put(Buffer.concat([good, Buffer.from('<script>alert(1)</script>')])) === 415);
  const bad = Buffer.from(good); bad[good.length - 20] ^= 0xff;
  ok('PNG with broken CRC rejected', await put(bad) === 415);
  ok('PNG 9000×9000 rejected (413)', await put(png(9000, 9000)) === 413);
  ok('PNG 8192×8192 accepted', await put(png(8192, 8192)) === 200);
  ok('image > MAX_IMAGE_MB rejected (413)', await put(png(64, 64, 3 * 1024 * 1024)) === 413);
}

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CPORT}`, `--user-data-dir=${join(OUT, 'profile')}`, '--no-first-run', '--no-default-browser-check', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1320,940', 'about:blank'], { stdio: 'ignore' });
let wsUrl = null;
for (let i = 0; i < 60 && !wsUrl; i++) { await sleep(200); try { wsUrl = (await (await fetch(`http://127.0.0.1:${CPORT}/json/version`)).json()).webSocketDebuggerUrl; } catch { } }
const ws = new WebSocket(wsUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let mid = 0;
const waiting = new Map();
const errors = [], cspHits = [], external = [];
const allowedOrigins = new Set([new URL(BASE).origin, new URL(mock.issuer).origin]);
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); return; }
  const p = m.params || {};
  if (m.method === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails.exception?.description || p.exceptionDetails.text);
  if (m.method === 'Log.entryAdded' && /Content Security Policy|Content-Security-Policy/i.test(p.entry.text)) cspHits.push(p.entry.text.slice(0, 200));
  if (m.method === 'Runtime.consoleAPICalled' && p.args.some(a => /Content Security Policy/i.test(String(a.value)))) cspHits.push(String(p.args[0].value).slice(0, 200));
  if (m.method === 'Network.requestWillBeSent') {
    const u = p.request.url;
    if (/^(https?|wss?):/.test(u) && !allowedOrigins.has(new URL(u).origin)) external.push(u);
  }
});
const cdp = (method, params = {}, sessionId) => new Promise(res => { const i = ++mid; waiting.set(i, res); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
const tab = async (ctx, url) => {
  const { result: { targetId } } = await cdp('Target.createTarget', { url: 'about:blank', browserContextId: ctx });
  const { result: { sessionId } } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  for (const d of ['Runtime', 'Page', 'Log', 'Network']) await cdp(`${d}.enable`, {}, sessionId);
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI), true);` }, sessionId);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1320, height: 940, deviceScaleFactor: 1, mobile: false }, sessionId);
  const t = { sessionId, targetId };
  t.ev = async expr => {
    const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.result?.exceptionDetails) throw new Error(`eval: ${expr.slice(0, 120)} -> ${r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text}`);
    return r.result?.result?.value;
  };
  t.go = async u => { await cdp('Page.navigate', { url: u }, sessionId); await sleep(300); };
  t.ready = () => until(async () => await t.ev(`!!(window.SpineKitSync && SpineKitSync.app && SpineKitSync.app() && SpineKitSync.status().pid && SpineKitSync.status().live)`), 15000, 100);
  if (url) await t.go(url);
  return t;
};

const ctx = (await cdp('Target.createBrowserContext')).result.browserContextId;
mock.user = { email: 'anya@test.dev', name: 'Аня' };
const A = await tab(ctx, `${BASE}/p/${PID}`);
ok('browser: SSO login lands on /p/<id>', await A.ready() >= 0 && await A.ev('location.pathname') === `/p/${PID}`);
const libs = await until(() => A.ev(`(() => { const L = SpineKitSync.app().state.lib; return L && L.spine === 'ok' && L.zip === 'ok'; })()`), 20000, 200);
ok('browser: spine-player and JSZip load from /vendor', libs >= 0, JSON.stringify(await A.ev(`SpineKitSync.app().state.lib`)));
ok('browser: preview canvas mounted', await until(() => A.ev(`!!document.querySelector('#stage canvas')`), 15000, 200) >= 0);
{
  const menu = await A.ev(`(() => { const m = document.getElementById('sk-me'); return m && !m.hidden ? m.textContent + (document.getElementById('sk-logout') ? ' Вийти' : '') + (document.getElementById('sk-trash-btn') ? ' Кошик' : '') : ''; })()`);
  ok('browser: sidebar account shows the user', /anya@test\.dev/.test(menu) && /Вийти/.test(menu) && !/Кошик/.test(menu), menu);
}
const cookieIn = async t => (await cdp('Network.getCookies', { urls: [BASE] }, t.sessionId)).result?.cookies?.find(c => c.name === 'kit_sid');
{
  const c1 = await cookieIn(A);
  secrets.add(c1.value);
  const j = new Map([['kit_sid', c1.value]]);
  const s = await sessionOf(j);
  const lo = await fetch(BASE + '/auth/logout', { method: 'POST', redirect: 'manual', headers: { cookie: cookieHdr(j), origin: BASE, 'content-type': 'application/x-www-form-urlencoded' }, body: 'csrf=' + encodeURIComponent(s.csrf) });
  ok('logout with csrf → /auth/bye, session gone', lo.status === 303 && lo.headers.get('location') === '/auth/bye' && (await sessionOf(j)).status === 401, `${lo.status} ${lo.headers.get('location')}`);
  await A.ev(`(() => { const i = document.getElementById('g-name'); i.value = 'after-relogin'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  const banner = await until(() => A.ev(`(() => { const b = document.getElementById('sk-banner'); return !b.hidden && /Сесія завершилась/.test(b.textContent); })()`), 10000, 100);
  ok('browser: banner «Сесія завершилась» after session ends', banner >= 0);
  const waitingEdits = await A.ev(`SpineKitSync.status().outbox`);
  const L = await tab(ctx, `${BASE}/auth/login?next=${encodeURIComponent('/auth/done')}`);
  ok('browser: re-login in a new tab', await until(() => L.ev(`location.pathname === '/auth/done' && /Вхід виконано/.test(document.body.textContent)`), 10000, 100) >= 0);
  const docOk = await until(async () => (await call(anya.j, 'GET', `/api/projects/${PID}`)).body.settings.game === 'after-relogin', 20000, 200);
  ok('browser: unsaved edit arrives after new login', waitingEdits > 0 && docOk >= 0, `outbox=${waitingEdits} ${docOk}`);
  ok('browser: banner hides after new login', await until(() => A.ev(`document.getElementById('sk-banner').hidden`), 10000, 200) >= 0);
  const c2 = await cookieIn(A);
  if (c2) secrets.add(c2.value);
  ok('browser: new session cookie', !!c2 && c2.value !== c1.value && c2.httpOnly && c2.sameSite === 'Lax');
  const lcsp = await L.ev(`window.__csp.length`);
  await cdp('Target.closeTarget', { targetId: L.targetId });
  ok('browser: auth pages without CSP violations', lcsp === 0, String(lcsp));
}
{
  await A.ev(`SpineKitSync.idle()`);
  const v = await A.ev(`window.__csp.slice(0, 5)`);
  ok('browser: zero CSP violations on the kit page', v.length === 0 && cspHits.length === 0, JSON.stringify(v.concat(cspHits).slice(0, 5)));
  ok('browser: zero requests to external hosts', external.length === 0, external.slice(0, 5).join(' '));
  ok('browser: no page errors', errors.length === 0, errors.slice(0, 3).join(' || '));
  await A.ev(`(() => { const s = document.createElement('script'); s.textContent = 'window.__pwned = 1'; document.head.appendChild(s); const i = new Image(); i.src = 'https://example.com/x.png'; return true; })()`);
  await sleep(300);
  ok('browser: control — injected inline script and external image are blocked and detected', (await A.ev(`!window.__pwned && window.__csp.length >= 2`)) && cspHits.length >= 1, JSON.stringify(await A.ev(`window.__csp`)));
  await A.ev(`document.getElementById('sk-logout').click(), true`);
  ok('browser: «Вийти» from the menu', await until(() => A.ev(`location.pathname === '/auth/bye'`), 8000, 100) >= 0);
  ok('browser: no session after «Вийти»', !(await cookieIn(A)));
}
{
  const ctx2 = (await cdp('Target.createBrowserContext')).result.browserContextId;
  mock.user = { email: 'boss@test.dev', name: 'Бос' };
  const B = await tab(ctx2, `${BASE}/`);
  await until(() => B.ev(`!!(window.SpineKitSync && SpineKitSync.me && SpineKitSync.me())`), 15000, 100);
  const cr = await call(anya.j, 'POST', '/api/projects', { settings: { game: 'bin-ui', reels: 5, rows: 3, components: [] } });
  await call(anya.j, 'DELETE', `/api/projects/${cr.body.id}`);
  await until(() => B.ev(`!!document.getElementById('sk-me') && !document.getElementById('sk-me').hidden`), 8000, 100);
  await B.ev(`document.getElementById('sk-trash-btn').click(), true`);
  const row = await until(() => B.ev(`[...document.querySelectorAll('#sk-trash-list .sk-t')].some(li => /bin-ui/.test(li.textContent))`), 8000, 100);
  ok('browser: admin «Кошик» lists deleted project', row >= 0);
  await B.ev(`[...document.querySelectorAll('#sk-trash-list .sk-t')].find(li => /bin-ui/.test(li.textContent)).querySelector('button').click(), true`);
  const back = await until(async () => (await call(anya.j, 'GET', '/api/projects')).body.some(p => p.id === cr.body.id), 8000, 200);
  ok('browser: «Відновити» returns it to the list', back >= 0);
  ok('browser: admin page without CSP violations', (await B.ev(`window.__csp.length`)) === 0);
  await cdp('Target.disposeBrowserContext', { browserContextId: ctx2 });
}
await cdp('Target.disposeBrowserContext', { browserContextId: ctx });
chrome.kill();

const rate = spawnKit({ AUTH: 'dev', HOST: '127.0.0.1', PORT: String(RPORT), PUBLIC_URL: RBASE, DATA_DIR: join(OUT, 'rate-data') }, 'rate');
ok('rate server starts', await until(async () => (await fetch(RBASE + '/healthz')).ok, 8000, 100) >= 0);
{
  const j = jar();
  const r0 = await fetch(RBASE + '/auth/login', { redirect: 'manual' });
  await r0.text();
  const r1 = await fetch(RBASE + '/auth/dev', { method: 'POST', redirect: 'manual', headers: { origin: RBASE, 'content-type': 'application/x-www-form-urlencoded' }, body: 'name=R&email=r%40test.dev&next=%2F' });
  keep(j, r1);
  const s = await (await fetch(RBASE + '/api/session', { headers: { cookie: cookieHdr(j) } })).json();
  secrets.add(s.csrf);
  const h = { cookie: cookieHdr(j), origin: RBASE, 'x-kit-csrf': s.csrf, 'content-type': 'application/json' };
  const edits = await Promise.all(Array.from({ length: 160 }, async () => (await fetch(RBASE + '/api/projects/nope/ops', { method: 'POST', headers: h, body: '{"client":"x","seq":1,"ops":[]}' })).status));
  const n429 = edits.filter(x => x === 429).length;
  ok('edits over 30/s (burst 120) → 429', n429 >= 20 && edits.filter(x => x !== 429).length >= 110, `429×${n429}`);
  const ra = await fetch(RBASE + '/api/projects/nope/ops', { method: 'POST', headers: h, body: '{}' });
  ok('429 has Retry-After', ra.status === 429 && Number(ra.headers.get('retry-after')) >= 1, `${ra.status} ${ra.headers.get('retry-after')}`);
  const ups = await Promise.all(Array.from({ length: 320 }, async (_, i) => (await fetch(RBASE + '/api/blobs/' + 'a'.repeat(63) + (i % 10), { method: 'PUT', headers: { cookie: h.cookie, origin: RBASE, 'x-kit-csrf': s.csrf }, body: Buffer.from('x') })).status));
  ok('uploads over 300 per 10 min → 429', ups.filter(x => x === 429).length >= 15, `429×${ups.filter(x => x === 429).length}`);
  const auths = [];
  for (let i = 0; i < 12; i++) auths.push((await fetch(RBASE + '/auth/login')).status);
  ok('/auth/* over 10/min per IP → 429', auths.includes(429) && auths.indexOf(429) <= 9, auths.join(','));
}
rate.kill('SIGTERM');
kit.kill('SIGTERM');
await sleep(500);
for (const t of mock.issued) secrets.add(t);
for (const s of mock.seen) { if (s.state) secrets.add(s.state); if (s.nonce) secrets.add(s.nonce); if (s.challenge) secrets.add(s.challenge); }
{
  const all = logs.main + logs.rate;
  const leaked = [...secrets].filter(s => s && s.length >= 12 && all.includes(s));
  ok('logs: no cookies, csrf, codes, tokens, state or secrets', leaked.length === 0 && secrets.size > 20, `${leaked.length} leaked of ${secrets.size}: ${leaked.slice(0, 3).map(s => s.slice(0, 12) + '…').join(', ')}`);
  const lines = logs.main.split('\n').filter(Boolean);
  const parsed = lines.map(l => { try { return JSON.parse(l); } catch { return null; } });
  ok('logs: stdout is JSON lines', parsed.every(Boolean), lines.find((l, i) => !parsed[i]) || '');
  const reqs = parsed.filter(p => p && p.kind === 'req');
  ok('logs: request lines have id, user, route, status, ms', reqs.length > 50 && reqs.every(r => r.id && 'user' in r && r.route && r.status && Number.isFinite(r.ms)) && reqs.some(r => r.route === '/auth/callback' && r.user === null) && reqs.some(r => r.user === 'anya@test.dev'));
  ok('logs: routes carry no query string', reqs.every(r => !r.route.includes('?') && !r.route.includes('code=')));
  writeFileSync(join(OUT, 'server.log'), all);
}
{
  const hits = [];
  for (const f of readdirSync(join(KIT, 'src')).filter(f => f.endsWith('.js'))) readFileSync(join(KIT, 'src', f), 'utf8').split('\n').forEach((l, i) => { if (/innerHTML|insertAdjacentHTML/.test(l)) hits.push({ f, i: i + 1, l: l.trim() }); });
  const SAFE = /insertAdjacentHTML\('(beforeend|afterbegin)', (TICK|CHEVRON|ART_ICON)\)|innerHTML = '<svg[^']*'\s*\+\s*(ICONS\.upload|it\.icon|paths)\s*\+\s*'<\/svg>'|innerHTML = Info\.(miniGrid|cellArt|icon)\(|\$\('dlg-(art|text)'\)\.innerHTML = r\.(art \|\| ''|html)/;
  const odd = hits.filter(h => !SAFE.test(h.l));
  ok(`innerHTML/insertAdjacentHTML: ${hits.length} places, only icons and number-only SVG`, odd.length === 0, odd.map(h => `${h.f}:${h.i}`).join(' '));
}

await mock.close();
const bad = results.filter(r => r.startsWith('FAIL'));
console.log('\n' + bad.join('\n'));
console.log(`\n${results.length - bad.length}/${results.length} passed`);
process.exit(bad.length ? 1 : 0);
