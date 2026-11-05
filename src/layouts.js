(function (root) {
  'use strict';
  var AREAS = ['area_bottom', 'area_bottom_left', 'area_bottom_right', 'area_center', 'area_left', 'area_right', 'area_top', 'area_top_left', 'area_top_right'];
  var MARGINS = {
    area_top_left: [0, 0], area_top: [0.5, 0], area_top_right: [1, 0],
    area_left: [0, 0.5], area_center: [0.5, 0.5], area_right: [1, 0.5],
    area_bottom_left: [0, 1], area_bottom: [0.5, 1], area_bottom_right: [1, 1]
  };
  var SCREENS = {
    layout_landscape_16_9: [['16:9', 16 / 9], ['19.5:9', 19.5 / 9], ['21:9', 21 / 9]],
    layout_landscape_4_3: [['4:3', 4 / 3], ['3:2', 3 / 2], ['16:10', 16 / 10]],
    layout_portrait_9_16: [['9:16', 9 / 16], ['9:19.5', 9 / 19.5], ['3:4', 3 / 4], ['1:1', 1]]
  };
  var C = 'area_center', B = 'area_bottom', TR = 'area_top_right', BL = 'area_bottom_left';
  var TEMPLATE = [
    ['layout_landscape_16_9', 2560, 1440, [
      ['position_background', C, 1280, -720, 0.77], ['position_fullscreen', C, 1280, -720], ['position_reels', C, 1280, -720, 0.85],
      ['position_loading', B, 1280, -1334], ['position_game_logo', C, 1280, -127, 1.2], ['position_loading_audio', TR, 2338, -68],
      ['position_arrow_left', C, 194, -720], ['position_arrow_right', C, 2337, -720, 1, 180], ['position_paytable', C, 1280, -720],
      ['position_freespins', C, 1280, -720], ['position_outcomes', C, 1280, -720, 0.86], ['position_feature_bet_button', C, 269, -1042, 0.9],
      ['position_feature_bet_screen', C, 1280, -720], ['position_logo', C, 1280, -720, 0.77], ['position_character', C, 278.02, -626, 0.35],
      ['position_brand_logo', C, 1280, -1186, 1.06], ['position_features_carousel', C, 1280, -720], ['position_btn_play_now', C, 1280, -1180],
      ['position_btn_close', TR, 2404, -157], ['position_spin_indicator', C, 2337, -705.83], ['position_video_skip', B, 1280, -1334],
      ['position_video_sound', BL, 152, -1288], ['position_video', C, 1280, -720, 2]
    ]],
    ['layout_landscape_4_3', 1920, 1440, [
      ['position_background', C, 961, -723, 0.7], ['position_fullscreen', C, 960, -720], ['position_reels', C, 960, -720, 0.7],
      ['position_loading', B, 960, -1328, 0.75], ['position_game_logo', C, 961, -194.28, 1.2], ['position_loading_audio', TR, 1858, -94, 0.75],
      ['position_arrow_left', C, 120, -720, 0.75], ['position_arrow_right', C, 1800, -720, 0.75, 180], ['position_paytable', C, 960, -720, 0.75],
      ['position_freespins', C, 960, -720, 0.75], ['position_outcomes', C, 961, -720, 0.75], ['position_feature_bet_button', C, 186, -985, 0.75],
      ['position_feature_bet_screen', C, 960, -720, 0.75], ['position_logo', C, 960, -708, 0.7], ['position_character', C, 178, -687.1, 0.25],
      ['position_brand_logo', C, 960, -1084, 0.8], ['position_features_carousel', C, 960, -720, 0.9], ['position_btn_play_now', C, 960, -1097, 0.75],
      ['position_btn_close', TR, 1783, -136], ['position_spin_indicator', C, 1763.78, -708.49, 0.75], ['position_video_skip', B, 960, -1334, 0.75],
      ['position_video_sound', BL, 152, -1334, 0.75], ['position_video', C, 960, -720, 2]
    ]],
    ['layout_portrait_9_16', 1440, 2560, [
      ['position_background', C, 720, -1280], ['position_fullscreen', C, 720, -1480], ['position_reels', C, 720, -1280, 0.8],
      ['position_loading', B, 720, -2430], ['position_game_logo', C, 1220, -165, 1.2], ['position_loading_audio', TR, 1376, -90],
      ['position_arrow_left', C, 195, -2001], ['position_arrow_right', C, 1245, -2001, 1, 180], ['position_spin_indicator', C, 720, -2077.44],
      ['position_paytable', C, 720, -1280], ['position_freespins', C, 720, -1280], ['position_outcomes', C, 720, -1280, 0.9],
      ['position_feature_bet_button', C, 142, -1899, 0.85], ['position_feature_bet_screen', C, 720, -1280], ['position_logo', C, 720, -1280],
      ['position_character', C, 720, -535, 0.5], ['position_button_action', B, 720, -2290], ['position_brand_logo', C, 720, -2003, 1.04],
      ['position_features_carousel', C, 720, -1280], ['position_btn_play_now', C, 727, -2312, 0.9], ['position_btn_close', TR, 1280, -210],
      ['position_video_skip', B, 720, -2426, 0.86], ['position_video_sound', BL, 152, -2408, 0.86], ['position_video', C, 720, -1289, 2]
    ]]
  ];
  var BONE_KEYS = ['rotation', 'x', 'y', 'scaleX', 'scaleY', 'shearX', 'shearY'];

  function r2(v) { return Math.round(Number(v) * 100) / 100 || 0; }
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }
  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

  function cleanBone(b) {
    var o = { name: String(b.name), parent: b.parent ? String(b.parent) : 'root', x: r2(num(b.x, 0)), y: r2(num(b.y, 0)), scaleX: r2(num(b.scaleX, 1)), scaleY: r2(num(b.scaleY, 1)), rotation: r2(num(b.rotation, 0)) };
    if (b.shearX) o.shearX = r2(b.shearX);
    if (b.shearY) o.shearY = r2(b.shearY);
    return o;
  }

  function fromTemplate(t) {
    var bones = AREAS.map(function (a) { return cleanBone({ name: a, parent: 'root' }); });
    t[3].forEach(function (b) {
      var s = b[4] === undefined ? 1 : b[4];
      bones.push(cleanBone({ name: b[0], parent: b[1], x: b[2], y: b[3], scaleX: s, scaleY: s, rotation: b[5] || 0 }));
    });
    return { name: t[0], w: t[1], h: t[2], bones: bones };
  }
  function template(name) {
    var t = TEMPLATE.filter(function (x) { return x[0] === name; })[0];
    return t ? fromTemplate(t) : null;
  }
  function stock(name) { return TEMPLATE.some(function (t) { return t[3].some(function (b) { return b[0] === name; }); }); }

  function defaults() { return { list: TEMPLATE.map(fromTemplate), bind: {}, off: {} }; }

  function normalizeLayout(L) {
    if (!L || typeof L !== 'object' || !Array.isArray(L.bones)) return null;
    var seen = {};
    var bones = L.bones.filter(function (b) {
      if (!b || !b.name || b.name === 'root' || b.name === 'game_size' || seen[b.name]) return false;
      seen[b.name] = true;
      return true;
    }).map(cleanBone);
    var out = { name: String(L.name || 'layout'), w: Math.max(1, Math.round(Math.abs(num(L.w, 1920)))), h: Math.max(1, Math.round(Math.abs(num(L.h, 1080)))), bones: bones };
    if (L.src && typeof L.src === 'object') out.src = clone(L.src);
    return out;
  }
  function normalize(raw) {
    var d = defaults();
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.list)) return d;
    var list = raw.list.map(normalizeLayout).filter(Boolean);
    return {
      list: list.length ? list : d.list,
      bind: raw.bind && typeof raw.bind === 'object' ? clone(raw.bind) : {},
      off: raw.off && typeof raw.off === 'object' ? clone(raw.off) : {}
    };
  }

  function isArea(name) { return /^area_/.test(name); }
  function anchors(L) { return L.bones.filter(function (b) { return !isArea(b.name); }); }
  function boneOf(L, name) { return L ? L.bones.filter(function (b) { return b.name === name; })[0] || null : null; }

  function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { var t = a % b; a = b; b = t; } return a || 1; }
  function title(L) {
    var m = /^layout_[a-z]+_(\d+)_(\d+)$/.exec(L.name);
    if (m) return m[1] + ':' + m[2];
    var g = gcd(L.w, L.h);
    return L.w / g <= 50 && L.h / g <= 50 ? L.w / g + ':' + L.h / g : String(Math.round(L.w / L.h * 100) / 100);
  }
  function screens(L) {
    var own = L.w / L.h;
    var list = (SCREENS[L.name] || []).slice();
    if (!list.some(function (s) { return Math.abs(s[1] - own) < 0.005; })) list.unshift([title(L), own]);
    return list;
  }

  function screen(L, aspect) {
    var own = L.w / L.h;
    var a = aspect > 0 ? aspect : own;
    return a > own ? { w: L.h * a, h: L.h } : { w: L.w, h: L.w / a };
  }
  function place(L, b, scr) {
    var s = Math.min(scr.w / L.w, scr.h / L.h);
    var m = MARGINS[b.parent];
    var x, y;
    if (!m) { x = Math.round(b.x / L.w * scr.w); y = Math.round(b.y / L.h * scr.h); }
    else if (scr.w / scr.h > L.w / L.h) { x = b.x * s + (scr.w - L.w * s) * m[0]; y = b.y * s; }
    else { x = b.x * s; y = b.y * s + (L.h * s - scr.h) * m[1]; }
    var r = -(b.rotation || 0) * Math.PI / 180;
    var sx = s * Math.abs(b.scaleX), sy = s * Math.abs(b.scaleY);
    return { a: Math.cos(r) * sx, b: Math.sin(r) * sx, c: -Math.sin(r) * sy, d: Math.cos(r) * sy, e: Math.abs(x), f: Math.abs(y) };
  }
  function nudge(L, b, scr, dx, dy) {
    var s = Math.min(scr.w / L.w, scr.h / L.h);
    if (!MARGINS[b.parent]) return { x: dx * L.w / scr.w, y: -dy * L.h / scr.h };
    return { x: dx / s, y: -dy / s };
  }

  function exportBone(b) {
    var o = { name: b.name };
    if (b.parent) o.parent = b.parent;
    BONE_KEYS.forEach(function (k) {
      var unit = k === 'scaleX' || k === 'scaleY';
      var v = r2(b[k] === undefined ? (unit ? 1 : 0) : b[k]);
      if (unit ? v !== 1 : v !== 0) o[k] = v;
    });
    return o;
  }
  function toJson(L, tech) {
    var src = L.src || {};
    var areas = L.bones.filter(function (b) { return isArea(b.name); });
    var rest = L.bones.filter(function (b) { return !isArea(b.name); });
    return {
      skeleton: { hash: src.hash || 'draft-' + L.name.replace(/^layout_/, ''), spine: (tech && tech.spineVersion) || '4.1.24', y: -L.h, width: L.w, height: L.h },
      bones: [{ name: 'root' }].concat(areas.map(exportBone), [{ name: 'game_size', parent: 'root', x: L.w, y: -L.h }], rest.map(exportBone)),
      slots: src.slots ? clone(src.slots) : [{ name: 'templates', bone: 'root', color: 'ffffff8f' }],
      skins: src.skins ? clone(src.skins) : [],
      animations: src.animations ? clone(src.animations) : { animation: {} }
    };
  }
  function editorJson(L, tech, items) {
    var json = toJson(L, tech);
    json.skeleton.images = './images/';
    json.slots = json.slots.map(function (s) { var o = clone(s); delete o.attachment; return o; });
    var att = {};
    items.forEach(function (it) {
      if (!boneOf(L, it.bone)) return;
      json.slots.push({ name: it.slot, bone: it.bone, attachment: it.region });
      var a = {};
      if (r2(it.x)) a.x = r2(it.x);
      if (r2(it.y)) a.y = r2(it.y);
      a.width = r2(it.width);
      a.height = r2(it.height);
      att[it.slot] = {};
      att[it.slot][it.region] = a;
    });
    json.skins = [{ name: 'default', attachments: att }];
    return json;
  }

  function parse(text, fileName) {
    var json = JSON.parse(text);
    if (!json || !Array.isArray(json.bones)) throw new Error('немає bones');
    var gs = json.bones.filter(function (b) { return b.name === 'game_size'; })[0];
    var sk = json.skeleton || {};
    var w = Math.abs(num(gs && gs.x, num(sk.width, 0))), h = Math.abs(num(gs && gs.y, num(sk.height, 0)));
    if (!w || !h) throw new Error('немає game_size');
    var name = String(json.fileName || fileName || 'layout').replace(/^.*[\\/]/, '').replace(/\.json$/i, '');
    var src = { hash: sk.hash || '' };
    if (Array.isArray(json.slots)) src.slots = json.slots;
    if (Array.isArray(json.skins)) src.skins = json.skins;
    if (json.animations && typeof json.animations === 'object') src.animations = json.animations;
    return normalizeLayout({ name: name, w: w, h: h, bones: json.bones, src: src });
  }

  root.SpineKitLayouts = {
    AREAS: AREAS,
    MARGINS: MARGINS,
    defaults: defaults,
    normalize: normalize,
    template: template,
    stock: stock,
    cleanBone: cleanBone,
    anchors: anchors,
    boneOf: boneOf,
    isArea: isArea,
    title: title,
    screens: screens,
    screen: screen,
    place: place,
    nudge: nudge,
    toJson: toJson,
    editorJson: editorJson,
    parse: parse
  };
})(typeof window !== 'undefined' ? window : globalThis);
