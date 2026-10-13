import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { Script } from 'node:vm';
import { normalizeTimelinePayload, PENDING_REASONS } from '../ui/common-contract.mjs';
import { createGoogleBridge } from '../ui/bridge.mjs';
import { timelineDay, preciseTimelineRange, projectPendingReasons, buildTimelineLayout } from '../../web/dist/app.mjs';
import { buildGoogleUi } from '../../scripts/build-google-ui.mjs';
import { createGooglePreviewServer, createPreviewPayload } from '../../scripts/serve-google-preview.mjs';

function payload() { return createPreviewPayload(new Date('2026-12-21T04:00:00Z')); }
test('single public contract preserves IDs, codes, four workspaces, and flexible allocations', () => {
  const source = payload();
  source.projects[0].workspaceUnits.A = 9;
  const result = normalizeTimelinePayload(source);
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.projects.length, 9);
  assert.equal(result.projects[0].id, 'C-901');
  assert.equal(result.projects[0].customerCode, 'TEST-01');
  assert.equal(result.projects[0].workspaceUnits.A, 9);
  assert.deepEqual(result.workspaces.map((space) => space.id), ['A','B','C','D']);
  assert.deepEqual(PENDING_REASONS, ['no-workspace','workspace-values','production-dates','correction-dates','customer-code']);
});
test('client contract rejects extra private fields, leaked names, unknown reasons, and malformed allocations', () => {
  for (const field of ['name','customer','owner','goal','sourceLinks','status','alias']) {
    const data = payload(); data.projects[0][field] = 'PRIVATE';
    assert.throws(() => normalizeTimelinePayload(data));
  }
  for (const code of ['Name', 'TEST-01 Name', 'https://private.example', 'TEST-01@example.com', '<b>TEST-01</b>']) {
    const data = payload(); data.projects[0].customerCode = code;
    assert.throws(() => normalizeTimelinePayload(data));
  }
  for (const units of [0,-1,1.2,'2',Number.MAX_SAFE_INTEGER+1]) {
    const data = payload(); data.projects[0].workspaceUnits.A = units;
    assert.throws(() => normalizeTimelinePayload(data));
  }
  const badReason = payload(); badReason.projects[0].pendingReasons = ['PRIVATE NOTE'];
  assert.throws(() => normalizeTimelinePayload(badReason));
  const badWarning = payload(); badWarning.warnings = ['PRIVATE NAME'];
  assert.throws(() => normalizeTimelinePayload(badWarning));
  const badRoot = payload(); badRoot.sourceUrl = 'PRIVATE';
  assert.throws(() => normalizeTimelinePayload(badRoot));
  const duplicate = payload(); duplicate.projects.push(duplicate.projects[0]);
  assert.throws(() => normalizeTimelinePayload(duplicate));
});
test('month precision, impossible and reversed dates remain pending; valid corrections stay visible', () => {
  assert.equal(timelineDay('2028-02-29') !== null, true);
  assert.equal(timelineDay('2027-02-29'), null);
  assert.equal(timelineDay('2026-12'), null);
  assert.equal(preciseTimelineRange('2027-01-02', '2026-12-31'), null);
  const source = payload();
  const project = { ...source.projects[0], start: '2026-12', end: '', correctionStart: '2027-01-03', correctionEnd: '2027-01-08' };
  assert.ok(projectPendingReasons(project).includes('production-dates'));
  const layout = buildTimelineLayout([project], source.workspaces, timelineDay('2026-12-20'));
  assert.equal(layout.rows[0].blocks.length, 1);
  assert.equal(layout.rows[0].blocks[0].phase, 'correction');
  const unspecified = source.projects.find((project) => !project.workspaceIds.length);
  assert.ok(projectPendingReasons(unspecified).includes('no-workspace'));
  assert.ok(projectPendingReasons(source.projects.at(-1)).includes('correction-dates'));
});
test('timeline retains overlap lanes, cross-workspace cases and year-spanning phases without date guesses', () => {
  const source = payload();
  const base = { ...source.projects[0], start: '2026-12-25', end: '2027-01-05', correctionStart: '2027-01-12', correctionEnd: '2027-01-14', workspaceIds: ['A','C'], workspaceUnits: { A: 3, C: 1 }, pendingReasons: [] };
  const overlapping = { ...base, id: 'C-999', start: '2026-12-29', end: '2027-01-01', correctionStart: '', correctionEnd: '', workspaceIds: ['A'], workspaceUnits: { A: 1 } };
  const layout = buildTimelineLayout([base,overlapping], source.workspaces, timelineDay('2026-12-20'), 40);
  assert.equal(layout.rows[0].blocks.length, 3);
  assert.equal(layout.rows[2].blocks.length, 2);
  assert.notEqual(layout.rows[0].blocks.find((block) => block.project.id === 'C-999').lane, layout.rows[0].blocks.find((block) => block.phase === 'production' && block.project.id === base.id).lane);
  assert.equal(layout.rows[0].blocks.find((block) => block.phase === 'production' && block.project.id === base.id).width, 12*20-4);
  const earlier = buildTimelineLayout([base], source.workspaces, timelineDay('2020-01-01'));
  assert.equal(earlier.rows.flatMap((row) => row.blocks).length, 0);
  assert.equal(projectPendingReasons(base).length, 0);
});
test('bridge only performs an argument-free getTimeline read and sanitizes service errors', async () => {
  const calls = [];
  const runner = { withSuccessHandler(fn) { this.ok=fn; return this; }, withFailureHandler(fn) { this.bad=fn; return this; }, getTimeline(...args) { calls.push(args); this.ok(payload()); } };
  const read = createGoogleBridge(runner);
  await read({ sourceId: 'PRIVATE', mode: 'internal' });
  assert.deepEqual(calls, [[]]);
  runner.getTimeline = function() { this.bad(new Error('PRIVATE_SOURCE_ID')); };
  await assert.rejects(read(), /Schedule service is unavailable/);
  await assert.rejects(createGoogleBridge(null)(), /unavailable/);
});
test('build produces one self-contained read-only HTML and one complete single deployment bundle', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'pm-single-ui-'));
  try {
    const result = await buildGoogleUi({ outputDir: resolve(directory, 'html'), packageDir: resolve(directory, 'bundle') });
    assert.equal(result.length,1); assert.equal(result[0].filename,'Index.html');
    const html = result[0].html;
    for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Script(match[1]);
    assert.deepEqual(await readdir(resolve(directory,'bundle')), ['single']);
    assert.deepEqual((await readdir(resolve(directory,'bundle/single'))).sort(), ['Code.gs','Index.html','appsscript.json']);
    const manifest = JSON.parse(await readFile(resolve(directory,'bundle/single/appsscript.json'),'utf8'));
    assert.deepEqual(manifest.oauthScopes,['https://www.googleapis.com/auth/spreadsheets.readonly']);
    assert.doesNotMatch(html,/saveLayout|publishApprovedSnapshot|sourceUrl|assignment-form|layout-demo|id="search"|id="month-view"|id="week-view"|id="theme-toggle"|PublicIndex/);
    assert.doesNotMatch(html,/TEST-01|C-901|PRIVATE/);
    assert.match(html,/id="previous"/); assert.match(html,/id="today-button"/); assert.match(html,/id="next"/);
  } finally {
    if (!resolve(directory).startsWith(resolve(tmpdir())+sep)) throw new Error('Unsafe cleanup');
    await rm(directory,{ recursive:true,force:true });
  }
});
test('preview exposes only fictional reads and rejects writes, arguments, and old view routes', async () => {
  const server = createGooglePreviewServer({ now:new Date('2026-12-21T04:00:00Z') });
  await new Promise((done)=>server.listen(0,'127.0.0.1',done));
  const base = 'http://127.0.0.1:'+server.address().port;
  const rpc=(body)=>fetch(base+'/mock/timeline',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  try {
    const response=await rpc({method:'getTimeline'});
    const data=normalizeTimelinePayload(await response.json());
    assert.equal(data.projects.length,9);
    assert.ok(data.projects.every((project)=>!project.customerCode || project.customerCode.startsWith('TEST-')));
    assert.equal((await rpc({method:'saveLayout',input:{}})).status,400);
    assert.equal((await rpc({method:'getTimeline',input:{source:'PRIVATE'}})).status,400);
    assert.equal((await fetch(base+'/internal')).status,404);
    assert.equal((await fetch(base+'/public')).status,404);
  } finally { await new Promise((done)=>server.close(done)); }
});
