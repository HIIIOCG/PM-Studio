export const TIMELINE_DAYS = 210;
export const TIMELINE_AXIS_HEIGHT = 68;
export const TIMELINE_LANE_HEIGHT = 70;

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
export function buildTimelineLayout(projects, workspaces, firstDay, { dayWidth, days = TIMELINE_DAYS, today = null, expandedStacks = new Set() }) {
  if (!Number.isFinite(dayWidth) || dayWidth <= 0) throw new Error('Invalid timeline scale.');
  let top = TIMELINE_AXIS_HEIGHT;
  const lastDay = firstDay + days - 1;
  const inset = Math.min(2, dayWidth * .12);
  const stackVisualInset = (width, decoration) => Math.min(decoration, Math.max(0, width - 44));
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
    const blocks = [], followUps = [], stacks = [];
    // Only identical complete phase footprints share a visual stack. Tracking
    // intervals and screen clipping never establish membership or change its key.
    const footprintGroups = new Map();
    if (workspace.id === 'D') for (const group of groups) {
      if (!group.phases.some((phase) => phase.last >= firstDay && phase.first <= lastDay)) continue;
      const footprint = JSON.stringify([
        group.phases.map(({ phase, start, end, startPrecision, endPrecision }) => [phase, start, end, startPrecision, endPrecision]),
        group.project.correctionStart || '', group.project.correctionEnd || '',
      ]);
      if (!footprintGroups.has(footprint)) footprintGroups.set(footprint, []);
      footprintGroups.get(footprint).push(group);
    }
    const stackByProject = new Map();
    for (const [footprint, members] of footprintGroups) {
      if (new Set(members.map((member) => member.project.id)).size < 2) continue;
      members.sort((a, b) => a.project.id.localeCompare(b.project.id));
      const ids = members.map((member) => member.project.id);
      const key = 'D:' + JSON.stringify([ids, footprint]);
      const stack = { key, expanded: expandedStacks.has(key), count: ids.length, layerOffsetPx: 6, decorationOffsetPx: (ids.length - 1) * 6, projects: members.map((member) => member.project), blocks: [], representatives: [], representative: null, controlsId: 'd-stack-' + ids.join('-') };
      for (const member of members) stackByProject.set(member.project.id, { stack, members });
    }
    const emittedStacks = new Set();
    const units = groups.flatMap((group) => {
      const entry = stackByProject.get(group.project.id);
      if (!entry) return [{ members: [group], first: group.first, last: group.last, laneCount: group.laneCount, offsets: [0], stack: null }];
      const { stack, members } = entry;
      if (emittedStacks.has(stack.key)) return [];
      emittedStacks.add(stack.key);
      // The back cards are decoration, not extra work. Reserve their real
      // diagonal extent separately so they cannot cover another phase or case.
      const phaseOffsets = new Map();
      let collapsedLaneCount = members[0].laneCount;
      if (!stack.expanded) {
        const laneSpan = Math.max(1, Math.ceil((48 + stack.decorationOffsetPx + 4) / TIMELINE_LANE_HEIGHT));
        const bandEnds = [];
        for (const phase of [...members[0].phases].sort((a, b) => a.first - b.first || a.last - b.last)) {
          let band = bandEnds.findIndex((end) => end < phase.first);
          if (band < 0) band = bandEnds.length;
          const visible = phase.last >= firstDay && phase.first <= lastDay;
          const width = (visible ? Math.min(lastDay, phase.last) - Math.max(firstDay, phase.first) + 1 : phase.last - phase.first + 1) * dayWidth - 2 * inset;
          const overflow = stack.decorationOffsetPx - stackVisualInset(width, stack.decorationOffsetPx);
          bandEnds[band] = phase.last + 1 + (overflow - 2 * inset) / dayWidth;
          phaseOffsets.set(phase.phase, band * laneSpan);
        }
        collapsedLaneCount = bandEnds.length * laneSpan;
      }
      // Expanded stacks reserve a bottom lane for their control. Tracking lines
      // always retain individual anchors, including when their work is hidden.
      let laneCount = stack.expanded ? 0 : collapsedLaneCount;
      const offsets = members.map((member, index) => {
        if (!stack.expanded && (index === 0 || !member.followUp)) return 0;
        const offset = laneCount;
        laneCount += member.laneCount;
        return offset;
      });
      const controlLane = stack.expanded ? laneCount++ : null;
      return [{ members, first: Math.min(...members.map((member) => member.first)), last: Math.max(...members.map((member) => member.last)), laneCount, offsets, phaseOffsets, controlLane, stack }];
    });
    const laneEnds = [];
    for (const unit of units) {
      // Keep a project's phases and tracking line together, with room for its endpoint.
      let lane = 0;
      while (Array.from({ length: unit.laneCount }, (_, offset) => laneEnds[lane + offset]).some((end) => end !== undefined && end >= unit.first)) lane++;
      let reservedEnd = unit.last + (unit.members.some((member) => member.followUp) ? 110 / dayWidth : 0);
      if (unit.stack) {
        // Controls and diagonal back cards may extend beyond a short phase.
        // Reserve that display space without enlarging the real date interval.
        const visibleBoxes = unit.members[0].phases.filter((item) => item.last >= firstDay && item.first <= lastDay).map((phase) => {
          const visibleFirst = Math.max(firstDay, phase.first);
          const width = (Math.min(lastDay, phase.last) - visibleFirst + 1) * dayWidth - 2 * inset;
          if (!unit.stack.expanded) {
            const visualInset = stackVisualInset(width, unit.stack.decorationOffsetPx);
            reservedEnd = Math.max(reservedEnd, visibleFirst + (width - visualInset + unit.stack.decorationOffsetPx) / dayWidth);
          }
          return { left: (visibleFirst - firstDay) * dayWidth + inset, width };
        });
        if (unit.stack.expanded) {
          const stack = unit.stack;
          stack.collapseTrackLeft = Math.min(...visibleBoxes.map((box) => box.left));
          stack.collapseTrackWidth = Math.max(44, Math.max(...visibleBoxes.map((box) => box.left + box.width)) - stack.collapseTrackLeft);
          stack.collapseTrackRight = stack.collapseTrackLeft + stack.collapseTrackWidth;
          reservedEnd = Math.max(reservedEnd, firstDay + (stack.collapseTrackRight - inset) / dayWidth);
        }
      }
      for (let offset = 0; offset < unit.laneCount; offset++) laneEnds[lane + offset] = reservedEnd;
      for (const [memberIndex, group] of unit.members.entries()) {
        const memberLane = lane + unit.offsets[memberIndex];
        const phaseLane = (phase) => unit.stack && !unit.stack.expanded && (memberIndex === 0 || !group.followUp)
          ? unit.phaseOffsets.get(phase.phase) : phase.phaseLane;
        for (const block of group.phases.filter((phase) => phase.last >= firstDay && phase.first <= lastDay)) {
          block.lane = memberLane + phaseLane(block);
          block.left = (Math.max(firstDay, block.first) - firstDay) * dayWidth + inset;
          block.width = (Math.min(lastDay, block.last) - Math.max(firstDay, block.first) + 1) * dayWidth - 2 * inset;
          block.top = top + 11 + block.lane * TIMELINE_LANE_HEIGHT;
          if (unit.stack) {
            block.dateLeft = block.left;
            block.dateWidth = block.width;
            if (!unit.stack.expanded) {
              // Only the collapsed silhouette is inset; dates and the waiting
              // line still use the full original work interval.
              block.visualInsetPx = stackVisualInset(block.dateWidth, unit.stack.decorationOffsetPx);
              block.width -= block.visualInsetPx;
            }
            block.stackKey = unit.stack.key;
            block.stackHidden = !unit.stack.expanded && memberIndex !== 0;
            unit.stack.blocks.push(block);
            if (memberIndex === 0) unit.stack.representatives.push(block);
          }
          blocks.push(block);
        }
        const followUp = group.followUp;
        if (followUp && followUp.last >= firstDay && followUp.first <= lastDay) {
          followUp.lane = memberLane + phaseLane(group.phases.find((phase) => phase.phase === followUp.anchor.phase));
          followUp.left = Math.max(0, (followUp.first - firstDay) * dayWidth - inset);
          const end = Math.min((today - firstDay + .5) * dayWidth, days * dayWidth);
          followUp.width = Math.max(0, end - followUp.left);
          followUp.top = top + 35 + followUp.lane * TIMELINE_LANE_HEIGHT;
          followUp.endpointVisible = today >= firstDay && today <= lastDay;
          followUp.clippedStart = followUp.first < firstDay;
          followUps.push(followUp);
        }
      }
      if (unit.stack) {
        const stack = unit.stack;
        stack.representative = stack.representatives[0];
        stack.left = stack.representative.left;
        stack.width = stack.representative.width;
        stack.top = stack.expanded ? Math.min(...stack.blocks.map((block) => block.top)) : stack.representative.top;
        if (stack.expanded) stack.collapseTop = top + 11 + (lane + unit.controlLane) * TIMELINE_LANE_HEIGHT;
        stacks.push(stack);
      }
    }
    const height = Math.max(1, laneEnds.length) * TIMELINE_LANE_HEIGHT + 18;
    const row = { workspace, top, height, blocks, followUps };
    if (workspace.id === 'D') row.stacks = stacks;
    top += height;
    return row;
  });
  return { rows, height: top, width: days * dayWidth, firstDay, lastDay, dayWidth };
}
