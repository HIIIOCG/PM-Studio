/**
 * Teamspace read adapter for the same PM Studio schedule and Script project.
 * The bundle prepends the shared schedule helpers, with its two entry
 * functions renamed to private helpers. Date/allocation rules have one source.
 * The teamspace deployment uses USER_DEPLOYING and ANYONE_ANONYMOUS, as authorized
 * by the user. Teamspace adds its four authorized text fields to the public
 * allowlist. Both variants remain read-only and use the same current source.
 */
const PM_INTERNAL_ = Object.freeze({
  error: '排程目前無法讀取，請稍後重試。',
  fields: Object.freeze({
    name: '專案／範圍', customer: '客戶', contact: '窗口', assignee: '執行者'
  })
});

function doGet(e) {
  try {
    if (arguments.length > 1) throw new Error('request');
    noParameters_(e);
    return ContentService.createTextOutput(JSON.stringify(getTimeline()))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    try {
      return ContentService.createTextOutput(JSON.stringify({ error: PM_INTERNAL_.error }))
        .setMimeType(ContentService.MimeType.JSON);
    } catch (outputError) { throw new Error(PM_INTERNAL_.error); }
  }
}

function getTimeline() {
  try {
    if (arguments.length) throw new Error('request');
    const properties = PropertiesService.getScriptProperties().getProperties();
    if (Object.keys(properties).length !== 1 || !Object.prototype.hasOwnProperty.call(properties, 'SOURCE_SHEET_ID')) throw new Error('configuration');
    const sourceId = text_(properties.SOURCE_SHEET_ID);
    if (!/^[A-Za-z0-9_-]{8,}$/u.test(sourceId)) throw new Error('configuration');
    // The read-only deployment reads the latest source with deployer permission.
    // Source credentials, IDs and original rows are never returned to the browser.
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
  // Validate the common schedule with the public implementation, then add only
  // the four explicitly authorized teamspace fields by validated project ID.
  const result = publicRows_(rows);
  const header = rows[0].map(text_);
  const details = new Map();
  rows.slice(1).forEach(function(row) {
    if (!Array.isArray(row)) return;
    const id = text_(row[header.indexOf('案號')]);
    if (!/^(?:C|BG|P|D|O)-\d{3,}$/u.test(id)) return;
    const fields = {};
    Object.keys(PM_INTERNAL_.fields).forEach(function(key) {
      fields[key] = detailText_(row[header.indexOf(PM_INTERNAL_.fields[key])]);
    });
    details.set(id, fields);
  });
  return {
    projects: result.projects.map(function(project) {
      // Dedicated source links, original rows and settings remain server-side.
      return Object.assign({}, project, details.get(project.id));
    }),
    warnings: result.warnings
  };
}
