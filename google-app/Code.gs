/** Read-only public schedule. Source rows never cross the server boundary. */
const PM_SCHEDULE_ = Object.freeze({
  tab: '專案列表',
  error: '排程目前無法讀取，請稍後重試。',
  textLimit: 4000,
  customerTypes: Object.freeze(['VTuber個人', 'VTuber公司', '遊戲公司', '其他']),
  fields: Object.freeze({
    owner: '專案主管', status: '狀態', deliveryGoal: '目前交付目標',
    notes: '延長修正／補充', deliverySteps: '交付步驟（參考）'
  }),
  workspaces: [
    { id: 'A', name: '工作區 A', usualLoad: 2 },
    { id: 'B', name: '工作區 B', usualLoad: 2 },
    { id: 'C', name: '工作區 C' },
    { id: 'D', name: '工作區 D' }
  ],
  required: ['案號', '客戶編號', '原始開始', '原始結束', '目前排程開始', '目前排程結束',
    '修正開始', '修正結束', '工作區 A 占用', '工作區 B 占用', '工作區 C 占用', '工作區 D 占用']
});

function doGet(e) {
  try {
    if (arguments.length > 1) throw new Error('request');
    noParameters_(e);
    return ContentService.createTextOutput(JSON.stringify(getTimeline()))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    try {
      return ContentService.createTextOutput(JSON.stringify({ error: PM_SCHEDULE_.error }))
        .setMimeType(ContentService.MimeType.JSON);
    } catch (outputError) { throw new Error(PM_SCHEDULE_.error); }
  }
}

function getTimeline() {
  try {
    if (arguments.length) throw new Error('request');
    const properties = PropertiesService.getScriptProperties().getProperties();
    if (Object.keys(properties).length !== 1 || !Object.prototype.hasOwnProperty.call(properties, 'SOURCE_SHEET_ID')) throw new Error('configuration');
    const sourceId = text_(properties.SOURCE_SHEET_ID);
    if (!/^[A-Za-z0-9_-]{8,}$/u.test(sourceId)) throw new Error('configuration');
    // Advanced Sheets supports a genuinely read-only OAuth scope. Formatted values
    // preserve the same visible precision as getDisplayValues, without date guessing.
    const response = Sheets.Spreadsheets.Values.get(sourceId, "'" + PM_SCHEDULE_.tab + "'", {
      majorDimension: 'ROWS', valueRenderOption: 'FORMATTED_VALUE'
    });
    const rows = response.values;
    if (!Array.isArray(rows) || rows.length < 5 || rows.length > 1000
      || rows.some(function(row) { return !Array.isArray(row) || row.length > 64; })) throw new Error('source');
    const result = publicRows_(rows.slice(4));
    return {
      schemaVersion: 3,
      today: Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd'),
      syncedAt: new Date().toISOString(),
      projects: result.projects,
      workspaces: PM_SCHEDULE_.workspaces.map(function(workspace) { return Object.assign({}, workspace); }),
      warnings: result.warnings
    };
  } catch (error) {
    // Service errors may contain private sheet IDs, names, links or row values.
    throw new Error(PM_SCHEDULE_.error);
  }
}

function publicRows_(rows) {
  if (!Array.isArray(rows) || !Array.isArray(rows[0])) throw new Error('headers');
  // Normalize the former label before duplicate checking. Either unique label
  // is readable during migration; competing columns must never be guessed.
  const header = rows[0].map(function(value) {
    const label = text_(value);
    return label === '負責人' ? PM_SCHEDULE_.fields.owner : label;
  });
  const nonempty = header.filter(Boolean);
  if (new Set(nonempty).size !== nonempty.length || PM_SCHEDULE_.required.some(function(label) { return !header.includes(label); })) throw new Error('headers');
  const ids = new Set(), warnings = new Set(), projects = [];
  rows.slice(1).forEach(function(row) {
    if (!Array.isArray(row) || !row.some(function(value) { return text_(value) !== ''; })) return;
    const field = function(label) { return text_(row[header.indexOf(label)]); };
    const id = field('案號');
    if (!id) { warnings.add('project-id-missing'); return; }
    if (!/^(?:C|BG|P|D|O)-\d{3,}$/u.test(id)) { warnings.add('project-id-invalid'); return; }
    if (ids.has(id)) throw new Error('duplicate project');
    ids.add(id);
    const pending = new Set();
    const rawCustomer = field('客戶編號');
    const customerCode = /^[A-Z]+-\d+$/u.test(rawCustomer) ? rawCustomer : '';
    if (!customerCode) pending.add('customer-code');
    const rawCustomerType = field('客戶類型');
    const customerType = PM_SCHEDULE_.customerTypes.includes(rawCustomerType) ? rawCustomerType : '';
    if (rawCustomerType && !customerType) pending.add('customer-type');

    // These optional source columns allow an older sheet to remain readable while
    // it is upgraded. Public values are fixed enums, never free-form status text.
    const rawScheduleKind = field('排程性質');
    const scheduleKind = rawScheduleKind === '時段預約' ? 'reservation' : 'production';
    if (rawScheduleKind && !['製作排程', '時段預約'].includes(rawScheduleKind)) pending.add('schedule-kind');
    const rawFollowUp = field('未結事項');
    const parsedFollowUp = followUp_(rawFollowUp);
    if (parsedFollowUp === null) pending.add('follow-up-values');
    const followUp = parsedFollowUp || [];

    let rawStart = field('目前排程開始'), rawEnd = field('目前排程結束');
    const supplement = field('延長修正／補充');
    if (!rawStart && !rawEnd && !rescheduled_(supplement)) {
      rawStart = field('原始開始'); rawEnd = field('原始結束');
    }
    const start = dateText_(rawStart), end = dateText_(rawEnd);
    if (!validRange_(start, end)) pending.add('production-dates');
    const rawCorrectionStart = field('修正開始'), rawCorrectionEnd = field('修正結束');
    const correctionStart = dateText_(rawCorrectionStart), correctionEnd = dateText_(rawCorrectionEnd);
    if ((rawCorrectionStart || rawCorrectionEnd) && !validRange_(correctionStart, correctionEnd)
      || !rawCorrectionStart && !rawCorrectionEnd && !(rawFollowUp && parsedFollowUp !== null)
        && correctionPending_(supplement)) pending.add('correction-dates');

    const workspaceIds = [], workspaceUnits = {};
    PM_SCHEDULE_.workspaces.forEach(function(workspace) {
      const raw = field('工作區 ' + workspace.id + ' 占用');
      if (!raw) return;
      const units = Number(raw);
      // Safe integer handling is a technical bound, never a production capacity.
      if (!/^[1-9]\d*$/u.test(raw) || !Number.isSafeInteger(units)) { pending.add('workspace-values'); return; }
      workspaceIds.push(workspace.id); workspaceUnits[workspace.id] = units;
    });
    if (!workspaceIds.length) pending.add('no-workspace');
    // Construct the response field by field. Never spread a source row or private object.
    const project = { id: id, customerCode: customerCode, customerType: customerType, start: start, end: end,
      correctionStart: correctionStart, correctionEnd: correctionEnd,
      scheduleKind: scheduleKind, followUp: followUp,
      workspaceIds: workspaceIds, workspaceUnits: workspaceUnits, pendingReasons: Array.from(pending) };
    Object.keys(PM_SCHEDULE_.fields).forEach(function(key) {
      project[key] = detailText_(row[header.indexOf(PM_SCHEDULE_.fields[key])]);
    });
    projects.push(project);
  });
  return { projects: projects, warnings: Array.from(warnings) };
}

function dateText_(value) {
  return /^\d{4}-\d{2}(?:-\d{2})?$/u.test(value) ? value : '';
}

function parseDay_(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? Math.floor(date.getTime() / 86400000) : null;
}

function validRange_(start, end) {
  const first = dateBoundary_(start, false), last = dateBoundary_(end, true);
  return first !== null && last !== null && first <= last;
}

function dateBoundary_(value, last) {
  if (!/^\d{4}-\d{2}$/u.test(value)) return parseDay_(value);
  const first = parseDay_(value + '-01');
  if (first === null) return null;
  if (!last) return first;
  // Calendar envelopes are display/validation bounds only. The original month
  // string remains in the payload and is never converted to a claimed exact day.
  const date = new Date(first * 86400000);
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return Math.floor(date.getTime() / 86400000);
}

function followUp_(value) {
  if (!value || value === '已處理') return [];
  const labels = { '客戶確認中': 'customer-confirmation', '待收款中': 'payment' };
  const tokens = value.split(/[、,，\r\n]+/u).map(text_).filter(Boolean);
  if (!tokens.length || tokens.some(function(token) { return !Object.prototype.hasOwnProperty.call(labels, token); })) return null;
  // Canonical order and exact token matching keep even malformed private notes
  // from entering the response or being mistaken for an authorized status.
  return Object.keys(labels).filter(function(label) { return tokens.includes(label); }).map(function(label) { return labels[label]; });
}

function rescheduled_(value) {
  return /改期|延期|延長|延後|順延|待排|待定|日期未定|日期待|排程待|尚未.*(?:日期|排程)|(?:日期|排程).*(?:未確定|待確認)/u.test(value);
}

function correctionPending_(value) {
  return /修正.*(?:未定|待定|待確認|待排|未確定|新終點)|(?:未定|待定|待確認|待排|未確定).*修正|原期後持續修正/u.test(value);
}

function noParameters_(e) {
  if (e == null) return;
  if (Object.prototype.toString.call(e) !== '[object Object]'
    || text_(e.queryString) || text_(e.pathInfo)
    || Object.keys(e.parameter || {}).length || Object.keys(e.parameters || {}).length
    || e.postData) throw new Error('request');
}

function text_(value) { return value == null ? '' : String(value).trim(); }

function detailText_(value) {
  const bounded = text_(value).slice(0, PM_SCHEDULE_.textLimit);
  // Do not leave a split Unicode surrogate at the size boundary.
  return bounded.replace(/[\uD800-\uDBFF]$/u, '');
}
