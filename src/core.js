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
  function skinSlug(s) { return String(s || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^[_-]+|[_-]+$/g, ''); }
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
    var skins = listOf(o.skins).map(skinSlug).filter(function (s, i, a) { return s && a.indexOf(s) === i; });
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
      region: 'art/reels/' + name.replace(/^animation_reels_/, ''),
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
    var base = 'art/' + name.replace(/^animation_/, '') + '/bar_';
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
      var region = 'art/' + short + '/' + (p.name === short ? p.name + '_part' : p.name);
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
      region: 'art/' + name.replace(/^animation_/, '') + '/' + name.replace(/^animation_/, ''),
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
    importJson.skeleton.images = './';
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
      '  spine-editor/   те саме для Spine Editor: <спайн>.json, картинки в art/<група>/ і shapes/'
    ].concat(plan.layouts && plan.layouts.length ? [
      '  ' + folder.replace(/spine\/$/, '') + 'layouts/   лейаути ' + plan.layouts.join(', ') + ': кістки position_*, на які гра ставить компоненти',
      '  spine-editor/layouts/   ті самі лейаути з картинками компонентів на кістках, для Spine Editor'
    ] : [], [
      '  kit-settings.json   налаштування кита, з яких зібрано архів',
      '',
      'ЯК ПОЧАТИ (Spine Editor ' + t.spineVersion + ')',
      '  1. Spine → Import Data → spine-editor/<спайн>.json.',
      '  2. Шлях до картинок (Images): папка spine-editor/, у якій лежить art/. Шлях картинки = назва регіону: art/reels/high_1.png → art/reels/high_1.',
      '  3. Збережіть проект .spine і працюйте в ньому далі.',
      '',
      'ЩО МОЖНА',
      '  - замінити картинки своїми, назви регіонів (шляхи файлів у art/) лишаються ті самі;',
      '  - додати нові картинки в art/<група>/ поруч зі своїми;',
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
      var j = s.final && s.final.obj ? s.final.obj : s.json;
      var skins = (Array.isArray(j.skins) ? j.skins : []).map(function (k) { return k.name; });
      var anims = Object.keys(j.animations || {});
      return '  ' + s.name + (j !== s.json ? ' (фінал аніматора, у spine-editor/ його немає)' : '') + '\n    анімації: ' + (anims.join(', ') || '—') + '\n    скіни: ' + (skins.join(', ') || '—');
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

  function atlasOf(text) {
    var pages = [], regions = [], page = null, region = null, head = true;
    String(text || '').replace(/^﻿/, '').split(/\r\n|\r|\n/).forEach(function (raw) {
      var t = raw.trim();
      if (!t) { head = true; region = null; return; }
      if (head) { page = { name: t, f: {} }; pages.push(page); head = false; region = null; return; }
      var i = t.indexOf(':');
      if (i !== -1) { (region || page).f[t.slice(0, i).trim()] = t.slice(i + 1).trim(); return; }
      region = { page: page.name, name: t, f: {} };
      regions.push(region);
    });
    var nums = function (v) { return String(v === undefined ? '' : v).split(',').map(function (x) { return parseFloat(x); }).filter(function (x) { return isFinite(x); }); };
    pages.forEach(function (p) { var s = nums(p.f.size); p.w = s[0] || 0; p.h = s[1] || 0; });
    regions.forEach(function (r) {
      var b = nums(r.f.bounds), xy = nums(r.f.xy), sz = nums(r.f.size);
      var four = b.length === 4;
      r.x = four ? b[0] : xy[0]; r.y = four ? b[1] : xy[1]; r.w = four ? b[2] : sz[0]; r.h = four ? b[3] : sz[1];
      var rot = String(r.f.rotate === undefined ? 'false' : r.f.rotate);
      r.rot = rot === 'true' ? 90 : rot === 'false' ? 0 : parseFloat(rot);
      r.index = r.f.index === undefined ? -1 : parseInt(r.f.index, 10);
    });
    return { pages: pages, regions: regions };
  }
  function renamePages(text, map) {
    var head = true;
    return String(text || '').split(/(\r\n|\r|\n)/).map(function (part, i) {
      if (i % 2) return part;
      var t = part.trim();
      if (!t) { head = true; return part; }
      if (!head) return part;
      head = false;
      return map[t] ? part.replace(t, map[t]) : part;
    }).join('');
  }
  function pageNames(name, pages) {
    return pages.map(function (p, i) {
      var ext = (/\.[a-z0-9]+$/i.exec(p.name) || ['.png'])[0].toLowerCase();
      return name + (i ? '_' + (i + 1) : '') + ext;
    });
  }

  function skinList(json) {
    var s = json.skins;
    if (Array.isArray(s)) return s.filter(isObj);
    return isObj(s) ? Object.keys(s).map(function (n) { return { name: n, attachments: s[n] }; }) : [];
  }
  function regionPath(a, key) { return (a && (a.path || a.name)) || key; }
  function attRegions(json) {
    var out = [];
    var add = function (n) { if (out.indexOf(n) === -1) out.push(n); };
    skinList(json).forEach(function (s) {
      Object.keys(s.attachments || {}).forEach(function (sl) {
        var o = s.attachments[sl];
        if (!isObj(o)) return;
        Object.keys(o).forEach(function (k) {
          var a = o[k];
          if (!isObj(a) || ['region', 'mesh', 'linkedmesh'].indexOf(a.type || 'region') === -1) return;
          var path = regionPath(a, k), q = a.sequence;
          if (!isObj(q)) { add(path); return; }
          var start = q.start === undefined ? 1 : Number(q.start), digits = Number(q.digits) || 0;
          for (var i = 0; i < (Number(q.count) || 0); i++) { var n = String(start + i); while (n.length < digits) n = '0' + n; add(path + n); }
        });
      });
    });
    return out;
  }
  function oddAtts(json) {
    var out = [];
    skinList(json).forEach(function (s) {
      Object.keys(s.attachments || {}).forEach(function (sl) {
        var o = s.attachments[sl];
        if (!isObj(o)) return;
        Object.keys(o).forEach(function (k) {
          var a = o[k];
          if (!isObj(a) || ['region', 'mesh', 'linkedmesh', 'clipping'].indexOf(a.type || 'region') !== -1) return;
          var n = typeof a.path === 'string' ? a.path : a.name ? String(a.name) : ['width', 'height', 'x', 'y'].some(function (q) { return a[q] !== undefined; }) ? k : null;
          if (n && out.indexOf(n) === -1) out.push(n);
        });
      });
    });
    return out;
  }
  function spacerSlotsOf(json, key) {
    var skins = skinList(json);
    return (json.slots || []).filter(function (sl) {
      if (!sl || !sl.attachment) return false;
      if (sl.attachment === key) return true;
      return skins.some(function (s) { var a = s.attachments && s.attachments[sl.name] && s.attachments[sl.name][sl.attachment]; return isObj(a) && regionPath(a, sl.attachment) === key; });
    }).map(function (sl) { return sl.name; });
  }
  function evList(anim, json) {
    var defs = json && isObj(json.events) ? json.events : {};
    return (anim && Array.isArray(anim.events) ? anim.events : []).filter(isObj).map(function (e) {
      var d = isObj(defs[e.name]) ? defs[e.name] : {};
      var raw = Object.keys(e).filter(function (k) { return k !== 'time'; }).sort().map(function (k) { return k + '=' + JSON.stringify(e[k]); }).join(',');
      return { name: String(e.name), int: Number(e.int !== undefined ? e.int : d.int) || 0, t: Number(e.time) || 0, raw: raw };
    });
  }
  function evKey(e) { return e.name + (e.int ? '(' + e.int + ')' : ''); }
  function evText(list) { return list.length ? list.map(function (e) { return evKey(e) + '@' + fmt(e.t); }).join(', ') : '—'; }
  function animEmpty(anim) {
    if (!isObj(anim)) return true;
    return !Object.keys(anim).some(function (k) { var v = anim[k]; return Array.isArray(v) ? v.length > 0 : isObj(v) && Object.keys(v).length > 0; });
  }
  function countOf(json) {
    var att = 0, mesh = 0;
    skinList(json).forEach(function (s) { Object.keys(s.attachments || {}).forEach(function (sl) { var o = s.attachments[sl]; if (!isObj(o)) return; Object.keys(o).forEach(function (k) { att++; if (o[k] && (o[k].type === 'mesh' || o[k].type === 'linkedmesh')) mesh++; }); }); });
    return { bones: (json.bones || []).length, slots: (json.slots || []).length, att: att, mesh: mesh, cons: (json.ik || []).length + (json.transform || []).length + (json.path || []).length, events: Object.keys(json.events || {}).length };
  }

  function fakeTex(w, h) { return { getImage: function () { return { width: w || 1, height: h || 1 }; }, setFilters: function () {}, setWraps: function () {}, dispose: function () {} }; }
  function runtimeOf(sp, atlasText, jsonText, skinName) {
    var atlas = new sp.TextureAtlas(atlasText || '');
    atlas.pages.forEach(function (p) { p.setTexture(fakeTex(p.width, p.height)); });
    var data = new sp.SkeletonJson(new sp.AtlasAttachmentLoader(atlas)).readSkeletonData(String(jsonText).replace(/^﻿/, ''));
    var sk = new sp.Skeleton(data);
    var skin = skinName ? data.findSkin(skinName) : null;
    if (!skin && (!data.defaultSkin || !data.defaultSkin.attachments.some(function (a) { return a && Object.keys(a).length; }))) skin = data.skins.filter(function (s) { return s !== data.defaultSkin; })[0] || null;
    if (skin && skin !== data.defaultSkin) sk.setSkin(skin);
    sk.setToSetupPose();
    sk.updateWorldTransform();
    return { sp: sp, data: data, sk: sk };
  }
  function boundsOf(rt) {
    var off = new rt.sp.Vector2(), size = new rt.sp.Vector2();
    rt.sk.setToSetupPose();
    rt.sk.updateWorldTransform();
    rt.sk.getBounds(off, size, []);
    return isFinite(size.x) && isFinite(size.y) ? { w: size.x, h: size.y } : null;
  }
  function rectOf(rt, name) {
    var slot = rt.sk.findSlot(name);
    if (!slot) return null;
    var a = slot.getAttachment();
    if (a && typeof a.computeWorldVertices === 'function' && a.offset) {
      var v = new Float32Array(8);
      a.computeWorldVertices(slot, v, 0, 2);
      var xs = [v[0], v[2], v[4], v[6]], ys = [v[1], v[3], v[5], v[7]];
      var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
      return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
    }
    return { x: slot.bone.worldX, y: slot.bone.worldY, w: 0, h: 0 };
  }
  function poseOf(rt, anim, t) {
    var sk = rt.sk;
    sk.setToSetupPose();
    anim.apply(sk, t, t, false, null, 1, rt.sp.MixBlend.setup, rt.sp.MixDirection.mixIn);
    sk.updateWorldTransform();
    return {
      bones: sk.bones.map(function (b) { return [b.worldX, b.worldY, b.a, b.b, b.c, b.d]; }),
      slots: sk.slots.map(function (s) { return [s.color.r, s.color.g, s.color.b, s.color.a, s.attachment ? s.attachment.name : '', s.bone.data.index]; })
    };
  }
  function seamOf(rt, name) {
    var anim = rt.data.findAnimation(name);
    if (!anim || !(anim.duration > 0)) return null;
    var a = poseOf(rt, anim, 0), b = poseOf(rt, anim, anim.duration);
    var seen = function (s) { return !!s[4] && s[3] > 0.02; }, shown = {};
    a.slots.concat(b.slots).forEach(function (s) { if (seen(s)) shown[s[5]] = true; });
    var worst = null;
    a.bones.forEach(function (p, i) {
      if (!shown[i]) return;
      var q = b.bones[i], move = Math.hypot(p[0] - q[0], p[1] - q[1]);
      var d = Math.max(move, 40 * Math.max(Math.abs(p[2] - q[2]), Math.abs(p[3] - q[3]), Math.abs(p[4] - q[4]), Math.abs(p[5] - q[5])));
      if (d > 0.5 && (!worst || d > worst.d)) worst = { d: d, what: 'кістка ' + rt.sk.bones[i].data.name + (move > 0.5 ? ' зсунута на ' + fmt(move) + ' px' : ' повернута або масштабована інакше') };
    });
    if (worst) return worst.what;
    for (var i = 0; i < a.slots.length; i++) {
      var p = a.slots[i], q = b.slots[i];
      if (!seen(p) && !seen(q)) continue;
      if (p[4] !== q[4]) return 'слот ' + rt.sk.slots[i].data.name + ': ' + (p[4] || '—') + ' → ' + (q[4] || '—');
      if (Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2]), Math.abs(p[3] - q[3])) > 0.02) return 'слот ' + rt.sk.slots[i].data.name + ': колір або прозорість';
    }
    return null;
  }

  var FINAL_TEXT = {
    json: ['Немає JSON спайна', ''],
    skeleton: ['Це не файл Spine', ''],
    version: ['Інша версія Spine', 'Експортуйте з Spine {v}: гра і валідатор арт-репо приймають лише її'],
    nonessential: ['Експортовано з Nonessential data', 'Вимкніть Nonessential data в експорті: валідатор арт-репо відхиляє skeleton.images і skeleton.audio'],
    'draft-hash': ['Це чернетка з кита, а не експорт аніматора', 'Файл ще не проходив через Spine Editor'],
    'skin-missing': ['Немає скінів драфту', 'Гра вмикає скін за назвою: без нього «Skin not found» і гра зависає'],
    'skin-extra': ['Нові скіни', 'Їх немає в драфті: гра про них не знає, а валідатор арт-репо порівнює скіни з референсом (validator/reference/spines.json)'],
    'anim-missing': ['Немає анімацій драфту', 'Гра викликає їх за назвою: без них «Animation not found»'],
    'anim-extra': ['Нові анімації', 'Їх немає в драфті: гра їх не викличе, поки розробник не додасть, а валідатор арт-репо порівнює список анімацій з референсом'],
    'anim-order': ['Інший порядок анімацій', 'Spine експортує за абеткою, а валідатор арт-репо порівнює порядок з референсом: оновіть референс або порядок у компоненті'],
    'anim-empty': ['Порожні анімації', 'У драфті в них є рух, у фіналі немає жодного ключа'],
    duration: ['Тривалість змінено понад {tol}%', 'Гра може чекати кінця анімації (in, out, stop, win): погодьте нову тривалість з розробником'],
    'event-missing': ['Немає подій драфту', 'Гра чекає ці події: без них логіка зависне або не спрацює'],
    'event-extra': ['Нові події', 'Їх немає в драфті: гра їх не слухає, а валідатор арт-репо порівнює події з референсом'],
    'event-time': ['Події зсунуто в часі', 'Гра зреагує на них в інший момент (звук, зупинка, наступний крок)'],
    'event-order': ['Інший порядок подій', 'Валідатор арт-репо порівнює порядок подій з референсом'],
    'event-fields': ['Ключі подій записано інакше', 'Поля int, float, string чи гучність відрізняються від драфту: валідатор арт-репо порівнює ключі подій з референсом дослівно, а гра може читати float чи string'],
    'spacer-missing': ['Немає спейсерів', 'Гра ставить сюди текст або символи за назвою слота'],
    'spacer-kind': ['Слоти більше не спейсери', 'У сетапі слот показує інше вкладення, ніж {sp}: гра не знайде місце під текст, валідатор арт-репо теж'],
    'spacer-extra': ['Нові спейсери', 'Їх немає в драфті: гра не покладе туди текст, а валідатор арт-репо порівнює спейсери з референсом'],
    'spacer-moved': ['Спейсери зсунуто', 'Текст або символ стане в інше місце, ніж у драфті'],
    'slots-missing': ['Немає слотів драфту', 'Якщо гра звертається до них за назвою, вона зламається'],
    'regions-missing': ['Немає картинок драфту', 'Регіони з драфту прибрано або перейменовано: якщо гра міняє їх за назвою, вона зламається'],
    root: ['Кістку root зсунуто або масштабовано', 'Гра ставить спайн на кістку лейаута через root: компонент зʼїде'],
    size: ['Інший розмір у сетапі', 'Лейаути й позиції в грі розраховані на розмір драфту: перевірте масштаб'],
    seam: ['Цикли зі швом', 'Гра крутить ці анімації по колу: кінець не збігається з початком, буде ривок'],
    'atlas-missing': ['Немає атласу', 'Додайте {n}.atlas і сторінки .png з того самого експорту'],
    'atlas-parse': ['Атлас порожній або не читається', ''],
    'atlas-index': ['Атлас з індексами', 'Пакуйте з useIndexes: false, інакше low_5 стане кадром 5 регіону low'],
    'page-missing': ['Немає сторінок атласу', 'Додайте ці PNG з того самого експорту'],
    'page-size': ['Розмір сторінки не збігається з атласом', 'Сторінка з іншого експорту: експортуйте атлас і сторінки разом'],
    'page-big': ['Сторінки більші за {max} px', 'На слабких пристроях вони можуть не завантажитися: поставте Max {max} у Pack settings'],
    'page-huge': ['Сторінки більші за 8192 px', 'Таку текстуру не покаже більшість GPU, і командний сервер її не прийме: поставте Max {max} у Pack settings'],
    'page-broken': ['Сторінки атласу не відкриваються як картинки', 'Файл пошкоджений або це не PNG, JPEG чи WebP: експортуйте ще раз'],
    'page-clash': ['Назви сторінок атласу зайняті іншими спайнами', 'У zip і арт-репо вони перетруть одна одну: перейменуйте один зі спайнів у киті'],
    'region-bounds': ['Регіони за межами сторінки', 'Атлас пошкоджений або сторінка з іншого експорту'],
    'region-missing': ['В атласі немає картинок спайна', 'Спайн не завантажиться в грі'],
    'att-space': ['Пробіл у назві картинки', 'Валідатор арт-репо це відхиляє'],
    'att-ref': ['Референсна картинка в експорті', 'Приберіть txt/references з експорту'],
    'att-validator': ['Вкладення, які валідатор арт-репо шукає в атласі', 'Це не картинки (point, bounding box чи path з координатами або назвою), але валідатор арт-репо вважає їх картинками і може відхилити експорт'],
    broken: ['Файл Spine пошкоджений', 'Перевірка не змогла його прочитати: експортуйте ще раз'],
    runtime: ['Рантайм Spine не читає фінал', 'Так само впаде і гра'],
    'file-json': ['Інша назва JSON', 'При експорті кит запише його як {n}.json'],
    'file-atlas': ['Інша назва атласу', 'При експорті кит запише його як {n}.atlas'],
    'page-rename': ['Сторінки атласу буде перейменовано', 'Так вони не перетруться сторінками інших спайнів в арт-репо'],
    'extra-files': ['Файли не використано', ''],
    'no-runtime': ['Рантайм Spine не завантажився', 'Не перевірено, чи рантайм (а з ним і гра) прочитає файл, позиції спейсерів, розмір у сетапі й шви циклів']
  };

  function finalCheck(input, draft, opts) {
    try { return finalRun(input, draft, opts); }
    catch (e) {
      var t = FINAL_TEXT.broken;
      return { spine: draft.name, ok: false, errors: [{ id: 'broken', title: t[0], detail: String((e && e.message) || e) + '. ' + t[1] }], warnings: [], notes: [], diff: { anims: [], skins: [], spacers: [], skel: [], regions: { add: [], del: [] }, files: [] }, rename: {}, sum: null };
    }
  }
  function finalRun(input, draft, opts) {
    opts = opts || {};
    var tech = Object.assign({}, TECH, opts.tech || {});
    var name = draft.name, dj = draft.json;
    var contract = draft.contract || contractEntry(draft, tech);
    var frame = 1 / (tech.fps || 30) + EPS;
    var out = { spine: name, ok: false, errors: [], warnings: [], notes: [], diff: { anims: [], skins: [], spacers: [], skel: [], regions: { add: [], del: [] }, files: [] }, rename: {}, sum: null };
    var bag = {}, order = [];
    var put = function (level, id, item) {
      if (!bag[id]) { bag[id] = { level: level, items: [] }; order.push(id); }
      if (item !== undefined && bag[id].items.indexOf(item) === -1) bag[id].items.push(item);
    };
    var list = function (a, n) { n = n || 10; return a.slice(0, n).join(', ') + (a.length > n ? ' і ще ' + (a.length - n) : ''); };
    var sub = function (s) { return String(s).replace(/\{v\}/g, tech.spineVersion).replace(/\{tol\}/g, Math.round(tech.timingTolerance * 100)).replace(/\{max\}/g, tech.maxPage).replace(/\{sp\}/g, tech.spacer).replace(/\{n\}/g, name); };
    var finish = function () {
      order.forEach(function (id) {
        var b = bag[id], t = FINAL_TEXT[id] || [id, ''];
        var long = b.items.some(function (x) { return String(x).length > 40; }) || b.items.length > 6;
        var f = { id: id, title: sub(t[0]) + (b.items.length && !long ? ': ' + list(b.items) : b.items.length > 1 ? ' (' + b.items.length + ')' : ''), detail: (long ? b.items.join('; ') + '. ' : '') + sub(t[1]) };
        (b.level === 'error' ? out.errors : b.level === 'warning' ? out.warnings : out.notes).push(f);
      });
      out.ok = !out.errors.length;
      return out;
    };
    var ji = input.json || null;
    if (!ji || (typeof ji.text !== 'string' && !isObj(ji.obj))) { put('error', 'json', name + '.json'); return finish(); }
    var json = ji.obj;
    if (!json) {
      try { json = JSON.parse(ji.text.replace(/^﻿/, '')); } catch (e) { put('error', 'json', (ji.name || name + '.json') + ' не читається: ' + ((e && e.message) || e)); return finish(); }
    }
    if (!isObj(json) || !isObj(json.skeleton)) { put('error', 'skeleton', (ji.name || name + '.json') + ': немає skeleton'); return finish(); }
    var sk = json.skeleton;
    var fa = isObj(json.animations) ? json.animations : {};
    var da = isObj(dj.animations) ? dj.animations : {};
    if (sk.spine !== tech.spineVersion) put('error', 'version', (sk.spine || 'без версії') + ' замість ' + tech.spineVersion);
    if (sk.images || sk.audio) put('error', 'nonessential');
    if (typeof sk.hash === 'string' && sk.hash.indexOf('draft-') === 0) put('warning', 'draft-hash');

    var fSkins = skinList(json).map(function (s) { return s.name; });
    contract.skins.forEach(function (n) { if (fSkins.indexOf(n) === -1) put('error', 'skin-missing', n); });
    fSkins.forEach(function (n) { if (contract.skins.indexOf(n) === -1) put('warning', 'skin-extra', n); });
    contract.skins.concat(fSkins.filter(function (n) { return contract.skins.indexOf(n) === -1; })).forEach(function (n) {
      out.diff.skins.push({ name: n, st: fSkins.indexOf(n) === -1 ? 'del' : contract.skins.indexOf(n) === -1 ? 'add' : 'same' });
    });

    var cNames = contract.animations.map(function (a) { return a.name; });
    var fNames = Object.keys(fa);
    contract.animations.forEach(function (a) {
      var f = fa[a.name];
      var line = { name: a.name, loop: !!a.loop, a: { d: a.duration, ev: evText(evList(da[a.name], dj)) }, b: null, st: 'del', notes: [] };
      out.diff.anims.push(line);
      if (!f) { put('error', 'anim-missing', a.name); return; }
      var d = durationOf(f);
      var fe = evList(f, json), de = evList(da[a.name], dj);
      line.b = { d: d, ev: evText(fe) };
      line.st = 'same';
      if (animEmpty(f) && !animEmpty(da[a.name])) { put('warning', 'anim-empty', a.name); line.notes.push('порожня'); }
      if (a.duration && Math.abs(d - a.duration) > frame) {
        line.notes.push('тривалість ' + fmt(a.duration) + ' → ' + fmt(d) + ' с');
        if (Math.abs(d - a.duration) / a.duration > tech.timingTolerance) put('warning', 'duration', a.name + ' ' + fmt(a.duration) + ' → ' + fmt(d) + ' с');
      }
      var used = fe.map(function () { return false; }), seq = [];
      de.forEach(function (e) {
        var i = fe.findIndex(function (x, k) { return !used[k] && evKey(x) === evKey(e); });
        if (i === -1) { put('error', 'event-missing', a.name + ': ' + evKey(e) + '@' + fmt(e.t)); return; }
        used[i] = true;
        seq.push(i);
        if (Math.abs(fe[i].t - e.t) > frame) put('warning', 'event-time', a.name + ': ' + evKey(e) + ' ' + fmt(e.t) + ' → ' + fmt(fe[i].t) + ' с');
        if (fe[i].raw !== e.raw) put('warning', 'event-fields', a.name + ': ' + evKey(e));
      });
      if (seq.some(function (v, k) { return k && v < seq[k - 1]; })) put('warning', 'event-order', a.name + ': ' + evText(fe));
      fe.forEach(function (e, k) { if (!used[k]) put('warning', 'event-extra', a.name + ': ' + evKey(e) + '@' + fmt(e.t)); });
      if (line.a.ev !== line.b.ev) line.notes.push('події');
      if (!opts.quick && !opts.lite && canon(f) !== canon(da[a.name] || {})) line.notes.push('ключі змінено');
      if (line.notes.length) line.st = 'chg';
    });
    fNames.forEach(function (n) {
      if (cNames.indexOf(n) !== -1) return;
      var f = fa[n];
      out.diff.anims.push({ name: n, a: null, b: { d: durationOf(f), ev: evText(evList(f, json)) }, st: 'add', notes: [] });
      put('warning', 'anim-extra', n);
    });
    var common = fNames.filter(function (n) { return cNames.indexOf(n) !== -1; });
    var cCommon = cNames.filter(function (n) { return fNames.indexOf(n) !== -1; });
    if (canon(common) !== canon(cCommon)) put('warning', 'anim-order', 'драфт: ' + list(cCommon, 12) + ' · фінал: ' + list(common, 12));

    var dSp = spacerSlotsOf(dj, tech.spacer), fSp = spacerSlotsOf(json, tech.spacer);
    var fSlots = (json.slots || []).map(function (s) { return s && s.name; });
    var dDeco = contract.decorationSpacers || [], fDeco = spacerSlots(json, tech.spacer);
    dSp.forEach(function (n) {
      if (fSlots.indexOf(n) === -1) put('error', 'spacer-missing', n);
      else if (fSp.indexOf(n) === -1) put('warning', 'spacer-kind', n);
      else if (dDeco.indexOf(n) !== -1 && fDeco.indexOf(n) === -1) put('warning', 'spacer-kind', n);
    });
    fDeco.forEach(function (n) { if (dDeco.indexOf(n) === -1) put('warning', 'spacer-extra', n); });
    var spNames = dSp.concat(fSp.filter(function (n) { return dSp.indexOf(n) === -1; }));

    var goneSlots = (dj.slots || []).map(function (s) { return s.name; }).filter(function (n) { return fSlots.indexOf(n) === -1 && dSp.indexOf(n) === -1; });
    goneSlots.forEach(function (n) { put('warning', 'slots-missing', n); });

    var root0 = (dj.bones || [])[0] || {}, root1 = (json.bones || [])[0] || {};
    [['x', 0], ['y', 0], ['rotation', 0], ['scaleX', 1], ['scaleY', 1], ['shearX', 0], ['shearY', 0]].forEach(function (k) {
      var a = root0[k[0]] === undefined ? k[1] : Number(root0[k[0]]), b = root1[k[0]] === undefined ? k[1] : Number(root1[k[0]]);
      if (root1.name && Math.abs(a - b) > 0.001) put('warning', 'root', k[0] + ' ' + fmt(a) + ' → ' + fmt(b));
    });

    var dAtt = attRegions(dj), fAtt = attRegions(json);
    out.diff.regions.del = dAtt.filter(function (a) { return fAtt.indexOf(a) === -1 && a !== tech.spacer; });
    out.diff.regions.add = fAtt.filter(function (a) { return dAtt.indexOf(a) === -1; });
    out.diff.regions.del.forEach(function (a) { put('warning', 'regions-missing', a); });
    var odd = oddAtts(json).filter(function (a) { return fAtt.indexOf(a) === -1; });
    fAtt.concat(odd).forEach(function (a) {
      if (a.indexOf(' ') !== -1) put('error', 'att-space', a);
      if (a.indexOf('txt/references/') !== -1) put('error', 'att-ref', a);
    });

    var dc = countOf(dj), fc = countOf(json);
    var row = function (k, a, b) { out.diff.skel.push({ k: k, a: String(a), b: String(b), st: String(a) === String(b) ? 'same' : 'chg' }); };
    row('Версія Spine', dj.skeleton.spine, sk.spine || '—');
    row('Кістки', dc.bones, fc.bones);
    row('Слоти', dc.slots, fc.slots);
    row('Вкладення', dc.att, fc.att);
    row('Картинки (регіони)', dAtt.length, fAtt.length);
    row('Меші', dc.mesh, fc.mesh);
    row('Констрейнти', dc.cons, fc.cons);
    row('Події', dc.events, fc.events);

    if (opts.quick) return finish();

    var ai = input.atlas || null, at = null;
    if (ji.name && ji.name !== name + '.json') put('info', 'file-json', ji.name);
    out.diff.files.push({ k: 'JSON', v: (ji.name || name + '.json') + (ji.name && ji.name !== name + '.json' ? ' → ' + name + '.json' : '') });
    if (!ai || typeof ai.text !== 'string') { if (fAtt.length) put('error', 'atlas-missing'); }
    else {
      at = atlasOf(ai.text);
      if (ai.name && ai.name !== name + '.atlas') put('info', 'file-atlas', ai.name);
      out.diff.files.push({ k: 'Атлас', v: (ai.name || name + '.atlas') + (ai.name && ai.name !== name + '.atlas' ? ' → ' + name + '.atlas' : '') });
      if (!at.pages.length) put('error', 'atlas-parse', ai.name || name + '.atlas');
      var want = pageNames(name, at.pages);
      var rename = at.pages.some(function (p, i) { return p.name !== want[i]; });
      var pages = input.pages || {};
      at.pages.forEach(function (p, i) {
        var got = pages[p.name], moved = rename && p.name !== want[i];
        if (moved) { out.rename[p.name] = want[i]; put('info', 'page-rename', p.name + ' → ' + want[i]); }
        out.diff.files.push({ k: 'Сторінка ' + (i + 1), v: p.name + (moved ? ' → ' + want[i] : '') + (p.w ? ' · ' + p.w + '×' + p.h : '') + (got ? '' : ' · немає файлу') });
        if (opts.taken && opts.taken[want[i]]) put('error', 'page-clash', want[i] + ' (' + opts.taken[want[i]] + ')');
        if (!got) { put('error', 'page-missing', p.name); return; }
        if (got.w === 0 && got.h === 0) { put('error', 'page-broken', got.name || p.name); return; }
        if (p.w && got.w && (p.w !== got.w || p.h !== got.h)) put('error', 'page-size', p.name + ': атлас ' + p.w + '×' + p.h + ', PNG ' + got.w + '×' + got.h);
        var pw = p.w || got.w, ph = p.h || got.h;
        if (Math.max(pw || 0, ph || 0) > 8192) put('error', 'page-huge', want[i] + ' ' + pw + '×' + ph);
        else if (Math.max(pw || 0, ph || 0) > tech.maxPage) put('warning', 'page-big', want[i] + ' ' + pw + '×' + ph);
        at.regions.filter(function (r) { return r.page === p.name; }).forEach(function (r) {
          var turned = r.rot === 90 || r.rot === 270, w = turned ? r.h : r.w, h = turned ? r.w : r.h;
          if ([r.x, r.y, w, h].every(isFinite) && pw && ph && (r.x < 0 || r.y < 0 || r.x + w > pw || r.y + h > ph)) put('error', 'region-bounds', r.name);
        });
      });
      at.regions.filter(function (r) { return r.index >= 0; }).forEach(function (r) { put('warning', 'atlas-index', r.name + '#' + r.index); });
      var rNames = at.regions.map(function (r) { return r.name; });
      rNames.forEach(function (n) { if (n.indexOf(' ') !== -1) put('error', 'att-space', n); });
      fAtt.filter(function (a) { return rNames.indexOf(a) === -1; }).forEach(function (a) { put('error', 'region-missing', a); });
      odd.filter(function (a) { return rNames.indexOf(a) === -1; }).forEach(function (a) { put('warning', 'att-validator', a); });
    }
    (input.extra || []).filter(Boolean).forEach(function (n) { put('info', 'extra-files', n); });

    var sp = opts.spine, rtF = null, rtD = null;
    var setup = contract.skins.filter(function (n) { return n !== 'default' && fSkins.indexOf(n) !== -1; })[0] || null;
    if (!sp) put(opts.gate ? 'warning' : 'info', 'no-runtime');
    else {
      if (at ? at.pages.length : !fAtt.length) {
        try { rtF = runtimeOf(sp, at ? ai.text : '', ji.text || JSON.stringify(json), setup); }
        catch (e) {
          var msg = String((e && e.message) || e);
          if (!(bag['region-missing'] && /Region not found/i.test(msg))) put('error', 'runtime', msg);
        }
      }
      try { rtD = runtimeOf(sp, draft.atlasText || '', draft.jsonText || JSON.stringify(dj), setup); } catch (e) { rtD = null; }
    }
    var bA = rtD ? boundsOf(rtD) : null, bB = rtF ? boundsOf(rtF) : null;
    if (!bA) bA = { w: Number(dj.skeleton.width) || 0, h: Number(dj.skeleton.height) || 0 };
    if (!bB) bB = { w: Number(sk.width) || 0, h: Number(sk.height) || 0 };
    row('Розмір у сетапі', Math.round(bA.w) + '×' + Math.round(bA.h), Math.round(bB.w) + '×' + Math.round(bB.h));
    if (bA.w > 0 && bA.h > 0 && bB.w > 0 && bB.h > 0 && (Math.abs(bB.w / bA.w - 1) > 0.25 || Math.abs(bB.h / bA.h - 1) > 0.25)) put('warning', 'size', Math.round(bA.w) + '×' + Math.round(bA.h) + ' → ' + Math.round(bB.w) + '×' + Math.round(bB.h));
    spNames.forEach(function (n) {
      var a = rtD ? rectOf(rtD, n) : null, b = rtF ? rectOf(rtF, n) : null;
      var st = dSp.indexOf(n) === -1 ? 'add' : fSlots.indexOf(n) === -1 ? 'del' : fSp.indexOf(n) === -1 ? 'kind' : 'same';
      if (st === 'same' && a && b) {
        var dist = Math.hypot(b.x - a.x, b.y - a.y);
        var grow = Math.max(a.w ? Math.abs(b.w / a.w - 1) : 0, a.h ? Math.abs(b.h / a.h - 1) : 0);
        if (dist > 2 || grow > 0.05) {
          st = 'moved';
          put('warning', 'spacer-moved', n + ' ' + fmt(a.x) + ', ' + fmt(a.y) + ' → ' + fmt(b.x) + ', ' + fmt(b.y) + (grow > 0.05 ? ' (' + fmt(a.w) + '×' + fmt(a.h) + ' → ' + fmt(b.w) + '×' + fmt(b.h) + ')' : ''));
        }
      }
      out.diff.spacers.push({ name: n, st: st, a: a, b: b });
    });
    if (rtF) contract.animations.forEach(function (a) {
      if (!a.loop || !fa[a.name]) return;
      var bad = seamOf(rtF, a.name);
      if (bad) put('warning', 'seam', a.name + ': ' + bad);
    });
    if (at) row('Сторінки атласу', (draft.page ? 1 : 0), at.pages.length);
    out.sum = {
      anims: fNames.map(function (n) { return [n, durationOf(fa[n])]; }),
      skins: fSkins,
      spacers: fSp,
      w: Math.round(bB.w), h: Math.round(bB.h),
      bones: fc.bones, slots: fc.slots, regions: fAtt.length,
      pages: at ? at.pages.map(function (p) { var g = (input.pages || {})[p.name] || {}; return [out.rename[p.name] || p.name, p.w || g.w || 0, p.h || g.h || 0]; }) : [],
      version: sk.spine || '', hash: sk.hash || ''
    };
    return finish();
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
    skinSlug: skinSlug,
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
    finalCheck: finalCheck,
    atlasOf: atlasOf,
    renamePages: renamePages,
    durationOf: durationOf,
    pngSize: pngSize,
    roundTo: roundTo
  };
})(typeof window !== 'undefined' ? window : globalThis);
