#!/usr/bin/env node
import { readFileSync, readdirSync, statSync, openSync, readSync, closeSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, extname, basename, relative, dirname } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { TOOLS, INSTRUCTIONS, listTools } from './server/tools.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.SPINE_KIT_PORT) || 5180;
const BASE = `http://127.0.0.1:${PORT}`;
const PAGE = `http://localhost:${PORT}/?connect=1`;
const DATA = process.env.SPINE_KIT_DATA || join(HERE, 'projects');
const VERSION = '1.0.0';
const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const IMAGE_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const SKIP_DIRS = new Set(['node_modules', '.git', '.idea', '.vscode', 'dist', '.trash']);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => process.stderr.write(`[spine-draft-kit] ${a.join(' ')}\n`);

async function api(path, opts = {}) {
  const r = await fetch(BASE + path, opts);
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text }; }
  return { status: r.status, data };
}

async function serverInfo() {
  try { const r = await api('/api/info'); return r.status === 200 ? r.data : null; } catch { return null; }
}

async function bridge(tool, args, timeout) {
  let r;
  try { r = await api('/api/bridge/call', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tool, args, timeout }) }); }
  catch { throw new Error(`Сервер кита не запущений на ${BASE}. Виклич open_kit або запусти npm run dev у ${HERE}.`); }
  if (!r.data.ok) throw new Error(r.data.error || 'kit error');
  return r.data.result;
}

async function uploadFile(path) {
  const p = resolve(path);
  const type = IMAGE_EXT[extname(p).toLowerCase()];
  if (!type) throw new Error(`Не картинка (потрібен PNG / JPEG / WebP): ${p}`);
  if (!existsSync(p)) throw new Error(`Файл не знайдено: ${p}`);
  const r = await api(`/api/bridge/blobs?name=${encodeURIComponent(basename(p))}`, { method: 'PUT', headers: { 'content-type': type }, body: readFileSync(p) });
  if (!r.data.id) throw new Error(r.data.error || 'upload failed');
  return { blob: r.data.id, name: basename(p), path: p };
}

async function prepare(tool, args) {
  const a = JSON.parse(JSON.stringify(args || {}));
  if (tool === 'import_layouts') return { mode: a.mode, files: layoutFiles(a.paths) };
  if (tool === 'import_component') return { name: a.name, file: await uploadComponent(a.path) };
  if (typeof a.image === 'string' && a.image) a.image = await uploadFile(a.image);
  if (tool === 'set_symbols') for (const s of a.symbols || []) {
    if (typeof s.image === 'string' && s.image) s.image = await uploadFile(s.image);
    if (typeof s.blur_image === 'string' && s.blur_image) s.blur_image = await uploadFile(s.blur_image);
  }
  if (Array.isArray(a.parts)) for (const p of a.parts) if (p && typeof p.image === 'string' && p.image) p.image = await uploadFile(p.image);
  return a;
}

async function uploadComponent(path) {
  if (typeof path !== 'string' || !path) throw new Error('path: шлях до .component.json');
  const p = resolve(path);
  if (!existsSync(p) || !statSync(p).isFile()) throw new Error(`Файл не знайдено: ${p}`);
  if (statSync(p).size > 200 * 1024 * 1024) throw new Error(`Завеликий файл: ${p}`);
  const r = await api(`/api/bridge/blobs?name=${encodeURIComponent(basename(p))}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: readFileSync(p) });
  if (!r.data.id) throw new Error(r.data.error || 'upload failed');
  return { blob: r.data.id, name: basename(p), path: p };
}

async function exportComponent(args) {
  const r = await bridge('export_component', { id: args.id }, 120000);
  const want = args.path ? resolve(args.path) : join(DATA, 'components');
  const file = /\.json$/i.test(want) ? want : join(want, r.name);
  mkdirSync(dirname(file), { recursive: true });
  const res = await fetch(`${BASE}/api/bridge/blobs/${r.blob}`);
  if (!res.ok) throw new Error('файл не дійшов від сторінки');
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return { file, bytes: statSync(file).size, spine: r.spine, parts: r.parts, anims: r.anims, images: r.images };
}

function layoutFiles(paths) {
  const list = (Array.isArray(paths) ? paths : [paths]).filter(p => typeof p === 'string' && p);
  if (!list.length) throw new Error('paths порожній: дай шляхи до layout_*.json або до папки з ними');
  const files = [];
  for (const p of list.map(x => resolve(x))) {
    if (!existsSync(p)) throw new Error(`Немає: ${p}`);
    const found = statSync(p).isDirectory() ? readdirSync(p).filter(n => /\.json$/i.test(n) && !n.startsWith('.')).sort().map(n => join(p, n)) : [p];
    for (const f of found) {
      if (statSync(f).size > 32 * 1024 * 1024) throw new Error(`Завеликий файл: ${f}`);
      files.push({ name: basename(f), path: f, text: readFileSync(f, 'utf8') });
    }
  }
  if (!files.length) throw new Error(`JSON-файлів немає: ${list.join(', ')}`);
  return files;
}

function imageSize(path) {
  const fd = openSync(path, 'r');
  const buf = Buffer.alloc(65536);
  const n = readSync(fd, buf, 0, buf.length, 0);
  closeSync(fd);
  const b = buf.subarray(0, n);
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b.length > 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const kind = b.toString('ascii', 12, 16);
    if (kind === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L') { const v = b.readUInt32LE(21); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
    if (kind === 'VP8X') return { w: b.readUIntLE(24, 3) + 1, h: b.readUIntLE(27, 3) + 1 };
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return null;
}

function guess(rel) {
  const n = basename(rel, extname(rel)).toLowerCase();
  const p = rel.toLowerCase();
  const blur = /blur/.test(n);
  const base = n.replace(/^animation_symbol_|^symbol_|^sym_/, '').replace(/[_-]?blur(red)?$/, '');
  if (/wild/.test(n)) return { kind: 'symbol', group: 'wild', name: base, blur };
  if (/scatter|bonus/.test(n)) return { kind: 'symbol', group: 'scatter', name: base, blur };
  if (/^(h|hi|high|hp)[_-]?\d+$/.test(base) || /high/.test(n)) return { kind: 'symbol', group: 'high', name: base, blur };
  if (/^(l|lo|low|lp)[_-]?\d+$/.test(base) || /low/.test(n) || /^(ace|king|queen|jack|ten|nine|a|k|q|j|10|9)$/.test(base)) return { kind: 'symbol', group: 'low', name: base, blur };
  if (/notification|info.?(panel|banner|bar)/.test(n)) return { kind: 'infopanel' };
  if (/frame|border|reel.?bg|reels.?bg/.test(n)) return { kind: /above|over|top|front|fg/.test(n) ? 'frame_above' : /under|below|back|bg/.test(n) ? 'frame_under' : 'frame' };
  if (/logo/.test(n)) return { kind: 'logo' };
  if (/popup|pop_up|big.?win|mega|epic|congrat|intro|outro|banner/.test(n)) return { kind: 'popup' };
  if (/background|^bg|_bg|bg_/.test(n)) return { kind: 'background' };
  if (/symbol/.test(p)) return { kind: 'symbol', group: 'other', name: base, blur };
  return { kind: 'unknown' };
}

function scanArt({ dir, max_depth }) {
  const root = resolve(dir);
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`Папки немає: ${root}`);
  const depth = Number(max_depth) || 5;
  const images = [];
  const other = [];
  const walk = (d, level) => {
    if (level > depth || images.length > 3000) return;
    let list;
    try { list = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      if (e.name.startsWith('.')) continue;
      const full = join(d, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(full, level + 1); continue; }
      const ext = extname(e.name).toLowerCase();
      const rel = relative(root, full);
      if (IMAGE_EXT[ext]) {
        let size = null;
        try { size = imageSize(full); } catch { size = null; }
        images.push({ path: full, rel, w: size && size.w, h: size && size.h, bytes: statSync(full).size, guess: guess(rel) });
      } else if (['.psd', '.psb', '.spine', '.json', '.atlas', '.ai', '.svg'].includes(ext)) other.push(rel);
    }
  };
  walk(root, 0);
  const counts = {};
  for (const i of images) { const k = i.guess.kind === 'symbol' ? `symbol:${i.guess.group}` : i.guess.kind; counts[k] = (counts[k] || 0) + 1; }
  return { root, total: images.length, counts, images, other_files: other.slice(0, 200) };
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref();
}

async function openKit() {
  let info = await serverInfo();
  let started = false;
  if (!info) {
    mkdirSync(DATA, { recursive: true });
    const out = openSync(join(DATA, '.kit-server.log'), 'a');
    spawn(process.execPath, [join(HERE, 'dev.mjs')], { cwd: HERE, detached: true, stdio: ['ignore', out, out], env: { ...process.env, PORT: String(PORT), SPINE_KIT_DATA: DATA } }).unref();
    started = true;
    for (let i = 0; i < 40 && !info; i++) { await sleep(250); info = await serverInfo(); }
    if (!info) throw new Error(`Сервер не стартував. Лог: ${join(DATA, '.kit-server.log')}`);
  }
  if (!info.page) {
    openBrowser(PAGE);
    for (let i = 0; i < 60 && !info.page; i++) { await sleep(500); info = await serverInfo() || info; }
  }
  return { server: started ? 'started' : 'running', url: `http://localhost:${PORT}`, page_connected: !!info.page, projects_dir: info.projectsDir, note: info.page ? 'Кит підключений.' : 'Сторінка відкрита, але ще не підключилась: попроси користувача натиснути Connect у кіті.' };
}

async function kitStatus() {
  const info = await serverInfo();
  if (!info) return { server: false, url: `http://localhost:${PORT}`, hint: 'Сервер кита не запущений: виклич open_kit.' };
  const out = { server: true, url: `http://localhost:${PORT}`, projects_dir: info.projectsDir, page_connected: info.page };
  if (info.page) out.kit = await bridge('status', {}, 15000);
  else out.hint = 'Сторінка кита не підключена: виклич open_kit або попроси натиснути Connect.';
  return out;
}

async function exportDrafts(args) {
  const r = await bridge('export_drafts', { layouts: args.layouts }, 300000);
  const dir = resolve(args.out_dir || join(DATA, 'exports'));
  mkdirSync(dir, { recursive: true });
  const res = await fetch(`${BASE}/api/bridge/blobs/${r.blob}`);
  if (!res.ok) throw new Error('zip не дійшов від сторінки');
  const file = join(dir, r.name);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  const out = { zip: file, spines: r.spines, layouts: r.layouts, bytes: statSync(file).size };
  if (args.unzip) {
    const u = spawnSync('unzip', ['-o', '-q', file, '-d', dir], { encoding: 'utf8' });
    out.extracted = u.status === 0 ? join(dir, r.name.replace(/\.zip$/, '')) : `unzip failed: ${u.stderr || u.status}`;
  }
  return out;
}

function content(result) {
  const parts = [];
  const shots = result && Array.isArray(result.images) && result.images.length && result.images.every(s => s && s.data) ? result.images : [];
  const rest = result && typeof result === 'object' && !Array.isArray(result) ? { ...result } : result;
  if (shots.length) delete rest.images;
  parts.push({ type: 'text', text: typeof rest === 'string' ? rest : JSON.stringify(rest, null, 1) });
  for (const s of shots) parts.push({ type: 'image', data: s.data, mimeType: s.mime || 'image/png' });
  return parts;
}

async function runTool(name, args) {
  const t = TOOLS.find(x => x.name === name);
  if (!t) throw new Error(`Unknown tool ${name}`);
  if (name === 'kit_status') return kitStatus();
  if (name === 'open_kit') return openKit();
  if (name === 'scan_art') return scanArt(args || {});
  if (name === 'export_drafts') return exportDrafts(args || {});
  if (name === 'export_component') return exportComponent(args || {});
  return bridge(name, await prepare(name, args), t.timeout || 90000);
}

let clientName = 'Claude';
let presenceOn = false;
async function presence() {
  if (presenceOn) return;
  presenceOn = true;
  for (;;) {
    try {
      const r = await fetch(`${BASE}/api/bridge/agent?name=${encodeURIComponent(clientName)}`);
      if (r.ok && r.body) for await (const chunk of r.body) void chunk;
    } catch { }
    await sleep(2500);
  }
}

const write = msg => process.stdout.write(JSON.stringify(msg) + '\n');
const reply = (id, result) => write({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => write({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    const want = params && params.protocolVersion;
    if (params && params.clientInfo && params.clientInfo.name) clientName = params.clientInfo.name;
    presence();
    return reply(id, {
      protocolVersion: PROTOCOLS.includes(want) ? want : PROTOCOLS[0],
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'spine-draft-kit', title: 'Spine Draft Kit', version: VERSION },
      instructions: INSTRUCTIONS
    });
  }
  if (method === 'ping') return reply(id, {});
  if (method === 'tools/list') {
    return reply(id, {
      tools: listTools(TOOLS)
    });
  }
  if (method === 'tools/call') {
    try { return reply(id, { content: content(await runTool(params.name, params.arguments)) }); }
    catch (e) { return reply(id, { content: [{ type: 'text', text: e.message }], isError: true }); }
  }
  if (id === undefined || id === null) return;
  fail(id, -32601, `Method not found: ${method}`);
}

const rl = createInterface({ input: process.stdin });
rl.on('line', line => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return fail(null, -32700, 'Parse error'); }
  for (const m of Array.isArray(msg) ? msg : [msg]) handle(m).catch(e => { log(e.stack || e.message); if (m.id !== undefined) fail(m.id, -32603, e.message); });
});
rl.on('close', () => process.exit(0));
log(`ready, kit ${BASE}`);
