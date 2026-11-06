import { randomBytes } from 'node:crypto';
import { readBody } from './auth.mjs';
import { HTTP_TOOLS, LABELS, listTools, httpInstructions, GUIDE } from './tools.mjs';

const VERSION = '1.0.0';
const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26'];
const ACTIVE = 10 * 60 * 1000;
const SESSION_IDLE = 24 * 3600 * 1000;

const content = result => {
  const parts = [];
  const shots = result && Array.isArray(result.images) && result.images.length && result.images.every(s => s && s.data) ? result.images : [];
  const rest = result && typeof result === 'object' && !Array.isArray(result) ? { ...result } : result;
  if (shots.length) delete rest.images;
  parts.push({ type: 'text', text: typeof rest === 'string' ? rest : JSON.stringify(rest, null, 1) });
  for (const s of shots) parts.push({ type: 'image', data: s.data, mimeType: s.mime || 'image/png' });
  return parts;
};
const iso = t => t ? new Date(t).toISOString() : null;
const author = by => by ? by.name || by.email : '';
const size = m => `${m.w}x${m.h}`;

export function createMcpHttp({ hub, oauth, files, engine, publicUrl, log, limiter, library }) {
  const origin = new URL(publicUrl).origin;
  const sessions = new Map();
  const rate = limiter ? limiter(10, 20) : () => 0;
  const audit = (type, o) => log && log.audit(type, o);
  const instructions = httpInstructions(origin);
  const listed = listTools(HTTP_TOOLS);

  const projectUrl = id => `${origin}/p/${id}`;
  const agents = id => {
    const now = Date.now();
    const out = new Map();
    for (const s of sessions.values()) {
      if (s.project !== id || now - s.last > ACTIVE) continue;
      const prev = out.get(s.owner.email);
      if (prev && prev.busy) continue;
      out.set(s.owner.email, { kind: 'claude', email: s.owner.email, name: 'Claude · ' + s.owner.name, busy: s.busy });
    }
    return [...out.values()];
  };
  hub.setAgents(agents);
  const tell = id => { if (id) hub.presenceChanged(id); };
  const at = s => Math.max(s.last, s.seen || 0);
  const linked = email => {
    const now = Date.now();
    const mine = [...sessions.values()].filter(s => s.owner.email === email && now - at(s) <= ACTIVE);
    return { on: mine.length > 0, projects: [...new Set(mine.map(s => s.project).filter(Boolean))] };
  };
  hub.setLinked(linked);
  const mine = email => hub.linkedChanged(email);

  setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) {
      if (now - s.last > SESSION_IDLE) sessions.delete(id);
      else if (s.project && !s.gone && now - s.last > ACTIVE) { s.gone = true; tell(s.project); }
      if (sessions.has(id) && !s.away && now - at(s) > ACTIVE) { s.away = true; mine(s.owner.email); }
    }
  }, 60000).unref();

  const json = (res, code, d, h = {}) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...h });
    res.end(JSON.stringify(d));
  };
  const rpcErr = (res, code, id, c, message) => json(res, code, { jsonrpc: '2.0', id: id ?? null, error: { code: c, message } });

  const viewingOf = s => hub.viewing(s.owner.email).map(id => { const d = hub.get(id); return d ? { id, name: d.settings.game || '', url: projectUrl(id) } : null; }).filter(Boolean);
  const viewHint = list => {
    const one = v => `«${v.name || 'Без назви'}» (${v.id})`;
    if (list.length === 1) return ` Людина зараз має відкритим у браузері проект ${one(list[0])}: open_project на ньому — і вона бачитиме роботу наживо.`;
    if (list.length > 1) return ` Людина зараз має відкритими в браузері проекти ${list.map(one).join(', ')}: open_project на одному з них показує роботу наживо; спитай, у якому працювати.`;
    return '';
  };

  const need = s => {
    if (!s.project) throw new Error('У цій MCP-сесії немає проекту (після перезапуску сервера його треба відкрити знову): list_projects, потім open_project або create_project.' + viewHint(viewingOf(s)));
    if (!hub.get(s.project)) { const id = s.project; s.project = null; throw new Error(`Проект ${id} видалено або він недоступний. list_projects → open_project.`); }
    return s.project;
  };
  const by = s => ({ kind: 'claude', email: s.owner.email, name: s.owner.name });
  const metaOut = (p, cur) => ({ id: p.id, name: p.settings.game || '', grid: `${p.settings.reels}x${p.settings.rows}`, components: (p.settings.components || []).filter(c => c.on).length, updated: iso(p.updated), updated_by: p.updatedBy ? p.updatedBy.name || p.updatedBy.email : null, open: p.id === cur, url: projectUrl(p.id) });

  const prepare = (s, tool, args) => {
    const a = JSON.parse(JSON.stringify(args || {}));
    const img = v => {
      const f = files.resolve(s.owner, v, ['image']);
      return { blob: engine.putBlob(f.buf, f.type, f.name), name: f.name, path: f.name };
    };
    if (tool === 'import_layouts') {
      const list = (Array.isArray(a.refs) ? a.refs : [a.refs]).filter(Boolean);
      if (!list.length) throw new Error('refs порожній: залий layout_*.json через upload_files і передай refs');
      return { mode: a.mode, files: list.map(r => { const f = files.resolve(s.owner, r, ['layout', 'component']); return { name: f.name, path: f.name, text: f.buf.toString('utf8') }; }) };
    }
    if (tool === 'import_component') {
      const f = files.resolve(s.owner, a.ref, ['component', 'layout']);
      return { name: a.name, file: { blob: engine.putBlob(f.buf, 'application/json', f.name), name: f.name, path: f.name } };
    }
    if (tool === 'sandbox_new' && typeof a.from_file === 'string' && a.from_file) {
      const f = files.resolve(s.owner, a.from_file, ['component', 'layout']);
      a.file = { blob: engine.putBlob(f.buf, 'application/json', f.name), name: f.name, path: f.name };
      delete a.from_file;
    }
    if (typeof a.image === 'string' && a.image) a.image = img(a.image);
    if (tool === 'set_symbols') for (const x of a.symbols || []) {
      if (x && typeof x.image === 'string' && x.image) x.image = img(x.image);
      if (x && typeof x.blur_image === 'string' && x.blur_image) x.blur_image = img(x.blur_image);
    }
    if (Array.isArray(a.parts)) for (const p of a.parts) if (p && typeof p.image === 'string' && p.image) p.image = img(p.image);
    return a;
  };

  const inEngine = async (s, tool, args, project) => {
    const t = HTTP_TOOLS.find(x => x.name === tool);
    const pid = project === undefined ? need(s) : project;
    s.busy = LABELS[tool] || tool;
    tell(pid || s.project);
    try {
      return await engine.run({ project: pid, tool, args, owner: { email: s.owner.email, name: s.owner.name, client: s.client }, timeout: (t && t.timeout) || 90000 });
    } finally {
      s.busy = null;
      s.last = Date.now();
      tell(pid || s.project);
    }
  };

  const server = {
    kit_status: async s => {
      const doc = s.project && hub.get(s.project);
      if (s.project && !doc) s.project = null;
      const viewing = viewingOf(s);
      const out = { server: origin, user: s.owner, client: s.client, project: doc ? { id: doc.id, name: doc.settings.game || '', grid: `${doc.settings.reels}x${doc.settings.rows}`, url: projectUrl(doc.id), version: doc.v } : null, viewing };
      if (doc) out.in_project = hub.presenceOf(doc.id).map(p => ({ kind: p.kind, name: p.name, email: p.email, busy: p.busy || undefined }));
      else out.hint = 'Проект не вибрано: list_projects, спитай людину, потім open_project або create_project.' + viewHint(viewing);
      return out;
    },
    list_projects: async s => {
      const list = hub.list();
      return { current: s.project, projects: list.map(p => metaOut(p, s.project)) };
    },
    open_project: async (s, a) => {
      const q = String(a.id || '').trim();
      const list = hub.list();
      const p = list.find(x => x.id === q) || list.find(x => (x.settings.game || '').toLowerCase() === q.toLowerCase());
      if (!p) throw new Error(`Немає проекту «${q}». Є: ${list.map(x => `${x.settings.game || 'Без назви'} (${x.id})`).join(', ') || 'жодного'}`);
      const before = s.project;
      s.project = p.id;
      if (before && before !== p.id) tell(before);
      mine(s.owner.email);
      const st = await inEngine(s, 'status', {}, p.id);
      return { project: { id: p.id, name: p.settings.game || '', url: projectUrl(p.id) }, grid: st.project && st.project.grid, cell: st.project && st.project.cell, symbols: st.symbols, components: st.components, in_project: hub.presenceOf(p.id).map(x => x.name) };
    },
    upload_files: async (s, a) => files.issue(s.owner, a.files),
    get_history: async (s, a) => {
      const id = need(s);
      const scope = a.scope === 'drafts' || a.scope === 'layouts' ? a.scope : '';
      const limit = Math.max(1, Math.min(100, Math.round(Number(a.limit) || 20)));
      const h = hub.history(id, scope, '');
      return {
        project: id,
        entries: (h ? h.entries : []).slice(0, limit).map(e => ({
          id: e.id, scope: e.scope, time: iso(e.t), label: e.label,
          by: e.by && e.by.kind === 'claude' ? 'Claude · ' + e.by.name : (e.by && e.by.name) || '',
          email: e.by && e.by.email, named: e.named || undefined, in_progress: e.open || undefined
        })),
        more: !!(h && (h.more || h.entries.length > limit))
      };
    },
    restore_version: async (s, a) => {
      const id = need(s);
      const r = hub.restore(id, by(s), String(a.entry || ''), a.scope);
      if (r.error) throw new Error(r.error);
      audit('project.restore', { email: s.owner.email, project: id, entry: String(a.entry || '').slice(0, 64), scope: a.scope, via: 'mcp' });
      return r.nothing ? { restored: false, note: 'Вже в цьому стані' } : { restored: true, v: r.v, note: 'Відкат записано в історію: його теж можна відкотити' };
    },
    save_version: async (s, a) => {
      const id = need(s);
      const r = hub.version(id, by(s), a.label);
      if (r.error) throw new Error(r.error);
      return { saved: true, label: r.entries[0].named, entries: r.entries.map(e => e.id) };
    },
    create_project: async (s, a) => {
      const r = await inEngine(s, 'create_project', a, null);
      const before = s.project;
      s.project = r.project.id;
      if (before && before !== s.project) tell(before);
      tell(s.project);
      mine(s.owner.email);
      return { ...r, url: projectUrl(r.project.id) };
    },
    export_drafts: async (s, a) => {
      const r = await inEngine(s, 'export_drafts', { layouts: a.layouts });
      const buf = engine.takeBlob(r.blob);
      if (!buf) throw new Error('zip не дійшов від рушія');
      const d = files.offer(s.owner, r.name, buf, 'application/zip');
      return { name: r.name, bytes: buf.length, spines: r.spines, layouts: r.layouts, download: d.url, expires_in: d.expires_in, curl: `curl -fsS -o ${files.quote('<folder>/' + r.name)} ${files.quote(d.url)}` };
    },
    export_component: async (s, a) => {
      const r = await inEngine(s, 'export_component', { id: a.id });
      const buf = engine.takeBlob(r.blob);
      if (!buf) throw new Error('файл не дійшов від рушія');
      const d = files.offer(s.owner, r.name, buf, 'application/json');
      return { name: r.name, bytes: buf.length, spine: r.spine, parts: r.parts, anims: r.anims, images: r.images, download: d.url, expires_in: d.expires_in, curl: `curl -fsS -o ${files.quote('<folder>/' + r.name)} ${files.quote(d.url)}` };
    },
    sandbox_guide: async () => GUIDE,
    library_list: async (s, a) => {
      if (a.id) {
        const x = library.get(String(a.id));
        if (!x) throw new Error(`Немає компонента ${String(a.id).slice(0, 80)} у бібліотеці`);
        return { id: x.id, label: x.label, spine: x.name, note: x.note, tags: x.tags, size: size(library.meta(x)), by: author(x.by), updated: iso(x.updated), component: x.component, images: Object.keys(x.images || {}) };
      }
      const all = library.list();
      const words = String(a.query || '').toLowerCase().split(/\s+/).filter(Boolean);
      const hit = m => { const t = [m.label, m.name, m.note, ...m.tags, m.by && m.by.name, m.by && m.by.email].filter(Boolean).join(' ').toLowerCase(); return words.every(w => t.includes(w)); };
      return { total: all.length, items: all.filter(hit).slice(0, 100).map(m => ({ id: m.id, label: m.label, spine: m.name, size: size(m), parts: m.parts, anims: m.anims, note: m.note, tags: m.tags, by: author(m.by), updated: iso(m.updated) })) };
    },
    library_remove: async (s, a) => {
      const id = String(a.id || '');
      const x = library.get(id);
      const r = library.remove(id, s.owner, false);
      if (r.code === 404) throw new Error(`Немає компонента ${id.slice(0, 80)} у бібліотеці`);
      if (r.code === 403) throw new Error(`Видалити «${x.label}» з бібліотеки може лише його автор: ${author(x.by) || '?'}.`);
      if (r.error) throw new Error(r.error);
      hub.broadcast('library', { items: library.list() });
      audit('library.delete', { email: s.owner.email, id, via: 'mcp' });
      return { removed: true, id };
    }
  };

  const runTool = async (s, name, args) => {
    const t = HTTP_TOOLS.find(x => x.name === name);
    if (!t) throw new Error(`Unknown tool ${name}`);
    s.last = Date.now();
    s.gone = false;
    if (server[name]) return server[name](s, args || {});
    return inEngine(s, name, prepare(s, name, args));
  };

  const call = async (req, res, s, msg) => {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no', 'mcp-session-id': s.id });
    res.write(': call\n\n');
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { return; } }, 15000);
    const p = msg.params || {};
    let result;
    const t0 = Date.now();
    try { result = { content: content(await runTool(s, p.name, p.arguments)) }; }
    catch (e) { result = { content: [{ type: 'text', text: (e && e.message) || String(e) }], isError: true }; }
    clearInterval(ping);
    if (log) log.info('mcp.call', { user: s.owner.email, tool: String(p.name || '').slice(0, 64), ok: !result.isError, ms: Date.now() - t0, project: s.project || null });
    try { res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })}\n\n`); } catch { return; }
  };

  const handle = async (req, res, url) => {
    if (req.headers.origin && req.headers.origin !== origin) return json(res, 403, { error: 'origin' });
    const b = oauth.bearer(req);
    if (b.error) return json(res, 401, { error: b.error === 'missing' ? 'unauthorized' : 'invalid_token' }, { 'www-authenticate': oauth.challenge(b.error) });
    res.kitUser = b.user.email;
    const m = req.method;
    const sid = String(req.headers['mcp-session-id'] || '');
    if (m === 'GET') { res.setHeader('allow', 'POST, DELETE'); return json(res, 405, { error: 'SSE stream not offered: use POST' }); }
    if (m === 'DELETE') {
      const s = sessions.get(sid);
      if (!s || s.owner.email !== b.user.email) return json(res, 404, { error: 'unknown session' });
      sessions.delete(sid);
      tell(s.project);
      mine(s.owner.email);
      res.writeHead(204);
      return res.end();
    }
    if (m !== 'POST') { res.setHeader('allow', 'POST, DELETE'); return json(res, 405, { error: 'method' }); }
    const pv = req.headers['mcp-protocol-version'];
    if (pv && !PROTOCOLS.includes(String(pv))) return rpcErr(res, 400, null, -32600, `Unsupported MCP-Protocol-Version ${String(pv).slice(0, 20)}; supported: ${PROTOCOLS.join(', ')}`);
    const wait = rate(b.user.email);
    if (wait) return json(res, 429, { error: 'забагато запитів' }, { 'retry-after': String(wait) });
    let msg;
    try { msg = JSON.parse((await readBody(req, 4 * 1024 * 1024)).toString('utf8')); }
    catch (e) { if (e.code === 413) return rpcErr(res, 413, null, -32600, 'body too large'); return rpcErr(res, 400, null, -32700, 'Parse error'); }
    if (Array.isArray(msg)) return rpcErr(res, 400, null, -32600, 'Batches are not supported');
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return rpcErr(res, 400, msg && msg.id, -32600, 'Invalid Request');
    if (msg.method === 'initialize') {
      const want = msg.params && msg.params.protocolVersion;
      const ci = (msg.params && msg.params.clientInfo) || {};
      const id = randomBytes(24).toString('base64url');
      const s = { id, owner: b.user, family: b.family, client: String(ci.name || b.client || 'Claude').slice(0, 80), protocol: PROTOCOLS.includes(want) ? want : PROTOCOLS[0], project: null, busy: null, last: Date.now(), created: Date.now() };
      sessions.set(id, s);
      mine(b.user.email);
      audit('mcp.session', { email: b.user.email, client: s.client });
      return json(res, 200, { jsonrpc: '2.0', id: msg.id, result: { protocolVersion: s.protocol, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'spine-draft-kit', title: 'Spine Draft Kit', version: VERSION }, instructions } }, { 'mcp-session-id': id });
    }
    if (!sid) return rpcErr(res, 400, msg.id, -32600, 'Mcp-Session-Id header required (call initialize first)');
    const s = sessions.get(sid);
    if (!s || s.owner.email !== b.user.email) return rpcErr(res, 404, msg.id, -32001, 'Session not found: initialize again');
    s.seen = Date.now();
    if (s.away) { s.away = false; mine(s.owner.email); }
    if (msg.id === undefined || msg.id === null || !msg.method) { res.writeHead(202); return res.end(); }
    if (msg.method === 'ping') return json(res, 200, { jsonrpc: '2.0', id: msg.id, result: {} });
    if (msg.method === 'tools/list') return json(res, 200, { jsonrpc: '2.0', id: msg.id, result: { tools: listed } });
    if (msg.method === 'tools/call') return call(req, res, s, msg);
    rpcErr(res, 200, msg.id, -32601, `Method not found: ${String(msg.method).slice(0, 80)}`);
  };

  return { handle, sessions: () => sessions.size };
}
