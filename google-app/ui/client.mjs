const DAY = 86_400_000;
const AXIS_HEIGHT = 76;
const CARD_HEIGHT = 170;
const CARD_GAP = 15;
const ROW_PADDING = 15;
const $ = (id) => document.getElementById(id);
let today = taipeiToday();
const state = { payload: null, zoom: 'month', pastExpanded: false, start: today, search: '', activeProject: null, loading: false };
const callGoogle = createGoogleBridge(APP_VIEW);
const normalizePayload = APP_VIEW === 'public' ? normalizePublicPayload : normalizeInternalPayload;
function dayWidth() { return state.zoom === 'month' ? Math.max(4, $('timeline-viewport').clientWidth / 205) : 36; }
function dayNumber(value) { return parseDay(value); }
function fromDay(value) { return formatDay(value); }
function addDays(value, days) { return fromDay(dayNumber(value) + days); }
function shortDate(value) { return value?.slice(5).replace('-', '/') ?? '未定'; }
function dateText(value) { return value || '未定'; }
function syncTimeLabel(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  try {
    const parts = new Intl.DateTimeFormat('zh-TW', {
      timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date);
    const part = (name) => parts.find((item) => item.type === name)?.value || '';
    return `${part('month')}/${part('day')} ${part('hour')}:${part('minute')}`;
  } catch { return String(value); }
}
function create(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function workspaces() { return state.payload?.workspaces || []; }
function overlaps(a, b) { return a.start <= b.end && b.start <= a.end; }
function workspaceUnits(project, space) { const value = project.workspaceUnits?.[space?.id]; return Number.isInteger(value) && value > 0 ? value : 1; }
function notify(message, error = false) { $('notification').textContent = message; $('notification').classList.toggle('error', error); $('notification').hidden = !message; }
function detailRow(label, value) { $('detail-content').append(create('div', 'detail-label', label), create('div', 'detail-value', value || '未填')); }

function updateThemeControl() {
  const dark = document.documentElement.dataset.theme !== 'light';
  $('theme-toggle').textContent = dark ? '切換亮色' : '切換暗色';
  $('theme-toggle').setAttribute('aria-label', dark ? '切換亮色' : '切換暗色');
  $('theme-toggle').setAttribute('aria-pressed', String(dark));
}

async function load() {
  if (state.loading) return;
  state.loading = true;
  $('refresh').disabled = true;
  $('sync-status').textContent = '正在讀取排程';
  try {
    const payload = normalizePayload(await callGoogle('getTimeline'));
    const followToday = state.start === today;
    if (dayNumber(payload.today) !== null) { today = payload.today; if (followToday) state.start = today; }
    state.payload = payload;
    notify(payload.warnings?.length ? payload.warnings.join('；') : '');
    render();
  } catch (error) {
    notify(APP_VIEW === 'public' ? '無法讀取公開排程，請稍後再試。' : error.message, true);
    $('sync-status').textContent = '尚未讀取';
  } finally { state.loading = false; $('refresh').disabled = false; }
}

function render() {
  if (!state.payload) return;
  $('view-label').textContent = state.payload.preview ? '本機示意預覽' : APP_VIEW === 'public' ? '公開排程' : '團隊排程';
  $('mode-description').textContent = state.payload.preview ? '此畫面使用虛構案件，不代表實際檔期。' : APP_VIEW === 'public' ? '選擇合適的時間後，聯繫團隊確認製作需求與預約。' : '每個方塊代表一段工作；點選案件查看資訊與安排工作區。';
  $('sync-status').textContent = state.payload.syncedAt ? `已更新 · ${syncTimeLabel(state.payload.syncedAt)}` : '已讀取排程';
  const source = $('source-link');
  if (source) { source.hidden = !state.payload.sourceUrl; if (state.payload.sourceUrl) source.href = state.payload.sourceUrl; }
  $('month-view').setAttribute('aria-pressed', String(state.zoom === 'month'));
  $('week-view').setAttribute('aria-pressed', String(state.zoom === 'week'));
  $('past-toggle').setAttribute('aria-pressed', String(state.pastExpanded));
  $('past-toggle').textContent = state.pastExpanded ? '收合過去日期' : '展開過去日期';
  renderTimeline();
  renderPending();
}

function renderPending() {
  const projects = state.payload.projects.filter(matchProject);
  const plan = planBlocks(projects, workspaces());
  const reasons = new Map();
  for (const item of [...plan.pending, ...plan.unassigned]) { if (!reasons.has(item.projectId)) reasons.set(item.projectId, new Set()); reasons.get(item.projectId).add(item.reason); }
  const pending = projects.filter((project) => reasons.has(project.id)).sort((a, b) => (dayNumber(a.start) ?? Infinity) - (dayNumber(b.start) ?? Infinity) || a.id.localeCompare(b.id));
  $('pending-section').hidden = !pending.length;
  $('pending-count').textContent = `${pending.length} 案`;
  const wrapper = $('pending-projects'); wrapper.replaceChildren();
  for (const project of pending) {
    const card = create('button', 'pending-card'); card.type = 'button';
    card.append(create('span', 'pending-heading', APP_VIEW === 'public' ? project.alias : `${project.id} · ${project.name || '未命名專案'}`), create('span', 'pending-goal', project.goal || '製作排程'));
    card.append(create('span', 'pending-meta', `${dateText(project.start)} → ${dateText(project.end)} · ${[...reasons.get(project.id)].join('；')}`));
    card.addEventListener('click', () => openProject(project)); wrapper.append(card);
  }
}

$('theme-toggle').addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('pm-studio-theme', theme); } catch { /* The view still switches when preferences cannot be stored. */ }
  updateThemeControl();
});
updateThemeControl();
$('refresh').addEventListener('click', load);
$('month-view').addEventListener('click', () => { state.zoom = 'month'; render(); });
$('week-view').addEventListener('click', () => { state.zoom = 'week'; render(); });
$('past-toggle').addEventListener('click', () => { state.pastExpanded = !state.pastExpanded; state.start = state.pastExpanded ? addDays(today, -35) : today; render(); });
$('today-button').addEventListener('click', () => { state.start = state.pastExpanded ? addDays(today, -14) : today; render(); });
function shift(days) { state.start = addDays(state.start, days); if (dayNumber(state.start) < dayNumber(today)) state.pastExpanded = true; render(); }
$('previous').addEventListener('click', () => shift(state.zoom === 'month' ? -28 : -14));
$('next').addEventListener('click', () => shift(state.zoom === 'month' ? 28 : 14));
$('search').addEventListener('input', (event) => { state.search = event.target.value.trim(); if (state.payload) { renderTimeline(); renderPending(); } });
$('timeline-viewport').addEventListener('scroll', () => { if (state.payload) updateDateRange(); }, { passive: true });
$('timeline-viewport').addEventListener('keydown', (event) => { if (event.key === 'Home') { event.preventDefault(); $('today-button').click(); } });
let resizeFrame;
new ResizeObserver(() => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(() => { if (!state.payload) return; if (Math.abs((state.renderedDayWidth || 0) - dayWidth()) > .01) renderTimeline(true); else updateDateRange(); }); }).observe($('timeline-viewport'));
$('close-dialog').addEventListener('click', () => $('project-dialog').close());
$('project-dialog').addEventListener('click', (event) => { if (event.target !== $('project-dialog')) return; const rect = $('project-dialog').getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('project-dialog').close(); });

await load();
setInterval(() => { const current = taipeiToday(); if (current === today || state.payload?.preview) return; load(); }, 60000);
