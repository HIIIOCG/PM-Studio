const scheduleElement = (id) => document.getElementById(id);
const scheduleState = { payload: null, firstDay: null, loading: false, failed: false, layout: null };
const readSchedule = createGoogleBridge();
function scheduleNode(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function projectIdentity(project) { return project.customerCode ? scheduleText('customer', { code: project.customerCode }) : scheduleText('missingCustomer'); }
function rangeText(start, end) { return (start || scheduleText('unspecified')) + ' → ' + (end || scheduleText('unspecified')); }
function renderScheduleChrome() {
  document.documentElement.lang = getScheduleLanguage();
  document.title = 'PM Studio｜' + scheduleText('title');
  for (const [id, key] of Object.entries({ 'schedule-title': 'title', 'today-button': 'today', 'legend-production': 'production', 'legend-correction': 'correction', 'pending-title': 'pending', 'page-footer': 'footer', 'retry': 'retry', 'preview-note': 'preview' })) scheduleElement(id).textContent = scheduleText(key);
  scheduleElement('previous').setAttribute('aria-label', scheduleText('previous'));
  scheduleElement('next').setAttribute('aria-label', scheduleText('next'));
  scheduleElement('timeline-viewport').setAttribute('aria-label', scheduleText('timeline'));
  const language = scheduleElement('language-toggle');
  language.textContent = getScheduleLanguage() === 'en' ? '繁體中文' : 'English';
  language.setAttribute('lang', getScheduleLanguage() === 'en' ? 'zh-Hant' : 'en');
  language.setAttribute('aria-label', getScheduleLanguage() === 'en' ? '切換至繁體中文' : 'Switch to English');
  for (const id of ['previous', 'next', 'today-button']) scheduleElement(id).disabled = !scheduleState.payload;
  renderScheduleNotice();
}
function renderScheduleNotice() {
  const notice = scheduleElement('load-notice');
  let key = null;
  if (scheduleState.loading) key = 'loading';
  else if (scheduleState.failed) key = scheduleState.payload ? 'staleError' : 'loadError';
  else if (scheduleState.payload?.warnings.length) key = 'warning';
  else if (scheduleState.payload && !scheduleState.payload.projects.length) key = 'empty';
  notice.hidden = !key;
  notice.classList.toggle('error', scheduleState.failed && !scheduleState.loading);
  notice.classList.toggle('warning', key === 'warning');
  scheduleElement('load-message').textContent = key ? scheduleText(key) : '';
  scheduleElement('retry').hidden = !scheduleState.failed;
  scheduleElement('retry').disabled = scheduleState.loading;
  const payload = scheduleState.payload;
  scheduleElement('sync-status').textContent = payload ? scheduleText(scheduleState.failed ? 'stale' : 'loaded') + ' · ' + scheduleReadTime(payload.syncedAt) + ' (UTC+8)' : '';
}
function renderSchedulePending() {
  const projects = scheduleState.payload.projects.map((project) => ({ project, reasons: projectPendingReasons(project) })).filter((item) => item.reasons.length);
  scheduleElement('pending-section').hidden = !projects.length;
  scheduleElement('pending-count').textContent = String(projects.length);
  const target = scheduleElement('pending-projects');
  target.replaceChildren();
  for (const { project, reasons } of projects) {
    const card = scheduleNode('article', 'pending-card');
    const title = scheduleNode('div', 'card-heading');
    title.append(scheduleNode('span', 'card-id', project.id), scheduleNode('span', 'customer-code', projectIdentity(project)));
    card.append(title, scheduleNode('p', 'pending-reason', reasons.map((reason) => scheduleText(reason)).join(' · ')));
    card.append(scheduleNode('p', 'pending-dates', scheduleText('production') + ' ' + rangeText(project.start, project.end)));
    if (project.correctionStart || project.correctionEnd || reasons.includes('correction-dates')) card.append(scheduleNode('p', 'pending-dates', scheduleText('correction') + ' ' + rangeText(project.correctionStart, project.correctionEnd)));
    target.append(card);
  }
}
function renderScheduleTimeline(preserveScroll = false) {
  const viewport = scheduleElement('timeline-viewport');
  const savedScroll = preserveScroll ? viewport.scrollLeft : 0;
  const { payload, firstDay } = scheduleState;
  const layout = buildTimelineLayout(payload.projects, payload.workspaces, firstDay);
  scheduleState.layout = layout;
  scheduleElement('timeline-grid').hidden = false;
  const canvas = scheduleElement('timeline-canvas');
  canvas.replaceChildren();
  canvas.style.width = layout.width + 'px'; canvas.style.height = layout.height + 'px';
  const labels = scheduleElement('workspace-labels');
  labels.replaceChildren(scheduleNode('div', 'label-axis', scheduleText('workspace')));
  let monthStart = firstDay;
  for (let index = 0; index < TIMELINE_DAYS; index++) {
    const day = firstDay + index;
    const date = new Date(day * 86400000);
    const weekday = date.getUTCDay();
    const grid = scheduleNode('div', 'grid-day' + ([0, 6].includes(weekday) ? ' weekend' : '') + (weekday === 1 ? ' week-start' : ''));
    grid.style.left = index * TIMELINE_DAY_WIDTH + 'px'; grid.style.width = TIMELINE_DAY_WIDTH + 'px'; canvas.append(grid);
    if (weekday === 1 || date.getUTCDate() === 1) {
      const label = scheduleNode('span', 'day-label', String(date.getUTCDate()));
      label.style.left = index * TIMELINE_DAY_WIDTH + 'px'; label.style.width = TIMELINE_DAY_WIDTH + 'px'; canvas.append(label);
    }
    const nextDate = new Date((day + 1) * 86400000);
    if (nextDate.getUTCDate() === 1 || index === TIMELINE_DAYS - 1) {
      const month = scheduleNode('div', 'month-label', scheduleMonth(monthStart));
      month.style.left = (monthStart - firstDay) * TIMELINE_DAY_WIDTH + 'px';
      month.style.width = (day - monthStart + 1) * TIMELINE_DAY_WIDTH + 'px'; canvas.append(month);
      monthStart = day + 1;
    }
  }
  for (const row of layout.rows) {
    const label = scheduleNode('div', 'workspace-label'); label.style.height = row.height + 'px';
    label.append(scheduleNode('span', 'workspace-letter', row.workspace.id), scheduleNode('span', 'workspace-description', workspaceText(row.workspace.id))); labels.append(label);
    const rule = scheduleNode('div', 'row-rule'); rule.style.top = row.top + row.height + 'px'; canvas.append(rule);
    if (!row.blocks.length) { const empty = scheduleNode('span', 'empty-row', scheduleText('noWork')); empty.style.top = row.top + 43 + 'px'; canvas.append(empty); }
    for (const block of row.blocks) {
      const project = block.project;
      const card = scheduleNode('article', 'project-card' + (block.phase === 'correction' ? ' correction' : ''));
      card.style.left = block.left + 'px'; card.style.top = block.top + 'px'; card.style.width = block.width + 'px';
      card.setAttribute('tabindex', '0');
      const identity = project.id + ' · ' + projectIdentity(project);
      const details = identity + ' · ' + scheduleText(block.phase) + ' · ' + rangeText(block.start, block.end) + ' · ' + scheduleText('workspace') + ' ' + project.workspaceIds.join(' + ');
      card.setAttribute('aria-label', details); card.setAttribute('title', details);
      const heading = scheduleNode('div', 'card-heading'); heading.append(scheduleNode('span', 'card-id', project.id), scheduleNode('span', 'customer-code', projectIdentity(project)));
      card.append(heading, scheduleNode('span', 'card-dates', rangeText(block.start, block.end)), scheduleNode('span', 'card-meta', scheduleText(block.phase) + ' · ' + project.workspaceIds.join(' + ') + ' · ' + String(project.workspaceUnits[row.workspace.id])));
      canvas.append(card);
    }
  }
  const today = timelineDay(payload.today);
  if (today >= firstDay && today <= layout.lastDay) {
    const line = scheduleNode('div', 'today-line'); line.style.left = (today - firstDay) * TIMELINE_DAY_WIDTH + 'px';
    line.append(scheduleNode('span', 'today-label', scheduleText('today'))); canvas.append(line);
  }
  viewport.scrollLeft = savedScroll;
  updateScheduleRange();
}
function updateScheduleRange() {
  if (!scheduleState.payload) return;
  const viewport = scheduleElement('timeline-viewport');
  const first = scheduleState.firstDay + Math.floor(viewport.scrollLeft / TIMELINE_DAY_WIDTH);
  const last = Math.min(scheduleState.layout.lastDay, first + Math.max(1, Math.floor(viewport.clientWidth / TIMELINE_DAY_WIDTH)) - 1);
  scheduleElement('date-range').textContent = timelineDate(first) + ' — ' + timelineDate(last);
  const count = new Set(scheduleState.layout.rows.flatMap((row) => row.blocks).filter((block) => block.first <= last && block.last >= first).map((block) => block.project.id)).size;
  scheduleElement('visible-count').textContent = scheduleText('visible', { count });
}
function renderSchedule(preserveScroll = false) {
  renderScheduleChrome();
  if (!scheduleState.payload) return;
  renderScheduleTimeline(preserveScroll);
  renderSchedulePending();
}
async function loadSchedule() {
  if (scheduleState.loading) return;
  scheduleState.loading = true; renderScheduleNotice();
  try {
    const payload = normalizeTimelinePayload(await readSchedule());
    scheduleState.payload = payload;
    if (scheduleState.firstDay === null) scheduleState.firstDay = timelineDay(payload.today) - 4;
    scheduleState.failed = false;
  } catch { scheduleState.failed = true; }
  finally { scheduleState.loading = false; renderSchedule(true); }
}
function shiftSchedule(direction) {
  if (!scheduleState.payload) return;
  const viewport = scheduleElement('timeline-viewport');
  const visibleStart = scheduleState.firstDay + Math.floor(viewport.scrollLeft / TIMELINE_DAY_WIDTH);
  scheduleState.firstDay = visibleStart + direction * Math.max(7, Math.floor(viewport.clientWidth / TIMELINE_DAY_WIDTH) - 2);
  renderScheduleTimeline();
}
try { setScheduleLanguage(localStorage.getItem('pm-studio-language')); } catch { setScheduleLanguage('zh-Hant'); }
scheduleElement('language-toggle').addEventListener('click', () => {
  const language = setScheduleLanguage(getScheduleLanguage() === 'en' ? 'zh-Hant' : 'en');
  try { localStorage.setItem('pm-studio-language', language); } catch { /* Language still changes when storage is unavailable. */ }
  renderSchedule(true);
});
scheduleElement('previous').addEventListener('click', () => shiftSchedule(-1));
scheduleElement('next').addEventListener('click', () => shiftSchedule(1));
scheduleElement('today-button').addEventListener('click', () => { if (!scheduleState.payload) return; scheduleState.firstDay = timelineDay(scheduleState.payload.today) - 4; renderScheduleTimeline(); });
scheduleElement('retry').addEventListener('click', loadSchedule);
scheduleElement('timeline-viewport').addEventListener('scroll', updateScheduleRange, { passive: true });
scheduleElement('timeline-viewport').addEventListener('keydown', (event) => { if (event.key === 'Home') { event.preventDefault(); scheduleElement('today-button').click(); } });
new ResizeObserver(updateScheduleRange).observe(scheduleElement('timeline-viewport'));
renderScheduleChrome();
await loadSchedule();
