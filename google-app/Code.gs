/** Internal app only. Deploy USER_ACCESSING; never bundle with PublicCode.gs. */
const PM_INTERNAL_ = Object.freeze({
  sourceTab: '專案列表', layoutTab: '工作區安排', approvalTab: '公開設定', feedTab: '匿名排程',
  layoutHeader: ['projectId', 'workspaceIds', 'workspaceUnits', 'updatedAt'],
  approvalHeader: ['projectId', 'approved', 'alias', 'approvedGoal', 'scheduleStart', 'scheduleEnd', 'approvedRevision'],
  feedHeader: ['alias', 'approvedGoal', 'scheduleStart', 'scheduleEnd', 'workspaceIds', 'workspaceUnits'],
  workspaces: [
    { id: 'A', name: '3D角色模型 A', capacity: null, usualLoad: 2, unit: '角色', type: 'character' },
    { id: 'B', name: '3D角色模型 B', capacity: null, usualLoad: 2, unit: '角色', type: 'character' },
    { id: 'C', name: '角色與場景模型', capacity: null, unit: '項目', type: 'character-and-scene' },
    { id: 'D', name: 'CT 遊戲美術外包', capacity: null, unit: '項目', type: 'ct-art' }
  ]
});

function doGet(e) {
  const access = internalAccess_();
  noQuery_(e);
  loadInternal_(access); // Check the actual resources under the visitor's identity.
  return HtmlService.createHtmlOutputFromFile('Index').setTitle('PM Studio・內部排程');
}

function getTimeline() {
  const access = internalAccess_();
  if (arguments.length) throw new Error('此讀取不接受參數。');
  return loadInternal_(access).payload;
}

function saveLayout(input) {
  const access = internalAccess_();
  if (arguments.length !== 1) throw new Error('工作區請求格式無效。');
  exactKeys_(input, ['assignments', 'allocations', 'revision']);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('其他人正在儲存，請稍後重試。');
  try {
    const current = loadInternal_(access);
    requireRevision_(input.revision, current.payload.revision);
    const layout = validateLayout_(input.assignments, input.allocations, current.payload.projects);
    const time = new Date().toISOString();
    const rows = Object.keys(layout.assignments).sort().map(function(id) {
      return [id, JSON.stringify(layout.assignments[id]), JSON.stringify(layout.allocations[id]), time];
    });
    replaceRows_(current.layoutSheet, rows, 4);
    SpreadsheetApp.flush();
    return loadInternal_(access).payload;
  } finally { lock.releaseLock(); }
}

/** Explicit supervisor approval, never automatic promotion of the source goal. */
function publishApprovedSnapshot(input) {
  const access = internalAccess_();
  requirePublisher_(access);
  if (arguments.length !== 1) throw new Error('公開核准請求格式無效。');
  exactKeys_(input, ['revision', 'approvals']);
  if (!Array.isArray(input.approvals) || input.approvals.length > 995) throw new Error('公開核准清單無效。');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('其他人正在儲存，請稍後重試。');
  try {
    const current = loadInternal_(access);
    requireRevision_(input.revision, current.payload.revision);
    const projection = approvedProjection_(input.approvals, current.payload.projects);
    const feedId = requiredProperty_(access.properties, 'PUBLIC_FEED_SHEET_ID');
    if ([access.sourceId, access.settingsId].includes(feedId)) throw new Error('匿名資料必須使用獨立檔案。');
    const feed = SpreadsheetApp.openById(feedId);
    const feedSheet = safeFeedSheet_(feed);
    const approvalSheet = requiredTab_(current.settings, PM_INTERNAL_.approvalTab);
    readTable_(approvalSheet, PM_INTERNAL_.approvalHeader);
    const approvalRows = input.approvals.map(function(item) {
      return [item.projectId, 'TRUE', item.alias, item.approvedGoal, item.scheduleStart, item.scheduleEnd, input.revision];
    });
    // All checks finish before writes; only the six approved fields enter this file.
    replaceRows_(feedSheet, projection, 6);
    replaceRows_(approvalSheet, approvalRows, 7);
    SpreadsheetApp.flush();
    return { published: projection.length, revision: current.payload.revision };
  } finally { lock.releaseLock(); }
}

function internalAccess_() {
  const email = text_(Session.getActiveUser().getEmail()).toLowerCase();
  const effective = text_(Session.getEffectiveUser().getEmail()).toLowerCase();
  if (!email || email !== effective) throw new Error('請以自己的 Google 身分授權內部排程。');
  const properties = PropertiesService.getScriptProperties().getProperties();
  const folderId = requiredProperty_(properties, 'INTERNAL_FOLDER_ID');
  const sourceId = requiredProperty_(properties, 'INTERNAL_SHEET_ID');
  const settingsId = requiredProperty_(properties, 'SETTINGS_SHEET_ID');
  if (sourceId === settingsId) throw new Error('排程設定必須使用獨立檔案。');
  try { DriveApp.getFolderById(folderId).getName(); }
  catch (error) { throw new Error('沒有指定 HIIIO DIGITAL 專案資料夾的讀取權限。'); }
  return { email: email, sourceId: sourceId, settingsId: settingsId, properties: properties };
}

function requirePublisher_(access) {
  let publishers;
  try { publishers = JSON.parse(access.properties.PUBLISHERS_JSON || '[]'); }
  catch (error) { throw new Error('公開核准權限尚未設定。'); }
  if (!Array.isArray(publishers) || !publishers.some(function(email) {
    return typeof email === 'string' && email.trim().toLowerCase() === access.email;
  })) throw new Error('尚未取得主管公開核准權限。');
}

function loadInternal_(access) {
  let source, settings;
  try {
    source = SpreadsheetApp.openById(access.sourceId);
    settings = SpreadsheetApp.openById(access.settingsId);
  } catch (error) { throw new Error('沒有專案列表或排程設定的讀取權限。'); }
  const sourceSheet = requiredTab_(source, PM_INTERNAL_.sourceTab);
  if (sourceSheet.getLastRow() > 1000 || sourceSheet.getLastColumn() > 64) throw new Error('專案列表超出目前支援範圍。');
  const width = sourceSheet.getLastColumn();
  if (width < 1 || sourceSheet.getLastRow() < 5) throw new Error('專案列表缺少第 5 列表頭。');
  const rows = sourceSheet.getRange(5, 1, Math.max(1, sourceSheet.getLastRow() - 4), width).getDisplayValues();
  const projects = adaptSheetRows_(rows);
  const dataColumn = rows[0].map(text_).indexOf('資料');
  if (dataColumn >= 0 && rows.length > 1) {
    const rich = sourceSheet.getRange(6, dataColumn + 1, rows.length - 1, 1).getRichTextValues();
    const idColumn = rows[0].map(text_).indexOf('案號');
    const links = {};
    rows.slice(1).forEach(function(row, index) { links[text_(row[idColumn])] = richLinks_(rich[index][0]); });
    projects.forEach(function(project) { project.sourceLinks = links[project.id] || []; });
  }
  const layoutSheet = requiredTab_(settings, PM_INTERNAL_.layoutTab);
  const layoutRows = readTable_(layoutSheet, PM_INTERNAL_.layoutHeader);
  const assignments = {}, allocations = {};
  layoutRows.forEach(function(row) {
    const id = text_(row[0]);
    if (Object.prototype.hasOwnProperty.call(assignments, id)) throw new Error('工作區安排有重複案號。');
    try { assignments[id] = JSON.parse(row[1]); allocations[id] = JSON.parse(row[2]); }
    catch (error) { throw new Error('工作區安排儲存格式無效。'); }
  });
  const layout = validateLayout_(assignments, allocations, projects);
  projects.forEach(function(project) {
    project.workspaceIds = layout.assignments[project.id] || [];
    project.workspaceUnits = layout.allocations[project.id] || {};
  });
  const revision = hash_(JSON.stringify({ rows: rows, links: projects.map(function(p) { return p.sourceLinks; }), layout: layoutRows }));
  const warnings = [];
  if (projects.some(function(project) { return !getProjectDates_(project); })) warnings.push('部分日期尚未完整確定，保留待排。');
  return { settings: settings, layoutSheet: layoutSheet, payload: {
    mode: 'internal', today: today_(), syncedAt: new Date().toISOString(), revision: revision,
    projects: projects, workspaces: PM_INTERNAL_.workspaces, warnings: warnings,
    permissions: { canEditLayout: true }, sourceUrl: 'https://docs.google.com/spreadsheets/d/' + access.sourceId + '/edit'
  } };
}

function validateLayout_(assignments, allocations, projects) {
  object_(assignments); object_(allocations);
  const known = new Set(projects.map(function(project) { return project.id; }));
  const allowed = PM_INTERNAL_.workspaces;
  const result = { assignments: {}, allocations: {} };
  Object.keys(allocations).forEach(function(id) {
    if (!Object.prototype.hasOwnProperty.call(assignments, id)) throw new Error('占用數量缺少對應工作區安排。');
  });
  Object.keys(assignments).sort().forEach(function(id) {
    if (!known.has(id)) throw new Error('工作區安排包含未知案號。');
    const ids = assignments[id];
    if (!Array.isArray(ids) || ids.length > allowed.length || new Set(ids).size !== ids.length
      || ids.some(function(area) { return !allowed.some(function(workspace) { return workspace.id === area; }); })) throw new Error('工作區安排無效。');
    const units = allocations[id];
    object_(units);
    if (Object.keys(units).length !== ids.length || Object.keys(units).some(function(area) { return !ids.includes(area); })) throw new Error('占用數量與工作區不一致。');
    result.assignments[id] = allowed.map(function(w) { return w.id; }).filter(function(area) { return ids.includes(area); });
    result.allocations[id] = {};
    result.assignments[id].forEach(function(area) {
      // Bound the data size; this is not a confirmed production capacity.
      if (!Number.isInteger(units[area]) || units[area] < 1 || units[area] > 1000) throw new Error('工作區占用數量無效。');
      result.allocations[id][area] = units[area];
    });
  });
  return result;
}

function approvedProjection_(approvals, projects) {
  const ids = new Set(), aliases = new Set();
  const privateTerms = [];
  projects.forEach(function(p) { [p.name, p.customer, p.owner, p.executor].forEach(function(value) {
    if (text_(value).length >= 2) privateTerms.push(text_(value).toLowerCase());
  }); });
  return approvals.map(function(item) {
    exactKeys_(item, ['projectId', 'approved', 'alias', 'approvedGoal', 'scheduleStart', 'scheduleEnd', 'workspaceIds', 'workspaceUnits']);
    const project = projects.find(function(p) { return p.id === item.projectId; });
    if (!project || ids.has(item.projectId) || item.approved !== true) throw new Error('每案都須主管明確核准。');
    ids.add(item.projectId);
    if (typeof item.alias !== 'string' || !/^專案 \d{3,}$/u.test(item.alias) || aliases.has(item.alias)) throw new Error('匿名名稱無效或重複。');
    aliases.add(item.alias);
    if (!project.externalAlias || item.alias !== project.externalAlias) throw new Error('匿名名稱須先在主表確認，且與核准名稱一致。');
    const goal = approvedText_(item.approvedGoal);
    if (privateTerms.some(function(term) { return goal.toLowerCase().includes(term); })) throw new Error('核准目標仍包含內部專名，請重新確認匿名內容。');
    const dates = getProjectDates_(project);
    if (!dates || item.scheduleStart !== dates.start || item.scheduleEnd !== dates.end) throw new Error('公開日期必須是最新且完整確認的排程。');
    const assignment = {}; assignment[item.projectId] = item.workspaceIds;
    const allocation = {}; allocation[item.projectId] = item.workspaceUnits;
    const layout = validateLayout_(assignment, allocation, projects);
    if (!layout.assignments[item.projectId].length
      || JSON.stringify(layout.assignments[item.projectId]) !== JSON.stringify(project.workspaceIds)
      || JSON.stringify(layout.allocations[item.projectId]) !== JSON.stringify(project.workspaceUnits)) throw new Error('公開工作區須與已確認安排一致。');
    return [item.alias, goal, dates.start, dates.end, JSON.stringify(layout.assignments[item.projectId]), JSON.stringify(layout.allocations[item.projectId])];
  });
}

function approvedText_(value) {
  if (typeof value !== 'string' || value !== value.trim() || !value || value.length > 500
    || /https?:\/\/|www\.|@|\b(?:C|BG|P|D|O)-\d{3,}\b|[\u0000-\u001f]|^[=+\-]/iu.test(value)) throw new Error('核准目標須是不含連結、案號、姓名或公式的匿名文字。');
  return value;
}

function readTable_(sheet, expected) {
  if (sheet.getLastRow() > 1000 || sheet.getLastColumn() !== expected.length) throw new Error('設定表範圍或欄位無效。');
  const range = sheet.getRange(1, 1, Math.max(1, sheet.getLastRow()), expected.length);
  const rows = range.getDisplayValues();
  if (JSON.stringify(rows[0]) !== JSON.stringify(expected)) throw new Error('設定表欄位無效。');
  if (range.getFormulas().some(function(row) { return row.some(Boolean); })) throw new Error('設定與匿名資料不可包含公式。');
  return rows.slice(1).filter(function(row) { return row.some(function(value) { return text_(value) !== ''; }); });
}

function safeFeedSheet_(spreadsheet) {
  const sheets = spreadsheet.getSheets();
  if (sheets.length !== 1 || sheets[0].getName() !== PM_INTERNAL_.feedTab) throw new Error('匿名資料檔案結構無效。');
  readTable_(sheets[0], PM_INTERNAL_.feedHeader);
  return sheets[0];
}

function replaceRows_(sheet, rows, width) {
  if (rows.length > 999) throw new Error('資料超出目前支援範圍。');
  if (sheet.getMaxRows() < 1000) throw new Error('設定表需先準備 1000 列。');
  const values = Array.from({ length: 999 }, function(_, index) { return rows[index] || Array(width).fill(''); });
  const range = sheet.getRange(2, 1, 999, width);
  range.setValues(values); // Complete replacement also clears previous rich-text values/chips.
  range.clearNote();
}

function requireRevision_(received, current) {
  if (typeof received !== 'string' || received !== current) throw new Error('資料已被更新，請重新載入後再儲存。');
}

function requiredProperty_(properties, name) {
  const value = text_(properties[name]);
  if (!/^[A-Za-z0-9_-]{8,}$/u.test(value)) throw new Error('必要資料來源尚未設定。');
  return value;
}

function requiredTab_(spreadsheet, name) {
  const sheet = spreadsheet.getSheetByName(name);
  if (!sheet) throw new Error('缺少必要資料分頁。');
  return sheet;
}

function object_(value) {
  if (!value || Object.prototype.toString.call(value) !== '[object Object]') throw new Error('請求物件格式無效。');
}

function exactKeys_(value, expected) {
  object_(value);
  const keys = Object.keys(value).sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected.slice().sort())) throw new Error('請求包含不支援的欄位。');
}

function noQuery_(e) {
  if (e && (text_(e.queryString) || text_(e.pathInfo)
    || Object.keys(e.parameter || {}).length || Object.keys(e.parameters || {}).length)) throw new Error('此入口不接受切換參數。');
}

function richLinks_(rich) {
  if (!rich) return [];
  const values = [rich.getLinkUrl()].concat(rich.getRuns().map(function(run) { return run.getLinkUrl(); }));
  return Array.from(new Set(values.filter(function(value) { return typeof value === 'string' && /^https?:\/\//iu.test(value); })));
}

function hash_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8)
    .map(function(byte) { return ('0' + ((byte + 256) % 256).toString(16)).slice(-2); }).join('');
}

function today_() { return Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd'); }
function text_(value) { return value == null ? '' : String(value).trim(); }

// Extracted from scripts/timeline-core.mjs; parity covered by the Node tests.
function parseDay_(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? Math.floor(date.getTime() / 86400000) : null;
}

function getProjectDates_(project) {
  let start = text_(project.start), end = text_(project.end), basis = project.dateBasis || 'current';
  if (!start && !end) {
    if (/改期|延期|延長|延後|順延|待排|待定|日期未定|日期待|排程待|尚未.*(?:日期|排程)|(?:日期|排程).*(?:未確定|待確認)/u.test(text_(project.supplement))) return null;
    start = text_(project.originalStart); end = text_(project.originalEnd); basis = 'original';
  }
  const startDay = parseDay_(start), endDay = parseDay_(end);
  if (startDay === null || endDay === null || startDay > endDay) return null;
  return { start: start, end: end, startDay: startDay, endDay: endDay, basis: basis };
}

function adaptSheetRows_(rows) {
  const header = rows[0].map(text_);
  const nonempty = header.filter(Boolean);
  if (new Set(nonempty).size !== nonempty.length) throw new Error('專案列表表頭重複。');
  ['案號', '目前交付目標', '客戶', '負責人', '狀態', '原始開始', '原始結束'].forEach(function(label) {
    if (!header.includes(label)) throw new Error('專案列表缺少必要欄位。');
  });
  if (!header.includes('專案名稱') && !header.includes('專案／範圍')) throw new Error('專案列表缺少專案名稱。');
  const ids = new Set();
  return rows.slice(1).filter(function(row) { return text_(row[header.indexOf('案號')]); }).map(function(row) {
    function field(label) { return text_(row[header.indexOf(label)]); }
    const id = field('案號');
    if (!/^(C|BG|P|D|O)-\d{3,}$/u.test(id) || ids.has(id)) throw new Error('專案列表案號無效或重複。');
    ids.add(id);
    const mixed = field('專案／範圍'), lines = mixed.split(/\r?\n/u), first = lines.shift() || '', pieces = first.split('｜');
    const project = {
      id: id, name: field('專案名稱') || pieces.shift() || mixed,
      requirements: field('專案需求') || pieces.concat(lines).join('；'),
      goal: field('目前交付目標'), customer: field('客戶'), owner: field('負責人'), executor: field('執行者'), status: field('狀態'),
      originalStart: field('原始開始'), originalEnd: field('原始結束'), start: field('目前排程開始'), end: field('目前排程結束'),
      correctionStart: field('修正開始'), correctionEnd: field('修正結束'), supplement: field('延長修正／補充'),
      deliverySteps: field('交付步驟（參考）'), externalAlias: field('對外名稱'), sourceLinks: [], workspaceIds: [], workspaceUnits: {}, dateBasis: 'current'
    };
    const dates = getProjectDates_(project);
    if (dates) { project.start = dates.start; project.end = dates.end; project.dateBasis = dates.basis; }
    return project;
  }).sort(function(a, b) {
    const ad = getProjectDates_(a), bd = getProjectDates_(b);
    return (ad ? ad.startDay : Infinity) - (bd ? bd.startDay : Infinity) || a.id.localeCompare(b.id);
  });
}
