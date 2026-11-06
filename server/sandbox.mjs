import { mkdirSync, readFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { SHA, imageInfo, writeAtomic } from './data.mjs';

const KIT = 'spine-draft-kit/sandbox@1';
const MB = 1024 * 1024;
const MAX_COMPONENT = MB;
const MAX_DOC = 16 * MB;
const MAX_ITEMS = 60;
const TYPES = ['png', 'jpeg', 'webp'];
const ROLE = /^(main|part:[a-z0-9_]{1,64})$/;
const SBID = /^sb[A-Za-z0-9_-]{1,62}$/;

const plain = o => !!o && typeof o === 'object' && !Array.isArray(o);
const bad = error => ({ code: 400, error });
const norm = email => String(email || '').trim().toLowerCase();
const keyOf = email => createHash('sha256').update(norm(email)).digest('hex').slice(0, 40);
const isId = id => typeof id === 'string' && SBID.test(id);
const person = by => ({ kind: by && by.kind === 'claude' ? 'claude' : 'user', email: by ? by.email : '', name: by ? by.name : '' });

const repair = list => {
  const seen = new Set();
  const out = [];
  for (const x of list) {
    if (!plain(x) || !isId(x.id) || seen.has(x.id) || !plain(x.component)) continue;
    seen.add(x.id);
    out.push({ id: x.id, component: x.component, images: plain(x.images) ? x.images : {}, v: Number.isInteger(x.v) && x.v > 0 ? x.v : 1, t: Number(x.t) || 0, by: plain(x.by) ? x.by : null });
  }
  return out;
};

export function createSandbox({ data, log }) {
  const dir = join(data.dir, 'sandbox');
  mkdirSync(dir, { recursive: true });
  const docs = new Map();
  const types = new Map();

  const load = email => {
    const key = keyOf(email);
    if (docs.has(key)) return docs.get(key);
    const f = join(dir, key + '.json');
    let items = [];
    if (existsSync(f)) {
      let x = null;
      try { x = JSON.parse(readFileSync(f, 'utf8')); } catch { x = null; }
      if (plain(x) && x.kit === KIT && Array.isArray(x.items)) {
        items = repair(x.items);
        if (items.length !== x.items.length && log) log.error(`sandbox: пропущено ${x.items.length - items.length} пошкоджених записів у ${key}.json`);
      } else {
        const aside = `${key}.json.bad-${Date.now()}`;
        if (log) log.error(`sandbox: пропущено файл ${key}.json, пісочниця починається порожньою`, { moved: aside });
        try { renameSync(f, join(dir, aside)); } catch { }
      }
    }
    const doc = { kit: KIT, email: norm(email), items };
    docs.set(key, doc);
    return doc;
  };

  const save = (doc, text) => {
    const key = keyOf(doc.email);
    writeAtomic(join(dir, key + '.json'), text);
    docs.set(key, doc);
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
    if (b.order != null && !(Number.isInteger(b.order) && b.order >= 0)) return bad('order: ціле число від 0');
    return { component, images, order: b.order == null ? null : b.order };
  };

  return {
    get: email => ({ items: load(email).items }),
    put(email, id, body, by) {
      if (!isId(id)) return bad('id: sb і далі 1–62 символи a-z, A-Z, 0-9, _ або -');
      const c = check(body);
      if (c.error) return c;
      const doc = load(email);
      const i = doc.items.findIndex(x => x.id === id);
      if (i < 0 && doc.items.length >= MAX_ITEMS) return bad(`у пісочниці до ${MAX_ITEMS} компонентів`);
      const item = { id, component: c.component, images: c.images, v: i < 0 ? 1 : doc.items[i].v + 1, t: Date.now(), by: person(by) };
      const items = doc.items.filter(x => x.id !== id);
      items.splice(c.order === null ? (i < 0 ? items.length : i) : Math.min(c.order, items.length), 0, item);
      const next = { kit: KIT, email: doc.email, items };
      const text = JSON.stringify(next);
      if (text.length > MAX_DOC) return { code: 413, error: 'пісочниця завелика (понад 16 МБ)' };
      save(next, text);
      return { item };
    },
    remove(email, id) {
      const doc = load(email);
      if (!doc.items.some(x => x.id === id)) return { code: 404, error: 'немає в пісочниці' };
      const next = { kit: KIT, email: doc.email, items: doc.items.filter(x => x.id !== id) };
      save(next, JSON.stringify(next));
      return { ok: true };
    }
  };
}
