import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const publicCode = await readFile(new URL('../Code.gs', import.meta.url), 'utf8');
const adapterCode = await readFile(new URL('../internal/Code.gs', import.meta.url), 'utf8');
const manifest = JSON.parse(await readFile(new URL('../internal/appsscript.json', import.meta.url), 'utf8'));
const sharedCode = publicCode.replace(/^function doGet\(/m, 'function publicDoGet_(')
  .replace(/^function getTimeline\(/m, 'function publicGetTimeline_(');
const SOURCE_ID = 'FICTIONAL_INTERNAL_SOURCE_1234';
const INTERNAL_ERROR = '排程目前無法讀取，請稍後重試。';
const PUBLIC_ERROR = '排程目前無法讀取，請稍後重試。';
const header = ['案號', '目前交付目標', '專案／範圍', '客戶', '專案主管', '狀態', '原始開始', '原始結束',
  '延長修正／補充', '交付步驟（參考）', '資料', '窗口', '執行者', '目前排程開始', '目前排程結束',
  '修正開始', '修正結束', '客戶編號', '客戶類型', '工作區 A 占用', '工作區 B 占用', '工作區 C 占用', '工作區 D 占用', '排程性質', '未結事項'];
const defaults = {
  '案號': 'C-001', '目前交付目標': 'FictionalGoal', '專案／範圍': 'FictionalProject', '客戶': 'FictionalCustomer',
  '專案主管': 'FictionalOwner', '執行者': 'FictionalExecutor', '窗口': 'FictionalContact',
  '資料': 'https://private.example/source', '交付步驟（參考）': 'FictionalDelivery',
  '狀態': '製作中（2026/10/12 更新）', '客戶編號': 'V-01', '客戶類型': 'VTuber公司', '原始開始': '2026-01-01', '原始結束': '2026-02-28',
  '目前排程開始': '2026-12-01', '目前排程結束': '2027-01-31', '工作區 A 占用': '1'
};
const privateKeys = ['name', 'customer', 'owner', 'status', 'deliveryGoal', 'notes', 'contact', 'assignee', 'deliverySteps'];
const internalOnlyKeys = ['name', 'customer', 'contact', 'assignee'];
const plain = value => JSON.parse(JSON.stringify(value));
const row = (changes = {}, columns = header) => columns.map(label => ({ ...defaults, ...changes })[label] ?? '');
const slotHeader = [...header, '時段工作區'];
const slotRow = (changes = {}) => slotHeader.map((label) => ({ '排程性質': '空白預約', '時段工作區': 'D', '目前排程開始': '2026-11', '目前排程結束': '2026-11', ...changes })[label] ?? '');
const fixedDate = class extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-10-13T16:30:00.000Z'])); }
};

function setup(options = {}, code = sharedCode + '\n' + adapterCode) {
  const state = { reads: [] };
  const properties = options.properties ?? { SOURCE_SHEET_ID: SOURCE_ID };
  const rows = options.values ?? [[], [], [], [], options.header ?? header, ...(options.rows ?? [row()])];
  const context = vm.createContext({
    Date: fixedDate,
    PropertiesService: { getScriptProperties: () => ({ getProperties: () => ({ ...properties }) }) },
    Sheets: { Spreadsheets: { Values: {
      get(id, range, settings) {
        state.reads.push({ id, range, settings: plain(settings) });
        if (options.readError) throw new Error(options.readError);
        return options.response ?? { values: rows };
      }
    } } },
    Utilities: {
      formatDate(date, timezone, format) {
        assert.equal(timezone, 'Asia/Taipei'); assert.equal(format, 'yyyy-MM-dd');
        return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
      }
    },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput(content) {
        if (options.outputError) throw new Error('PRIVATE_OUTPUT_ERROR ' + SOURCE_ID);
        return { content, setMimeType(value) { this.mimeType = value; return this; } };
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

test('teamspace manifest uses anonymous deployer execution with only Sheets read permission', () => {
  assert.deepEqual(manifest.webapp, { executeAs: 'USER_DEPLOYING', access: 'ANYONE_ANONYMOUS' });
  assert.deepEqual(manifest.oauthScopes, ['https://www.googleapis.com/auth/spreadsheets.readonly']);
  assert.equal(manifest.timeZone, 'Asia/Taipei');
  assert.equal(manifest.runtimeVersion, 'V8');
  assert.deepEqual(manifest.dependencies.enabledAdvancedServices, [{ userSymbol: 'Sheets', version: 'v4', serviceId: 'sheets' }]);
});

test('one current source read returns the schedule plus the exact internal text allowlist', () => {
  const env = setup();
  const payload = plain(env.rpc('getTimeline'));
  const base = plain(setup({}, publicCode).rpc('getTimeline'));
  assert.deepEqual(Object.keys(payload).sort(), Object.keys(base).sort());
  assert.equal(payload.schemaVersion, 4);
  assert.deepEqual(payload.reservationSlots, []);
  assert.equal(payload.today, '2026-10-14');
  assert.equal(payload.syncedAt, '2026-10-13T16:30:00.000Z');
  assert.deepEqual(env.state.reads, [{ id: SOURCE_ID, range: "'專案列表'", settings: { majorDimension: 'ROWS', valueRenderOption: 'FORMATTED_VALUE' } }]);
  assert.deepEqual(payload.projects[0], {
    ...base.projects[0], name: 'FictionalProject', customer: 'FictionalCustomer', owner: 'FictionalOwner',
    status: '製作中（2026/10/12 更新）', deliveryGoal: 'FictionalGoal', notes: '', contact: 'FictionalContact',
    assignee: 'FictionalExecutor', deliverySteps: 'FictionalDelivery'
  });
  assert.doesNotMatch(JSON.stringify(payload), /private\.example|FICTIONAL_INTERNAL_SOURCE|sourceUrl|rawRow|properties|originalStart/);
  const legacy = header.map(label => label === '專案主管' ? '負責人' : label);
  assert.equal(setup({ header: legacy, rows: [row({ '負責人': 'LegacyLead' }, legacy)] }).rpc('getTimeline').projects[0].owner, 'LegacyLead');
});

test('both adapters share identity-free slots and invalid slot IDs cannot overwrite a real project team detail', () => {
  const values = [slotRow(), slotRow(), slotRow({ '時段工作區': 'B' }),
    row({}, slotHeader), slotRow({ '案號': 'C-001', '專案／範圍': 'RejectedSlotName', '客戶': 'RejectedSlotCustomer', '窗口': 'RejectedSlotContact', '執行者': 'RejectedSlotAssignee' })];
  const publicPayload = plain(setup({ header: slotHeader, rows: values }, publicCode).rpc('getTimeline'));
  const team = setup({ header: slotHeader, rows: values }), payload = plain(team.rpc('getTimeline'));
  assert.equal(payload.schemaVersion, 4); assert.equal(team.state.reads.length, 1);
  assert.deepEqual(payload.reservationSlots, publicPayload.reservationSlots);
  assert.deepEqual(payload.reservationSlots, [{ workspaceId: 'D', start: '2026-11', end: '2026-11' }, { workspaceId: 'B', start: '2026-11', end: '2026-11' }]);
  assert.deepEqual(payload.warnings, ['reservation-slot-duplicate', 'reservation-slot-invalid']);
  assert.equal(payload.projects.length, 1); assert.equal(payload.projects[0].name, 'FictionalProject');
  assert.equal(payload.projects[0].customer, 'FictionalCustomer'); assert.equal(payload.projects[0].contact, 'FictionalContact'); assert.equal(payload.projects[0].assignee, 'FictionalExecutor');
  assert.doesNotMatch(JSON.stringify(payload), /RejectedSlot/);
  assert.deepEqual(payload.projects[0].pendingReasons, []);
});

test('source failures return a generic error and never substitute cached data', () => {
  const denied = setup({ readError: '403 Permission denied ' + SOURCE_ID + ' https://private.example/source FictionalCustomer' });
  assert.throws(() => denied.rpc('getTimeline'), { message: INTERNAL_ERROR });
  assert.equal(denied.state.reads.length, 1);
  const allowed = setup();
  assert.equal(allowed.rpc('getTimeline').projects[0].name, 'FictionalProject');
  // A subsequent request must read Sheets again; earlier data cannot substitute
  // for an unavailable current source.
  allowed.context.Sheets.Spreadsheets.Values.get = () => { throw new Error('403 revoked sharing PRIVATE_SOURCE'); };
  assert.throws(() => allowed.rpc('getTimeline'), { message: INTERNAL_ERROR });
});

test('every successful request rereads the main sheet and sees current changes', () => {
  const env = setup();
  assert.equal(env.rpc('getTimeline').projects[0].name, 'FictionalProject');
  env.rows[5][header.indexOf('專案／範圍')] = 'FictionalUpdatedProject';
  assert.equal(env.rpc('getTimeline').projects[0].name, 'FictionalUpdatedProject');
  assert.equal(env.state.reads.length, 2);
});

test('internal data shares public date, correction, pending, reservation, follow-up and allocation semantics', () => {
  const scenarios = [
    {},
    { '目前排程開始': '2027-04', '目前排程結束': '2027-06', '排程性質': '時段預約', '工作區 A 占用': '5' },
    { '目前排程開始': '', '目前排程結束': '', '延長修正／補充': '改期，日期待確認' },
    { '目前排程開始': '', '目前排程結束': '', '延長修正／補充': '' },
    { '目前排程開始': '2027-02', '目前排程結束': '2027-01', '工作區 A 占用': '不確定' },
    { '延長修正／補充': '原期後持續修正；新終點待定', '未結事項': '已處理' },
    { '延長修正／補充': '原期後持續修正；新終點待定', '未結事項': '待收款中、客戶確認中' },
    { '未結事項': '待收款中、私人文字', '排程性質': '未知類型' },
    { '修正開始': '2027-03', '修正結束': '2027-04', '工作區 A 占用': '', '工作區 C 占用': '3' },
    { '修正開始': '2027-03', '修正結束': '', '未結事項': '客戶確認中' }
  ];
  for (const changes of scenarios) {
    const options = { rows: [row(changes)] };
    const internal = plain(setup(options).rpc('getTimeline'));
    for (const project of internal.projects) for (const key of internalOnlyKeys) delete project[key];
    assert.deepEqual(internal, plain(setup(options, publicCode).rpc('getTimeline')));
  }
});

test('private fields attach by project ID when invalid source rows are skipped and headers move', () => {
  const columns = [...header, '私人設定'].reverse();
  const options = { header: columns, rows: [
    row({ '案號': 'INVALID_PRIVATE_ID', '專案／範圍': 'SkippedProject' }, columns),
    row({ '案號': 'BG-002', '專案／範圍': 'BackgroundProject', '工作區 C 占用': '2', '私人設定': 'PRIVATE_SETTINGS' }, columns),
    row({ '案號': 'C-001', '專案／範圍': 'CharacterProject' }, columns)
  ] };
  const payload = plain(setup(options).rpc('getTimeline'));
  assert.deepEqual(payload.projects.map(project => [project.id, project.name]), [['BG-002', 'BackgroundProject'], ['C-001', 'CharacterProject']]);
  assert.deepEqual(payload.warnings, ['project-id-invalid']);
  assert.doesNotMatch(JSON.stringify(payload), /PRIVATE|SkippedProject|private\.example/);
});

test('empty optional internal columns return empty text and older W/X headers retain the shared migration behavior', () => {
  const columns = header.filter(label => !['專案／範圍', '客戶', '專案主管', '狀態', '目前交付目標', '窗口', '執行者', '交付步驟（參考）', '排程性質', '未結事項'].includes(label));
  const payload = plain(setup({ header: columns, rows: [row({}, columns)] }).rpc('getTimeline'));
  assert.ok(privateKeys.every(key => payload.projects[0][key] === ''));
  assert.equal(payload.projects[0].scheduleKind, 'production');
  assert.deepEqual(payload.projects[0].followUp, []);
  assert.deepEqual(payload.projects[0].pendingReasons, []);
});

test('internal free text is bounded while preserving plain text and valid Unicode at the boundary', () => {
  const changes = {
    '專案／範圍': '  <script>Fictional</script>  ',
    '客戶': 'x'.repeat(5000), '專案主管': 'x'.repeat(3999) + '😀',
    '延長修正／補充': '  第一行\n第二行  '
  };
  const item = setup({ rows: [row(changes)] }).rpc('getTimeline').projects[0];
  assert.equal(item.name, '<script>Fictional</script>');
  assert.equal(item.customer.length, 4000);
  assert.equal(item.owner.length, 3999);
  assert.equal(item.notes, '第一行\n第二行');
  assert.ok(privateKeys.every(key => typeof item[key] === 'string' && item[key].length <= 4000));
});

test('invalid headers, duplicate project IDs and malformed/oversized source fail without partial private output', () => {
  const oversized = [[], [], [], [], header, ...Array.from({ length: 996 }, () => [])];
  for (const options of [
    { header: [...header, '案號'] }, { header: header.filter(label => label !== '客戶編號') },
    { header: [...header, '負責人'] }, { header: [...header, '專案主管'] },
    { header: [...header.filter(label => label !== '專案主管'), '負責人', '負責人'] },
    { rows: [row(), row()] }, { response: {} }, { values: [] }, { values: oversized },
    { header: [...header, ...Array(43).fill('')] }
  ]) assert.throws(() => setup(options).rpc('getTimeline'), { message: INTERNAL_ERROR });
  assert.deepEqual(plain(setup({ rows: [] }).rpc('getTimeline').projects), []);
});

test('source properties and client-supplied parameters cannot select another source or bypass reads', () => {
  for (const properties of [{}, { SOURCE_SHEET_ID: '' }, { SOURCE_SHEET_ID: 'tiny' }, { SOURCE_SHEET_ID: SOURCE_ID, INTERNAL_SECRET: 'PRIVATE' }]) {
    const env = setup({ properties });
    assert.throws(() => env.rpc('getTimeline'), { message: INTERNAL_ERROR });
    assert.equal(env.state.reads.length, 0);
  }
  for (const argument of [undefined, null, {}, SOURCE_ID, { source: SOURCE_ID }, { rows: [row()] }, { id: 'C-001' }]) {
    const env = setup();
    assert.throws(() => env.rpc('getTimeline', argument), { message: INTERNAL_ERROR });
    assert.equal(env.state.reads.length, 0);
  }
});

test('anonymous teamspace JSON GET freshly reads the same source and includes exactly nine text fields for pending and scheduled records', () => {
  const env = setup({ rows: [row(), row({ '案號': 'BG-002', '工作區 A 占用': '', '目前排程結束': '' })] });
  const firstOutput = env.rpc('doGet', { queryString: '', parameter: {}, parameters: {}, pathInfo: '' });
  assert.equal(firstOutput.mimeType, 'JSON');
  const first = JSON.parse(firstOutput.content);
  assert.equal(first.projects.length, 2);
  assert.deepEqual(first, plain(setup({ rows: env.rows.slice(5) }).rpc('getTimeline')));
  for (const item of first.projects) {
    assert.deepEqual(Object.keys(item).sort(), ['id', 'customerCode', 'customerType', 'start', 'end',
      'correctionStart', 'correctionEnd', 'scheduleKind', 'followUp', 'workspaceIds', 'workspaceUnits', 'pendingReasons',
      ...privateKeys].sort());
  }
  assert.ok(first.projects[1].pendingReasons.includes('no-workspace'));
  assert.ok(first.projects[1].pendingReasons.includes('production-dates'));
  assert.doesNotMatch(firstOutput.content, /private\.example|FICTIONAL_INTERNAL_SOURCE|sourceUrl|rawRow|properties/);
  env.rows[5][header.indexOf('專案／範圍')] = 'FictionalUpdatedProject';
  env.rows[5][header.indexOf('目前交付目標')] = 'FictionalUpdatedGoal';
  const second = JSON.parse(env.rpc('doGet').content);
  assert.equal(first.projects[0].name, 'FictionalProject');
  assert.equal(second.projects[0].name, 'FictionalUpdatedProject');
  assert.equal(second.projects[0].deliveryGoal, 'FictionalUpdatedGoal');
  assert.equal(env.state.reads.length, 2);
  assert.deepEqual(env.state.reads[1], env.state.reads[0]);
  const publicPayload = JSON.parse(setup({ rows: env.rows.slice(5) }, publicCode).rpc('doGet').content);
  const sharedPayload = plain(second);
  for (const item of sharedPayload.projects) for (const key of internalOnlyKeys) delete item[key];
  assert.deepEqual(publicPayload, sharedPayload);
});

test('teamspace JSON GET rejects parameters, extra paths and arguments without source reads', () => {
  const env = setup();
  for (const event of [{ queryString: 'mode=internal' }, { parameter: { source: '' } }, { parameters: { source: [''] } }, { pathInfo: 'internal' }, { postData: {} }, 'internal']) {
    const output = env.rpc('doGet', event);
    assert.equal(output.mimeType, 'JSON');
    assert.deepEqual(JSON.parse(output.content), { error: INTERNAL_ERROR });
  }
  assert.deepEqual(JSON.parse(env.rpc('doGet', {}, {}).content), { error: INTERNAL_ERROR });
  assert.equal(env.state.reads.length, 0);
  assert.doesNotMatch(adapterCode, /USER_ACCESSING|登入帳號|Session\./);
});

test('teamspace JSON GET failures expose only generic errors and cannot return earlier source data', () => {
  for (const options of [{ readError: 'PRIVATE_READ_ERROR ' + SOURCE_ID }, { properties: {} }, { response: {} }, { rows: [row(), row()] }]) {
    const output = setup(options).rpc('doGet');
    assert.equal(output.mimeType, 'JSON');
    assert.deepEqual(JSON.parse(output.content), { error: INTERNAL_ERROR });
    assert.doesNotMatch(output.content, /PRIVATE|FICTIONAL_INTERNAL_SOURCE|private\.example|projects/);
  }
  const env = setup();
  assert.equal(JSON.parse(env.rpc('doGet').content).projects[0].name, 'FictionalProject');
  env.context.Sheets.Spreadsheets.Values.get = () => {
    env.state.reads.push({ denied: true });
    throw new Error('PRIVATE_REVOKED_SOURCE ' + SOURCE_ID);
  };
  assert.deepEqual(JSON.parse(env.rpc('doGet').content), { error: INTERNAL_ERROR });
  assert.equal(env.state.reads.length, 2);
  assert.throws(() => setup({ outputError: true }).rpc('doGet'), { message: INTERNAL_ERROR });
});

test('the bundled RPC surface has only the internal read endpoints and no credential/write/cache APIs', () => {
  const functions = [...(sharedCode + '\n' + adapterCode).matchAll(/^function (\w+)\(/gm)].map(match => match[1]);
  assert.deepEqual(functions.filter(name => !name.endsWith('_')), ['doGet', 'getTimeline']);
  const env = setup();
  for (const name of ['publicDoGet_', 'publicGetTimeline_', 'publicRows_', 'internalRows_', 'internalText_', 'doPost', 'saveLayout', 'publishApprovedSnapshot']) {
    assert.throws(() => env.rpc(name), /unavailable/);
  }
  assert.doesNotMatch(adapterCode, /SpreadsheetApp|DriveApp|Session\.|LockService|CacheService|setValues|appendRow|batchUpdate|Values\.update|setProperty|UrlFetchApp|ScriptApp|Logger|console\./);
});

test('public omits the four teamspace-only fields while teamspace preserves its complete authorized details', () => {
  const payload = plain(setup({}, publicCode).rpc('getTimeline'));
  for (const key of internalOnlyKeys) assert.ok(!Object.hasOwn(payload.projects[0], key));
  const internal = plain(setup().rpc('getTimeline'));
  assert.ok(privateKeys.every(key => Object.hasOwn(internal.projects[0], key)));
  for (const project of internal.projects) for (const key of internalOnlyKeys) delete project[key];
  assert.deepEqual(payload, internal);
  assert.equal(payload.projects[0].customerType, 'VTuber公司');
  assert.doesNotMatch(JSON.stringify(payload), /FictionalProject|FictionalCustomer|FictionalContact|FictionalExecutor|private\.example|FICTIONAL_INTERNAL_SOURCE|sourceUrl|rawRow/);
  assert.throws(() => setup({ readError: 'PRIVATE_ERROR' }, publicCode).rpc('getTimeline'), { message: PUBLIC_ERROR });
});
