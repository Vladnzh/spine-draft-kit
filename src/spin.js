(function (root) {
  'use strict';

  var MODES = {
    normal: { delay: 0.0666, loop: 6, loopExtra: 2, speed: 1 },
    quick: { delay: 0, loop: 1, loopExtra: 0, speed: 1.5 }
  };
  var WIN_LOOPS = 2;

  var Tex = null;
  function texClass(spine) {
    if (!Tex) Tex = class extends spine.Texture { setFilters() {} setWraps() {} dispose() {} };
    return Tex;
  }
  function loadData(spine, sp) {
    var T = texClass(spine);
    var atlas = new spine.TextureAtlas(sp.atlasText);
    atlas.pages.forEach(function (p) { p.setTexture(new T({ width: p.width || 1, height: p.height || 1 })); });
    return new spine.SkeletonJson(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData(sp.jsonText);
  }
  function tick(spine, sk, st, dt) {
    st.update(dt);
    st.apply(sk);
    sk.updateWorldTransform(spine.Physics ? spine.Physics.update : undefined);
  }

  function blurOf(cache, img) {
    if (cache.has(img)) return cache.get(img);
    var sp = Math.round(0.16 * img.height);
    var c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height + 2 * sp;
    var x = c.getContext('2d');
    x.globalAlpha = 0.3;
    for (var k = -3; k <= 3; k++) x.drawImage(img, 0, sp + k * sp / 3);
    var out = { canvas: c, pad: sp };
    cache.set(img, out);
    return out;
  }

  function run(o) {
    var spine = o.spine, g = o.geometry, mode = MODES[o.quick ? 'quick' : 'normal'];
    var rowSp = o.spines.filter(function (s) { return /^animation_reel_\d+_rows$/.test(s.name); })[0];
    if (!rowSp) throw new Error('немає спайна animation_reel_' + g.R + '_rows');
    var rowData = loadData(spine, rowSp);
    if (!rowData.findAnimation('spin_start')) rowData.animations.push(new spine.Animation('spin_start', [], 0));
    ['spin_loop', 'spin_stop'].forEach(function (n) { if (!rowData.findAnimation(n)) throw new Error(rowSp.name + ' без анімації ' + n); });
    var symData = {};
    o.spines.forEach(function (s) { var m = /^animation_symbol_(.+)$/.exec(s.name); if (m && o.symbols.indexOf(m[1]) !== -1) symData[m[1]] = loadData(spine, s); });
    var pick = function () { return o.symbols[Math.floor(Math.random() * o.symbols.length)]; };

    var final = [];
    for (var c = 0; c < g.C; c++) { final.push([]); for (var r = 0; r < g.R; r++) final[c].push(pick()); }
    var win = null;
    if (o.win && g.C >= 2) {
      var pays = o.symbols.filter(function (n) { return !/scatter|bonus|blank/.test(n); });
      var name = pays.filter(function (n) { return /^high/.test(n); })[0] || pays[0] || o.symbols[0];
      var row = Math.floor((g.R - 1) / 2);
      win = { name: name, row: row, len: Math.min(g.C, 3), t: 0 };
      for (c = 0; c < win.len; c++) final[c][row] = name;
      if (win.len < g.C && final[win.len][row] === name) final[win.len][row] = o.symbols.filter(function (n) { return n !== name; })[0] || name;
    }

    function cellAnim(sym, anim, then) {
      var d = symData[sym];
      if (!d || !d.findAnimation(anim)) return null;
      var sk = new spine.Skeleton(d);
      sk.setToSetupPose();
      var st = new spine.AnimationState(new spine.AnimationStateData(d));
      st.setAnimation(0, anim, false);
      if (then && d.findAnimation(then)) st.addAnimation(0, then, true, 0);
      return { sk: sk, st: st, end: then ? Infinity : d.findAnimation(anim).duration };
    }

    var reels = [];
    for (c = 0; c < g.C; c++) {
      var sk = new spine.Skeleton(rowData);
      sk.setToSetupPose();
      var st = new spine.AnimationState(new spine.AnimationStateData(rowData));
      st.timeScale = mode.speed;
      var cells = [{ name: pick(), blur: false, anim: null }];
      for (r = 0; r < g.R; r++) cells.push({ name: o.start[c][r], blur: false, anim: null });
      var reel = { c: c, sk: sk, st: st, cells: cells, t0: c * mode.delay, started: false, loops: 0, seq: mode.loop + c * mode.loopExtra, stopping: false, done: false };
      st.addListener(listener(reel));
      reels.push(reel);
    }

    function listener(reel) {
      return {
        event: function (entry, ev) {
          var i = ev.intValue || 0;
          var cell = reel.cells[i];
          if (!cell) return;
          if (ev.data.name === 'onOffScreen') { cell.name = pick(); cell.blur = true; cell.anim = null; }
          else if (ev.data.name === 'onFinalSymbol') {
            cell.name = i > 0 ? final[reel.c][i - 1] : pick();
            cell.blur = false;
            cell.anim = i > 0 ? cellAnim(cell.name, 'stop') : null;
          }
        },
        complete: function (entry) {
          var n = entry.animation.name;
          if (n === 'spin_loop') {
            reel.loops += 1;
            if (reel.loops > reel.seq) {
              reel.stopping = true;
              reel.st.setAnimation(0, 'spin_stop', false).trackTime = entry.trackTime % entry.animation.duration;
            }
          } else if (n === 'spin_stop') reel.done = true;
        }
      };
    }

    function quickStop() {
      var live = reels.filter(function (reel) { return !reel.stopping; });
      if (!live.length) return;
      slam = true;
      notify();
      var lead = live[0];
      var cur = lead.started ? lead.st.tracks[0] : null;
      var at = cur && cur.animation.name === 'spin_loop' ? cur.trackTime % cur.animation.duration : 0;
      live.forEach(function (reel) {
        reel.seq = lead.loops;
        if (reel === lead && cur) return;
        reel.started = true;
        reel.loops = lead.loops;
        reel.st.setAnimation(0, 'spin_loop', true).trackTime = at;
      });
    }

    var t = 0, last = 0, raf = 0, stopped = false, phase = 'spin', slam = false, shown = 'spin';
    var blurCache = new Map();

    function status() {
      if (stopped || phase === 'idle') return 'idle';
      if (phase === 'win') return 'win';
      return slam || reels.every(function (reel) { return reel.stopping; }) ? 'stopping' : 'spin';
    }
    function notify() {
      var s = status();
      if (s === shown) return;
      shown = s;
      if (o.onState) o.onState(s);
    }

    function drawImg(x, img, cx, cy, w, h, blur) {
      if (!img) return;
      if (blur) {
        var b = blurOf(blurCache, img);
        var k = h / img.height;
        x.drawImage(b.canvas, cx - w / 2, -cy - h / 2 - b.pad * k, w, h + 2 * b.pad * k);
      } else x.drawImage(img, cx - w / 2, -cy - h / 2, w, h);
    }
    function drawAnim(x, a, img, ox, oy) {
      var slot = a.sk.findSlot('symbol');
      var att = slot && slot.getAttachment();
      if (!att || !att.computeWorldVertices || !img) return;
      var v = [];
      att.computeWorldVertices(slot, v, 0, 2);
      var alpha = a.sk.color.a * slot.color.a;
      if (alpha <= 0) return;
      x.save();
      x.globalAlpha *= alpha;
      x.transform((v[4] - v[2]) / img.width, -(v[5] - v[3]) / img.width, (v[0] - v[2]) / img.height, -(v[1] - v[3]) / img.height, ox + v[2], -(oy + v[3]));
      x.drawImage(img, 0, 0);
      x.restore();
    }

    function isWin(c, i) { return win && phase === 'win' && i - 1 === win.row && c < win.len; }

    function cellsLayer(x) {
      var w = g.gridW + 2 * g.margin, h = g.gridH + 2 * g.margin;
      x.save();
      x.beginPath();
      x.rect(-w / 2, -h / 2, w, h);
      x.clip();
      reels.forEach(function (reel) {
        for (var i = phase === 'idle' ? 1 : 0; i < reel.cells.length; i++) {
          var cell = reel.cells[i];
          var bone = reel.sk.findBone('slot_' + i);
          var slot = reel.sk.findSlot('slot_' + i);
          if (!bone || !slot) continue;
          var ox = g.reelX[reel.c] + bone.worldX, oy = bone.worldY;
          var a = slot.color.a;
          if (a <= 0) continue;
          x.save();
          x.globalAlpha = a;
          if (win && phase === 'win' && !isWin(reel.c, i)) x.filter = 'brightness(0.63)';
          var img = o.art(cell.name);
          if (cell.anim) drawAnim(x, cell.anim, img, ox, oy);
          else {
            var bl = cell.blur && o.blur ? o.blur(cell.name) : null;
            if (bl) drawImg(x, bl.img, ox, oy, bl.width, bl.height, false);
            else { var s = o.size(cell.name); drawImg(x, img, ox, oy, s.width, s.height, cell.blur && !o.blur); }
          }
          x.restore();
        }
      });
      x.restore();
      if (win && phase === 'win') {
        var pts = [];
        for (var c = 0; c < win.len; c++) pts.push([g.reelX[c], g.slotY[win.row + 1]]);
        x.save();
        x.globalAlpha = 0.75 + 0.25 * Math.sin(win.t * 6);
        x.lineCap = 'round';
        x.lineJoin = 'round';
        x.beginPath();
        x.moveTo(pts[0][0] - 0.5 * g.W, -pts[0][1]);
        pts.forEach(function (p) { x.lineTo(p[0], -p[1]); });
        x.lineTo(pts[pts.length - 1][0] + 0.5 * g.W, -pts[pts.length - 1][1]);
        x.strokeStyle = 'rgba(255,255,255,0.9)';
        x.lineWidth = 0.075 * Math.min(g.W, g.H);
        x.stroke();
        x.strokeStyle = o.lineColor;
        x.lineWidth = 0.045 * Math.min(g.W, g.H);
        x.stroke();
        x.restore();
      }
    }

    function startWin() {
      phase = 'win';
      var longest = 0;
      reels.forEach(function (reel) {
        for (var i = 1; i < reel.cells.length; i++) {
          if (!isWin(reel.c, i)) continue;
          var a = cellAnim(reel.cells[i].name, 'win', 'win_idle');
          if (!a) a = cellAnim(reel.cells[i].name, 'win');
          reel.cells[i].anim = a;
          if (a) {
            var d = a.sk.data;
            var len = d.findAnimation('win').duration + (d.findAnimation('win_idle') ? WIN_LOOPS * d.findAnimation('win_idle').duration : 0);
            longest = Math.max(longest, len);
          }
        }
      });
      win.until = Math.max(longest, 1.2);
    }

    function finish() {
      stopped = true;
      cancelAnimationFrame(raf);
      reels.forEach(function (reel) { reel.cells.forEach(function (cell) { cell.anim = null; cell.blur = false; }); });
      phase = 'idle';
      o.paint(cellsLayer);
      notify();
      if (o.onEnd) o.onEnd(final.map(function (col) { return col.slice(); }));
    }

    function frame(now) {
      if (stopped) return;
      var dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      t += dt;
      reels.forEach(function (reel) {
        var rdt = reel.started ? dt : 0;
        if (!reel.started && t >= reel.t0) {
          reel.started = true;
          reel.st.setAnimation(0, 'spin_start', false);
          reel.st.addAnimation(0, 'spin_loop', true, 0);
          rdt = t - reel.t0;
        }
        tick(spine, reel.sk, reel.st, rdt);
        reel.cells.forEach(function (cell) {
          var a = cell.anim;
          if (!a) return;
          tick(spine, a.sk, a.st, dt);
          if (a.st.tracks[0] && a.st.tracks[0].trackTime >= a.end) cell.anim = null;
        });
      });
      if (phase === 'spin' && reels.every(function (reel) { return reel.done; }) && reels.every(function (reel) { return reel.cells.every(function (cell) { return !cell.anim; }); })) {
        if (win) startWin();
        else { finish(); return; }
      }
      if (phase === 'win') {
        win.t += dt;
        if (win.t >= win.until) { finish(); return; }
      }
      o.paint(cellsLayer);
      notify();
      raf = requestAnimationFrame(frame);
    }

    o.paint(cellsLayer);
    raf = requestAnimationFrame(frame);

    return {
      quickStop: quickStop,
      skip: function () { if (phase === 'win' && !stopped) finish(); },
      cancel: function () { stopped = true; cancelAnimationFrame(raf); },
      get running() { return !stopped; },
      get phase() { return phase; },
      get state() { return status(); }
    };
  }

  root.SpineKitSpin = { run: run, MODES: MODES };
})(typeof window !== 'undefined' ? window : globalThis);
