import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { Script } from 'node:vm';
import { normalizeTimelinePayload, PENDING_REASONS, CUSTOMER_TYPES, PROJECT_DETAIL_FIELDS } from '../ui/common-contract.mjs';
import { createGoogleBridge } from '../ui/bridge.mjs';
import { timelineDay, timelineDateBounds, timelineRange, taipeiToday, timelineScale, timelineScrollPosition, preciseTimelineRange, projectPendingReasons, projectFollowUp, buildTimelineLayout } from '../../web/dist/app.mjs';
import { buildGoogleUi } from '../../scripts/build-google-ui.mjs';
import { createGooglePreviewServer, createPreviewPayload } from '../../scripts/serve-google-preview.mjs';

function payload() { return createPreviewPayload(new Date('2026-12-21T04:00:00Z')); }
test('single public contract preserves IDs, codes, four workspaces, and flexible allocations', () => {
  const source = payload();
  source.projects[0].workspaceUnits.A = 9;
  const result = normalizeTimelinePayload(source);
  assert.equal(result.schemaVersion, 3);
  assert.equal(result.projects.length, 12);
  assert.equal(result.projects[0].id, 'C-901');
  assert.equal(result.projects[0].customerCode, 'TEST-01');
  assert.equal(result.projects[0].workspaceUnits.A, 9);
  assert.deepEqual(result.workspaces.map((space) => space.id), ['A','B','C','D']);
  assert.deepEqual(PENDING_REASONS, ['no-workspace','workspace-values','production-dates','correction-dates','customer-code','customer-type','schedule-kind','follow-up-values']);
  assert.deepEqual(CUSTOMER_TYPES, ['VTuber個人', 'VTuber公司', '遊戲公司', '其他']);
  assert.equal(result.projects[0].customerType, 'VTuber個人');
  for (const field of PROJECT_DETAIL_FIELDS) assert.equal(result.projects[0][field], source.projects[0][field]);
});
test('client contract rejects non-allowlisted fields, unknown reasons, and malformed allocations', () => {
  for (const field of ['name','customer','contact','assignee','goal','sourceLinks','sourceUrl','originalRow','sourceId','alias']) {
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
test('public detail text and client types remain explicit, bounded, and required', () => {
  assert.deepEqual(PROJECT_DETAIL_FIELDS, ['owner', 'status', 'deliveryGoal', 'notes', 'deliverySteps']);
  for (const field of ['name', 'customer', 'contact', 'assignee']) assert.ok(!Object.hasOwn(payload().projects[0], field));
  for (const field of PROJECT_DETAIL_FIELDS) {
    const missing = payload(); delete missing.projects[0][field]; assert.throws(() => normalizeTimelinePayload(missing));
    for (const value of [null, {}, 1, 'x'.repeat(4001)]) { const bad = payload(); bad.projects[0][field] = value; assert.throws(() => normalizeTimelinePayload(bad)); }
    const allowed = payload(); allowed.projects[0][field] = 'x'.repeat(4000); assert.equal(normalizeTimelinePayload(allowed).projects[0][field].length, 4000);
  }
  for (const customerType of [...CUSTOMER_TYPES, '']) {
    const data = payload(); data.projects[0].customerType = customerType; assert.equal(normalizeTimelinePayload(data).projects[0].customerType, customerType);
  }
  for (const customerType of ['VTuber', '個人', '<b>其他</b>', null, 1]) {
    const data = payload(); data.projects[0].customerType = customerType; assert.throws(() => normalizeTimelinePayload(data));
  }
  const missing = payload(); delete missing.projects[0].customerType; assert.throws(() => normalizeTimelinePayload(missing));
});
test('missing, impossible and reversed dates remain pending; valid corrections stay visible', () => {
  assert.equal(timelineDay('2028-02-29') !== null, true);
  assert.equal(timelineDay('2027-02-29'), null);
  assert.equal(timelineDay('2026-12'), null);
  assert.equal(preciseTimelineRange('2027-01-02', '2026-12-31'), null);
  const source = payload();
  const project = { ...source.projects[0], start: '2026-12', end: '', correctionStart: '2027-01-03', correctionEnd: '2027-01-08' };
  assert.ok(projectPendingReasons(project).includes('production-dates'));
  const layout = buildTimelineLayout([project], source.workspaces, timelineDay('2026-12-20'), timelineScale(900));
  assert.equal(layout.rows[0].blocks.length, 1);
  assert.equal(layout.rows[0].blocks[0].phase, 'correction');
  const unspecified = source.projects.find((project) => !project.workspaceIds.length);
  assert.ok(projectPendingReasons(unspecified).includes('no-workspace'));
  assert.ok(projectPendingReasons(source.projects.find((project) => project.id === 'BG-902')).includes('correction-dates'));
});
test('known months render their calendar envelope, preserve source precision, and do not become pending', () => {
  const source = payload();
  const project = { ...source.projects[0], start: '2026-09', end: '2026-11-30', correctionStart: '2026-12', correctionEnd: '2027-01', pendingReasons: [] };
  const original = JSON.stringify(project);
  assert.equal(projectPendingReasons(project).length, 0);
  assert.deepEqual(timelineDateBounds('2028-02'), { first: timelineDay('2028-02-01'), last: timelineDay('2028-02-29'), precision: 'month' });
  assert.equal(timelineDateBounds('2027-13'), null);
  assert.equal(timelineRange('2027-03', '2027-02'), null);
  const row = buildTimelineLayout([project], source.workspaces, timelineDay('2026-09-01'), { dayWidth: 10, days: 180 }).rows[0];
  assert.equal(row.blocks.length, 2);
  assert.equal(row.blocks[0].start, '2026-09');
  assert.equal(row.blocks[0].startPrecision, 'month');
  assert.equal(row.blocks[0].width, 91 * 10 - 2.4);
  assert.equal(row.blocks[1].endPrecision, 'month');
  assert.equal(JSON.stringify(project), original);
});
test('reservations are real timeline phases without additional confirmation or allocation changes', () => {
  const source = payload();
  const reservation = { ...source.projects[0], scheduleKind: 'reservation', start: '2027-04', end: '2027-06', correctionStart: '', correctionEnd: '', workspaceIds: ['A', 'B'], workspaceUnits: { A: 1, B: 1 }, pendingReasons: [] };
  const layout = buildTimelineLayout([reservation], source.workspaces, timelineDay('2027-04-01'), timelineScale(900));
  assert.equal(layout.rows[0].blocks[0].phase, 'reservation');
  assert.equal(layout.rows[1].blocks[0].phase, 'reservation');
  assert.deepEqual(projectPendingReasons(reservation), []);
});
test('historic follow-up survives offscreen work without stretching bars, reserves distinct lanes, and clears with status', () => {
  const source = payload(), today = timelineDay('2026-12-21'), first = today - 4;
  const historical = { ...source.projects[0], start: '2026-08-01', end: '2026-08-31', correctionStart: '2026-09-01', correctionEnd: '2026-09-03', followUp: ['customer-confirmation', 'payment'] };
  const other = { ...historical, id: 'C-999' };
  const current = { ...historical, id: 'C-998', start: '2026-12-18', end: '2026-12-24', correctionStart: '', correctionEnd: '', followUp: [] };
  const layout = buildTimelineLayout([historical, other, current], source.workspaces, first, { ...timelineScale(212), today });
  const row = layout.rows[0];
  assert.equal(row.blocks.length, 1);
  assert.equal(row.followUps.length, 2);
  assert.equal(new Set([...row.blocks, ...row.followUps].map((item) => item.lane)).size, 3);
  assert.ok(row.followUps.every((item) => item.left === 0 && item.clippedStart && item.endpointVisible));
  assert.equal(row.followUps[0].first, timelineDay('2026-09-04'));
  assert.equal(row.followUps[0].last, today);
  assert.equal(row.blocks[0].last, timelineDay('2026-12-24'));
  assert.equal(projectFollowUp({ ...historical, followUp: [] }, today), null);
  assert.equal(projectFollowUp({ ...historical, correctionEnd: '' }, today), null);
  assert.equal(projectFollowUp({ ...historical, correctionEnd: '2027-02-01' }, today), null);
  const beforeToday = buildTimelineLayout([historical], source.workspaces, today - 40, { dayWidth: 10, days: 20, today }).rows[0].followUps[0];
  assert.equal(beforeToday.endpointVisible, false);
  assert.equal(beforeToday.width, 200);
  const workView = buildTimelineLayout([historical], source.workspaces, timelineDay('2026-08-01'), { dayWidth: 10, days: 170, today }).rows[0];
  assert.equal(workView.blocks[0].width, 31 * 10 - 2.4);
  assert.equal(workView.blocks[1].left + workView.blocks[1].width, workView.followUps[0].left);
});
test('Taipei date crosses midnight independently of UTC and follow-up starts only after work ends', () => {
  assert.equal(taipeiToday(new Date('2026-12-21T15:59:59Z')), '2026-12-21');
  assert.equal(taipeiToday(new Date('2026-12-21T16:00:00Z')), '2026-12-22');
  const project = { ...payload().projects[0], start: '2026-12', end: '2026-12', correctionStart: '', correctionEnd: '', followUp: ['payment'] };
  assert.equal(projectFollowUp(project, timelineDay('2026-12-31')), null);
  assert.equal(projectFollowUp(project, timelineDay('2027-01-01')).first, timelineDay('2027-01-01'));
});
test('overlapping production and revisions use separate lanes and tracking joins the latest phase', () => {
  const source = payload();
  const project = { ...source.projects[0], start: '2026-12-01', end: '2026-12-20', correctionStart: '2026-12-15', correctionEnd: '2026-12-22', followUp: ['payment'] };
  const row = buildTimelineLayout([project], source.workspaces, timelineDay('2026-12-01'), { dayWidth: 10, today: timelineDay('2026-12-23') }).rows[0];
  assert.notEqual(row.blocks[0].lane, row.blocks[1].lane);
  assert.equal(row.followUps[0].lane, row.blocks[1].lane);
  assert.ok(Math.abs(row.followUps[0].left - row.blocks[1].left - row.blocks[1].width) < 1e-9);
});
test('timeline retains overlap lanes, cross-workspace cases and year-spanning phases without date guesses', () => {
  const source = payload();
  const base = { ...source.projects[0], start: '2026-12-25', end: '2027-01-05', correctionStart: '2027-01-12', correctionEnd: '2027-01-14', workspaceIds: ['A','C'], workspaceUnits: { A: 3, C: 1 }, pendingReasons: [] };
  const overlapping = { ...base, id: 'C-999', start: '2026-12-29', end: '2027-01-01', correctionStart: '', correctionEnd: '', workspaceIds: ['A'], workspaceUnits: { A: 1 } };
  const layout = buildTimelineLayout([base,overlapping], source.workspaces, timelineDay('2026-12-20'), { dayWidth: 20, days: 40 });
  assert.equal(layout.rows[0].blocks.length, 3);
  assert.equal(layout.rows[2].blocks.length, 2);
  assert.notEqual(layout.rows[0].blocks.find((block) => block.project.id === 'C-999').lane, layout.rows[0].blocks.find((block) => block.phase === 'production' && block.project.id === base.id).lane);
  assert.equal(layout.rows[0].blocks.find((block) => block.phase === 'production' && block.project.id === base.id).width, 12*20-4);
  const earlier = buildTimelineLayout([base], source.workspaces, timelineDay('2020-01-01'), timelineScale(900));
  assert.equal(earlier.rows.flatMap((row) => row.blocks).length, 0);
  assert.equal(projectPendingReasons(base).length, 0);
});
test('adaptive scale fits exactly six or twelve weeks without losing fractional scroll dates', () => {
  for (const width of [212, 240, 559, 560, 561, 900, 1428]) {
    const scale = timelineScale(width);
    assert.equal(scale.visibleDays, width <= 560 ? 42 : 84);
    assert.ok(Math.abs(scale.dayWidth * scale.visibleDays - width) < 1e-9);
    const first = timelineDay('2026-12-17');
    const position = timelineScrollPosition(first, 167.25 * scale.dayWidth, scale.dayWidth);
    assert.equal(position.day, first + 167);
    assert.ok(Math.abs(position.fraction - .25) < 1e-9);
    assert.equal(timelineScrollPosition(first, 42 * scale.dayWidth, scale.dayWidth).day, first + 42);
  }
});
test('one-day bars keep true widths at both scales and same-day overlaps use separate lanes', () => {
  const source = payload();
  const base = { ...source.projects[0], start: '2026-12-25', end: '2026-12-25', correctionStart: '', correctionEnd: '', workspaceIds: ['A'], workspaceUnits: { A: 1 }, pendingReasons: [] };
  const overlap = { ...base, id: 'C-998' };
  const nextDay = { ...base, id: 'C-999', start: '2026-12-26', end: '2026-12-26' };
  for (const width of [212, 900]) {
    const scale = timelineScale(width);
    const layout = buildTimelineLayout([base, overlap, nextDay], source.workspaces, timelineDay('2026-12-20'), scale);
    const blocks = layout.rows[0].blocks;
    assert.ok(blocks.every((block) => block.width > 0 && block.width <= scale.dayWidth));
    assert.notEqual(blocks[0].lane, blocks[1].lane);
    assert.equal(blocks[0].lane, blocks[2].lane);
    assert.ok(Math.abs(blocks[2].left - blocks[0].left - scale.dayWidth) < 1e-9);
    assert.ok(blocks[0].left + blocks[0].width < blocks[2].left);
    assert.ok(Math.abs(layout.width - 210 * scale.dayWidth) < 1e-9);
  }
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
    assert.equal(data.projects.length,12);
    assert.ok(data.projects.every((project)=>!project.customerCode || project.customerCode.startsWith('TEST-')));
    assert.equal((await rpc({method:'saveLayout',input:{}})).status,400);
    assert.equal((await rpc({method:'getTimeline',input:{source:'PRIVATE'}})).status,400);
    assert.equal((await fetch(base+'/internal')).status,404);
    assert.equal((await fetch(base+'/public')).status,404);
  } finally { await new Promise((done)=>server.close(done)); }
});
