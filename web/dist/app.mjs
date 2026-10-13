export const TIMELINE_DAY_WIDTH = 20;
export const TIMELINE_DAYS = 210;
export const TIMELINE_AXIS_HEIGHT = 68;
export const TIMELINE_LANE_HEIGHT = 94;

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
export function projectPhases(project) {
  return [
    { phase: 'production', start: project.start, end: project.end },
    { phase: 'correction', start: project.correctionStart, end: project.correctionEnd },
  ].flatMap((phase) => { const range = preciseTimelineRange(phase.start, phase.end); return range ? [{ ...phase, ...range }] : []; });
}
export function projectPendingReasons(project) {
  const reasons = new Set(project.pendingReasons);
  if (!project.workspaceIds.length) reasons.add('no-workspace');
  if (!preciseTimelineRange(project.start, project.end)) reasons.add('production-dates');
  if ((project.correctionStart || project.correctionEnd) && !preciseTimelineRange(project.correctionStart, project.correctionEnd)) reasons.add('correction-dates');
  if (!project.customerCode) reasons.add('customer-code');
  return [...reasons];
}
export function buildTimelineLayout(projects, workspaces, firstDay, days = TIMELINE_DAYS) {
  let top = TIMELINE_AXIS_HEIGHT;
  const lastDay = firstDay + days - 1;
  const rows = workspaces.map((workspace) => {
    const blocks = projects.filter((project) => project.workspaceIds.includes(workspace.id))
      .flatMap((project) => projectPhases(project).filter((phase) => phase.last >= firstDay && phase.first <= lastDay).map((phase) => ({ ...phase, project })))
      .sort((a, b) => a.first - b.first || a.last - b.last || a.project.id.localeCompare(b.project.id) || a.phase.localeCompare(b.phase));
    const laneEnds = [];
    for (const block of blocks) {
      let lane = laneEnds.findIndex((end) => end < block.first);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = block.last;
      block.lane = lane;
      block.left = (Math.max(firstDay, block.first) - firstDay) * TIMELINE_DAY_WIDTH + 2;
      block.width = (Math.min(lastDay, block.last) - Math.max(firstDay, block.first) + 1) * TIMELINE_DAY_WIDTH - 4;
      block.top = top + 12 + lane * TIMELINE_LANE_HEIGHT;
    }
    const height = Math.max(1, laneEnds.length) * TIMELINE_LANE_HEIGHT + 18;
    const row = { workspace, top, height, blocks };
    top += height;
    return row;
  });
  return { rows, height: top, width: days * TIMELINE_DAY_WIDTH, firstDay, lastDay };
}
