const scheduleElement = (id) => document.getElementById(id);
const scheduleState = { payload: null, firstDay: null, today: null, loading: false, failed: false, layout: null, scale: null, viewPosition: null, expandedStacks: new Set() };
const readSchedule = createGoogleBridge();
const workspaceHelp = createWorkspaceHelp({ getLanguage:getScheduleLanguage });
startScheduleRefraction();
let scheduleDetailsDialog;
function scheduleNode(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function projectCustomerCode(project) { return project.customerCode ? scheduleText('customer', { code: project.customerCode }) : scheduleText('missingCustomer'); }
function projectCustomerType(project) { return project.customerType ? scheduleText(project.customerType) : scheduleText('missingCustomerType'); }
function projectIdentity(project) { return projectCustomerCode(project) + ' · ' + projectCustomerType(project); }
function dateText(value) { return value ? value + (/^\d{4}-\d{2}$/.test(value) ? ' ' + scheduleText('monthPrecision') : '') : scheduleText('unspecified'); }
function rangeText(start, end) { return dateText(start) + ' → ' + dateText(end); }
function showScheduleDetails(block) {
  if (!scheduleDetailsDialog) {
    scheduleDetailsDialog = scheduleNode('dialog', 'project-details');
    scheduleDetailsDialog.setAttribute('id', 'project-details');
    scheduleDetailsDialog.setAttribute('aria-labelledby', 'project-details-title');
    document.querySelector('main').append(scheduleDetailsDialog);
  }
  const project = block.project;
  const heading = scheduleNode('h2', '', project.id);
  heading.setAttribute('id', 'project-details-title');
  const close = scheduleNode('button', 'details-close', '×');
  close.setAttribute('id', 'close-project-details');
  close.setAttribute('type', 'button');
  close.setAttribute('aria-label', getScheduleLanguage() === 'en' ? 'Close project details' : '關閉專案資訊');
  close.addEventListener('click', () => scheduleDetailsDialog.close());
  const areas = project.workspaceIds.map((id) => id + ' × ' + project.workspaceUnits[id]).join(' · ');
  scheduleDetailsDialog.replaceChildren(close, heading, scheduleNode('p', 'details-customer', projectCustomerCode(project)));
  const fields = scheduleNode('dl', 'project-fields');
  fields.append(scheduleNode('dt', '', scheduleText('customerType')), scheduleNode('dd', '', projectCustomerType(project)));
  for (const key of ['owner', 'status', 'deliveryGoal', 'notes', 'deliverySteps']) {
    fields.append(scheduleNode('dt', '', scheduleText(key)), scheduleNode('dd', '', project[key] || scheduleText('unspecified')));
  }
  scheduleDetailsDialog.append(fields);
  for (const phase of projectPhases(project)) scheduleDetailsDialog.append(scheduleNode('p', 'details-dates', scheduleText(phase.phase) + ' · ' + rangeText(phase.start, phase.end)));
  if (project.followUp.length) {
    const states = scheduleNode('div', 'details-statuses');
    for (const status of project.followUp) states.append(scheduleNode('span', 'status-tag', scheduleText(status)));
    scheduleDetailsDialog.append(states);
  }
  if (block.phase === 'followUp') scheduleDetailsDialog.append(scheduleNode('p', 'details-note', scheduleText('followUpNote')));
  scheduleDetailsDialog.append(scheduleNode('p', 'details-workspaces', scheduleText('workspace') + ' ' + areas));
  if (!scheduleDetailsDialog.open) scheduleDetailsDialog.showModal();
}
function renderScheduleChrome() {
  document.documentElement.lang = getScheduleLanguage();
  document.querySelector('.brand-link')?.setAttribute('aria-label', getScheduleLanguage() === 'en' ? 'HIIIO website' : 'HIIIO 官網');
  document.title = 'PM Studio｜' + scheduleText('title');
  for (const [id, key] of Object.entries({ 'schedule-title': 'title', 'today-button': 'today', 'legend-production': 'production', 'legend-correction': 'correction', 'legend-reservation': 'reservation', 'legend-follow-up': 'followUp', 'pending-title': 'pending', 'page-footer': 'footer', 'retry': 'retry', 'preview-note': 'preview' })) scheduleElement(id).textContent = scheduleText(key);
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
  else if (scheduleState.payload && !scheduleState.payload.projects.length && !scheduleState.payload.reservationSlots.length) key = 'empty';
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
    const identity = scheduleNode('div', 'pending-identity');
    const title = scheduleNode('div', 'card-heading');
    title.append(scheduleNode('span', 'card-id', project.id));
    identity.append(title, scheduleNode('p', 'customer-code', projectIdentity(project)));
    const schedule = scheduleNode('div', 'pending-schedule');
    schedule.append(scheduleNode('p', 'pending-dates', scheduleText(project.scheduleKind) + ' ' + rangeText(project.start, project.end)));
    if (project.correctionStart || project.correctionEnd || reasons.includes('correction-dates')) schedule.append(scheduleNode('p', 'pending-dates', scheduleText('correction') + ' ' + rangeText(project.correctionStart, project.correctionEnd)));
    card.append(identity, scheduleNode('p', 'pending-reason', reasons.map((reason) => scheduleText(reason)).join(' · ')), schedule);
    const details = scheduleNode('button', 'pending-details');
    const arrow = scheduleNode('span', 'details-arrow', '↗');
    arrow.setAttribute('aria-hidden', 'true');
    details.append(scheduleNode('span', '', scheduleText('details')), arrow);
    details.setAttribute('type', 'button');
    details.setAttribute('aria-label', scheduleText('details') + ' · ' + project.id + ' · ' + projectIdentity(project));
    details.addEventListener('click', () => showScheduleDetails({ project, phase: 'pending' }));
    card.append(details);
    target.append(card);
  }
}
function toggleScheduleStack(stack, phase) {
  if (stack.expanded) scheduleState.expandedStacks.delete(stack.key);
  else scheduleState.expandedStacks.add(stack.key);
  renderScheduleTimeline(true);
  const toggles = [...scheduleElement('timeline-canvas').querySelectorAll('.project-stack-toggle')]
    .filter((node) => node.getAttribute('data-stack-key') === stack.key);
  const viewportBounds = scheduleElement('timeline-viewport').getBoundingClientRect();
  const toggle = toggles.find((node) => node.getAttribute('data-stack-phase') === phase)
    || toggles.find((node) => { const bounds = node.getBoundingClientRect(); return bounds.right > viewportBounds.left && bounds.left < viewportBounds.right; })
    || toggles[0];
  toggle?.focus({ preventScroll: true });
}
function renderScheduleTimeline(preserveScroll = false) {
  const viewport = scheduleElement('timeline-viewport');
  const previousScale = scheduleState.scale;
  let savedScroll = preserveScroll ? viewport.scrollLeft : 0;
  // Reveal the grid before measuring; a hidden viewport reports zero width.
  scheduleElement('timeline-grid').hidden = false;
  const scale = timelineScale(viewport.clientWidth);
  // The browser may already have clamped scrollLeft after a width change.
  const position = preserveScroll && previousScale
    ? previousScale.viewportWidth !== scale.viewportWidth && scheduleState.viewPosition
      ? scheduleState.viewPosition
      : timelineScrollPosition(scheduleState.firstDay, viewport.scrollLeft, previousScale.dayWidth)
    : null;
  if (position && previousScale.viewportWidth !== scale.viewportWidth) {
    // Rebase near the visible date so a wider viewport cannot clamp an old right-edge scroll.
    scheduleState.firstDay = position.day;
    savedScroll = position.fraction * scale.dayWidth;
  }
  const { payload, firstDay } = scheduleState;
  const today = timelineDay(scheduleState.today);
  const layout = buildTimelineLayout(payload.projects, payload.workspaces, firstDay, { ...scale, today, expandedStacks: scheduleState.expandedStacks, reservationSlots: payload.reservationSlots });
  const dayWidth = scale.dayWidth;
  scheduleState.scale = scale;
  scheduleState.layout = layout;
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
    grid.style.left = index * dayWidth + 'px'; grid.style.width = dayWidth + 'px'; canvas.append(grid);
    if (weekday === 1) {
      const label = scheduleNode('span', 'day-label', String(date.getUTCDate()));
      label.setAttribute('data-date', timelineDate(day));
      label.style.left = index * dayWidth + 'px'; label.style.width = Math.min(7, TIMELINE_DAYS - index) * dayWidth + 'px'; canvas.append(label);
    }
    const nextDate = new Date((day + 1) * 86400000);
    if (nextDate.getUTCDate() === 1 || index === TIMELINE_DAYS - 1) {
      const monthWidth = (day - monthStart + 1) * dayWidth;
      const month = scheduleNode('div', 'month-label', monthWidth >= 90 ? scheduleMonth(monthStart) : '');
      month.setAttribute('title', scheduleMonth(monthStart));
      month.style.left = (monthStart - firstDay) * dayWidth + 'px';
      month.style.width = monthWidth + 'px'; canvas.append(month);
      monthStart = day + 1;
    }
  }
  for (const row of layout.rows) {
    const label = scheduleNode('div', 'workspace-label'); label.style.height = row.height + 'px';
    workspaceHelp.render(label, row.workspace.id); labels.append(label);
    const rule = scheduleNode('div', 'row-rule'); rule.style.top = row.top + row.height + 'px'; canvas.append(rule);
    if (!row.blocks.length && !row.followUps.length && !(row.reservationSlots || []).length) { const empty = scheduleNode('span', 'empty-row', scheduleText('noWork')); empty.style.top = row.top + 43 + 'px'; canvas.append(empty); }
    for (const slot of row.reservationSlots || []) {
      const marker = scheduleNode('div', 'reservation-slot' + (slot.width < 80 ? ' is-narrow' : ''));
      marker.setAttribute('role', 'img');
      marker.setAttribute('aria-label', scheduleText('reservation') + ' · ' + scheduleText('workspace') + ' ' + slot.workspaceId + ' · ' + rangeText(slot.start, slot.end));
      marker.setAttribute('data-slot-workspace', slot.workspaceId);
      marker.setAttribute('data-slot-start', slot.start); marker.setAttribute('data-slot-end', slot.end);
      marker.setAttribute('data-start-precision', slot.startPrecision); marker.setAttribute('data-end-precision', slot.endPrecision);
      marker.style.left = slot.left + 'px'; marker.style.top = slot.top + 'px'; marker.style.width = slot.width + 'px';
      marker.append(scheduleNode('span', 'reservation-slot-label', scheduleText('reservation')));
      canvas.append(marker);
    }
    const stacks = new Map((row.stacks || []).map((stack) => [stack.key, stack]));
    const stackMembers = new Map();
    for (const stack of stacks.values()) {
      const members = scheduleNode('div', 'stack-members');
      members.setAttribute('id', stack.controlsId);
      members.setAttribute('role', 'group');
      members.setAttribute('aria-label', scheduleText('stackCount', { count: stack.count }));
      canvas.append(members); stackMembers.set(stack.key, members);
      if (!stack.expanded) continue;
      {
        const track = scheduleNode('div', 'stack-collapse-track');
        track.style.left = stack.collapseTrackLeft + 'px'; track.style.top = stack.collapseTop + 'px'; track.style.width = stack.collapseTrackWidth + 'px';
        const collapse = scheduleNode('button', 'project-stack-toggle stack-collapse');
        collapse.setAttribute('type', 'button');
        collapse.setAttribute('data-stack-placement', 'bottom-right');
        collapse.setAttribute('data-stack-key', stack.key);
        collapse.setAttribute('data-stack-phase', 'all');
        collapse.setAttribute('aria-expanded', 'true');
        collapse.setAttribute('aria-label', scheduleText('collapseStack', { count: stack.count }));
        collapse.setAttribute('aria-controls', stack.controlsId);
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('aria-hidden', 'true'); icon.setAttribute('focusable', 'false');
        const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        chevron.setAttribute('d', 'm6 15 6-6 6 6'); icon.append(chevron); collapse.append(icon);
        collapse.addEventListener('click', () => toggleScheduleStack(stack, 'all'));
        track.append(collapse); canvas.append(track);
      }
    }
    for (const block of row.blocks) {
      if (block.stackHidden) continue;
      const stack = stacks.get(block.stackKey);
      const collapsed = stack && !stack.expanded;
      const project = block.project;
      const card = scheduleNode('button', 'project-card ' + block.phase + (block.width < 190 ? ' is-compact' : '') + (block.width < 80 ? ' is-narrow' : '') + (block.startPrecision === 'month' ? ' month-start' : '') + (block.endPrecision === 'month' ? ' month-end' : ''));
      card.setAttribute('type', 'button');
      card.setAttribute('data-project-id', project.id);
      card.setAttribute('data-material', 'neutral-glass');
      card.setAttribute('data-phase', block.phase);
      card.setAttribute('data-start-precision', block.startPrecision);
      card.setAttribute('data-end-precision', block.endPrecision);
      card.style.left = block.left + 'px'; card.style.top = block.top + 'px'; card.style.width = block.width + 'px';
      card.setAttribute('tabindex', '0');
      const identity = project.id + ' · ' + projectIdentity(project);
      const details = identity + ' · ' + scheduleText(block.phase) + ' · ' + rangeText(block.start, block.end) + ' · ' + scheduleText('workspace') + ' ' + project.workspaceIds.join(' + ');
      card.setAttribute('aria-label', details);
      if (collapsed) {
        card.className += ' project-stack-toggle stack-top';
        card.setAttribute('data-stack-key', stack.key);
        card.setAttribute('data-stack-phase', block.phase);
        card.setAttribute('aria-expanded', 'false');
        card.setAttribute('aria-controls', stack.controlsId);
        card.setAttribute('aria-label', scheduleText('expandStack', { count: stack.count }) + ' · ' + details);
        for (let layer = stack.count - 1; layer > 0; layer--) {
          const ghost = scheduleNode('span', 'stack-layer');
          ghost.setAttribute('data-stack-layer', String(layer));
          ghost.setAttribute('aria-hidden', 'true'); ghost.style.setProperty('--stack-layer', String(layer));
          card.append(ghost);
        }
      }
      const heading = scheduleNode('div', 'card-heading'); heading.append(scheduleNode('span', 'card-id', project.id));
      heading.append(scheduleNode('span', 'card-phase', scheduleText(block.phase)));
      const content = scheduleNode('span', 'card-content');
      content.append(heading, scheduleNode('span', 'card-meta', collapsed ? scheduleText('expandStack', { count: stack.count }) + ' ⌄' : projectIdentity(project)));
      const glassSurface = scheduleNode('span', 'project-glass-surface');
      glassSurface.setAttribute('aria-hidden', 'true');
      card.append(glassSurface, content);
      card.addEventListener('click', () => collapsed ? toggleScheduleStack(stack, block.phase) : showScheduleDetails(block));
      (stackMembers.get(block.stackKey) || canvas).append(card);
    }
    for (const followUp of row.followUps) {
      const project = followUp.project;
      const stem = scheduleNode('div', 'follow-up-stem' + (followUp.clippedStart ? ' clipped-start' : ''));
      stem.setAttribute('aria-hidden', 'true');
      stem.setAttribute('data-project-id', project.id);
      stem.style.left = followUp.left + 'px'; stem.style.top = followUp.top + 'px'; stem.style.width = followUp.width + 'px';
      canvas.append(stem);
      if (followUp.endpointVisible) {
        const endpoint = scheduleNode('button', 'follow-up-endpoint');
        endpoint.setAttribute('type', 'button');
        endpoint.setAttribute('data-project-id', project.id);
        endpoint.setAttribute('data-phase', 'followUp');
        const details = project.id + ' · ' + projectIdentity(project) + ' · ' + project.followUp.map((status) => scheduleText(status)).join(' · ');
        endpoint.setAttribute('aria-label', details);
        endpoint.style.left = followUp.left + followUp.width - 22 + 'px'; endpoint.style.top = followUp.top - 22 + 'px';
        endpoint.append(scheduleNode('span', 'follow-up-label', project.id));
        endpoint.addEventListener('click', () => showScheduleDetails(followUp));
        canvas.append(endpoint);
      }
    }
  }
  if (today >= firstDay && today <= layout.lastDay) {
    const line = scheduleNode('div', 'today-line'); line.style.left = (today - firstDay + .5) * dayWidth + 'px';
    line.append(scheduleNode('span', 'today-label', scheduleText('today'))); canvas.append(line);
  }
  viewport.scrollLeft = savedScroll;
  updateScheduleRange();
}
function updateScheduleRange() {
  if (!scheduleState.payload) return;
  const viewport = scheduleElement('timeline-viewport');
  // A resize can fire scroll before ResizeObserver; keep the last date until rescaled.
  if (viewport.clientWidth !== scheduleState.scale.viewportWidth) return;
  const position = timelineScrollPosition(scheduleState.firstDay, viewport.scrollLeft, scheduleState.scale.dayWidth);
  scheduleState.viewPosition = position;
  const first = position.day;
  const last = Math.min(scheduleState.layout.lastDay, first + scheduleState.scale.visibleDays - 1);
  scheduleElement('date-range').textContent = timelineDate(first) + ' — ' + timelineDate(last);
  const count = new Set(scheduleState.layout.rows.flatMap((row) => [...row.blocks, ...row.followUps]).filter((block) => block.first <= last && block.last >= first).map((block) => block.project.id)).size;
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
    scheduleState.today = taipeiToday();
    if (scheduleState.firstDay === null) scheduleState.firstDay = timelineDay(scheduleState.today) - 4;
    scheduleState.failed = false;
  } catch { scheduleState.failed = true; }
  finally { scheduleState.loading = false; renderSchedule(true); }
}
function shiftSchedule(direction) {
  if (!scheduleState.payload) return;
  const viewport = scheduleElement('timeline-viewport');
  const visibleStart = timelineScrollPosition(scheduleState.firstDay, viewport.scrollLeft, scheduleState.scale.dayWidth).day;
  scheduleState.firstDay = visibleStart + direction * (scheduleState.scale.visibleDays - 7);
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
scheduleElement('today-button').addEventListener('click', () => { if (!scheduleState.payload) return; scheduleState.today = taipeiToday(); scheduleState.firstDay = timelineDay(scheduleState.today) - 4; renderScheduleTimeline(); });
scheduleElement('retry').addEventListener('click', loadSchedule);
scheduleElement('timeline-viewport').addEventListener('scroll', updateScheduleRange, { passive: true });
scheduleElement('timeline-viewport').addEventListener('keydown', (event) => { if (event.key === 'Home') { event.preventDefault(); scheduleElement('today-button').click(); } });
new ResizeObserver(() => {
  const width = scheduleElement('timeline-viewport').clientWidth;
  if (scheduleState.payload && width > 0 && width !== scheduleState.scale?.viewportWidth) renderScheduleTimeline(true);
}).observe(scheduleElement('timeline-viewport'));
function refreshScheduleDay() {
  if (!scheduleState.payload) return;
  const today = taipeiToday();
  if (today !== scheduleState.today) { scheduleState.today = today; renderScheduleTimeline(true); }
}
// This only refreshes the open page's date; it does not schedule notifications or writes.
if (typeof setInterval === 'function') setInterval(refreshScheduleDay, 60000);
if (typeof document.addEventListener === 'function') document.addEventListener('visibilitychange', refreshScheduleDay);
renderScheduleChrome();
await loadSchedule();
