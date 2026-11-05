import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeAtomic } from './server/data.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const VENDOR_DIR = join(HERE, 'vendor');
export const VENDOR = [
  { file: 'spine-player-4.1.55.min.js', url: 'https://cdn.jsdelivr.net/npm/@esotericsoftware/spine-player@4.1.55/dist/iife/spine-player.min.js', sha256: 'cb52ab56b13b6005d74710ae54da8b353098396c306fd536288a8f1a3ed3e6e3' },
  { file: 'jszip-3.10.1.min.js', url: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', sha256: 'acc7e41455a80765b5fd9c7ee1b8078a6d160bbbca455aeae854de65c947d59e' }
];

const sha = buf => createHash('sha256').update(buf).digest('hex');

export function vendorState(dir = VENDOR_DIR) {
  return VENDOR.map(v => {
    const f = join(dir, v.file);
    if (!existsSync(f)) return { ...v, ok: false, why: 'немає файлу' };
    const buf = readFileSync(f);
    return sha(buf) === v.sha256 ? { ...v, ok: true, buf } : { ...v, ok: false, why: 'sha256 не збігається' };
  });
}

async function main() {
  mkdirSync(VENDOR_DIR, { recursive: true });
  let bad = 0;
  for (const v of vendorState()) {
    if (v.ok) { console.log(`= ${v.file}`); continue; }
    try {
      const r = await fetch(v.url, { signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      const got = sha(buf);
      if (got !== v.sha256) throw new Error(`sha256 ${got}, а має бути ${v.sha256}`);
      writeAtomic(join(VENDOR_DIR, v.file), buf);
      console.log(`+ ${v.file} (${buf.length} байт)`);
    } catch (e) {
      bad++;
      console.error(`! ${v.file}: ${e.message}`);
    }
  }
  if (bad) { console.error(`Не вдалося: ${bad}. Поклади файли у ${VENDOR_DIR} вручну.`); process.exit(1); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
