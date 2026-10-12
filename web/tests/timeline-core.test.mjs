import test from 'node:test';
import assert from 'node:assert/strict';
import { WORKSPACES, parseDay, formatDay, taipeiToday, getProjectDates, adaptSheetRows, clipBlock, planBlocks } from '../../scripts/timeline-core.mjs';

// Fictional records exercise date and resource layout rules without real project data.
const project = overrides => ({
  id: 'C-001', name: '測試案甲', goal: '交付測試成果', status: '製作中',
  start: '2026-10-01', end: '2026-10-20', originalStart: '2026-09-01', originalEnd: '2026-09-30',
  correctionStart: '', correctionEnd: '', supplement: '', dateBasis: 'current',
  workspaceIds: ['A'], workspaceUnits: { A: 1 }, ...overrides,
});
const header = ['案號', '目前交付目標', '專案／範圍', '客戶', '負責人', '狀態', '原始開始', '原始結束',
  '延長修正／補充', '交付步驟（參考）', '資料', '窗口', '執行者', '目前排程開始', '目前排程結束', '修正開始', '修正結束', '對外匿名名稱'];
const sheetRow = (id, start, end, edits = {}) => {
  const values = { 案號: id, 目前交付目標: '交付測試成果', '專案／範圍': '測試案甲｜2角色\n衣裝與配件',
    客戶: '測試客戶', 負責人: 'A', 狀態: '製作中', 原始開始: start, 原始結束: end, 執行者: 'B',
    資料: 'https://drive.google.com/file/test', 對外匿名名稱: '專案 001', ...edits };
  return header.map(name => values[name] ?? '');
};

test('parseDay accepts real ISO days and keeps leap days and cross-year distances exact', () => {
  assert.equal(parseDay('2026-01-01'), Date.parse('2026-01-01T00:00:00Z') / 86400000);
  assert.equal(parseDay('2024-03-01') - parseDay('2024-02-28'), 2);
  assert.equal(parseDay('2027-01-01') - parseDay('2026-12-31'), 1);
  assert.equal(parseDay('2000-02-29') - parseDay('2000-02-28'), 1);
});

test('parseDay never guesses a month, missing day, normalized invalid day, or locale date', () => {
  for (const value of [undefined, null, '', '待確認', '2026-09', '2026-1-01', '2026-01-1',
    '2026/01/01', '2026-02-29', '2026-02-30', '1900-02-29', '2026-13-01', '2026-00-10',
    '2026-01-00', ' 2026-01-01', '2026-01-01 ', '2026-01-01T00:00:00Z', 20260101]) {
    assert.equal(parseDay(value), null, String(value));
  }
});

test('taipeiToday changes at UTC 16:00 and crosses months and years without host timezone dependence', () => {
  assert.equal(taipeiToday(new Date('2026-10-12T15:59:59.999Z')), '2026-10-12');
  assert.equal(taipeiToday(new Date('2026-10-12T16:00:00.000Z')), '2026-10-13');
  assert.equal(taipeiToday(new Date('2026-12-31T16:00:00.000Z')), '2027-01-01');
  assert.equal(taipeiToday(new Date('2024-02-28T16:00:00.000Z')), '2024-02-29');
});

test('formatDay reverses UTC day parsing and rejects non-integer dates', () => {
  for (const value of ['2024-02-29', '2026-12-31', '2027-01-01']) assert.equal(formatDay(parseDay(value)), value);
  assert.throws(() => formatDay(1.5), /整數日期/);
});

test('current schedule wins and only two empty current dates allow original fallback', () => {
  const current = project();
  assert.deepEqual(getProjectDates(current), { start: '2026-10-01', end: '2026-10-20',
    startDay: parseDay('2026-10-01'), endDay: parseDay('2026-10-20'), basis: 'current' });
  const original = project({ start: '', end: '', originalStart: '2026-12-20', originalEnd: '2027-01-08' });
  const before = structuredClone(original);
  assert.equal(getProjectDates(original).basis, 'original');
  assert.equal(getProjectDates(original).end, '2027-01-08');
  assert.deepEqual(original, before);
  assert.equal(getProjectDates(project({ end: '' })), null);
  assert.equal(getProjectDates(project({ start: 'wrong', end: '2026-10-20' })), null);
});

test('rescheduled or unconfirmed notes stop original fallback while full current dates remain usable', () => {
  for (const supplement of ['改期到下個月', '延期', '修正日期待確認', '尚未確認排程', '新終點待定', '待排']) {
    assert.equal(getProjectDates(project({ start: '', end: '', supplement })), null, supplement);
    assert.equal(getProjectDates(project({ supplement })).basis, 'current', supplement);
  }
});

test('month-only, partial, invalid, and inverted production dates remain pending', () => {
  for (const dates of [
    { start: '2026-10', end: '2026-11' }, { start: '2026-10-01', end: '' },
    { start: '2026-10-20', end: '2026-10-01' }, { start: '2026-02-29', end: '2026-03-01' },
    { start: '', end: '', originalStart: '2026-10', originalEnd: '2026-11' },
  ]) {
    const input = project(dates);
    const before = structuredClone(input);
    const plan = planBlocks([input]);
    assert.deepEqual(plan.blocks, []);
    assert.ok(plan.pending.some(item => item.projectId === 'C-001'));
    assert.deepEqual(input, before);
  }
});

test('sheet adapter maps current A:R data without guessing workspaces from owners or executors', () => {
  const rows = [header, sheetRow('C-001', '2026-09-01', '2026-09-30', {
    目前排程開始: '2026-10-01', 目前排程結束: '2026-10-20', 修正開始: '2026-10-21', 修正結束: '2026-10-30',
  })];
  const before = structuredClone(rows);
  const [adapted] = adaptSheetRows(rows);
  assert.equal(adapted.id, 'C-001');
  assert.equal(adapted.name, '測試案甲');
  assert.equal(adapted.requirements, '2角色；衣裝與配件');
  assert.equal(adapted.start, '2026-10-01');
  assert.equal(adapted.correctionStart, '2026-10-21');
  assert.equal(adapted.owner, 'A');
  assert.equal(adapted.executor, 'B');
  assert.deepEqual(adapted.workspaceIds, []);
  assert.deepEqual(adapted.sourceLinks, []);
  assert.deepEqual(rows, before);
  assert.equal(planBlocks([adapted]).unassigned.length, 1);
});

test('adapter supports explicit name and requirements fields and stable date/id sorting', () => {
  const sorted = adaptSheetRows([header,
    sheetRow('C-003', '2026-10', ''), sheetRow('C-002', '2026-01-01', '2026-01-20'),
    sheetRow('C-001', '2026-01-01', '2026-01-20'), Array(18).fill(''),
  ]);
  assert.deepEqual(sorted.map(item => item.id), ['C-001', 'C-002', 'C-003']);
  assert.equal(sorted[0].dateBasis, 'original');
  const explicit = [...header];
  explicit[2] = '專案名稱';
  explicit.push('專案需求');
  const row = sheetRow('C-001', '2026-01-01', '2026-01-20');
  row[2] = '明確案名';
  row.push('提供模型白模');
  const [adapted] = adaptSheetRows([explicit, row]);
  assert.equal(adapted.name, '明確案名');
  assert.equal(adapted.requirements, '提供模型白模');
});

test('adapter refuses missing key fields and duplicate IDs', () => {
  assert.throws(() => adaptSheetRows([]), /表頭/);
  assert.throws(() => adaptSheetRows([header.filter(name => name !== '原始結束')]), /原始結束/);
  assert.throws(() => adaptSheetRows([header, sheetRow('C-001', '', ''), sheetRow('C-001', '', '')]), /無效或重複/);
});

test('adjacent assigned resources create one spanning project card', () => {
  const input = project({ workspaceIds: ['C', 'B', 'B'], workspaceUnits: { B: 2, C: 1 } });
  const before = structuredClone(input);
  const plan = planBlocks([input]);
  assert.equal(plan.blocks.length, 1);
  assert.deepEqual(plan.blocks[0].workspaceIds, ['B', 'C']);
  assert.equal(plan.blocks[0].firstWorkspaceIndex, 1);
  assert.equal(plan.blocks[0].lastWorkspaceIndex, 2);
  assert.deepEqual(plan.blocks[0].workspaceUnits, { B: 2, C: 1 });
  assert.deepEqual(input, before);
});

test('nonadjacent resources split into continuous segments while retaining one project ID', () => {
  const plan = planBlocks([project({ workspaceIds: ['D', 'C', 'A'], workspaceUnits: { A: 1, C: 1, D: 1 } })]);
  assert.equal(plan.blocks.length, 2);
  assert.deepEqual(plan.blocks.map(block => block.workspaceIds), [['A'], ['C', 'D']]);
  assert.deepEqual(plan.blocks.map(block => block.projectId), ['C-001', 'C-001']);
  assert.equal(new Set(plan.blocks.map(block => block.key)).size, 2);
});

test('missing or partially unknown resource assignments remain unassigned without guessed blocks', () => {
  for (const workspaceIds of [[], ['UNKNOWN'], ['A', 'UNKNOWN']]) {
    const plan = planBlocks([project({ workspaceIds })]);
    assert.deepEqual(plan.blocks, []);
    assert.equal(plan.unassigned.length, 1);
    assert.equal(plan.unassigned[0].projectId, 'C-001');
  }
});

test('same-resource intersecting dates stack visually but nonintersecting ranges reuse a stack', () => {
  const plan = planBlocks([
    project({ id: 'C-002', start: '2026-10-20', end: '2026-10-22' }),
    project({ id: 'C-003', start: '2026-10-23', end: '2026-10-30' }),
    project({ id: 'C-004', workspaceIds: ['B'], workspaceUnits: { B: 1 } }),
    project(),
  ]);
  const byId = Object.fromEntries(plan.blocks.map(block => [block.projectId, block]));
  assert.equal(byId['C-001'].stackIndex, 0);
  assert.equal(byId['C-002'].stackIndex, 1);
  assert.equal(byId['C-003'].stackIndex, 0);
  assert.equal(byId['C-004'].stackIndex, 0);
});

test('A/B have a usual-load reminder without a fixed character capacity', () => {
  const projects = [project(), project({ id: 'C-002' }), project({ id: 'C-003' })];
  assert.deepEqual(planBlocks(projects.slice(0, 2)).overloads, []);
  const [overload] = planBlocks(projects).overloads;
  assert.deepEqual(overload, { workspaceId: 'A', startDay: parseDay('2026-10-01'), endDay: parseDay('2026-10-20'),
    used: 3, capacity: 2, referenceOnly: true, projectIds: ['C-001', 'C-002', 'C-003'] });
  for (const id of ['A', 'B']) {
    const workspace = WORKSPACES.find(item => item.id === id);
    assert.equal(workspace.capacity, null);
    assert.equal(workspace.usualLoad, 2);
  }
});

test('additional A/B/C character units remain visible without truncation or inferred reassignment', () => {
  const input = project({ workspaceIds: ['A', 'B', 'C'], workspaceUnits: { A: 4, B: 3, C: 5 } });
  const before = structuredClone(input);
  const plan = planBlocks([input]);
  assert.equal(plan.blocks.length, 1);
  assert.deepEqual(plan.blocks[0].workspaceUnits, { A: 4, B: 3, C: 5 });
  assert.deepEqual(plan.unassigned, []);
  assert.deepEqual(plan.overloads.map(item => [item.workspaceId, item.used, item.referenceOnly]),
    [['A', 4, true], ['B', 3, true]]);
  assert.deepEqual(input, before);
});

test('explicit capacity for a custom workspace remains distinct from a usual-load reminder', () => {
  const plan = planBlocks([project({ workspaceUnits: { A: 3 } })],
    [{ id: 'A', capacity: 2, usualLoad: 1 }]);
  assert.equal(plan.overloads[0].capacity, 2);
  assert.equal(plan.overloads[0].referenceOnly, false);
});

test('a two-character case plus another character overloads only their shared inclusive interval', () => {
  const plan = planBlocks([
    project({ workspaceUnits: { A: 2 } }),
    project({ id: 'C-002', start: '2026-10-10', end: '2026-10-12' }),
  ]);
  assert.equal(plan.overloads.length, 1);
  assert.equal(plan.overloads[0].startDay, parseDay('2026-10-10'));
  assert.equal(plan.overloads[0].endDay, parseDay('2026-10-12'));
  assert.equal(plan.overloads[0].used, 3);
});

test('C and D unknown capacities never become assumed one-person resource caps', () => {
  const plan = planBlocks([
    project({ workspaceIds: ['C'], workspaceUnits: { C: 8 } }),
    project({ id: 'C-002', workspaceIds: ['C'], workspaceUnits: { C: 5 } }),
    project({ id: 'D-001', workspaceIds: ['D'], workspaceUnits: { D: 6 } }),
    project({ id: 'D-002', workspaceIds: ['D'], workspaceUnits: { D: 3 } }),
  ]);
  assert.equal(plan.blocks.length, 4);
  assert.deepEqual(plan.overloads, []);
  assert.equal(WORKSPACES.find(workspace => workspace.id === 'C').capacity, null);
  assert.equal(WORKSPACES.find(workspace => workspace.id === 'D').capacity, null);
});

test('overlapping production and correction phases do not invent extra character occupancy for one case', () => {
  const plan = planBlocks([project({ workspaceUnits: { A: 2 }, correctionStart: '2026-10-10', correctionEnd: '2026-10-30' })]);
  assert.equal(plan.blocks.length, 2);
  assert.notEqual(plan.blocks[0].stackIndex, plan.blocks[1].stackIndex);
  assert.deepEqual(plan.overloads, []);
});

test('unknown correction dates stay pending without hiding a valid production block', () => {
  for (const correction of [
    { correctionStart: '2026-11', correctionEnd: '2026-12' },
    { correctionStart: '2026-11-02', correctionEnd: '' },
    { correctionStart: '2026-11-02', correctionEnd: '2026-11-01' },
    { supplement: '原期後持續修正；新終點待定' },
  ]) {
    const plan = planBlocks([project(correction)]);
    assert.equal(plan.blocks.length, 1);
    assert.equal(plan.blocks[0].phase, 'production');
    assert.ok(plan.pending.some(item => item.reason === '修正排程待定'));
  }
});

test('a fully dated correction remains visible when its original production schedule is unknown', () => {
  const plan = planBlocks([project({ start: '2026-10', end: '', correctionStart: '2026-11-02', correctionEnd: '2026-11-10' })]);
  assert.equal(plan.blocks.length, 1);
  assert.equal(plan.blocks[0].phase, 'correction');
  assert.equal(plan.blocks[0].startDay, parseDay('2026-11-02'));
  assert.equal(plan.blocks[0].endDay, parseDay('2026-11-10'));
  assert.ok(plan.pending.some(item => item.projectId === 'C-001' && item.reason === '排程日期未完整確定'));
});

test('past folding clips ongoing cross-year blocks and anchors their label inside the visible timeline', () => {
  const plan = planBlocks([project({ start: '2026-12-20', end: '2027-01-08' })]);
  const before = structuredClone(plan.blocks[0]);
  const clipped = clipBlock(plan.blocks[0], parseDay('2027-01-01'), parseDay('2027-01-31'));
  assert.ok(clipped);
  assert.equal(clipped.projectId, 'C-001');
  assert.equal(clipped.clippedStart, true);
  assert.equal(clipped.clippedEnd, false);
  assert.equal(clipped.labelStartDay, parseDay('2027-01-01'));
  assert.equal(clipped.duration, 8);
  assert.deepEqual(plan.blocks[0], before);
  assert.equal(clipBlock(plan.blocks[0], parseDay('2027-01-09'), parseDay('2027-01-31')), null);
});

test('right clipping and a one-day block retain inclusive duration and reject inverted viewport bounds', () => {
  const [block] = planBlocks([project()]).blocks;
  const clipped = clipBlock(block, parseDay('2026-10-20'), parseDay('2026-10-20'));
  assert.equal(clipped.duration, 1);
  assert.equal(clipped.clippedStart, true);
  assert.equal(clipped.clippedEnd, false);
  assert.equal(clipBlock(block, parseDay('2026-10-01'), parseDay('2026-10-10')).clippedEnd, true);
  assert.throws(() => clipBlock(block, parseDay('2026-10-20'), parseDay('2026-10-10')), /範圍無效/);
});

test('layout sorting is deterministic and never mutates input order or resource arrays', () => {
  const projects = [project({ id: 'C-003' }), project({ id: 'C-002' }), project()];
  const before = structuredClone(projects);
  const forward = planBlocks(projects);
  const reverse = planBlocks([...projects].reverse());
  assert.deepEqual(forward, reverse);
  assert.deepEqual(projects, before);
});
