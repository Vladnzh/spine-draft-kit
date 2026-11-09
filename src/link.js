(function (root) {
  'use strict';
  var KEY = 'spine-draft-kit.connect';
  var LOCAL = /^https?:$/.test(location.protocol) && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  var MODE_TAG = typeof document !== 'undefined' ? document.querySelector('meta[name="spine-kit-mode"]') : null;
  var ENGINE = !!MODE_TAG && MODE_TAG.content === 'engine';
  var SERVER = !!MODE_TAG && MODE_TAG.content === 'server';
  var LABELS = {
    status: 'стан кита', list_projects: 'список проектів', open_project: 'відкрив проект', create_project: 'створив проект', get_project: 'читає проект',
    update_game: 'налаштування гри', set_symbols: 'символи', update_component: 'компонент', add_component: 'додав компонент', remove_component: 'прибрав компонент',
    preview: 'превʼю', screenshot: 'скріншот', spin: 'спін', export_drafts: 'експорт драфту',
    get_layouts: 'читає лейаути', update_layout: 'лейаут', place_components: 'компоненти на лейауті', import_layouts: 'імпорт лейаутів', show_layout: 'показує лейаут',
    export_component: 'експорт компонента', import_component: 'імпорт компонента', import_final: 'імпорт фіналу', remove_final: 'повернув драфт',
    sandbox_get: 'читає пісочницю', sandbox_new: 'новий компонент у пісочниці', sandbox_update: 'пісочниця', sandbox_preview: 'дивиться пісочницю',
    sandbox_remove: 'прибрав з пісочниці', sandbox_save: 'зберіг у бібліотеку', sandbox_to_project: 'з пісочниці в чернетки',
    library_list: 'бібліотека', library_add: 'з бібліотеки в чернетки', library_remove: 'прибрав з бібліотеки'
  };
  var link = { local: false, info: null, es: null, online: false, replaced: false, agents: [], busy: null, log: [], backupAt: 0, backupError: '' };
  var App = null;

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
  function frame() { return new Promise(function (r) { requestAnimationFrame(function () { r(); }); }); }
  function clock(t) { var d = new Date(t); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2); }
  async function getJson(path) {
    var r = await fetch(path, { cache: 'no-store' });
    if (!r.ok) throw new Error(path + ' ' + r.status);
    return r.json();
  }
  async function sendJson(path, method, data) {
    var r = await fetch(path, { method: method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
    if (!r.ok) throw new Error(path + ' ' + r.status);
    return r.json();
  }
  function readWant() { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } }
  function writeWant(v) { try { if (v) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch (e) { return; } }

  async function probe() {
    if (!LOCAL) return false;
    try { link.info = await getJson('/api/info'); } catch (e) { return false; }
    return !!link.info && link.info.kit === 'spine-draft-kit';
  }

  var uploaded = new WeakMap();
  var waiting = {};
  var pushing = false;

  async function push(rec) {
    var files = {};
    var keys = Object.keys(rec.images || {});
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i], b = rec.images[k];
      var done = uploaded.get(b);
      if (done && done.pid === rec.id && done.key === k) { files[k] = done.file; continue; }
      var r = await fetch('/api/projects/' + rec.id + '/images/' + encodeURIComponent(k), { method: 'PUT', headers: { 'content-type': b.type || 'image/png' }, body: b });
      if (!r.ok) throw new Error('картинка ' + k + ': ' + r.status);
      var file = (await r.json()).file;
      uploaded.set(b, { pid: rec.id, key: k, file: file });
      files[k] = file;
    }
    await sendJson('/api/projects/' + rec.id, 'PUT', { id: rec.id, created: rec.created, updated: rec.updated, settings: rec.settings, images: files });
  }

  async function backup(rec) {
    if (!link.local || !rec || !rec.id) return;
    waiting[rec.id] = rec;
    if (pushing) return;
    pushing = true;
    try {
      while (Object.keys(waiting).length) {
        var id = Object.keys(waiting)[0];
        var next = waiting[id];
        delete waiting[id];
        try { await push(next); link.backupAt = Date.now(); link.backupError = ''; }
        catch (e) { link.backupError = e.message || String(e); }
      }
    } finally { pushing = false; renderPop(); }
  }

  async function forget(id) {
    if (!link.local) return;
    delete waiting[id];
    try { await fetch('/api/projects/' + id, { method: 'DELETE' }); } catch (e) { return; }
  }

  async function restore(Store) {
    link.local = await probe();
    renderButton();
    if (!link.local) return 0;
    var disk;
    try { disk = await getJson('/api/projects'); } catch (e) { return 0; }
    var recs = await Store.list();
    var mine = {}, onDisk = {}, n = 0;
    recs.forEach(function (r) { mine[r.id] = r; });
    for (var i = 0; i < disk.length; i++) {
      var d = disk[i];
      onDisk[d.id] = d;
      if (mine[d.id] && (mine[d.id].updated || 0) >= d.updated) continue;
      try {
        var p = await getJson('/api/projects/' + d.id);
        var images = {};
        var keys = Object.keys(p.images || {});
        for (var j = 0; j < keys.length; j++) {
          var file = p.images[keys[j]];
          var r = await fetch('/api/projects/' + d.id + '/images/' + encodeURIComponent(file), { cache: 'no-store' });
          if (!r.ok) continue;
          images[keys[j]] = await r.blob();
          uploaded.set(images[keys[j]], { pid: d.id, key: keys[j], file: file });
        }
        await Store.put({ id: p.id, created: p.created, updated: p.updated, settings: p.settings, images: images, history: mine[d.id] && mine[d.id].history });
        n++;
      } catch (e) { continue; }
    }
    recs.forEach(function (r) { var d = onDisk[r.id]; if (!d || (d.updated || 0) < (r.updated || 0)) backup(r); });
    return n;
  }

  function S() { return App.state; }
  function K() { return App.K; }
  function needProject() { if (!S().pid) throw new Error('Немає відкритого проекту'); }
  function symComp() { return S().s.components.filter(function (c) { return c.type === 'symbols'; })[0]; }
  function spineOf(c) { return 'animation_' + (K().slug(c.name).replace(/^animation_/, '') || 'element'); }
  function symName(n) { return K().slug(n).replace(/^animation_symbol_/, '').replace(/^symbol_/, '').replace(/_blur$/, ''); }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, Math.round(Number(v)))); }
  function num(v) { return v !== undefined && v !== null && isFinite(Number(v)); }
  function imageKey(c) { return c.type === 'custom' ? 'c:' + c.id : c.type === 'frame_under' || c.type === 'frame_above' ? c.type : null; }
  function compList() { return S().s.components.map(function (c) { return c.type === 'custom' ? c.id + ' (' + spineOf(c) + ')' : c.type; }).join(', '); }
  function findComp(id) {
    var cs = S().s.components, key = String(id || '');
    return cs.filter(function (c) { return c.id === key; })[0]
      || cs.filter(function (c) { return c.type === key && c.type !== 'custom'; })[0]
      || cs.filter(function (c) { return c.type === 'custom' && (c.name === key || spineOf(c) === key); })[0];
  }
  function closeWizard() { if (S().wiz) { S().wiz = null; App.renderWizard(); } }

  function eventsText(ev) {
    if (typeof ev === 'string') return ev;
    if (!Array.isArray(ev)) return '';
    return ev.map(function (e) { return typeof e === 'string' ? e : e.name + (e.int ? '(' + e.int + ')' : '') + (e.time ? '@' + e.time : ''); }).join(', ');
  }
  function keysOf(name, raw) {
    var nk = K().normKeys(raw);
    if (nk.errors.length) throw new Error('ключі ' + name + ': ' + nk.errors.join('; '));
    return Object.keys(nk.keys).length ? nk.keys : null;
  }
  function normAnims(list) {
    if (!Array.isArray(list)) throw new Error('anims має бути масивом');
    return list.map(function (a) {
      var name = String(a && a.name || '').trim();
      if (!name) throw new Error('анімація без назви');
      var P = K().PRESETS;
      var preset = P[a.preset] ? a.preset : K().presetFor(name, 'custom');
      var d = Number(a.duration);
      var row = App.A(name, isFinite(d) && d >= 0 ? d : (P[preset] && P[preset].duration) || 1, preset, !!a.loop, eventsText(a.events));
      var keys = a.keys === undefined || a.keys === null ? null : keysOf(name, a.keys);
      if (keys) row.keys = keys;
      return row;
    });
  }
  function mergeAnims(rows, list) {
    if (!Array.isArray(list)) throw new Error('anims має бути масивом');
    var P = K().PRESETS;
    list.forEach(function (a) {
      var name = String(a && a.name || '').trim();
      if (!name) throw new Error('анімація без назви');
      var row = rows.filter(function (r) { return r.name === name; })[0];
      if (!row) { rows.push(normAnims([a])[0]); return; }
      if (a.preset !== undefined) { if (!P[a.preset]) throw new Error(name + ': немає руху ' + a.preset); row.preset = a.preset; }
      if (num(a.duration) && Number(a.duration) >= 0) row.duration = Number(a.duration);
      if (typeof a.loop === 'boolean') row.loop = a.loop;
      if (a.events !== undefined) row.events = eventsText(a.events);
      if (a.keys === null) delete row.keys;
      else if (a.keys !== undefined) { var keys = keysOf(name, a.keys); if (keys) row.keys = keys; else delete row.keys; }
    });
    return rows;
  }

  var BAR_PARTS = ['bar', 'bar_fill', 'bar_shine', 'bar_head', 'bar_glow', 'bar_clip', 'bar_flash'];
  function reservedOf(c) {
    var out = ['root', 'art'];
    K().listOf(c.spacers).forEach(function (s) { var n = K().slug(String(s).split('@')[0]); if (n) out.push(n, n + '_bone'); });
    if (c.bar) out = out.concat(BAR_PARTS);
    return out;
  }
  function partsInfo(c) {
    return (c.parts || []).map(function (p) {
      var o = JSON.parse(JSON.stringify(p));
      var im = App.imageOf(App.partKey(c, p.name));
      o.image = im ? im.fileName || true : false;
      return o;
    });
  }
  function renamePartRefs(c, from, to) {
    (c.parts || []).forEach(function (p) { if (p.parent === from) p.parent = to; });
    (c.anims || []).forEach(function (a) {
      if (!a.keys || !a.keys[from]) return;
      var next = {};
      Object.keys(a.keys).forEach(function (k) { next[k === from ? to : k] = a.keys[k]; });
      a.keys = next;
    });
  }
  var PART_FIELDS = ['parent', 'x', 'y', 'w', 'h', 'pivot', 'rotate', 'behind', 'blend', 'alpha', 'shape', 'color'];
  async function applyParts(c, list, mode, remove) {
    var Kit = K();
    if (!Array.isArray(c.parts)) c.parts = [];
    var find = function (n) { return c.parts.filter(function (p) { return p.name === n; })[0]; };
    var drop = function (p) {
      c.parts = c.parts.filter(function (x) { return x !== p; });
      App.forgetImage(App.partKey(c, p.name));
      c.parts.forEach(function (x) { if (x.parent === p.name) x.parent = 'art'; });
    };
    (Array.isArray(remove) ? remove : []).forEach(function (r) {
      var p = find(Kit.slug(r));
      if (!p) throw new Error('немає частини ' + r + '. Є: ' + (c.parts.map(function (x) { return x.name; }).join(', ') || 'жодної'));
      drop(p);
    });
    var reserved = reservedOf(c), names = [];
    var items = Array.isArray(list) ? list : [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i] || {};
      var name = Kit.slug(it.name);
      if (!name) throw new Error('частина без назви: ' + JSON.stringify(it.name));
      var p = find(name);
      if (it.rename) {
        var nn = Kit.slug(it.rename);
        if (!p) throw new Error('немає частини ' + name + ' для перейменування');
        if (!nn) throw new Error('rename порожній');
        if (nn !== name && (find(nn) || reserved.indexOf(nn) !== -1)) throw new Error('назва ' + nn + ' вже зайнята');
        App.movePartImage(c, name, nn);
        renamePartRefs(c, name, nn);
        p.name = nn;
        name = nn;
      }
      if (reserved.indexOf(name) !== -1) throw new Error('частина не може зватись ' + name + ': це вже кістка чи слот компонента');
      var set = function (v) { return v !== undefined && v !== null && v !== ''; };
      if (set(it.blend) && Kit.BLENDS.indexOf(it.blend) === -1) throw new Error(name + ': blend ' + it.blend + ', можна ' + Kit.BLENDS.join(', '));
      if (set(it.shape) && Kit.SHAPES.indexOf(it.shape) === -1) throw new Error(name + ': shape ' + it.shape + ', можна ' + Kit.SHAPES.filter(Boolean).join(', '));
      if (set(it.pivot) && it.pivot !== 'center' && !Kit.pivotName(it.pivot)) throw new Error(name + ': pivot ' + it.pivot + ', можна center, bottom, top, left, right або "x:y"');
      if (set(it.color) && !Kit.hexOf(it.color)) throw new Error(name + ': color як "ffcc00"');
      ['x', 'y', 'w', 'h', 'rotate', 'alpha'].forEach(function (f) { if (set(it[f]) && !num(it[f])) throw new Error(name + '.' + f + ' має бути числом'); });
      if (!p) { p = { name: name }; c.parts.push(p); }
      PART_FIELDS.forEach(function (f) { if (it[f] === null) delete p[f]; else if (it[f] !== undefined) p[f] = it[f]; });
      if (it.remove_image) App.forgetImage(App.partKey(c, name));
      if (it.image) {
        var nat = await putImage(App.partKey(c, name), it.image);
        if (!num(it.w) && !num(it.h)) { p.w = nat.w; p.h = nat.h; }
      }
      var clean = Kit.normPart(p);
      Object.keys(p).forEach(function (k) { delete p[k]; });
      Object.assign(p, clean);
      if (names.indexOf(name) === -1) names.push(name);
    }
    c.parts.forEach(function (p) {
      if (p.parent !== 'art' && !find(p.parent)) throw new Error(p.name + ': немає батька ' + p.parent + '. Є: art, ' + c.parts.map(function (x) { return x.name; }).join(', '));
    });
    if (mode === 'replace') {
      c.parts.filter(function (p) { return names.indexOf(p.name) === -1; }).forEach(drop);
      c.parts = names.map(find).filter(Boolean);
    }
    if (!c.parts.length) delete c.parts;
  }
  function setPivot(c, v) {
    if (v === null || v === '' || v === 'center') { delete c.pivot; return; }
    var pv = K().pivotName(v);
    if (!pv) throw new Error('pivot: center, bottom, top, left, right або "x:y" (px від центру картинки, y угору)');
    c.pivot = pv;
  }

  async function putImage(key, img) {
    if (!img || !img.blob) throw new Error('картинка не передана');
    var r = await fetch('/api/bridge/blobs/' + img.blob, { cache: 'no-store' });
    if (!r.ok) throw new Error('картинка не дійшла: ' + img.name);
    var blob = await r.blob();
    try { return await App.setImage(key, blob, img.name); } catch (e) { throw new Error('картинка не читається: ' + img.name); }
  }

  async function commit() {
    App.renderGame();
    App.changed({ render: true, now: true });
    await sleep(40);
    await App.flush();
    await frame();
  }

  function warnings() {
    var out = [];
    (S().plan ? S().plan.spines : []).forEach(function (s) { s.warnings.forEach(function (w) { out.push(s.name + ': ' + w); }); });
    return out;
  }
  function summary() {
    var st = S();
    return { project: { id: st.pid, name: st.s.game }, grid: st.s.reels + 'x' + st.s.rows, cell: st.s.cell, spines: st.plan ? st.plan.spines.map(function (s) { return s.name; }) : [], warnings: warnings() };
  }
  function compInfo(c) {
    var key = imageKey(c);
    var o = { id: c.id, type: c.type, on: c.on !== false };
    if (c.type === 'custom') { o.spine = spineOf(c); o.label = c.label; o.w = c.w; o.h = c.h; o.x = c.x || 0; o.y = c.y || 0; if (c.pivot) o.pivot = c.pivot; if (c.bar) o.bar = c.bar; if (c.parts && c.parts.length) o.parts = partsInfo(c); }
    if (c.skins !== undefined) o.skins = c.skins;
    if (c.spacers !== undefined) o.spacers = c.spacers;
    if (key) o.image = S().images[key] ? S().images[key].fileName || true : false;
    if (c.anims) o.anims = c.anims;
    if (c.finals && Object.keys(c.finals).length) o.finals = App.fin.list(c);
    return o;
  }
  function finalOf(sp) {
    var v = sp.final, f = v.meta;
    var o = { imported: App.fin.iso(f.at), by: f.by || undefined, files: f.files || [], accepted_warnings: (f.accepted || []).map(function (a) { return a.id; }) };
    if (v.obj) {
      o.animations = Object.keys(v.obj.animations || {});
      o.skins = Array.isArray(v.obj.skins) ? v.obj.skins.map(function (s) { return s.name; }) : Object.keys(v.obj.skins || {});
    }
    var bad = v.ready && v.drift ? v.drift.errors.concat(v.drift.warnings).map(function (x) { return x.id + ' (' + x.title + ')'; }) : App.fin.issues(v);
    o.status = !bad.length ? 'відповідає драфту' : v.ready ? 'не відповідає драфту: ' + bad.join('; ') : 'не готовий, превʼю показує драфт, експорт зупиниться: ' + bad.join('; ');
    return o;
  }
  function finalNum(v) { return String(Math.round(Number(v) * 1000) / 1000).replace('.', ','); }
  function finalId(it, w, many) { return many ? it.sp.name + ':' + w.id : w.id; }
  function finalTaken(it, w, accept, many) { return accept.indexOf(finalId(it, w, many)) !== -1 || (!many && accept.indexOf(it.sp.name + ':' + w.id) !== -1); }
  function finalSig(items) {
    var s = JSON.stringify(items.map(function (it) { return [it.sp.name, it.r.errors.map(function (e) { return e.id; }), it.r.warnings.map(function (w) { return [w.id, w.title, w.detail]; })]; }));
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }
  function finalReport(it, accept, many) {
    var r = it.r, d = r.diff, m = it.m;
    return {
      spine: it.sp.name,
      files: [m.json && m.json.name, m.atlas && m.atlas.name].concat(Object.keys(m.pages || {}).map(function (k) { return m.pages[k].name; })).filter(Boolean),
      replaces: it.sp.final ? 'фінал від ' + (App.fin.iso(it.sp.final.meta.at) || 'невідомої дати') : 'драфт',
      ok: r.ok,
      errors: r.errors.map(function (f) { return { id: f.id, title: f.title, detail: f.detail }; }),
      warnings: r.warnings.map(function (f) { return { id: finalId(it, f, many), title: f.title, detail: f.detail, accepted: finalTaken(it, f, accept, many) }; }),
      notes: r.notes.map(function (f) { return f.title + (f.detail ? ': ' + f.detail : ''); }),
      changes: {
        animations: d.anims.filter(function (a) { return a.st !== 'same'; }).map(function (a) { return a.name + ': ' + (a.st === 'add' ? 'нова, ' + finalNum(a.b.d) + ' с' : a.st === 'del' ? 'немає у фіналі' : a.notes.map(function (n) { return n === 'події' ? 'події ' + a.a.ev + ' → ' + a.b.ev : n; }).join(', ')); }),
        skins: d.skins.filter(function (s) { return s.st !== 'same'; }).map(function (s) { return (s.st === 'add' ? '+' : '−') + s.name; }),
        spacers: d.spacers.filter(function (s) { return s.st !== 'same'; }).map(function (s) { return s.name + ': ' + ({ add: 'новий', del: 'немає', moved: 'зсунуто', kind: 'не спейсер' }[s.st] || s.st) + (s.a && s.b ? ' (' + finalNum(s.a.x) + ', ' + finalNum(s.a.y) + ' → ' + finalNum(s.b.x) + ', ' + finalNum(s.b.y) + ')' : ''); }),
        skeleton: d.skel.filter(function (x) { return x.st !== 'same'; }).map(function (x) { return x.k + ': ' + x.a + ' → ' + x.b; }),
        images_added: d.regions.add.length,
        images_removed: d.regions.del
      }
    };
  }

  function flat(cv, max) {
    var s = Math.min(1, (max || 1400) / Math.max(cv.width, cv.height));
    var c = el('canvas', { width: Math.max(1, Math.round(cv.width * s)), height: Math.max(1, Math.round(cv.height * s)) });
    var x = c.getContext('2d');
    x.fillStyle = getComputedStyle(document.body).backgroundColor || '#ffffff';
    x.fillRect(0, 0, c.width, c.height);
    x.drawImage(cv, 0, 0, c.width, c.height);
    return { data: c.toDataURL('image/png').split(',')[1], mime: 'image/png' };
  }
  function shot(target, max) {
    var cv = target === 'grid' ? $('grid-canvas') : target === 'layout' ? $('lay-canvas') : document.querySelector('#stage canvas');
    return cv && cv.width ? flat(cv, max) : null;
  }
  async function waitPlayer() {
    for (var i = 0; i < 60; i++) {
      var p = S().player;
      if (p && p.ready) return true;
      if (S().lib.spine === 'fail') return false;
      await sleep(100);
    }
    return false;
  }

  function LK() { return window.SpineKitLayouts; }
  function lays() { return App.lay.all(); }
  function r2(v) { return K().roundTo(Number(v), 2); }
  function findLayout(q) {
    var list = lays().list;
    if (q === undefined || q === null || String(q).trim() === '') return App.lay.cur();
    var k = String(q).trim(), low = k.toLowerCase();
    var L = list.filter(function (x) { return x.name === k; })[0]
      || list.filter(function (x) { return x.name.toLowerCase() === low || x.name.toLowerCase() === 'layout_' + low; })[0]
      || list.filter(function (x) { return LK().title(x) === k; })[0];
    if (!L) throw new Error('Немає лейауту «' + k + '». Є: ' + list.map(function (x) { return x.name + ' (' + LK().title(x) + ')'; }).join(', '));
    return L;
  }
  function boneExists(n) { return lays().list.some(function (L) { return LK().boneOf(L, n); }); }
  function layBound() {
    var m = {};
    App.lay.items().forEach(function (it) {
      var b = App.lay.boneFor(it.id);
      if (b && !lays().off[it.id]) (m[b] = m[b] || []).push(it.names);
    });
    return m;
  }
  function boneInfo(b, bound) {
    var o = { name: b.name, parent: b.parent, x: b.x, y: b.y };
    if (b.scaleX === b.scaleY) o.scale = b.scaleX;
    else { o.scale_x = b.scaleX; o.scale_y = b.scaleY; }
    if (b.rotation) o.rotation = b.rotation;
    if (!LK().stock(b.name)) o.custom = true;
    if (bound[b.name]) o.components = bound[b.name];
    var w = App.lay.warn(b);
    if (w) o.warning = w;
    return o;
  }
  function layInfo(L) {
    var bound = layBound();
    return { name: L.name, title: LK().title(L), w: L.w, h: L.h, screens: LK().screens(L).map(function (s) { return s[0]; }), template: !!LK().template(L.name), bones: LK().anchors(L).map(function (b) { return boneInfo(b, bound); }) };
  }
  function layComps() {
    var all = lays();
    return App.lay.items().map(function (it) {
      var b = App.lay.boneFor(it.id);
      var o = { id: it.id, title: it.title, spine: it.names, bone: b || null };
      if (typeof all.bind[it.id] !== 'string') o.default_bone = true;
      if (all.off[it.id]) o.hidden = true;
      var miss = b ? all.list.filter(function (L) { return !LK().boneOf(L, b); }).map(function (L) { return L.name; }) : [];
      if (miss.length) o.missing_in = miss;
      return o;
    });
  }
  function layWarnings() {
    var out = [];
    lays().list.forEach(function (L) { LK().anchors(L).forEach(function (b) { var w = App.lay.warn(b); if (w) out.push(L.name + ' ' + b.name + ': ' + w); }); });
    layComps().forEach(function (c) {
      if (!c.bone) out.push(c.spine + ': не стоїть на жодній кістці');
      else if (c.missing_in) out.push(c.spine + ': кістки ' + c.bone + ' немає в ' + c.missing_in.join(', '));
    });
    return out;
  }
  function layItem(id) {
    var key = String(id || '').trim();
    var items = App.lay.items();
    var want = /^(reels|symbols|frame_under|frame_above)$|^animation_reels/.test(key) ? 'reels' : (findComp(key) || {}).id;
    var it = items.filter(function (x) { return x.id === want || x.id === key; })[0];
    if (!it) throw new Error('Немає на лейауті «' + key + '» (компонент вимкнений або не існує). Є: ' + items.map(function (x) { return x.id === 'reels' ? 'reels' : x.id + ' (' + x.names + ')'; }).join(', '));
    return it;
  }
  function aspectOf(v, L) {
    if (num(v) && Number(v) > 0) return Number(v);
    var t = String(v).trim();
    var hit = LK().screens(L).filter(function (s) { return s[0] === t; })[0];
    if (hit) return hit[1];
    var m = /^(\d+(?:\.\d+)?)\s*[:x×\/]\s*(\d+(?:\.\d+)?)$/.exec(t);
    if (m && Number(m[2]) > 0) return Number(m[1]) / Number(m[2]);
    throw new Error('Екран «' + t + '»: число (ширина/висота) або «21:9». Пресети ' + L.name + ': ' + LK().screens(L).map(function (s) { return s[0]; }).join(', '));
  }
  async function layView(L) {
    var Y = App.lay;
    if (S().view !== 'layouts') App.showView('layouts');
    var i = L ? lays().list.indexOf(L) : -1;
    if (i !== -1 && i !== Y.st.cur) { Y.st.cur = i; Y.st.reset = false; }
    Y.render();
    await frame();
  }
  async function layCommit(L) {
    App.lay.save();
    await layView(L);
    await App.flush();
  }
  function drafts() { if (S().view === 'layouts' || S().view === 'sandbox') App.showView('drafts'); }

  function SB() { return App.sb; }
  async function sbIn() { if (ENGINE) await App.sb.pull(); }
  async function sbOut() { await commit(); await App.sb.flush(); }
  function sbNames() { return SB().list().map(function (c) { return c.id + ' (' + spineOf(c) + ')'; }).join(', ') || 'нічого'; }
  function sbFind(id) {
    var c = id ? SB().item(id) : SB().cur();
    if (!c) throw new Error(id ? 'У пісочниці немає «' + id + '». Є: ' + sbNames() : 'Пісочниця порожня: спершу sandbox_new');
    return c;
  }
  function sbWarn(c) { var sp = SB().plan(c); return sp ? sp.warnings : ['спайн не зібрався']; }
  function animSnap(c) { var o = {}; (c.anims || []).forEach(function (a) { if (a) o[a.name] = JSON.stringify(a); }); return o; }
  function animChanged(before, c) { return (c.anims || []).filter(function (a) { return a && before[a.name] !== JSON.stringify(a); }).map(function (a) { return a.name; }); }
  async function sbFields(c, a) {
    if (typeof a.name === 'string' && a.name.trim()) c.name = a.name.trim();
    if (typeof a.label === 'string' && a.label.trim()) c.label = a.label.trim();
    if (typeof a.skins === 'string') c.skins = a.skins;
    if (typeof a.spacers === 'string') c.spacers = a.spacers;
    if (typeof a.bar === 'string') c.bar = a.bar.trim();
    if (a.pivot !== undefined) setPivot(c, a.pivot);
    if (Array.isArray(a.anims)) c.anims = a.anims_mode === 'merge' ? mergeAnims(c.anims || [], a.anims) : normAnims(a.anims);
    if (a.parts || a.remove_parts) await applyParts(c, a.parts, a.parts_mode, a.remove_parts);
    if (a.remove_image) App.forgetImage('c:' + c.id);
    if (a.image) {
      var nat = await putImage('c:' + c.id, a.image);
      if (!num(a.w) && !num(a.h)) App.fitSize(c, nat);
    }
    ['w', 'h', 'x', 'y'].forEach(function (k) { if (num(a[k])) c[k] = Number(a[k]); });
  }
  async function sbLook(c, look, changed) {
    if (!look) return null;
    var o = typeof look === 'object' ? look : {};
    var want = o.animation ? { animation: o.animation } : changed && changed.length ? { animations: changed } : { animation: 'all' };
    return SB().film(Object.assign({ id: c.id, at: o.at }, want));
  }
  function withFilm(out, film) {
    if (!film) return out;
    out.preview = film.shown || [];
    out.animations = film.animations;
    if (film.note) out.note = film.note;
    out.images = film.images || [];
    return out;
  }
  async function fileData(f) {
    if (!f || !f.blob) throw new Error('файл не передано');
    var r = await fetch('/api/bridge/blobs/' + f.blob, { cache: 'no-store' });
    if (!r.ok) throw new Error('файл не дійшов: ' + f.name);
    var data;
    try { data = JSON.parse(await r.text()); } catch (e) { throw new Error('Не JSON: ' + f.name); }
    if (!data || data.kit !== App.COMP_KIT) throw new Error('Це не файл компонента кита (потрібен kit ' + App.COMP_KIT + ')');
    return data;
  }
  function libWords(q) { return String(q || '').toLowerCase().split(/\s+/).filter(Boolean); }
  function libOut(m) {
    return { id: m.id, label: m.label, spine: m.name, size: (m.w || 0) + 'x' + (m.h || 0), parts: m.parts, anims: m.anims, note: m.note || undefined, tags: m.tags && m.tags.length ? m.tags : undefined, by: m.by ? m.by.name || m.by.email : undefined, updated: m.updated ? new Date(m.updated).toISOString() : undefined };
  }

  var TOOLS = {
    status: async function () {
      var st = S(), sc = st.s && symComp();
      return {
        project: st.pid ? { id: st.pid, name: st.s.game, grid: st.s.reels + 'x' + st.s.rows, cell: st.s.cell } : null,
        symbols: sc ? sc.symbols.length : 0,
        components: !st.s ? [] : st.s.components.filter(function (c) { return c.on !== false; }).map(function (c) { return c.type === 'custom' ? spineOf(c) : c.type; }),
        projects: st.projects.length,
        wizard_open: !!st.wiz,
        preview: st.pv,
        projects_dir: link.info && link.info.projectsDir
      };
    },
    list_projects: async function () {
      var st = S();
      return { current: st.pid, projects: st.projects.map(function (p) { return { id: p.id, name: p.name, grid: p.reels + 'x' + p.rows, components: p.n, open: p.id === st.pid }; }), projects_dir: link.info && link.info.projectsDir };
    },
    open_project: async function (a) {
      var q = String(a.id || '').trim();
      var ps = S().projects;
      var p = ps.filter(function (x) { return x.id === q; })[0] || ps.filter(function (x) { return x.name.toLowerCase() === q.toLowerCase(); })[0];
      if (!p) throw new Error('Немає проекту «' + q + '». Є: ' + ps.map(function (x) { return x.name + ' (' + x.id + ')'; }).join(', '));
      closeWizard();
      if (p.id !== S().pid && !await App.openProject(p.id)) throw new Error('Проект не відкрито: у поточному є незбережені зміни, користувач скасував');
      App.toast('Claude відкрив проект ' + p.name);
      return summary();
    },
    create_project: async function (a) {
      var s = App.defaults();
      s.game = String(a.name || '').trim() || 'new-slot';
      if (num(a.reels)) s.reels = clamp(a.reels, 1, 12);
      if (num(a.rows)) s.rows = clamp(a.rows, 1, 12);
      if (num(a.cell_w)) s.cell.w = clamp(a.cell_w, 16, 2000);
      if (num(a.cell_h)) s.cell.h = clamp(a.cell_h, 16, 2000);
      s.components.forEach(function (c) {
        if (c.type === 'symbols' && Array.isArray(a.symbols)) {
          var seen = {};
          c.symbols = a.symbols.map(symName).filter(function (n) { if (!n || seen[n]) return false; seen[n] = true; return true; }).map(function (n) { return { name: n }; });
        }
        if (c.type === 'frame_under' && a.frame_under === false) c.on = false;
        if (c.type === 'frame_above' && a.frame_above === false) c.on = false;
      });
      closeWizard();
      if (!await App.createProject(s)) throw new Error('Проект не створено: у поточному є незбережені зміни, користувач скасував');
      await commit();
      App.toast('Claude створив проект ' + s.game);
      return summary();
    },
    get_project: async function () {
      needProject();
      var st = S();
      return {
        id: st.pid,
        settings: JSON.parse(JSON.stringify(st.s)),
        images: Object.keys(st.images).filter(function (k) { return k.indexOf('f:') !== 0; }).map(function (k) { var im = st.images[k]; return { key: k, file: im.fileName, w: im.w, h: im.h }; }),
        spines: st.plan ? st.plan.spines.map(function (sp) { var o = { name: sp.name, component: sp.comp, skins: sp.json.skins.map(function (s) { return s.name; }), animations: Object.keys(sp.json.animations), warnings: sp.warnings }; if (sp.final) o.final = finalOf(sp); return o; }) : []
      };
    },
    update_game: async function (a) {
      needProject();
      var s = S().s;
      if (typeof a.name === 'string') s.game = a.name.trim();
      if (num(a.reels)) s.reels = clamp(a.reels, 1, 12);
      if (num(a.rows)) s.rows = clamp(a.rows, 1, 12);
      if (num(a.cell_w)) s.cell.w = clamp(a.cell_w, 16, 2000);
      if (num(a.cell_h)) s.cell.h = clamp(a.cell_h, 16, 2000);
      if (typeof a.spine_version === 'string') s.tech.spineVersion = a.spine_version.trim();
      if (num(a.fps)) s.tech.fps = Math.round(Number(a.fps));
      if (typeof a.folder === 'string') s.tech.folder = a.folder.trim();
      await commit();
      App.toast('Claude змінив налаштування гри');
      return summary();
    },
    set_symbols: async function (a) {
      needProject();
      var st = S(), c = symComp();
      var find = function (n) { return c.symbols.filter(function (s) { return s.name === n; })[0]; };
      (a.remove || []).forEach(function (r) {
        var n = symName(r);
        c.symbols = c.symbols.filter(function (s) { return s.name !== n; });
        App.forgetSymbolImages(n);
      });
      var names = [];
      var list = Array.isArray(a.symbols) ? a.symbols : [];
      for (var i = 0; i < list.length; i++) {
        var it = list[i] || {};
        var name = symName(it.name);
        if (!name) throw new Error('символ без назви: ' + JSON.stringify(it.name));
        var s = find(name);
        if (it.rename) {
          var nn = symName(it.rename);
          if (!s) throw new Error('немає символу ' + name + ' для перейменування');
          if (nn !== name && find(nn)) throw new Error('символ ' + nn + ' вже є');
          App.moveSymbolImages(name, nn);
          s.name = nn;
          name = nn;
        }
        if (!s) { s = { name: name }; c.symbols.push(s); }
        if (it.image) await putImage('sym:' + name, it.image);
        if (it.blur_image) await putImage('blur:' + name, it.blur_image);
        else if (it.blur_image === null) App.forgetImage('blur:' + name);
        if (it.anims === null) s.ownAnims = false;
        else if (Array.isArray(it.anims)) { s.ownAnims = true; s.anims = normAnims(it.anims); }
        if (names.indexOf(name) === -1) names.push(name);
      }
      if (a.mode === 'replace') {
        c.symbols.filter(function (s) { return names.indexOf(s.name) === -1; }).forEach(function (s) { App.forgetSymbolImages(s.name); });
        c.symbols = names.map(find);
      }
      c.on = true;
      if (names.length) st.sel = names[names.length - 1];
      st.open[c.id] = true;
      await commit();
      App.toast('Claude оновив символи: ' + names.length);
      return { symbols: c.symbols.map(function (s) { var im = st.images['sym:' + s.name]; return { name: s.name, image: im ? im.fileName || true : false, own_anims: !!s.ownAnims }; }), warnings: warnings() };
    },
    update_component: async function (a) {
      needProject();
      var c = findComp(a.id);
      if (!c) throw new Error('Немає компонента «' + a.id + '». Є: ' + compList());
      var key = imageKey(c);
      if (typeof a.on === 'boolean') c.on = a.on;
      if (typeof a.skins === 'string' && c.type !== 'symbols' && c.type !== 'reels') c.skins = a.skins;
      if (typeof a.spacers === 'string' && c.type !== 'symbols' && c.type !== 'reels') c.spacers = a.spacers;
      if (Array.isArray(a.anims)) {
        if (c.type === 'reels') throw new Error('Анімації барабанів фіксовані');
        c.anims = a.anims_mode === 'merge' ? mergeAnims(c.anims || [], a.anims) : normAnims(a.anims);
      }
      if (typeof a.txt === 'boolean' && c.type === 'symbols') c.txt = a.txt;
      if (typeof a.blur === 'boolean' && c.type === 'symbols') c.blur = a.blur;
      if (num(a.fill) && c.type === 'symbols') c.fill = clamp(a.fill, 10, 100);
      if (c.type !== 'custom' && (a.parts || a.remove_parts || a.pivot !== undefined)) throw new Error('Частини й опорна точка є лише у своїх компонентах (custom)');
      if (c.type === 'custom') {
        if (typeof a.name === 'string' && a.name.trim()) { var was = spineOf(c); c.name = a.name.trim(); App.fin.move(c, was, spineOf(c)); }
        if (typeof a.label === 'string' && a.label.trim()) c.label = a.label.trim();
        if (typeof a.bar === 'string') c.bar = a.bar.trim();
        if (a.pivot !== undefined) setPivot(c, a.pivot);
        ['w', 'h', 'x', 'y'].forEach(function (k) { if (num(a[k])) c[k] = Number(a[k]); });
        if (a.parts || a.remove_parts) await applyParts(c, a.parts, a.parts_mode, a.remove_parts);
      }
      if (a.remove_image && key) App.forgetImage(key);
      if (a.image) {
        if (!key) throw new Error(c.type === 'symbols' ? 'Картинки символів: set_symbols' : 'У ' + c.type + ' немає картинки');
        var nat = await putImage(key, a.image);
        if (c.type === 'custom' && !num(a.w) && !num(a.h)) App.fitSize(c, nat);
      }
      S().open[c.id] = true;
      await commit();
      App.toast('Claude оновив компонент ' + (c.type === 'custom' ? spineOf(c) : c.type));
      return { component: compInfo(c), warnings: warnings() };
    },
    add_component: async function (a) {
      needProject();
      var t = App.templates[a.template || 'custom'];
      if (!t) throw new Error('Шаблон: ' + Object.keys(App.templates).join(', '));
      var st = S();
      var taken = st.s.components.filter(function (c) { return c.type === 'custom'; }).map(spineOf);
      var base = a.name ? 'animation_' + K().slug(a.name).replace(/^animation_/, '') : t.name;
      var name = base, n = 2;
      while (taken.indexOf(name) !== -1) name = base + '_' + n++;
      var c = App.fromTemplate(t, name);
      if (typeof a.label === 'string' && a.label.trim()) c.label = a.label.trim();
      if (typeof a.skins === 'string') c.skins = a.skins;
      if (typeof a.spacers === 'string') c.spacers = a.spacers;
      if (typeof a.bar === 'string') c.bar = a.bar.trim();
      if (a.pivot !== undefined) setPivot(c, a.pivot);
      if (Array.isArray(a.anims)) c.anims = a.anims_mode === 'merge' ? mergeAnims(c.anims, a.anims) : normAnims(a.anims);
      try {
        if (a.parts) { delete c.parts; await applyParts(c, a.parts, 'replace'); }
        if (a.image) { App.fitSize(c, await putImage('c:' + c.id, a.image)); }
      } catch (e) { App.forgetComponentImages(c); throw e; }
      ['w', 'h', 'x', 'y'].forEach(function (k) { if (num(a[k])) c[k] = Number(a[k]); });
      st.s.components.push(c);
      st.open[c.id] = true;
      st.pv = { spine: name, anim: null, skin: null };
      await commit();
      App.toast('Claude додав ' + name);
      return { component: compInfo(c), warnings: warnings() };
    },
    remove_component: async function (a) {
      needProject();
      var c = findComp(a.id);
      if (!c) throw new Error('Немає компонента «' + a.id + '». Є: ' + compList());
      if (c.type !== 'custom') throw new Error('Вбудовані компоненти вимикаються: update_component on:false');
      S().s.components = S().s.components.filter(function (x) { return x !== c; });
      App.forgetComponentImages(c);
      await commit();
      App.toast('Claude прибрав ' + spineOf(c));
      return summary();
    },
    export_component: async function (a) {
      needProject();
      var c = findComp(a.id);
      if (!c) { await sbIn(); c = App.sb.item(a.id); }
      if (!c) throw new Error('Немає компонента «' + a.id + '». Є: ' + compList());
      if (c.type !== 'custom') throw new Error('Експортуються лише свої компоненти (custom): ' + compList());
      var r = await App.exportComponent(c);
      var up = await fetch('/api/bridge/blobs?name=' + encodeURIComponent(r.name), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: r.text });
      if (!up.ok) throw new Error('файл не передався: ' + up.status);
      var data = JSON.parse(r.text);
      return { blob: (await up.json()).id, name: r.name, spine: spineOf(c), parts: (c.parts || []).map(function (p) { return p.name; }), anims: (c.anims || []).map(function (x) { return x.name + (x.keys ? ' (ключі)' : ''); }), images: Object.keys(data.images) };
    },
    import_component: async function (a) {
      needProject();
      if (!a.file || !a.file.blob) throw new Error('файл не передано');
      var r = await fetch('/api/bridge/blobs/' + a.file.blob, { cache: 'no-store' });
      if (!r.ok) throw new Error('файл не дійшов: ' + a.file.name);
      var data;
      try { data = JSON.parse(await r.text()); } catch (e) { throw new Error('Не JSON: ' + a.file.name); }
      if (!data || data.kit !== App.COMP_KIT) throw new Error('Це не файл компонента кита (потрібен kit ' + App.COMP_KIT + ', його пише export_component або кнопка «Експорт» у картці)');
      drafts();
      var c = await App.importComponent(data, { name: a.name });
      await commit();
      App.toast('Claude імпортував ' + spineOf(c));
      return { component: compInfo(c), warnings: warnings() };
    },
    import_final: async function (a) {
      needProject();
      var c = findComp(a.component), only = a.spine || null;
      var hit = c ? null : (S().plan ? S().plan.spines : []).filter(function (s) { return s.name === a.component; })[0];
      if (hit) { c = S().s.components.filter(function (x) { return x.id === hit.comp; })[0]; only = only || hit.name; }
      if (!c) throw new Error('Немає компонента «' + a.component + '». Є: ' + compList());
      var spines = (S().plan ? S().plan.spines : []).filter(function (s) { return s.comp === c.id; });
      if (!spines.length) throw new Error('У компонента немає спайнів: він вимкнений? Увімкни його через update_component on: true');
      if (only && !spines.some(function (s) { return s.name === only; })) throw new Error('У компонента немає спайна ' + only + '. Є: ' + spines.map(function (s) { return s.name; }).join(', '));
      var src = (Array.isArray(a.files) ? a.files : [a.files]).filter(Boolean);
      if (!src.length) throw new Error('files порожній: потрібні <спайн>.json, <спайн>.atlas і всі .png сторінки атласу з експорту Spine');
      var files = [], pid = S().pid, cid = c.id;
      for (var i = 0; i < src.length; i++) {
        var f = src[i];
        if (!f.blob) throw new Error('файл не передано: ' + (f.name || i));
        var r = await fetch('/api/bridge/blobs/' + f.blob, { cache: 'no-store' });
        if (!r.ok) throw new Error('файл не дійшов: ' + f.name);
        var b = await r.blob(), file = new File([b], f.name, { type: b.type });
        file.kitPath = f.path || f.name;
        files.push(file);
      }
      var res = await App.fin.check(c, await App.fin.read(files), only);
      c = S().pid === pid ? S().s.components.filter(function (x) { return x.id === cid; })[0] : null;
      if (!c) throw new Error('Поки йшла перевірка, компонент прибрали або відкрили інший проект: нічого не змінено');
      var accept = (Array.isArray(a.accept) ? a.accept : a.accept ? [a.accept] : []).map(String);
      var many = res.items.length > 1, sig = finalSig(res.items);
      var out = {
        component: c.type === 'custom' ? spineOf(c) : c.type,
        applied: false,
        check: sig,
        spines: res.items.map(function (it) { return finalReport(it, accept, many); }),
        without_files: res.match.spines.filter(function (m) { return !m.json; }).map(function (m) { return m.sp.name; }),
        unused_files: res.match.extra,
        runtime_checked: res.runtime
      };
      if (!res.items.length) { out.next = 'Жоден JSON не підійшов до спайнів компонента (' + spines.map(function (s) { return s.name; }).join(', ') + '). Назва файлу має збігатися зі спайном, або дай рівно один JSON для компонента з одним спайном.'; return out; }
      var errors = 0, warns = 0, open = [];
      res.items.forEach(function (it) {
        errors += it.r.errors.length;
        warns += it.r.warnings.length;
        it.r.warnings.forEach(function (w) { if (!finalTaken(it, w, accept, many)) open.push(finalId(it, w, many)); });
      });
      if (errors) out.next = 'Є помилки, імпорт заблоковано. Скажи людині, що виправити в Spine, і чекай новий експорт. Не змінюй компонент чи файли, щоб обійти помилки.';
      else if (a.apply !== true) out.next = open.length ? 'Нічого не змінено. Покажи людині кожне попередження (title і detail) та головні зміни і спитай про кожне окремо. Потім виклич import_final з apply: true, check: "' + sig + '" і accept, де лише ті id, які людина підтвердила.' : warns ? 'Нічого не змінено. Усі попередження вже в accept: якщо людина справді підтвердила кожне, виклич import_final з apply: true, check: "' + sig + '" і тим самим accept.' : 'Помилок і попереджень немає, нічого не змінено. Виклич import_final з apply: true, коли людина погодиться.';
      else if (open.length) out.next = 'Не імпортовано: не підтверджено ' + open.join(', ') + '. Кожне попередження людина читає й підтверджує сама; не додавай id в accept без її слова.';
      else if (warns && a.check !== sig) out.next = 'Не імпортовано: після перевірки змінилися файли або драфт, і попередження вже інші, ніж бачила людина. Покажи їй ці попередження ще раз і виклич import_final з check: "' + sig + '" та accept, які вона підтвердить.';
      else {
        drafts();
        await App.fin.apply(c, res.items, 'Claude');
        await commit();
        App.toast('Claude імпортував фінал: ' + res.items.map(function (it) { return it.sp.name; }).join(', '));
        out.applied = true;
        out.next = 'Імпортовано: превʼю й експорт (zip, арт-репо) тепер беруть фінал. Переглянь анімації через preview. remove_final повертає драфт.';
      }
      return out;
    },
    remove_final: async function (a) {
      needProject();
      var c = findComp(a.component), only = a.spine || null;
      if (!c) { c = S().s.components.filter(function (x) { return x.finals && x.finals[a.component]; })[0]; if (c) only = only || a.component; }
      if (!c) throw new Error('Немає компонента «' + a.component + '». Є: ' + compList());
      var have = Object.keys(c.finals || {});
      if (!have.length) throw new Error('У компонента немає імпортованого фіналу');
      if (only && have.indexOf(only) === -1) throw new Error('Фіналу для ' + only + ' немає. Фінали компонента: ' + have.join(', '));
      drafts();
      var gone = App.fin.remove(c, only);
      await commit();
      App.toast('Claude повернув драфт: ' + gone.join(', '));
      return { removed: gone, component: compInfo(c) };
    },
    preview: async function (a) {
      needProject();
      var st = S();
      var spines = st.plan ? st.plan.spines : [];
      var sp = spines.filter(function (s) { return s.name === (a.spine || st.pv.spine); })[0] || (a.spine ? null : spines[0]);
      if (!sp) throw new Error('Немає спайна «' + a.spine + '». Є: ' + spines.map(function (s) { return s.name; }).join(', '));
      var fv = !a.draft && App.fin.live(sp) ? sp.final.obj : null, pj = fv || sp.json;
      var anims = Object.keys(pj.animations || {}), skins = Array.isArray(pj.skins) ? pj.skins.map(function (s) { return s.name; }) : Object.keys(pj.skins || {});
      if (a.animation && anims.indexOf(a.animation) === -1) throw new Error('У ' + sp.name + (fv ? ' (фінал)' : '') + ' немає анімації ' + a.animation + '. Є: ' + anims.join(', '));
      if (a.skin && skins.indexOf(a.skin) === -1) throw new Error('У ' + sp.name + (fv ? ' (фінал)' : '') + ' немає скіна ' + a.skin + '. Є: ' + skins.join(', '));
      st.pv = { spine: sp.name, anim: a.animation || null, skin: a.skin || null, draft: a.draft ? sp.name : null };
      drafts();
      App.renderPreview();
      App.renderComponents();
      var ok = await waitPlayer();
      await sleep(1000 * (num(a.at) ? Math.max(0, Number(a.at)) : 0.4));
      var img = ok ? shot('preview') : null;
      return { spine: sp.name, version: fv ? 'фінал аніматора' : 'драфт кита', animation: st.pv.anim, skin: st.pv.skin, animations: anims, skins: skins, note: ok ? undefined : 'Рантайм Spine не готовий, скріншота немає', images: img ? [img] : [] };
    },
    screenshot: async function (a) {
      var t = a.target || 'both';
      if (t !== 'grid') drafts();
      await frame();
      var out = [];
      if (t !== 'preview') { var g = shot('grid'); if (g) out.push(g); }
      if (t !== 'grid') { await waitPlayer(); var p = shot('preview'); if (p) out.push(p); }
      return { target: t, preview: S().pv, images: out };
    },
    spin: async function (a) {
      needProject();
      if (a.layout) await layView(findLayout(a.layout));
      var wait = Date.now();
      while (App.spinning() && Date.now() - wait < 20000) await sleep(100);
      $('spin-win').checked = !!a.win;
      $('spin-quick').checked = !!a.quick;
      App.startSpin();
      await sleep(120);
      if (!App.spinning()) throw new Error('Спін не запустився' + ($('spin-go').title ? ': ' + $('spin-go').title : ''));
      wait = Date.now();
      while (App.spinning() && Date.now() - wait < 30000) await sleep(100);
      await sleep(a.win ? 1200 : 250);
      var inLay = S().view === 'layouts';
      if (inLay) await frame();
      var g = shot(inLay ? 'layout' : 'grid');
      return { done: !App.spinning(), view: inLay ? 'layout ' + App.lay.cur().name : 'grid', images: g ? [g] : [] };
    },
    export_drafts: async function (a) {
      needProject();
      var st = S();
      var spines = st.plan ? st.plan.spines : [];
      if (!spines.length) throw new Error('Немає спайнів: увімкніть компоненти');
      for (var i = 0; i < 100 && !window.JSZip; i++) await sleep(100);
      if (!window.JSZip) throw new Error('JSZip не завантажився');
      var name = (K().slug(st.s.game) || 'slot') + '-spine-drafts.zip';
      var keep = st.skip;
      if (typeof a.layouts === 'boolean') {
        st.skip = {};
        Object.keys(keep).forEach(function (k) { if (k.indexOf('layout:') !== 0) st.skip[k] = keep[k]; });
        st.skip.layouts = !a.layouts;
      }
      var layNames = App.lay.names();
      var blob;
      try { blob = await App.buildZip(spines); } finally { st.skip = keep; }
      var r = await fetch('/api/bridge/blobs?name=' + encodeURIComponent(name), { method: 'PUT', headers: { 'content-type': 'application/zip' }, body: blob });
      if (!r.ok) throw new Error('zip не передався: ' + r.status);
      return { blob: (await r.json()).id, name: name, spines: spines.length, layouts: layNames.length ? { folder: App.lay.folder(), files: layNames } : null };
    },
    get_layouts: async function (a) {
      needProject();
      var cur = App.lay.cur();
      var list = a.layout ? [findLayout(a.layout)] : lays().list;
      return {
        current: cur ? cur.name : null,
        tab_open: S().view === 'layouts',
        folder: App.lay.folder(),
        layouts: list.map(layInfo),
        components: layComps(),
        warnings: layWarnings()
      };
    },
    update_layout: async function (a) {
      needProject();
      var Y = App.lay, all = lays(), L = findLayout(a.layout), added = [];
      var nn = typeof a.name === 'string' && a.name.trim() ? K().slug(a.name) : '';
      if (typeof a.name === 'string' && a.name.trim() && !nn) throw new Error('Порожня назва лейауту');
      if (nn && all.list.some(function (x) { return x !== L && x.name === nn; })) throw new Error('Лейаут ' + nn + ' вже є');
      var t = a.reset ? LK().template(L.name) : null;
      if (a.reset && !t) throw new Error('Для ' + L.name + ' немає шаблону Pandora');
      var removes = (Array.isArray(a.remove_bones) ? a.remove_bones : []).map(function (n) {
        var b = Y.boneName(n);
        if (!boneExists(b)) throw new Error('Немає кістки ' + b);
        if (LK().stock(b)) throw new Error(b + ' — кістка шаблону Pandora, гра її чекає: не видаляється');
        return b;
      });
      var taken = {};
      var edits = (Array.isArray(a.bones) ? a.bones : []).map(function (it) {
        it = it || {};
        if (/^area_/.test(K().slug(it.name))) throw new Error('area_* кістки фіксовані: міняй кістки position_*');
        var name = Y.boneName(it.name);
        if (!name) throw new Error('кістка без назви: ' + JSON.stringify(it.name));
        if (removes.indexOf(name) !== -1) throw new Error(name + ' і в bones, і в remove_bones');
        if (it.parent !== undefined && it.parent !== 'root' && LK().AREAS.indexOf(it.parent) === -1) throw new Error(name + ': батько root або ' + LK().AREAS.join(', '));
        ['x', 'y', 'scale', 'scale_x', 'scale_y', 'rotation'].forEach(function (k) { if (it[k] !== undefined && !num(it[k])) throw new Error(name + '.' + k + ' має бути числом'); });
        var to = '';
        if (it.rename) {
          to = Y.boneName(it.rename);
          if (!to) throw new Error('rename порожній для ' + name);
          if (!boneExists(name)) throw new Error('Немає кістки ' + name + ' для перейменування');
          if (LK().stock(name)) throw new Error(name + ' — кістка шаблону Pandora: не перейменовується');
          if (to !== name && (boneExists(to) || taken[to])) throw new Error('Кістка ' + to + ' вже є');
          taken[to] = true;
        }
        return { it: it, name: name, to: to };
      });
      if (t) {
        t.bones = t.bones.concat(L.bones.filter(function (x) { return !LK().isArea(x.name) && !LK().stock(x.name); }));
        all.list[all.list.indexOf(L)] = t;
        L = t;
      }
      if (nn && nn !== L.name) {
        if (Y.st.scr[L.name]) { Y.st.scr[nn] = Y.st.scr[L.name]; delete Y.st.scr[L.name]; }
        L.name = nn;
      }
      if (num(a.w)) L.w = clamp(a.w, 1, 10000);
      if (num(a.h)) L.h = clamp(a.h, 1, 10000);
      removes.forEach(function (n) { Y.remove(n); });
      edits.forEach(function (e) {
        var it = e.it, name = e.name;
        if (e.to && e.to !== name) { Y.rename(name, e.to); name = e.to; }
        if (!LK().boneOf(L, name)) {
          all.list.forEach(function (x) { if (!LK().boneOf(x, name)) x.bones.push(LK().cleanBone({ name: name, parent: 'area_center', x: Math.round(x.w / 2), y: -Math.round(x.h / 2) })); });
          added.push(name);
        }
        var b = LK().boneOf(L, name);
        if (it.parent) b.parent = it.parent;
        if (num(it.x)) b.x = r2(it.x);
        if (num(it.y)) b.y = r2(it.y);
        if (num(it.scale)) { b.scaleX = r2(it.scale); b.scaleY = r2(it.scale); }
        if (num(it.scale_x)) b.scaleX = r2(it.scale_x);
        if (num(it.scale_y)) b.scaleY = r2(it.scale_y);
        if (num(it.rotation)) b.rotation = r2(it.rotation);
        Y.st.sel = name;
      });
      await layCommit(L);
      App.toast('Claude змінив лейаут ' + L.name);
      var out = { layout: layInfo(L), warnings: layWarnings() };
      if (added.length) out.added = added.map(function (n) { return n + ': додано в усі лейаути; в інших стоїть по центру (area_center), задай там значення окремо'; });
      return out;
    },
    place_components: async function (a) {
      needProject();
      var Y = App.lay, all = lays();
      var list = Array.isArray(a.components) ? a.components : [];
      if (!list.length) throw new Error('components порожній');
      var plan = list.map(function (p) {
        p = p || {};
        var it = layItem(p.id);
        var bone;
        if (p.bone === null) bone = null;
        else if (p.bone === '') bone = '';
        else if (p.bone !== undefined) {
          bone = Y.boneName(p.bone);
          if (!bone || !boneExists(bone)) throw new Error('Немає кістки ' + (bone || p.bone) + '. Додай її: update_layout bones');
        }
        return { id: it.id, bone: bone, hidden: p.hidden };
      });
      var last = null;
      plan.forEach(function (p) {
        if (p.bone === null) delete all.bind[p.id];
        else if (p.bone !== undefined) all.bind[p.id] = p.bone;
        if (p.hidden === true) all.off[p.id] = true;
        else if (p.hidden === false) delete all.off[p.id];
        var b = Y.boneFor(p.id);
        if (b) last = b;
      });
      var L = a.layout ? findLayout(a.layout) : Y.cur();
      if (last && LK().boneOf(L, last)) Y.st.sel = last;
      await layCommit(L);
      App.toast('Claude розставив компоненти на лейаутах');
      return { components: layComps(), warnings: layWarnings() };
    },
    import_layouts: async function (a) {
      needProject();
      var Y = App.lay, all = lays(), done = [], skipped = [], got = [];
      (Array.isArray(a.files) ? a.files : []).forEach(function (f) {
        try { got.push(LK().parse(f.text, f.name)); }
        catch (e) { skipped.push(f.name + ': ' + (e.message || e)); }
      });
      if (!got.length) throw new Error('Жодного лейауту' + (skipped.length ? ': ' + skipped.join('; ') : ''));
      if (a.mode === 'replace') {
        var seen = {};
        all.list = got.filter(function (L) { if (seen[L.name]) return false; seen[L.name] = true; return true; });
        all.list.forEach(function (L) { done.push({ name: L.name, w: L.w, h: L.h }); });
      } else {
        got.forEach(function (L) {
          var at = all.list.map(function (x) { return x.name; }).indexOf(L.name);
          if (at === -1) all.list.push(L);
          else all.list[at] = L;
          done.push({ name: L.name, w: L.w, h: L.h, replaced: at !== -1 });
        });
      }
      Y.st.sel = null;
      Y.st.reset = false;
      await layCommit(got[got.length - 1]);
      App.toast('Claude імпортував лейаути: ' + done.map(function (d) { return d.name; }).join(', '));
      return { imported: done, skipped: skipped, layouts: all.list.map(function (L) { return L.name; }), components: layComps(), warnings: layWarnings() };
    },
    show_layout: async function (a) {
      needProject();
      var Y = App.lay, L = findLayout(a.layout);
      if (a.bone !== undefined) {
        var bn = a.bone ? Y.boneName(a.bone) : null;
        if (bn && !LK().boneOf(L, bn)) throw new Error('У ' + L.name + ' немає кістки ' + bn);
        Y.st.sel = bn;
      }
      if (typeof a.marks === 'boolean') { Y.st.marks = a.marks; $('lay-marks').checked = a.marks; }
      var list = LK().screens(L);
      var want = a.screen === 'all' ? list : a.screen === undefined || a.screen === null || a.screen === '' ? null : [[String(a.screen), aspectOf(a.screen, L)]];
      if (want && !want.length) want = null;
      await layView(L);
      var images = [], names = [];
      if (!want) {
        var now = Y.st.scr[L.name] > 0 ? Y.st.scr[L.name] : L.w / L.h;
        var hit = list.filter(function (s) { return Math.abs(s[1] - now) < 0.005; })[0];
        images.push(shot('layout'));
        names.push(hit ? hit[0] : String(Math.round(now * 1000) / 1000));
      }
      var keep = Y.st.scr[L.name];
      for (var i = 0; want && i < want.length; i++) {
        Y.st.scr[L.name] = want[i][1];
        Y.render();
        await frame();
        images.push(shot('layout', want.length > 1 ? 1000 : 1400));
        names.push(want[i][0]);
      }
      if (want && want.length > 1) {
        if (keep > 0) Y.st.scr[L.name] = keep;
        else delete Y.st.scr[L.name];
        Y.render();
      }
      return { layout: L.name, size: L.w + 'x' + L.h, screens: names, presets: list.map(function (s) { return s[0]; }), selected: Y.st.sel, images: images.filter(Boolean) };
    },
    sandbox_get: async function (a) {
      needProject();
      await sbIn();
      if (a.id) return SB().info(sbFind(a.id), true);
      var cur = SB().cur();
      return { personal: true, shown: cur ? cur.id : null, items: SB().list().map(function (c) { return SB().info(c, false); }), library: App.lib.api.mode() === 'server' ? 'team server' : 'this browser' };
    },
    sandbox_new: async function (a) {
      needProject();
      await sbIn();
      var srcs = ['template', 'from_library', 'from_component', 'file'].filter(function (k) { return a[k]; });
      if (srcs.length > 1) throw new Error('Одне джерело: template, from_library, from_component або from_file');
      var c;
      if (a.from_library) c = await SB().fromLib(a.from_library);
      else if (a.from_component) {
        var src = findComp(a.from_component);
        if (!src || src.type !== 'custom') throw new Error('У чернетках немає свого компонента «' + a.from_component + '». Є: ' + compList());
        c = await SB().fromComp(src);
      } else if (a.file) c = await SB().fromData(await fileData(a.file));
      else {
        var key = a.template || 'custom';
        if (!App.templates[key]) throw new Error('Шаблон: ' + Object.keys(App.templates).join(', '));
        c = SB().fromTemplate(key);
      }
      try { await sbFields(c, a); }
      catch (e) { SB().remove(c); await sbOut(); throw e; }
      await sbOut();
      SB().show(c.id);
      App.toast('Claude: у пісочниці ' + spineOf(c));
      var out = { item: SB().info(c, false), warnings: sbWarn(c), note: 'Користувач бачить це наживо у вкладці «Пісочниця».' };
      return withFilm(out, await sbLook(c, a.preview, null));
    },
    sandbox_update: async function (a) {
      needProject();
      await sbIn();
      var c = sbFind(a.id);
      var before = animSnap(c);
      await sbFields(c, a);
      var ch = animChanged(before, c);
      await sbOut();
      SB().show(c.id, ch[0]);
      App.toast('Claude змінив ' + spineOf(c) + ' у пісочниці');
      return withFilm({ item: SB().info(c, false), changed_animations: ch, warnings: sbWarn(c) }, await sbLook(c, a.preview, ch));
    },
    sandbox_preview: async function (a) {
      needProject();
      await sbIn();
      var c = sbFind(a.id);
      return SB().film({ id: c.id, animation: a.animation, at: a.at, skin: a.skin, bg: a.bg });
    },
    sandbox_remove: async function (a) {
      needProject();
      await sbIn();
      var c = sbFind(a.id);
      SB().remove(c);
      await sbOut();
      App.toast('Claude прибрав ' + spineOf(c) + ' з пісочниці');
      return { removed: c.id, items: SB().list().map(function (x) { return SB().info(x, false); }) };
    },
    sandbox_save: async function (a) {
      needProject();
      await sbIn();
      var c = sbFind(a.id);
      var r = await SB().save(c, { asNew: !!a.as_new, label: a.label, note: a.note, tags: Array.isArray(a.tags) ? a.tags : undefined });
      await sbOut();
      return { saved: true, updated_existing: r.updated, library: libOut(r.item), where: App.lib.api.mode() === 'server' ? 'бібліотека команди на сервері' : 'бібліотека цього браузера' };
    },
    sandbox_to_project: async function (a) {
      needProject();
      await sbIn();
      var c = sbFind(a.id);
      var nc = await SB().toProject(c, { name: a.name });
      await commit();
      App.toast('Claude додав ' + spineOf(nc) + ' у «Чернетки»');
      return { component: compInfo(nc), warnings: warnings() };
    },
    library_list: async function (a) {
      var L = App.lib.api;
      var items = await L.list();
      if (a.id) {
        var got = await L.get(a.id);
        if (!got) throw new Error('Немає компонента ' + a.id + ' у бібліотеці');
        return Object.assign(libOut(got.meta), { component: got.component, images: Object.keys(got.images) });
      }
      var words = libWords(a.query);
      var hit = items.filter(function (m) {
        var hay = [m.label, m.name, m.note, (m.tags || []).join(' '), m.by && m.by.name, m.by && m.by.email].join(' ').toLowerCase();
        return words.every(function (w) { return hay.indexOf(w) !== -1; });
      });
      return { total: items.length, where: L.mode() === 'server' ? 'team server' : 'this browser', items: hit.slice(0, 100).map(libOut) };
    },
    library_add: async function (a) {
      needProject();
      var nc = await App.lib.add(a.id, { name: a.name });
      await commit();
      App.toast('Claude додав ' + spineOf(nc) + ' з бібліотеки');
      return { component: compInfo(nc), warnings: warnings() };
    },
    library_remove: async function (a) {
      var L = App.lib.api;
      var m = (await L.list()).filter(function (x) { return x.id === a.id; })[0];
      if (!m) throw new Error('Немає компонента ' + a.id + ' у бібліотеці');
      if (!L.canEdit(m)) throw new Error('Видалити може лише автор: ' + ((m.by && (m.by.name || m.by.email)) || 'невідомо'));
      await L.remove(a.id);
      return { removed: true, id: a.id };
    }
  };

  var calls = [];
  var running = false;
  function note(tool, ok, text) {
    link.log.unshift({ at: Date.now(), tool: tool, ok: ok, text: text || '' });
    link.log.length = Math.min(link.log.length, 30);
  }
  async function execute(c) {
    var out;
    link.busy = LABELS[c.tool] || c.tool;
    renderButton();
    try {
      if (!TOOLS[c.tool]) throw new Error('Невідомий інструмент ' + c.tool);
      out = { id: c.id, ok: true, result: await TOOLS[c.tool](c.args || {}) };
      note(c.tool, true);
    } catch (e) {
      out = { id: c.id, ok: false, error: (e && e.message) || String(e) };
      note(c.tool, false, out.error);
    }
    if (ENGINE && App.sb && App.sb.forget) App.sb.forget();
    link.busy = null;
    renderButton();
    renderPop();
    try { await sendJson(ENGINE ? '/api/engine/result' : '/api/bridge/result', 'POST', out); } catch (e) { return; }
  }
  async function enqueue(c) {
    calls.push(c);
    if (running) return;
    running = true;
    try { while (calls.length) await execute(calls.shift()); } finally { running = false; }
  }

  function connect() {
    if (!link.local || link.es || !App) return;
    link.replaced = false;
    var es = new EventSource('/api/bridge/page');
    link.es = es;
    es.addEventListener('hello', function (e) { var d = JSON.parse(e.data); link.info = d; link.agents = d.agents || []; link.online = true; renderButton(); renderPop(); });
    es.addEventListener('agents', function (e) { link.agents = JSON.parse(e.data).agents || []; renderButton(); renderPop(); });
    es.addEventListener('call', function (e) { enqueue(JSON.parse(e.data)); });
    es.addEventListener('replaced', function () { link.replaced = true; disconnect(); });
    es.onerror = function () { link.online = false; renderButton(); renderPop(); };
    renderButton();
    renderPop();
  }
  function connectEngine() {
    if (link.es || !App) return;
    var es = new EventSource('/api/engine/calls');
    link.es = es;
    es.addEventListener('call', function (e) { enqueue(JSON.parse(e.data)); });
    es.onopen = function () { link.online = true; };
    es.onerror = function () { link.online = false; };
  }
  function disconnect() {
    if (link.es) { link.es.close(); link.es = null; }
    link.online = false;
    link.agents = [];
    renderButton();
    renderPop();
  }
  function toggle(on) {
    writeWant(on);
    if (on) connect();
    else { link.replaced = false; disconnect(); }
  }

  function status() {
    if (SERVER && root.SpineKitSync && root.SpineKitSync.linkState) return root.SpineKitSync.linkState();
    if (!link.local) return { key: 'off', text: 'Connect', line: 'Офлайн-версія: підключення працює з локального сервера' };
    if (link.busy) return { key: 'busy', text: 'Claude', line: 'Claude працює: ' + link.busy };
    if (link.replaced) return { key: 'off', text: 'Connect', line: 'Кит підключений в іншій вкладці' };
    if (!link.es) return { key: 'off', text: 'Connect', line: 'Не підключено' };
    if (!link.online) return { key: 'wait', text: 'Connect', line: 'Шукаю сервер кита…' };
    if (!link.agents.length) return { key: 'wait', text: 'Очікує', line: 'Кит на звʼязку, чекаю Claude' };
    return { key: 'on', text: 'Claude', line: 'Підключено: ' + link.agents.map(function (a) { return a.name; }).join(', ') };
  }
  function renderButton() {
    var b = $('link-btn');
    if (!b) return;
    var st = status();
    b.setAttribute('data-state', st.key);
    $('link-txt').textContent = st.text;
    b.title = st.line;
    b.setAttribute('aria-label', 'Підключення Claude: ' + st.line);
    var m = $('menu-btn');
    if (!m) return;
    m.setAttribute('data-state', link.local ? st.key : 'none');
    m.title = link.local ? 'Проекти · ' + st.line : 'Проекти';
  }

  function copyBtn(text) {
    var b = el('button', { type: 'button', class: 'btn sm', text: 'Копіювати' });
    b.addEventListener('click', async function () {
      try { await navigator.clipboard.writeText(text); b.textContent = 'Скопійовано'; }
      catch (e) { b.textContent = 'Виділіть і скопіюйте'; }
      setTimeout(function () { b.textContent = 'Копіювати'; }, 1600);
    });
    return b;
  }
  function renderPop() {
    var body = $('link-body');
    if (!body || !$('link-dlg').open) return;
    if (SERVER && root.SpineKitSync && root.SpineKitSync.renderConnect) { root.SpineKitSync.renderConnect(body); return; }
    var st = status();
    body.textContent = '';
    var on = !!link.es;
    body.appendChild(el('div', { class: 'lk-status', 'data-state': st.key }, [el('i', { 'aria-hidden': 'true' }), el('span', { text: st.line })]));
    if (!link.local) {
      body.appendChild(el('p', {}, ['Claude керує китом через локальний MCP-сервер. Відкрий кит з локального сервера: у папці кита ', el('code', { text: 'npm run dev' }), ', далі ', el('code', { text: 'http://localhost:5180' }), '.']));
      return;
    }
    body.appendChild(el('div', { class: 'lk-actions' }, [
      el('button', { type: 'button', class: 'btn ' + (on ? '' : 'primary'), text: on ? 'Відключити' : link.replaced ? 'Підключити тут' : 'Підключити', onclick: function () { toggle(!on); } })
    ]));
    var mcp = link.info && link.info.mcp ? link.info.mcp : 'mcp.mjs';
    var cmd = 'claude mcp add --scope user spine-draft-kit -- node "' + mcp + '"';
    body.appendChild(el('div', { class: 'lk-step' }, [el('b', { text: '1. Додай кит у Claude Code (один раз)' }), el('div', { class: 'lk-cmd' }, [el('code', { text: cmd }), copyBtn(cmd)])]));
    body.appendChild(el('div', { class: 'lk-step' }, [el('b', { text: '2. Попроси Claude' }), el('p', {}, ['«Заповни кит артом з ', el('code', { text: '/шлях/до/арту' }), '». Claude спитає, у який проект: існуючий чи новий, і заповнить його тут наживо.'])]));
    var dir = link.info && link.info.projectsDir;
    body.appendChild(el('div', { class: 'lk-step' }, [el('b', { text: 'Збереження' }), el('p', {}, [
      'Проекти зберігаються в браузері й у папці ', el('code', { text: dir || 'projects/' }), '. Видалені переносяться в ', el('code', { text: '.trash' }), '.',
      link.backupError ? el('span', { class: 'lk-err', text: ' Помилка копії: ' + link.backupError }) : link.backupAt ? ' Остання копія: ' + clock(link.backupAt) + '.' : ''
    ])]));
    if (link.log.length) {
      body.appendChild(el('div', { class: 'lk-step' }, [el('b', { text: 'Дії Claude' }), el('ul', { class: 'lk-log' }, link.log.slice(0, 12).map(function (l) {
        return el('li', { class: l.ok ? '' : 'bad' }, [el('span', { text: clock(l.at) }), (LABELS[l.tool] || l.tool) + (l.ok ? '' : ': ' + l.text)]);
      }))]));
    }
  }
  function openPop() {
    var d = $('link-dlg');
    if (typeof d.showModal === 'function') { if (!d.open) d.showModal(); }
    else d.setAttribute('open', '');
    renderPop();
  }

  function bind() {
    var b = $('link-btn');
    if (!b) return;
    var d = $('link-dlg');
    var close = function () { if (typeof d.close === 'function') d.close(); else d.removeAttribute('open'); };
    b.addEventListener('click', openPop);
    $('link-close').addEventListener('click', close);
    d.addEventListener('click', function (e) { if (e.target === d) close(); });
    renderButton();
  }

  function start(app) {
    App = app;
    if (ENGINE) { connectEngine(); return; }
    var u = new URL(location.href);
    if (u.searchParams.get('connect') === '1') {
      writeWant(true);
      u.searchParams.delete('connect');
      history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
    }
    if (link.local && readWant()) connect();
    renderButton();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();

  root.SpineKitLink = { restore: restore, backup: backup, forget: forget, start: start, refresh: renderButton, local: function () { return link.local; } };
})(typeof window !== 'undefined' ? window : globalThis);
