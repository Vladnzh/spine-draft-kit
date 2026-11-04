import { createServer } from 'node:http';
import { readFileSync, watch } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBridge } from './server/bridge.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'Spine-Draft-Kit.html');
const PORT = Number(process.env.PORT) || 5180;
const DATA = process.env.SPINE_KIT_DATA || join(HERE, 'projects');
const bridge = createBridge({ port: PORT, kitDir: HERE, dataDir: DATA });
const RELOAD = `<script>new EventSource('/__reload').onmessage=()=>location.reload()</script>`;
const clients = new Set();
let error = '';

const build = () => {
  const r = spawnSync(process.execPath, [join(HERE, 'build.mjs')], { encoding: 'utf8' });
  error = r.status === 0 ? '' : (r.stderr || r.stdout);
  console.log(error ? `build failed\n${error}` : r.stdout.trim());
  for (const res of clients) res.write('data: reload\n\n');
};

createServer((req, res) => {
  if (bridge.handle(req, res)) return;
  if (req.url === '/__reload') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    res.write(': open\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  if (error) return res.end(`<pre style="color:#c00;white-space:pre-wrap">${error.replace(/</g, '&lt;')}</pre>${RELOAD}`);
  res.end(readFileSync(OUT, 'utf8').replace('</body>', `${RELOAD}</body>`));
}).listen(PORT, () => console.log(`Draft Kit: http://localhost:${PORT}\nПроекти: ${DATA}`));

let timer;
watch(join(HERE, 'src'), () => {
  clearTimeout(timer);
  timer = setTimeout(build, 80);
});
build();
