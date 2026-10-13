import { planBlocks, getProjectDates } from '/timeline-core.mjs';
import { t, workspaceDescription, unitText, weekdayText } from '/localization.mjs';

const DAY = 86_400_000;
const AXIS_HEIGHT = 76;
const CARD_HEIGHT = 170;
const CARD_GAP = 15;
const ROW_PADDING = 15;
const $ = (id) => document.getElementById(id);
let today = taipeiDate();
const state = { mode: 'demo', payload: null, livePayload: null, zoom: 'month', pastExpanded: false, start: today, search: '', activeProject: null, loading: false };
function dayWidth() { return state.zoom === 'month' ? Math.max(4, $('timeline-viewport').clientWidth / 205) : 36; }
function updateThemeControl() {
  const dark = document.documentElement.dataset.theme !== 'light';
  $('theme-toggle').textContent = dark ? '切換亮色' : '切換暗色';
  $('theme-toggle').setAttribute('aria-label', dark ? '切換亮色' : '切換暗色');
  $('theme-toggle').setAttribute('aria-pressed', String(dark));
}

function taipeiDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const value = (name) => parts.find((part) => part.type === name).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
function dayNumber(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return null;
  const n = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(n) || new Date(n).toISOString().slice(0, 10) !== value) return null;
  return n / DAY;
}
function fromDay(n) { return new Date(n * DAY).toISOString().slice(0, 10); }
function addDays(value, n) { return fromDay(dayNumber(value) + n); }
function shortDate(value) { return value?.slice(5).replace('-', '/') ?? '未定'; }
function dateText(value) { return value || '未定'; }
function create(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function notify(message, error = false) { $('notification').textContent = message; $('notification').classList.toggle('error', error); $('notification').hidden = !message; }
function matchProject(project) { const query = state.search.toLocaleLowerCase(); return !query || [project.id, project.name, project.goal, project.requirements, project.customer, project.owner].some((value) => String(value ?? '').toLocaleLowerCase().includes(query)); }
function preciseRange(project) { const range = getProjectDates(project); return range ? { start: range.startDay, end: range.endDay } : null; }
function workspaces() { return state.payload?.workspaces?.length ? state.payload.workspaces : ['A', 'B', 'C', 'D'].map((id) => ({ id, name: `工作區 ${id}` })); }
function assignedIndexes(project, spaces) { const indexes = (project.workspaceIds ?? []).map((id) => spaces.findIndex((space) => space.id === id)); return indexes.some((index) => index < 0) ? [] : indexes.sort((a, b) => a - b); }
function overlaps(a, b) { return a.start <= b.end && b.start <= a.end; }
function workspaceUnits(project, space) { const units = project.workspaceUnits?.[space.id]; return Number.isInteger(units) && units > 0 ? units : 1; }

async function getPayload(path) {
  const response = await fetch(path, { cache: 'no-store' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `讀取失敗（${response.status}）`);
  if (!Array.isArray(result.projects)) throw new Error('沒有取得完整專案資料。');
  return result;
}
async function load(mode = state.mode, refresh = false) {
  if (state.loading) return;
  state.loading = true;
  $('refresh').disabled = true;
  $('sync-status').textContent = mode === 'demo' ? '讀取示意排程' : '讀取最新專案資料';
  try {
    const payload = mode === 'live' && state.livePayload && !refresh ? state.livePayload : await getPayload(mode === 'demo' ? '/api/demo' : '/api/projects');
    if (mode === 'live') state.livePayload = payload;
    state.payload = payload;
    state.mode = mode;
    state.activeProject = null;
    notify(payload.warnings?.length ? payload.warnings.join('；') : '');
    render();
  } catch (error) {
    notify(`${error.message} 請確認本機預覽服務正在執行。`, true);
    $('sync-status').textContent = '讀取失敗';
  } finally { state.loading = false; $('refresh').disabled = false; }
}

function render() {
  if (!state.payload) return;
  $('demo-mode').setAttribute('aria-pressed', String(state.mode === 'demo'));
  $('live-mode').setAttribute('aria-pressed', String(state.mode === 'live'));
  const liveCount = state.livePayload?.projects.length;
  $('live-mode').textContent = liveCount === undefined ? '專案列表' : `專案列表（${liveCount}案）`;
  $('mode-description').textContent = state.mode === 'demo' ? '以示意案件預覽版型，案件與工作區安排均非實際資料。' : '真實專案資料；尚未指定工作區的案件列於「待安排」。';
  $('sync-status').textContent = state.mode === 'demo' ? '示意資料' : state.payload.syncedAt ? `已讀取 · ${state.payload.syncedAt}` : '已讀取專案列表';
  const sourceUrl = state.mode === 'live' ? state.payload.sourceUrl : state.livePayload?.sourceUrl;
  $('source-link').hidden = !sourceUrl;
  if (sourceUrl && /^https:\/\//.test(sourceUrl)) $('source-link').href = sourceUrl;
  $('month-view').setAttribute('aria-pressed', String(state.zoom === 'month'));
  $('week-view').setAttribute('aria-pressed', String(state.zoom === 'week'));
  $('past-toggle').setAttribute('aria-pressed', String(state.pastExpanded));
  $('past-toggle').textContent = state.pastExpanded ? '收合過去日期' : '展開過去日期';
  renderTimeline();
  renderPending();
}

function buildLayout(projects, spaces) {
  const plan = planBlocks(projects, spaces);
  const byId = new Map(projects.map((project) => [project.id, project]));
  const rows = spaces.map((space) => ({ ...space, lanes: [], overlaps: false, height: CARD_HEIGHT + ROW_PADDING * 2 }));
  const rawItems = plan.blocks.map((block) => ({ project: byId.get(block.projectId), range: { start: block.startDay, end: block.endDay }, indexes: block.workspaceIds.map((id) => spaces.findIndex((space) => space.id === id)), lane: 0, phase: block.phase, key: block.key }));
  const items = rawItems.flatMap((item) => {
    const sharedRange = item.indexes.length > 1 && rawItems.some((other) => other !== item && overlaps(other.range, item.range) && other.indexes.some((index) => item.indexes.includes(index)));
    if (sharedRange) return item.indexes.map((index) => ({ ...item, indexes: [index], splitCross: true, key: `${item.key}:${spaces[index].id}` }));
    return [{ ...item, splitCross: (item.project.workspaceIds ?? []).length > item.indexes.length }];
  });
  const placed = [];
  for (const item of items) {
    let lane = 0;
    const sameCase = placed.find((other) => other.project.id === item.project.id && overlaps(other.range, item.range) && item.indexes.every((index) => other.indexes.includes(index)));
    if (sameCase) { lane = sameCase.lane; item.attached = item.phase === 'correction'; }
    else while (item.indexes.some((index) => Array.from({ length: workspaceUnits(item.project, rows[index]) }, (_, unit) => rows[index].lanes[lane + unit]).some((ranges) => ranges?.some((range) => overlaps(range, item.range))))) lane++;
    item.lane = lane;
    for (const index of item.indexes) {
      for (let unit = 0; unit < workspaceUnits(item.project, rows[index]); unit++) (rows[index].lanes[lane + unit] ??= []).push(item.range);
    }
    placed.push(item);
  }
  for (const item of items) if (item.phase === 'correction' && items.some((other) => other.phase === 'production' && other.project.id === item.project.id && other.lane === item.lane && overlaps(other.range, item.range) && item.indexes.every((index) => other.indexes.includes(index)))) item.attached = true;
  let top = AXIS_HEIGHT;
  for (const row of rows) { row.overlaps = plan.overloads.some((item) => item.workspaceId === row.id); row.height = Math.max(Number.isFinite(row.usualLoad) ? row.usualLoad : Number.isFinite(row.capacity) ? row.capacity : 1, row.lanes.length) * (CARD_HEIGHT + CARD_GAP) - CARD_GAP + ROW_PADDING * 2; row.top = top; top += row.height; }
  return { rows, items, height: top };
}

function renderTimeline(preserveScroll = false) {
  const spaces = workspaces();
  const visibleProjects = state.payload.projects.filter(matchProject);
  const { rows, items, height } = buildLayout(visibleProjects, spaces);
  const pixelsPerDay = dayWidth();
  const previousOffsetDays = preserveScroll && state.renderedDayWidth ? $('timeline-viewport').scrollLeft / state.renderedDayWidth : 0;
  const rangeDays = state.zoom === 'month' ? 240 : 120;
  const startDay = dayNumber(state.start);
  const endDay = startDay + rangeDays - 1;
  const width = pixelsPerDay * rangeDays;
  const canvas = $('timeline-canvas');
  canvas.replaceChildren(); canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
  const labels = $('workspace-labels');
  labels.replaceChildren(create('div', 'label-axis', t('workspace')));
  for (const row of rows) {
    const label = create('div', 'workspace-label'); label.style.height = `${row.height}px`;
    label.append(create('span', 'workspace-name', t('workspace')), create('strong', '', row.id));
    if (row.name && row.name !== `工作區 ${row.id}`) label.append(create('span', 'workspace-name', workspaceDescription(row)));
    if (Number.isFinite(row.usualLoad)) label.append(create('span', 'capacity-note', t('usualLoad', { count: row.usualLoad, unit: unitText(row, row.usualLoad) })));
    else if (row.id === 'C') label.append(create('span', 'capacity-note', t('flexibleCapacity')));
    else if (Number.isFinite(row.capacity)) label.append(create('span', 'capacity-note', t('maxCapacity', { count: row.capacity, unit: unitText(row, row.capacity) })));
    if (row.overlaps) label.append(create('span', 'overlap-note', t('overload')));
    labels.append(label);
    const rule = create('div', 'workspace-rule'); rule.style.top = `${row.top + row.height}px`; canvas.append(rule);
    if (!items.some((item) => item.indexes.includes(rows.indexOf(row)) && item.range.start <= endDay && item.range.end >= startDay)) { const empty = create('span', 'empty-row-label', t('emptyRange')); empty.style.top = `${row.top + row.height / 2 - 8}px`; canvas.append(empty); }
  }
  const axis = create('div', 'time-axis');
  let lastMonthLabelX = -Infinity;
  let lastDayLabelX = -Infinity;
  for (let index = 0; index < rangeDays; index++) {
    const date = new Date((startDay + index) * DAY);
    const weekday = date.getUTCDay(); const monthStart = date.getUTCDate() === 1;
    const x = index * pixelsPerDay;
    if (weekday === 0 || weekday === 6) { const shade = create('div', 'weekend-shade'); shade.style.left = `${x}px`; shade.style.width = `${pixelsPerDay}px`; canvas.append(shade); }
    if (monthStart || index === 0 || state.zoom === 'week' || weekday === 1) { const line = create('div', `grid-line${monthStart ? ' major-line' : ''}`); line.style.left = `${x}px`; canvas.append(line); }
    if ((monthStart || index === 0) && x - lastMonthLabelX >= 90) { const month = create('span', 'month-label', `${date.getUTCFullYear()} / ${String(date.getUTCMonth() + 1).padStart(2, '0')}`); month.style.left = `${x}px`; axis.append(month); lastMonthLabelX = x; }
    if ((state.zoom === 'week' || weekday === 1 || index === 0) && x - lastDayLabelX >= (state.zoom === 'week' ? 32 : 39)) { const text = state.zoom === 'week' ? `${date.getUTCDate()} ${weekdayText(weekday)}` : `${date.getUTCMonth() + 1}/${date.getUTCDate()}`; const tick = create('span', `day-label${weekday === 0 || weekday === 6 ? ' weekend-label' : ''}`, text); tick.style.left = `${x}px`; axis.append(tick); lastDayLabelX = x; }
  }
  canvas.append(axis);
  const visibleCases = new Set();
  for (const item of items) {
    if (item.range.end < startDay || item.range.start > endDay) continue;
    visibleCases.add(item.project.id);
    const first = rows[item.indexes[0]], last = rows[item.indexes.at(-1)];
    const cardTop = first.top + ROW_PADDING + item.lane * (CARD_HEIGHT + CARD_GAP);
    const lastUnits = workspaceUnits(item.project, last);
    const cardHeight = Math.max(CARD_HEIGHT, last.top + ROW_PADDING + (item.lane + lastUnits) * (CARD_HEIGHT + CARD_GAP) - CARD_GAP - cardTop);
    const x = Math.max(item.range.start, startDay) - startDay;
    const cardWidth = (Math.min(item.range.end, endDay) - Math.max(item.range.start, startDay) + 1) * pixelsPerDay - 8;
    const card = makeCard(item.project, item.indexes.length > 1, cardWidth, item.phase, item.attached, item.indexes.map((index) => spaces[index].id), item.splitCross);
    Object.assign(card.style, { left: `${x * pixelsPerDay + 4}px`, top: `${item.attached ? cardTop + cardHeight - 45 : cardTop}px`, width: `${Math.max(17, cardWidth)}px`, height: `${item.attached ? 41 : cardHeight}px` });
    if (item.range.start < startDay) { const heading = card.querySelector('.card-heading'); heading.textContent = `← ${heading.textContent}`; card.title = t('startDate', { date: fromDay(item.range.start) }); }
    canvas.append(card);
  }
  const todayDay = dayNumber(today);
  if (todayDay >= startDay && todayDay <= endDay) { const line = create('div', 'today-line'); line.style.left = `${(todayDay - startDay) * pixelsPerDay + 1}px`; line.append(create('span', 'today-label', t('todayDate', { date: shortDate(today) }))); canvas.append(line); }
  $('visible-count').textContent = t('visibleCount', { count: visibleCases.size }) + (rows.some((row) => row.overlaps) ? t('visibleOverload') : '');
  state.renderedDayWidth = pixelsPerDay;
  $('timeline-viewport').scrollLeft = previousOffsetDays * pixelsPerDay;
  updateDateRange();
}

function makeCard(project, cross, width, phase = 'production', attached = false, segmentIds = [], splitCross = false) {
  const card = create('button', `project-card${cross ? ' cross-workspace' : ''}${width < 180 || attached ? ' short-card' : ''}${phase === 'correction' ? ' correction-card' : ''}${splitCross ? ' same-case-segment' : ''}`); card.type = 'button';
  const start = phase === 'correction' ? project.correctionStart : project.start, end = phase === 'correction' ? project.correctionEnd : project.end;
  const renderIds = segmentIds.length ? segmentIds : project.workspaceIds ?? [];
  card.setAttribute('aria-label', `${project.id} ${project.name || ''}，${phase === 'correction' ? '追加修正' : project.goal || '製作項目未填'}，${dateText(start)} 至 ${dateText(end)}，工作區 ${renderIds.join('、')}${splitCross ? `，同案跨區 ${(project.workspaceIds ?? []).join('、')}` : ''}`);
  card.append(create('span', 'card-heading', `${project.id} · ${phase === 'correction' ? '追加修正' : project.name || '未命名專案'}`));
  if (!attached) card.append(create('span', 'card-goal', project.requirements || project.goal || '製作項目未填'), create('span', 'card-customer', project.customer || '客戶未填'));
  const spaces = workspaces();
  const areaText = renderIds.map((id) => { const space = spaces.find((item) => item.id === id); return `${id}（${workspaceUnits(project, space || { id })} ${space?.unit || '項目'}）`; }).join(' ＋ ');
  if (!attached) card.append(create('span', 'cross-label', splitCross ? `同案跨區 ${(project.workspaceIds ?? []).join(' ＋ ')} · 本段 ${areaText}` : `工作區 ${areaText}`));
  const bottom = create('span', 'card-bottom'); bottom.append(create('span', 'card-dates', `${dateText(start)} → ${dateText(end)}`)); if (project.status) bottom.append(create('span', 'card-status', project.status)); if (!attached) card.append(bottom);
  card.addEventListener('click', () => openProject(project)); return card;
}

function renderPending() {
  const spaces = workspaces();
  const projects = state.payload.projects.filter(matchProject);
  const plan = planBlocks(projects, spaces);
  const reasons = new Map();
  for (const item of [...plan.pending, ...plan.unassigned]) { if (!reasons.has(item.projectId)) reasons.set(item.projectId, new Set()); reasons.get(item.projectId).add(item.reason); }
  const pending = projects.filter((project) => reasons.has(project.id)).sort((a, b) => (dayNumber(a.start) ?? Infinity) - (dayNumber(b.start) ?? Infinity) || a.id.localeCompare(b.id));
  $('pending-section').hidden = !pending.length;
  $('pending-count').textContent = `${pending.length} 案`;
  const wrapper = $('pending-projects'); wrapper.replaceChildren();
  for (const project of pending) {
    const card = create('button', 'pending-card'); card.type = 'button';
    card.append(create('span', 'pending-heading', `${project.id} · ${project.name || '未命名專案'}`), create('span', 'pending-goal', project.goal || project.requirements || '目前交付目標未填'));
    const reason = [...reasons.get(project.id)].join('；');
    card.append(create('span', 'pending-meta', `${dateText(project.start)} → ${dateText(project.end)} · ${reason}`));
    card.addEventListener('click', () => openProject(project)); wrapper.append(card);
  }
}

function updateDateRange() {
  const viewport = $('timeline-viewport');
  const width = state.renderedDayWidth || dayWidth();
  const first = dayNumber(state.start) + Math.floor(viewport.scrollLeft / width);
  const last = first + Math.max(1, Math.floor(viewport.clientWidth / width)) - 1;
  const left = fromDay(first), right = fromDay(last);
  $('date-range').textContent = `${left.replaceAll('-', '/')} — ${right.replaceAll('-', '/')}`;
}

function detailRow(label, value) { const content = $('detail-content'); content.append(create('div', 'detail-label', label), create('div', 'detail-value', value || '未填')); }
function openProject(project) {
  state.activeProject = project;
  $('detail-id').textContent = project.id;
  $('detail-title').textContent = project.name || '未命名專案';
  $('detail-content').replaceChildren();
  detailRow('交付目標', project.goal); detailRow('製作項目', project.requirements); detailRow('客戶', project.customer); detailRow('負責人', project.owner); detailRow('狀態', project.status);
  $('detail-content').append(create('div', 'detail-divider'));
  detailRow('目前排程', `${dateText(project.start)} → ${dateText(project.end)}`);
  if (project.dateBasis) detailRow('日期依據', project.dateBasis === 'original' ? '原始起訖' : project.dateBasis === 'current' ? '目前排程起訖' : project.dateBasis === 'demo' ? '示意日期' : project.dateBasis);
  if (project.originalStart || project.originalEnd) detailRow('原始起訖', `${dateText(project.originalStart)} → ${dateText(project.originalEnd)}`);
  if (project.correctionStart || project.correctionEnd) detailRow('追加修正', `${dateText(project.correctionStart)} → ${dateText(project.correctionEnd)}`);
  if (project.supplement) detailRow('排程補充', project.supplement);
  detailRow('工作區', (project.workspaceIds ?? []).length ? project.workspaceIds.map((id) => { const space = workspaces().find((item) => item.id === id); return `${id}（${workspaceUnits(project, space || { id })} ${space?.unit || '項目'}）`; }).join(' ＋ ') : '尚未指定');
  const options = $('workspace-options'); options.replaceChildren();
  for (const space of workspaces()) {
    const option = create('div', 'workspace-option'); const choice = create('label', 'workspace-choice'); const input = create('input'); input.type = 'checkbox'; input.name = 'workspace'; input.value = space.id; input.dataset.workspace = space.id; input.checked = (project.workspaceIds ?? []).includes(space.id); choice.append(input, create('span', '', space.name || `工作區 ${space.id}`));
    const unitsLabel = create('label', 'units-control'); const count = create('input', 'units-input'); count.type = 'number'; count.min = '1'; count.max = '1000'; count.step = '1'; count.required = true; count.dataset.workspaceUnits = space.id; count.setAttribute('aria-label', `工作區 ${space.id} 使用${space.unit || '項目'}數`); count.value = String(workspaceUnits(project, space)); count.disabled = !input.checked;
    count.addEventListener('input', () => { count.setCustomValidity(''); });
    count.addEventListener('invalid', () => { count.setCustomValidity(count.validity.rangeOverflow ? '使用數量過大，請確認安排。' : '使用數量請填入正整數。'); });
    input.addEventListener('change', () => { count.disabled = !input.checked; count.setCustomValidity(''); });
    unitsLabel.append(count, create('span', '', space.unit || '項目')); option.append(choice, unitsLabel); options.append(option);
  }
  $('assignment-form').hidden = state.mode === 'demo'; $('demo-dialog-note').hidden = state.mode !== 'demo'; $('assignment-error').hidden = true;
  $('project-dialog').showModal();
}

function readWorkspaceAllocations(ids) {
  return Object.fromEntries(ids.map((id) => {
    const input = $('workspace-options').querySelector(`input[data-workspace-units="${id}"]`);
    const units = Number(input?.value);
    if (!Number.isInteger(units) || units < 1) throw new Error(`工作區 ${id} 使用數量請填入正整數。`);
    if (units > 1000) throw new Error(`工作區 ${id} 使用數量過大，請確認安排。`);
    return [id, units];
  }));
}

async function saveAssignment(ids) {
  const project = state.activeProject;
  if (!project || state.mode !== 'live') return;
  const assignments = Object.fromEntries(state.payload.projects.map((item) => [item.id, item.id === project.id ? ids : item.workspaceIds ?? []]));
  let activeAllocation;
  try { activeAllocation = readWorkspaceAllocations(ids); }
  catch (error) { $('assignment-error').textContent = error.message; $('assignment-error').hidden = false; return; }
  const allocations = Object.fromEntries(state.payload.projects.map((item) => [item.id, item.id === project.id ? activeAllocation : item.workspaceUnits ?? Object.fromEntries((item.workspaceIds ?? []).map((id) => [id, 1]))]));
  $('save-assignment').disabled = true; $('clear-assignment').disabled = true;
  try {
    const response = await fetch('/api/layout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assignments, allocations }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '工作區配置沒有儲存成功。');
    $('project-dialog').close();
    await load('live', true);
    notify(ids.length ? `${project.id} 已安排至工作區 ${ids.join(' ＋ ')}；專案日期與狀態未變更。` : `${project.id} 已移回待安排；專案日期與狀態未變更。`);
  } catch (error) { $('assignment-error').textContent = error.message; $('assignment-error').hidden = false; }
  finally { $('save-assignment').disabled = false; $('clear-assignment').disabled = false; }
}

$('theme-toggle').addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('pm-studio-theme', theme); } catch { /* Switching works without saved preferences. */ }
  updateThemeControl();
});
updateThemeControl();
$('demo-mode').addEventListener('click', () => load('demo'));
$('live-mode').addEventListener('click', () => load('live'));
$('refresh').addEventListener('click', () => load(state.mode, true));
$('month-view').addEventListener('click', () => { state.zoom = 'month'; render(); });
$('week-view').addEventListener('click', () => { state.zoom = 'week'; render(); });
$('past-toggle').addEventListener('click', () => { state.pastExpanded = !state.pastExpanded; state.start = state.pastExpanded ? addDays(today, -35) : today; render(); });
$('today-button').addEventListener('click', () => { state.start = state.pastExpanded ? addDays(today, -14) : today; render(); });
function shift(n) { state.start = addDays(state.start, n); if (dayNumber(state.start) < dayNumber(today)) state.pastExpanded = true; render(); }
$('previous').addEventListener('click', () => shift(state.zoom === 'month' ? -28 : -14));
$('next').addEventListener('click', () => shift(state.zoom === 'month' ? 28 : 14));
$('search').addEventListener('input', (event) => { state.search = event.target.value.trim(); renderTimeline(); renderPending(); });
$('timeline-viewport').addEventListener('scroll', updateDateRange, { passive: true });
$('timeline-viewport').addEventListener('keydown', (event) => { if (event.key === 'Home') { event.preventDefault(); $('today-button').click(); } });
let resizeFrame;
new ResizeObserver(() => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(() => { if (state.payload && Math.abs((state.renderedDayWidth || 0) - dayWidth()) > .01) renderTimeline(true); else updateDateRange(); }); }).observe($('timeline-viewport'));
$('close-dialog').addEventListener('click', () => $('project-dialog').close());
$('project-dialog').addEventListener('click', (event) => { if (event.target === $('project-dialog')) { const rect = $('project-dialog').getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('project-dialog').close(); } });
$('assignment-form').addEventListener('submit', (event) => { event.preventDefault(); saveAssignment([...$('workspace-options').querySelectorAll('input[data-workspace]:checked')].map((input) => input.dataset.workspace)); });
$('clear-assignment').addEventListener('click', () => saveAssignment([]));

await load('demo');
getPayload('/api/projects').then((payload) => { state.livePayload = payload; $('live-mode').textContent = `專案列表（${payload.projects.length}案）`; if (payload.sourceUrl && /^https:\/\//.test(payload.sourceUrl)) { $('source-link').href = payload.sourceUrl; $('source-link').hidden = false; } }).catch(() => {});
setInterval(() => {
  const current = taipeiDate();
  if (current === today) return;
  const followToday = state.start === today;
  today = current;
  if (followToday) state.start = today;
  load(state.mode, true);
}, 60000);
