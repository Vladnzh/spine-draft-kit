(function (root) {
  'use strict';

  function isObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  function keyBy(arr, k) {
    var seen = {};
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i];
      if (!isObj(v)) return false;
      var id = v[k];
      if ((typeof id !== 'string' && typeof id !== 'number') || id === '' || seen['$' + id]) return false;
      seen['$' + id] = true;
    }
    return true;
  }
  function kind(arr) {
    if (!arr.length) return '';
    if (keyBy(arr, 'id')) return 'id';
    if (keyBy(arr, 'name')) return 'name';
    return null;
  }
  function segKey(seg) { return isObj(seg) ? ('id' in seg ? 'id' : 'name') : null; }
  function find(arr, seg) {
    var k = segKey(seg), v = seg[k];
    for (var i = 0; i < arr.length; i++) if (isObj(arr[i]) && arr[i][k] === v) return i;
    return -1;
  }
  function seg(k, v) { var s = {}; s[k] = v; return s; }

  function walk(doc, path) {
    var cur = doc;
    for (var i = 0; i < path.length; i++) {
      var s = path[i];
      if (typeof s === 'string') {
        if (!isObj(cur) || !Object.prototype.hasOwnProperty.call(cur, s)) return undefined;
        cur = cur[s];
      } else {
        if (!Array.isArray(cur)) return undefined;
        var j = find(cur, s);
        if (j === -1) return undefined;
        cur = cur[j];
      }
    }
    return cur;
  }
  function get(doc, path) { return walk(doc, path); }

  function diffInto(out, a, b, path) {
    if (same(a, b)) return;
    if (isObj(a) && isObj(b)) {
      Object.keys(a).forEach(function (k) { if (!Object.prototype.hasOwnProperty.call(b, k)) out.push({ p: path.concat(k), d: 1 }); });
      Object.keys(b).forEach(function (k) {
        if (!Object.prototype.hasOwnProperty.call(a, k)) out.push({ p: path.concat(k), v: clone(b[k]) });
        else diffInto(out, a[k], b[k], path.concat(k));
      });
      return;
    }
    if (Array.isArray(a) && Array.isArray(b) && path.length) {
      var ka = kind(a), kb = kind(b);
      var k = ka === '' ? kb : kb === '' ? ka : ka === kb ? ka : null;
      if (k) {
        var inB = {}, inA = {};
        b.forEach(function (x) { inB['$' + x[k]] = x; });
        a.forEach(function (x) { inA['$' + x[k]] = x; });
        var order = [];
        a.forEach(function (x) {
          if (!inB['$' + x[k]]) out.push({ p: path.concat([seg(k, x[k])]), d: 1 });
          else order.push(x[k]);
        });
        b.forEach(function (x, i) {
          if (inA['$' + x[k]]) return;
          var after = i ? b[i - 1][k] : null;
          out.push({ p: path.concat([seg(k, x[k])]), v: clone(x), after: after });
          var at = after === null ? 0 : order.indexOf(after) + 1;
          if (after !== null && at === 0) at = order.length;
          order.splice(at, 0, x[k]);
        });
        b.forEach(function (x) { if (inA['$' + x[k]]) diffInto(out, inA['$' + x[k]], x, path.concat([seg(k, x[k])])); });
        var want = b.map(function (x) { return x[k]; });
        if (!same(order, want)) out.push({ p: path, o: want });
        return;
      }
    }
    out.push({ p: path, v: clone(b) });
  }
  function diff(a, b) {
    var out = [];
    diffInto(out, a, b, []);
    return out;
  }

  function step(doc, op) {
    var p = op.p;
    if (!Array.isArray(p) || !p.length) return false;
    var parent = walk(doc, p.slice(0, -1));
    var last = p[p.length - 1];
    if ('o' in op) {
      var arr = walk(doc, p);
      if (!Array.isArray(arr) || !Array.isArray(op.o)) return false;
      var k = keyBy(arr, 'id') ? 'id' : keyBy(arr, 'name') ? 'name' : null;
      if (!k) return false;
      var listed = [], rest = arr.slice();
      op.o.forEach(function (v) {
        var j = find(rest, seg(k, v));
        if (j !== -1) { listed.push(rest[j]); rest.splice(j, 1); }
      });
      var next = listed.concat(rest);
      if (same(next.map(function (x) { return x[k]; }), arr.map(function (x) { return x[k]; }))) return false;
      arr.length = 0;
      next.forEach(function (x) { arr.push(x); });
      return true;
    }
    if (typeof last === 'string') {
      if (!isObj(parent)) return false;
      if (op.d) {
        if (!Object.prototype.hasOwnProperty.call(parent, last)) return false;
        delete parent[last];
        return true;
      }
      if (!('v' in op)) return false;
      parent[last] = clone(op.v);
      return true;
    }
    if (!isObj(last) || !Array.isArray(parent)) return false;
    var at = find(parent, last);
    if (op.d) {
      if (at === -1) return false;
      parent.splice(at, 1);
      return true;
    }
    if (!('v' in op) || !isObj(op.v)) return false;
    var val = clone(op.v);
    var key = segKey(last);
    val[key] = last[key];
    if (at !== -1) { parent[at] = val; return true; }
    var pos = parent.length;
    if (op.after === null) pos = 0;
    else if (op.after !== undefined) {
      var j2 = find(parent, seg(key, op.after));
      if (j2 !== -1) pos = j2 + 1;
    }
    parent.splice(pos, 0, val);
    return true;
  }
  function apply(doc, ops) {
    var done = [];
    (ops || []).forEach(function (op) { if (step(doc, op)) done.push(op); });
    return done;
  }

  function inverseOf(doc, op) {
    var p = op.p;
    if (!Array.isArray(p) || !p.length) return null;
    var last = p[p.length - 1];
    if ('o' in op) {
      var arr = walk(doc, p);
      if (!Array.isArray(arr)) return null;
      var k = keyBy(arr, 'id') ? 'id' : keyBy(arr, 'name') ? 'name' : null;
      return k ? { p: p, o: arr.map(function (x) { return x[k]; }) } : null;
    }
    var parent = walk(doc, p.slice(0, -1));
    if (typeof last === 'string') {
      if (!isObj(parent)) return null;
      if (Object.prototype.hasOwnProperty.call(parent, last)) return { p: p, v: clone(parent[last]) };
      return op.d ? null : { p: p, d: 1 };
    }
    if (!Array.isArray(parent)) return null;
    var at = find(parent, last);
    if (at === -1) return op.d ? null : { p: p, d: 1 };
    if (op.d) {
      var key = segKey(last);
      return { p: p, v: clone(parent[at]), after: at ? parent[at - 1][key] : null };
    }
    return { p: p, v: clone(parent[at]) };
  }
  function invertEach(doc, ops) {
    var sim = clone(doc);
    return (ops || []).map(function (op) {
      var inv = inverseOf(sim, op);
      return step(sim, op) ? inv : null;
    });
  }
  function invert(doc, ops) {
    return invertEach(doc, ops).filter(Boolean).reverse();
  }

  var api = { diff: diff, apply: apply, invert: invert, invertEach: invertEach, get: get, clone: clone, same: same };
  root.SpineKitPatch = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
