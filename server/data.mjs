import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, existsSync, appendFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

export const KIT = 'spine-draft-kit/server@1';
export const ID = /^[A-Za-z0-9_-]{1,64}$/;
export const SHA = /^[0-9a-f]{64}$/;
export const MIME = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };

export function writeAtomic(path, data) {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

export const sha256 = buf => createHash('sha256').update(buf).digest('hex');

export function imageInfo(b) {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a) return { type: 'png', w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b.length > 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const kind = b.toString('ascii', 12, 16);
    if (kind === 'VP8 ') return { type: 'webp', w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L') { const v = b.readUInt32LE(21); return { type: 'webp', w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
    if (kind === 'VP8X') return { type: 'webp', w: b.readUIntLE(24, 3) + 1, h: b.readUIntLE(27, 3) + 1 };
    return null;
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { type: 'jpeg', w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
      i += 2 + b.readUInt16BE(i + 2);
    }
    return { type: 'jpeg', w: 0, h: 0 };
  }
  return null;
}

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (b, s, e) => { let c = -1; for (let i = s; i < e; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };

const pngOk = b => {
  let i = 8, first = true, idat = false;
  while (i + 12 <= b.length) {
    const len = b.readUInt32BE(i);
    const type = b.toString('latin1', i + 4, i + 8);
    if (len > 0x7fffffff || i + 12 + len > b.length || !/^[A-Za-z]{4}$/.test(type)) return false;
    if (first && (type !== 'IHDR' || len !== 13)) return false;
    if (crc32(b, i + 4, i + 8 + len) !== b.readUInt32BE(i + 8 + len)) return false;
    first = false;
    if (type === 'IDAT') idat = true;
    i += 12 + len;
    if (type === 'IEND') return idat && i === b.length;
  }
  return false;
};

export function imageCheck(b, maxSide = 8192) {
  const info = imageInfo(b);
  if (!info) return { code: 415, error: 'лише PNG, JPEG або WebP' };
  if (info.type === 'png' && !pngOk(b)) return { code: 415, error: 'пошкоджений або підроблений PNG' };
  if (info.type === 'webp' && b.readUInt32LE(4) + 8 !== b.length && b.readUInt32LE(4) + 9 !== b.length) return { code: 415, error: 'пошкоджений WebP' };
  if (!(info.w > 0 && info.h > 0)) return { code: 415, error: 'не вдалося прочитати розмір картинки' };
  if (info.w > maxSide || info.h > maxSide) return { code: 413, error: `картинка більша за ${maxSide}×${maxSide}` };
  return { info };
}

const plain = x => !!x && typeof x === 'object' && !Array.isArray(x);

export function textInfo(b) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { return null; }
  try { const d = JSON.parse(text); if (plain(d) && plain(d.skeleton)) return { type: 'json' }; } catch { }
  const lines = text.split(/\r\n|\r|\n/);
  const first = lines.find(l => l.trim());
  if (first && /\.(png|jpe?g|webp)$/i.test(first.trim()) && lines.some(l => /^\s*size\s*:/.test(l))) return { type: 'atlas' };
  return null;
}

export function blobCheck(b, maxSide = 8192) {
  if (imageInfo(b)) return imageCheck(b, maxSide);
  const t = textInfo(b);
  return t ? { info: { type: t.type, w: 0, h: 0 } } : { code: 415, error: 'лише PNG, JPEG, WebP, Spine JSON або атлас' };
}

const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

export function lockInfo(dir) {
  const f = join(dir, '.lock');
  if (!existsSync(f)) return null;
  const pid = Number(readFileSync(f, 'utf8'));
  return pid && pid !== process.pid && alive(pid) ? pid : null;
}

export function openData(dir) {
  for (const d of ['projects', 'blobs', 'auth']) mkdirSync(join(dir, d), { recursive: true });
  const projects = new Map();
  const timers = new Map();
  const pdir = id => join(dir, 'projects', id);

  const readJson = (f, dflt) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return dflt; } };

  for (const name of readdirSync(join(dir, 'projects'))) {
    if (!ID.test(name)) continue;
    const doc = readJson(join(pdir(name), 'doc.json'), null);
    if (!doc || doc.id !== name) continue;
    let entries = [];
    try { entries = readFileSync(join(pdir(name), 'history.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { entries = []; }
    projects.set(name, { doc, entries });
  }

  const writeDoc = id => {
    clearTimeout(timers.get(id));
    timers.delete(id);
    const p = projects.get(id);
    if (p) writeAtomic(join(pdir(id), 'doc.json'), JSON.stringify(p.doc));
  };

  const blobPath = sha => join(dir, 'blobs', sha.slice(0, 2), sha);

  return {
    dir,
    lock() {
      const pid = lockInfo(dir);
      if (pid) throw new Error(`DATA_DIR зайнятий процесом ${pid} (${join(dir, '.lock')})`);
      writeFileSync(join(dir, '.lock'), String(process.pid));
    },
    unlock() { try { if (Number(readFileSync(join(dir, '.lock'), 'utf8')) === process.pid) rmSync(join(dir, '.lock')); } catch { return; } },
    ids: () => [...projects.keys()],
    project: id => projects.get(id) || null,
    create(doc, entries) {
      mkdirSync(join(pdir(doc.id), 'snaps'), { recursive: true });
      projects.set(doc.id, { doc, entries: [] });
      writeDoc(doc.id);
      return projects.get(doc.id);
    },
    touch(id) {
      if (timers.has(id)) return;
      timers.set(id, setTimeout(() => writeDoc(id), 500));
    },
    writeDoc,
    addEntry(id, entry, snapJson) {
      const p = projects.get(id);
      if (!p) return;
      const f = join(pdir(id), 'snaps', `${entry.v}.json.gz`);
      mkdirSync(join(pdir(id), 'snaps'), { recursive: true });
      if (snapJson && !existsSync(f)) writeAtomic(f, gzipSync(snapJson));
      appendFileSync(join(pdir(id), 'history.jsonl'), JSON.stringify(entry) + '\n');
      p.entries.push(entry);
    },
    readSnap(id, v) {
      try { return JSON.parse(gunzipSync(readFileSync(join(pdir(id), 'snaps', `${v}.json.gz`))).toString('utf8')); } catch { return null; }
    },
    blobHas: sha => typeof sha === 'string' && SHA.test(sha) && existsSync(blobPath(sha)),
    blobPut(buf) {
      const sha = sha256(buf);
      const f = blobPath(sha);
      if (!existsSync(f)) { mkdirSync(join(dir, 'blobs', sha.slice(0, 2)), { recursive: true }); writeAtomic(f, buf); }
      return sha;
    },
    blobGet(sha) {
      if (typeof sha !== 'string' || !SHA.test(sha)) return null;
      try { return readFileSync(blobPath(sha)); } catch { return null; }
    },
    blobSize(sha) { try { return statSync(blobPath(sha)).size; } catch { return -1; } },
    readJson: name => readJson(join(dir, name), null),
    writeJson: (name, data) => writeAtomic(join(dir, name), JSON.stringify(data)),
    flush() { for (const id of [...timers.keys()]) writeDoc(id); }
  };
}
