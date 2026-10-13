import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';

const manifest = JSON.parse(await readFile(new URL('../appsscript.json', import.meta.url), 'utf8'));
const backend = await readFile(new URL('../Code.gs', import.meta.url), 'utf8');

test('single public app executes as the deployer and requests only spreadsheet read access', () => {
  assert.equal(manifest.exceptionLogging, 'STACKDRIVER');
  assert.equal(manifest.timeZone, 'Asia/Taipei');
  assert.equal(manifest.runtimeVersion, 'V8');
  assert.deepEqual(manifest.webapp, { executeAs: 'USER_DEPLOYING', access: 'ANYONE_ANONYMOUS' });
  assert.deepEqual(manifest.oauthScopes, ['https://www.googleapis.com/auth/spreadsheets.readonly']);
});

test('Advanced Sheets v4 supplies formatted reads without a broad SpreadsheetApp scope', () => {
  assert.deepEqual(manifest.dependencies, {
    enabledAdvancedServices: [{ userSymbol: 'Sheets', version: 'v4', serviceId: 'sheets' }]
  });
  assert.match(backend, /Sheets\.Spreadsheets\.Values\.get/);
  assert.match(backend, /valueRenderOption: 'FORMATTED_VALUE'/);
  assert.doesNotMatch(backend, /SpreadsheetApp|DriveApp|Session\.|UrlFetchApp/);
  new Script(backend);
});

test('the deployable backend contains no internal or publication operations', () => {
  const methods = [...backend.matchAll(/^function (\w+)\(/gm)].map(match => match[1]).filter(name => !name.endsWith('_'));
  assert.deepEqual(methods, ['doGet', 'getTimeline']);
  assert.doesNotMatch(backend, /INTERNAL_SHEET_ID|SETTINGS_SHEET_ID|PUBLIC_FEED_SHEET_ID|PUBLISHERS_JSON|saveLayout|publishApprovedSnapshot/);
});
