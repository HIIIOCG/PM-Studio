/** Public app only. Deploy separately; only the anonymous feed is readable here. */
const PM_PUBLIC_ = Object.freeze({
  tab: '匿名排程',
  header: ['alias', 'approvedGoal', 'scheduleStart', 'scheduleEnd', 'workspaceIds', 'workspaceUnits'],
  workspaces: [
    { id: 'A', name: '3D角色模型 A', capacity: 2, unit: '角色', type: 'character' },
    { id: 'B', name: '3D角色模型 B', capacity: 2, unit: '角色', type: 'character' },
    { id: 'C', name: '額外模型項目', capacity: null, unit: '項目', type: 'additional-model' },
    { id: 'D', name: 'CT 遊戲美術外包', capacity: null, unit: '項目', type: 'ct-art' }
  ]
});

function doGet(e) {
  if (e && (publicText_(e.queryString) || publicText_(e.pathInfo)
    || Object.keys(e.parameter || {}).length || Object.keys(e.parameters || {}).length)) throw new Error('此入口不接受切換參數。');
  return HtmlService.createHtmlOutputFromFile('PublicIndex').setTitle('PM Studio・公開匿名排程');
}

function getTimeline() {
  if (arguments.length) throw new Error('此讀取不接受參數。');
  try {
    const properties = PropertiesService.getScriptProperties().getProperties();
    if (Object.keys(properties).some(function(key) { return key !== 'PUBLIC_FEED_SHEET_ID'; })) throw new Error('設定無效。');
    const id = publicText_(properties.PUBLIC_FEED_SHEET_ID);
    if (!/^[A-Za-z0-9_-]{8,}$/u.test(id)) throw new Error('設定無效。');
    const spreadsheet = SpreadsheetApp.openById(id);
    const sheets = spreadsheet.getSheets();
    if (sheets.length !== 1 || sheets[0].getName() !== PM_PUBLIC_.tab) throw new Error('資料結構無效。');
    const sheet = sheets[0];
    if (sheet.getLastRow() > 1000 || sheet.getLastColumn() !== 6) throw new Error('資料範圍無效。');
    const header = sheet.getRange(1, 1, 1, 6).getDisplayValues()[0];
    if (JSON.stringify(header) !== JSON.stringify(PM_PUBLIC_.header)) throw new Error('資料欄位無效。');
    const range = sheet.getRange(1, 1, Math.max(1, sheet.getLastRow()), 6);
    if (range.getFormulas().some(function(row) { return row.some(Boolean); })) throw new Error('資料不可包含公式。');
    const aliases = new Set();
    const projects = range.getDisplayValues().slice(1).filter(function(row) {
      return row.some(function(value) { return publicText_(value) !== ''; });
    }).map(function(row) { return publicProject_(row, aliases); });
    return { mode: 'public', today: Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd'),
      syncedAt: '', projects: projects, workspaces: PM_PUBLIC_.workspaces, warnings: [], permissions: { canEditLayout: false } };
  } catch (error) {
    // Never forward service exceptions, IDs, links, or data to anonymous visitors.
    throw new Error('公開排程目前無法讀取，請稍後重試。');
  }
}

function publicProject_(row, aliases) {
  const alias = row[0], goal = row[1], start = row[2], end = row[3];
  if (typeof alias !== 'string' || !/^專案 \d{3,}$/u.test(alias) || aliases.has(alias)) throw new Error('匿名名稱無效。');
  aliases.add(alias);
  if (typeof goal !== 'string' || !goal || goal !== goal.trim() || goal.length > 500
    || /https?:\/\/|www\.|@|\b(?:C|BG|P|D|O)-\d{3,}\b|[\u0000-\u001f]|^[=+\-]/iu.test(goal)) throw new Error('匿名內容無效。');
  const startDay = publicDay_(start), endDay = publicDay_(end);
  if (startDay === null || endDay === null || startDay > endDay) throw new Error('排程日期無效。');
  const ids = JSON.parse(row[4]), units = JSON.parse(row[5]);
  if (!Array.isArray(ids) || !ids.length || ids.length > 4 || new Set(ids).size !== ids.length
    || ids.some(function(id) { return !['A', 'B', 'C', 'D'].includes(id); })
    || !units || Object.prototype.toString.call(units) !== '[object Object]'
    || Object.keys(units).length !== ids.length || Object.keys(units).some(function(id) { return !ids.includes(id); })
    || ids.some(function(id) { return !Number.isInteger(units[id]) || units[id] < 1 || units[id] > (['A', 'B'].includes(id) ? 2 : 1000); })) throw new Error('公開工作區無效。');
  const safeUnits = {}; ids.forEach(function(id) { safeUnits[id] = units[id]; });
  return { alias: alias, goal: goal, start: start, end: end, workspaceIds: ids.slice(), workspaceUnits: safeUnits };
}

function publicDay_(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? Math.floor(date.getTime() / 86400000) : null;
}

function publicText_(value) { return value == null ? '' : String(value).trim(); }
