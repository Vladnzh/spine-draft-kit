(function () {
  'use strict';
  var K = window.SpineDraftKit;
  var Store = window.SpineKitStore;
  var Sync = window.SpineKitSync && window.SpineKitSync.mode() ? window.SpineKitSync : null;
  var Info = window.SpineKitInfo;
  var Link = window.SpineKitLink;
  var LK = window.SpineKitLayouts;
  var SPINE_URL = 'https://cdn.jsdelivr.net/npm/@esotericsoftware/spine-player@4.1.55/dist/iife/spine-player.min.js';
  var ZIP_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
  var LEGACY = 'spine-draft-kit.v2';
  var LAST = 'spine-draft-kit.last';
  var GRIDS = [[3, 3], [5, 3], [5, 4], [6, 4], [6, 5], [7, 7]];
  var TITLES = { symbols: 'Символи', reels: 'Барабани', frame_under: 'Рамка під барабанами', frame_above: 'Рамка над барабанами' };

  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === undefined || v === null || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.indexOf('on') === 0 && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else if (k === 'value') n.value = v;
      else if (k === 'checked') n.checked = !!v;
      else n.setAttribute(k, v === true ? '' : v);
    });
    [].concat(kids || []).forEach(function (c) { if (c !== null && c !== undefined && c !== false) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function A(name, duration, preset, loop, events) { return { name: name, duration: duration, preset: preset, loop: !!loop, events: events || '' }; }
  var seq = 0;
  function newId() { seq += 1; return 'c' + Date.now().toString(36) + seq + Math.random().toString(36).slice(2, 6); }

  function symbolAnims() { return [A('idle', 2, 'breathe', true), A('stop', 0.28, 'land'), A('win', 0.85, 'win'), A('win_idle', 0.85, 'win', true), A('win_insignificant', 0.65, 'pulse')]; }
  function frameAnims() { return [A('in', 0.5, 'fade_in'), A('loop_1', 2, 'hold', true), A('out', 0.3, 'fade_out')]; }
  var TEMPLATES = {
    background: { label: 'Фон', name: 'animation_bg', w: 4000, h: 4000, anims: function () { return [A('in', 1, 'fade_in'), A('loop_1', 4, 'hold', true), A('out', 0.3, 'fade_out')]; } },
    logo: { label: 'Логотип', name: 'animation_game_logo', w: 640, h: 280, anims: function () { return [A('in', 0.55, 'pop_in'), A('loop_1', 2, 'breathe', true), A('out', 0.3, 'pop_out')]; } },
    popup: { label: 'Попап', name: 'animation_popup', w: 900, h: 600, anims: function () { return [A('in', 0.55, 'pop_in'), A('loop_1', 1.15, 'glow', true), A('out', 0.3, 'pop_out')]; } },
    infopanel: { label: 'Інфопанель', name: 'animation_notification_panel', w: 1000, h: 160, skins: 'default, maingame, freespins, feature_active', spacers: 'txt_notification_panel', y: function (g) { return -Math.round(g.gridH / 2 + 104); }, anims: function () { return [A('in', 0.35, 'fade_in'), A('in_txt', 0.2, 'fade_in'), A('loop_1', 2, 'hold', true), A('out', 0.27, 'fade_out'), A('out_txt', 0.2, 'fade_out')]; } },
    character: { label: 'Персонаж', name: 'animation_character', w: 1200, h: 2000, pivot: 'bottom', anims: charAnims },
    custom: { label: 'Свій', name: 'animation_element', w: 400, h: 400, anims: function () { return [A('in', 0.35, 'fade_in'), A('loop_1', 2, 'breathe', true), A('out', 0.35, 'fade_out')]; } }
  };
  function charAnims() {
    var io = 'ease-in-out', eo = 'ease-out', ei = 'ease-in';
    var row = function (name, d, loop, keys) { var a = A(name, d, 'hold', loop); a.keys = keys; return a; };
    return [
      row('in', 1.2, false, { all: [{ t: 0, alpha: 0 }, { t: 0.3, alpha: 1 }], art: [{ t: 0, sx: 0.8, sy: 0.55, ease: eo }, { t: 0.35, sx: 0.94, sy: 1.1, ease: io }, { t: 0.6, sx: 1.05, sy: 0.94, ease: io }, { t: 0.85, sx: 1, sy: 1 }] }),
      row('idle', 3, true, { art: [{ t: 0, sx: 1, sy: 1, rotate: 0, ease: io }, { t: 0.75, rotate: 1, ease: io }, { t: 1.5, sx: 0.99, sy: 1.025, ease: io }, { t: 2.25, rotate: -1, ease: io }, { t: 3, sx: 1, sy: 1, rotate: 0 }] }),
      row('win', 1.7, false, { art: [{ t: 0, y: 0, sx: 1, sy: 1, ease: eo }, { t: 0.15, y: 0, sx: 1.08, sy: 0.88, ease: eo }, { t: 0.42, y: 90, sx: 0.95, sy: 1.08, ease: ei }, { t: 0.68, y: 0, sx: 1.08, sy: 0.9, ease: eo }, { t: 0.9, y: 24, sx: 0.98, sy: 1.03, ease: ei }, { t: 1.08, y: 0, sx: 1.03, sy: 0.97, ease: eo }, { t: 1.3, sx: 1, sy: 1 }] }),
      row('anticipation_in', 0.6, false, { art: [{ t: 0, rotate: 0, sx: 1, sy: 1, ease: eo }, { t: 0.6, rotate: -4, sx: 1.03, sy: 0.97 }] }),
      row('anticipation_loop', 1.3333, true, { art: [{ t: 0, x: 0, rotate: -4, sx: 1.03, sy: 0.97, ease: io }, { t: 0.3333, x: -6, rotate: -5, ease: io }, { t: 0.6667, x: 6, rotate: -3, ease: io }, { t: 1, x: -6, rotate: -5, ease: io }, { t: 1.3333, x: 0, rotate: -4 }] }),
      row('anticipation_out', 0.5, false, { art: [{ t: 0, rotate: -4, sx: 1.03, sy: 0.97, ease: eo }, { t: 0.5, rotate: 0, sx: 1, sy: 1 }] }),
      row('trigger', 2.1, false, { art: [{ t: 0, y: 0, rotate: 0, sx: 1, sy: 1, ease: eo }, { t: 0.2, sx: 1.1, sy: 0.85, ease: eo }, { t: 0.55, y: 140, rotate: 6, sx: 0.94, sy: 1.1, ease: ei }, { t: 0.9, y: 0, rotate: 0, sx: 1.1, sy: 0.88, ease: eo }, { t: 1.15, sx: 0.97, sy: 1.04, ease: io }, { t: 1.4, sx: 1, sy: 1 }], all: [{ t: 0.5, color: 'ffffff', ease: eo }, { t: 0.9, color: 'fff0a0', ease: io }, { t: 1.6, color: 'ffffff' }] }),
      row('attention', 3, false, { art: [{ t: 0, y: 0, rotate: 0, sx: 1, sy: 1, ease: eo }, { t: 0.2, sx: 1.05, sy: 0.92, ease: eo }, { t: 0.45, y: 50, sx: 0.97, sy: 1.05, ease: ei }, { t: 0.7, y: 0, sx: 1.04, sy: 0.95, ease: eo }, { t: 0.9, sx: 1, sy: 1, rotate: 0, ease: io }, { t: 1.4, rotate: 5, ease: io }, { t: 2.1, rotate: -3, ease: io }, { t: 2.6, rotate: 0 }] }),
      row('out', 0.5, false, { all: [{ t: 0.15, alpha: 1, ease: ei }, { t: 0.5, alpha: 0 }], art: [{ t: 0, sx: 1, sy: 1, ease: ei }, { t: 0.5, sx: 1.1, sy: 0.3 }] })
    ];
  }

  function fromTemplate(t, name) {
    var c = { id: newId(), type: 'custom', label: t.label, on: true, name: name || t.name, w: t.w, h: t.h, x: 0, y: t.y ? t.y(geo()) : 0, skins: t.skins || 'default', spacers: t.spacers || '', anims: t.anims() };
    if (t.pivot) c.pivot = t.pivot;
    if (t.parts) c.parts = t.parts();
    return c;
  }

  function partKey(c, name) { return 'p:' + c.id + ':' + name; }
  function partOf(key) {
    var m = /^p:([^:]+):(.+)$/.exec(key);
    var c = m && comp(m[1]);
    return (c && (c.parts || []).filter(function (p) { return p && p.name === m[2]; })[0]) || null;
  }
  function forgetComponentImages(c) {
    var st = imgs('c:' + c.id);
    forgetImage('c:' + c.id);
    Object.keys(st.images).concat(Object.keys(st.blobs)).forEach(function (k) { if (k.indexOf('p:' + c.id + ':') === 0) forgetImage(k); });
  }
  function movePartImage(c, from, to) {
    var a = partKey(c, from), b = partKey(c, to);
    if (a === b) return;
    var st = imgs(a);
    if (st.images[a]) { st.images[b] = st.images[a]; st.blobs[b] = st.blobs[a]; }
    forgetImage(a);
  }

  var COMP_KIT = 'spine-draft-kit/component@1';
  function compImageKeys(c) {
    var out = { main: 'c:' + c.id };
    (c.parts || []).forEach(function (p) { if (p && p.name) out['part:' + p.name] = partKey(c, p.name); });
    return out;
  }
  async function exportComponent(c) {
    var d = clone(c);
    delete d.id;
    delete d.on;
    delete d.lib;
    delete d.libV;
    var bone = state.s.layouts && state.s.layouts.bind ? state.s.layouts.bind[c.id] : null;
    if (typeof bone === 'string' && bone) d.bone = bone;
    var keys = compImageKeys(c), images = {}, roles = Object.keys(keys);
    for (var i = 0; i < roles.length; i++) {
      var k = keys[roles[i]];
      var st = imgs(k);
      if (st.blobs[k]) images[roles[i]] = { name: (st.images[k] && st.images[k].fileName) || '', data: await readAsDataUrl(st.blobs[k]) };
    }
    return { name: spineOf(c) + '.component.json', text: JSON.stringify({ kit: COMP_KIT, component: d, images: images }, null, 1) };
  }
  async function importComponent(data, opts) {
    opts = opts || {};
    if (!data || data.kit !== COMP_KIT || !data.component || typeof data.component !== 'object') throw new Error('Це не файл компонента кита');
    var src = clone(data.component);
    var c = { id: opts.sandbox ? sbNewId() : newId(), type: 'custom', label: typeof src.label === 'string' && src.label ? src.label : TEMPLATES.custom.label, on: true };
    if (opts.sandbox) delete c.on;
    ['w', 'h', 'x', 'y'].forEach(function (k) { if (isFinite(Number(src[k]))) c[k] = Number(src[k]); });
    ['skins', 'spacers', 'bar'].forEach(function (k) { if (typeof src[k] === 'string') c[k] = src[k]; });
    if (K.pivotName(src.pivot)) c.pivot = K.pivotName(src.pivot);
    if (Array.isArray(src.parts)) c.parts = src.parts.map(K.normPart).filter(Boolean);
    c.anims = Array.isArray(src.anims) ? src.anims.filter(function (a) { return a && a.name; }) : frameAnims();
    var taken = (opts.sandbox ? sbList() : state.s.components.filter(function (x) { return x.type === 'custom'; })).map(spineOf);
    var base = 'animation_' + (K.slug(opts.name || src.name).replace(/^animation_/, '') || 'element');
    var name = base, n = 2;
    while (taken.indexOf(name) !== -1) name = base + '_' + n++;
    c.name = name;
    var keys = compImageKeys(c), imgs = data.images || {};
    var roles = Object.keys(imgs);
    for (var i = 0; i < roles.length; i++) {
      var im = imgs[roles[i]], url = typeof im === 'string' ? im : im && im.data;
      var blob = im && im.blob instanceof Blob ? im.blob : null;
      if (!keys[roles[i]] || (!blob && typeof url !== 'string')) continue;
      try { await setImage(keys[roles[i]], blob || dataUrlBlob(url), (im && im.name) || ''); } catch (e) { continue; }
    }
    if (opts.sandbox) {
      sbItems().push(c);
      sb.cur = c.id;
      sb.anim = null;
      sb.skin = null;
      sb.playing = true;
      changed({ render: true, now: true });
      return c;
    }
    state.s.components.push(c);
    if (typeof src.bone === 'string' && src.bone && lays().list.some(function (L) { return LK.boneOf(L, src.bone); })) lays().bind[c.id] = src.bone;
    state.open[c.id] = true;
    state.pv = { spine: name, anim: null, skin: null };
    changed({ render: true, now: true });
    return c;
  }

  function fitSize(c, natural) {
    var bg = c.label === TEMPLATES.background.label || /(^|_)bg(_|$)|background/.test(String(c.name || ''));
    var k = bg ? Math.max(1, Math.round(TEMPLATES.background.w / Math.max(natural.w, natural.h))) : 1;
    c.w = natural.w * k;
    c.h = natural.h * k;
  }

  function defaults() {
    return {
      kit: 2,
      game: '',
      reels: 5,
      rows: 3,
      cell: { w: 334, h: 334 },
      tech: { spineVersion: K.TECH.spineVersion, fps: K.TECH.fps, folder: K.TECH.folder },
      components: [
        { id: 'symbols', type: 'symbols', on: true, txt: true, blur: true, fill: 84, anims: symbolAnims(), symbols: ['wild_1', 'scatter_1', 'high_1', 'high_2', 'high_3', 'high_4', 'low_1', 'low_2', 'low_3', 'low_4'].map(function (n) { return { name: n }; }) },
        { id: 'reels', type: 'reels', on: true },
        { id: 'frame_under', type: 'frame_under', on: true, skins: 'default, freespins, maingame', spacers: '', anims: frameAnims() },
        { id: 'frame_above', type: 'frame_above', on: true, skins: 'default, freespins, maingame', spacers: '', anims: frameAnims() }
      ],
      layouts: LK.defaults()
    };
  }

  function normalize(raw) {
    var d = defaults();
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.components)) return d;
    var s = {
      kit: 2,
      game: typeof raw.game === 'string' ? raw.game : '',
      reels: Math.min(12, Math.max(1, Number(raw.reels) || d.reels)),
      rows: Math.min(12, Math.max(1, Number(raw.rows) || d.rows)),
      cell: { w: Number(raw.cell && raw.cell.w) || d.cell.w, h: Number(raw.cell && raw.cell.h) || d.cell.h },
      tech: Object.assign({}, d.tech, raw.tech || {}),
      components: raw.components.filter(function (c) { return c && c.type; }).map(function (c) {
        var o = JSON.parse(JSON.stringify(c));
        o.id = o.id || newId();
        if (o.type === 'symbols') { o.symbols = (o.symbols || []).filter(function (x) { return x && x.name; }); o.anims = o.anims || symbolAnims(); }
        if (o.type === 'frame_under' || o.type === 'frame_above' || o.type === 'custom') o.anims = o.anims || frameAnims();
        return o;
      }),
      layouts: LK.normalize(raw.layouts)
    };
    ['symbols', 'reels', 'frame_under', 'frame_above'].forEach(function (id) {
      if (!s.components.some(function (c) { return c.type === id; })) {
        var c = d.components.filter(function (x) { return x.type === id; })[0];
        c.on = false;
        s.components.push(c);
      }
    });
    return s;
  }

  var state = {
    s: defaults(),
    images: {},
    open: { symbols: true },
    skip: {},
    sel: null,
    plan: null,
    pv: { spine: 'animation_symbol_high_1', anim: 'win', skin: null },
    lib: { spine: 'loading', zip: 'loading' },
    player: null,
    check: { json: null, atlas: null, pngs: {}, list: [] },
    pid: null,
    projects: [],
    blobs: {},
    wiz: null,
    confirmDel: null
  };

  function comp(id) { return state.s.components.filter(function (c) { return c.id === id; })[0] || sbList().filter(function (c) { return c.id === id; })[0]; }
  function symComp() { return state.s.components.filter(function (c) { return c.type === 'symbols'; })[0]; }
  function geo() { return K.geometry(state.s); }

  function toast(text) {
    var t = el('div', { class: 'toast', role: 'status', text: text });
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }

  var AUTO = 'spine-draft-kit.autosave';
  var HIST_MAX = 50;
  var MOD = /Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘S' : 'Ctrl+S';
  var auto = Sync ? true : readAuto();
  var hist = { list: [], timer: null, saved: {}, dirty: false, view: 'drafts' };
  function readAuto() { try { return localStorage.getItem(AUTO) !== '0'; } catch (e) { return true; } }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  var saveTimer = null;
  var cleanSig = null, blobIds = new WeakMap(), blobSeq = 0;
  function blobRev(b) {
    if (!b || typeof b !== 'object') return '-';
    var id = blobIds.get(b);
    if (!id) { blobSeq += 1; id = blobSeq; blobIds.set(b, id); }
    return id;
  }
  function projSig() { return state.s ? JSON.stringify(state.s) + '|' + Object.keys(state.blobs).sort().map(function (k) { return k + ':' + blobRev(state.blobs[k]); }).join(',') : ''; }
  function scheduleSave() {
    if (!auto && !hist.dirty && cleanSig !== null && projSig() === cleanSig) return;
    clearTimeout(saveTimer);
    clearTimeout(hist.timer);
    if (!Sync) hist.timer = setTimeout(histCommit, 1200);
    setDirty(true);
    if (auto) saveTimer = setTimeout(saveNow, Sync ? 200 : 400);
  }
  function saveNow() {
    clearTimeout(saveTimer);
    if (!state.pid) return Promise.resolve();
    var old = state.projects.filter(function (p) { return p.id === state.pid; })[0];
    var rec = { id: state.pid, created: old ? old.created : Date.now(), updated: Date.now(), settings: JSON.parse(JSON.stringify(state.s)), images: Object.assign({}, state.blobs), history: hist.list.slice() };
    updateMeta(rec);
    Link.backup(rec);
    histMark();
    setDirty(false);
    cleanSig = projSig();
    renderHist();
    return Store.put(rec);
  }
  function flush() { return auto ? saveNow() : Promise.resolve(); }
  async function saveProject() {
    if (!state.pid) return;
    histCommit();
    await saveNow();
  }
  async function saveClick() {
    if (Sync) { toast('Зберігається автоматично'); return; }
    if (!state.pid) return;
    await saveProject();
    toast('Збережено');
  }
  function setDirty(v) {
    if (hist.dirty === v) return;
    hist.dirty = v;
    renderSaveBtn();
  }
  function writeAuto(v) { try { localStorage.setItem(AUTO, v ? '1' : '0'); } catch (e) { return false; } return true; }
  async function setAuto(v) {
    auto = !!v;
    writeAuto(auto);
    if (state.pid) await saveProject();
    renderSaveBtn();
    renderHist();
    toast(auto ? 'Автозбереження увімкнено' : 'Автозбереження вимкнено: зберігайте кнопкою або ' + MOD);
  }

  async function leaveOk() {
    if (!state.pid) return true;
    if (Sync) {
      if (hist.dirty) await Promise.race([saveNow(), new Promise(function (r) { setTimeout(r, 3000); })]);
      return true;
    }
    if (auto) { if (histCommit() || hist.dirty) await saveNow(); return true; }
    if (!hist.dirty) return true;
    var d = $('unsaved-dlg');
    $('unsaved-txt').textContent = 'У проекті «' + (state.s.game || 'Без назви') + '» є незбережені зміни.';
    d.returnValue = '';
    if (!d.open) d.showModal();
    var v = await new Promise(function (done) { d.addEventListener('close', function () { done(d.returnValue); }, { once: true }); });
    if (v === 'save') { await saveProject(); return true; }
    if (v !== 'drop') return false;
    clearTimeout(saveTimer);
    clearTimeout(hist.timer);
    setDirty(false);
    return true;
  }

  function histLast(scope) {
    for (var i = hist.list.length - 1; i >= 0; i--) if (hist.list[i].scope === scope && !hist.list[i].undone) return hist.list[i];
    return null;
  }
  function histMark() {
    hist.saved = {};
    ['drafts', 'layouts'].forEach(function (scope) { var h = histLast(scope); hist.saved[scope] = h ? h.id : null; });
  }
  function histCut(scope) {
    var n = hist.list.length;
    hist.list = hist.list.filter(function (h) { return h.scope !== scope || !h.undone; });
    return hist.list.length !== n;
  }
  function histClean() {
    return ['drafts', 'layouts'].every(function (scope) { var h = histLast(scope); return (h ? h.id : null) === hist.saved[scope]; });
  }
  function histSnap(scope) {
    if (scope === 'layouts') return { layouts: clone(state.s.layouts || null) };
    var s = clone(state.s);
    delete s.layouts;
    var names = {};
    Object.keys(state.images).forEach(function (k) { if (state.images[k].fileName) names[k] = state.images[k].fileName; });
    return { s: s, blobs: Object.assign({}, state.blobs), names: names };
  }
  function histCommit() {
    clearTimeout(hist.timer);
    if (Sync || !state.s || !state.pid) return 0;
    var n = 0;
    ['drafts', 'layouts'].forEach(function (scope) {
      var prev = histLast(scope);
      var snap = histSnap(scope);
      var label = prev ? histDiff(scope, prev.snap, snap) : 'Початок';
      if (label) { histPush(scope, label, snap, true); n++; }
    });
    return n;
  }
  function histPush(scope, label, snap, merge) {
    var now = Date.now();
    var cut = histCut(scope);
    var top = hist.list[hist.list.length - 1];
    if (merge && !cut && top && top.scope === scope && top.label === label && now - top.t < 10000 && (auto || top.id !== hist.saved[scope])) { top.snap = snap; top.t = now; }
    else hist.list.push({ id: newId(), t: now, scope: scope, label: label, snap: snap });
    var mine = hist.list.filter(function (h) { return h.scope === scope; });
    if (mine.length > HIST_MAX) hist.list.splice(hist.list.indexOf(mine[0]), 1);
    if (auto) { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 400); }
    renderHist();
  }
  function histOpen(list) {
    clearTimeout(hist.timer);
    hist.list = (Array.isArray(list) ? list : []).filter(function (h) { return h && h.snap && (h.scope === 'layouts' || (h.scope === 'drafts' && h.snap.s)); });
    ['drafts', 'layouts'].forEach(function (scope) {
      var prev = histLast(scope);
      var snap = histSnap(scope);
      var label = !prev ? 'Початок' : histDiff(scope, prev.snap, snap) ? 'Стан при відкритті' : '';
      if (!label) return;
      histCut(scope);
      hist.list.push({ id: newId(), t: Date.now(), scope: scope, label: label, snap: snap });
    });
    histMark();
    hist.dirty = false;
    cleanSig = projSig();
    renderSaveBtn();
    renderHist();
  }

  function compTitle(c) { return TITLES[c.type] || c.label || c.name || 'Компонент'; }
  function histParts(scope, a, b) { return scope === 'layouts' ? layDiff((a && a.layouts) || {}, (b && b.layouts) || {}) : draftDiff(a, b); }
  function histDiff(scope, a, b) {
    var out = histParts(scope, a, b);
    if (!out.length) return '';
    return out.slice(0, 3).join(', ') + (out.length > 3 ? ' +' + (out.length - 3) : '');
  }
  function draftDiff(a, b) {
    var out = [];
    var add = function (t) { if (out.indexOf(t) === -1) out.push(t); };
    var x = a.s, y = b.s;
    if (x.game !== y.game) add('Назва гри');
    if (x.reels !== y.reels || x.rows !== y.rows) add('Сітка ' + y.reels + '×' + y.rows);
    if (!same(x.cell, y.cell)) add('Клітинка ' + y.cell.w + '×' + y.cell.h);
    if (!same(x.tech, y.tech)) add('Технічні');
    var xc = x.components || [], yc = y.components || [];
    var find = function (list, id) { return list.filter(function (c) { return c.id === id; })[0]; };
    var fresh = {};
    yc.forEach(function (c) {
      var o = find(xc, c.id);
      if (!o) { fresh[c.id] = true; add('+ ' + compTitle(c)); }
      else if ((o.on !== false) !== (c.on !== false)) add(compTitle(c) + (c.on === false ? ': вимкнено' : ': увімкнено'));
      else if (!same(o, c)) add(compTitle(c));
    });
    xc.forEach(function (c) { if (!find(yc, c.id)) { fresh[c.id] = true; add('− ' + compTitle(c)); } });
    var ids = function (list) { return list.map(function (c) { return c.id; }); };
    if (!out.length && !same(ids(xc), ids(yc))) add('Порядок компонентів');
    var any = function (id) { return find(yc, id) || find(xc, id); };
    var ab = a.blobs || {}, bb = b.blobs || {};
    Object.keys(Object.assign({}, ab, bb)).forEach(function (k) {
      if (ab[k] === bb[k]) return;
      if (k.indexOf('sym:') === 0) add('Картинка ' + k.slice(4));
      else if (k.indexOf('blur:') === 0) add('Блюр ' + k.slice(5));
      else if (k.indexOf('c:') === 0) { var c = any(k.slice(2)); if (!fresh[k.slice(2)]) add('Картинка: ' + (c ? compTitle(c) : 'компонент')); }
      else if (k.indexOf('p:') === 0) { var pid = k.split(':')[1], pc = any(pid); if (!fresh[pid]) add('Частина: ' + (pc ? compTitle(pc) : 'компонент') + ' · ' + k.split(':').slice(2).join(':')); }
      else add('Картинка: ' + (TITLES[k] || k));
    });
    if (!out.length && !same(x, y)) add('Зміни');
    return out;
  }
  function layDiff(a, b) {
    var out = [];
    var add = function (t) { if (out.indexOf(t) === -1) out.push(t); };
    var al = a.list || [], bl = b.list || [];
    var where = {}, keys = [];
    var note = function (key, L) { if (!where[key]) { where[key] = []; keys.push(key); } where[key].push(LK.title(L)); };
    bl.forEach(function (L) {
      var o = al.filter(function (z) { return z.name === L.name; })[0];
      if (!o) { add('+ ' + L.name); return; }
      if (same(o, L)) return;
      if (o.w !== L.w || o.h !== L.h) note('розмір', L);
      L.bones.forEach(function (z) {
        var p = LK.boneOf(o, z.name);
        if (!p) note('+ ' + z.name, L);
        else if (!same(p, z)) note(z.name, L);
      });
      o.bones.forEach(function (z) { if (!LK.boneOf(L, z.name)) note('− ' + z.name, L); });
    });
    al.forEach(function (L) { if (!bl.some(function (z) { return z.name === L.name; })) add('− ' + L.name); });
    var plus = keys.filter(function (k) { return k.indexOf('+ ') === 0; }), minus = keys.filter(function (k) { return k.indexOf('− ') === 0; });
    if (plus.length === 1 && minus.length === 1) {
      keys = keys.filter(function (k) { return k !== plus[0] && k !== minus[0]; });
      add(minus[0].slice(2) + ' → ' + plus[0].slice(2));
    }
    keys.forEach(function (k) { add(k + (where[k].length < bl.length ? ' · ' + where[k].join(', ') : '')); });
    var comps = state.s ? state.s.components : [];
    var cname = function (id) { var c = comps.filter(function (z) { return z.id === id; })[0]; return c ? compTitle(c) : id; };
    var ab = a.bind || {}, bb = b.bind || {};
    Object.keys(Object.assign({}, ab, bb)).forEach(function (id) { if (ab[id] !== bb[id]) add(cname(id) + ' → ' + (bb[id] || 'не ставити')); });
    var ao = a.off || {}, bo = b.off || {};
    Object.keys(Object.assign({}, ao, bo)).forEach(function (id) { if (!!ao[id] !== !!bo[id]) add(cname(id) + (bo[id] ? ': сховано' : ': показано')); });
    if (!out.length && !same(a, b)) add('Зміни');
    return out;
  }

  function stamp(t) {
    var d = new Date(t);
    var p = function (v) { return String(v).padStart(2, '0'); };
    var time = p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    return d.toDateString() === new Date().toDateString() ? time : p(d.getDate()) + '.' + p(d.getMonth() + 1) + ' ' + time.slice(0, 5);
  }
  async function histRestore(h) {
    if (!state.s || !state.pid || hist.busy) return;
    histCommit();
    if (hist.list.indexOf(h) === -1 || h === histLast(h.scope)) { renderHist(); return; }
    hist.busy = true;
    try { await histApply(h); } finally { hist.busy = false; }
    var mine = hist.list.filter(function (x) { return x.scope === h.scope; });
    var at = mine.indexOf(h);
    mine.forEach(function (x, i) { if (i > at) x.undone = true; else delete x.undone; });
    changed({ render: true, now: true });
    if (!auto && histClean()) setDirty(false);
    renderHist();
  }
  async function histApply(h) {
    if (h.scope === 'layouts') {
      state.s.layouts = clone(h.snap.layouts);
      lay.sel = null;
      lay.reset = false;
    } else {
      var blobs = h.snap.blobs || {}, names = h.snap.names || {};
      var keys = Object.keys(blobs);
      for (var i = 0; i < keys.length; i++) {
        if (state.blobs[keys[i]] === blobs[keys[i]]) continue;
        try { await setImage(keys[i], blobs[keys[i]], names[keys[i]]); } catch (e) { forgetImage(keys[i]); }
      }
      Object.keys(state.blobs).forEach(function (k) { if (!blobs[k]) forgetImage(k); });
      var s = clone(h.snap.s);
      s.layouts = state.s.layouts;
      state.s = s;
      state.sel = null;
      state.confirmDel = null;
      renderGame();
    }
  }

  function renderSaveBtn() {
    var b = $('hist-btn');
    if (!b) return;
    var dirty = !auto && hist.dirty;
    b.classList.toggle('dirty', dirty);
    b.title = dirty ? 'Історія змін · є незбережені зміни, ' + MOD : 'Історія змін';
    b.setAttribute('aria-label', b.title);
    var f = $('hist-save');
    if (f) f.disabled = !hist.dirty;
  }
  function renderHist() {
    var d = $('hist-dlg');
    if (!d || !d.open) return;
    if (Sync) { Sync.renderHist(); return; }
    $('hist-auto').checked = auto;
    $('hist-foot').hidden = auto;
    $('hist-note').textContent = 'Зберігайте кнопкою або ' + MOD;
    Array.prototype.forEach.call(document.querySelectorAll('#hist-tabs .preset'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-scope') === hist.view)); });
    var ul = $('hist-list');
    ul.textContent = '';
    var mine = hist.list.filter(function (h) { return h.scope === hist.view; });
    var saved = mine.map(function (h) { return h.id; }).indexOf(hist.saved[hist.view]);
    var cur = histLast(hist.view);
    mine.slice().reverse().forEach(function (h) {
      var i = mine.indexOf(h);
      var unsaved = !auto && !h.undone && i !== saved && (i > saved || h === cur);
      ul.appendChild(el('li', null, [el('button', {
        type: 'button',
        class: 'hist-it' + (h === cur ? ' now' : '') + (h.undone ? ' undone' : '') + (unsaved ? ' unsaved' : ''),
        'aria-current': h === cur ? 'step' : null,
        title: h === cur ? null : h.undone ? 'Повторити до цього кроку' : 'Повернутися до цього кроку',
        onclick: function () { histRestore(h); }
      }, [
        el('span', { class: 'hist-t', title: unsaved ? 'Не збережено' : null, text: stamp(h.t) }),
        el('span', { class: 'hist-l' }, [h.label, !auto && i === saved && h !== cur ? el('small', { text: 'збережено' }) : null]),
        h === cur ? el('span', { class: 'hist-tag', text: 'зараз' }) : null
      ])]));
    });
  }
  function openHist() {
    if (!state.pid) return;
    histCommit();
    hist.view = state.view === 'layouts' ? 'layouts' : 'drafts';
    panel($('hist-dlg'), true);
    renderHist();
    renderSaveBtn();
  }
  async function histStep(dir) {
    if (Sync) { if (state.pid) Sync.step(dir); return; }
    if (!state.s || !state.pid || hist.busy) return;
    histCommit();
    var d = $('hist-dlg');
    var scope = d && d.open ? hist.view : state.view === 'layouts' ? 'layouts' : 'drafts';
    var mine = hist.list.filter(function (h) { return h.scope === scope; });
    var cur = histLast(scope);
    var to = mine[mine.indexOf(cur) + dir];
    if (!to) { toast(dir < 0 ? 'Далі назад кроків немає' : 'Далі вперед кроків немає'); return; }
    await histRestore(to);
    toast(dir < 0 ? 'Скасовано: ' + cur.label : 'Повторено: ' + to.label);
  }
  function typing(t) {
    if (!t) return false;
    if (t.isContentEditable || t.tagName === 'TEXTAREA') return true;
    return t.tagName === 'INPUT' && /^(text|number|search|email|url|tel|password)$/.test(t.type);
  }
  function bindHist() {
    $('hist-save').addEventListener('click', saveClick);
    $('hist-btn').addEventListener('click', openHist);
    var d = $('hist-dlg');
    bindPanel(d);
    $('hist-close').addEventListener('click', function () { panel(d, false); });
    $('hist-auto').addEventListener('change', function (e) { setAuto(e.target.checked); });
    Array.prototype.forEach.call(document.querySelectorAll('#hist-tabs .preset'), function (b) {
      b.addEventListener('click', function () { hist.view = b.getAttribute('data-scope'); renderHist(); });
    });
    document.addEventListener('keydown', function (e) {
      if (e.code !== 'KeyS' || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      e.preventDefault();
      saveClick();
    });
    document.addEventListener('keydown', function (e) {
      if (e.code !== 'KeyZ' || !(e.metaKey || e.ctrlKey) || e.altKey || typing(e.target)) return;
      if (document.querySelector('dialog[open]:not(#hist-dlg)')) return;
      e.preventDefault();
      histStep(e.shiftKey ? 1 : -1);
    });
    window.addEventListener('beforeunload', function (e) {
      if (auto || !hist.dirty || !state.pid) return;
      e.preventDefault();
      e.returnValue = '';
    });
    renderSaveBtn();
  }

  var timer = null;
  function changed(opts) {
    opts = opts || {};
    sbSchedule();
    scheduleSave();
    if (opts.render) renderComponents();
    clearTimeout(timer);
    timer = setTimeout(rebuild, opts.now ? 0 : 140);
  }

  var remote = { timer: null, key: 0 };
  document.addEventListener('keydown', function () { remote.key = Date.now(); }, true);
  function remoteBusy() {
    var a = document.activeElement;
    return !!a && typing(a) && !!a.closest('#c-list, #game, #sb-edit, #sb-lib') && Date.now() - remote.key < 1500;
  }
  function remoteRender() {
    clearTimeout(remote.timer);
    if (!state.s) return;
    if (remoteBusy()) { remote.timer = setTimeout(remoteRender, 400); return; }
    renderGame();
    renderComponents();
    renderProjects();
    clearTimeout(timer);
    timer = setTimeout(remoteRebuild, 140);
  }
  function remoteRebuild() {
    if (spin.ctl && spin.ctl.running) { clearTimeout(timer); timer = setTimeout(remoteRebuild, 300); return; }
    rebuild();
  }
  function applyRemote(settings, images) {
    if (!state.s) return Promise.resolve();
    var P = window.SpineKitPatch;
    P.apply(state, P.diff({ s: state.s }, { s: normalize(settings) }));
    var todo = [];
    Object.keys(images).forEach(function (k) { if (isSbKey(k)) return; if (state.blobs[k] !== images[k].file) { state.blobs[k] = images[k].file; todo.push(k); } });
    Object.keys(state.blobs).forEach(function (k) { if (!images[k]) forgetImage(k); });
    remoteRender();
    return (async function () {
      for (var i = 0; i < todo.length; i++) {
        var k = todo[i];
        if (state.blobs[k] !== images[k].file) continue;
        try { await setImage(k, images[k].file, images[k].name); } catch (e) { forgetImage(k); }
      }
      if (todo.length) remoteRender();
    })();
  }
  function setProjects(list) {
    state.projects = list.map(projectMeta).sort(function (a, b) { return b.created - a.created; });
    renderProjects();
  }

  function fitPx(w, h, max) {
    var s = Math.min(1, max / Math.max(w, h));
    return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
  }

  function px(key) {
    var im = imgs(key).images[key];
    if (im) return { w: im.w, h: im.h, win: im.win || null, uploaded: true };
    var g = geo();
    if (key.indexOf('sym:') === 0) return { w: Math.round(0.86 * g.W), h: Math.round(0.86 * g.H) };
    if (key.indexOf('blur:') === 0) {
      var sp = px('sym:' + key.slice(5));
      return { w: sp.w, h: sp.h + 2 * blurPad(sp.h) };
    }
    if (key === 'frame_under') return fitPx(g.gridW + 2 * g.margin, g.gridH + 2 * g.margin, 2048);
    if (key === 'frame_above') return fitPx(g.gridW + 2 * g.border, g.gridH + 2 * g.border, 2048);
    if (key.indexOf('p:') === 0) {
      var pt = partOf(key);
      return fitPx(Number(pt && pt.w) || 100, Number(pt && pt.h) || 100, 1024);
    }
    if (key.indexOf('c:') === 0) {
      var c = comp(key.slice(2));
      return fitPx(Number(c && c.w) || 400, Number(c && c.h) || 400, 1024);
    }
    return null;
  }

  function rr(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function hashHue(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; }
  function symHue(name) {
    var m = /(high|low|h|l)_?(\d+)/.exec(name);
    if (/wild/.test(name)) return [44, 92];
    if (/scatter|free|bonus/.test(name)) return [272, 62];
    if (/jackpot/.test(name)) return [8, 76];
    if (m && /^h/.test(m[1])) return [[352, 18, 326, 34, 300][(Number(m[2]) - 1) % 5], 64];
    if (m) return [[204, 168, 140, 228, 188, 254][(Number(m[2]) - 1) % 6], 52];
    return [hashHue(name), 40];
  }
  function symLabel(name) {
    var m = /^(high|low)_?(\d+)$/.exec(name);
    if (m) return (m[1] === 'high' ? 'H' : 'L') + m[2];
    if (/^wild/.test(name)) return 'W';
    if (/^scatter/.test(name)) return 'S';
    if (/^(free|bonus)/.test(name)) return 'B';
    return name.replace(/_/g, '').slice(0, 3).toUpperCase();
  }
  var FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

  function drawSymbol(name, w, h) {
    var c = el('canvas', { width: w, height: h });
    var x = c.getContext('2d');
    var hs = symHue(name);
    var g = x.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, 'hsl(' + hs[0] + ',' + hs[1] + '%,64%)');
    g.addColorStop(1, 'hsl(' + hs[0] + ',' + hs[1] + '%,34%)');
    var r = 0.18 * Math.min(w, h);
    rr(x, 1, 1, w - 2, h - 2, r);
    x.fillStyle = g;
    x.fill();
    x.lineWidth = Math.max(2, 0.025 * w);
    x.strokeStyle = 'rgba(255,255,255,0.45)';
    rr(x, x.lineWidth, x.lineWidth, w - 2 * x.lineWidth, h - 2 * x.lineWidth, r * 0.85);
    x.stroke();
    x.fillStyle = '#fff';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.shadowColor = 'rgba(0,0,0,0.35)';
    x.shadowBlur = 0.04 * h;
    x.font = '700 ' + Math.round(0.4 * h) + 'px ' + FONT;
    x.fillText(symLabel(name), w / 2, h * 0.47);
    x.shadowBlur = 0;
    x.font = '500 ' + Math.round(0.085 * h) + 'px ' + FONT;
    x.fillStyle = 'rgba(255,255,255,0.85)';
    x.fillText(name, w / 2, h * 0.84);
    return c;
  }

  function drawFrameUnder(w, h) {
    var g = geo();
    var c = el('canvas', { width: w, height: h });
    var x = c.getContext('2d');
    var s = w / (g.gridW + 2 * g.margin);
    var grad = x.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#26304f');
    grad.addColorStop(1, '#151a2c');
    rr(x, 0, 0, w, h, 0.05 * Math.min(g.W, g.H) * s);
    x.fillStyle = grad;
    x.fill();
    x.fillStyle = 'rgba(255,255,255,0.07)';
    for (var i = 1; i < g.C; i++) x.fillRect((g.margin + i * g.W) * s - 2 * s, g.margin * s, 4 * s, g.gridH * s);
    x.strokeStyle = 'rgba(255,255,255,0.12)';
    x.lineWidth = 2 * s;
    rr(x, g.margin * s, g.margin * s, g.gridW * s, g.gridH * s, 0.03 * g.W * s);
    x.stroke();
    return c;
  }

  function drawFrameAbove(w, h) {
    var g = geo();
    var c = el('canvas', { width: w, height: h });
    var x = c.getContext('2d');
    var s = w / (g.gridW + 2 * g.border);
    var b = g.border * s;
    var grad = x.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#f7dc8a');
    grad.addColorStop(0.45, '#c8922c');
    grad.addColorStop(1, '#8a5a14');
    rr(x, 0, 0, w, h, 0.5 * b);
    x.fillStyle = grad;
    x.fill();
    x.globalCompositeOperation = 'destination-out';
    rr(x, b, b, g.gridW * s, g.gridH * s, 0.18 * b);
    x.fill();
    x.globalCompositeOperation = 'source-over';
    x.lineWidth = Math.max(2, 0.08 * b);
    x.strokeStyle = 'rgba(80,46,6,0.9)';
    rr(x, b, b, g.gridW * s, g.gridH * s, 0.18 * b);
    x.stroke();
    x.strokeStyle = 'rgba(255,240,200,0.6)';
    rr(x, x.lineWidth, x.lineWidth, w - 2 * x.lineWidth, h - 2 * x.lineWidth, 0.45 * b);
    x.stroke();
    return c;
  }

  function drawCustom(c, w, h) {
    var cv = el('canvas', { width: w, height: h });
    var x = cv.getContext('2d');
    var name = String(c.name || '').replace(/^animation_/, '');
    var hue = hashHue(name);
    var bg = /(^|_)bg$|background/.test(name);
    var grad = x.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, 'hsl(' + hue + ',45%,' + (bg ? 30 : 62) + '%)');
    grad.addColorStop(1, 'hsl(' + ((hue + 40) % 360) + ',50%,' + (bg ? 14 : 38) + '%)');
    if (bg) { x.fillStyle = grad; x.fillRect(0, 0, w, h); }
    else { rr(x, 1, 1, w - 2, h - 2, 0.12 * Math.min(w, h)); x.fillStyle = grad; x.fill(); }
    x.setLineDash([0.03 * Math.min(w, h), 0.02 * Math.min(w, h)]);
    x.lineWidth = Math.max(2, 0.012 * Math.min(w, h));
    x.strokeStyle = 'rgba(255,255,255,0.4)';
    if (bg) x.strokeRect(0.04 * w, 0.04 * h, 0.92 * w, 0.92 * h);
    else { rr(x, 0.05 * w, 0.05 * h, 0.9 * w, 0.9 * h, 0.09 * Math.min(w, h)); x.stroke(); }
    x.fillStyle = '#fff';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.font = '600 ' + Math.round(Math.min(0.12 * h, 1.4 * w / Math.max(4, name.length))) + 'px ' + FONT;
    x.fillText(name, w / 2, h / 2);
    return cv;
  }

  function partRgb(p) {
    if (p.color) return [0, 2, 4].map(function (i) { return parseInt(p.color.slice(i, i + 2), 16); });
    if (p.shape === 'glow') return [255, 226, 122];
    var h = hashHue(p.name || '') / 360, s = 0.62, l = 0.58;
    var q = l + s - l * s, b = 2 * l - q;
    return [h + 1 / 3, h, h - 1 / 3].map(function (t) {
      t = (t + 1) % 1;
      var v = t < 1 / 6 ? b + (q - b) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? b + (q - b) * (2 / 3 - t) * 6 : b;
      return Math.round(v * 255);
    });
  }
  function drawPart(p, w, h) {
    var cv = el('canvas', { width: w, height: h });
    var x = cv.getContext('2d');
    var c = partRgb(p), m = Math.min(w, h);
    var rgba = function (a, k) { k = k || 1; return 'rgba(' + Math.min(255, Math.round(c[0] * k)) + ',' + Math.min(255, Math.round(c[1] * k)) + ',' + Math.min(255, Math.round(c[2] * k)) + ',' + a + ')'; };
    var ellipse = function (rx, ry) { x.beginPath(); x.ellipse(w / 2, h / 2, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2); };
    var lw = Math.max(1.5, 0.05 * m);
    if (p.shape === 'glow') {
      x.translate(w / 2, h / 2);
      x.scale(w / m, h / m);
      var g = x.createRadialGradient(0, 0, 0, 0, 0, m / 2);
      g.addColorStop(0, rgba(1)); g.addColorStop(0.3, rgba(0.6)); g.addColorStop(0.65, rgba(0.18)); g.addColorStop(1, rgba(0));
      x.fillStyle = g;
      x.fillRect(-m / 2, -m / 2, m, m);
    } else if (p.shape === 'circle') {
      var cg = x.createRadialGradient(w * 0.38, h * 0.34, 0, w / 2, h / 2, m * 0.62);
      cg.addColorStop(0, rgba(1, 1.35)); cg.addColorStop(0.55, rgba(1)); cg.addColorStop(1, rgba(1, 0.62));
      ellipse(w / 2 - lw / 2, h / 2 - lw / 2);
      x.fillStyle = cg; x.fill();
      x.lineWidth = lw; x.strokeStyle = 'rgba(255,255,255,0.55)'; x.stroke();
    } else if (p.shape === 'ring') {
      var rw = Math.max(2, 0.14 * m);
      ellipse(w / 2 - rw / 2, h / 2 - rw / 2);
      x.lineWidth = rw; x.strokeStyle = rgba(1); x.stroke();
    } else if (p.shape === 'star') {
      x.beginPath();
      for (var i = 0; i < 10; i++) {
        var a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.45 : 1;
        x.lineTo(w / 2 + Math.cos(a) * r * (w / 2 - lw), h / 2 + Math.sin(a) * r * (h / 2 - lw));
      }
      x.closePath();
      var sg = x.createLinearGradient(0, 0, 0, h);
      sg.addColorStop(0, rgba(1, 1.3)); sg.addColorStop(1, rgba(1, 0.7));
      x.fillStyle = sg; x.fill();
      x.lineJoin = 'round'; x.lineWidth = lw; x.strokeStyle = 'rgba(255,255,255,0.55)'; x.stroke();
    } else {
      var fg = x.createLinearGradient(0, 0, w, h);
      fg.addColorStop(0, rgba(1, 1.15)); fg.addColorStop(1, rgba(1, 0.6));
      rr(x, 1, 1, w - 2, h - 2, (p.shape === 'rect' ? 0.18 : 0.12) * m);
      x.fillStyle = fg; x.fill();
      if (p.shape !== 'rect') {
        x.setLineDash([0.06 * m, 0.04 * m]);
        x.lineWidth = Math.max(1.5, 0.025 * m);
        x.strokeStyle = 'rgba(255,255,255,0.45)';
        rr(x, 0.06 * w, 0.06 * h, 0.88 * w, 0.88 * h, 0.09 * m);
        x.stroke();
        x.setLineDash([]);
        x.fillStyle = '#fff';
        x.textAlign = 'center';
        x.textBaseline = 'middle';
        x.font = '600 ' + Math.max(8, Math.round(Math.min(0.2 * h, 1.5 * w / Math.max(4, String(p.name).length)))) + 'px ' + FONT;
        x.fillText(String(p.name), w / 2, h / 2);
      } else {
        x.lineWidth = lw; x.strokeStyle = 'rgba(255,255,255,0.45)';
        rr(x, lw, lw, w - 2 * lw, h - 2 * lw, 0.15 * m); x.stroke();
      }
    }
    return cv;
  }

  function blurPad(h) { return Math.round(0.18 * h); }
  function boxBlurY(d, w, h, r) {
    var out = new Float32Array(d.length), n = 2 * r + 1;
    for (var x = 0; x < w; x++) {
      for (var c = 0; c < 4; c++) {
        var s = 0, y;
        for (y = 0; y <= r && y < h; y++) s += d[(y * w + x) * 4 + c];
        for (y = 0; y < h; y++) {
          out[(y * w + x) * 4 + c] = s / n;
          var add = y + r + 1, sub = y - r;
          if (add < h) s += d[(add * w + x) * 4 + c];
          if (sub >= 0) s -= d[(sub * w + x) * 4 + c];
        }
      }
    }
    return out;
  }
  var blurCache = new WeakMap();
  function drawBlur(src) {
    var b = blurCache.get(src);
    if (b) return b;
    var pad = blurPad(src.height);
    var w = src.width, h = src.height + 2 * pad;
    b = el('canvas', { width: w, height: h });
    var x = b.getContext('2d');
    x.drawImage(src, 0, pad);
    var img = x.getImageData(0, 0, w, h), px8 = img.data;
    var d = new Float32Array(px8.length);
    for (var i = 0; i < px8.length; i += 4) {
      var a = px8[i + 3] / 255;
      d[i] = px8[i] * a; d[i + 1] = px8[i + 1] * a; d[i + 2] = px8[i + 2] * a; d[i + 3] = px8[i + 3];
    }
    var r = Math.max(1, Math.round(pad / 2));
    d = boxBlurY(boxBlurY(d, w, h, r), w, h, r);
    for (i = 0; i < px8.length; i += 4) {
      var al = d[i + 3], k = al > 0 ? 255 / al : 0;
      px8[i] = Math.min(255, d[i] * k); px8[i + 1] = Math.min(255, d[i + 1] * k); px8[i + 2] = Math.min(255, d[i + 2] * k); px8[i + 3] = Math.min(255, al);
    }
    x.putImageData(img, 0, 0);
    blurCache.set(src, b);
    return b;
  }

  function roundRect(x, l, t, w, h, r) {
    x.beginPath();
    x.moveTo(l + r, t);
    x.arcTo(l + w, t, l + w, t + h, r);
    x.arcTo(l + w, t + h, l, t + h, r);
    x.arcTo(l, t + h, l, t, r);
    x.arcTo(l, t, l + w, t, r);
    x.closePath();
  }
  function drawBar(key) {
    var p = key.split(':');
    var kind = p[1], w = Number(p[2]), h = Number(p[3]), r = Number(p[4]);
    var cv = el('canvas', { width: w, height: h });
    var x = cv.getContext('2d');
    if (kind === 'fill') {
      var gr = x.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#ffe59a'); gr.addColorStop(0.45, '#ffb13a'); gr.addColorStop(0.8, '#e07b12'); gr.addColorStop(1, '#b45a08');
      roundRect(x, 0, 0, w, h, r); x.fillStyle = gr; x.fill();
      var hi = x.createLinearGradient(0, 0, 0, h * 0.45);
      hi.addColorStop(0, 'rgba(255,255,255,0.55)'); hi.addColorStop(1, 'rgba(255,255,255,0)');
      roundRect(x, r * 0.4, h * 0.06, w - r * 0.8, h * 0.4, r * 0.7); x.fillStyle = hi; x.fill();
    } else if (kind === 'flash') {
      roundRect(x, 0, 0, w, h, r); x.fillStyle = '#fff'; x.fill();
    } else if (kind === 'shine') {
      x.setTransform(1, 0, -0.36, 1, 0.18 * h, 0);
      var sg = x.createLinearGradient(0, 0, w, 0);
      sg.addColorStop(0.15, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, 'rgba(255,255,255,0.6)'); sg.addColorStop(0.85, 'rgba(255,255,255,0)');
      x.fillStyle = sg; x.fillRect(-w, 0, 3 * w, h);
    } else if (kind === 'head') {
      x.translate(w / 2, h / 2); x.scale(1, h / w);
      var rg = x.createRadialGradient(0, 0, 0, 0, 0, w / 2);
      rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.25, 'rgba(255,244,190,0.85)'); rg.addColorStop(0.6, 'rgba(255,190,80,0.3)'); rg.addColorStop(1, 'rgba(255,170,60,0)');
      x.fillStyle = rg; x.fillRect(-w / 2, -w / 2, w, w);
    } else if (kind === 'glow') {
      var bw = Number(p[5]), bh = Number(p[6]), off = 4 * w;
      x.shadowColor = 'rgba(255,232,117,1)'; x.shadowBlur = bh * 0.35; x.shadowOffsetX = off;
      x.strokeStyle = '#000'; x.lineWidth = bh * 0.12;
      for (var i = 0; i < 2; i++) { roundRect(x, (w - bw) / 2 - off, (h - bh) / 2, bw, bh, r); x.stroke(); }
    }
    return cv;
  }

  var artCache = {};
  function art(key) {
    var im = imgs(key).images[key];
    if (im) return im.canvas;
    if (key.indexOf('blur:') === 0) { var sc = art('sym:' + key.slice(5)); return sc ? drawBlur(sc) : null; }
    if (key.indexOf('bar:') === 0) return artCache[key] || (artCache[key] = drawBar(key));
    if (key.indexOf('p:') === 0) {
      var pt = partOf(key), q = px(key);
      var pk = key + '|' + q.w + 'x' + q.h + '|' + (pt ? (pt.shape || '') + ',' + (pt.color || '') : '');
      return artCache[pk] || (artCache[pk] = drawPart(pt || { name: key.split(':').pop() }, q.w, q.h));
    }
    var p = px(key);
    if (!p) return null;
    var g = geo();
    var c = key.indexOf('c:') === 0 ? comp(key.slice(2)) : null;
    var ck = key + '|' + p.w + 'x' + p.h + '|' + g.C + 'x' + g.R + '|' + g.W + 'x' + g.H + '|' + (c ? c.name : '');
    if (artCache[ck]) return artCache[ck];
    var cv;
    if (key.indexOf('sym:') === 0) cv = drawSymbol(key.slice(4), p.w, p.h);
    else if (key === 'frame_under') cv = drawFrameUnder(p.w, p.h);
    else if (key === 'frame_above') cv = drawFrameAbove(p.w, p.h);
    else cv = drawCustom(c || { name: key }, p.w, p.h);
    artCache[ck] = cv;
    return cv;
  }

  var thumbCache = new WeakMap();
  function thumb(canvas) {
    if (!canvas) return '';
    var t = thumbCache.get(canvas);
    if (t) return t;
    var s = Math.min(1, 128 / Math.max(canvas.width, canvas.height));
    var c = el('canvas', { width: Math.max(1, Math.round(canvas.width * s)), height: Math.max(1, Math.round(canvas.height * s)) });
    c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
    t = c.toDataURL('image/png');
    thumbCache.set(canvas, t);
    return t;
  }

  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('картинка не читається')); };
      img.src = url;
    });
  }
  function readAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
      r.readAsDataURL(file);
    });
  }
  async function canvasFromUrl(url) {
    var img = await loadImage(url);
    var p = fitPx(img.naturalWidth, img.naturalHeight, 4092);
    var c = el('canvas', { width: p.w, height: p.h });
    c.getContext('2d').drawImage(img, 0, 0, p.w, p.h);
    return { canvas: c, natural: { w: img.naturalWidth, h: img.naturalHeight } };
  }
  function windowOf(canvas) {
    var s = Math.min(1, 1024 / Math.max(canvas.width, canvas.height));
    var w = Math.max(1, Math.round(canvas.width * s)), h = Math.max(1, Math.round(canvas.height * s));
    var c = el('canvas', { width: w, height: h });
    var x = c.getContext('2d');
    x.drawImage(canvas, 0, 0, w, h);
    var data = x.getImageData(0, 0, w, h).data;
    var alpha = new Uint8Array(w * h);
    for (var i = 0; i < w * h; i++) alpha[i] = data[i * 4 + 3];
    var win = K.findWindow(alpha, w, h);
    if (!win) return null;
    return { left: win.left / s, top: win.top / s, right: win.right / s, bottom: win.bottom / s };
  }
  function dataUrlBlob(url) {
    var m = /^data:([^;,]*)(;base64)?,(.*)$/.exec(url);
    if (!m) throw new Error('не data URL');
    var raw = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
    var bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return new Blob([bytes], { type: m[1] || 'image/png' });
  }
  async function setImage(key, source, fileName) {
    var blob = typeof source === 'string' ? dataUrlBlob(source) : source;
    var url = URL.createObjectURL(blob);
    var r;
    try { r = await canvasFromUrl(url); } finally { URL.revokeObjectURL(url); }
    var im = { canvas: r.canvas, w: r.canvas.width, h: r.canvas.height, fileName: fileName || '' };
    if (key === 'frame_above') im.win = windowOf(r.canvas);
    var st = imgs(key);
    st.images[key] = im;
    st.blobs[key] = blob;
    return r.natural;
  }
  function isSbKey(k) { return /^(c|p):sb/.test(String(k || '')); }
  function imgs(k) { return isSbKey(k) ? sb.store : state; }
  function forgetImage(key) { var st = imgs(key); delete st.images[key]; delete st.blobs[key]; }
  function dropImage(key) {
    forgetImage(key);
    changed({ render: true, images: true });
  }

  async function addImageFile(key, file, after) {
    try {
      var natural = await setImage(key, file, file.name);
      if (after) after(natural);
      changed({ render: true, images: true });
    } catch (e) { toast('Не вдалося прочитати ' + file.name); }
  }

  function symbolNameFromFile(n) {
    return K.slug(n).replace(/^animation_symbol_/, '').replace(/^symbol_/, '').replace(/_blur$/, '');
  }
  function isBlurFile(n) { return /_blur$/.test(K.slug(n)); }
  function moveSymbolImages(from, to) {
    ['sym:', 'blur:'].forEach(function (p) {
      if (!state.images[p + from]) return;
      state.images[p + to] = state.images[p + from];
      state.blobs[p + to] = state.blobs[p + from];
      forgetImage(p + from);
    });
  }
  function forgetSymbolImages(n) { forgetImage('sym:' + n); forgetImage('blur:' + n); }
  async function addSymbolFiles(files) {
    var c = symComp();
    var added = 0;
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (!/^image\//.test(f.type)) continue;
      var name = symbolNameFromFile(f.name);
      if (!name) continue;
      if (!c.symbols.some(function (s) { return s.name === name; })) c.symbols.push({ name: name });
      try { await setImage((isBlurFile(f.name) ? 'blur:' : 'sym:') + name, f, f.name); added++; } catch (e) { toast('Не вдалося прочитати ' + f.name); }
    }
    if (added) {
      state.sel = symbolNameFromFile(files[files.length - 1].name);
      changed({ render: true, images: true });
      if (state.wiz) renderWizard();
    }
  }

  function fileButton(label, accept, multiple, onFiles) {
    var id = 'f' + newId();
    var input = el('input', { type: 'file', class: 'file', id: id, accept: accept, multiple: multiple || null });
    input.addEventListener('change', function () { var fs = Array.prototype.slice.call(input.files || []); input.value = ''; if (fs.length) onFiles(fs); });
    return [input, el('label', { class: 'btn sm', for: id, text: label })];
  }
  function dropTarget(node, onFiles) {
    node.addEventListener('dragover', function (e) { e.preventDefault(); node.classList.add('over'); });
    node.addEventListener('dragleave', function () { node.classList.remove('over'); });
    node.addEventListener('drop', function (e) {
      e.preventDefault();
      node.classList.remove('over');
      var fs = Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.files) || []);
      if (fs.length) onFiles(fs);
    });
  }

  var DD_VALUE = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  var DD_INDEX = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');
  var CHEVRON = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5"/></svg>';
  var TICK = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 4.5"/></svg>';
  var dd = { pop: null, cur: null, active: -1, typed: '', typedAt: 0 };

  function ddClose(focus) {
    var c = dd.cur;
    if (!c) return;
    dd.cur = null;
    dd.pop.hidden = true;
    dd.pop.textContent = '';
    c.btn.setAttribute('aria-expanded', 'false');
    c.btn.removeAttribute('aria-activedescendant');
    if (focus) c.btn.focus({ preventScroll: true });
  }
  function ddActivate(i) {
    var opts = dd.pop.children;
    if (!opts.length) return;
    i = Math.max(0, Math.min(opts.length - 1, i));
    if (opts[dd.active]) opts[dd.active].classList.remove('act');
    dd.active = i;
    opts[i].classList.add('act');
    dd.cur.btn.setAttribute('aria-activedescendant', opts[i].id);
    var top = opts[i].offsetTop, bottom = top + opts[i].offsetHeight;
    if (top < dd.pop.scrollTop) dd.pop.scrollTop = top - 6;
    else if (bottom > dd.pop.scrollTop + dd.pop.clientHeight) dd.pop.scrollTop = bottom - dd.pop.clientHeight + 6;
  }
  function ddChoose(i) {
    var c = dd.cur;
    ddClose(true);
    if (!c || i < 0 || i === DD_INDEX.get.call(c.sel)) return;
    DD_INDEX.set.call(c.sel, i);
    c.sync();
    c.sel.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function ddOpen(c) {
    if (dd.cur) ddClose(false);
    var sel = c.sel;
    if (!sel.options.length) return;
    var pop = dd.pop;
    pop.className = 'dd-pop' + (c.wrap.classList.contains('mono') ? ' mono' : '') + (c.wrap.closest('.pv-ctrl') ? ' pv' : '');
    pop.setAttribute('aria-label', c.btn.getAttribute('aria-label') || '');
    Array.prototype.forEach.call(sel.options, function (o, i) {
      var opt = el('div', { class: 'dd-opt', role: 'option', id: 'dd-opt-' + i, 'aria-selected': String(i === sel.selectedIndex) }, [el('span', { text: o.text })]);
      opt.insertAdjacentHTML('beforeend', TICK);
      opt.addEventListener('pointerdown', function (e) { e.preventDefault(); });
      opt.addEventListener('pointermove', function () { if (dd.active !== i) ddActivate(i); });
      opt.addEventListener('click', function () { ddChoose(i); });
      pop.appendChild(opt);
    });
    dd.cur = c;
    c.btn.setAttribute('aria-expanded', 'true');
    pop.hidden = false;
    var r = c.btn.getBoundingClientRect();
    var vw = document.documentElement.clientWidth, vh = window.innerHeight;
    var w = Math.min(Math.max(r.width, 200), vw - 32);
    var below = vh - r.bottom - 16, above = r.top - 16;
    var up = below < Math.min(pop.scrollHeight, 240) && above > below;
    pop.style.width = w + 'px';
    pop.style.left = Math.max(16, Math.min(r.left, vw - w - 16)) + 'px';
    pop.style.maxHeight = Math.max(120, Math.min(320, up ? above : below)) + 'px';
    pop.style.top = up ? '' : (r.bottom + 6) + 'px';
    pop.style.bottom = up ? (vh - r.top + 6) + 'px' : '';
    pop.classList.toggle('up', up);
    dd.active = -1;
    ddActivate(Math.max(0, sel.selectedIndex));
  }
  function ddType(ch) {
    var now = Date.now();
    dd.typed = (now - dd.typedAt < 700 ? dd.typed : '') + ch.toLowerCase();
    dd.typedAt = now;
    var opts = Array.prototype.slice.call(dd.cur.sel.options);
    for (var k = 1; k <= opts.length; k += 1) {
      var i = (dd.active + (dd.typed.length > 1 ? k - 1 : k)) % opts.length;
      if (opts[i].text.toLowerCase().indexOf(dd.typed) === 0) { ddActivate(i); return; }
    }
  }
  function ddKey(c, e) {
    var k = e.key;
    if (dd.cur !== c) {
      if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ') { e.preventDefault(); ddOpen(c); }
      return;
    }
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); ddClose(true); }
    else if (k === 'Tab') ddClose(false);
    else if (k === 'Enter' || k === ' ') { e.preventDefault(); ddChoose(dd.active); }
    else if (k === 'ArrowDown') { e.preventDefault(); ddActivate(dd.active + 1); }
    else if (k === 'ArrowUp') { e.preventDefault(); ddActivate(dd.active - 1); }
    else if (k === 'Home' || k === 'PageUp') { e.preventDefault(); ddActivate(k === 'Home' ? 0 : dd.active - 8); }
    else if (k === 'End' || k === 'PageDown') { e.preventDefault(); ddActivate(k === 'End' ? Infinity : dd.active + 8); }
    else if (k.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); ddType(k); }
  }
  function ddSetup() {
    if (dd.pop) return;
    dd.pop = el('div', { class: 'dd-pop', id: 'dd-pop', role: 'listbox', hidden: true });
    document.body.appendChild(dd.pop);
    document.addEventListener('pointerdown', function (e) {
      if (dd.cur && !dd.pop.contains(e.target) && !dd.cur.btn.contains(e.target)) ddClose(false);
    }, true);
    document.addEventListener('scroll', function (e) { if (dd.cur && e.target !== dd.pop) ddClose(false); }, true);
    window.addEventListener('resize', function () { ddClose(false); });
    window.addEventListener('blur', function () { ddClose(false); });
  }

  function dropdown(sel, mono) {
    if (sel.ddWrap) return sel.ddWrap;
    ddSetup();
    var btn = el('button', { type: 'button', class: 'dd-btn', id: (sel.id || 'dd' + newId()) + '-btn', role: 'combobox', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-controls': 'dd-pop', 'aria-label': sel.getAttribute('aria-label') }, [el('span', { class: 'dd-val' })]);
    btn.insertAdjacentHTML('beforeend', CHEVRON);
    var wrap = el('div', { class: 'dd' + (mono ? ' mono' : '') });
    if (sel.parentNode) sel.parentNode.replaceChild(wrap, sel);
    wrap.appendChild(sel);
    wrap.appendChild(btn);
    sel.classList.add('dd-native');
    sel.tabIndex = -1;
    sel.setAttribute('aria-hidden', 'true');
    if (sel.id) Array.prototype.forEach.call(document.querySelectorAll('label[for="' + sel.id + '"]'), function (l) { l.htmlFor = btn.id; });
    var c = {
      sel: sel, btn: btn, wrap: wrap,
      sync: function () {
        var o = sel.options[DD_INDEX.get.call(sel)];
        btn.firstChild.textContent = o ? o.text : '—';
        btn.disabled = sel.disabled || !sel.options.length;
        wrap.hidden = sel.hidden;
        if (dd.cur === c && (btn.disabled || wrap.hidden)) ddClose(false);
      }
    };
    Object.defineProperty(sel, 'value', { configurable: true, get: function () { return DD_VALUE.get.call(sel); }, set: function (v) { DD_VALUE.set.call(sel, v); c.sync(); } });
    Object.defineProperty(sel, 'selectedIndex', { configurable: true, get: function () { return DD_INDEX.get.call(sel); }, set: function (v) { DD_INDEX.set.call(sel, v); c.sync(); } });
    new MutationObserver(c.sync).observe(sel, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'disabled'] });
    sel.addEventListener('change', c.sync);
    btn.addEventListener('click', function () { if (dd.cur === c) ddClose(true); else ddOpen(c); });
    btn.addEventListener('keydown', function (e) { ddKey(c, e); });
    sel.ddWrap = wrap;
    c.sync();
    return wrap;
  }

  var mn = { pop: null, btn: null, active: -1 };
  function menuClose(focus) {
    var b = mn.btn;
    if (!b) return;
    mn.btn = null;
    mn.pop.hidden = true;
    mn.pop.textContent = '';
    b.setAttribute('aria-expanded', 'false');
    if (focus) b.focus({ preventScroll: true });
  }
  function menuActivate(i) {
    var opts = mn.pop.children;
    if (!opts.length) return;
    i = (i + opts.length) % opts.length;
    if (opts[mn.active]) opts[mn.active].classList.remove('act');
    mn.active = i;
    opts[i].classList.add('act');
    opts[i].focus({ preventScroll: true });
  }
  function menuSetup() {
    if (mn.pop) return;
    mn.pop = el('div', { class: 'dd-pop menu', role: 'menu', tabindex: '-1', hidden: true });
    document.body.appendChild(mn.pop);
    mn.pop.addEventListener('keydown', function (e) {
      var k = e.key, n = mn.pop.children.length;
      if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); menuClose(true); }
      else if (k === 'Tab') menuClose(false);
      else if (k === 'ArrowDown') { e.preventDefault(); menuActivate(mn.active + 1); }
      else if (k === 'ArrowUp') { e.preventDefault(); menuActivate(mn.active < 0 ? n - 1 : mn.active - 1); }
      else if (k === 'Home') { e.preventDefault(); menuActivate(0); }
      else if (k === 'End') { e.preventDefault(); menuActivate(n - 1); }
    });
    document.addEventListener('pointerdown', function (e) {
      if (mn.btn && !mn.pop.contains(e.target) && !mn.btn.contains(e.target)) menuClose(false);
    }, true);
    document.addEventListener('scroll', function (e) { if (mn.btn && e.target !== mn.pop) menuClose(false); }, true);
    window.addEventListener('resize', function () { menuClose(false); });
    window.addEventListener('blur', function () { menuClose(false); });
  }
  function menuOpen(btn, items, keyboard) {
    menuSetup();
    ddClose(false);
    menuClose(false);
    var pop = mn.pop;
    items.forEach(function (it, i) {
      var opt = el('button', { type: 'button', class: 'dd-opt' + (it.cls ? ' ' + it.cls : ''), role: 'menuitem', tabindex: '-1' });
      opt.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + it.icon + '</svg>';
      opt.appendChild(el('span', { text: it.text }));
      opt.addEventListener('pointermove', function () { if (mn.active !== i) menuActivate(i); });
      opt.addEventListener('click', function () { menuClose(false); it.run(); });
      pop.appendChild(opt);
    });
    mn.btn = btn;
    mn.active = -1;
    btn.setAttribute('aria-expanded', 'true');
    pop.hidden = false;
    var r = btn.getBoundingClientRect();
    var vw = document.documentElement.clientWidth, vh = window.innerHeight;
    var w = Math.min(Math.max(r.width, 220), vw - 32);
    var below = vh - r.bottom - 16, above = r.top - 16;
    var up = below < pop.scrollHeight && above > below;
    pop.style.width = w + 'px';
    pop.style.left = Math.max(16, Math.min(r.left, vw - w - 16)) + 'px';
    pop.style.maxHeight = Math.max(120, up ? above : below) + 'px';
    pop.style.top = up ? '' : (r.bottom + 6) + 'px';
    pop.style.bottom = up ? (vh - r.top + 6) + 'px' : '';
    pop.classList.toggle('up', up);
    if (keyboard) menuActivate(0);
    else pop.focus({ preventScroll: true });
  }
  function menuBtn(cls, text, items) {
    var b = el('button', { type: 'button', class: 'btn sm ' + cls, 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, [el('span', { text: text })]);
    b.insertAdjacentHTML('beforeend', CHEVRON);
    b.addEventListener('click', function (e) { if (mn.btn === b) menuClose(false); else menuOpen(b, items, e.detail === 0); });
    b.addEventListener('keydown', function (e) {
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && mn.btn !== b) { e.preventDefault(); menuOpen(b, items, true); }
    });
    return b;
  }

  function infoBtn(key) { return el('button', { type: 'button', class: 'info', 'data-info': key, 'aria-label': 'Що таке: ' + Info.title(key), text: 'i' }); }

  var KEY_ICON = '<path d="M12 3.5 20.5 12 12 20.5 3.5 12Z"/>';
  var BAR_PARTS = ['bar', 'bar_fill', 'bar_shine', 'bar_head', 'bar_glow', 'bar_clip', 'bar_flash'];
  var kd = { c: null, row: null, bound: false };
  function spacerSlots(c) { return K.listOf(c.spacers).map(function (s) { return K.spacerItem(s).split('@')[0]; }).filter(Boolean); }
  function barOn(c) { return !!String(c.bar || '').trim(); }
  function partReserved(c) {
    var out = ['root', 'art'];
    spacerSlots(c).forEach(function (s) { out.push(s, s + '_bone'); });
    return barOn(c) ? out.concat(BAR_PARTS) : out;
  }
  function keyTargets(c) {
    var out = ['art'].concat((c.parts || []).map(function (p) { return p ? K.slug(p.name) : ''; }), spacerSlots(c), barOn(c) ? BAR_PARTS.filter(function (n) { return n !== 'bar_clip'; }) : [], ['all']);
    return out.filter(function (n, i) { return n && out.indexOf(n) === i; });
  }
  function keysOf(row) {
    var k = row && row.keys;
    if (typeof k === 'string') { try { k = JSON.parse(k); } catch (e) { return null; } }
    return k && typeof k === 'object' && !Array.isArray(k) ? k : null;
  }
  function keyLine(k) {
    if (!k || typeof k !== 'object' || Array.isArray(k)) return JSON.stringify(k);
    var f = Object.keys(k);
    return f.length ? '{ ' + f.map(function (n) { return JSON.stringify(n) + ': ' + JSON.stringify(k[n]); }).join(', ') + ' }' : '{}';
  }
  function keysText(keys) {
    var t = Object.keys(keys);
    if (!t.length) return '{}';
    return '{\n' + t.map(function (n) {
      var v = keys[n];
      return '  ' + JSON.stringify(n) + ': ' + (Array.isArray(v) && v.length ? '[\n' + v.map(function (k) { return '    ' + keyLine(k); }).join(',\n') + '\n  ]' : JSON.stringify(v));
    }).join(',\n') + '\n}';
  }
  function keysClose() {
    var d = $('keys-dlg');
    if (typeof d.close === 'function') d.close(); else d.removeAttribute('open');
  }
  function keysCheck() {
    var nk = K.normKeys($('keys-text').value), tg = kd.c ? keyTargets(kd.c) : [];
    var out = nk.errors.map(function (e) { return el('li', { text: e }); });
    Object.keys(nk.keys).forEach(function (n) {
      if (tg.indexOf(n) === -1) out.push(el('li', { class: 'warn', text: 'немає цілі ' + n }));
      else if (n === 'all' && nk.keys.all.some(function (k) { return ['x', 'y', 'scale', 'sx', 'sy', 'rotate'].some(function (f) { return k[f] !== undefined; }); })) out.push(el('li', { class: 'warn', text: 'all бере лише alpha і color' }));
    });
    $('keys-errs').replaceChildren.apply($('keys-errs'), out);
    $('keys-save').disabled = nk.errors.length > 0;
    return !nk.errors.length;
  }
  function keysSave() {
    if (!kd.row || !keysCheck()) return;
    var text = $('keys-text').value.trim();
    var data = text ? JSON.parse(text) : null;
    if (data && typeof data === 'object' && !Array.isArray(data) && Object.keys(K.normKeys(data).keys).length) kd.row.keys = data;
    else delete kd.row.keys;
    keysClose();
    changed({ render: true });
  }
  function keysBind() {
    if (kd.bound) return;
    kd.bound = true;
    var d = $('keys-dlg'), down = false;
    $('keys-close').addEventListener('click', keysClose);
    $('keys-cancel').addEventListener('click', keysClose);
    $('keys-save').addEventListener('click', keysSave);
    $('keys-text').addEventListener('input', keysCheck);
    d.addEventListener('pointerdown', function (e) { down = e.target === d; });
    d.addEventListener('click', function (e) { if (e.target === d && down) keysClose(); });
  }
  function openKeys(c, row) {
    keysBind();
    kd.c = c;
    kd.row = row;
    var k = keysOf(row), first = (c.parts || []).map(function (p) { return p ? K.slug(p.name) : ''; }).filter(Boolean)[0] || 'art';
    var ex = {};
    ex[first] = [{ t: 0, scale: 1, ease: 'ease-out' }, { t: 0.3, scale: 1.1 }, { t: 0.6, scale: 1 }];
    var pk = K.PRESETS[row.preset] ? row.preset : K.presetFor(row.name, 'custom');
    $('h-keys').textContent = 'Ключі · ' + row.name;
    $('keys-hint').replaceChildren('Поверх руху «' + (K.PRESETS[pk] ? K.PRESETS[pk].label : pk) + '», ' + String(Number(row.duration) || 0).replace('.', ',') + ' с', infoBtn('keys'));
    $('keys-tg').replaceChildren.apply($('keys-tg'), [el('span', { text: 'Цілі' })].concat(keyTargets(c).map(function (n) { return el('code', { text: n }); })));
    var t = $('keys-text');
    t.value = k && Object.keys(k).length ? keysText(k) : typeof row.keys === 'string' && row.keys.trim() && !k ? row.keys : keysText(ex);
    keysCheck();
    var d = $('keys-dlg');
    if (typeof d.showModal === 'function') { if (!d.open) d.showModal(); } else d.setAttribute('open', '');
    t.setSelectionRange(0, 0);
    t.scrollTop = 0;
    if (window.matchMedia && window.matchMedia('(pointer: fine)').matches) t.focus({ preventScroll: true });
  }
  function keysBtn(c, a) {
    var tg = Object.keys(K.normKeys(keysOf(a)).keys);
    var b = iconBtn('ghost keys', 'Ключі ' + a.name, KEY_ICON, function () { openKeys(c, a); }, tg.length > 0);
    b.title = tg.length ? 'Ключі: ' + tg.join(', ') : 'Додати ключі';
    return b;
  }

  function animTable(rows, owner) {
    var keyed = !!(owner && owner.type === 'custom');
    var wrap = el('div', { class: keyed ? 'anims keyed' : 'anims' });
    wrap.appendChild(el('div', { class: 'a-head' }, [el('span', { text: 'Анімація' }), el('span', { text: 'Сек' }), el('span', {}, ['Рух', infoBtn('motion')]),el('span', {}, ['Події', infoBtn('events')]), keyed ? el('span', { class: 'a-keys' }, [infoBtn('keys')]) : null, el('span')]));
    rows.forEach(function (a, i) {
      var sel = el('select', { 'aria-label': 'Рух ' + a.name, onchange: function () { a.preset = sel.value; changed(); } });
      Object.keys(K.PRESETS).forEach(function (p) { sel.appendChild(el('option', { value: p, text: K.PRESETS[p].label })); });
      var pick = dropdown(sel);
      sel.value = K.PRESETS[a.preset] ? a.preset : K.presetFor(a.name, 'custom');
      wrap.appendChild(el('div', { class: 'a-row' }, [
        el('input', { type: 'text', value: a.name, spellcheck: 'false', 'aria-label': 'Назва анімації', oninput: function (e) { a.name = e.target.value.trim(); changed(); } }),
        el('input', { type: 'number', value: String(a.duration), min: '0', step: '0.01', 'aria-label': 'Тривалість, с', oninput: function (e) { a.duration = Number(e.target.value); changed(); } }),
        pick,
        el('input', { type: 'text', class: 'ev', value: typeof a.events === 'string' ? a.events : '', placeholder: 'onEvent@0.5', spellcheck: 'false', 'aria-label': 'Події', oninput: function (e) { a.events = e.target.value; changed(); } }),
        keyed ? keysBtn(owner, a) : null,
        el('button', { type: 'button', class: 'btn ghost icon del', title: 'Прибрати', 'aria-label': 'Прибрати ' + a.name, text: '✕', onclick: function () { rows.splice(i, 1); changed({ render: true }); } })
      ]));
    });
    wrap.appendChild(el('div', {}, [el('button', { type: 'button', class: 'btn ghost sm', text: '+ анімація', onclick: function () { rows.push(A('anim_' + (rows.length + 1), 0.5, 'hold')); changed({ render: true }); } })]));
    return wrap;
  }

  function textField(label, value, cls, onInput, placeholder, info) {
    var id = 'i' + newId();
    return el('div', { class: 'field' }, [
      el('span', { class: 'lbl' }, [el('label', { for: id, text: label }), info ? infoBtn(info) : null]),
      el('input', { type: 'text', id: id, class: cls || null, value: value || '', placeholder: placeholder || null, spellcheck: 'false', autocomplete: 'off', oninput: function (e) { onInput(e.target.value, e.target); } })
    ]);
  }
  function listField(label, value, onSet, placeholder, info) {
    var f = textField(label, value, null, onSet, placeholder, info);
    var input = f.querySelector('input');
    input.addEventListener('change', function () {
      input.value = K.listOf(input.value).map(info === 'spacers' ? K.spacerItem : K.slug).filter(function (s, i, a) { return s && a.indexOf(s) === i; }).join(', ');
      onSet(input.value);
    });
    return f;
  }
  function numPair(label, a, b, onA, onB, labels, info) {
    return el('div', { class: 'field' }, [
      el('span', { class: 'lbl' }, [label, info ? infoBtn(info) : null]),
      el('span', { class: 'dims' }, [
        el('input', { type: 'number', value: String(a), 'aria-label': labels[0], step: 'any', oninput: function (e) { onA(e.target.value); } }),
        labels[2] || '×',
        el('input', { type: 'number', value: String(b), 'aria-label': labels[1], step: 'any', oninput: function (e) { onB(e.target.value); } })
      ])
    ]);
  }

  function imageRow(key, note, after) {
    var im = imgs(key).images[key];
    var row = el('div', { class: 'img-row' }, [
      el('div', { class: 'prev' }, [el('img', { alt: '', src: thumb(art(key)) })])
    ].concat(fileButton(im ? 'Замінити' : 'Картинка', 'image/png,image/webp,image/jpeg', false, function (fs) { addImageFile(key, fs[0], after); }))
      .concat([im ? el('button', { type: 'button', class: 'btn ghost sm', text: 'Прибрати', onclick: function () { dropImage(key); } }) : null, el('span', { class: 'note', text: note || (im ? im.fileName : 'заглушка') })]));
    dropTarget(row, function (fs) { addImageFile(key, fs[0], after); });
    return row;
  }

  function symbolsBody(c) {
    var body = el('div', { class: 'comp-body' });
    var tiles = el('div', { class: 'tiles' });
    c.symbols.forEach(function (s) {
      tiles.appendChild(el('button', { type: 'button', class: 'tile', 'aria-pressed': String(state.sel === s.name), title: s.name, onclick: function () { state.sel = state.sel === s.name ? null : s.name; renderComponents(); } }, [
        el('img', { alt: '', src: thumb(art('sym:' + s.name)) }),
        el('span', {}, [s.name, s.ownAnims ? el('b', { class: 'own', text: ' •' }) : null])
      ]));
    });
    tiles.appendChild(el('button', { type: 'button', class: 'tile add', title: 'Додати символ', 'aria-label': 'Додати символ', text: '+', onclick: function () {
      var n = 1;
      while (c.symbols.some(function (s) { return s.name === 'symbol_' + n; })) n++;
      c.symbols.push({ name: 'symbol_' + n });
      state.sel = 'symbol_' + n;
      changed({ render: true });
    } }));
    dropTarget(tiles, addSymbolFiles);
    body.appendChild(el('div', { class: 'sub', text: 'Символи' }));
    body.appendChild(tiles);
    body.appendChild(el('div', { class: 'img-row' }, fileButton('Додати PNG', 'image/png,image/webp,image/jpeg', true, addSymbolFiles).concat([el('span', { class: 'note', text: 'назва файлу = назва символу' })])));
    var s = c.symbols.filter(function (x) { return x.name === state.sel; })[0];
    if (s) {
      var key = 'sym:' + s.name;
      var nameInput = el('input', { type: 'text', value: s.name, spellcheck: 'false', 'aria-label': 'Назва символу', class: 'w-name' });
      nameInput.addEventListener('change', function () {
        var n = K.slug(nameInput.value);
        if (!n || (n !== s.name && c.symbols.some(function (x) { return x.name === n; }))) { nameInput.value = s.name; toast(n ? 'Символ ' + n + ' вже є' : 'Порожня назва'); return; }
        moveSymbolImages(s.name, n);
        s.name = n;
        state.sel = n;
        changed({ render: true, images: true });
      });
      var picBlock = function (k, what, cap) {
        var pickFile = fileButton('', 'image/png,image/webp,image/jpeg', false, function (fs) { addImageFile(k, fs[0]); });
        var pickLabel = pickFile[1];
        var picTitle = (state.images[k] ? 'Замінити ' : 'Додати ') + what;
        pickLabel.className = 'btn icon';
        pickLabel.title = picTitle;
        pickLabel.setAttribute('aria-label', picTitle);
        pickLabel.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS.upload + '</svg>';
        var pic = el('label', { class: 'pic', for: pickLabel.htmlFor, title: picTitle + ' (або перетягни файл)' }, [el('img', { alt: '', src: thumb(art(k)) })]);
        dropTarget(pic, function (fs) { addImageFile(k, fs[0]); });
        return el('div', { class: 'sym-pic' }, [pic, cap ? el('span', { class: 'note pic-cap', text: cap }) : null, el('div', { class: 'pic-act' }, [pickFile[0], pickLabel, state.images[k] ? iconBtn('pic-del', 'Прибрати ' + what, ICONS.x, function () { dropImage(k); }) : null])]);
      };
      var edit = el('div', { class: 'sym-edit' }, [
        el('div', { class: 'sym-pics' }, [
          picBlock(key, 'картинку', 'основна'),
          c.blur !== false ? picBlock('blur:' + s.name, 'блюр', state.images['blur:' + s.name] ? '_blur' : '_blur · авто') : null
        ]),
        el('div', { class: 'grid' }, [
          el('div', { class: 'row' }, [el('div', { class: 'field' }, [el('span', { class: 'lbl', text: 'Назва' }), nameInput])]),
          el('label', { class: 'switch' }, [el('input', { type: 'checkbox', checked: !!s.ownAnims, onchange: function (e) {
            s.ownAnims = e.target.checked;
            if (s.ownAnims && !s.anims) s.anims = JSON.parse(JSON.stringify(c.anims));
            changed({ render: true });
          } }), 'Свої анімації']),
          s.ownAnims ? animTable(s.anims) : null,
          el('button', { type: 'button', class: 'btn sm sym-del', text: 'Видалити символ', onclick: function () {
            c.symbols = c.symbols.filter(function (x) { return x !== s; });
            forgetSymbolImages(s.name);
            state.sel = null;
            changed({ render: true, images: true });
          } })
        ])
      ]);
      body.appendChild(edit);
    }
    body.appendChild(el('div', { class: 'sub' }, ['Анімації символів', infoBtn('anims')]));
    body.appendChild(animTable(c.anims));
    body.appendChild(el('div', { class: 'row', style: 'align-items: center; gap: 4px;' }, [el('label', { class: 'switch' }, [el('input', { type: 'checkbox', checked: !!c.txt, onchange: function (e) { c.txt = e.target.checked; changed(); } }), 'Слот txt_amount для суми виграшу']), infoBtn('spacers')]));
    body.appendChild(el('div', { class: 'row', style: 'align-items: center; gap: 4px;' }, [el('label', { class: 'switch' }, [el('input', { type: 'checkbox', checked: c.blur !== false, onchange: function (e) { c.blur = e.target.checked; changed({ render: true }); } }), 'Блюр у скінах _blur'])]));
    body.appendChild(el('div', { class: 'row' }, [el('div', { class: 'field' }, [el('span', { class: 'lbl', text: 'Розмір символу, % клітинки' }),
      el('input', { type: 'number', value: String(Number(c.fill) > 0 ? c.fill : 84), min: '10', max: '100', step: '1', 'aria-label': 'Розмір символу, % клітинки', oninput: function (e) { var v = Number(e.target.value); if (v > 0) { c.fill = Math.min(100, v); changed(); } } })])]));
    return body;
  }

  function reelsBody() {
    var g = geo();
    var cols = 'animation_reels_' + g.C + '_columns', rows = 'animation_reel_' + g.R + '_rows';
    var sp = state.plan ? state.plan.spines.filter(function (x) { return x.name === rows; })[0] : null;
    var dur = function (n) { var a = sp && sp.contract.animations.filter(function (x) { return x.name === n; })[0]; return a ? String(a.duration).replace('.', ',') + ' с' : ''; };
    return el('div', { class: 'comp-body' }, [el('div', { class: 'row' }, [gridSetBtn('btn sm')]), el('dl', { class: 'facts' }, [
      el('dt', { text: cols }), el('dd', { text: 'reel_0 … reel_' + (g.C - 1) + ' · крок ' + g.W + ' px' }),
      el('dt', { text: rows }), el('dd', { text: 'slot_1 … slot_' + g.R + ' видно, slot_0 за кадром · крок ' + g.H + ' px' }),
      el('dt', { text: 'Спін' }), el('dd', { text: 'spin_loop ' + dur('spin_loop') + ' · spin_stop ' + dur('spin_stop') }),
      el('dt', { text: 'Події' }), el('dd', { text: 'onOffScreen, onFinalSymbol, onStopReelSound' })
    ])]);
  }

  function frameBody(c) {
    var key = c.type;
    var im = state.images[key];
    var note = null;
    if (key === 'frame_above') note = !im ? 'заглушка' : im.win ? 'вікно ' + Math.round(im.win.right - im.win.left) + '×' + Math.round(im.win.bottom - im.win.top) + ' px → сітка' : 'вікна немає: по центру';
    return el('div', { class: 'comp-body' }, [
      el('div', { class: 'sub', text: 'Картинка' }),
      imageRow(key, note),
      el('div', { class: 'row' }, [
        listField('Скіни', c.skins, function (v) { c.skins = v; changed(); }, null, 'skins'),
        listField('Спейсери', c.spacers, function (v) { c.spacers = v; changed(); }, key === 'frame_above' ? 'txt_pays_left, txt_pays_right' : '', 'spacers')
      ]),
      el('div', { class: 'sub', text: 'Анімації' }),
      animTable(c.anims)
    ]);
  }

  var PIVOT_OPTS = [['', 'Центр'], ['bottom', 'Низ'], ['top', 'Верх'], ['left', 'Ліво'], ['right', 'Право']];
  function pickField(label, aria, opts, value, set, info, quiet) {
    var sel = el('select', { 'aria-label': aria });
    opts.forEach(function (o) { sel.appendChild(el('option', { value: o[0], text: o[1] })); });
    sel.addEventListener('change', function () { set(sel.value); changed(quiet ? null : { render: true }); });
    var pick = dropdown(sel);
    sel.value = value;
    return el('div', { class: 'field pick' }, [el('span', { class: 'lbl' }, [label, info ? infoBtn(info) : null]), pick]);
  }
  function pivotField(o, aria, quiet) {
    var cur = K.pivotName(o.pivot);
    var opts = PIVOT_OPTS.some(function (p) { return p[0] === cur; }) ? PIVOT_OPTS : PIVOT_OPTS.concat([[cur, cur]]);
    return pickField('Опорна точка', aria, opts, cur, function (v) { if (v) o.pivot = v; else delete o.pivot; }, 'pivot', quiet);
  }
  function partHex(p) {
    return K.hexOf(p.color) || partRgb({ name: p.name, shape: p.shape }).map(function (v) { return ('0' + Math.max(0, Math.min(255, v)).toString(16)).slice(-2); }).join('');
  }
  function partFree(c, n, self) {
    return !!n && partReserved(c).indexOf(n) === -1 && !(c.parts || []).some(function (p) { return p && p !== self && K.slug(p.name) === n; });
  }
  function freePart(c, base) {
    var n = 2, name = base;
    while (!partFree(c, name)) name = base + '_' + n++;
    return name;
  }
  function partKids(c, name) {
    var out = [name], grew = true;
    while (grew) {
      grew = false;
      (c.parts || []).forEach(function (x) { if (x && x.name && out.indexOf(x.name) === -1 && out.indexOf(x.parent) !== -1) { out.push(x.name); grew = true; } });
    }
    return out;
  }
  function renameTarget(a, from, to) {
    var k = keysOf(a), f = K.slug(from);
    if (!k || !Object.keys(k).some(function (t) { return t !== 'all' && K.slug(t) === f; })) return;
    var out = {};
    Object.keys(k).forEach(function (t) {
      var n = t !== 'all' && K.slug(t) === f ? to : t;
      out[n] = Array.isArray(out[n]) && Array.isArray(k[t]) ? out[n].concat(k[t]) : k[t];
    });
    a.keys = out;
  }
  function renamePart(c, p, input) {
    var n = K.slug(input.value), old = p.name;
    if (n === old) { input.value = old; return; }
    var why = !n ? 'Порожня назва' : partReserved(c).indexOf(n) !== -1 ? 'Назва ' + n + ' зарезервована' : !partFree(c, n, p) ? 'Частина ' + n + ' вже є' : '';
    if (why) { input.value = old; toast(why); return; }
    movePartImage(c, old, n);
    (c.parts || []).forEach(function (x) { if (x && x.parent === old) x.parent = n; });
    (c.anims || []).forEach(function (a) { renameTarget(a, old, n); });
    p.name = n;
    state.selPart[c.id] = n;
    changed({ render: true, images: true });
  }
  async function addPartFiles(c, files) {
    var last = null;
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (!/^image\//.test(f.type)) continue;
      var p = { name: freePart(c, K.slug(f.name) || 'part'), w: 100, h: 100 };
      try {
        var nat = await setImage(partKey(c, p.name), f, f.name);
        p.w = nat.w;
        p.h = nat.h;
        if (!c.parts) c.parts = [];
        c.parts.push(p);
        last = p.name;
      } catch (e) { toast('Не вдалося прочитати ' + f.name); }
    }
    if (!last) return;
    state.selPart = state.selPart || {};
    state.selPart[c.id] = last;
    changed({ render: true, images: true });
  }
  function partTiles(c) {
    state.selPart = state.selPart || {};
    var sel = state.selPart[c.id];
    var tiles = el('div', { class: 'tiles' });
    (c.parts || []).forEach(function (p) {
      if (!p || !p.name) return;
      tiles.appendChild(el('button', { type: 'button', class: 'tile', 'aria-pressed': String(sel === p.name), title: p.name, onclick: function () { state.selPart[c.id] = sel === p.name ? null : p.name; renderComponents(); } }, [
        el('img', { alt: '', src: thumb(art(partKey(c, p.name))) }),
        el('span', { text: p.name })
      ]));
    });
    tiles.appendChild(el('button', { type: 'button', class: 'tile add', title: 'Додати частину', 'aria-label': 'Додати частину', text: '+', onclick: function () {
      var n = 1;
      while (!partFree(c, 'part_' + n)) n++;
      if (!c.parts) c.parts = [];
      c.parts.push({ name: 'part_' + n, w: 100, h: 100 });
      state.selPart[c.id] = 'part_' + n;
      changed({ render: true });
    } }));
    dropTarget(tiles, function (fs) { addPartFiles(c, fs); });
    return tiles;
  }
  function partEditor(c) {
    var sel = (state.selPart || {})[c.id];
    var p = (c.parts || []).filter(function (x) { return x && x.name === sel; })[0];
    if (!p) return null;
    var k = partKey(c, p.name), im = imgs(k).images[k];
    var after = function (natural) { p.w = natural.w; p.h = natural.h; };
    var pick = fileButton('', 'image/png,image/webp,image/jpeg', false, function (fs) { addImageFile(k, fs[0], after); });
    var what = (im ? 'Замінити' : 'Додати') + ' картинку';
    pick[1].className = 'btn icon';
    pick[1].title = what;
    pick[1].setAttribute('aria-label', what);
    pick[1].innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS.upload + '</svg>';
    var pic = el('label', { class: 'pic', for: pick[1].htmlFor, title: what + ' (або перетягни файл)' }, [el('img', { alt: '', src: thumb(art(k)) })]);
    dropTarget(pic, function (fs) { addImageFile(k, fs[0], after); });
    var nameIn = el('input', { type: 'text', value: p.name, spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Назва частини' });
    nameIn.addEventListener('change', function () { renamePart(c, p, nameIn); });
    var kids = partKids(c, p.name), par = p.parent || 'art';
    var parents = [['art', 'Основна картинка']].concat((c.parts || []).filter(function (x) { return x && x.name && kids.indexOf(x.name) === -1; }).map(function (x) { return [x.name, x.name]; }));
    if (!parents.some(function (o) { return o[0] === par; })) parents.push([par, par]);
    var w = Number(p.w) > 0 ? p.w : im ? im.w : 100, h = Number(p.h) > 0 ? p.h : im ? im.h : 100;
    var box = function (label, input, tail) { return el('div', { class: 'field' }, [el('span', { class: 'lbl', text: label }), el('span', { class: 'dims' }, [input, tail || null])]); };
    var rot = el('input', { type: 'number', value: String(Number(p.rotate) || 0), step: 'any', 'aria-label': 'Поворот частини, градуси', oninput: function (e) { var v = Number(e.target.value) || 0; if (v) p.rotate = v; else delete p.rotate; changed(); } });
    var alpha = el('input', { type: 'number', value: String(p.alpha !== undefined && isFinite(Number(p.alpha)) ? Number(p.alpha) : 1), min: '0', max: '1', step: '0.05', 'aria-label': 'Прозорість частини на старті', oninput: function (e) {
      var s = e.target.value;
      if (s === '' || !isFinite(Number(s))) return;
      var v = Math.max(0, Math.min(1, Number(s)));
      if (v >= 1) delete p.alpha; else p.alpha = v;
      changed();
    } });
    var color = el('input', { type: 'color', value: '#' + partHex(p), 'aria-label': 'Колір частини', oninput: function (e) { p.color = e.target.value.slice(1).toLowerCase(); changed(); }, onchange: function () { changed({ render: true }); } });
    return el('div', { class: 'sym-edit part-edit' }, [
      el('div', { class: 'sym-pics' }, [el('div', { class: 'sym-pic' }, [pic, el('div', { class: 'pic-act' }, [pick[0], pick[1], im ? iconBtn('pic-del', 'Прибрати картинку частини', ICONS.x, function () { dropImage(k); }) : null])])]),
      el('div', { class: 'grid' }, [
        el('div', { class: 'row' }, [
          el('div', { class: 'field' }, [el('span', { class: 'lbl', text: 'Назва' }), nameIn]),
          pickField('Батько', 'Батько частини', parents, par, function (v) { p.parent = v; })
        ]),
        el('div', { class: 'row' }, [
          numPair(el('span', {}, ['Центр X, Y ', el('span', { class: 'hint', text: 'від батька, y угору' })]), p.x || 0, p.y || 0, function (v) { p.x = Number(v) || 0; changed(); }, function (v) { p.y = Number(v) || 0; changed(); }, ['X', 'Y', ',']),
          numPair('Розмір', w, h, function (v) { if (Number(v) > 0) p.w = Number(v); else delete p.w; changed(); }, function (v) { if (Number(v) > 0) p.h = Number(v); else delete p.h; changed(); }, ['Ширина', 'Висота']),
          pivotField(p, 'Опорна точка частини'),
          box('Поворот', rot, '°')
        ]),
        el('div', { class: 'row' }, [
          pickField('Шар', 'Шар частини', [['', 'Над картинкою'], ['behind', 'Під картинкою']], p.behind === true ? 'behind' : '', function (v) { if (v) p.behind = true; else delete p.behind; }),
          pickField('Змішування', 'Змішування частини', [['normal', 'Звичайне'], ['additive', 'Додавання'], ['multiply', 'Множення'], ['screen', 'Екран']], K.BLENDS.indexOf(p.blend) > 0 ? p.blend : 'normal', function (v) { if (v === 'normal') delete p.blend; else p.blend = v; }),
          box('Прозорість на старті', alpha)
        ]),
        el('div', { class: 'row' }, [
          pickField('Заглушка', 'Заглушка частини', [['', 'Картка з назвою'], ['rect', 'Прямокутник'], ['circle', 'Коло'], ['ring', 'Кільце'], ['glow', 'Світіння'], ['star', 'Зірка']], K.SHAPES.indexOf(p.shape) > 0 ? p.shape : '', function (v) { if (v) p.shape = v; else delete p.shape; }),
          box('Колір', color, p.color ? el('button', { type: 'button', class: 'btn ghost sm', text: 'Скинути', 'aria-label': 'Скинути колір частини', onclick: function () { delete p.color; changed({ render: true }); } }) : null)
        ]),
        el('button', { type: 'button', class: 'btn sm sym-del', text: 'Видалити частину', onclick: function () {
          var n = p.name;
          c.parts = (c.parts || []).filter(function (x) { return x !== p; });
          c.parts.forEach(function (x) { if (x && x.parent === n) x.parent = 'art'; });
          if (!c.parts.length) delete c.parts;
          forgetImage(partKey(c, n));
          state.selPart[c.id] = null;
          changed({ render: true, images: true });
        } })
      ])
    ]);
  }

  function customBody(c) {
    var key = 'c:' + c.id;
    return el('div', { class: 'comp-body' }, [
      el('div', { class: 'row', style: 'padding-top: 10px;' }, [
        textField('Назва спайна', c.name, 'w-name', function (v) { c.name = v; changed(); }),
        listField('Скіни', c.skins, function (v) { c.skins = v; changed(); }, null, 'skins'),
        listField('Спейсери', c.spacers, function (v) { c.spacers = v; changed(); }, 'txt_amount', 'spacers')
      ]),
      imageRow(key, null, function (natural) { fitSize(c, natural); }),
      el('div', { class: 'row' }, [
        numPair('Розмір у грі, px', c.w, c.h, function (v) { c.w = Number(v); changed(); }, function (v) { c.h = Number(v); changed(); }, ['Ширина', 'Висота'], 'custom'),
        numPair('Центр X, Y', c.x || 0, c.y || 0, function (v) { c.x = Number(v); changed(); }, function (v) { c.y = Number(v); changed(); }, ['X', 'Y', ',']),
        pivotField(c, 'Опорна точка компонента', true),
        textField('Прогрес-бар', c.bar, null, function (v) { c.bar = v.trim(); changed(); }, 'x:y:ширина:висота', 'bar')
      ]),
      el('div', { class: 'sub' }, ['Частини', infoBtn('parts')]),
      partTiles(c),
      partEditor(c),
      el('div', { class: 'sub', text: 'Анімації' }),
      animTable(c.anims, c),
      el('div', { class: 'row', style: 'justify-content: flex-end; padding-top: 10px;' }, [
        labelBtn('Експорт', ICONS.download, { type: 'button', class: 'btn ghost sm', title: 'Зберегти в .component.json', 'aria-label': 'Експорт ' + compTitle(c), onclick: async function () {
          try {
            var r = await exportComponent(c);
            await saveFile(r.name, new Blob([r.text], { type: 'application/json' }));
            toast('Компонент збережено у файл');
          } catch (e) { toast('Не вдалося зберегти: ' + ((e && e.message) || e)); }
        } }),
        el('button', { type: 'button', class: 'btn ghost sm', text: '✕ Прибрати компонент', 'aria-label': 'Прибрати ' + (TITLES[c.type] || c.label || 'компонент'), onclick: function () { state.s.components = state.s.components.filter(function (x) { return x !== c; }); forgetComponentImages(c); changed({ render: true, images: true }); } })
      ])
    ]);
  }

  function compSpines(id) { return state.plan ? state.plan.spines.filter(function (s) { return s.comp === id; }) : []; }
  function compNames(c) {
    var g = geo();
    if (c.type === 'symbols') return 'animation_symbol_* ×' + c.symbols.length + ' · animation_symbols_static';
    if (c.type === 'reels') return 'animation_reels_' + g.C + '_columns · animation_reel_' + g.R + '_rows';
    if (c.type === 'frame_under') return 'animation_reels_frame_under';
    if (c.type === 'frame_above') return 'animation_reels_frame_above';
    return 'animation_' + (K.slug(c.name).replace(/^animation_/, '') || 'element');
  }
  function compThumb(c) {
    if (c.type === 'symbols') return c.symbols.length ? art('sym:' + c.symbols[0].name) : null;
    if (c.type === 'reels') return reelsIcon();
    if (c.type === 'frame_under' || c.type === 'frame_above') return art(c.type);
    return art('c:' + c.id);
  }
  var reelsIconCache = {};
  function reelsIcon() {
    var g = geo();
    var k = g.C + 'x' + g.R;
    if (reelsIconCache[k]) return reelsIconCache[k];
    var cs = Math.max(3, Math.floor(60 / Math.max(g.C, g.R)));
    var c = el('canvas', { width: g.C * cs + 2, height: g.R * cs + 2 });
    var x = c.getContext('2d');
    for (var i = 0; i < g.C; i++) for (var j = 0; j < g.R; j++) { x.fillStyle = (i + j) % 2 ? '#8e8e93' : '#0a84ff'; x.fillRect(1 + i * cs + 1, 1 + j * cs + 1, cs - 2, cs - 2); }
    reelsIconCache[k] = c;
    return c;
  }

  function card(c) {
    var open = !!state.open[c.id];
    var spines = compSpines(c.id);
    var selected = spines.some(function (s) { return s.name === state.pv.spine; });
    var title = TITLES[c.type] || c.label || 'Компонент';
    var bodyId = 'body-' + c.id;
    var head = el('div', { class: 'comp-head' }, [
      el('button', { type: 'button', class: 'comp-open', 'aria-expanded': String(open), 'aria-controls': bodyId, onclick: function () { state.open[c.id] = !open; renderComponents(); } }, [
        el('span', { class: 'chev', 'aria-hidden': 'true' }),
        el('span', { class: 'comp-thumb', 'aria-hidden': 'true' }, [el('img', { alt: '', src: thumb(compThumb(c)) })]),
        el('span', { class: 'comp-t' }, [el('b', { text: title }), el('code', { 'data-names': c.id, text: compNames(c) })])
      ]),
      infoBtn(c.type === 'custom' ? 'custom' : c.type),
      el('div', { class: 'comp-act' }, [
        labelBtn('Превʼю', ICONS.play, { type: 'button', class: 'btn ghost sm', title: 'Показати в превʼю', 'aria-label': 'Показати ' + title + ' в превʼю', disabled: c.on === false || !spines.length, onclick: function () { showInPreview(c); } })
      ])
    ]);
    var body = null;
    if (open) {
      if (c.type === 'symbols') body = symbolsBody(c);
      else if (c.type === 'reels') body = reelsBody();
      else if (c.type === 'frame_under' || c.type === 'frame_above') body = frameBody(c);
      else body = customBody(c);
      body.id = bodyId;
    }
    return el('article', { class: 'comp' + (c.on === false ? ' off' : '') + (selected ? ' sel' : ''), 'data-id': c.id }, [head, body]);
  }

  function renderComponents() {
    var list = $('c-list');
    var y = window.scrollY;
    var ae = document.activeElement;
    var active = ae && ae.getAttribute('aria-label');
    var caret = ae && typeof ae.selectionStart === 'number' ? [ae.selectionStart, ae.selectionEnd] : null;
    list.textContent = '';
    state.s.components.forEach(function (c) { list.appendChild(card(c)); });
    window.scrollTo(0, y);
    if (active) {
      var again = list.querySelector('[aria-label="' + active.replace(/"/g, '\\"') + '"]');
      if (again) again.focus({ preventScroll: true });
      if (again && caret && typeof again.setSelectionRange === 'function') { try { again.setSelectionRange(caret[0], caret[1]); } catch (e) { caret = null; } }
    }
    if (sbShown()) { renderSbEdit(); renderSbItems(); window.scrollTo(0, y); }
  }

  function showInPreview(c) {
    var sp = compSpines(c.id);
    if (!sp.length) return;
    var pick = sp[0];
    if (c.type === 'symbols' && state.sel) pick = sp.filter(function (s) { return s.name === 'animation_symbol_' + state.sel; })[0] || pick;
    if (c.type === 'reels') pick = sp[1] || pick;
    state.pv.spine = pick.name;
    state.pv.anim = null;
    state.pv.skin = null;
    renderPreview();
    renderComponents();
    var win = $('stage').closest('.window');
    var r = win.getBoundingClientRect();
    var bar = document.querySelector('.bar');
    if (r.top < (bar ? bar.getBoundingClientRect().bottom : 0) || r.bottom > window.innerHeight) win.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

  function attOf(name, slot) {
    var sp = state.plan && state.plan.spines.filter(function (s) { return s.name === name; })[0];
    if (!sp) return null;
    var skin = sp.json.skins.filter(function (s) { return s.attachments && s.attachments[slot]; })[0];
    if (!skin) return null;
    var a = skin.attachments[slot];
    return a[Object.keys(a)[0]];
  }

  function drawGrid(layer) {
    var g = state.plan.geometry;
    var cv = $('grid-canvas');
    var pad = 0.22 * Math.min(g.W, g.H);
    var ww = g.gridW + 2 * g.border + 2 * pad, wh = g.gridH + 2 * g.border + 2 * pad;
    var W = 760, H = Math.round(Math.min(900, Math.max(220, W * wh / ww)));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    var x = cv.getContext('2d');
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.clearRect(0, 0, W, H);
    var s = Math.min(W / ww, H / wh);
    x.setTransform(s, 0, 0, s, W / 2, H / 2);
    var put = function (canvas, a) { if (canvas && a) x.drawImage(canvas, (a.x || 0) - a.width / 2, -(a.y || 0) - a.height / 2, a.width, a.height); };
    var on = function (t) { var c = state.s.components.filter(function (k) { return k.type === t; })[0]; return c && c.on !== false; };
    if (on('frame_under')) put(art('frame_under'), attOf('animation_reels_frame_under', 'frame'));
    else {
      x.strokeStyle = cssVar('--line');
      x.lineWidth = 2 / s;
      for (var i = 0; i < g.C; i++) for (var j = 1; j <= g.R; j++) x.strokeRect(g.reelX[i] - g.W / 2, -g.slotY[j] - g.H / 2, g.W, g.H);
    }
    var sc = symComp();
    if (layer) layer(x);
    else if (sc && sc.on !== false && sc.symbols.length) {
      var grid = startGrid();
      for (var c = 0; c < g.C; c++) {
        for (var r = 1; r <= g.R; r++) {
          var sym = grid[c][r - 1];
          var a = attOf('animation_symbol_' + sym, 'symbol');
          if (a) put(art('sym:' + sym), { x: g.reelX[c], y: g.slotY[r], width: a.width, height: a.height });
        }
      }
    }
    if (on('frame_above')) put(art('frame_above'), attOf('animation_reels_frame_above', 'frame'));
    $('grid-label').textContent = g.C + ' × ' + g.R + ' · ' + g.W + ' × ' + g.H + ' px';
  }

  var spin = { ctl: null, grid: null, layer: null };
  function startGrid() {
    var g = state.plan.geometry;
    var names = symComp().symbols.map(function (s) { return s.name; });
    var last = spin.grid;
    if (last && last.length === g.C && last.every(function (col) { return col.length === g.R && col.every(function (n) { return names.indexOf(n) !== -1; }); })) return last;
    var out = [];
    for (var c = 0; c < g.C; c++) {
      out.push([]);
      for (var r = 1; r <= g.R; r++) out[c].push(names[(c * 3 + r * 7 + c * r) % names.length]);
    }
    return out;
  }
  function spinBlocker() {
    var on = function (t) { var c = state.s.components.filter(function (k) { return k.type === t; })[0]; return c && c.on !== false; };
    if (!state.plan) return 'Ще збираю спайни';
    if (state.lib.spine !== 'ok') return state.lib.spine === 'fail' ? 'Рантайм Spine не завантажився' : 'Завантажую рантайм Spine…';
    if (!on('reels')) return 'Увімкніть Барабани';
    if (!on('symbols') || !symComp().symbols.length) return 'Увімкніть Символи';
    if (state.view === 'layouts') {
      var L = curLayout(), rb = boneFor('reels');
      if (lays().off.reels || !rb || !L || !LK.boneOf(L, rb)) return 'Барабанів немає на цьому лейауті';
    }
    return '';
  }
  var SPIN_LABEL = { idle: 'Спін', spin: 'Стоп', stopping: 'Зупиняю', win: 'Новий спін' };
  function renderSpinBtn() {
    var st = spin.ctl && spin.ctl.running ? spin.ctl.state : 'idle';
    var why = st === 'idle' ? spinBlocker() : '';
    ['spin-go', 'lay-spin-go'].forEach(function (id) {
      var b = $(id);
      b.dataset.state = st;
      b.disabled = !!why;
      b.title = why;
      b.setAttribute('aria-label', SPIN_LABEL[st]);
      if (st === 'stopping') b.setAttribute('aria-disabled', 'true');
      else b.removeAttribute('aria-disabled');
    });
    $('lay-spin-quick').checked = $('spin-quick').checked;
    $('lay-spin-win').checked = $('spin-win').checked;
  }
  function stopSpin() {
    if (!spin.ctl) return;
    spin.ctl.cancel();
    spin.ctl = null;
    if (state.plan) { drawGrid(); drawLayout(); }
    renderSpinBtn();
  }
  function startSpin() {
    if (spin.ctl && spin.ctl.running) {
      var now = spin.ctl.state;
      if (now === 'spin') spin.ctl.quickStop();
      if (now !== 'win') return;
      spin.ctl.skip();
    }
    if (spinBlocker()) return;
    var g = state.plan.geometry;
    try {
      spin.ctl = window.SpineKitSpin.run({
        spine: window.spine,
        geometry: g,
        spines: state.plan.spines,
        symbols: symComp().symbols.map(function (s) { return s.name; }),
        start: startGrid(),
        art: function (n) { return art('sym:' + n); },
        size: function (n) { return attOf('animation_symbol_' + n, 'symbol') || { width: 0.86 * g.W, height: 0.86 * g.H }; },
        blur: function (n) {
          if (symComp().blur === false) return null;
          var st = state.plan.spines.filter(function (x) { return x.name === 'animation_symbols_static'; })[0];
          var sk = st && st.json.skins.filter(function (x) { return x.name === 'symbol_' + n + '_blur'; })[0];
          var a = sk && sk.attachments.symbols.symbols;
          return a ? { img: art('blur:' + n), width: a.width, height: a.height } : null;
        },
        quick: $('spin-quick').checked,
        win: $('spin-win').checked,
        lineColor: cssVar('--brand'),
        paint: function (layer) {
          spin.layer = layer;
          if (state.view === 'layouts') drawLayout(layer);
          else drawGrid(layer);
        },
        onState: function () { renderSpinBtn(); },
        onEnd: function (grid) { spin.grid = grid; drawGrid(); renderSpinBtn(); }
      });
    } catch (e) {
      spin.ctl = null;
      toast('Спін не запустився: ' + e.message);
    }
    renderSpinBtn();
  }

  var downloadsReady = null;
  function initDownloads() {
    try {
      downloadsReady = window.claude && typeof window.claude.use === 'function' ? Promise.resolve(window.claude.use('downloads')).catch(function () { return null; }) : Promise.resolve(null);
    } catch (e) { downloadsReady = Promise.resolve(null); }
  }
  async function saveFile(name, blob) {
    var d = null;
    try { d = await downloadsReady; } catch (e) { d = null; }
    if (d && typeof d.save === 'function') {
      try { await d.save({ filename: name, data: blob }); toast('Збережено: ' + name); return; }
      catch (e) {
        var code = e && e.code;
        if (code === 'declined') return;
        if (code === 'rate_limited') { toast('Зачекайте кілька секунд і спробуйте ще раз'); return; }
        if (code && code !== 'unavailable' && code !== 'not_granted') { toast('Не вдалося зберегти: ' + ((e && e.message) || code)); return; }
      }
    }
    try {
      var url = URL.createObjectURL(blob);
      var a = el('a', { href: url, download: name });
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 4000);
    } catch (e) { toast('Браузер не дав зберегти файл'); }
  }
  function canvasBlob(c) { return new Promise(function (res, rej) { c.toBlob(function (b) { if (b) res(b); else rej(new Error('PNG не створено')); }, 'image/png'); }); }

  function regionCanvas(src, w, h) {
    var c = el('canvas', { width: w, height: h });
    var x = c.getContext('2d');
    if (src === 'white') { x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); }
    else if (src && src !== 'clear') { var a = typeof src === 'string' ? art(src) : src; if (a) x.drawImage(a, 0, 0, w, h); }
    return c;
  }
  function pageCanvas(page) {
    var c = el('canvas', { width: page.width, height: page.height });
    var x = c.getContext('2d');
    page.placements.forEach(function (p) {
      if (p.src === 'white') { x.fillStyle = '#fff'; x.fillRect(p.x, p.y, p.w, p.h); }
      else if (p.src && p.src !== 'clear') { var a = typeof p.src === 'string' ? art(p.src) : p.src; if (a) x.drawImage(a, p.x, p.y, p.w, p.h); }
    });
    return c;
  }

  async function buildZip(spines) {
    var zip = new window.JSZip();
    var root = (K.slug(state.s.game) || 'slot') + '-spine-drafts/';
    var folder = String(state.plan.tech.folder || '').replace(/^\/+/, '').replace(/\/?$/, '/');
    for (var i = 0; i < spines.length; i++) {
      var sp = spines[i];
      zip.file(root + folder + sp.name + '.json', sp.jsonText);
      zip.file(root + folder + sp.name + '.atlas', sp.atlasText);
      zip.file(root + folder + sp.pageName, await canvasBlob(pageCanvas(sp.page)));
      var ed = root + 'spine-editor/' + sp.name + '/';
      zip.file(ed + sp.name + '.json', sp.importJsonText);
      for (var j = 0; j < sp.regions.length; j++) {
        var r = sp.regions[j];
        zip.file(ed + 'images/' + r.name + '.png', await canvasBlob(regionCanvas(r.src, r.w, r.h)));
      }
    }
    await addLayouts(zip, root);
    zip.file(root + 'README.txt', K.readme(state.s, { tech: state.plan.tech, geometry: state.plan.geometry, spines: spines, layouts: layNames() }));
    zip.file(root + 'kit-settings.json', JSON.stringify(state.s, null, 1));
    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  }

  async function downloadZip(spines, fileName) {
    if (!spines.length && !layNames().length) return;
    if (!window.JSZip) { toast(state.lib.zip === 'fail' ? 'JSZip не завантажився з cdnjs.cloudflare.com' : 'Ще завантажую JSZip, спробуйте за мить'); return; }
    var btn = $('dl-all');
    btn.disabled = true;
    try {
      await saveFile(fileName, await buildZip(spines));
    } catch (e) {
      toast('Архів не зібрався: ' + e.message);
    } finally { btn.disabled = false; }
  }

  function b64(text) { return btoa(unescape(encodeURIComponent(text))); }
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error(src)); };
      document.head.appendChild(s);
    });
  }

  function previewBundle(sp) {
    var g = state.plan.geometry;
    var sc = symComp();
    var syms = sc && sc.on !== false && sc.symbols.length ? sc.symbols.map(function (s) { return s.name; }) : ['high_1', 'low_1', 'wild_1'];
    var symAtt = function (n) { var p = px('sym:' + n); return K.contain(p.w, p.h, g.W, g.H); };
    var json, regions;
    if (/^animation_reel_\d+_rows$/.test(sp.name)) {
      json = JSON.parse(sp.jsonText);
      regions = [];
      var seen = {};
      var att = json.skins[0].attachments;
      for (var i = 0; i <= g.R; i++) {
        var n = syms[i % syms.length];
        var region = 'art/reels/' + n;
        var a = symAtt(n);
        att['slot_' + i] = {};
        att['slot_' + i][region] = { width: a.width, height: a.height };
        json.slots.filter(function (s) { return s.name === 'slot_' + i; })[0].attachment = region;
        if (!seen[region]) { seen[region] = true; var p = px('sym:' + n); regions.push({ name: region, w: p.w, h: p.h, src: 'sym:' + n }); }
      }
      json.slots.unshift({ name: 'preview_clip', bone: 'reel', attachment: 'preview_clip' });
      var hw = g.W / 2, hh = g.gridH / 2;
      att.preview_clip = { preview_clip: { type: 'clipping', end: 'slot_' + g.R, vertexCount: 4, vertices: [-hw, hh, -hw, -hh, hw, -hh, hw, hh] } };
      regions.push({ name: state.plan.tech.spacer, w: 1, h: 1, src: 'clear' });
      return K.bundle(sp.name, json, regions, state.plan.tech);
    }
    if (/^animation_reels_\d+_columns$/.test(sp.name)) {
      json = JSON.parse(sp.jsonText);
      regions = [{ name: state.plan.tech.spacer, w: 1, h: 1, src: 'clear' }, { name: state.plan.tech.white, w: 10, h: 10, src: 'white' }];
      var colPx = fitPx(g.W, g.gridH, 1024);
      var at = json.skins[0].attachments;
      for (var c = 0; c < g.C; c++) {
        var cv = el('canvas', { width: colPx.w, height: colPx.h });
        var x = cv.getContext('2d');
        var k = colPx.w / g.W;
        for (var r = 0; r < g.R; r++) {
          var nm = syms[(c * 3 + (r + 1) * 7 + c * (r + 1)) % syms.length];
          var aa = symAtt(nm);
          x.drawImage(art('sym:' + nm), (g.W - aa.width) / 2 * k, (r * g.H + (g.H - aa.height) / 2) * k, aa.width * k, aa.height * k);
        }
        var rg = 'preview/column_' + c;
        at['reel_' + c] = {};
        at['reel_' + c][rg] = { width: g.W, height: g.gridH };
        json.slots.filter(function (s) { return s.name === 'reel_' + c; })[0].attachment = rg;
        regions.push({ name: rg, w: colPx.w, h: colPx.h, src: cv });
      }
      return K.bundle(sp.name, json, regions, state.plan.tech);
    }
    var comp = state.s.components.filter(function (c) { return c.id === sp.comp; })[0] || sbList().filter(function (c) { return c.id === sp.comp; })[0];
    var tslot = comp && comp.type === 'custom' && sp.json.slots.filter(function (s) { return /^txt_/.test(s.name); })[0];
    if (tslot) {
      json = JSON.parse(sp.jsonText);
      var host = json.skins.filter(function (s) { return s.attachments && s.attachments[tslot.name]; })[0];
      var tw = Math.max(16, Math.round(0.62 * (Number(comp.w) || 400))), th = Math.max(8, Math.round(0.3 * (Number(comp.h) || 400)));
      var tcv = el('canvas', { width: tw, height: th });
      var tx = tcv.getContext('2d');
      var text = 'PLACE YOUR BETS', fs = Math.round(0.72 * th);
      tx.font = '700 ' + fs + 'px ' + FONT;
      var mw = tx.measureText(text).width;
      if (mw > 0.94 * tw) { fs = Math.floor(fs * 0.94 * tw / mw); tx.font = '700 ' + fs + 'px ' + FONT; }
      tx.fillStyle = '#fff';
      tx.textAlign = 'center';
      tx.textBaseline = 'middle';
      tx.fillText(text, tw / 2, th / 2);
      host.attachments[tslot.name] = { 'preview/txt': { width: tw, height: th } };
      json.slots.filter(function (s) { return s.name === tslot.name; })[0].attachment = 'preview/txt';
      return K.bundle(sp.name, json, sp.regions.concat([{ name: 'preview/txt', w: tw, h: th, src: tcv }]), state.plan.tech);
    }
    return sp;
  }

  function disposePlayer() {
    if (state.player && state.player.player) { try { state.player.player.dispose(); } catch (e) { /* already gone */ } }
    state.player = null;
    $('stage').textContent = '';
  }
  function stageMsg(text) { disposePlayer(); $('stage').appendChild(el('div', { class: 'stage-msg', text: text })); }

  function viewportFor(sp) {
    var vp = { padLeft: '12%', padRight: '12%', padTop: '12%', padBottom: '12%', transitionTime: 0 };
    var g = state.plan.geometry;
    var w = 0, h = 0;
    if (/^animation_reel_\d+_rows$/.test(sp.name)) { w = g.W; h = g.gridH; }
    else if (/^animation_reels_\d+_columns$/.test(sp.name)) { w = g.gridW + 2 * g.margin; h = g.gridH + 2 * g.margin; }
    if (!w) return vp;
    return { x: -w / 2, y: -h / 2, width: w, height: h, padLeft: '6%', padRight: '6%', padTop: '6%', padBottom: '6%', transitionTime: 0 };
  }

  function mountPlayer() {
    var sp = state.plan && state.plan.spines.filter(function (s) { return s.name === state.pv.spine; })[0];
    if (!sp) { stageMsg('Немає спайнів: увімкніть компонент.'); return; }
    var anims = Object.keys(sp.json.animations);
    if (!anims.length) { stageMsg('У спайні немає анімацій.'); return; }
    if (anims.indexOf(state.pv.anim) === -1) state.pv.anim = ['win', 'spin_loop', 'idle', 'in', 'loop_1'].filter(function (n) { return anims.indexOf(n) !== -1; })[0] || anims[0];
    var skins = sp.json.skins.map(function (s) { return s.name; });
    if (skins.indexOf(state.pv.skin) === -1) state.pv.skin = skins.indexOf('default') !== -1 ? 'default' : skins[0];
    var owner = comp(sp.comp);
    var key = sp.name + '|' + sp.jsonText.length + '|' + sp.atlasText + '|' + state.pv.skin + '|' + Object.keys(state.images).join(',') + '|' + JSON.stringify(px('sym:' + (((symComp() || {}).symbols || [])[0] || { name: '' }).name)) + '|' + JSON.stringify(owner && owner.parts ? owner.parts.map(function (p) { return [p.name, p.shape, p.color]; }) : '');
    var rec = state.player;
    if (rec && rec.key === key && rec.jsonText === sp.jsonText) {
      if (rec.ready && rec.anim !== state.pv.anim) { try { rec.player.setAnimation(state.pv.anim, true); rec.anim = state.pv.anim; } catch (e) { /* keep */ } }
      return;
    }
    if (state.lib.spine !== 'ok') { stageMsg(state.lib.spine === 'fail' ? 'Рантайм Spine не завантажився з cdn.jsdelivr.net. Файли генеруються і без превʼю.' : 'Завантажую рантайм Spine…'); return; }
    disposePlayer();
    var b = previewBundle(sp);
    var raw = {};
    raw[b.name + '.json'] = 'data:application/json;base64,' + b64(b.jsonText);
    raw[b.name + '.atlas'] = 'data:text/plain;base64,' + b64(b.atlasText);
    raw[b.pageName] = pageCanvas(b.page).toDataURL('image/png');
    var div = el('div', { class: 'pc' });
    $('stage').appendChild(div);
    var anim = state.pv.anim;
    var cfg = {
      jsonUrl: b.name + '.json',
      atlasUrl: b.name + '.atlas',
      rawDataURIs: raw,
      animation: anim,
      skin: state.pv.skin,
      showControls: false,
      showLoading: false,
      alpha: true,
      backgroundColor: '00000000',
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      viewport: viewportFor(sp),
      success: function (p) {
        var rec = state.player;
        if (!rec || rec.player !== p) return;
        rec.ready = true;
        if (rec.anim !== state.pv.anim) { try { p.setAnimation(state.pv.anim, true); rec.anim = state.pv.anim; } catch (e) { /* keep */ } }
      },
      error: function (p, msg) { if (state.player && state.player.player === p) stageMsg('Превʼю не запустилося: ' + msg); }
    };
    try {
      var player = new window.spine.SpinePlayer(div, cfg);
      state.player = { player: player, key: key, jsonText: sp.jsonText, anim: anim, ready: false };
    } catch (e) { stageMsg('Превʼю не запустилося: ' + e.message); }
  }

  function renderPreview() {
    var spines = state.plan ? state.plan.spines : [];
    var sel = $('pv-spine');
    sel.textContent = '';
    spines.forEach(function (s) { sel.appendChild(el('option', { value: s.name, text: s.name })); });
    if (!spines.some(function (s) { return s.name === state.pv.spine; })) { state.pv.spine = spines.length ? spines[0].name : null; state.pv.anim = null; }
    if (state.pv.spine) sel.value = state.pv.spine;
    var sp = spines.filter(function (s) { return s.name === state.pv.spine; })[0];
    var skinSel = $('pv-skin');
    skinSel.textContent = '';
    var skins = sp ? sp.json.skins.map(function (s) { return s.name; }) : [];
    skins.forEach(function (n) { skinSel.appendChild(el('option', { value: n, text: n })); });
    skinSel.hidden = !skins.length;
    skinSel.disabled = skins.length < 2;
    mountPlayer();
    if (state.pv.skin) skinSel.value = state.pv.skin;
    var chips = $('pv-anims');
    chips.textContent = '';
    if (sp) Object.keys(sp.json.animations).forEach(function (n) {
      chips.appendChild(el('button', { type: 'button', class: 'chip', 'aria-pressed': String(n === state.pv.anim), text: n, onclick: function () { state.pv.anim = n; renderPreview(); } }));
    });
  }

  function renderSide() {
    var p = state.plan;
    var n = p.spines.length;
    $('dl-all').disabled = !n;
    var w = $('warns');
    w.textContent = '';
    p.spines.forEach(function (s) { s.warnings.forEach(function (t) { w.appendChild(el('li', { text: s.name + ': ' + t })); }); });
    var on = state.s.components.filter(function (c) { return c.on !== false; }).length + ' / ' + state.s.components.length;
    $('c-count').textContent = on;
    $('dl-n').textContent = (exComps().filter(function (c) { return !state.skip[c.id]; }).length + exLays().length) + ' / ' + (exComps().length + layList().length);
    $('dl-all').disabled = !exComps().length && !layList().length;
    state.s.components.forEach(function (c) {
      var code = document.querySelector('[data-names="' + c.id + '"]');
      if (code) code.textContent = compNames(c);
    });
  }
  function exComps() { return state.s.components.filter(function (c) { return c.on !== false && compSpines(c.id).length; }); }
  function exSpines() { return state.plan.spines.filter(function (s) { return !state.skip[s.comp]; }); }
  function renderExport() {
    var list = $('ex-list');
    list.textContent = '';
    exComps().forEach(function (c) {
      var n = compSpines(c.id).length;
      list.appendChild(el('label', { class: 'wz-comp' }, [
        el('input', { type: 'checkbox', checked: !state.skip[c.id], 'aria-label': 'Експортувати ' + (TITLES[c.type] || c.label || 'компонент'), onchange: function (e) { state.skip[c.id] = !e.target.checked; exChanged(); } }),
        el('span', { class: 'comp-thumb', 'aria-hidden': 'true' }, [el('img', { alt: '', src: thumb(compThumb(c)) })]),
        el('span', {}, [el('b', { text: TITLES[c.type] || c.label || 'Компонент' }), el('small', { text: compNames(c) + ' · ' + n + ' ' + plural(n, 'спайн', 'спайни', 'спайнів') })])
      ]));
    });
    layList().forEach(function (L) { list.appendChild(exLayoutRow(L)); });
    renderExFoot();
  }
  function exAll() { return exComps().every(function (c) { return !state.skip[c.id]; }) && exLays().length === layList().length; }
  function exWhat(n, l) {
    var a = [];
    if (n) a.push(n + ' ' + plural(n, 'спайн', 'спайни', 'спайнів'));
    if (l) a.push(l + ' ' + plural(l, 'лейаут', 'лейаути', 'лейаутів'));
    return a.join(' і ') || '0 спайнів';
  }
  function exChanged() {
    renderExFoot();
    renderSide();
    if (exRepo.to !== 'repo') return;
    exRepo.msg = '';
    exRepo.bad = false;
    planArt();
  }
  function renderExFoot() {
    var n = exSpines().length, l = exLays().length, go = $('ex-go');
    $('ex-all').textContent = exAll() ? 'Зняти всі' : 'Вибрати всі';
    if (exRepo.to === 'repo') {
      go.textContent = exRepo.busy || 'Записати ' + exWhat(n, l);
      go.disabled = !!exRepo.busy || !(n + l) || !exRepo.plan;
    } else {
      go.textContent = 'Експортувати ' + exWhat(n, l);
      go.disabled = !(n + l);
    }
  }
  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  function renderGame() {
    var s = state.s;
    $('g-name').value = s.game;
    $('crumb').textContent = s.game || 'Без назви';
    $('g-reels').value = s.reels;
    $('g-rows').value = s.rows;
    $('g-cw').value = s.cell.w;
    $('g-ch').value = s.cell.h;
    $('t-ver').value = s.tech.spineVersion;
    $('t-fps').value = s.tech.fps;
    $('t-folder').value = s.tech.folder;
    renderPresets();
  }
  function renderPresets() {
    var box = $('g-presets');
    box.textContent = '';
    GRIDS.forEach(function (g) {
      box.appendChild(el('button', { type: 'button', class: 'preset', 'aria-pressed': String(state.s.reels === g[0] && state.s.rows === g[1]), text: g[0] + '×' + g[1], onclick: function () {
        state.s.reels = g[0];
        state.s.rows = g[1];
        $('g-reels').value = g[0];
        $('g-rows').value = g[1];
        renderPresets();
        changed({ render: true });
      } }));
    });
    $('tech-sum').textContent = 'Spine ' + state.s.tech.spineVersion + ' · ' + state.s.tech.fps + ' fps · ' + state.s.tech.folder;
    $('g-sum').textContent = state.s.reels + ' × ' + state.s.rows + ' · ' + state.s.cell.w + ' × ' + state.s.cell.h + ' px';
  }

  function gridSetBtn(cls) {
    return labelBtn('Налаштувати', ICONS.gear, { type: 'button', class: cls, title: 'Налаштувати сітку', 'aria-label': 'Налаштувати сітку', onclick: openGrid });
  }
  function openGrid() {
    var d = $('grid-dlg');
    drawer(false);
    stopSpin();
    if (typeof d.showModal === 'function') { if (!d.open) d.showModal(); }
    else d.setAttribute('open', '');
    drawGridDlg();
    $('grid-close').focus({ preventScroll: true });
  }
  function drawGridDlg() {
    var d = $('grid-dlg'), src = $('grid-canvas'), cv = $('gd-canvas');
    if (!d.open && !d.hasAttribute('open')) return;
    if (cv.width !== src.width || cv.height !== src.height) { cv.width = src.width; cv.height = src.height; }
    var x = cv.getContext('2d');
    x.clearRect(0, 0, cv.width, cv.height);
    x.drawImage(src, 0, 0);
    $('gd-label').textContent = $('grid-label').textContent;
  }

  function rebuild() {
    try { state.plan = K.planAll(state.s, px); }
    catch (e) { toast('Не вдалося зібрати: ' + e.message); return; }
    if (spin.ctl) { spin.ctl.cancel(); spin.ctl = null; }
    drawGrid();
    drawGridDlg();
    renderSpinBtn();
    renderSide();
    renderPreview();
    renderCheckAs();
    renderLayouts();
    if (sbShown()) { renderSbItems(); renderSbStage(); }
    if (state.open.reels) {
      var art_ = document.querySelector('[data-id="reels"] .comp-body');
      if (art_) art_.replaceWith(Object.assign(reelsBody(), { id: 'body-reels' }));
    }
  }

  function bindGame() {
    var num = function (id, fn) { $(id).addEventListener('input', function (e) { var v = Number(e.target.value); if (isFinite(v) && v > 0) { fn(v); renderPresets(); changed({ render: true }); } }); };
    $('grid-label').after(iconBtn('ghost', 'Налаштувати сітку', ICONS.gear, openGrid));
    $('g-sum-btn').replaceWith(gridSetBtn('btn sm'));
    $('g-name').addEventListener('input', function (e) { state.s.game = e.target.value; $('crumb').textContent = state.s.game || 'Без назви'; changed(); });
    num('g-reels', function (v) { state.s.reels = Math.min(12, Math.round(v)); });
    num('g-rows', function (v) { state.s.rows = Math.min(12, Math.round(v)); });
    num('g-cw', function (v) { state.s.cell.w = Math.min(2000, Math.max(16, Math.round(v))); });
    num('g-ch', function (v) { state.s.cell.h = Math.min(2000, Math.max(16, Math.round(v))); });
    $('t-ver').addEventListener('input', function (e) { state.s.tech.spineVersion = e.target.value.trim(); renderPresets(); changed(); });
    num('t-fps', function (v) { state.s.tech.fps = Math.round(v); });
    $('t-folder').addEventListener('input', function (e) { state.s.tech.folder = e.target.value.trim(); renderPresets(); changed(); });
    var ad = $('add-dlg');
    var closeAdd = function () { if (typeof ad.close === 'function') ad.close(); else ad.removeAttribute('open'); };
    var addComp = function (key) {
      var t = TEMPLATES[key];
      var names = state.s.components.map(function (c) { return c.type === 'custom' ? 'animation_' + K.slug(c.name).replace(/^animation_/, '') : ''; });
      var name = t.name, n = 2;
      while (names.indexOf(name) !== -1) name = t.name + '_' + n++;
      var c = fromTemplate(t, name);
      state.s.components.push(c);
      state.open[c.id] = true;
      state.pv.spine = name;
      state.pv.anim = null;
      closeAdd();
      changed({ render: true, now: true });
    };
    var ADD_NOTES = { background: 'Задній план гри на весь екран', logo: 'Назва гри з появою і диханням', popup: 'Вікно виграшу чи повідомлення', infopanel: 'Панель з текстами під барабанами', character: 'Герой біля барабанів: дихає, радіє виграшу', custom: 'Колектор, лічильник, панель: частини й ключі' };
    var addPics = {};
    var renderAddList = function () {
      var keys = Object.keys(TEMPLATES).filter(function (k) {
        var t = TEMPLATES[k];
        return k === 'custom' || !state.s.components.some(function (c) { return c.type === 'custom' && (c.label === t.label || c.name === t.name); });
      });
      $('add-list').replaceChildren.apply($('add-list'), keys.map(function (k) {
        var t = TEMPLATES[k], s = 128 / Math.max(t.w, t.h);
        addPics[k] = addPics[k] || thumb(drawCustom({ name: t.name }, Math.round(t.w * s), Math.round(t.h * s)));
        return el('button', { type: 'button', class: 'add-item', onclick: function () { addComp(k); } }, [
          el('span', { class: 'add-pic', 'aria-hidden': 'true' }, [el('img', { alt: '', src: addPics[k] })]),
          el('span', {}, [el('b', { text: t.label }), el('small', { text: ADD_NOTES[k] }), el('code', { text: t.name + ' · ' + t.w + '×' + t.h })])
        ]);
      }));
      var imp = addImport();
      $('add-list').appendChild(imp[0]);
      $('add-list').appendChild(imp[1]);
    };
    var addImport = function () {
      var input = el('input', { type: 'file', class: 'file', accept: '.json,application/json', tabindex: '-1', 'aria-hidden': 'true' });
      input.addEventListener('change', async function () {
        var f = input.files && input.files[0];
        input.value = '';
        if (!f) return;
        var data;
        try { data = JSON.parse(await f.text()); } catch (e) { toast('Це не файл компонента кита'); return; }
        try {
          var nc = await importComponent(data);
          closeAdd();
          toast('Додано ' + spineOf(nc));
        } catch (e) { toast((e && e.message) || 'Це не файл компонента кита'); }
      });
      var pic = el('span', { class: 'add-pic', 'aria-hidden': 'true' });
      pic.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICONS.upload + '</svg>';
      return [input, el('button', { type: 'button', class: 'add-item', onclick: function () { input.click(); } }, [pic, el('span', {}, [el('b', { text: 'Імпорт з файлу' }), el('small', { text: '.component.json з іншого проекту' })])])];
    };
    $('add-comp').addEventListener('click', function () { renderAddList(); if (typeof ad.showModal === 'function') { if (!ad.open) ad.showModal(); } else ad.setAttribute('open', ''); });
    $('add-close').addEventListener('click', closeAdd);
    ad.addEventListener('click', function (e) { if (e.target === ad) closeAdd(); });
    $('pv-spine').addEventListener('change', function (e) { state.pv.spine = e.target.value; state.pv.anim = null; state.pv.skin = null; renderPreview(); renderComponents(); });
    $('pv-skin').addEventListener('change', function (e) { state.pv.skin = e.target.value; renderPreview(); });
    var xd = $('ex-dlg');
    var closeEx = function () { if (typeof xd.close === 'function') xd.close(); else xd.removeAttribute('open'); };
    $('dl-all').addEventListener('click', function () { openArt(); renderExport(); if (typeof xd.showModal === 'function') { if (!xd.open) xd.showModal(); } else xd.setAttribute('open', ''); });
    $('ex-close').addEventListener('click', closeEx);
    xd.addEventListener('click', function (e) { if (e.target === xd) closeEx(); });
    $('ex-to').addEventListener('click', function (e) { var b = e.target.closest('[data-to]'); if (b) setExTo(b.dataset.to); });
    $('ex-all').addEventListener('click', function () {
      var all = exAll();
      exComps().forEach(function (c) { state.skip[c.id] = all; });
      layList().forEach(function (L) { state.skip['layout:' + L.name] = all; });
      renderExport();
      exChanged();
    });
    $('ex-go').addEventListener('click', function () {
      if (exRepo.to === 'repo') { writeArt(); return; }
      var spines = exSpines();
      closeEx();
      downloadZip(spines, (K.slug(state.s.game) || 'slot') + '-spine-drafts.zip');
    });
    $('spin-go').addEventListener('click', startSpin);
  }

  var lay = { cur: 0, sel: null, marks: true, drag: null, hits: [], view: null, hover: null, reset: false, scr: {} };
  var EYE = '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>';
  var EYE_OFF = '<path d="M3 3l18 18"/><path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6A17.4 17.4 0 0 0 2 12s3.6 7 10 7a10 10 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>';
  var LAY_FORCE = { bg: 'position_background', background: 'position_background', freespins_bg: 'position_background', outcomes: 'position_background', popup: 'position_background', freespins_notifications: 'position_background', black_overlay: 'position_background', splash: 'position_logo', paylines: 'position_reels' };
  var LAY_FALLBACK = { notification_panel: 'position_reels' };
  var LAY_Z = [[/^(bg|background)$|^bg_|_bg$/, 0], [/panel/, 11], [/feature|bonus_buy/, 12.5], [/logo|game_name|title/, 12.2], [/popup|outcome|notification|overlay|win/, 14], [/spin_indicator/, 14.1], [/splash|loading/, 21]];

  function lays() { if (!state.s.layouts) state.s.layouts = LK.defaults(); return state.s.layouts; }
  function curLayout() { var l = lays().list; if (lay.cur >= l.length) lay.cur = 0; return l[lay.cur] || null; }
  function curAspect(L) { var a = lay.scr[L.name]; return a > 0 ? a : L.w / L.h; }
  function compOn(t) { var c = state.s.components.filter(function (k) { return k.type === t; })[0]; return !!(c && c.on !== false); }
  function spineOf(c) { return 'animation_' + (K.slug(c.name).replace(/^animation_/, '') || 'element'); }
  function layZ(c) {
    var n = spineOf(c).replace(/^animation_/, '');
    for (var i = 0; i < LAY_Z.length; i++) if (LAY_Z[i][0].test(n)) return LAY_Z[i][1];
    return 12;
  }
  function layItems() {
    var out = [];
    if (['reels', 'symbols', 'frame_under', 'frame_above'].some(compOn)) out.push({ id: 'reels', title: 'Барабани й рамки', names: 'animation_reels_' + geo().C + '_columns', thumb: reelsIcon(), z: 4.5 });
    state.s.components.forEach(function (c) {
      if (c.type === 'custom' && c.on !== false) out.push({ id: c.id, c: c, title: c.label || 'Компонент', names: spineOf(c), thumb: art('c:' + c.id), z: layZ(c) });
    });
    return out;
  }
  function defaultBone(id) {
    if (id === 'reels') return 'position_reels';
    var c = comp(id);
    if (!c) return '';
    var n = spineOf(c).replace(/^animation_/, '');
    if (LAY_FORCE[n]) return LAY_FORCE[n];
    var want = 'position_' + n;
    if (lays().list.some(function (L) { return LK.boneOf(L, want); })) return want;
    return LAY_FALLBACK[n] || '';
  }
  function boneFor(id) { var b = lays().bind[id]; return typeof b === 'string' ? b : defaultBone(id); }
  function boundMap() {
    var m = {};
    layItems().forEach(function (it) {
      var b = boneFor(it.id);
      if (b && !lays().off[it.id]) (m[b] = m[b] || []).push(it);
    });
    return m;
  }
  function boneWarn(b) {
    if (b.parent !== 'root' && !LK.MARGINS[b.parent]) return 'Батько має бути root або area_*, інакше гра впаде';
    if (b.x < 0 || b.y > 0) return 'Потрібно x ≥ 0 і y ≤ 0: гра бере модуль координат';
    return '';
  }
  function boneName(v) {
    var n = K.slug(v);
    if (!n) return '';
    return /^(position|txt)_/.test(n) ? n : 'position_' + n;
  }

  function reelsBox() {
    var g = state.plan.geometry;
    var box = { l: -g.gridW / 2, t: -g.gridH / 2, r: g.gridW / 2, b: g.gridH / 2 };
    ['frame_under', 'frame_above'].forEach(function (t) {
      var a = compOn(t) ? attOf('animation_reels_' + t, 'frame') : null;
      if (!a) return;
      var cx = a.x || 0, cy = -(a.y || 0);
      box.l = Math.min(box.l, cx - a.width / 2);
      box.r = Math.max(box.r, cx + a.width / 2);
      box.t = Math.min(box.t, cy - a.height / 2);
      box.b = Math.max(box.b, cy + a.height / 2);
    });
    return box;
  }
  function paintReels(x, layer, line) {
    var g = state.plan.geometry;
    var put = function (canvas, a) { if (canvas && a) x.drawImage(canvas, (a.x || 0) - a.width / 2, -(a.y || 0) - a.height / 2, a.width, a.height); };
    if (compOn('frame_under')) put(art('frame_under'), attOf('animation_reels_frame_under', 'frame'));
    else if (line) {
      x.strokeStyle = 'rgba(255,255,255,0.25)';
      x.lineWidth = line;
      for (var i = 0; i < g.C; i++) for (var j = 1; j <= g.R; j++) x.strokeRect(g.reelX[i] - g.W / 2, -g.slotY[j] - g.H / 2, g.W, g.H);
    }
    if (layer) layer(x);
    else if (compOn('symbols') && symComp().symbols.length) {
      var grid = startGrid();
      for (var c = 0; c < g.C; c++) {
        for (var r = 1; r <= g.R; r++) {
          var sym = grid[c][r - 1];
          var a = attOf('animation_symbol_' + sym, 'symbol');
          if (a) put(art('sym:' + sym), { x: g.reelX[c], y: g.slotY[r], width: a.width, height: a.height });
        }
      }
    }
    if (compOn('frame_above')) put(art('frame_above'), attOf('animation_reels_frame_above', 'frame'));
  }
  function customBox(c) {
    var a = attOf(spineOf(c), 'art');
    if (!a) return null;
    var sp = state.plan.spines.filter(function (s) { return s.name === spineOf(c); })[0];
    var b = (sp && sp.json.bones.filter(function (x) { return x.name === 'art'; })[0]) || {};
    var cx = (b.x || 0) + (a.x || 0), cy = -((b.y || 0) + (a.y || 0));
    return { l: cx - a.width / 2, r: cx + a.width / 2, t: cy - a.height / 2, b: cy + a.height / 2 };
  }
  var BLEND_OP = { additive: 'lighter', multiply: 'multiply', screen: 'screen' };
  function setupPose(sp) {
    var json = sp.json, W = {}, src = {}, items = [], box = null;
    json.bones.forEach(function (b) {
      var r = (b.rotation || 0) * Math.PI / 180;
      var sx = b.scaleX === undefined ? 1 : b.scaleX, sy = b.scaleY === undefined ? 1 : b.scaleY;
      var l = [Math.cos(r) * sx, -Math.sin(r) * sy, Math.sin(r) * sx, Math.cos(r) * sy, b.x || 0, b.y || 0];
      var p = b.parent && W[b.parent];
      W[b.name] = p ? [p[0] * l[0] + p[1] * l[2], p[0] * l[1] + p[1] * l[3], p[2] * l[0] + p[3] * l[2], p[2] * l[1] + p[3] * l[3], p[0] * l[4] + p[1] * l[5] + p[4], p[2] * l[4] + p[3] * l[5] + p[5]] : l;
    });
    sp.regions.forEach(function (r) { src[r.name] = r.src; });
    var skin = json.skins.filter(function (s) { return s.name === 'default' && s.attachments; })[0] || json.skins.filter(function (s) { return s.attachments; })[0];
    json.slots.forEach(function (s) {
      var a = skin && s.attachment && skin.attachments[s.name] ? skin.attachments[s.name][s.attachment] : null;
      var m = W[s.bone];
      if (!a || !m) return;
      if (a.type === 'clipping') {
        var pts = [];
        for (var i = 0; i + 1 < a.vertices.length; i += 2) pts.push([m[0] * a.vertices[i] + m[1] * a.vertices[i + 1] + m[4], -(m[2] * a.vertices[i] + m[3] * a.vertices[i + 1] + m[5])]);
        items.push({ clip: pts, end: a.end, slot: s.name });
        return;
      }
      var key = !a.type && src[a.path || s.attachment];
      if (!key || key === 'clear') return;
      var ax = a.x || 0, ay = a.y || 0, w = a.width, h = a.height;
      var t = [m[0], -m[2], -m[1], m[3], m[0] * ax + m[1] * ay + m[4], -(m[2] * ax + m[3] * ay + m[5])];
      var alpha = s.color ? parseInt(s.color.slice(6, 8) || 'ff', 16) / 255 : 1;
      items.push({ slot: s.name, key: key, t: t, w: w, h: h, alpha: alpha, blend: BLEND_OP[s.blend] || '' });
      if (!(alpha > 0)) return;
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (q) {
        var u = q[0] * w / 2, v = q[1] * h / 2;
        var qx = t[0] * u + t[2] * v + t[4], qy = t[1] * u + t[3] * v + t[5];
        if (!box) box = { l: qx, r: qx, t: qy, b: qy };
        box.l = Math.min(box.l, qx); box.r = Math.max(box.r, qx); box.t = Math.min(box.t, qy); box.b = Math.max(box.b, qy);
      });
    });
    return { items: items, box: box };
  }
  function drawSetup(x, pose) {
    var open = [];
    pose.items.forEach(function (it) {
      if (it.clip) {
        x.save();
        x.beginPath();
        it.clip.forEach(function (p, i) { if (i) x.lineTo(p[0], p[1]); else x.moveTo(p[0], p[1]); });
        x.closePath();
        x.clip();
        open.push(it.end);
        return;
      }
      var img = art(it.key);
      if (img && it.alpha > 0) {
        x.save();
        x.globalAlpha *= it.alpha;
        if (it.blend) x.globalCompositeOperation = it.blend;
        x.transform(it.t[0], it.t[1], it.t[2], it.t[3], it.t[4], it.t[5]);
        x.drawImage(img, -it.w / 2, -it.h / 2, it.w, it.h);
        x.restore();
      }
      while (open.length && open[open.length - 1] === it.slot) { open.pop(); x.restore(); }
    });
    while (open.length) { open.pop(); x.restore(); }
  }
  function layDrawables() {
    var out = [];
    layItems().forEach(function (it) {
      var bone = boneFor(it.id);
      if (!bone || lays().off[it.id]) return;
      if (it.id === 'reels') { out.push({ id: it.id, it: it, bone: bone, z: it.z, box: reelsBox(), draw: paintReels }); return; }
      if (it.c.parts && it.c.parts.length) {
        var sp = state.plan.spines.filter(function (s) { return s.name === spineOf(it.c); })[0];
        var pose = sp && setupPose(sp);
        if (pose && pose.box) out.push({ id: it.id, it: it, bone: bone, z: it.z, box: pose.box, draw: function (x) { drawSetup(x, pose); } });
        return;
      }
      var box = customBox(it.c);
      if (!box) return;
      var key = 'c:' + it.c.id;
      out.push({ id: it.id, it: it, bone: bone, z: it.z, box: box, draw: function (x) { var img = art(key); if (img) x.drawImage(img, box.l, box.t, box.r - box.l, box.b - box.t); } });
    });
    return out.sort(function (p, q) { return p.z - q.z; });
  }

  function drawLayout(layer) {
    var L = state.s && state.plan ? curLayout() : null;
    if (!L || $('view-layouts').hidden) return;
    if (!layer && spin.ctl && spin.ctl.running) layer = spin.layer;
    var cv = $('lay-canvas'), stage = $('lay-stage');
    var scr = LK.screen(L, curAspect(L));
    var m = Math.round(0.07 * Math.max(scr.w, scr.h));
    var vw = scr.w + 2 * m, vh = scr.h + 2 * m;
    var aw = Math.max(200, stage.clientWidth - 16), ah = Math.max(320, window.innerHeight - 316);
    var fit = Math.min(aw / vw, ah / vh);
    var cw = Math.max(1, Math.round(vw * fit)), ch = Math.max(1, Math.round(vh * fit));
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var iw = Math.round(cw * dpr), ih = Math.round(ch * dpr);
    if (cv.width !== iw || cv.height !== ih) { cv.width = iw; cv.height = ih; }
    cv.style.width = cw + 'px';
    cv.style.height = ch + 'px';
    var k = iw / vw, px1 = dpr / k;
    lay.view = { k: k, m: m, css: cw / vw, cw: cw, scr: scr };
    var x = cv.getContext('2d');
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.clearRect(0, 0, iw, ih);
    var base = function () { x.setTransform(k, 0, 0, k, m * k, m * k); };
    base();
    x.fillStyle = '#0d0d10';
    x.fillRect(0, 0, scr.w, scr.h);
    lay.hits = [];
    layDrawables().forEach(function (d) {
      var b = LK.boneOf(L, d.bone);
      if (!b) return;
      var t = LK.place(L, b, scr);
      base();
      x.transform(t.a, t.b, t.c, t.d, t.e, t.f);
      d.draw(x, d.id === 'reels' ? layer : null, px1 / Math.max(0.01, Math.sqrt(Math.abs(t.a * t.d - t.b * t.c))));
      lay.hits.push({ id: d.id, bone: d.bone, t: t, box: d.box });
    });
    base();
    x.globalAlpha = 0.72;
    x.fillStyle = cssVar('--paper') || '#151517';
    x.beginPath();
    x.rect(-m, -m, vw, vh);
    x.rect(0, 0, scr.w, scr.h);
    x.fill('evenodd');
    x.globalAlpha = 1;
    x.lineWidth = px1;
    x.strokeStyle = cssVar('--line') || 'rgba(128,128,128,0.4)';
    x.strokeRect(0, 0, scr.w, scr.h);
    if (Math.abs(scr.w - L.w) > 0.5 || Math.abs(scr.h - L.h) > 0.5) {
      var s = Math.min(scr.w / L.w, scr.h / L.h);
      x.setLineDash([6 * px1, 4 * px1]);
      x.strokeStyle = 'rgba(255,255,255,0.4)';
      x.strokeRect((scr.w - L.w * s) / 2, (scr.h - L.h * s) / 2, L.w * s, L.h * s);
      x.setLineDash([]);
    }
    if (lay.marks) drawMarks(x, L, scr, px1);
  }

  function drawMarks(x, L, scr, px1) {
    var bound = boundMap();
    var brand = cssVar('--brand') || '#0a84ff';
    var labels = [];
    LK.anchors(L).forEach(function (b) {
      var t = LK.place(L, b, scr), cx = t.e, cy = t.f;
      var sel = b.name === lay.sel, has = !!bound[b.name];
      if (sel) {
        var len = 26 * px1, n = Math.hypot(t.a, t.b) || 1;
        x.beginPath();
        x.moveTo(cx, cy);
        x.lineTo(cx + t.a / n * len, cy + t.b / n * len);
        x.lineWidth = 2 * px1;
        x.strokeStyle = brand;
        x.stroke();
      }
      x.beginPath();
      x.arc(cx, cy, (sel ? 6 : has ? 5 : 4) * px1, 0, Math.PI * 2);
      x.fillStyle = sel ? brand : has ? '#fff' : 'rgba(255,255,255,0.45)';
      x.fill();
      x.lineWidth = 1.5 * px1;
      x.strokeStyle = sel ? '#fff' : 'rgba(0,0,0,0.6)';
      x.stroke();
      if (sel || has || b.name === lay.hover) labels.push({ cx: cx, cy: cy, sel: sel, text: b.name.replace(/^position_/, '') + (has && lay.view.cw >= 560 ? ' · ' + bound[b.name].map(function (it) { return it.title; }).join(', ') : '') });
    });
    labels.sort(function (p, q) { return (q.sel ? 1 : 0) - (p.sel ? 1 : 0); });
    var stack = {};
    var h = 18 * px1;
    x.font = '600 ' + (11 * px1) + 'px ' + FONT;
    x.textBaseline = 'middle';
    x.textAlign = 'left';
    labels.forEach(function (l) {
      var key = Math.round(l.cx / (24 * px1)) + ':' + Math.round(l.cy / (24 * px1));
      var i = stack[key] = (stack[key] || 0) + 1;
      var lw = x.measureText(l.text).width + 12 * px1;
      var lx = l.cx + 10 * px1, ly = l.cy + (i - 1) * (h + 3 * px1);
      if (lx + lw > scr.w + lay.view.m) lx = Math.max(-lay.view.m, l.cx - 10 * px1 - lw);
      x.fillStyle = l.sel ? brand : 'rgba(20,20,22,0.8)';
      rr(x, lx, ly - h / 2, lw, h, h / 2);
      x.fill();
      x.fillStyle = '#fff';
      x.fillText(l.text, lx + 6 * px1, ly + 0.5 * px1);
    });
  }

  function layPoint(e) {
    var cv = $('lay-canvas'), r = cv.getBoundingClientRect(), v = lay.view;
    return { x: (e.clientX - r.left) / r.width * cv.width / v.k - v.m, y: (e.clientY - r.top) / r.height * cv.height / v.k - v.m };
  }
  function hitMarks(p) {
    if (!lay.marks) return [];
    var L = curLayout(), tol = 12 / lay.view.css;
    return LK.anchors(L).filter(function (b) { var t = LK.place(L, b, lay.view.scr); return Math.hypot(t.e - p.x, t.f - p.y) <= tol; }).map(function (b) { return b.name; });
  }
  function hitItem(p) {
    for (var i = lay.hits.length - 1; i >= 0; i--) {
      var h = lay.hits[i], t = h.t;
      var det = t.a * t.d - t.b * t.c;
      if (!det) continue;
      var dx = p.x - t.e, dy = p.y - t.f;
      var u = (t.d * dx - t.c * dy) / det, v = (-t.b * dx + t.a * dy) / det;
      if (u >= h.box.l && u <= h.box.r && v >= h.box.t && v <= h.box.b) return h;
    }
    return null;
  }

  function fmtN(v) { return String(K.roundTo(Number(v) || 0, 2)); }
  function boneMeta(b) {
    var s = fmtN(b.x) + ', ' + fmtN(b.y);
    if (b.scaleX !== 1 || b.scaleY !== 1) s += ' · ×' + fmtN(b.scaleX) + (b.scaleY !== b.scaleX ? '/' + fmtN(b.scaleY) : '');
    if (b.rotation) s += ' · ' + fmtN(b.rotation) + '°';
    return s;
  }
  function boneRow(b) {
    var row = document.querySelector('#lay-bones [data-bone="' + b.name + '"]');
    if (!row) return;
    var w = boneWarn(b);
    row.classList.toggle('bad', !!w);
    var meta = row.querySelector('.lb-meta');
    if (meta) meta.textContent = boneMeta(b);
    var note = row.querySelector('.lb-edit .note');
    if (note) { note.textContent = w; note.hidden = !w; }
  }
  function boneTouched(b) {
    drawLayout();
    boneRow(b);
    scheduleSave();
  }
  function syncBoneInputs() {
    Array.prototype.forEach.call(document.querySelectorAll('#lay-bones .lb-edit input[type="number"]'), function (i) {
      if (i !== document.activeElement && i.layGet) i.value = fmtN(i.layGet());
    });
  }
  function selectBone(name, reveal) {
    lay.sel = name;
    renderLayBones();
    drawLayout();
    if (!reveal || !name || !layWide()) return;
    var row = document.querySelector('#lay-bones [data-bone="' + name + '"]');
    if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function layWide() { return getComputedStyle($('view-layouts')).gridTemplateColumns.trim().split(/\s+/).length > 1; }
  function renderLayouts() {
    if (!state.s || $('view-layouts').hidden) return;
    var L = curLayout();
    if (lay.sel && !LK.boneOf(L, lay.sel)) lay.sel = null;
    var fk = document.activeElement && document.activeElement.getAttribute('data-k');
    renderLayTabs();
    var typing = document.activeElement && document.activeElement.closest && document.activeElement.closest('#lay-comps input');
    if (!typing) renderLayComps();
    renderLayBones();
    renderLayMeta();
    renderSpinBtn();
    drawLayout();
    var again = fk ? document.querySelector('[data-k="' + fk + '"]') : null;
    if (again) again.focus({ preventScroll: true });
  }
  function renderLayTabs() {
    var box = $('lay-tabs');
    box.textContent = '';
    lays().list.forEach(function (L, i) {
      box.appendChild(el('button', { type: 'button', class: 'preset', 'aria-pressed': String(i === lay.cur), title: L.name, text: LK.title(L), onclick: function () { lay.cur = i; lay.reset = false; renderLayouts(); } }));
    });
    var L = curLayout();
    $('lay-size').textContent = L ? L.w + ' × ' + L.h : '';
    var scr = $('lay-scr');
    scr.textContent = '';
    if (!L) return;
    var a = curAspect(L);
    scr.appendChild(el('span', { text: 'Екран' }));
    LK.screens(L).forEach(function (s) {
      scr.appendChild(el('button', { type: 'button', class: 'chip', 'aria-pressed': String(Math.abs(s[1] - a) < 0.005), text: s[0], onclick: function () { lay.scr[L.name] = s[1]; renderLayTabs(); drawLayout(); } }));
    });
  }
  function layNum(c, key, pos) {
    return function (v) {
      var n = Number(v);
      if (v === '' || !isFinite(n) || (pos && !(n > 0))) return;
      c[key] = n;
      changed();
    };
  }
  function renderLayComps() {
    var box = $('lay-comps');
    box.textContent = '';
    var L = curLayout();
    var items = layItems();
    if (!items.length) { box.appendChild(el('p', { class: 'note', text: 'Увімкніть компоненти в «Чернетках».' })); return; }
    items.forEach(function (it) {
      var cur = boneFor(it.id);
      var off = !!lays().off[it.id];
      var sel = el('select', { 'aria-label': 'Кістка для ' + it.title });
      sel.appendChild(el('option', { value: '', text: '— не ставити' }));
      LK.anchors(L).forEach(function (b) { sel.appendChild(el('option', { value: b.name, text: b.name })); });
      if (cur && !LK.boneOf(L, cur)) sel.appendChild(el('option', { value: cur, text: cur + ' · немає тут' }));
      var pick = dropdown(sel, true);
      sel.value = cur;
      sel.addEventListener('change', function () {
        lays().bind[it.id] = sel.value;
        if (sel.value) lay.sel = sel.value;
        scheduleSave();
        renderLayouts();
      });
      var miss = cur ? lays().list.filter(function (x) { return !LK.boneOf(x, cur); }).map(LK.title) : [];
      var eye = iconBtn('ghost lay-eye', (off ? 'Показати ' : 'Сховати ') + it.title, off ? EYE_OFF : EYE, function () {
        if (off) delete lays().off[it.id];
        else lays().off[it.id] = true;
        scheduleSave();
        renderLayouts();
      }, !off);
      eye.setAttribute('data-k', 'eye:' + it.id);
      var c = it.c;
      var dims = c ? el('div', { class: 'row lay-dims' }, [
        numPair('Розмір у грі, px', c.w, c.h, layNum(c, 'w', true), layNum(c, 'h', true), ['Ширина ' + it.title, 'Висота ' + it.title], 'custom'),
        numPair('Центр X, Y', c.x || 0, c.y || 0, layNum(c, 'x'), layNum(c, 'y'), ['X ' + it.title, 'Y ' + it.title, ','])
      ]) : null;
      box.appendChild(el('div', { class: 'lay-comp' + (off ? ' off' : '') }, [
        el('span', { class: 'comp-thumb', 'aria-hidden': 'true' }, [el('img', { alt: '', src: thumb(it.thumb) })]),
        el('span', { class: 'comp-t' }, [el('b', { text: it.title }), el('code', { text: it.names }), miss.length ? el('small', { class: 'lay-warn', text: 'немає кістки в ' + miss.join(', ') }) : null]),
        pick,
        eye,
        dims
      ]));
    });
  }
  function renderLayBones() {
    var ul = $('lay-bones');
    var L = curLayout();
    ul.textContent = '';
    if (!L) return;
    var bound = boundMap();
    var list = LK.anchors(L);
    $('lay-bn').textContent = String(list.length);
    list.forEach(function (b) {
      var on = b.name === lay.sel;
      var li = el('li', { class: 'lay-bone' + (on ? ' sel' : '') + (boneWarn(b) ? ' bad' : ''), 'data-bone': b.name }, [
        el('button', { type: 'button', class: 'lb-open', 'data-k': 'bone:' + b.name, 'aria-expanded': String(on), onclick: function () { selectBone(on ? null : b.name); } }, [
          el('span', { class: 'lb-dot' + (bound[b.name] ? ' has' : ''), 'aria-hidden': 'true' }),
          el('code', { class: 'lb-name', text: b.name })
        ].concat((bound[b.name] || []).map(function (it) { return el('span', { class: 'lb-chip', text: it.title }); }), [el('span', { class: 'lb-meta', text: boneMeta(b) })]))
      ]);
      if (on) li.appendChild(boneEditor(b));
      ul.appendChild(li);
    });
  }
  function boneEditor(b) {
    var numIn = function (label, get, set) {
      var i = el('input', { type: 'number', step: 'any', value: fmtN(get()), 'aria-label': label, oninput: function (e) {
        if (e.target.value === '') return;
        var v = Number(e.target.value);
        if (!isFinite(v)) return;
        set(v);
        boneTouched(b);
      } });
      i.layGet = get;
      return el('label', { class: 'field' }, [el('span', { class: 'lbl', text: label }), i]);
    };
    var parents = ['root'].concat(LK.AREAS);
    if (parents.indexOf(b.parent) === -1) parents.push(b.parent);
    var psel = el('select', { 'aria-label': 'Батьківська кістка ' + b.name });
    parents.forEach(function (p) { psel.appendChild(el('option', { value: p, text: p })); });
    var ppick = dropdown(psel, true);
    psel.value = b.parent;
    psel.addEventListener('change', function () { b.parent = psel.value; boneTouched(b); });
    var fields = [
      el('div', { class: 'field lb-parent' }, [el('span', { class: 'lbl' }, ['Батько', infoBtn('layout_bones')]), ppick]),
      numIn('X', function () { return b.x; }, function (v) { b.x = v; }),
      numIn('Y', function () { return b.y; }, function (v) { b.y = v; })
    ];
    if (b.scaleX === b.scaleY) fields.push(numIn('Масштаб', function () { return b.scaleX; }, function (v) { b.scaleX = v; b.scaleY = v; }));
    else fields.push(numIn('Масштаб X', function () { return b.scaleX; }, function (v) { b.scaleX = v; }), numIn('Масштаб Y', function () { return b.scaleY; }, function (v) { b.scaleY = v; }));
    fields.push(numIn('Поворот, °', function () { return b.rotation; }, function (v) { b.rotation = v; }));
    var w = boneWarn(b);
    var note = el('p', { class: 'note', text: w });
    note.hidden = !w;
    fields.push(note);
    var box = el('div', { class: 'lb-edit' }, fields);
    if (!LK.stock(b.name)) {
      var name = el('input', { type: 'text', value: b.name, spellcheck: 'false', 'aria-label': 'Назва кістки' });
      name.addEventListener('change', function () {
        var n = boneName(name.value);
        if (n === b.name) { name.value = n; return; }
        if (!n || lays().list.some(function (x) { return LK.boneOf(x, n); })) { name.value = b.name; toast(n ? 'Кістка ' + n + ' вже є' : 'Порожня назва'); return; }
        renameBone(b.name, n);
      });
      box.prepend(el('label', { class: 'field lb-wide' }, [el('span', { class: 'lbl', text: 'Назва' }), name]));
      box.appendChild(el('button', { type: 'button', class: 'btn sm lb-del', text: 'Видалити кістку', onclick: function () { deleteBone(b.name); } }));
    }
    return box;
  }
  function renameBone(from, to) {
    lays().list.forEach(function (L) {
      L.bones.forEach(function (x) {
        if (x.name === from) x.name = to;
        if (x.parent === from) x.parent = to;
      });
    });
    var bind = lays().bind;
    Object.keys(bind).forEach(function (id) { if (bind[id] === from) bind[id] = to; });
    if (lay.sel === from) lay.sel = to;
    scheduleSave();
    renderLayouts();
  }
  function deleteBone(name) {
    lays().list.forEach(function (L) {
      L.bones = L.bones.filter(function (x) { return x.name !== name; });
      L.bones.forEach(function (x) { if (x.parent === name) x.parent = 'root'; });
    });
    var bind = lays().bind;
    Object.keys(bind).forEach(function (id) { if (bind[id] === name) bind[id] = ''; });
    if (lay.sel === name) lay.sel = null;
    scheduleSave();
    renderLayouts();
  }
  function addBone() {
    if (!state.s) return;
    var n = 1;
    while (lays().list.some(function (L) { return LK.boneOf(L, 'position_custom_' + n); })) n++;
    var name = 'position_custom_' + n;
    lays().list.forEach(function (L) { L.bones.push(LK.cleanBone({ name: name, parent: 'area_center', x: Math.round(L.w / 2), y: -Math.round(L.h / 2) })); });
    lay.sel = name;
    scheduleSave();
    renderLayouts();
    var row = document.querySelector('#lay-bones [data-bone="' + name + '"]');
    if (row) row.scrollIntoView({ block: 'nearest' });
  }
  function renderLayMeta() {
    var box = $('lay-meta');
    box.textContent = '';
    var L = curLayout();
    if (!L) return;
    var t = LK.template(L.name);
    var nameF = textField('Файл', L.name, 'w-name', function () {}, 'layout_landscape_16_9', 'layout_file');
    var input = nameF.querySelector('input');
    input.addEventListener('change', function () {
      var n = K.slug(input.value);
      if (n === L.name) return;
      if (!n || lays().list.some(function (x) { return x !== L && x.name === n; })) { input.value = L.name; toast(n ? 'Лейаут ' + n + ' вже є' : 'Порожня назва'); return; }
      if (lay.scr[L.name]) { lay.scr[n] = lay.scr[L.name]; delete lay.scr[L.name]; }
      L.name = n;
      scheduleSave();
      renderLayouts();
    });
    var size = function (key) {
      return function (v) {
        var n = Math.round(Number(v));
        if (!(n > 0)) return;
        L[key] = Math.min(10000, n);
        $('lay-size').textContent = L.w + ' × ' + L.h;
        drawLayout();
        scheduleSave();
      };
    };
    box.appendChild(el('div', { class: 'row' }, [nameF, numPair('Розмір гри, px', L.w, L.h, size('w'), size('h'), ['Ширина', 'Висота'], 'game_size')]));
    var acts = fileButton('Імпорт .json', '.json,application/json', true, importLayouts);
    acts.push(el('button', { type: 'button', class: 'btn sm' + (lay.reset ? ' lb-del' : ''), text: lay.reset ? 'Точно скинути?' : 'Скинути до шаблону', disabled: !t, title: t ? 'Повернути значення шаблону Pandora' : 'Для цього файлу немає шаблону', onclick: function () {
      if (!lay.reset) { lay.reset = true; renderLayMeta(); return; }
      lay.reset = false;
      t.bones = t.bones.concat(L.bones.filter(function (x) { return !LK.isArea(x.name) && !LK.stock(x.name); }));
      lays().list[lay.cur] = t;
      scheduleSave();
      renderLayouts();
      toast('Лейаут ' + t.name + ' скинуто до шаблону');
    } }));
    acts.push(el('span', { class: 'note', text: 'або перетягни layout_*.json на полотно' }));
    box.appendChild(el('div', { class: 'row lay-acts' }, acts));
  }

  async function importLayouts(files) {
    if (!state.s) return;
    var list = lays().list, done = [];
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (!/\.json$/i.test(f.name)) continue;
      try {
        var L = LK.parse(await f.text(), f.name);
        var at = list.map(function (x) { return x.name; }).indexOf(L.name);
        if (at === -1) { list.push(L); at = list.length - 1; }
        else list[at] = L;
        lay.cur = at;
        done.push(L.name);
      } catch (e) { toast('Не лейаут: ' + f.name); }
    }
    if (!done.length) return;
    lay.sel = null;
    lay.reset = false;
    scheduleSave();
    renderLayouts();
    toast('Імпортовано: ' + done.join(', '));
  }

  function layFolder() {
    var f = String((state.plan && state.plan.tech.folder) || '').replace(/^\/+/, '').replace(/\/?$/, '/');
    return (/spine\/$/.test(f) ? f.replace(/spine\/$/, '') : f) + 'layouts/';
  }
  function layExport() {
    var items = [], images = [], seen = {};
    layDrawables().forEach(function (d) {
      var box = d.box, bw = box.r - box.l, bh = box.b - box.t;
      if (!(bw > 0 && bh > 0)) return;
      var base = d.id === 'reels' ? 'reels' : spineOf(d.it.c).replace(/^animation_/, '');
      var n = seen[base] = (seen[base] || 0) + 1;
      var id = n > 1 ? base + '_' + n : base;
      var k = Math.min(1, 2048 / Math.max(bw, bh));
      var cv = el('canvas', { width: Math.max(1, Math.round(bw * k)), height: Math.max(1, Math.round(bh * k)) });
      var x = cv.getContext('2d');
      x.setTransform(k, 0, 0, k, -box.l * k, -box.t * k);
      d.draw(x, null, 0);
      images.push({ name: 'kit/' + id, canvas: cv });
      items.push({ slot: 'kit_' + id, bone: d.bone, region: 'kit/' + id, x: (box.l + box.r) / 2, y: -(box.t + box.b) / 2, width: bw, height: bh });
    });
    return { items: items, images: images };
  }
  function layList() { return state.s && state.s.layouts ? state.s.layouts.list : []; }
  function exLays() { return state.skip.layouts ? [] : layList().filter(function (L) { return !state.skip['layout:' + L.name]; }); }
  function layNames() { return exLays().map(function (L) { return L.name; }); }
  async function addLayouts(zip, root) {
    var list = exLays();
    if (!list.length) return;
    var tech = state.plan.tech, folder = layFolder(), ex = layExport(), ed = root + 'spine-editor/layouts/';
    list.forEach(function (L) {
      zip.file(root + folder + L.name + '.json', JSON.stringify(LK.toJson(L, tech)));
      zip.file(ed + L.name + '.json', JSON.stringify(LK.editorJson(L, tech, ex.items), null, 2));
    });
    for (var i = 0; i < ex.images.length; i++) zip.file(ed + 'images/' + ex.images[i].name + '.png', await canvasBlob(ex.images[i].canvas));
  }
  var layIcons = {};
  function layIcon(L) {
    var k = L.w + 'x' + L.h;
    if (layIcons[k]) return layIcons[k];
    var a = L.w / L.h, w = a >= 1 ? 42 : Math.max(14, Math.round(42 * a)), h = a >= 1 ? Math.max(14, Math.round(42 / a)) : 42;
    var c = el('canvas', { width: 48, height: 48 });
    var x = c.getContext('2d');
    x.strokeStyle = '#8e8e93';
    x.lineWidth = 3;
    rr(x, (48 - w) / 2, (48 - h) / 2, w, h, 5);
    x.stroke();
    x.fillStyle = '#0a84ff';
    x.beginPath();
    x.arc(24, 24, 5, 0, Math.PI * 2);
    x.fill();
    layIcons[k] = c;
    return c;
  }
  function exLayoutRow(L) {
    var key = 'layout:' + L.name;
    return el('label', { class: 'wz-comp' }, [
      el('input', { type: 'checkbox', checked: !state.skip[key], 'aria-label': 'Експортувати лейаут ' + LK.title(L), onchange: function (e) { state.skip[key] = !e.target.checked; exChanged(); } }),
      el('span', { class: 'comp-thumb', 'aria-hidden': 'true' }, [el('img', { alt: '', src: thumb(layIcon(L)) })]),
      el('span', {}, [el('b', { text: 'Лейаут ' + LK.title(L) }), el('small', { text: L.name + ' · ' + L.w + '×' + L.h + ' · ' + layFolder() })])
    ]);
  }

  var ART_TO = 'spine-draft-kit.export-to';
  var ART_ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5Z"/></svg>';
  var exRepo = { to: readExTo(), dir: null, last: null, perm: null, plan: null, msg: '', bad: false, busy: '', seq: 0, files: false, db: null };
  function artCan() { try { return typeof window.showDirectoryPicker === 'function' && window.self === window.top; } catch (e) { return false; } }
  function readExTo() { try { return artCan() && localStorage.getItem(ART_TO) === 'repo' ? 'repo' : 'zip'; } catch (e) { return 'zip'; } }
  function setExTo(to) {
    exRepo.to = to === 'repo' && artCan() ? 'repo' : 'zip';
    try { localStorage.setItem(ART_TO, exRepo.to); } catch (e) { /* no storage */ }
    openArt();
    renderExFoot();
  }
  function artDb() {
    if (!exRepo.db) exRepo.db = new Promise(function (res) {
      setTimeout(function () { res(null); }, 3000);
      try {
        var r = indexedDB.open('spine-draft-kit-art', 1);
        r.onupgradeneeded = function () { r.result.createObjectStore('dirs'); };
        r.onsuccess = function () { res(r.result); };
        r.onerror = r.onblocked = function () { res(null); };
      } catch (e) { res(null); }
    });
    return exRepo.db;
  }
  async function artStore(mode, fn) {
    var db = await artDb();
    if (!db) return null;
    return new Promise(function (res) {
      try {
        var q = fn(db.transaction('dirs', mode).objectStore('dirs'));
        q.onsuccess = function () { res(q.result || null); };
        q.onerror = function () { res(null); };
      } catch (e) { res(null); }
    });
  }
  function artKey() { return state.pid || 'none'; }
  function artGet(key) { return artStore('readonly', function (s) { return s.get(key); }); }
  function artPut(key, h) { return artStore('readwrite', function (s) { return s.put(h, key); }); }
  function spineFolder() { return String((state.plan && state.plan.tech.folder) || '').replace(/^\/+/, '').replace(/\/?$/, '/'); }
  function artParts(path) { return path.split('/').filter(function (p) { return p && p !== '.'; }); }
  async function artSub(root, path, create) {
    var d = root, parts = artParts(path);
    for (var i = 0; i < parts.length; i++) {
      try { d = await d.getDirectoryHandle(parts[i], { create: !!create }); }
      catch (e) { if (!create && e.name === 'NotFoundError') return null; throw e; }
    }
    return d;
  }
  async function artNames(d) {
    var out = new Set();
    if (d) for await (var k of d.keys()) out.add(k);
    return out;
  }
  async function artText(d, name) {
    try { return await (await (await d.getFileHandle(name)).getFile()).text(); }
    catch (e) { if (e.name === 'NotFoundError') return ''; throw e; }
  }
  function atlasPages(text) {
    return String(text || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(function (s) { return s.indexOf(':') === -1 && /\.(png|jpe?g|webp)$/i.test(s); });
  }
  async function artPerm(h, ask) {
    var o = { mode: 'readwrite' };
    try {
      var p = await h.queryPermission(o);
      if (p !== 'granted' && ask) p = await h.requestPermission(o);
      return p;
    } catch (e) { return 'denied'; }
  }
  async function openArt() {
    var box = $('ex-to');
    box.hidden = !artCan();
    [].forEach.call(box.querySelectorAll('[data-to]'), function (b) { b.setAttribute('aria-pressed', String(b.dataset.to === exRepo.to)); });
    exRepo.plan = null;
    exRepo.msg = '';
    exRepo.bad = false;
    renderArt();
    if (exRepo.to !== 'repo') return;
    var my = ++exRepo.seq, key = artKey();
    var dir = await artGet(key), last = await artGet('last');
    var perm = dir ? await artPerm(dir, false) : null;
    if (my !== exRepo.seq || key !== artKey()) return;
    exRepo.dir = dir;
    exRepo.last = last;
    exRepo.perm = perm;
    renderArt();
    renderExFoot();
    if (perm === 'granted') planArt();
  }
  async function pickArt() {
    var o = { id: 'art-repo', mode: 'readwrite' }, h;
    if (exRepo.dir || exRepo.last) o.startIn = exRepo.dir || exRepo.last;
    try { h = await window.showDirectoryPicker(o); }
    catch (e) {
      if (e.name === 'AbortError') return;
      exRepo.msg = 'Браузер не дав вибрати папку: ' + (e.message || e.name);
      exRepo.bad = true;
      renderArt();
      return;
    }
    var seg = artParts(spineFolder())[0], ok = true;
    try { ok = !seg || !!(await artSub(h, seg, false)); } catch (e) { ok = false; }
    if (!ok) {
      exRepo.msg = 'У «' + h.name + '» немає папки ' + seg + '/. Виберіть корінь арт-репо гри.';
      exRepo.bad = true;
      renderArt();
      return;
    }
    exRepo.dir = h;
    exRepo.last = h;
    exRepo.perm = 'granted';
    exRepo.msg = '';
    exRepo.bad = false;
    planArt();
    await artPut(artKey(), h);
    await artPut('last', h);
  }
  async function allowArt() {
    exRepo.perm = await artPerm(exRepo.dir, true);
    if (exRepo.perm === 'granted') { exRepo.msg = ''; exRepo.bad = false; planArt(); return; }
    exRepo.msg = 'Без дозволу на запис кит не може змінити папку';
    exRepo.bad = true;
    renderArt();
  }
  async function planArt() {
    if (exRepo.to !== 'repo' || !exRepo.dir || exRepo.perm !== 'granted') return;
    var my = ++exRepo.seq, plan = { add: [], rep: [], ladd: [], lrep: [], stale: [] }, own = {};
    exRepo.plan = null;
    renderArt();
    renderExFoot();
    state.plan.spines.forEach(function (s) { own[s.pageName] = true; });
    try {
      var sd = await artSub(exRepo.dir, spineFolder(), false), ld = await artSub(exRepo.dir, layFolder(), false);
      var sn = await artNames(sd), ln = await artNames(ld), list = exSpines();
      for (var i = 0; i < list.length; i++) {
        var sp = list[i];
        if (!sn.has(sp.name + '.json') && !sn.has(sp.name + '.atlas')) { plan.add.push(sp.name); continue; }
        plan.rep.push(sp.name);
        if (!sn.has(sp.name + '.atlas')) continue;
        atlasPages(await artText(sd, sp.name + '.atlas')).forEach(function (p) {
          if (!own[p] && p.indexOf(sp.name) === 0 && sn.has(p) && plan.stale.indexOf(p) === -1) plan.stale.push(p);
        });
      }
      exLays().forEach(function (L) { (ln.has(L.name + '.json') ? plan.lrep : plan.ladd).push(L.name); });
    } catch (e) {
      if (my !== exRepo.seq) return;
      exRepo.msg = 'Не вдалося прочитати папку: ' + (e.message || e.name);
      exRepo.bad = true;
      renderArt();
      renderExFoot();
      return;
    }
    if (my !== exRepo.seq) return;
    exRepo.plan = plan;
    renderArt();
    renderExFoot();
  }
  function planText(p) {
    var a = [], rep = p.rep.length + p.lrep.length ? exWhat(p.rep.length, p.lrep.length) : '', add = p.add.length + p.ladd.length ? exWhat(p.add.length, p.ladd.length) : '';
    if (rep) a.push('Замінить ' + rep);
    if (add) a.push((a.length ? 'додасть ' : 'Додасть ') + add);
    if (p.stale.length) a.push('прибере ' + p.stale.length + ' ' + plural(p.stale.length, 'стару сторінку', 'старі сторінки', 'старих сторінок') + ' атласу');
    return a.length ? a.join(' · ') : 'Нічого не вибрано';
  }
  function planFiles(p) {
    var g = [['Нові', p.add.concat(p.ladd)], ['Заміна', p.rep.concat(p.lrep)], ['Прибрати', p.stale]].filter(function (x) { return x[1].length; });
    if (!g.length) return null;
    return el('details', { class: 'ex-files', open: exRepo.files, ontoggle: function (e) { exRepo.files = e.target.open; } }, [el('summary', { text: 'Файли' })].concat(g.map(function (x) { return el('p', {}, [el('b', { text: x[0] }), x[1].join(' · ')]); })));
  }
  function renderArt() {
    var box = $('ex-repo');
    box.hidden = exRepo.to !== 'repo';
    if (box.hidden) return;
    var where = spineFolder() + ' · ' + layFolder(), btns = [], kids = [];
    if (exRepo.dir && exRepo.perm !== 'granted') btns.push(el('button', { type: 'button', class: 'btn sm primary', text: 'Дозволити', onclick: allowArt }));
    btns.push(el('button', { type: 'button', class: 'btn sm' + (exRepo.dir ? '' : ' primary'), text: exRepo.dir ? 'Змінити' : 'Вибрати папку', onclick: pickArt }));
    var row = el('div', { class: 'ex-dir' }, [el('span', {}, [el('b', { text: exRepo.dir ? exRepo.dir.name : 'Корінь арт-репо гри' }), el('small', { text: where })])].concat(btns));
    row.insertAdjacentHTML('afterbegin', ART_ICON);
    kids.push(row);
    if (exRepo.msg) kids.push(el('p', { class: 'ex-plan ' + (exRepo.bad ? 'bad' : 'ok'), text: exRepo.msg }));
    else if (!exRepo.dir) kids.push(el('p', { class: 'ex-plan', text: 'Кит замінить спайни й лейаути з тими ж назвами і додасть нові' }));
    else if (exRepo.perm !== 'granted') kids.push(el('p', { class: 'ex-plan', text: 'Браузер питає дозвіл на запис у цю папку' }));
    else if (!exRepo.plan) kids.push(el('p', { class: 'ex-plan', text: 'Дивлюся, що вже є в репо…' }));
    else {
      kids.push(el('p', { class: 'ex-plan', text: planText(exRepo.plan) }));
      var f = planFiles(exRepo.plan);
      if (f) kids.push(f);
    }
    box.replaceChildren.apply(box, kids);
  }
  async function artFile(d, name, data) {
    var blob = data instanceof Blob ? data : new Blob([data]), fh = null, old = null;
    try { fh = await d.getFileHandle(name); old = await fh.getFile(); }
    catch (e) { if (e.name !== 'NotFoundError') throw e; }
    if (old && old.size === blob.size) {
      var x = new Uint8Array(await old.arrayBuffer()), y = new Uint8Array(await blob.arrayBuffer()), same = true;
      for (var i = 0; i < x.length && same; i++) same = x[i] === y[i];
      if (same) return 'same';
    }
    if (!fh) fh = await d.getFileHandle(name, { create: true });
    var w = await fh.createWritable();
    await w.write(blob);
    await w.close();
    return old ? 'rep' : 'add';
  }
  function artSummary(r) {
    var a = [];
    if (r.rep + r.lrep) a.push('замінено ' + exWhat(r.rep, r.lrep));
    if (r.add + r.ladd) a.push('додано ' + exWhat(r.add, r.ladd));
    if (r.same + r.lsame) a.push('без змін ' + exWhat(r.same, r.lsame));
    if (r.del) a.push('прибрано ' + r.del + ' ' + plural(r.del, 'стару сторінку', 'старі сторінки', 'старих сторінок'));
    return 'Готово: ' + (a.join(' · ') || 'нічого не записано');
  }
  async function writeArt() {
    if (exRepo.busy || !exRepo.dir) return;
    if (exRepo.perm !== 'granted') { await allowArt(); if (exRepo.perm !== 'granted') return; }
    var list = exSpines(), ls = exLays(), tech = state.plan.tech, total = list.length + ls.length, own = {};
    var r = { add: 0, rep: 0, same: 0, ladd: 0, lrep: 0, lsame: 0, del: 0 };
    var step = function (i) { exRepo.busy = 'Записую ' + i + ' / ' + total + '…'; renderExFoot(); };
    state.plan.spines.forEach(function (s) { own[s.pageName] = true; });
    exRepo.msg = '';
    exRepo.bad = false;
    try {
      var sd = list.length ? await artSub(exRepo.dir, spineFolder(), true) : null;
      for (var i = 0; i < list.length; i++) {
        var sp = list[i];
        step(i + 1);
        var old = atlasPages(await artText(sd, sp.name + '.atlas'));
        var got = [await artFile(sd, sp.pageName, await canvasBlob(pageCanvas(sp.page))), await artFile(sd, sp.name + '.atlas', sp.atlasText), await artFile(sd, sp.name + '.json', sp.jsonText)];
        r[got[2] === 'add' ? 'add' : got.some(function (g) { return g !== 'same'; }) ? 'rep' : 'same']++;
        for (var j = 0; j < old.length; j++) {
          if (own[old[j]] || old[j].indexOf(sp.name) !== 0) continue;
          try { await sd.removeEntry(old[j]); r.del++; }
          catch (e) { if (e.name !== 'NotFoundError') throw e; }
        }
      }
      var ld = ls.length ? await artSub(exRepo.dir, layFolder(), true) : null;
      for (var k = 0; k < ls.length; k++) {
        step(list.length + k + 1);
        r['l' + await artFile(ld, ls[k].name + '.json', JSON.stringify(LK.toJson(ls[k], tech)))]++;
      }
      exRepo.msg = artSummary(r);
    } catch (e) {
      exRepo.msg = 'Запис зупинився: ' + (e.message || e.name);
      exRepo.bad = true;
    } finally { exRepo.busy = ''; }
    toast(exRepo.bad ? exRepo.msg : 'Записано в ' + exRepo.dir.name);
    renderArt();
    renderExFoot();
  }

  function bindLayouts() {
    var cv = $('lay-canvas');
    cv.addEventListener('pointerdown', function (e) {
      if (!lay.view || e.button > 0) return;
      var p = layPoint(e);
      var marks = hitMarks(p);
      var name = null, cycle = false;
      if (marks.length) {
        cycle = marks.indexOf(lay.sel) !== -1;
        name = cycle ? lay.sel : marks[0];
      } else {
        var h = hitItem(p);
        name = h ? h.bone : null;
      }
      if (!name) { if (lay.sel) selectBone(null); return; }
      if (name !== lay.sel) selectBone(name, true);
      var L = curLayout(), b = LK.boneOf(L, name);
      if (!b) return;
      lay.drag = { id: e.pointerId, p: p, x: b.x, y: b.y, b: b, moved: false, marks: cycle ? marks : null };
      cv.setPointerCapture(e.pointerId);
      // cv.style.cursor = 'grabbing';
      // cv.focus({ preventScroll: true });
      e.preventDefault();
    });
    cv.addEventListener('pointermove', function (e) {
      if (!lay.view) return;
      var d = lay.drag;
      var p = layPoint(e);
      if (!d) {
        var hov = hitMarks(p)[0] || null;
        cv.style.cursor = hov || hitItem(p) ? 'pointer' : 'default';
        if (hov !== lay.hover) { lay.hover = hov; drawLayout(); }
        return;
      }
      // if (e.pointerId !== d.id) return;
      // if (!d.moved && Math.hypot(p.x - d.p.x, p.y - d.p.y) * lay.view.css < 3) return;
      // var n = LK.nudge(curLayout(), d.b, lay.view.scr, p.x - d.p.x, p.y - d.p.y);
      // d.b.x = Math.round(d.x + n.x);
      // d.b.y = Math.round(d.y + n.y);
      // d.moved = true;
      // drawLayout();
      // boneRow(d.b);
      // syncBoneInputs();
    });
    var end = function (e) {
      var d = lay.drag;
      if (!d || e.pointerId !== d.id) return;
      lay.drag = null;
      // cv.style.cursor = 'grab';
      if (d.moved) scheduleSave();
      else if (d.marks && d.marks.length > 1) selectBone(d.marks[(d.marks.indexOf(d.b.name) + 1) % d.marks.length], true);
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', function () { if (!lay.drag && lay.hover) { lay.hover = null; drawLayout(); } });
    // cv.addEventListener('keydown', function (e) {
    //   var d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
    //   var b = d && lay.sel ? LK.boneOf(curLayout(), lay.sel) : null;
    //   if (!b) return;
    //   e.preventDefault();
    //   var st = e.shiftKey ? 10 : 1;
    //   b.x = K.roundTo(b.x + d[0] * st, 2);
    //   b.y = K.roundTo(b.y + d[1] * st, 2);
    //   boneTouched(b);
    //   syncBoneInputs();
    // });
    $('lay-marks').addEventListener('change', function (e) { lay.marks = e.target.checked; drawLayout(); });
    $('lay-spin-go').addEventListener('click', startSpin);
    $('lay-spin-quick').addEventListener('change', function (e) { $('spin-quick').checked = e.target.checked; });
    $('lay-spin-win').addEventListener('change', function (e) { $('spin-win').checked = e.target.checked; });
    $('lay-add').addEventListener('click', addBone);
    var SHUT = 'spine-draft-kit.lay-shut';
    var shut = {};
    try { shut = JSON.parse(localStorage.getItem(SHUT) || '{}') || {}; } catch (e) { shut = {}; }
    document.querySelectorAll('.lay-tog').forEach(function (b) {
      var id = b.getAttribute('aria-controls');
      var card = b.closest('.lay-card');
      var set = function (closed) {
        card.classList.toggle('shut', closed);
        b.setAttribute('aria-expanded', String(!closed));
      };
      set(!!shut[id]);
      b.addEventListener('click', function () {
        shut[id] = !shut[id];
        set(shut[id]);
        try { localStorage.setItem(SHUT, JSON.stringify(shut)); } catch (e) { return; }
      });
    });
    dropTarget($('lay-stage'), importLayouts);
    if (window.ResizeObserver) new ResizeObserver(function () { drawLayout(); }).observe($('lay-stage'));
    window.addEventListener('resize', function () { drawLayout(); });
    var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    if (mq && mq.addEventListener) mq.addEventListener('change', function () { drawLayout(); });
  }

  var Lib = window.SpineKitLibrary;
  var SbStore = window.SpineKitSandboxStore;
  var sb = { items: [], store: { images: {}, blobs: {} }, saved: {}, ready: false, loadErr: '', saveTimer: null, flushing: null, again: false, cur: null, anim: null, skin: null, speed: 1, playing: true, loop: true, bones: false, cam: null, camFor: null, zoomTxt: '', plan: null, player: null, scrub: false, t: 0, d: 0, confirm: null, conTimer: null, libDel: null, libBusy: '', libErr: '', libLoading: false, q: '' };
  var SB_MOVED = 'spine-draft-kit.sandbox-moved';
  var SB_PREF = 'spine-draft-kit.sandbox';
  var SB_TPL = ['custom', 'character', 'logo', 'popup', 'infopanel', 'background'];
  var SB_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5Z" fill="currentColor"/></svg>';
  var SB_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/></svg>';
  var SB_MORE = '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>';
  var SB_PLUS = '<path d="M12 5v14M5 12h14"/>';
  var SB_BOX = '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 10h16"/>';
  var SB_FILE = '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/>';

  function sbPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(SB_PREF) || '{}') || {};
      if (typeof p.speed === 'number' && p.speed >= 0.1 && p.speed <= 2) sb.speed = p.speed;
      if (typeof p.loop === 'boolean') sb.loop = p.loop;
    } catch (e) { return; }
  }
  function sbKeep() { try { localStorage.setItem(SB_PREF, JSON.stringify({ speed: sb.speed, loop: sb.loop })); } catch (e) { return; } }
  function sbNewId() { return 'sb' + newId().slice(1); }
  function sbList() { return sb.items; }
  function sbItems() {
    if (!sb.ready) throw new Error('Пісочниця ще завантажується, спробуйте за мить');
    return sb.items;
  }
  function sbItem(id) {
    var k = String(id || '');
    if (!k) return null;
    return sbList().filter(function (c) { return c.id === k; })[0] || sbList().filter(function (c) { return c.name === k || spineOf(c) === k; })[0] || null;
  }
  function sbCur() {
    var l = sbList();
    var c = sbItem(sb.cur) || l[l.length - 1] || null;
    sb.cur = c ? c.id : null;
    return c;
  }
  function sbShown() { return !!state.s && state.view === 'sandbox' && !$('view-sandbox').hidden; }
  function sbFmt(t) { return (Math.round((Number(t) || 0) * 100) / 100).toFixed(2).replace('.', ','); }
  function sbReset() {
    sbDispose();
    sb.cur = null;
    sb.anim = null;
    sb.skin = null;
    sb.plan = null;
    sb.confirm = null;
    sb.libDel = null;
    $('tab-sandbox').classList.remove('dot');
  }
  function sbClean(raw) {
    var c = clone(raw.component || raw);
    c.id = raw.id;
    c.type = 'custom';
    delete c.on;
    if (!Array.isArray(c.anims)) c.anims = frameAnims();
    return c;
  }
  function sbKeyOf(id, role) { return role === 'main' ? 'c:' + id : 'p:' + id + ':' + role.slice(5); }
  async function sbImages(id, images) {
    var roles = Object.keys(images || {});
    for (var i = 0; i < roles.length; i++) {
      var x = images[roles[i]];
      if (!x || !x.blob || (roles[i] !== 'main' && roles[i].indexOf('part:') !== 0)) continue;
      try { await setImage(sbKeyOf(id, roles[i]), x.blob, x.name || ''); } catch (e) { continue; }
    }
  }
  function sbSig(c) {
    var keys = compImageKeys(c);
    return JSON.stringify(c) + '|' + Object.keys(keys).map(function (r) { return keys[r] + ':' + imgRev(keys[r]); }).join(',') + '|' + sb.items.indexOf(c);
  }
  function sbRecord(c) {
    var d = clone(c);
    delete d.id;
    var keys = compImageKeys(c), images = {};
    Object.keys(keys).forEach(function (role) {
      var k = keys[role];
      if (sb.store.blobs[k]) images[role] = { name: (sb.store.images[k] && sb.store.images[k].fileName) || '', blob: sb.store.blobs[k] };
    });
    return { id: c.id, component: d, images: images, order: sb.items.indexOf(c) };
  }
  async function sbLoad() {
    var recs;
    if (sb.ready) await sbFlush();
    try { recs = await SbStore.load(); sb.loadErr = ''; }
    catch (e) { sb.loadErr = e.message; return false; }
    sb.store.images = {};
    sb.store.blobs = {};
    sb.items = recs.map(sbClean);
    for (var i = 0; i < recs.length; i++) await sbImages(recs[i].id, recs[i].images);
    sb.saved = {};
    sb.items.forEach(function (c) { sb.saved[c.id] = sbSig(c); });
    sb.ready = true;
    if (!sbItem(sb.cur)) { sb.cur = null; sb.anim = null; sb.skin = null; }
    return true;
  }
  function sbForget() {
    clearTimeout(sb.saveTimer);
    sbDispose();
    sb.items = [];
    sb.store.images = {};
    sb.store.blobs = {};
    sb.saved = {};
    sb.again = false;
    sb.ready = false;
    sb.cur = null;
    sb.anim = null;
    sb.skin = null;
    sb.plan = null;
  }
  function sbSchedule() {
    if (!sb.ready) return;
    clearTimeout(sb.saveTimer);
    sb.saveTimer = setTimeout(sbFlush, 300);
  }
  async function sbWrite() {
    var ids = {}, list = sb.items.slice();
    for (var i = 0; i < list.length; i++) {
      var c = list[i], sig = sbSig(c);
      ids[c.id] = true;
      if (sb.saved[c.id] === sig) continue;
      try { await SbStore.put(sbRecord(c)); sb.saved[c.id] = sig; } catch (e) { toast('Пісочниця не зберіглась: ' + e.message); }
    }
    var gone = Object.keys(sb.saved).filter(function (id) { return !ids[id]; });
    for (var j = 0; j < gone.length; j++) {
      try { await SbStore.remove(gone[j]); delete sb.saved[gone[j]]; } catch (e) { toast('Пісочниця: не вдалося прибрати: ' + e.message); }
    }
  }
  async function sbDrain() {
    try {
      while (sb.again) {
        sb.again = false;
        await sbWrite();
      }
    } finally { sb.flushing = null; }
  }
  async function sbFlush() {
    clearTimeout(sb.saveTimer);
    if (!sb.ready) return;
    sb.again = true;
    if (!sb.flushing) sb.flushing = sbDrain();
    await sb.flushing;
  }
  function sbLegacy(settings) {
    var out = {};
    var list = settings && settings.sandbox && Array.isArray(settings.sandbox.items) ? settings.sandbox.items : [];
    if (!list.length || !sb.ready || (Sync && Sync.mode() === 'engine')) return out;
    var done = {};
    try { done = JSON.parse(localStorage.getItem(SB_MOVED) || '{}') || {}; } catch (e) { done = {}; }
    list.forEach(function (raw) {
      if (!raw || !raw.id || done[raw.id] || sb.items.some(function (x) { return x.id === raw.id; })) return;
      sb.items.push(sbClean(raw));
      done[raw.id] = true;
      out[raw.id] = true;
    });
    try { localStorage.setItem(SB_MOVED, JSON.stringify(done)); } catch (e) { return out; }
    return out;
  }
  function sbMine(by) {
    var me = Sync && Sync.me ? Sync.me() : null;
    return !!by && by.kind === 'claude' && !!me && String(by.email || '').toLowerCase() === String(me.email || '').toLowerCase();
  }
  async function sbRemote(ev) {
    if (!sb.ready || !ev || !ev.id) return;
    var c = sb.items.filter(function (x) { return x.id === ev.id; })[0] || null;
    var anim = null;
    if (ev.op === 'del') {
      if (!c) return;
      sb.items = sb.items.filter(function (x) { return x !== c; });
      forgetComponentImages(c);
      delete sb.saved[c.id];
      if (sb.cur === c.id) { sb.cur = null; sb.anim = null; sb.skin = null; }
    } else if (ev.rec) {
      var next = sbClean(ev.rec);
      if (c) {
        var old = {};
        (c.anims || []).forEach(function (a) { if (a) old[a.name] = JSON.stringify(a); });
        (next.anims || []).forEach(function (a) { if (!anim && a && old[a.name] !== JSON.stringify(a)) anim = a.name; });
        var P = window.SpineKitPatch;
        P.apply({ x: c }, P.diff({ x: c }, { x: next }));
      } else { c = next; sb.items.push(c); }
      var want = {}, roles = Object.keys(ev.rec.images || {});
      roles.forEach(function (role) { want[sbKeyOf(c.id, role)] = true; });
      Object.keys(sb.store.images).concat(Object.keys(sb.store.blobs)).forEach(function (k) { if ((k === 'c:' + c.id || k.indexOf('p:' + c.id + ':') === 0) && !want[k]) forgetImage(k); });
      for (var i = 0; i < roles.length; i++) {
        var x = ev.rec.images[roles[i]], k = sbKeyOf(c.id, roles[i]);
        if (!x || !x.blob || sb.store.blobs[k] === x.blob) continue;
        try { await setImage(k, x.blob, x.name || ''); } catch (e) { continue; }
      }
      sb.saved[c.id] = sbSig(c);
    }
    if (sbMine(ev.by) && ev.op !== 'del' && !(sbShown() && remoteBusy() && c.id !== sb.cur)) {
      if (c.id !== sb.cur) { sb.cur = c.id; sb.skin = null; sb.anim = null; sb.confirm = null; }
      if (anim) sb.anim = anim;
      sb.playing = true;
      if (!sbShown() && state.s) $('tab-sandbox').classList.add('dot');
    }
    if (!sbShown()) return;
    if (remoteBusy()) { clearTimeout(sb.remoteTimer); sb.remoteTimer = setTimeout(renderSandbox, 600); return; }
    renderSandbox();
  }

  function sbPlanOf(c) {
    if (!c || !state.s) return null;
    try { return K.planAll(Object.assign({}, state.s, { components: [c] }), px).spines[0] || null; } catch (e) { return null; }
  }
  function sbBuild() {
    var c = sbCur();
    sb.plan = null;
    if (!c || !state.s) return null;
    try { sb.plan = K.planAll(Object.assign({}, state.s, { components: [c] }), px); } catch (e) { toast('Пісочниця: не вдалося зібрати: ' + e.message); }
    return sbSpine();
  }
  function sbSpine() { return (sb.plan && sb.plan.spines[0]) || null; }

  var imgIds = new WeakMap(), imgSeq = 0;
  function imgRev(k) {
    var im = imgs(k).images[k];
    if (!im || !im.canvas) return '-';
    var id = imgIds.get(im.canvas);
    if (!id) { imgSeq += 1; id = imgSeq; imgIds.set(im.canvas, id); }
    return id;
  }
  function sbKey(c, sp) {
    var keys = compImageKeys(c);
    return sp.jsonText + '|' + sp.atlasText + '|' + Object.keys(keys).map(function (r) { return keys[r] + ':' + imgRev(keys[r]); }).join(',') + '|' + JSON.stringify((c.parts || []).map(function (p) { return [p.name, p.shape, p.color]; })) + '|' + sb.skin;
  }
  function sbDispose() {
    if (sb.player && sb.player.player) { try { sb.player.player.dispose(); } catch (e) { /* already gone */ } }
    sb.player = null;
    var st = $('sb-stage');
    if (st) st.textContent = '';
  }
  function sbMsg(text) { sbDispose(); $('sb-stage').appendChild(el('div', { class: 'stage-msg', text: text })); }
  function sbApply(p) {
    p.animationState.apply(p.skeleton);
    p.skeleton.updateWorldTransform();
  }
  var SB_PAD = 1.16;
  function sbAabb(v, n) {
    var b = { l: Infinity, b: Infinity, r: -Infinity, t: -Infinity };
    for (var i = 0; i < n; i += 2) {
      if (!isFinite(v[i]) || !isFinite(v[i + 1])) return null;
      b.l = Math.min(b.l, v[i]); b.r = Math.max(b.r, v[i]);
      b.b = Math.min(b.b, v[i + 1]); b.t = Math.max(b.t, v[i + 1]);
    }
    return n ? b : null;
  }
  function sbJoin(a, b) {
    if (!a) return b;
    if (!b) return a;
    return { l: Math.min(a.l, b.l), b: Math.min(a.b, b.b), r: Math.max(a.r, b.r), t: Math.max(a.t, b.t) };
  }
  function sbCut(a, c) {
    var b = { l: Math.max(a.l, c.l), b: Math.max(a.b, c.b), r: Math.min(a.r, c.r), t: Math.min(a.t, c.t) };
    return b.r > b.l && b.t > b.b ? b : null;
  }
  function sbBounds(p, a) {
    var S = window.spine, sk = p.skeleton, seen = null, raw = null, v = [];
    var n = a.duration > 0 ? 60 : 1;
    sk.setToSetupPose();
    for (var i = 0; i < n; i++) {
      var t = n > 1 ? a.duration * i / (n - 1) : 0;
      a.apply(sk, t, t, false, [], 1, S.MixBlend.setup, S.MixDirection.mixIn);
      sk.updateWorldTransform();
      var clip = null, end = null;
      for (var j = 0; j < sk.drawOrder.length; j++) {
        var s = sk.drawOrder[j], at = s.bone.active ? s.getAttachment() : null, k = 0;
        if (at instanceof S.ClippingAttachment) {
          k = at.worldVerticesLength;
          at.computeWorldVertices(s, 0, k, v, 0, 2);
          clip = sbAabb(v, k);
          end = clip ? at.endSlot : null;
          continue;
        }
        if (at instanceof S.RegionAttachment) { k = 8; at.computeWorldVertices(s, v, 0, 2); }
        else if (at instanceof S.MeshAttachment) { k = at.worldVerticesLength; at.computeWorldVertices(s, 0, k, v, 0, 2); }
        var b = k ? sbAabb(v, k) : null;
        if (b) {
          raw = sbJoin(raw, b);
          var alpha = sk.color.a * s.color.a * (at.color ? at.color.a : 1);
          if (clip) b = sbCut(b, clip);
          if (b && alpha > 0.02) seen = sbJoin(seen, b);
        }
        if (clip && end === s.data) clip = null;
      }
    }
    return seen || raw;
  }
  function sbFit(p) {
    var vp = p.config.viewport, fit = { boxes: {}, all: null, w: 0, h: 0 };
    p.skeleton.data.animations.forEach(function (a) {
      var b;
      try { b = sbBounds(p, a); } catch (e) { return; }
      if (!b) return;
      fit.boxes[a.name] = b;
      fit.all = sbJoin(fit.all, b);
      fit.w = Math.max(fit.w, b.r - b.l);
      fit.h = Math.max(fit.h, b.t - b.b);
    });
    p.skeleton.setToSetupPose();
    p.skeleton.updateWorldTransform();
    if (!fit.all) return null;
    fit.w = Math.max(fit.w, 32);
    fit.h = Math.max(fit.h, 32);
    vp.x = fit.all.l;
    vp.y = fit.all.b;
    vp.width = Math.max(fit.all.r - fit.all.l, 1);
    vp.height = Math.max(fit.all.t - fit.all.b, 1);
    return fit;
  }
  function sbAuto(p) {
    var f = sb.player && sb.player.player === p ? sb.player.fit : null, cv = p.canvas;
    if (!f || !cv || !cv.clientWidth || !cv.clientHeight) return null;
    var e = p.animationState && p.animationState.getCurrent(0);
    var b = (e && e.animation && f.boxes[e.animation.name]) || f.all;
    return { x: (b.l + b.r) / 2, y: (b.b + b.t) / 2, s: Math.min(cv.clientWidth / (f.w * SB_PAD), cv.clientHeight / (f.h * SB_PAD)) };
  }
  function sbCam(p) {
    var v = sb.cam || sbAuto(p), cv = p.canvas;
    if (!v || !cv || !cv.clientWidth || !cv.clientHeight) return;
    var w = cv.clientWidth / v.s, h = cv.clientHeight / v.s;
    p.currentViewport = { x: v.x - w / 2, y: v.y - h / 2, width: w, height: h, padLeft: 0, padRight: 0, padTop: 0, padBottom: 0 };
    var txt = Math.round(v.s * 100) + '%';
    if (txt !== sb.zoomTxt) { sb.zoomTxt = txt; $('sb-zoom-v').textContent = txt; }
  }
  function sbView() {
    var r = sb.player;
    if (!r || !r.ready) return null;
    return sb.cam || sbAuto(r.player);
  }
  function sbZoom(k, cx, cy) {
    var v = sbView();
    if (!v) return;
    var cv = sb.player.player.canvas, s = Math.min(16, Math.max(0.05, v.s * k));
    var dx = cx === undefined ? 0 : cx - cv.clientWidth / 2, dy = cy === undefined ? 0 : cy - cv.clientHeight / 2;
    sb.cam = { x: v.x + dx / v.s - dx / s, y: v.y - dy / v.s + dy / s, s: s };
  }
  function sbActual() {
    var v = sbView();
    if (v) sb.cam = { x: v.x, y: v.y, s: 1 };
  }
  function sbCenter() { sb.cam = null; }
  function sbSpeedTxt(n) { return String(Math.round(n * 100) / 100).replace('.', ',') + '×'; }
  function sbSetSpeed(n) {
    sb.speed = Math.min(2, Math.max(0.1, Math.round(n * 100) / 100));
    if (sb.player && sb.player.player) sb.player.player.speed = sb.speed;
    $('sb-speed').value = String(sb.speed);
    $('sb-speed-v').textContent = sbSpeedTxt(sb.speed);
  }
  function sbPlay(name) {
    var r = sb.player;
    if (!r || !r.ready) return;
    var p = r.player;
    try {
      if (!p.skeleton.data.findAnimation(name)) return;
      p.skeleton.setToSetupPose();
      var e = p.setAnimation(name, sb.loop);
      r.anim = name;
      p.speed = sb.speed;
      if (sb.playing) p.play();
      else { e.trackTime = 0; sbApply(p); p.pause(); }
    } catch (e) { return; }
    renderSbTransport();
  }
  function sbSeek(t) {
    var r = sb.player;
    if (!r || !r.ready) return;
    var p = r.player, e = p.animationState.getCurrent(0);
    if (!e) return;
    p.pause();
    sb.playing = false;
    e.trackTime = Math.max(0, t);
    p.skeleton.setToSetupPose();
    sbApply(p);
    sbTick(p);
    renderSbTransport();
  }
  function sbToggle() {
    var r = sb.player;
    if (!r || !r.ready) return;
    var p = r.player, e = p.animationState.getCurrent(0);
    if (!p.paused) { p.pause(); sb.playing = false; }
    else if (e && e.animation && !sb.loop && e.trackTime >= e.animation.duration - 0.0001) { sb.playing = true; sbPlay(sb.anim); return; }
    else { sb.playing = true; p.play(); }
    renderSbTransport();
  }
  function sbTick(p) {
    if (!sb.player || sb.player.player !== p || !sb.player.ready) return;
    var e = p.animationState.getCurrent(0);
    if (!e || !e.animation) return;
    var d = e.animation.duration || 0;
    var t = d ? (sb.loop ? e.trackTime % d : Math.min(e.trackTime, d)) : 0;
    if (!sb.loop && !p.paused && d && e.trackTime >= d) { p.pause(); sb.playing = false; t = d; renderSbTransport(); }
    if (Math.abs(t - sb.t) < 0.0005 && sb.d === d) return;
    sb.t = t;
    sb.d = d;
    if (!sb.scrub) $('sb-scrub').value = String(d ? Math.round(t / d * 1000) : 0);
    $('sb-time').textContent = sbFmt(t) + ' / ' + sbFmt(d) + ' с';
  }
  function sbMount() {
    var c = sbCur(), sp = sbSpine();
    if (!c) { sbDispose(); return; }
    if (sb.camFor !== c.id) { sb.cam = null; sb.camFor = c.id; }
    if (!sp) { sbMsg('Не вдалося зібрати спайн.'); return; }
    var anims = Object.keys(sp.json.animations);
    if (!anims.length) { sbMsg('У компонента немає анімацій: додайте рядок в «Анімаціях».'); return; }
    if (anims.indexOf(sb.anim) === -1) sb.anim = ['idle', 'loop_1', 'win', 'in'].filter(function (n) { return anims.indexOf(n) !== -1; })[0] || anims[0];
    var skins = sp.json.skins.map(function (s) { return s.name; });
    if (skins.indexOf(sb.skin) === -1) sb.skin = skins.indexOf('default') !== -1 ? 'default' : skins[0];
    var key = sbKey(c, sp);
    var rec = sb.player;
    if (rec && rec.key === key) { if (rec.ready && rec.anim !== sb.anim) sbPlay(sb.anim); return; }
    if (state.lib.spine !== 'ok') { sbMsg(state.lib.spine === 'fail' ? 'Рантайм Spine не завантажився з cdn.jsdelivr.net.' : 'Завантажую рантайм Spine…'); return; }
    sbDispose();
    var b = previewBundle(sp);
    var raw = {};
    raw[b.name + '.json'] = 'data:application/json;base64,' + b64(b.jsonText);
    raw[b.name + '.atlas'] = 'data:text/plain;base64,' + b64(b.atlasText);
    raw[b.pageName] = pageCanvas(b.page).toDataURL('image/png');
    var div = el('div', { class: 'pc' });
    $('sb-stage').appendChild(div);
    var cfg = {
      jsonUrl: b.name + '.json',
      atlasUrl: b.name + '.atlas',
      rawDataURIs: raw,
      animation: sb.anim,
      skin: sb.skin,
      showControls: false,
      showLoading: false,
      alpha: true,
      backgroundColor: '00000000',
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      defaultMix: 0,
      viewport: { padLeft: '8%', padRight: '8%', padTop: '8%', padBottom: '8%', transitionTime: 0 },
      debug: { bones: sb.bones, regions: false, meshes: false, bounds: false, paths: false, clipping: false, points: false, hulls: false },
      frame: function (p) { sbCam(p); sbTick(p); },
      success: function (p) {
        var r = sb.player;
        if (!r || r.player !== p) return;
        r.fit = sbFit(p);
        r.ready = true;
        sbPlay(sb.anim);
      },
      error: function (p, msg) { if (sb.player && sb.player.player === p) sbMsg('Превʼю не запустилося: ' + msg); }
    };
    try { sb.player = { player: new window.spine.SpinePlayer(div, cfg), key: key, ready: false, anim: null }; }
    catch (e) { sbMsg('Превʼю не запустилося: ' + e.message); }
    renderSbTransport();
  }
  async function sbWait() {
    for (var i = 0; i < 80; i++) {
      if (sb.player && sb.player.ready) return true;
      if (state.lib.spine === 'fail') return false;
      await new Promise(function (r) { setTimeout(r, 100); });
    }
    return false;
  }
  function frame2() { return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(function () { r(); }); }); }); }

  function sbStart() {
    var tpls = el('div', { class: 'sb-tpls' }, SB_TPL.map(function (k) {
      var t = TEMPLATES[k];
      return el('button', { type: 'button', class: 'sb-tpl', onclick: function () { sbFromTemplate(k); } }, [
        el('span', { class: 'add-pic' }, [el('img', { alt: '', src: thumb(drawCustom({ name: t.name }, 160, k === 'character' ? 240 : 160)) })]),
        el('span', { text: t.label }),
        el('small', { text: t.name })
      ]);
    }));
    var more = el('div', { class: 'row', style: 'justify-content: center;' }, [sbFromProjectBtn('З чернеток'), sbFileBtn()]);
    return el('div', { class: 'sb-start' }, [
      el('h3', { text: 'Пісочниця порожня' }),
      el('p', { text: 'Ваш особистий верстак: його бачите лише ви і ваш Claude, він той самий у всіх проектах і не йде в чернетки чи експорт. Почніть із шаблону, відкрийте компонент з бібліотеки або попросіть Claude.' }),
      tpls,
      more,
      el('p', {}, ['Наприклад: ', el('code', { text: '«Зроби в пісочниці колектор монет: in, idle, add, win»' })])
    ]);
  }
  function sbFromProjectBtn(text) {
    var list = state.s.components.filter(function (c) { return c.type === 'custom'; });
    var b = menuBtn('', text, list.map(function (c) {
      return { text: compTitle(c) + ' · ' + spineOf(c), icon: SB_BOX, run: async function () { try { await sbFromComp(c); } catch (e) { toast('Не вдалося: ' + e.message); } } };
    }));
    if (!list.length) { b.disabled = true; b.title = 'У чернетках немає своїх компонентів'; }
    return b;
  }
  function sbFileBtn() {
    var input = el('input', { type: 'file', class: 'file', accept: '.json,application/json' });
    input.addEventListener('change', async function () {
      var f = input.files && input.files[0];
      input.value = '';
      if (f) { try { await sbFromFile(f); } catch (e) { toast(e.message); } }
    });
    var b = labelBtn('З файлу', SB_FILE, { type: 'button', class: 'btn sm', title: 'Відкрити .component.json', onclick: function () { input.click(); } });
    return el('span', {}, [input, b]);
  }
  function sbNewItems() {
    var out = SB_TPL.map(function (k) { return { text: 'Новий: ' + TEMPLATES[k].label, icon: SB_PLUS, run: function () { sbFromTemplate(k); } }; });
    state.s.components.filter(function (c) { return c.type === 'custom'; }).forEach(function (c) {
      out.push({ text: 'Копія з чернеток: ' + compTitle(c), icon: SB_BOX, run: async function () { try { await sbFromComp(c); } catch (e) { toast('Не вдалося: ' + e.message); } } });
    });
    out.push({ text: 'З файлу .component.json', icon: SB_FILE, run: function () { var i = $('sb-file'); if (i) i.click(); } });
    return out;
  }

  function renderSbItems() {
    var box = $('sb-items');
    if (!box || !state.s) return;
    var cur = sbCur();
    box.textContent = '';
    sbList().forEach(function (c) {
      box.appendChild(el('button', { type: 'button', class: 'sb-item', 'aria-pressed': String(!!cur && c.id === cur.id), title: spineOf(c) + (c.lib ? ' · у бібліотеці' : ''), onclick: function () { sbSel(c.id); } }, [
        el('img', { alt: '', src: thumb(art('c:' + c.id)) }),
        el('span', { text: c.label || spineOf(c) })
      ]));
    });
    if (sbList().length) box.appendChild(menuBtn('', '+ Новий', sbNewItems()));
  }
  function renderSbAnims() {
    var box = $('sb-anims');
    box.textContent = '';
    var sp = sbCur() ? sbSpine() : null;
    if (!sp) return;
    Object.keys(sp.json.animations).forEach(function (n) {
      box.appendChild(el('button', { type: 'button', class: 'chip', 'aria-pressed': String(n === sb.anim), title: sbFmt(K.durationOf(sp.json.animations[n])) + ' с', text: n, onclick: function () { sb.anim = n; sb.playing = true; sbPlay(n); renderSbAnims(); } }));
    });
  }
  function renderSbTransport() {
    var r = sb.player, ready = !!(r && r.ready);
    var playing = ready && !r.player.paused;
    var b = $('sb-play');
    b.innerHTML = playing ? SB_PAUSE : SB_PLAY;
    b.setAttribute('aria-label', playing ? 'Пауза' : 'Грати');
    b.disabled = !ready;
    $('sb-scrub').disabled = !ready;
    $('sb-time').textContent = sbFmt(sb.t) + ' / ' + sbFmt(sb.d) + ' с';
    $('sb-speed').value = String(sb.speed);
    $('sb-speed-v').textContent = sbSpeedTxt(sb.speed);
    ['sb-zoom-out', 'sb-zoom-v', 'sb-zoom-in', 'sb-center'].forEach(function (id) { $(id).disabled = !ready; });
    $('sb-loop').checked = sb.loop;
    $('sb-bones').checked = sb.bones;
    var sp = sbCur() ? sbSpine() : null, skins = sp ? sp.json.skins.map(function (s) { return s.name; }) : [];
    var sel = $('sb-skin');
    var now = Array.prototype.map.call(sel.options, function (o) { return o.value; });
    if (now.join('|') !== skins.join('|')) { sel.textContent = ''; skins.forEach(function (n) { sel.appendChild(el('option', { value: n, text: n })); }); }
    if (sb.skin && skins.indexOf(sb.skin) !== -1) sel.value = sb.skin;
    sel.hidden = skins.length < 2;
  }
  function renderSbActs() {
    var box = $('sb-acts');
    box.textContent = '';
    var c = sbCur();
    if (!c) return;
    var meta = c.lib ? (Lib.cached() || []).filter(function (m) { return m.id === c.lib; })[0] : null;
    var mine = !!meta && Lib.canEdit(meta);
    var busy = !!sb.libBusy;
    box.appendChild(labelBtn(mine ? 'Оновити в бібліотеці' : 'Зберегти в бібліотеку', ICONS.upload, { type: 'button', class: 'btn primary sm', disabled: busy || null, onclick: async function () { try { await sbSave(c, {}); } catch (e) { return; } } }));
    if (mine) box.appendChild(el('button', { type: 'button', class: 'btn ghost sm', text: 'Як новий', disabled: busy || null, onclick: async function () { try { await sbSave(c, { asNew: true }); } catch (e) { return; } } }));
    var cur = state.projects.filter(function (p) { return p.id === state.pid; })[0];
    var targets = [{ text: 'Цей проект: ' + ((cur && cur.name) || state.s.game || 'без назви'), icon: SB_BOX, run: async function () { try { await sbToProject(c, { show: true }); } catch (e) { toast('Не вдалося: ' + e.message); } } }];
    state.projects.filter(function (p) { return p.id !== state.pid; }).forEach(function (p) {
      targets.push({ text: p.name + ' · ' + p.reels + '×' + p.rows, icon: SB_BOX, run: async function () { try { await sbToProject(c, { pid: p.id, show: true }); } catch (e) { toast('Не вдалося: ' + e.message); } } });
    });
    box.appendChild(menuBtn('', 'Додати в проект', targets));
    box.appendChild(menuBtn('ghost', 'Експорт', [
      { text: 'Spine (.zip): json, atlas, png', icon: ICONS.download, run: function () { sbSpineExport(c); } },
      { text: 'Компонент (.component.json)', icon: ICONS.download, run: function () { sbExport(c); } }
    ]));
    box.appendChild(el('span', { class: 'sb-gap' }));
    if (sb.libBusy) box.appendChild(el('span', { class: 'note', text: sb.libBusy }));
    else if (meta) box.appendChild(el('span', { class: 'note', text: mine ? 'Є в бібліотеці' : 'З бібліотеки · ' + ((meta.by && (meta.by.name || meta.by.email)) || '') }));
    if (sb.confirm === c.id) box.appendChild(el('button', { type: 'button', class: 'btn sm sb-del', text: 'Точно прибрати?', onclick: function () { sbRemoveClick(c); } }));
    else box.appendChild(iconBtn('ghost sb-rm', 'Прибрати з пісочниці', ICONS.trash, function () { sbRemoveClick(c); }));
  }
  function renderSbStage() {
    var stage = $('sb-stage');
    if (!stage || !state.s) return;
    var c = sbCur();
    sbBuild();
    $('sb-play-row').hidden = !c;
    $('sb-opts').hidden = !c;
    $('sb-zoom').hidden = !c;
    if (!c) { sbDispose(); stage.appendChild(sb.ready ? sbStart() : el('div', { class: 'stage-msg', text: sb.loadErr ? 'Пісочниця недоступна: ' + sb.loadErr : 'Завантажую пісочницю…' })); }
    else {
      var start = stage.querySelector('.sb-start');
      if (start) start.remove();
      sbMount();
    }
    renderSbAnims();
    renderSbTransport();
    renderSbActs();
  }
  function sbBody(c) {
    var key = 'c:' + c.id;
    return el('div', { class: 'comp-body' }, [
      el('div', { class: 'row' }, [
        textField('Назва', c.label, null, function (v) { c.label = v.trim() || TEMPLATES.custom.label; changed(); renderSbItems(); }),
        textField('Назва спайна', c.name, 'w-name', function (v) { c.name = v; changed(); })
      ]),
      el('div', { class: 'row' }, [
        listField('Скіни', c.skins, function (v) { c.skins = v; changed(); }, null, 'skins'),
        listField('Спейсери', c.spacers, function (v) { c.spacers = v; changed(); }, 'txt_amount', 'spacers')
      ]),
      imageRow(key, null, function (natural) { fitSize(c, natural); }),
      el('div', { class: 'row' }, [
        numPair('Розмір у грі, px', c.w, c.h, function (v) { c.w = Number(v); changed(); }, function (v) { c.h = Number(v); changed(); }, ['Ширина', 'Висота'], 'custom'),
        pivotField(c, 'Опорна точка компонента', true),
        textField('Прогрес-бар', c.bar, null, function (v) { c.bar = v.trim(); changed(); }, 'x:y:ширина:висота', 'bar')
      ]),
      el('div', { class: 'sub' }, ['Частини', infoBtn('parts')]),
      partTiles(c),
      partEditor(c),
      el('div', { class: 'sub', text: 'Анімації' }),
      animTable(c.anims, c)
    ]);
  }
  function renderSbEdit() {
    var box = $('sb-edit');
    if (!box || !state.s) return;
    var c = sbCur();
    var ae = document.activeElement;
    var inside = ae && box.contains(ae);
    var active = inside && ae.getAttribute('aria-label');
    var caret = inside && typeof ae.selectionStart === 'number' ? [ae.selectionStart, ae.selectionEnd] : null;
    box.textContent = '';
    if (!c) { box.appendChild(el('p', { class: 'note', text: 'Тут будуть налаштування компонента: картинка, частини, анімації з ключами.' })); return; }
    box.appendChild(sbBody(c));
    if (active) {
      var again = box.querySelector('[aria-label="' + active.replace(/"/g, '\\"') + '"]');
      if (again) again.focus({ preventScroll: true });
      if (again && caret && typeof again.setSelectionRange === 'function') { try { again.setSelectionRange(caret[0], caret[1]); } catch (e) { caret = null; } }
    }
  }

  function libWho(m) { return m && m.by ? m.by.name || m.by.email || '' : ''; }
  function libDay(t) {
    if (!t) return '';
    var d = new Date(t), p = function (v) { return String(v).padStart(2, '0'); };
    return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + String(d.getFullYear()).slice(2);
  }
  function libHit(m, q) {
    var words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    var hay = [m.label, m.name, m.note, (m.tags || []).join(' '), libWho(m), m.by && m.by.email].join(' ').toLowerCase();
    return words.every(function (w) { return hay.indexOf(w) !== -1; });
  }
  async function sbLibLoad() {
    if (sb.libLoading) return;
    sb.libLoading = true;
    try { await Lib.list(); sb.libErr = ''; } catch (e) { sb.libErr = e.message; }
    sb.libLoading = false;
    renderSbLib();
    renderSbActs();
  }
  function libTile(m) {
    var c = sbCur();
    var url = Lib.thumbUrl(m);
    var label = m.label || m.name;
    var items = [
      { text: 'Відкрити в пісочниці', icon: SB_PLUS, run: function () { sbOpenLib(m.id); } },
      { text: 'Додати в «Чернетки»', icon: SB_BOX, run: async function () { try { var nc = await libToProject(m.id, {}); toast('Додано в «Чернетки»: ' + spineOf(nc)); } catch (e) { toast('Не вдалося: ' + e.message); } } },
      { text: 'Експорт .component.json', icon: ICONS.download, run: function () { libExport(m); } }
    ];
    if (Lib.canEdit(m)) items.push({ text: 'Видалити з бібліотеки', icon: ICONS.trash, cls: 'm-del', run: function () { sb.libDel = m.id; renderSbLib(); } });
    var more = iconBtn('ghost lib-more', 'Дії: ' + label, SB_MORE, function (e) { if (mn.btn === more) menuClose(false); else menuOpen(more, items, e.detail === 0); });
    more.setAttribute('aria-haspopup', 'menu');
    var meta = [m.anims.length + ' анім.', m.parts.length ? m.parts.length + ' част.' : '', libWho(m), libDay(m.updated)].filter(Boolean).join(' · ');
    var foot = sb.libDel === m.id
      ? el('div', { class: 'p-confirm' }, [
        el('span', { class: 'p-confirm-q', text: 'Видалити «' + label + '» для всіх?' }),
        el('button', { type: 'button', class: 'btn sm p-yes', text: 'Так', onclick: async function () { sb.libDel = null; try { await Lib.remove(m.id); toast('Видалено з бібліотеки'); } catch (e) { toast('Не вдалося: ' + e.message); renderSbLib(); } } }),
        el('button', { type: 'button', class: 'btn ghost sm', text: 'Ні', onclick: function () { sb.libDel = null; renderSbLib(); } })
      ])
      : null;
    return el('article', { class: 'lib-tile' + (c && c.lib === m.id ? ' on' : ''), title: m.note || '' }, [
      el('button', { type: 'button', class: 'lib-open', 'aria-label': 'Відкрити в пісочниці: ' + label, onclick: function () { sbOpenLib(m.id); } }, [
        el('span', { class: 'lib-pic' }, [url ? el('img', { alt: '', src: url, loading: 'lazy' }) : el('span', { text: label.slice(0, 2).toUpperCase() })]),
        el('b', { text: label }),
        el('code', { text: m.name }),
        el('small', { text: meta })
      ]),
      more,
      foot
    ]);
  }
  function renderSbLib() {
    var box = $('sb-lib');
    if (!box) return;
    var items = Lib.cached();
    if (items === null && !sb.libLoading && !sb.libErr) sbLibLoad();
    var q = $('sb-lib-q');
    if (!q) {
      q = el('input', { type: 'text', id: 'sb-lib-q', placeholder: 'Пошук: назва, тип, автор', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Пошук у бібліотеці', oninput: function (e) { sb.q = e.target.value; renderSbLib(); } });
      box.appendChild(q);
      box.appendChild(el('p', { class: 'note', id: 'sb-lib-note' }));
      box.appendChild(el('div', { class: 'lib-grid', id: 'sb-lib-grid' }));
    }
    var list = (items || []).filter(function (m) { return libHit(m, sb.q); });
    $('sb-lib-n').textContent = items ? String(items.length) : '';
    var note = $('sb-lib-note');
    note.textContent = sb.libErr ? 'Бібліотека недоступна: ' + sb.libErr
      : items === null ? 'Завантажую…'
        : !items.length ? 'Поки порожньо. «Зберегти в бібліотеку» під превʼю додасть сюди компонент' + (Lib.mode() === 'server' ? ' для всієї команди.' : ' (у цьому браузері).')
          : !list.length ? 'Нічого не знайдено.'
            : Lib.mode() === 'server' ? 'Спільна для всієї команди. Клік відкриває копію в пісочниці.' : 'Зберігається в цьому браузері. Клік відкриває копію в пісочниці.';
    var grid = $('sb-lib-grid');
    grid.textContent = '';
    list.forEach(function (m) { grid.appendChild(libTile(m)); });
  }
  function renderSandbox() {
    if (!state.s || $('view-sandbox').hidden) return;
    renderSbItems();
    renderSbStage();
    renderSbEdit();
    renderSbLib();
  }
  function sbSel(id, anim) {
    if (id && id !== sb.cur) { sb.cur = id; sb.anim = null; sb.skin = null; sb.confirm = null; }
    if (anim) sb.anim = anim;
    sb.playing = true;
    renderSandbox();
  }
  function sbShow(id, anim) {
    if (id && id !== sb.cur) { sb.cur = id; sb.skin = null; sb.anim = null; sb.confirm = null; }
    if (anim) sb.anim = anim;
    sb.playing = true;
    if (state.view !== 'sandbox') showView('sandbox');
    else renderSandbox();
  }

  function sbCarry(c) {
    var d = clone(c);
    ['id', 'on', 'lib', 'libV'].forEach(function (k) { delete d[k]; });
    var keys = compImageKeys(c), images = {};
    Object.keys(keys).forEach(function (role) {
      var k = keys[role];
      var st = imgs(k);
      if (st.blobs[k]) images[role] = { name: (st.images[k] && st.images[k].fileName) || '', blob: st.blobs[k] };
    });
    return { kit: COMP_KIT, component: d, images: images };
  }
  function sbFromTemplate(k) {
    var t = TEMPLATES[k] || TEMPLATES.custom;
    var taken = sbList().map(spineOf), name = t.name, n = 2;
    while (taken.indexOf(name) !== -1) name = t.name + '_' + n++;
    var c = fromTemplate(t, name);
    c.id = sbNewId();
    delete c.on;
    sbItems().push(c);
    sb.cur = c.id;
    sb.anim = null;
    sb.skin = null;
    sb.playing = true;
    changed({ render: true, now: true });
    return c;
  }
  async function sbFromComp(src) {
    var c = await importComponent(sbCarry(src), { sandbox: true });
    toast('У пісочниці копія: ' + compTitle(c));
    return c;
  }
  async function sbFromFile(f) {
    var data;
    try { data = JSON.parse(await f.text()); } catch (e) { throw new Error('Це не JSON: ' + f.name); }
    var c = await importComponent(data, { sandbox: true });
    toast('Відкрито в пісочниці: ' + compTitle(c));
    return c;
  }
  async function sbFromLib(id) {
    var got = await Lib.get(id);
    if (!got) throw new Error('Немає компонента ' + id + ' у бібліотеці');
    var c = await importComponent({ kit: COMP_KIT, component: got.component, images: got.images }, { sandbox: true });
    c.lib = got.meta.id;
    c.libV = got.meta.updated;
    changed({ render: true, now: true });
    return c;
  }
  async function sbOpenLib(id) {
    var have = sbList().filter(function (c) { return c.lib === id; });
    var m = (Lib.cached() || []).filter(function (x) { return x.id === id; })[0];
    var same = have.filter(function (c) { return m && c.libV === m.updated; })[0];
    if (same) { sbSel(same.id); return; }
    try { var c = await sbFromLib(id); toast('Відкрито в пісочниці: ' + compTitle(c)); } catch (e) { toast('Не вдалося відкрити: ' + e.message); }
  }
  async function libToProject(id, opts) {
    var got = await Lib.get(id);
    if (!got) throw new Error('Немає компонента ' + id + ' у бібліотеці');
    return importComponent({ kit: COMP_KIT, component: got.component, images: got.images }, { name: opts && opts.name });
  }
  async function libExport(m) {
    try {
      var got = await Lib.get(m.id);
      if (!got) throw new Error('немає в бібліотеці');
      var images = {}, roles = Object.keys(got.images);
      for (var i = 0; i < roles.length; i++) images[roles[i]] = { name: got.images[roles[i]].name || '', data: await readAsDataUrl(got.images[roles[i]].blob) };
      var text = JSON.stringify({ kit: COMP_KIT, component: got.component, images: images }, null, 1);
      await saveFile((m.name || 'component') + '.component.json', new Blob([text], { type: 'application/json' }));
    } catch (e) { toast('Не вдалося зберегти: ' + e.message); }
  }
  async function sbSpineExport(c) {
    if (!window.JSZip) { toast(state.lib.zip === 'fail' ? 'JSZip не завантажився з cdnjs.cloudflare.com' : 'Ще завантажую JSZip, спробуйте за мить'); return; }
    var plan;
    try { plan = K.planAll(Object.assign({}, state.s, { components: [c] }), px); } catch (e) { toast('Не вдалося зібрати: ' + e.message); return; }
    var sp = plan.spines[0];
    if (!sp) { toast('Немає що експортувати'); return; }
    try {
      var zip = new window.JSZip();
      var root = sp.name + '-spine/';
      var folder = String(plan.tech.folder || '').replace(/^\/+/, '').replace(/\/?$/, '/');
      if (folder === '/') folder = '';
      zip.file(root + folder + sp.name + '.json', sp.jsonText);
      zip.file(root + folder + sp.name + '.atlas', sp.atlasText);
      zip.file(root + folder + sp.pageName, await canvasBlob(pageCanvas(sp.page)));
      var ed = root + 'spine-editor/' + sp.name + '/';
      zip.file(ed + sp.name + '.json', sp.importJsonText);
      for (var j = 0; j < sp.regions.length; j++) {
        var r = sp.regions[j];
        zip.file(ed + 'images/' + r.name + '.png', await canvasBlob(regionCanvas(r.src, r.w, r.h)));
      }
      if (sp.warnings && sp.warnings.length) zip.file(root + 'WARNINGS.txt', sp.warnings.join('\n'));
      await saveFile(sp.name + '-spine.zip', await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }));
    } catch (e) { toast('Архів не зібрався: ' + ((e && e.message) || e)); }
  }
  async function sbExport(c) {
    try {
      var r = await exportComponent(c);
      await saveFile(r.name, new Blob([r.text], { type: 'application/json' }));
    } catch (e) { toast('Не вдалося зберегти: ' + ((e && e.message) || e)); }
  }
  async function sbThumb(c) {
    var sp = sbPlanOf(c);
    var pose = sp && setupPose(sp);
    if (!pose || !pose.box) return null;
    var bw = Math.max(1, pose.box.r - pose.box.l), bh = Math.max(1, pose.box.b - pose.box.t);
    var S = 256, k = Math.min(S * 0.88 / bw, S * 0.88 / bh);
    var cv = el('canvas', { width: S, height: S });
    var x = cv.getContext('2d');
    x.setTransform(k, 0, 0, k, S / 2 - (pose.box.l + bw / 2) * k, S / 2 - (pose.box.t + bh / 2) * k);
    drawSetup(x, pose);
    return canvasBlob(cv);
  }
  async function sbSave(c, opts) {
    opts = opts || {};
    if (sb.libBusy) throw new Error('Бібліотека ще зберігає попереднє');
    sb.libBusy = 'Зберігаю…';
    renderSbActs();
    try {
      var meta = null;
      if (c.lib && !opts.asNew) {
        meta = (Lib.cached() || []).filter(function (m) { return m.id === c.lib; })[0] || null;
        if (!meta) { try { var got = await Lib.get(c.lib); meta = got && got.meta; } catch (e) { meta = null; } }
      }
      var id = meta && Lib.canEdit(meta) ? meta.id : null;
      var data = sbCarry(c);
      var out = await Lib.save({
        id: id,
        label: String(opts.label || c.label || compTitle(c)).trim(),
        name: spineOf(c),
        note: opts.note !== undefined ? opts.note : meta ? meta.note : '',
        tags: Array.isArray(opts.tags) ? opts.tags : meta ? meta.tags : [],
        component: data.component,
        images: data.images,
        thumb: await sbThumb(c)
      });
      if (opts.label) c.label = String(opts.label).trim();
      c.lib = out.id;
      c.libV = out.updated;
      changed();
      toast(id ? 'Оновлено в бібліотеці' : 'Збережено в бібліотеку');
      return { item: out, updated: !!id };
    } catch (e) {
      toast('Бібліотека: ' + e.message);
      throw e;
    } finally {
      sb.libBusy = '';
      if (sbShown()) { renderSbActs(); renderSbLib(); }
    }
  }
  async function sbToProject(c, opts) {
    opts = opts || {};
    var data = sbCarry(c);
    if (opts.pid && opts.pid !== state.pid && !await openProject(opts.pid)) throw new Error('Проект не відкрито');
    var nc = await importComponent(data, { name: opts.name });
    if (opts.show) { showView('drafts'); toast('Додано в «Чернетки»: ' + spineOf(nc)); }
    return nc;
  }
  function sbRemove(c) {
    sb.items = sb.items.filter(function (x) { return x !== c; });
    forgetComponentImages(c);
    if (sb.cur === c.id) { sb.cur = null; sb.anim = null; sb.skin = null; }
    sb.confirm = null;
    changed({ render: true, images: true, now: true });
  }
  function sbRemoveClick(c) {
    clearTimeout(sb.conTimer);
    if (sb.confirm === c.id) { sbRemove(c); return; }
    sb.confirm = c.id;
    renderSbActs();
    sb.conTimer = setTimeout(function () { if (sb.confirm === c.id) { sb.confirm = null; if (sbShown()) renderSbActs(); } }, 3500);
  }

  function sbTimes(at, d) {
    var list = Array.isArray(at) ? at : at !== undefined && at !== null && at !== '' ? [at] : null;
    var out = list ? list.map(Number).filter(function (t) { return isFinite(t) && t >= 0; }).slice(0, 12) : d > 0 ? [0, 0.25, 0.5, 0.75, 1].map(function (f) { return K.roundTo(f * d, 3); }) : [0];
    out = out.map(function (t) { return Math.min(t, d); }).filter(function (t, i, a) { return a.indexOf(t) === i; });
    return out.length ? out : [0];
  }
  function sbCell(x, bg, l, t, w, h) {
    if (bg === 'checker') {
      x.fillStyle = '#d8d8dc';
      x.fillRect(l, t, w, h);
      x.fillStyle = '#c4c4ca';
      for (var i = 0; i * 10 < w; i++) for (var j = 0; j * 10 < h; j++) if ((i + j) % 2) x.fillRect(l + i * 10, t + j * 10, Math.min(10, w - i * 10), Math.min(10, h - j * 10));
      return;
    }
    x.fillStyle = bg === 'light' ? '#f6f6f8' : '#1b1b1e';
    x.fillRect(l, t, w, h);
  }
  async function sbFilm(o) {
    o = o || {};
    var c = o.id ? sbItem(o.id) : sbCur();
    if (!c) throw new Error(o.id ? 'У пісочниці немає «' + o.id + '». Є: ' + (sbList().map(function (x) { return x.id + ' (' + spineOf(x) + ')'; }).join(', ') || 'нічого') : 'Пісочниця порожня: sandbox_new');
    if (c.id !== sb.cur) { sb.cur = c.id; sb.anim = null; sb.skin = null; }
    var sp0 = sbPlanOf(c);
    if (!sp0) throw new Error('Спайн не зібрався');
    var all = Object.keys(sp0.json.animations);
    var names = Array.isArray(o.animations) && o.animations.length ? o.animations.filter(function (n, i, l) { return l.indexOf(n) === i; }) : !o.animation || o.animation === 'all' ? all : [o.animation];
    names.forEach(function (n) { if (all.indexOf(n) === -1) throw new Error('У ' + spineOf(c) + ' немає анімації ' + n + '. Є: ' + all.join(', ')); });
    var skins = sp0.json.skins.map(function (s) { return s.name; });
    if (o.skin && skins.indexOf(o.skin) === -1) throw new Error('Немає скіна ' + o.skin + '. Є: ' + skins.join(', '));
    if (o.skin) sb.skin = o.skin;
    if (names.length === 1) sb.anim = names[0];
    sb.playing = true;
    if (state.view !== 'sandbox') showView('sandbox');
    else renderSandbox();
    var sp = sbSpine() || sp0;
    var info = { item: c.id, spine: spineOf(c), skin: sb.skin, animations: all.map(function (n) { return { name: n, duration: K.roundTo(K.durationOf(sp.json.animations[n]), 3) }; }), warnings: sp.warnings };
    if (!await sbWait()) return Object.assign(info, { note: 'Рантайм Spine не готовий, кадрів немає', images: [] });
    var p = sb.player.player, cv = p.canvas;
    if (!cv || !cv.width || !cv.height) return Object.assign(info, { note: 'Сцена не має розміру', images: [] });
    var bg = ['dark', 'light', 'checker'].indexOf(o.bg) !== -1 ? o.bg : 'dark';
    var rows = names.map(function (n) { var d = K.roundTo(p.skeleton.data.findAnimation(n).duration || 0, 4); return { name: n, d: d, times: sbTimes(o.at, d) }; });
    var cols = Math.max.apply(null, rows.map(function (r) { return r.times.length; }));
    var gap = 8, pad = 12, head = 24, cap = 20, maxW = 1400;
    var fw = Math.min(rows.length > 1 ? 220 : 280, Math.floor((maxW - 2 * pad - (cols - 1) * gap) / cols));
    var f = sb.player.fit, v = f ? { width: f.w * SB_PAD, height: f.h * SB_PAD } : null, crop = { x: 0, y: 0, w: cv.width, h: cv.height };
    if (v && v.width > 0 && v.height > 0) {
      var z = Math.max(v.width / cv.width, v.height / cv.height);
      crop = { x: (cv.width - v.width / z) / 2, y: (cv.height - v.height / z) / 2, w: v.width / z, h: v.height / z };
    }
    var ar = crop.w / crop.h;
    var cw = ar >= 1 ? fw : Math.max(60, Math.round(fw * ar)), ch = ar >= 1 ? Math.max(40, Math.round(fw / ar)) : fw;
    var rowH = head + ch + cap + gap;
    var per = Math.max(1, Math.floor((2400 - 2 * pad) / rowH));
    var ink = bg === 'light' || bg === 'checker' ? '#151517' : '#f4f4f6', soft = bg === 'light' || bg === 'checker' ? 'rgba(21,21,23,0.6)' : 'rgba(244,244,246,0.6)';
    var sheets = [];
    var keepLoop = sb.loop, keepCam = sb.cam;
    sb.loop = false;
    sb.cam = null;
    try {
      for (var s0 = 0; s0 < rows.length; s0 += per) {
        var part = rows.slice(s0, s0 + per);
        var W = 2 * pad + cols * cw + (cols - 1) * gap, H = 2 * pad + part.length * rowH - gap;
        var sheet = el('canvas', { width: W, height: H });
        var x = sheet.getContext('2d');
        x.fillStyle = bg === 'dark' ? '#111113' : '#ffffff';
        x.fillRect(0, 0, W, H);
        for (var r = 0; r < part.length; r++) {
          var row = part[r], top = pad + r * rowH;
          x.fillStyle = ink;
          x.font = '600 14px ' + FONT;
          x.textBaseline = 'middle';
          x.textAlign = 'left';
          x.fillText(row.name + '  ·  ' + sbFmt(row.d) + ' с', pad, top + head / 2);
          p.skeleton.setToSetupPose();
          var e = p.setAnimation(row.name, false);
          p.pause();
          for (var k = 0; k < row.times.length; k++) {
            e.trackTime = row.times[k];
            p.skeleton.setToSetupPose();
            sbApply(p);
            await frame2();
            var l = pad + k * (cw + gap), t = top + head;
            sbCell(x, bg, l, t, cw, ch);
            x.drawImage(cv, crop.x, crop.y, crop.w, crop.h, l, t, cw, ch);
            x.fillStyle = soft;
            x.font = '500 12px ' + FONT;
            x.textAlign = 'center';
            x.fillText(sbFmt(row.times[k]) + ' с', l + cw / 2, t + ch + cap / 2 + 1);
          }
        }
        sheets.push({ data: sheet.toDataURL('image/png').split(',')[1], mime: 'image/png' });
      }
    } finally {
      sb.loop = keepLoop;
      sb.cam = keepCam;
      sb.playing = true;
      sb.anim = names[0];
      if (sb.player && sb.player.ready) sbPlay(sb.anim);
      if (sbShown()) renderSbAnims();
    }
    return Object.assign(info, { shown: rows.map(function (r) { return { name: r.name, at: r.times }; }), images: sheets });
  }
  function sbInfo(c, full) {
    var o = { id: c.id, label: c.label, spine: spineOf(c), size: (Number(c.w) || 0) + 'x' + (Number(c.h) || 0), parts: (c.parts || []).map(function (p) { return p.name; }), anims: (c.anims || []).map(function (a) { return a.name + (a.keys ? ' (ключі)' : ''); }), library: c.lib || null };
    if (!full) return o;
    var sp = sbPlanOf(c);
    var keys = compImageKeys(c), images = {};
    Object.keys(keys).forEach(function (r) { var im = imgs(keys[r]).images[keys[r]]; images[r] = im ? im.fileName || true : false; });
    o.settings = clone(c);
    o.images = images;
    if (sp) o.spine_info = { skins: sp.json.skins.map(function (s) { return s.name; }), animations: Object.keys(sp.json.animations).map(function (n) { return { name: n, duration: K.roundTo(K.durationOf(sp.json.animations[n]), 3) }; }), slots: sp.json.slots.map(function (s) { return s.name; }), warnings: sp.warnings };
    return o;
  }

  function bindSandbox() {
    sbPrefs();
    $('sb-play').addEventListener('click', sbToggle);
    var sc = $('sb-scrub');
    sc.addEventListener('input', function () { sb.scrub = true; sbSeek(sb.d * Number(sc.value) / 1000); });
    sc.addEventListener('change', function () { sb.scrub = false; });
    $('sb-speed').addEventListener('input', function (e) { sbSetSpeed(Number(e.target.value) || 1); });
    $('sb-speed').addEventListener('change', sbKeep);
    $('sb-speed-v').addEventListener('click', function () { sbSetSpeed(1); sbKeep(); });
    $('sb-zoom-in').addEventListener('click', function () { sbZoom(1.25); });
    $('sb-zoom-out').addEventListener('click', function () { sbZoom(0.8); });
    $('sb-zoom-v').addEventListener('click', sbActual);
    $('sb-center').addEventListener('click', sbCenter);
    var stage = $('sb-stage'), drag = null;
    stage.addEventListener('wheel', function (e) {
      if (e.target.tagName !== 'CANVAS' || !sbView()) return;
      e.preventDefault();
      var dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      var r = e.target.getBoundingClientRect();
      sbZoom(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    stage.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || e.target.tagName !== 'CANVAS') return;
      var v = sbView();
      if (!v) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, v: v };
      stage.setPointerCapture(e.pointerId);
      stage.classList.add('drag');
    });
    stage.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      sb.cam = { x: drag.v.x - (e.clientX - drag.x) / drag.v.s, y: drag.v.y + (e.clientY - drag.y) / drag.v.s, s: drag.v.s };
    });
    var undrag = function (e) { if (drag && e.pointerId === drag.id) { drag = null; stage.classList.remove('drag'); } };
    stage.addEventListener('pointerup', undrag);
    stage.addEventListener('pointercancel', undrag);
    stage.addEventListener('dblclick', function (e) { if (e.target.tagName === 'CANVAS') sbCenter(); });
    $('sb-loop').addEventListener('change', function (e) { sb.loop = e.target.checked; sbKeep(); sb.playing = true; sbPlay(sb.anim); });
    $('sb-bones').addEventListener('change', function (e) { sb.bones = e.target.checked; if (sb.player && sb.player.player) sb.player.player.config.debug.bones = sb.bones; });
    $('sb-skin').addEventListener('change', function (e) { sb.skin = e.target.value; renderSbStage(); });
    dropdown($('sb-skin'), true);
    var file = el('input', { type: 'file', class: 'file', id: 'sb-file', accept: '.json,application/json' });
    file.addEventListener('change', async function () {
      var f = file.files && file.files[0];
      file.value = '';
      if (f) { try { await sbFromFile(f); } catch (e) { toast(e.message); } }
    });
    $('view-sandbox').appendChild(file);
    dropTarget($('sb-stage'), async function (fs) {
      var f = fs.filter(function (x) { return /\.json$/i.test(x.name); })[0];
      if (f) { try { await sbFromFile(f); } catch (e) { toast(e.message); } return; }
      var c = sbCur();
      var pics = fs.filter(function (x) { return /^image\//.test(x.type); });
      if (!c || !pics.length) return;
      if (pics.length === 1 && !sb.store.images['c:' + c.id]) addImageFile('c:' + c.id, pics[0], function (natural) { fitSize(c, natural); });
      else addPartFiles(c, pics);
    });
    $('sb-stage').addEventListener('keydown', function (e) {
      if (e.target !== $('sb-stage')) return;
      if (e.key === ' ') { e.preventDefault(); sbToggle(); }
      else if (e.key === '+' || e.key === '=') { e.preventDefault(); sbZoom(1.25); }
      else if (e.key === '-') { e.preventDefault(); sbZoom(0.8); }
      else if (e.key === '0') { e.preventDefault(); sbCenter(); }
    });
    $('sb-stage').tabIndex = 0;
    Lib.onChange(function () { if (sbShown()) { renderSbLib(); renderSbActs(); } });
    SbStore.onRemote(sbRemote);
    window.addEventListener('pagehide', function () { if (sb.ready) sbFlush(); });
  }

  function showView(v) {
    state.view = v;
    ['drafts', 'check', 'layouts', 'sandbox'].forEach(function (n) {
      $('view-' + n).hidden = n !== v || !state.pid;
      var tab = $('tab-' + n);
      if (tab) tab.setAttribute('aria-selected', String(n === v));
    });
    stopSpin();
    renderSpinBtn();
    if (v !== 'drafts') disposePlayer();
    else if (state.plan) { state.player = null; renderComponents(); renderPreview(); }
    if (v === 'layouts') renderLayouts();
    if (v === 'sandbox') { $('tab-sandbox').classList.remove('dot'); renderSandbox(); }
    else sbDispose();
  }

  function renderCheckAs() {
    var sel = $('ck-as');
    var cur = sel.value;
    sel.textContent = '';
    (state.plan ? state.plan.spines : []).forEach(function (s) { sel.appendChild(el('option', { value: s.name, text: s.name })); });
    var want = state.check.json ? state.check.json.name.replace(/\.json$/i, '') : cur;
    if (want && state.plan && state.plan.spines.some(function (s) { return s.name === want; })) sel.value = want;
    else if (cur) sel.value = cur;
  }

  async function addCheckFiles(files) {
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var n = f.name;
      if (/\.json$/i.test(n)) state.check.json = { name: n, text: await f.text() };
      else if (/\.atlas(\.txt)?$/i.test(n)) state.check.atlas = { name: n, text: await f.text() };
      else if (/\.png$/i.test(n)) { var size = K.pngSize(new Uint8Array(await f.slice(0, 32).arrayBuffer())); if (size) state.check.pngs[n] = size; }
    }
    renderCheckAs();
    runCheck();
  }

  function runCheck() {
    var ck = state.check;
    var list = $('ck-list');
    list.textContent = '';
    [ck.json && ck.json.name, ck.atlas && ck.atlas.name].concat(Object.keys(ck.pngs)).filter(Boolean).forEach(function (n) { list.appendChild(el('li', { text: n })); });
    var v = $('ck-verdict'), out = $('ck-findings');
    out.textContent = '';
    if (!ck.json) { v.textContent = ''; v.appendChild(el('span', { class: 'lbl', text: 'Додайте .json, щоб почати.' })); return; }
    var r = K.checkExport({ spineName: $('ck-as').value || ck.json.name, jsonText: ck.json.text, atlasText: ck.atlas && ck.atlas.text, pngs: ck.pngs }, { tech: state.plan.tech, spines: state.plan.spines.map(function (s) { return s.contract; }) });
    v.textContent = '';
    var pill = r.counts.error ? el('span', { class: 'pill error', text: r.counts.error + ' ' + plural(r.counts.error, 'помилка', 'помилки', 'помилок') })
      : r.counts.warning ? el('span', { class: 'pill warning', text: r.counts.warning + ' ' + plural(r.counts.warning, 'зауваження', 'зауваження', 'зауважень') })
        : el('span', { class: 'pill ok', text: 'Готово' });
    v.appendChild(el('b', { text: r.name || ck.json.name }));
    v.appendChild(pill);
    r.findings.forEach(function (f) { out.appendChild(el('li', { class: 'finding ' + f.level }, [el('b', { text: f.title }), f.detail ? el('span', { text: f.detail }) : null])); });
  }

  function bindCheck() {
    var drop = $('ck-drop');
    dropTarget(drop, addCheckFiles);
    $('ck-files').addEventListener('change', function (e) { var fs = Array.prototype.slice.call(e.target.files || []); e.target.value = ''; addCheckFiles(fs); });
    $('ck-as').addEventListener('change', runCheck);
    document.querySelectorAll('.tab').forEach(function (t) { t.addEventListener('click', function () { showView(t.getAttribute('data-view')); if (t.getAttribute('data-view') === 'check') runCheck(); }); });
  }

  function projectMeta(rec) {
    var s = rec.settings || {};
    return { id: rec.id, created: rec.created || rec.updated || 0, name: s.game || 'Без назви', reels: s.reels || 5, rows: s.rows || 3, n: (s.components || []).filter(function (c) { return c.on !== false; }).length };
  }
  function updateMeta(rec) {
    var m = projectMeta(rec);
    var i = state.projects.map(function (p) { return p.id; }).indexOf(rec.id);
    if (i === -1) state.projects.unshift(m);
    else state.projects[i] = m;
    renderProjects();
  }
  function rememberLast(id) { try { localStorage.setItem(LAST, id); } catch (e) { return; } }
  function readLast() { try { return localStorage.getItem(LAST); } catch (e) { return null; } }

  async function openProject(id) {
    if (state.pid && state.pid !== id && !await leaveOk()) return false;
    var rec = await Store.get(id);
    if (!rec) return false;
    disposePlayer();
    sbReset();
    clearTimeout(saveTimer);
    clearTimeout(hist.timer);
    state.pid = id;
    state.s = normalize(rec.settings);
    hist.list = Array.isArray(rec.history) ? rec.history : [];
    state.images = {};
    state.blobs = {};
    state.sel = null;
    state.open = { symbols: true };
    state.pv = { spine: null, anim: null, skin: null };
    state.confirmDel = null;
    lay.sel = null;
    lay.reset = false;
    var moved = sbLegacy(rec.settings);
    var keys = Object.keys(rec.images || {});
    for (var i = 0; i < keys.length; i++) {
      if (isSbKey(keys[i]) && !moved[keys[i].split(':')[1]]) continue;
      try { await setImage(keys[i], rec.images[keys[i]], rec.images[keys[i]].name); } catch (e) { /* skip a broken image */ }
    }
    if (Object.keys(moved).length) { sbSchedule(); toast('Пісочниця тепер особиста: компоненти з неї перенесено до вашої'); }
    rememberLast(id);
    showEmpty(false);
    renderGame();
    renderProjects();
    rebuild();
    renderComponents();
    histOpen(rec.history);
    if (!state.wiz) drawer(false);
    if (Sync) Sync.opened(id);
    return true;
  }

  function showEmpty(on) {
    var v = state.view || 'drafts';
    $('view-empty').hidden = !on;
    $('view-drafts').hidden = on || v !== 'drafts';
    $('view-layouts').hidden = on || v !== 'layouts';
    $('view-sandbox').hidden = on || v !== 'sandbox';
    document.querySelector('.bar-end').hidden = on;
    var tabs = document.querySelector('.bar .tabs');
    if (tabs) tabs.hidden = on;
  }

  function clearProject() {
    clearTimeout(timer);
    clearTimeout(saveTimer);
    clearTimeout(hist.timer);
    hist.list = [];
    setDirty(false);
    stopSpin();
    disposePlayer();
    sbReset();
    state.pid = null;
    state.s = null;
    state.plan = null;
    state.images = {};
    state.blobs = {};
    state.sel = null;
    state.confirmDel = null;
    rememberLast('');
    $('crumb').textContent = '';
    showEmpty(true);
    renderProjects();
    if (!state.wiz) drawer(false);
    if (Sync) Sync.closed();
  }

  async function closeProject() {
    if (!state.pid || state.wiz) return;
    if (!await leaveOk()) return;
    clearProject();
  }

  async function createProject(settings, images) {
    if (!await leaveOk()) return null;
    var now = Date.now();
    var rec = { id: newId(), created: now, updated: now, settings: settings, images: images || {} };
    await Store.put(rec);
    state.projects.unshift(projectMeta(rec));
    await openProject(rec.id);
    return rec.id;
  }

  function createExample() {
    var s = defaults();
    s.game = 'example-slot';
    return createProject(s);
  }

  async function removeProject(id, next) {
    if (id === state.pid) { clearTimeout(saveTimer); clearTimeout(hist.timer); }
    await Store.remove(id);
    Link.forget(id);
    state.projects = state.projects.filter(function (p) { return p.id !== id; });
    if (id !== state.pid) { renderProjects(); return; }
    state.pid = null;
    var target = next !== undefined ? next : state.projects.length ? state.projects[0].id : null;
    if (target && state.projects.some(function (p) { return p.id === target; })) await openProject(target);
    else clearProject();
  }

  async function duplicateProject() {
    await flush();
    var s = JSON.parse(JSON.stringify(state.s));
    s.game = (s.game || 'slot') + '-copy';
    if (await createProject(s, Object.assign({}, state.blobs))) toast('Створено копію');
  }

  async function exportProject() {
    await flush();
    var imgs = {};
    var keys = Object.keys(state.blobs);
    for (var i = 0; i < keys.length; i++) imgs[keys[i]] = await readAsDataUrl(state.blobs[keys[i]]);
    saveFile((K.slug(state.s.game) || 'slot') + '.spine-kit.json', new Blob([JSON.stringify({ kit: 'spine-draft-kit@2', settings: state.s, images: imgs })], { type: 'application/json' }));
  }

  async function importFile(f) {
    try {
      var data = JSON.parse(await f.text());
      if (data && data.kit === COMP_KIT) {
        if (!state.pid) { toast('Це компонент: спершу відкрийте проект'); return; }
        var ic = await importComponent(data);
        toast('Додано компонент ' + spineOf(ic));
        return;
      }
      var settings = normalize(data.settings || data);
      var blobs = {};
      Object.keys(data.images || {}).forEach(function (k) { try { blobs[k] = dataUrlBlob(data.images[k]); } catch (e) { /* skip */ } });
      if (await createProject(settings, blobs)) toast('Імпортовано: ' + f.name);
    } catch (e) { toast('Це не файл проекту кита'); }
  }

  function migrateLegacy() {
    var saved = null, imgs = {};
    try { saved = JSON.parse(localStorage.getItem(LEGACY) || 'null'); imgs = JSON.parse(localStorage.getItem(LEGACY + '.img') || '{}') || {}; } catch (e) { return null; }
    if (!saved) return null;
    var blobs = {};
    Object.keys(imgs).forEach(function (k) { try { blobs[k] = dataUrlBlob(imgs[k]); } catch (e) { /* skip */ } });
    var s = normalize(saved);
    if (!s.game) s.game = 'my-slot';
    return { settings: s, images: blobs };
  }

  var ICONS = {
    gear: '<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
    play: '<path d="M8 5.5v13l10.5-6.5Z" fill="currentColor"/>',
    download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14"/>',
    upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 19h14"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>'
  };
  function labelBtn(text, paths, attrs) {
    var b = el('button', attrs);
    b.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
    b.appendChild(document.createTextNode(text));
    return b;
  }
  function iconBtn(cls, label, paths, onclick, pressed) {
    var b = el('button', { type: 'button', class: 'btn icon ' + cls, title: label, 'aria-label': label, 'aria-pressed': pressed === undefined ? null : String(pressed), onclick: onclick });
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
    return b;
  }

  function openGame() {
    var d = $('game');
    drawer(false);
    if (typeof d.showModal === 'function') { if (!d.open) d.showModal(); }
    else d.setAttribute('open', '');
    $('game-close').focus({ preventScroll: true });
  }

  function renderProjects() {
    var ul = $('plist');
    ul.textContent = '';
    state.projects.forEach(function (p) {
      var active = p.id === state.pid;
      var ico = el('span', { class: 'p-ico', 'aria-hidden': 'true' });
      ico.innerHTML = Info.miniGrid(p.reels, p.rows);
      var li = el('li', { class: 'pitem' + (active ? ' active' : '') }, [
        el('button', { type: 'button', class: 'p-open', 'aria-current': active ? 'true' : null, onclick: function () { if (!active) openProject(p.id); else drawer(false); } }, [
          ico,
          el('span', { class: 'p-txt' }, [el('span', { class: 'p-name', text: p.name }), el('span', { class: 'p-meta', text: p.reels + '×' + p.rows + ' · ' + p.n + ' ' + plural(p.n, 'компонент', 'компоненти', 'компонентів') })])
        ])
      ]);
      if (active && state.confirmDel === p.id) {
        li.appendChild(el('div', { class: 'p-confirm' }, [
          el('span', { class: 'p-confirm-q', text: 'Видалити проект?' }),
          el('button', { type: 'button', class: 'btn sm p-yes', text: 'Так', onclick: function () { state.confirmDel = null; removeProject(p.id); } }),
          el('button', { type: 'button', class: 'btn ghost sm', text: 'Ні', onclick: function () { state.confirmDel = null; renderProjects(); } })
        ]));
      } else if (active) {
        li.appendChild(el('div', { class: 'p-act' }, [
          menuBtn('p-more', 'Дії з проектом', [
            { text: 'Налаштування гри', icon: ICONS.gear, cls: 'm-set', run: openGame },
            { text: 'Зробити копію', icon: ICONS.copy, cls: 'm-copy', run: duplicateProject },
            { text: 'Експорт у .json', icon: ICONS.download, run: exportProject },
            { text: 'Видалити', icon: ICONS.trash, cls: 'm-del', run: function () { state.confirmDel = p.id; renderProjects(); } }
          ])
        ]));
      }
      ul.appendChild(li);
    });
  }

  async function panel(p, open) {
    p.classList.toggle('open', open);
    if (p.tagName !== 'DIALOG') return;
    if (open) { if (!p.open) p.showModal(); return; }
    try { await Promise.all(p.getAnimations().map(function (a) { return a.finished; })); } catch (e) { return; }
    if (!p.classList.contains('open') && p.open) p.close();
  }
  function bindPanel(p) {
    p.addEventListener('cancel', function (e) { e.preventDefault(); panel(p, false); });
    p.addEventListener('close', function () { p.classList.remove('open'); });
    p.addEventListener('click', function (e) { if (e.target === p) panel(p, false); });
  }
  function drawer(open) {
    panel($('sidebar'), open);
    $('scrim').classList.toggle('open', open);
    $('menu-btn').setAttribute('aria-expanded', String(open));
  }

  var WZ = [['Назва', 'game'], ['Сітка', 'grid'], ['Клітинка', 'cell'], ['Символи', 'symbols'], ['Компоненти', 'components']];
  var CELLS = [[334, 334, 'шаблон'], [300, 300, ''], [256, 256, ''], [400, 400, ''], [300, 240, '']];
  var KINDS = ['wild', 'scatter', 'high', 'low'];

  function namesFrom(c) {
    var out = [];
    KINDS.forEach(function (k) { for (var i = 1; i <= c[k]; i++) out.push(k + '_' + i); });
    K.listOf(c.extra).map(K.slug).filter(Boolean).forEach(function (n) { if (out.indexOf(n) === -1) out.push(n); });
    return out;
  }
  function applyCounts() {
    var sc = symComp();
    var names = namesFrom(state.wiz.counts);
    var keep = sc.symbols.filter(function (s) { return state.images['sym:' + s.name] && names.indexOf(s.name) === -1; });
    sc.symbols = names.map(function (n) { return sc.symbols.filter(function (s) { return s.name === n; })[0] || { name: n }; }).concat(keep);
    changed({ render: true });
  }

  async function startWizard() {
    if (!await leaveOk()) return;
    var prev = state.pid;
    var s = defaults();
    var counts = { wild: 1, scatter: 1, high: 4, low: 5, extra: '' };
    s.components[0].symbols = namesFrom(counts).map(function (n) { return { name: n }; });
    state.wiz = { step: 0, prev: prev, counts: counts, extras: { background: false, logo: false, popup: false, infopanel: false, character: false } };
    await createProject(s);
    renderWizard();
  }

  async function cancelWizard() {
    var prev = state.wiz.prev;
    state.wiz = null;
    renderWizard();
    await removeProject(state.pid, prev);
  }

  function finishWizard() {
    if (!state.s.game.trim()) { state.wiz.step = 0; renderWizard(); toast('Дайте проекту назву'); return; }
    Object.keys(state.wiz.extras).forEach(function (k) {
      if (!state.wiz.extras[k]) return;
      state.s.components.push(fromTemplate(TEMPLATES[k]));
    });
    state.wiz = null;
    state.open = { symbols: true };
    renderWizard();
    renderGame();
    changed({ render: true, now: true });
    saveProject();
    drawer(false);
    toast('Проект створено');
  }

  function wizardBody(step) {
    var g = geo();
    var s = state.s;
    var body = el('div', { class: 'wz-body' });
    if (step === 0) {
      var input = el('input', { type: 'text', id: 'wz-name', value: s.game, placeholder: 'my-slot', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Назва гри', oninput: function (e) {
        s.game = e.target.value;
        $('g-name').value = s.game;
        $('crumb').textContent = s.game || 'Без назви';
        $('wz-next').disabled = !s.game.trim();
        changed();
      } });
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && s.game.trim()) { state.wiz.step = 1; renderWizard(); } });
      body.appendChild(input);
      body.appendChild(el('span', { class: 'lbl', text: 'Латиницею, як у репо гри' }));
    } else if (step === 1) {
      var tiles = el('div', { class: 'gtiles' });
      GRIDS.forEach(function (gr) {
        var b = el('button', { type: 'button', class: 'gtile', 'aria-pressed': String(s.reels === gr[0] && s.rows === gr[1]), onclick: function () {
          s.reels = gr[0];
          s.rows = gr[1];
          renderGame();
          changed({ render: true });
          renderWizard();
        } });
        b.innerHTML = Info.miniGrid(gr[0], gr[1]);
        b.appendChild(document.createTextNode(gr[0] + '×' + gr[1]));
        tiles.appendChild(b);
      });
      body.appendChild(tiles);
      body.appendChild(numPair('Свої: барабани × ряди', s.reels, s.rows, function (v) { if (Number(v) > 0) { s.reels = Math.min(12, Math.round(Number(v))); renderGame(); changed({ render: true }); } }, function (v) { if (Number(v) > 0) { s.rows = Math.min(12, Math.round(Number(v))); renderGame(); changed({ render: true }); } }, ['Барабани', 'Ряди']));
    } else if (step === 2) {
      var ct = el('div', { class: 'gtiles' });
      CELLS.forEach(function (c) {
        ct.appendChild(el('button', { type: 'button', class: 'gtile', 'aria-pressed': String(s.cell.w === c[0] && s.cell.h === c[1]), onclick: function () {
          s.cell = { w: c[0], h: c[1] };
          renderGame();
          changed({ render: true });
          renderWizard();
        } }, [c[0] + '×' + c[1], c[2] ? el('small', { text: c[2] }) : null]));
      });
      body.appendChild(ct);
      body.appendChild(numPair('Свій розмір, px', s.cell.w, s.cell.h, function (v) { if (Number(v) >= 16) { s.cell.w = Math.round(Number(v)); renderGame(); changed({ render: true }); } }, function (v) { if (Number(v) >= 16) { s.cell.h = Math.round(Number(v)); renderGame(); changed({ render: true }); } }, ['Ширина', 'Висота']));
      var art = el('div', { class: 'wz-art' });
      art.innerHTML = Info.cellArt(g.W, g.H);
      body.appendChild(art);
    } else if (step === 3) {
      var c = state.wiz.counts;
      var st = el('div', { class: 'steppers' });
      KINDS.forEach(function (k) {
        var out = el('output', { text: String(c[k]) });
        var set = function (d) { c[k] = Math.max(0, Math.min(12, c[k] + d)); applyCounts(); renderWizard(); };
        st.appendChild(el('div', { class: 'stepper' }, [
          el('span', {}, [k[0].toUpperCase() + k.slice(1) + ' ', el('code', { text: k + '_1' })]),
          el('button', { type: 'button', class: 'btn icon sm', text: '−', 'aria-label': 'Менше ' + k, onclick: function () { set(-1); } }),
          out,
          el('button', { type: 'button', class: 'btn icon sm', text: '+', 'aria-label': 'Більше ' + k, onclick: function () { set(1); } })
        ]));
      });
      body.appendChild(st);
      body.appendChild(textField('Інші через кому', c.extra, null, function (v) { c.extra = v; applyCounts(); var box = $('wz-names'); if (box) { box.textContent = ''; symComp().symbols.forEach(function (x) { box.appendChild(el('span', { text: x.name })); }); } }, 'bonus, jackpot'));
      var names = el('div', { class: 'wz-names', id: 'wz-names' });
      symComp().symbols.forEach(function (x) { names.appendChild(el('span', { text: x.name })); });
      body.appendChild(names);
      var drop = el('div', { class: 'wz-drop' }, ['Або киньте PNG: назва файлу стане назвою символу'].concat(fileButton('Вибрати PNG', 'image/png,image/webp,image/jpeg', true, addSymbolFiles)));
      dropTarget(drop, addSymbolFiles);
      body.appendChild(drop);
    } else {
      var list = el('div', { class: 'wz-comps' });
      var row = function (kind, title, sub, checked, onChange, disabled) {
        var ic = el('span');
        ic.innerHTML = Info.icon(kind);
        list.appendChild(el('label', { class: 'wz-comp' }, [
          el('input', { type: 'checkbox', checked: checked, disabled: disabled || null, onchange: function (e) { onChange(e.target.checked); } }),
          ic,
          el('span', {}, [el('b', { text: title }), el('small', { text: sub })])
        ]));
      };
      row('symbols', 'Символи', symComp().symbols.length + ' × animation_symbol_*', true, function () {}, true);
      ['reels', 'frame_under', 'frame_above'].forEach(function (t) {
        var cc = state.s.components.filter(function (x) { return x.type === t; })[0];
        row(t, TITLES[t], compNames(cc), cc.on !== false, function (v) { cc.on = v; changed({ render: true }); });
      });
      ['background', 'logo', 'popup', 'infopanel', 'character'].forEach(function (k) {
        row(k, TEMPLATES[k].label, TEMPLATES[k].name, state.wiz.extras[k], function (v) { state.wiz.extras[k] = v; });
      });
      body.appendChild(list);
      body.appendChild(el('span', { class: 'lbl', text: 'Інші компоненти додасте пізніше кнопками «+».' }));
    }
    return body;
  }

  function renderWizard() {
    var w = $('wizard');
    var on = !!state.wiz;
    w.hidden = !on;
    $('sb-projects').hidden = on;
    w.textContent = '';
    if (!on) return;
    var step = state.wiz.step;
    var last = step === WZ.length - 1;
    w.appendChild(el('div', { class: 'wz-head' }, [el('b', { text: 'Новий проект' }), el('button', { type: 'button', class: 'btn ghost sm', text: 'Скасувати', onclick: cancelWizard })]));
    w.appendChild(el('ol', { class: 'wz-steps', 'aria-label': 'Кроки' }, WZ.map(function (x, i) {
      return el('li', { class: i < step ? 'done' : i === step ? 'cur' : null, 'aria-current': i === step ? 'step' : null, title: x[0], 'aria-label': (i + 1) + '. ' + x[0], text: String(i + 1) });
    })));
    w.appendChild(el('div', { class: 'wz-title' }, [el('h3', { text: (step + 1) + '. ' + WZ[step][0] }), infoBtn(WZ[step][1])]));
    w.appendChild(wizardBody(step));
    w.appendChild(el('div', { class: 'wz-nav' }, [
      el('button', { type: 'button', class: 'btn', text: 'Назад', disabled: step === 0, onclick: function () { state.wiz.step -= 1; renderWizard(); } }),
      el('button', { type: 'button', class: 'btn primary', id: 'wz-next', text: last ? 'Створити' : 'Далі', disabled: step === 0 && !state.s.game.trim(), onclick: function () { if (last) finishWizard(); else { state.wiz.step += 1; renderWizard(); } } })
    ]));
    if (step === 0) { var n = $('wz-name'); if (n) n.focus({ preventScroll: true }); }
  }

  function openInfo(key) {
    var r = Info.render(key, { geometry: geo(), presets: K.PRESETS, tech: Object.assign({}, K.TECH, state.s.tech) });
    if (!r) return;
    $('dlg-title').textContent = r.title;
    $('dlg-art').innerHTML = r.art || '';
    $('dlg-text').innerHTML = r.html;
    var d = $('info-dlg');
    if (typeof d.showModal === 'function') { if (!d.open) d.showModal(); }
    else d.setAttribute('open', '');
    $('dlg-close').focus({ preventScroll: true });
  }

  function bindShell() {
    dropdown($('pv-spine'), true);
    dropdown($('pv-skin'), true);
    dropdown($('ck-as'), true);
    document.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('[data-info]') : null;
      if (!b) return;
      e.preventDefault();
      openInfo(b.getAttribute('data-info'));
    });
    var d = $('info-dlg');
    var close = function () { if (typeof d.close === 'function') d.close(); else d.removeAttribute('open'); };
    $('dlg-close').addEventListener('click', close);
    d.addEventListener('click', function (e) { if (e.target === d) close(); });
    var g = $('game');
    var closeGame = function () { if (typeof g.close === 'function') g.close(); else g.removeAttribute('open'); };
    $('game-close').addEventListener('click', closeGame);
    g.addEventListener('click', function (e) { if (e.target === g) closeGame(); });
    var gd = $('grid-dlg');
    var closeGrid = function () { if (typeof gd.close === 'function') gd.close(); else gd.removeAttribute('open'); };
    $('grid-close').addEventListener('click', closeGrid);
    gd.addEventListener('click', function (e) { if (e.target === gd) closeGrid(); });
    $('new-project').addEventListener('click', startWizard);
    $('empty-new').addEventListener('click', function () { drawer(true); startWizard(); });
    $('sidebar').addEventListener('click', function (e) { if (!e.target.closest('button, label, input, a, .pitem, .wizard')) closeProject(); });
    $('import-file').addEventListener('change', function (e) { var f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) importFile(f); });
    $('menu-btn').addEventListener('click', function () { drawer(!$('sidebar').classList.contains('open')); });
    $('scrim').addEventListener('click', function () { drawer(false); });
    var sb = $('sidebar');
    var sbTimer = 0;
    var edgeTimer = 0;
    var sbHold = function () {
      var a = document.activeElement;
      return state.wiz || sb.matches(':hover') || document.querySelector('.dd-pop:not([hidden])') || (sb.contains(a) && a.matches('input:not([type="file"])'));
    };
    var sbAuto = function () {
      clearTimeout(sbTimer);
      sbTimer = setTimeout(function () { if (sb.classList.contains('open') && !sbHold()) drawer(false); }, 350);
    };
    sb.addEventListener('pointerenter', function () { clearTimeout(sbTimer); });
    sb.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') sbAuto(); });
    sb.addEventListener('focusout', sbAuto);
    document.addEventListener('pointerdown', function (e) { if (sb.classList.contains('open') && !e.target.closest('#sidebar, #menu-btn, .dd-pop, dialog')) drawer(false); });
    $('sb-edge').addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') edgeTimer = setTimeout(function () { drawer(true); }, 150); });
    $('sb-edge').addEventListener('pointerleave', function () { clearTimeout(edgeTimer); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && $('sidebar').classList.contains('open') && !$('info-dlg').open && !$('game').open && !$('grid-dlg').open && !$('add-dlg').open && !$('keys-dlg').open && !$('ex-dlg').open && !$('hist-dlg').open && !$('unsaved-dlg').open) drawer(false); });
    window.addEventListener('pagehide', function () { if (auto) { histCommit(); saveNow(); } });
  }

  async function init() {
    initDownloads();
    bindShell();
    bindGame();
    bindCheck();
    bindLayouts();
    bindHist();
    bindSandbox();
    if (Sync) await Sync.start(App);
    if (!Sync || Sync.mode() !== 'engine') await sbLoad();
    var restored = Sync ? 0 : await Link.restore(Store);
    var recs = await Store.list();
    if (!Store.persistent()) $('store-note').hidden = false;
    state.projects = recs.map(projectMeta).sort(function (a, b) { return b.created - a.created; });
    var last = Sync ? Sync.wanted(readLast()) : readLast();
    if (!recs.length) {
      var legacy = Sync ? null : migrateLegacy();
      if (legacy) await createProject(legacy.settings, legacy.images);
      else if (last === null && !Sync) await createExample();
      else showEmpty(true);
    } else if (last === '') { showEmpty(true); renderProjects(); }
    else await openProject(state.projects.some(function (p) { return p.id === last; }) ? last : state.projects[0].id);
    // if ((location.hash || '').replace('#', '') === 'check') showView('check');
    if (restored) toast('Відновлено з диска: ' + restored + ' ' + plural(restored, 'проект', 'проекти', 'проектів'));
    Link.start(App);
    loadScript(SPINE_URL).then(function () { state.lib.spine = window.spine && window.spine.SpinePlayer ? 'ok' : 'fail'; state.player = null; renderPreview(); renderSpinBtn(); if (sbShown()) renderSbStage(); }, function () { state.lib.spine = 'fail'; renderPreview(); renderSpinBtn(); if (sbShown()) renderSbStage(); });
    loadScript(ZIP_URL).then(function () { state.lib.zip = window.JSZip ? 'ok' : 'fail'; }, function () { state.lib.zip = 'fail'; });
    var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    if (mq && mq.addEventListener) mq.addEventListener('change', function () { if (state.plan) drawGrid(); });
  }

  var App = {
    K: K, state: state, A: A, defaults: defaults, newId: newId, templates: TEMPLATES, fromTemplate: fromTemplate, fitSize: fitSize,
    partKey: partKey, movePartImage: movePartImage, forgetComponentImages: forgetComponentImages, exportComponent: exportComponent, importComponent: importComponent, COMP_KIT: COMP_KIT,
    setImage: setImage, forgetImage: forgetImage, moveSymbolImages: moveSymbolImages, forgetSymbolImages: forgetSymbolImages, changed: changed, saveNow: saveNow, flush: flush, saveProject: saveProject,
    renderGame: renderGame, renderComponents: renderComponents, renderPreview: renderPreview, renderWizard: renderWizard,
    openProject: openProject, createProject: createProject, startSpin: startSpin, buildZip: buildZip, toast: toast, panel: panel,
    applyRemote: applyRemote, histParts: histParts, setProjects: setProjects, clearProject: clearProject, hist: hist, dirty: function () { return hist.dirty; },
    spinning: function () { return !!(spin.ctl && spin.ctl.running); },
    showView: showView,
    imageOf: function (k) { return imgs(k).images[k]; },
    sb: {
      st: sb, list: sbList, items: sbItems, item: sbItem, cur: sbCur, newId: sbNewId, show: sbShow, film: sbFilm, info: sbInfo, plan: sbPlanOf,
      pull: async function () { if (!await sbLoad()) throw new Error('Пісочниця недоступна: ' + sb.loadErr); },
      flush: sbFlush,
      forget: sbForget,
      fromTemplate: sbFromTemplate, fromComp: sbFromComp, fromLib: sbFromLib, fromData: function (data, opts) { return importComponent(data, Object.assign({}, opts || {}, { sandbox: true })); },
      save: sbSave, toProject: sbToProject, remove: sbRemove, render: renderSandbox
    },
    lib: { api: Lib, add: libToProject },
    lay: { st: lay, all: lays, cur: curLayout, items: layItems, boneFor: boneFor, warn: boneWarn, boneName: boneName, rename: renameBone, remove: deleteBone, render: renderLayouts, draw: drawLayout, save: scheduleSave, folder: layFolder, names: layNames }
  };

  init();
})();
