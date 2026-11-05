(function (root) {
  'use strict';
  var tag = typeof document !== 'undefined' ? document.querySelector('meta[name="spine-kit-mode"]') : null;
  var MODE = tag && /^(server|engine|view)$/.test(tag.content) ? tag.content : null;
  if (!MODE) { root.SpineKitSync = { mode: function () { return null; } }; return; }

  var P = root.SpineKitPatch;
  var App = null;
  var me = null, csrf = '', role = '';
  var client = 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  var seq = 0;
  var pid = null, confirmed = null, shadow = null, lastV = 0;
  var pending = [], outbox = [], sending = false;
  var known = {}, removing = {};
  var hashes = new WeakMap(), files = {}, uploaded = {};
  var undo = [], redo = [];
  var es = null, live = false, liveTimer = null, retry = 0, authLost = false, netDown = false;
  var presence = [];
  var hc = { key: '', entries: null, more: false, token: 0, naming: false };
  var viewInfo = null;
  var tasks = [], running = false, nested = null;
  var UNDO_MAX = 100, UNDO_MERGE = 1200;

  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === undefined || v === null || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.indexOf('on') === 0 && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    [].concat(kids || []).forEach(function (c) { if (c !== null && c !== undefined && c !== false) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function clone(x) { return P.clone(x); }
  function omit(o, k) { var x = Object.assign({}, o || {}); delete x[k]; return x; }
  function toast(t) { if (App) App.toast(t); }
  function stamp(t) {
    var d = new Date(t);
    var p = function (v) { return String(v).padStart(2, '0'); };
    var time = p(d.getHours()) + ':' + p(d.getMinutes());
    return d.toDateString() === new Date().toDateString() ? time : p(d.getDate()) + '.' + p(d.getMonth() + 1) + ' ' + time;
  }
  function hue(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; }
  function initials(name, email) {
    var w = String(name || email || '?').trim().split(/\s+/).filter(Boolean);
    return ((w[0] || '?')[0] + (w[1] ? w[1][0] : '')).toUpperCase();
  }
  function avatar(u, cls) {
    return el('span', { class: 'sk-av' + (cls ? ' ' + cls : ''), title: (u.name || '') + (u.email ? ' · ' + u.email : ''), style: 'background:hsl(' + hue(u.email || u.name || '') + ' 55% 48%)', text: initials(u.name, u.email) });
  }

  function serial(fn) {
    return new Promise(function (resolve, reject) { tasks.push({ fn: fn, resolve: resolve, reject: reject }); pump(); });
  }
  async function pump() {
    if (running) return;
    running = true;
    while (tasks.length) {
      var t = tasks.shift();
      try { t.resolve(await t.fn()); } catch (e) { t.reject(e); }
    }
    running = false;
  }

  async function relogin() {
    var r = await fetch('/api/session', { cache: 'no-store' });
    if (r.status === 401) { setAuth(true); var e = new Error('Сесія завершилась'); e.status = 401; throw e; }
    if (!r.ok) { var e2 = new Error('/api/session ' + r.status); e2.status = r.status; throw e2; }
    var s = await r.json();
    me = s.user;
    role = s.role;
    csrf = s.csrf;
    renderMe();
    setAuth(false);
  }
  async function api(path, opts) {
    opts = opts || {};
    var method = opts.method || 'GET';
    var write = method !== 'GET' && method !== 'HEAD';
    if (authLost && write) await relogin();
    var body = opts.body, type = null;
    if (opts.json !== undefined) { type = 'application/json'; body = JSON.stringify(opts.json); }
    var send = function () {
      var headers = {};
      if (write) headers['x-kit-csrf'] = csrf;
      if (type) headers['content-type'] = type;
      return fetch(path, { method: method, headers: headers, body: body, cache: 'no-store', keepalive: !!opts.keepalive && (!body || body.length < 60000) });
    };
    var r = await send();
    for (var n = 0; r.status === 429 && n < 30; n++) { await sleep(1000 * Math.min(60, Number(r.headers.get('retry-after')) || 1)); r = await send(); }
    if (r.status === 403 && write && r.headers.get('x-kit-error') === 'csrf') { await relogin(); r = await send(); }
    if (r.status === 401) { setAuth(true); var e = new Error('Сесія завершилась'); e.status = 401; throw e; }
    if (authLost) await relogin();
    return r;
  }
  async function getJson(path) {
    var r = await api(path);
    if (!r.ok) { var e = new Error(path + ' ' + r.status); e.status = r.status; throw e; }
    return r.json();
  }
  async function postJson(path, data) {
    var r = await api(path, { method: 'POST', json: data });
    var out = await r.json();
    if (!r.ok) { var e = new Error(out.error || String(r.status)); e.status = r.status; throw e; }
    return out;
  }

  function sniff(b) {
    if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
    if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
    if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
    return null;
  }
  async function hashOf(blob) {
    var h = hashes.get(blob);
    if (h) return h;
    var buf = await blob.arrayBuffer();
    var d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
    var sha = Array.prototype.map.call(d, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    h = { sha: sha, type: sniff(new Uint8Array(buf, 0, Math.min(16, buf.byteLength))) };
    hashes.set(blob, h);
    if (!files[sha]) files[sha] = blob;
    return h;
  }
  async function fileOf(im) {
    var have = files[im.sha];
    if (have && have instanceof File) return have;
    if (have) {
      var w = new File([have], im.name || im.sha, { type: have.type });
      files[im.sha] = w;
      hashes.set(w, { sha: im.sha, type: im.type });
      return w;
    }
    var r = await api('/api/blobs/' + im.sha);
    if (!r.ok) throw new Error('картинка ' + im.name + ': ' + r.status);
    var f = new File([await r.blob()], im.name || im.sha, { type: r.headers.get('content-type') || '' });
    files[im.sha] = f;
    hashes.set(f, { sha: im.sha, type: im.type });
    uploaded[im.sha] = true;
    return f;
  }
  async function filesFor(images) {
    var out = {};
    var keys = Object.keys(images || {});
    var cur = App && App.state ? App.state.blobs : {};
    var got = await Promise.all(keys.map(async function (k) {
      var b = cur[k], h = b && hashes.get(b);
      if (h && h.sha === images[k].sha) return b;
      try { return await fileOf(images[k]); } catch (e) { return null; }
    }));
    keys.forEach(function (k, i) { if (got[i]) out[k] = { file: got[i], name: images[k].name }; });
    return out;
  }
  async function upload(sha) {
    if (uploaded[sha]) return;
    var h = await api('/api/blobs/' + sha, { method: 'HEAD' });
    if (!h.ok) {
      var blob = files[sha];
      if (!blob) throw new Error('немає картинки ' + sha.slice(0, 8));
      var r = await api('/api/blobs/' + sha, { method: 'PUT', body: blob });
      if (!r.ok) { var e = new Error('картинка не прийнята: ' + r.status); e.status = r.status; throw e; }
    }
    uploaded[sha] = true;
  }
  function shasIn(ops) {
    var out = [];
    var add = function (v) {
      if (!v || typeof v !== 'object') return;
      if (typeof v.sha === 'string') out.push(v.sha);
      else Object.keys(v).forEach(function (k) { add(v[k]); });
    };
    ops.forEach(function (op) { if (op.p[0] === 'images') { if (op.p.length === 3 && op.p[2] === 'sha') out.push(op.v); else add(op.v); } });
    return out;
  }

  async function build(settings, blobs, base) {
    var images = {};
    var keys = Object.keys(blobs || {});
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i], b = blobs[k];
      if (!b) continue;
      var h = await hashOf(b);
      if (!h.type) continue;
      var old = base && base.images && base.images[k];
      if (old && old.sha === h.sha) { images[k] = clone(old); continue; }
      var im = App.state.images[k];
      images[k] = { sha: h.sha, name: String((im && im.fileName) || b.name || '').slice(0, 200), type: h.type, w: im ? im.w : 0, h: im ? im.h : 0 };
    }
    return { settings: clone(settings), images: images };
  }
  function snapOf(d, scope) {
    if (scope === 'layouts') return { layouts: d.settings.layouts };
    var blobs = {};
    Object.keys(d.images || {}).forEach(function (k) { blobs[k] = d.images[k].sha; });
    return { s: omit(d.settings, 'layouts'), blobs: blobs };
  }
  function scopes(ops) {
    var out = {};
    ops.forEach(function (op) {
      if (op.p.length === 1 && op.p[0] === 'settings') { out.drafts = true; out.layouts = true; }
      else out[op.p[0] === 'settings' && op.p[1] === 'layouts' ? 'layouts' : 'drafts'] = true;
    });
    return out;
  }
  function partsOf(a, b, ops) {
    var out = {}, sc = scopes(ops);
    Object.keys(sc).forEach(function (s) { try { out[s] = App.histParts(s, snapOf(a, s), snapOf(b, s)); } catch (e) { out[s] = []; } });
    return out;
  }
  function labelOf(parts) {
    var all = [];
    Object.keys(parts || {}).forEach(function (s) { (parts[s] || []).forEach(function (x) { if (all.indexOf(x) === -1) all.push(x); }); });
    return all.length ? all.slice(0, 3).join(', ') + (all.length > 3 ? ' +' + (all.length - 3) : '') : 'Зміни';
  }

  function related(p, q) {
    var n = Math.min(p.length, q.length);
    for (var i = 0; i < n; i++) if (JSON.stringify(p[i]) !== JSON.stringify(q[i])) return false;
    return true;
  }
  function mineOf(doc, op) {
    var v = P.get(doc, op.p);
    if ('o' in op) return JSON.stringify(Array.isArray(v) ? v.map(function (x) { return x && (x.id !== undefined ? x.id : x.name); }) : null);
    return JSON.stringify(v === undefined ? null : v);
  }
  function stillMine(doc, it) { return mineOf(doc, it.op) === it.mine; }
  function remember(stack, before, ops, after, label, merge) {
    var invs = P.invertEach(before, ops);
    var items = [];
    ops.forEach(function (op, i) { if (invs[i]) items.push({ op: op, inv: invs[i], mine: mineOf(after, op) }); });
    if (!items.length) return;
    var now = Date.now();
    var top = stack[stack.length - 1];
    if (merge && top && now - top.t < UNDO_MERGE && top.pid === pid) {
      top.items.forEach(function (it) { if (items.some(function (n) { return related(n.op.p, it.op.p); })) it.mine = mineOf(after, it.op); });
      items.forEach(function (n) { if (!top.items.some(function (it) { return JSON.stringify(it.op.p) === JSON.stringify(n.op.p) && ('o' in it.op) === ('o' in n.op); })) top.items.push(n); });
      top.t = now;
      if (top.labels.indexOf(label) === -1) top.labels.push(label);
    } else {
      stack.push({ pid: pid, t: now, items: items, labels: [label] });
      if (stack.length > UNDO_MAX) stack.shift();
    }
  }

  function send(ops, parts) {
    seq += 1;
    var item = { pid: pid, body: { client: client, seq: seq, ops: ops, parts: parts }, done: [] };
    pending.push({ seq: seq, ops: ops, acked: false });
    var p = new Promise(function (r) { item.done.push(r); });
    outbox.push(item);
    flushOutbox();
    return p;
  }
  async function flushOutbox() {
    if (sending) return;
    sending = true;
    var wait = 500;
    while (outbox.length) {
      var it = outbox[0];
      try {
        var shas = shasIn(it.body.ops);
        for (var i = 0; i < shas.length; i++) await upload(shas[i]);
        var r = await api('/api/projects/' + it.pid + '/ops', { method: 'POST', json: it.body, keepalive: true });
        if (r.status >= 500) throw new Error('server ' + r.status);
        var out = await r.json();
        outbox.shift();
        setNet(false);
        wait = 500;
        if (!r.ok) {
          toast('Сервер не прийняв зміни: ' + (out.error || r.status));
          if (it.pid === pid) { pending = pending.filter(function (x) { return x.seq !== it.body.seq; }); serial(reload); }
        } else if (it.pid === pid) pending.forEach(function (x) { if (x.seq === it.body.seq) { x.acked = true; x.v = out.v; } });
        it.done.forEach(function (f) { f(); });
      } catch (e) {
        if (e.status && e.status !== 401 && e.status < 500) {
          outbox.shift();
          toast('Сервер не прийняв зміни: ' + e.message);
          if (it.pid === pid) { pending = pending.filter(function (x) { return x.seq !== it.body.seq; }); serial(reload); }
          it.done.forEach(function (f) { f(); });
          continue;
        }
        if (e.status !== 401) setNet(true);
        await sleep(wait);
        wait = Math.min(5000, wait * 2);
      }
    }
    sending = false;
    renderBanner();
  }

  function anchor(ops, base, doc) {
    var out = [], seen = {};
    ops.forEach(function (op) {
      var p = op.p, n = 'o' in op ? p.length : p.length - 1, cut = 0;
      for (var i = 1; i <= n && !cut; i++) if (P.get(base, p.slice(0, i)) === undefined) cut = i;
      if (!cut) { out.push(op); return; }
      var q = p.slice(0, cut), key = JSON.stringify(q);
      if (seen[key]) return;
      seen[key] = true;
      var v = P.get(doc, q);
      if (v === undefined) return;
      var w = { p: q, v: clone(v) }, last = q[q.length - 1];
      if (last && typeof last === 'object') {
        var arr = P.get(doc, q.slice(0, -1)) || [], k = 'id' in last ? 'id' : 'name', at = -1;
        arr.forEach(function (x, j) { if (x && x[k] === last[k]) at = j; });
        w.after = at > 0 ? arr[at - 1][k] : null;
      }
      out.push(w);
    });
    return out;
  }

  async function stage(rec) {
    if (MODE === 'view') return { ack: null };
    if (rec.id !== pid) {
      if (!known[rec.id]) return { ack: create(rec) };
      return { ack: null };
    }
    if (!shadow) return { ack: null };
    var doc = await build(rec.settings, rec.images, shadow);
    var ops = anchor(P.diff(shadow, doc), recompute(), doc);
    if (!ops.length) return { ack: null };
    var parts = partsOf(shadow, doc, ops);
    remember(undo, shadow, ops, doc, labelOf(parts), true);
    redo = [];
    shadow = doc;
    return { ack: send(ops, parts) };
  }
  async function create(rec) {
    var images = {};
    var keys = Object.keys(rec.images || {});
    for (var i = 0; i < keys.length; i++) {
      var b = rec.images[keys[i]];
      var h = await hashOf(b);
      if (!h.type) continue;
      try { await upload(h.sha); } catch (e) { if (e.status === 401) throw e; continue; }
      images[keys[i]] = { sha: h.sha, name: String(b.name || '').slice(0, 200), type: h.type, w: 0, h: 0 };
    }
    var dims = await Promise.all(Object.keys(images).map(function (k) { return dimsOf(rec.images[k]); }));
    Object.keys(images).forEach(function (k, i) { images[k].w = dims[i].w; images[k].h = dims[i].h; });
    await postJson('/api/projects', { id: rec.id, settings: rec.settings, images: images });
    known[rec.id] = true;
  }
  async function dimsOf(blob) {
    try { var bm = await createImageBitmap(blob); var d = { w: bm.width, h: bm.height }; bm.close(); return d; } catch (e) { return { w: 0, h: 0 }; }
  }

  async function flushLocal() {
    if (!App || !App.dirty()) return;
    nested = [];
    try { App.saveNow(); } catch (e) { nested = null; return; }
    var list = nested;
    nested = null;
    for (var i = 0; i < list.length; i++) await list[i];
  }
  async function adopt() {
    var pre = recompute();
    var imgs = await filesFor(pre.images);
    await flushLocal();
    var next = recompute();
    if (P.same(shadow, next)) return;
    if (!P.same(next.images, pre.images)) imgs = await filesFor(next.images);
    var done = App.applyRemote(next.settings, imgs);
    shadow = { settings: clone(App.state.s), images: clone(next.images) };
    await done;
  }
  function recompute() {
    var next = clone(confirmed);
    pending.forEach(function (x) { P.apply(next, x.ops); });
    return next;
  }
  async function onOps(b) {
    if (!pid || !confirmed) return;
    if (b.v <= lastV) return;
    if (b.v > lastV + 1) return reload();
    lastV = b.v;
    var mine = b.client === client ? pending.filter(function (x) { return x.seq === b.seq; })[0] : null;
    P.apply(confirmed, b.ops);
    if (mine) {
      pending = pending.filter(function (x) { return x !== mine; });
      if (b.ops.length === mine.ops.length) return;
    }
    await adopt();
  }
  async function reload() {
    if (!pid) return;
    var doc;
    try { doc = await getJson('/api/projects/' + pid); } catch (e) { return; }
    confirmed = { settings: doc.settings, images: doc.images };
    lastV = doc.v;
    pending = pending.filter(function (x) { return !x.acked || x.v > doc.v; });
    await adopt();
  }

  async function revert(dir) {
    var from = dir < 0 ? undo : redo, to = dir < 0 ? redo : undo;
    await flushLocal();
    var top = from[from.length - 1];
    if (!top || top.pid !== pid || !shadow) { toast(dir < 0 ? 'Далі назад кроків немає' : 'Далі вперед кроків немає'); return; }
    from.pop();
    var ok = top.items.filter(function (it) { return stillMine(shadow, it); });
    var ops = ok.map(function (it) { return it.inv; }).reverse();
    var label = (dir < 0 ? 'Скасовано: ' : 'Повторено: ') + top.labels.join(', ');
    if (!ops.length) { toast(dir < 0 ? 'Нема чого скасувати: ці поля вже змінили інші' : 'Нема чого повторити'); return; }
    var before = shadow;
    var next = clone(shadow);
    var applied = anchor(P.apply(next, ops), recompute(), next);
    var sc = scopes(applied), parts = {};
    Object.keys(sc).forEach(function (s) { parts[s] = [label]; });
    var keep = to.length;
    remember(to, before, applied, next, top.labels.join(', '), false);
    if (to.length > keep) to[to.length - 1].labels = top.labels.slice();
    var imgs = await filesFor(next.images);
    var done = App.applyRemote(next.settings, imgs);
    shadow = { settings: clone(App.state.s), images: clone(next.images) };
    send(applied, parts);
    toast(label + (ok.length < top.items.length ? ' (частину вже змінили інші)' : ''));
    await done;
  }

  function setProject(id, doc) {
    pid = id;
    confirmed = { settings: doc.settings, images: doc.images };
    shadow = clone(confirmed);
    lastV = doc.v;
    pending = [];
    undo = [];
    redo = [];
    hc.key = '';
    known[id] = true;
  }

  function connect() {
    if (MODE === 'view') return;
    if (es) { es.close(); es = null; }
    var url = '/api/events' + (pid ? '?project=' + encodeURIComponent(pid) + '&since=' + lastV : '');
    var src = new EventSource(url);
    es = src;
    var on = function (name, fn) { src.addEventListener(name, function (e) { if (es === src) fn(JSON.parse(e.data)); }); };
    on('hello', function (d) {
      retry = 0;
      setLive(true);
      if (d.me) me = d.me;
      presence = d.presence || [];
      renderPresence();
      if (d.behind) serial(reload);
    });
    on('ops', function (b) { serial(function () { return onOps(b); }); });
    on('presence', function (d) { presence = d.list || []; renderPresence(); });
    on('history', function (d) { histEvent(d.entry); });
    on('projects', function (d) {
      known = {};
      (d.list || []).forEach(function (p) { known[p.id] = true; });
      if (pid) known[pid] = true;
      if (App && App.setProjects) App.setProjects(d.list || []);
    });
    on('deleted', function (d) {
      if (!pid || removing[pid]) return;
      var by = d.by || 'хтось';
      toast('Проект видалив ' + by);
      pid = null;
      App.clearProject();
    });
    src.onerror = function () {
      if (es !== src) return;
      src.close();
      es = null;
      setLive(false);
      retry = Math.min(retry + 1, 6);
      setTimeout(async function () {
        if (es) return;
        try { await api('/api/session'); } catch (e) { setNet(!e.status); }
        if (!es) connect();
      }, Math.min(5000, 500 * retry));
    };
  }

  function setLive(v) {
    live = v;
    clearTimeout(liveTimer);
    if (v) { netDown = false; renderBanner(); return; }
    liveTimer = setTimeout(function () { if (!live) { netDown = true; renderBanner(); } }, 2000);
  }
  function setNet(v) { if (netDown === v) return; netDown = v; renderBanner(); }
  function setAuth(v) { if (authLost === v) return; authLost = v; renderBanner(); }

  function renderBanner() {
    var b = $('sk-banner');
    if (!b) return;
    b.textContent = '';
    var on = false;
    if (MODE === 'view' && viewInfo) {
      on = true;
      b.className = 'sk-banner view';
      b.appendChild(el('span', { text: 'Версія від ' + stamp(viewInfo.entry.t) + ' · ' + viewInfo.entry.label }));
      b.appendChild(el('button', { type: 'button', class: 'btn sm primary', text: 'Відновити', onclick: viewRestore }));
      b.appendChild(el('button', { type: 'button', class: 'btn sm', text: 'Закрити', onclick: function () { window.close(); location.href = '/p/' + viewInfo.id; } }));
    } else if (authLost) {
      on = true;
      b.className = 'sk-banner bad';
      b.appendChild(el('span', { text: 'Сесія завершилась' }));
      b.appendChild(el('button', { type: 'button', class: 'btn sm primary', text: 'Увійти', onclick: function () { window.open('/auth/login?next=' + encodeURIComponent('/auth/done'), '_blank'); } }));
    } else if (netDown || (outbox.length && !live)) {
      on = true;
      b.className = 'sk-banner warn';
      b.appendChild(el('span', { text: 'Немає звʼязку з сервером — зміни зачекають' }));
    }
    b.hidden = !on;
  }

  function renderPresence() {
    var box = $('sk-pres');
    if (!box) return;
    box.textContent = '';
    var list = presence.filter(function (u) { return u.kind === 'human'; });
    list.sort(function (a, b) { return (a.email === (me && me.email)) - (b.email === (me && me.email)); });
    list.slice(0, 5).forEach(function (u) { box.appendChild(avatar(u)); });
    if (list.length > 5) box.appendChild(el('span', { class: 'sk-av more', title: list.slice(5).map(function (u) { return u.name; }).join(', '), text: '+' + (list.length - 5) }));
    box.hidden = !list.length;
  }

  function renderMe() {
    var b = $('sk-me');
    if (!b || !me) return;
    b.textContent = '';
    b.appendChild(avatar(me));
    b.title = (me.name || '') + ' · ' + me.email;
    b.hidden = false;
  }
  function acctOutside(e) { if (!e.target.closest('#sk-acct') && !e.target.closest('#sk-me')) closeAcct(); }
  function acctKey(e) { if (e.key === 'Escape') { closeAcct(); var b = $('sk-me'); if (b) b.focus(); } }
  function closeAcct() {
    var m = $('sk-acct');
    if (m) m.remove();
    document.removeEventListener('pointerdown', acctOutside, true);
    document.removeEventListener('keydown', acctKey, true);
    var b = $('sk-me');
    if (b) b.setAttribute('aria-expanded', 'false');
  }
  function toggleAcct() {
    if ($('sk-acct')) { closeAcct(); return; }
    var b = $('sk-me'), r = b.getBoundingClientRect();
    var m = el('div', { class: 'sk-acct', id: 'sk-acct', role: 'menu', style: 'top:' + Math.round(r.bottom + 8) + 'px;right:' + Math.max(16, Math.round(window.innerWidth - r.right)) + 'px' }, [
      el('div', { class: 'sk-acct-who' }, [el('b', { text: me.name || me.email }), el('small', { text: me.email + (role === 'admin' ? ' · адмін' : '') })]),
      role === 'admin' ? el('button', { type: 'button', class: 'btn sm', role: 'menuitem', text: 'Кошик', onclick: function () { closeAcct(); openTrash(); } }) : null,
      el('button', { type: 'button', class: 'btn sm', role: 'menuitem', id: 'sk-logout', text: 'Вийти', onclick: logout })
    ]);
    document.body.appendChild(m);
    b.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', acctOutside, true);
    document.addEventListener('keydown', acctKey, true);
    m.querySelector('button').focus();
  }
  function logout() {
    var f = el('form', { method: 'post', action: '/auth/logout', hidden: true }, [el('input', { type: 'hidden', name: 'csrf', value: csrf })]);
    document.body.appendChild(f);
    f.submit();
  }
  async function openTrash() {
    var d = $('sk-trash');
    if (!d) {
      d = el('dialog', { class: 'dlg', id: 'sk-trash', 'aria-labelledby': 'sk-trash-h' }, [
        el('div', { class: 'dlg-head' }, [el('h3', { id: 'sk-trash-h', text: 'Кошик' }), el('button', { type: 'button', class: 'btn ghost icon', 'aria-label': 'Закрити', text: '✕', onclick: function () { d.close(); } })]),
        el('ol', { class: 'sk-trash', id: 'sk-trash-list' })
      ]);
      d.addEventListener('click', function (e) { if (e.target === d) d.close(); });
      document.body.appendChild(d);
    }
    if (!d.open) d.showModal();
    await renderTrash();
  }
  async function renderTrash() {
    var ul = $('sk-trash-list');
    if (!ul) return;
    var list;
    try { list = await getJson('/api/trash'); } catch (e) { list = null; }
    ul.textContent = '';
    if (!list || !list.length) { ul.appendChild(el('li', { class: 'sk-h-empty', text: list ? 'Кошик порожній' : 'Не вдалося відкрити кошик' })); return; }
    list.forEach(function (p) {
      var by = p.deleted && p.deleted.by ? p.deleted.by.name || p.deleted.by.email : '';
      ul.appendChild(el('li', { class: 'sk-t' }, [
        el('span', { class: 'sk-h-txt' }, [el('span', { class: 'sk-h-l', text: p.settings.game || 'Без назви' }), el('span', { class: 'sk-h-m', text: 'видалив ' + by + ' · ' + stamp(p.deleted.t) })]),
        el('button', { type: 'button', class: 'btn sm', text: 'Відновити', onclick: async function () {
          try { await postJson('/api/projects/' + encodeURIComponent(p.id) + '/undelete', {}); toast('Проект відновлено'); } catch (e) { toast('Не вдалося відновити: ' + e.message); }
          renderTrash();
        } })
      ]));
    });
  }

  function histView() { return App && App.hist ? App.hist.view : 'drafts'; }
  async function loadHist(more) {
    if (!pid) return;
    var key = pid + ':' + histView();
    var token = ++hc.token;
    var r = null;
    try {
      var last = more && hc.entries && hc.entries.length ? hc.entries[hc.entries.length - 1].id : '';
      r = await getJson('/api/projects/' + pid + '/history?scope=' + histView() + (last ? '&before=' + encodeURIComponent(last) : ''));
    } catch (e) { r = null; }
    if (token !== hc.token || key !== hc.key) return;
    hc.entries = (more && hc.entries ? hc.entries : []).concat((r && r.entries) || []);
    hc.more = !!(r && r.more);
    drawHist();
  }
  function histEvent(e) {
    if (!e || !pid || hc.key !== pid + ':' + e.scope || !hc.entries) return;
    var i = hc.entries.map(function (x) { return x.id; }).indexOf(e.id);
    if (i === -1) hc.entries.unshift(e);
    else hc.entries[i] = e;
    drawHist();
  }
  function entryLabel(e) {
    if (e.restoreOf) return 'Відкат до ' + stamp(e.restoreT) + ' · ' + (e.restoreLabel || '');
    return e.label;
  }
  function renderHist() {
    var d = $('hist-dlg');
    if (!d || !d.open) return;
    var sw = $('hist-auto');
    if (sw && sw.closest('label')) sw.closest('label').hidden = true;
    if ($('hist-foot')) $('hist-foot').hidden = true;
    Array.prototype.forEach.call(document.querySelectorAll('#hist-tabs .preset'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-scope') === histView())); });
    var top = document.querySelector('#hist-dlg .hist-top');
    if (top && !$('sk-name')) top.appendChild(el('div', { class: 'sk-name', id: 'sk-name' }));
    drawName();
    if (hc.key !== pid + ':' + histView()) { hc.entries = null; hc.key = pid + ':' + histView(); loadHist(false); }
    drawHist();
  }
  function drawName() {
    var box = $('sk-name');
    if (!box) return;
    box.textContent = '';
    if (MODE === 'view') return;
    if (!hc.naming) { box.appendChild(el('button', { type: 'button', class: 'btn sm', text: 'Назвати версію', onclick: function () { hc.naming = true; drawName(); var i = $('sk-name-in'); if (i) i.focus(); } })); return; }
    var input = el('input', { type: 'text', id: 'sk-name-in', maxlength: '120', placeholder: 'Назва версії', 'aria-label': 'Назва версії' });
    var save = async function () {
      var v = input.value.trim();
      if (!v) return;
      try { await postJson('/api/projects/' + pid + '/versions', { label: v }); toast('Версію названо'); } catch (e) { toast('Не вдалося: ' + e.message); }
      hc.naming = false;
      drawName();
    };
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') save(); if (e.key === 'Escape') { e.stopPropagation(); hc.naming = false; drawName(); } });
    box.appendChild(input);
    box.appendChild(el('button', { type: 'button', class: 'btn sm primary', text: 'Зберегти', onclick: save }));
  }
  function drawHist() {
    var d = $('hist-dlg'), ul = $('hist-list');
    if (!d || !d.open || !ul) return;
    ul.textContent = '';
    if (!hc.entries) { ul.appendChild(el('li', { class: 'sk-h-empty', text: 'Завантаження…' })); return; }
    if (!hc.entries.length) { ul.appendChild(el('li', { class: 'sk-h-empty', text: 'Записів немає' })); return; }
    hc.entries.forEach(function (e, i) {
      var who = e.by && e.by.kind === 'claude' ? 'Claude · ' + e.by.name : (e.by && e.by.name) || '';
      var acts = el('span', { class: 'sk-h-act' });
      if (i > 0 && MODE !== 'view') acts.appendChild(el('button', { type: 'button', class: 'btn sm', text: 'Відновити', onclick: function () { restore(e); } }));
      acts.appendChild(el('button', { type: 'button', class: 'btn sm ghost', text: 'Переглянути', onclick: function () { window.open('/p/' + pid + '?v=' + encodeURIComponent(e.id), '_blank'); } }));
      if (MODE !== 'view') acts.appendChild(el('button', { type: 'button', class: 'btn sm ghost', text: 'Копія', onclick: function () { copyFrom(e); } }));
      ul.appendChild(el('li', { class: 'sk-h' + (e.named ? ' named' : '') + (i === 0 ? ' now' : '') }, [
        avatar(e.by || {}),
        el('span', { class: 'sk-h-txt' }, [
          el('span', { class: 'sk-h-l', text: e.named ? '★ ' + e.named : entryLabel(e) }),
          el('span', { class: 'sk-h-m', text: who + ' · ' + stamp(e.t) + (i === 0 ? ' · зараз' : '') })
        ]),
        acts
      ]));
    });
    if (hc.more) ul.appendChild(el('li', null, [el('button', { type: 'button', class: 'btn sm ghost', text: 'Ще', onclick: function () { loadHist(true); } })]));
  }
  async function restore(e) {
    await serial(flushLocal);
    try {
      var r = await postJson('/api/projects/' + pid + '/restore', { entry: e.id, scope: e.scope });
      toast(r.nothing ? 'Вже в цьому стані' : 'Відновлено: ' + entryLabel(e));
    } catch (x) { toast('Не вдалося відновити: ' + x.message); }
  }
  async function copyFrom(e) {
    try {
      var r = await postJson('/api/projects/' + pid + '/copy', { entry: e.id });
      known[r.id] = true;
      var d = $('hist-dlg');
      if (d && d.open) d.close();
      await App.openProject(r.id);
      toast('Створено копію');
    } catch (x) { toast('Не вдалося: ' + x.message); }
  }
  async function viewRestore() {
    try {
      await postJson('/api/projects/' + viewInfo.id + '/restore', { entry: viewInfo.entry.id, scope: viewInfo.entry.scope });
      location.href = '/p/' + viewInfo.id;
    } catch (x) { toast('Не вдалося відновити: ' + x.message); }
  }

  var Store = {
    list: async function () {
      if (MODE === 'view') return viewInfo ? [{ id: viewInfo.id, created: viewInfo.doc.created, updated: viewInfo.doc.updated, settings: viewInfo.doc.settings }] : [];
      var l = await getJson('/api/projects');
      l.forEach(function (p) { known[p.id] = true; });
      return l.map(function (p) { return { id: p.id, created: p.created, updated: p.updated, settings: p.settings }; });
    },
    get: function (id) {
      return serial(async function () {
        var doc;
        if (MODE === 'view') doc = viewInfo && viewInfo.id === id ? viewInfo.doc : null;
        else { try { doc = await getJson('/api/projects/' + encodeURIComponent(id)); } catch (e) { return null; } }
        if (!doc) return null;
        var imgs = await filesFor(doc.images);
        var images = {};
        Object.keys(imgs).forEach(function (k) { images[k] = imgs[k].file; });
        setProject(id, doc);
        return { id: id, created: doc.created, updated: doc.updated, settings: clone(doc.settings), images: images, history: [] };
      });
    },
    put: async function (rec) {
      if (MODE === 'view') return;
      if (nested) { var st = stage(rec); nested.push(st); var x = await st; return x.ack; }
      var r = await serial(function () { return stage(rec); });
      return r.ack;
    },
    remove: async function (id) {
      if (MODE === 'view') return;
      removing[id] = true;
      try { await api('/api/projects/' + encodeURIComponent(id), { method: 'DELETE' }); } catch (e) { toast('Не вдалося видалити: ' + e.message); }
      delete known[id];
    },
    persistent: function () { return true; }
  };
  root.SpineKitStore = Store;

  var CSS = '.sk-pres{display:flex;align-items:center;padding-right:4px}.sk-pres[hidden]{display:none}'
    + '.sk-av{flex:none;display:inline-grid;place-items:center;width:28px;height:28px;border-radius:50%;color:#fff;font:600 11px/1 var(--f-text);letter-spacing:.02em;border:2px solid var(--paper);margin-left:-6px;user-select:none}'
    + '.sk-av:first-child{margin-left:0}.sk-av.more{background:rgb(var(--ink-rgb)/.16);color:var(--ink)}'
    + '.sk-banner{position:fixed;z-index:60;left:50%;top:12px;transform:translateX(-50%);display:flex;align-items:center;gap:10px;max-width:calc(100% - 32px);padding:8px 8px 8px 16px;border-radius:9999px;background:var(--card);color:var(--ink);border:1px solid rgb(var(--ink-rgb)/.14);font:500 14px/1.3 var(--f-text)}'
    + '.sk-banner[hidden]{display:none}.sk-banner::before{content:"";flex:none;width:8px;height:8px;border-radius:50%;background:var(--brand)}'
    + '.sk-banner.warn::before{background:var(--warning)}.sk-banner.bad::before{background:var(--destructive)}.sk-banner.warn{padding-right:16px}'
    + '.sk-name{display:flex;gap:8px;align-items:center}.sk-name input{font:inherit;height:34px;padding:0 12px;border-radius:9999px;border:1px solid var(--line);background:var(--field);color:var(--ink);width:180px}'
    + '.sk-h{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;column-gap:12px;row-gap:6px;min-height:52px;padding:8px 10px;border-radius:16px}'
    + '.sk-h .sk-av{margin:0;border:0}.sk-h.now{background:var(--card)}.sk-h.named .sk-h-l{color:var(--achievement);font-weight:600}'
    + '.sk-h-txt{display:grid;gap:2px;min-width:0}.sk-h-l{font-size:15px;line-height:1.35;overflow-wrap:anywhere}.sk-h-m{font:400 13px/1.2 var(--f-num);color:rgb(var(--ink-rgb)/.6)}'
    + '.sk-h-act{grid-column:2;display:none;gap:4px;flex-wrap:wrap}.sk-h:hover .sk-h-act,.sk-h:focus-within .sk-h-act{display:flex}@media (hover:hover){.sk-h:not(.now):hover{background:rgb(var(--ink-rgb)/.06)}}'
    + '@media (hover:none){.sk-h-act{display:flex}}.sk-h-empty{padding:16px 10px;color:rgb(var(--ink-rgb)/.6);font-size:14px}'
    + '.sk-me{flex:none;display:inline-grid;place-items:center;padding:0;margin:0 8px 0 4px;border:0;border-radius:50%;background:none;cursor:pointer}.sk-me[hidden]{display:none}.sk-me .sk-av{margin:0;border:0}'
    + '.sk-acct{position:fixed;z-index:70;display:grid;gap:8px;min-width:220px;max-width:calc(100% - 32px);padding:12px;border-radius:20px;background:var(--card);color:var(--ink);border:1px solid rgb(var(--ink-rgb)/.14);font:500 14px/1.3 var(--f-text)}'
    + '.sk-acct-who{display:grid;gap:2px;padding:2px 4px 6px}.sk-acct-who small{font-size:13px;color:rgb(var(--ink-rgb)/.6);overflow-wrap:anywhere}'
    + '.sk-trash{list-style:none;margin:0;padding:0 8px 12px;display:grid;gap:4px;min-width:min(420px,calc(100vw - 64px))}.sk-t{display:flex;align-items:center;gap:12px;padding:8px 10px;border-radius:16px}.sk-t .sk-h-txt{flex:1}';

  function mount() {
    document.head.appendChild(el('style', { text: CSS }));
    document.body.appendChild(el('div', { class: 'sk-banner', id: 'sk-banner', role: 'status', hidden: true }));
    var end = document.querySelector('.bar-end');
    if (end && !$('sk-pres')) end.insertBefore(el('div', { class: 'sk-pres', id: 'sk-pres', hidden: true, 'aria-label': 'Хто в проекті' }), end.firstChild);
    if (end && !$('sk-me')) end.insertBefore(el('button', { type: 'button', class: 'sk-me', id: 'sk-me', hidden: true, 'aria-label': 'Акаунт', 'aria-haspopup': 'menu', onclick: toggleAcct }), $('sk-pres').nextSibling);
    var lb = $('link-btn');
    if (lb) lb.hidden = true;
    window.addEventListener('beforeunload', function (e) {
      if (!outbox.length) return;
      e.preventDefault();
      e.returnValue = '';
    });
  }

  function pathId() {
    var m = /^\/p\/([A-Za-z0-9_-]{1,64})$/.exec(location.pathname);
    return m ? m[1] : null;
  }

  async function start(app) {
    App = app;
    mount();
    var s;
    try { s = await getJson('/api/session'); }
    catch (e) { location.href = '/auth/login?next=' + encodeURIComponent(location.pathname + location.search); return new Promise(function () {}); }
    me = s.user;
    role = s.role;
    csrf = s.csrf;
    renderMe();
    if (MODE === 'view') {
      var id = pathId(), v = new URL(location.href).searchParams.get('v');
      try { var r = await getJson('/api/projects/' + id + '/history/' + encodeURIComponent(v)); viewInfo = { id: id, entry: r.entry, doc: r.doc }; }
      catch (e) { toast('Версію не знайдено'); }
      renderBanner();
      return;
    }
    connect();
  }

  function wanted(last) {
    var id = pathId();
    if (id) return id;
    if (MODE === 'engine') return '';
    return last;
  }
  function opened(id) {
    if (MODE !== 'view' && location.pathname !== '/p/' + id) history.replaceState(null, '', '/p/' + id);
    if (MODE === 'view') return;
    serial(async function () {
      if (pid !== id) return;
      shadow = await build(App.state.s, App.state.blobs, confirmed);
      connect();
    });
  }
  function closed() {
    pid = null;
    confirmed = null;
    shadow = null;
    pending = [];
    presence = [];
    renderPresence();
    if (MODE !== 'view' && location.pathname !== '/') history.replaceState(null, '', '/');
    connect();
  }
  function step(dir) {
    if (MODE === 'view') return;
    serial(function () { return revert(dir); });
  }

  root.SpineKitSync = {
    mode: function () { return MODE; },
    start: start,
    wanted: wanted,
    opened: opened,
    closed: closed,
    step: step,
    renderHist: renderHist,
    me: function () { return me; },
    status: function () { return { pid: pid, v: lastV, pending: pending.length, outbox: outbox.length, live: live, undo: undo.length, redo: redo.length }; },
    app: function () { return App; },
    idle: async function () {
      for (var i = 0; i < 200; i++) {
        if (!tasks.length && !running && !outbox.length && !pending.length && !(App && App.dirty())) return true;
        await sleep(50);
      }
      return false;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
