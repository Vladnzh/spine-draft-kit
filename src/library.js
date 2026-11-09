(function (root) {
  'use strict';
  var KIT = 'spine-draft-kit/library@1';
  var LIB_DB = 'spine-draft-kit-library';
  var SB_DB = 'spine-draft-kit-sandbox';
  var STORE = 'items';
  var CLIENT = 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  var memory = {};
  var sbMemory = {};
  var listeners = [];
  var sbListeners = [];
  var urls = {};
  var cache = null;
  var dbs = {};
  var dimCache = new WeakMap();

  function sync() { var S = root.SpineKitSync; return S && S.mode && S.mode() && S.api ? S : null; }
  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function newId() { return 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  function names(list) { return (Array.isArray(list) ? list : []).map(function (x) { return x && x.name; }).filter(Boolean); }

  function open(name) {
    if (dbs[name]) return dbs[name];
    dbs[name] = new Promise(function (resolve) {
      var done = false;
      var finish = function (db) { if (!done) { done = true; resolve(db); } };
      setTimeout(function () { finish(null); }, 3000);
      try {
        var req = root.indexedDB.open(name, 1);
        req.onupgradeneeded = function () { req.result.createObjectStore(STORE, { keyPath: 'id' }); };
        req.onsuccess = function () { finish(req.result); };
        req.onerror = function () { finish(null); };
        req.onblocked = function () { finish(null); };
      } catch (e) { finish(null); }
    });
    return dbs[name];
  }
  async function idb(name, mode, fn) {
    var db = await open(name);
    if (!db) { var r = fn(null); return r && 'result' in r ? r.result : undefined; }
    return new Promise(function (resolve, reject) {
      var t;
      try { t = db.transaction(STORE, mode); } catch (e) { reject(e); return; }
      var req = fn(t.objectStore(STORE));
      t.oncomplete = function () { resolve(req && 'result' in req ? req.result : undefined); };
      t.onerror = function () { reject(t.error); };
      t.onabort = function () { reject(t.error); };
    });
  }

  function metaOf(rec) {
    var c = rec.component || {};
    return {
      id: rec.id, label: rec.label || '', name: rec.name || '', note: rec.note || '', tags: rec.tags || [],
      w: Number(c.w) || 0, h: Number(c.h) || 0, anims: names(c.anims), parts: names(c.parts),
      thumb: rec.thumb ? { local: true } : null, by: rec.by || null, created: rec.created || 0, updated: rec.updated || 0, updatedBy: rec.updatedBy || null
    };
  }
  function localUrl(rec) {
    var u = urls[rec.id];
    if (u && u.t === rec.updated) return u.url;
    if (u) URL.revokeObjectURL(u.url);
    if (!rec.thumb) { delete urls[rec.id]; return ''; }
    urls[rec.id] = { t: rec.updated, url: URL.createObjectURL(rec.thumb) };
    return urls[rec.id].url;
  }
  function thumbUrl(m) {
    if (!m || !m.thumb) return '';
    if (m.thumb.sha) return '/api/blobs/' + m.thumb.sha;
    return urls[m.id] ? urls[m.id].url : '';
  }
  function tell() { listeners.forEach(function (fn) { try { fn(cache || []); } catch (e) { return; } }); }

  async function failOf(r) {
    var msg = String(r.status);
    try { msg = (await r.json()).error || msg; } catch (e) { msg = String(r.status); }
    var e = new Error(msg);
    e.status = r.status;
    return e;
  }
  async function dims(blob) {
    var have = dimCache.get(blob);
    if (have) return have;
    var d = { w: 0, h: 0 };
    try {
      var b = await createImageBitmap(blob);
      d = { w: b.width, h: b.height };
      if (b.close) b.close();
    } catch (e) { d = { w: 0, h: 0 }; }
    dimCache.set(blob, d);
    return d;
  }
  async function ref(S, blob, name) {
    var h = await S.hashOf(blob);
    if (!h.type) return null;
    await S.upload(h.sha);
    var d = await dims(blob);
    return { sha: h.sha, name: String(name || '').slice(0, 200), type: h.type, w: d.w, h: d.h };
  }
  async function refs(S, images) {
    var out = {};
    var roles = Object.keys(images || {});
    for (var i = 0; i < roles.length; i++) {
      var x = images[roles[i]];
      var rf = x && x.blob ? await ref(S, x.blob, x.name) : null;
      if (rf) out[roles[i]] = rf;
    }
    return out;
  }
  async function files(S, images) {
    var out = {};
    var roles = Object.keys(images || {});
    for (var i = 0; i < roles.length; i++) {
      var im = images[roles[i]];
      try { out[roles[i]] = { blob: await S.fileOf(im), name: im.name || '' }; } catch (e) { continue; }
    }
    return out;
  }
  function blobsOf(images) {
    var out = {};
    Object.keys(images || {}).forEach(function (k) { var x = images[k]; if (x && x.blob) out[k] = { blob: x.blob, name: x.name || '' }; });
    return out;
  }

  async function list() {
    var S = sync();
    if (S) {
      var r = await S.api('/api/library');
      if (!r.ok) throw await failOf(r);
      cache = (await r.json()).items || [];
    } else {
      var all = await idb(LIB_DB, 'readonly', function (st) { return st ? st.getAll() : { result: Object.keys(memory).map(function (k) { return memory[k]; }) }; });
      cache = (all || []).filter(function (x) { return x && x.kit === KIT; }).map(function (rec) { localUrl(rec); return metaOf(rec); }).sort(function (a, b) { return b.updated - a.updated; });
    }
    tell();
    return cache;
  }

  async function get(id) {
    var S = sync();
    if (S) {
      var r = await S.api('/api/library/' + encodeURIComponent(id));
      if (r.status === 404) return null;
      if (!r.ok) throw await failOf(r);
      var item = (await r.json()).item;
      var m = metaOf(item);
      m.thumb = item.thumb || null;
      return { meta: m, component: clone(item.component), images: await files(S, item.images) };
    }
    var rec = await idb(LIB_DB, 'readonly', function (st) { return st ? st.get(id) : { result: memory[id] }; });
    if (!rec) return null;
    return { meta: metaOf(rec), component: clone(rec.component), images: blobsOf(rec.images) };
  }

  async function save(d) {
    var S = sync();
    var body = { label: String(d.label || '').trim(), name: String(d.name || '').trim(), note: String(d.note || '').trim(), tags: (d.tags || []).map(function (t) { return String(t).trim(); }).filter(Boolean), component: d.component };
    if (S) {
      body.images = await refs(S, d.images);
      body.thumb = d.thumb ? await ref(S, d.thumb, 'thumb.png') : null;
      var r = await S.api(d.id ? '/api/library/' + encodeURIComponent(d.id) : '/api/library', { method: d.id ? 'PUT' : 'POST', json: body });
      if (!r.ok) throw await failOf(r);
      var out = (await r.json()).item;
      try { await list(); } catch (e) { tell(); }
      return out;
    }
    var old = d.id ? await idb(LIB_DB, 'readonly', function (st) { return st ? st.get(d.id) : { result: memory[d.id] }; }) : null;
    var now = Date.now();
    var rec = Object.assign(body, { id: d.id || newId(), kit: KIT, images: blobsOf(d.images), thumb: d.thumb || null, by: old ? old.by || null : null, created: old ? old.created : now, updated: now });
    memory[rec.id] = rec;
    await idb(LIB_DB, 'readwrite', function (st) { return st ? st.put(rec) : null; });
    await list();
    return metaOf(rec);
  }

  async function remove(id) {
    var S = sync();
    if (S) {
      var r = await S.api('/api/library/' + encodeURIComponent(id), { method: 'DELETE' });
      if (!r.ok) throw await failOf(r);
    } else {
      delete memory[id];
      await idb(LIB_DB, 'readwrite', function (st) { return st ? st.delete(id) : null; });
    }
    await list();
    return true;
  }

  function renamed(c, label, name) {
    var x = clone(c) || {};
    x.label = label;
    x.name = name.replace(/^animation_/, '');
    return x;
  }
  async function rename(id, label, name) {
    label = String(label || '').trim();
    name = String(name || '').trim();
    var S = sync();
    if (S) {
      var g = await S.api('/api/library/' + encodeURIComponent(id));
      if (!g.ok) throw await failOf(g);
      var item = (await g.json()).item;
      var r = await S.api('/api/library/' + encodeURIComponent(id), { method: 'PUT', json: { label: label, name: name, note: item.note || '', tags: item.tags || [], component: renamed(item.component, label, name), images: item.images || {}, thumb: item.thumb || null } });
      if (!r.ok) throw await failOf(r);
      var out = (await r.json()).item;
      try { await list(); } catch (e) { tell(); }
      return out;
    }
    var rec = await idb(LIB_DB, 'readonly', function (st) { return st ? st.get(id) : { result: memory[id] }; });
    if (!rec) throw new Error('немає компонента');
    rec.label = label;
    rec.name = name;
    rec.component = renamed(rec.component, label, name);
    rec.updated = Date.now();
    memory[rec.id] = rec;
    await idb(LIB_DB, 'readwrite', function (st) { return st ? st.put(rec) : null; });
    await list();
    return metaOf(rec);
  }

  function canEdit(m) {
    var S = sync();
    if (!S) return true;
    var me = S.me && S.me();
    if (S.role && S.role() === 'admin') return true;
    return !!(m && m.by && me && String(m.by.email || '').toLowerCase() === String(me.email || '').toLowerCase());
  }

  root.SpineKitLibrary = {
    KIT: KIT,
    mode: function () { return sync() ? 'server' : 'local'; },
    list: list,
    get: get,
    save: save,
    rename: rename,
    remove: remove,
    canEdit: canEdit,
    thumbUrl: thumbUrl,
    cached: function () { return cache; },
    onChange: function (fn) { listeners.push(fn); },
    remote: function (items) { cache = Array.isArray(items) ? items : []; tell(); }
  };

  async function sbLoad() {
    var S = sync();
    if (S) {
      var r = await S.api('/api/sandbox');
      if (!r.ok) throw await failOf(r);
      var items = (await r.json()).items || [];
      var out = [];
      for (var i = 0; i < items.length; i++) out.push({ id: items[i].id, component: items[i].component, images: await files(S, items[i].images), order: i });
      return out;
    }
    var all = await idb(SB_DB, 'readonly', function (st) { return st ? st.getAll() : { result: Object.keys(sbMemory).map(function (k) { return sbMemory[k]; }) }; });
    return (all || []).filter(function (x) { return x && x.id && x.component; }).sort(function (a, b) { return (a.order || 0) - (b.order || 0) || (a.t || 0) - (b.t || 0); }).map(function (x) { return { id: x.id, component: x.component, images: blobsOf(x.images), order: x.order || 0 }; });
  }
  async function sbPut(rec) {
    var S = sync();
    if (S) {
      var body = { component: rec.component, images: await refs(S, rec.images), order: rec.order, client: CLIENT };
      var r = await S.api('/api/sandbox/items/' + encodeURIComponent(rec.id), { method: 'PUT', json: body });
      if (!r.ok) throw await failOf(r);
      return (await r.json()).item;
    }
    var x = { id: rec.id, component: clone(rec.component), images: blobsOf(rec.images), order: rec.order || 0, t: Date.now() };
    sbMemory[x.id] = x;
    await idb(SB_DB, 'readwrite', function (st) { return st ? st.put(x) : null; });
    return { id: x.id };
  }
  async function sbRemove(id) {
    var S = sync();
    if (S) {
      var r = await S.api('/api/sandbox/items/' + encodeURIComponent(id) + '?client=' + encodeURIComponent(CLIENT), { method: 'DELETE' });
      if (!r.ok && r.status !== 404) throw await failOf(r);
      return true;
    }
    delete sbMemory[id];
    await idb(SB_DB, 'readwrite', function (st) { return st ? st.delete(id) : null; });
    return true;
  }
  var sbTasks = [], sbRunning = false;
  async function sbPump() {
    if (sbRunning) return;
    sbRunning = true;
    while (sbTasks.length) {
      try { await sbHandle(sbTasks.shift()); } catch (e) { continue; }
    }
    sbRunning = false;
  }
  function sbRemote(ev) { sbTasks.push(ev); sbPump(); }
  async function sbHandle(ev) {
    var S = sync();
    if (!S || !ev || ev.client === CLIENT) return;
    var out = { op: ev.op, id: ev.op === 'del' ? ev.id : ev.item && ev.item.id, by: ev.by || null };
    if (ev.op === 'put') {
      if (!ev.item || !ev.item.id) return;
      out.rec = { id: ev.item.id, component: ev.item.component, images: await files(S, ev.item.images) };
    }
    sbListeners.forEach(function (fn) { try { fn(out); } catch (e) { return; } });
  }

  root.SpineKitSandboxStore = {
    mode: function () { return sync() ? 'server' : 'local'; },
    client: CLIENT,
    load: sbLoad,
    put: sbPut,
    remove: sbRemove,
    onRemote: function (fn) { sbListeners.push(fn); },
    remote: sbRemote
  };
})(typeof window !== 'undefined' ? window : globalThis);
