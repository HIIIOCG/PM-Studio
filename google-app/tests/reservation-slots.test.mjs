import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimelineLayout, timelineDay, timelineScale } from '../../web/dist/app.mjs';

const workspaces = ['A', 'B', 'C', 'D'].map((id) => ({ id, name: 'Workspace ' + id }));
const firstDay = timelineDay('2026-10-01');
const options = { dayWidth: 10, days: 160, today: timelineDay('2026-10-16') };
const slotFields = ['workspaceId', 'start', 'end', 'first', 'last', 'startPrecision', 'endPrecision', 'left', 'width', 'top'].sort();
function project(id, overrides = {}) {
  return { id, customerCode: '', customerType: '', owner: '', status: '', deliveryGoal: '', notes: '', deliverySteps: '',
    start: '2026-10', end: '2026-10-31', correctionStart: '', correctionEnd: '', scheduleKind: 'production', followUp: [],
    workspaceIds: ['D'], workspaceUnits: { D: 1 }, pendingReasons: [], ...overrides };
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); }
  return value;
}
function visibleCases(row) {
  return new Set([...row.blocks, ...row.followUps].map((item) => item.project.id));
}
function collides(a, b) {
  return a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
}

test('four independent monthly slots follow the October D stack without creating or counting cases', () => {
  const projects = freeze(Array.from({ length: 4 }, (_, index) => project('O-' + (101 + index))));
  const months = ['2026-11', '2026-12', '2027-01', '2027-02'];
  const slots = freeze(months.map((month) => ({ workspaceId: 'D', start: month, end: month })));
  const original = JSON.stringify({ projects, slots });
  const layout = buildTimelineLayout(projects, workspaces, firstDay, { ...options, reservationSlots: slots });
  const row = layout.rows[3];
  assert.equal(row.blocks.length, 4);
  assert.equal(row.stacks.length, 1);
  assert.equal(row.stacks[0].count, 4);
  assert.deepEqual([...visibleCases(row)], projects.map((item) => item.id));
  assert.equal(row.followUps.length, 0);
  assert.equal(row.reservationSlots.length, 4);
  assert.equal(row.height, 88);
  for (const [index, slot] of row.reservationSlots.entries()) {
    assert.deepEqual(Object.keys(slot).sort(), slotFields);
    assert.equal(slot.start, months[index]);
    assert.equal(slot.end, months[index]);
    assert.equal(slot.startPrecision, 'month');
    assert.equal(slot.endPrecision, 'month');
    assert.equal(slot.top, row.stacks[0].representative.top);
    if (index) assert.ok(row.reservationSlots[index - 1].left + row.reservationSlots[index - 1].width < slot.left);
  }
  const february = row.reservationSlots[3];
  assert.equal(february.first, timelineDay('2027-02-01'));
  assert.equal(february.last, timelineDay('2027-02-28'));
  assert.equal(february.width, 28 * 10 - 2.4);
  assert.ok(layout.rows.every((item) => Array.isArray(item.reservationSlots)));
  assert.equal(JSON.stringify({ projects, slots }), original);
});

test('a schedule containing only blank slots has real rows and canvas geometry for any workspace', () => {
  const slots = workspaces.map((space) => ({ workspaceId: space.id, start: '2026-11', end: '2026-11' }));
  const layout = buildTimelineLayout([], workspaces, firstDay, { ...options, reservationSlots: slots });
  assert.equal(layout.rows.length, 4);
  assert.equal(layout.width, 1600);
  assert.ok(layout.height > 0);
  for (const row of layout.rows) {
    assert.equal(row.reservationSlots.length, 1);
    assert.equal(row.reservationSlots[0].workspaceId, row.workspace.id);
    assert.equal(row.reservationSlots[0].width, 30 * 10 - 2.4);
    assert.equal(row.blocks.length, 0);
    assert.equal(row.followUps.length, 0);
    assert.equal(visibleCases(row).size, 0);
    if (row.workspace.id === 'D') assert.equal(row.stacks.length, 0);
  }
});

test('slots and A/B/C cases are sorted together and same-day overlap requires separate visual lanes', () => {
  for (const workspaceId of ['A', 'B', 'C']) {
    const projects = [project('C-101', { start: '2026-11-05', end: '2026-11-10', workspaceIds: [workspaceId], workspaceUnits: { [workspaceId]: 3 } })];
    const slots = [{ workspaceId, start: '2026-11-11', end: '2026-11-14' }, { workspaceId, start: '2026-11-01', end: '2026-11-05' }];
    const row = buildTimelineLayout(projects, workspaces, firstDay, { ...options, reservationSlots: slots }).rows.find((item) => item.workspace.id === workspaceId);
    assert.deepEqual(row.reservationSlots.map((slot) => slot.start), ['2026-11-01', '2026-11-11']);
    assert.notEqual(row.reservationSlots[0].top, row.blocks[0].top, 'the fifth is occupied by both intervals');
    assert.equal(row.reservationSlots[1].top, row.reservationSlots[0].top, 'the later non-overlapping slot reuses its lane');
    assert.equal(row.blocks[0].project.workspaceUnits[workspaceId], 3);
    assert.equal(visibleCases(row).size, 1);
  }
});

test('a blank slot sharing a D footprint remains separate from both collapsed and expanded cases', () => {
  const projects = [project('O-101'), project('O-102')];
  const slots = [{ workspaceId: 'D', start: '2026-10', end: '2026-10-31' }];
  const baseline = buildTimelineLayout(projects, workspaces, firstDay, options).rows[3];
  for (const expandedStacks of [new Set(), new Set([baseline.stacks[0].key])]) {
    const row = buildTimelineLayout(projects, workspaces, firstDay, { ...options, expandedStacks, reservationSlots: slots }).rows[3];
    assert.equal(row.stacks.length, 1);
    assert.equal(row.stacks[0].count, 2);
    assert.equal(row.stacks[0].key, baseline.stacks[0].key);
    assert.equal(row.blocks.length, 2);
    assert.equal(visibleCases(row).size, 2);
    assert.equal(row.reservationSlots.length, 1);
    const slot = { ...row.reservationSlots[0], height: 48 };
    for (const block of row.blocks.filter((item) => !item.stackHidden)) {
      const decoration = expandedStacks.size ? 0 : row.stacks[0].decorationOffsetPx;
      assert.equal(collides(slot, { left: block.left, width: block.width + decoration, top: block.top, height: 48 + decoration }), false);
    }
    if (expandedStacks.size) {
      const stack = row.stacks[0];
      assert.equal(collides(slot, { left: stack.collapseTrackRight - 44, width: 44, top: stack.collapseTop, height: 44 }), false);
    }
  }
});

test('short D back cards and bottom controls reserve their display space against an adjacent slot', () => {
  const projects = Array.from({ length: 8 }, (_, index) => project('O-' + (101 + index), { start: '2026-10-01', end: '2026-10-01' }));
  const slots = [{ workspaceId: 'D', start: '2026-10-02', end: '2026-10-02' }];
  const baseline = buildTimelineLayout(projects, workspaces, firstDay, options).rows[3];
  for (const expandedStacks of [new Set(), new Set([baseline.stacks[0].key])]) {
    const row = buildTimelineLayout(projects, workspaces, firstDay, { ...options, reservationSlots: slots, expandedStacks }).rows[3];
    const stack = row.stacks[0], slot = { ...row.reservationSlots[0], height: 48 };
    for (const block of stack.blocks.filter((item) => !item.stackHidden)) {
      const offset = stack.expanded ? 0 : stack.decorationOffsetPx;
      assert.equal(collides(slot, { left: block.left, width: block.width + offset, top: block.top, height: 48 + offset }), false);
    }
    if (stack.expanded) assert.equal(collides(slot, { left: stack.collapseTrackRight - 44, width: 44, top: stack.collapseTop, height: 44 }), false);
  }
});

test('historic per-case tracking remains visible and independently clickable beside a current blank slot', () => {
  const projects = [project('O-101', { start: '2026-09-01', end: '2026-09-30', followUp: ['payment'] })];
  const slots = [{ workspaceId: 'D', start: '2026-11', end: '2026-11' }];
  const row = buildTimelineLayout(projects, workspaces, timelineDay('2026-11-01'), { ...options, today: timelineDay('2026-11-15'), reservationSlots: slots }).rows[3];
  assert.equal(row.blocks.length, 0);
  assert.equal(row.stacks.length, 0);
  assert.equal(row.reservationSlots.length, 1);
  assert.equal(row.followUps.length, 1);
  const tracking = row.followUps[0];
  assert.equal(tracking.project.id, 'O-101');
  assert.equal(tracking.endpointVisible, true);
  assert.equal(tracking.clippedStart, true);
  assert.equal(visibleCases(row).size, 1);
  assert.equal(collides({ ...row.reservationSlots[0], height: 48 }, { left: tracking.left + tracking.width - 22, width: 44, top: tracking.top - 22, height: 44 }), false);
});

test('month and day precision, clipping, leap February, and invalid/offscreen ranges retain the existing date rules', () => {
  const slots = [
    { workspaceId: 'D', start: '2028-02', end: '2028-02' },
    { workspaceId: 'D', start: '2028-03-02', end: '2028-03-03' },
    { workspaceId: 'D', start: '2027-02-29', end: '2027-02-29' },
    { workspaceId: 'D', start: '2028-04', end: '2028-03' },
    { workspaceId: 'D', start: '2029-01', end: '2029-01' },
  ];
  for (const viewportWidth of [212, 900]) {
    const scale = timelineScale(viewportWidth), inset = Math.min(2, scale.dayWidth * .12);
    const row = buildTimelineLayout([], workspaces, timelineDay('2028-02-15'), { ...scale, days: 30, reservationSlots: slots }).rows[3];
    assert.equal(row.reservationSlots.length, 2);
    const [month, day] = row.reservationSlots;
    assert.equal(month.first, timelineDay('2028-02-01'));
    assert.equal(month.last, timelineDay('2028-02-29'));
    assert.equal(month.start, '2028-02');
    assert.equal(month.left, inset);
    assert.equal(month.width, 15 * scale.dayWidth - 2 * inset);
    assert.equal(month.startPrecision, 'month');
    assert.equal(day.startPrecision, 'day');
    assert.equal(day.width, 2 * scale.dayWidth - 2 * inset);
    assert.equal(day.top, month.top);
  }
});

test('overlapping non-case slots use separate lanes and no adjacent slots are merged', () => {
  const slots = [
    { workspaceId: 'B', start: '2026-11-01', end: '2026-11-05' },
    { workspaceId: 'B', start: '2026-11-05', end: '2026-11-10' },
    { workspaceId: 'B', start: '2026-11-11', end: '2026-11-20' },
  ];
  const row = buildTimelineLayout([], workspaces, firstDay, { ...options, reservationSlots: slots }).rows[1];
  assert.equal(row.reservationSlots.length, 3);
  assert.notEqual(row.reservationSlots[0].top, row.reservationSlots[1].top);
  assert.equal(row.reservationSlots[0].top, row.reservationSlots[2].top);
  assert.equal(row.blocks.length, 0);
});

test('omitting slots and passing an empty list produce the same original layout shape', () => {
  const projects = [project('O-101'), project('O-102'), project('C-101', { workspaceIds: ['A'], workspaceUnits: { A: 2 } })];
  const baseline = buildTimelineLayout(projects, workspaces, firstDay, options);
  const empty = buildTimelineLayout(projects, workspaces, firstDay, { ...options, reservationSlots: [] });
  assert.equal(JSON.stringify(empty), JSON.stringify(baseline));
  assert.ok(baseline.rows.every((row) => !Object.hasOwn(row, 'reservationSlots')));
  const withDSlot = buildTimelineLayout(projects, workspaces, firstDay, { ...options, reservationSlots: [{ workspaceId: 'D', start: '2026-11', end: '2026-11' }] });
  const earlierRows = withDSlot.rows.slice(0, 3).map(({ reservationSlots, ...row }) => {
    assert.deepEqual(reservationSlots, []);
    return row;
  });
  assert.equal(JSON.stringify(earlierRows), JSON.stringify(baseline.rows.slice(0, 3)));
});
