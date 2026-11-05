import { createHash } from 'node:crypto';
import { readBody } from './auth.mjs';
import { ID, SHA, MIME, imageInfo, imageCheck, sha256 } from './data.mjs';
import { routeOf } from './log.mjs';
import { vendorState } from '../vendor.mjs';

const MB = 1024 * 1024;
const BASE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
const BLOB_CSP = "default-src 'none'; sandbox";

export const limiter = (perSec, burst) => {
  const m = new Map();
  return key => {
    const now = Date.now();
    let b = m.get(key);
    if (!b) {
      if (m.size > 20000) for (const [k, x] of m) if (now - x.t > 3600000) m.delete(k);
      b = { n: burst, t: now };
      m.set(key, b);
    }
    b.n = Math.min(burst, b.n + (now - b.t) / 1000 * perSec);
    b.t = now;
    if (b.n < 1) return Math.ceil((1 - b.n) / perSec);
    b.n -= 1;
    return 0;
  };
};

const pageCsp = html => {
  const hashes = [];
  for (const m of html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
    if (m[1] && /\bsrc\s*=/i.test(m[1])) continue;
    hashes.push(`'sha256-${createHash('sha256').update(m[2], 'utf8').digest('base64')}'`);
  }
  return `default-src 'self'; script-src 'self' ${[...new Set(hashes)].join(' ')}; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`;
};

const json = (res, code, d) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(d));
};
const readJson = async (req, limit) => {
  const buf = await readBody(req, limit);
  try { return JSON.parse(buf.toString('utf8') || '{}'); } catch { const e = new Error('bad json'); e.code = 400; throw e; }
};
const out = (res, r, ok = 200) => r && r.error ? json(res, r.code || 400, { error: r.error }) : json(res, ok, r);

export function createHttp({ data, hub, auth, cfg, page, log, oauth, mcp, files }) {
  const pub = new URL(cfg.publicUrl);
  const reloads = new Set();
  const maxImage = (Number(cfg.maxImageMb) || 64) * MB;
  const audit = (type, o) => log && log.audit(type, o);
  const rate = {
    auth: limiter((Number(cfg.rateAuthPerMin) || 10) / 60, Number(cfg.rateAuthPerMin) || 10),
    edit: limiter(30, 120),
    upload: limiter(300 / 600, 300)
  };
  let vend = vendorState();
  const vendor = () => vend.every(v => v.ok) ? vend : (vend = vendorState());
  const pages = new Map();
  const ipOf = req => {
    if (cfg.trustProxy) {
      const xff = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
      if (xff.length) return xff[xff.length - 1];
    }
    return req.socket.remoteAddress || '';
  };
  const tooMany = (res, wait, html) => {
    res.writeHead(429, { 'content-type': html ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'retry-after': String(Math.max(1, wait)), 'cache-control': 'no-store' });
    res.end(html ? 'Забагато спроб. Зачекайте хвилину.' : JSON.stringify({ error: 'забагато запитів' }));
  };

  const security = res => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'same-origin');
    res.setHeader('cross-origin-opener-policy', 'same-origin');
    res.setHeader('cross-origin-resource-policy', 'same-origin');
    res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('content-security-policy', BASE_CSP);
    if (pub.protocol === 'https:') res.setHeader('strict-transport-security', 'max-age=31536000');
  };

  const sendPage = (res, mode) => {
    let html = page();
    if (!html) { res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Сторінка не зібрана: node build.mjs'); return; }
    const key = html.length + ':' + mode;
    let hit = pages.get(key);
    if (!hit || hit.src !== html) {
      let out = html.replace('<meta charset="utf-8">', `<meta charset="utf-8"><meta name="spine-kit-mode" content="${mode}">`);
      for (const v of vendor()) if (v.ok) out = out.split(`'${v.url}'`).join(`'/vendor/${v.file}'`);
      if (cfg.dev && mode !== 'engine') out = out.replace('</body>', `<script>new EventSource('/__reload').onmessage=()=>location.reload()</script></body>`);
      hit = { src: html, out, csp: pageCsp(out) };
      if (pages.size > 8) pages.clear();
      pages.set(key, hit);
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': hit.csp });
    res.end(hit.out);
  };

  const api = async (req, res, url, s) => {
    const path = url.pathname;
    const m = req.method;
    const user = s.by || { kind: 'user', email: s.user.email, name: s.user.name };
    let r;

    if (path.startsWith('/api/mcp/') && oauth && !s.engine) return oauth.api(req, res, url, s);

    if (path === '/api/session' && m === 'GET') return json(res, 200, { user: s.user, role: s.role, csrf: s.csrf, mcpUrl: pub.origin + '/mcp' });

    if (path === '/api/events' && m === 'GET') {
      const project = url.searchParams.get('project');
      const since = url.searchParams.has('since') ? Number(url.searchParams.get('since')) : NaN;
      return hub.subscribe(req, res, s.engine ? null : s.user, project && ID.test(project) ? project : null, since);
    }

    if ((r = /^\/api\/blobs\/([0-9a-f]{64})$/.exec(path))) {
      const sha = r[1];
      if (m === 'HEAD') { res.writeHead(data.blobHas(sha) ? 200 : 404, { 'cache-control': 'no-store' }); return res.end(); }
      if (m === 'GET') {
        const buf = data.blobGet(sha);
        if (!buf) return json(res, 404, { error: 'немає блоба' });
        const info = imageInfo(buf);
        res.writeHead(200, { 'content-type': (info && MIME[info.type]) || 'application/octet-stream', 'content-length': buf.length, 'cache-control': 'private, max-age=31536000, immutable', 'x-content-type-options': 'nosniff', 'content-security-policy': BLOB_CSP });
        return res.end(buf);
      }
      if (m === 'PUT') {
        const wait = rate.upload(s.user.email);
        if (wait) return tooMany(res, wait);
        if (Number(req.headers['content-length']) > maxImage) return json(res, 413, { error: `картинка більша за ${cfg.maxImageMb || 64} МБ` });
        let buf;
        try { buf = await readBody(req, maxImage); }
        catch (e) { if (e.code === 413) return json(res, 413, { error: `картинка більша за ${cfg.maxImageMb || 64} МБ` }); throw e; }
        if (sha256(buf) !== sha) return json(res, 400, { error: 'sha не збігається з байтами' });
        const c = imageCheck(buf, 8192);
        if (c.error) return json(res, c.code, { error: c.error });
        data.blobPut(buf);
        return json(res, 200, { sha, type: c.info.type, w: c.info.w, h: c.info.h });
      }
    }

    if (path === '/api/trash' && m === 'GET') return s.role === 'admin' ? json(res, 200, hub.trash()) : json(res, 403, { error: 'лише для адміна' });
    if (path === '/api/audit' && m === 'GET') return s.role === 'admin' ? json(res, 200, log ? log.readAudit(Math.min(1000, Number(url.searchParams.get('limit')) || 200)) : []) : json(res, 403, { error: 'лише для адміна' });
    if ((r = /^\/api\/projects\/([^/]+)\/undelete$/.exec(path)) && m === 'POST' && ID.test(r[1])) {
      if (s.role !== 'admin') return json(res, 403, { error: 'лише для адміна' });
      if (!hub.undelete(r[1])) return json(res, 404, { error: 'немає в кошику' });
      audit('project.undelete', { email: s.user.email, project: r[1] });
      return json(res, 200, { ok: true });
    }

    if (path === '/api/projects') {
      if (m === 'GET') return json(res, 200, hub.list());
      if (m === 'POST') {
        const body = await readJson(req, 21 * MB);
        r = hub.create(body, user);
        if (!r.error) audit('project.create', { email: s.user.email, project: r.doc.id });
        return r.error ? out(res, r) : json(res, 200, { id: r.doc.id, v: r.doc.v });
      }
    }

    if ((r = /^\/api\/projects\/([^/]+)(?:\/([a-z]+)(?:\/([^/]+))?)?$/.exec(path)) && ID.test(r[1])) {
      const [, id, sub, extra] = r;
      if (!sub) {
        if (m === 'GET') { const doc = hub.get(id); return doc ? json(res, 200, doc) : json(res, 404, { error: 'немає проекту' }); }
        if (m === 'DELETE') {
          if (!hub.remove(id, s.user)) return json(res, 404, { error: 'немає проекту' });
          audit('project.delete', { email: s.user.email, project: id });
          return json(res, 200, { ok: true });
        }
      }
      if (sub === 'ops' && m === 'POST' && !extra) return out(res, hub.ops(id, user, await readJson(req, 2 * MB)));
      if (sub === 'history' && m === 'GET') {
        if (extra) { const e = hub.entry(id, extra); return e ? json(res, 200, e) : json(res, 404, { error: 'немає запису' }); }
        const h = hub.history(id, url.searchParams.get('scope') || '', url.searchParams.get('before') || '');
        return h ? json(res, 200, h) : json(res, 404, { error: 'немає проекту' });
      }
      if (sub === 'restore' && m === 'POST' && !extra) {
        const b = await readJson(req, 64 * 1024);
        const x = hub.restore(id, s.user, String(b.entry || ''), b.scope);
        if (!x.error) audit('project.restore', { email: s.user.email, project: id, entry: String(b.entry || '').slice(0, 64), scope: b.scope });
        return out(res, x);
      }
      if (sub === 'versions' && m === 'POST' && !extra) { const b = await readJson(req, 64 * 1024); return out(res, hub.version(id, s.user, b.label)); }
      if (sub === 'copy' && m === 'POST' && !extra) {
        const b = await readJson(req, 64 * 1024);
        const c = hub.copy(id, s.user, b.entry ? String(b.entry) : '');
        if (!c.error) audit('project.create', { email: s.user.email, project: c.doc.id, copyOf: id });
        return c.error ? out(res, c) : json(res, 200, { id: c.doc.id });
      }
    }

    json(res, 404, { error: 'unknown api' });
  };

  const serveVendor = (req, res, path) => {
    const v = vendor().find(x => x.ok && '/vendor/' + x.file === path);
    if (!v || (req.method !== 'GET' && req.method !== 'HEAD')) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'content-length': v.buf.length, 'cache-control': 'public, max-age=31536000, immutable' });
    return res.end(req.method === 'HEAD' ? undefined : v.buf);
  };

  const handle = async (req, res) => {
    let url;
    try { url = new URL(req.url, pub.origin); } catch { res.writeHead(400); return res.end(); }
    const path = url.pathname;
    security(res);
    if (path === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
    const id = log ? log.id() : '';
    const t0 = Date.now();
    req.kitIp = ipOf(req);
    if (log) {
      res.setHeader('x-request-id', id);
      res.on('close', () => log.request({ id, user: res.kitUser || null, m: req.method, route: routeOf(path), status: res.statusCode, ms: Date.now() - t0 }));
    }
    if (req.headers.host !== pub.host) { res.writeHead(421, { 'content-type': 'text/plain' }); return res.end('misdirected request'); }
    if (path.startsWith('/vendor/')) return serveVendor(req, res, path);
    if (oauth && (path.startsWith('/.well-known/oauth-') || path.startsWith('/oauth/'))) return oauth.handle(req, res, url);
    if (mcp && path === '/mcp') return mcp.handle(req, res, url);
    if (files && /^\/[ud]\//.test(path)) return files.handle(req, res, url);
    if (path.startsWith('/auth/')) {
      if (path !== '/auth/bye' && path !== '/auth/done') {
        const wait = rate.auth(req.kitIp);
        if (wait) return tooMany(res, wait, true);
      }
      return auth.handle(req, res, url);
    }
    if (cfg.dev && path === '/__reload') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      res.write(': open\n\n');
      reloads.add(res);
      req.on('close', () => reloads.delete(res));
      return;
    }
    const s = auth.session(req);
    if (s) res.kitUser = s.user.email;
    if (path.startsWith('/api/')) {
      if (!s) return json(res, 401, { error: 'login' });
      const write = req.method !== 'GET' && req.method !== 'HEAD';
      if (write && (!auth.sameOrigin(req) || req.headers['x-kit-csrf'] !== s.csrf)) { res.setHeader('x-kit-error', 'csrf'); return json(res, 403, { error: 'csrf' }); }
      if (write && !/^\/api\/blobs\//.test(path)) {
        const wait = rate.edit(s.user.email);
        if (wait) return tooMany(res, wait);
      }
      return api(req, res, url, s);
    }
    if (req.method === 'GET' && (path === '/' || /^\/p\/[A-Za-z0-9_-]{1,64}$/.test(path))) {
      if (!s) { res.writeHead(303, { location: '/auth/login?next=' + encodeURIComponent(path + url.search) }); return res.end(); }
      return sendPage(res, url.searchParams.has('v') && path !== '/' ? 'view' : 'server');
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  };

  return {
    handler: async (req, res) => {
      try { await handle(req, res); }
      catch (e) {
        if (log && e.code !== 413 && e.code !== 400) log.error('request: ' + e.message, { route: routeOf(String(req.url || '')) });
        if (!res.headersSent) json(res, e.code === 413 ? 413 : e.code === 400 ? 400 : 500, { error: e.code === 413 || e.code === 400 ? e.message : 'помилка сервера' });
        else res.end();
      }
    },
    reload: () => { for (const r of reloads) r.write('data: reload\n\n'); },
    api,
    sendPage,
    serveVendor
  };
}
