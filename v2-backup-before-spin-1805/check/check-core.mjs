import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
require(join(HERE, '../src/core.js'));
const K = globalThis.SpineDraftKit;
const spine = await import(join(process.env.HOME, 'Documents/GitHub/spine-viewer-v2/node_modules/@esotericsoftware/spine-core/dist/index.js'));
const ART = join(process.env.HOME, 'Documents/Lucky/TwinWin/workshop/GitLab/Art/art-dice-dominium');
const ref = JSON.parse(readFileSync(join(ART, 'validator/reference/spines.json'), 'utf8'));

const problems = [];
const fail = m => problems.push(m);

const stdAnims = [
  { name: 'idle', duration: 2, preset: 'breathe', loop: true },
  { name: 'stop', duration: 0.28, preset: 'land' },
  { name: 'win', duration: 0.85, preset: 'win' },
  { name: 'win_idle', duration: 0.85, preset: 'win', loop: true },
  { name: 'win_insignificant', duration: 0.65, preset: 'pulse' }
];
const frameAnims = [{ name: 'in', duration: 0.5 }, { name: 'loop_1', duration: 2, loop: true }, { name: 'out', duration: 0.3 }];
const dice = {
  game: 'dice-dominium', reels: 5, rows: 3, cell: { w: 334, h: 334 },
  components: [
    { id: 'symbols', type: 'symbols', txt: true, anims: stdAnims, symbols: ['blank', 'dice_1', 'dice_2', 'dice_3', 'dice_4', 'dice_5', 'dice_6', 'high_1', 'high_2', 'high_3', 'high_4', 'jackpot', 'low_1', 'low_2', 'low_3', 'low_4', 'low_5', 'wild_1'].map(name => ({ name })) },
    { id: 'reels', type: 'reels' },
    { id: 'frame_under', type: 'frame_under', skins: 'default, freespins, maingame', anims: frameAnims },
    { id: 'frame_above', type: 'frame_above', skins: 'default, freespins, maingame', anims: frameAnims, spacers: 'txt_pays_left, txt_pays_right' },
    { id: 'c1', type: 'custom', name: 'animation_bg', skins: 'default', w: 1920, h: 1080, anims: [{ name: 'in', duration: 2, events: 'onMainGameIntroSound@0.8667' }, { name: 'loop_1', duration: 4, loop: true }, { name: 'loop_2', duration: 4, loop: true }, { name: 'loop_3', duration: 4, loop: true }, { name: 'out', duration: 0.1 }, { name: 'splash_loop', duration: 2, loop: true }] }
  ]
};
const px = key => (key.startsWith('sym:') ? { w: 280, h: 280 } : null);
const plan = K.planAll(dice, px);

const canon = v => JSON.stringify(v);
for (const s of plan.spines) {
  const r = ref[s.name + '.json'];
  if (!r) { if (!/symbol_(blank|dice_\d|jackpot)$/.test(s.name)) fail(`${s.name}: no reference entry`); continue; }
  if (s.name === 'animation_symbol_wild_1') continue;
  const c = s.contract;
  if (canon([...c.skins].sort()) !== canon([...r.skins].sort())) fail(`${s.name}: skins ${c.skins} vs ${r.skins}`);
  if (canon(c.animations.map(a => a.name)) !== canon(r.animations)) fail(`${s.name}: animations ${c.animations.map(a => a.name)} vs ${r.animations}`);
  if (canon(c.decorationSpacers) !== canon([...r.decorationSpacers].sort())) fail(`${s.name}: spacers ${c.decorationSpacers} vs ${r.decorationSpacers}`);
  for (const a of c.animations) {
    const want = (r.events || {})[a.name] || [];
    if (canon(a.events || []) !== canon(want)) fail(`${s.name}/${a.name}: events ${canon(a.events || [])} vs ${canon(want)}`);
  }
  if (s.warnings.length) fail(`${s.name}: warnings ${s.warnings}`);
}

class FakeTexture extends spine.Texture {
  constructor() { super({ width: 4096, height: 4096 }); }
  setFilters() {}
  setWraps() {}
  dispose() {}
}
const parsed = {};
for (const s of plan.spines) {
  try {
    const atlas = new spine.TextureAtlas(s.atlasText);
    for (const page of atlas.pages) page.setTexture(new FakeTexture());
    const data = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData(s.jsonText);
    const sk = new spine.Skeleton(data);
    if (data.skins.length && !data.defaultSkin) sk.setSkin(data.skins[0]);
    sk.setToSetupPose();
    sk.updateWorldTransform();
    for (const anim of data.animations) {
      const st = new spine.AnimationState(new spine.AnimationStateData(data));
      st.setAnimation(0, anim.name, false);
      for (let t = 0; t <= anim.duration + 0.05; t += 1 / 60) { st.update(1 / 60); st.apply(sk); sk.updateWorldTransform(); }
    }
    for (const e of K.checkExport({ spineName: s.name, jsonText: s.jsonText, atlasText: s.atlasText }, { tech: plan.tech, spines: plan.spines.map(x => x.contract) }).findings) {
      if (e.level !== 'info') fail(`${s.name}: checker ${e.level} ${e.title} ${e.detail}`);
    }
    parsed[s.name] = { data, sk };
  } catch (e) { fail(`${s.name}: spine-core ${e.message}`); }
}

const rows = parsed.animation_reel_3_rows;
if (rows) {
  const pose = (animName, t) => {
    const sk = new spine.Skeleton(rows.data);
    sk.setToSetupPose();
    rows.data.findAnimation(animName).apply(sk, 0, t, false, [], 1, spine.MixBlend.setup, spine.MixDirection.mixIn);
    sk.updateWorldTransform();
    return [0, 1, 2, 3].map(i => Math.round(sk.findBone('slot_' + i).worldY));
  };
  const loopEnd = rows.data.findAnimation('spin_loop').duration;
  const stopEnd = rows.data.findAnimation('spin_stop').duration;
  console.log('rows setup', pose('spin_start', 0), 'loop mid', pose('spin_loop', loopEnd / 2), 'loop end', pose('spin_loop', loopEnd), 'stop end', pose('spin_stop', stopEnd), 'durations', K.roundTo(loopEnd, 4), K.roundTo(stopEnd, 4));
  const real = JSON.parse(readFileSync(join(ART, 'skins/main/Motion/spine/animation_reel_3_rows.json'), 'utf8'));
  const gen = plan.spines.find(s => s.name === 'animation_reel_3_rows').json;
  for (const a of ['spin_loop', 'spin_stop']) {
    const tr = (j, b) => j.animations[a].bones[b].translate.map(k => `${k.time || 0}:${Math.round(k.y || 0)}`).join(' ');
    for (const b of ['slot_0', 'slot_1', 'slot_2', 'slot_3']) console.log(a, b, '\n  gen ', tr(gen, b), '\n  real', tr(real, b));
    console.log(a, 'events gen ', gen.animations[a].events.map(e => `${e.time || 0}:${e.name}${e.int ?? ''}`).join(' '));
    console.log(a, 'events real', real.animations[a].events.map(e => `${e.time || 0}:${e.name}${e.int ?? ''}`).join(' '));
  }
}

const g45 = K.planAll({ reels: 4, rows: 5, cell: { w: 200, h: 180 }, components: [{ id: 'reels', type: 'reels' }] }, () => null);
for (const s of g45.spines) {
  try {
    const atlas = new spine.TextureAtlas(s.atlasText);
    for (const page of atlas.pages) page.setTexture(new FakeTexture());
    const data = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData(s.jsonText);
    if (s.name.includes('rows')) {
      const pose = (n, t) => { const sk = new spine.Skeleton(data); sk.setToSetupPose(); data.findAnimation(n).apply(sk, 0, t, false, [], 1, spine.MixBlend.setup, spine.MixDirection.mixIn); sk.updateWorldTransform(); return data.bones.filter(b => /^slot_\d$/.test(b.name)).map(b => Math.round(sk.findBone(b.name).worldY)); };
      console.log('4x5', s.name, 'setup', pose('spin_start', 0), 'stop end', pose('spin_stop', data.findAnimation('spin_stop').duration), s.contract.animations.map(a => `${a.name}:${(a.events || []).map(e => e.name + (e.int ?? '')).join('/')}`).join(' '));
    } else console.log('4x5', s.name, s.contract.decorationSpacers.join(','), data.findBone('reel_0').x, data.findBone('reel_3').x);
  } catch (e) { fail(`4x5 ${s.name}: ${e.message}`); }
}

console.log(plan.spines.map(s => `${s.name} ${s.page.width}x${s.page.height}`).join('\n'));
console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'OK: contract matches the Dice reference, spine-core parses and plays every spine');
process.exit(problems.length ? 1 : 0);
