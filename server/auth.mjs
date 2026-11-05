import { randomBytes, createHash } from 'node:crypto';
import { createOidc, pkce, random } from './oidc.mjs';

const IDLE = 12 * 3600 * 1000;
const FLOW = 10 * 60 * 1000;
const MAX = 7 * 24 * 3600 * 1000;
const EMAIL = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}$/;

const hash = s => createHash('sha256').update(s).digest('hex');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeNext = n => typeof n === 'string' && /^\/(?![\/\\])/.test(n) ? n : '/';

export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { const e = new Error('body too large'); e.code = 413; reject(e); req.destroy(); return; }
      parts.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}

const PAGE = (title, body) => `<!doctype html><html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
:root{--paper:#f2f2f4;--card:#fff;--ink:#151517;--line:rgb(21 21 23/.2);--brand:#007aff;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--paper:#151517;--card:#242426;--ink:#f4f4f6;--line:rgb(244 244 246/.2);--brand:#0a84ff}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--paper);color:var(--ink);font:15px/1.4 ui-sans-serif,system-ui,sans-serif}
form,.box{background:var(--card);border-radius:20px;padding:28px;display:grid;gap:14px;width:min(360px,calc(100% - 32px));box-sizing:border-box}
h1{margin:0;font-size:20px}label{display:grid;gap:6px;font-size:13px;opacity:.8}
input{font:inherit;padding:10px 12px;border-radius:12px;border:1px solid var(--line);background:transparent;color:inherit}
button,.btn{font:600 15px/1 inherit;padding:12px;border:0;border-radius:9999px;background:var(--brand);color:#fff;cursor:pointer;text-align:center;text-decoration:none}
p{margin:0;overflow-wrap:anywhere}.box form{background:none;padding:0;width:auto;border-radius:0}.sub{background:transparent;color:inherit;border:1px solid var(--line)}
</style></head><body>${body}</body></html>`;

export function createAuth({ data, mode, publicUrl, admins, oidc: oc, log }) {
  const dev = mode === 'dev';
  const secure = new URL(publicUrl).protocol === 'https:';
  const cookie = secure ? '__Host-kit_sid' : 'kit_sid';
  const flowCookie = secure ? '__Host-kit_oidc' : 'kit_oidc';
  const origin = new URL(publicUrl).origin;
  const audit = (type, o) => log && log.audit(type, o);
  const oidc = !dev && oc ? createOidc({ issuer: oc.issuer, clientId: oc.clientId, clientSecret: oc.clientSecret, scopes: oc.scopes, redirectUri: origin + '/auth/callback' }) : null;
  const flows = new Map();
  const sessions = new Map();
  for (const s of data.readJson('auth/sessions.json') || []) if (s && s.h && s.user) sessions.set(s.h, s);
  let saveTimer = null;
  const save = () => {
    if (saveTimer) return;
    saveTimer = setTimeout(() => { saveTimer = null; data.writeJson('auth/sessions.json', [...sessions.values()]); }, 1000);
  };
  const users = data.readJson('users.json') || {};
  const roleOf = email => admins.includes(email.toLowerCase()) ? 'admin' : 'editor';

  const sid = req => {
    const m = new RegExp(`(?:^|;\\s*)${cookie.replace(/[-]/g, '\\-')}=([A-Za-z0-9_-]{20,})`).exec(req.headers.cookie || '');
    return m ? m[1] : null;
  };
  const session = req => {
    const id = sid(req);
    if (!id) return null;
    const s = sessions.get(hash(id));
    if (!s) return null;
    const now = Date.now();
    if (now - s.last > IDLE || now - s.created > MAX) { sessions.delete(s.h); save(); return null; }
    if (now - s.last > 60000) { s.last = now; save(); }
    return { user: s.user, role: roleOf(s.user.email), csrf: s.csrf };
  };
  const addCookie = (res, name, value, age) => {
    const prev = res.getHeader('set-cookie');
    res.setHeader('set-cookie', [].concat(prev || [], `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`));
  };
  const setCookie = (res, value, age) => addCookie(res, cookie, value, age);
  const readCookie = (req, name) => {
    const m = new RegExp(`(?:^|;\\s*)${name.replace(/[-]/g, '\\-')}=([A-Za-z0-9_-]{20,})`).exec(req.headers.cookie || '');
    return m ? m[1] : null;
  };
  const ipOf = req => req.kitIp || req.socket.remoteAddress || '';
  const html = (res, code, title, body) => {
    res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(PAGE(title, body));
  };
  const box = (h, text, action) => `<div class="box"><h1>${esc(h)}</h1>${text ? `<p>${esc(text)}</p>` : ''}${action || ''}</div>`;
  const again = '<a class="btn" href="/auth/login">Увійти</a>';
  const outForm = '<form method="post" action="/auth/logout" class="plain"><button>Вийти</button></form>';
  const sweep = () => {
    const now = Date.now();
    for (const [k, f] of flows) if (now - f.t > FLOW) flows.delete(k);
    while (flows.size > 5000) flows.delete(flows.keys().next().value);
  };
  const google = /^https:\/\/accounts\.google\.com\/?$/.test(String((oc && oc.issuer) || ''));
  const allowed = (email, groups, hd) => {
    const domain = email.split('@')[1];
    if (oc.domains.length && oc.domains.includes(domain) && (!google || String(hd || '').toLowerCase() === domain)) return true;
    return oc.groups.length > 0 && groups.some(g => oc.groups.includes(g));
  };
  const login = (res, user) => {
    const id = randomBytes(32).toString('base64url');
    const now = Date.now();
    sessions.set(hash(id), { h: hash(id), user, csrf: randomBytes(24).toString('base64url'), created: now, last: now });
    const u = users[user.email] || { email: user.email, first: now };
    Object.assign(u, { name: user.name, role: roleOf(user.email), last: now });
    users[user.email] = u;
    data.writeJson('users.json', users);
    save();
    setCookie(res, id, Math.round(MAX / 1000));
  };
  const sameOrigin = req => req.headers.origin === origin;

  const handle = async (req, res, url) => {
    const path = url.pathname;
    if (path === '/auth/login' && req.method === 'GET' && !dev) {
      const next = safeNext(url.searchParams.get('next'));
      sweep();
      const state = random(), nonce = random(), bind = random(), p = pkce();
      flows.set(state, { nonce, verifier: p.verifier, next, bind: hash(bind), t: Date.now() });
      let to;
      try { to = await oidc.authUrl({ state, nonce, challenge: p.challenge }); }
      catch (e) {
        flows.delete(state);
        log && log.error('oidc: ' + e.message);
        return html(res, 502, 'Вхід · Draft Kit', box('Вхід недоступний', 'SSO не відповідає. Спробуйте за хвилину.', again));
      }
      addCookie(res, flowCookie, bind, Math.round(FLOW / 1000));
      res.writeHead(303, { location: to, 'cache-control': 'no-store' });
      res.end();
      return;
    }
    if (path === '/auth/callback' && req.method === 'GET' && !dev) {
      const q = url.searchParams;
      const state = q.get('state') || '';
      const flow = flows.get(state);
      flows.delete(state);
      const bind = readCookie(req, flowCookie);
      addCookie(res, flowCookie, '', 0);
      const bad = (reason, code = 400) => {
        audit('login.failed', { reason, ip: ipOf(req) });
        return html(res, code, 'Вхід · Draft Kit', box('Вхід не вдався', reason, again));
      };
      if (!flow || Date.now() - flow.t > FLOW || !bind || hash(bind) !== flow.bind) return bad('Посилання входу застаріло або відкрите в іншому браузері');
      if (q.get('error')) return bad('SSO: ' + String(q.get('error')).slice(0, 80));
      const code = q.get('code');
      if (!code) return bad('SSO не передав код');
      let claims;
      try {
        const t = await oidc.exchange(code, flow.verifier);
        claims = await oidc.verifyIdToken(t.id_token, flow.nonce);
      } catch (e) {
        if (!e.oidc) throw e;
        return bad(e.message);
      }
      const email = String(claims.email || claims.preferred_username || '').trim().toLowerCase();
      if (!EMAIL.test(email)) return bad('SSO не передав email', 403);
      const name = String(claims.name || [claims.given_name, claims.family_name].filter(Boolean).join(' ') || email.split('@')[0]).trim().slice(0, 80);
      const raw = claims[oc.groupsClaim];
      const groups = (Array.isArray(raw) ? raw : raw ? [raw] : []).map(String);
      if (claims.email_verified === false || !allowed(email, groups, claims.hd)) {
        audit('login.denied', { email, reason: claims.email_verified === false ? 'email_verified' : 'access', ip: ipOf(req) });
        return html(res, 403, 'Немає доступу · Draft Kit', box('Немає доступу', email, outForm));
      }
      login(res, { email, name });
      audit('login', { email, name, ip: ipOf(req) });
      res.writeHead(303, { location: flow.next, 'cache-control': 'no-store' });
      res.end();
      return;
    }
    if (path === '/auth/bye' && req.method === 'GET') return html(res, 200, 'Вихід · Draft Kit', box('Ви вийшли', '', again));
    if (path === '/auth/done' && req.method === 'GET') return html(res, 200, 'Вхід · Draft Kit', box('Вхід виконано', 'Поверніться у вкладку з китом — зміни дійдуть самі.', ''));
    if (path === '/auth/login' && req.method === 'GET') {
      const next = safeNext(url.searchParams.get('next'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(PAGE('Вхід · Draft Kit', `<form method="post" action="/auth/dev"><h1>Draft Kit · вхід для розробки</h1><label>Імʼя<input name="name" required maxlength="80" autocomplete="name"></label><label>Email<input name="email" type="email" required maxlength="200" autocomplete="email"></label><input type="hidden" name="next" value="${esc(next)}"><button>Увійти</button></form>`));
      return;
    }
    if (path === '/auth/dev' && req.method === 'POST' && dev) {
      if (!sameOrigin(req)) { res.writeHead(403); res.end('forbidden'); return; }
      const form = new URLSearchParams((await readBody(req, 8192)).toString('utf8'));
      const email = String(form.get('email') || '').trim().toLowerCase();
      const name = String(form.get('name') || '').trim().slice(0, 80) || email.split('@')[0];
      if (!EMAIL.test(email)) { res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Поганий email'); return; }
      login(res, { email, name });
      audit('login', { email, name, dev: true, ip: ipOf(req) });
      res.writeHead(303, { location: safeNext(form.get('next')) });
      res.end();
      return;
    }
    if (path === '/auth/logout' && req.method === 'POST') {
      if (!sameOrigin(req)) { res.writeHead(403); res.end('forbidden'); return; }
      const form = new URLSearchParams((await readBody(req, 8192)).toString('utf8'));
      const s = session(req);
      if (s && (req.headers['x-kit-csrf'] || form.get('csrf')) !== s.csrf) { res.writeHead(403); res.end('forbidden'); return; }
      const id = sid(req);
      if (id) { sessions.delete(hash(id)); save(); }
      if (s) audit('logout', { email: s.user.email, ip: ipOf(req) });
      setCookie(res, '', 0);
      res.writeHead(303, { location: '/auth/bye' });
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  };

  return { session, handle, sameOrigin, cookie, flush: () => data.writeJson('auth/sessions.json', [...sessions.values()]) };
}
