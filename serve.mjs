import { createServer } from 'node:http';
import { createServer as createTlsServer } from 'node:https';
import { readFileSync, existsSync, statSync, readdirSync, watch } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { openData, lockInfo, imageInfo, ID, KIT } from './server/data.mjs';
import { createHub } from './server/hub.mjs';
import { createAuth } from './server/auth.mjs';
import { createHttp, limiter } from './server/http.mjs';
import { createOAuth } from './server/oauth.mjs';
import { createFiles } from './server/files.mjs';
import { createEngine } from './server/engine.mjs';
import { createMcpHttp } from './server/mcp-http.mjs';
import { createLog } from './server/log.mjs';
import { createLibrary } from './server/library.mjs';
import { createSandbox } from './server/sandbox.mjs';
import { vendorState } from './vendor.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'Spine-Draft-Kit.html');
const args = process.argv.slice(2);
const dev = args.includes('--dev');
const httpsFlag = args.includes('--https');
const rest = args.filter(a => a !== '--dev' && a !== '--https');
const env = process.env;
const PORT = Number(env.PORT) || (dev ? 5190 : 8080);
const CERTS = join(HERE, 'certs');
const tlsCert = env.TLS_CERT || (httpsFlag ? join(CERTS, 'localhost.pem') : '');
const tlsKey = env.TLS_KEY || (httpsFlag ? join(CERTS, 'localhost-key.pem') : '');
const tls = !!(tlsCert || tlsKey);
const cfg = {
  dev,
  port: PORT,
  host: env.HOST || (dev ? '127.0.0.1' : '0.0.0.0'),
  publicUrl: (env.PUBLIC_URL || (dev ? `${tls ? 'https' : 'http'}://localhost:${PORT}` : '')).replace(/\/+$/, ''),
  dataDir: resolve(env.DATA_DIR || (dev ? join(HERE, 'server-data') : '/data')),
  auth: env.AUTH || (dev ? 'dev' : 'oidc'),
  admins: String(env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
  maxImageMb: Number(env.MAX_IMAGE_MB) || 64,
  trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true',
  rateAuthPerMin: Number(env.RATE_AUTH_PER_MIN) || 10,
  rateRegisterPerHour: Number(env.RATE_REGISTER_PER_HOUR) || (dev ? 600 : 10),
  chromePath: env.CHROME_PATH || '',
  enginePort: Number(env.ENGINE_PORT) || 0,
  engineMaxTabs: Number(env.ENGINE_MAX_TABS) || 6,
  engineIdleMin: Number(env.ENGINE_IDLE_MIN) || 10,
  engineNoSandbox: env.ENGINE_NO_SANDBOX === '1' || env.ENGINE_NO_SANDBOX === 'true',
  extraRedirects: String(env.OAUTH_EXTRA_REDIRECTS || '').split(',').map(s => s.trim()).filter(Boolean)
};
const list = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
const LOOP = new Set(['127.0.0.1', '::1', 'localhost']);
const die = m => { console.error(m); process.exit(1); };
const secret = () => {
  if (env.OIDC_CLIENT_SECRET_FILE) { try { return readFileSync(env.OIDC_CLIENT_SECRET_FILE, 'utf8').trim(); } catch (e) { die(`Не читається OIDC_CLIENT_SECRET_FILE: ${e.message}`); } }
  return env.OIDC_CLIENT_SECRET || '';
};

if (rest[0] === 'import') await runImport(rest[1]);
else start();

function start() {
  if (!cfg.publicUrl) die('Потрібна змінна PUBLIC_URL, наприклад https://spine-kit.example.com');
  if (!['dev', 'oidc'].includes(cfg.auth)) die('AUTH має бути oidc або dev');
  if (cfg.auth === 'dev' && !LOOP.has(cfg.host)) die('AUTH=dev працює лише на loopback (HOST=127.0.0.1)');
  let pubUrl;
  try { pubUrl = new URL(cfg.publicUrl); } catch { die(`Поганий PUBLIC_URL: ${cfg.publicUrl}`); }
  if (pubUrl.protocol !== 'https:' && !(pubUrl.protocol === 'http:' && LOOP.has(pubUrl.hostname.replace(/^\[|\]$/g, '')))) die('PUBLIC_URL має бути https:// (http дозволений лише для localhost)');
  let oidc = null;
  if (cfg.auth === 'oidc') {
    oidc = {
      issuer: env.OIDC_ISSUER || '',
      clientId: env.OIDC_CLIENT_ID || '',
      clientSecret: secret(),
      scopes: env.OIDC_SCOPES || 'openid email profile',
      groupsClaim: env.OIDC_GROUPS_CLAIM || 'groups',
      domains: list(env.ALLOWED_EMAIL_DOMAINS).map(s => s.toLowerCase().replace(/^@/, '')),
      groups: list(env.ALLOWED_GROUPS)
    };
    if (!oidc.issuer || !oidc.clientId) die('Потрібні OIDC_ISSUER і OIDC_CLIENT_ID (і OIDC_CLIENT_SECRET або OIDC_CLIENT_SECRET_FILE)');
    if (!/^https:\/\//.test(oidc.issuer) && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(oidc.issuer)) die('OIDC_ISSUER має бути https://');
    if (!oidc.domains.length && !oidc.groups.length) die('Потрібна хоч одна з ALLOWED_EMAIL_DOMAINS або ALLOWED_GROUPS');
  }
  const missing = vendorState().filter(v => !v.ok);
  if (missing.length) {
    const m = `Немає vendor/ (${missing.map(v => v.file + ': ' + v.why).join(', ')}). Запусти: node vendor.mjs`;
    if (!dev && cfg.auth !== 'dev') die(m);
    console.error(m);
  }
  const data = openData(cfg.dataDir);
  try { data.lock(); } catch (e) { die(e.message); }
  const log = createLog({ dir: cfg.dataDir });
  const library = createLibrary({ data, log });
  const sandbox = createSandbox({ data, log });
  const hub = createHub({ data });
  const auth = createAuth({ data, mode: cfg.auth, publicUrl: cfg.publicUrl, admins: cfg.admins, oidc, log });
  let cached = null;
  const page = () => {
    if (!dev && cached) return cached;
    try { cached = readFileSync(OUT, 'utf8'); } catch { cached = null; }
    return cached;
  };
  const oauth = createOAuth({ data, publicUrl: cfg.publicUrl, auth, log, extraRedirects: cfg.extraRedirects, limiter, regPerHour: cfg.rateRegisterPerHour });
  const files = createFiles({ data, publicUrl: cfg.publicUrl, maxImageMb: cfg.maxImageMb, log, limiter });
  const engine = createEngine({ chromePath: cfg.chromePath, port: cfg.enginePort, maxTabs: cfg.engineMaxTabs, idleMin: cfg.engineIdleMin, noSandbox: cfg.engineNoSandbox, profileDir: join(tmpdir(), `spine-kit-engine-${PORT}`), log });
  const mcp = createMcpHttp({ hub, oauth, files, engine, publicUrl: cfg.publicUrl, log, limiter, library });
  const http = createHttp({ data, hub, auth, cfg, page, log, oauth, mcp, files, library, sandbox });
  engine.use(http);
  let server;
  if (tls) {
    if (!tlsCert || !tlsKey) die('Для HTTPS потрібні обидва: TLS_CERT і TLS_KEY');
    for (const f of [tlsCert, tlsKey]) if (!existsSync(f)) die(`Немає файлу сертифіката: ${f}\nЛокально: brew install mkcert && mkcert -install && npm run certs`);
    server = createTlsServer({ cert: readFileSync(tlsCert), key: readFileSync(tlsKey) }, http.handler);
  } else server = createServer(http.handler);
  server.on('error', e => die(`Не вдалося слухати ${cfg.host}:${PORT}: ${e.message}`));
  server.listen(PORT, cfg.host, () => log.info(`Draft Kit (сервер${dev ? ', dev' : ''}): ${cfg.publicUrl}`, { auth: cfg.auth, data: cfg.dataDir }));
  setInterval(() => hub.ping(), 20000).unref();

  if (dev) {
    const build = () => {
      const r = spawnSync(process.execPath, [join(HERE, 'build.mjs')], { encoding: 'utf8' });
      console.log(r.status === 0 ? r.stdout.trim() : `build failed\n${r.stderr || r.stdout}`);
      http.reload();
    };
    let timer;
    watch(join(HERE, 'src'), () => { clearTimeout(timer); timer = setTimeout(build, 80); });
    build();
  }

  let closing = false;
  const stop = () => {
    if (closing) return;
    closing = true;
    hub.shutdown();
    auth.flush();
    oauth.flush();
    engine.stop();
    data.unlock();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

async function runImport(src) {
  if (!src) die('Використання: node serve.mjs [--dev] import <папка projects/ | папка проекту | файл .spine-kit.json>');
  const path = resolve(src);
  if (!existsSync(path)) die(`Немає ${path}`);
  const pid = lockInfo(cfg.dataDir);
  if (pid) die(`Сервер працює (pid ${pid}). Зупини його перед імпортом.`);
  const data = openData(cfg.dataDir);
  data.lock();
  const hub = createHub({ data });
  const by = { kind: 'user', email: 'import@local', name: 'Імпорт' };
  const sources = [];
  if (statSync(path).isDirectory()) {
    if (existsSync(join(path, 'project.json'))) sources.push(path);
    else for (const d of readdirSync(path, { withFileTypes: true })) if (d.isDirectory() && !d.name.startsWith('.') && existsSync(join(path, d.name, 'project.json'))) sources.push(join(path, d.name));
  } else sources.push(path);
  let n = 0;
  for (const s of sources) {
    try {
      const r = importOne(s, data, hub, by);
      console.log(`+ ${r.game || 'Без назви'} → ${r.id} (${r.images} картинок${r.skipped.length ? ', пропущено: ' + r.skipped.join(', ') : ''})`);
      n++;
    } catch (e) { console.log(`! ${basename(s)}: ${e.message}`); }
  }
  hub.shutdown();
  data.unlock();
  console.log(`Імпортовано ${n} з ${sources.length} у ${cfg.dataDir}`);
}

function importOne(src, data, hub, by) {
  let settings, created, updated, id, files = [];
  if (statSync(src).isDirectory()) {
    const p = JSON.parse(readFileSync(join(src, 'project.json'), 'utf8'));
    settings = p.settings; created = p.created; updated = p.updated; id = p.id;
    for (const [key, file] of Object.entries(p.images || {})) {
      const f = join(src, 'images', basename(String(file)));
      if (existsSync(f)) files.push({ key, name: basename(f), buf: readFileSync(f) });
      else files.push({ key, name: String(file), buf: null });
    }
  } else {
    const p = JSON.parse(readFileSync(src, 'utf8'));
    settings = p.settings || p;
    for (const [key, url] of Object.entries(p.images || {})) {
      const m = /^data:[^;,]*;base64,(.*)$/.exec(String(url));
      files.push({ key, name: key.replace(/^[a-z]+:/, '') + '.png', buf: m ? Buffer.from(m[1], 'base64') : null });
    }
  }
  if (!settings || !Array.isArray(settings.components)) throw new Error('це не проект кита');
  const images = {}, skipped = [];
  for (const f of files) {
    const info = f.buf && imageInfo(f.buf);
    if (!info) { skipped.push(f.key); continue; }
    const sha = data.blobPut(f.buf);
    images[f.key] = { sha, name: f.name, type: info.type, w: info.w, h: info.h };
  }
  const now = Date.now();
  const doc = { kit: KIT, id: ID.test(id || '') && !data.project(id) ? id : 'c' + now.toString(36) + Math.random().toString(36).slice(2, 7), v: 1, created: created || now, createdBy: { email: by.email, name: by.name }, updated: updated || now, updatedBy: { email: by.email, name: by.name }, settings, images };
  hub.adopt(doc, by, 'Імпорт');
  return { id: doc.id, game: settings.game, images: Object.keys(images).length, skipped };
}
