import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { rmSync, mkdirSync, existsSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { readBody } from './auth.mjs';
import { ID } from './data.mjs';

const COOKIE = 'kit_engine';
const ENGINE_USER = { email: 'engine@kit.local', name: 'Рушій' };
const BLOB_TTL = 15 * 60 * 1000;
const OPEN_TIMEOUT = 45000;
const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LOOPBACK = new Set(['127.0.0.1', '::ffff:127.0.0.1']);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const crashError = m => { const e = new Error(m); e.crash = true; return e; };
const withTimeout = async (p, ms, msg) => {
  let t;
  try { return await Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg)), ms); })]); }
  finally { clearTimeout(t); }
};

export const chromeArgs = (profile, noSandbox) => [
  '--headless=new', '--remote-debugging-pipe', `--user-data-dir=${profile}`,
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-sync', '--disable-component-update',
  '--mute-audio', '--hide-scrollbars', '--window-size=1320,940',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
  ...(noSandbox ? ['--no-sandbox'] : [])
];

export function createEngine({ chromePath, port = 0, maxTabs = 6, idleMin = 10, profileDir, noSandbox = false, log }) {
  const chromeBin = chromePath || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : existsSync(MAC_CHROME) ? MAC_CHROME : 'chromium');
  const idleMs = Math.max(1000, Number(idleMin) * 60000);
  let http = null;
  let chrome = null;
  let starting = null;
  const tabs = new Map();
  const byToken = new Map();
  const opening = new Map();
  const calls = new Map();
  const blobs = new Map();
  let base = '';
  let listening = null;

  const info = (msg, o) => log && log.info(msg, o);

  const launch = async () => {
    rmSync(profileDir, { recursive: true, force: true });
    mkdirSync(profileDir, { recursive: true });
    const proc = spawn(chromeBin, chromeArgs(profileDir, noSandbox), { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
    const c = { proc, alive: true, id: 0, wait: new Map(), buf: '', started: Date.now() };
    const die = why => {
      if (!c.alive) return;
      c.alive = false;
      for (const w of c.wait.values()) w.reject(crashError('Chromium рушія впав: ' + why));
      c.wait.clear();
      if (chrome === c) chrome = null;
      for (const t of [...tabs.values(), ...byToken.values()]) dropTab(t, crashError('Chromium рушія впав'));
      info('engine: chromium stopped', { why });
    };
    proc.on('error', e => die(e.code === 'ENOENT' ? `немає ${chromeBin} (CHROME_PATH)` : e.message));
    proc.on('exit', (code, sig) => die(sig || String(code)));
    proc.stdio[3].on('error', () => die('pipe'));
    proc.stdio[4].on('error', () => die('pipe'));
    proc.stdio[4].setEncoding('utf8');
    proc.stdio[4].on('data', d => {
      c.buf += d;
      let i;
      while ((i = c.buf.indexOf('\0')) >= 0) {
        const line = c.buf.slice(0, i);
        c.buf = c.buf.slice(i + 1);
        let m;
        try { m = JSON.parse(line); } catch { continue; }
        if (m.id && c.wait.has(m.id)) {
          const w = c.wait.get(m.id);
          c.wait.delete(m.id);
          if (m.error) w.reject(new Error(`CDP ${w.method}: ${m.error.message}`));
          else w.resolve(m.result || {});
        }
      }
    });
    c.send = (method, params = {}, ms = 20000) => {
      if (!c.alive) return Promise.reject(crashError('Chromium рушія не працює'));
      const id = ++c.id;
      const d = deferred();
      c.wait.set(id, { ...d, method });
      try { proc.stdio[3].write(JSON.stringify({ id, method, params }) + '\0'); } catch (e) { c.wait.delete(id); return Promise.reject(crashError(e.message)); }
      return withTimeout(d.promise, ms, `CDP ${method}: немає відповіді`);
    };
    chrome = c;
    try {
      const v = await c.send('Browser.getVersion', {}, 20000);
      info('engine: chromium started', { product: v.product, pid: proc.pid });
    } catch (e) {
      try { proc.kill('SIGKILL'); } catch { }
      die('start');
      throw crashError(`Chromium рушія не стартував (${chromeBin}): ${e.message}`);
    }
    return c;
  };

  const ensureChrome = async () => {
    if (chrome && chrome.alive) return chrome;
    if (!starting) {
      starting = launch();
      try { await starting; } finally { starting = null; }
    } else await starting;
    if (!chrome || !chrome.alive) throw crashError('Chromium рушія не стартував');
    return chrome;
  };

  const dropTab = (t, err) => {
    if (tabs.get(t.project) === t) tabs.delete(t.project);
    byToken.delete(t.token);
    t.dead = true;
    if (t.sse) { try { t.sse.end(); } catch { } t.sse = null; }
    t.ready.reject(err || new Error('вкладку закрито'));
    for (const [id, c] of calls) if (c.tab === t) { calls.delete(id); clearTimeout(c.timer); c.reject(err || new Error('вкладку рушія закрито')); }
    for (const q of t.queue.splice(0)) q.reject(err || new Error('вкладку рушія закрито'));
  };
  const closeTab = async (t, why) => {
    dropTab(t, new Error('вкладку рушія закрито: ' + why));
    info('engine: tab closed', { project: t.project, why });
    if (chrome && chrome.alive && t.ctx) { try { await chrome.send('Target.disposeBrowserContext', { browserContextId: t.ctx }, 10000); } catch { return; } }
  };

  const makeRoom = async () => {
    const live = [...tabs.values()];
    if (live.length < maxTabs) return;
    const idle = live.filter(t => !t.busy && !t.queue.length).sort((a, b) => a.last - b.last);
    for (const t of idle.slice(0, live.length - maxTabs + 1)) await closeTab(t, 'ліміт вкладок');
  };

  const openTab = async project => {
    const c = await ensureChrome();
    await listening;
    await makeRoom();
    const t = { token: randomBytes(32).toString('base64url'), csrf: randomBytes(24).toString('base64url'), project, ctx: null, sse: null, ready: deferred(), busy: 0, queue: [], running: false, last: Date.now(), owner: null, dead: false };
    t.ready.promise.catch(() => null);
    byToken.set(t.token, t);
    if (project) tabs.set(project, t);
    try {
      t.ctx = (await c.send('Target.createBrowserContext', {})).browserContextId;
      await c.send('Storage.setCookies', { browserContextId: t.ctx, cookies: [{ name: COOKIE, value: t.token, url: base + '/', httpOnly: true, sameSite: 'Strict' }] });
      await c.send('Target.createTarget', { url: base + (project ? '/p/' + project : '/'), browserContextId: t.ctx, width: 1320, height: 940 });
      await withTimeout(t.ready.promise, OPEN_TIMEOUT, 'сторінка рушія не підключилась за 45 с');
    } catch (e) {
      await closeTab(t, 'не відкрилась');
      throw e.crash ? e : new Error('Рушій не відкрив проект: ' + e.message);
    }
    info('engine: tab opened', { project: project || '(new)' });
    return t;
  };

  const pump = async t => {
    if (t.running) return;
    t.running = true;
    while (t.queue.length && !t.dead) {
      const q = t.queue.shift();
      try { q.resolve(await q.fn()); } catch (e) { q.reject(e); }
    }
    t.running = false;
  };
  const inTab = (t, fn) => {
    const d = deferred();
    t.queue.push({ fn, resolve: d.resolve, reject: d.reject });
    pump(t);
    return d.promise;
  };

  const send = async (t, tool, args, owner, timeout) => {
    if (t.dead) throw crashError('вкладку рушія закрито');
    if (!t.sse) await withTimeout(t.ready.promise, 15000, 'сторінка рушія не на звʼязку');
    t.owner = owner || t.owner;
    t.busy++;
    t.last = Date.now();
    const id = randomUUID();
    const d = deferred();
    const timer = setTimeout(() => { calls.delete(id); d.reject(new Error(`Рушій не відповів за ${Math.round(timeout / 1000)} с`)); }, timeout);
    calls.set(id, { ...d, timer, tab: t });
    try {
      t.sse.write(`event: call\ndata: ${JSON.stringify({ id, tool, args })}\n\n`);
      const r = await d.promise;
      if (!r.ok) throw new Error(r.error || 'помилка рушія');
      return r.result;
    } finally {
      t.busy--;
      t.last = Date.now();
    }
  };

  const tabFor = async project => {
    const have = tabs.get(project);
    if (have && !have.dead) return have;
    if (opening.has(project)) return opening.get(project);
    const p = (async () => {
      const t = await openTab(project);
      const st = await inTab(t, () => send(t, 'status', {}, null, 30000));
      if (!st || !st.project || st.project.id !== project) { await closeTab(t, 'інший проект'); throw new Error('Рушій не відкрив проект ' + project); }
      return t;
    })();
    opening.set(project, p);
    try { return await p; } finally { opening.delete(project); }
  };

  const once = async ({ project, tool, args, owner, timeout }) => {
    if (tool === 'create_project') {
      const t = await openTab(null);
      try {
        const r = await inTab(t, () => send(t, tool, args, owner, timeout));
        const id = r && r.project && r.project.id;
        if (!id || !ID.test(id)) throw new Error('рушій не повернув id проекту');
        t.project = id;
        tabs.set(id, t);
        return r;
      } catch (e) {
        if (!t.project) await closeTab(t, 'create_project не вдався');
        throw e;
      }
    }
    const t = await tabFor(project);
    return inTab(t, () => send(t, tool, args, owner, timeout));
  };

  const run = async opts => {
    try { return await once(opts); }
    catch (e) {
      if (!e.crash) throw e;
      info('engine: retry after crash', { tool: opts.tool });
      return once(opts);
    }
  };

  const health = async () => {
    const c = chrome;
    if (!c || !c.alive) return;
    try { await c.send('Browser.getVersion', {}, 10000); }
    catch { info('engine: chromium hung, killing'); try { c.proc.kill('SIGKILL'); } catch { return; } }
  };
  const sweep = async () => {
    const now = Date.now();
    for (const t of [...tabs.values()]) if (!t.busy && !t.queue.length && now - t.last > idleMs) await closeTab(t, 'простій');
    for (const [id, b] of blobs) if (now - b.at > BLOB_TTL) blobs.delete(id);
  };
  const hTimer = setInterval(health, 30000);
  const sTimer = setInterval(sweep, Math.min(30000, Math.max(500, idleMs / 4)));
  hTimer.unref();
  sTimer.unref();

  const putBlob = (buf, type, name) => {
    const id = randomUUID();
    blobs.set(id, { buf, type: type || 'application/octet-stream', name: name || '', at: Date.now() });
    return id;
  };
  const takeBlob = id => {
    const b = blobs.get(id);
    if (b) blobs.delete(id);
    return b ? b.buf : null;
  };

  const json = (res, code, d) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(d));
  };
  const tabOf = req => {
    const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]{20,})`).exec(req.headers.cookie || '');
    const t = m && byToken.get(m[1]);
    return t && !t.dead ? t : null;
  };
  const sessionOf = t => {
    const o = t.owner;
    const user = o ? { email: o.email, name: o.name } : ENGINE_USER;
    return { user, role: 'editor', csrf: t.csrf, engine: true, by: { kind: 'claude', email: user.email, name: user.name } };
  };

  const handle = async (req, res) => {
    if (req.headers.host !== `127.0.0.1:${port}` || !LOOPBACK.has(req.socket.remoteAddress)) { res.writeHead(421); return res.end(); }
    const url = new URL(req.url, base);
    const path = url.pathname;
    const m = req.method;
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'same-origin');
    res.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
    if (path === '/healthz') { res.writeHead(200); return res.end('ok'); }
    const t = tabOf(req);
    if (!t) return json(res, 403, { error: 'engine only' });
    const write = m !== 'GET' && m !== 'HEAD';
    if (write && req.headers.origin !== base) return json(res, 403, { error: 'origin' });
    let r;
    if (m === 'GET' && (path === '/' || /^\/p\/[A-Za-z0-9_-]{1,64}$/.test(path))) return http.sendPage(res, 'engine');
    if (path.startsWith('/vendor/')) return http.serveVendor(req, res, path);
    if (path === '/api/session' && m === 'GET') return json(res, 200, { user: ENGINE_USER, role: 'editor', csrf: t.csrf, mcpUrl: '' });
    if (path === '/api/engine/calls' && m === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(': open\n\n');
      if (t.sse && t.sse !== res) { try { t.sse.end(); } catch { } }
      t.sse = res;
      t.ready.resolve(true);
      const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { return; } }, 20000);
      req.on('close', () => { clearInterval(ping); if (t.sse === res) t.sse = null; });
      return;
    }
    if (path === '/api/engine/result' && m === 'POST') {
      const b = JSON.parse((await readBody(req, 300 * 1024 * 1024)).toString('utf8') || '{}');
      const c = calls.get(b.id);
      if (c && c.tab === t) { calls.delete(b.id); clearTimeout(c.timer); c.resolve({ ok: !!b.ok, result: b.result, error: b.error }); }
      return json(res, 200, { ok: true });
    }
    if (path === '/api/bridge/blobs' && m === 'PUT') {
      const buf = await readBody(req, 300 * 1024 * 1024);
      return json(res, 200, { id: putBlob(buf, String(req.headers['content-type'] || ''), url.searchParams.get('name') || '') });
    }
    if ((r = /^\/api\/bridge\/blobs\/([\w-]+)$/.exec(path)) && m === 'GET') {
      const b = blobs.get(r[1]);
      if (!b) return json(res, 404, { error: 'blob expired' });
      res.writeHead(200, { 'content-type': b.type, 'cache-control': 'no-store', 'x-name': encodeURIComponent(b.name) });
      return res.end(b.buf);
    }
    if (path === '/api/events' || path === '/api/projects' || /^\/api\/projects\/[^/]+(\/[a-z]+(\/[^/]+)?)?$/.test(path) || /^\/api\/blobs\/[0-9a-f]{64}$/.test(path)) {
      if (/\/(undelete|copy|restore|versions)$/.test(path) || (m === 'DELETE' && /^\/api\/projects\//.test(path))) return json(res, 403, { error: 'not for engine' });
      return http.api(req, res, url, sessionOf(t));
    }
    if ((path === '/api/library' || /^\/api\/library\/[A-Za-z0-9_-]{1,64}$/.test(path)) && ['GET', 'POST', 'PUT', 'DELETE'].includes(m)) return http.api(req, res, url, sessionOf(t));
    if ((path === '/api/sandbox' && m === 'GET') || (/^\/api\/sandbox\/items\/[^/]+$/.test(path) && ['GET', 'PUT', 'DELETE'].includes(m))) return http.api(req, res, url, sessionOf(t));
    json(res, 404, { error: 'unknown api' });
  };

  const server = createServer(async (req, res) => {
    try { await handle(req, res); }
    catch (e) {
      if (log && e.code !== 413) log.error('engine request: ' + e.message);
      if (!res.headersSent) json(res, e.code === 413 ? 413 : 500, { error: e.code === 413 ? 'завеликий' : 'помилка рушія' });
      else res.end();
    }
  });
  listening = new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(port) || 0, '127.0.0.1', () => {
      port = server.address().port;
      base = `http://127.0.0.1:${port}`;
      resolve(port);
    });
  });
  listening.catch(e => log && log.error('engine: не вдалося слухати 127.0.0.1:' + port + ': ' + e.message));

  return {
    use(h) { http = h; },
    run,
    putBlob,
    takeBlob,
    ready: () => listening,
    state: () => ({ chrome: !!(chrome && chrome.alive), pid: chrome && chrome.alive ? chrome.proc.pid : null, port, tabs: [...tabs.values()].map(t => ({ project: t.project, busy: t.busy, idle: Date.now() - t.last })) }),
    async stop() {
      clearInterval(hTimer);
      clearInterval(sTimer);
      if (chrome && chrome.alive) { try { chrome.proc.kill('SIGKILL'); } catch { } }
      server.close();
      await sleep(0);
    }
  };
}
