import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ID, SHA, imageInfo, writeAtomic } from './data.mjs';

const KIT = 'spine-draft-kit/library@1';
const MB = 1024 * 1024;
const MAX_COMPONENT = MB;
const MAX_ITEM = 2 * MB;
const TYPES = ['png', 'jpeg', 'webp'];
const ROLE = /^(main|part:[a-z0-9_]{1,64})$/;
const NAME = /^[a-z0-9_]+$/;

const rid = () => 'l' + Date.now().toString(36) + randomBytes(4).toString('hex');
const plain = o => !!o && typeof o === 'object' && !Array.isArray(o);
const names = list => (Array.isArray(list) ? list : []).map(x => x && x.name).filter(n => typeof n === 'string' && n).slice(0, 200);
const person = u => ({ email: u.email, name: u.name });
const same = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();
const whoOf = by => by ? by.name || by.email : '?';
const bad = error => ({ code: 400, error });
const readItem = f => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

export function createLibrary({ data, log }) {
  const dir = join(data.dir, 'library');
  mkdirSync(dir, { recursive: true });
  const items = new Map();
  const types = new Map();

  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json') || !ID.test(f.slice(0, -5))) continue;
    const x = readItem(join(dir, f));
    if (!plain(x) || x.id !== f.slice(0, -5) || x.kit !== KIT || !plain(x.component)) { if (log) log.error('library: пропущено файл ' + f); continue; }
    items.set(x.id, x);
  }

  const save = x => {
    writeAtomic(join(dir, x.id + '.json'), JSON.stringify(x));
    items.set(x.id, x);
  };

  const blobType = sha => {
    if (types.has(sha)) return types.get(sha);
    const buf = data.blobHas(sha) ? data.blobGet(sha) : null;
    const t = buf ? (imageInfo(buf) || {}).type || null : null;
    if (t) types.set(sha, t);
    return t;
  };
  const image = v => plain(v) && typeof v.sha === 'string' && SHA.test(v.sha) && typeof v.name === 'string' && v.name.length <= 200 && TYPES.includes(v.type) && Number.isFinite(v.w) && Number.isFinite(v.h) && v.w >= 0 && v.h >= 0 && blobType(v.sha) === v.type
    ? { sha: v.sha, name: v.name, type: v.type, w: v.w, h: v.h }
    : null;

  const check = b => {
    if (!plain(b)) return bad('потрібен JSON-обʼєкт');
    const label = typeof b.label === 'string' ? b.label.trim() : '';
    if (!label || label.length > 120) return bad('label: назва від 1 до 120 символів');
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!name || name.length > 80 || !NAME.test(name)) return bad('name: spine-назва до 80 символів, лише a-z, 0-9 і _');
    if (b.note != null && typeof b.note !== 'string') return bad('note: має бути рядком');
    const note = (b.note || '').trim();
    if (note.length > 1000) return bad('note: до 1000 символів');
    if (b.tags != null && (!Array.isArray(b.tags) || b.tags.length > 12 || !b.tags.every(t => typeof t === 'string' && t.trim() && t.trim().length <= 40))) return bad('tags: до 12 міток по 1–40 символів');
    const tags = (b.tags || []).map(t => t.trim());
    if (!plain(b.component) || !Array.isArray(b.component.anims) || b.component.anims.length > 200) return bad('component: потрібен обʼєкт з масивом anims (до 200 анімацій)');
    const text = JSON.stringify(b.component);
    if (text.length > MAX_COMPONENT) return { code: 413, error: 'component: більший за 1 МБ' };
    const component = JSON.parse(text);
    delete component.id;
    delete component.on;
    const src = b.images == null ? {} : b.images;
    if (!plain(src) || Object.keys(src).length > 300) return bad('images: обʼєкт до 300 картинок');
    const images = {};
    for (const [k, v] of Object.entries(src)) {
      if (!ROLE.test(k)) return bad(`images.${k.slice(0, 80)}: ключ main або part:<назва з a-z, 0-9, _>`);
      const im = image(v);
      if (!im) return bad(`images.${k}: потрібні {sha, name, type, w, h} і завантажений блоб`);
      images[k] = im;
    }
    let thumb = null;
    if (b.thumb != null) {
      thumb = image(b.thumb);
      if (!thumb) return bad('thumb: потрібні {sha, name, type, w, h} і завантажений блоб');
    }
    return { fields: { label, name, note, tags, component, images, thumb } };
  };
  const tooBig = x => JSON.stringify(x).length > MAX_ITEM;

  const meta = x => {
    const c = plain(x.component) ? x.component : {};
    return { id: x.id, label: x.label || '', name: x.name || '', note: x.note || '', tags: Array.isArray(x.tags) ? x.tags : [], w: Number(c.w) || 0, h: Number(c.h) || 0, anims: names(c.anims), parts: names(c.parts), thumb: x.thumb || null, by: x.by || null, created: x.created || 0, updated: x.updated || 0, updatedBy: x.updatedBy || null };
  };
  const live = id => { const x = items.get(id); return x && !x.deleted ? x : null; };
  const mayEdit = (x, user, isAdmin) => !!isAdmin || (!!x.by && !!user && same(x.by.email, user.email));

  return {
    meta,
    list: () => [...items.values()].filter(x => !x.deleted).sort((a, b) => b.updated - a.updated).map(meta),
    get: id => live(id),
    create(body, user) {
      const v = check(body);
      if (v.error) return v;
      const now = Date.now();
      const item = { id: rid(), kit: KIT, ...v.fields, by: person(user), created: now, updated: now, updatedBy: person(user) };
      if (tooBig(item)) return { code: 413, error: 'компонент завеликий (понад 2 МБ)' };
      save(item);
      return { item };
    },
    update(id, body, user, isAdmin) {
      const old = live(id);
      if (!old) return { code: 404, error: 'немає компонента' };
      if (!mayEdit(old, user, isAdmin)) return { code: 403, error: `змінювати може лише автор (${whoOf(old.by)}) або адмін` };
      const v = check(body);
      if (v.error) return v;
      const item = { ...old, ...v.fields, updated: Date.now(), updatedBy: person(user) };
      if (tooBig(item)) return { code: 413, error: 'компонент завеликий (понад 2 МБ)' };
      save(item);
      return { item };
    },
    remove(id, user, isAdmin) {
      const old = live(id);
      if (!old) return { code: 404, error: 'немає компонента' };
      if (!mayEdit(old, user, isAdmin)) return { code: 403, error: `видалити може лише автор (${whoOf(old.by)}) або адмін` };
      save({ ...old, deleted: { t: Date.now(), by: person(user) } });
      return { ok: true };
    }
  };
}
