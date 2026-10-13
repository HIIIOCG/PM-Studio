export const TIMELINE_DAYS = 210;
export const TIMELINE_AXIS_HEIGHT = 68;
export const TIMELINE_LANE_HEIGHT = 94;

export function timelineScale(viewportWidth) {
  const width = Math.max(1, Number(viewportWidth) || 1);
  const visibleDays = width <= 560 ? 42 : 84;
  return { viewportWidth: width, visibleDays, dayWidth: width / visibleDays };
}
export function timelineScrollPosition(firstDay, scrollLeft, dayWidth) {
  const offset = Math.max(0, scrollLeft) / dayWidth;
  const wholeDays = Math.floor(offset + 1e-7);
  return { day: firstDay + wholeDays, fraction: Math.max(0, offset - wholeDays) };
}

export function timelineDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? Math.floor(date.getTime() / 86400000) : null;
}
export function timelineDate(day) { return new Date(day * 86400000).toISOString().slice(0, 10); }
export function preciseTimelineRange(start, end) {
  const first = timelineDay(start), last = timelineDay(end);
  return first !== null && last !== null && first <= last ? { first, last } : null;
}
export function timelineDateBounds(value) {
  const day = timelineDay(value);
  if (day !== null) return { first: day, last: day, precision: 'day' };
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) return null;
  const first = timelineDay(value + '-01');
  if (first === null) return null;
  const nextMonth = new Date(first * 86400000);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  return { first, last: Math.floor(nextMonth.getTime() / 86400000) - 1, precision: 'month' };
}
export function timelineRange(start, end) {
  const beginning = timelineDateBounds(start), ending = timelineDateBounds(end);
  return beginning && ending && beginning.first <= ending.last
    ? { first: beginning.first, last: ending.last, startPrecision: beginning.precision, endPrecision: ending.precision } : null;
}
export function taipeiToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year', 'month', 'day'].map((key) => parts.find((part) => part.type === key).value).join('-');
}
export function projectPhases(project) {
  return [
    { phase: project.scheduleKind === 'reservation' ? 'reservation' : 'production', start: project.start, end: project.end },
    { phase: 'correction', start: project.correctionStart, end: project.correctionEnd },
  ].flatMap((phase) => { const range = timelineRange(phase.start, phase.end); return range ? [{ ...phase, ...range }] : []; });
}
export function projectFollowUp(project, today) {
  if (!project.followUp?.length || !Number.isFinite(today) || !timelineRange(project.start, project.end)) return null;
  // An unknown revision end cannot be treated as completed work.
  if (project.pendingReasons.includes('correction-dates') || ((project.correctionStart || project.correctionEnd) && !timelineRange(project.correctionStart, project.correctionEnd))) return null;
  const phases = projectPhases(project);
  const anchor = phases.reduce((latest, phase) => !latest || phase.last > latest.last ? phase : latest, null);
  if (!anchor || anchor.last >= today) return null;
  return { phase: 'followUp', first: anchor.last + 1, last: today, anchor, project };
}
export function projectPendingReasons(project) {
  const reasons = new Set(project.pendingReasons);
  if (!project.workspaceIds.length) reasons.add('no-workspace');
  if (!timelineRange(project.start, project.end)) reasons.add('production-dates');
  if ((project.correctionStart || project.correctionEnd) && !timelineRange(project.correctionStart, project.correctionEnd)) reasons.add('correction-dates');
  if (!project.customerCode) reasons.add('customer-code');
  return [...reasons];
}
export function buildTimelineLayout(projects, workspaces, firstDay, { dayWidth, days = TIMELINE_DAYS, today = null }) {
  if (!Number.isFinite(dayWidth) || dayWidth <= 0) throw new Error('Invalid timeline scale.');
  let top = TIMELINE_AXIS_HEIGHT;
  const lastDay = firstDay + days - 1;
  const inset = Math.min(2, dayWidth * .12);
  const rows = workspaces.map((workspace) => {
    const groups = projects.filter((project) => project.workspaceIds.includes(workspace.id)).map((project) => {
      const phases = projectPhases(project).map((phase) => ({ ...phase, project }));
      const phaseLaneEnds = [];
      for (const phase of [...phases].sort((a, b) => a.first - b.first || a.last - b.last)) {
        let phaseLane = phaseLaneEnds.findIndex((end) => end < phase.first);
        if (phaseLane < 0) phaseLane = phaseLaneEnds.length;
        phaseLaneEnds[phaseLane] = phase.last;
        phase.phaseLane = phaseLane;
      }
      const followUp = projectFollowUp(project, today);
      const items = [...phases, ...(followUp ? [followUp] : [])];
      return { project, phases, followUp, laneCount: phaseLaneEnds.length, first: Math.min(...items.map((item) => item.first)), last: Math.max(...items.map((item) => item.last)) };
    }).filter((group) => [...group.phases, ...(group.followUp ? [group.followUp] : [])].some((item) => item.last >= firstDay && item.first <= lastDay))
      .sort((a, b) => a.first - b.first || a.last - b.last || a.project.id.localeCompare(b.project.id));
    const blocks = [], followUps = [];
    const laneEnds = [];
    for (const group of groups) {
      // Keep a project's phases and tracking line together, with room for its endpoint.
      let lane = 0;
      while (Array.from({ length: group.laneCount }, (_, offset) => laneEnds[lane + offset]).some((end) => end !== undefined && end >= group.first)) lane++;
      for (let offset = 0; offset < group.laneCount; offset++) laneEnds[lane + offset] = group.last + (group.followUp ? 110 / dayWidth : 0);
      for (const block of group.phases.filter((phase) => phase.last >= firstDay && phase.first <= lastDay)) {
        block.lane = lane + block.phaseLane;
        block.left = (Math.max(firstDay, block.first) - firstDay) * dayWidth + inset;
        block.width = (Math.min(lastDay, block.last) - Math.max(firstDay, block.first) + 1) * dayWidth - 2 * inset;
        block.top = top + 12 + block.lane * TIMELINE_LANE_HEIGHT;
        blocks.push(block);
      }
      const followUp = group.followUp;
      if (followUp && followUp.last >= firstDay && followUp.first <= lastDay) {
        followUp.lane = lane + group.phases.find((phase) => phase.phase === followUp.anchor.phase).phaseLane;
        followUp.left = Math.max(0, (followUp.first - firstDay) * dayWidth - inset);
        const end = Math.min((today - firstDay + .5) * dayWidth, days * dayWidth);
        followUp.width = Math.max(0, end - followUp.left);
        followUp.top = top + 51 + followUp.lane * TIMELINE_LANE_HEIGHT;
        followUp.endpointVisible = today >= firstDay && today <= lastDay;
        followUp.clippedStart = followUp.first < firstDay;
        followUps.push(followUp);
      }
    }
    const height = Math.max(1, laneEnds.length) * TIMELINE_LANE_HEIGHT + 18;
    const row = { workspace, top, height, blocks, followUps };
    top += height;
    return row;
  });
  return { rows, height: top, width: days * dayWidth, firstDay, lastDay, dayWidth };
}
