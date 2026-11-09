import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] || join(HERE, 'out');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9361;
const PROFILE = join(OUT, 'profile');
const DOWNLOADS = join(OUT, 'downloads');
const SHOTS = join(OUT, 'shots');
const TEST = join(OUT, 'test.html');
rmSync(OUT, { recursive: true, force: true });
[OUT, DOWNLOADS, SHOTS].forEach(d => mkdirSync(d, { recursive: true }));
const CSP = "default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data: blob:; connect-src 'none'";
const html = readFileSync(join(HERE, '../Spine-Draft-Kit.html'), 'utf8');
writeFileSync(TEST, html.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${CSP}">`));

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1320,940', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let wsUrl = null;
for (let i = 0; i < 50 && !wsUrl; i++) {
  await sleep(200);
  try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = list.find(t => t.type === 'page'); if (p) wsUrl = p.webSocketDebuggerUrl; } catch { /* starting */ }
}
const ws = new WebSocket(wsUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
const problems = [];
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) problems.push(`console.${m.params.type}: ${m.params.args.map(a => a.value ?? a.description ?? '').join(' ')}`);
  if (m.method === 'Runtime.exceptionThrown') problems.push(`exception: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') problems.push(`log: ${m.params.entry.text} ${m.params.entry.url || ''}`);
  if (m.method === 'Network.loadingFailed' && !/ERR_ABORTED/.test(m.params.errorText)) problems.push(`network: ${m.params.errorText} ${m.params.blockedReason || ''}`);
});
const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(`eval: ${expr.slice(0, 90)} -> ${r.result.exceptionDetails.exception?.description}`);
  return r.result?.result?.value;
};
const shot = async (name, clip) => {
  const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
  const buf = Buffer.from(r.result.data, 'base64');
  if (name) writeFileSync(join(SHOTS, name + '.png'), buf);
  return buf;
};
const results = [];
const ok = (label, cond, detail = '') => results.push(`${cond ? 'PASS' : 'FAIL'} ${label}${detail ? ' :: ' + detail : ''}`);
const stageClip = async () => JSON.parse(await ev(`JSON.stringify((() => { const r = document.getElementById('stage').getBoundingClientRect(); return { x: r.x, y: r.y + scrollY, width: r.width, height: r.height }; })())`));
const plays = async label => {
  await sleep(1500);
  const clip = await stageClip();
  const a = await shot(null, clip); await sleep(450); const b = await shot(null, clip);
  const info = JSON.parse(await ev(`JSON.stringify({ canvas: !!document.querySelector('#stage canvas'), err: (document.querySelector('#stage .spine-player-error, #stage .stage-msg') || {}).textContent || '' })`));
  ok(`${label}: player renders and animates`, info.canvas && !info.err && !a.equals(b), JSON.stringify(info));
};

await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable'); await send('Network.enable');
await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS });
await send('Emulation.setDeviceMetricsOverride', { width: 1320, height: 940, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: 'file://' + TEST });
await sleep(6000);

const snap = async () => JSON.parse(await ev(`JSON.stringify({
  cards: document.querySelectorAll('#c-list .comp').length,
  meta: document.getElementById('dl-meta').textContent,
  spines: [...document.getElementById('pv-spine').options].map(o => o.value),
  pv: document.getElementById('pv-spine').value,
  chips: [...document.querySelectorAll('#pv-anims .chip')].map(c => c.textContent + (c.getAttribute('aria-pressed') === 'true' ? '*' : '')),
  warns: document.getElementById('warns').textContent,
  grid: document.getElementById('grid-label').textContent,
  sw: document.documentElement.scrollWidth, iw: innerWidth
})`));
let s = await snap();
ok('boots with 4 components', s.cards === 4, JSON.stringify(s.cards));
ok('15 spines planned for the default 5x3', s.spines.length === 15 && /^15 /.test(s.meta), s.meta);
ok('no warnings', !s.warns, s.warns);
ok('grid label', s.grid === '5 × 3 · 334 × 334 px', s.grid);
await plays('symbol win');
await shot('desktop-light');

await ev(`[...document.querySelectorAll('.preset')].find(b => b.textContent === '6×4').click(), true`);
await sleep(600);
s = await snap();
ok('6x4 preset renames the reel spines', s.spines.includes('animation_reels_6_columns') && s.spines.includes('animation_reel_4_rows') && s.grid.startsWith('6 × 4'), s.spines.filter(n => /reel_|reels_\d/.test(n)).join(','));
await ev(`(() => { const sel = document.getElementById('pv-spine'); sel.value = 'animation_reel_4_rows'; sel.dispatchEvent(new Event('change')); return true; })()`);
s = await snap();
ok('reel rows preview selected spin_loop', s.chips.includes('spin_loop*'), s.chips.join(' '));
await plays('reel rows spin_loop');
await shot('reels-rows');
await ev(`(() => { const sel = document.getElementById('pv-spine'); sel.value = 'animation_reels_6_columns'; sel.dispatchEvent(new Event('change')); [...document.querySelectorAll('#pv-anims .chip')].find(c => c.textContent === 'in').click(); return true; })()`);
await plays('reel columns in');

await ev(`document.querySelector('[data-add="background"]').click(), true`);
await sleep(700);
s = await snap();
ok('added a background component', s.cards === 5 && s.spines.includes('animation_bg') && s.pv === 'animation_bg', `${s.cards} ${s.pv}`);
await plays('background');
await ev(`document.querySelector('[data-id="frame_above"] .comp-open').click(), true`);
await ev(`document.querySelector('[data-id="reels"] .comp-open').click(), true`);
await sleep(500);
const bodies = await ev(`[...document.querySelectorAll('.comp-body')].length`);
ok('cards expand', bodies >= 3, String(bodies));
const ddState = async id => JSON.parse(await ev(`JSON.stringify((() => { const sel = document.getElementById('${id}'), btn = document.getElementById('${id}-btn'); return { open: !document.getElementById('dd-pop').hidden, expanded: btn.getAttribute('aria-expanded'), opts: [...document.querySelectorAll('#dd-pop .dd-opt')].map(o => o.textContent), picked: (document.querySelector('#dd-pop .dd-opt[aria-selected="true"]') || {}).textContent || '', label: btn.textContent, value: sel.value, native: getComputedStyle(sel).display, focus: document.activeElement === btn }; })())`));
const ddKeys = keys => ev(`(() => { const b = document.getElementById('pv-spine-btn'); b.focus(); ${JSON.stringify(keys)}.forEach(key => b.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))); return true; })()`);
s = await snap();
await ev(`document.getElementById('pv-spine-btn').click(), true`);
let d = await ddState('pv-spine');
ok('dropdown: opens with every spine, native select hidden', d.open && d.expanded === 'true' && d.opts.join() === s.spines.join() && d.picked === s.pv && d.native === 'none', JSON.stringify({ n: d.opts.length, picked: d.picked, native: d.native }));
await sleep(300);
await shot('dropdown-open');
await ev(`[...document.querySelectorAll('#dd-pop .dd-opt')].find(o => o.textContent === 'animation_reels_6_columns').click(), true`);
await sleep(300);
d = await ddState('pv-spine'); s = await snap();
ok('dropdown: click picks and fires change', !d.open && d.value === 'animation_reels_6_columns' && d.label === 'animation_reels_6_columns' && s.chips.some(c => c.replace('*', '') === 'in') && d.focus, JSON.stringify({ v: d.value, l: d.label, chips: s.chips.join(' ') }));
await ddKeys(['ArrowDown', 'Home', 'Enter']);
await sleep(300);
d = await ddState('pv-spine');
ok('dropdown: keyboard Home + Enter picks the first', !d.open && d.value === s.spines[0] && d.label === s.spines[0], d.value);
await ddKeys(['ArrowDown', 'End', 'Escape']);
d = await ddState('pv-spine');
ok('dropdown: Escape closes without picking', !d.open && d.value === s.spines[0] && d.focus, d.value);
await ddKeys(['ArrowDown', 'a', 'n', 'i', 'm', 'a', 't', 'i', 'o', 'n', '_', 'b', 'g', 'Enter']);
await sleep(300);
d = await ddState('pv-spine');
ok('dropdown: type-ahead finds a spine', d.value === 'animation_bg', d.value);
await ev(`document.getElementById('pv-spine').value = 'animation_reels_6_columns', true`);
d = await ddState('pv-spine');
ok('dropdown: programmatic value updates the label', d.label === 'animation_reels_6_columns', d.label);
await ev(`document.getElementById('pv-spine').dispatchEvent(new Event('change')), true`);
await sleep(300);
const motion = JSON.parse(await ev(`JSON.stringify((() => { const w = document.querySelector('.a-row .dd'); const b = w.querySelector('.dd-btn'); b.click(); const opts = [...document.querySelectorAll('#dd-pop .dd-opt')]; const before = b.textContent; const target = opts[opts.length - 1]; const text = target.textContent; target.click(); return { n: opts.length, before, after: b.textContent, text, value: w.querySelector('select').value, open: !document.getElementById('dd-pop').hidden }; })())`));
ok('dropdown: motion preset in an animation row', motion.n > 3 && motion.after === motion.text && motion.after !== motion.before && !motion.open, JSON.stringify(motion));
await ev(`document.getElementById('pv-spine-btn').click(), true`);
await ev(`scrollBy(0, 40), true`);
await sleep(100);
d = await ddState('pv-spine');
ok('dropdown: scrolling the page closes it', !d.open && d.expanded === 'false', String(d.open));
await ev(`[...document.querySelectorAll('.tile')].find(t => t.textContent.startsWith('high_2')).click(), true`);
await sleep(300);
ok('symbol editor opens', await ev(`!!document.querySelector('.sym-edit')`));
await shot('desktop-expanded');

await ev(`document.getElementById('dl-all').click(), true`);
let zip = null;
for (let i = 0; i < 60 && !zip; i++) { await sleep(300); zip = readdirSync(DOWNLOADS).find(f => f.endsWith('.zip')); }
ok('zip downloaded', !!zip, zip || 'none');
if (zip) {
  const tmp = join(OUT, 'unzipped');
  execFileSync('unzip', ['-q', join(DOWNLOADS, zip), '-d', tmp]);
  const root = join(tmp, readdirSync(tmp)[0]);
  const dir = join(root, 'skins/main/Motion/spine');
  const jsons = readdirSync(dir).filter(f => f.endsWith('.json'));
  ok('zip holds 16 spines for the art repo', jsons.length === 16, jsons.length + '');
  const core = await import(join(process.env.HOME, 'Documents/GitHub/spine-viewer-v2/node_modules/@esotericsoftware/spine-core/dist/index.js'));
  class T extends core.Texture { constructor(img) { super(img); } setFilters() {} setWraps() {} dispose() {} }
  const png = f => { const b = readFileSync(f); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };
  let bad = [];
  for (const j of jsons) {
    const name = j.replace(/\.json$/, '');
    try {
      const atlasText = readFileSync(join(dir, name + '.atlas'), 'utf8');
      const atlas = new core.TextureAtlas(atlasText);
      for (const p of atlas.pages) {
        const size = png(join(dir, p.name));
        if (size.w !== p.width || size.h !== p.height) bad.push(`${name}: page ${p.name} ${size.w}x${size.h} vs ${p.width}x${p.height}`);
        p.setTexture(new T({ width: p.width, height: p.height }));
      }
      const data = new core.SkeletonJson(new core.AtlasAttachmentLoader(atlas)).readSkeletonData(readFileSync(join(dir, j), 'utf8'));
      const sk = new core.Skeleton(data);
      if (!data.defaultSkin && data.skins.length) sk.setSkin(data.skins[0]);
      for (const a of data.animations) { const st = new core.AnimationState(new core.AnimationStateData(data)); st.setAnimation(0, a.name, false); for (let t = 0; t < a.duration + 0.05; t += 1 / 60) { st.update(1 / 60); st.apply(sk); sk.updateWorldTransform(); } }
      const ed = JSON.parse(readFileSync(join(root, 'spine-editor', name + '.json'), 'utf8'));
      if (ed.skeleton.images !== './') bad.push(`${name}: editor json images path`);
      for (const r of atlas.regions) if (!existsSync(join(root, 'spine-editor', r.name + '.png'))) bad.push(`${name}: editor image ${r.name}`);
    } catch (e) { bad.push(`${name}: ${e.message}`); }
  }
  ok('every zipped spine parses, plays, has matching pages and editor images', !bad.length, bad.slice(0, 6).join(' | '));
  ok('README and settings in zip', existsSync(join(root, 'README.txt')) && existsSync(join(root, 'kit-settings.json')));

  await ev(`document.getElementById('tab-check')?.click(), true`);
  const doc = await send('DOM.getDocument');
  const q = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#ck-files' });
  await send('DOM.setFileInputFiles', { nodeId: q.result.nodeId, files: ['animation_reels_frame_above.json', 'animation_reels_frame_above.atlas', 'animation_reels_frame_above.png'].map(f => join(dir, f)) });
  await sleep(800);
  const verdict = await ev(`document.getElementById('ck-verdict').textContent + ' | ' + document.getElementById('ck-findings').textContent`);
  ok('checker passes a generated draft', /Готово/.test(verdict), verdict);
  const broken = JSON.parse(readFileSync(join(dir, 'animation_reels_frame_above.json'), 'utf8'));
  delete broken.animations.out;
  broken.skeleton.spine = '4.2.10';
  writeFileSync(join(OUT, 'animation_reels_frame_above.json'), JSON.stringify(broken));
  await send('DOM.setFileInputFiles', { nodeId: q.result.nodeId, files: [join(OUT, 'animation_reels_frame_above.json')] });
  await sleep(800);
  const v2 = await ev(`document.getElementById('ck-verdict').textContent + ' | ' + document.getElementById('ck-findings').textContent`);
  ok('checker catches a wrong version and a missing animation', /помилк/.test(v2) && /4\.2\.10/.test(v2) && /out/.test(v2), v2.slice(0, 200));
  await shot('check');
  await ev(`document.getElementById('tab-drafts')?.click(), true`);
  await sleep(500);
  const d2 = await send('DOM.getDocument');
  const fa = await send('DOM.querySelector', { nodeId: d2.result.root.nodeId, selector: '[data-id="frame_above"] input[type="file"]' });
  await send('DOM.setFileInputFiles', { nodeId: fa.result.nodeId, files: [join(root, 'spine-editor/art/reels/frame_above.png')] });
  await sleep(1200);
  const note = await ev(`(document.querySelector('[data-id="frame_above"] .img-row .note') || {}).textContent || ''`);
  ok('uploaded frame finds its transparent window', /вікно \d+×\d+ px/.test(note), note);
  const d3 = await send('DOM.getDocument');
  const si = await send('DOM.querySelector', { nodeId: d3.result.root.nodeId, selector: '[data-id="symbols"] .img-row input[type="file"]' });
  const before = await ev(`[...document.querySelectorAll('.tile:not(.add)')].length`);
  await send('DOM.setFileInputFiles', { nodeId: si.result.nodeId, files: [join(root, 'spine-editor/art/reels/high_1.png')] });
  await sleep(1200);
  const after = JSON.parse(await ev(`JSON.stringify({ n: [...document.querySelectorAll('.tile:not(.add)')].length, sel: (document.querySelector('.tile[aria-pressed="true"] span') || {}).textContent, btn: [...document.querySelectorAll('.sym-edit .btn')].map(b => b.textContent).join('/') })`));
  ok('symbol PNG lands on the matching symbol', after.n === before && after.sel === 'high_1' && /Прибрати картинку/.test(after.btn), JSON.stringify(after));
  s = await snap();
  ok('still no warnings after uploads', !s.warns, s.warns);
  await shot('uploads');

  await send('Page.reload');
  await sleep(5000);
  await ev(`[...document.querySelectorAll('.tile')].find(t => t.textContent.startsWith('high_1')).click(), true`);
  await sleep(300);
  const kept = JSON.parse(await ev(`JSON.stringify({ btn: [...document.querySelectorAll('.sym-edit .btn')].map(b => b.textContent).join('/'), cards: document.querySelectorAll('#c-list .comp').length, grid: document.getElementById('grid-label').textContent, note: (document.querySelector('[data-id="frame_above"] .img-row .note') || {}).textContent || '' })`));
  ok('project survives a reload with its images', /Прибрати картинку/.test(kept.btn) && kept.cards === 5 && kept.grid.startsWith('6 × 4'), JSON.stringify(kept));
}

await ev(`(() => { const b = document.querySelector('[data-id="frame_above"] .comp-open'); if (b.getAttribute('aria-expanded') !== 'true') b.click(); return true; })()`);
await sleep(300);
const keys = JSON.parse(await ev(`JSON.stringify([...new Set([...document.querySelectorAll('[data-info]')].map(b => b.dataset.info))])`));
const withArt = ['grid', 'cell', 'components', 'symbols', 'anims', 'motion', 'loop', 'events', 'skins', 'spacers', 'reels', 'frame_under', 'frame_above', 'custom', 'download'];
const infoBad = [];
for (const k of keys) {
  await ev(`document.querySelector('[data-info="${k}"]').click(), true`);
  await sleep(160);
  const r = JSON.parse(await ev(`JSON.stringify({ open: document.getElementById('info-dlg').open, title: document.getElementById('dlg-title').textContent, art: document.querySelectorAll('#dlg-art svg, #dlg-art .demos, #dlg-art .tree').length, text: document.getElementById('dlg-text').textContent.length })`));
  if (!r.open || !r.title || r.text < 20 || (withArt.includes(k) && !r.art)) infoBad.push(k + JSON.stringify(r));
  if (['reels', 'motion', 'skins'].includes(k)) await shot('info-' + k);
  await ev(`document.getElementById('dlg-close').click(), true`);
  await sleep(60);
}
ok('every info popup opens with text and art', !infoBad.length && keys.length >= 20, keys.length + ' keys ' + infoBad.join(' | '));
ok('dialog closes', !(await ev(`document.getElementById('info-dlg').open`)));

const sb = async () => JSON.parse(await ev(`JSON.stringify({ items: [...document.querySelectorAll('#plist .p-name')].map(n => n.textContent), active: (document.querySelector('.pitem.active .p-name') || {}).textContent, wiz: !document.getElementById('wizard').hidden, grid: document.getElementById('grid-label').textContent, crumb: document.getElementById('crumb').textContent })`));
let b = await sb();
ok('sidebar lists the example project', b.items.length === 1 && b.active === 'example-slot', JSON.stringify(b));
await ev(`document.getElementById('new-project').click(), true`);
await sleep(800);
b = await sb();
const next = () => ev(`document.getElementById('wz-next').click(), true`);
ok('wizard opens on step 1 with Next locked', b.wiz && await ev(`document.getElementById('wz-next').disabled`), JSON.stringify(b));
await shot('wizard-1');
await ev(`(() => { const i = document.getElementById('wz-name'); i.value = 'test-slot'; i.dispatchEvent(new Event('input')); return true; })()`);
await next(); await sleep(200);
await ev(`[...document.querySelectorAll('.wizard .gtile')].find(t => t.textContent === '6×5').click(), true`);
await sleep(500);
await shot('wizard-2');
await next(); await sleep(200);
await ev(`[...document.querySelectorAll('.wizard .gtile')].find(t => t.textContent.startsWith('300×300')).click(), true`);
await sleep(300);
await shot('wizard-3');
await next(); await sleep(200);
await ev(`document.querySelector('[aria-label="Більше high"]').click(), true`);
await sleep(300);
const names = await ev(`[...document.querySelectorAll('#wz-names span')].map(s => s.textContent).join(',')`);
ok('symbol counts drive the names', /high_5/.test(names) && /low_5/.test(names) && /wild_1/.test(names), names);
await shot('wizard-4');
await next(); await sleep(200);
await ev(`[...document.querySelectorAll('.wz-comp')].find(l => l.textContent.includes('Фон')).querySelector('input').click(), true`);
await shot('wizard-5');
await next();
await sleep(1200);
b = await sb();
s = await snap();
ok('wizard creates the project', !b.wiz && b.items.length === 2 && b.active === 'test-slot' && b.crumb === 'test-slot' && b.grid === '6 × 5 · 300 × 300 px', JSON.stringify(b));
ok('created project has the chosen parts', s.cards === 5 && ['animation_bg', 'animation_reels_6_columns', 'animation_reel_5_rows', 'animation_symbol_high_5'].every(n => s.spines.includes(n)) && !s.warns, s.spines.length + ' ' + s.warns);
await shot('after-wizard');

await send('Page.reload');
await sleep(5000);
b = await sb();
ok('projects persist across reloads and the last one reopens', b.items.length === 2 && b.active === 'test-slot' && b.grid.startsWith('6 × 5'), JSON.stringify(b));
await ev(`[...document.querySelectorAll('.p-open')].find(x => x.textContent.includes('example-slot')).click(), true`);
await sleep(1200);
b = await sb();
ok('switching projects swaps the settings', b.active === 'example-slot' && b.grid.startsWith('6 × 4'), JSON.stringify(b));
await ev(`document.getElementById('new-project').click(), true`);
await sleep(700);
await ev(`[...document.querySelectorAll('.wizard .btn')].find(x => x.textContent === 'Скасувати').click(), true`);
await sleep(1200);
b = await sb();
ok('cancel removes the draft and returns', !b.wiz && b.items.length === 2 && b.active === 'example-slot', JSON.stringify(b));
const gameShown = async () => JSON.parse(await ev(`JSON.stringify({ hidden: document.getElementById('game').hidden, h: document.getElementById('game').getBoundingClientRect().height, pressed: document.querySelector('.p-set').getAttribute('aria-pressed') })`));
let gs = await gameShown();
ok('game settings stay hidden until the gear', gs.hidden && gs.h === 0 && gs.pressed === 'false', JSON.stringify(gs));
await ev(`document.querySelector('.p-set').click(), true`);
await sleep(300);
gs = await gameShown();
ok('the gear opens the game settings', !gs.hidden && gs.h > 100 && gs.pressed === 'true', JSON.stringify(gs));
await shot('game-open');
await ev(`document.querySelector('.p-set').click(), true`);
await sleep(300);
gs = await gameShown();
ok('the gear closes them again', gs.hidden && gs.pressed === 'false', JSON.stringify(gs));
await ev(`[...document.querySelectorAll('.p-act .btn')].find(x => x.getAttribute('aria-label') === 'Копія').click(), true`);
await sleep(1200);
b = await sb();
ok('copy duplicates the project', b.items.length === 3 && b.active === 'example-slot-copy', JSON.stringify(b));
await ev(`[...document.querySelectorAll('.p-act .btn')].find(x => x.getAttribute('aria-label') === 'Видалити').click(), true`);
await sleep(200);
await ev(`[...document.querySelectorAll('.p-confirm .btn')].find(x => x.textContent === 'Так').click(), true`);
await sleep(1200);
b = await sb();
ok('delete asks first and removes', b.items.length === 2 && !b.items.includes('example-slot-copy'), JSON.stringify(b));

await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
await sleep(800);
await ev(`scrollTo(0, 0), true`);
await shot('desktop-dark');
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 860, deviceScaleFactor: 1, mobile: true });
await sleep(1200);
s = await snap();
const wide = await ev(`JSON.stringify([...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > innerWidth + 1; }).slice(0, 5).map(e => e.tagName + '.' + e.className))`);
ok('no horizontal scroll at 390 px', s.sw <= s.iw, `${s.sw} vs ${s.iw} ${wide}`);
await shot('mobile');
const phoneDd = JSON.parse(await ev(`JSON.stringify((() => { const b = document.getElementById('pv-spine-btn'); b.scrollIntoView({ block: 'center' }); return true; })())`));
await sleep(200);
await ev(`document.getElementById('pv-spine-btn').click(), true`);
const phonePop = JSON.parse(await ev(`JSON.stringify((() => { const r = document.getElementById('dd-pop').getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, iw: innerWidth, ih: innerHeight }; })())`));
ok('phone: dropdown fits the viewport', phoneDd && phonePop.l >= 16 && phonePop.r <= phonePop.iw - 16 && phonePop.t >= 0 && phonePop.b <= phonePop.ih, JSON.stringify(phonePop));
await sleep(300);
await shot('mobile-dropdown');
await ev(`document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })), true`);
const drawerOff = JSON.parse(await ev(`JSON.stringify({ btn: getComputedStyle(document.getElementById('menu-btn')).display, left: document.getElementById('sidebar').getBoundingClientRect().right })`));
await ev(`document.getElementById('menu-btn').click(), true`);
await sleep(500);
const drawerOn = await ev(`document.getElementById('sidebar').getBoundingClientRect().left`);
ok('phone: projects live in a drawer', drawerOff.btn !== 'none' && drawerOff.left <= 0 && drawerOn >= 0, JSON.stringify({ drawerOff, drawerOn }));
await shot('mobile-drawer');
await ev(`document.getElementById('scrim').click(), true`);
await sleep(400);
await ev(`document.querySelector('#c-list').scrollIntoView(), true`);
await sleep(300);
await shot('mobile-comps');

ok('no console errors, exceptions or blocked loads', !problems.length, problems.slice(0, 6).join(' | '));
console.log(results.join('\n'));
ws.close();
chrome.kill();
process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
