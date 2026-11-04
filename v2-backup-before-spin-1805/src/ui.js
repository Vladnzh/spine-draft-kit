(function () {
  'use strict';
  var K = window.SpineDraftKit;
  var Store = window.SpineKitStore;
  var Info = window.SpineKitInfo;
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
  function newId() { seq += 1; return 'c' + Date.now().toString(36) + seq; }

  function symbolAnims() { return [A('idle', 2, 'breathe', true), A('stop', 0.28, 'land'), A('win', 0.85, 'win'), A('win_idle', 0.85, 'win', true), A('win_insignificant', 0.65, 'pulse')]; }
  function frameAnims() { return [A('in', 0.5, 'fade_in'), A('loop_1', 2, 'hold', true), A('out', 0.3, 'fade_out')]; }
  var TEMPLATES = {
    background: { label: 'Фон', name: 'animation_bg', w: 1920, h: 1080, anims: function () { return [A('in', 1, 'fade_in'), A('loop_1', 4, 'hold', true), A('out', 0.3, 'fade_out')]; } },
    logo: { label: 'Логотип', name: 'animation_game_logo', w: 640, h: 280, anims: function () { return [A('in', 0.55, 'pop_in'), A('loop_1', 2, 'breathe', true), A('out', 0.3, 'pop_out')]; } },
    popup: { label: 'Попап', name: 'animation_popup', w: 900, h: 600, anims: function () { return [A('in', 0.55, 'pop_in'), A('loop_1', 1.15, 'glow', true), A('out', 0.3, 'pop_out')]; } },
    custom: { label: 'Свій', name: 'animation_element', w: 400, h: 400, anims: function () { return [A('in', 0.35, 'fade_in'), A('loop_1', 2, 'breathe', true), A('out', 0.35, 'fade_out')]; } }
  };

  function defaults() {
    return {
      kit: 2,
      game: '',
      reels: 5,
      rows: 3,
      cell: { w: 334, h: 334 },
      tech: { spineVersion: K.TECH.spineVersion, fps: K.TECH.fps, folder: K.TECH.folder },
      components: [
        { id: 'symbols', type: 'symbols', on: true, txt: true, anims: symbolAnims(), symbols: ['wild_1', 'scatter_1', 'high_1', 'high_2', 'high_3', 'high_4', 'low_1', 'low_2', 'low_3', 'low_4'].map(function (n) { return { name: n }; }) },
        { id: 'reels', type: 'reels', on: true },
        { id: 'frame_under', type: 'frame_under', on: true, skins: 'default, freespins, maingame', spacers: '', anims: frameAnims() },
        { id: 'frame_above', type: 'frame_above', on: true, skins: 'default, freespins, maingame', spacers: '', anims: frameAnims() }
      ]
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
      })
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
    confirmDel: null,
    gameOpen: false
  };

  function comp(id) { return state.s.components.filter(function (c) { return c.id === id; })[0]; }
  function symComp() { return state.s.components.filter(function (c) { return c.type === 'symbols'; })[0]; }
  function geo() { return K.geometry(state.s); }

  function toast(text) {
    var t = el('div', { class: 'toast', role: 'status', text: text });
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }

  var saveTimer = null;
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 400); }
  function saveNow() {
    clearTimeout(saveTimer);
    if (!state.pid) return Promise.resolve();
    var old = state.projects.filter(function (p) { return p.id === state.pid; })[0];
    var rec = { id: state.pid, created: old ? old.created : Date.now(), updated: Date.now(), settings: JSON.parse(JSON.stringify(state.s)), images: Object.assign({}, state.blobs) };
    updateMeta(rec);
    return Store.put(rec);
  }

  var timer = null;
  function changed(opts) {
    opts = opts || {};
    scheduleSave();
    if (opts.render) renderComponents();
    clearTimeout(timer);
    timer = setTimeout(rebuild, opts.now ? 0 : 140);
  }

  function fitPx(w, h, max) {
    var s = Math.min(1, max / Math.max(w, h));
    return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
  }

  function px(key) {
    var im = state.images[key];
    if (im) return { w: im.w, h: im.h, win: im.win || null, uploaded: true };
    var g = geo();
    if (key.indexOf('sym:') === 0) return { w: Math.round(0.86 * g.W), h: Math.round(0.86 * g.H) };
    if (key === 'frame_under') return fitPx(g.gridW + 2 * g.margin, g.gridH + 2 * g.margin, 2048);
    if (key === 'frame_above') return fitPx(g.gridW + 2 * g.border, g.gridH + 2 * g.border, 2048);
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

  var artCache = {};
  function art(key) {
    var im = state.images[key];
    if (im) return im.canvas;
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
    state.images[key] = im;
    state.blobs[key] = blob;
    return r.natural;
  }
  function forgetImage(key) { delete state.images[key]; delete state.blobs[key]; }
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
  async function addSymbolFiles(files) {
    var c = symComp();
    var added = 0;
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (!/^image\//.test(f.type)) continue;
      var name = symbolNameFromFile(f.name);
      if (!name) continue;
      if (!c.symbols.some(function (s) { return s.name === name; })) c.symbols.push({ name: name });
      try { await setImage('sym:' + name, f, f.name); added++; } catch (e) { toast('Не вдалося прочитати ' + f.name); }
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

  function infoBtn(key) { return el('button', { type: 'button', class: 'info', 'data-info': key, 'aria-label': 'Що таке: ' + Info.title(key), text: 'i' }); }

  function animTable(rows) {
    var wrap = el('div', { class: 'anims' });
    wrap.appendChild(el('div', { class: 'a-head' }, [el('span', { text: 'Анімація' }), el('span', { text: 'Сек' }), el('span', {}, ['Рух', infoBtn('motion')]), el('span', {}, ['∞', infoBtn('loop')]), el('span', {}, ['Події', infoBtn('events')]), el('span')]));
    rows.forEach(function (a, i) {
      var sel = el('select', { 'aria-label': 'Рух ' + a.name, onchange: function () { a.preset = sel.value; changed(); } });
      Object.keys(K.PRESETS).forEach(function (p) { sel.appendChild(el('option', { value: p, text: K.PRESETS[p].label })); });
      sel.value = K.PRESETS[a.preset] ? a.preset : K.presetFor(a.name, 'custom');
      wrap.appendChild(el('div', { class: 'a-row' }, [
        el('input', { type: 'text', value: a.name, spellcheck: 'false', 'aria-label': 'Назва анімації', oninput: function (e) { a.name = e.target.value.trim(); changed(); } }),
        el('input', { type: 'number', value: String(a.duration), min: '0', step: '0.01', 'aria-label': 'Тривалість, с', oninput: function (e) { a.duration = Number(e.target.value); changed(); } }),
        sel,
        el('input', { type: 'checkbox', checked: a.loop, title: 'Петля', 'aria-label': 'Петля', onchange: function (e) { a.loop = e.target.checked; changed(); } }),
        el('input', { type: 'text', class: 'ev', value: typeof a.events === 'string' ? a.events : '', placeholder: 'onEvent@0.5', spellcheck: 'false', 'aria-label': 'Події', oninput: function (e) { a.events = e.target.value; changed(); } }),
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
    var im = state.images[key];
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
        if (state.images[key]) { state.images['sym:' + n] = state.images[key]; state.blobs['sym:' + n] = state.blobs[key]; forgetImage(key); }
        s.name = n;
        state.sel = n;
        changed({ render: true, images: true });
      });
      var edit = el('div', { class: 'sym-edit' }, [
        el('img', { alt: '', src: thumb(art(key)) }),
        el('div', { class: 'grid' }, [
          el('div', { class: 'row' }, [el('div', { class: 'field' }, [el('span', { class: 'lbl', text: 'Назва' }), nameInput])]),
          el('div', { class: 'img-row' }, fileButton(state.images[key] ? 'Замінити картинку' : 'Картинка', 'image/png,image/webp,image/jpeg', false, function (fs) { addImageFile(key, fs[0]); }).concat([
            state.images[key] ? el('button', { type: 'button', class: 'btn ghost sm', text: 'Прибрати картинку', onclick: function () { dropImage(key); } }) : null,
            el('button', { type: 'button', class: 'btn ghost sm', text: 'Видалити символ', onclick: function () {
              c.symbols = c.symbols.filter(function (x) { return x !== s; });
              forgetImage(key);
              state.sel = null;
              changed({ render: true, images: true });
            } })
          ])),
          el('label', { class: 'switch' }, [el('input', { type: 'checkbox', checked: !!s.ownAnims, onchange: function (e) {
            s.ownAnims = e.target.checked;
            if (s.ownAnims && !s.anims) s.anims = JSON.parse(JSON.stringify(c.anims));
            changed({ render: true });
          } }), 'Свої анімації']),
          s.ownAnims ? animTable(s.anims) : null
        ])
      ]);
      body.appendChild(edit);
    }
    body.appendChild(el('div', { class: 'sub' }, ['Анімації символів', infoBtn('anims')]));
    body.appendChild(animTable(c.anims));
    body.appendChild(el('div', { class: 'row', style: 'align-items: center; gap: 4px;' }, [el('label', { class: 'switch' }, [el('input', { type: 'checkbox', checked: !!c.txt, onchange: function (e) { c.txt = e.target.checked; changed(); } }), 'Слот txt_amount для суми виграшу']), infoBtn('spacers')]));
    return body;
  }

  function reelsBody() {
    var g = geo();
    var cols = 'animation_reels_' + g.C + '_columns', rows = 'animation_reel_' + g.R + '_rows';
    var sp = state.plan ? state.plan.spines.filter(function (x) { return x.name === rows; })[0] : null;
    var dur = function (n) { var a = sp && sp.contract.animations.filter(function (x) { return x.name === n; })[0]; return a ? String(a.duration).replace('.', ',') + ' с' : ''; };
    return el('div', { class: 'comp-body' }, [el('dl', { class: 'facts' }, [
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
        textField('Скіни', c.skins, null, function (v) { c.skins = v; changed(); }, null, 'skins'),
        textField('Спейсери', c.spacers, null, function (v) { c.spacers = v; changed(); }, key === 'frame_above' ? 'txt_pays_left, txt_pays_right' : '', 'spacers')
      ]),
      el('div', { class: 'sub', text: 'Анімації' }),
      animTable(c.anims)
    ]);
  }

  function customBody(c) {
    var key = 'c:' + c.id;
    return el('div', { class: 'comp-body' }, [
      el('div', { class: 'row', style: 'padding-top: 10px;' }, [
        textField('Назва спайна', c.name, 'w-name', function (v) { c.name = v; changed(); }),
        textField('Скіни', c.skins, null, function (v) { c.skins = v; changed(); }, null, 'skins'),
        textField('Спейсери', c.spacers, null, function (v) { c.spacers = v; changed(); }, 'txt_amount', 'spacers')
      ]),
      imageRow(key, null, function (natural) { c.w = natural.w; c.h = natural.h; }),
      el('div', { class: 'row' }, [
        numPair('Розмір у грі, px', c.w, c.h, function (v) { c.w = Number(v); changed(); }, function (v) { c.h = Number(v); changed(); }, ['Ширина', 'Висота'], 'custom'),
        numPair('Центр X, Y', c.x || 0, c.y || 0, function (v) { c.x = Number(v); changed(); }, function (v) { c.y = Number(v); changed(); }, ['X', 'Y', ','])
      ]),
      el('div', { class: 'sub', text: 'Анімації' }),
      animTable(c.anims)
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
        el('button', { type: 'button', class: 'btn ghost sm', text: '▶', title: 'Показати в превʼю', 'aria-label': 'Показати ' + title + ' в превʼю', disabled: c.on === false || !spines.length, onclick: function () { showInPreview(c); } }),
        el('button', { type: 'button', class: 'btn ghost sm', text: '.zip', title: 'Завантажити цей компонент', disabled: c.on === false || !spines.length, onclick: function () { downloadZip(compSpines(c.id), (K.slug(state.s.game) || 'slot') + '-' + (c.type === 'custom' ? K.slug(c.name) : c.type) + '.zip'); } }),
        c.type === 'custom'
          ? el('button', { type: 'button', class: 'btn ghost icon', text: '✕', title: 'Прибрати компонент', 'aria-label': 'Прибрати ' + title, onclick: function () { state.s.components = state.s.components.filter(function (x) { return x !== c; }); forgetImage('c:' + c.id); changed({ render: true, images: true }); } })
          : el('label', { class: 'switch', title: 'Генерувати' }, [el('input', { type: 'checkbox', checked: c.on !== false, 'aria-label': 'Генерувати ' + title, onchange: function (e) { c.on = e.target.checked; changed({ render: true }); } })])
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
    var active = document.activeElement && document.activeElement.getAttribute('aria-label');
    list.textContent = '';
    state.s.components.forEach(function (c) { list.appendChild(card(c)); });
    window.scrollTo(0, y);
    if (active) {
      var again = list.querySelector('[aria-label="' + active.replace(/"/g, '\\"') + '"]');
      if (again) again.focus({ preventScroll: true });
    }
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
    if (window.matchMedia('(max-width: 980px)').matches) $('stage').scrollIntoView({ block: 'center' });
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

  function drawGrid() {
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
    if (sc && sc.on !== false && sc.symbols.length) {
      var n = sc.symbols.length;
      for (var c = 0; c < g.C; c++) {
        for (var r = 1; r <= g.R; r++) {
          var sym = sc.symbols[(c * 3 + r * 7 + c * r) % n].name;
          var a = attOf('animation_symbol_' + sym, 'symbol');
          if (a) put(art('sym:' + sym), { x: g.reelX[c], y: g.slotY[r], width: a.width, height: a.height });
        }
      }
    }
    if (on('frame_above')) put(art('frame_above'), attOf('animation_reels_frame_above', 'frame'));
    $('grid-label').textContent = g.C + ' × ' + g.R + ' · ' + g.W + ' × ' + g.H + ' px';
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

  async function downloadZip(spines, fileName) {
    if (!spines.length) return;
    if (!window.JSZip) { toast(state.lib.zip === 'fail' ? 'JSZip не завантажився з cdnjs.cloudflare.com' : 'Ще завантажую JSZip, спробуйте за мить'); return; }
    var btn = $('dl-all');
    btn.disabled = true;
    try {
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
      zip.file(root + 'README.txt', K.readme(state.s, { tech: state.plan.tech, geometry: state.plan.geometry, spines: spines }));
      zip.file(root + 'kit-settings.json', JSON.stringify(state.s, null, 1));
      var blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      await saveFile(fileName, blob);
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
    var key = sp.name + '|' + sp.jsonText.length + '|' + sp.atlasText + '|' + state.pv.skin + '|' + Object.keys(state.images).join(',') + '|' + JSON.stringify(px('sym:' + ((symComp() || {}).symbols || [{ name: '' }])[0].name));
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
    skinSel.hidden = skins.length < 2;
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
    $('dl-meta').textContent = n + ' ' + plural(n, 'спайн', 'спайни', 'спайнів') + ' · .json, .atlas, .png і файли для Spine Editor';
    $('dl-all').disabled = !n;
    var w = $('warns');
    w.textContent = '';
    p.spines.forEach(function (s) { s.warnings.forEach(function (t) { w.appendChild(el('li', { text: s.name + ': ' + t })); }); });
    $('c-count').textContent = state.s.components.filter(function (c) { return c.on !== false; }).length + ' / ' + state.s.components.length;
    state.s.components.forEach(function (c) {
      var code = document.querySelector('[data-names="' + c.id + '"]');
      if (code) code.textContent = compNames(c);
    });
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
  }

  function rebuild() {
    try { state.plan = K.planAll(state.s, px); }
    catch (e) { toast('Не вдалося зібрати: ' + e.message); return; }
    drawGrid();
    renderSide();
    renderPreview();
    renderCheckAs();
    if (state.open.reels) {
      var art_ = document.querySelector('[data-id="reels"] .comp-body');
      if (art_) art_.replaceWith(Object.assign(reelsBody(), { id: 'body-reels' }));
    }
  }

  function bindGame() {
    var num = function (id, fn) { $(id).addEventListener('input', function (e) { var v = Number(e.target.value); if (isFinite(v) && v > 0) { fn(v); renderPresets(); changed({ render: true }); } }); };
    $('g-name').addEventListener('input', function (e) { state.s.game = e.target.value; $('crumb').textContent = state.s.game || 'Без назви'; changed(); });
    num('g-reels', function (v) { state.s.reels = Math.min(12, Math.round(v)); });
    num('g-rows', function (v) { state.s.rows = Math.min(12, Math.round(v)); });
    num('g-cw', function (v) { state.s.cell.w = Math.min(2000, Math.max(16, Math.round(v))); });
    num('g-ch', function (v) { state.s.cell.h = Math.min(2000, Math.max(16, Math.round(v))); });
    $('t-ver').addEventListener('input', function (e) { state.s.tech.spineVersion = e.target.value.trim(); renderPresets(); changed(); });
    num('t-fps', function (v) { state.s.tech.fps = Math.round(v); });
    $('t-folder').addEventListener('input', function (e) { state.s.tech.folder = e.target.value.trim(); renderPresets(); changed(); });
    document.querySelectorAll('[data-add]').forEach(function (b) {
      b.addEventListener('click', function () {
        var t = TEMPLATES[b.getAttribute('data-add')];
        var names = state.s.components.map(function (c) { return c.type === 'custom' ? 'animation_' + K.slug(c.name).replace(/^animation_/, '') : ''; });
        var name = t.name, n = 2;
        while (names.indexOf(name) !== -1) name = t.name + '_' + n++;
        var c = { id: newId(), type: 'custom', label: t.label, on: true, name: name, w: t.w, h: t.h, x: 0, y: 0, skins: 'default', spacers: '', anims: t.anims() };
        state.s.components.push(c);
        state.open[c.id] = true;
        state.pv.spine = name;
        state.pv.anim = null;
        changed({ render: true, now: true });
      });
    });
    $('pv-spine').addEventListener('change', function (e) { state.pv.spine = e.target.value; state.pv.anim = null; state.pv.skin = null; renderPreview(); renderComponents(); });
    $('pv-skin').addEventListener('change', function (e) { state.pv.skin = e.target.value; renderPreview(); });
    $('dl-all').addEventListener('click', function () { downloadZip(state.plan.spines, (K.slug(state.s.game) || 'slot') + '-spine-drafts.zip'); });
  }

  function showView(v) {
    ['drafts', 'check'].forEach(function (n) {
      $('view-' + n).hidden = n !== v;
      $('tab-' + n).setAttribute('aria-selected', String(n === v));
    });
    if (v !== 'drafts') disposePlayer();
    else if (state.plan) { state.player = null; renderPreview(); }
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
    if (state.pid && state.pid !== id) await saveNow();
    var rec = await Store.get(id);
    if (!rec) return;
    disposePlayer();
    state.pid = id;
    state.s = normalize(rec.settings);
    state.images = {};
    state.blobs = {};
    state.sel = null;
    state.open = { symbols: true };
    state.pv = { spine: null, anim: null, skin: null };
    state.confirmDel = null;
    var keys = Object.keys(rec.images || {});
    for (var i = 0; i < keys.length; i++) { try { await setImage(keys[i], rec.images[keys[i]]); } catch (e) { /* skip a broken image */ } }
    rememberLast(id);
    renderGame();
    renderProjects();
    rebuild();
    renderComponents();
    if (!state.wiz) drawer(false);
  }

  async function createProject(settings, images) {
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
    await Store.remove(id);
    state.projects = state.projects.filter(function (p) { return p.id !== id; });
    if (id !== state.pid) { renderProjects(); return; }
    state.pid = null;
    var target = next && state.projects.some(function (p) { return p.id === next; }) ? next : state.projects.length ? state.projects[0].id : null;
    if (target) await openProject(target);
    else await createExample();
  }

  async function duplicateProject() {
    await saveNow();
    var s = JSON.parse(JSON.stringify(state.s));
    s.game = (s.game || 'slot') + '-copy';
    await createProject(s, Object.assign({}, state.blobs));
    toast('Створено копію');
  }

  async function exportProject() {
    await saveNow();
    var imgs = {};
    var keys = Object.keys(state.blobs);
    for (var i = 0; i < keys.length; i++) imgs[keys[i]] = await readAsDataUrl(state.blobs[keys[i]]);
    saveFile((K.slug(state.s.game) || 'slot') + '.spine-kit.json', new Blob([JSON.stringify({ kit: 'spine-draft-kit@2', settings: state.s, images: imgs })], { type: 'application/json' }));
  }

  async function importFile(f) {
    try {
      var data = JSON.parse(await f.text());
      var settings = normalize(data.settings || data);
      var blobs = {};
      Object.keys(data.images || {}).forEach(function (k) { try { blobs[k] = dataUrlBlob(data.images[k]); } catch (e) { /* skip */ } });
      await createProject(settings, blobs);
      toast('Імпортовано: ' + f.name);
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
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>'
  };
  function iconBtn(cls, label, paths, onclick, pressed) {
    var b = el('button', { type: 'button', class: 'btn icon ' + cls, title: label, 'aria-label': label, 'aria-pressed': pressed === undefined ? null : String(pressed), onclick: onclick });
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
    return b;
  }

  function showGame(open) {
    state.gameOpen = open;
    $('game').hidden = !open;
    $('view-drafts').classList.toggle('no-game', !open);
    renderProjects();
    if (!open) return;
    drawer(false);
    $('game').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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
          'Видалити проект?',
          el('button', { type: 'button', class: 'btn sm', text: 'Так', onclick: function () { state.confirmDel = null; removeProject(p.id); } }),
          el('button', { type: 'button', class: 'btn ghost sm', text: 'Ні', onclick: function () { state.confirmDel = null; renderProjects(); } })
        ]));
      } else if (active) {
        li.appendChild(el('div', { class: 'p-act' }, [
          el('button', { type: 'button', class: 'btn ghost sm', text: 'Експорт', title: 'Зберегти проект у .json', onclick: exportProject }),
          iconBtn('p-set', 'Налаштування гри', ICONS.gear, function () { showGame(!state.gameOpen); }, state.gameOpen),
          iconBtn('p-copy', 'Копія', ICONS.copy, duplicateProject),
          iconBtn('p-del', 'Видалити', ICONS.trash, function () { state.confirmDel = p.id; renderProjects(); })
        ]));
      }
      ul.appendChild(li);
    });
  }

  function drawer(open) {
    $('sidebar').classList.toggle('open', open);
    $('scrim').hidden = !open;
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
    var prev = state.pid;
    var s = defaults();
    var counts = { wild: 1, scatter: 1, high: 4, low: 5, extra: '' };
    s.components[0].symbols = namesFrom(counts).map(function (n) { return { name: n }; });
    state.wiz = { step: 0, prev: prev, counts: counts, extras: { background: false, logo: false, popup: false } };
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
      var t = TEMPLATES[k];
      state.s.components.push({ id: newId(), type: 'custom', label: t.label, on: true, name: t.name, w: t.w, h: t.h, x: 0, y: 0, skins: 'default', spacers: '', anims: t.anims() });
    });
    state.wiz = null;
    state.open = { symbols: true };
    renderWizard();
    renderGame();
    changed({ render: true, now: true });
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
      ['background', 'logo', 'popup'].forEach(function (k) {
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
    $('new-project').addEventListener('click', startWizard);
    $('import-file').addEventListener('change', function (e) { var f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) importFile(f); });
    $('menu-btn').addEventListener('click', function () { drawer(!$('sidebar').classList.contains('open')); });
    $('scrim').addEventListener('click', function () { drawer(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && $('sidebar').classList.contains('open') && !$('info-dlg').open) drawer(false); });
    window.addEventListener('pagehide', function () { saveNow(); });
  }

  async function init() {
    initDownloads();
    bindShell();
    bindGame();
    bindCheck();
    var recs = await Store.list();
    if (!Store.persistent()) $('store-note').hidden = false;
    state.projects = recs.map(projectMeta).sort(function (a, b) { return b.created - a.created; });
    if (!recs.length) {
      var legacy = migrateLegacy();
      if (legacy) await createProject(legacy.settings, legacy.images);
      else await createExample();
    } else {
      var last = readLast();
      await openProject(state.projects.some(function (p) { return p.id === last; }) ? last : state.projects[0].id);
    }
    if ((location.hash || '').replace('#', '') === 'check') showView('check');
    loadScript(SPINE_URL).then(function () { state.lib.spine = window.spine && window.spine.SpinePlayer ? 'ok' : 'fail'; state.player = null; renderPreview(); }, function () { state.lib.spine = 'fail'; renderPreview(); });
    loadScript(ZIP_URL).then(function () { state.lib.zip = window.JSZip ? 'ok' : 'fail'; }, function () { state.lib.zip = 'fail'; });
    var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    if (mq && mq.addEventListener) mq.addEventListener('change', function () { if (state.plan) drawGrid(); });
  }

  init();
})();
