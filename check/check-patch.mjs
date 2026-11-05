import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
createRequire(import.meta.url)(join(HERE, '../src/patch.js'));
const P = globalThis.SpineKitPatch;
const results = [];
const ok = (label, cond, detail = '') => results.push(`${cond ? 'PASS' : 'FAIL'} ${label}${cond || !detail ? '' : ' :: ' + detail}`);
const J = x => JSON.stringify(x);
const clone = x => JSON.parse(J(x));
const canon = x => Array.isArray(x) ? x.map(canon) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canon(x[k])])) : x;
const C = x => J(canon(x));

const roundTrip = (label, a, b) => {
  const ops = P.diff(a, b);
  const x = clone(a);
  const inv = P.invert(x, ops);
  const applied = P.apply(x, ops);
  ok(`${label}: diff+apply`, J(x) === J(b), `${J(ops)} -> ${J(x)}`);
  ok(`${label}: all ops applied`, applied.length === ops.length, J(ops));
  P.apply(x, inv);
  ok(`${label}: invert`, C(x) === C(a), `${J(inv)} -> ${J(x)}`);
  return ops;
};

const base = () => ({
  settings: {
    game: 'dice', reels: 5, rows: 3, cell: { w: 334, h: 334 },
    components: [
      { id: 'symbols', type: 'symbols', symbols: [{ name: 'high_1' }, { name: 'low_1' }], anims: [{ name: 'idle', duration: 2 }, { name: 'win', duration: 0.85 }] },
      { id: 'reels', type: 'reels' },
      { id: 'c1', type: 'custom', name: 'animation_logo', w: 640, parts: [{ name: 'glow', x: 0 }], anims: [{ name: 'in', duration: 0.5, keys: { art: [{ t: 0, y: 0 }, { t: 0.3, y: 120 }] } }] }
    ],
    layouts: { list: [{ name: 'layout_landscape_16_9', w: 2560, h: 1440, bones: [{ name: 'position_logo', x: 0, y: 500 }] }], bind: {} }
  },
  images: { 'sym:high_1': { sha: 'a'.repeat(64), name: 'high_1.png', type: 'png', w: 300, h: 300 } }
});

{
  const a = base(), b = base();
  b.settings.game = 'dice2'; b.settings.cell.w = 300; delete b.settings.rows; b.settings.extra = { x: 1 };
  roundTrip('objects', a, b);
}
{
  const a = base(), b = base();
  b.settings.components.unshift({ id: 'bg', type: 'custom', name: 'animation_bg' });
  b.settings.components.splice(2, 0, { id: 'c2', type: 'custom', name: 'animation_popup' });
  b.settings.components.push({ id: 'c3', type: 'custom', name: 'animation_x' });
  const ops = roundTrip('keyed insert start/middle/end', a, b);
  ok('keyed insert uses after', ops.filter(o => 'after' in o).map(o => o.after).join(',') === ',symbols,c1', J(ops));
}
{
  const a = base(), b = base();
  b.settings.components = b.settings.components.filter(c => c.id !== 'reels');
  const ops = roundTrip('keyed delete', a, b);
  ok('keyed delete is one op', ops.length === 1 && ops[0].d === 1 && ops[0].p[2].id === 'reels', J(ops));
}
{
  const a = base(), b = base();
  b.settings.components.reverse();
  const ops = roundTrip('keyed order', a, b);
  ok('order is one o op', ops.length === 1 && Array.isArray(ops[0].o), J(ops));
}
{
  const a = base(), b = base();
  b.settings.components[0].symbols[0].name = 'high_9';
  const ops = roundTrip('rename by name', a, b);
  ok('rename = delete + insert after null', ops.length === 2 && ops[0].d === 1 && ops[1].after === null, J(ops));
}
{
  const a = base(), b = base();
  b.settings.components[2].anims[0].keys.art[1].y = 90;
  const ops = roundTrip('atomic keyframes', a, b);
  ok('keyframes written whole', ops.length === 1 && ops[0].p.at(-1) === 'art' && Array.isArray(ops[0].v), J(ops));
}
{
  const a = base(), b = base();
  b.settings.components[2].w = 700;
  b.settings.components[0].anims[1].duration = 1;
  b.settings.layouts.list[0].bones[0].x = 40;
  b.settings.layouts.list[0].bones.push({ name: 'position_popup', x: 0, y: 0 });
  b.settings.components[2].parts.push({ name: 'star', x: 10 });
  roundTrip('nested keyed fields', a, b);
}
{
  const a = base(), b = base();
  b.images['frame_above'] = { sha: 'b'.repeat(64), name: 'frame.png', type: 'png', w: 10, h: 10 };
  delete b.images['sym:high_1'];
  roundTrip('images add/remove', a, b);
  const c = base();
  c.images['sym:high_1'].sha = 'c'.repeat(64);
  roundTrip('image replaced', a, c);
}
{
  const a = base(), b = base();
  b.settings.components[0].symbols = ['x', 'y'];
  roundTrip('keyed → atomic', a, b);
  const c = base();
  c.settings.components[0].symbols = [{ name: 'a' }, { name: 'a' }];
  roundTrip('duplicate names → atomic', a, c);
  const d = base();
  d.settings.layouts.bind = { c1: 'position_logo' };
  roundTrip('empty object → filled', a, d);
  const e = base();
  e.settings.components[1].parts = [{ name: 'p1' }];
  e.settings.components[2].parts = [];
  roundTrip('empty array ↔ keyed', a, e);
}
{
  const server = base();
  const A = base(), B = base();
  A.settings.components[2].w = 1;
  B.settings.components[2].name = 'animation_logo_2';
  const opsA = P.diff(base(), A), opsB = P.diff(base(), B);
  P.apply(server, opsA); P.apply(server, opsB);
  ok('different fields both kept', server.settings.components[2].w === 1 && server.settings.components[2].name === 'animation_logo_2');
  const s2 = base();
  const del = P.diff(base(), (() => { const x = base(); x.settings.components = x.settings.components.filter(c => c.id !== 'c1'); return x; })());
  P.apply(s2, del);
  const applied = P.apply(s2, opsA);
  ok('write under deleted parent skipped', applied.length === 0 && !s2.settings.components.some(c => c.id === 'c1'), J(applied));
  ok('get', P.get(base(), ['settings', 'components', { id: 'c1' }, 'parts', { name: 'glow' }, 'x']) === 0 && P.get(base(), ['settings', 'nope', 'x']) === undefined);
}

const rnd = (() => { let s = 12345; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; })();
const pick = arr => arr[Math.floor(rnd() * arr.length)];
let uid = 0;
const edit = doc => {
  const s = doc.settings;
  const comps = s.components;
  const c = pick(comps);
  const r = rnd();
  if (r < 0.12) s.game = 'g' + Math.floor(rnd() * 1000);
  else if (r < 0.2) comps.splice(Math.floor(rnd() * (comps.length + 1)), 0, { id: 'n' + (++uid) + Math.floor(rnd() * 1e6), type: 'custom', name: 'x', w: 10, anims: [], parts: [] });
  else if (r < 0.26 && comps.length > 2) comps.splice(comps.indexOf(c), 1);
  else if (r < 0.32) { comps.sort(() => rnd() - 0.5); }
  else if (r < 0.42 && c) c.w = Math.floor(rnd() * 999);
  else if (r < 0.5 && c) { c.anims = c.anims || []; c.anims.push({ name: 'a' + (++uid), duration: rnd() }); }
  else if (r < 0.55 && c && c.anims && c.anims.length) c.anims.splice(Math.floor(rnd() * c.anims.length), 1);
  else if (r < 0.6 && c && c.anims && c.anims.length) pick(c.anims).name = 'r' + (++uid);
  else if (r < 0.65 && c && c.anims && c.anims.length) pick(c.anims).keys = { art: [{ t: 0, y: Math.floor(rnd() * 100) }] };
  else if (r < 0.72 && c) { c.parts = c.parts || []; c.parts.splice(Math.floor(rnd() * (c.parts.length + 1)), 0, { name: 'p' + (++uid), x: 0 }); }
  else if (r < 0.76 && c && c.parts && c.parts.length) c.parts.splice(Math.floor(rnd() * c.parts.length), 1);
  else if (r < 0.8 && c && c.parts && c.parts.length) pick(c.parts).x = Math.floor(rnd() * 50);
  else if (r < 0.86) { const L = s.layouts.list[0]; L.bones.push({ name: 'b' + (++uid), x: 0, y: 0 }); }
  else if (r < 0.9) { const L = s.layouts.list[0]; if (L.bones.length) L.bones.splice(Math.floor(rnd() * L.bones.length), 1); }
  else if (r < 0.95) doc.images['k' + Math.floor(rnd() * 5)] = { sha: String(uid++).padStart(64, '0'), name: 'n.png', type: 'png', w: 1, h: 1 };
  else delete doc.images['k' + Math.floor(rnd() * 5)];
};

{
  const server = base();
  const log = [];
  const clients = [0, 1, 2].map(i => ({ i, confirmed: base(), pending: [], shadow: base(), seen: 0, seq: 0 }));
  let diffBad = 0;
  const deliver = cl => {
    while (cl.seen < log.length) {
      const b = log[cl.seen++];
      P.apply(cl.confirmed, b.ops);
      if (b.client === cl.i) cl.pending.shift();
      else {
        cl.shadow = clone(cl.confirmed);
        cl.pending.forEach(p => P.apply(cl.shadow, p.ops));
      }
    }
  };
  const queue = [];
  for (let n = 0; n < 600; n++) {
    const cl = clients[n % 3];
    if (rnd() < 0.5) deliver(cl);
    const next = clone(cl.shadow);
    edit(next);
    const ops = P.diff(cl.shadow, next);
    const check = clone(cl.shadow);
    P.apply(check, ops);
    if (J(check) !== J(next)) diffBad++;
    cl.shadow = next;
    if (ops.length) { const b = { client: cl.i, seq: ++cl.seq, ops }; cl.pending.push(b); queue.push(b); }
    while (queue.length && rnd() < 0.6) { const b = queue.shift(); log.push({ client: b.client, seq: b.seq, ops: P.apply(server, b.ops) }); }
  }
  while (queue.length) { const b = queue.shift(); log.push({ client: b.client, seq: b.seq, ops: P.apply(server, b.ops) }); }
  clients.forEach(deliver);
  ok('random: diff reproduces target every time', diffBad === 0, `${diffBad} bad diffs`);
  ok('random: 3 clients × 200 edits converge', clients.every(c => J(c.confirmed) === J(server) && J(c.shadow) === J(server) && !c.pending.length), clients.map(c => J(c.confirmed).length).join(','));
}

console.log(results.join('\n'));
const bad = results.filter(r => r.startsWith('FAIL'));
console.log(`\n${results.length - bad.length}/${results.length} passed`);
process.exit(bad.length ? 1 : 0);
