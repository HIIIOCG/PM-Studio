import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const code = await readFile(new URL('../Code.gs', import.meta.url), 'utf8');
const SOURCE_ID = 'FICTIONAL_SOURCE_1234';
const PUBLIC_ERROR = '排程目前無法讀取，請稍後重試。';
const header = ['案號', '目前交付目標', '專案／範圍', '客戶', '負責人', '狀態', '原始開始', '原始結束',
  '延長修正／補充', '交付步驟（參考）', '資料', '窗口', '執行者', '目前排程開始', '目前排程結束',
  '修正開始', '修正結束', '客戶編號', '客戶類型', '工作區 A 占用', '工作區 B 占用', '工作區 C 占用', '工作區 D 占用', '排程性質', '未結事項'];
const defaults = {
  '案號': 'C-001', '目前交付目標': 'FictionalGoal', '專案／範圍': 'PrivateProject', '客戶': 'PrivateCustomer',
  '負責人': 'FictionalOwner', '執行者': 'PrivateExecutor', '窗口': 'PrivateContact',
  '資料': 'https://private.example/source', '交付步驟（參考）': 'FictionalDelivery',
  '狀態': '製作中', '客戶編號': 'V-01', '客戶類型': 'VTuber個人', '原始開始': '2026-01-01', '原始結束': '2026-02-28',
  '目前排程開始': '2026-12-01', '目前排程結束': '2027-01-31', '工作區 A 占用': '1'
};
const plain = value => JSON.parse(JSON.stringify(value));
const row = (changes = {}, columns = header) => columns.map(label => ({ ...defaults, ...changes })[label] ?? '');
const fixedDate = class extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-10-12T16:30:00.000Z'])); }
};

function setup(options = {}) {
  const state = { reads: [] };
  const rows = options.values ?? [[], [], [], [], options.header ?? header, ...(options.rows ?? [row()])];
  const properties = options.properties ?? { SOURCE_SHEET_ID: SOURCE_ID };
  const context = vm.createContext({
    Date: fixedDate,
    PropertiesService: { getScriptProperties: () => ({ getProperties: () => ({ ...properties }) }) },
    Sheets: { Spreadsheets: { Values: {
      get(id, range, settings) {
        state.reads.push({ id, range, settings: plain(settings) });
        if (options.readError) throw new Error('SecretCustomer ' + SOURCE_ID + ' https://private.example/error');
        return options.response ?? { values: rows };
      }
    } } },
    Utilities: {
      formatDate(date, timezone, format) {
        assert.equal(timezone, 'Asia/Taipei'); assert.equal(format, 'yyyy-MM-dd');
        return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
      }
    },
    HtmlService: {
      XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
      createHtmlOutputFromFile(file) {
        if (options.htmlError) throw new Error('Secret HTML failure');
        return { file, setTitle(value) { this.title = value; return this; },
          addMetaTag(name, content) { this.meta = { name, content }; return this; },
          setXFrameOptionsMode(value) { this.frame = value; return this; } };
      }
    }
  });
  vm.runInContext(code, context);
  const rpc = (name, ...args) => {
    if (name.endsWith('_') || typeof context[name] !== 'function') throw new Error('RPC unavailable');
    return context[name](...args);
  };
  return { context, rpc, state, rows };
}
const project = changes => plain(setup({ rows: [row(changes)] }).rpc('getTimeline').projects[0]);
const hasReason = (item, reason) => assert.ok(item.pendingReasons.includes(reason));

test('single read uses formatted source values and returns only the exact public contract', () => {
  const env = setup();
  const payload = plain(env.rpc('getTimeline'));
  assert.deepEqual(Object.keys(payload).sort(), ['schemaVersion', 'today', 'syncedAt', 'projects', 'workspaces', 'warnings'].sort());
  assert.equal(payload.schemaVersion, 3);
  assert.equal(payload.today, '2026-10-13');
  assert.equal(payload.syncedAt, '2026-10-12T16:30:00.000Z');
  assert.deepEqual(env.state.reads, [{ id: SOURCE_ID, range: "'專案列表'", settings: { majorDimension: 'ROWS', valueRenderOption: 'FORMATTED_VALUE' } }]);
  assert.deepEqual(payload.projects[0], {
    id: 'C-001', customerCode: 'V-01', customerType: 'VTuber個人', start: '2026-12-01', end: '2027-01-31', correctionStart: '', correctionEnd: '',
    scheduleKind: 'production', followUp: [],
    workspaceIds: ['A'], workspaceUnits: { A: 1 }, pendingReasons: [],
    owner: 'FictionalOwner', status: '製作中', deliveryGoal: 'FictionalGoal', notes: '', deliverySteps: 'FictionalDelivery'
  });
  assert.doesNotMatch(JSON.stringify(payload), /PrivateProject|PrivateCustomer|PrivateExecutor|PrivateContact|private\.example|FICTIONAL_SOURCE|sourceUrl|externalAlias|approved|originalStart/);
});

test('all 24 fictional projects remain present across statuses, missing dates and unassigned workspaces', () => {
  const rows = Array.from({ length: 24 }, (_, index) => row({
    '案號': ['C', 'BG', 'P', 'D', 'O'][index % 5] + '-' + String(index + 1).padStart(3, '0'),
    '狀態': ['製作中', '已出檔', '已交付', '取消', '結案'][index % 5],
    ...(index % 6 === 0 ? { '工作區 A 占用': '' } : {}),
    ...(index % 4 === 0 ? { '目前排程開始': '2027-04', '目前排程結束': '待確認' } : {})
  }));
  const payload = plain(setup({ rows }).rpc('getTimeline'));
  assert.equal(payload.projects.length, 24);
  assert.equal(new Set(payload.projects.map(item => item.id)).size, 24);
  assert.equal(payload.projects.filter(item => item.pendingReasons.includes('no-workspace')).length, 4);
  assert.equal(payload.projects.filter(item => item.pendingReasons.includes('production-dates')).length, 6);
});

test('source columns are selected explicitly and invalid restricted values never cross their field boundary', () => {
  const changes = Object.fromEntries(header.map(label => [label, 'Secret-' + label + '@private.example']));
  changes['案號'] = 'C-001';
  const payload = plain(setup({ rows: [row(changes)] }).rpc('getTimeline'));
  assert.equal(payload.projects.length, 1);
  const item = payload.projects[0];
  const detailFields = ['owner', 'status', 'deliveryGoal', 'notes', 'deliverySteps'];
  const base = Object.fromEntries(Object.entries(item).filter(([key]) => !detailFields.includes(key)));
  assert.doesNotMatch(JSON.stringify(base), /Secret|private|目前|客戶|修正|https|@/);
  assert.equal(item.status, changes['狀態']);
  assert.equal(item.notes, changes['延長修正／補充']);
  for (const label of ['專案／範圍', '客戶', '窗口', '執行者', '資料']) assert.ok(!JSON.stringify(item).includes(changes[label]));
  assert.equal(payload.projects[0].customerCode, '');
  assert.equal(payload.projects[0].start, '');
  assert.equal(payload.projects[0].end, '');
  assert.equal(payload.projects[0].correctionStart, '');
  assert.deepEqual(payload.projects[0].workspaceUnits, {});
  assert.equal(item.customerType, '');
  assert.deepEqual(new Set(payload.projects[0].pendingReasons), new Set(['customer-code', 'customer-type', 'schedule-kind', 'follow-up-values', 'production-dates', 'correction-dates', 'workspace-values', 'no-workspace']));
});

test('customer types accept only four confirmed labels while blank and missing columns remain unclassified', () => {
  for (const value of ['VTuber個人', 'VTuber公司', '遊戲公司', '其他']) {
    const item = project({ '客戶類型': value });
    assert.equal(item.customerType, value);
    assert.ok(!item.pendingReasons.includes('customer-type'));
  }
  const blank = project({ '客戶類型': '' });
  assert.equal(blank.customerType, ''); assert.ok(!blank.pendingReasons.includes('customer-type'));
  for (const value of ['VTuber', '公司', 'VTuber個人、其他', 'PrivateCustomerType', '<script>']) {
    const item = project({ '客戶類型': value });
    assert.equal(item.customerType, ''); hasReason(item, 'customer-type');
    assert.ok(!JSON.stringify(item).includes(value));
  }
  const oldHeader = header.filter(label => label !== '客戶類型');
  const migrated = plain(setup({ header: oldHeader, rows: [row({}, oldHeader)] }).rpc('getTimeline').projects[0]);
  assert.equal(migrated.customerType, ''); assert.ok(!migrated.pendingReasons.includes('customer-type'));
});

test('authorized public details are plain bounded text without source-link or raw-row fields', () => {
  const item = project({
    '目前交付目標': '  <script>Fictional</script>  ', '狀態': 'x'.repeat(5000),
    '負責人': 'x'.repeat(3999) + '😀', '延長修正／補充': '  第一行\n第二行  '
  });
  assert.equal(item.deliveryGoal, '<script>Fictional</script>');
  assert.equal(item.status.length, 4000); assert.equal(item.owner.length, 3999);
  assert.equal(item.notes, '第一行\n第二行');
  assert.doesNotMatch(JSON.stringify(item), /private\.example|sourceUrl|rawRow/);
});

test('all public projects omit project and customer names, contact and assignee before reaching the browser', () => {
  const changes = [
    { '案號': 'C-001', '專案／範圍': 'PrivateNameOne', '客戶': 'PrivateCustomerOne', '窗口': 'PrivateContactOne', '執行者': 'PrivateAssigneeOne' },
    { '案號': 'BG-002', '專案／範圍': 'PrivateNameTwo', '客戶': 'PrivateCustomerTwo', '窗口': 'PrivateContactTwo', '執行者': 'PrivateAssigneeTwo', '工作區 A 占用': '' }
  ];
  const payload = plain(setup({ rows: changes.map(values => row(values)) }).rpc('getTimeline'));
  assert.equal(payload.projects.length, 2);
  for (const item of payload.projects) {
    for (const key of ['name', 'customer', 'contact', 'assignee']) assert.ok(!Object.hasOwn(item, key));
    assert.equal(item.owner, 'FictionalOwner'); assert.equal(item.deliveryGoal, 'FictionalGoal');
  }
  assert.doesNotMatch(JSON.stringify(payload), /PrivateName|PrivateCustomer|PrivateContact|PrivateAssignee/);
});

test('customer codes retain leading zeroes and invalid or missing codes stay pending', () => {
  assert.equal(project({ '客戶編號': 'ABC-0003' }).customerCode, 'ABC-0003');
  for (const value of ['', 'V-01 SecretCustomer', 'v-01', 'V-01@example.test', '=V-01', '<script>']) {
    const item = project({ '客戶編號': value });
    assert.equal(item.customerCode, ''); hasReason(item, 'customer-code');
  }
});

test('only two empty current dates without rescheduling clues permit original-date fallback', () => {
  const original = project({ '目前排程開始': '', '目前排程結束': '' });
  assert.equal(original.start, '2026-01-01'); assert.equal(original.end, '2026-02-28');
  for (const note of ['改期，日期待定', '延期', '延長', '尚未確認排程', '日期待確認']) {
    const item = project({ '目前排程開始': '', '目前排程結束': '', '延長修正／補充': note });
    assert.equal(item.start, ''); assert.equal(item.end, ''); hasReason(item, 'production-dates');
  }
  const partial = project({ '目前排程開始': '2027-02', '目前排程結束': '' });
  assert.equal(partial.start, '2027-02'); assert.equal(partial.end, ''); hasReason(partial, 'production-dates');
  const explicitUnknown = project({ '目前排程開始': '待確認', '目前排程結束': '' });
  assert.equal(explicitUnknown.start, ''); assert.equal(explicitUnknown.end, '');
});

test('source date precision, invalid calendar days and inverted ranges are preserved without invented dates', () => {
  for (const [start, end] of [['2026-02-29', '2026-03-01'], ['2027-13-01', '2027-14-01'], ['2027-02-02', '2027-01-01'], ['2027-13', '2028-01'], ['2027-02', '2027-01'], ['2027-02-29', '2027-03']]) {
    const item = project({ '目前排程開始': start, '目前排程結束': end });
    assert.equal(item.start, start); assert.equal(item.end, end); hasReason(item, 'production-dates');
  }
  const locale = project({ '目前排程開始': '2026/12/1', '目前排程結束': 'SecretCustomer' });
  assert.equal(locale.start, ''); assert.equal(locale.end, ''); hasReason(locale, 'production-dates');
  const leap = project({ '目前排程開始': '2028-02-29', '目前排程結束': '2028-03-01' });
  assert.ok(!leap.pendingReasons.includes('production-dates'));
});

test('month-known production and correction dates are valid calendar envelopes without changing source precision', () => {
  for (const [start, end] of [['2026-09', '2026-11-30'], ['2027-04', '2027-06'], ['2027-12', '2028-01'], ['2028-02-29', '2028-02'], ['2027-02', '2027-02-01']]) {
    const item = project({ '目前排程開始': start, '目前排程結束': end, '修正開始': start, '修正結束': end });
    assert.equal(item.start, start); assert.equal(item.end, end);
    assert.equal(item.correctionStart, start); assert.equal(item.correctionEnd, end);
    assert.ok(!item.pendingReasons.includes('production-dates'));
    assert.ok(!item.pendingReasons.includes('correction-dates'));
  }
  for (const [start, end] of [['2028-03-01', '2028-02'], ['2027-02', '2027-01-31'], ['2027-00', '2027-03']]) {
    hasReason(project({ '目前排程開始': start, '目前排程結束': end }), 'production-dates');
  }
});

test('reservation kind maps only its authorized source label and works during optional-column migration', () => {
  const reserved = project({ '目前排程開始': '2027-04', '目前排程結束': '2027-06', '排程性質': '時段預約' });
  assert.equal(reserved.scheduleKind, 'reservation');
  assert.deepEqual(reserved.pendingReasons, []);
  for (const value of ['', '製作排程']) assert.equal(project({ '排程性質': value }).scheduleKind, 'production');
  for (const value of ['SecretCustomer 時段預約', 'reservation', '製作排程、時段預約', '<script>']) {
    const item = project({ '排程性質': value });
    assert.equal(item.scheduleKind, 'production'); hasReason(item, 'schedule-kind');
    assert.ok(!JSON.stringify(item).includes(value));
  }
  const oldHeader = header.filter(label => !['排程性質', '未結事項'].includes(label));
  const migrated = plain(setup({ header: oldHeader, rows: [row({}, oldHeader)] }).rpc('getTimeline').projects[0]);
  assert.equal(migrated.scheduleKind, 'production'); assert.deepEqual(migrated.followUp, []);
  assert.deepEqual(migrated.pendingReasons, []);
});

test('follow-up exposes only exact allowed tokens, never raw source status or note content', () => {
  assert.deepEqual(project({ '未結事項': '客戶確認中' }).followUp, ['customer-confirmation']);
  assert.deepEqual(project({ '未結事項': '待收款中' }).followUp, ['payment']);
  for (const separator of ['、', ',', '，', '\n', '\r\n']) {
    assert.deepEqual(project({ '未結事項': '待收款中' + separator + ' 客戶確認中' + separator + '待收款中' }).followUp, ['customer-confirmation', 'payment']);
  }
  for (const value of ['', '已處理']) assert.deepEqual(project({ '未結事項': value }).followUp, []);
  for (const value of ['待收款', 'SecretCustomer 客戶確認中', '客戶確認中／待收款中', '已處理、待收款中', '客戶確認中、SecretAccount', ',，']) {
    const item = project({ '未結事項': value });
    assert.deepEqual(item.followUp, []); hasReason(item, 'follow-up-values');
    assert.ok(!JSON.stringify(item).includes(value));
  }
  const privateOnly = project({ '狀態': '客戶確認中、待收款中', '延長修正／補充': '待收款中 SecretBankAccount' });
  assert.deepEqual(privateOnly.followUp, []);
  assert.equal(privateOnly.status, '客戶確認中、待收款中');
  assert.equal(privateOnly.notes, '待收款中 SecretBankAccount');
});

test('explicit follow-up state supersedes obsolete correction hints, while partial correction dates remain pending', () => {
  const note = '原期後持續修正；新終點待定 SecretCustomer';
  for (const value of ['客戶確認中', '待收款中', '已處理']) {
    const item = project({ '未結事項': value, '延長修正／補充': note });
    assert.ok(!item.pendingReasons.includes('correction-dates'));
    assert.equal(item.correctionStart, ''); assert.equal(item.correctionEnd, '');
    const partial = project({ '未結事項': value, '延長修正／補充': note, '修正開始': '2027-02' });
    hasReason(partial, 'correction-dates');
  }
  for (const value of ['', 'SecretCustomer']) {
    hasReason(project({ '未結事項': value, '延長修正／補充': note }), 'correction-dates');
  }
});

test('correction periods and pending notes stay distinct from an existing production schedule', () => {
  const full = project({ '修正開始': '2027-02-01', '修正結束': '2027-02-10' });
  assert.equal(full.start, '2026-12-01'); assert.equal(full.correctionStart, '2027-02-01');
  assert.ok(!full.pendingReasons.includes('correction-dates'));
  for (const [start, end] of [['2027-02', ''], ['2027-03-10', '2027-03-01'], ['SecretCustomer', '']]) {
    const item = project({ '修正開始': start, '修正結束': end });
    hasReason(item, 'correction-dates'); assert.equal(item.start, '2026-12-01');
  }
  const unknown = project({ '延長修正／補充': '原期後持續修正；新終點待定 SecretCustomer' });
  hasReason(unknown, 'correction-dates');
  assert.equal(unknown.start, '2026-12-01');
  assert.equal(unknown.notes, '原期後持續修正；新終點待定 SecretCustomer');
  const historical = project({ '延長修正／補充': '修正已完成' });
  assert.ok(!historical.pendingReasons.includes('correction-dates'));
});

test('A/B usual load does not cap extra characters and C/D are not assigned by project prefix', () => {
  const item = project({ '案號': 'O-001', '工作區 A 占用': '5', '工作區 B 占用': '7', '工作區 C 占用': '3', '工作區 D 占用': '' });
  assert.deepEqual(item.workspaceUnits, { A: 5, B: 7, C: 3 });
  assert.deepEqual(item.workspaceIds, ['A', 'B', 'C']);
  assert.deepEqual(item.pendingReasons, []);
  const payload = plain(setup().rpc('getTimeline'));
  assert.deepEqual(payload.workspaces.map(item => item.usualLoad ?? null), [2, 2, null, null]);
  assert.ok(payload.workspaces.every(item => !('capacity' in item)));
});

test('invalid allocations remain pending and never become one unit or reveal cell text', () => {
  for (const value of ['0', '-1', '1.5', '=1+1', 'SecretCustomer', '1,000', 'Infinity', '9007199254740992']) {
    const item = project({ '工作區 A 占用': value });
    assert.deepEqual(item.workspaceIds, []); assert.deepEqual(item.workspaceUnits, {});
    hasReason(item, 'workspace-values'); hasReason(item, 'no-workspace');
    assert.doesNotMatch(JSON.stringify(item), /SecretCustomer/);
  }
  assert.equal(project({ '工作區 A 占用': '1001' }).workspaceUnits.A, 1001);
});

test('headers can move, extra private fields stay private, required or duplicate headers fail generically', () => {
  const reordered = [...header].reverse();
  assert.equal(setup({ header: reordered, rows: [row({}, reordered)] }).rpc('getTimeline').projects[0].customerCode, 'V-01');
  const extra = [...header, 'private_notes'];
  assert.doesNotMatch(JSON.stringify(setup({ header: extra, rows: [row({ private_notes: 'SecretPrivate' }, extra)] }).rpc('getTimeline')), /SecretPrivate/);
  for (const columns of [header.filter(label => label !== '客戶編號'), [...header, '案號']]) {
    assert.throws(() => setup({ header: columns }).rpc('getTimeline'), { message: PUBLIC_ERROR });
  }
});

test('malformed or missing project IDs produce fixed warnings without hiding valid cases', () => {
  const payload = plain(setup({ rows: [row(), row({ '案號': 'SecretProject' }), row({ '案號': '' }), Array(22).fill('')] }).rpc('getTimeline'));
  assert.equal(payload.projects.length, 1);
  assert.deepEqual(payload.warnings, ['project-id-invalid', 'project-id-missing']);
  assert.doesNotMatch(JSON.stringify(payload), /SecretProject/);
  assert.throws(() => setup({ rows: [row(), row()] }).rpc('getTimeline'), { message: PUBLIC_ERROR });
});

test('empty source is a real empty schedule, malformed and oversized reads fail without truncation', () => {
  assert.deepEqual(plain(setup({ rows: [] }).rpc('getTimeline').projects), []);
  const oversized = [[], [], [], [], header, ...Array.from({ length: 996 }, () => [])];
  oversized[1000] = row({ '案號': 'C-999' });
  for (const options of [{ response: {} }, { values: [] }, { values: oversized }, { header: [...header, ...Array(43).fill('')] }, { readError: true }]) {
    assert.throws(() => setup(options).rpc('getTimeline'), { message: PUBLIC_ERROR });
  }
});

test('only the configured source property is accepted, including no caller-supplied source or revision', () => {
  for (const properties of [{}, { SOURCE_SHEET_ID: '' }, { SOURCE_SHEET_ID: 'tiny' }, { SOURCE_SHEET_ID: SOURCE_ID, PUBLIC_FEED_SHEET_ID: 'PRIVATE_EXTRA' }]) {
    const env = setup({ properties });
    assert.throws(() => env.rpc('getTimeline'), { message: PUBLIC_ERROR });
    assert.equal(env.state.reads.length, 0);
  }
  for (const arg of [undefined, null, {}, { source: 'PRIVATE_EXTRA' }, { revision: 'abc' }]) {
    const env = setup();
    assert.throws(() => env.rpc('getTimeline', arg), { message: PUBLIC_ERROR });
    assert.equal(env.state.reads.length, 0);
  }
});

test('HTML permits the read-only Pages frame but rejects URL parameters and private failures', () => {
  const env = setup();
  const html = env.rpc('doGet', { queryString: '', parameter: {}, parameters: {}, pathInfo: '' });
  assert.equal(html.file, 'Index'); assert.equal(html.title, 'PM Studio'); assert.equal(html.frame, 'ALLOWALL');
  assert.deepEqual(plain(html.meta), { name: 'viewport', content: 'width=device-width, initial-scale=1' });
  assert.equal(env.state.reads.length, 0);
  for (const event of [{ queryString: 'mode=internal' }, { parameter: { source: '' } }, { parameters: { source: [''] } }, { pathInfo: 'internal' }, { postData: {} }, 'internal']) {
    assert.throws(() => env.rpc('doGet', event), { message: PUBLIC_ERROR });
  }
  assert.throws(() => setup({ htmlError: true }).rpc('doGet'), { message: PUBLIC_ERROR });
});

test('public RPC surface has only doGet and getTimeline; helpers and all former writes are unavailable', () => {
  const env = setup();
  const functions = [...code.matchAll(/^function (\w+)\(/gm)].map(match => match[1]);
  assert.deepEqual(functions.filter(name => !name.endsWith('_')), ['doGet', 'getTimeline']);
  for (const name of ['saveLayout', 'publishApprovedSnapshot', 'loadInternal_', 'publicRows_', 'rescheduled_']) {
    assert.throws(() => env.rpc(name, {}), /unavailable/);
  }
  assert.doesNotMatch(code, /SpreadsheetApp|DriveApp|Session\.|LockService|setValues|appendRow|batchUpdate|Values\.update|setProperty|UrlFetchApp|ScriptApp|Logger|console\./);
});
