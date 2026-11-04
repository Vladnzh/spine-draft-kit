(function () {
  'use strict';
  var K = window.SpineDraftKit;
  var Store = window.SpineKitStore;
  var Info = window.SpineKitInfo;
  var Link = window.SpineKitLink;
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
    background: { label: 'Фон', name: 'animation_bg', w: 4000, h: 4000, anims: function () { return [A('in', 1, 'fade_in'), A('loop_1', 4, 'hold', true), A('out', 0.3, 'fade_out')]; } },
    logo: { label: 'Логотип', name: 'animation_game_logo', w: 640, h: 280, anims: function () { return [A('in', 0.55, 'pop_in'), A('loop_1', 2, 'breathe', true), A('out', 0.3, 'pop_out')]; } },
    popup: { label: 'Попап', name: 'animation_popup', w: 900, h: 600, anims: function () { return [A('in', 0.55, 'pop_in'), A('loop_1', 1.15, 'glow', true), A('out', 0.3, 'pop_out')]; } },
    custom: { label: 'Свій', name: 'animation_element', w: 400, h: 400, anims: function () { return [A('in', 0.35, 'fade_in'), A('loop_1', 2, 'breathe', true), A('out', 0.35, 'fade_out')]; } }
  };

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
    Link.backup(rec);
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
    if (key.indexOf('blur:') === 0) {
      var sp = px('sym:' + key.slice(5));
      return { w: sp.w, h: sp.h + 2 * blurPad(sp.h) };
    }
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

  var artCache = {};
  function art(key) {
    var im = state.images[key];
    if (im) return im.canvas;
    if (key.indexOf('blur:') === 0) { var sc = art('sym:' + key.slice(5)); return sc ? drawBlur(sc) : null; }
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

  function animTable(rows) {
    var wrap = el('div', { class: 'anims' });
    wrap.appendChild(el('div', { class: 'a-head' }, [el('span', { text: 'Анімація' }), el('span', { text: 'Сек' }), el('span', {}, ['Рух', infoBtn('motion')]),el('span', {}, ['Події', infoBtn('events')]), el('span')]));
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
      input.value = K.listOf(input.value).map(K.slug).filter(function (s, i, a) { return s && a.indexOf(s) === i; }).join(', ');
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
        numPair('Центр X, Y', c.x || 0, c.y || 0, function (v) { c.x = Number(v); changed(); }, function (v) { c.y = Number(v); changed(); }, ['X', 'Y', ','])
      ]),
      el('div', { class: 'sub', text: 'Анімації' }),
      animTable(c.anims),
      el('div', { class: 'row', style: 'justify-content: flex-end; padding-top: 10px;' }, [
        el('button', { type: 'button', class: 'btn ghost sm', text: '✕ Прибрати компонент', 'aria-label': 'Прибрати ' + (TITLES[c.type] || c.label || 'компонент'), onclick: function () { state.s.components = state.s.components.filter(function (x) { return x !== c; }); forgetImage(key); changed({ render: true, images: true }); } })
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

  var spin = { ctl: null, grid: null };
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
    return '';
  }
  var SPIN_LABEL = { idle: 'Спін', spin: 'Стоп', stopping: 'Зупиняю', win: 'Новий спін' };
  function renderSpinBtn() {
    var b = $('spin-go');
    var st = spin.ctl && spin.ctl.running ? spin.ctl.state : 'idle';
    var why = st === 'idle' ? spinBlocker() : '';
    b.dataset.state = st;
    b.disabled = !!why;
    b.title = why;
    b.setAttribute('aria-label', SPIN_LABEL[st]);
    if (st === 'stopping') b.setAttribute('aria-disabled', 'true');
    else b.removeAttribute('aria-disabled');
  }
  function stopSpin() {
    if (!spin.ctl) return;
    spin.ctl.cancel();
    spin.ctl = null;
    if (state.plan) drawGrid();
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
        paint: function (layer) { drawGrid(layer); },
        onState: function () { renderSpinBtn(); },
        onEnd: function (grid) { spin.grid = grid; renderSpinBtn(); }
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
    zip.file(root + 'README.txt', K.readme(state.s, { tech: state.plan.tech, geometry: state.plan.geometry, spines: spines }));
    zip.file(root + 'kit-settings.json', JSON.stringify(state.s, null, 1));
    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  }

  async function downloadZip(spines, fileName) {
    if (!spines.length) return;
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
    $('dl-meta').textContent = n + ' ' + plural(n, 'спайн', 'спайни', 'спайнів');
    $('dl-all').disabled = !n;
    var w = $('warns');
    w.textContent = '';
    p.spines.forEach(function (s) { s.warnings.forEach(function (t) { w.appendChild(el('li', { text: s.name + ': ' + t })); }); });
    var on = state.s.components.filter(function (c) { return c.on !== false; }).length + ' / ' + state.s.components.length;
    $('c-count').textContent = on;
    $('dl-n').textContent = exComps().filter(function (c) { return !state.skip[c.id]; }).length + ' / ' + exComps().length;
    $('dl-all').disabled = !exComps().length;
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
        el('input', { type: 'checkbox', checked: !state.skip[c.id], 'aria-label': 'Експортувати ' + (TITLES[c.type] || c.label || 'компонент'), onchange: function (e) { state.skip[c.id] = !e.target.checked; renderExFoot(); renderSide(); } }),
        el('span', { class: 'comp-thumb', 'aria-hidden': 'true' }, [el('img', { alt: '', src: thumb(compThumb(c)) })]),
        el('span', {}, [el('b', { text: TITLES[c.type] || c.label || 'Компонент' }), el('small', { text: compNames(c) + ' · ' + n + ' ' + plural(n, 'спайн', 'спайни', 'спайнів') })])
      ]));
    });
    renderExFoot();
  }
  function renderExFoot() {
    var n = exSpines().length;
    var all = exComps().every(function (c) { return !state.skip[c.id]; });
    $('ex-all').textContent = all ? 'Зняти всі' : 'Вибрати всі';
    $('ex-go').textContent = 'Експортувати ' + n + ' ' + plural(n, 'спайн', 'спайни', 'спайнів');
    $('ex-go').disabled = !n;
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
      var c = { id: newId(), type: 'custom', label: t.label, on: true, name: name, w: t.w, h: t.h, x: 0, y: 0, skins: 'default', spacers: '', anims: t.anims() };
      state.s.components.push(c);
      state.open[c.id] = true;
      state.pv.spine = name;
      state.pv.anim = null;
      closeAdd();
      changed({ render: true, now: true });
    };
    var ADD_NOTES = { background: 'Задній план гри на весь екран', logo: 'Назва гри з появою і диханням', popup: 'Вікно виграшу чи повідомлення', custom: 'Будь-який інший елемент' };
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
    };
    $('add-comp').addEventListener('click', function () { renderAddList(); if (typeof ad.showModal === 'function') { if (!ad.open) ad.showModal(); } else ad.setAttribute('open', ''); });
    $('add-close').addEventListener('click', closeAdd);
    ad.addEventListener('click', function (e) { if (e.target === ad) closeAdd(); });
    $('pv-spine').addEventListener('change', function (e) { state.pv.spine = e.target.value; state.pv.anim = null; state.pv.skin = null; renderPreview(); renderComponents(); });
    $('pv-skin').addEventListener('change', function (e) { state.pv.skin = e.target.value; renderPreview(); });
    var xd = $('ex-dlg');
    var closeEx = function () { if (typeof xd.close === 'function') xd.close(); else xd.removeAttribute('open'); };
    $('dl-all').addEventListener('click', function () { renderExport(); if (typeof xd.showModal === 'function') { if (!xd.open) xd.showModal(); } else xd.setAttribute('open', ''); });
    $('ex-close').addEventListener('click', closeEx);
    xd.addEventListener('click', function (e) { if (e.target === xd) closeEx(); });
    $('ex-all').addEventListener('click', function () {
      var all = exComps().every(function (c) { return !state.skip[c.id]; });
      exComps().forEach(function (c) { state.skip[c.id] = all; });
      renderExport();
      renderSide();
    });
    $('ex-go').addEventListener('click', function () {
      var spines = exSpines();
      closeEx();
      downloadZip(spines, (K.slug(state.s.game) || 'slot') + '-spine-drafts.zip');
    });
    $('spin-go').addEventListener('click', startSpin);
  }

  function showView(v) {
    ['drafts', 'check'].forEach(function (n) {
      $('view-' + n).hidden = n !== v;
      var tab = $('tab-' + n);
      if (tab) tab.setAttribute('aria-selected', String(n === v));
    });
    if (v !== 'drafts') { disposePlayer(); stopSpin(); }
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
    showEmpty(false);
    renderGame();
    renderProjects();
    rebuild();
    renderComponents();
    if (!state.wiz) drawer(false);
  }

  function showEmpty(on) {
    $('view-empty').hidden = !on;
    $('view-drafts').hidden = on;
    document.querySelector('.bar-end').hidden = on;
  }

  function clearProject() {
    clearTimeout(timer);
    stopSpin();
    disposePlayer();
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
  }

  async function closeProject() {
    if (!state.pid || state.wiz) return;
    await saveNow();
    clearProject();
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
    Link.forget(id);
    state.projects = state.projects.filter(function (p) { return p.id !== id; });
    if (id !== state.pid) { renderProjects(); return; }
    state.pid = null;
    var target = next !== undefined ? next : state.projects.length ? state.projects[0].id : null;
    if (target && state.projects.some(function (p) { return p.id === target; })) await openProject(target);
    else clearProject();
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
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && $('sidebar').classList.contains('open') && !$('info-dlg').open && !$('game').open && !$('grid-dlg').open && !$('add-dlg').open && !$('ex-dlg').open) drawer(false); });
    window.addEventListener('pagehide', function () { saveNow(); });
  }

  async function init() {
    initDownloads();
    bindShell();
    bindGame();
    bindCheck();
    var restored = await Link.restore(Store);
    var recs = await Store.list();
    if (!Store.persistent()) $('store-note').hidden = false;
    state.projects = recs.map(projectMeta).sort(function (a, b) { return b.created - a.created; });
    var last = readLast();
    if (!recs.length) {
      var legacy = migrateLegacy();
      if (legacy) await createProject(legacy.settings, legacy.images);
      else if (last === null) await createExample();
      else showEmpty(true);
    } else if (last === '') showEmpty(true);
    else await openProject(state.projects.some(function (p) { return p.id === last; }) ? last : state.projects[0].id);
    // if ((location.hash || '').replace('#', '') === 'check') showView('check');
    if (restored) toast('Відновлено з диска: ' + restored + ' ' + plural(restored, 'проект', 'проекти', 'проектів'));
    Link.start(App);
    loadScript(SPINE_URL).then(function () { state.lib.spine = window.spine && window.spine.SpinePlayer ? 'ok' : 'fail'; state.player = null; renderPreview(); renderSpinBtn(); }, function () { state.lib.spine = 'fail'; renderPreview(); renderSpinBtn(); });
    loadScript(ZIP_URL).then(function () { state.lib.zip = window.JSZip ? 'ok' : 'fail'; }, function () { state.lib.zip = 'fail'; });
    var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    if (mq && mq.addEventListener) mq.addEventListener('change', function () { if (state.plan) drawGrid(); });
  }

  var App = {
    K: K, state: state, A: A, defaults: defaults, newId: newId, templates: TEMPLATES, fitSize: fitSize,
    setImage: setImage, forgetImage: forgetImage, moveSymbolImages: moveSymbolImages, forgetSymbolImages: forgetSymbolImages, changed: changed, saveNow: saveNow,
    renderGame: renderGame, renderComponents: renderComponents, renderPreview: renderPreview, renderWizard: renderWizard,
    openProject: openProject, createProject: createProject, startSpin: startSpin, buildZip: buildZip, toast: toast,
    spinning: function () { return !!(spin.ctl && spin.ctl.running); }
  };

  init();
})();
