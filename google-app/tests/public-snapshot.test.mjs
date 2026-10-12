import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_FEED_HEADER, validatePublicSnapshot, createPublicPayload, snapshotFromFeedRows, parseFeedCsv } from '../../scripts/public-snapshot.mjs';
import { exportPublicSnapshot } from '../../scripts/export-public-snapshot.mjs';

const timestamp = '2026-10-12T13:00:00.000Z';
const project = () => ({ alias: '專案 001', goal: '角色模型交付', start: '2026-12-28', end: '2027-01-14', workspaceIds: ['A', 'C'], workspaceUnits: { A: 3, C: 1 } });
const snapshot = () => ({ schemaVersion: 1, publishedAt: timestamp, projects: [project()] });

test('snapshot rejects private fields at every level instead of filtering them into public data', () => {
  for (const extra of ['sourceUrl', 'customer', 'preview', 'today']) assert.throws(() => validatePublicSnapshot({ ...snapshot(), [extra]: 'private' }));
  for (const extra of ['id', 'owner', 'customer', 'sourceLinks', 'approvedRevision']) {
    const value = snapshot(); value.projects[0][extra] = 'private';
    assert.throws(() => validatePublicSnapshot(value));
  }
  for (const goal of ['C-001 角色', '請洽 test@example.test', 'https://example.test', '=IMPORTDATA()', '交付\n內部資訊']) {
    const value = snapshot(); value.projects[0].goal = goal;
    assert.throws(() => validatePublicSnapshot(value));
  }
});

test('snapshot validates dates and publication metadata without imposing workspace capacity', () => {
  assert.equal(validatePublicSnapshot(snapshot()).projects[0].workspaceUnits.A, 3);
  for (const [key, value] of [['start', '2026-12'], ['start', '2026-02-30'], ['end', '2026-01-01']]) {
    const data = snapshot(); data.projects[0][key] = value; assert.throws(() => validatePublicSnapshot(data));
  }
  for (const publishedAt of ['', '2026-02-30T13:00:00.000Z', '2026-10-12']) assert.throws(() => validatePublicSnapshot({ ...snapshot(), publishedAt }));
  const duplicate = snapshot(); duplicate.projects.push(project()); assert.throws(() => validatePublicSnapshot(duplicate));
  const unknownUnits = snapshot(); unknownUnits.projects[0].workspaceUnits.B = 1; assert.throws(() => validatePublicSnapshot(unknownUnits));
});

test('browser payload uses current Taipei date and retains original publication time', () => {
  const data = createPublicPayload(snapshot(), new Date('2027-01-02T16:05:00.000Z'));
  assert.equal(data.today, '2027-01-03');
  assert.equal(data.syncedAt, timestamp);
  assert.equal(data.mode, 'public');
  assert.deepEqual(data.permissions, { canEditLayout: false });
  assert.equal(data.workspaces[0].capacity, null);
  assert.equal(data.workspaces[0].usualLoad, 2);
  assert.deepEqual(Object.keys(data.projects[0]), ['alias', 'goal', 'start', 'end', 'workspaceIds', 'workspaceUnits']);
});

test('anonymous CSV/row import requires the exact approved-feed schema and preserves empty feed', () => {
  const row = ['專案 001', '模型,角色', '2026-12-28', '2027-01-14', '["A","C"]', '{"A":3,"C":1}'];
  const quoted = (cell) => `"${cell.replaceAll('"', '""')}"`;
  const csv = '\uFEFF' + [PUBLIC_FEED_HEADER, row].map((cells) => cells.map(quoted).join(',')).join('\r\n') + '\r\n';
  assert.equal(snapshotFromFeedRows(parseFeedCsv(csv), timestamp).projects[0].goal, '模型,角色');
  assert.deepEqual(snapshotFromFeedRows([PUBLIC_FEED_HEADER], timestamp).projects, []);
  assert.throws(() => snapshotFromFeedRows([['案號', ...PUBLIC_FEED_HEADER.slice(1)], row], timestamp));
  assert.throws(() => snapshotFromFeedRows([PUBLIC_FEED_HEADER, [...row, 'private']], timestamp));
  assert.throws(() => parseFeedCsv('"unterminated'));
});

test('invalid feed cannot replace a previous published snapshot', async () => {
  const local = resolve(dirname(fileURLToPath(import.meta.url)), '../../local');
  await mkdir(local, { recursive: true });
  const directory = await mkdtemp(resolve(local, 'pm-public-export-'));
  try {
    const feedPath = resolve(directory, 'anonymous.json'), outputPath = resolve(directory, 'schedule.json');
    await writeFile(feedPath, JSON.stringify({ values: [PUBLIC_FEED_HEADER] }));
    await exportPublicSnapshot({ feedPath, outputPath, publishedAt: timestamp });
    const original = await readFile(outputPath, 'utf8');
    const simultaneous = await Promise.allSettled([
      exportPublicSnapshot({ feedPath, outputPath, publishedAt: timestamp }),
      exportPublicSnapshot({ feedPath, outputPath, publishedAt: timestamp }),
    ]);
    assert.ok(simultaneous.some((result) => result.status === 'fulfilled'));
    for (const result of simultaneous.filter((result) => result.status === 'rejected')) assert.match(result.reason.message, /正在匯出/);
    assert.equal(await readFile(outputPath, 'utf8'), original);
    await writeFile(feedPath, JSON.stringify({ values: [['customer', 'internal']] }));
    await assert.rejects(exportPublicSnapshot({ feedPath, outputPath, publishedAt: timestamp }));
    assert.equal(await readFile(outputPath, 'utf8'), original);
    await assert.rejects(exportPublicSnapshot({ feedPath, outputPath: feedPath, publishedAt: timestamp }));
    if (process.platform === 'win32') await assert.rejects(exportPublicSnapshot({ feedPath, outputPath: feedPath.toUpperCase(), publishedAt: timestamp }), /不可覆蓋/);
  } finally {
    if (!resolve(directory).startsWith(local + sep)) throw new Error('Unsafe temporary path.');
    await rm(directory, { recursive: true, force: true });
  }
});
