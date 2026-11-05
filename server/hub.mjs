import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { KIT, ID, SHA, imageInfo } from './data.mjs';

createRequire(import.meta.url)('../src/patch.js');
const P = globalThis.SpineKitPatch;

const GROUP_IDLE = 20000;
const GROUP_MAX = 5 * 60 * 1000;
const BUFFER = 500;
const MAX_OPS = 2000;
const MAX_DOC = 20 * 1024 * 1024;
const IMG_FIELDS = new Set(['sha', 'name', 'type', 'w', 'h']);

const rid = p => p + Date.now().toString(36) + randomBytes(4).toString('hex');
const who = by => `${by.kind}:${by.email}`;
const scopeOf = p => p[0] === 'settings' && p[1] === 'layouts' ? 'layouts' : 'drafts';
const scopesOf = ops => {
  const out = new Set();
  for (const op of ops) {
    if (op.p.length === 1 && op.p[0] === 'settings') { out.add('drafts'); out.add('layouts'); }
    else out.add(scopeOf(op.p));
  }
  return [...out];
};
const labelOf = parts => parts.length ? parts.slice(0, 3).join(', ') + (parts.length > 3 ? ' +' + (parts.length - 3) : '') : 'Зміни';
const omit = (o, k) => { const x = Object.assign({}, o || {}); delete x[k]; return x; };

const segOk = s => typeof s === 'string' ? s.length <= 200 : !!s && typeof s === 'object' && !Array.isArray(s) && Object.keys(s).length === 1 && ('id' in s || 'name' in s) && ['string', 'number'].includes(typeof (s.id ?? s.name)) && String(s.id ?? s.name).length <= 200;

export function createHub({ data }) {
  const subs = new Set();
  const live = new Map();
  const typeCache = new Map();
  let listTimer = null;
  let lastList = '';
  let agents = () => [];

  const state = id => {
    if (!live.has(id)) live.set(id, { buffer: [], seen: new Map(), open: { drafts: null, layouts: null } });
    return live.get(id);
  };
  const send = (res, event, d) => { try { res.write(`event: ${event}\ndata: ${JSON.stringify(d)}\n\n`); } catch { return; } };
  const toProject = (id, event, d) => { for (const s of subs) if (s.project === id) send(s.res, event, d); };

  const blobType = sha => {
    if (typeCache.has(sha)) return typeCache.get(sha);
    const buf = data.blobGet(sha);
    const t = buf ? (imageInfo(buf) || {}).type || null : null;
    if (t) typeCache.set(sha, t);
    return t;
  };
  const imageOk = im => !!im && typeof im === 'object' && !Array.isArray(im) && SHA.test(im.sha) && typeof im.name === 'string' && im.name.length <= 200 && ['png', 'jpeg', 'webp'].includes(im.type) && Number.isFinite(im.w) && Number.isFinite(im.h) && im.w >= 0 && im.h >= 0 && blobType(im.sha) === im.type;
  const imagesOk = images => !!images && typeof images === 'object' && !Array.isArray(images) && Object.keys(images).every(k => k.length <= 200 && imageOk(images[k]));

  const meta = doc => ({ id: doc.id, created: doc.created, updated: doc.updated, updatedBy: doc.updatedBy || null, settings: { game: doc.settings.game || '', reels: doc.settings.reels, rows: doc.settings.rows, components: (doc.settings.components || []).map(c => ({ on: !c || c.on !== false })) } });
  const list = () => data.ids().map(id => data.project(id).doc).filter(d => !d.deleted).sort((a, b) => b.updated - a.updated).map(meta);
  const presence = id => {
    const out = new Map();
    for (const s of subs) if (s.project === id && s.user) out.set(s.user.email, { kind: 'human', email: s.user.email, name: s.user.name });
    let more = [];
    try { more = agents(id) || []; } catch { more = []; }
    return [...out.values(), ...more];
  };
  const tellPresence = id => toProject(id, 'presence', { list: presence(id) });
  const tellList = force => {
    const run = () => {
      clearTimeout(listTimer);
      listTimer = null;
      const l = list();
      const s = JSON.stringify(l);
      if (s === lastList) return;
      lastList = s;
      for (const x of subs) send(x.res, 'projects', { list: l });
    };
    if (force) return run();
    if (!listTimer) listTimer = setTimeout(run, 3000);
  };

  const entryOut = (e, open) => {
    const x = { id: e.id, v: e.v, t0: e.t0, t: e.t, scope: e.scope, by: e.by, label: e.label || labelOf(e.parts || []) };
    for (const k of ['named', 'restoreOf', 'restoreT', 'restoreLabel']) if (e[k] !== undefined) x[k] = e[k];
    if (open) x.open = true;
    return x;
  };
  const closeEntry = (id, scope) => {
    const st = state(id);
    const e = st.open[scope];
    if (!e) return;
    clearTimeout(e.timer);
    st.open[scope] = null;
    const line = entryOut(e);
    data.addEntry(id, line, e.snap);
    toProject(id, 'history', { entry: line });
  };
  const closeAll = id => { closeEntry(id, 'drafts'); closeEntry(id, 'layouts'); };

  const record = (id, by, scopes, parts, snap, extra) => {
    const st = state(id);
    const now = Date.now();
    const doc = data.project(id).doc;
    for (const scope of scopes) {
      let e = st.open[scope];
      if (e && (extra || who(e.by) !== who(by) || now - e.t0 > GROUP_MAX)) { closeEntry(id, scope); e = null; }
      if (!e) e = st.open[scope] = { id: rid('h'), t0: now, scope, by, parts: [] };
      e.v = doc.v;
      e.t = now;
      e.snap = snap;
      for (const p of (parts && parts[scope]) || []) if (!e.parts.includes(p)) e.parts.push(p);
      if (extra) { Object.assign(e, extra); closeEntry(id, scope); continue; }
      clearTimeout(e.timer);
      e.timer = setTimeout(() => closeEntry(id, scope), GROUP_IDLE);
      e.timer.unref?.();
      toProject(id, 'history', { entry: entryOut(e, true) });
    }
  };

  const checkOps = ops => {
    if (!Array.isArray(ops) || ops.length > MAX_OPS) return 'ops: масив до 2000';
    for (const op of ops) {
      if (!op || typeof op !== 'object' || !Array.isArray(op.p) || !op.p.length || op.p.length > 32) return 'ops: поганий шлях';
      if (!['settings', 'images'].includes(op.p[0]) || !op.p.every(segOk)) return 'ops: корінь лише settings або images';
      const n = ('v' in op ? 1 : 0) + (op.d === 1 ? 1 : 0) + ('o' in op ? 1 : 0);
      if (n !== 1) return 'ops: одна з v, d, o';
      if ('o' in op && (!Array.isArray(op.o) || op.o.length > 10000)) return 'ops: o має бути масивом';
      if (op.p.length === 1 && (op.d || 'o' in op || !op.v || typeof op.v !== 'object' || Array.isArray(op.v))) return 'ops: корінь не видаляється';
      if (op.p[0] === 'images') {
        if (op.p.length === 1 && !imagesOk(op.v)) return 'images: погані картинки';
        if (op.p.length > 3 || 'o' in op || (op.p.length >= 2 && typeof op.p[1] !== 'string')) return 'images: поганий шлях';
        if (op.p.length === 2 && 'v' in op && !imageOk(op.v)) return `images.${op.p[1]}: потрібні {sha, name, type, w, h} і завантажений блоб`;
        if (op.p.length === 3 && (!IMG_FIELDS.has(op.p[2]) || op.d)) return 'images: поганий шлях';
      }
    }
    return null;
  };

  const commit = (id, by, client, seq, ops, parts, extra) => {
    const p = data.project(id);
    const st = state(id);
    const doc = { settings: p.doc.settings, images: p.doc.images };
    const inv = P.invert(doc, ops);
    const applied = P.apply(doc, ops);
    p.doc.settings = doc.settings;
    p.doc.images = doc.images;
    if (!applied.length) return { v: p.doc.v, applied };
    const touched = new Set(applied.filter(o => o.p[0] === 'images').map(o => o.p[1] || '*'));
    const badImg = [...touched].some(k => k === '*' ? !imagesOk(p.doc.images) : p.doc.images[k] !== undefined && !imageOk(p.doc.images[k]));
    const snap = JSON.stringify(p.doc);
    if (badImg || snap.length > MAX_DOC || !p.doc.settings || typeof p.doc.settings !== 'object') {
      const back = { settings: p.doc.settings, images: p.doc.images };
      P.apply(back, inv);
      p.doc.settings = back.settings;
      p.doc.images = back.images;
      return { error: badImg ? 'images: погана картинка' : 'документ завеликий' };
    }
    const now = Date.now();
    p.doc.v += 1;
    p.doc.updated = now;
    p.doc.updatedBy = { email: by.email, name: by.name };
    const batch = { v: p.doc.v, by, client, seq, ops: applied, t: now };
    st.buffer.push(batch);
    if (st.buffer.length > BUFFER) st.buffer.splice(0, st.buffer.length - BUFFER);
    data.touch(id);
    record(id, by, scopesOf(applied), parts, JSON.stringify(p.doc), extra);
    toProject(id, 'ops', batch);
    tellList(false);
    return { v: p.doc.v, applied };
  };

  const cleanParts = parts => {
    const out = {};
    if (!parts || typeof parts !== 'object') return out;
    for (const s of ['drafts', 'layouts']) if (Array.isArray(parts[s])) out[s] = parts[s].filter(x => typeof x === 'string' && x.length <= 200).slice(0, 50);
    return out;
  };

  const newDoc = (id, settings, images, by) => {
    const now = Date.now();
    return { kit: KIT, id, v: 1, created: now, createdBy: { email: by.email, name: by.name }, updated: now, updatedBy: { email: by.email, name: by.name }, settings, images };
  };
  const born = (doc, by, label) => {
    data.create(doc);
    const snap = JSON.stringify(doc);
    const now = Date.now();
    for (const scope of ['drafts', 'layouts']) data.addEntry(doc.id, { id: rid('h'), v: 1, t0: now, t: now, scope, by, label }, snap);
    tellList(true);
    return doc;
  };

  const hub = {
    list,
    setAgents(fn) { agents = typeof fn === 'function' ? fn : () => []; },
    presenceOf: presence,
    presenceChanged: id => tellPresence(id),
    get: id => { const p = data.project(id); return p && !p.doc.deleted ? p.doc : null; },
    create(body, by, label = 'Створено') {
      const settings = body && body.settings;
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return { code: 400, error: 'settings missing' };
      const images = body.images || {};
      if (!imagesOk(images)) return { code: 400, error: 'images: потрібні {sha, name, type, w, h} і завантажені блоби' };
      const id = typeof body.id === 'string' && ID.test(body.id) && !data.project(body.id) ? body.id : rid('c');
      const doc = newDoc(id, settings, images, by);
      if (JSON.stringify(doc).length > MAX_DOC) return { code: 413, error: 'документ завеликий' };
      return { doc: born(doc, by, label) };
    },
    adopt(doc, by, label) { return born(doc, by, label); },
    remove(id, user) {
      const p = data.project(id);
      if (!p || p.doc.deleted) return false;
      closeAll(id);
      p.doc.deleted = { t: Date.now(), by: { email: user.email, name: user.name } };
      data.writeDoc(id);
      toProject(id, 'deleted', { by: user.name || user.email });
      tellList(true);
      return true;
    },
    trash: () => data.ids().map(id => data.project(id).doc).filter(d => d.deleted).sort((a, b) => b.deleted.t - a.deleted.t).map(d => Object.assign(meta(d), { deleted: d.deleted })),
    undelete(id) {
      const p = data.project(id);
      if (!p || !p.doc.deleted) return false;
      delete p.doc.deleted;
      data.writeDoc(id);
      tellList(true);
      return true;
    },
    ops(id, by, body) {
      const p = data.project(id);
      if (!p || p.doc.deleted) return { code: 404, error: 'немає проекту' };
      const client = typeof body.client === 'string' ? body.client.slice(0, 64) : '';
      const seq = Number(body.seq);
      const st = state(id);
      const key = `${client}:${seq}`;
      if (client && st.seen.has(key)) return { v: st.seen.get(key), dup: true };
      const err = checkOps(body.ops);
      if (err) return { code: 400, error: err };
      const r = commit(id, Object.assign({ client }, by), client, seq, body.ops, cleanParts(body.parts));
      if (r.error) return { code: 400, error: r.error };
      if (client) {
        st.seen.set(key, r.v);
        if (st.seen.size > 5000) st.seen.delete(st.seen.keys().next().value);
      }
      return { v: r.v };
    },
    subscribe(req, res, user, project, since) {
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      res.write(': open\n\n');
      const p = project && data.project(project);
      const sub = { res, user, project: p && !p.doc.deleted ? project : null };
      subs.add(sub);
      if (sub.project) {
        const st = state(project);
        const v = p.doc.v;
        const from = Number.isFinite(since) ? since : v;
        const missed = st.buffer.filter(b => b.v > from);
        const behind = from < v && (!missed.length || missed[0].v !== from + 1);
        send(res, 'hello', { v, me: user, presence: presence(project), behind });
        if (!behind) for (const b of missed) send(res, 'ops', b);
        tellPresence(project);
      } else {
        if (project) send(res, 'deleted', { by: p && p.doc.deleted ? p.doc.deleted.by.name : '' });
        send(res, 'hello', { v: 0, me: user, presence: [] });
      }
      send(res, 'projects', { list: list() });
      req.on('close', () => { subs.delete(sub); if (sub.project) tellPresence(sub.project); });
    },
    history(id, scope, before) {
      const p = data.project(id);
      if (!p) return null;
      const st = state(id);
      const open = ['drafts', 'layouts'].map(s => st.open[s]).filter(e => e && (!scope || e.scope === scope)).map(e => entryOut(e, true));
      let all = p.entries.filter(e => !scope || e.scope === scope).slice().reverse();
      if (before) { const i = all.findIndex(e => e.id === before); all = i === -1 ? [] : all.slice(i + 1); }
      else all = open.concat(all);
      return { entries: all.slice(0, 100), more: all.length > 100 };
    },
    entry(id, entryId) {
      const p = data.project(id);
      if (!p) return null;
      const st = state(id);
      const e = p.entries.find(x => x.id === entryId) || ['drafts', 'layouts'].map(s => st.open[s]).find(x => x && x.id === entryId);
      if (!e) return null;
      const doc = st.open[e.scope] === e ? JSON.parse(e.snap) : data.readSnap(id, e.v);
      return doc ? { entry: entryOut(e, st.open[e.scope] === e), doc } : null;
    },
    restore(id, user, entryId, scope) {
      const p = data.project(id);
      if (!p || p.doc.deleted) return { code: 404, error: 'немає проекту' };
      if (!['drafts', 'layouts'].includes(scope)) return { code: 400, error: 'scope: drafts або layouts' };
      closeAll(id);
      const e = p.entries.find(x => x.id === entryId);
      const snap = e && data.readSnap(id, e.v);
      if (!snap) return { code: 404, error: 'немає запису' };
      const cur = p.doc;
      const ops = scope === 'layouts'
        ? P.diff({ settings: { layouts: cur.settings.layouts } }, { settings: { layouts: snap.settings.layouts } })
        : P.diff({ settings: omit(cur.settings, 'layouts'), images: cur.images }, { settings: omit(snap.settings, 'layouts'), images: snap.images });
      const by = { kind: user.kind === 'claude' ? 'claude' : 'user', email: user.email, name: user.name, client: 'server' };
      const label = 'Відкат · ' + e.label;
      if (!ops.length) return { v: cur.v, nothing: true };
      const r = commit(id, by, 'server', 0, ops, { [scope]: [label] }, { label, restoreOf: e.id, restoreT: e.t, restoreLabel: e.label });
      return r.error ? { code: 400, error: r.error } : { v: r.v };
    },
    version(id, user, label) {
      const p = data.project(id);
      if (!p || p.doc.deleted) return { code: 404, error: 'немає проекту' };
      const name = String(label || '').trim().slice(0, 120);
      if (!name) return { code: 400, error: 'потрібна назва' };
      closeAll(id);
      const now = Date.now();
      const snap = JSON.stringify(p.doc);
      const by = { kind: user.kind === 'claude' ? 'claude' : 'user', email: user.email, name: user.name };
      const out = [];
      for (const scope of ['drafts', 'layouts']) {
        const line = { id: rid('h'), v: p.doc.v, t0: now, t: now, scope, by, label: name, named: name };
        data.addEntry(id, line, snap);
        toProject(id, 'history', { entry: line });
        out.push(line);
      }
      return { entries: out };
    },
    copy(id, user, entryId) {
      const p = data.project(id);
      if (!p || p.doc.deleted) return { code: 404, error: 'немає проекту' };
      let src = p.doc, from = '';
      if (entryId) {
        closeAll(id);
        const e = p.entries.find(x => x.id === entryId);
        src = e && data.readSnap(id, e.v);
        if (!src) return { code: 404, error: 'немає запису' };
        from = ' · ' + e.label;
      }
      const settings = JSON.parse(JSON.stringify(src.settings));
      const game = settings.game || 'slot';
      settings.game = game + '-copy';
      const by = { kind: 'user', email: user.email, name: user.name };
      const doc = newDoc(rid('c'), settings, JSON.parse(JSON.stringify(src.images || {})), by);
      return { doc: born(doc, by, 'Копія з ' + game + from) };
    },
    shutdown() { for (const id of live.keys()) closeAll(id); data.flush(); },
    ping() { for (const s of subs) { try { s.res.write(': ping\n\n'); } catch { subs.delete(s); } } }
  };
  return hub;
}
