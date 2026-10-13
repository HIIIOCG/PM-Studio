/** Read-only public schedule. Source rows never cross the server boundary. */
const PM_SCHEDULE_ = Object.freeze({
  tab: '專案列表',
  error: '排程目前無法讀取，請稍後重試。',
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
    return HtmlService.createHtmlOutputFromFile('Index').setTitle('PM Studio')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (error) { throw new Error(PM_SCHEDULE_.error); }
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
      schemaVersion: 2,
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
  const header = rows[0].map(text_);
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
      || !rawCorrectionStart && !rawCorrectionEnd && correctionPending_(supplement)) pending.add('correction-dates');

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
    projects.push({ id: id, customerCode: customerCode, start: start, end: end,
      correctionStart: correctionStart, correctionEnd: correctionEnd,
      workspaceIds: workspaceIds, workspaceUnits: workspaceUnits, pendingReasons: Array.from(pending) });
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
  const first = parseDay_(start), last = parseDay_(end);
  return first !== null && last !== null && first <= last;
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
