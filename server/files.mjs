import { randomBytes, createHash } from 'node:crypto';
import { readBody } from './auth.mjs';
import { imageCheck, MIME } from './data.mjs';

const MB = 1024 * 1024;
const LINK_TTL = 15 * 60 * 1000;
const REF_TTL = 60 * 60 * 1000;
const IMG = /\.(png|jpe?g|webp)$/i;

const hash = s => createHash('sha256').update(s).digest('hex');
const kindOf = name => IMG.test(name) ? 'image' : /\.component\.json$/i.test(name) ? 'component' : /\.json$/i.test(name) ? 'layout' : /\.atlas(\.txt)?$/i.test(name) ? 'atlas' : null;
const cleanName = n => String(n || '').split(/[\\/]/).pop().replace(/[\x00-\x1f"'`]/g, '').slice(0, 200);
const q = s => "'" + String(s).replace(/'/g, "'\\''") + "'";

export function createFiles({ data, publicUrl, maxImageMb = 64, log, limiter }) {
  const origin = new URL(publicUrl).origin;
  const maxImage = maxImageMb * MB;
  const LIMIT = { image: maxImage, layout: 32 * MB, component: 200 * MB, atlas: 16 * MB };
  const ups = new Map();
  const refs = new Map();
  const downs = new Map();
  const rate = limiter ? limiter(300 / 600, 300) : () => 0;

  const sweep = () => {
    const now = Date.now();
    for (const [k, u] of ups) if (u.exp < now) ups.delete(k);
    for (const [k, r] of refs) if (r.exp < now) refs.delete(k);
    for (const [k, d] of downs) if (d.exp < now) downs.delete(k);
  };
  setInterval(sweep, 60000).unref();

  const json = (res, code, d) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(d));
  };

  const issue = (owner, list) => {
    sweep();
    const items = Array.isArray(list) ? list : [];
    if (!items.length) throw new Error('files: дай список [{name}]');
    if (items.length > 200) throw new Error('files: не більше 200 за раз');
    const out = items.map(it => {
      const name = cleanName(it && it.name);
      const kind = kindOf(name);
      if (!name || !kind) throw new Error(`${name || '?'}: лише PNG, JPEG, WebP, layout_*.json, Spine JSON, .atlas або .component.json`);
      const t = randomBytes(32).toString('base64url');
      const id = randomBytes(12).toString('base64url');
      ups.set(hash(t), { id, owner: owner.email, name, kind, exp: Date.now() + LINK_TTL });
      return { name, ref: 'upload:' + id, url: `${origin}/u/${t}`, path: typeof it.path === 'string' && it.path ? it.path : null };
    });
    const curl = 'curl -fsS ' + out.map(f => `-T ${q(f.path || `<local path of ${f.name}>`)} ${q(f.url)}`).join(' ');
    return { files: out.map(({ path, ...f }) => f), expires_in: LINK_TTL / 1000, curl, note: 'Run the curl once (it uploads every file). Then pass the refs. Links work once, for 15 minutes.' };
  };

  const upload = async (req, res, t) => {
    const u = ups.get(hash(t));
    if (req.method !== 'PUT') { res.setHeader('allow', 'PUT'); return json(res, 405, { error: 'лише PUT' }); }
    if (!u || u.exp < Date.now()) return json(res, 404, { error: 'посилання недійсне або застаріло: виклич upload_files ще раз' });
    ups.delete(hash(t));
    const wait = rate(u.owner);
    if (wait) { res.setHeader('retry-after', String(wait)); return json(res, 429, { error: 'забагато завантажень' }); }
    const limit = LIMIT[u.kind];
    if (Number(req.headers['content-length']) > limit) return json(res, 413, { error: `${u.name}: більше ${Math.round(limit / MB)} МБ` });
    let buf;
    try { buf = await readBody(req, limit); }
    catch (e) { if (e.code === 413) return json(res, 413, { error: `${u.name}: більше ${Math.round(limit / MB)} МБ` }); throw e; }
    const ref = { owner: u.owner, name: u.name, kind: u.kind, exp: Date.now() + REF_TTL };
    if (u.kind === 'image') {
      const c = imageCheck(buf, 8192);
      if (c.error) return json(res, c.code, { error: `${u.name}: ${c.error}` });
      ref.sha = data.blobPut(buf);
      ref.type = MIME[c.info.type];
      ref.w = c.info.w;
      ref.h = c.info.h;
      ref.bytes = buf.length;
    } else if (u.kind === 'atlas') {
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return json(res, 415, { error: `${u.name}: не текст UTF-8` }); }
      if (!text.trim()) return json(res, 415, { error: `${u.name}: порожній файл` });
      ref.buf = buf;
      ref.type = 'text/plain';
      ref.bytes = buf.length;
    } else {
      let parsed;
      try { parsed = JSON.parse(buf.toString('utf8').replace(/^﻿/, '')); } catch { return json(res, 415, { error: `${u.name}: не JSON` }); }
      if (!parsed || typeof parsed !== 'object') return json(res, 415, { error: `${u.name}: не обʼєкт JSON` });
      ref.buf = buf;
      ref.type = 'application/json';
      ref.bytes = buf.length;
    }
    refs.set(u.id, ref);
    if (log) log.audit('file.upload', { email: u.owner, name: u.name, kind: u.kind, bytes: buf.length });
    json(res, 200, { ok: true, ref: 'upload:' + u.id, name: u.name, bytes: buf.length });
  };

  const resolve = (owner, value, want) => {
    const m = /^upload:([A-Za-z0-9_-]{8,64})$/.exec(String(value || ''));
    if (!m) throw new Error(`«${String(value).slice(0, 120)}» — не ref. Сервер не бачить локальних шляхів: виклич upload_files, виконай curl і передай ref "upload:<id>"`);
    const r = refs.get(m[1]);
    if (!r || r.exp < Date.now() || r.owner !== owner.email) throw new Error(`${value}: ref невідомий або застарів (діє годину після заливки). Можливо, curl не виконано: виклич upload_files ще раз`);
    if (want && !want.includes(r.kind)) throw new Error(`${r.name}: потрібен ${want.join(' або ')}, а це ${r.kind}`);
    const buf = r.kind === 'image' ? data.blobGet(r.sha) : r.buf;
    if (!buf) throw new Error(`${r.name}: файл зник, залий ще раз`);
    return { name: r.name, type: r.type, buf, kind: r.kind };
  };

  const offer = (owner, name, buf, type) => {
    sweep();
    const t = randomBytes(32).toString('base64url');
    downs.set(hash(t), { owner: owner.email, name: cleanName(name), buf, type, exp: Date.now() + LINK_TTL });
    return { url: `${origin}/d/${t}`, expires_in: LINK_TTL / 1000 };
  };

  const download = (req, res, t) => {
    const d = downs.get(hash(t));
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('allow', 'GET'); return json(res, 405, { error: 'лише GET' }); }
    if (!d || d.exp < Date.now()) return json(res, 404, { error: 'посилання недійсне або застаріло' });
    res.writeHead(200, { 'content-type': d.type || 'application/octet-stream', 'content-length': d.buf.length, 'content-disposition': `attachment; filename="${d.name.replace(/[^\w.-]/g, '_')}"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" });
    res.end(req.method === 'HEAD' ? undefined : d.buf);
  };

  const handle = async (req, res, url) => {
    const m = /^\/([ud])\/([A-Za-z0-9_-]{20,100})$/.exec(url.pathname);
    if (!m) return json(res, 404, { error: 'not found' });
    return m[1] === 'u' ? upload(req, res, m[2]) : download(req, res, m[2]);
  };

  return { issue, resolve, offer, handle, quote: q };
}
