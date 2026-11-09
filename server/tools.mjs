import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.SPINE_KIT_PORT) || 5180;
const DATA = process.env.SPINE_KIT_DATA || join(HERE, 'projects');

const PRESETS = 'hold, fade_in, fade_out, pop_in, pop_out, pulse, breathe, land, win, shake, float_up, glow, flash';
const SANDBOX_STEP = 'Sandbox (the «Пісочниця» tab): the user\'s PERSONAL workbench to test and make components with a live preview. Only they and their Claude see it, it is the same in every project, it is not in the drafts, their export or the project history (so save what matters to the library). Use it for every new component or animation experiment. Call sandbox_guide once first (rules and recipes for a good result in 2-3 calls), look for a base in library_list, then sandbox_new with everything planned in one call and preview: true, read the filmstrip, fix with sandbox_update (anims_mode "merge", preview), check everything with sandbox_preview animation "all". When the user likes it: sandbox_save puts it into the component library (reusable in any project and game); sandbox_to_project or library_add copy it into the drafts only when the user asks. Changing the sandbox needs no permission; the drafts do.';
const finalStep = how => `Animator finals: the drafts go to animators, who polish them in Spine Editor (first animations, text spacers, events) and export under the same names. When the user brings such an export for a component (<spine>.json, <spine>.atlas and every .png page${how}; for symbols or reels the file names tell which spine they belong to), call import_final with apply false first. It checks the export against the component's draft, the contract the game and the art-repo validator rely on, and returns errors, warnings (each with an id) and the changes (animations, durations, events, spacers, skins, size, images). Errors block the import: tell the user what to fix in Spine and re-export; never change the component or the files to make an error go away. Show the user every warning as it is (title and detail) and the main changes, and ask about each warning; never accept a warning on your own, in bulk or because it looks harmless. Then call import_final with apply true, the same files, check = the check value of that result and accept = exactly the ids the user confirmed; if it answers that the warnings changed, show the new ones and ask again. If runtime_checked is false, the game-load, spacer, size and seam checks did not run: say so. After the import the preview and the export (zip, art repo) use the final instead of the draft. The component settings stay the contract: if they change later, get_project and the card show that the final no longer matches, so tell the user and suggest a new export or remove_final. preview with draft true shows the kit draft for comparison; remove_final goes back to the draft, only when the user asks.`;
const FINAL_DESC = 'Check an animator\'s finished Spine export (json, atlas and png pages from Spine Editor, under the draft\'s names) against a component\'s draft and, when allowed, import it INSTEAD of the draft: the preview and the export (zip, art repo) then use the animator\'s files. apply false (default) only checks: it returns errors, warnings (id, title, detail) and the changes, and nothing changes. apply true imports only when there are no errors, every warning id is in accept and check is the value from the apply false result (if the files or the draft changed since, nothing is imported and the new warnings come back). Errors: another Spine version, nonessential data, missing skins, animations, spacers or events of the draft, missing, broken or oversized (over 8192 px) atlas pages, missing regions, page names taken by another spine, a file the runtime cannot load. Warnings: anything that differs from the draft (new or reordered animations, durations beyond ±10 %, moved spacers or events, changed event fields, loops with a seam, another size or root, removed slots or images, a kit draft instead of an export, the Spine runtime not loaded so the runtime checks did not run). The user reads and confirms each warning; show them all and never accept one yourself.';
const finalSchema = files => ({
  type: 'object',
  properties: {
    component: { type: 'string', description: 'Component id, spine name (e.g. animation_last_5, animation_symbol_high_1) or type (symbols, reels, frame_under, frame_above).' },
    files: { type: 'array', items: { type: 'string' }, description: files + ' Files are matched to the component\'s spines by name; a component with one spine takes a single .json under any name.' },
    spine: { type: 'string', description: 'Only this spine of the component (symbols and reels have several).' },
    apply: { type: 'boolean', description: 'false (default): check only, nothing changes. true: import, allowed only without errors and with every warning id in accept.' },
    accept: { type: 'array', items: { type: 'string' }, description: 'Ids of the warnings the user read and confirmed, one by one, exactly as the check returned them ("<spine>:<id>" when several spines are imported at once). Never fill it on your own.' },
    check: { type: 'string', description: 'The check value returned by the apply false call whose warnings the user confirmed. Required for apply true when there are warnings.' }
  },
  required: ['component', 'files']
});

const GUIDE = `Sandbox guide: a good-looking component in 2-3 calls.

WORKFLOW
1. library_list first (query by kind: collector, meter, logo, popup, character...). If something close exists, sandbox_new {"from_library": id} and adapt it. library_list {"id"} shows its full keys: copy what works.
2. Plan the whole component before the first call: parts (what moves on its own), pivot, every animation the game calls with keys. Make it in ONE sandbox_new call (all parts + all anims) with "preview": true.
3. Read the filmstrip with the checklist below. Fix only what is wrong: sandbox_update with anims_mode "merge", only the rows you change, "preview": {"animation": "<row>"}.
4. After 2-3 rounds show it to the user (they watch the «Пісочниця» tab live) and ask what to change. Do not polish alone forever.
5. When the user is happy: sandbox_save with a label in the user's language and a one-line note (what it is, which game, which animations the game calls). sandbox_to_project only when the user asks.

STRUCTURE
- art = the main image; w x h is its box in game px. Parts = everything that moves, fades or blends on its own: glow, rays, shine, sparkles, coin, icon, plate, counter background, character limbs. Name parts by role: glow, rays, coin, plate, star_1...
- Draw order = the parts list; "behind": true puts a part under art (glows, rays, shadows).
- Light: "blend": "additive", setup "alpha": 0 (hidden until an animation shows it), placeholder "shape" glow / star / ring with a warm colour (ffd34d, ffb020, fff2b0): reads as light on dark game backgrounds.
- "parent": a part that must follow another part sits on it (a sparkle on a coin); x / y are from the parent's image centre, y up.
- "pivot": bottom for characters and anything standing, centre for badges, coins, buttons, "x:y" for hinges (a lid).
- Keep the motion compact: the stage fits every animation at one scale, a part flying 2000 px away makes everything tiny.
- No art yet: placeholders (shape + colour) at the real sizes; the motion can be judged now, art drops in later under the same part names.

TIMING (seconds)
- in / appear 0.3-0.6 (pop 0.35-0.5). out / hide 0.2-0.35, faster than in.
- idle / loop_N 1.5-3, seamless; breathing scale 1.02-1.05, float +-6-12 px.
- win 0.8-1.5: the biggest move in the first 30 %, then settle. win_idle: a calmer loop of the same idea.
- add / hit / bump (+1 on a counter) 0.25-0.4.
- anticipation loop 0.6-1.4, small and quick: shake +-4-8 px, rotate +-2-4 deg, glow pulse.
- trigger / big moment 1-2 with a flash: additive part, alpha 0 -> 0.9 -> 0 in 0.15-0.25 s.
- Repeated parts stagger by 0.04-0.08 s; secondary parts lag the main move by 0.03-0.1 s (follow-through).

EASING (ease = how the motion runs from THIS key to the next one)
- Entrances ease-out, or "back" (overshoots the next value, then settles: a pop with no extra keys). Exits ease-in. Loops ease-in-out on every key. Spinning rays linear. "soft" = a strong ease-out for landings.
- Never linear for organic motion. "shake" only on short keys. "stepped" = hard cuts.

MOTION THAT READS
- Pop in: scale 0.2 -> 1 with "back", alpha 0 -> 1 in the first 30 %.
- Squash and stretch keeps the volume: sx 1.1 with sy 0.9; a landing is sy 0.85 / sx 1.12, then back to 1.
- Anticipation: a small opposite move (scale 0.94, or y -10) for 10-20 % of the time before the main move.
- Nothing stops dead: overshoot and settle.
- One focal action per animation; secondary motion at about half the amplitude.
- At game scale: win scale peak 1.15-1.3, rotation 3-8 deg, glow alpha peak 0.6-0.9 (1 burns the art out).
- Loops: the first key equals the last key on every channel, the last key t equals the duration, no hold at the seam.
- Spinning rays: {"rays": [{"t": 0, "rotate": 0, "ease": "linear"}, {"t": 8, "rotate": -360}]} (rotate = degrees counter-clockwise, negative = clockwise), duration 8.

KEYS (recap)
{"<target>": [key, ...]}, target = art, a part, a spacer slot, a bar part or all. key: t (s), x / y (px offset, y up), scale or sx / sy (multiplier of setup), rotate (deg CCW, added), alpha (absolute), color ("ffcc00", absolute), ease. A channel missing in a key keeps its previous value; a channel with no key at 0 starts from the setup pose; values hold after the last key. Keys override the preset on the same channels; to control everything set preset "hold" and key it all. Duration = max(duration, last key t).

RECIPES (copy and adapt)
- in 0.45 (pop): {"all": [{"t": 0, "alpha": 0}, {"t": 0.12, "alpha": 1}], "art": [{"t": 0, "scale": 0.2, "ease": "back"}, {"t": 0.4, "scale": 1}]}
- idle 2 (breathe, loop): {"art": [{"t": 0, "scale": 1, "ease": "ease-in-out"}, {"t": 1, "scale": 1.04, "ease": "ease-in-out"}, {"t": 2, "scale": 1}]}
- glow pulse 1.2 (loop, glow behind, additive, alpha 0): {"glow": [{"t": 0, "alpha": 0.25, "scale": 0.95, "ease": "ease-in-out"}, {"t": 0.6, "alpha": 0.7, "scale": 1.05, "ease": "ease-in-out"}, {"t": 1.2, "alpha": 0.25, "scale": 0.95}]}
- win 1.1 (anticipation, burst, settle; glow + flash parts): {"art": [{"t": 0, "scale": 1, "ease": "ease-in"}, {"t": 0.08, "scale": 0.93, "ease": "back"}, {"t": 0.35, "scale": 1.22, "rotate": 4, "ease": "ease-in-out"}, {"t": 0.6, "scale": 0.98, "rotate": -2, "ease": "ease-out"}, {"t": 0.85, "scale": 1, "rotate": 0}], "glow": [{"t": 0.05, "alpha": 0, "scale": 0.9, "ease": "ease-out"}, {"t": 0.3, "alpha": 0.85, "scale": 1.15, "ease": "ease-in"}, {"t": 1.1, "alpha": 0, "scale": 1.4}], "flash": [{"t": 0.3, "alpha": 0, "ease": "ease-out"}, {"t": 0.36, "alpha": 0.9, "ease": "ease-in"}, {"t": 0.55, "alpha": 0}]}
- add 0.32 (bump): {"art": [{"t": 0, "sx": 1, "sy": 1, "ease": "ease-out"}, {"t": 0.08, "sx": 1.12, "sy": 0.9, "ease": "back"}, {"t": 0.32, "sx": 1, "sy": 1}]}
- collect 0.6 (a coin part flies up into the meter): {"coin": [{"t": 0, "x": 0, "y": -220, "scale": 1, "alpha": 1, "ease": "ease-in"}, {"t": 0.45, "x": 0, "y": 0, "scale": 0.5, "ease": "ease-out"}, {"t": 0.6, "alpha": 0}]}
- anticipation_loop 0.6: {"art": [{"t": 0, "x": 0, "rotate": 0, "ease": "ease-in-out"}, {"t": 0.15, "x": -6, "rotate": 2, "ease": "ease-in-out"}, {"t": 0.3, "x": 6, "rotate": -2, "ease": "ease-in-out"}, {"t": 0.45, "x": -4, "rotate": 1, "ease": "ease-in-out"}, {"t": 0.6, "x": 0, "rotate": 0}]}
- out 0.28: {"all": [{"t": 0.08, "alpha": 1, "ease": "ease-in"}, {"t": 0.28, "alpha": 0}], "art": [{"t": 0, "scale": 1, "ease": "ease-in"}, {"t": 0.28, "scale": 0.6}]}
- text pops on a txt_* spacer: {"txt_amount": [{"t": 0, "y": -20, "alpha": 0, "ease": "back"}, {"t": 0.25, "y": 0, "alpha": 1}]}

REVIEW CHECKLIST (every filmstrip)
- First and last frame: "in" ends exactly at the idle pose; "out" ends hidden (or as the game expects); a loop looks the same at 0 and at the end.
- No jumps between neighbouring frames; nothing pops in or out unless intended.
- The silhouette and the main move read even at half size.
- Glows do not wash out the art (alpha <= 0.9, additive on dark).
- No warnings in the result (bad keys, unknown targets, reserved names).
- The game contract: spine name animation_<name>, the animation names the game calls (in, idle / loop_1, out, win...), events only if the game listens.

SPEED
- One call with everything beats ten small ones: batch parts and animations.
- anims_mode "merge" changes one row without resending the rest.
- "preview": true on sandbox_new / sandbox_update returns the filmstrip in the same call; sandbox_preview {"animation": "all"} reviews every animation on one image.`;
const PARENTS = ['root', 'area_top_left', 'area_top', 'area_top_right', 'area_left', 'area_center', 'area_right', 'area_bottom_left', 'area_bottom', 'area_bottom_right'];

const INSTRUCTIONS = `Spine Draft Kit is a local web tool (http://localhost:${PORT}) that generates draft Spine 4.1.24 files for slot games (symbols, reels, reel frames, background, logo, popups). These tools drive the open kit page live: every change shows up in the user's browser immediately, and the project autosaves to the browser and to disk (${DATA}).

Workflow:
1. Call kit_status first. If the server or the page is not connected, call open_kit.
2. When the user points at an art folder, call scan_art on it and read the result (names, sizes, guesses).
3. Before filling anything, call list_projects and ASK the user whether to fill an existing project (name it) or create a new one, unless they already said so. Never fill or change an existing project without the user's explicit choice. Also confirm the grid (reels x rows) and cell size if the art does not make them obvious.
4. create_project or open_project, then set_symbols (images by absolute path; the file name without extension is a good symbol name: wild_1, scatter_1, high_1..., low_1...), update_component for frame_under / frame_above images and animations, add_component for background / logo / popup / infopanel / custom elements.
5. Look at the result: screenshot (grid + preview), preview a spine and animation, spin to play a real reel spin. Fix what looks wrong.
6. Layouts (the «Лейаути» tab): every project starts with the Pandora template layouts layout_landscape_16_9 (2560x1440), layout_landscape_4_3 (1920x1440), layout_portrait_9_16 (1440x2560); the game picks one by window aspect and puts each component on a position_* bone. If the game already has layouts (art repo skins/main/Motion/layouts/), import_layouts them (ask before replacing). get_layouts shows bones and which component sits where; place_components binds components to bones; update_layout moves, adds, renames bones; show_layout with screen "all" checks wider and taller windows; spin with layout plays the spin there.
7. export_drafts writes the zip with all spines (and the layouts) when the user wants files.
8. Custom components (collectors, meters, characters, panels like Lucky 5): add_component (template custom or character) or update_component with parts (extra images: each part is its own bone + slot with the same name, region art/<spine>/<part>; parent, x/y from the parent's image centre with y up, w/h, pivot, behind, blend, setup alpha, placeholder shape/color) and per-animation keys ({"<part|art|spacer|all>": [{"t": 0, "y": 0, "alpha": 0, "ease": "ease-out"}, {"t": 0.3, "y": 120, "alpha": 1}]}). Use anims_mode "merge" to change one animation without resending the rest. Then preview each new animation (at several "at" values) and fix what looks wrong. export_component saves a component (settings, parts, keys, images) to a .component.json file; import_component adds such a file to the open project (another game or project).
9. ${SANDBOX_STEP} The user sees every step live in the «Пісочниця» tab (a project must be open in the kit). The sandbox and the library of this local kit live in the browser.
10. ${finalStep(' as local paths or their folder')}
Talk to the user in their language (the kit UI is Ukrainian). Motion presets: ${PRESETS}. Events format: "onEvent@0.5, onOther(2)@0.1".`;

const KEYS = 'Custom components only. Keyframes on top of the preset, as {"<target>": [key, ...]}. target: "art" (main image), a part name, a spacer slot (e.g. txt_count), a progress-bar part (bar, bar_fill, bar_head, bar_glow, bar_flash, bar_shine) or "all" (alpha / color of every visible slot). key: t (seconds, required), x, y (px offset from the setup position, y up), scale (both axes) or sx / sy (multiplier of setup), rotate (degrees counter-clockwise, added to setup), alpha (0..1, absolute), color ("ffcc00" tint, absolute), ease (how the motion runs from THIS key to the next: linear default, ease-in, ease-out, ease-in-out, back, soft, shake, stepped, or a bezier [x1, y1, x2, y2] like CSS cubic-bezier). A key keeps the previous value of channels it leaves out; a channel whose first key is after 0 starts from the setup pose at t 0; after the last key the value holds. Keys override the preset on the same channels (translate, scale, rotate, rgb, alpha). The animation lasts max(duration, last key t). null removes the keys.';
const anims = {
  type: 'array',
  description: `Animations. Each: name, duration (seconds), preset (one of: ${PRESETS}), loop (seamless loop hint), events ("onEvent@0.5, onOther(2)@0.1"), keys (keyframes on parts, custom components).`,
  items: {
    type: 'object',
    properties: { name: { type: 'string' }, duration: { type: 'number' }, preset: { type: 'string' }, loop: { type: 'boolean' }, events: { type: 'string' }, keys: { type: ['object', 'null'], description: KEYS } },
    required: ['name']
  }
};
const image = { type: 'string', description: 'Absolute path to a local PNG / JPEG / WebP file.' };
const animsMode = { type: 'string', enum: ['replace', 'merge'], description: '"replace" (default): anims becomes the whole list. "merge": rows are matched by name, only the fields given change (keys, duration, preset, loop, events), new names are appended.' };
const pivot = { type: 'string', description: 'Rotation / scale point: center (default), bottom (characters: feet stay put), top, left, right, or "x:y" in px from the image centre, y up. Position fields still mean the image centre.' };
const parts = {
  type: 'array',
  description: 'Custom components only. Extra images inside the component, drawn in list order. Each part becomes a bone and a slot with the same name and a region art/<spine>/<part>. Matched by name: existing parts are updated (only the fields given), new ones are added.',
  items: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'a-z0-9_. Not root, art, a spacer slot or a bar part.' },
      rename: { type: 'string', description: 'New name; parents and keys follow.' },
      image,
      remove_image: { type: 'boolean' },
      parent: { type: 'string', description: '"art" (default, the main image) or another part.' },
      x: { type: 'number', description: 'Centre from the parent image centre, px, y up.' },
      y: { type: 'number' },
      w: { type: 'number', description: 'Size in game px; default the image size or 100.' },
      h: { type: 'number' },
      pivot,
      rotate: { type: 'number', description: 'Setup rotation, degrees counter-clockwise.' },
      behind: { type: 'boolean', description: 'Draw under the main image.' },
      blend: { type: 'string', enum: ['normal', 'additive', 'multiply', 'screen'] },
      alpha: { type: 'number', description: 'Setup opacity 0..1; 0 hides the part until an animation shows it (glow, flash). Fade presets (fade_in, fade_out...) only fade parts with alpha 1.' },
      shape: { type: 'string', enum: ['', 'rect', 'circle', 'ring', 'glow', 'star'], description: 'Placeholder drawn when the part has no image ("" = labelled card).' },
      color: { type: ['string', 'null'], description: 'Placeholder colour "ffcc00".' }
    },
    required: ['name']
  }
};
const sbId = { type: 'string', description: 'Sandbox item id (sandbox_get lists them) or its spine name. Omitted: the item the sandbox shows now (the last one worked on).' };
const look = {
  type: ['boolean', 'object'],
  description: 'Return a filmstrip in the same call: true = the animations this call added or changed (every animation of a new item), 5 frames each; or {"animation": "<name>" | "all", "at": [seconds]}.',
  properties: { animation: { type: 'string' }, at: { type: 'array', items: { type: 'number' } } }
};

const TOOLS = [
  { name: 'kit_status', title: 'Kit status', description: 'Is the kit server running, is the kit page connected, which project is open, where projects are saved on disk.', inputSchema: { type: 'object', properties: {} }, local: true },
  { name: 'open_kit', title: 'Open kit', description: 'Start the local kit server if it is down and open the kit page in the browser with Connect on. Waits until the page connects.', inputSchema: { type: 'object', properties: {} }, local: true },
  {
    name: 'scan_art', title: 'Scan art folder', local: true,
    description: 'List images in a local art folder (recursive): relative path, pixel size, and a guess of what each is (symbol wild/scatter/high/low, blur variant, frame under/above, background, logo, popup). Read-only.',
    inputSchema: { type: 'object', properties: { dir: { type: 'string', description: 'Absolute path to the art folder.' }, max_depth: { type: 'number', description: 'Default 5.' } }, required: ['dir'] }
  },
  { name: 'list_projects', title: 'List projects', description: 'Projects in the kit (id, name, grid, which one is open). Use before asking the user which project to fill.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'open_project', title: 'Open project', mutates: true,
    description: 'Open an existing project by id or exact name. Only after the user chose it.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Project id or name.' } }, required: ['id'] }
  },
  {
    name: 'create_project', title: 'Create project', mutates: true,
    description: 'Create a new project and open it. Only after the user asked for a new project.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Game name (slug-like, e.g. dice-dominium).' },
        reels: { type: 'number', description: 'Columns, default 5.' },
        rows: { type: 'number', description: 'Rows, default 3.' },
        cell_w: { type: 'number', description: 'Cell width px, default 334.' },
        cell_h: { type: 'number', description: 'Cell height px, default 334.' },
        symbols: { type: 'array', items: { type: 'string' }, description: 'Symbol names. Empty array = no symbols yet; omitted = template list (wild_1, scatter_1, high_1..4, low_1..4).' },
        frame_under: { type: 'boolean', description: 'Generate the frame under the reels, default true.' },
        frame_above: { type: 'boolean', description: 'Generate the frame above the reels, default true.' }
      },
      required: ['name']
    }
  },
  { name: 'get_project', title: 'Get project', description: 'Full settings of the open project (game, grid, cell, tech, components with animations), which images are set, generated spines with skins, animations and warnings.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'update_game', title: 'Update game', mutates: true,
    description: 'Change game settings of the open project.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, reels: { type: 'number' }, rows: { type: 'number' }, cell_w: { type: 'number' }, cell_h: { type: 'number' }, spine_version: { type: 'string' }, fps: { type: 'number' }, folder: { type: 'string', description: 'Export folder inside the zip, default skins/main/Motion/spine/.' } }
    }
  },
  {
    name: 'set_symbols', title: 'Set symbols', mutates: true,
    description: 'Add or update symbols of the open project, with images from local files. mode "merge" (default) keeps other symbols, "replace" makes the list exactly these symbols in this order.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['merge', 'replace'] },
        symbols: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Symbol name, e.g. high_1. Spine becomes animation_symbol_<name>.' },
              rename: { type: 'string', description: 'New name for an existing symbol.' },
              image,
              blur_image: { type: ['string', 'null'], description: 'Absolute path to the motion-blurred image for the symbol_<name>_blur skin. Omitted: the kit blurs the symbol image itself. null drops an uploaded one.' },
              anims: { ...anims, description: 'Own animations for this symbol only (otherwise it uses the shared symbol animations). null resets to shared.' }
            },
            required: ['name']
          }
        },
        remove: { type: 'array', items: { type: 'string' }, description: 'Symbol names to delete.' }
      }
    }
  },
  {
    name: 'update_component', title: 'Update component', mutates: true,
    description: 'Change a component: "symbols" (shared symbol animations, txt slot), "reels", "frame_under", "frame_above", or a custom component by id or spine name. Any field may be omitted.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        on: { type: 'boolean', description: 'Generate this component.' },
        image,
        remove_image: { type: 'boolean' },
        anims,
        skins: { type: 'string', description: 'Comma separated, e.g. "default, freespins, maingame".' },
        spacers: { type: 'string', description: 'Comma separated slot names the game reads, e.g. "txt_amount". name@x:y sets the exact point from the image centre in px, y up (e.g. "txt_title@0:75").' },
        txt: { type: 'boolean', description: 'Symbols only: add the txt_amount slot.' },
        blur: { type: 'boolean', description: 'Symbols only: the symbol_<name>_blur skins use a motion-blurred image (default true); false reuses the sharp image.' },
        fill: { type: 'number', description: 'Symbols only: symbol size as % of the cell (default 84); images are scaled up or down to fit.' },
        name: { type: 'string', description: 'Custom only: spine name.' },
        label: { type: 'string', description: 'Custom only: card title in the kit.' },
        bar: { type: 'string', description: 'Custom only: progress bar "x:y:w:h" (track centre and size in px from the image centre, y up; "" removes it). Adds fill, shine, head, flash, glow and the animations progress (1 s scrub: the game sets track time = fraction), add, anticipation (loop), trigger, demo.' },
        w: { type: 'number' }, h: { type: 'number' }, x: { type: 'number' }, y: { type: 'number' },
        pivot: { ...pivot, type: ['string', 'null'], description: 'Custom only. ' + pivot.description },
        anims_mode: animsMode,
        parts,
        parts_mode: { type: 'string', enum: ['merge', 'replace'], description: '"merge" (default) keeps parts not listed; "replace" makes the list exactly these parts in this order.' },
        remove_parts: { type: 'array', items: { type: 'string' }, description: 'Part names to delete (their children move to art).' }
      },
      required: ['id']
    }
  },
  {
    name: 'add_component', title: 'Add component', mutates: true,
    description: 'Add a component from a template: background (animation_bg, in / loop_1 / out), logo, popup, infopanel (animation_notification_panel under the reels: in / in_txt / loop_1 / out / out_txt, text spacer txt_notification_panel, skins default / maingame / freespins / feature_active), character (animation_character, 1200x2000, skin default, pivot bottom, sits on position_character; keyed in, idle loop, win, anticipation_in / anticipation_loop / anticipation_out for near misses, trigger, attention, out; rename the animations to the game\'s contract if it differs), custom (any element; with parts and keys it becomes a collector, meter or panel like Lucky 5). Size defaults to the image size.',
    inputSchema: {
      type: 'object',
      properties: {
        template: { type: 'string', enum: ['background', 'logo', 'popup', 'infopanel', 'character', 'custom'] },
        name: { type: 'string', description: 'Spine name, e.g. animation_game_logo.' },
        label: { type: 'string', description: 'Card title in the kit, e.g. Колектор.' },
        image, anims,
        anims_mode: { ...animsMode, description: '"replace" (default): anims replaces the template animations. "merge": patch / extend the template animations by name.' },
        skins: { type: 'string' }, spacers: { type: 'string', description: 'Comma separated slot names the game reads; name@x:y = exact point from the image centre, y up.' },
        bar: { type: 'string', description: 'Progress bar "x:y:w:h", see update_component.' },
        pivot,
        parts: { ...parts, description: 'Extra images inside the component (replaces template parts). ' + parts.description },
        w: { type: 'number' }, h: { type: 'number' }, x: { type: 'number' }, y: { type: 'number' }
      },
      required: ['template']
    }
  },
  {
    name: 'export_component', title: 'Export component', timeout: 120000,
    description: 'Save one custom component of the open project (settings, parts, animations with keys, its images embedded, its layout bone) to a .component.json file, so it can be imported into another project or game with import_component or the kit\'s «Імпорт з файлу».',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Component id or spine name.' }, path: { type: 'string', description: `Absolute .json file path or folder. Default ${join(DATA, 'components')}.` } }, required: ['id'] }
  },
  {
    name: 'import_component', title: 'Import component', mutates: true, timeout: 120000,
    description: 'Add a component from a .component.json file (made by export_component or the card\'s «Експорт») to the open project, with its images. The spine name gets _2, _3 if taken; the layout bone is kept when the project has it.',
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Absolute path to the .component.json file.' }, name: { type: 'string', description: 'Optional new spine name.' } }, required: ['path'] }
  },
  {
    name: 'remove_component', title: 'Remove component', mutates: true,
    description: 'Remove a custom component (built-in ones are switched off with update_component on:false).',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
  },
  {
    name: 'import_final', title: 'Import animator final', mutates: true, timeout: 240000,
    description: FINAL_DESC,
    inputSchema: finalSchema('Absolute paths of the export files (<spine>.json, <spine>.atlas, every .png page of the atlas) or of a folder with them.')
  },
  {
    name: 'remove_final', title: 'Remove animator final', mutates: true, destructive: true,
    description: 'Drop the imported animator final of a component (or of one of its spines): the preview and the export go back to the kit\'s draft. The animator\'s own files are not touched. Only when the user asked.',
    inputSchema: { type: 'object', properties: { component: { type: 'string', description: 'Component id, spine name or type.' }, spine: { type: 'string', description: 'Only this spine. Omitted: every final of the component.' } }, required: ['component'] }
  },
  {
    name: 'preview', title: 'Preview spine',
    description: 'Show a spine animation in the kit preview (the user sees it too) and return a screenshot of it. A spine with an imported animator final shows the final unless draft is true.',
    inputSchema: { type: 'object', properties: { spine: { type: 'string', description: 'e.g. animation_symbol_high_1' }, animation: { type: 'string' }, skin: { type: 'string' }, at: { type: 'number', description: 'Seconds into the animation for the screenshot, default 0.4.' }, draft: { type: 'boolean', description: 'Show the kit draft even when the spine has an imported animator final.' } } }
  },
  {
    name: 'screenshot', title: 'Screenshot',
    description: 'PNG of the kit: "grid" (reels with frames and symbols as the game shows them), "preview" (the spine player), or "both" (default). For layouts use show_layout.',
    inputSchema: { type: 'object', properties: { target: { type: 'string', enum: ['grid', 'preview', 'both'] } } }
  },
  {
    name: 'spin', title: 'Spin reels',
    description: 'Play a real slot spin on the grid with the generated reel spines and return the final grid screenshot.',
    inputSchema: { type: 'object', properties: { win: { type: 'boolean', description: 'Show a win line in the middle row.' }, quick: { type: 'boolean' }, layout: { type: 'string', description: 'Spin on the «Лейаути» tab on this layout (file name or title like 16:9) and return that canvas. Omitted: the tab the kit shows now.' } } }
  },
  {
    name: 'export_drafts', title: 'Export drafts', timeout: 300000,
    description: 'Build the zip with every generated spine (json, atlas, png, Spine Editor import folder, README) and save it to disk.',
    inputSchema: { type: 'object', properties: { out_dir: { type: 'string', description: `Absolute folder, default ${join(DATA, 'exports')}.` }, unzip: { type: 'boolean', description: 'Also extract the zip next to it.' }, layouts: { type: 'boolean', description: 'Include the layout_*.json files (skins/main/Motion/layouts/) and spine-editor/layouts. true = every layout, false = none. Default: the layouts ticked in the export dialog (all on).' } } }
  },
  {
    name: 'get_layouts', title: 'Get layouts',
    description: 'Layouts of the open project (the «Лейаути» tab). Pandora picks one layout_*.json by window aspect a = w/h (a > 15/9 → landscape 16_9, 1.25 < a ≤ 15/9 → 4_3, a ≤ 1.25 → portrait 9_16) and puts each component on a position_* bone. Per layout: game size, screen presets, bones (parent, x, y, scale, rotation, components on it, warnings, custom = not in the Pandora template). Per component: its bone (one name for every layout), default_bone (picked by name), hidden, missing_in (layouts without that bone). Read-only.',
    inputSchema: { type: 'object', properties: { layout: { type: 'string', description: 'Only this layout: file name (layout_landscape_16_9) or title (16:9). Omitted: all.' } } }
  },
  {
    name: 'update_layout', title: 'Update layout', mutates: true, destructive: true,
    description: 'Change one layout: file name, game size, reset to the Pandora template, add / edit / rename / delete position_* bones. Coordinates are game pixels as in Spine: x from the left edge (x ≥ 0), y negative downwards (y = minus the distance from the top, y ≤ 0); the bone is the centre of the component. The parent only picks the margin: area_top_left … area_center … area_bottom_right make the bone slide to that side on a wider or taller window, root stretches with the window; any other parent crashes the game. A new bone is added to every layout (centred in the others: set it there too); rename and delete apply to every layout; template bones cannot be renamed or deleted. Shows the layout in the kit.',
    inputSchema: {
      type: 'object',
      properties: {
        layout: { type: 'string', description: 'File name or title (16:9). Omitted: the layout open in the kit.' },
        name: { type: 'string', description: 'New file name, e.g. layout_landscape_16_9.' },
        w: { type: 'number', description: 'Game width px (game_size).' },
        h: { type: 'number', description: 'Game height px (game_size).' },
        reset: { type: 'boolean', description: 'Back to the Pandora template values for this file name (custom bones stay). Runs before bones.' },
        bones: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Bone, e.g. position_reels (position_ is added if missing).' },
              rename: { type: 'string', description: 'New name (custom bones only), renamed in every layout and in component bindings.' },
              parent: { type: 'string', enum: PARENTS },
              x: { type: 'number' }, y: { type: 'number' },
              scale: { type: 'number', description: 'Both axes.' }, scale_x: { type: 'number' }, scale_y: { type: 'number' },
              rotation: { type: 'number', description: 'Degrees.' }
            },
            required: ['name']
          }
        },
        remove_bones: { type: 'array', items: { type: 'string' }, description: 'Custom bones to delete from every layout (components on them become unplaced).' }
      }
    }
  },
  {
    name: 'place_components', title: 'Place components', mutates: true,
    description: 'Which layout bone each component sits on (the same bone name in every layout) and whether it is hidden on the layout canvas and in the Spine Editor layout export. id: "reels" (reels with frames and symbols) or a custom component id / spine name. Defaults come from the spine name: animation_game_logo → position_game_logo, bg / popups / big win → position_background, splash → position_logo, notification_panel → position_reels.',
    inputSchema: {
      type: 'object',
      properties: {
        components: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              bone: { type: ['string', 'null'], description: 'position_* bone; "" = not placed; null = back to the default by name.' },
              hidden: { type: 'boolean' }
            },
            required: ['id']
          }
        },
        layout: { type: 'string', description: 'Layout to show in the kit afterwards.' }
      },
      required: ['components']
    }
  },
  {
    name: 'import_layouts', title: 'Import layouts', mutates: true, destructive: true,
    description: 'Load the game\'s own layout files (Spine JSON with a game_size bone, e.g. <art repo>/skins/main/Motion/layouts/layout_*.json or the stripped {fileName, bones} build files) into the open project. A layout with the same file name is replaced; mode "replace" makes the list exactly these files. Component bindings stay.',
    inputSchema: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' }, description: 'Absolute paths to .json files or folders (every .json in a folder, not recursive).' },
        mode: { type: 'string', enum: ['merge', 'replace'] }
      },
      required: ['paths']
    }
  },
  {
    name: 'show_layout', title: 'Show layout',
    description: 'Open the «Лейаути» tab on a layout (the user sees it too) and return a screenshot: the window with components on their bones, bone marks with names, a dashed box for the layout frame when the window is wider or taller.',
    inputSchema: {
      type: 'object',
      properties: {
        layout: { type: 'string', description: 'File name or title (16:9). Omitted: the open one.' },
        screen: { type: ['string', 'number'], description: 'Window aspect: a preset label ("21:9", "9:19.5"), "W:H", a number w/h, or "all" for one screenshot per preset. Omitted: the current one.' },
        bone: { type: 'string', description: 'Highlight this bone; "" clears.' },
        marks: { type: 'boolean', description: 'Bone marks on the canvas, default on.' }
      }
    }
  },
  {
    name: 'sandbox_guide', title: 'Sandbox guide',
    description: 'Rules and recipes for a good-looking component in 2-3 calls: workflow, parts and pivots, timing and easing per animation type, amplitudes that read at game scale, keyframe recipes (pop in, idle, glow, win burst, bump, collect, anticipation, out, text), the review checklist. Read it once before the first sandbox_new. Read-only.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'sandbox_get', title: 'Get sandbox',
    description: 'The user\'s personal sandbox (the «Пісочниця» tab): a workbench for testing and making components with a live preview, the same in every project, apart from the drafts. Without id: the items on it (id, label, spine, size, parts, animations, library link) and which one it shows. With id: the full item (settings, parts, animations with keys, images, the generated spine: skins, animations with durations, slots, warnings). Read-only.',
    inputSchema: { type: 'object', properties: { id: sbId } }
  },
  {
    name: 'sandbox_new', title: 'New sandbox item', mutates: true,
    description: 'Put a new component on the sandbox and show it (the user watches the «Пісочниця» tab live). Source: template (default custom), from_library (a library item), from_component (a copy of a custom component of the project) or from_file (.component.json). The other fields work as in add_component and override the source. Send everything you planned in this one call: parts and every animation with keys. The drafts and their export are not touched.',
    inputSchema: {
      type: 'object',
      properties: {
        template: { type: 'string', enum: ['custom', 'character', 'logo', 'popup', 'infopanel', 'background'], description: 'custom: any element (collector, meter, panel, badge); character: 1200x2000, pivot bottom, keyed in / idle / win / anticipation_* / trigger / attention / out.' },
        from_library: { type: 'string', description: 'Library item id (library_list).' },
        from_component: { type: 'string', description: 'A custom component of the project: id or spine name.' },
        from_file: { type: 'string', description: 'Absolute path to a .component.json file.' },
        name: { type: 'string', description: 'Spine name, e.g. animation_coin_collector.' },
        label: { type: 'string', description: 'Title in the kit, in the user\'s language, e.g. Колектор монет.' },
        image, anims,
        anims_mode: { ...animsMode, description: '"replace" (default): anims replaces the source animations. "merge": patch / extend the source animations by name.' },
        skins: { type: 'string' }, spacers: { type: 'string', description: 'Comma separated slot names the game reads; name@x:y = exact point from the image centre, y up.' },
        bar: { type: 'string', description: 'Progress bar "x:y:w:h", see update_component.' },
        pivot,
        parts: { ...parts, description: 'Extra images inside the component, merged by name into the source parts. ' + parts.description },
        w: { type: 'number' }, h: { type: 'number' }, x: { type: 'number' }, y: { type: 'number' },
        preview: look
      }
    }
  },
  {
    name: 'sandbox_update', title: 'Update sandbox item', mutates: true,
    description: 'Change a sandbox item; the same fields as update_component for a custom component (parts merge by name, anims_mode "merge" patches rows by name). The sandbox shows the item and plays the animation you changed.',
    inputSchema: {
      type: 'object',
      properties: {
        id: sbId,
        name: { type: 'string' }, label: { type: 'string' },
        image, remove_image: { type: 'boolean' },
        anims, anims_mode: animsMode,
        skins: { type: 'string' }, spacers: { type: 'string' }, bar: { type: 'string' },
        w: { type: 'number' }, h: { type: 'number' }, x: { type: 'number' }, y: { type: 'number' },
        pivot: { ...pivot, type: ['string', 'null'] },
        parts,
        parts_mode: { type: 'string', enum: ['merge', 'replace'], description: '"merge" (default) keeps parts not listed; "replace" makes the list exactly these parts in this order.' },
        remove_parts: { type: 'array', items: { type: 'string' } },
        preview: look
      }
    }
  },
  {
    name: 'sandbox_preview', title: 'Preview sandbox',
    description: 'Filmstrip of a sandbox item: frames of its animations at exact times on one image, one row per animation, the same scale everywhere (so sizes compare), with durations and warnings. The animation then keeps playing in the sandbox for the user.',
    inputSchema: {
      type: 'object',
      properties: {
        id: sbId,
        animation: { type: 'string', description: 'Animation name or "all" (default).' },
        at: { type: ['number', 'array'], items: { type: 'number' }, description: 'Seconds: one number or a list (up to 12). Default 5 frames from 0 to the end.' },
        skin: { type: 'string' },
        bg: { type: 'string', enum: ['dark', 'light', 'checker'], description: 'Frame background, default dark (like most slot games).' }
      }
    }
  },
  {
    name: 'sandbox_remove', title: 'Remove sandbox item', mutates: true, destructive: true,
    description: 'Take an item off the sandbox. The sandbox has no history: only the library copy (if saved) stays. Ask the user first unless they asked for it.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
  },
  {
    name: 'sandbox_save', title: 'Save to library', mutates: true,
    description: 'Save a sandbox item to the component library (settings, parts, animations with keys, images, a thumbnail), reusable in any project. An item that came from the library or was saved before updates its library entry when you may edit it (its author or an admin); otherwise, or with as_new, a new entry is made.',
    inputSchema: {
      type: 'object',
      properties: {
        id: sbId,
        label: { type: 'string', description: 'Title in the user\'s language.' },
        note: { type: 'string', description: 'One line: what it is, which game, which animations the game calls.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Kinds for search: collector, meter, logo, popup, character...' },
        as_new: { type: 'boolean' }
      }
    }
  },
  {
    name: 'sandbox_to_project', title: 'Sandbox to drafts', mutates: true,
    description: 'Copy a sandbox item into the project\'s drafts («Чернетки»: a component card, exported with the other spines). Only when the user asks. The spine name gets _2, _3 if taken.',
    inputSchema: { type: 'object', properties: { id: sbId, name: { type: 'string', description: 'Spine name in the project, default the item\'s.' } } }
  },
  {
    name: 'library_list', title: 'Component library',
    description: 'Saved components to reuse: id, label, spine, size, parts, animations, note, tags, author, date. query filters by words in label, spine, note, tags or author. With id: the full settings of that component (parts, animations with keys) to learn from or copy. Read-only.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, id: { type: 'string' } } }
  },
  {
    name: 'library_add', title: 'Library to drafts', mutates: true,
    description: 'Copy a library component with its images straight into the project\'s drafts («Чернетки»). Only when the user asks. The spine name gets _2, _3 if taken.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Library item id.' }, name: { type: 'string', description: 'Optional new spine name.' } }, required: ['id'] }
  },
  {
    name: 'library_remove', title: 'Remove from library', mutates: true, destructive: true,
    description: 'Delete a component from the library. Only its author (or an admin) can, and only when they asked.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
  }
];

export { TOOLS, INSTRUCTIONS, PRESETS, GUIDE };

export const listTools = TOOLS => TOOLS.map(t => ({
  name: t.name,
  title: t.title,
  description: t.description,
  inputSchema: t.inputSchema,
  annotations: { title: t.title, readOnlyHint: !t.mutates && !['open_kit', 'export_drafts', 'export_component', 'spin', 'preview', 'show_layout', 'sandbox_preview'].includes(t.name), destructiveHint: !!t.destructive || t.name === 'remove_component' || t.name === 'set_symbols', openWorldHint: false }
}));

export const LABELS = {
  status: 'стан кита', list_projects: 'список проектів', open_project: 'відкрив проект', create_project: 'створив проект', get_project: 'читає проект',
  update_game: 'налаштування гри', set_symbols: 'символи', update_component: 'компонент', add_component: 'додав компонент', remove_component: 'прибрав компонент',
  preview: 'превʼю', screenshot: 'скріншот', spin: 'спін', export_drafts: 'експорт драфту',
  get_layouts: 'читає лейаути', update_layout: 'лейаут', place_components: 'компоненти на лейауті', import_layouts: 'імпорт лейаутів', show_layout: 'показує лейаут',
  export_component: 'експорт компонента', import_component: 'імпорт компонента', import_final: 'імпорт фіналу', remove_final: 'повернув драфт',
  upload_files: 'завантаження файлів', get_history: 'читає історію', restore_version: 'відкат', save_version: 'версія',
  sandbox_guide: 'читає правила пісочниці', sandbox_get: 'читає пісочницю', sandbox_new: 'новий компонент у пісочниці', sandbox_update: 'пісочниця', sandbox_preview: 'дивиться пісочницю',
  sandbox_remove: 'прибрав з пісочниці', sandbox_save: 'зберіг у бібліотеку', sandbox_to_project: 'з пісочниці в чернетки',
  library_list: 'бібліотека', library_add: 'з бібліотеки в чернетки', library_remove: 'прибрав з бібліотеки'
};

const REF = 'A ref "upload:<id>" from upload_files (PNG / JPEG / WebP). The server cannot read local paths.';
const SERVER_SIDE = new Set(['kit_status', 'list_projects', 'open_project', 'upload_files', 'get_history', 'restore_version', 'save_version', 'sandbox_guide', 'library_list', 'library_remove']);

const refs = schema => {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(refs);
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'properties') {
      out.properties = {};
      for (const [name, p] of Object.entries(v)) {
        if (name === 'image') out.properties.image = { type: 'string', description: REF };
        else if (name === 'from_file') out.properties.from_file = { type: 'string', description: 'Ref "upload:<id>" of a .component.json file (upload_files).' };
        else if (name === 'blur_image') out.properties.blur_image ={ type: ['string', 'null'], description: 'Ref "upload:<id>" of the motion-blurred image for the symbol_<name>_blur skin. Omitted: the kit blurs the symbol image itself. null drops an uploaded one.' };
        else out.properties[name] = refs(p);
      }
    } else out[k] = refs(v);
  }
  return out;
};

const HTTP_EXTRA = [
  {
    name: 'upload_files', title: 'Upload files',
    description: 'Get one-time upload links for local files (images, layout_*.json, .component.json, an animator\'s Spine export: <spine>.json, <spine>.atlas, .png pages). Run the returned curl command (one command for all files; put the real local paths in), then pass each ref ("upload:<id>") to set_symbols / update_component / add_component (image, blur_image, parts[].image), import_layouts (refs), import_component (ref) or import_final (files). Links work once, PUT only, for 15 minutes; a ref stays valid for an hour for you only.',
    inputSchema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'object', properties: { name: { type: 'string', description: 'File name with extension, e.g. high_1.png.' }, path: { type: 'string', description: 'Optional absolute local path; only used to fill in the curl command.' } }, required: ['name'] }
        }
      },
      required: ['files']
    }
  },
  {
    name: 'get_history', title: 'Get history',
    description: 'History of the current project, newest first: who changed what and when (people and "Claude · <name>"), named versions. Read-only.',
    inputSchema: { type: 'object', properties: { scope: { type: 'string', enum: ['drafts', 'layouts'], description: 'Omitted: both.' }, limit: { type: 'number', description: 'Default 20, max 100.' } } }
  },
  {
    name: 'restore_version', title: 'Restore version', mutates: true, destructive: true,
    description: 'Roll one scope ("drafts" or "layouts") of the current project back to a history entry (id from get_history). Nothing is lost: the rollback is a new history entry that can be undone the same way. Only after the user asked.',
    inputSchema: { type: 'object', properties: { entry: { type: 'string' }, scope: { type: 'string', enum: ['drafts', 'layouts'] } }, required: ['entry', 'scope'] }
  },
  {
    name: 'save_version', title: 'Save version', mutates: true,
    description: 'Name the current state of the project (a named version in the history, kept forever).',
    inputSchema: { type: 'object', properties: { label: { type: 'string' } }, required: ['label'] }
  }
];

const HTTP_OVERRIDES = {
  kit_status: { description: 'Who you are on the team server, which project this MCP session works on (with its link /p/<id>), who is in that project now, and which projects you have open in the browser right now (viewing): the sandbox and the drafts update live there. After a server restart the session has no project: open it again.' },
  list_projects: { description: 'Projects on the team server (id, name, grid, last change and who made it; open = the project of this MCP session). Use before asking the user which project to fill.' },
  open_project: { description: 'Make an existing project (id or exact name) the project of this MCP session. It never switches what people have open. Only after the user chose it.' },
  create_project: { description: 'Create a new project on the team server and make it the project of this MCP session. Only after the user asked for a new project.' },
  export_drafts: {
    description: 'Build the zip with every generated spine (json, atlas, png, Spine Editor import folder, README) and return a download link (GET, 15 minutes) with a ready curl command: replace <folder> with a local folder and run it, then unzip if the user wants the files extracted.',
    inputSchema: { type: 'object', properties: { layouts: { type: 'boolean', description: 'Include the layout_*.json files (skins/main/Motion/layouts/) and spine-editor/layouts. true = every layout, false = none. Default: all.' } } }
  },
  export_component: {
    description: 'Save one custom component of the project (settings, parts, animations with keys, its images embedded, its layout bone) as a .component.json and return a download link (GET, 15 minutes) with a curl command, so it can be imported into another project with import_component.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Component id or spine name.' } }, required: ['id'] }
  },
  import_final: { description: FINAL_DESC, inputSchema: finalSchema('Refs "upload:<id>" of the export files (<spine>.json, <spine>.atlas, every .png page of the atlas) from upload_files.') },
  import_component: {
    description: 'Add a component from a .component.json (made by export_component or the card\'s «Експорт») to the project, with its images. Upload the file with upload_files first. The spine name gets _2, _3 if taken; the layout bone is kept when the project has it.',
    inputSchema: { type: 'object', properties: { ref: { type: 'string', description: 'Ref "upload:<id>" of the .component.json file.' }, name: { type: 'string', description: 'Optional new spine name.' } }, required: ['ref'] }
  },
  library_list: { description: 'The team\'s component library on the server (made by people and Claude): id, label, spine, size, parts, animations, note, tags, author, date. query filters by words in label, spine, note, tags or author. With id: the full settings of that component (parts, animations with keys) to learn from or copy. Read-only.' },
  library_remove: { description: 'Delete a component from the team library. Only its author can, and only when they asked.' },
  import_layouts: {
    description: 'Load the game\'s own layout files (Spine JSON with a game_size bone, e.g. <art repo>/skins/main/Motion/layouts/layout_*.json or the stripped {fileName, bones} build files) into the project. Upload them with upload_files first. A layout with the same file name is replaced; mode "replace" makes the list exactly these files. Component bindings stay.',
    inputSchema: { type: 'object', properties: { refs: { type: 'array', items: { type: 'string' }, description: 'Refs "upload:<id>" of the .json files.' }, mode: { type: 'string', enum: ['merge', 'replace'] } }, required: ['refs'] }
  }
};

export const HTTP_TOOLS = [...TOOLS.filter(t => t.name !== 'open_kit' && t.name !== 'scan_art').map(t => {
  const o = HTTP_OVERRIDES[t.name] || {};
  const x = { ...t, inputSchema: refs(o.inputSchema || t.inputSchema), description: o.description || t.description };
  delete x.local;
  if (SERVER_SIDE.has(t.name)) x.server = true;
  return x;
}), ...HTTP_EXTRA.map(t => ({ ...t, server: true }))];

export const httpInstructions = publicUrl => `Spine Draft Kit is the team server (${publicUrl}) that generates draft Spine 4.1.24 files for slot games (symbols, reels, reel frames, background, logo, popups). Every project lives on the server: people see each change live in their browsers, and the history shows who did what.

Workflow:
1. Call kit_status first: who you are and which project this MCP session works on (none after a server restart).
2. The art is on the user's disk, the server cannot see it: look at the folder with your own tools (find, \`file\` / \`sips\` for sizes). Guess names like this: wild_*, scatter_* / bonus, high_N / h_N, low_N / l_N and cards (A K Q J 10 9), *_blur is the blurred variant; frame / border (above / over / front → frame_above, under / back → frame_under), logo, popup / big_win / mega / epic, bg / background. Then call upload_files, run the returned curl as one command and pass the refs ("upload:<id>") instead of paths.
3. Before filling anything, call list_projects and ASK the user whether to fill an existing project (name it) or create a new one, unless they already said so. Never fill or change an existing project without the user's explicit choice. Also confirm the grid (reels x rows) and cell size if the art does not make them obvious.
4. create_project or open_project (they only set the project of this MCP session, never what people have open), then set_symbols (image refs; the file name without extension is a good symbol name: wild_1, scatter_1, high_1..., low_1...), update_component for frame_under / frame_above images and animations, add_component for background / logo / popup / infopanel / custom elements.
5. Look at the result: screenshot (grid + preview), preview a spine and animation, spin to play a real reel spin. Fix what looks wrong.
6. Layouts (the «Лейаути» tab): every project starts with the Pandora template layouts layout_landscape_16_9 (2560x1440), layout_landscape_4_3 (1920x1440), layout_portrait_9_16 (1440x2560); the game picks one by window aspect and puts each component on a position_* bone. If the game already has layouts (art repo skins/main/Motion/layouts/), upload and import_layouts them (ask before replacing). get_layouts shows bones and which component sits where; place_components binds components to bones; update_layout moves, adds, renames bones; show_layout with screen "all" checks wider and taller windows; spin with layout plays the spin there.
7. export_drafts returns a download link with a curl command when the user wants files.
8. Custom components (collectors, meters, characters, panels like Lucky 5): add_component (template custom or character) or update_component with parts (extra images: each part is its own bone + slot with the same name, region art/<spine>/<part>; parent, x/y from the parent's image centre with y up, w/h, pivot, behind, blend, setup alpha, placeholder shape/color) and per-animation keys ({"<part|art|spacer|all>": [{"t": 0, "y": 0, "alpha": 0, "ease": "ease-out"}, {"t": 0.3, "y": 120, "alpha": 1}]}). Use anims_mode "merge" to change one animation without resending the rest. Then preview each new animation (at several "at" values) and fix what looks wrong. export_component gives a .component.json download; import_component adds such a file (uploaded) to the project.
9. Other people may be editing the same project at the same time: before a big change, say what you are going to do. Every change of yours is recorded as «Claude · <person>» in the history and can be rolled back (get_history, restore_version); save_version names the current state.
10. ${SANDBOX_STEP} It belongs to the user of this MCP session and is stored on the server; the sandbox tools still run inside the project of this MCP session, so open one first (prefer the one the user has open: kit_status → viewing; opening a project only sets this session's project, it changes nothing). The user watches the changes live in the «Пісочниця» tab of whatever project they have open. The library is shared by the whole team: save there what is worth reusing, with a clear label and note.
11. ${finalStep(', uploaded with upload_files (the server cannot read local paths)')}
Talk to the user in their language (the kit UI is Ukrainian). Motion presets: ${PRESETS}. Events format: "onEvent@0.5, onOther(2)@0.1".`;
