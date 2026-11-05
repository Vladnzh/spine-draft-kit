import { createPublicKey, verify, createHash, randomBytes } from 'node:crypto';

const HOUR = 3600 * 1000;
const strip = s => String(s || '').replace(/\/+$/, '');
const fail = m => { const e = new Error(m); e.oidc = true; throw e; };

export const random = (n = 32) => randomBytes(n).toString('base64url');
export const pkce = () => {
  const verifier = random(48);
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

export function createOidc({ issuer, clientId, clientSecret, scopes, redirectUri }) {
  const base = strip(issuer);
  const secure = base.startsWith('https:');
  let disc = null, discAt = 0, jwks = null, jwksAt = 0, jwksTry = 0;

  const getJson = async (url, opts = {}) => {
    let r;
    try { r = await fetch(url, { ...opts, redirect: 'error', signal: AbortSignal.timeout(10000) }); }
    catch (e) { fail(`${new URL(url).host} недоступний (${e.cause?.code || e.name})`); }
    const text = await r.text();
    let j;
    try { j = JSON.parse(text); } catch { fail(`${new URL(url).host}: відповідь не JSON (${r.status})`); }
    if (!r.ok) fail(`${new URL(url).host}: ${j.error || r.status}${j.error_description ? ' · ' + String(j.error_description).slice(0, 200) : ''}`);
    return j;
  };
  const endpoint = (d, k) => {
    const v = d[k];
    if (typeof v !== 'string') fail(`discovery: немає ${k}`);
    const u = new URL(v);
    if (secure && u.protocol !== 'https:') fail(`discovery: ${k} не https`);
    return v;
  };

  const discovery = async () => {
    if (disc && Date.now() - discAt < HOUR) return disc;
    const d = await getJson(base + '/.well-known/openid-configuration');
    if (strip(d.issuer) !== base) fail('discovery: issuer не збігається з OIDC_ISSUER');
    for (const k of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) endpoint(d, k);
    disc = d;
    discAt = Date.now();
    return d;
  };

  const keys = async force => {
    const d = await discovery();
    const fresh = jwks && Date.now() - jwksAt < HOUR;
    if (fresh && !force) return jwks;
    if (force && jwks && Date.now() - jwksTry < 60000) return jwks;
    jwksTry = Date.now();
    const j = await getJson(d.jwks_uri);
    jwks = Array.isArray(j.keys) ? j.keys : [];
    jwksAt = Date.now();
    return jwks;
  };

  const authUrl = async ({ state, nonce, challenge }) => {
    const d = await discovery();
    const u = new URL(d.authorization_endpoint);
    const q = { response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: scopes, state, nonce, code_challenge: challenge, code_challenge_method: 'S256' };
    for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
    return u.href;
  };

  const exchange = async (code, verifier) => {
    const d = await discovery();
    const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier });
    const headers = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' };
    const methods = Array.isArray(d.token_endpoint_auth_methods_supported) ? d.token_endpoint_auth_methods_supported : ['client_secret_basic'];
    if (!clientSecret) body.set('client_id', clientId);
    else if (methods.includes('client_secret_basic')) headers.authorization = 'Basic ' + Buffer.from(encodeURIComponent(clientId) + ':' + encodeURIComponent(clientSecret)).toString('base64');
    else { body.set('client_id', clientId); body.set('client_secret', clientSecret); }
    const t = await getJson(d.token_endpoint, { method: 'POST', headers, body });
    if (typeof t.id_token !== 'string') fail('провайдер не повернув id_token');
    return t;
  };

  const verifyIdToken = async (jwt, nonce) => {
    const parts = String(jwt).split('.');
    if (parts.length !== 3) fail('ID token: не JWT');
    let header, claims;
    try {
      header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch { fail('ID token: не JWT'); }
    const alg = header.alg;
    if (alg !== 'RS256' && alg !== 'ES256') fail(`ID token: алгоритм ${alg} не підтримується`);
    const fits = k => k && (!header.kid || k.kid === header.kid) && (!k.use || k.use === 'sig') && (!k.alg || k.alg === alg) && (alg === 'RS256' ? k.kty === 'RSA' : k.kty === 'EC' && k.crv === 'P-256');
    let cands = (await keys(false)).filter(fits);
    if (!cands.length) cands = (await keys(true)).filter(fits);
    if (!cands.length) fail('ID token: немає ключа в JWKS');
    const data = Buffer.from(parts[0] + '.' + parts[1]);
    const sig = Buffer.from(parts[2], 'base64url');
    const good = cands.some(k => {
      try {
        const key = createPublicKey({ key: k, format: 'jwk' });
        return verify('sha256', data, alg === 'ES256' ? { key, dsaEncoding: 'ieee-p1363' } : key, sig);
      } catch { return false; }
    });
    if (!good) fail('ID token: підпис не збігається');
    const d = await discovery();
    const now = Math.floor(Date.now() / 1000);
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== d.issuer) fail('ID token: чужий iss');
    if (!aud.includes(clientId)) fail('ID token: чужий aud');
    if ((aud.length > 1 || claims.azp !== undefined) && claims.azp !== clientId) fail('ID token: чужий azp');
    if (typeof claims.exp !== 'number' || claims.exp < now - 60) fail('ID token: прострочений');
    if (typeof claims.iat === 'number' && claims.iat > now + 300) fail('ID token: iat з майбутнього');
    if (typeof claims.nonce !== 'string' || claims.nonce !== nonce) fail('ID token: nonce не збігається');
    return claims;
  };

  return { discovery, authUrl, exchange, verifyIdToken };
}
