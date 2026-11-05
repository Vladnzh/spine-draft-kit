import { createServer } from 'node:http';
import { generateKeyPairSync, sign, createHash, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const readBody = req => new Promise((resolve, reject) => {
  const parts = [];
  req.on('data', c => parts.push(c));
  req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
  req.on('error', reject);
});

export async function startMockOidc({ port = 5194, host = '127.0.0.1', clientId = 'kit', clientSecret = 'kit-secret', form = false } = {}) {
  const issuer = `http://${host}:${port}`;
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwks = [
    { ...rsa.publicKey.export({ format: 'jwk' }), kid: 'rsa1', use: 'sig', alg: 'RS256' },
    { ...ec.publicKey.export({ format: 'jwk' }), kid: 'ec1', use: 'sig', alg: 'ES256' }
  ];
  const codes = new Map();
  const mock = { issuer, clientId, clientSecret, user: { email: 'anya@test.dev', name: 'Аня' }, claims: {}, alg: 'RS256', tamper: null, deny: false, form, issued: [], seen: [] };

  const jwt = claims => {
    const alg = mock.tamper === 'none' ? 'none' : mock.alg;
    const data = enc({ alg, typ: 'JWT', kid: mock.alg === 'ES256' ? 'ec1' : 'rsa1' }) + '.' + enc(claims);
    if (alg === 'none') return data + '.';
    const sig = mock.alg === 'ES256' ? sign('sha256', Buffer.from(data), { key: ec.privateKey, dsaEncoding: 'ieee-p1363' }) : sign('sha256', Buffer.from(data), rsa.privateKey);
    if (mock.tamper === 'sig') sig[10] ^= 1;
    return data + '.' + sig.toString('base64url');
  };
  const send = (res, code, body, type = 'application/json') => {
    res.writeHead(code, { 'content-type': type + '; charset=utf-8', 'cache-control': 'no-store' });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  const issue = (res, q, user) => {
    const redirect = new URL(q.get('redirect_uri'));
    if (mock.deny) {
      redirect.searchParams.set('error', 'access_denied');
      redirect.searchParams.set('state', q.get('state') || '');
    } else {
      const code = randomBytes(24).toString('base64url');
      codes.set(code, { redirectUri: q.get('redirect_uri'), challenge: q.get('code_challenge'), nonce: q.get('nonce'), user, claims: { ...mock.claims }, t: Date.now() });
      mock.issued.push(code);
      redirect.searchParams.set('code', code);
      redirect.searchParams.set('state', q.get('state') || '');
    }
    res.writeHead(302, { location: redirect.href });
    res.end();
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, issuer);
    if (url.pathname === '/.well-known/openid-configuration') return send(res, 200, {
      issuer,
      authorization_endpoint: issuer + '/authorize',
      token_endpoint: issuer + '/token',
      jwks_uri: issuer + '/jwks',
      end_session_endpoint: issuer + '/logout',
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256', 'ES256'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['openid', 'email', 'profile']
    });
    if (url.pathname === '/jwks') return send(res, 200, { keys: jwks });
    if (url.pathname === '/authorize') {
      const q = req.method === 'POST' ? new URLSearchParams(await readBody(req)) : url.searchParams;
      mock.seen.push({ state: q.get('state'), nonce: q.get('nonce'), challenge: q.get('code_challenge') });
      if (q.get('client_id') !== clientId || q.get('response_type') !== 'code' || q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge') || !q.get('redirect_uri')) return send(res, 400, 'bad authorize request', 'text/plain');
      if (req.method === 'POST') return issue(res, q, { email: String(q.get('email') || ''), name: String(q.get('name') || '') });
      if (!mock.form) return issue(res, q, mock.user);
      const hidden = [...q].map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');
      return send(res, 200, `<!doctype html><meta charset="utf-8"><title>Mock SSO</title><form method="post" style="font:15px system-ui;display:grid;gap:10px;max-width:320px;margin:60px auto"><h1>Mock SSO</h1><label>Імʼя <input name="name" value="Тест"></label><label>Email <input name="email" type="email" value="test@test.dev"></label>${hidden}<button>Увійти</button></form>`, 'text/html');
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      const q = new URLSearchParams(await readBody(req));
      let id = q.get('client_id'), secret = q.get('client_secret');
      const basic = /^Basic (.+)$/.exec(req.headers.authorization || '');
      if (basic) [id, secret] = Buffer.from(basic[1], 'base64').toString('utf8').split(':').map(decodeURIComponent);
      if (id !== clientId || secret !== clientSecret) return send(res, 401, { error: 'invalid_client' });
      if (q.get('grant_type') !== 'authorization_code') return send(res, 400, { error: 'unsupported_grant_type' });
      const rec = codes.get(q.get('code'));
      codes.delete(q.get('code'));
      if (!rec || Date.now() - rec.t > 60000 || rec.redirectUri !== q.get('redirect_uri')) return send(res, 400, { error: 'invalid_grant' });
      if (createHash('sha256').update(q.get('code_verifier') || '').digest('base64url') !== rec.challenge) return send(res, 400, { error: 'invalid_grant', error_description: 'PKCE' });
      const now = Math.floor(Date.now() / 1000);
      const claims = {
        iss: mock.tamper === 'iss' ? 'http://evil.example' : issuer,
        sub: createHash('sha256').update(rec.user.email).digest('hex').slice(0, 16),
        aud: mock.tamper === 'aud' ? 'someone-else' : clientId,
        exp: mock.tamper === 'exp' ? now - 3600 : now + 300,
        iat: now,
        nonce: mock.tamper === 'nonce' ? 'wrong-nonce' : rec.nonce,
        email: rec.user.email,
        email_verified: true,
        name: rec.user.name,
        ...rec.claims
      };
      const idToken = jwt(claims);
      const access = randomBytes(24).toString('base64url');
      mock.issued.push(idToken, access);
      return send(res, 200, { access_token: access, token_type: 'Bearer', expires_in: 300, id_token: idToken });
    }
    if (url.pathname === '/logout') return send(res, 200, 'Вийшли з mock SSO', 'text/plain');
    send(res, 404, 'not found', 'text/plain');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  mock.close = () => new Promise(r => server.close(r));
  return mock;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.MOCK_PORT) || 5194;
  const m = await startMockOidc({ port, form: true });
  console.log(`Mock OIDC: ${m.issuer}\nOIDC_ISSUER=${m.issuer} OIDC_CLIENT_ID=${m.clientId} OIDC_CLIENT_SECRET=${m.clientSecret} ALLOWED_EMAIL_DOMAINS=test.dev`);
}
