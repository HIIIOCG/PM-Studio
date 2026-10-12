import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { getProjectDates, parseDay } from '../../scripts/timeline-core.mjs';

const internalCode = await readFile(new URL('../Code.gs', import.meta.url), 'utf8');
const publicCode = await readFile(new URL('../PublicCode.gs', import.meta.url), 'utf8');
const sourceId = 'MASTER_1234';
const settingsId = 'SETTINGS_1234';
const feedId = 'FEED_1234';
const header = ['案號', '目前交付目標', '專案／範圍', '客戶', '負責人', '狀態', '原始開始', '原始結束',
  '延長修正／補充', '交付步驟（參考）', '資料', '窗口', '執行者', '目前排程開始', '目前排程結束', '修正開始', '修正結束', '對外名稱'];
const sourceRow = ['C-001', 'SecretPerson 的模型', 'PrivateProject｜一角色', 'PrivateCustomer', 'SecretPerson', '進行中',
  '2026-12-01', '2027-01-31', '', '', '附件', '', '', '', '', '', '', '專案 001'];
const layoutHeader = ['projectId', 'workspaceIds', 'workspaceUnits', 'updatedAt'];
const approvalHeader = ['projectId', 'approved', 'alias', 'approvedGoal', 'scheduleStart', 'scheduleEnd', 'approvedRevision'];
const feedHeader = ['alias', 'approvedGoal', 'scheduleStart', 'scheduleEnd', 'workspaceIds', 'workspaceUnits'];
const safeRow = ['專案 001', '模型製作', '2026-12-01', '2027-01-31', '["A"]', '{"A":1}'];
const plain = value => JSON.parse(JSON.stringify(value));

class Sheet {
  constructor(name, values, state) { this.name = name; this.values = structuredClone(values); this.state = state; this.maxRows = 1000; this.writable = true; }
  getName() { return this.name; }
  getMaxRows() { return this.maxRows; }
  getLastRow() { return this.values.findLastIndex(row => row?.some(value => value !== '' && value != null)) + 1; }
  getLastColumn() { return Math.max(0, ...this.values.map(row => row.findLastIndex(value => value !== '' && value != null) + 1)); }
  getRange(row, col, height, width) {
    const sheet = this;
    const read = () => Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => sheet.values[row + y - 1]?.[col + x - 1] ?? ''));
    return {
      getDisplayValues() { sheet.state.reads.push({ sheet: sheet.name, row, col, height, width }); return read().map(r => r.map(v => String(v))); },
      getFormulas() { return read().map(r => r.map(v => typeof v === 'string' && v.startsWith('=') ? v : '')); },
      getRichTextValues() { return read().map(r => r.map(() => ({ getLinkUrl: () => 'https://private.example/source', getRuns: () => [] }))); },
      setValues(values) {
        if (!sheet.writable) throw new Error('Google ACL write denied: private-sheet-id');
        assert.equal(values.length, height); assert.ok(values.every(r => r.length === width));
        sheet.state.writes.push({ sheet: sheet.name, row, col, height, width });
        values.forEach((r, y) => r.forEach((value, x) => { sheet.values[row + y - 1] ??= []; sheet.values[row + y - 1][col + x - 1] = value; }));
        return this;
      },
      clearNote() { sheet.state.notesCleared.push(sheet.name); return this; }
    };
  }
}

function setup(kind = 'internal', options = {}) {
  const state = { opens: [], reads: [], writes: [], notesCleared: [], folders: [], locks: 0, releases: 0 };
  const master = new Sheet('專案列表', [[], [], [], [], header, sourceRow], state);
  const layout = new Sheet('工作區安排', [layoutHeader], state);
  const approval = new Sheet('公開設定', [approvalHeader], state);
  const feed = new Sheet('匿名排程', [feedHeader, ...(options.feedRows || [])], state);
  if (options.assigned) layout.values.push(['C-001', '["A"]', '{"A":1}', '2026-10-12T00:00:00Z']);
  const sheets = new Map([
    [sourceId, [master]], [settingsId, [layout, approval]], [feedId, [feed]]
  ]);
  const props = kind === 'public' ? { PUBLIC_FEED_SHEET_ID: feedId } : {
    INTERNAL_FOLDER_ID: 'FOLDER_1234', INTERNAL_SHEET_ID: sourceId, SETTINGS_SHEET_ID: settingsId, PUBLIC_FEED_SHEET_ID: feedId,
    ...(options.publisher ? { PUBLISHERS_JSON: '["worker@example.test"]' } : {})
  };
  Object.assign(props, options.properties);
  const email = options.email ?? 'worker@example.test';
  const context = vm.createContext({
    PropertiesService: { getScriptProperties: () => ({ getProperties: () => ({ ...props }) }) },
    Session: { getActiveUser: () => ({ getEmail: () => email }), getEffectiveUser: () => ({ getEmail: () => options.effectiveEmail ?? email }) },
    DriveApp: { getFolderById(id) { state.folders.push(id); if (options.folderDenied) throw new Error('ACL'); return { getName: () => 'PM folder' }; } },
    SpreadsheetApp: {
      openById(id) {
        state.opens.push(id);
        if (options.deniedIds?.includes(id) || !sheets.has(id)) throw new Error('private exception ' + id);
        return { getSheetByName: name => sheets.get(id).find(sheet => sheet.name === name) || null, getSheets: () => sheets.get(id) };
      }, flush() {}
    },
    LockService: { getScriptLock: () => ({ tryLock() { state.locks++; return !options.lockDenied; }, releaseLock() { state.releases++; } }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_, value) => [...createHash('sha256').update(value).digest()],
      formatDate: date => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
    },
    HtmlService: { createHtmlOutputFromFile: file => ({ file, setTitle() { return this; } }) }
  });
  vm.runInContext(kind === 'public' ? publicCode : internalCode, context);
  // Match the documented google.script.run boundary, including private helpers.
  const rpc = (name, ...args) => {
    if (name.endsWith('_') || typeof context[name] !== 'function') throw new Error('RPC unavailable');
    return context[name](...args);
  };
  return { context, rpc, state, props, master, layout, approval, feed, sheets };
}

function inputFor(env, workspaceIds = ['A'], workspaceUnits = { A: 1 }) {
  return { assignments: { 'C-001': workspaceIds }, allocations: { 'C-001': workspaceUnits }, revision: env.rpc('getTimeline').revision };
}

function approvalFor(env) {
  return { revision: env.rpc('getTimeline').revision, approvals: [{ projectId: 'C-001', approved: true, alias: '專案 001',
    approvedGoal: '模型製作', scheduleStart: '2026-12-01', scheduleEnd: '2027-01-31', workspaceIds: ['A'], workspaceUnits: { A: 1 } }] };
}

test('all internal RPCs deny anonymous users before touching private resources', () => {
  const env = setup('internal', { email: '' });
  for (const [name, arg] of [['doGet', {}], ['getTimeline'], ['saveLayout', {}], ['publishApprovedSnapshot', {}]]) {
    assert.throws(() => env.rpc(name, ...(arg ? [arg] : [])), /Google/);
  }
  assert.deepEqual(env.state.opens, []); assert.deepEqual(env.state.folders, []); assert.deepEqual(env.state.writes, []);
});

test('internal execute-as-owner mismatch denies; existing folder and file ACLs remain the authority', () => {
  assert.throws(() => setup('internal', { effectiveEmail: 'owner@example.test' }).rpc('getTimeline'), /Google/);
  const deniedFolder = setup('internal', { folderDenied: true });
  assert.throws(() => deniedFolder.rpc('getTimeline'), /資料夾/); assert.deepEqual(deniedFolder.state.opens, []);
  const deniedSheet = setup('internal', { deniedIds: [settingsId] });
  assert.throws(() => deniedSheet.rpc('getTimeline'), /讀取權限/);
  const coworker = setup('internal', { email: 'other-company-member@example.test' });
  assert.equal(coworker.rpc('getTimeline').mode, 'internal'); // No extra employee allowlist.
});

test('internal headers are dynamic, month precision stays pending, and missing resources stay empty', () => {
  const env = setup();
  const reverse = header.map((_, i) => header.length - 1 - i);
  env.master.values[4] = reverse.map(i => header[i]);
  const row = [...sourceRow]; row[6] = '2026-12';
  env.master.values[5] = reverse.map(i => row[i]);
  const payload = env.rpc('getTimeline');
  assert.equal(payload.projects[0].originalStart, '2026-12'); assert.equal(payload.projects[0].start, '');
  assert.deepEqual(plain(payload.projects[0].workspaceIds), []); assert.equal(payload.warnings.length, 1);
  assert.equal(payload.projects[0].owner, 'SecretPerson'); assert.equal(payload.projects[0].executor, '');
  assert.deepEqual(plain(payload.projects[0].sourceLinks), ['https://private.example/source']);
  assert.throws(() => env.rpc('getTimeline', { mode: 'public' }), /參數/);
  assert.throws(() => env.rpc('doGet', { parameter: { mode: 'public' } }), /參數/);
});

test('extracted date rules match timeline core: leap dates, partial/inverted dates and reschedule fallback', () => {
  const { context } = setup();
  for (const value of ['2024-02-29', '2026-02-29', '2026-13-01', '2026-02', '2026-2-01', '2027-01-01']) {
    assert.equal(context.parseDay_(value), parseDay(value));
  }
  for (const item of [
    { originalStart: '2026-12-01', originalEnd: '2027-01-31' },
    { originalStart: '2026-12-01', originalEnd: '2027-01-31', supplement: '改期，日期待定' },
    { start: '2027-01-01', end: '2027-01-31', supplement: '原期後持續修正；新終點待定' },
    { start: '2026-12', end: '2027-01' },
    { start: '2027-01-31', end: '2026-12-01' },
    { start: '2027-01-01', originalStart: '2026-12-01', originalEnd: '2027-01-31' }
  ]) assert.deepEqual(plain(context.getProjectDates_(item)), getProjectDates(item));
});

test('layout updates preserve confirmed extra A/B characters and C/D units without fixed capacity', () => {
  const env = setup();
  const result = env.rpc('saveLayout', inputFor(env, ['D', 'B', 'A', 'C'], { D: 3, B: 4, A: 3, C: 5 }));
  assert.deepEqual(plain(result.projects[0].workspaceIds), ['A', 'B', 'C', 'D']);
  assert.deepEqual(plain(result.projects[0].workspaceUnits), { A: 3, B: 4, C: 5, D: 3 });
  assert.deepEqual(plain(env.rpc('getTimeline').projects[0].workspaceUnits), { A: 3, B: 4, C: 5, D: 3 });
  assert.deepEqual(plain(result.workspaces.map(workspace => workspace.capacity)), [null, null, null, null]);
  assert.deepEqual(plain(result.workspaces.filter(workspace => workspace.usualLoad).map(workspace => [workspace.id, workspace.usualLoad])), [['A', 2], ['B', 2]]);
  assert.equal(result.workspaces.find(workspace => workspace.id === 'C').name, '角色與場景模型');
  assert.deepEqual(env.state.writes.map(write => write.sheet), ['工作區安排']);
  assert.equal(env.state.releases, 1); assert.ok(env.state.notesCleared.includes('工作區安排'));
});

test('invalid workspace, units, unknown project and surplus request fields do not write', () => {
  const cases = [
    env => inputFor(env, ['A'], { A: 1001 }), env => inputFor(env, ['Z'], { Z: 1 }),
    env => inputFor(env, ['A', 'A'], { A: 1 }), env => inputFor(env, ['A'], { A: 0 }),
    env => inputFor(env, ['A'], { A: 1, B: 1 }),
    env => ({ ...inputFor(env), mode: 'public' }),
    env => ({ ...inputFor(env), assignments: { 'C-999': ['A'] }, allocations: { 'C-999': { A: 1 } } }),
    env => ({ ...inputFor(env), allocations: { 'C-001': { A: 1 }, 'C-999': {} } })
  ];
  for (const make of cases) {
    const env = setup(); assert.throws(() => env.rpc('saveLayout', make(env))); assert.deepEqual(env.state.writes, []);
  }
});

test('all workspace unit counts keep a technical integer bound independent of usual load', () => {
  for (const area of ['A', 'B', 'C', 'D']) {
    for (const units of [-1, 0, 1.5, 1001, '3']) {
      const env = setup();
      assert.throws(() => env.rpc('saveLayout', inputFor(env, [area], { [area]: units })), /數量/);
      assert.deepEqual(env.state.writes, []);
    }
    const env = setup();
    assert.equal(env.rpc('saveLayout', inputFor(env, [area], { [area]: 1000 })).projects[0].workspaceUnits[area], 1000);
  }
});

test('source-row or other-user layout change invalidates revision; successful response returns new revision', () => {
  const env = setup(); const input = inputFor(env);
  env.master.values[5][1] = '另一個新的目標';
  assert.throws(() => env.rpc('saveLayout', input), /已被更新/); assert.deepEqual(env.state.writes, []);
  const first = inputFor(env); const response = env.rpc('saveLayout', first);
  assert.notEqual(response.revision, first.revision);
  assert.throws(() => env.rpc('saveLayout', first), /已被更新/);
  assert.equal(env.state.writes.length, 1);
});

test('write ACL and lock failures deny layout changes', () => {
  const env = setup(); const input = inputFor(env); env.layout.writable = false;
  assert.throws(() => env.rpc('saveLayout', input), /ACL/); assert.deepEqual(env.state.writes, []); assert.equal(env.state.releases, 1);
  const busy = setup('internal', { lockDenied: true });
  assert.throws(() => busy.rpc('saveLayout', inputFor(busy)), /其他人/); assert.deepEqual(busy.state.writes, []);
});

test('publishing defaults to deny for a resource-authorized employee', () => {
  const env = setup('internal', { assigned: true });
  assert.throws(() => env.rpc('publishApprovedSnapshot', approvalFor(env)), /主管/); assert.deepEqual(env.state.writes, []);
});

test('supervisor publication writes only approved projection; empty approval explicitly empties old feed', () => {
  const env = setup('internal', { assigned: true, publisher: true });
  const result = env.rpc('publishApprovedSnapshot', approvalFor(env));
  assert.equal(result.published, 1); assert.deepEqual(env.feed.values[1], safeRow);
  const serialized = JSON.stringify(env.feed.values);
  for (const term of ['C-001', 'PrivateProject', 'PrivateCustomer', 'SecretPerson', 'private.example', sourceId]) assert.ok(!serialized.includes(term));
  assert.equal(env.approval.values[1][0], 'C-001'); // Approval provenance remains only in private settings.
  env.rpc('publishApprovedSnapshot', { revision: env.rpc('getTimeline').revision, approvals: [] });
  assert.equal(env.feed.getLastRow(), 1);
});

test('publication rejects unapproved/raw goal, private fields, dates, pending rows and unconfirmed workspaces', () => {
  const changes = [
    item => { item.approved = false; }, item => { delete item.approvedGoal; }, item => { item.approvedGoal = 'PrivateProject 模型'; },
    item => { item.approvedGoal = 'SecretPerson 模型'; }, item => { item.approvedGoal = 'C-001 製作'; },
    item => { item.approvedGoal = '=IMPORTDATA("https://private.example")'; }, item => { item.sourceId = sourceId; },
    item => { item.alias = 'PrivateProject'; }, item => { item.alias = '專案 002'; },
    item => { item.scheduleStart = '2026-12'; }, item => { item.scheduleStart = '2026-02-29'; },
    item => { item.scheduleEnd = '2026-01-01'; }, item => { item.workspaceIds = ['B']; item.workspaceUnits = { B: 1 }; },
    item => { item.workspaceIds = ['C']; item.workspaceUnits = { C: 1 }; }
  ];
  for (const change of changes) {
    const env = setup('internal', { assigned: true, publisher: true }); const input = approvalFor(env); change(input.approvals[0]);
    assert.throws(() => env.rpc('publishApprovedSnapshot', input)); assert.deepEqual(env.state.writes, []);
  }
  const pending = setup('internal', { assigned: true, publisher: true }); pending.master.values[5][8] = '改期，日期待定';
  assert.throws(() => pending.rpc('publishApprovedSnapshot', approvalFor(pending)), /日期/); assert.deepEqual(pending.state.writes, []);
  const noAlias = setup('internal', { assigned: true, publisher: true }); noAlias.master.values[5][17] = '';
  assert.throws(() => noAlias.rpc('publishApprovedSnapshot', approvalFor(noAlias)), /匿名名稱/); assert.deepEqual(noAlias.state.writes, []);
});

test('public deployment has only two callable functions, helpers/private RPCs cannot be used', () => {
  const env = setup('public');
  assert.deepEqual(Object.keys(env.context).filter(key => typeof env.context[key] === 'function' && !key.endsWith('_')).sort(), ['doGet', 'getTimeline']);
  for (const name of ['saveLayout', 'publishApprovedSnapshot', 'loadInternal_', 'publicProject_']) assert.throws(() => env.rpc(name, {}), /unavailable/);
  for (const token of ['INTERNAL_SHEET_ID', 'INTERNAL_FOLDER_ID', 'DriveApp', 'Session', 'publishApprovedSnapshot', 'saveLayout']) assert.ok(!publicCode.includes(token));
});

test('public reads only private anonymous feed and returns exact safe fields, empty feed stays empty', () => {
  const env = setup('public', { feedRows: [safeRow] }); const payload = env.rpc('getTimeline');
  assert.deepEqual(env.state.opens, [feedId]); assert.deepEqual(env.state.writes, []); assert.deepEqual(env.state.folders, []);
  assert.deepEqual(Object.keys(payload.projects[0]).sort(), ['alias', 'goal', 'start', 'end', 'workspaceIds', 'workspaceUnits'].sort());
  assert.deepEqual(plain(payload.workspaces.map(w => w.id)), ['A', 'B', 'C', 'D']); assert.equal(payload.permissions.canEditLayout, false);
  for (const term of [sourceId, settingsId, feedId, 'C-001', 'PrivateProject', 'sourceUrl', 'owner', 'customer']) assert.ok(!JSON.stringify(payload).includes(term));
  assert.equal(setup('public').rpc('getTimeline').projects.length, 0);
});

test('query, RPC arguments and properties cannot switch public to private resources', () => {
  const env = setup('public');
  assert.throws(() => env.rpc('getTimeline', { mode: 'internal', sourceId }), /參數/);
  for (const e of [{ parameter: { mode: 'internal' } }, { queryString: 'mode=internal' }, { pathInfo: 'internal' }]) assert.throws(() => env.rpc('doGet', e), /參數/);
  assert.deepEqual(env.state.opens, []);
  env.props.MODE = 'internal'; assert.throws(() => env.rpc('getTimeline'), /公開排程目前/); assert.deepEqual(env.state.opens, []);
  const changed = setup('public', { properties: { PUBLIC_FEED_SHEET_ID: sourceId } });
  assert.throws(() => changed.rpc('getTimeline'), /公開排程目前/); assert.deepEqual(changed.state.reads, []);
});

test('public feed fails closed on extra sheets/columns, formulas, sensitive fields and invalid calendar/resources', () => {
  const mutations = [
    env => { env.sheets.get(feedId).push(env.master); }, env => { env.feed.values[0].push('sourceId'); },
    env => { env.feed.values[1][1] = '=A1'; }, env => { env.feed.values[1][1] = 'https://private.example/source'; },
    env => { env.feed.values[1][1] = 'C-001 目標'; }, env => { env.feed.values[1][2] = '2026-12'; },
    env => { env.feed.values[1][2] = '2026-02-29'; }, env => { env.feed.values[1][3] = '2026-01-01'; },
    env => { env.feed.values[1][4] = '["Z"]'; env.feed.values[1][5] = '{"Z":1}'; },
    env => { env.feed.values[1][5] = '{"A":1,"sourceId":"secret"}'; }, env => { env.feed.values[1][5] = '{"A":1001}'; },
    env => { env.feed.values[1][5] = '{"A":0}'; }, env => { env.feed.values[1][5] = '{"A":1.5}'; },
    env => { env.feed.values.push([...safeRow]); }
  ];
  for (const mutate of mutations) {
    const env = setup('public', { feedRows: [safeRow] }); mutate(env);
    assert.throws(() => env.rpc('getTimeline'), error => error.message === '公開排程目前無法讀取，請稍後重試。');
    assert.deepEqual(env.state.writes, []);
  }
  const denied = setup('public', { deniedIds: [feedId] });
  assert.throws(() => denied.rpc('getTimeline'), error => !error.message.includes(feedId));
});

test('bounded reads fail instead of silently discarding source row 1001', () => {
  const env = setup(); env.master.values[1000] = ['C-002'];
  assert.throws(() => env.rpc('getTimeline'), /超出/); assert.deepEqual(env.state.reads, []);
  const pub = setup('public', { feedRows: [safeRow] }); pub.feed.values[1000] = [...safeRow];
  assert.throws(() => pub.rpc('getTimeline'), /公開排程目前/); assert.deepEqual(pub.state.reads, []);
});

test('approved anonymous extra A/B characters, C models and D work survive publication and readback', () => {
  for (const [ids, units] of [[['A', 'B', 'C'], { A: 3, B: 4, C: 3 }], [['D'], { D: 4 }]]) {
    const env = setup('internal', { publisher: true });
    env.rpc('saveLayout', inputFor(env, ids, units));
    const input = approvalFor(env); input.approvals[0].workspaceIds = ids; input.approvals[0].workspaceUnits = units;
    env.rpc('publishApprovedSnapshot', input);
    const publicEnv = setup('public', { feedRows: [env.feed.values[1]] });
    const payload = publicEnv.rpc('getTimeline');
    assert.deepEqual(plain(payload.projects[0].workspaceIds), ids);
    assert.deepEqual(plain(payload.projects[0].workspaceUnits), units);
    assert.ok(payload.workspaces.every(w => w.capacity === null));
    assert.equal(payload.workspaces.find(w => w.id === 'A').usualLoad, 2);
    assert.equal(payload.workspaces.find(w => w.id === 'B').usualLoad, 2);
  }
});
