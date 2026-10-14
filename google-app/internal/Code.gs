/**
 * Signed-in read adapter for the same PM Studio schedule and Script project.
 * The bundle prepends the unchanged public schedule helpers, with its two entry
 * functions renamed to private helpers. Date/allocation rules have one source.
 * The internal deployment uses USER_ACCESSING. The existing public deployment
 * remains pinned to its verified public version. Google performs internal Sheets
 * reads with the accessing user's own existing sharing permissions.
 */
const PM_INTERNAL_ = Object.freeze({
  error: '無法讀取內部排程，請確認登入帳號具有專案列表存取權限。',
  textLimit: 4000,
  fields: Object.freeze({
    name: '專案／範圍', customer: '客戶', owner: '負責人', status: '狀態',
    deliveryGoal: '目前交付目標', notes: '延長修正／補充', contact: '窗口',
    assignee: '執行者', deliverySteps: '交付步驟（參考）'
  })
});

function doGet(e) {
  try {
    if (arguments.length > 1) throw new Error('request');
    noParameters_(e);
    // Keep Google's default frame protection. The Pages /internal/ entry opens
    // this signed-in app at the top level instead of embedding it.
    return HtmlService.createHtmlOutputFromFile('Index').setTitle('PM Studio 內部排程')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  } catch (error) { throw new Error(PM_INTERNAL_.error); }
}

function getTimeline() {
  try {
    if (arguments.length) throw new Error('request');
    const properties = PropertiesService.getScriptProperties().getProperties();
    if (Object.keys(properties).length !== 1 || !Object.prototype.hasOwnProperty.call(properties, 'SOURCE_SHEET_ID')) throw new Error('configuration');
    const sourceId = text_(properties.SOURCE_SHEET_ID);
    if (!/^[A-Za-z0-9_-]{8,}$/u.test(sourceId)) throw new Error('configuration');
    // Advanced Sheets inherits USER_ACCESSING. No deployer credential, cache,
    // or public snapshot is used as a fallback when this user cannot read.
    const response = Sheets.Spreadsheets.Values.get(sourceId, "'" + PM_SCHEDULE_.tab + "'", {
      majorDimension: 'ROWS', valueRenderOption: 'FORMATTED_VALUE'
    });
    const rows = response.values;
    if (!Array.isArray(rows) || rows.length < 5 || rows.length > 1000
      || rows.some(function(row) { return !Array.isArray(row) || row.length > 64; })) throw new Error('source');
    const result = internalRows_(rows.slice(4));
    return {
      schemaVersion: 3,
      today: Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd'),
      syncedAt: new Date().toISOString(),
      projects: result.projects,
      workspaces: PM_SCHEDULE_.workspaces.map(function(workspace) { return Object.assign({}, workspace); }),
      warnings: result.warnings
    };
  } catch (error) {
    // Source-service messages can contain sheet IDs and private row values.
    throw new Error(PM_INTERNAL_.error);
  }
}

function internalRows_(rows) {
  // Validate IDs, headers, dates, pending reasons, reservations, follow-up and
  // allocations with the exact same implementation used by the public app.
  const result = publicRows_(rows);
  const header = rows[0].map(text_);
  const privateFields = new Map();
  rows.slice(1).forEach(function(row) {
    if (!Array.isArray(row)) return;
    const id = text_(row[header.indexOf('案號')]);
    if (!/^(?:C|BG|P|D|O)-\d{3,}$/u.test(id)) return;
    const fields = {};
    Object.keys(PM_INTERNAL_.fields).forEach(function(key) {
      fields[key] = internalText_(row[header.indexOf(PM_INTERNAL_.fields[key])]);
    });
    privateFields.set(id, fields);
  });
  return {
    projects: result.projects.map(function(project) {
      // Only the validated base response and the explicit internal text
      // allowlist are joined. Source rows, source links and settings stay server-side.
      return Object.assign({}, project, privateFields.get(project.id));
    }),
    warnings: result.warnings
  };
}

function internalText_(value) {
  const bounded = text_(value).slice(0, PM_INTERNAL_.textLimit);
  // Do not leave a split Unicode surrogate at the size boundary.
  return bounded.replace(/[\uD800-\uDBFF]$/u, '');
}
