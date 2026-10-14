import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, readdir, rm, symlink } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPublicSite, validateAppUrl, validateTeamspaceAppUrl, renderPublicEntry, renderTeamspaceEntry } from '../../scripts/build-public-site.mjs';
import { createPublicPreviewHandler } from '../../scripts/serve-public-site.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const local = resolve(root, 'local');
// Deliberately fictional; a real deployment address is supplied only at build time.
const appUrl = 'https://script.google.com/macros/s/FICTIONAL_PM_STUDIO_TEST_001/exec';
const updatedUrl = 'https://script.google.com/macros/s/FICTIONAL_PM_STUDIO_TEST_002/exec';
const teamspaceUrl = 'https://script.google.com/macros/s/FICTIONAL_PM_STUDIO_TEAMSPACE_001/exec';
const updatedTeamspaceUrl = 'https://script.google.com/macros/s/FICTIONAL_PM_STUDIO_TEAMSPACE_002/exec';

async function temporaryDirectory(t) {
  await mkdir(local, { recursive: true });
  const directory = await mkdtemp(resolve(local, 'public-site-test-'));
  t.after(async () => {
    if (!resolve(directory).startsWith(local + sep)) throw new Error('Unsafe temporary cleanup path.');
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test('only exact Google Apps Script production URLs are accepted', () => {
  assert.equal(validateAppUrl(appUrl), appUrl);
  for (const invalid of [
    undefined, null, {}, '', 'javascript:alert(1)',
    appUrl.replace('https:', 'http:'),
    appUrl.replace('script.google.com', 'script.google.com.example.org'),
    appUrl.replace('script.google.com', 'user:secret@script.google.com'),
    appUrl.replace('script.google.com', 'script.google.com:443'),
    appUrl.replace('/exec', '/dev'),
    appUrl.replace('/macros/s/', '/macros/u/0/s/'),
    appUrl.replace('/macros/s/', '/macros/s/../s/'),
    appUrl.replace('FICTIONAL', '%46ICTIONAL'),
    `${appUrl}/`, `${appUrl}?mode=internal`, `${appUrl}#internal`,
    `${appUrl}\n`, `${appUrl}\r\n`, ` ${appUrl}`, `${appUrl} `,
    `${appUrl}" onload="alert(1)`, `${appUrl}</iframe><script>alert(1)</script>`,
  ]) {
    assert.throws(() => validateAppUrl(invalid), /PM_STUDIO_APP_URL/);
  }
});

test('teamspace entry accepts only an exact Apps Script execution URL', () => {
  assert.equal(validateTeamspaceAppUrl(teamspaceUrl), teamspaceUrl);
  for (const invalid of [
    undefined, null, {}, '', 'javascript:alert(1)',
    teamspaceUrl.replace('https:', 'http:'),
    teamspaceUrl.replace('script.google.com', 'script.google.com.example.org'),
    teamspaceUrl.replace('script.google.com', 'user:secret@script.google.com'),
    teamspaceUrl.replace('script.google.com', 'script.google.com:443'),
    teamspaceUrl.replace('/exec', '/dev'),
    teamspaceUrl.replace('/macros/s/', '/macros/u/0/s/'),
    teamspaceUrl.replace('FICTIONAL', '%46ICTIONAL'),
    `${teamspaceUrl}/`, `${teamspaceUrl}?mode=internal`, `${teamspaceUrl}#internal`,
    `${teamspaceUrl}\n`, ` ${teamspaceUrl}`, `${teamspaceUrl} `,
    `${teamspaceUrl}" onload="alert(1)`, `${teamspaceUrl}</a><script>alert(1)</script>`,
    'https://docs.google.com/spreadsheets/d/FICTIONAL_PRIVATE_SOURCE/edit',
  ]) {
    assert.throws(() => validateTeamspaceAppUrl(invalid), /PM_STUDIO_TEAMSPACE_APP_URL/);
  }
});

test('invalid teamspace URLs are rejected before an existing publication changes', async (t) => {
  const directory = await temporaryDirectory(t);
  const outputDir = resolve(directory, 'site');
  await buildPublicSite({ appUrl, teamspaceAppUrl: teamspaceUrl, outputDir });
  const previousTeamspace = await readFile(resolve(outputDir, 'teamspace/index.html'), 'utf8');
  await assert.rejects(buildPublicSite({ appUrl: updatedUrl, teamspaceAppUrl: `${teamspaceUrl}?source=PRIVATE`, outputDir }), /PM_STUDIO_TEAMSPACE_APP_URL/);
  assert.equal(await readFile(resolve(outputDir, 'teamspace/index.html'), 'utf8'), previousTeamspace);
  assert.equal(await readFile(resolve(outputDir, 'index.html'), 'utf8'), renderPublicEntry(appUrl));
});

test('public build requires a valid URL and refuses private or unexpected output files', async (t) => {
  const directory = await temporaryDirectory(t);
  const outputDir = resolve(directory, 'site');
  await assert.rejects(buildPublicSite({ appUrl: '', outputDir }), /PM_STUDIO_APP_URL/);
  await assert.rejects(readdir(outputDir), { code: 'ENOENT' });
  await mkdir(outputDir);
  await writeFile(resolve(outputDir, 'Code.gs'), 'PRIVATE');
  await assert.rejects(buildPublicSite({ appUrl, outputDir }), /未允許/);
  assert.equal(await readFile(resolve(outputDir, 'Code.gs'), 'utf8'), 'PRIVATE');
  await assert.rejects(buildPublicSite({ appUrl, outputDir: root }), /獨立資料夾/);
  await assert.rejects(buildPublicSite({ appUrl, outputDir: resolve(root, '..', 'outside') }), /獨立資料夾/);
});

test('public output contains only the read-only iframe entry and no project snapshot or internal code', async (t) => {
  const directory = await temporaryDirectory(t);
  const outputDir = resolve(directory, 'site');
  const result = await buildPublicSite({ appUrl, outputDir });
  assert.equal(result.outputDir, outputDir);
  assert.deepEqual((await readdir(outputDir)).sort(), ['.nojekyll', 'index.html']);
  const html = await readFile(resolve(outputDir, 'index.html'), 'utf8');
  assert.ok(html.includes(`<iframe id="schedule" src="${appUrl}"`));
  assert.match(html, /height:100dvh/);
  assert.match(html, /referrerpolicy="no-referrer"/);
  assert.match(html, /另開排程/);
  assert.doesNotMatch(html, /schedule\.json|google\.script|saveLayout|publishApprovedSnapshot|INTERNAL_SHEET_ID|sourceUrl|fetch\(|\/api\/|search|assignment-form|客戶名|目前交付目標/);
  assert.doesNotMatch(html, /<script|connection|setTimeout|addEventListener/);
  await buildPublicSite({ appUrl: updatedUrl, outputDir });
  assert.match(await readFile(resolve(outputDir, 'index.html'), 'utf8'), /TEST_002\/exec/);
  assert.deepEqual(await readdir(directory), ['site']);
});

test('the environment may supply the deployment URL without exposing it in the build result', async (t) => {
  const directory = await temporaryDirectory(t);
  const previous = process.env.PM_STUDIO_APP_URL;
  try {
    process.env.PM_STUDIO_APP_URL = appUrl;
    const result = await buildPublicSite({ outputDir: resolve(directory, 'site') });
    assert.equal(JSON.stringify(result).includes(appUrl), false);
  } finally {
    if (previous === undefined) delete process.env.PM_STUDIO_APP_URL;
    else process.env.PM_STUDIO_APP_URL = previous;
  }
});

test('optional teamspace entry opens the timeline directly and leaves the public schedule unchanged', async (t) => {
  const directory = await temporaryDirectory(t);
  const outputDir = resolve(directory, 'site');
  const result = await buildPublicSite({ appUrl, teamspaceAppUrl: teamspaceUrl, outputDir });
  assert.deepEqual((await readdir(outputDir)).sort(), ['.nojekyll', 'index.html', 'teamspace']);
  assert.deepEqual(await readdir(resolve(outputDir, 'teamspace')), ['index.html']);
  assert.equal(await readFile(resolve(outputDir, 'index.html'), 'utf8'), renderPublicEntry(appUrl));
  const teamspaceHtml = await readFile(resolve(outputDir, 'teamspace/index.html'), 'utf8');
  assert.equal(teamspaceHtml, renderTeamspaceEntry(teamspaceUrl));
  assert.ok(teamspaceHtml.includes(`<iframe id="schedule" src="${teamspaceUrl}" title="PM Studio 團隊排程"`));
  assert.ok(teamspaceHtml.includes(`href="${teamspaceUrl}" target="_blank" rel="noopener noreferrer"`));
  assert.match(teamspaceHtml, /另開團隊排程/);
  assert.match(teamspaceHtml, /height:100dvh/);
  assert.doesNotMatch(teamspaceHtml, /http-equiv="refresh"|登入|帳號|授權|<script|fetch\(|google\.script|SOURCE_SHEET_ID|docs\.google\.com\/spreadsheets|projects|schedule\.json/);
  assert.doesNotMatch(await readFile(resolve(outputDir, 'index.html'), 'utf8'), /internal|teamspace|內部|團隊/);
  assert.equal(JSON.stringify(result).includes(teamspaceUrl), false);
  await buildPublicSite({ appUrl, teamspaceAppUrl: '', outputDir });
  assert.deepEqual((await readdir(outputDir)).sort(), ['.nojekyll', 'index.html']);
});

test('teamspace URL can be supplied privately through the environment', async (t) => {
  const directory = await temporaryDirectory(t);
  const previous = process.env.PM_STUDIO_TEAMSPACE_APP_URL;
  try {
    process.env.PM_STUDIO_TEAMSPACE_APP_URL = teamspaceUrl;
    const result = await buildPublicSite({ appUrl, outputDir: resolve(directory, 'site') });
    assert.equal(await readFile(resolve(result.outputDir, 'teamspace/index.html'), 'utf8'), renderTeamspaceEntry(teamspaceUrl));
    assert.equal(JSON.stringify(result).includes(teamspaceUrl), false);
  } finally {
    if (previous === undefined) delete process.env.PM_STUDIO_TEAMSPACE_APP_URL;
    else process.env.PM_STUDIO_TEAMSPACE_APP_URL = previous;
  }
});

test('teamspace generation and install failures restore both complete entry pages', async (t) => {
  const directory = await temporaryDirectory(t);
  const outputDir = resolve(directory, 'site');
  await buildPublicSite({ appUrl, teamspaceAppUrl: teamspaceUrl, outputDir });
  const originalTeamspace = await readFile(resolve(outputDir, 'teamspace/index.html'), 'utf8');
  await assert.rejects(buildPublicSite({ appUrl: updatedUrl, teamspaceAppUrl: updatedTeamspaceUrl, outputDir,
    renderTeamspace: async () => { throw new Error('Simulated teamspace generation failure'); },
  }), /Simulated teamspace generation failure/);
  assert.equal(await readFile(resolve(outputDir, 'index.html'), 'utf8'), renderPublicEntry(appUrl));
  assert.equal(await readFile(resolve(outputDir, 'teamspace/index.html'), 'utf8'), originalTeamspace);
  await assert.rejects(buildPublicSite({ appUrl: updatedUrl, teamspaceAppUrl: updatedTeamspaceUrl, outputDir,
    installDirectory: async () => { throw new Error('Simulated teamspace install failure'); },
  }), /Simulated teamspace install failure/);
  assert.equal(await readFile(resolve(outputDir, 'index.html'), 'utf8'), renderPublicEntry(appUrl));
  assert.equal(await readFile(resolve(outputDir, 'teamspace/index.html'), 'utf8'), originalTeamspace);
  assert.deepEqual(await readdir(directory), ['site']);
});

test('teamspace entry directory rejects extra files and subdirectories', async (t) => {
  const directory = await temporaryDirectory(t);
  for (const kind of ['file', 'directory']) {
    const outputDir = resolve(directory, kind);
    await mkdir(resolve(outputDir, 'teamspace'), { recursive: true });
    await writeFile(resolve(outputDir, 'index.html'), 'previous public entry');
    await writeFile(resolve(outputDir, 'teamspace/index.html'), 'previous teamspace entry');
    if (kind === 'file') await writeFile(resolve(outputDir, 'teamspace/Code.gs'), 'PRIVATE');
    else await mkdir(resolve(outputDir, 'teamspace/private'));
    await assert.rejects(buildPublicSite({ appUrl, teamspaceAppUrl: teamspaceUrl, outputDir }), /未允許/);
    assert.equal(await readFile(resolve(outputDir, 'index.html'), 'utf8'), 'previous public entry');
    assert.equal(await readFile(resolve(outputDir, 'teamspace/index.html'), 'utf8'), 'previous teamspace entry');
  }
});

test('teamspace entry rejects linked directories and linked HTML files before replacement', async (t) => {
  const directory = await temporaryDirectory(t);
  const actual = resolve(directory, 'actual');
  await mkdir(actual);
  await writeFile(resolve(actual, 'index.html'), 'PRIVATE');
  const linkedDirectorySite = resolve(directory, 'linked-directory-site');
  await mkdir(linkedDirectorySite);
  try { await symlink(actual, resolve(linkedDirectorySite, 'teamspace'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('Environment does not permit symlink creation.'); return; }
    throw error;
  }
  await assert.rejects(buildPublicSite({ appUrl, teamspaceAppUrl: teamspaceUrl, outputDir: linkedDirectorySite }), /未允許|符號連結/);
  assert.equal(await readFile(resolve(actual, 'index.html'), 'utf8'), 'PRIVATE');
  const linkedFileSite = resolve(directory, 'linked-file-site');
  await mkdir(resolve(linkedFileSite, 'teamspace'), { recursive: true });
  try { await symlink(resolve(actual, 'index.html'), resolve(linkedFileSite, 'teamspace/index.html'), 'file'); }
  catch (error) {
    if (['EPERM', 'EACCES'].includes(error.code)) { t.diagnostic('Environment does not permit file symlink creation; directory junction rejection was verified.'); return; }
    throw error;
  }
  await assert.rejects(buildPublicSite({ appUrl, teamspaceAppUrl: teamspaceUrl, outputDir: linkedFileSite }), /未允許/);
  assert.equal(await readFile(resolve(actual, 'index.html'), 'utf8'), 'PRIVATE');
});

test('the exact legacy internal entry migrates atomically to teamspace and is kept only in a local backup', async (t) => {
  const directory = await temporaryDirectory(t);
  const outputDir = resolve(directory, 'site');
  await mkdir(resolve(outputDir, 'internal'), { recursive: true });
  await writeFile(resolve(outputDir, 'index.html'), 'previous public entry');
  await writeFile(resolve(outputDir, '.nojekyll'), '');
  await writeFile(resolve(outputDir, 'internal/index.html'), 'previous signed-in entry');
  const result = await buildPublicSite({ appUrl, teamspaceAppUrl: teamspaceUrl, outputDir });
  assert.deepEqual((await readdir(outputDir)).sort(), ['.nojekyll', 'index.html', 'teamspace']);
  assert.equal(await readFile(resolve(outputDir, 'teamspace/index.html'), 'utf8'), renderTeamspaceEntry(teamspaceUrl));
  assert.equal(await readFile(resolve(result.previousSiteBackup, 'internal/index.html'), 'utf8'), 'previous signed-in entry');
  await assert.rejects(readFile(resolve(outputDir, 'internal/index.html')), { code: 'ENOENT' });
});

test('a failed route migration restores the old entry together with the public page', async (t) => {
  const directory = await temporaryDirectory(t);
  const outputDir = resolve(directory, 'site');
  await mkdir(resolve(outputDir, 'internal'), { recursive: true });
  await writeFile(resolve(outputDir, 'index.html'), 'previous public entry');
  await writeFile(resolve(outputDir, 'internal/index.html'), 'previous signed-in entry');
  await assert.rejects(buildPublicSite({ appUrl, teamspaceAppUrl: teamspaceUrl, outputDir,
    installDirectory: async () => { throw new Error('Simulated route migration failure'); },
  }), /Simulated route migration failure/);
  assert.equal(await readFile(resolve(outputDir, 'index.html'), 'utf8'), 'previous public entry');
  assert.equal(await readFile(resolve(outputDir, 'internal/index.html'), 'utf8'), 'previous signed-in entry');
  assert.deepEqual(await readdir(directory), ['site']);
});

test('legacy internal entry accepts only its exact index file', async (t) => {
  const directory = await temporaryDirectory(t);
  for (const kind of ['file', 'directory']) {
    const outputDir = resolve(directory, kind);
    await mkdir(resolve(outputDir, 'internal'), { recursive: true });
    await writeFile(resolve(outputDir, 'internal/index.html'), 'previous signed-in entry');
    if (kind === 'file') await writeFile(resolve(outputDir, 'internal/Code.gs'), 'PRIVATE');
    else await mkdir(resolve(outputDir, 'internal/private'));
    await assert.rejects(buildPublicSite({ appUrl, teamspaceAppUrl: teamspaceUrl, outputDir }), /未允許/);
    assert.equal(await readFile(resolve(outputDir, 'internal/index.html'), 'utf8'), 'previous signed-in entry');
  }
});

test('legacy snapshots are retained in a complete backup and absent from the new site', async (t) => {
  const directory = await temporaryDirectory(t);
  const outputDir = resolve(directory, 'site');
  await mkdir(resolve(outputDir, 'data'), { recursive: true });
  await writeFile(resolve(outputDir, 'index.html'), 'old complete HTML');
  await writeFile(resolve(outputDir, '.nojekyll'), '');
  await writeFile(resolve(outputDir, 'data/schedule.json'), '{"old":"fixture"}');
  const result = await buildPublicSite({ appUrl, outputDir });
  assert.ok(result.previousSiteBackup.startsWith(directory + sep));
  assert.equal(await readFile(resolve(result.previousSiteBackup, 'index.html'), 'utf8'), 'old complete HTML');
  assert.equal(await readFile(resolve(result.previousSiteBackup, 'data/schedule.json'), 'utf8'), '{"old":"fixture"}');
  assert.deepEqual((await readdir(outputDir)).sort(), ['.nojekyll', 'index.html']);
  assert.deepEqual((await readdir(result.previousSiteBackup)).sort(), ['.nojekyll', 'data', 'index.html']);
});

test('generation and installation failures preserve the complete previous site', async (t) => {
  const directory = await temporaryDirectory(t);
  const outputDir = resolve(directory, 'site');
  await buildPublicSite({ appUrl, outputDir });
  const previousHtml = await readFile(resolve(outputDir, 'index.html'), 'utf8');
  await assert.rejects(buildPublicSite({ appUrl: updatedUrl, outputDir, renderEntry: async () => {
    throw Object.assign(new Error('Simulated generation failure'), { code: 'ENOSPC' });
  } }), /Simulated generation failure/);
  assert.equal(await readFile(resolve(outputDir, 'index.html'), 'utf8'), previousHtml);
  await assert.rejects(buildPublicSite({ appUrl: updatedUrl, outputDir, installDirectory: async () => {
    throw Object.assign(new Error('Simulated Windows directory lock'), { code: 'EPERM' });
  } }), /Simulated Windows directory lock/);
  assert.equal(await readFile(resolve(outputDir, 'index.html'), 'utf8'), previousHtml);
  assert.deepEqual((await readdir(directory)).sort(), ['site']);
  assert.deepEqual((await readdir(outputDir)).sort(), ['.nojekyll', 'index.html']);
});

test('failed legacy migration restores the old HTML and snapshot together', async (t) => {
  const directory = await temporaryDirectory(t);
  const outputDir = resolve(directory, 'site');
  await mkdir(resolve(outputDir, 'data'), { recursive: true });
  await writeFile(resolve(outputDir, 'index.html'), 'old HTML');
  await writeFile(resolve(outputDir, '.nojekyll'), '');
  await writeFile(resolve(outputDir, 'data/schedule.json'), 'old snapshot');
  await assert.rejects(buildPublicSite({ appUrl, outputDir, installDirectory: async () => {
    throw new Error('Simulated migration failure');
  } }), /Simulated migration failure/);
  assert.equal(await readFile(resolve(outputDir, 'index.html'), 'utf8'), 'old HTML');
  assert.equal(await readFile(resolve(outputDir, 'data/schedule.json'), 'utf8'), 'old snapshot');
  assert.deepEqual(await readdir(directory), ['site']);
});

test('unexpected files in a legacy data folder are rejected before replacement', async (t) => {
  const directory = await temporaryDirectory(t);
  const outputDir = resolve(directory, 'site');
  await mkdir(resolve(outputDir, 'data'), { recursive: true });
  await writeFile(resolve(outputDir, 'data/private.json'), 'PRIVATE');
  await assert.rejects(buildPublicSite({ appUrl, outputDir }), /未允許/);
  assert.equal(await readFile(resolve(outputDir, 'data/private.json'), 'utf8'), 'PRIVATE');
});

test('junction ancestors are rejected before writing through them', async (t) => {
  const directory = await temporaryDirectory(t);
  const actual = resolve(directory, 'actual');
  const link = resolve(directory, 'linked');
  await mkdir(actual);
  try { await symlink(actual, link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('Environment does not permit symlink creation.'); return; }
    throw error;
  }
  await assert.rejects(buildPublicSite({ appUrl, outputDir: resolve(link, 'site') }), /符號連結/);
  assert.deepEqual(await readdir(actual), []);
});

test('both entries never mask the iframe or depend on cross-origin load events', () => {
  for (const html of [renderPublicEntry(appUrl), renderTeamspaceEntry(teamspaceUrl)]) {
    const body = html.match(/<body>([\s\S]*?)<\/body>/)?.[1];
    assert.ok(body);
    assert.deepEqual([...body.matchAll(/<([a-z][\w-]*)\b/gi)].map((match) => match[1]), ['iframe', 'a']);
    assert.match(html, /iframe\{position:fixed;inset:0;width:100%;height:100%;height:100dvh/);
    assert.doesNotMatch(html, /<script|connection|setTimeout|addEventListener|onload|onerror|opacity:0|visibility:hidden|display:none/);
    assert.match(html, /class="open-schedule"[^>]+target="_blank"[^>]+rel="noopener noreferrer"/);
  }
});

test('preview serves the entry at the project path and rejects snapshot and private paths', async (t) => {
  const directory = await temporaryDirectory(t);
  const outputDir = resolve(directory, 'site');
  await buildPublicSite({ appUrl, outputDir });
  const handler = createPublicPreviewHandler(outputDir);
  async function request(url, method = 'GET') {
    const response = { status: null, headers: {}, body: undefined,
      writeHead(status, headers = {}) { this.status = status; this.headers = headers; },
      end(body) { this.body = body?.toString(); },
    };
    await handler({ url, method }, response);
    return response;
  }
  for (const path of ['/', '/PM-Studio']) {
    const response = await request(path);
    assert.equal(response.status, 302);
    assert.equal(response.headers.Location, '/PM-Studio/');
  }
  for (const path of ['/PM-Studio/', '/PM-Studio/index.html']) {
    const response = await request(path);
    assert.equal(response.status, 200);
    assert.match(response.body, /<iframe/);
    assert.equal(response.headers['X-Content-Type-Options'], 'nosniff');
  }
  const head = await request('/PM-Studio/', 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.body, undefined);
  assert.equal((await request('/PM-Studio/', 'POST')).status, 405);
  for (const path of ['/PM-Studio/data/schedule.json', '/PM-Studio/Code.gs', '/local/operations/config/sources.json', '/.git/config']) {
    assert.equal((await request(path)).status, 404);
  }
  assert.equal((await request('/PM-Studio/teamspace/')).status, 404);
  assert.equal((await request('/PM-Studio/teamspace/index.html')).status, 404);
  assert.equal((await request('/PM-Studio/internal/')).status, 404);
});

test('preview serves only the fixed teamspace entry routes and retains private-file rejection', async (t) => {
  const directory = await temporaryDirectory(t);
  const outputDir = resolve(directory, 'site');
  await buildPublicSite({ appUrl, teamspaceAppUrl: teamspaceUrl, outputDir });
  const handler = createPublicPreviewHandler(outputDir);
  async function request(url, method = 'GET') {
    const response = { status: null, headers: {}, body: undefined,
      writeHead(status, headers = {}) { this.status = status; this.headers = headers; },
      end(body) { this.body = body?.toString(); },
    };
    await handler({ url, method }, response);
    return response;
  }
  const redirect = await request('/PM-Studio/teamspace');
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.Location, '/PM-Studio/teamspace/');
  for (const path of ['/PM-Studio/teamspace/', '/PM-Studio/teamspace/index.html']) {
    const response = await request(path);
    assert.equal(response.status, 200);
    assert.equal(response.body, renderTeamspaceEntry(teamspaceUrl));
    assert.equal(response.headers['X-Content-Type-Options'], 'nosniff');
    assert.equal((await request(path, 'HEAD')).body, undefined);
    assert.equal((await request(path, 'POST')).status, 405);
  }
  for (const path of ['/PM-Studio/internal', '/PM-Studio/internal/', '/PM-Studio/internal/index.html', '/teamspace/', '/PM-Studio/teamspace/Code.gs', '/PM-Studio/teamspace/data/schedule.json', '/PM-Studio/teamspace/config/sources.json', '/PM-Studio/teamspace/%2e%2e/.git/config']) {
    assert.equal((await request(path)).status, 404);
  }
});
