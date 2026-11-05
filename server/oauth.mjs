import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { readBody } from './auth.mjs';

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const ACCESS_TTL = 60 * MIN;
const REFRESH_TTL = 30 * DAY;
const PERSONAL_TTL = 90 * DAY;
const CODE_TTL = 60 * 1000;
const REQ_TTL = 10 * MIN;
const CLIENT_IDLE = 30 * DAY;
const LOOP = new Set(['localhost', '127.0.0.1', '[::1]']);

const hash = s => createHash('sha256').update(String(s)).digest('hex');
const token = p => p + randomBytes(32).toString('base64url');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const strip = s => String(s || '').replace(/\/+$/, '');
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

const PAGE = (title, body) => `<!doctype html><html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
:root{--paper:#f2f2f4;--card:#fff;--ink:#151517;--line:rgb(21 21 23/.2);--brand:#007aff;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--paper:#151517;--card:#242426;--ink:#f4f4f6;--line:rgb(244 244 246/.2);--brand:#0a84ff}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--paper);color:var(--ink);font:15px/1.4 ui-sans-serif,system-ui,sans-serif}
.box{background:var(--card);border-radius:20px;padding:28px;display:grid;gap:14px;width:min(400px,calc(100% - 32px));box-sizing:border-box}
h1{margin:0;font-size:20px}p{margin:0;overflow-wrap:anywhere}small{opacity:.7}
.row{display:flex;gap:10px;justify-content:flex-end}
button{font:600 15px/1 inherit;padding:12px 18px;border:0;border-radius:9999px;background:var(--brand);color:#fff;cursor:pointer}
button.sub{background:transparent;color:inherit;border:1px solid var(--line)}
</style></head><body>${body}</body></html>`;

const loopback = u => u.protocol === 'http:' && LOOP.has(u.hostname);
const parseUri = s => { try { const u = new URL(String(s)); return u.hash ? null : u; } catch { return null; } };

export function createOAuth({ data, publicUrl, auth, log, extraRedirects = [], limiter }) {
  const origin = new URL(publicUrl).origin;
  const resource = origin + '/mcp';
  const audit = (type, o) => log && log.audit(type, o);
  const extra = extraRedirects.map(strip).filter(Boolean);
  const regRate = limiter ? limiter(10 / 3600, 10) : () => 0;
  const tokenRate = limiter ? limiter(1, 30) : () => 0;

  const clients = new Map();
  for (const c of data.readJson('auth/clients.json') || []) if (c && c.client_id) clients.set(c.client_id, c);
  const store = data.readJson('auth/tokens.json') || {};
  const families = new Map();
  const tokens = new Map();
  for (const f of store.families || []) if (f && f.id) families.set(f.id, f);
  for (const t of store.tokens || []) if (t && t.h && families.has(t.family)) tokens.set(t.h, t);
  const codes = new Map();
  const requests = new Map();

  let timer = null;
  const writeNow = () => {
    clearTimeout(timer);
    timer = null;
    data.writeJson('auth/clients.json', [...clients.values()]);
    data.writeJson('auth/tokens.json', { families: [...families.values()], tokens: [...tokens.values()] });
  };
  const save = () => { if (!timer) { timer = setTimeout(writeNow, 1000); timer.unref?.(); } };

  const sweep = () => {
    const now = Date.now();
    let dirty = false;
    for (const [h, t] of tokens) if (t.exp < now) { tokens.delete(h); dirty = true; }
    for (const [id, f] of families) if (![...tokens.values()].some(t => t.family === id)) { families.delete(id); dirty = true; }
    for (const [id, c] of clients) if (now - (c.last || c.created || 0) > CLIENT_IDLE && ![...families.values()].some(f => f.client_id === id)) { clients.delete(id); dirty = true; }
    for (const [k, c] of codes) if (now - c.t > 10 * MIN) codes.delete(k);
    for (const [k, r] of requests) if (now - r.t > REQ_TTL) requests.delete(k);
    if (dirty) save();
  };
  sweep();
  setInterval(sweep, 10 * MIN).unref();

  const json = (res, code, d, extraHeaders = {}) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', pragma: 'no-cache', ...extraHeaders });
    res.end(JSON.stringify(d));
  };
  const oerr = (res, code, error, description) => json(res, code, description ? { error, error_description: description } : { error });
  const html = (res, code, title, body, csp) => {
    const h = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' };
    if (csp) h['content-security-policy'] = csp;
    res.writeHead(code, h);
    res.end(PAGE(title, body));
  };
  const box = (h, text) => `<div class="box"><h1>${esc(h)}</h1>${text ? `<p>${esc(text)}</p>` : ''}</div>`;

  const redirectOk = (client, uri) => {
    const u = parseUri(uri);
    if (!u) return false;
    return client.redirect_uris.some(r => {
      const x = parseUri(r);
      if (!x) return false;
      if (loopback(x) && loopback(u)) return x.hostname === u.hostname && x.pathname === u.pathname && x.search === u.search;
      return x.href === u.href;
    });
  };
  const allowedUri = s => {
    const u = parseUri(s);
    if (!u) return false;
    if (loopback(u)) return true;
    return extra.some(e => strip(u.href) === e || u.href.startsWith(e + '/') || u.href.startsWith(e + '?'));
  };
  const resourceOk = r => !r || strip(r) === resource;

  const family = (o) => {
    const f = { id: 'f' + randomBytes(9).toString('hex'), created: Date.now(), last: Date.now(), ...o };
    families.set(f.id, f);
    return f;
  };
  const addToken = (f, type, ttl) => {
    const raw = token(type === 'refresh' ? 'skr_' : type === 'personal' ? 'skp_' : 'ska_');
    tokens.set(hash(raw), { h: hash(raw), type, family: f.id, exp: Date.now() + ttl, created: Date.now() });
    return raw;
  };
  const revokeFamily = (id, why) => {
    const f = families.get(id);
    if (!f) return false;
    for (const [h, t] of tokens) if (t.family === id) tokens.delete(h);
    families.delete(id);
    save();
    audit(why === 'replay' ? 'token.replay' : 'token.revoke', { email: f.email, family: id, client: f.client_name || f.label || '', kind: f.kind, by: why && why !== 'replay' ? why : undefined });
    return true;
  };
  const pair = f => {
    const access = addToken(f, 'access', ACCESS_TTL);
    const refresh = addToken(f, 'refresh', REFRESH_TTL);
    save();
    return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL / 1000, refresh_token: refresh, scope: 'kit' };
  };

  const metaResource = () => ({ resource, authorization_servers: [origin], bearer_methods_supported: ['header'], scopes_supported: ['kit'], resource_name: 'Spine Draft Kit' });
  const metaServer = () => ({
    issuer: origin,
    authorization_endpoint: origin + '/oauth/authorize',
    token_endpoint: origin + '/oauth/token',
    registration_endpoint: origin + '/oauth/register',
    revocation_endpoint: origin + '/oauth/revoke',
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['kit']
  });

  const register = async (req, res) => {
    const wait = regRate(req.kitIp || req.socket.remoteAddress || '');
    if (wait) { res.setHeader('retry-after', String(wait)); return oerr(res, 429, 'too_many_requests', 'забагато реєстрацій, спробуйте пізніше'); }
    let b;
    try { b = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}'); } catch { return oerr(res, 400, 'invalid_client_metadata', 'не JSON'); }
    const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.map(String) : [];
    if (!uris.length || uris.length > 10) return oerr(res, 400, 'invalid_redirect_uri', 'потрібен redirect_uris');
    const bad = uris.find(u => !allowedUri(u));
    if (bad) return oerr(res, 400, 'invalid_redirect_uri', 'дозволені лише http://localhost, 127.0.0.1, [::1] (і OAUTH_EXTRA_REDIRECTS)');
    const grants = Array.isArray(b.grant_types) ? b.grant_types : ['authorization_code'];
    if (grants.some(g => g !== 'authorization_code' && g !== 'refresh_token')) return oerr(res, 400, 'invalid_client_metadata', 'grant_types: authorization_code, refresh_token');
    const now = Date.now();
    const c = {
      client_id: 'mcp_' + randomBytes(12).toString('base64url'),
      client_id_issued_at: Math.floor(now / 1000),
      client_name: String(b.client_name || 'MCP-клієнт').replace(/[\x00-\x1f]/g, '').slice(0, 80),
      redirect_uris: uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      created: now,
      last: now
    };
    clients.set(c.client_id, c);
    save();
    audit('client.register', { client: c.client_name, client_id: c.client_id, ip: req.kitIp || '' });
    const { created, last, ...out } = c;
    json(res, 201, { ...out, scope: 'kit' });
  };

  const consentCsp = to => `default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self' ${to}; frame-ancestors 'none'; base-uri 'none'`;
  const back = (res, uri, params) => {
    const u = new URL(uri);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
    u.searchParams.set('iss', origin);
    res.writeHead(303, { location: u.href, 'cache-control': 'no-store' });
    res.end();
  };

  const authorize = async (req, res, url) => {
    const q = url.searchParams;
    const client = clients.get(q.get('client_id') || '');
    const uri = q.get('redirect_uri') || '';
    if (!client) return html(res, 400, 'Підключення · Draft Kit', box('Невідомий клієнт', 'Перепідключіть сервер у Claude Code (/mcp → Authenticate).'));
    if (!uri && client.redirect_uris.length !== 1) return html(res, 400, 'Підключення · Draft Kit', box('Немає redirect_uri', ''));
    const redirect = uri || client.redirect_uris[0];
    if (!redirectOk(client, redirect)) return html(res, 400, 'Підключення · Draft Kit', box('Чужа адреса повернення', 'redirect_uri не збігається з зареєстрованим.'));
    const state = q.get('state') || '';
    if (q.get('response_type') !== 'code') return back(res, redirect, { error: 'unsupported_response_type', state });
    if (q.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(q.get('code_challenge') || '')) return back(res, redirect, { error: 'invalid_request', error_description: 'потрібен PKCE S256', state });
    if (!resourceOk(q.get('resource'))) return back(res, redirect, { error: 'invalid_target', error_description: 'resource має бути ' + resource, state });
    const s = auth.session(req);
    if (!s) {
      res.writeHead(303, { location: '/auth/login?next=' + encodeURIComponent(url.pathname + url.search), 'cache-control': 'no-store' });
      return res.end();
    }
    const id = randomBytes(18).toString('base64url');
    requests.set(id, { t: Date.now(), client_id: client.client_id, redirect, state, challenge: q.get('code_challenge'), resource: q.get('resource') || resource, email: s.user.email });
    const to = new URL(redirect).origin;
    html(res, 200, 'Підключення · Draft Kit', `<form class="box" method="post" action="/oauth/authorize">
<h1>Підключити Claude?</h1>
<p><b>${esc(client.client_name)}</b> хоче працювати зі Spine Draft Kit від імені <b>${esc(s.user.email)}</b>.</p>
<p><small>Він бачитиме й змінюватиме всі проекти, як і ви. Кожна його зміна в історії буде підписана «Claude · ${esc(s.user.name || s.user.email)}». Відключити можна в киті: Connect → Відключити.</small></p>
<input type="hidden" name="req" value="${esc(id)}"><input type="hidden" name="csrf" value="${esc(s.csrf)}">
<div class="row"><button class="sub" name="decision" value="deny">Скасувати</button><button name="decision" value="allow" autofocus>Дозволити</button></div>
</form>`, consentCsp(to));
  };

  const decide = async (req, res) => {
    if (req.headers.origin !== origin) { res.writeHead(403); return res.end('forbidden'); }
    const form = new URLSearchParams((await readBody(req, 8192)).toString('utf8'));
    const s = auth.session(req);
    const r = requests.get(form.get('req') || '');
    if (!s || !r || !same(form.get('csrf') || '', s.csrf) || r.email !== s.user.email || Date.now() - r.t > REQ_TTL) return html(res, 400, 'Підключення · Draft Kit', box('Запит застарів', 'Почніть підключення в Claude Code ще раз.'));
    requests.delete(form.get('req'));
    const client = clients.get(r.client_id);
    if (!client) return html(res, 400, 'Підключення · Draft Kit', box('Невідомий клієнт', ''));
    if (form.get('decision') !== 'allow') {
      audit('consent.deny', { email: s.user.email, client: client.client_name });
      return back(res, r.redirect, { error: 'access_denied', state: r.state });
    }
    const code = randomBytes(32).toString('base64url');
    codes.set(hash(code), { t: Date.now(), client_id: client.client_id, redirect: r.redirect, challenge: r.challenge, resource: r.resource, user: { email: s.user.email, name: s.user.name }, used: false, family: null });
    audit('consent.allow', { email: s.user.email, client: client.client_name });
    back(res, r.redirect, { code, state: r.state });
  };

  const tokenEndpoint = async (req, res) => {
    const wait = tokenRate(req.kitIp || req.socket.remoteAddress || '');
    if (wait) { res.setHeader('retry-after', String(wait)); return oerr(res, 429, 'slow_down'); }
    const type = String(req.headers['content-type'] || '');
    const raw = (await readBody(req, 64 * 1024)).toString('utf8');
    let q;
    if (/json/.test(type)) { try { q = new URLSearchParams(Object.entries(JSON.parse(raw || '{}')).map(([k, v]) => [k, String(v)])); } catch { return oerr(res, 400, 'invalid_request'); } }
    else q = new URLSearchParams(raw);
    const basic = /^Basic\s+(.+)$/i.exec(String(req.headers.authorization || ''));
    if (basic && !q.get('client_id')) { try { q.set('client_id', decodeURIComponent(Buffer.from(basic[1], 'base64').toString('utf8').split(':')[0])); } catch { return oerr(res, 401, 'invalid_client'); } }
    const client = clients.get(q.get('client_id') || '');
    if (!client) return oerr(res, 401, 'invalid_client');
    client.last = Date.now();
    const grant = q.get('grant_type');
    if (grant === 'authorization_code') {
      const h = hash(q.get('code') || '');
      const c = codes.get(h);
      if (!c) return oerr(res, 400, 'invalid_grant', 'код невідомий або застарів');
      if (c.used) {
        if (c.family) revokeFamily(c.family, 'replay');
        return oerr(res, 400, 'invalid_grant', 'код уже використано');
      }
      c.used = true;
      if (Date.now() - c.t > CODE_TTL) return oerr(res, 400, 'invalid_grant', 'код застарів');
      if (c.client_id !== client.client_id) return oerr(res, 400, 'invalid_grant', 'чужий клієнт');
      if ((q.get('redirect_uri') || c.redirect) !== c.redirect) return oerr(res, 400, 'invalid_grant', 'redirect_uri не збігається');
      if (q.get('resource') && strip(q.get('resource')) !== strip(c.resource)) return oerr(res, 400, 'invalid_target');
      const verifier = q.get('code_verifier') || '';
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || createHash('sha256').update(verifier).digest('base64url') !== c.challenge) return oerr(res, 400, 'invalid_grant', 'PKCE не збігається');
      const f = family({ kind: 'oauth', client_id: client.client_id, client_name: client.client_name, email: c.user.email, name: c.user.name });
      c.family = f.id;
      audit('token.issue', { email: f.email, family: f.id, client: f.client_name, kind: 'oauth' });
      return json(res, 200, pair(f));
    }
    if (grant === 'refresh_token') {
      const t = tokens.get(hash(q.get('refresh_token') || ''));
      if (!t || t.type !== 'refresh' || t.exp < Date.now()) return oerr(res, 400, 'invalid_grant', 'refresh_token невідомий або застарів');
      const f = families.get(t.family);
      if (!f || f.client_id !== client.client_id) return oerr(res, 400, 'invalid_grant');
      if (t.used) { revokeFamily(f.id, 'replay'); return oerr(res, 400, 'invalid_grant', 'refresh_token уже використано: усі токени цього підключення відкликано'); }
      if (q.get('resource') && !resourceOk(q.get('resource'))) return oerr(res, 400, 'invalid_target');
      t.used = true;
      for (const [h, x] of tokens) if (x.family === f.id && x.type === 'access') tokens.delete(h);
      f.last = Date.now();
      return json(res, 200, pair(f));
    }
    oerr(res, 400, 'unsupported_grant_type');
  };

  const revoke = async (req, res) => {
    const raw = (await readBody(req, 64 * 1024)).toString('utf8');
    const q = new URLSearchParams(raw);
    const t = tokens.get(hash(q.get('token') || ''));
    if (t) {
      const f = families.get(t.family);
      const cid = q.get('client_id');
      if (f && (!cid || cid === f.client_id || f.kind === 'personal')) revokeFamily(f.id, f.email);
    }
    res.writeHead(200, { 'cache-control': 'no-store' });
    res.end();
  };

  const handle = async (req, res, url) => {
    const path = url.pathname;
    const m = req.method;
    if (path === '/.well-known/oauth-protected-resource' || path === '/.well-known/oauth-protected-resource/mcp') return m === 'GET' ? json(res, 200, metaResource(), { 'cache-control': 'max-age=300' }) : json(res, 405, { error: 'method' });
    if (path === '/.well-known/oauth-authorization-server' || path === '/.well-known/oauth-authorization-server/mcp') return m === 'GET' ? json(res, 200, metaServer(), { 'cache-control': 'max-age=300' }) : json(res, 405, { error: 'method' });
    if (path === '/oauth/register' && m === 'POST') return register(req, res);
    if (path === '/oauth/authorize' && m === 'GET') return authorize(req, res, url);
    if (path === '/oauth/authorize' && m === 'POST') return decide(req, res);
    if (path === '/oauth/token' && m === 'POST') return tokenEndpoint(req, res);
    if (path === '/oauth/revoke' && m === 'POST') return revoke(req, res);
    json(res, 404, { error: 'not_found' });
  };

  const bearer = req => {
    const h = String(req.headers.authorization || '');
    const m = /^Bearer\s+([A-Za-z0-9._~+\/-]+=*)$/i.exec(h);
    if (!m) return { error: h ? 'invalid' : 'missing' };
    const t = tokens.get(hash(m[1]));
    if (!t || (t.type !== 'access' && t.type !== 'personal')) return { error: 'invalid' };
    if (t.exp < Date.now()) return { error: 'expired' };
    const f = families.get(t.family);
    if (!f) return { error: 'invalid' };
    const now = Date.now();
    if (now - f.last > MIN) { f.last = now; const c = clients.get(f.client_id); if (c) c.last = now; save(); }
    return { user: { email: f.email, name: f.name || f.email.split('@')[0] }, family: f.id, client: f.client_name || f.label || 'Claude' };
  };
  const challenge = err => `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"${err && err !== 'missing' ? ', error="invalid_token", error_description="' + (err === 'expired' ? 'token expired' : 'token invalid') + '"' : ''}`;

  const listFor = (email, all) => [...families.values()].filter(f => all || f.email === email).sort((a, b) => b.last - a.last).map(f => ({
    id: f.id, kind: f.kind, name: f.kind === 'personal' ? f.label || 'Персональний токен' : f.client_name, email: f.email, created: f.created, last: f.last,
    exp: f.kind === 'personal' ? Math.max(...[...tokens.values()].filter(t => t.family === f.id).map(t => t.exp), 0) : undefined
  }));

  const api = async (req, res, url, s) => {
    const path = url.pathname;
    const m = req.method;
    let r;
    if (path === '/api/mcp/clients' && m === 'GET') return json(res, 200, listFor(s.user.email, s.role === 'admin' && url.searchParams.get('all') === '1'));
    if ((r = /^\/api\/mcp\/clients\/(f[0-9a-f]{18})$/.exec(path)) && m === 'DELETE') {
      const f = families.get(r[1]);
      if (!f || (f.email !== s.user.email && s.role !== 'admin')) return json(res, 404, { error: 'немає підключення' });
      revokeFamily(f.id, s.user.email);
      return json(res, 200, { ok: true });
    }
    if (path === '/api/mcp/tokens' && m === 'POST') {
      let b = {};
      try { b = JSON.parse((await readBody(req, 4096)).toString('utf8') || '{}'); } catch { b = {}; }
      if ([...families.values()].filter(f => f.email === s.user.email && f.kind === 'personal').length >= 20) return json(res, 400, { error: 'забагато персональних токенів: відкличте старі' });
      const f = family({ kind: 'personal', client_id: '', label: String(b.label || 'Персональний токен').replace(/[\x00-\x1f]/g, '').slice(0, 80), email: s.user.email, name: s.user.name });
      const raw = addToken(f, 'personal', PERSONAL_TTL);
      save();
      audit('token.issue', { email: f.email, family: f.id, kind: 'personal' });
      return json(res, 200, { id: f.id, token: raw, exp: Date.now() + PERSONAL_TTL, command: `claude mcp add --transport http spine-kit ${resource} --header "Authorization: Bearer ${raw}"` });
    }
    json(res, 404, { error: 'unknown api' });
  };

  return { handle, bearer, challenge, api, resource, flush: writeNow, revokeFamily };
}
