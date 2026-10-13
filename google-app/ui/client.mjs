const DAY = 86_400_000;
const AXIS_HEIGHT = 76;
const CARD_HEIGHT = 170;
const CARD_GAP = 15;
const ROW_PADDING = 15;
const $ = (id) => document.getElementById(id);
let today = taipeiToday();
const state = { payload: null, zoom: 'month', pastExpanded: false, start: today, search: '', activeProject: null, loading: false, stale: false, noticeKey: null, noticeError: false };
const callGoogle = createGoogleBridge(APP_VIEW);
const normalizePayload = APP_VIEW === 'public' ? normalizePublicPayload : normalizeInternalPayload;
function dayWidth() { return state.zoom === 'month' ? Math.max(4, $('timeline-viewport').clientWidth / 205) : 36; }
function dayNumber(value) { return parseDay(value); }
function fromDay(value) { return formatDay(value); }
function addDays(value, days) { return fromDay(dayNumber(value) + days); }
function shortDate(value) { return value?.slice(5).replace('-', '/') ?? t('unspecified'); }
function dateText(value) { return value || t('unspecified'); }
function syncTimeLabel(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  try {
    const parts = new Intl.DateTimeFormat('zh-TW', {
      timeZone: 'Asia/Taipei', ...(APP_TRANSPORT === 'static' ? { year: 'numeric' } : {}), month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date);
    const part = (name) => parts.find((item) => item.type === name)?.value || '';
    return APP_TRANSPORT === 'static' ? `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}（${t('taipeiTime')}）` : `${part('month')}/${part('day')} ${part('hour')}:${part('minute')}`;
  } catch { return String(value); }
}
function create(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function workspaces() { return state.payload?.workspaces || []; }
function overlaps(a, b) { return a.start <= b.end && b.start <= a.end; }
function workspaceUnits(project, space) { const value = project.workspaceUnits?.[space?.id]; return Number.isInteger(value) && value > 0 ? value : 1; }
function notify(message, error = false) { state.noticeKey = null; $('notification').textContent = message; $('notification').classList.toggle('error', error); $('notification').hidden = !message; }
function notifyLocalized(key, error = false) { notify(t(key), error); state.noticeKey = key; state.noticeError = error; }
function detailRow(label, value) { $('detail-content').append(create('div', 'detail-label', label), create('div', 'detail-value', value || t('missing'))); }

function updateThemeControl() {
  const dark = document.documentElement.dataset.theme !== 'light';
  $('theme-toggle').textContent = t(dark ? 'lightMode' : 'darkMode');
  $('theme-toggle').setAttribute('aria-label', t(dark ? 'lightMode' : 'darkMode'));
  $('theme-toggle').setAttribute('aria-pressed', String(dark));
}

function renderSyncStatus() {
  if (state.loading) { $('sync-status').textContent = t('loading'); return; }
  if (!state.payload) { $('sync-status').textContent = t(state.stale && APP_VIEW === 'public' ? 'notLoadedPublic' : state.stale ? 'notLoaded' : 'loading'); return; }
  $('sync-status').textContent = APP_TRANSPORT === 'static'
    ? `${t(state.stale ? 'previousPublished' : 'lastPublished')} · ${syncTimeLabel(state.payload.syncedAt)}`
    : state.stale ? t('notLoaded') : state.payload.syncedAt ? `${t('updated')} · ${syncTimeLabel(state.payload.syncedAt)}` : t('loaded');
}

async function load() {
  if (state.loading) return;
  state.loading = true;
  $('refresh').disabled = true;
  renderSyncStatus();
  try {
    const payload = normalizePayload(await callGoogle('getTimeline'));
    const followToday = state.start === today;
    if (dayNumber(payload.today) !== null) { today = payload.today; if (followToday) state.start = today; }
    state.payload = payload;
    state.stale = false;
    state.loading = false;
    if (APP_TRANSPORT === 'static' && !payload.projects.length) notifyLocalized('noPublicProjects');
    else notify(payload.warnings?.length ? payload.warnings.join('；') : '');
    render();
  } catch (error) {
    state.stale = true;
    state.loading = false;
    if (APP_VIEW === 'public') notifyLocalized(state.payload ? 'publicReloadError' : 'publicLoadError', true);
    else notify(error.message, true);
    renderSyncStatus();
  } finally { state.loading = false; $('refresh').disabled = false; }
}

function render(preserveScroll = false) {
  if (!state.payload) return;
  $('view-label').textContent = t(state.payload.preview ? 'previewView' : APP_VIEW === 'public' ? 'publicView' : 'teamView');
  $('mode-description').textContent = t(state.payload.preview ? 'previewDescription' : APP_VIEW === 'public' ? 'publicDescription' : 'teamDescription');
  renderSyncStatus();
  const source = $('source-link');
  if (source) { source.hidden = !state.payload.sourceUrl; if (state.payload.sourceUrl) source.href = state.payload.sourceUrl; }
  $('month-view').setAttribute('aria-pressed', String(state.zoom === 'month'));
  $('week-view').setAttribute('aria-pressed', String(state.zoom === 'week'));
  $('past-toggle').setAttribute('aria-pressed', String(state.pastExpanded));
  $('past-toggle').textContent = t(state.pastExpanded ? 'collapsePast' : 'expandPast');
  renderTimeline(preserveScroll);
  renderPending();
}

function renderPending() {
  const projects = state.payload.projects.filter(matchProject);
  const plan = planBlocks(projects, workspaces());
  const reasons = new Map();
  for (const item of [...plan.pending, ...plan.unassigned]) { if (!reasons.has(item.projectId)) reasons.set(item.projectId, new Set()); reasons.get(item.projectId).add(item.reason); }
  const pending = projects.filter((project) => reasons.has(project.id)).sort((a, b) => (dayNumber(a.start) ?? Infinity) - (dayNumber(b.start) ?? Infinity) || a.id.localeCompare(b.id));
  $('pending-section').hidden = !pending.length;
  $('pending-count').textContent = t('projectCount', { count: pending.length });
  const wrapper = $('pending-projects'); wrapper.replaceChildren();
  for (const project of pending) {
    const card = create('button', 'pending-card'); card.type = 'button';
    card.append(create('span', 'pending-heading', APP_VIEW === 'public' ? project.alias : `${project.id} · ${project.name || t('unnamed')}`), create('span', 'pending-goal', project.goal || t('productionSchedule')));
    card.append(create('span', 'pending-meta', `${dateText(project.start)} → ${dateText(project.end)} · ${[...reasons.get(project.id)].map(pendingReasonText).join('；')}`));
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
initializeLanguage();
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
setInterval(() => {
  const current = taipeiToday();
  if (current === today || state.payload?.preview) return;
  if (APP_TRANSPORT !== 'static') { load(); return; }
  const followToday = state.start === today;
  today = current;
  if (followToday) state.start = today;
  if (state.payload) { state.payload.today = current; render(); }
}, 60000);
