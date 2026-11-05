#!/usr/bin/env node
import { readFileSync, readdirSync, statSync, openSync, readSync, closeSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, extname, basename, relative, dirname } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.SPINE_KIT_PORT) || 5180;
const BASE = `http://127.0.0.1:${PORT}`;
const PAGE = `http://localhost:${PORT}/?connect=1`;
const DATA = process.env.SPINE_KIT_DATA || join(HERE, 'projects');
const VERSION = '1.0.0';
const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const IMAGE_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const SKIP_DIRS = new Set(['node_modules', '.git', '.idea', '.vscode', 'dist', '.trash']);
const PRESETS = 'hold, fade_in, fade_out, pop_in, pop_out, pulse, breathe, land, win, shake, float_up, glow, flash';
const PARENTS = ['root', 'area_top_left', 'area_top', 'area_top_right', 'area_left', 'area_center', 'area_right', 'area_bottom_left', 'area_bottom', 'area_bottom_right'];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => process.stderr.write(`[spine-draft-kit] ${a.join(' ')}\n`);

const INSTRUCTIONS = `Spine Draft Kit is a local web tool (http://localhost:${PORT}) that generates draft Spine 4.1.24 files for slot games (symbols, reels, reel frames, background, logo, popups). These tools drive the open kit page live: every change shows up in the user's browser immediately, and the project autosaves to the browser and to disk (${DATA}).

Workflow:
1. Call kit_status first. If the server or the page is not connected, call open_kit.
2. When the user points at an art folder, call scan_art on it and read the result (names, sizes, guesses).
3. Before filling anything, call list_projects and ASK the user whether to fill an existing project (name it) or create a new one, unless they already said so. Never fill or change an existing project without the user's explicit choice. Also confirm the grid (reels x rows) and cell size if the art does not make them obvious.
4. create_project or open_project, then set_symbols (images by absolute path; the file name without extension is a good symbol name: wild_1, scatter_1, high_1..., low_1...), update_component for frame_under / frame_above images and animations, add_component for background / logo / popup / infopanel / custom elements.
5. Look at the result: screenshot (grid + preview), preview a spine and animation, spin to play a real reel spin. Fix what looks wrong.
6. Layouts (the «Лейаути» tab): every project starts with the Pandora template layouts layout_landscape_16_9 (2560x1440), layout_landscape_4_3 (1920x1440), layout_portrait_9_16 (1440x2560); the game picks one by window aspect and puts each component on a position_* bone. If the game already has layouts (art repo skins/main/Motion/layouts/), import_layouts them (ask before replacing). get_layouts shows bones and which component sits where; place_components binds components to bones; update_layout moves, adds, renames bones; show_layout with screen "all" checks wider and taller windows; spin with layout plays the spin there.
7. export_drafts writes the zip with all spines (and the layouts) when the user wants files.
8. Custom components (collectors, meters, characters, panels like Lucky 5): add_component (template custom or character) or update_component with parts (extra images: each part is its own bone + slot with the same name, region art/<spine>_<part>; parent, x/y from the parent's image centre with y up, w/h, pivot, behind, blend, setup alpha, placeholder shape/color) and per-animation keys ({"<part|art|spacer|all>": [{"t": 0, "y": 0, "alpha": 0, "ease": "ease-out"}, {"t": 0.3, "y": 120, "alpha": 1}]}). Use anims_mode "merge" to change one animation without resending the rest. Then preview each new animation (at several "at" values) and fix what looks wrong. export_component saves a component (settings, parts, keys, images) to a .component.json file; import_component adds such a file to the open project (another game or project).
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
  description: 'Custom components only. Extra images inside the component, drawn in list order. Each part becomes a bone and a slot with the same name and a region art/<spine>_<part>. Matched by name: existing parts are updated (only the fields given), new ones are added.',
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
    name: 'preview', title: 'Preview spine',
    description: 'Show a spine animation in the kit preview (the user sees it too) and return a screenshot of it.',
    inputSchema: { type: 'object', properties: { spine: { type: 'string', description: 'e.g. animation_symbol_high_1' }, animation: { type: 'string' }, skin: { type: 'string' }, at: { type: 'number', description: 'Seconds into the animation for the screenshot, default 0.4.' } } }
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
  }
];

async function api(path, opts = {}) {
  const r = await fetch(BASE + path, opts);
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text }; }
  return { status: r.status, data };
}

async function serverInfo() {
  try { const r = await api('/api/info'); return r.status === 200 ? r.data : null; } catch { return null; }
}

async function bridge(tool, args, timeout) {
  let r;
  try { r = await api('/api/bridge/call', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tool, args, timeout }) }); }
  catch { throw new Error(`Сервер кита не запущений на ${BASE}. Виклич open_kit або запусти npm run dev у ${HERE}.`); }
  if (!r.data.ok) throw new Error(r.data.error || 'kit error');
  return r.data.result;
}

async function uploadFile(path) {
  const p = resolve(path);
  const type = IMAGE_EXT[extname(p).toLowerCase()];
  if (!type) throw new Error(`Не картинка (потрібен PNG / JPEG / WebP): ${p}`);
  if (!existsSync(p)) throw new Error(`Файл не знайдено: ${p}`);
  const r = await api(`/api/bridge/blobs?name=${encodeURIComponent(basename(p))}`, { method: 'PUT', headers: { 'content-type': type }, body: readFileSync(p) });
  if (!r.data.id) throw new Error(r.data.error || 'upload failed');
  return { blob: r.data.id, name: basename(p), path: p };
}

async function prepare(tool, args) {
  const a = JSON.parse(JSON.stringify(args || {}));
  if (tool === 'import_layouts') return { mode: a.mode, files: layoutFiles(a.paths) };
  if (tool === 'import_component') return { name: a.name, file: await uploadComponent(a.path) };
  if (typeof a.image === 'string' && a.image) a.image = await uploadFile(a.image);
  if (tool === 'set_symbols') for (const s of a.symbols || []) {
    if (typeof s.image === 'string' && s.image) s.image = await uploadFile(s.image);
    if (typeof s.blur_image === 'string' && s.blur_image) s.blur_image = await uploadFile(s.blur_image);
  }
  if (Array.isArray(a.parts)) for (const p of a.parts) if (p && typeof p.image === 'string' && p.image) p.image = await uploadFile(p.image);
  return a;
}

async function uploadComponent(path) {
  if (typeof path !== 'string' || !path) throw new Error('path: шлях до .component.json');
  const p = resolve(path);
  if (!existsSync(p) || !statSync(p).isFile()) throw new Error(`Файл не знайдено: ${p}`);
  if (statSync(p).size > 200 * 1024 * 1024) throw new Error(`Завеликий файл: ${p}`);
  const r = await api(`/api/bridge/blobs?name=${encodeURIComponent(basename(p))}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: readFileSync(p) });
  if (!r.data.id) throw new Error(r.data.error || 'upload failed');
  return { blob: r.data.id, name: basename(p), path: p };
}

async function exportComponent(args) {
  const r = await bridge('export_component', { id: args.id }, 120000);
  const want = args.path ? resolve(args.path) : join(DATA, 'components');
  const file = /\.json$/i.test(want) ? want : join(want, r.name);
  mkdirSync(dirname(file), { recursive: true });
  const res = await fetch(`${BASE}/api/bridge/blobs/${r.blob}`);
  if (!res.ok) throw new Error('файл не дійшов від сторінки');
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return { file, bytes: statSync(file).size, spine: r.spine, parts: r.parts, anims: r.anims, images: r.images };
}

function layoutFiles(paths) {
  const list = (Array.isArray(paths) ? paths : [paths]).filter(p => typeof p === 'string' && p);
  if (!list.length) throw new Error('paths порожній: дай шляхи до layout_*.json або до папки з ними');
  const files = [];
  for (const p of list.map(x => resolve(x))) {
    if (!existsSync(p)) throw new Error(`Немає: ${p}`);
    const found = statSync(p).isDirectory() ? readdirSync(p).filter(n => /\.json$/i.test(n) && !n.startsWith('.')).sort().map(n => join(p, n)) : [p];
    for (const f of found) {
      if (statSync(f).size > 32 * 1024 * 1024) throw new Error(`Завеликий файл: ${f}`);
      files.push({ name: basename(f), path: f, text: readFileSync(f, 'utf8') });
    }
  }
  if (!files.length) throw new Error(`JSON-файлів немає: ${list.join(', ')}`);
  return files;
}

function imageSize(path) {
  const fd = openSync(path, 'r');
  const buf = Buffer.alloc(65536);
  const n = readSync(fd, buf, 0, buf.length, 0);
  closeSync(fd);
  const b = buf.subarray(0, n);
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b.length > 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const kind = b.toString('ascii', 12, 16);
    if (kind === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L') { const v = b.readUInt32LE(21); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
    if (kind === 'VP8X') return { w: b.readUIntLE(24, 3) + 1, h: b.readUIntLE(27, 3) + 1 };
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return null;
}

function guess(rel) {
  const n = basename(rel, extname(rel)).toLowerCase();
  const p = rel.toLowerCase();
  const blur = /blur/.test(n);
  const base = n.replace(/^animation_symbol_|^symbol_|^sym_/, '').replace(/[_-]?blur(red)?$/, '');
  if (/wild/.test(n)) return { kind: 'symbol', group: 'wild', name: base, blur };
  if (/scatter|bonus/.test(n)) return { kind: 'symbol', group: 'scatter', name: base, blur };
  if (/^(h|hi|high|hp)[_-]?\d+$/.test(base) || /high/.test(n)) return { kind: 'symbol', group: 'high', name: base, blur };
  if (/^(l|lo|low|lp)[_-]?\d+$/.test(base) || /low/.test(n) || /^(ace|king|queen|jack|ten|nine|a|k|q|j|10|9)$/.test(base)) return { kind: 'symbol', group: 'low', name: base, blur };
  if (/notification|info.?(panel|banner|bar)/.test(n)) return { kind: 'infopanel' };
  if (/frame|border|reel.?bg|reels.?bg/.test(n)) return { kind: /above|over|top|front|fg/.test(n) ? 'frame_above' : /under|below|back|bg/.test(n) ? 'frame_under' : 'frame' };
  if (/logo/.test(n)) return { kind: 'logo' };
  if (/popup|pop_up|big.?win|mega|epic|congrat|intro|outro|banner/.test(n)) return { kind: 'popup' };
  if (/background|^bg|_bg|bg_/.test(n)) return { kind: 'background' };
  if (/symbol/.test(p)) return { kind: 'symbol', group: 'other', name: base, blur };
  return { kind: 'unknown' };
}

function scanArt({ dir, max_depth }) {
  const root = resolve(dir);
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`Папки немає: ${root}`);
  const depth = Number(max_depth) || 5;
  const images = [];
  const other = [];
  const walk = (d, level) => {
    if (level > depth || images.length > 3000) return;
    let list;
    try { list = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      if (e.name.startsWith('.')) continue;
      const full = join(d, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(full, level + 1); continue; }
      const ext = extname(e.name).toLowerCase();
      const rel = relative(root, full);
      if (IMAGE_EXT[ext]) {
        let size = null;
        try { size = imageSize(full); } catch { size = null; }
        images.push({ path: full, rel, w: size && size.w, h: size && size.h, bytes: statSync(full).size, guess: guess(rel) });
      } else if (['.psd', '.psb', '.spine', '.json', '.atlas', '.ai', '.svg'].includes(ext)) other.push(rel);
    }
  };
  walk(root, 0);
  const counts = {};
  for (const i of images) { const k = i.guess.kind === 'symbol' ? `symbol:${i.guess.group}` : i.guess.kind; counts[k] = (counts[k] || 0) + 1; }
  return { root, total: images.length, counts, images, other_files: other.slice(0, 200) };
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref();
}

async function openKit() {
  let info = await serverInfo();
  let started = false;
  if (!info) {
    mkdirSync(DATA, { recursive: true });
    const out = openSync(join(DATA, '.kit-server.log'), 'a');
    spawn(process.execPath, [join(HERE, 'dev.mjs')], { cwd: HERE, detached: true, stdio: ['ignore', out, out], env: { ...process.env, PORT: String(PORT), SPINE_KIT_DATA: DATA } }).unref();
    started = true;
    for (let i = 0; i < 40 && !info; i++) { await sleep(250); info = await serverInfo(); }
    if (!info) throw new Error(`Сервер не стартував. Лог: ${join(DATA, '.kit-server.log')}`);
  }
  if (!info.page) {
    openBrowser(PAGE);
    for (let i = 0; i < 60 && !info.page; i++) { await sleep(500); info = await serverInfo() || info; }
  }
  return { server: started ? 'started' : 'running', url: `http://localhost:${PORT}`, page_connected: !!info.page, projects_dir: info.projectsDir, note: info.page ? 'Кит підключений.' : 'Сторінка відкрита, але ще не підключилась: попроси користувача натиснути Connect у кіті.' };
}

async function kitStatus() {
  const info = await serverInfo();
  if (!info) return { server: false, url: `http://localhost:${PORT}`, hint: 'Сервер кита не запущений: виклич open_kit.' };
  const out = { server: true, url: `http://localhost:${PORT}`, projects_dir: info.projectsDir, page_connected: info.page };
  if (info.page) out.kit = await bridge('status', {}, 15000);
  else out.hint = 'Сторінка кита не підключена: виклич open_kit або попроси натиснути Connect.';
  return out;
}

async function exportDrafts(args) {
  const r = await bridge('export_drafts', { layouts: args.layouts }, 300000);
  const dir = resolve(args.out_dir || join(DATA, 'exports'));
  mkdirSync(dir, { recursive: true });
  const res = await fetch(`${BASE}/api/bridge/blobs/${r.blob}`);
  if (!res.ok) throw new Error('zip не дійшов від сторінки');
  const file = join(dir, r.name);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  const out = { zip: file, spines: r.spines, layouts: r.layouts, bytes: statSync(file).size };
  if (args.unzip) {
    const u = spawnSync('unzip', ['-o', '-q', file, '-d', dir], { encoding: 'utf8' });
    out.extracted = u.status === 0 ? join(dir, r.name.replace(/\.zip$/, '')) : `unzip failed: ${u.stderr || u.status}`;
  }
  return out;
}

function content(result) {
  const parts = [];
  const shots = result && Array.isArray(result.images) && result.images.length && result.images.every(s => s && s.data) ? result.images : [];
  const rest = result && typeof result === 'object' && !Array.isArray(result) ? { ...result } : result;
  if (shots.length) delete rest.images;
  parts.push({ type: 'text', text: typeof rest === 'string' ? rest : JSON.stringify(rest, null, 1) });
  for (const s of shots) parts.push({ type: 'image', data: s.data, mimeType: s.mime || 'image/png' });
  return parts;
}

async function runTool(name, args) {
  const t = TOOLS.find(x => x.name === name);
  if (!t) throw new Error(`Unknown tool ${name}`);
  if (name === 'kit_status') return kitStatus();
  if (name === 'open_kit') return openKit();
  if (name === 'scan_art') return scanArt(args || {});
  if (name === 'export_drafts') return exportDrafts(args || {});
  if (name === 'export_component') return exportComponent(args || {});
  return bridge(name, await prepare(name, args), t.timeout || 90000);
}

let clientName = 'Claude';
let presenceOn = false;
async function presence() {
  if (presenceOn) return;
  presenceOn = true;
  for (;;) {
    try {
      const r = await fetch(`${BASE}/api/bridge/agent?name=${encodeURIComponent(clientName)}`);
      if (r.ok && r.body) for await (const chunk of r.body) void chunk;
    } catch { }
    await sleep(2500);
  }
}

const write = msg => process.stdout.write(JSON.stringify(msg) + '\n');
const reply = (id, result) => write({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => write({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    const want = params && params.protocolVersion;
    if (params && params.clientInfo && params.clientInfo.name) clientName = params.clientInfo.name;
    presence();
    return reply(id, {
      protocolVersion: PROTOCOLS.includes(want) ? want : PROTOCOLS[0],
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'spine-draft-kit', title: 'Spine Draft Kit', version: VERSION },
      instructions: INSTRUCTIONS
    });
  }
  if (method === 'ping') return reply(id, {});
  if (method === 'tools/list') {
    return reply(id, {
      tools: TOOLS.map(t => ({
        name: t.name,
        title: t.title,
        description: t.description,
        inputSchema: t.inputSchema,
        annotations: { title: t.title, readOnlyHint: !t.mutates && !['open_kit', 'export_drafts', 'export_component', 'spin', 'preview', 'show_layout'].includes(t.name), destructiveHint: !!t.destructive || t.name === 'remove_component' || t.name === 'set_symbols', openWorldHint: false }
      }))
    });
  }
  if (method === 'tools/call') {
    try { return reply(id, { content: content(await runTool(params.name, params.arguments)) }); }
    catch (e) { return reply(id, { content: [{ type: 'text', text: e.message }], isError: true }); }
  }
  if (id === undefined || id === null) return;
  fail(id, -32601, `Method not found: ${method}`);
}

const rl = createInterface({ input: process.stdin });
rl.on('line', line => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return fail(null, -32700, 'Parse error'); }
  for (const m of Array.isArray(msg) ? msg : [msg]) handle(m).catch(e => { log(e.stack || e.message); if (m.id !== undefined) fail(m.id, -32603, e.message); });
});
rl.on('close', () => process.exit(0));
log(`ready, kit ${BASE}`);
