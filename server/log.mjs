import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export const routeOf = path => {
  const p = String(path || '').split('?')[0].replace(/[^\x21-\x7e]/g, '?');
  if (/^\/[ud]\//.test(p)) return p.slice(0, 3) + '…';
  return p.length > 200 ? p.slice(0, 200) + '…' : p;
};

export function createLog({ dir, out = process.stdout }) {
  const now = () => new Date().toISOString();
  const line = o => { try { out.write(JSON.stringify(o) + '\n'); } catch { return; } };
  const file = dir ? join(dir, 'audit.jsonl') : null;
  return {
    id: () => randomBytes(6).toString('hex'),
    request: o => line({ t: now(), kind: 'req', ...o }),
    info: (msg, o) => line({ t: now(), kind: 'info', msg, ...o }),
    error: (msg, o) => line({ t: now(), kind: 'error', msg, ...o }),
    audit(type, o) {
      const e = { t: now(), type, ...o };
      if (file) { try { appendFileSync(file, JSON.stringify(e) + '\n'); } catch (err) { line({ t: e.t, kind: 'error', msg: 'audit: ' + err.message }); } }
      line({ kind: 'audit', ...e });
    },
    readAudit(limit = 200) {
      if (!file) return [];
      let text = '';
      try { text = readFileSync(file, 'utf8'); } catch { return []; }
      return text.split('\n').filter(Boolean).slice(-limit).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse();
    }
  };
}
