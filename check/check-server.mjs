import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, rmSync, cpSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT = join(HERE, '..');
const OUT = process.argv[2] || join(HERE, 'out-server');
const SRC_PROJECTS = process.argv[3] || join(KIT, 'projects');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CPORT = Number(process.env.CHROME_PORT) || 9397;
const PORT = Number(process.env.PORT) || 5197;
const LPORT = Number(process.env.LOCAL_PORT) || 5198;
const BASE = `http://localhost:${PORT}`;
const DATA = join(OUT, 'data');
const PID = 'cmw3e9k1l1';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(SRC_PROJECTS, join(OUT, 'projects-copy'), { recursive: true, filter: s => !s.includes('/.trash') });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (label, cond, detail = '') => { results.push(`${cond ? 'PASS' : 'FAIL'} ${label}${cond || !detail ? '' : ' :: ' + detail}`); console.log(results.at(-1)); };
const canon = x => Array.isArray(x) ? x.map(canon) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canon(x[k])])) : x;
const C = x => JSON.stringify(canon(x));
const until = async (fn, ms = 5000, step = 50) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return Date.now() - t0; } catch { } await sleep(step); }
  return -1;
};
const run = (args, env) => new Promise(res => {
  const p = spawn(process.execPath, args, { cwd: KIT, env: { ...process.env, ...env } });
  let out = '';
  p.stdout.on('data', d => out += d);
  p.stderr.on('data', d => out += d);
  p.on('close', code => res({ code, out }));
});

const imp = await run([join(KIT, 'serve.mjs'), 'import', join(OUT, 'projects-copy')], { DATA_DIR: DATA });
ok('import: command', imp.code === 0 && /Імпортовано 1 з 1/.test(imp.out), imp.out);

let server = null;
const startServer = async () => {
  server = spawn(process.execPath, [join(KIT, 'serve.mjs')], { cwd: KIT, env: { ...process.env, AUTH: 'dev', HOST: '127.0.0.1', PORT: String(PORT), PUBLIC_URL: BASE, DATA_DIR: DATA }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stderr.on('data', d => process.stderr.write('[server] ' + d));
  return until(async () => (await fetch(BASE + '/healthz')).ok, 8000, 100);
};
const stopServer = async () => {
  if (!server) return;
  const p = server;
  server = null;
  const done = new Promise(r => p.on('close', r));
  p.kill('SIGTERM');
  await done;
};
ok('server starts', await startServer() >= 0);

const PROFILE = join(OUT, 'profile');
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CPORT}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1320,940', 'about:blank'], { stdio: 'ignore' });
let wsUrl = null;
for (let i = 0; i < 60 && !wsUrl; i++) { await sleep(200); try { wsUrl = (await (await fetch(`http://127.0.0.1:${CPORT}/json/version`)).json()).webSocketDebuggerUrl; } catch { } }
const ws = new WebSocket(wsUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let mid = 0;
const waiting = new Map();
const errors = [];
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') errors.push(`${m.sessionId}: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(`${m.sessionId}: console.error ${m.params.args.map(a => a.value ?? a.description ?? '').join(' ')}`);
});
const cdp = (method, params = {}, sessionId) => new Promise(res => { const i = ++mid; waiting.set(i, res); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });

const tab = async (ctx, url) => {
  const { result: { targetId } } = await cdp('Target.createTarget', { url: 'about:blank', browserContextId: ctx });
  const { result: { sessionId } } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  await cdp('Runtime.enable', {}, sessionId);
  await cdp('Page.enable', {}, sessionId);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1320, height: 940, deviceScaleFactor: 1, mobile: false }, sessionId);
  const t = { sessionId, targetId };
  t.ev = async expr => {
    const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.result?.exceptionDetails) throw new Error(`eval: ${expr.slice(0, 120)} -> ${r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text}`);
    return r.result?.result?.value;
  };
  t.go = async u => { await cdp('Page.navigate', { url: u }, sessionId); await sleep(300); };
  t.ready = () => until(async () => await t.ev(`!!(window.SpineKitSync && SpineKitSync.app && SpineKitSync.app() && SpineKitSync.status().pid && SpineKitSync.status().live)`), 15000, 100);
  t.s = path => t.ev(`JSON.parse(JSON.stringify(SpineKitSync.app().state.s${path || ''}))`);
  t.idle = () => t.ev(`SpineKitSync.idle()`);
  t.edit = code => t.ev(`(() => { const App = SpineKitSync.app(), S = App.state; ${code}; App.changed({ render: true }); return true; })()`);
  if (url) await t.go(url);
  return t;
};
const ctxA = (await cdp('Target.createBrowserContext')).result.browserContextId;
const ctxB = (await cdp('Target.createBrowserContext')).result.browserContextId;
const login = async (t, name, email, next) => {
  await t.go(`${BASE}/auth/login?next=${encodeURIComponent(next)}`);
  await until(() => t.ev(`!!document.querySelector('input[name=email]')`), 5000);
  await t.ev(`(() => { const f = document.querySelector('form'); f.name.value = ${JSON.stringify(name)}; f.email.value = ${JSON.stringify(email)}; f.submit(); return true; })()`);
  await sleep(500);
};
const A = await tab(ctxA);
const B = await tab(ctxB);
await login(A, 'Аня', 'anya@test.dev', `/p/${PID}`);
await login(B, 'Богдан', 'bohdan@test.dev', `/p/${PID}`);
ok('A opens /p/<id>', await A.ready() >= 0);
ok('B opens /p/<id>', await B.ready() >= 0);

const cookieOf = async t => (await cdp('Network.getCookies', { urls: [BASE] }, t.sessionId)).result?.cookies?.find(c => c.name === 'kit_sid');
await cdp('Network.enable', {}, A.sessionId);
const jar = `kit_sid=${(await cookieOf(A)).value}`;
const csrf = (await (await fetch(BASE + '/api/session', { headers: { cookie: jar } })).json()).csrf;
const get = async p => (await fetch(BASE + p, { headers: { cookie: jar } })).json();
const post = async (p, body) => (await fetch(BASE + p, { method: 'POST', headers: { cookie: jar, origin: BASE, 'x-kit-csrf': csrf, 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
const doc = () => get(`/api/projects/${PID}`);
const hist = async scope => (await get(`/api/projects/${PID}/history?scope=${scope}`)).entries;

{
  const src = JSON.parse(readFileSync(join(OUT, 'projects-copy', readdirSync(join(OUT, 'projects-copy')).find(d => d.endsWith(PID)), 'project.json'), 'utf8'));
  const d = await doc();
  const keys = Object.keys(src.images);
  const blobs = await Promise.all(keys.map(async k => (await fetch(`${BASE}/api/blobs/${d.images[k]?.sha}`, { method: 'HEAD', headers: { cookie: jar } })).ok));
  ok('import: settings equal', C(d.settings) === C(src.settings));
  ok('import: all images with blobs', keys.length > 0 && keys.every(k => d.images[k]) && blobs.every(Boolean), `${keys.length} keys`);
  ok('import: layouts kept', C(d.settings.layouts) === C(src.settings.layouts), (d.settings.layouts?.list || []).map(l => l.name).join(','));
}

await sleep(2500);
{
  const d = await doc();
  const h = (await hist('drafts')).concat(await hist('layouts'));
  ok('opening only: no history entries, no versions', d.v === 1 && h.length === 2 && h.every(e => e.label === 'Імпорт'), `v=${d.v} ${h.map(e => e.label).join(' | ')}`);
}

{
  const sameUi = await A.ev(`SpineKitSync.app().state.images['sym:high_1'] ? SpineKitSync.app().state.images['sym:high_1'].w : 0`);
  ok('images decoded in A', sameUi > 0);
  await A.ev(`(() => { const i = document.getElementById('g-name'); i.value = 'dice-live'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  const ms = await until(async () => (await B.s('.game')) === 'dice-live', 3000, 20);
  ok('field A → B ≤ 1 s', ms >= 0 && ms <= 1000, `${ms} ms`);
  ok('B shows the field', await B.ev(`document.getElementById('crumb').textContent`) === 'dice-live');
}

await sleep(1500);
{
  await Promise.all([A.edit(`S.s.cell.w = 300`), B.edit(`S.s.rows = 4`)]);
  await sleep(200);
  await Promise.all([A.idle(), B.idle()]);
  await sleep(300);
  const [a, b, d] = [await A.s(), await B.s(), (await doc()).settings];
  ok('different fields both kept', a.cell.w === 300 && a.rows === 4 && b.cell.w === 300 && b.rows === 4 && d.cell.w === 300 && d.rows === 4, JSON.stringify([a.cell.w, a.rows, b.cell.w, b.rows, d.cell.w, d.rows]));
  await Promise.all([A.edit(`S.s.game = 'AAA'`), B.edit(`S.s.game = 'BBB'`)]);
  await sleep(200);
  await Promise.all([A.idle(), B.idle()]);
  await sleep(400);
  const g = [await A.s('.game'), await B.s('.game'), (await doc()).settings.game];
  ok('same field converges', g[0] === g[1] && g[1] === g[2] && /^(AAA|BBB)$/.test(g[0]), g.join(','));
}

await sleep(1500);
{
  await Promise.all([
    A.edit(`
      S.s.components.push(App.fromTemplate(App.templates.custom, 'animation_meter'));
      S.s.components = S.s.components.filter(c => c.type !== 'frame_under');
      const sc = S.s.components.find(c => c.type === 'symbols');
      sc.symbols.push({ name: 'bonus_1' });
      sc.anims = sc.anims.filter(a => a.name !== 'win_insignificant');
      S.s.layouts.list[0].bones.push({ name: 'position_a', x: 10, y: 20 });
    `),
    B.edit(`
      S.s.components.unshift(App.fromTemplate(App.templates.logo));
      const sc = S.s.components.find(c => c.type === 'symbols');
      sc.symbols.reverse();
      sc.anims.push(App.A('anticipation', 1, 'shake', true));
      const cu = S.s.components.find(c => c.type === 'custom');
      if (cu) { cu.parts = (cu.parts || []).concat([{ name: 'glow_b', parent: 'art', x: 0, y: 0, w: 50, h: 50 }]); cu.anims.reverse(); }
      S.s.layouts.list[0].bones.push({ name: 'position_b', x: 0, y: 0 });
      S.s.layouts.list[0].bones.reverse();
    `)
  ]);
  await sleep(300);
  await Promise.all([A.idle(), B.idle()]);
  await sleep(600);
  const F = await tab(ctxB, `${BASE}/p/${PID}`);
  await F.ready();
  await sleep(500);
  const [a, b, f] = [await A.s(), await B.s(), await F.s()];
  await cdp('Target.closeTarget', { targetId: F.targetId });
  ok('structural concurrent edits: A = B = fresh tab from server', C(a) === C(b) && C(b) === C(f), `${C(a).length} ${C(b).length} ${C(f).length}`);
  const sc = a.components.find(c => c.type === 'symbols');
  const L = a.layouts.list[0];
  ok('structural: all edits present', a.components.some(c => c.name === 'animation_meter') && a.components.some(c => c.name === 'animation_game_logo') && !a.components.some(c => c.type === 'frame_under' && c.on !== false) && sc.symbols.some(s => s.name === 'bonus_1') && sc.anims.some(x => x.name === 'anticipation') && !sc.anims.some(x => x.name === 'win_insignificant') && L.bones.some(x => x.name === 'position_a') && L.bones.some(x => x.name === 'position_b'), JSON.stringify({ comps: a.components.map(c => c.name || c.type), syms: sc.symbols.map(s => s.name), anims: sc.anims.map(x => x.name) }));
  await A.edit(`S.s.components.find(c => c.type === 'frame_under').on = true`);
  await A.idle();
  await sleep(300);
  const fu = ((await doc()).settings.components || []).find(c => c.type === 'frame_under');
  ok('edit of a normalized component reaches the server', !!fu && fu.on === true && Array.isArray(fu.anims), JSON.stringify(fu || null).slice(0, 120));
}

await sleep(1500);
{
  await B.edit(`S.s.tech.spineVersion = '4.1.24'; S.s.cell.w = 301`);
  await B.idle();
  await sleep(300);
  const sha = await A.ev(`(async () => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 48;
    const x = c.getContext('2d'); x.fillStyle = '#e3352b'; x.fillRect(0, 0, 64, 48);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const App = SpineKitSync.app();
    await App.setImage('sym:high_1', new File([blob], 'high_1.png', { type: 'image/png' }), 'high_1.png');
    App.changed({ render: true, images: true });
    return true;
  })()`);
  const ms = await until(async () => await B.ev(`(SpineKitSync.app().state.images['sym:high_1'] || {}).w === 64`), 5000, 50);
  ok('image A → B', sha && ms >= 0, `${ms} ms`);
  await sleep(300);
  const h = await hist('drafts');
  const e = h.find(x => /Картинка high_1/.test(x.label));
  ok('history: «Картинка high_1» by A', !!e && e.by.email === 'anya@test.dev', h.slice(0, 4).map(x => `${x.label} (${x.by.name})`).join(' | '));
}

await sleep(1500);
{
  await B.edit(`S.s.cell.w = 302`);
  await B.idle();
  await sleep(300);
  await A.edit(`S.s.cell.h = 300`);
  await sleep(400);
  await A.edit(`S.s.tech.fps = 60`);
  await A.idle();
  await sleep(300);
  let h = await hist('drafts');
  const top = h[0];
  ok('history groups A edits', top.by.email === 'anya@test.dev' && /Клітинка/.test(top.label) && /Технічні/.test(top.label) && top.open, `${top.label} open=${top.open}`);
  await B.edit(`S.s.tech.folder = 'skins/x/'`);
  await B.idle();
  await sleep(300);
  h = await hist('drafts');
  ok('other author closes the group', h[0].by.email === 'bohdan@test.dev' && h[1].id === top.id && !h[1].open, h.slice(0, 3).map(x => `${x.label}/${x.by.name}/${x.open ? 'open' : 'closed'}`).join(' | '));
  const layBefore = C((await doc()).settings.layouts);
  const first = (await hist('drafts')).at(-1);
  const r = await post(`/api/projects/${PID}/restore`, { entry: first.id, scope: 'drafts' });
  const src = JSON.parse(readFileSync(join(OUT, 'projects-copy', readdirSync(join(OUT, 'projects-copy')).find(d => d.endsWith(PID)), 'project.json'), 'utf8'));
  const msA = await until(async () => (await A.s('.game')) === src.settings.game && (await B.s('.game')) === src.settings.game, 5000);
  const d = await doc();
  ok('restore drafts updates both tabs', r.v > 0 && msA >= 0 && d.settings.game === src.settings.game, JSON.stringify(r));
  ok('restore keeps layouts scope', C(d.settings.layouts) === layBefore);
  h = await hist('drafts');
  ok('restore entry in history', h[0].restoreOf === first.id && h[0].by.email === 'anya@test.dev', h[0].label);
  const nv = await post(`/api/projects/${PID}/versions`, { label: 'Перед релізом' });
  ok('named version', nv.entries && nv.entries.length === 2 && (await hist('layouts')).some(e => e.named === 'Перед релізом'));
  const cp = await post(`/api/projects/${PID}/copy`, { entry: first.id });
  const seen = await until(async () => await B.ev(`SpineKitSync.app().state.projects.some(p => p.id === ${JSON.stringify(cp.id)})`), 5000);
  const cdoc = await get(`/api/projects/${cp.id}`);
  ok('copy from version → new project, B sees it live', !!cp.id && seen >= 0 && cdoc.settings.game === src.settings.game + '-copy', JSON.stringify(cp));
  const V = await tab(ctxA, `${BASE}/p/${PID}?v=${first.id}`);
  await until(() => V.ev(`!!document.querySelector('#sk-banner:not([hidden])')`), 10000);
  await sleep(800);
  const vt = await V.ev(`document.getElementById('sk-banner').textContent`);
  const v0 = (await doc()).v;
  await V.ev(`(() => { const App = SpineKitSync.app(); App.state.s.game = 'view-edit'; App.changed(); return true; })()`);
  await sleep(1200);
  ok('view version is read-only', /Версія від/.test(vt) && (await doc()).v === v0 && (await V.s('.game')) === 'view-edit', vt);
  await cdp('Target.closeTarget', { targetId: V.targetId });
}

await sleep(1500);
{
  const h0 = (await A.s('.cell.h'));
  await A.edit(`S.s.cell.h = 222; S.s.tech.fps = 50`);
  await A.idle();
  await sleep(1400);
  await B.edit(`S.s.tech.fps = 24`);
  await B.idle();
  await until(async () => (await A.s('.tech.fps')) === 24, 3000);
  await A.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', key: 'z', metaKey: true, ctrlKey: true, bubbles: true })), true`);
  await sleep(300);
  await A.idle();
  await sleep(500);
  const [a, b, d] = [await A.s(), await B.s(), (await doc()).settings];
  ok('⌘Z in A undoes only A', a.cell.h === h0 && b.cell.h === h0 && d.cell.h === h0, JSON.stringify([h0, a.cell.h, b.cell.h, d.cell.h]));
  ok('⌘Z keeps B field', a.tech.fps === 24 && b.tech.fps === 24 && d.tech.fps === 24, JSON.stringify([a.tech.fps, b.tech.fps, d.tech.fps]));
  const h = await hist('drafts');
  ok('undo is a batch «Скасовано: …»', /^Скасовано/.test(h[0].label) && h[0].by.email === 'anya@test.dev', h[0].label);
}

{
  const before = C((await doc()).settings);
  const seenA = C(await A.s());
  await cdp('Page.reload', {}, B.sessionId);
  await sleep(500);
  await B.ready();
  await sleep(800);
  ok('B reload shows the same state', C(await B.s()) === seenA);
  const entries = async () => (await hist('drafts')).concat(await hist('layouts'));
  const ids0 = (await entries()).map(e => e.id);
  await stopServer();
  ok('server restarts', await startServer() >= 0);
  const ids1 = (await entries()).map(e => e.id);
  ok('restart keeps state', C((await doc()).settings) === before);
  ok('restart keeps history', ids0.every(id => ids1.includes(id)), `${ids0.length} → ${ids1.length}`);
  ok('tabs reconnect after restart', await until(() => A.ev(`SpineKitSync.status().live`), 10000) >= 0 && await until(() => B.ev(`SpineKitSync.status().live`), 10000) >= 0);
}

{
  await stopServer();
  const banner = await until(() => A.ev(`(() => { const b = document.getElementById('sk-banner'); return !b.hidden && /Немає звʼязку/.test(b.textContent); })()`), 8000, 200);
  ok('offline banner shows', banner >= 0);
  await A.ev(`(() => { const i = document.getElementById('g-name'); i.value = 'offline-edit'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await sleep(2000);
  const queued = await A.ev(`SpineKitSync.status().outbox`);
  await sleep(28000);
  ok('server back', await startServer() >= 0);
  const ms = await until(async () => (await B.s('.game')) === 'offline-edit', 15000, 100);
  ok('offline edits wait and arrive', queued > 0 && ms >= 0 && (await doc()).settings.game === 'offline-edit', `outbox=${queued} ${ms} ms`);
  ok('banner hides', await until(() => A.ev(`document.getElementById('sk-banner').hidden`), 8000) >= 0);
}

{
  const pres = await A.ev(`[...document.querySelectorAll('#sk-pres .sk-av')].map(a => a.title).join(' | ')`);
  ok('presence shows both people', /Аня/.test(pres) && /Богдан/.test(pres), pres);
  await A.ev(`document.getElementById('hist-btn').click(), true`);
  await until(() => A.ev(`document.querySelectorAll('#hist-list .sk-h').length > 3`), 5000);
  const rows = await A.ev(`[...document.querySelectorAll('#hist-list .sk-h')].slice(0, 4).map(li => li.textContent).join(' | ')`);
  ok('history panel lists entries with authors', /Аня|Богдан/.test(rows), rows.slice(0, 300));
  await A.ev(`document.getElementById('hist-close').click(), true`);
}

ok('no page errors', errors.length === 0, errors.slice(0, 5).join(' || '));

await cdp('Target.disposeBrowserContext', { browserContextId: ctxA });
await cdp('Target.disposeBrowserContext', { browserContextId: ctxB });
await stopServer();

{
  const LDATA = join(OUT, 'local-projects');
  mkdirSync(LDATA, { recursive: true });
  const dev = spawn(process.execPath, [join(KIT, 'dev.mjs')], { cwd: KIT, env: { ...process.env, PORT: String(LPORT), SPINE_KIT_DATA: LDATA }, stdio: 'ignore' });
  await until(async () => (await fetch(`http://127.0.0.1:${LPORT}/api/info`)).ok, 8000, 100);
  const ctx = (await cdp('Target.createBrowserContext')).result.browserContextId;
  const L = await tab(ctx, `http://localhost:${LPORT}/?connect=1`);
  const linked = await until(async () => (await (await fetch(`http://127.0.0.1:${LPORT}/api/info`)).json()).page, 15000, 200);
  ok('local: page connects (Connect)', linked >= 0);
  ok('local: no server mode', await L.ev(`window.SpineKitSync.mode() === null && !document.getElementById('sk-banner')`));
  const mcp = spawn(process.execPath, [join(KIT, 'mcp.mjs')], { cwd: KIT, env: { ...process.env, SPINE_KIT_PORT: String(LPORT), SPINE_KIT_DATA: LDATA }, stdio: ['pipe', 'pipe', 'ignore'] });
  let buf = '';
  const replies = new Map();
  mcp.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(line); if (m.id) replies.set(m.id, m); } catch { } } });
  const rpc = async (id, method, params) => { mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); await until(() => replies.has(id), 30000, 50); return replies.get(id); };
  await rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'check', version: '1' } });
  mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const tools = await rpc(2, 'tools/list', {});
  ok('local: stdio MCP tools/list', (tools.result?.tools || []).length > 10, String((tools.result?.tools || []).length));
  const cr = await rpc(3, 'tools/call', { name: 'create_project', arguments: { name: 'local-check', reels: 5, rows: 3 } });
  const txt = JSON.stringify(cr.result || cr.error);
  ok('local: create_project through the page', !cr.result?.isError && /local-check/.test(txt), txt.slice(0, 300));
  const onDisk = await until(() => readdirSync(LDATA).some(d => d.startsWith('local-check--')), 8000, 200);
  ok('local: project copied to disk', onDisk >= 0);
  mcp.kill();
  dev.kill();
  await cdp('Target.disposeBrowserContext', { browserContextId: ctx });
}

chrome.kill();
console.log('\n' + results.filter(r => r.startsWith('FAIL')).join('\n'));
const bad = results.filter(r => r.startsWith('FAIL'));
console.log(`\n${results.length - bad.length}/${results.length} passed`);
process.exit(bad.length ? 1 : 0);
