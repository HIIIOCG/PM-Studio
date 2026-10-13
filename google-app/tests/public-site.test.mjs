import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, readdir, rm, symlink } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script, createContext } from 'node:vm';
import { buildPublicSite, validateAppUrl, renderPublicEntry } from '../../scripts/build-public-site.mjs';
import { createPublicPreviewHandler } from '../../scripts/serve-public-site.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const local = resolve(root, 'local');
// Deliberately fictional; a real deployment address is supplied only at build time.
const appUrl = 'https://script.google.com/macros/s/FICTIONAL_PM_STUDIO_TEST_001/exec';
const updatedUrl = 'https://script.google.com/macros/s/FICTIONAL_PM_STUDIO_TEST_002/exec';

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
  assert.match(html, /正在連接排程/);
  assert.match(html, /另開排程/);
  assert.doesNotMatch(html, /schedule\.json|google\.script|saveLayout|publishApprovedSnapshot|INTERNAL_SHEET_ID|sourceUrl|fetch\(|\/api\/|search|assignment-form|客戶名|目前交付目標/);
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Script(match[1]);
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

test('connection status is neutral and failure keeps a direct schedule link available', () => {
  const html = renderPublicEntry(appUrl);
  const frame = { listeners: {}, addEventListener(name, handler) { this.listeners[name] = handler; } };
  const connection = { hidden: false };
  const message = { textContent: '' };
  let timer;
  const context = createContext({
    document: { getElementById(id) { return { schedule: frame, connection, 'connection-message': message }[id]; } },
    setTimeout(handler) { timer = handler; return 1; }, clearTimeout() {},
  });
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Script(match[1]).runInContext(context);
  timer();
  assert.match(message.textContent, /連接時間較長/);
  frame.listeners.load();
  assert.equal(connection.hidden, true);
  frame.listeners.error();
  assert.equal(connection.hidden, false);
  assert.match(message.textContent, /無法連接/);
  assert.match(html, /class="open-schedule"[^>]+target="_blank"[^>]+rel="noopener noreferrer"/);
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
});
