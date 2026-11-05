import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { writeFileSync, mkdirSync, rmSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { startMockOidc } from './mock-oidc.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT = join(HERE, '..');
const OUT = process.argv[2] || join(HERE, 'out-docker');
const IMAGE = process.env.IMAGE || 'spine-draft-kit:test';
const PORT = Number(process.env.PORT) || 5201;
const MPORT = Number(process.env.MOCK_PORT) || 5202;
const NAME = process.env.CONTAINER || 'spine-kit-check';
const VOLUME = NAME + '-data';
const BASE = `http://localhost:${PORT}`;
const RESOURCE = BASE + '/mcp';
const REDIRECT = 'http://127.0.0.1:5188/callback';
const SECRET = 'docker-secret';

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const facts = [];
const ok = (label, cond, detail = '') => { results.push(`${cond ? 'PASS' : 'FAIL'} ${label}${cond || !detail ? '' : ' :: ' + String(detail).slice(0, 600)}`); console.log(results.at(-1)); };
const note = s => { facts.push(s); console.log('   ' + s); };
const until = async (fn, ms = 5000, step = 200) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return Date.now() - t0; } catch { } await sleep(step); }
  return -1;
};
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
const docker = (...args) => sh('docker', args);
const dockerAsync = async (...args) => {
  const p = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', d => { out += d; });
  p.stderr.on('data', d => { out += d; });
  const [status] = await once(p, 'close');
  return { status, out };
};
const b64 = b => Buffer.from(b).toString('base64url');
const secrets = new Set();
const MB = n => Math.round(n / 1024 / 1024);

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

const ART = join(OUT, 'art');
mkdirSync(ART, { recursive: true });
writeFileSync(join(ART, 'high_1.png'), png(220, 220, [230, 60, 60]));
writeFileSync(join(ART, 'low_1.png'), png(200, 200, [60, 120, 230]));

if (process.env.BUILD) {
  const args = ['build', '-t', IMAGE];
  if (process.env.NODE_IMAGE) args.push('--build-arg', 'NODE_IMAGE=' + process.env.NODE_IMAGE);
  const t0 = Date.now();
  const b = sh('docker', [...args, KIT], { stdio: ['ignore', 'pipe', 'pipe'] });
  ok('docker build', b.status === 0, (b.stderr || b.stdout).slice(-600));
  note(`build took ${Math.round((Date.now() - t0) / 1000)} s`);
}
{
  const i = docker('image', 'inspect', IMAGE, '--format', '{{json .}}');
  ok('image exists', i.status === 0, i.stderr);
  const { Size: size, Config: c = {} } = i.status === 0 ? JSON.parse(i.stdout) : {};
  note(`image size ${MB(Number(size))} MB`);
  ok('image: USER node, DATA_DIR=/data, VOLUME /data, EXPOSE 8080', c.User === 'node' && c.Env.includes('DATA_DIR=/data') && '/data' in (c.Volumes || {}) && '8080/tcp' in (c.ExposedPorts || {}), JSON.stringify(c).slice(0, 400));
  ok('image: HEALTHCHECK on /healthz, CMD node serve.mjs', /healthz/.test(c.Healthcheck?.Test?.join(' ')) && JSON.stringify(c.Cmd) === '["node","serve.mjs"]', JSON.stringify([c.Healthcheck, c.Cmd, c.Entrypoint]));
}

const FORWARD = `const net=require('net');net.createServer(c=>{const u=net.connect(${MPORT},'host.docker.internal');c.pipe(u).pipe(c);u.on('error',()=>c.destroy());c.on('error',()=>u.destroy())}).listen(${MPORT},'127.0.0.1')`;
const forward = () => docker('exec', '-d', NAME, 'node', '-e', FORWARD);
const cleanup = () => { docker('rm', '-f', NAME); if (!process.env.KEEP) docker('volume', 'rm', '-f', VOLUME); };
docker('rm', '-f', NAME);
docker('volume', 'rm', '-f', VOLUME);
process.on('exit', cleanup);

const mock = await startMockOidc({ port: MPORT, clientSecret: SECRET });
{
  const env = { PUBLIC_URL: BASE, OIDC_ISSUER: mock.issuer, OIDC_CLIENT_ID: mock.clientId, OIDC_CLIENT_SECRET: SECRET, ALLOWED_EMAIL_DOMAINS: 'test.dev', ADMIN_EMAILS: 'anya@test.dev', RATE_AUTH_PER_MIN: '1000', ENGINE_IDLE_MIN: '0.5', ENGINE_NO_SANDBOX: process.env.ENGINE_NO_SANDBOX ?? '1' };
  const r = docker('run', '-d', '--name', NAME, '-p', `127.0.0.1:${PORT}:8080`, '-v', `${VOLUME}:/data`, '--health-interval=3s', '--health-start-period=5s', ...String(process.env.EXTRA_RUN_ARGS || '').split(' ').filter(Boolean), ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]), IMAGE);
  ok('docker run', r.status === 0, r.stderr);
}
const started = async label => {
  const up = await until(async () => (await fetch(BASE + '/healthz')).ok, 20000);
  ok(`${label}: /healthz answers from the host`, up >= 0, docker('logs', '--tail', '20', NAME).stderr);
  const f = forward();
  ok(`${label}: mock OIDC reachable from the container`, f.status === 0 && await until(async () => (await dockerAsync('exec', NAME, 'node', '--input-type=module', '-e', `process.exit((await fetch('http://127.0.0.1:${MPORT}/.well-known/openid-configuration', { signal: AbortSignal.timeout(3000) })).ok ? 0 : 1)`)).status === 0, 15000, 500) >= 0, f.stderr);
  const healthy = await until(() => docker('inspect', '-f', '{{.State.Health.Status}}', NAME).stdout.trim() === 'healthy', 30000, 1000);
  ok(`${label}: docker healthcheck is healthy`, healthy >= 0, docker('inspect', '-f', '{{json .State.Health}}', NAME).stdout.slice(0, 400));
};
await started('start');
{
  const id = docker('exec', NAME, 'id', '-u');
  const top = docker('top', NAME, '-o', 'user,pid,comm');
  const users = top.stdout.trim().split('\n').slice(1).map(l => l.trim().split(/\s+/)[0]);
  ok('process is not root (uid and every process)', id.stdout.trim() !== '0' && users.length > 0 && users.every(u => u !== 'root' && u !== '0'), `${id.stdout} ${top.stdout}`);
  const w = docker('exec', NAME, 'sh', '-c', 'touch /app/x 2>&1; touch /data/x && rm /data/x && echo data-ok');
  ok('code is read-only for the user, /data is writable', /Permission denied|Read-only file system/.test(w.stdout) && /data-ok/.test(w.stdout), w.stdout + w.stderr);
}

const memory = label => {
  const s = docker('stats', '--no-stream', '--format', '{{.MemUsage}}', NAME).stdout.trim();
  const p = docker('exec', NAME, 'sh', '-c', 'for d in /proc/[0-9]*; do n=$(cat $d/comm 2>/dev/null); k=$(grep "^Pss:" $d/smaps_rollup 2>/dev/null | tr -s " " | cut -d" " -f2); [ -n "$k" ] && echo "$n $k"; done').stdout;
  const st = Object.fromEntries(docker('exec', NAME, 'cat', '/sys/fs/cgroup/memory.stat').stdout.trim().split('\n').map(l => l.split(' ')));
  const shm = docker('exec', NAME, 'df', '-k', '/dev/shm').stdout.trim().split('\n').at(-1).split(/\s+/)[2];
  const sum = {};
  for (const l of p.trim().split('\n')) { const [n, k] = l.split(' '); const g = /chrom/i.test(n) ? 'chromium' : /^(node|MainThread)$/.test(n) ? 'node' : 'other'; sum[g] = (sum[g] || 0) + Number(k); }
  note(`memory ${label}: docker stats ${s}; cgroup anon ${MB(Number(st.anon))} MB, shmem ${MB(Number(st.shmem))} MB; PSS node ${Math.round((sum.node || 0) / 1024)} MB, chromium ${Math.round((sum.chromium || 0) / 1024)} MB; /dev/shm used ${Math.round(Number(shm) / 1024)} MB`);
  return sum;
};

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
    if (res.status >= 300 && res.status < 400 && loc && !loc.startsWith('http://127.0.0.1:5188/')) { url = new URL(loc, url).href; continue; }
    break;
  }
  return { status: res.status, url, text: await res.text(), headers: res.headers };
};
const form = (path, body, headers = {}) => fetch(BASE + path, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(body).toString() });
const pkce = () => { const v = b64(randomBytes(40)); return { v, c: createHash('sha256').update(v).digest('base64url') }; };
const authorize = async (j, user, clientId) => {
  mock.user = user;
  const p = pkce();
  const state = b64(randomBytes(12));
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: p.c, code_challenge_method: 'S256', state, scope: 'kit', resource: RESOURCE });
  const page = await walk(j, `${BASE}/oauth/authorize?${q}`);
  const req = /name="req" value="([^"]+)"/.exec(page.text);
  const csrf = /name="csrf" value="([^"]+)"/.exec(page.text);
  if (!req || !csrf) return { page };
  const res = await form('/oauth/authorize', { req: req[1], csrf: csrf[1], decision: 'allow' }, { cookie: cookieHdr(j), origin: BASE });
  const u = new URL(res.headers.get('location') || 'http://x/');
  const code = u.searchParams.get('code');
  if (code) secrets.add(code);
  return { page, code, verifier: p.v };
};
const client = token => {
  const c = { token, sid: null, n: 0, pv: null };
  c.raw = async msg => {
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    if (c.token) headers.authorization = 'Bearer ' + c.token;
    if (c.sid) headers['mcp-session-id'] = c.sid;
    if (c.pv) headers['mcp-protocol-version'] = c.pv;
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
    c.sid = null;
    const r = await c.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'check-docker', version: '1' } });
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
    return { status: r.status, error: !!res.isError, text, json, images: (res.content || []).filter(x => x.type === 'image') };
  };
  return c;
};

const ANYA = { email: 'anya@test.dev', name: 'Аня' };
const OLYA = { email: 'olya@test.dev', name: 'Оля' };

const human = jar();
{
  mock.user = OLYA;
  const r = await walk(human, `${BASE}/auth/login?next=/`);
  const s = await (await fetch(BASE + '/api/session', { headers: { cookie: cookieHdr(human) } })).json();
  if (s.csrf) secrets.add(s.csrf);
  ok('human login via mock OIDC (SSO → callback → session)', s.user?.email === 'olya@test.dev' && s.role === 'editor', `${r.status} ${r.url} ${JSON.stringify(s)}`);
  const page = await fetch(BASE + '/', { headers: { cookie: cookieHdr(human) } });
  const html = await page.text();
  ok('page served with CSP and /vendor scripts', page.ok && /script-src 'self'/.test(page.headers.get('content-security-policy') || '') && html.includes('/vendor/spine-player-4.1.55.min.js') && !html.includes('cdn.jsdelivr.net/npm/@esotericsoftware'), page.status);
  mock.user = { email: 'eve@evil.dev', name: 'Єва' };
  const deny = await walk(jar(), `${BASE}/auth/login?next=/`);
  ok('foreign domain → «Немає доступу»', /Немає доступу/.test(deny.text), deny.text.slice(0, 200));
}
memory('idle, after login');

let A, PID, CID, tokens;
{
  const reg = await fetch(BASE + '/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude Code (docker)', redirect_uris: [REDIRECT], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }) });
  const rb = await reg.json();
  CID = rb.client_id;
  ok('DCR', reg.status === 201 && /^mcp_/.test(CID), JSON.stringify(rb));
  const a = await authorize(jar(), ANYA, CID);
  ok('authorize: SSO + consent → code', !!a.code && /хоче працювати зі Spine Draft Kit/.test(a.page.text), a.page.text.slice(0, 200));
  const t = await form('/oauth/token', { grant_type: 'authorization_code', code: a.code, redirect_uri: REDIRECT, client_id: CID, code_verifier: a.verifier, resource: RESOURCE });
  tokens = await t.json();
  if (tokens.access_token) { secrets.add(tokens.access_token); secrets.add(tokens.refresh_token); }
  ok('token with PKCE', t.status === 200 && /^ska_/.test(tokens.access_token), JSON.stringify(tokens).slice(0, 200));
  A = client(tokens.access_token);
  const i = await A.init();
  ok('initialize', i.status === 200 && !!A.sid, i.text.slice(0, 200));
  const l = await A.rpc('tools/list', {});
  ok('tools/list', (l.body.result?.tools || []).some(t => t.name === 'upload_files'));
}
{
  const t0 = Date.now();
  const cp = await A.tool('create_project', { name: 'docker-test', reels: 5, rows: 3, symbols: [] });
  PID = cp.json?.project?.id;
  ok('create_project: engine Chromium starts in the container', !cp.error && !!PID, cp.text.slice(0, 400) + '\n' + docker('logs', '--tail', '15', NAME).stdout);
  note(`create_project (Chromium cold start + tab) took ${Date.now() - t0} ms`);
  const up = await A.tool('upload_files', { files: [{ name: 'high_1.png', path: join(ART, 'high_1.png') }, { name: 'low_1.png', path: join(ART, 'low_1.png') }] });
  const refs = up.json?.files || [];
  for (const f of refs) secrets.add(f.url.split('/u/')[1]);
  const c = sh('sh', ['-c', String(up.json?.curl || 'false')]);
  ok('upload_files + curl', refs.length === 2 && c.status === 0 && (c.stdout.match(/"ok":true/g) || []).length === 2, up.text.slice(0, 300) + ' ' + c.stdout + c.stderr);
  const s = await A.tool('set_symbols', { symbols: [{ name: 'high_1', image: refs[0]?.ref }, { name: 'low_1', image: refs[1]?.ref }] });
  ok('set_symbols with refs', !s.error && s.json?.symbols?.length === 2, s.text.slice(0, 300));
  const shot = await A.tool('screenshot', { target: 'grid' });
  const img = shot.images[0];
  if (img) writeFileSync(join(OUT, 'screenshot.png'), Buffer.from(img.data, 'base64'));
  ok('screenshot returns a PNG (WebGL in the container)', !shot.error && img && img.mimeType === 'image/png' && img.data.length > 2000, shot.text.slice(0, 200));
  const sp = await A.tool('spin', { quick: true });
  ok('spin works', !sp.error && sp.json?.done === true, sp.text.slice(0, 300));
  memory('one engine tab, after spin');
  const ex = await A.tool('export_drafts', {});
  const url = ex.json?.download;
  if (url) secrets.add(url.split('/d/')[1]);
  const dir = join(OUT, 'download');
  mkdirSync(dir, { recursive: true });
  const d = url ? sh('sh', ['-c', ex.json.curl.replace('<folder>', dir)]) : { status: 1, stderr: ex.text };
  const zip = join(dir, ex.json?.name || 'none');
  const u = sh('unzip', ['-o', '-q', zip, '-d', join(dir, 'x')]);
  const all = [];
  const walkDir = p => { for (const e of readdirSync(p, { withFileTypes: true })) { if (e.isDirectory()) walkDir(join(p, e.name)); else all.push(e.name); } };
  if (u.status === 0) walkDir(join(dir, 'x'));
  ok('export_drafts → curl → zip unpacks', d.status === 0 && existsSync(zip) && statSync(zip).size === ex.json.bytes && all.includes('animation_symbol_high_1.json'), `${d.stderr} ${u.stderr} ${all.slice(0, 8)}`);
  const h = await A.tool('get_history', { scope: 'drafts', limit: 20 });
  ok('get_history: «Claude · Аня»', (h.json?.entries || []).some(e => e.by === 'Claude · Аня'), h.text.slice(0, 300));
  const closed = await until(async () => /engine: tab closed/.test((await dockerAsync('logs', NAME)).out), 90000, 1000);
  ok('engine tab closes after idle (ENGINE_IDLE_MIN=0.5)', closed >= 0);
  memory('Chromium running, no tabs');
}

{
  const t0 = Date.now();
  const st = docker('stop', '-t', '20', NAME);
  const code = docker('inspect', '-f', '{{.State.ExitCode}}', NAME).stdout.trim();
  const took = Date.now() - t0;
  ok('docker stop: graceful SIGTERM (exit 0, under 10 s)', st.status === 0 && code === '0' && took < 10000, `${code} ${took} ms ${st.stderr}`);
  note(`docker stop took ${took} ms`);
  ok('docker start', docker('start', NAME).status === 0);
}
await started('restart');
{
  const s = await (await fetch(BASE + '/api/session', { headers: { cookie: cookieHdr(human) } })).json();
  ok('after restart: human session survives', s.user?.email === 'olya@test.dev', JSON.stringify(s));
  const list = await (await fetch(BASE + '/api/projects', { headers: { cookie: cookieHdr(human) } })).json();
  const p = (Array.isArray(list) ? list : list.projects || []).find(x => x.id === PID);
  ok('after restart: project is in the list', !!p && p.settings?.game === 'docker-test', JSON.stringify(list).slice(0, 300));
  const doc = await (await fetch(BASE + '/api/projects/' + PID, { headers: { cookie: cookieHdr(human) } })).json();
  const imgs = Object.keys(doc.images || {});
  const blob = imgs.length ? await fetch(BASE + '/api/blobs/' + doc.images[imgs[0]].sha, { headers: { cookie: cookieHdr(human) } }) : null;
  ok('after restart: images and blobs are on disk', imgs.includes('sym:high_1') && imgs.includes('sym:low_1') && blob?.ok, imgs.join());
  const stale = await A.rpc('tools/list', {});
  ok('after restart: old MCP session → 404 (client reconnects)', stale.status === 404, String(stale.status));
  const i = await A.init();
  ok('after restart: same access token still works', i.status === 200, String(i.status));
  const op = await A.tool('open_project', { id: PID });
  const gp = await A.tool('get_project');
  ok('after restart: open_project + get_project keep the symbols', !op.error && !gp.error && JSON.stringify(gp.json || {}).includes('high_1'), gp.text.slice(0, 300));
  const h = await A.tool('get_history', { scope: 'drafts', limit: 30 });
  ok('after restart: history survives', (h.json?.entries || []).some(e => e.by === 'Claude · Аня') && (h.json?.entries || []).some(e => e.label === 'Створено'), h.text.slice(0, 300));
  const r = await form('/oauth/token', { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: CID });
  const n = await r.json();
  if (n.access_token) { secrets.add(n.access_token); secrets.add(n.refresh_token); }
  ok('after restart: refresh token rotates', r.status === 200 && n.access_token && n.access_token !== tokens.access_token, JSON.stringify(n).slice(0, 200));
  memory('after restart, one engine tab');
}
{
  const logs = docker('logs', NAME);
  const text = logs.stdout + logs.stderr;
  writeFileSync(join(OUT, 'container.log'), text);
  const leaked = [...secrets].filter(s => s && s.length >= 16 && text.includes(s));
  ok('container logs: JSON lines, no tokens, codes or cookies', leaked.length === 0 && text.split('\n').filter(Boolean).every(l => l.startsWith('{')), `${leaked.length} leaked`);
}

await mock.close();
const bad = results.filter(r => r.startsWith('FAIL'));
writeFileSync(join(OUT, 'facts.txt'), facts.join('\n') + '\n');
console.log('\n' + facts.join('\n'));
console.log('\n' + bad.join('\n'));
console.log(`\n${results.length - bad.length}/${results.length} passed`);
process.exit(bad.length ? 1 : 0);
