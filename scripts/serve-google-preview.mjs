import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGoogleUi } from './build-google-ui.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const previewBridge = `(() => {
  function bound(ok, bad) {
    return { withSuccessHandler(handler) { return bound(handler, bad); }, withFailureHandler(handler) { return bound(ok, handler); },
      getTimeline() { fetch('/mock/timeline', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"method":"getTimeline"}' })
        .then(async response => { if (!response.ok) throw new Error('Preview unavailable'); return response.json(); }).then(ok).catch(bad); } };
  }
  window.google = { script: { run: bound(null, null) } };
})();`;
function previewDay(now) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); }
export function createPreviewPayload(now = new Date()) {
  const today = previewDay(now);
  const base = Date.parse(today + 'T00:00:00Z');
  const date = (offset) => new Date(base + offset * 86400000).toISOString().slice(0, 10);
  const project = (id, customerCode, start, end, workspaceUnits, correctionStart = '', correctionEnd = '', pendingReasons = []) =>
    ({ id, customerCode, start, end, correctionStart, correctionEnd, workspaceIds: Object.keys(workspaceUnits), workspaceUnits, pendingReasons, scheduleKind: 'production', followUp: [] });
  return {
    schemaVersion: 3, today, syncedAt: now.toISOString(),
    workspaces: [{ id: 'A', name: '角色模型 A', usualLoad: 2 }, { id: 'B', name: '角色模型 B', usualLoad: 2 }, { id: 'C', name: '角色與場景' }, { id: 'D', name: 'CT 美術' }], warnings: [],
    projects: [
      project('C-901', 'TEST-01', date(-16), date(26), { A: 2 }, date(31), date(44)),
      project('C-902', 'TEST-02', date(8), date(66), { A: 1, B: 1 }),
      project('C-903', 'TEST-03', date(-5), date(19), { B: 1 }),
      project('BG-901', 'TEST-04', date(6), date(58), { C: 1 }),
      project('O-901', 'TEST-05', date(-7), date(41), { D: 1 }),
      project('P-901', 'TEST-06', date(47), date(48), { C: 1 }),
      project('C-904', 'TEST-07', date(15), date(72), {}, '', '', ['no-workspace']),
      project('C-905', '', date(12).slice(0, 7), '', { B: 1 }, '', '', ['production-dates', 'customer-code']),
      project('BG-902', 'TEST-08', date(-25), date(-6), { C: 2 }, date(3), '', ['correction-dates']),
      { ...project('C-906', 'TEST-09', date(-32).slice(0, 7), date(16), { A: 1 }), followUp: [] },
      { ...project('C-907', 'TEST-10', date(-96), date(-45), { B: 1 }), followUp: ['customer-confirmation', 'payment'] },
      { ...project('O-902', 'TEST-11', date(70).slice(0, 7), date(135).slice(0, 7), { C: 1 }), scheduleKind: 'reservation' },
    ],
  };
}
function previewJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
async function previewInput(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 1024) throw new Error('Invalid request'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export function createGooglePreviewServer({ now = new Date(), htmlPath = resolve(root, 'google-app/Index.html') } = {}) {
  const payload = createPreviewPayload(now);
  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    try {
      if (req.method === 'GET' && url.pathname === '/') {
        const source = await readFile(htmlPath, 'utf8');
        const html = source.replace('<head>', '<head><script src="/mock-bridge.js"></script>').replace('id="preview-note" class="preview-note" hidden', 'id="preview-note" class="preview-note"');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
          'Content-Security-Policy': "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" });
        return res.end(html);
      }
      if (req.method === 'GET' && url.pathname === '/mock-bridge.js') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); return res.end(previewBridge); }
      if (req.method === 'POST' && url.pathname === '/mock/timeline') {
        const input = await previewInput(req);
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 || input.method !== 'getTimeline') return previewJson(res, 400, { error: 'Read-only preview; no arguments or writes.' });
        return previewJson(res, 200, payload);
      }
      return previewJson(res, 404, { error: 'Preview route not found.' });
    } catch { return previewJson(res, 400, { error: 'Invalid preview request.' }); }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PM_STUDIO_GOOGLE_PREVIEW_PORT || 4318);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid preview port.');
  await buildGoogleUi();
  createGooglePreviewServer().listen(port, '127.0.0.1', () => console.log('Fictional preview: http://127.0.0.1:' + port + '/'));
}
