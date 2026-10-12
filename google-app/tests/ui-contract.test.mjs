import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { Script } from 'node:vm';
import { WORKSPACES, createDemo } from '../../scripts/timeline-core.mjs';
import { normalizePublicPayload } from '../ui/public-contract.mjs';
import { normalizeInternalPayload } from '../ui/internal-contract.mjs';
import { createGoogleBridge } from '../ui/bridge.mjs';
import { buildGoogleUi } from '../../scripts/build-google-ui.mjs';
import { createGooglePreviewServer } from '../../scripts/serve-google-preview.mjs';

function publicData() {
  return { mode: 'public', today: '2026-10-12', workspaces: WORKSPACES, permissions: { canEditLayout: false },
    projects: [{ alias: '專案 001', goal: '角色與場景製作', start: '2026-10-12', end: '2027-01-15', workspaceIds: ['B', 'C'], workspaceUnits: { B: 2, C: 1 } }] };
}

test('public projects use anonymous keys and keep all four workspaces', () => {
  const payload = normalizePublicPayload(publicData());
  assert.equal(payload.projects[0].id, '專案 001');
  assert.deepEqual(payload.projects[0].workspaceIds, ['B', 'C']);
  assert.deepEqual(payload.workspaces.map((space) => space.capacity), [2, 2, null, null]);
});

test('public data rejects internal fields, wrong modes, and write permissions', () => {
  for (const field of ['id', 'customer', 'owner', 'originalStart', 'sourceLinks', 'status']) {
    const value = publicData(); value.projects[0][field] = 'PRIVATE';
    assert.throws(() => normalizePublicPayload(value));
  }
  const source = publicData(); source.sourceUrl = 'https://docs.google.com/spreadsheets/d/PRIVATE';
  assert.throws(() => normalizePublicPayload(source));
  assert.throws(() => normalizePublicPayload({ ...publicData(), mode: 'internal' }));
  assert.throws(() => normalizePublicPayload({ ...publicData(), permissions: { canEditLayout: true } }));
});

test('internal layout editing requires a revision and backend permission', () => {
  const sample = { ...createDemo(new Date('2026-10-12T04:00:00Z')), mode: 'internal', permissions: { canEditLayout: true } };
  assert.throws(() => normalizeInternalPayload(sample));
  const result = normalizeInternalPayload({ ...sample, revision: 'REV-1' });
  assert.equal(result.revision, 'REV-1');
  assert.equal(result.permissions.canEditLayout, true);
  assert.equal(normalizeInternalPayload({ ...sample, permissions: {} }).permissions.canEditLayout, false);
});

test('Google bridge always queries without mode/source arguments and denies public writes', async () => {
  const calls = [];
  const api = { withSuccessHandler(handler) { this.ok = handler; return this; }, withFailureHandler(handler) { this.fail = handler; return this; },
    getTimeline(...args) { calls.push(args); this.ok(publicData()); }, saveLayout() { throw new Error('must not be called'); } };
  const call = createGoogleBridge('public', api);
  await call('getTimeline', { mode: 'internal', sourceId: 'PRIVATE' });
  assert.deepEqual(calls, [[]]);
  await assert.rejects(call('saveLayout', {}));
});

test('separate HTML bundles compile and public HTML has no internal bridge or static routes', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'pm-studio-google-ui-'));
  try {
    const result = await buildGoogleUi({ outputDir: directory, packageDir: null });
    for (const item of result) for (const match of item.html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Script(match[1]);
    const publicHtml = result.find((item) => item.view === 'public').html;
    assert.doesNotMatch(publicHtml, /\/api\/projects|\/api\/layout|saveLayout|project\.customer|project\.owner|sourceUrl|id="assignment-form"|id="source-link"|id="layout-demo"/);
    assert.doesNotMatch(publicHtml, /C-001|PrivateProject|private\.example/);
    const internalHtml = result.find((item) => item.view === 'internal').html;
    assert.match(internalHtml, /revision: state\.payload\.revision/);
    assert.match(internalHtml, /id="layout-demo"/);
    assert.match(publicHtml, /data-theme="dark"/);
  } finally {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe temporary cleanup path.');
    await rm(directory, { recursive: true, force: true });
  }
});

test('preview uses only synthetic anonymous public data and rejects stale internal updates', async () => {
  const server = createGooglePreviewServer({ now: new Date('2026-10-12T04:00:00Z') });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const rpc = (view, body) => fetch(`${base}/mock/${view}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const published = await (await rpc('public', { method: 'getTimeline' })).json();
    assert.equal(normalizePublicPayload(published).projects.length, 9);
    assert.doesNotMatch(JSON.stringify(published), /DEMO-|customer|owner|sourceUrl/);
    assert.equal((await rpc('public', { method: 'saveLayout', input: {} })).status, 403);
    assert.equal((await rpc('public', { method: 'getTimeline', input: { mode: 'internal' } })).status, 400);
    const internal = await (await rpc('internal', { method: 'getTimeline' })).json();
    const changed = await rpc('internal', { method: 'saveLayout', input: { revision: internal.revision, assignments: { 'DEMO-001': ['A', 'C'] }, allocations: { 'DEMO-001': { A: 1, C: 1 } } } });
    assert.equal(changed.status, 200);
    assert.equal((await rpc('internal', { method: 'saveLayout', input: { revision: internal.revision, assignments: {}, allocations: {} } })).status, 409);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
