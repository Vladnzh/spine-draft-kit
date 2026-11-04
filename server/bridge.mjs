import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const BLOB_TTL = 15 * 60 * 1000;

const slug = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'project';
const fileOf = key => String(key).replace(/[^\w.-]+/g, '_');

function writeAtomic(path, data) {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

function readBody(req, limit = 256 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return; }
      parts.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}

const json = (res, code, data) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
};

const sse = res => {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
  res.write(': open\n\n');
};
const send = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

export function createBridge({ port, kitDir, dataDir }) {
  mkdirSync(join(dataDir, '.trash'), { recursive: true });
  const hosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);
  const pages = new Set();
  const agents = new Map();
  const pending = new Map();
  const blobs = new Map();
  let page = null;

  const info = () => ({
    kit: 'spine-draft-kit',
    kitDir,
    mcp: join(kitDir, 'mcp.mjs'),
    projectsDir: dataDir,
    port,
    page: !!page,
    agents: [...agents.values()]
  });

  const tellPages = () => { for (const p of pages) send(p, 'agents', { agents: [...agents.values()] }); };

  setInterval(() => {
    for (const p of pages) p.write(': ping\n\n');
    for (const a of agents.keys()) a.write(': ping\n\n');
    const old = Date.now() - BLOB_TTL;
    for (const [id, b] of blobs) if (b.at < old) blobs.delete(id);
  }, 20000).unref();

  const allowed = req => {
    if (!LOOPBACK.has(req.socket.remoteAddress)) return false;
    if (!hosts.has(req.headers.host)) return false;
    const origin = req.headers.origin;
    return !origin || origin === `http://${req.headers.host}`;
  };

  const folderOf = id => {
    for (const d of readdirSync(dataDir, { withFileTypes: true })) {
      if (d.isDirectory() && !d.name.startsWith('.') && (d.name === id || d.name.endsWith(`--${id}`))) return join(dataDir, d.name);
    }
    return null;
  };

  const readProject = dir => {
    try { return JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')); } catch { return null; }
  };

  const listProjects = () => {
    const out = [];
    for (const d of readdirSync(dataDir, { withFileTypes: true })) {
      if (!d.isDirectory() || d.name.startsWith('.')) continue;
      const p = readProject(join(dataDir, d.name));
      if (p && ID.test(p.id || '')) out.push({ id: p.id, name: (p.settings && p.settings.game) || '', created: p.created || 0, updated: p.updated || 0, folder: join(dataDir, d.name) });
    }
    return out.sort((a, b) => b.updated - a.updated);
  };

  const ensureFolder = (id, name) => {
    const want = join(dataDir, `${slug(name)}--${id}`);
    const have = folderOf(id);
    if (have && have !== want) renameSync(have, want);
    mkdirSync(join(want, 'images'), { recursive: true });
    return want;
  };

  const saveProject = (id, body) => {
    const settings = body.settings || {};
    const dir = ensureFolder(id, settings.game);
    const images = body.images && typeof body.images === 'object' ? body.images : {};
    const keep = new Set(Object.values(images));
    for (const f of readdirSync(join(dir, 'images'))) if (!keep.has(f)) rmSync(join(dir, 'images', f), { force: true });
    writeAtomic(join(dir, 'project.json'), JSON.stringify({ kit: 'spine-draft-kit@2', id, created: body.created || Date.now(), updated: body.updated || Date.now(), settings, images }, null, 1));
    return dir;
  };

  const saveImage = (id, key, type, buf) => {
    const dir = folderOf(id) || ensureFolder(id, '');
    const file = `${fileOf(key)}.${EXT[type] || 'png'}`;
    for (const f of readdirSync(join(dir, 'images'))) if (f !== file && f.replace(/\.[^.]+$/, '') === fileOf(key)) rmSync(join(dir, 'images', f), { force: true });
    writeAtomic(join(dir, 'images', file), buf);
    return file;
  };

  const trashProject = id => {
    const dir = folderOf(id);
    if (!dir) return false;
    renameSync(dir, join(dataDir, '.trash', `${dir.split(/[\\/]/).pop()}--${Date.now()}`));
    return true;
  };

  const dropPage = res => {
    pages.delete(res);
    if (page !== res) return;
    page = null;
    for (const [id, p] of pending) {
      pending.delete(id);
      clearTimeout(p.timer);
      p.resolve({ ok: false, error: 'Сторінку кита закрили або перезавантажили. Повтори виклик.' });
    }
  };

  const call = (tool, args, timeout) => new Promise(resolve => {
    if (!page) { resolve({ ok: false, code: 'no_page', error: 'Кит не підключений: відкрий http://localhost:' + port + ' і натисни Connect (або виклич open_kit).' }); return; }
    const id = randomUUID();
    const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, error: `Кит не відповів за ${Math.round(timeout / 1000)} с` }); }, timeout);
    pending.set(id, { resolve, timer });
    send(page, 'call', { id, tool, args });
  });

  const routes = async (req, res, url) => {
    const path = url.pathname;
    const m = req.method;
    let r;

    if (path === '/api/info' && m === 'GET') return json(res, 200, info());

    if (path === '/api/bridge/page' && m === 'GET') {
      sse(res);
      if (page && page !== res) send(page, 'replaced', {});
      pages.add(res);
      page = res;
      send(res, 'hello', info());
      req.on('close', () => dropPage(res));
      return;
    }

    if (path === '/api/bridge/agent' && m === 'GET') {
      sse(res);
      agents.set(res, { name: url.searchParams.get('name') || 'Claude', since: Date.now() });
      tellPages();
      req.on('close', () => { agents.delete(res); tellPages(); });
      return;
    }

    if (path === '/api/bridge/call' && m === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      if (typeof body.tool !== 'string') return json(res, 400, { ok: false, error: 'tool missing' });
      const out = await call(body.tool, body.args || {}, Math.min(600000, Number(body.timeout) || 60000));
      return json(res, out.code === 'no_page' ? 409 : 200, out);
    }

    if (path === '/api/bridge/result' && m === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const p = pending.get(body.id);
      if (p) { pending.delete(body.id); clearTimeout(p.timer); p.resolve({ ok: !!body.ok, result: body.result, error: body.error }); }
      return json(res, 200, { ok: true });
    }

    if (path === '/api/bridge/blobs' && m === 'PUT') {
      const id = randomUUID();
      blobs.set(id, { buf: await readBody(req), type: req.headers['content-type'] || 'application/octet-stream', name: url.searchParams.get('name') || '', at: Date.now() });
      return json(res, 200, { id });
    }

    if ((r = /^\/api\/bridge\/blobs\/([\w-]+)$/.exec(path)) && m === 'GET') {
      const b = blobs.get(r[1]);
      if (!b) return json(res, 404, { error: 'blob expired' });
      res.writeHead(200, { 'content-type': b.type, 'cache-control': 'no-store', 'x-name': encodeURIComponent(b.name) });
      return res.end(b.buf);
    }

    if (path === '/api/projects' && m === 'GET') return json(res, 200, listProjects());

    if ((r = /^\/api\/projects\/([^/]+)$/.exec(path)) && ID.test(r[1])) {
      const id = r[1];
      if (m === 'GET') {
        const dir = folderOf(id);
        const p = dir && readProject(dir);
        return p ? json(res, 200, p) : json(res, 404, { error: 'not found' });
      }
      if (m === 'PUT') {
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
        return json(res, 200, { ok: true, folder: saveProject(id, body) });
      }
      if (m === 'DELETE') return json(res, 200, { ok: trashProject(id) });
    }

    if ((r = /^\/api\/projects\/([^/]+)\/images\/([^/]+)$/.exec(path)) && ID.test(r[1])) {
      const id = r[1];
      const name = decodeURIComponent(r[2]);
      if (m === 'PUT') return json(res, 200, { file: saveImage(id, name, String(req.headers['content-type'] || '').split(';')[0], await readBody(req)) });
      if (m === 'GET') {
        const dir = folderOf(id);
        const f = dir && join(dir, 'images', fileOf(name));
        if (!f || !existsSync(f)) return json(res, 404, { error: 'not found' });
        res.writeHead(200, { 'content-type': MIME[f.split('.').pop().toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
        return res.end(readFileSync(f));
      }
    }

    json(res, 404, { error: 'unknown api' });
  };

  return {
    info,
    handle(req, res) {
      const url = new URL(req.url, 'http://localhost');
      if (!url.pathname.startsWith('/api/')) return false;
      if (!allowed(req)) { json(res, 403, { error: 'forbidden' }); return true; }
      routes(req, res, url).catch(e => { if (!res.headersSent) json(res, 500, { ok: false, error: e.message }); else res.end(); });
      return true;
    }
  };
}
