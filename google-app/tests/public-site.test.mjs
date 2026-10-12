import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, readdir, rm, symlink } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script, createContext } from 'node:vm';
import { createStaticBridge } from '../ui/static-bridge.mjs';
import { buildPublicSite } from '../../scripts/build-public-site.mjs';
import { buildGoogleUi } from '../../scripts/build-google-ui.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const local = resolve(root, 'local');
const snapshot = (projects = []) => ({ schemaVersion: 1, publishedAt: '2026-01-01T08:00:00.000Z', projects });
const syntheticProject = () => ({ alias: '專案 001', goal: '合成測試排程', start: '2026-10-12', end: '2027-01-15', workspaceIds: ['B', 'C'], workspaceUnits: { B: 3, C: 2 } });

async function temporaryDirectory(t) {
  await mkdir(local, { recursive: true });
  const directory = await mkdtemp(resolve(local, 'public-site-test-'));
  t.after(async () => {
    if (!resolve(directory).startsWith(local + sep)) throw new Error('Unsafe temporary cleanup path.');
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test('static bridge reads only a relative anonymous snapshot and computes the current Taipei day', async () => {
  const calls = [];
  const call = createStaticBridge({ now: () => new Date('2026-10-12T16:00:00Z'), fetchImpl: async (...args) => {
    calls.push(args);
    return { ok: true, json: async () => snapshot([syntheticProject()]) };
  } });
  const payload = await call('getTimeline');
  assert.deepEqual(calls, [['./data/schedule.json', { cache: 'no-store', credentials: 'omit' }]]);
  assert.equal(payload.today, '2026-10-13');
  assert.equal(payload.syncedAt, '2026-01-01T08:00:00.000Z');
  assert.equal(payload.permissions.canEditLayout, false);
  assert.deepEqual(payload.projects[0].workspaceUnits, { B: 3, C: 2 });
  await assert.rejects(call('saveLayout', {}));
  await assert.rejects(call('getTimeline', { source: 'PRIVATE' }));
  assert.equal(calls.length, 1);
});

test('static bridge rejects failed or private responses instead of creating substitute records', async () => {
  const responses = [
    async () => { throw new Error('PRIVATE_SERVER_ERROR'); },
    async () => ({ ok: false, json: async () => snapshot() }),
    async () => ({ ok: true, json: async () => ({ ...snapshot(), sourceUrl: 'PRIVATE' }) }),
    async () => ({ ok: true, json: async () => snapshot([{ ...syntheticProject(), customer: 'PRIVATE' }]) }),
    async () => ({ ok: true, json: async () => { throw new Error('Invalid JSON'); } }),
  ];
  for (const fetchImpl of responses) {
    await assert.rejects(createStaticBridge({ fetchImpl })('getTimeline'), (error) => {
      assert.equal(error.message, '公開排程目前無法讀取，請稍後再試。');
      return true;
    });
  }
});

test('public build requires a supplied valid snapshot and refuses contaminated output', async (t) => {
  const directory = await temporaryDirectory(t);
  const outputDir = resolve(directory, 'site');
  await assert.rejects(buildPublicSite({ outputDir }), /--snapshot/);
  await assert.rejects(readdir(outputDir), { code: 'ENOENT' });
  const snapshotPath = resolve(directory, 'snapshot.json');
  await writeFile(snapshotPath, JSON.stringify({ ...snapshot(), privateField: 'PRIVATE' }));
  await assert.rejects(buildPublicSite({ snapshotPath, outputDir }));
  await assert.rejects(readdir(outputDir), { code: 'ENOENT' });
  await writeFile(snapshotPath, JSON.stringify(snapshot()));
  await mkdir(outputDir);
  await writeFile(resolve(outputDir, 'Code.gs'), 'PRIVATE');
  await assert.rejects(buildPublicSite({ snapshotPath, outputDir }), /未允許/);
  assert.equal(await readFile(resolve(outputDir, 'Code.gs'), 'utf8'), 'PRIVATE');
  await assert.rejects(buildPublicSite({ snapshotPath, outputDir: root }), /獨立資料夾/);
  await assert.rejects(buildGoogleUi({ outputDir, transport: 'static', packageDir: null }), /公開前端/);
});

test('public build outputs only publishable files and executable scripts without Google or internal code', async (t) => {
  const directory = await temporaryDirectory(t);
  const snapshotPath = resolve(directory, 'snapshot.json');
  const outputDir = resolve(directory, 'site');
  const source = snapshot([syntheticProject()]);
  await writeFile(snapshotPath, JSON.stringify(source));
  const result = await buildPublicSite({ snapshotPath, outputDir });
  assert.equal(result.projectCount, 1);
  assert.deepEqual((await readdir(outputDir)).sort(), ['.nojekyll', 'data', 'index.html']);
  assert.deepEqual(await readdir(resolve(outputDir, 'data')), ['schedule.json']);
  assert.deepEqual(JSON.parse(await readFile(resolve(outputDir, 'data/schedule.json'), 'utf8')), source);
  const html = await readFile(resolve(outputDir, 'index.html'), 'utf8');
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Script(match[1]);
  assert.doesNotMatch(html, /google\.script|createGoogleBridge|saveLayout|publishApprovedSnapshot|normalizeInternalPayload|sourceUrl|PUBLIC_FEED_SHEET_ID|createDemo|snapshotFromFeedRows|parseFeedCsv|\/api\/|id="assignment-form"|id="source-link"|id="layout-demo"|合成測試排程/);
  assert.match(html, /\.\/data\/schedule\.json/);
  assert.match(html, /目前區間無已公開排程/);
  assert.match(html, /目前尚無已公開排程；請聯繫團隊確認檔期。/);
  assert.match(html, /台北時間/);
  assert.match(html, /空白時段不代表可預約/);
  assert.match(html, /id="theme-toggle"/);
  assert.match(html, /id="week-view"/);
  assert.doesNotMatch(html, /<(?:script|link)[^>]+(?:src|href)="\//);
  // Rebuilding a clean output is supported without accumulating files.
  await buildPublicSite({ snapshotPath, outputDir });
});

test('failed generation and installation preserve the complete previous publication', async (t) => {
  const directory = await temporaryDirectory(t);
  const snapshotPath = resolve(directory, 'snapshot.json');
  const outputDir = resolve(directory, 'site');
  await writeFile(snapshotPath, JSON.stringify(snapshot()));
  await buildPublicSite({ snapshotPath, outputDir });
  const previousHtml = await readFile(resolve(outputDir, 'index.html'), 'utf8');
  const previousData = await readFile(resolve(outputDir, 'data/schedule.json'), 'utf8');
  const updated = { ...snapshot([syntheticProject()]), publishedAt: '2026-10-12T04:00:00.000Z' };
  await writeFile(snapshotPath, JSON.stringify(updated));
  await assert.rejects(buildPublicSite({ snapshotPath, outputDir, buildUi: async ({ outputDir: staging }) => {
    await writeFile(resolve(staging, 'index.html'), 'incomplete HTML');
    throw Object.assign(new Error('Simulated disk write failure'), { code: 'ENOSPC' });
  } }), /Simulated disk write failure/);
  assert.equal(await readFile(resolve(outputDir, 'index.html'), 'utf8'), previousHtml);
  assert.equal(await readFile(resolve(outputDir, 'data/schedule.json'), 'utf8'), previousData);
  await assert.rejects(buildPublicSite({ snapshotPath, outputDir, installDirectory: async () => {
    throw Object.assign(new Error('Simulated Windows directory lock'), { code: 'EPERM' });
  } }), /Simulated Windows directory lock/);
  assert.equal(await readFile(resolve(outputDir, 'index.html'), 'utf8'), previousHtml);
  assert.equal(await readFile(resolve(outputDir, 'data/schedule.json'), 'utf8'), previousData);
  assert.deepEqual((await readdir(directory)).sort(), ['site', 'snapshot.json']);
  await buildPublicSite({ snapshotPath, outputDir });
  assert.deepEqual(JSON.parse(await readFile(resolve(outputDir, 'data/schedule.json'), 'utf8')), updated);
  assert.deepEqual((await readdir(outputDir)).sort(), ['.nojekyll', 'data', 'index.html']);
});

test('public build rejects junction ancestors before writing through them', async (t) => {
  const directory = await temporaryDirectory(t);
  const snapshotPath = resolve(directory, 'snapshot.json');
  const actual = resolve(directory, 'actual');
  const link = resolve(directory, 'linked');
  await writeFile(snapshotPath, JSON.stringify(snapshot()));
  await mkdir(actual);
  try { await symlink(actual, link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('Environment does not permit symlink creation.'); return; }
    throw error;
  }
  await assert.rejects(buildPublicSite({ snapshotPath, outputDir: resolve(link, 'site') }), /符號連結/);
  assert.deepEqual(await readdir(actual), []);
});

function browserElements() {
  const elements = new Map();
  function element() {
    return { children: [], style: {}, dataset: {}, attributes: {}, listeners: new Map(),
      textContent: '', hidden: false, disabled: false, scrollLeft: 0, clientWidth: 900,
      classList: { toggle() {} },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(name, callback) { this.listeners.set(name, callback); },
      querySelector(selector) { return this.children.find((child) => child.className?.split(' ').includes(selector.slice(1))); },
      getBoundingClientRect() { return { left: 0, right: 900, top: 0, bottom: 500 }; },
      showModal() {}, close() {},
    };
  }
  const document = { documentElement: { dataset: { theme: 'dark' } },
    getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
    createElement() { return element(); },
  };
  return { document, elements };
}

test('failed reloads keep the prior-publication label through navigation and successful retries restore it', async (t) => {
  const directory = await temporaryDirectory(t);
  const snapshotPath = resolve(directory, 'snapshot.json');
  const outputDir = resolve(directory, 'site');
  await writeFile(snapshotPath, JSON.stringify(snapshot()));
  await buildPublicSite({ snapshotPath, outputDir });
  const html = await readFile(resolve(outputDir, 'index.html'), 'utf8');
  const { document, elements } = browserElements();
  let fail = false;
  let calls = 0;
  const intervals = [];
  const context = createContext({ document, Intl, Date, Map, Set, console,
    fetch: async () => { calls++; if (fail) throw new Error('Offline'); return { ok: true, json: async () => snapshot() }; },
    localStorage: { getItem() { return null; }, setItem() {} },
    ResizeObserver: class { observe() {} },
    requestAnimationFrame() { return 1; }, cancelAnimationFrame() {},
    setInterval(callback) { intervals.push(callback); return intervals.length; },
  });
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) await new Script(match[1]).runInContext(context);
  assert.equal(calls, 1);
  assert.equal(elements.get('sync-status').textContent, '最後發布 · 2026-01-01 16:00（台北時間）');
  assert.equal(elements.get('notification').textContent, '目前尚無已公開排程；請聯繫團隊確認檔期。');
  fail = true;
  await elements.get('refresh').listeners.get('click')();
  assert.match(elements.get('sync-status').textContent, /^讀取失敗 · 上次發布/);
  assert.match(elements.get('notification').textContent, /上次成功讀取的資料/);
  elements.get('week-view').listeners.get('click')();
  assert.match(elements.get('sync-status').textContent, /^讀取失敗 · 上次發布/);
  for (const callback of intervals) callback();
  assert.equal(calls, 2);
  fail = false;
  await elements.get('refresh').listeners.get('click')();
  assert.match(elements.get('sync-status').textContent, /^最後發布/);
  assert.equal(elements.get('refresh').disabled, false);
});

test('static site preserves the full approved 500-character goal in project details', async (t) => {
  const directory = await temporaryDirectory(t);
  const snapshotPath = resolve(directory, 'snapshot.json');
  const outputDir = resolve(directory, 'site');
  const goal = '公'.repeat(500);
  const value = snapshot([{ ...syntheticProject(), goal }]);
  await writeFile(snapshotPath, JSON.stringify(value));
  await buildPublicSite({ snapshotPath, outputDir });
  const html = await readFile(resolve(outputDir, 'index.html'), 'utf8');
  const { document, elements } = browserElements();
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-10-12T04:00:00Z'])); }
  }
  const context = createContext({ document, Intl, Date: FixedDate, Map, Set,
    fetch: async () => ({ ok: true, json: async () => value }),
    localStorage: { getItem() { return null; }, setItem() {} },
    ResizeObserver: class { observe() {} },
    requestAnimationFrame() { return 1; }, cancelAnimationFrame() {}, setInterval() {},
  });
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) await new Script(match[1]).runInContext(context);
  const card = elements.get('timeline-canvas').children.find((child) => child.className?.split(' ').includes('project-card'));
  assert.ok(card);
  card.listeners.get('click')();
  assert.equal(elements.get('detail-content').children[1].textContent, goal);
});
