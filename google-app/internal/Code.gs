/**
 * Teamspace read adapter for the same PM Studio schedule and Script project.
 * The bundle prepends the shared schedule helpers, with its two entry
 * functions renamed to private helpers. Date/allocation rules have one source.
 * The teamspace deployment uses USER_DEPLOYING and ANYONE_ANONYMOUS, as authorized
 * by the user. Both latest variants expose the authorized bounded details,
 * remain read-only and use the same current source.
 */
const PM_INTERNAL_ = Object.freeze({
  error: '排程目前無法讀取，請稍後重試。'
});

function doGet(e) {
  try {
    if (arguments.length > 1) throw new Error('request');
    noParameters_(e);
    return HtmlService.createHtmlOutputFromFile('Index').setTitle('PM Studio 團隊專案排程')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (error) { throw new Error(PM_INTERNAL_.error); }
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
  // Main-entry and teamspace share one explicit detail allowlist, customer-type
  // validation, date/allocation rules and source-link exclusions.
  return publicRows_(rows);
}
