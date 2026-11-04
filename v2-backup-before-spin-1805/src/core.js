(function (root) {
  'use strict';

  var VERSION = '2.0.0';
  var TECH = { spineVersion: '4.1.24', fps: 30, folder: 'skins/main/Motion/spine/', spacer: 'shapes/spacer', white: 'shapes/bg_white', maxPage: 4096, padding: 2, timingTolerance: 0.1 };

  function roundTo(v, d) {
    var f = Math.pow(10, d);
    var r = Math.round(v * f) / f;
    return Object.is(r, -0) ? 0 : r;
  }
  function r4(v) { return roundTo(v, 4); }
  function r2(v) { return roundTo(v, 2); }
  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function slug(s) { return String(s || '').trim().toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, ''); }
  function listOf(s) { return (Array.isArray(s) ? s : String(s || '').split(',')).map(function (x) { return String(x).trim(); }).filter(Boolean); }

  var EASE = {
    linear: null,
    'ease-in': [0.42, 0, 1, 1],
    'ease-out': [0, 0, 0.58, 1],
    'ease-in-out': [0.42, 0, 0.58, 1],
    back: [0.2, 1.5, 0.4, 1],
    shake: [0.36, 0.07, 0.19, 0.97],
    soft: [0.2, 0.8, 0.3, 1]
  };

  function bezier(t0, t1, v0, v1, c) {
    return [r4(t0 + (t1 - t0) * c[0]), r4(v0 + (v1 - v0) * c[1]), r4(t0 + (t1 - t0) * c[2]), r4(v0 + (v1 - v0) * c[3])];
  }

  function timeline(keys, duration, ease, channels, toFrame) {
    var curve = EASE[ease] || null;
    return keys.map(function (key, i) {
      var time = r4((key.at / 100) * duration);
      var frame = {};
      if (time) frame.time = time;
      var body = toFrame(key);
      Object.keys(body).forEach(function (k) { frame[k] = body[k]; });
      var next = keys[i + 1];
      if (next && curve) {
        var nextTime = r4((next.at / 100) * duration);
        frame.curve = [];
        channels.forEach(function (ch) { bezier(time, nextTime, key[ch], next[ch], curve).forEach(function (n) { frame.curve.push(n); }); });
      }
      return frame;
    });
  }

  function hex2(v) {
    var n = Math.max(0, Math.min(255, Math.round(v * 255)));
    return (n < 16 ? '0' : '') + n.toString(16);
  }
  function parseHex(hex) {
    var s = String(hex || 'ffffff').replace(/^#/, '');
    if (s.length === 6) s += 'ff';
    return { r: parseInt(s.slice(0, 2), 16) / 255, g: parseInt(s.slice(2, 4), 16) / 255, b: parseInt(s.slice(4, 6), 16) / 255, a: parseInt(s.slice(6, 8), 16) / 255 };
  }

  function channelKeys(keys, has, pick, identity) {
    var list = keys.filter(has).map(function (k) { var v = pick(k); v.at = k.at; return v; });
    if (!list.length) return list;
    if (list[0].at !== 0) { var first = identity(); first.at = 0; list.unshift(first); }
    if (list[list.length - 1].at !== 100) { var last = identity(); last.at = 100; list.push(last); }
    return list;
  }

  function motion(duration, ease, keys, ctx) {
    var bone = {};
    var sk = channelKeys(keys,
      function (k) { return k.scale !== undefined; },
      function (k) { return { s: k.scale }; },
      function () { return { s: 1 }; });
    if (sk.some(function (k) { return k.s !== 1; })) {
      sk.forEach(function (k) { k.sx = k.s; k.sy = k.s; });
      bone.scale = timeline(sk, duration, ease, ['sx', 'sy'], function (k) { return { x: r4(k.s), y: r4(k.s) }; });
    }
    var rk = channelKeys(keys,
      function (k) { return k.rotate !== undefined; },
      function (k) { return { rot: r4(-k.rotate) }; },
      function () { return { rot: 0 }; });
    if (rk.some(function (k) { return k.rot !== 0; })) {
      bone.rotate = timeline(rk, duration, ease, ['rot'], function (k) { return { value: k.rot }; });
    }
    var mk = channelKeys(keys,
      function (k) { return k.x !== undefined || k.y !== undefined; },
      function (k) { return { x: r4(k.x || 0), y: r4(-(k.y || 0)) }; },
      function () { return { x: 0, y: 0 }; });
    if (mk.some(function (k) { return k.x !== 0 || k.y !== 0; })) {
      bone.translate = timeline(mk, duration, ease, ['x', 'y'], function (k) { return { x: k.x, y: k.y }; });
    }
    var ck = channelKeys(keys,
      function (k) { return k.opacity !== undefined || k.color !== undefined; },
      function (k) { var c = parseHex(k.color || 'ffffff'); return { r: c.r, g: c.g, b: c.b, a: k.opacity !== undefined ? k.opacity : 1 }; },
      function () { return { r: 1, g: 1, b: 1, a: 1 }; });
    var anim = {};
    if (ck.some(function (k) { return k.r !== 1 || k.g !== 1 || k.b !== 1 || k.a !== 1; })) {
      anim.slots = {};
      anim.slots[ctx.slot] = { rgba: timeline(ck, duration, ease, ['r', 'g', 'b', 'a'], function (k) { return { color: hex2(k.r) + hex2(k.g) + hex2(k.b) + hex2(k.a) }; }) };
    }
    if (Object.keys(bone).length) {
      anim.bones = {};
      anim.bones[ctx.bone] = bone;
    }
    return anim;
  }

  var PRESETS = {
    hold: { label: 'Пауза', duration: 1 },
    fade_in: { label: 'Поява', duration: 0.35, ease: 'ease-out', keys: function () { return [{ at: 0, opacity: 0 }, { at: 100, opacity: 1 }]; } },
    fade_out: { label: 'Зникнення', duration: 0.35, ease: 'ease-in', keys: function () { return [{ at: 0, opacity: 1 }, { at: 100, opacity: 0 }]; } },
    pop_in: { label: 'Вистрибує', duration: 0.55, ease: 'back', keys: function () { return [{ at: 0, scale: 0.3, rotate: -4, opacity: 0 }, { at: 100, scale: 1, rotate: 0, opacity: 1 }]; } },
    pop_out: { label: 'Стискається', duration: 0.3, ease: 'ease-in', keys: function () { return [{ at: 0, scale: 1, opacity: 1 }, { at: 100, scale: 0.3, opacity: 0 }]; } },
    pulse: { label: 'Пульс', duration: 0.65, ease: 'ease-out', keys: function () { return [{ at: 0, scale: 1 }, { at: 45, scale: 1.06 }, { at: 100, scale: 1 }]; } },
    breathe: { label: 'Дихання', duration: 2, ease: 'ease-in-out', keys: function () { return [{ at: 0, scale: 1 }, { at: 50, scale: 1.015 }, { at: 100, scale: 1 }]; } },
    land: { label: 'Приземлення', duration: 0.28, ease: 'ease-out', keys: function (c) { var d = r4(0.02 * (c.cellH || c.h || 100)); return [{ at: 0, y: 0 }, { at: 40, y: d }, { at: 100, y: 0 }]; } },
    win: { label: 'Виграш', duration: 0.85, ease: 'ease-in-out', keys: function () { return [{ at: 0, scale: 1, rotate: 0 }, { at: 30, scale: 1.18, rotate: -4 }, { at: 60, scale: 1.08, rotate: 3 }, { at: 100, scale: 1, rotate: 0 }]; } },
    shake: {
      label: 'Трясіння', duration: 0.55, ease: 'shake',
      keys: function (c) {
        var a = 0.025 * (c.h || 100);
        var k = function (at, x, y) { return { at: at, x: r4(x * a), y: r4(y * a) }; };
        return [k(10, -0.2, 0.2), k(20, 0.6, -0.4), k(30, -1, 0.4), k(40, 1, -0.2), k(50, -1, 0.4), k(60, 1, -0.2), k(70, -1, 0.4), k(80, 0.6, -0.4), k(90, -0.2, 0.2)];
      }
    },
    float_up: {
      label: 'Злітає', duration: 1.1, ease: 'soft',
      keys: function (c) { var h = 1.2 * (c.h || 100); return [{ at: 0, opacity: 0, scale: 0.5, y: 0 }, { at: 18, opacity: 1, scale: 1.25, y: -h * 0.25 }, { at: 70, opacity: 1, scale: 1, y: -h * 2 / 3 }, { at: 100, opacity: 0, scale: 0.95, y: -h }]; }
    },
    glow: { label: 'Світіння', duration: 1.15, ease: 'ease-in-out', keys: function () { return [{ at: 0, color: 'ffffff' }, { at: 50, color: 'ffe875' }, { at: 100, color: 'ffffff' }]; } },
    flash: { label: 'Спалах', duration: 0.6, ease: 'ease-out', keys: function () { return [{ at: 0, opacity: 0.85 }, { at: 100, opacity: 0 }]; } }
  };

  function presetFor(name, kind) {
    var n = String(name).split('/').pop();
    if (n === 'stop' || n === 'pressed') return 'land';
    if (n === 'win' || n === 'win_idle') return kind === 'symbol' ? 'win' : 'pulse';
    if (n === 'win_insignificant') return 'pulse';
    if (/^(in|show|enter|intro|fade_in)(_|$)/.test(n)) return 'fade_in';
    if (/^(out|hide|exit|fade_out)(_|$)/.test(n)) return 'fade_out';
    if (/anticipation/.test(n)) return 'glow';
    if (n === 'idle') return 'breathe';
    return 'hold';
  }

  function parseEvents(s) {
    return listOf(s).map(function (part) {
      var m = /^([A-Za-z_][\w]*)(?:\((-?\d+)\))?(?:@([\d.]+))?$/.exec(part.replace(/\s+/g, ''));
      if (!m) return null;
      var e = { name: m[1], time: m[3] ? Number(m[3]) : 0 };
      if (m[2] !== undefined && Number(m[2]) !== 0) e.int = Number(m[2]);
      return e;
    }).filter(Boolean);
  }

  function buildAnimation(spec, ctx) {
    var preset = PRESETS[spec.preset] ? spec.preset : 'hold';
    var d = Number(spec.duration);
    if (!isFinite(d) || d < 0) d = PRESETS[preset].duration;
    var anim;
    if (preset === 'hold' || !d) {
      anim = {};
      if (d) {
        anim.bones = {};
        anim.bones[ctx.bone] = { translate: [{}, { time: r4(d) }] };
      }
    } else {
      anim = motion(d, PRESETS[preset].ease, PRESETS[preset].keys(ctx), ctx);
    }
    var events = (spec.events || []).filter(function (e) { return e && e.name; }).slice().sort(function (a, b) { return (a.time || 0) - (b.time || 0); });
    if (events.length) {
      anim.events = events.map(function (e) {
        var o = {};
        var t = r4(Math.min(Number(e.time) || 0, d || 0));
        if (t) o.time = t;
        o.name = e.name;
        if (e.int) o.int = e.int;
        return o;
      });
    }
    return anim;
  }

  function specsFrom(rows, kind) {
    return (rows || []).filter(function (a) { return a && a.name; }).map(function (a) {
      var preset = a.preset || presetFor(a.name, kind);
      var d = Number(a.duration);
      return { name: String(a.name).trim(), preset: preset, duration: isFinite(d) && d >= 0 ? d : PRESETS[preset] ? PRESETS[preset].duration : 1, loop: !!a.loop, events: typeof a.events === 'string' ? parseEvents(a.events) : (a.events || []) };
    });
  }

  function eventNamesOf(animations) {
    var names = [];
    Object.keys(animations).forEach(function (k) {
      (animations[k].events || []).forEach(function (e) { if (names.indexOf(e.name) === -1) names.push(e.name); });
    });
    return names;
  }

  function withEvents(json) {
    var names = eventNamesOf(json.animations || {});
    if (!names.length) return json;
    var out = {};
    Object.keys(json).forEach(function (k) {
      if (k === 'animations') { out.events = {}; names.forEach(function (n) { out.events[n] = {}; }); }
      out[k] = json[k];
    });
    return out;
  }

  function corners(x, y, w, h) { return [[x - w / 2, y - h / 2], [x + w / 2, y + h / 2]]; }
  function bounds(points) {
    var xs = points.map(function (p) { return p[0]; });
    var ys = points.map(function (p) { return p[1]; });
    var minX = Math.min.apply(null, xs), minY = Math.min.apply(null, ys);
    return { x: r2(minX), y: r2(minY), width: r2(Math.max.apply(null, xs) - minX), height: r2(Math.max.apply(null, ys) - minY) };
  }
  function skeleton(name, tech, points) {
    var b = bounds(points);
    return { hash: 'draft-' + name.replace(/^animation_/, ''), spine: tech.spineVersion, x: b.x, y: b.y, width: b.width, height: b.height };
  }

  function contain(w, h, maxW, maxH) {
    var s = Math.min(1, maxW / w, maxH / h);
    return { width: r2(w * s), height: r2(h * s) };
  }

  function geometry(s) {
    var C = Math.max(1, Math.round(s.reels)), R = Math.max(1, Math.round(s.rows));
    var W = Number(s.cell.w), H = Number(s.cell.h);
    var m = Math.round(0.07 * Math.min(W, H));
    var b = Math.round(0.16 * Math.min(W, H));
    var reelX = [], slotY = [];
    for (var i = 0; i < C; i++) reelX.push(r4((i - (C - 1) / 2) * W));
    slotY.push(r4(-(R + 1) / 2 * H));
    for (var j = 1; j <= R; j++) slotY.push(r4(((R + 1) / 2 - j) * H));
    return { C: C, R: R, W: W, H: H, gridW: C * W, gridH: R * H, margin: m, border: b, reelX: reelX, slotY: slotY };
  }

  function sideX(slot, halfW) {
    if (/_left$/.test(slot)) return -halfW;
    if (/_right$/.test(slot)) return halfW;
    return 0;
  }
  function sideY(slot, halfH) {
    if (/_top$/.test(slot)) return halfH;
    if (/_bottom$/.test(slot)) return -halfH;
    return 0;
  }

  function rig(o, tech) {
    var bones = [{ name: 'root' }];
    var used = { root: true };
    var add = function (b) { if (!used[b.name]) { used[b.name] = true; bones.push(b); } };
    var parent = 'root';
    o.chain.forEach(function (n) { add({ name: n, parent: parent }); parent = n; });
    (o.extraBones || []).forEach(add);
    var slots = [{ name: o.slot, bone: parent, attachment: o.region }];
    var att = {};
    att[o.slot] = {};
    var a = {};
    if (r2(o.att.x || 0)) a.x = r2(o.att.x);
    if (r2(o.att.y || 0)) a.y = r2(o.att.y);
    a.width = r2(o.att.width);
    a.height = r2(o.att.height);
    att[o.slot][o.region] = a;
    var pts = corners(o.att.x || 0, o.att.y || 0, o.att.width, o.att.height);
    (o.spacers || []).forEach(function (sp) {
      if (att[sp.slot]) return;
      var bn = used[sp.bone || sp.slot] ? sp.slot + '_bone' : (sp.bone || sp.slot);
      var b = { name: bn, parent: sp.parent || 'root' };
      if (r2(sp.x || 0)) b.x = r2(sp.x);
      if (r2(sp.y || 0)) b.y = r2(sp.y);
      add(b);
      slots.push({ name: sp.slot, bone: bn, attachment: tech.spacer });
      att[sp.slot] = {};
      att[sp.slot][tech.spacer] = sp.att ? clone(sp.att) : { width: 1, height: 1 };
      pts = pts.concat(corners(sp.x || 0, sp.y || 0, 1, 1));
    });
    var skins = listOf(o.skins);
    if (!skins.length) skins = ['default'];
    var skinList = skins.indexOf('default') !== -1
      ? skins.map(function (s) { return s === 'default' ? { name: 'default', attachments: att } : { name: s }; })
      : skins.map(function (s) { return { name: s, attachments: clone(att) }; });
    var json = { skeleton: skeleton(o.name, tech, pts), bones: bones, slots: slots, skins: skinList, animations: {} };
    o.specs.forEach(function (sp) {
      if (!sp.name || json.animations[sp.name]) return;
      json.animations[sp.name] = buildAnimation(sp, o.ctx);
    });
    var regions = [{ name: o.region, w: o.px.w, h: o.px.h, src: o.src }];
    if ((o.spacers || []).length) regions.push({ name: tech.spacer, w: 1, h: 1, src: 'clear' });
    return { name: o.name, json: withEvents(json), regions: regions, loops: o.specs.filter(function (s) { return s.loop; }).map(function (s) { return s.name; }) };
  }

  function symbolSpines(comp, s, g, px, tech) {
    var out = [];
    var shared = specsFrom(comp.anims, 'symbol');
    var statics = [];
    (comp.symbols || []).forEach(function (sym) {
      var name = slug(sym.name);
      if (!name) return;
      var key = 'sym:' + name;
      var p = px(key) || { w: Math.round(0.86 * g.W), h: Math.round(0.86 * g.H) };
      var att = contain(p.w, p.h, g.W, g.H);
      var region = 'art/reels/' + name;
      statics.push({ name: name, region: region, att: att, px: p, key: key });
      var spacers = comp.txt ? [{ slot: 'txt_amount', bone: 'txt_multiplier_amount', parent: 'txt', x: 0.34 * g.W, y: 0.42 * g.H, att: { x: 0.5, y: 0.5, width: 1, height: 1 } }] : [];
      out.push(rig({
        name: 'animation_symbol_' + name,
        chain: ['art'],
        extraBones: comp.txt ? [{ name: 'txt', parent: 'root' }] : [],
        slot: 'symbol',
        region: region,
        att: att,
        px: p,
        src: key,
        spacers: spacers,
        skins: ['default'],
        specs: sym.ownAnims ? specsFrom(sym.anims, 'symbol') : shared,
        ctx: { bone: 'art', slot: 'symbol', w: att.width, h: att.height, cellH: g.H }
      }, tech));
    });
    if (statics.length) {
      var maxW = Math.max.apply(null, statics.map(function (x) { return x.att.width; }));
      var maxH = Math.max.apply(null, statics.map(function (x) { return x.att.height; }));
      var skins = [];
      var seen = {};
      statics.forEach(function (x) {
        [x.name, x.name + '_blur'].forEach(function (sn) {
          var a = { symbols: { symbols: { name: x.region, width: x.att.width, height: x.att.height } } };
          skins.push({ name: 'symbol_' + sn, attachments: a });
        });
      });
      var json = {
        skeleton: skeleton('animation_symbols_static', tech, corners(0, 0, maxW, maxH)),
        bones: [{ name: 'root' }, { name: 'scale', parent: 'root' }],
        slots: [{ name: 'symbols', bone: 'scale', attachment: 'symbols' }],
        skins: skins,
        animations: {
          active_state: {},
          dim_in: { slots: { symbols: { rgb: [{ color: 'ffffff' }, { time: 0.2, color: 'a0a0a0' }] } } },
          dim_out: { slots: { symbols: { rgb: [{ color: 'a0a0a0' }, { time: 0.2, color: 'ffffff' }] } } },
          in: { slots: { symbols: { rgba: [{ color: 'ffffffff' }] } }, bones: { scale: { scale: [{}] } } },
          out: {
            slots: { symbols: { rgba: [{ time: 0.3, color: 'ffffffff' }, { time: 0.4667, color: 'ffffff00' }] } },
            bones: { scale: { scale: [{ time: 0.3, curve: [0.367, 0.939, 0.411, 0.786, 0.367, 0.939, 0.411, 0.786] }, { time: 0.4667, x: 0.6, y: 0.6 }] } }
          }
        }
      };
      var regions = [];
      statics.forEach(function (x) { if (!seen[x.region]) { seen[x.region] = true; regions.push({ name: x.region, w: x.px.w, h: x.px.h, src: x.key }); } });
      out.push({ name: 'animation_symbols_static', json: json, regions: regions, loops: [] });
    }
    return out;
  }

  var EPS = 0.0006;
  var STOP_EASE = [0.12, 0.18, 0.45, 1];
  var SETTLE_EASE = [0.4, 0, 0.62, 1];
  var IN_EASE = [0.32, 0.63, 0.41, 1];

  function splitBezier(p0, p1, p2, p3, u) {
    var lerp = function (a, b) { return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]; };
    var a = lerp(p0, p1), b = lerp(p1, p2), c = lerp(p2, p3);
    var d = lerp(a, b), e = lerp(b, c), f = lerp(d, e);
    return [[p0, a, d, f], [f, e, c, p3]];
  }
  function bezierPoint(p, u) {
    var m = 1 - u;
    return [m * m * m * p[0][0] + 3 * m * m * u * p[1][0] + 3 * m * u * u * p[2][0] + u * u * u * p[3][0],
      m * m * m * p[0][1] + 3 * m * m * u * p[1][1] + 3 * m * u * u * p[2][1] + u * u * u * p[3][1]];
  }
  function ctrl(t0, v0, t1, v1, e) { return [[t0, v0], [t0 + (t1 - t0) * e[0], v0 + (v1 - v0) * e[1]], [t0 + (t1 - t0) * e[2], v0 + (v1 - v0) * e[3]], [t1, v1]]; }
  function curveOf(p) { return [r4(p[1][0]), r4(p[1][1]), r4(p[2][0]), r4(p[2][1])]; }
  function key(t, y, curve) {
    var k = {};
    if (r4(t)) k.time = r4(t);
    if (r4(y)) k.y = r4(y);
    if (curve) k.curve = curve;
    return k;
  }

  function reelRowsSpine(g, tech) {
    var R = g.R, H = g.H;
    var dt = 1 / (tech.fps || 30);
    var bot = g.slotY[0], top = -bot, P = (R + 1) * H, v = H / dt;
    var name = 'animation_reel_' + R + '_rows';
    var bones = [{ name: 'root' }, { name: 'art', parent: 'root' }, { name: 'reel', parent: 'art' }];
    var slots = [];
    var att = {};
    var i;
    for (i = 0; i <= R; i++) {
      var b = { name: 'slot_' + i, parent: 'reel' };
      if (g.slotY[i]) b.y = g.slotY[i];
      b.transform = 'noRotationOrReflection';
      bones.push(b);
      slots.push({ name: 'slot_' + i, bone: 'slot_' + i, attachment: 'spacer' });
      att['slot_' + i] = { spacer: { path: tech.spacer, width: 1, height: 1 } };
    }
    bones.push({ name: 'reel_static', parent: 'art' });
    for (i = 0; i <= R; i++) {
      var bs = { name: 'slot_' + i + '_static', parent: 'reel_static' };
      if (g.slotY[i]) bs.y = g.slotY[i];
      bs.transform = 'noRotationOrReflection';
      bones.push(bs);
      slots.push({ name: 'slot_' + i + '_static', bone: 'slot_' + i + '_static', attachment: 'spacer' });
      att['slot_' + i + '_static'] = { spacer: { path: tech.spacer, width: 1, height: 1 } };
    }

    function runKeys(y0, steps, startWrapped) {
      var keys = [];
      var abs = y0;
      if (startWrapped) {
        keys.push(key(0, 0, 'stepped'));
        abs = top - v * EPS;
        keys.push(key(EPS, abs - y0));
        abs = top;
      } else keys.push(key(0, 0));
      for (var k = 1; k <= steps; k++) {
        abs -= H;
        var t = k * dt;
        if (Math.abs(abs - bot) < 0.001 && k < steps) {
          keys.push(key(t, bot - y0, 'stepped'));
          keys.push(key(t + EPS, top - v * EPS - y0));
          abs = top;
        } else keys.push(key(t, abs - y0));
      }
      return { keys: keys, abs: abs };
    }

    var loop = { bones: {}, events: [] };
    for (i = 0; i <= R; i++) {
      loop.bones['slot_' + i] = { translate: runKeys(g.slotY[i], R + 1, i === 0).keys };
    }
    for (var k = 1; k <= R + 1; k++) {
      var ev = { time: r4(k * dt), name: 'onOffScreen' };
      if (R + 1 - k) ev.int = R + 1 - k;
      loop.events.push(ev);
    }

    var tA = R * dt, tB = (R + 4) * dt, tC = (R + 7) * dt, o = r4(0.12 * H);
    var stop = { bones: {}, events: [{ name: 'onOffScreen' }] };
    var wrap0 = null;
    for (i = 0; i <= R; i++) {
      var y0 = g.slotY[i];
      var run = runKeys(y0, R, i === 0);
      var keys = run.keys;
      var abs = run.abs;
      if (Math.abs(abs - bot) < 0.001) {
        keys[keys.length - 1].curve = 'stepped';
        abs = top;
        keys.push(key(tA + EPS, top - y0));
      }
      var last = keys[keys.length - 1];
      var startT = last.time || 0;
      var endAbs = abs - H - o;
      var p = ctrl(startT, abs, tB, endAbs, STOP_EASE);
      if (endAbs < bot) {
        var lo = 0, hi = 1;
        for (var it = 0; it < 40; it++) { var mid = (lo + hi) / 2; if (bezierPoint(p, mid)[1] > bot) lo = mid; else hi = mid; }
        var parts = splitBezier(p[0], p[1], p[2], p[3], hi);
        var tw = parts[0][3][0];
        last.curve = curveOf(parts[0].map(function (q) { return [q[0], q[1] - y0]; }));
        keys.push(key(tw, bot - y0, 'stepped'));
        var second = parts[1].map(function (q) { return [q[0], q[1] + P - y0]; });
        second[0] = [tw + EPS, second[0][1]];
        if (second[1][0] < tw + EPS) second[1] = [tw + EPS, second[1][1]];
        keys.push(key(tw + EPS, second[0][1], curveOf(second)));
        endAbs += P;
        wrap0 = r4(tw);
      } else {
        last.curve = curveOf(p.map(function (q) { return [q[0], q[1] - y0]; }));
      }
      var settle = ctrl(tB, endAbs, tC, endAbs + o, SETTLE_EASE);
      keys.push(key(tB, endAbs - y0, curveOf(settle.map(function (q) { return [q[0], q[1] - y0]; }))));
      keys.push(key(tC, endAbs + o - y0));
      stop.bones['slot_' + i] = { translate: keys };
    }
    for (k = 1; k <= R; k++) {
      var fe = { time: r4(k * dt), name: 'onFinalSymbol', int: R + 1 - k };
      stop.events.push(fe);
    }
    stop.events.push({ time: wrap0 !== null ? wrap0 : r4((R + 2) * dt), name: 'onFinalSymbol' });
    stop.events.push({ time: r4(tB + 2 * dt), name: 'onStopReelSound' });

    var inAnim = { slots: {} }, outAnim = { slots: {} };
    for (i = 0; i <= R; i++) {
      inAnim.slots['slot_' + i] = { rgba: [{ color: 'ffffff00', curve: 'stepped' }, { time: 1, color: 'ffffff00', curve: [1.111, 1, 1.222, 1, 1.111, 1, 1.222, 1, 1.111, 1, 1.222, 1, 1.111, 0, 1.222, 1] }, { time: 1.3333, color: 'ffffffff' }] };
      outAnim.slots['slot_' + i] = { rgba: [{ color: 'ffffffff' }, { time: 0.1667, color: 'ffffff00' }] };
    }
    var json = {
      skeleton: skeleton(name, tech, corners(0, 0, g.W, (R + 1) * H)),
      bones: bones,
      slots: slots,
      skins: [{ name: 'default', attachments: att }],
      events: { onFinalSymbol: {}, onOffScreen: {}, onStopReelSound: {} },
      animations: { in: inAnim, out: outAnim, spin_loop: loop, spin_start: {}, spin_stop: stop }
    };
    return { name: name, json: json, regions: [{ name: tech.spacer, w: 1, h: 1, src: 'clear' }], loops: ['spin_loop'] };
  }

  function reelColumnsSpine(g, tech) {
    var C = g.C;
    var name = 'animation_reels_' + C + '_columns';
    var m = g.margin;
    var w = g.gridW + 2 * m, h = g.gridH + 2 * m;
    var bones = [{ name: 'root' }, { name: 'art', parent: 'root' }, { name: 'reel_root', parent: 'art' }, { name: 'reels', parent: 'reel_root' }];
    var i;
    for (i = 0; i < C; i++) {
      var b = { name: 'reel_' + i, parent: 'reels' };
      if (g.reelX[i]) b.x = g.reelX[i];
      bones.push(b);
    }
    bones.push({ name: 'reels_clipping', parent: 'reel_root' });
    bones.push({ name: 'dim', parent: 'root', scaleX: r4(w / 10), scaleY: r4(h / 10) });
    var slots = [{ name: 'reels_clipping', bone: 'reels_clipping', attachment: 'reels_clipping' }];
    var att = {
      dim: {},
      reels_clipping: { reels_clipping: { type: 'clipping', end: 'reels_clipping', vertexCount: 4, vertices: [-w / 2, h / 2, -w / 2, -h / 2, w / 2, -h / 2, w / 2, h / 2].map(r2) } }
    };
    att.dim[tech.white] = { width: 10, height: 10 };
    for (i = C - 1; i >= 0; i--) {
      slots.push({ name: 'reel_' + i, bone: 'reel_' + i, attachment: tech.spacer });
      att['reel_' + i] = {};
      att['reel_' + i][tech.spacer] = { width: 1, height: 1 };
    }
    slots.push({ name: 'dim', bone: 'dim', color: '00000000', attachment: tech.white });
    var ease = function (v0, v1) { return [0.2133, v0 + (v1 - v0) * IN_EASE[1], 0.2733, v0 + (v1 - v0) * IN_EASE[3]].map(r4); };
    var inAnim = { slots: {}, bones: { reel_root: { scale: [{ x: 1.5, y: 1.5, curve: ease(1.5, 1).concat(ease(1.5, 1)) }, { time: 0.6667 }] } } };
    for (i = 0; i < C; i++) {
      inAnim.slots['reel_' + i] = { rgba: [{ color: 'ffffff00', curve: ease(1, 1).concat(ease(1, 1), ease(1, 1), ease(0, 1)) }, { time: 0.6667, color: 'ffffffff' }] };
    }
    var json = {
      skeleton: skeleton(name, tech, corners(0, 0, w, h)),
      bones: bones,
      slots: slots,
      skins: [{ name: 'default', attachments: att }],
      animations: {
        dim_in: { slots: { dim: { rgba: [{ color: '00000000' }, { time: 0.2, color: '000000b4' }] } } },
        dim_out: { slots: { dim: { rgba: [{ color: '000000b4' }, { time: 0.2, color: '00000000' }] } } },
        in: inAnim,
        loop_1: {},
        out: {},
        pm_mg: {}
      }
    };
    return { name: name, json: json, regions: [{ name: tech.spacer, w: 1, h: 1, src: 'clear' }, { name: tech.white, w: 10, h: 10, src: 'white' }], loops: ['loop_1'] };
  }

  function frameGeometry(img, win, rect) {
    var sx = rect.w / (win.right - win.left);
    var sy = rect.h / (win.bottom - win.top);
    var left = -rect.w / 2 - win.left * sx;
    var right = left + img.w * sx;
    var topY = rect.h / 2 + win.top * sy;
    var bottom = topY - img.h * sy;
    return { x: r2((left + right) / 2), y: r2((topY + bottom) / 2), width: r2(right - left), height: r2(topY - bottom) };
  }

  function frameSpine(comp, g, px, tech) {
    var above = comp.type === 'frame_above';
    var name = above ? 'animation_reels_frame_above' : 'animation_reels_frame_under';
    var key = comp.type;
    var p = px(key);
    var m = g.margin, b = g.border;
    var box = above ? { w: g.gridW + 2 * b, h: g.gridH + 2 * b } : { w: g.gridW + 2 * m, h: g.gridH + 2 * m };
    var att;
    if (p && p.win) att = frameGeometry(p, p.win, { w: g.gridW, h: g.gridH });
    else if (p && p.uploaded) {
      var s = above ? Math.min(box.w / p.w, box.h / p.h) : Math.max(box.w / p.w, box.h / p.h);
      att = { width: r2(p.w * s), height: r2(p.h * s) };
    } else att = { width: box.w, height: box.h };
    if (!p) p = { w: Math.round(box.w), h: Math.round(box.h) };
    var halfW = g.gridW / 2 + (above ? b / 2 : m / 2), halfH = g.gridH / 2 + (above ? b / 2 : m / 2);
    var spacers = listOf(comp.spacers).map(slug).filter(Boolean).map(function (sl) { return { slot: sl, parent: 'reel_frame', x: sideX(sl, halfW), y: sideY(sl, halfH) }; });
    return rig({
      name: name,
      chain: ['art', 'reel_frame'],
      slot: 'frame',
      region: 'art/' + name.replace(/^animation_/, ''),
      att: att,
      px: p,
      src: key,
      spacers: spacers,
      skins: comp.skins,
      specs: specsFrom(comp.anims, 'frame'),
      ctx: { bone: 'reel_frame', slot: 'frame', w: att.width, h: att.height, cellH: g.H }
    }, tech);
  }

  function customSpine(comp, g, px, tech) {
    var name = 'animation_' + (slug(comp.name).replace(/^animation_/, '') || 'element');
    var key = 'c:' + comp.id;
    var p = px(key);
    var w = Number(comp.w) || (p ? p.w : 400), h = Number(comp.h) || (p ? p.h : 400);
    if (!p) p = { w: Math.round(w), h: Math.round(h) };
    var att = { x: Number(comp.x) || 0, y: Number(comp.y) || 0, width: w, height: h };
    var spacers = listOf(comp.spacers).map(slug).filter(Boolean).map(function (sl) { return { slot: sl, x: att.x + sideX(sl, w / 2), y: att.y + sideY(sl, h / 2) }; });
    return rig({
      name: name,
      chain: ['art'],
      slot: 'art',
      region: 'art/' + name.replace(/^animation_/, ''),
      att: att,
      px: p,
      src: key,
      spacers: spacers,
      skins: comp.skins,
      specs: specsFrom(comp.anims, 'custom'),
      ctx: { bone: 'art', slot: 'art', w: w, h: h, cellH: g.H }
    }, tech);
  }

  function pot(n) { var p = 16; while (p < n) p *= 2; return p; }

  function pack(regions, padding, maxPage) {
    var items = regions.slice().sort(function (a, b) { return b.h - a.h || b.w - a.w || (a.name < b.name ? -1 : 1); });
    var best = null;
    var widest = Math.max.apply(null, items.map(function (r) { return r.w; }));
    for (var W = pot(widest + padding); W <= Math.max(maxPage, pot(widest + padding)); W *= 2) {
      var x = padding, y = padding, rowH = 0, placed = [];
      items.forEach(function (r) {
        if (x + r.w + padding > W) { x = padding; y += rowH + padding; rowH = 0; }
        placed.push({ name: r.name, x: x, y: y, w: r.w, h: r.h, src: r.src });
        x += r.w + padding;
        rowH = Math.max(rowH, r.h);
      });
      var Hh = pot(y + rowH + padding);
      var cand = { width: W, height: Hh, placements: placed };
      if (!best || W * Hh < best.width * best.height || (W * Hh === best.width * best.height && Math.max(W, Hh) < Math.max(best.width, best.height))) best = cand;
      if (Hh <= W) break;
    }
    return best;
  }

  function atlasText(pageName, page) {
    var lines = ['', pageName, 'size: ' + page.width + ', ' + page.height, 'format: RGBA8888', 'filter: Linear, Linear', 'repeat: none'];
    page.placements.slice().sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; }).forEach(function (p) {
      lines.push(p.name, '  rotate: false', '  xy: ' + p.x + ', ' + p.y, '  size: ' + p.w + ', ' + p.h, '  orig: ' + p.w + ', ' + p.h, '  offset: 0, 0', '  index: -1');
    });
    return lines.join('\n') + '\n';
  }

  function durationOf(anim) {
    var max = 0;
    var walk = function (o) {
      if (Array.isArray(o)) o.forEach(function (k) { if (k && typeof k === 'object') { if (typeof k.time === 'number' && k.time > max) max = k.time; walk(k); } });
      else if (isObj(o)) Object.keys(o).forEach(function (k) { if (k !== 'curve') walk(o[k]); });
    };
    walk(anim || {});
    return r4(max);
  }

  function spacerSlots(json, key) {
    return (json.slots || []).filter(function (s) { return s.attachment === key; }).map(function (s) { return s.name; }).sort();
  }

  function contractEntry(spine, tech) {
    var json = spine.json;
    return {
      name: spine.name,
      skins: (json.skins || []).map(function (s) { return s.name; }),
      animations: Object.keys(json.animations).map(function (n) {
        var a = { name: n, duration: durationOf(json.animations[n]) };
        if (spine.loops.indexOf(n) !== -1) a.loop = true;
        var ev = (json.animations[n].events || []).map(function (e) { var o = { name: e.name }; if (e.int !== undefined) o.int = e.int; return o; });
        if (ev.length) a.events = ev;
        return a;
      }),
      decorationSpacers: spacerSlots(json, tech.spacer)
    };
  }

  function finalize(spine, tech) {
    var page = pack(spine.regions, tech.padding, tech.maxPage);
    var pageName = spine.name + '.png';
    var importJson = clone(spine.json);
    importJson.skeleton.images = './images/';
    var warnings = [];
    if (page.width > tech.maxPage || page.height > tech.maxPage) warnings.push('Атлас ' + page.width + '×' + page.height + ' більший за ' + tech.maxPage + ' px');
    return Object.assign({}, spine, {
      pageName: pageName,
      page: page,
      atlasText: atlasText(pageName, page),
      jsonText: JSON.stringify(spine.json),
      importJsonText: JSON.stringify(importJson, null, 2),
      contract: contractEntry(spine, tech),
      warnings: warnings
    });
  }

  function planAll(settings, px) {
    var tech = Object.assign({}, TECH, settings.tech || {});
    var g = geometry(settings);
    var groups = [];
    (settings.components || []).forEach(function (comp) {
      if (comp.on === false) return;
      var list = [];
      if (comp.type === 'symbols') list = symbolSpines(comp, settings, g, px, tech);
      else if (comp.type === 'reels') list = [reelColumnsSpine(g, tech), reelRowsSpine(g, tech)];
      else if (comp.type === 'frame_under' || comp.type === 'frame_above') list = [frameSpine(comp, g, px, tech)];
      else list = [customSpine(comp, g, px, tech)];
      groups.push({ id: comp.id, spines: list.map(function (sp) { var f = finalize(sp, tech); f.comp = comp.id; return f; }) });
    });
    var seen = {};
    groups.forEach(function (gr) {
      gr.spines.forEach(function (sp) {
        if (seen[sp.name]) sp.warnings.push('Назва ' + sp.name + ' вже є в іншому компоненті');
        seen[sp.name] = true;
      });
    });
    return { tech: tech, geometry: g, groups: groups, spines: groups.reduce(function (a, gr) { return a.concat(gr.spines); }, []) };
  }

  function findWindow(alpha, width, height, threshold) {
    var t = threshold === undefined ? 127 : threshold;
    var sx = Math.floor(width / 2), sy = Math.floor(height / 2);
    if (alpha[sy * width + sx] > t) return null;
    var seen = new Uint8Array(width * height);
    var queue = new Int32Array(width * height);
    var head = 0, tail = 0;
    queue[tail++] = sy * width + sx;
    seen[sy * width + sx] = 1;
    var minX = sx, maxX = sx, minY = sy, maxY = sy, touches = false;
    while (head < tail) {
      var idx = queue[head++];
      var x = idx % width, y = (idx - x) / width;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      var nb = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
      for (var i = 0; i < 4; i++) {
        var nx = nb[i][0], ny = nb[i][1];
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) { touches = true; continue; }
        var ni = ny * width + nx;
        if (!seen[ni] && alpha[ni] <= t) { seen[ni] = 1; queue[tail++] = ni; }
      }
    }
    if (touches) return null;
    return { left: minX, top: minY, right: maxX + 1, bottom: maxY + 1 };
  }

  function readme(settings, plan) {
    var t = plan.tech;
    var lines = [
      'Spine-чернетки: ' + (settings.game || 'гра') + ', сітка ' + plan.geometry.C + '×' + plan.geometry.R + ', клітинка ' + plan.geometry.W + '×' + plan.geometry.H + ' px',
      '',
      t.folder + '   готові .json, .atlas, .png для арт-репо',
      'spine-editor/<назва>/   те саме для Spine Editor: Import Data, картинки в images/',
      '',
      'Не міняйте назви спайнів, скінів, анімацій, слотів і регіонів.',
      'Експорт: Spine ' + t.spineVersion + ', JSON з атласом, без Nonessential data, useIndexes: false.',
      '',
      plan.spines.map(function (s) { return s.name; }).join('\n'),
      '',
      'Spine Draft Kit ' + VERSION
    ];
    return lines.join('\n') + '\n';
  }

  function validatorParseAtlas(txt) {
    var lines = String(txt).split(/\r\n|\r|\n/);
    var output = {}, child = {}, parent;
    lines.forEach(function (line) {
      if (line === '') { child = {}; parent = ''; }
      else if (!parent) { parent = line.trim(); output[parent] = child; }
      else if (line.indexOf(':') !== -1) {
        var parts = line.split(':').map(function (s) { return s.trim(); });
        child[parts[0]] = parts[1].indexOf(',') !== -1 ? parts[1].split(',').map(function (s) { return s.trim(); }) : parts[1];
      } else { child = {}; output[parent][line.trim()] = child; }
    });
    return output;
  }

  function isAttachedImage(a) {
    return Object.keys(a).length > 0 && (a.type === 'mesh' || a.width !== undefined || a.height !== undefined || a.x !== undefined || a.y !== undefined) && !a.name && !a.path && a.type !== 'clipping';
  }
  function attachedImageName(a, key) {
    if (isAttachedImage(a)) return key;
    if (a.path && typeof a.path === 'string' && !a.attachments) return a.path;
    if (a.name && !a.attachments && a.type !== 'clipping') return a.name;
    return undefined;
  }
  function validatorAttachments(json) {
    var skins = json.skins;
    if (!skins) return [];
    var list = [];
    var arr = Array.isArray(skins) ? skins : Object.keys(skins).map(function (k) { return { attachments: skins[k] }; });
    arr.forEach(function (skin) {
      var att = skin && skin.attachments;
      if (!att) return;
      Object.keys(att).forEach(function (slot) {
        var cur = att[slot];
        if (!isObj(cur)) return;
        Object.keys(cur).forEach(function (child) {
          if (!isObj(cur[child])) return;
          var n = attachedImageName(cur[child], child);
          if (n && list.indexOf(n) === -1) list.push(n);
        });
      });
    });
    return list;
  }

  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (isObj(v)) return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
    return JSON.stringify(v);
  }
  function diff(expected, actual) {
    return { missing: expected.filter(function (x) { return actual.indexOf(x) === -1; }), extra: actual.filter(function (x) { return expected.indexOf(x) === -1; }) };
  }
  function diffText(d) {
    return [d.missing.length ? 'бракує: ' + d.missing.join(', ') : '', d.extra.length ? 'зайві: ' + d.extra.join(', ') : ''].filter(Boolean).join('; ');
  }
  function fmt(v) { return String(roundTo(v, 3)).replace('.', ','); }

  function checkExport(input, contract) {
    var tech = Object.assign({}, TECH, contract.tech || {});
    var out = [];
    var add = function (level, title, detail) { out.push({ level: level, title: title, detail: detail || '' }); };
    var json;
    try { json = JSON.parse(input.jsonText); } catch (e) { add('error', 'Файл не читається як JSON', String(e && e.message)); return done(); }
    if (!isObj(json) || !isObj(json.skeleton)) { add('error', 'Це не файл Spine: немає skeleton'); return done(); }
    var name = String(input.spineName || '').replace(/\.json$/i, '');
    var entry = (contract.spines || []).filter(function (s) { return s.name === name; })[0];
    var sk = json.skeleton;
    if (sk.spine !== tech.spineVersion) add('error', 'Версія Spine ' + (sk.spine || '—') + ', потрібна ' + tech.spineVersion);
    if (sk.images || sk.audio) add('error', 'Експортовано з Nonessential data', 'skeleton.' + (sk.images ? 'images' : 'audio'));
    if (typeof sk.hash === 'string' && sk.hash.indexOf('draft-') === 0) add('info', 'Це ще чернетка', sk.hash);
    var skins = (Array.isArray(json.skins) ? json.skins.map(function (s) { return s.name; }) : Object.keys(json.skins || {})).sort();
    var anims = Object.keys(json.animations || {});
    if (!entry) add('warning', 'Назви ' + (name || '—') + ' немає серед компонентів кита');
    else {
      if (canon(entry.skins.slice().sort()) !== canon(skins)) add('error', 'Скіни не ті', diffText(diff(entry.skins, skins)));
      var exp = entry.animations.map(function (a) { return a.name; });
      if (canon(exp) !== canon(anims)) {
        var da = diff(exp, anims);
        if (!da.missing.length && !da.extra.length) add('error', 'Анімації в іншому порядку', 'треба: ' + exp.join(', '));
        else add('error', 'Анімації не ті', diffText(da));
      }
      var sp = spacerSlots(json, tech.spacer);
      if (canon(entry.decorationSpacers) !== canon(sp)) add('error', 'Слоти-спейсери не ті', diffText(diff(entry.decorationSpacers, sp)));
      entry.animations.forEach(function (a) {
        var got = ((json.animations || {})[a.name] || {}).events || [];
        var gotN = got.map(function (e) { var o = { name: e.name }; if (e.int !== undefined && e.int !== 0) o.int = e.int; return o; });
        if (canon(a.events || []) !== canon(gotN)) add('error', 'Події в ' + a.name + ' не ті', 'треба: ' + ((a.events || []).map(function (e) { return e.name + (e.int ? '(' + e.int + ')' : ''); }).join(', ') || 'немає'));
        var actual = durationOf((json.animations || {})[a.name]);
        if (a.duration && actual && Math.abs(actual - a.duration) / a.duration > tech.timingTolerance) add('warning', a.name + ': ' + fmt(actual) + ' с замість ' + fmt(a.duration) + ' с');
      });
    }
    var atts = validatorAttachments(json);
    atts.forEach(function (a) {
      if (a.indexOf(' ') !== -1) add('error', 'Пробіл у назві вкладення', a);
      if (a.indexOf('txt/references/') !== -1) add('error', 'Референсна картинка в експорті', a);
    });
    if (input.atlasText) {
      var parsed = {};
      try { parsed = validatorParseAtlas(input.atlasText); } catch (e) { add('error', 'Атлас не читається'); }
      var pages = Object.keys(parsed);
      var regions = [];
      pages.forEach(function (pg) { Object.keys(parsed[pg]).forEach(function (k) { if (isObj(parsed[pg][k])) regions.push({ page: pg, name: k, r: parsed[pg][k] }); }); });
      var names = regions.map(function (r) { return r.name; });
      if (pages.length && pages[0].replace(/\.[^.]+$/, '') !== name) add('error', 'Перша сторінка атласу ' + pages[0] + ', а спайн ' + name);
      regions.forEach(function (r) {
        if (r.r.index !== undefined && parseInt(r.r.index, 10) >= 0) add('warning', 'Атлас з індексами: ' + r.name + ' index ' + r.r.index, 'пакуйте з useIndexes: false');
        if (r.r.rotate !== undefined && ['true', 'false', '0', '90'].indexOf(String(r.r.rotate)) === -1) add('error', 'Регіон ' + r.name + ': rotate ' + r.r.rotate);
      });
      atts.forEach(function (a) { if (names.indexOf(a) === -1) add('error', 'Регіону ' + a + ' немає в атласі'); });
      var pngs = input.pngs || {};
      if (Object.keys(pngs).length) {
        pages.forEach(function (pg) {
          var img = pngs[pg];
          if (!img) { add('error', 'Немає сторінки ' + pg); return; }
          var size = parsed[pg].size ? [].concat(parsed[pg].size).join(',').split(',').map(function (x) { return parseInt(x, 10); }) : null;
          if (size && (size[0] !== img.width || size[1] !== img.height)) add('error', pg + ': в атласі ' + size[0] + '×' + size[1] + ', PNG ' + img.width + '×' + img.height);
          regions.filter(function (r) { return r.page === pg; }).forEach(function (r) {
            var xy = [].concat(r.r.xy || []).join(',').split(',').map(function (x) { return parseInt(x, 10); });
            var sz = [].concat(r.r.size || []).join(',').split(',').map(function (x) { return parseInt(x, 10); });
            var rot = ['true', '90', '270'].indexOf(String(r.r.rotate)) !== -1;
            if (xy.length === 2 && sz.length === 2 && (xy[0] + (rot ? sz[1] : sz[0]) > img.width || xy[1] + (rot ? sz[0] : sz[1]) > img.height)) add('error', 'Регіон ' + r.name + ' за межами сторінки');
          });
        });
      } else add('info', 'PNG не додано: розміри сторінок не перевірено');
    } else add('info', 'Атлас не додано: регіони не перевірено');
    return done();

    function done() {
      var order = { error: 0, warning: 1, info: 2 };
      out.sort(function (a, b) { return order[a.level] - order[b.level]; });
      var counts = { error: 0, warning: 0, info: 0 };
      out.forEach(function (f) { counts[f.level]++; });
      return { name: name, entry: entry || null, findings: out, counts: counts };
    }
  }

  function pngSize(bytes) {
    if (!bytes || bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null;
    var u32 = function (o) { return ((bytes[o] << 24) >>> 0) + (bytes[o + 1] << 16) + (bytes[o + 2] << 8) + bytes[o + 3]; };
    return { width: u32(16), height: u32(20) };
  }

  root.SpineDraftKit = {
    VERSION: VERSION,
    TECH: TECH,
    PRESETS: PRESETS,
    slug: slug,
    listOf: listOf,
    presetFor: presetFor,
    parseEvents: parseEvents,
    geometry: geometry,
    planAll: planAll,
    bundle: function (name, json, regions, tech) {
      var t = Object.assign({}, TECH, tech || {});
      var page = pack(regions, t.padding, t.maxPage);
      return { name: name, json: json, jsonText: JSON.stringify(json), page: page, pageName: name + '.png', atlasText: atlasText(name + '.png', page) };
    },
    contain: contain,
    findWindow: findWindow,
    readme: readme,
    checkExport: checkExport,
    durationOf: durationOf,
    pngSize: pngSize,
    roundTo: roundTo
  };
})(typeof window !== 'undefined' ? window : globalThis);
