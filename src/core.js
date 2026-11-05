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
      (ctx.also || []).forEach(function (s) { anim.slots[s] = clone(anim.slots[ctx.slot]); });
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
  function fit(w, h, maxW, maxH) {
    var s = Math.min(maxW / w, maxH / h);
    return { width: r2(w * s), height: r2(h * s) };
  }
  function symbolFill(comp) {
    var f = Number(comp && comp.fill);
    return f > 0 ? Math.min(100, f) / 100 : 0.84;
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
  var SPACER_AT = /^(.*?)\s*@\s*(-?\d+(?:\.\d+)?)\s*:\s*(-?\d+(?:\.\d+)?)$/;
  function spacerItem(s) {
    var m = SPACER_AT.exec(String(s).trim());
    var sl = slug(m ? m[1] : s);
    return sl && m ? sl + '@' + Number(m[2]) + ':' + Number(m[3]) : sl;
  }
  function spacerList(list, halfW, halfH) {
    return listOf(list).map(function (s) {
      var m = SPACER_AT.exec(s);
      var sl = slug(m ? m[1] : s);
      return sl ? { slot: sl, x: m ? Number(m[2]) : sideX(sl, halfW), y: m ? Number(m[3]) : sideY(sl, halfH) } : null;
    }).filter(Boolean);
  }

  function rig(o, tech) {
    var bones = [{ name: 'root' }];
    var used = { root: true };
    var add = function (b) { if (!used[b.name]) { used[b.name] = true; bones.push(b); } };
    var parent = 'root';
    var at = { x: r2((o.at && o.at.x) || 0), y: r2((o.at && o.at.y) || 0) };
    o.chain.forEach(function (n, i) {
      var b = { name: n, parent: parent };
      if (!i && at.x) b.x = at.x;
      if (!i && at.y) b.y = at.y;
      add(b);
      parent = n;
    });
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
    var pts = corners(at.x + (o.att.x || 0), at.y + (o.att.y || 0), o.att.width, o.att.height);
    (o.spacers || []).forEach(function (sp) {
      if (att[sp.slot]) return;
      var bn = used[sp.bone || sp.slot] ? sp.slot + '_bone' : (sp.bone || sp.slot);
      var b = { name: bn, parent: sp.parent || 'root' };
      if (r2(sp.x || 0)) b.x = r2(sp.x);
      if (r2(sp.y || 0)) b.y = r2(sp.y);
      add(b);
      var key = sp.key || tech.spacer;
      slots.push({ name: sp.slot, bone: bn, attachment: key });
      att[sp.slot] = {};
      att[sp.slot][key] = Object.assign(key === tech.spacer ? {} : { path: tech.spacer }, sp.att ? clone(sp.att) : { width: 1, height: 1 });
      var off = sp.parent === o.chain[0] ? at : { x: 0, y: 0 };
      pts = pts.concat(corners(off.x + (sp.x || 0), off.y + (sp.y || 0), 1, 1));
    });
    var skins = listOf(o.skins).map(slug).filter(function (s, i, a) { return s && a.indexOf(s) === i; });
    if (!skins.length) skins = ['default'];
    var skinList = skins.indexOf('default') !== -1
      ? skins.map(function (s) { return s === 'default' ? { name: 'default', attachments: att } : { name: s }; })
      : skins.map(function (s) { return { name: s, attachments: clone(att) }; });
    var json = { skeleton: skeleton(o.name, tech, pts), bones: bones, slots: slots, skins: skinList, animations: {} };
    o.specs.forEach(function (sp) {
      if (!sp.name || json.animations[sp.name]) return;
      json.animations[sp.name] = buildAnimation(sp, sp.ctx || o.ctx);
    });
    var regions = [{ name: o.region, w: o.px.w, h: o.px.h, src: o.src }];
    if ((o.spacers || []).length) regions.push({ name: tech.spacer, w: 1, h: 1, src: 'clear' });
    return { name: o.name, json: withEvents(json), regions: regions, loops: o.specs.filter(function (s) { return s.loop; }).map(function (s) { return s.name; }) };
  }

  function symbolSpines(comp, s, g, px, tech) {
    var out = [];
    var shared = specsFrom(comp.anims, 'symbol');
    var statics = [];
    var fill = symbolFill(comp);
    var blurOn = comp.blur !== false;
    (comp.symbols || []).forEach(function (sym) {
      var name = slug(sym.name);
      if (!name) return;
      var key = 'sym:' + name;
      var p = px(key) || { w: Math.round(0.86 * g.W), h: Math.round(0.86 * g.H) };
      var att = fit(p.w, p.h, fill * g.W, fill * g.H);
      var region = 'art/reels/' + name;
      var blur = null;
      var bp = blurOn && px('blur:' + name);
      if (bp) {
        var k = att.width / p.w;
        blur = { region: region + '_blur', key: 'blur:' + name, px: bp, att: { width: r2(bp.w * k), height: r2(bp.h * k) } };
      }
      statics.push({ name: name, region: region, att: att, px: p, key: key, blur: blur });
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
        [x, x.blur || x].forEach(function (v, i) {
          var a = { symbols: { symbols: { name: v.region, width: v.att.width, height: v.att.height } } };
          skins.push({ name: 'symbol_' + x.name + (i ? '_blur' : ''), attachments: a });
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
      statics.forEach(function (x) {
        [x, x.blur].forEach(function (v) { if (v && !seen[v.region]) { seen[v.region] = true; regions.push({ name: v.region, w: v.px.w, h: v.px.h, src: v.key }); } });
      });
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
  function curveOf(p) { return [r4(p[1][0]), 0, r4(p[2][0]), 0, r4(p[1][0]), r4(p[1][1]), r4(p[2][0]), r4(p[2][1])]; }
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
    var spacers = spacerList(comp.spacers, halfW, halfH).map(function (sp) { sp.parent = 'reel_frame'; return sp; });
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

  function barOf(s) {
    var n = String(s || '').split(':').map(function (v) { return Number(String(v).trim()); });
    if (n.length !== 4 || !n.every(isFinite) || n[2] <= 0 || n[3] <= 0) return null;
    return { x: n[0], y: n[1], w: n[2], h: n[3] };
  }

  var BAR_OUT = [0, 0, 0.58, 1];
  var BAR_IO = [0.42, 0, 0.58, 1];
  var BAR_OVER = [0.3, 1.3, 0.5, 1];

  function barKeys(keys, kind) {
    return keys.map(function (k, i) {
      var o = {};
      if (r4(k[0])) o.time = r4(k[0]);
      var v = k[1];
      if (kind === 'att') { o.name = v; return o; }
      if (kind === 'alpha') o.value = r4(v);
      else if (kind === 'x') { if (r4(v)) o.x = r4(v); }
      else if (kind === 'sx') { if (r4(v) !== 1) o.x = r4(v); }
      else if (r4(v) !== 1) { o.x = r4(v); o.y = r4(v); }
      var n = keys[i + 1], e = k[2];
      if (n && e === 'stepped') o.curve = 'stepped';
      else if (n && e) {
        var ch = function (v0, v1) { return [r4(k[0] + (n[0] - k[0]) * e[0]), r4(v0 + (v1 - v0) * e[1]), r4(k[0] + (n[0] - k[0]) * e[2]), r4(v0 + (v1 - v0) * e[3])]; };
        var cx = ch(v, n[1]);
        o.curve = kind === 'alpha' ? cx : kind === 'x' ? cx.concat(ch(0, 0)) : kind === 'sx' ? cx.concat(ch(1, 1)) : cx.concat(cx);
      }
      return o;
    });
  }

  function barAnim(t) {
    var a = {};
    Object.keys(t).forEach(function (path) {
      var p = path.split('.');
      var group = p[2] === 'alpha' || p[2] === 'att' ? 'slots' : 'bones';
      var type = { x: 'translate', scale: 'scale', sx: 'scale', alpha: 'alpha', att: 'attachment' }[p[2]];
      a[group] = a[group] || {};
      a[group][p[0]] = a[group][p[0]] || {};
      a[group][p[0]][type] = barKeys(t[path], p[2]);
    });
    return a;
  }

  function mergeAnim(a, b) {
    var out = clone(a || {});
    ['bones', 'slots'].forEach(function (g) {
      if (!b[g]) return;
      out[g] = out[g] || {};
      Object.keys(b[g]).forEach(function (n) { out[g][n] = Object.assign(out[g][n] || {}, b[g][n]); });
    });
    return out;
  }

  function pulseKeys(t, from, peak, at, end, e) { return [[t, from, e || BAR_OUT], [t + at, peak, e || BAR_OUT], [t + end, from]]; }

  function withBar(spine, b, name, tech) {
    var json = spine.json;
    var w = r2(b.w), h = r2(b.h), hw = r2(w / 2), hh = r2(h / 2);
    var r = r2(Math.min(hh, 0.175 * h));
    var sw = r2(h * 1.4), head = { w: r2(h * 0.9), h: r2(h * 1.5) }, glow = { w: r2(w + h * 0.8), h: r2(h * 2.2) };
    var base = 'art/' + name.replace(/^animation_/, '') + '_bar_';
    var bone = function (n, parent, x, y) { var o = { name: n, parent: parent }; if (r2(x || 0)) o.x = r2(x); if (r2(y || 0)) o.y = r2(y); return o; };
    var track = bone('bar_shine_track', 'bar_sweep');
    track.transform = 'noScale';
    json.bones.push(bone('bar', 'art', b.x, b.y), bone('bar_fill', 'bar', -w), bone('bar_head', 'bar_fill', hw), bone('bar_sweep', 'bar', -hw), track, bone('bar_shine', 'bar_shine_track', -sw / 2));
    var slots = [
      { name: 'bar_glow', bone: 'bar', color: 'ffffff00', attachment: base + 'glow', blend: 'additive' },
      { name: 'bar_clip', bone: 'bar', attachment: 'bar_clip' },
      { name: 'bar_fill', bone: 'bar_fill', attachment: base + 'fill' },
      { name: 'bar_flash', bone: 'bar_fill', color: 'ffffff00', attachment: base + 'flash', blend: 'additive' },
      { name: 'bar_head', bone: 'bar_head', attachment: base + 'head', blend: 'additive' },
      { name: 'bar_shine_clip', bone: 'bar', attachment: 'bar_shine_clip' },
      { name: 'bar_shine', bone: 'bar_shine', blend: 'additive' }
    ];
    var at = json.slots.map(function (s) { return s.name; }).indexOf('art');
    json.slots.splice.apply(json.slots, [at + 1, 0].concat(slots));
    var arc = [];
    [[hw - r, hh - r, 90], [hw - r, -hh + r, 0], [-hw + r, -hh + r, -90], [-hw + r, hh - r, -180]].forEach(function (k) {
      for (var j = 0; j <= 4; j++) { var t = (k[2] - j * 22.5) * Math.PI / 180; arc.push(r2(k[0] + r * Math.cos(t)), r2(k[1] + r * Math.sin(t))); }
    });
    var bi = function (n) { return json.bones.map(function (x) { return x.name; }).indexOf(n); };
    var c = r2(r * 0.6), B = bi('bar'), F = bi('bar_fill');
    var cut = [[B, -hw + c, hh], [F, hw - c, hh], [F, hw, hh - c], [F, hw, -hh + c], [F, hw - c, -hh], [B, -hw + c, -hh], [B, -hw, -hh + c], [B, -hw, hh - c]];
    var att = {
      bar_glow: {}, bar_fill: {}, bar_shine: {}, bar_flash: {}, bar_head: {},
      bar_clip: { bar_clip: { type: 'clipping', end: 'bar_head', vertexCount: arc.length / 2, vertices: arc } },
      bar_shine_clip: { bar_shine_clip: { type: 'clipping', end: 'bar_shine', vertexCount: cut.length, vertices: [].concat.apply([], cut.map(function (v) { return [1, v[0], r2(v[1]), r2(v[2]), 1]; })) } }
    };
    att.bar_glow[base + 'glow'] = { width: glow.w, height: glow.h };
    att.bar_fill[base + 'fill'] = { width: w, height: h };
    att.bar_shine[base + 'shine'] = { width: sw, height: h };
    att.bar_flash[base + 'flash'] = { width: w, height: h };
    att.bar_head[base + 'head'] = { width: head.w, height: head.h };
    json.skins.forEach(function (s) { if (s.attachments) Object.assign(s.attachments, clone(att)); });
    var R = Math.round;
    var src = function (kind, rw, rh) { return 'bar:' + kind + ':' + R(rw) + ':' + R(rh) + ':' + R(r); };
    spine.regions.push(
      { name: base + 'fill', w: R(w), h: R(h), src: src('fill', w, h) },
      { name: base + 'flash', w: R(w), h: R(h), src: src('flash', w, h) },
      { name: base + 'shine', w: R(sw), h: R(h), src: src('shine', sw, h) },
      { name: base + 'head', w: R(head.w), h: R(head.h), src: src('head', head.w, head.h) },
      { name: base + 'glow', w: R(glow.w), h: R(glow.h), src: 'bar:glow:' + R(glow.w) + ':' + R(glow.h) + ':' + R(r) + ':' + R(w) + ':' + R(h) }
    );
    var shown = [[0, null, 'stepped'], [0.04, base + 'shine']];
    var anims = json.animations;
    var loops = Object.keys(anims).filter(function (n) { return /^(loop|idle)/.test(n); });
    if (!loops.length) { anims.loop_1 = {}; loops = ['loop_1']; spine.loops.push('loop_1'); }
    loops.forEach(function (n) {
      var d = durationOf(anims[n]) || 1.6;
      anims[n] = mergeAnim(anims[n], barAnim({ 'bar_shine_track..x': [[0, 0], [d, w]], 'bar_shine..x': [[0, 0], [d, sw]] }));
    });
    var own = {
      progress: { 'bar_fill..x': [[0, 0], [1, w]], 'bar_sweep..sx': [[0, 0.001], [1, 1]], 'bar_shine..att': shown },
      add: { 'bar_head..scale': pulseKeys(0, 1, 1.6, 0.14, 0.35), 'bar_flash..alpha': pulseKeys(0, 0, 0.5, 0.14, 0.35) },
      anticipation: { 'bar_glow..alpha': pulseKeys(0, 0.3, 0.85, 0.575, 1.15, BAR_IO), 'bar_head..scale': pulseKeys(0, 1, 1.3, 0.575, 1.15, BAR_IO) },
      trigger: {
        'art..scale': pulseKeys(0, 1, 1.035, 0.23, 1.15),
        'bar_glow..alpha': pulseKeys(0, 0, 1, 0.23, 1.15),
        'bar_flash..alpha': pulseKeys(0, 0, 0.85, 0.23, 0.9),
        'bar_head..scale': pulseKeys(0, 1, 2, 0.23, 1.15)
      }
    };
    var steps = [[0.4, 0.3], [1.6, 0.55], [2.8, 0.8], [4, 1]];
    var fill = [[0, 0]], sweep = [[0, 0.001]], head = [[0, 1]], flash = [[0, 0]];
    steps.forEach(function (s, i) {
      var from = i ? steps[i - 1][1] : 0;
      fill.push([s[0], from * w, BAR_OVER], [s[0] + 0.7, s[1] * w]);
      sweep.push([s[0], Math.max(0.001, from), BAR_OVER], [s[0] + 0.7, s[1]]);
      if (s[1] < 1) { head = head.concat(pulseKeys(s[0], 1, 1.6, 0.14, 0.35)); flash = flash.concat(pulseKeys(s[0], 0, 0.5, 0.14, 0.35)); }
    });
    var tg = 4.7, drain = tg + 1.15;
    fill.push([drain, w, BAR_IO], [drain + 0.5, 0], [drain + 0.8, 0]);
    sweep.push([drain, 1, BAR_IO], [drain + 0.5, 0.001], [drain + 0.8, 0.001]);
    flash = flash.concat(pulseKeys(tg, 0, 0.85, 0.23, 0.9));
    var shineAt = function (len) { var k = []; for (var i = 0; i < 4; i++) k.push([i * 1.6, 0], [(i + 1) * 1.6 - 0.0333, len, 'stepped']); return k.concat([[6.4, 0]]); };
    own.demo = {
      'bar_fill..x': fill,
      'bar_sweep..sx': sweep,
      'bar_flash..alpha': flash,
      'bar_shine_track..x': shineAt(w),
      'bar_shine..x': shineAt(sw),
      'bar_shine..att': [[0, null, 'stepped'], [0.46, base + 'shine', 'stepped'], [drain + 0.42, null]],
      'bar_glow..alpha': [[0, 0], [3.4, 0], [3.5, 0.3, BAR_IO], [4.075, 0.85, BAR_IO], [tg, 0.3, BAR_OUT], [tg + 0.23, 1, BAR_OUT], [drain, 0]],
      'bar_head..scale': head.concat([[3.5, 1, BAR_IO], [4.075, 1.3, BAR_IO], [tg, 1, BAR_OUT], [tg + 0.23, 2, BAR_OUT], [drain, 1]]),
      'art..scale': pulseKeys(tg, 1, 1.035, 0.23, 1.15)
    };
    Object.keys(own).forEach(function (n) { anims[n] = mergeAnim(anims[n], barAnim(own[n])); });
    if (spine.loops.indexOf('anticipation') === -1) spine.loops.push('anticipation');
    return spine;
  }

  var PIVOTS = { center: [0, 0], bottom: [0, -0.5], top: [0, 0.5], left: [-0.5, 0], right: [0.5, 0] };
  var PIVOT_AT = /^\s*(-?\d+(?:\.\d+)?)\s*:\s*(-?\d+(?:\.\d+)?)\s*$/;
  var BLENDS = ['normal', 'additive', 'multiply', 'screen'];
  var SHAPES = ['', 'rect', 'circle', 'ring', 'glow', 'star'];
  var BAR_NAMES = ['bar', 'bar_fill', 'bar_shine', 'bar_head', 'bar_glow', 'bar_clip', 'bar_flash'];
  var KEY_NUM = ['x', 'y', 'scale', 'sx', 'sy', 'rotate', 'alpha'];

  function pivotName(v) {
    var s = String(v === undefined || v === null ? '' : v).trim().toLowerCase();
    if (!s || s === 'center') return '';
    if (PIVOTS[s]) return s;
    var m = PIVOT_AT.exec(s);
    return m ? Number(m[1]) + ':' + Number(m[2]) : '';
  }
  function pivotOf(v, w, h) {
    var s = pivotName(v);
    var m = PIVOT_AT.exec(s);
    if (m) return { x: Number(m[1]), y: Number(m[2]) };
    var p = PIVOTS[s] || PIVOTS.center;
    return { x: r2(p[0] * w), y: r2(p[1] * h) };
  }
  function hexOf(v) {
    var s = String(v || '').trim().replace(/^#/, '').toLowerCase();
    return /^[0-9a-f]{6}$/.test(s) ? s : '';
  }
  function given(v) { return v !== undefined && v !== null && v !== '' && isFinite(Number(v)); }

  function normPart(p) {
    if (!isObj(p)) return null;
    var name = slug(p.name);
    if (!name) return null;
    var o = { name: name, parent: slug(p.parent) || 'art', x: given(p.x) ? r2(Number(p.x)) : 0, y: given(p.y) ? r2(Number(p.y)) : 0 };
    if (given(p.w) && Number(p.w) > 0) o.w = r2(Number(p.w));
    if (given(p.h) && Number(p.h) > 0) o.h = r2(Number(p.h));
    var pv = pivotName(p.pivot);
    if (pv) o.pivot = pv;
    if (given(p.rotate) && r2(Number(p.rotate))) o.rotate = r2(Number(p.rotate));
    if (p.behind === true) o.behind = true;
    if (BLENDS.indexOf(p.blend) > 0) o.blend = p.blend;
    if (given(p.alpha) && Number(p.alpha) < 1) o.alpha = r4(Math.max(0, Number(p.alpha)));
    if (SHAPES.indexOf(p.shape) > 0) o.shape = p.shape;
    var c = hexOf(p.color);
    if (c) o.color = c;
    return o;
  }

  function easeOf(e) {
    if (e === 'stepped') return 'stepped';
    if (Array.isArray(e)) return e.length === 4 && e.every(function (v) { return given(v); }) ? e.map(Number) : null;
    return EASE[e] || null;
  }

  function normKeys(raw) {
    var errors = [], out = {};
    var src = raw;
    if (typeof src === 'string') {
      if (!src.trim()) return { keys: out, errors: errors };
      try { src = JSON.parse(src); } catch (e) { return { keys: out, errors: ['ключі не читаються як JSON: ' + e.message] }; }
    }
    if (src === undefined || src === null) return { keys: out, errors: errors };
    if (!isObj(src)) return { keys: out, errors: ['ключі мають бути обʼєктом { "частина": [ { "t": 0, ... } ] }'] };
    Object.keys(src).forEach(function (target) {
      var name = target === 'all' ? 'all' : slug(target);
      if (!name) { errors.push('частина без назви'); return; }
      var list = src[target];
      if (!Array.isArray(list)) { errors.push(name + ': потрібен масив ключів'); return; }
      var keys = [];
      list.forEach(function (k, i) {
        var at = name + '[' + i + ']';
        if (!isObj(k)) { errors.push(at + ': ключ має бути обʼєктом'); return; }
        var t = Number(k.t !== undefined ? k.t : k.time);
        if (!given(k.t !== undefined ? k.t : k.time) || t < 0) { errors.push(at + ': потрібен t ≥ 0, секунди'); return; }
        var o = { t: r4(t) };
        Object.keys(k).forEach(function (f) {
          if (f === 't' || f === 'time') return;
          var v = k[f];
          if (KEY_NUM.indexOf(f) !== -1) {
            if (!given(v)) { errors.push(at + ': ' + f + ' має бути числом'); return; }
            o[f] = f === 'alpha' ? r4(Math.max(0, Math.min(1, Number(v)))) : r4(Number(v));
          } else if (f === 'color') {
            if (hexOf(v)) o.color = hexOf(v);
            else errors.push(at + ': color як "ffcc00"');
          } else if (f === 'ease') {
            if (v === 'linear' || v === null || v === '') return;
            if (easeOf(v)) o.ease = Array.isArray(v) ? v.map(Number) : v;
            else errors.push(at + ': ease ' + JSON.stringify(v) + ' невідомий');
          } else errors.push(at + ': невідоме поле ' + f);
        });
        keys.push(o);
      });
      keys.sort(function (a, b) { return a.t - b.t; });
      if (keys.length) out[name] = keys;
    });
    return { keys: out, errors: errors };
  }

  function keyGroup(list, names, init) {
    var has = list.filter(function (k) { return names.some(function (n) { return k[n] !== undefined; }); });
    if (!has.length) return null;
    var cur = init.slice(), out = [];
    if (has[0].t > 0) out.push({ t: 0, v: init.slice(), e: null });
    has.forEach(function (k) {
      names.forEach(function (n, j) { if (k[n] !== undefined) cur[j] = k[n]; });
      out.push({ t: k.t, v: cur.slice(), e: easeOf(k.ease) });
    });
    return out;
  }
  function keyTrack(list, frame) {
    return list.map(function (k, i) {
      var o = {};
      if (r4(k.t)) o.time = r4(k.t);
      var body = frame(k.v);
      Object.keys(body).forEach(function (f) { o[f] = body[f]; });
      var n = list[i + 1];
      if (n && k.e === 'stepped') o.curve = 'stepped';
      else if (n && k.e) {
        o.curve = [];
        k.v.forEach(function (v, j) { bezier(k.t, n.t, v, n.v[j], k.e).forEach(function (q) { o.curve.push(q); }); });
      }
      return o;
    });
  }

  function keyedAnim(keys, json, fade) {
    var anim = {}, notes = [];
    var bones = {}, slots = {}, tint = {};
    json.bones.forEach(function (b) { bones[b.name] = b; });
    json.slots.forEach(function (s) { slots[s.name] = s; });
    var names = Object.keys(keys).sort(function (a, b) { return (a === 'all' ? 0 : 1) - (b === 'all' ? 0 : 1); });
    names.forEach(function (target) {
      var list = keys[target].map(function (k) {
        var o = { t: k.t, ease: k.ease };
        if (k.x !== undefined) o.x = k.x;
        if (k.y !== undefined) o.y = k.y;
        if (k.sx !== undefined || k.scale !== undefined) o.sx = k.sx !== undefined ? k.sx : k.scale;
        if (k.sy !== undefined || k.scale !== undefined) o.sy = k.sy !== undefined ? k.sy : k.scale;
        if (k.rotate !== undefined) o.rotate = k.rotate;
        if (k.color) { var c = parseHex(k.color); o.r = c.r; o.g = c.g; o.b = c.b; }
        if (k.alpha !== undefined) o.a = k.alpha;
        return o;
      });
      var all = target === 'all';
      var slotList = all ? fade.filter(function (n) { return slots[n]; }) : slots[target] ? [target] : [];
      var bone = all ? null : bones[target] ? target : slots[target] ? slots[target].bone : null;
      if (!bone && !slotList.length) { notes.push('ключі: немає частини ' + target); return; }
      var tr = keyGroup(list, ['x', 'y'], [0, 0]);
      var sc = keyGroup(list, ['sx', 'sy'], [1, 1]);
      var ro = keyGroup(list, ['rotate'], [0]);
      if (tr || sc || ro) {
        if (!bone) notes.push('ключі ' + target + ': x, y, scale, rotate тільки для частин, all бере лише alpha і color');
        else {
          anim.bones = anim.bones || {};
          var b = anim.bones[bone] = anim.bones[bone] || {};
          if (tr) b.translate = keyTrack(tr, function (v) { return { x: r2(v[0]), y: r2(v[1]) }; });
          if (sc) b.scale = keyTrack(sc, function (v) { return { x: r4(v[0]), y: r4(v[1]) }; });
          if (ro) b.rotate = keyTrack(ro, function (v) { return { value: r2(v[0]) }; });
        }
      }
      var colored = list.filter(function (k) { return k.a !== undefined || k.r !== undefined; });
      if (!colored.length) return;
      if (!slotList.length) { notes.push('ключі ' + target + ': alpha і color тільки для частин з картинкою'); return; }
      slotList.forEach(function (sn) { tint[sn] = (tint[sn] || []).concat(colored); });
    });
    Object.keys(tint).forEach(function (sn) {
      var list = tint[sn].map(function (k, i) { return { k: k, i: i }; }).sort(function (a, b) { return a.k.t - b.k.t || a.i - b.i; }).map(function (x) { return x.k; });
      var c0 = parseHex(slots[sn].color || 'ffffffff');
      var rgb = keyGroup(list, ['r', 'g', 'b'], [c0.r, c0.g, c0.b]);
      var al = keyGroup(list, ['a'], [c0.a]);
      var s = {};
      if (rgb) s.rgb = keyTrack(rgb, function (v) { return { color: hex2(v[0]) + hex2(v[1]) + hex2(v[2]) }; });
      if (al) s.alpha = keyTrack(al, function (v) { return { value: r4(v[0]) }; });
      anim.slots = anim.slots || {};
      anim.slots[sn] = s;
    });
    return { anim: anim, notes: notes };
  }

  function padTo(anim, d) {
    if (!(d > 0) || durationOf(anim) >= r4(d)) return;
    var best = null, bt = -1;
    ['bones', 'slots'].forEach(function (g) {
      Object.keys(anim[g] || {}).forEach(function (n) {
        Object.keys(anim[g][n]).forEach(function (t) {
          var tl = anim[g][n][t];
          if (!Array.isArray(tl) || !tl.length) return;
          var lt = tl[tl.length - 1].time || 0;
          if (lt > bt) { bt = lt; best = tl; }
        });
      });
    });
    if (!best) {
      anim.bones = anim.bones || {};
      anim.bones.art = anim.bones.art || {};
      best = anim.bones.art.translate = anim.bones.art.translate || [{}];
    }
    var f = clone(best[best.length - 1]);
    delete f.curve;
    f.time = r4(d);
    best.push(f);
  }

  function partList(comp, reserved, notes) {
    var taken = {}, out = [], by = {};
    reserved.forEach(function (n) { taken[n] = true; });
    (Array.isArray(comp.parts) ? comp.parts : []).forEach(function (raw) {
      var p = normPart(raw);
      if (!p) return;
      if (taken[p.name]) { notes.push('Частина ' + p.name + ': назва вже зайнята'); return; }
      taken[p.name] = true;
      by[p.name] = p;
      out.push(p);
    });
    out.forEach(function (p) {
      if (p.parent !== 'art' && !by[p.parent]) { notes.push('Частина ' + p.name + ': немає батька ' + p.parent + ', стала на art'); p.parent = 'art'; return; }
      for (var q = by[p.parent], n = 0; q && n <= out.length; q = by[q.parent], n++) {
        if (q === p) { notes.push('Частина ' + p.name + ': батьки по колу, стала на art'); p.parent = 'art'; break; }
      }
    });
    return out;
  }

  function addParts(spine, comp, parts, ap, cx, cy, px) {
    if (!parts.length) return;
    var json = spine.json;
    var short = spine.name.replace(/^animation_/, '');
    var info = { art: { pv: ap, cx: cx, cy: cy } };
    var done = { art: true }, order = [];
    while (order.length < parts.length) {
      var moved = false;
      parts.forEach(function (p) { if (!done[p.name] && done[p.parent]) { done[p.name] = true; order.push(p); moved = true; } });
      if (!moved) break;
    }
    var pts = [], slotOf = {}, att = {};
    order.forEach(function (p) {
      var key = 'p:' + comp.id + ':' + p.name;
      var q = px(key);
      var w = p.w || (q ? q.w : 100), h = p.h || (q ? q.h : 100);
      if (!q) q = { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
      var pv = pivotOf(p.pivot, w, h);
      var par = info[p.parent];
      var b = { name: p.name, parent: p.parent };
      var bx = r2(p.x + pv.x - par.pv.x), by = r2(p.y + pv.y - par.pv.y);
      if (bx) b.x = bx;
      if (by) b.y = by;
      if (p.rotate) b.rotation = p.rotate;
      json.bones.push(b);
      info[p.name] = { pv: pv, cx: par.cx + p.x, cy: par.cy + p.y };
      pts = pts.concat(corners(par.cx + p.x, par.cy + p.y, w, h));
      var region = 'art/' + short + '_' + p.name;
      var slot = { name: p.name, bone: p.name, attachment: region };
      if (p.alpha !== undefined) slot.color = 'ffffff' + hex2(p.alpha);
      if (p.blend) slot.blend = p.blend;
      slotOf[p.name] = slot;
      var a = {};
      if (r2(-pv.x)) a.x = r2(-pv.x);
      if (r2(-pv.y)) a.y = r2(-pv.y);
      a.width = r2(w);
      a.height = r2(h);
      att[p.name] = {};
      att[p.name][region] = a;
      spine.regions.push({ name: region, w: q.w, h: q.h, src: key });
    });
    var at = json.slots.map(function (s) { return s.name; }).indexOf('art');
    var over = parts.filter(function (p) { return slotOf[p.name] && !p.behind; }).map(function (p) { return slotOf[p.name]; });
    var under = parts.filter(function (p) { return slotOf[p.name] && p.behind; }).map(function (p) { return slotOf[p.name]; });
    json.slots.splice.apply(json.slots, [at + 1, 0].concat(over));
    json.slots.splice.apply(json.slots, [at, 0].concat(under));
    json.skins.forEach(function (s) { if (s.attachments) Object.assign(s.attachments, clone(att)); });
    var sk = json.skeleton;
    var bb = bounds(pts.concat([[sk.x, sk.y], [sk.x + sk.width, sk.y + sk.height]]));
    sk.x = bb.x; sk.y = bb.y; sk.width = bb.width; sk.height = bb.height;
  }

  function applyKeys(spine, comp, fade, notes) {
    var anims = spine.json.animations;
    var seen = {};
    (comp.anims || []).forEach(function (row) {
      if (!row || !row.name || !row.keys) return;
      var n = String(row.name).trim();
      if (seen[n] || !anims[n]) return;
      seen[n] = true;
      var nk = normKeys(row.keys);
      nk.errors.forEach(function (e) { notes.push(n + ': ' + e); });
      if (!Object.keys(nk.keys).length) return;
      var k = keyedAnim(nk.keys, spine.json, fade);
      k.notes.forEach(function (e) { notes.push(n + ': ' + e); });
      anims[n] = mergeAnim(anims[n], k.anim);
      padTo(anims[n], specsFrom([row], 'custom')[0].duration);
    });
  }

  function customSpine(comp, g, px, tech) {
    var name = 'animation_' + (slug(comp.name).replace(/^animation_/, '') || 'element');
    var key = 'c:' + comp.id;
    var p = px(key);
    var w = Number(comp.w) || (p ? p.w : 400), h = Number(comp.h) || (p ? p.h : 400);
    if (!p) p = { w: Math.round(w), h: Math.round(h) };
    var ap = pivotOf(comp.pivot, w, h);
    var att = { x: -ap.x, y: -ap.y, width: w, height: h };
    var bare = name === 'animation_notification_panel' ? 'spacer' : null;
    var spacers = spacerList(comp.spacers, w / 2, h / 2).map(function (sp) { sp.key = bare; sp.parent = 'art'; sp.x = r2(sp.x - ap.x); sp.y = r2(sp.y - ap.y); return sp; });
    var txt = spacers.map(function (sp) { return sp.slot; }).filter(function (sl) { return /^txt_/.test(sl); });
    var bar = barOf(comp.bar);
    var notes = [];
    var reserved = ['root', 'art'].concat(bar ? BAR_NAMES : []);
    spacers.forEach(function (sp) { reserved.push(sp.slot, sp.slot + '_bone'); });
    var parts = partList(comp, reserved, notes);
    var shown = parts.filter(function (q) { return q.alpha === undefined; }).map(function (q) { return q.name; });
    var also = txt.concat(bar ? ['bar_fill', 'bar_shine', 'bar_head'] : [], shown);
    var specs = specsFrom(comp.anims, 'custom').map(function (sp) {
      if (txt.length && /(^|_)txt$/.test(sp.name)) sp.ctx = { bone: txt[0], slot: txt[0], w: w, h: h, cellH: g.H, also: txt.slice(1) };
      return sp;
    });
    var cx = Number(comp.x) || 0, cy = Number(comp.y) || 0;
    var spine = rig({
      name: name,
      chain: ['art'],
      at: { x: cx + ap.x, y: cy + ap.y },
      slot: 'art',
      region: 'art/' + name.replace(/^animation_/, ''),
      att: att,
      px: p,
      src: key,
      spacers: spacers,
      skins: comp.skins,
      specs: specs,
      ctx: { bone: 'art', slot: 'art', w: w, h: h, cellH: g.H, also: also }
    }, tech);
    addParts(spine, comp, parts, ap, cx, cy, px);
    if (bar) withBar(spine, { x: bar.x - ap.x, y: bar.y - ap.y, w: bar.w, h: bar.h }, name, tech);
    applyKeys(spine, comp, ['art'].concat(also), notes);
    spine.notes = notes;
    return spine;
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
    var warnings = (spine.notes || []).slice();
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
    var folder = String(t.folder || '').replace(/^\/+/, '').replace(/\/?$/, '/');
    var lines = [
      'Spine-чернетки: ' + (settings.game || 'гра') + ', сітка ' + plan.geometry.C + '×' + plan.geometry.R + ', клітинка ' + plan.geometry.W + '×' + plan.geometry.H + ' px',
      '',
      'Це чернетки під ФІНАЛЬНИМИ назвами: гра вже працює з ними. Ваше завдання: замінити чернетку',
      'на справжню анімацію і віддати файли з тими самими назвами.',
      '',
      'ЩО В АРХІВІ',
      '  ' + folder + '   готові .json, .atlas, .png: так файли лежать в арт-репо гри',
      '  spine-editor/<спайн>/   те саме для Spine Editor: <спайн>.json і картинки в images/'
    ].concat(plan.layouts && plan.layouts.length ? [
      '  ' + folder.replace(/spine\/$/, '') + 'layouts/   лейаути ' + plan.layouts.join(', ') + ': кістки position_*, на які гра ставить компоненти',
      '  spine-editor/layouts/   ті самі лейаути з картинками компонентів на кістках, для Spine Editor'
    ] : [], [
      '  kit-settings.json   налаштування кита, з яких зібрано архів',
      '',
      'ЯК ПОЧАТИ (Spine Editor ' + t.spineVersion + ')',
      '  1. Spine → Import Data → spine-editor/<спайн>/<спайн>.json.',
      '  2. Шлях до картинок (Images): папка images/ поруч із json.',
      '  3. Збережіть проект .spine і працюйте в ньому далі.',
      '',
      'ЩО МОЖНА',
      '  - замінити картинки своїми, назви регіонів (файлів у images/) лишаються ті самі;',
      '  - змінювати рух, ключі, криві, додавати кістки, меші, ефекти;',
      '  - змінювати тривалість анімацій, погодивши з розробником (stop і spin_stop гра може чекати).',
      '',
      'ЩО НЕ МОЖНА',
      '  - перейменовувати спайни, скіни, анімації, слоти й регіони: гра шукає їх за назвою;',
      '  - видаляти анімації, скіни, слоти-спейсери (txt_amount тощо) і події (onFinalSymbol тощо);',
      '  - міняти версію Spine: тільки ' + t.spineVersion + '.',
      '',
      'ЕКСПОРТ',
      '  Spine → Export → JSON, версія ' + t.spineVersion + ', Nonessential data вимкнено,',
      '  Pack atlas увімкнено, у налаштуваннях пакування useIndexes: false (інакше low_5 стане кадром 5 спайна low).',
      '  Назви файлів: <спайн>.json, <спайн>.atlas, <спайн>.png. Покладіть їх у ' + folder + ' арт-репо, замість чернеток.',
      '  Якщо в арт-репо є валідатор, запустіть його перед MR.',
      '',
      'СПАЙНИ'
    ]).concat(plan.spines.map(function (s) {
      if (!s.json) return '  ' + s.name;
      var skins = (s.json.skins || []).map(function (k) { return k.name; });
      var anims = Object.keys(s.json.animations || {});
      return '  ' + s.name + '\n    анімації: ' + (anims.join(', ') || '—') + '\n    скіни: ' + (skins.join(', ') || '—');
    })).concat([
      '',
      'Draft Kit ' + VERSION
    ]);
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
    spacerItem: spacerItem,
    listOf: listOf,
    normPart: normPart,
    normKeys: normKeys,
    pivotName: pivotName,
    pivotOf: pivotOf,
    hexOf: hexOf,
    BLENDS: BLENDS,
    SHAPES: SHAPES,
    EASES: Object.keys(EASE).concat(['stepped']),
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
