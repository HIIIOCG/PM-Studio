import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDemo } from './timeline-core.mjs';
import { buildGoogleUi } from './build-google-ui.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bridge = `(() => {
  const view = new URL(document.currentScript.src).searchParams.get('view');
  function send(method, input, success, failure) {
    fetch('/mock/' + view, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, ...(input === undefined ? {} : { input }) }) })
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error || '示意服務無法回應。'); return result; })
      .then(result => success?.(result)).catch(error => failure?.(error));
  }
  function bound(ok, bad) {
    return { withSuccessHandler(handler) { return bound(handler, bad); }, withFailureHandler(handler) { return bound(ok, handler); },
      getTimeline() { send('getTimeline', undefined, ok, bad); },
      saveLayout(input) { send('saveLayout', input, ok, bad); } };
  }
  window.google = { script: { run: bound(null, null) } };
})();`;

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
async function inputJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 128_000) throw new Error('示意要求太大。'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createGooglePreviewServer({ now = new Date() } = {}) {
  const sample = createDemo(now);
  let revisionNumber = 1;
  let projects = sample.projects.map((project) => ({ ...project }));
  const internal = () => ({ ...sample, mode: 'internal', preview: true, projects, revision: `mock-${revisionNumber}`, permissions: { canEditLayout: true } });
  const published = () => ({ mode: 'public', preview: true, today: sample.today, syncedAt: '', warnings: [], permissions: { canEditLayout: false }, workspaces: sample.workspaces,
    projects: sample.projects.map((project, index) => ({ alias: `專案 ${String(index + 1).padStart(3, '0')}`,
      goal: project.workspaceIds.includes('D') ? '遊戲美術製作' : project.workspaceIds.includes('C') ? '角色模型與場景製作' : '角色模型製作',
      start: project.start, end: project.end, workspaceIds: project.workspaceIds, workspaceUnits: project.workspaceUnits })) });
  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    try {
      if (req.method === 'GET' && (url.pathname === '/public' || url.pathname === '/internal' || url.pathname === '/')) {
        const view = url.pathname === '/public' ? 'public' : 'internal';
        const source = await readFile(resolve(root, 'google-app', view === 'public' ? 'PublicIndex.html' : 'Index.html'), 'utf8');
        const html = source.replace('<head>', `<head><script src="/mock-bridge.js?view=${view}"></script>`);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
          'Content-Security-Policy': "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" });
        return res.end(html);
      }
      if (req.method === 'GET' && url.pathname === '/mock-bridge.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(bridge);
      }
      if (req.method === 'POST' && ['/mock/public', '/mock/internal'].includes(url.pathname)) {
        const view = url.pathname.endsWith('/public') ? 'public' : 'internal';
        const input = await inputJson(req);
        if (!input || Object.keys(input).some((key) => !['method', 'input'].includes(key))) throw new Error('示意操作欄位無效。');
        if (input.method === 'getTimeline') {
          if ('input' in input) throw new Error('查詢不接受版本或資料來源參數。');
          return json(res, 200, view === 'public' ? published() : internal());
        }
        if (view === 'public') return json(res, 403, { error: '公開排程只提供查詢。' });
        if (input.method !== 'saveLayout') throw new Error('沒有這個示意操作。');
        const layout = input.input;
        if (!layout || Object.keys(layout).some((key) => !['assignments', 'allocations', 'revision'].includes(key))) throw new Error('配置欄位無效。');
        if (layout.revision !== `mock-${revisionNumber}`) return json(res, 409, { error: '資料已更新，請重新讀取後再安排。' });
        if (!layout.assignments || typeof layout.assignments !== 'object' || Array.isArray(layout.assignments)
          || !layout.allocations || typeof layout.allocations !== 'object' || Array.isArray(layout.allocations)) throw new Error('缺少工作區配置。');
        const ids = new Set(projects.map((project) => project.id));
        if (Object.keys(layout.assignments).some((id) => !ids.has(id))) throw new Error('配置含未知案件。');
        const validAreas = new Set(sample.workspaces.map((space) => space.id));
        const placements = new Map();
        for (const [id, areas] of Object.entries(layout.assignments)) {
          if (!Array.isArray(areas) || new Set(areas).size !== areas.length || areas.some((area) => !validAreas.has(area))) throw new Error('工作區無效。');
          const units = {};
          for (const area of areas) { const value = layout.allocations[id]?.[area] ?? 1; if (!Number.isInteger(value) || value < 1 || value > (area === 'A' || area === 'B' ? 2 : 1000)) throw new Error('使用數量無效。'); units[area] = value; }
          placements.set(id, { workspaceIds: [...areas], workspaceUnits: units });
        }
        projects = projects.map((project) => ({ ...project, ...(placements.get(project.id) || {}) }));
        revisionNumber++;
        return json(res, 200, internal());
      }
      json(res, 404, { error: '找不到預覽內容。' });
    } catch (error) { json(res, 400, { error: error.message || '示意要求無效。' }); }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PM_STUDIO_GOOGLE_PREVIEW_PORT || 4318);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('預覽連接埠無效。');
  await buildGoogleUi();
  const server = createGooglePreviewServer();
  server.listen(port, '127.0.0.1', () => console.log(`Google UI 示意預覽：http://127.0.0.1:${port}/internal ／ /public（純虛構資料）`));
}
