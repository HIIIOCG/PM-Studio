import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { Script, createContext } from 'node:vm';
import { normalizeTimelinePayload } from '../ui/common-contract.mjs';
import { normalizeInternalTimelinePayload, INTERNAL_PROJECT_FIELDS } from '../internal/ui/internal-contract.mjs';
import { buildGoogleUi } from '../../scripts/build-google-ui.mjs';
import { renderPublicEntry, renderTeamspaceEntry } from '../../scripts/build-public-site.mjs';
import { createPreviewPayload } from '../../scripts/serve-google-preview.mjs';

function sample() {
  const data = createPreviewPayload(new Date('2026-12-21T04:00:00Z'));
  data.projects = data.projects.map((project) => ({ ...project, name: '虛構專案 ' + project.id, customer: '虛構客戶', owner: '虛構專案主管', status: '虛構狀態（2026/12/21 更新）', deliveryGoal: '虛構交付目標', notes: '虛構補充\n第二行', contact: '虛構窗口', assignee: '虛構執行者', deliverySteps: '虛構步驟' }));
  return data;
}
async function fixture(t, bundle = false) {
  const directory = await mkdtemp(resolve(tmpdir(), 'pm-internal-ui-'));
  t.after(async () => { if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe cleanup'); await rm(directory, { recursive: true, force: true }); });
  return { directory, html: (await buildGoogleUi({ view: 'internal', outputDir: resolve(directory, 'html'), packageDir: bundle ? resolve(directory, 'bundle') : null }))[0].html };
}

function browserDocument(html) {
  const elements = new Map();
  function descendants(node) { return node.children.flatMap((child) => [child, ...descendants(child)]); }
  function matches(node, selector) {
    if (selector.startsWith('#')) return node.id === selector.slice(1);
    if (selector.startsWith('.')) return node.classList.contains(selector.slice(1));
    return node.tagName.toLowerCase() === selector.toLowerCase();
  }
  function element(tag = 'div') {
    const node = { tagName: tag.toUpperCase(), children: [], style: { setProperty(name, value) { this[name] = String(value); } }, attributes: {}, listeners: new Map(), hidden: false, disabled: false, open: false, scrollLeft: 0, _text: '',
      append(...children) { this.children.push(...children); }, replaceChildren(...children) { this._text = ''; this.children = children; },
      setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'id') { this.id = String(value); elements.set(this.id, this); } if (name === 'class') this.className = String(value); },
      getAttribute(name) { return this.attributes[name] ?? null; }, addEventListener(name, callback) { this.listeners.set(name, callback); }, async click() { return await this.listeners.get('click')?.({ target: this }); },
      querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }, querySelectorAll(selector) { return descendants(this).filter((child) => matches(child, selector)); },
      showModal() { this.open = true; }, close() { this.open = false; },
    };
    Object.defineProperty(node, 'textContent', { get() { return this._text + this.children.map((child) => child.textContent).join(''); }, set(value) { this._text = String(value); this.children = []; } });
    Object.defineProperty(node, 'innerHTML', { set() { throw new Error('Unsafe HTML rendering.'); } });
    node.classList = { contains(name) { return (node.className || '').split(' ').includes(name); }, toggle(name, force) { const classes = new Set((node.className || '').split(' ').filter(Boolean)); if (force ?? !classes.has(name)) classes.add(name); else classes.delete(name); node.className = [...classes].join(' '); } };
    return node;
  }
  const container = element('document'), stack = [container];
  const stripped = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  const voidTags = new Set(['meta', 'link', 'input', 'br', 'hr', 'img']);
  for (const token of stripped.matchAll(/<\/?[^>]+>|[^<]+/g)) {
    const value = token[0];
    if (/^<!/.test(value)) continue;
    if (/^<\//.test(value)) { stack.pop(); continue; }
    if (value.startsWith('<')) {
      const tag = /^<([\w-]+)/.exec(value)?.[1];
      if (!tag) continue;
      const node = element(tag);
      for (const attribute of value.slice(tag.length + 1, -1).matchAll(/([\w-]+)(?:="([^"]*)")?/g)) node.setAttribute(attribute[1], attribute[2] ?? '');
      node.hidden = node.getAttribute('hidden') !== null;
      stack.at(-1).append(node);
      if (!voidTags.has(tag) && !/\/>$/.test(value)) stack.push(node);
    } else if (value.trim()) stack.at(-1)._text += value;
  }
  const document = { documentElement: container.querySelector('html'), getElementById(id) { return elements.get(id) || null; }, createElement: element, querySelector(selector) { return container.querySelector(selector); }, querySelectorAll(selector) { return container.querySelectorAll(selector); } };
  Object.defineProperty(document, 'title', { get() { return container.querySelector('title').textContent; }, set(value) { container.querySelector('title').textContent = value; } });
  return { document, elements };
}
async function mount(html, data, { width = 900, failInitially = false, http = false } = {}) {
  const { document, elements } = browserDocument(html);
  const viewport = elements.get('timeline-viewport');
  Object.defineProperty(viewport, 'clientWidth', { get() { return width; } });
  let onResize, fail = failInitially, payload = data;
  const calls = [], preferences = new Map();
  class BrowserDate extends Date { constructor(...args) { super(...(args.length ? args : [data.syncedAt])); } }
  const runner = { withSuccessHandler(callback) { this.ok = callback; return this; }, withFailureHandler(callback) { this.bad = callback; return this; }, getTimeline(...args) { calls.push(args); if (fail) this.bad(new Error('PRIVATE_SOURCE_IDENTIFIER')); else this.ok(payload); } };
  const request = async (url, options) => {
    calls.push({ url, options });
    if (fail) throw new Error('PRIVATE_SOURCE_IDENTIFIER');
    return new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  };
  const context = createContext({ document, Intl, Date: BrowserDate, Map, Set, console,
    ...(http ? { fetch: request, AbortController, setTimeout, clearTimeout } : { google: { script: { run: runner } } }),
    localStorage: { getItem(key) { return preferences.get(key); }, setItem(key, value) { preferences.set(key, value); } }, ResizeObserver: class { constructor(callback) { onResize = callback; } observe() {} }, setInterval() {} });
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) await new Script(match[1]).runInContext(context);
  const get = (id) => { const node = elements.get(id); assert.ok(node, id); return node; };
  return { document, get, calls, preferences, click(id) { return get(id).click(); }, fail(value) { fail = value; }, payload(value) { payload = value; }, resize(value) { width = value; onResize(); } };
}

test('teamspace preserves nine bounded detail fields while public rejects team-only fields', () => {
  const source = sample(), original = JSON.stringify(source);
  const result = normalizeInternalTimelinePayload(source);
  assert.equal(result.projects[0].name, '虛構專案 C-901');
  assert.equal(result.projects[0].notes, '虛構補充\n第二行');
  assert.equal(JSON.stringify(source), original);
  assert.throws(() => normalizeTimelinePayload(source));
  assert.equal(normalizeTimelinePayload(createPreviewPayload(new Date('2026-12-21T04:00:00Z'))).projects[0].owner, 'Fictional project lead');
  for (const field of INTERNAL_PROJECT_FIELDS) {
    const missing = sample(); delete missing.projects[0][field]; assert.throws(() => normalizeInternalTimelinePayload(missing));
    for (const value of [null, {}, 1, 'x'.repeat(4001)]) { const bad = sample(); bad.projects[0][field] = value; assert.throws(() => normalizeInternalTimelinePayload(bad)); }
    const allowed = sample(); allowed.projects[0][field] = 'x'.repeat(4000); assert.equal(normalizeInternalTimelinePayload(allowed).projects[0][field].length, 4000);
  }
  for (const field of ['sourceLinks', 'sourceUrl', 'row', 'originalRow', 'SOURCE_SHEET_ID']) { const bad = sample(); bad.projects[0][field] = 'PRIVATE'; assert.throws(() => normalizeInternalTimelinePayload(bad)); }
  const root = sample(); root.sourceId = 'PRIVATE'; assert.throws(() => normalizeInternalTimelinePayload(root));
  const base = sample(); base.projects[0].workspaceUnits.A = 0; assert.throws(() => normalizeInternalTimelinePayload(base));
  const duplicate = sample(); duplicate.projects.push(duplicate.projects[0]); assert.throws(() => normalizeInternalTimelinePayload(duplicate));
});

test('same schedule builder creates an anonymous teamspace reading bundle for the existing Script project', async (t) => {
  const { html, directory } = await fixture(t, true);
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Script(match[1]);
  const bundle = resolve(directory, 'bundle/internal-readonly');
  assert.deepEqual((await readdir(bundle)).sort(), ['Code.gs', 'Index.html', 'appsscript.json']);
  const manifest = JSON.parse(await readFile(resolve(bundle, 'appsscript.json'), 'utf8'));
  assert.equal(manifest.webapp.executeAs, 'USER_DEPLOYING');
  assert.equal(manifest.webapp.access, 'ANYONE_ANONYMOUS');
  assert.deepEqual(manifest.oauthScopes, ['https://www.googleapis.com/auth/spreadsheets.readonly']);
  const code = await readFile(resolve(bundle, 'Code.gs'), 'utf8');
  assert.deepEqual([...code.matchAll(/^function (\w+)\(/gm)].map((match) => match[1]).filter((name) => !name.endsWith('_')).sort(), ['doGet', 'getTimeline']);
  new Script(code);
  assert.match(code, /existing PM Studio Script project/);
  assert.match(html, /團隊專案排程/);
  assert.doesNotMatch(html, /登入|存取權限|Google Project List permissions|sign-in|USER_ACCESSING/);
  assert.doesNotMatch(html, /虛構專案|C-901|TEST-01|PRIVATE_SOURCE_IDENTIFIER|https:\/\/docs\.google|<script[^>]+src=|saveLayout|publishApprovedSnapshot|assignment-form|id="search"/);
  assert.doesNotMatch(html, /innerHTML|insertAdjacentHTML/);
});

test('internal names appear on timeline and pending cards; details preserve all text without interpreting HTML', async (t) => {
  const source = sample();
  source.projects[0].name = '虛構 <img src=x onerror=alert(1)> 專案';
  source.projects[0].notes = '<script>PRIVATE_INJECTED_SCRIPT</script>\n保留原文';
  const page = await mount((await fixture(t)).html, source);
  assert.equal(page.document.title, 'PM Studio｜團隊專案排程');
  assert.equal(page.get('internal-access-note').textContent, '排程畫面為唯讀。');
  const card = page.get('timeline-canvas').querySelectorAll('.project-card').find((node) => node.getAttribute('data-project-id') === source.projects[0].id);
  assert.match(card.textContent, /虛構 <img/);
  assert.match(card.getAttribute('aria-label'), /虛構 <img/);
  assert.match(card.textContent, /TEST-01 · VTuber個人/);
  await card.click();
  assert.equal(page.get('project-details').open, true);
  for (const field of INTERNAL_PROJECT_FIELDS) assert.ok(page.get('project-details').textContent.includes(source.projects[0][field]), field);
  assert.match(page.get('project-details').textContent, /客戶 TEST-01客戶類型VTuber個人客戶/);
  assert.equal(page.get('project-details').querySelectorAll('img').length, 0);
  assert.equal(page.get('project-details').querySelectorAll('script').length, 0);
  await page.click('close-project-details');
  const pending = page.get('pending-projects').querySelector('.pending-card');
  assert.match(pending.textContent, /虛構專案/);
  assert.match(pending.textContent, /TEST-07 · 遊戲公司/);
  await pending.querySelector('button').click();
  assert.equal(page.get('project-details').open, true);
  assert.match(page.get('project-details').textContent, /虛構專案/);
  assert.deepEqual(page.calls, [[]]);
});

test('internal language and navigation preserve the 84/42-day timeline and full project identities', async (t) => {
  const html = (await fixture(t)).html, source = sample();
  const page = await mount(html, source);
  assert.equal(page.get('date-range').textContent, '2026-12-17 — 2027-03-10');
  const viewport = page.get('timeline-viewport'); viewport.scrollLeft = 40;
  viewport.listeners.get('scroll')();
  const before = page.get('date-range').textContent.split(' — ')[0];
  page.resize(212);
  assert.equal(page.get('date-range').textContent.split(' — ')[0], before);
  await page.click('today-button');
  assert.equal(page.get('date-range').textContent, '2026-12-17 — 2027-01-27');
  await page.click('next'); assert.equal(page.get('date-range').textContent, '2027-01-21 — 2027-03-03');
  await page.click('today-button'); await page.click('language-toggle');
  assert.equal(page.get('schedule-title').textContent, 'Team project schedule');
  assert.equal(page.get('internal-access-note').textContent, 'This schedule is read-only.');
  assert.match(page.get('timeline-canvas').textContent, /虛構專案/);
  await page.get('timeline-canvas').querySelectorAll('.project-card').find((card) => card.getAttribute('data-project-id') === 'C-901').click();
  assert.match(page.get('project-details').textContent, /Client.*虛構客戶.*Current delivery goal.*虛構交付目標/);
  assert.match(page.get('project-details').textContent, /Client TEST-01Client typeIndividual VTuber/);
  assert.equal(page.preferences.get('pm-studio-language'), 'en');
  assert.equal(page.calls.length, 1);
});

test('internal month reservations and offscreen follow-up retain their schedule behavior and full details', async (t) => {
  const source = sample();
  source.projects = [
    { ...source.projects[0], scheduleKind: 'reservation', start: '2026-12', end: '2027-01', correctionStart: '', correctionEnd: '' },
    { ...source.projects.find((project) => project.id === 'C-907') },
  ];
  const page = await mount((await fixture(t)).html, source, { width: 212 });
  assert.equal(page.get('pending-section').hidden, true);
  const reservation = page.get('timeline-canvas').querySelector('.reservation');
  assert.equal(reservation.getAttribute('data-start-precision'), 'month');
  assert.match(reservation.getAttribute('aria-label'), /時段預約.*2026-12 （月份） → 2027-01 （月份）/);
  const endpoint = page.get('timeline-canvas').querySelector('.follow-up-endpoint');
  assert.match(endpoint.getAttribute('aria-label'), /虛構專案 C-907.*客戶確認中.*待收款中/);
  assert.ok(page.get('timeline-canvas').querySelector('.clipped-start'));
  await endpoint.click();
  assert.match(page.get('project-details').textContent, /虛構專案 C-907/);
  assert.match(page.get('project-details').textContent, /等待事項不延長製作期間/);
});

test('teamspace source failures and malformed payloads show no fabricated data or private errors', async (t) => {
  const html = (await fixture(t)).html;
  const page = await mount(html, sample(), { failInitially: true });
  assert.equal(page.get('timeline-grid').hidden, true);
  assert.equal(page.get('retry').hidden, false);
  assert.doesNotMatch(page.document.querySelector('main').textContent, /PRIVATE_SOURCE_IDENTIFIER|虛構專案/);
  page.fail(false); await page.click('retry');
  assert.equal(page.get('timeline-grid').hidden, false);
  const malformed = sample(); malformed.projects[0].sourceLinks = 'PRIVATE_SOURCE_LINK';
  const denied = await mount(html, malformed);
  assert.equal(denied.get('timeline-grid').hidden, true);
  assert.doesNotMatch(denied.document.querySelector('main').textContent, /PRIVATE_SOURCE_LINK|虛構專案/);
});

const DIRECT_PUBLIC_URL = 'https://script.google.com/macros/s/FICTIONAL_DIRECT_PUBLIC_ENDPOINT/exec';
const DIRECT_TEAMSPACE_URL = 'https://script.google.com/macros/s/FICTIONAL_DIRECT_TEAMSPACE_ENDPOINT/exec';

function assertAnonymousRequest(call, url) {
  assert.equal(call.url, url);
  for (const [key, value] of Object.entries({ method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'follow', referrerPolicy: 'no-referrer' })) assert.equal(call.options[key], value, key);
  assert.ok(call.options.signal instanceof AbortSignal);
  assert.equal(Object.hasOwn(call.options, 'body'), false);
}

test('public Pages UI reads by anonymous HTTP and renders only its five detail fields as text', async () => {
  const source = createPreviewPayload(new Date('2026-12-21T04:00:00Z'));
  source.projects[0].notes = '<img src=x onerror=alert(1)>\n中性模型補充';
  source.projects[0].deliverySteps = '<script>PRIVATE_INJECTED_SCRIPT</script>\n中性交付步驟';
  const html = await renderPublicEntry(DIRECT_PUBLIC_URL);
  assert.doesNotMatch(html, /<iframe\b|google\.script\.run|createGoogleBridge\(|normalizeInternalTimelinePayload/);
  const page = await mount(html, source, { http: true });
  assert.equal(page.document.title, 'PM Studio｜專案排程');
  assert.equal(page.get('timeline-grid').hidden, false);
  assert.equal(page.get('date-range').textContent, '2026-12-17 — 2027-03-10');
  assert.equal(page.calls.length, 1);
  assertAnonymousRequest(page.calls[0], DIRECT_PUBLIC_URL);
  const card = page.get('timeline-canvas').querySelectorAll('.project-card').find((node) => node.getAttribute('data-project-id') === source.projects[0].id);
  assert.match(card.textContent, /C-901.*TEST-01 · VTuber個人/);
  await card.click();
  const dialog = page.get('project-details');
  assert.equal(dialog.open, true);
  assert.equal(dialog.querySelectorAll('.project-fields')[0].querySelectorAll('dt').length, 6);
  for (const field of ['owner', 'status', 'deliveryGoal', 'notes', 'deliverySteps']) assert.ok(dialog.textContent.includes(source.projects[0][field]), field);
  assert.equal(dialog.querySelectorAll('img').length, 0);
  assert.equal(dialog.querySelectorAll('script').length, 0);
  const pending = page.get('pending-projects').querySelector('.pending-card');
  assert.ok(pending);
  await pending.querySelector('button').click();
  assert.equal(dialog.open, true);
  assert.match(dialog.textContent, /TEST-07/);
  await page.click('language-toggle');
  assert.equal(page.get('schedule-title').textContent, 'Project schedule');
  assert.equal(page.preferences.get('pm-studio-language'), 'en');
  assert.deepEqual([...page.preferences.keys()], ['pm-studio-language']);
  await page.click('next');
  assert.equal(page.get('date-range').textContent, '2027-03-04 — 2027-05-26');
  assert.equal(page.calls.length, 1);
});

test('teamspace Pages HTTP preserves nine details, month reservations and offscreen follow-up at mobile width', async () => {
  const source = sample();
  source.projects = [
    { ...source.projects[0], name: '虛構 <img src=x onerror=alert(1)> 專案', notes: '<script>PRIVATE_INJECTED_SCRIPT</script>\n保留原文', scheduleKind: 'reservation', start: '2026-12', end: '2027-01', correctionStart: '', correctionEnd: '' },
    { ...source.projects.find((project) => project.id === 'C-907') },
  ];
  const html = await renderTeamspaceEntry(DIRECT_TEAMSPACE_URL);
  assert.doesNotMatch(html, /<iframe\b|google\.script\.run|createGoogleBridge\(/);
  const page = await mount(html, source, { width: 212, http: true });
  assert.equal(page.document.title, 'PM Studio｜團隊專案排程');
  assert.equal(page.get('timeline-grid').hidden, false);
  assert.equal(page.get('pending-section').hidden, true);
  assert.equal(page.get('date-range').textContent, '2026-12-17 — 2027-01-27');
  assert.equal(page.calls.length, 1);
  assertAnonymousRequest(page.calls[0], DIRECT_TEAMSPACE_URL);
  const reservation = page.get('timeline-canvas').querySelector('.reservation');
  assert.equal(reservation.getAttribute('data-start-precision'), 'month');
  assert.match(reservation.textContent, /虛構 <img/);
  await reservation.click();
  const dialog = page.get('project-details');
  for (const field of INTERNAL_PROJECT_FIELDS) assert.ok(dialog.textContent.includes(source.projects[0][field]), field);
  assert.equal(dialog.querySelectorAll('.project-fields')[0].querySelectorAll('dt').length, 9);
  assert.equal(dialog.querySelectorAll('img').length, 0);
  assert.equal(dialog.querySelectorAll('script').length, 0);
  const endpoint = page.get('timeline-canvas').querySelector('.follow-up-endpoint');
  assert.ok(page.get('timeline-canvas').querySelector('.clipped-start'));
  assert.match(endpoint.getAttribute('aria-label'), /虛構專案 C-907.*客戶確認中.*待收款中/);
  await endpoint.click();
  assert.match(dialog.textContent, /虛構專案 C-907/);
  await page.click('language-toggle');
  assert.equal(page.get('schedule-title').textContent, 'Team project schedule');
  await page.click('next');
  assert.equal(page.get('date-range').textContent, '2027-01-21 — 2027-03-03');
  assert.equal(page.calls.length, 1);
});

test('both Pages variants fail generically, reject the other field contract, and retry with a fresh HTTP read', async () => {
  for (const [render, url, data] of [
    [renderPublicEntry, DIRECT_PUBLIC_URL, createPreviewPayload(new Date('2026-12-21T04:00:00Z'))],
    [renderTeamspaceEntry, DIRECT_TEAMSPACE_URL, sample()],
  ]) {
    const html = await render(url);
    const page = await mount(html, data, { http: true, failInitially: true });
    assert.equal(page.get('timeline-grid').hidden, true);
    assert.equal(page.get('retry').hidden, false);
    assert.equal(page.get('sync-status').textContent, '');
    assert.doesNotMatch(page.document.querySelector('main').textContent, /PRIVATE_SOURCE_IDENTIFIER|C-901|虛構專案/);
    assert.equal(page.calls.length, 1);
    page.payload({ ...data, projects: data.projects.map((project) => ({ ...project, owner: 'Fictional updated owner' })) });
    page.fail(false);
    await page.click('retry');
    assert.equal(page.get('timeline-grid').hidden, false);
    assert.equal(page.get('retry').hidden, true);
    assert.equal(page.calls.length, 2);
    page.calls.forEach((call) => assertAnonymousRequest(call, url));
    assert.notEqual(page.calls[0].options.signal, page.calls[1].options.signal);
    const card = page.get('timeline-canvas').querySelectorAll('.project-card').find((node) => node.getAttribute('data-project-id') === data.projects[0].id);
    await card.click();
    assert.match(page.get('project-details').textContent, /Fictional updated owner/);
    assert.deepEqual([...page.preferences.keys()], []);
    const wrongContract = render === renderPublicEntry ? sample() : createPreviewPayload(new Date('2026-12-21T04:00:00Z'));
    const denied = await mount(html, wrongContract, { http: true });
    assert.equal(denied.get('timeline-grid').hidden, true);
    assert.equal(denied.get('retry').hidden, false);
    assert.doesNotMatch(denied.document.querySelector('main').textContent, /C-901|虛構專案/);
    const serviceError = await mount(html, { error: 'PRIVATE_SERVICE_ERROR' }, { http: true });
    assert.equal(serviceError.get('timeline-grid').hidden, true);
    assert.doesNotMatch(serviceError.document.querySelector('main').textContent, /PRIVATE_SERVICE_ERROR/);
  }
});

test('both Pages views unfold D stacks before opening individual authorized details and keep single D cases directly actionable', async () => {
  for (const teamspace of [false, true]) {
    const source = teamspace ? sample() : createPreviewPayload(new Date('2026-12-21T04:00:00Z'));
    const base = { ...source.projects[0], start: '2026-12-20', end: '2026-12-30', correctionStart: '', correctionEnd: '', workspaceIds: ['D'], workspaceUnits: { D: 1 }, pendingReasons: [], followUp: [] };
    source.projects = [
      { ...base, id: 'O-981', ...(teamspace ? { name: '虛構堆疊專案甲', customer: '虛構同一客戶' } : {}), deliveryGoal: '中性第一項交付目標' },
      { ...base, id: 'O-982', ...(teamspace ? { name: '虛構堆疊專案乙', customer: '虛構同一客戶' } : {}), deliveryGoal: '中性第二項交付目標' },
      { ...base, id: 'O-983', ...(teamspace ? { name: '虛構單獨專案' } : {}), start: '2027-01-12', end: '2027-01-16', deliveryGoal: '中性單獨交付目標' },
    ];
    const original = JSON.stringify(source);
    const url = teamspace ? DIRECT_TEAMSPACE_URL : DIRECT_PUBLIC_URL;
    const html = await (teamspace ? renderTeamspaceEntry(url) : renderPublicEntry(url));
    const page = await mount(html, source, { http: true, width: 212 });
    const addFocus = (node) => { node.focus = () => { page.document.activeElement = node; }; return node; };
    const createElement = page.document.createElement;
    page.document.createElement = (...args) => addFocus(createElement(...args));
    page.document.querySelectorAll('button').forEach(addFocus);
    const canvas = page.get('timeline-canvas');
    let dialog;
    const toggles = () => canvas.querySelectorAll('.project-stack-toggle');
    const cards = () => canvas.querySelectorAll('.project-card').filter((card) => !card.classList.contains('project-stack-toggle'));
    assert.equal(toggles().length, 1);
    assert.equal(toggles()[0].getAttribute('aria-expanded'), 'false');
    assert.match(toggles()[0].getAttribute('aria-label'), /^展開 2 個專案(?: ·|$)/);
    assert.deepEqual(cards().map((card) => card.getAttribute('data-project-id')), ['O-983']);
    if (!teamspace) assert.doesNotMatch(canvas.textContent, /虛構堆疊專案|虛構同一客戶/);
    await toggles()[0].click();
    assert.equal(page.document.getElementById('project-details')?.open ?? false, false);
    assert.equal(toggles()[0].getAttribute('aria-expanded'), 'true');
    for (const project of source.projects.slice(0, 2)) {
      const card = cards().find((item) => item.getAttribute('data-project-id') === project.id);
      assert.ok(card, project.id);
      if (teamspace) assert.ok(card.textContent.includes(project.name));
      await card.click();
      dialog = page.get('project-details');
      assert.equal(dialog.open, true);
      assert.ok(dialog.textContent.includes(project.deliveryGoal));
      assert.ok(page.get('project-details-title').textContent.includes(teamspace ? project.name : project.id));
      assert.equal(dialog.querySelectorAll('.project-fields')[0].querySelectorAll('dt').length, teamspace ? 9 : 6);
      for (const field of teamspace ? INTERNAL_PROJECT_FIELDS : ['owner', 'status', 'deliveryGoal', 'notes', 'deliverySteps']) assert.ok(dialog.textContent.includes(project[field]), field);
      assert.equal(dialog.querySelectorAll('img').length, 0);
      assert.equal(dialog.querySelectorAll('script').length, 0);
      await page.click('close-project-details');
      assert.equal(dialog.open, false);
    }
    await page.click('language-toggle');
    assert.equal(toggles()[0].getAttribute('aria-expanded'), 'true');
    assert.equal(toggles()[0].getAttribute('aria-label'), 'Collapse 2 projects');
    page.resize(900);
    assert.equal(toggles()[0].getAttribute('aria-expanded'), 'true');
    await toggles()[0].click();
    assert.equal(toggles()[0].getAttribute('aria-expanded'), 'false');
    assert.match(toggles()[0].getAttribute('aria-label'), /^Expand 2 projects(?: ·|$)/);
    assert.equal(page.document.activeElement, toggles()[0]);
    assert.equal(dialog.open, false);
    const single = cards().find((item) => item.getAttribute('data-project-id') === 'O-983');
    assert.ok(single);
    await single.click();
    assert.equal(dialog.open, true, 'an unstacked D project opens details on its first activation');
    assert.ok(dialog.textContent.includes('中性單獨交付目標'));
    assert.equal(page.calls.length, 1);
    assertAnonymousRequest(page.calls[0], url);
    assert.deepEqual([...page.preferences.keys()], ['pm-studio-language']);
    assert.equal(JSON.stringify(source), original);
    const reopened = await mount(html, source, { http: true });
    assert.equal(reopened.get('timeline-canvas').querySelector('.project-stack-toggle').getAttribute('aria-expanded'), 'false');
  }
});
