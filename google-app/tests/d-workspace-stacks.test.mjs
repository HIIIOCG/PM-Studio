import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimelineLayout, timelineDay, timelineScale } from '../../web/dist/app.mjs';

const workspaces = ['A', 'B', 'C', 'D'].map((id) => ({ id, name: 'Workspace ' + id }));
const firstDay = timelineDay('2026-10-01');
const options = { dayWidth: 10, days: 90, today: timelineDay('2026-10-20') };
function project(id, overrides = {}) {
  return { id, customerCode: '', customerType: '', owner: '', status: '', deliveryGoal: '', notes: '', deliverySteps: '',
    start: '2026-10', end: '2026-10-31', correctionStart: '', correctionEnd: '', scheduleKind: 'production', followUp: [],
    workspaceIds: ['D'], workspaceUnits: { D: 1 }, pendingReasons: [], ...overrides };
}
function dRow(projects, changes = {}, first = firstDay) {
  return buildTimelineLayout(projects, workspaces, first, { ...options, ...changes }).rows[3];
}
function phaseGeometry(block) {
  return [block.project.id, block.phase, block.start, block.end, block.startPrecision, block.endPrecision, block.first, block.last, block.dateLeft ?? block.left, block.dateWidth ?? block.width];
}
function collapseBox(stack) {
  return { left: stack.collapseTrackRight - 44, right: stack.collapseTrackRight, top: stack.collapseTop, bottom: stack.collapseTop + 44 };
}
function overlaps(first, second) {
  return first.left < second.right && second.left < first.right && first.top < second.bottom && second.top < first.bottom;
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); }
  return value;
}

test('D exact footprints collapse by unique project while retaining all original blocks and allocation data', () => {
  const projects = freeze([project('O-103'), project('O-101', { workspaceUnits: { D: 4 } }), project('O-102')]);
  const original = JSON.stringify(projects);
  const row = dRow(projects);
  assert.equal(row.stacks.length, 1);
  const stack = row.stacks[0];
  assert.equal(stack.count, 3);
  assert.equal(stack.expanded, false);
  assert.deepEqual(stack.projects.map((item) => item.id), ['O-101', 'O-102', 'O-103']);
  assert.equal(row.blocks.length, 3);
  assert.equal(row.blocks.filter((block) => !block.stackHidden).length, 1);
  assert.equal(stack.representative.project.id, 'O-101');
  assert.strictEqual(stack.representatives[0], stack.representative);
  assert.ok(row.blocks.every((block) => block.dateWidth === 31 * 10 - 2.4 && block.width + block.visualInsetPx === block.dateWidth && block.stackKey === stack.key));
  assert.equal(row.height, 88);
  assert.equal(stack.left, stack.representative.left);
  assert.equal(stack.width, stack.representative.width);
  assert.equal(JSON.stringify(projects), original);
  assert.equal(dRow([project('O-100', { workspaceUnits: { D: 9 } })]).stacks.length, 0);
});

test('expanded members start without a header gap and have a dedicated bottom control', () => {
  const projects = [project('O-101'), project('O-102'), project('O-103', { start: '2026-11', end: '2026-11-30' }), project('O-104', { start: '2026-11', end: '2026-11-30' })];
  const collapsed = dRow(projects);
  const key = collapsed.stacks[0].key;
  const expanded = dRow(projects, { expandedStacks: new Set([key]) });
  assert.deepEqual(expanded.blocks.map(phaseGeometry), collapsed.blocks.map(phaseGeometry));
  const stack = expanded.stacks.find((item) => item.key === key);
  assert.equal(stack.expanded, true);
  assert.ok(stack.blocks.every((block) => !block.stackHidden));
  assert.equal(new Set(stack.blocks.map((block) => block.lane)).size, 2);
  assert.equal(Math.min(...stack.blocks.map((block) => block.top)), collapsed.stacks[0].representative.top);
  assert.equal(stack.top, Math.min(...stack.blocks.map((block) => block.top)));
  assert.ok(stack.collapseTop >= Math.max(...stack.blocks.map((block) => block.top + 48)) + 22);
  assert.ok(stack.collapseTop + 44 <= expanded.top + expanded.height);
  assert.equal(expanded.stacks[1].expanded, false);
  assert.equal(expanded.stacks[1].blocks.filter((block) => !block.stackHidden).length, 1);
  assert.ok(expanded.height > collapsed.height);
  assert.equal(stack.controlsId, collapsed.stacks[0].controlsId);
});

test('a complete production and correction footprint stacks together while keeping each representative phase', () => {
  for (const correctionStart of ['2026-11-05', '2026-10-20', '2026-09-20']) {
    const projects = [project('O-101', { correctionStart, correctionEnd: '2026-11-09' }), project('O-102', { correctionStart, correctionEnd: '2026-11-09' })];
    const row = dRow(projects);
    const stack = row.stacks[0];
    assert.equal(stack.count, 2);
    assert.equal(stack.blocks.length, 4);
    assert.deepEqual(stack.representatives.map((block) => block.phase), ['production', 'correction']);
    assert.deepEqual(row.blocks.filter((block) => !block.stackHidden), stack.representatives);
    assert.equal(stack.top, stack.representative.top);
    const expanded = dRow(projects, { expandedStacks: new Set([stack.key]) });
    assert.deepEqual(expanded.blocks.map(phaseGeometry), row.blocks.map(phaseGeometry));
    assert.ok(expanded.blocks.every((block) => !block.stackHidden));
    const representativePhases = expanded.blocks.filter((block) => block.project.id === 'O-101');
    assert.equal(representativePhases[0].lane === representativePhases[1].lane, correctionStart === '2026-11-05');
  }
});

test('partial overlap, adjacency, phase differences, and equal drawing bounds with different precision do not stack', () => {
  const base = project('O-101');
  for (const overrides of [
    { start: '2026-10-15' },
    { start: '2026-11', end: '2026-11-30' },
    { start: '2026-10-01' },
    { end: '2026-10' },
    { scheduleKind: 'reservation' },
    { correctionStart: '2026-11-01', correctionEnd: '2026-11-03' },
    { correctionStart: '2026-11-01', correctionEnd: '' },
  ]) {
    const row = dRow([base, project('O-102', overrides)]);
    assert.equal(row.stacks.length, 0, JSON.stringify(overrides));
    assert.ok(row.blocks.every((block) => !Object.hasOwn(block, 'stackKey')));
  }
  const reservations = dRow([project('O-101', { scheduleKind: 'reservation' }), project('O-102', { scheduleKind: 'reservation' })]);
  assert.equal(reservations.stacks.length, 1);
  assert.ok(reservations.stacks[0].blocks.every((block) => block.phase === 'reservation'));
});

test('every tracking line keeps its own project, anchor lane, and clickable endpoint across collapse and expansion', () => {
  const projects = [project('O-101'), project('O-102', { followUp: ['payment'] }), project('O-103', { followUp: ['customer-confirmation'], correctionStart: '', correctionEnd: '' })];
  const changes = { today: timelineDay('2026-11-05') };
  const collapsed = dRow(projects, changes);
  const expanded = dRow(projects, { ...changes, expandedStacks: new Set([collapsed.stacks[0].key]) });
  for (const row of [collapsed, expanded]) {
    assert.equal(row.followUps.length, 2);
    assert.equal(new Set(row.followUps.map((item) => item.lane)).size, 2);
    assert.deepEqual(row.followUps.map((item) => item.project.id), ['O-102', 'O-103']);
    for (const followUp of row.followUps) {
      assert.equal(followUp.endpointVisible, true);
      assert.equal(followUp.first, timelineDay('2026-11-01'));
      assert.equal(followUp.last, timelineDay('2026-11-05'));
      assert.equal(Object.hasOwn(followUp, 'stackHidden'), false);
      const anchor = row.blocks.find((block) => block.project.id === followUp.project.id && block.phase === followUp.anchor.phase);
      assert.equal(followUp.top, anchor.top + 24);
      assert.equal(followUp.left, (anchor.dateLeft ?? anchor.left) + (anchor.dateWidth ?? anchor.width));
      assert.ok(followUp.top + 22 <= row.top + row.height);
    }
  }
  assert.deepEqual(collapsed.followUps.map((item) => [item.project.id, item.first, item.last, item.left, item.width]), expanded.followUps.map((item) => [item.project.id, item.first, item.last, item.left, item.width]));
  assert.notEqual(collapsed.followUps[0].lane, collapsed.stacks[0].representative.lane);
});

test('waiting intervals never create a stack and historic endpoints survive offscreen production', () => {
  const projects = [project('O-101', { start: '2026-08-01', end: '2026-08-31', followUp: ['payment'] }), project('O-102', { start: '2026-08-15', end: '2026-08-31', followUp: ['payment'] })];
  const row = dRow(projects);
  assert.equal(row.stacks.length, 0);
  assert.equal(row.blocks.length, 0);
  assert.equal(row.followUps.length, 2);
  assert.ok(row.followUps.every((item) => item.clippedStart && item.endpointVisible));
  const sameFootprint = dRow([projects[0], { ...projects[0], id: 'O-103' }]);
  assert.equal(sameFootprint.stacks.length, 0);
  assert.equal(sameFootprint.followUps.length, 2);
});

test('keys and membership survive resize, clipping, phase visibility changes, and input ordering', () => {
  const projects = [project('O-102', { correctionStart: '2026-11-05', correctionEnd: '2026-11-09' }), project('O-101', { correctionStart: '2026-11-05', correctionEnd: '2026-11-09' })];
  const original = dRow(projects);
  const key = original.stacks[0].key;
  for (const width of [212, 900]) {
    const row = dRow([...projects].reverse(), { ...timelineScale(width), days: 20, expandedStacks: new Set([key]) }, timelineDay('2026-11-01'));
    assert.equal(row.stacks[0].key, key);
    assert.equal(row.stacks[0].controlsId, original.stacks[0].controlsId);
    assert.equal(row.stacks[0].count, 2);
    assert.equal(row.stacks[0].expanded, true);
    assert.deepEqual(row.stacks[0].representatives.map((block) => block.phase), ['correction']);
    assert.equal(row.blocks.length, 2);
  }
});

test('D stacks leave A/B/C rows byte-identical, including a project assigned to D and A', () => {
  const projects = [project('O-101', { workspaceIds: ['A', 'D'], workspaceUnits: { A: 3, D: 1 } }), project('O-102', { workspaceIds: ['A', 'D'], workspaceUnits: { A: 2, D: 1 } })];
  const collapsed = buildTimelineLayout(projects, workspaces, firstDay, options);
  const key = collapsed.rows[3].stacks[0].key;
  const expanded = buildTimelineLayout(projects, workspaces, firstDay, { ...options, expandedStacks: new Set([key]) });
  assert.equal(JSON.stringify(collapsed.rows.slice(0, 3)), JSON.stringify(expanded.rows.slice(0, 3)));
  assert.equal(collapsed.rows[0].blocks.length, 2);
  assert.notEqual(collapsed.rows[0].blocks[0].lane, collapsed.rows[0].blocks[1].lane);
  assert.ok(collapsed.rows.slice(0, 3).every((row) => !Object.hasOwn(row, 'stacks')));
  assert.ok(collapsed.rows[0].blocks.every((block) => !Object.hasOwn(block, 'stackHidden')));
});

test('adjacent one-day stacks reserve the bottom icon width without stretching dates', () => {
  const projects = ['2026-10-01', '2026-10-02', '2026-10-20'].flatMap((date, index) => [
    project('O-' + (101 + index * 2), { start: date, end: date }),
    project('O-' + (102 + index * 2), { start: date, end: date }),
  ]);
  const original = JSON.stringify(projects);
  for (const viewportWidth of [212, 900]) {
    const scale = timelineScale(viewportWidth);
    const collapsed = dRow(projects, scale);
    assert.equal(collapsed.stacks[2].representative.lane, collapsed.stacks[0].representative.lane, 'later work reuses the lane after the back cards end');
    for (const expandedKeys of [[collapsed.stacks[0].key], collapsed.stacks.map((stack) => stack.key)]) {
      const row = dRow(projects, { ...scale, expandedStacks: new Set(expandedKeys) });
      assert.deepEqual(row.blocks.map(phaseGeometry), collapsed.blocks.map(phaseGeometry));
      const first = row.stacks[0], next = row.stacks[1];
      assert.equal(first.collapseTrackWidth, 44);
      const control = collapseBox(first);
      assert.ok(next.left < control.right, 'this fixture would overlap horizontally if the control lane were reused');
      for (const block of next.blocks.filter((item) => !item.stackHidden)) {
        assert.equal(overlaps(control, { left: block.left, right: block.left + block.width, top: block.top, bottom: block.top + 48 }), false);
      }
      if (next.expanded) assert.equal(overlaps(control, collapseBox(next)), false);
      assert.equal(row.stacks[2].top, row.stacks[0].top, 'later work can reuse the lane after the real control track ends');
      assert.ok(row.blocks.every((block) => block.width < 44), 'the actual one-day bars retain their true short width');
    }
  }
  assert.equal(JSON.stringify(projects), original);
});

test('a correction-only visible stack reserves its bottom control at the clipped work position', () => {
  const historical = { start: '2026-09-01', end: '2026-09-30', correctionStart: '2026-10-01', correctionEnd: '2026-10-01' };
  const projects = [project('O-101', historical), project('O-102', historical), project('O-103', { start: '2026-10-02', end: '2026-10-02' })];
  const collapsed = dRow(projects);
  const row = dRow(projects, { expandedStacks: new Set([collapsed.stacks[0].key]) });
  const stack = row.stacks[0];
  assert.deepEqual(stack.representatives.map((block) => block.phase), ['correction']);
  assert.equal(stack.left, 1.2);
  assert.equal(stack.collapseTrackLeft, 1.2);
  assert.equal(stack.collapseTrackWidth, 44);
  assert.deepEqual(row.blocks.map(phaseGeometry), collapsed.blocks.map(phaseGeometry));
  const next = row.blocks.find((block) => block.project.id === 'O-103');
  const control = collapseBox(stack);
  assert.ok(next.left < control.right);
  assert.equal(overlaps(control, { left: next.left, right: next.left + next.width, top: next.top, bottom: next.top + 48 }), false);
});

test('one bottom control spans the work footprint, excludes waiting, and clears every member and tracking endpoint', () => {
  const projects = [project('O-101', { start: '2026-10-01', end: '2026-10-03', correctionStart: '2026-10-05', correctionEnd: '2026-10-06', followUp: ['payment'] }),
    project('O-102', { start: '2026-10-01', end: '2026-10-03', correctionStart: '2026-10-05', correctionEnd: '2026-10-06', followUp: ['customer-confirmation'] })];
  const original = JSON.stringify(projects);
  const collapsed = dRow(projects);
  const row = dRow(projects, { expandedStacks: new Set([collapsed.stacks[0].key]) });
  const stack = row.stacks[0], control = collapseBox(stack);
  assert.equal(row.stacks.length, 1);
  assert.deepEqual(stack.representatives.map((block) => block.phase), ['production', 'correction']);
  assert.equal(stack.top, collapsed.stacks[0].representative.top);
  assert.equal(stack.collapseTrackLeft, Math.min(...stack.blocks.map((block) => block.left)));
  assert.ok(Math.abs(stack.collapseTrackRight - Math.max(...stack.blocks.map((block) => block.left + block.width))) < 1e-9);
  assert.ok(row.followUps.every((item) => item.left + item.width > stack.collapseTrackRight));
  for (const block of row.blocks) {
    assert.equal(overlaps(control, { left: block.left, right: block.left + block.width, top: block.top, bottom: block.top + 48 }), false);
  }
  for (const followUp of row.followUps) {
    assert.ok(stack.collapseTop >= followUp.top + 22);
    assert.equal(overlaps(control, { left: followUp.left + followUp.width - 22, right: followUp.left + followUp.width + 22, top: followUp.top - 22, bottom: followUp.top + 22 }), false);
  }
  assert.ok(control.bottom <= row.top + row.height);
  assert.deepEqual(row.blocks.map(phaseGeometry), collapsed.blocks.map(phaseGeometry));
  assert.equal(JSON.stringify(projects), original);
});

test('every collapsed case has one visible card layer and large diagonal stacks remain inside the row', () => {
  for (const count of [2, 4, 5, 8, 19]) {
    const projects = Array.from({ length: count }, (_, index) => project('O-' + (101 + index)));
    const row = dRow(projects);
    const stack = row.stacks[0];
    assert.equal(stack.count, count);
    assert.equal(stack.layerOffsetPx, 6);
    assert.equal(stack.decorationOffsetPx, (count - 1) * 6);
    assert.equal(stack.blocks.length, count);
    assert.ok(stack.representative.top + 48 + stack.decorationOffsetPx <= row.top + row.height);
    const expanded = dRow(projects, { expandedStacks: new Set([stack.key]) });
    assert.deepEqual(expanded.blocks.map(phaseGeometry), row.blocks.map(phaseGeometry));
  }
});

test('large collapsed back cards cannot cover an adjacent short case at either display scale', () => {
  const projects = Array.from({ length: 8 }, (_, index) => project('O-' + (101 + index), { start: '2026-10-01', end: '2026-10-01' }));
  projects.push(project('O-109', { start: '2026-10-02', end: '2026-10-02' }));
  for (const viewportWidth of [212, 900]) {
    const scale = timelineScale(viewportWidth);
    const row = dRow(projects, scale);
    const stack = row.stacks[0], representative = stack.representative;
    const next = row.blocks.find((block) => block.project.id === 'O-109');
    assert.ok(next.left < representative.left + representative.width + stack.decorationOffsetPx);
    assert.ok(next.top >= representative.top + 48 + stack.decorationOffsetPx + 4);
    assert.ok(row.blocks.every((block) => block.width === scale.dayWidth - 2 * Math.min(2, scale.dayWidth * .12)));
    const expanded = dRow(projects, { ...scale, expandedStacks: new Set([stack.key]) });
    assert.deepEqual(expanded.blocks.map(phaseGeometry), row.blocks.map(phaseGeometry));
  }
});

test('diagonal decoration separates adjacent production and correction phases while tracking stays per case', () => {
  const projects = Array.from({ length: 8 }, (_, index) => project('O-' + (101 + index), {
    start: '2026-10-01', end: '2026-10-01', correctionStart: '2026-10-02', correctionEnd: '2026-10-02',
    followUp: index === 0 || index === 3 ? ['payment'] : [],
  }));
  const row = dRow(projects);
  const stack = row.stacks[0];
  const [production, correction] = stack.representatives;
  assert.equal(production.phase, 'production');
  assert.equal(correction.phase, 'correction');
  assert.ok(correction.left < production.left + production.width + stack.decorationOffsetPx);
  assert.ok(correction.top >= production.top + 48 + stack.decorationOffsetPx + 4);
  assert.equal(row.followUps.length, 2);
  assert.equal(new Set(row.followUps.map((item) => item.lane)).size, 2);
  for (const followUp of row.followUps) {
    const anchor = row.blocks.find((block) => block.project.id === followUp.project.id && block.phase === 'correction');
    assert.equal(followUp.top, anchor.top + 24);
    assert.equal(followUp.endpointVisible, true);
    assert.equal(Object.hasOwn(followUp, 'stackHidden'), false);
    assert.ok(followUp.top + 22 <= row.top + row.height);
  }
  assert.ok(correction.top + 48 + stack.decorationOffsetPx <= row.top + row.height);
  const expanded = dRow(projects, { expandedStacks: new Set([stack.key]) });
  assert.deepEqual(expanded.blocks.map(phaseGeometry), row.blocks.map(phaseGeometry));
  assert.deepEqual(expanded.followUps.map((item) => [item.project.id, item.first, item.last, item.left, item.width]), row.followUps.map((item) => [item.project.id, item.first, item.last, item.left, item.width]));
});

test('adjacent July, August and September stacks share one lane at narrow and wide scales with their complete silhouettes inside the real months', () => {
  const months = [['2026-07', '2026-07-31'], ['2026-08', '2026-08-31'], ['2026-09', '2026-09-30']];
  const projects = freeze(months.flatMap(([start, end], index) => [project('O-' + (101 + index * 2), { start, end }), project('O-' + (102 + index * 2), { start, end })]));
  const original = JSON.stringify(projects);
  for (const viewportWidth of [212, 350, 560, 900, 1428]) {
    const scale = timelineScale(viewportWidth);
    const row = dRow(projects, { ...scale, days: 120 }, timelineDay('2026-07-01'));
    assert.equal(row.stacks.length, 3);
    assert.equal(new Set(row.stacks.map((stack) => stack.representative.lane)).size, 1);
    assert.equal(row.height, 88);
    for (const [index, stack] of row.stacks.entries()) {
      const block = stack.representative;
      assert.equal(stack.count, 2);
      assert.equal(block.visualInsetPx, 6);
      assert.equal(block.left, block.dateLeft);
      assert.equal(block.width + block.visualInsetPx, block.dateWidth);
      assert.ok(Math.abs(block.left + block.width + stack.decorationOffsetPx - block.dateLeft - block.dateWidth) < 1e-9);
      assert.equal(block.start, months[index][0]);
      assert.equal(block.startPrecision, 'month');
      assert.equal(block.end, months[index][1]);
      if (index) {
        const previous = row.stacks[index - 1];
        assert.ok(previous.representative.left + previous.representative.width + previous.decorationOffsetPx <= block.left);
      }
    }
    const expanded = dRow(projects, { ...scale, days: 120, expandedStacks: new Set(row.stacks.map((stack) => stack.key)) }, timelineDay('2026-07-01'));
    assert.deepEqual(expanded.blocks.map(phaseGeometry), row.blocks.map(phaseGeometry));
    assert.ok(expanded.blocks.every((block) => block.width === block.dateWidth && !Object.hasOwn(block, 'visualInsetPx')));
  }
  assert.equal(JSON.stringify(projects), original);
});

test('visual compaction never puts genuinely overlapping project periods in the same lane', () => {
  const projects = [project('O-101'), project('O-102'),
    project('O-103', { start: '2026-10-20', end: '2026-11-20' }), project('O-104', { start: '2026-10-20', end: '2026-11-20' })];
  for (const viewportWidth of [212, 900]) {
    const row = dRow(projects, timelineScale(viewportWidth));
    assert.equal(row.stacks.length, 2);
    assert.notEqual(row.stacks[0].representative.lane, row.stacks[1].representative.lane);
    assert.ok(row.stacks.every((stack) => stack.representative.visualInsetPx === 6));
  }
});

test('each long production and correction phase compacts separately, preserves the gap, and keeps waiting at the true end', () => {
  const projects = Array.from({ length: 3 }, (_, index) => project('O-' + (101 + index), {
    start: '2026-07', end: '2026-07-31', correctionStart: '2026-08-02', correctionEnd: '2026-08-31', followUp: index < 2 ? ['payment'] : [],
  }));
  const first = timelineDay('2026-07-01');
  for (const viewportWidth of [212, 900]) {
    const changes = { ...timelineScale(viewportWidth), days: 120, today: timelineDay('2026-09-05') };
    const row = dRow(projects, changes, first);
    const stack = row.stacks[0], [production, correction] = stack.representatives;
    assert.equal(stack.representatives.length, 2);
    assert.equal(production.lane, correction.lane);
    assert.equal(production.visualInsetPx, 12);
    assert.equal(correction.visualInsetPx, 12);
    assert.ok(production.left + production.width + stack.decorationOffsetPx < correction.left, 'the real phase gap stays empty');
    assert.equal(row.followUps.length, 2);
    assert.equal(new Set(row.followUps.map((item) => item.lane)).size, 2);
    for (const followUp of row.followUps) {
      const anchor = row.blocks.find((block) => block.project.id === followUp.project.id && block.phase === 'correction');
      assert.equal(followUp.first, timelineDay('2026-09-01'));
      assert.ok(Math.abs(followUp.left - anchor.dateLeft - anchor.dateWidth) < 1e-9);
      assert.ok(followUp.left > anchor.left + anchor.width, 'waiting does not start at the shortened front card');
      assert.equal(followUp.top, anchor.top + 24);
    }
    const expanded = dRow(projects, { ...changes, expandedStacks: new Set([stack.key]) }, first);
    assert.deepEqual(expanded.blocks.map(phaseGeometry), row.blocks.map(phaseGeometry));
    assert.deepEqual(expanded.followUps.map((item) => [item.project.id, item.first, item.last, item.left, item.width]), row.followUps.map((item) => [item.project.id, item.first, item.last, item.left, item.width]));
  }
});

test('short cases inset only their available visual space and reserve remaining decoration instead of producing zero or negative bars', () => {
  for (const days of [1, 5, 10]) {
    const end = '2026-10-' + String(days).padStart(2, '0');
    const nextDay = '2026-10-' + String(days + 1).padStart(2, '0');
    const projects = Array.from({ length: 8 }, (_, index) => project('O-' + (101 + index), { start: '2026-10-01', end }));
    projects.push(project('O-109', { start: nextDay, end: nextDay }));
    const row = dRow(projects);
    const stack = row.stacks[0], block = stack.representative;
    const expectedWidth = days * options.dayWidth - 2.4;
    const expectedInset = Math.min(stack.decorationOffsetPx, Math.max(0, expectedWidth - 44));
    assert.equal(block.dateWidth, expectedWidth);
    assert.equal(block.visualInsetPx, expectedInset);
    assert.equal(block.width, expectedWidth - expectedInset);
    assert.ok(block.width >= Math.min(44, expectedWidth));
    const next = row.blocks.find((item) => item.project.id === 'O-109');
    if (expectedInset === stack.decorationOffsetPx) {
      assert.equal(block.lane, next.lane);
      assert.ok(block.left + block.width + stack.decorationOffsetPx <= next.left);
    } else {
      assert.ok(next.top >= block.top + 48 + stack.decorationOffsetPx + 4);
    }
    assert.equal(Object.hasOwn(next, 'dateWidth'), false, 'single D cases retain their original shape');
  }
});
