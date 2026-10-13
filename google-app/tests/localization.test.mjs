import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script, createContext } from 'node:vm';
import { buildPublicSite } from '../../scripts/build-public-site.mjs';
import { buildGoogleUi } from '../../scripts/build-google-ui.mjs';
import { WORKSPACES } from '../../scripts/timeline-core.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const local = resolve(root, 'local');
const approvedProject = () => ({ alias: '專案 001', goal: '角色與場景製作', start: '2026-10-12', end: '2027-01-15', workspaceIds: ['B', 'C'], workspaceUnits: { B: 3, C: 2 } });
const snapshot = (projects = [approvedProject()]) => ({ schemaVersion: 1, publishedAt: '2026-10-12T04:00:00.000Z', projects });

async function fixture(t, value = snapshot()) {
  await mkdir(local, { recursive: true });
  const directory = await mkdtemp(resolve(local, 'localization-test-'));
  t.after(async () => {
    if (!resolve(directory).startsWith(local + sep)) throw new Error('Unsafe temporary cleanup path.');
    await rm(directory, { recursive: true, force: true });
  });
  const snapshotPath = resolve(directory, 'snapshot.json');
  const outputDir = resolve(directory, 'site');
  await writeFile(snapshotPath, JSON.stringify(value));
  await buildPublicSite({ snapshotPath, outputDir });
  return { html: await readFile(resolve(outputDir, 'index.html'), 'utf8'), value, snapshotPath, outputDir, directory };
}

// Read the generated template so missing controls and incorrect placement fail,
// while running its actual scripts without adding a browser dependency.
function browserDocument(html) {
  const elements = new Map();
  function element(tag = 'div') {
    const node = { tagName: tag.toUpperCase(), children: [], parentNode: null, style: {}, dataset: {}, attributes: {}, listeners: new Map(),
      hidden: false, disabled: false, open: false, value: '', scrollLeft: 0, clientWidth: 900, _text: '',
      append(...children) { for (const child of children) { child.parentNode = this; this.children.push(child); } },
      replaceChildren(...children) { this._text = ''; this.children = []; this.append(...children); },
      setAttribute(name, value) {
        this.attributes[name] = String(value);
        if (name === 'id') { this.id = String(value); elements.set(this.id, this); }
        if (name === 'class') this.className = String(value);
        if (name === 'lang') this.lang = String(value);
        if (name === 'placeholder') this.placeholder = String(value);
        if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value);
      },
      getAttribute(name) { return this.attributes[name] ?? null; },
      addEventListener(name, callback) { this.listeners.set(name, callback); },
      async click() { return await this.listeners.get('click')?.({ target: this }); },
      querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
      querySelectorAll(selector) { return descendants(this).filter((child) => selector.split(',').some((part) => matches(child, part.trim()))); },
      getBoundingClientRect() { return { left: 0, right: 900, top: 0, bottom: 500 }; },
      showModal() { this.open = true; }, close() { this.open = false; },
    };
    Object.defineProperty(node, 'textContent', {
      get() { return this._text + this.children.map((child) => child.textContent).join(''); },
      set(value) { this._text = String(value); this.children = []; },
    });
    node.classList = { toggle(name, force) {
      const classes = new Set((node.className || '').split(' ').filter(Boolean));
      const add = force ?? !classes.has(name);
      if (add) classes.add(name); else classes.delete(name);
      node.className = [...classes].join(' '); return add;
    }, contains(name) { return (node.className || '').split(' ').includes(name); } };
    return node;
  }
  function descendants(node) { return node.children.flatMap((child) => [child, ...descendants(child)]); }
  function matches(node, selector) {
    if (selector.startsWith('#')) return node.id === selector.slice(1);
    if (selector.startsWith('.')) return node.classList.contains(selector.slice(1));
    const attribute = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
    if (attribute) return node.getAttribute(attribute[1]) !== null && (attribute[2] === undefined || node.getAttribute(attribute[1]) === attribute[2]);
    return node.tagName.toLowerCase() === selector.toLowerCase();
  }
  const container = element('document');
  const stack = [container];
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
  const document = { documentElement: container.querySelector('html'),
    getElementById(id) { return elements.get(id) || null; },
    createElement: element,
    querySelector(selector) { return container.querySelector(selector); },
    querySelectorAll(selector) { return container.querySelectorAll(selector); },
  };
  Object.defineProperty(document, 'title', {
    get() { return container.querySelector('title').textContent; },
    set(value) { container.querySelector('title').textContent = value; },
  });
  return { document, elements };
}

async function mount(html, value, { preferences = new Map(), blockedStorage = false, failInitially = false, googlePayload } = {}) {
  const { document, elements } = browserDocument(html);
  let fail = failInitially;
  const calls = [];
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-10-13T04:00:00Z'])); } }
  const runner = { withSuccessHandler(handler) { this.success = handler; return this; }, withFailureHandler(handler) { this.failure = handler; return this; },
    getTimeline(...args) { calls.push(args); if (fail) this.failure(new Error('Offline')); else this.success(googlePayload); },
  };
  const context = createContext({ document, Intl, Date: FixedDate, Map, Set, console,
    fetch: async (...args) => { calls.push(args); if (fail) throw new Error('Offline'); return { ok: true, json: async () => value }; },
    google: { script: { run: runner } },
    localStorage: { getItem(key) { if (blockedStorage) throw new Error('Storage blocked'); return preferences.get(key) ?? null; },
      setItem(key, saved) { if (blockedStorage) throw new Error('Storage blocked'); preferences.set(key, saved); } },
    ResizeObserver: class { observe() {} }, requestAnimationFrame() { return 1; }, cancelAnimationFrame() {}, setInterval() {},
  });
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) await new Script(match[1]).runInContext(context);
  const get = (id) => { const node = elements.get(id); assert.ok(node, `Generated page must contain #${id}`); return node; };
  return { document, get, calls, preferences, fail(value) { fail = value; },
    click(id) { return get(id).click(); },
    input(id, value) { get(id).value = value; return get(id).listeners.get('input')({ target: get(id) }); },
  };
}

test('public language control is in the header and translates chrome without changing approved data', async (t) => {
  const built = await fixture(t);
  const original = JSON.stringify(built.value);
  const page = await mount(built.html, built.value);
  assert.equal(page.document.documentElement.lang, 'zh-Hant');
  assert.equal(page.get('today-button').textContent, '今天');
  assert.equal(page.get('language-toggle').textContent, 'English');
  assert.ok(page.get('language-toggle').parentNode.classList.contains('header-actions'));
  await page.click('language-toggle');
  assert.equal(page.document.documentElement.lang, 'en');
  assert.equal(page.preferences.get('pm-studio-language'), 'en');
  assert.equal(page.get('language-toggle').textContent, '繁體中文');
  assert.equal(page.get('language-toggle').getAttribute('aria-label'), '切換至繁體中文');
  assert.equal(page.get('today-button').textContent, 'Today');
  assert.equal(page.get('month-view').textContent, 'Month');
  assert.equal(page.get('week-view').textContent, 'Week');
  assert.equal(page.get('refresh').textContent, 'Refresh');
  assert.match(page.get('search').placeholder, /search/i);
  assert.match(page.get('search').getAttribute('aria-label'), /search/i);
  assert.match(page.document.title, /PM Studio/);
  assert.doesNotMatch(page.document.title, /[\u3400-\u9fff]/u);
  assert.doesNotMatch(page.document.querySelector('h1').textContent, /[\u3400-\u9fff]/u);
  assert.doesNotMatch(page.get('mode-description').textContent, /[\u3400-\u9fff]/u);
  assert.doesNotMatch(page.document.querySelector('.page-footer').textContent, /[\u3400-\u9fff]/u);
  assert.doesNotMatch(page.get('workspace-labels').textContent, /[\u3400-\u9fff]/u);
  assert.match(page.get('visible-count').textContent, /1/);
  assert.doesNotMatch(page.get('visible-count').textContent, /[\u3400-\u9fff]/u);
  const card = page.get('timeline-canvas').querySelector('.project-card');
  assert.ok(card);
  assert.equal(card.querySelector('.card-goal').textContent, built.value.projects[0].goal);
  assert.match(card.querySelector('.card-heading').textContent, /專案 001/);
  assert.doesNotMatch(card.querySelector('.cross-label').textContent, /[\u3400-\u9fff]/u);
  assert.equal(page.calls.length, 1, 'Language switch must not re-read or write the schedule');
  assert.equal(JSON.stringify(built.value), original);
  assert.equal(await readFile(built.snapshotPath, 'utf8'), original);
  assert.deepEqual(JSON.parse(await readFile(resolve(built.outputDir, 'data/schedule.json'), 'utf8')), built.value);
});

test('language preference survives reopening and a blocked store still permits switching', async (t) => {
  const built = await fixture(t);
  const preferences = new Map([['pm-studio-language', 'en']]);
  let page = await mount(built.html, built.value, { preferences });
  assert.equal(page.document.documentElement.lang, 'en');
  assert.equal(page.get('today-button').textContent, 'Today');
  await page.click('language-toggle');
  assert.equal(preferences.get('pm-studio-language'), 'zh-Hant');
  page = await mount(built.html, built.value, { preferences });
  assert.equal(page.document.documentElement.lang, 'zh-Hant');
  assert.equal(page.get('today-button').textContent, '今天');
  page = await mount(built.html, built.value, { preferences: new Map([['pm-studio-language', 'unsupported']]) });
  assert.equal(page.document.documentElement.lang, 'zh-Hant');
  page = await mount(built.html, built.value, { blockedStorage: true });
  await page.click('language-toggle');
  assert.equal(page.document.documentElement.lang, 'en');
  assert.equal(page.get('today-button').textContent, 'Today');
  await page.click('language-toggle');
  assert.equal(page.document.documentElement.lang, 'zh-Hant');
});

test('switching language preserves search, navigation, scroll, zoom, and an open project dialog', async (t) => {
  const built = await fixture(t);
  const page = await mount(built.html, built.value);
  await page.click('week-view');
  await page.click('past-toggle');
  page.input('search', built.value.projects[0].goal);
  page.get('timeline-viewport').scrollLeft = 360;
  page.get('timeline-viewport').listeners.get('scroll')();
  const range = page.get('date-range').textContent;
  await page.get('timeline-canvas').querySelector('.project-card').click();
  assert.equal(page.get('project-dialog').open, true);
  await page.click('language-toggle');
  assert.equal(page.get('search').value, built.value.projects[0].goal);
  assert.equal(page.get('timeline-viewport').scrollLeft, 360);
  assert.equal(page.get('date-range').textContent, range);
  assert.equal(page.get('week-view').getAttribute('aria-pressed'), 'true');
  assert.equal(page.get('past-toggle').getAttribute('aria-pressed'), 'true');
  assert.doesNotMatch(page.get('past-toggle').textContent, /[\u3400-\u9fff]/u);
  assert.equal(page.get('project-dialog').open, true);
  assert.equal(page.get('detail-title').textContent, built.value.projects[0].alias);
  const labels = page.get('detail-content').querySelectorAll('.detail-label').map((node) => node.textContent);
  assert.deepEqual(labels, ['Delivery goal', 'Schedule dates', 'Workspace']);
  assert.equal(page.get('detail-content').querySelector('.detail-value').textContent, built.value.projects[0].goal);
  assert.match(page.get('close-dialog').getAttribute('aria-label'), /close/i);
  const dayLabels = page.get('timeline-canvas').querySelectorAll('.day-label').map((node) => node.textContent);
  assert.ok(dayLabels.some((label) => /Sun|Mon|Tue|Wed|Thu|Fri|Sat/.test(label)));
  assert.ok(dayLabels.every((label) => !/[日一二三四五六]/u.test(label)));
  assert.equal(page.calls.length, 1);
  await page.click('language-toggle');
  assert.equal(page.get('project-dialog').open, true);
  assert.equal(page.get('detail-content').querySelector('.detail-label').textContent, '交付目標');
  assert.equal(page.get('timeline-viewport').scrollLeft, 360);
});

test('theme controls follow the selected language and keep theme and language preferences independent', async (t) => {
  const built = await fixture(t);
  const page = await mount(built.html, built.value, { preferences: new Map([['pm-studio-language', 'en']]) });
  assert.equal(page.document.documentElement.dataset.theme, 'dark');
  assert.equal(page.get('theme-toggle').textContent, 'Light mode');
  await page.click('theme-toggle');
  assert.equal(page.document.documentElement.dataset.theme, 'light');
  assert.equal(page.get('theme-toggle').textContent, 'Dark mode');
  assert.equal(page.get('theme-toggle').getAttribute('aria-label'), 'Dark mode');
  assert.equal(page.preferences.get('pm-studio-theme'), 'light');
  assert.equal(page.preferences.get('pm-studio-language'), 'en');
  await page.click('language-toggle');
  assert.equal(page.get('theme-toggle').textContent, '切換暗色');
  assert.equal(page.document.documentElement.dataset.theme, 'light');
  await page.click('language-toggle');
  assert.equal(page.get('theme-toggle').textContent, 'Dark mode');
  assert.equal(page.document.documentElement.dataset.theme, 'light');
});

test('English empty, failed-refresh, previous-publication, and retry notices remain accurate when language changes', async (t) => {
  const built = await fixture(t, snapshot([]));
  const page = await mount(built.html, built.value, { preferences: new Map([['pm-studio-language', 'en']]) });
  assert.match(page.get('notification').textContent, /no .*published/i);
  assert.doesNotMatch(page.get('notification').textContent, /[\u3400-\u9fff]/u);
  assert.match(page.get('sync-status').textContent, /last published/i);
  assert.match(page.get('sync-status').textContent, /2026-10-12 12:00/);
  page.fail(true);
  await page.click('refresh');
  assert.match(page.get('sync-status').textContent, /failed.*previous/i);
  assert.match(page.get('notification').textContent, /last successfully loaded|previous/i);
  assert.equal(page.get('notification').classList.contains('error'), true);
  await page.click('language-toggle');
  assert.match(page.get('sync-status').textContent, /^讀取失敗 · 上次發布/);
  assert.match(page.get('notification').textContent, /上次成功讀取的資料/);
  await page.click('week-view');
  await page.click('language-toggle');
  assert.match(page.get('sync-status').textContent, /failed.*previous/i);
  assert.match(page.get('notification').textContent, /last successfully loaded|previous/i);
  assert.equal(page.calls.length, 2);
  page.fail(false);
  await page.click('refresh');
  assert.match(page.get('sync-status').textContent, /last published/i);
  assert.match(page.get('notification').textContent, /no .*published/i);
  assert.equal(page.get('notification').classList.contains('error'), false);
  assert.equal(page.get('refresh').disabled, false);
  const initialFailure = await mount(built.html, built.value, { failInitially: true, preferences: new Map([['pm-studio-language', 'en']]) });
  assert.doesNotMatch(initialFailure.get('notification').textContent, /[\u3400-\u9fff]/u);
  assert.doesNotMatch(initialFailure.get('sync-status').textContent, /[\u3400-\u9fff]/u);
});

test('the independent public Apps Script bundle also switches language using only its read bridge', async (t) => {
  const built = await fixture(t);
  const bundles = await buildGoogleUi({ outputDir: resolve(built.directory, 'google'), packageDir: null, views: ['public'] });
  const googlePayload = { mode: 'public', today: '2026-10-13', syncedAt: built.value.publishedAt,
    projects: [...built.value.projects, { ...approvedProject(), alias: '專案 002', start: '2026-11', end: '', workspaceIds: [], workspaceUnits: {} }],
    workspaces: WORKSPACES, permissions: { canEditLayout: false } };
  const page = await mount(bundles[0].html, built.value, { googlePayload });
  await page.click('language-toggle');
  assert.equal(page.document.documentElement.lang, 'en');
  assert.equal(page.get('today-button').textContent, 'Today');
  assert.doesNotMatch(page.get('workspace-labels').textContent, /[\u3400-\u9fff]/u);
  assert.equal(page.get('pending-section').hidden, false);
  assert.doesNotMatch(page.get('pending-count').textContent, /[\u3400-\u9fff]/u);
  assert.doesNotMatch(page.get('pending-projects').querySelector('.pending-meta').textContent, /[\u3400-\u9fff]/u);
  assert.match(page.get('pending-projects').querySelector('.pending-meta').textContent, /2026-11/);
  assert.deepEqual(page.calls, [[]]);
  assert.equal(page.document.getElementById('assignment-form'), null);
  assert.doesNotMatch(bundles[0].html, /saveLayout|publishApprovedSnapshot|sourceUrl/);
});
