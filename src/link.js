(function (root) {
  'use strict';
  var KEY = 'spine-draft-kit.connect';
  var LOCAL = /^https?:$/.test(location.protocol) && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  var LABELS = {
    status: 'стан кита', list_projects: 'список проектів', open_project: 'відкрив проект', create_project: 'створив проект', get_project: 'читає проект',
    update_game: 'налаштування гри', set_symbols: 'символи', update_component: 'компонент', add_component: 'додав компонент', remove_component: 'прибрав компонент',
    preview: 'превʼю', screenshot: 'скріншот', spin: 'спін', export_drafts: 'експорт драфту'
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
        await Store.put({ id: p.id, created: p.created, updated: p.updated, settings: p.settings, images: images });
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
  function normAnims(list) {
    if (!Array.isArray(list)) throw new Error('anims має бути масивом');
    return list.map(function (a) {
      var name = String(a && a.name || '').trim();
      if (!name) throw new Error('анімація без назви');
      var P = K().PRESETS;
      var preset = P[a.preset] ? a.preset : K().presetFor(name, 'custom');
      var d = Number(a.duration);
      return App.A(name, isFinite(d) && d >= 0 ? d : (P[preset] && P[preset].duration) || 1, preset, !!a.loop, eventsText(a.events));
    });
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
    await App.saveNow();
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
    if (c.type === 'custom') { o.spine = spineOf(c); o.w = c.w; o.h = c.h; o.x = c.x || 0; o.y = c.y || 0; }
    if (c.skins !== undefined) o.skins = c.skins;
    if (c.spacers !== undefined) o.spacers = c.spacers;
    if (key) o.image = S().images[key] ? S().images[key].fileName || true : false;
    if (c.anims) o.anims = c.anims;
    return o;
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
  function shot(target) {
    var cv = target === 'grid' ? $('grid-canvas') : document.querySelector('#stage canvas');
    return cv && cv.width ? flat(cv) : null;
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
      if (p.id !== S().pid) await App.openProject(p.id);
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
      await App.createProject(s);
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
        images: Object.keys(st.images).map(function (k) { var im = st.images[k]; return { key: k, file: im.fileName, w: im.w, h: im.h }; }),
        spines: st.plan ? st.plan.spines.map(function (sp) { return { name: sp.name, component: sp.comp, skins: sp.json.skins.map(function (s) { return s.name; }), animations: Object.keys(sp.json.animations), warnings: sp.warnings }; }) : []
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
      if (Array.isArray(a.anims)) { if (c.type === 'reels') throw new Error('Анімації барабанів фіксовані'); c.anims = normAnims(a.anims); }
      if (typeof a.txt === 'boolean' && c.type === 'symbols') c.txt = a.txt;
      if (typeof a.blur === 'boolean' && c.type === 'symbols') c.blur = a.blur;
      if (num(a.fill) && c.type === 'symbols') c.fill = clamp(a.fill, 10, 100);
      if (c.type === 'custom') {
        if (typeof a.name === 'string' && a.name.trim()) c.name = a.name.trim();
        ['w', 'h', 'x', 'y'].forEach(function (k) { if (num(a[k])) c[k] = Number(a[k]); });
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
      var t = App.templates[a.template];
      if (!t) throw new Error('Шаблон: background, logo, popup або custom');
      var st = S();
      var taken = st.s.components.filter(function (c) { return c.type === 'custom'; }).map(spineOf);
      var base = a.name ? 'animation_' + K().slug(a.name).replace(/^animation_/, '') : t.name;
      var name = base, n = 2;
      while (taken.indexOf(name) !== -1) name = base + '_' + n++;
      var c = { id: App.newId(), type: 'custom', label: t.label, on: true, name: name, w: t.w, h: t.h, x: 0, y: 0, skins: typeof a.skins === 'string' ? a.skins : 'default', spacers: typeof a.spacers === 'string' ? a.spacers : '', anims: Array.isArray(a.anims) ? normAnims(a.anims) : t.anims() };
      st.s.components.push(c);
      if (a.image) { App.fitSize(c, await putImage('c:' + c.id, a.image)); }
      ['w', 'h', 'x', 'y'].forEach(function (k) { if (num(a[k])) c[k] = Number(a[k]); });
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
      App.forgetImage('c:' + c.id);
      await commit();
      App.toast('Claude прибрав ' + spineOf(c));
      return summary();
    },
    preview: async function (a) {
      needProject();
      var st = S();
      var spines = st.plan ? st.plan.spines : [];
      var sp = spines.filter(function (s) { return s.name === (a.spine || st.pv.spine); })[0] || (a.spine ? null : spines[0]);
      if (!sp) throw new Error('Немає спайна «' + a.spine + '». Є: ' + spines.map(function (s) { return s.name; }).join(', '));
      var anims = Object.keys(sp.json.animations), skins = sp.json.skins.map(function (s) { return s.name; });
      if (a.animation && anims.indexOf(a.animation) === -1) throw new Error('У ' + sp.name + ' немає анімації ' + a.animation + '. Є: ' + anims.join(', '));
      if (a.skin && skins.indexOf(a.skin) === -1) throw new Error('У ' + sp.name + ' немає скіна ' + a.skin + '. Є: ' + skins.join(', '));
      st.pv = { spine: sp.name, anim: a.animation || null, skin: a.skin || null };
      App.renderPreview();
      App.renderComponents();
      var ok = await waitPlayer();
      await sleep(1000 * (num(a.at) ? Math.max(0, Number(a.at)) : 0.4));
      var img = ok ? shot('preview') : null;
      return { spine: sp.name, animation: st.pv.anim, skin: st.pv.skin, animations: anims, skins: skins, note: ok ? undefined : 'Рантайм Spine не готовий, скріншота немає', images: img ? [img] : [] };
    },
    screenshot: async function (a) {
      var t = a.target || 'both';
      await frame();
      var out = [];
      if (t !== 'preview') { var g = shot('grid'); if (g) out.push(g); }
      if (t !== 'grid') { await waitPlayer(); var p = shot('preview'); if (p) out.push(p); }
      return { target: t, preview: S().pv, images: out };
    },
    spin: async function (a) {
      needProject();
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
      var g = shot('grid');
      return { done: !App.spinning(), images: g ? [g] : [] };
    },
    export_drafts: async function () {
      needProject();
      var st = S();
      var spines = st.plan ? st.plan.spines : [];
      if (!spines.length) throw new Error('Немає спайнів: увімкніть компоненти');
      for (var i = 0; i < 100 && !window.JSZip; i++) await sleep(100);
      if (!window.JSZip) throw new Error('JSZip не завантажився');
      var name = (K().slug(st.s.game) || 'slot') + '-spine-drafts.zip';
      var blob = await App.buildZip(spines);
      var r = await fetch('/api/bridge/blobs?name=' + encodeURIComponent(name), { method: 'PUT', headers: { 'content-type': 'application/zip' }, body: blob });
      if (!r.ok) throw new Error('zip не передався: ' + r.status);
      return { blob: (await r.json()).id, name: name, spines: spines.length };
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
    link.busy = null;
    renderButton();
    renderPop();
    try { await sendJson('/api/bridge/result', 'POST', out); } catch (e) { return; }
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

  root.SpineKitLink = { restore: restore, backup: backup, forget: forget, start: start, local: function () { return link.local; } };
})(typeof window !== 'undefined' ? window : globalThis);
