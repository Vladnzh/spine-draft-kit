import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = f => readFileSync(join(HERE, 'src', f), 'utf8');
const fill = (s, token, code, name) => {
  if (!s.includes(token)) throw new Error(`token ${token} missing`);
  if (/<\/script/i.test(code)) throw new Error(`${name} contains </script`);
  return s.split(token).join(code);
};
let page = src('page.html');
page = fill(page, '/*@CORE@*/', src('core.js'), 'core');
page = fill(page, '/*@STORE@*/', src('store.js'), 'store');
page = fill(page, '/*@INFO@*/', src('info.js'), 'info');
page = fill(page, '/*@UI@*/', src('ui.js'), 'ui');
if (!page.startsWith('<title>Spine Draft Kit</title>')) throw new Error('page must start with the title');
writeFileSync(join(HERE, 'spine-draft-kit.html'), page);
const standalone = `<!doctype html><html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>${page}</body></html>\n`;
writeFileSync(join(HERE, '..', 'Spine-Draft-Kit.html'), standalone);
console.log(`spine-draft-kit.html ${Buffer.byteLength(page)} bytes; ../Spine-Draft-Kit.html ${Buffer.byteLength(standalone)} bytes`);
