import { readFile, writeFile, mkdir, copyFile, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORKSPACES } from './timeline-core.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFile(resolve(root, path), 'utf8');
function section(source, start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first + start.length);
  if (first < 0 || last < 0) throw new Error(`前端來源結構已變動，請檢查 ${start}`);
  return source.slice(first, last);
}
function removeExports(source) { return source.replace(/^import[^\n]*\n/gm, '').replace(/^export\s+/gm, ''); }
function safeScript(source) { return source.replace(/<\/script/gi, '<\\/script'); }
async function present(path) { try { await access(resolve(root, path)); return true; } catch { return false; } }

function browserCore(source, view) {
  let core = section(source, 'const DAY_MS', 'export function adaptSheetRows')
    + section(source, 'export function clipBlock', 'export function createDemo');
  if (view === 'internal') core += source.slice(source.indexOf('export function createDemo'));
  else {
    const start = core.indexOf('export const WORKSPACES');
    const end = core.indexOf('export function parseDay');
    core = core.slice(0, start) + `const WORKSPACES = ${JSON.stringify(WORKSPACES)};\n\n` + core.slice(end);
    const dates = section(core, 'export function getProjectDates', 'export function clipBlock');
    core = core.replace(dates, `function getProjectDates(project) {\n  const startDay = parseDay(project.start), endDay = parseDay(project.end);\n  return startDay !== null && endDay !== null && startDay <= endDay ? { start: project.start, end: project.end, startDay, endDay, basis: 'current' } : null;\n}\n\n`);
    core = core.replace("\n      || /修正.*(?:未定|待定)|(?:未定|待定).*修正|原期後持續修正/u.test(project.supplement || '')", '');
    core = core.replace(/^const rescheduled[^\n]*\n/m, '');
  }
  return removeExports(core);
}

function staticClient(source) {
  return source
    .replace('activeProject: null, loading: false', 'activeProject: null, loading: false, stale: false')
    .replace('const callGoogle = createGoogleBridge(APP_VIEW);', 'const callSchedule = createStaticBridge();')
    .replace("callGoogle('getTimeline')", "callSchedule('getTimeline')")
    .replace("timeZone: 'Asia/Taipei', month:", "timeZone: 'Asia/Taipei', year: 'numeric', month:")
    .replace("`${part('month')}/${part('day')} ${part('hour')}:${part('minute')}`", "`${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}（台北時間）`")
    .replace('state.payload = payload;', 'state.payload = payload;\n    state.stale = false;')
    .replace("notify(payload.warnings?.length ? payload.warnings.join('；') : '');", "notify(payload.projects.length ? '' : '目前尚無已公開排程；請聯繫團隊確認檔期。');")
    .replace("notify(APP_VIEW === 'public' ? '無法讀取公開排程，請稍後再試。' : error.message, true);\n    $('sync-status').textContent = '尚未讀取';", "state.stale = true;\n    notify(state.payload ? '無法重新讀取公開排程；目前顯示上次成功讀取的資料，請稍後再試。' : '無法讀取公開排程，請稍後再試。', true);\n    if (state.payload) render();\n    else $('sync-status').textContent = '尚未讀取公開排程';")
    .replace("$('sync-status').textContent = state.payload.syncedAt ? `已更新 · ${syncTimeLabel(state.payload.syncedAt)}` : '已讀取排程';", "$('sync-status').textContent = `${state.stale ? '讀取失敗 · 上次發布' : '最後發布'} · ${syncTimeLabel(state.payload.syncedAt)}`;")
    .replace("setInterval(() => { const current = taipeiToday(); if (current === today || state.payload?.preview) return; load(); }, 60000);", "setInterval(() => { const current = taipeiToday(); if (current === today) return; const followToday = state.start === today; today = current; if (followToday) state.start = today; if (state.payload) { state.payload.today = current; render(); } }, 60000);");
}

export async function buildGoogleUi({
  outputDir = resolve(root, 'google-app'),
  packageDir = resolve(root, 'local/google-app-bundle'),
  views = ['internal', 'public'],
  transport = 'google',
} = {}) {
  if (!['google', 'static'].includes(transport)
    || !Array.isArray(views) || !views.length || new Set(views).size !== views.length
    || views.some((view) => !['internal', 'public'].includes(view))) throw new Error('前端建置設定無效。');
  if (transport === 'static' && (views.length !== 1 || views[0] !== 'public' || packageDir)) {
    throw new Error('靜態網站僅能建置公開前端，不能包含 Apps Script 部署包。');
  }
  const [html, css, theme, app, core, contract, bridge, client, publicFeatures, internalFeatures] = await Promise.all([
    read('web/dist/index.html'), read('web/dist/styles.css'), read('web/dist/theme.mjs'), read('web/dist/app.mjs'),
    read('scripts/timeline-core.mjs'), read('google-app/ui/common-contract.mjs'), read('google-app/ui/bridge.mjs'), read('google-app/ui/client.mjs'),
    read('google-app/ui/public-features.mjs'), read('google-app/ui/internal-features.mjs'),
  ]);
  const metrics = section(app, 'function buildLayout', 'function makeCard')
    .replace('目前區間未排工作', transport === 'static' ? '目前區間無已公開排程' : '目前區間未排工作');
  const dateRange = section(app, 'function updateDateRange', 'function detailRow');
  const staticSources = transport === 'static'
    ? `${removeExports(section(await read('scripts/public-snapshot.mjs'), 'function exactKeys', 'export function snapshotFromFeedRows'))}\n${removeExports(await read('google-app/ui/static-bridge.mjs'))}`
    : '';
  await mkdir(outputDir, { recursive: true });
  const output = [];
  for (const view of views) {
    let modeContract = await read(`google-app/ui/${view}-contract.mjs`);
    if (transport === 'static') modeContract = modeContract.replace('goal: cleanText(project.goal, 300)', 'goal: cleanText(project.goal, 500)');
    let template = html;
    template = template.replace('<script src="/theme.mjs"></script>', () => `<script>${safeScript(theme)}</script>`)
      .replace('<link rel="stylesheet" href="/styles.css">', () => `<style>${css}\n.view-label { font-size: 12px; font-weight: 650; padding: 7px 11px; border: 1px solid var(--border); border-radius: 6px; color: var(--muted); background: var(--surface-raised); }\n</style>`)
      .replace(/<div class="segmented mode-switch"[\s\S]*?<\/div>/, `<span id="view-label" class="view-label">${view === 'public' ? '公開排程' : '團隊排程'}</span>`)
      .replace('以示意案件預覽版型，案件與工作區安排均非實際資料。', view === 'public' ? '選擇合適的時間後，聯繫團隊確認製作需求與預約。' : '點選案件查看資訊與安排工作區。')
      .replace('工作區安排保存在本機；專案日期與狀態以專案列表為準。', view === 'public' ? '檔期預留依團隊確認。' : '工作區安排存入專案資料；日期與狀態以專案列表為準。')
      .replace('同案可配置多個工作區；只儲存本機配置，不更改日期或狀態。', '同案可配置多個工作區；只更新工作區安排。');
    let uiClient = client;
    let uiBridge = bridge;
    let features;
    if (view === 'public') {
      template = template.replace(/<a id="source-link"[\s\S]*?<\/a>/, '')
        .replace(/<form id="assignment-form"[\s\S]*?<\/form>/, '')
        .replace(/<p id="demo-dialog-note"[\s\S]*?<\/p>/, '')
        .replace('搜尋案號、專案、製作項目', '搜尋專案或交付目標')
        .replace('aria-label="搜尋案號、專案、製作項目"', 'aria-label="搜尋專案或交付目標"');
      uiBridge = uiBridge.replace("view === 'internal' ? ['getTimeline', 'saveLayout'] : ['getTimeline']", "['getTimeline']")
        .replace('else runner.saveLayout(input);', '');
      uiClient = uiClient.replace("APP_VIEW === 'public' ? normalizePublicPayload : normalizeInternalPayload", 'normalizePublicPayload')
        .replace(section(uiClient, "  const source = $('source-link');", "  $('month-view')"), '');
      features = publicFeatures;
      if (transport === 'static') {
        uiBridge = staticSources;
        uiClient = staticClient(uiClient);
        template = template.replace('<title>PM Studio｜工作區排程</title>', '<title>PM Studio｜公開排程</title>')
          .replace('aria-label="重新讀取專案資料"', 'aria-label="重新讀取公開排程"')
          .replace('檔期預留依團隊確認。', '公開排程以團隊確認為準；空白時段不代表可預約。');
      }
    } else {
      template = template.replace('<button id="refresh"', '<button id="layout-demo" class="quiet-button">版型示意</button><button id="refresh"');
      uiClient = uiClient.replace("APP_VIEW === 'public' ? normalizePublicPayload : normalizeInternalPayload", 'normalizeInternalPayload')
        .replace('state.payload = payload;\n    notify', "state.payload = payload;\n    state.isIllustration = false;\n    $('layout-demo').textContent = '版型示意';\n    notify");
      const detail = section(app, 'function openProject', 'async function saveAssignment')
        .replace("$('assignment-form').hidden = state.mode === 'demo'; $('demo-dialog-note').hidden = state.mode !== 'demo';", "$('assignment-form').hidden = !state.payload.permissions.canEditLayout; $('demo-dialog-note').hidden = !state.payload.preview;");
      features = section(app, 'function matchProject', 'function preciseRange')
        + section(app, 'function makeCard', 'function renderPending') + detail + internalFeatures;
    }
    const script = `// Generated from PM Studio UI sources. No project records are embedded.\n(async () => {\nconst APP_VIEW = ${JSON.stringify(view)};\n${browserCore(core, view)}\n${removeExports(contract)}\n${removeExports(modeContract)}\n${removeExports(uiBridge)}\n${metrics}\n${dateRange}\n${uiClient}\n${features}\n})();`;
    template = template.replace('<script type="module" src="/app.mjs"></script>', () => `<script>${safeScript(script)}</script>`)
      .replace(/^[ \t]+$/gm, '');
    const filename = transport === 'static' ? 'index.html' : view === 'public' ? 'PublicIndex.html' : 'Index.html';
    await writeFile(resolve(outputDir, filename), template);
    output.push({ view, filename, html: template });
    if (packageDir) {
      const destination = resolve(packageDir, view);
      await mkdir(destination, { recursive: true });
      await writeFile(resolve(destination, filename), template);
      const sourceBackend = view === 'public' ? 'google-app/PublicCode.gs' : 'google-app/Code.gs';
      const sourceManifest = view === 'public' ? 'google-app/public-appsscript.json' : 'google-app/appsscript.json';
      if (await present(sourceBackend)) await copyFile(resolve(root, sourceBackend), resolve(destination, view === 'public' ? 'PublicCode.gs' : 'Code.gs'));
      if (await present(sourceManifest)) await copyFile(resolve(root, sourceManifest), resolve(destination, 'appsscript.json'));
    }
  }
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildGoogleUi();
  console.log(`Google UI 已建立：${result.map((item) => item.filename).join('、')}；本機部署包位於 local/google-app-bundle/。`);
}
