import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { Script, createContext } from 'node:vm';
import { buildGoogleUi } from '../../scripts/build-google-ui.mjs';
import { createPreviewPayload } from '../../scripts/serve-google-preview.mjs';

async function fixture(t) {
  const directory = await mkdtemp(resolve(tmpdir(), 'pm-single-browser-'));
  t.after(async () => { if (!resolve(directory).startsWith(resolve(tmpdir())+sep)) throw new Error('Unsafe cleanup'); await rm(directory,{recursive:true,force:true}); });
  return (await buildGoogleUi({outputDir:directory,packageDir:null}))[0].html;
}
function browserDocument(html) {
  const elements = new Map();
  function element(tag = 'div') {
    const node = { tagName: tag.toUpperCase(), children: [], parentNode: null, style: { setProperty(name, value) { this[name] = String(value); } }, dataset: {}, attributes: {}, listeners: new Map(),
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
    createElementNS(namespace, tag) { return element(tag); },
    querySelector(selector) { return container.querySelector(selector); },
    querySelectorAll(selector) { return container.querySelectorAll(selector); },
  };
  Object.defineProperty(document, 'title', {
    get() { return container.querySelector('title').textContent; },
    set(value) { container.querySelector('title').textContent = value; },
  });
  return { document, elements };
}

async function mount(html, value, { preferences = new Map(), blockedStorage = false, failInitially = false, width = 900, measureHidden = false, now = value.syncedAt } = {}) {
  const { document, elements } = browserDocument(html);
  const viewport = elements.get('timeline-viewport');
  Object.defineProperty(viewport, 'clientWidth', { get() { return measureHidden && elements.get('timeline-grid').hidden ? 0 : width; } });
  let onResize, onDayRefresh;
  let clock = new Date(now).getTime();
  class BrowserDate extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } }
  let fail=failInitially, payload=value;
  const calls=[];
  const runner={withSuccessHandler(fn){this.ok=fn;return this;},withFailureHandler(fn){this.bad=fn;return this;},getTimeline(...args){calls.push(args);if(fail)this.bad(new Error('PRIVATE_SOURCE_ID'));else this.ok(payload);}};
  const context=createContext({document,Intl,Date:BrowserDate,Map,Set,console,google:{script:{run:runner}},
    localStorage:{getItem(key){if(blockedStorage)throw new Error('blocked');return preferences.get(key)||null;},setItem(key,value){if(blockedStorage)throw new Error('blocked');preferences.set(key,value);}},
    ResizeObserver:class{constructor(callback){onResize=callback;}observe(){}},
    setInterval(callback, interval) { assert.equal(interval, 60000); onDayRefresh = callback; },
  });
  for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) await new Script(match[1]).runInContext(context);
  const get=(id)=>{const node=elements.get(id);assert.ok(node,id);return node;};
  return {document,get,calls,preferences,fail(value){fail=value;},payload(value){payload=value;},click(id){return get(id).click();},
    advanceClock(value) { clock = new Date(value).getTime(); onDayRefresh(); },
    resize(nextWidth, clampBeforeObserver = false) {
      width = nextWidth;
      if (clampBeforeObserver) {
        viewport.scrollLeft = Math.min(viewport.scrollLeft, Math.max(0, parseFloat(get('timeline-canvas').style.width) - width));
        viewport.listeners.get('scroll')();
      }
      onResize();
    },
  };
}
const sample=()=>createPreviewPayload(new Date('2026-12-21T04:00:00Z'));

test('single UI loads cross-year work and corrections, and shows every incomplete case as pending', async(t)=>{
  const page=await mount(await fixture(t),sample());
  assert.equal(page.get('timeline-grid').hidden,false);
  assert.equal(page.get('retry').hidden,true);
  assert.equal(page.get('pending-section').hidden,false);
  assert.equal(page.get('pending-count').textContent,'3');
  assert.match(page.get('pending-projects').textContent,/C-904/);
  assert.match(page.get('pending-projects').textContent,/C-905/);
  assert.match(page.get('pending-projects').textContent,/BG-902/);
  assert.ok(page.get('timeline-canvas').querySelectorAll('.correction').length);
  assert.match(page.get('timeline-canvas').textContent,/2027/);
  assert.equal(page.document.getElementById('search'),null);
  assert.equal(page.document.getElementById('assignment-form'),null);
  assert.deepEqual(page.calls,[[]]);
});
test('language changes and persists without rereading, renaming project IDs, or losing scroll',async(t)=>{
  const value=sample(), original=JSON.stringify(value);
  const html=await fixture(t), page=await mount(html,value);
  page.get('timeline-viewport').scrollLeft=360;
  page.get('timeline-viewport').listeners.get('scroll')();
  const range=page.get('date-range').textContent;
  await page.click('language-toggle');
  assert.equal(page.document.documentElement.lang,'en');
  assert.equal(page.get('today-button').textContent,'Today');
  assert.equal(page.get('language-toggle').textContent,'繁體中文');
  assert.equal(page.preferences.get('pm-studio-language'),'en');
  assert.equal(page.get('timeline-viewport').scrollLeft,360);
  assert.equal(page.get('date-range').textContent,range);
  assert.doesNotMatch(page.get('workspace-labels').textContent,/[\u3400-\u9fff]/u);
  assert.doesNotMatch(page.get('pending-projects').textContent,/[\u3400-\u9fff]/u);
  assert.match(page.get('timeline-canvas').textContent,/C-901/);
  assert.match(page.get('timeline-canvas').textContent,/TEST-01/);
  assert.match(page.get('sync-status').textContent,/21\/12\/2026, 12:00/);
  assert.equal(page.calls.length,1);
  assert.equal(JSON.stringify(value),original);
  const reopened=await mount(html,value,{preferences:page.preferences});
  assert.equal(reopened.document.documentElement.lang,'en');
  const blocked=await mount(html,value,{blockedStorage:true});
  await blocked.click('language-toggle');
  assert.equal(blocked.document.documentElement.lang,'en');
});
test('date navigation works at narrow widths and across years; Today restores the initial range',async(t)=>{
  const page=await mount(await fixture(t),sample(),{width:240});
  const initial=page.get('date-range').textContent;
  assert.equal(initial,'2026-12-17 — 2027-01-27');
  await page.click('next');
  assert.equal(page.get('date-range').textContent,'2027-01-21 — 2027-03-03');
  await page.click('previous');
  assert.equal(page.get('date-range').textContent,initial);
  for(let i=0;i<12;i++)await page.click('previous');
  assert.match(page.get('date-range').textContent,/2025/);
  await page.click('today-button');
  assert.equal(page.get('date-range').textContent,initial);
  assert.equal(page.calls.length,1);
});
test('desktop fits twelve weeks; first render measures the visible viewport and uses Monday ticks', async(t) => {
  const html = await fixture(t);
  const desktop = await mount(html, sample(), { width: 900, measureHidden: true });
  assert.equal(desktop.get('date-range').textContent, '2026-12-17 — 2027-03-10');
  assert.ok(Math.abs(parseFloat(desktop.get('timeline-canvas').style.width) - 900 * 210 / 84) < 1e-9);
  await desktop.click('next');
  assert.equal(desktop.get('date-range').textContent, '2027-03-04 — 2027-05-26');
  for (const tick of desktop.get('timeline-canvas').querySelectorAll('.day-label')) assert.equal(new Date(tick.dataset.date + 'T00:00:00Z').getUTCDay(), 1);
  for (const month of desktop.get('timeline-canvas').querySelectorAll('.month-label')) assert.match(month.getAttribute('title'), /2027/);
  const narrow = await mount(html, sample(), { width: 212, measureHidden: true });
  assert.equal(narrow.get('date-range').textContent, '2026-12-17 — 2027-01-27');
  assert.ok(Math.abs(parseFloat(narrow.get('timeline-canvas').style.width) - 212 * 5) < 1e-9);
});
test('resizing preserves the left date and fraction even when the browser clamps old right-edge scroll', async(t) => {
  const page = await mount(await fixture(t), sample(), { width: 240 });
  const viewport = page.get('timeline-viewport');
  viewport.scrollLeft = 167.25 * 240 / 42;
  viewport.listeners.get('scroll')();
  const before = page.get('date-range').textContent.split(' — ')[0];
  page.resize(900, true);
  assert.equal(page.get('date-range').textContent.split(' — ')[0], before);
  assert.ok(Math.abs(viewport.scrollLeft / (900 / 84) - .25) < 1e-9);
  const canvasChild = page.get('timeline-canvas').children[0];
  page.resize(900);
  assert.equal(page.get('timeline-canvas').children[0], canvasChild, 'unchanged width must not rebuild');
  page.resize(212, true);
  assert.equal(page.get('date-range').textContent.split(' — ')[0], before);
  assert.ok(Math.abs(viewport.scrollLeft / (212 / 42) - .25) < 1e-9);
  page.resize(350, true);
  assert.equal(page.get('date-range').textContent.split(' — ')[0], before);
  assert.ok(Math.abs(viewport.scrollLeft / (350 / 42) - .25) < 1e-9);
  assert.equal(page.get('pending-count').textContent, '3');
  assert.equal(page.calls.length, 1);
});
test('single-day bars are native keyboard buttons with full details on activation without duration expansion', async(t) => {
  const value = sample();
  value.projects = [{ ...value.projects[0], start: value.today, end: value.today, correctionStart: '', correctionEnd: '', workspaceIds: ['A'], workspaceUnits: { A: 1 }, pendingReasons: [] }];
  const page = await mount(await fixture(t), value, { width: 212 });
  const card = page.get('timeline-canvas').querySelector('.project-card');
  const width = parseFloat(card.style.width);
  assert.equal(card.tagName, 'BUTTON');
  assert.equal(card.getAttribute('type'), 'button');
  assert.equal(card.getAttribute('tabindex'), '0');
  assert.ok(width > 0 && width <= 212 / 42);
  assert.match(card.getAttribute('aria-label'), /C-901.*2026-12-21 → 2026-12-21/);
  await card.click();
  assert.equal(page.get('project-details').open, true);
  assert.match(page.get('project-details').textContent, /C-901/);
  assert.match(page.get('project-details').textContent, /TEST-01/);
  assert.match(page.get('project-details').textContent, /2026-12-21 → 2026-12-21/);
  assert.equal(parseFloat(card.style.width), width);
  await page.click('close-project-details');
  assert.equal(page.get('project-details').open, false);
});
test('public details show the five authorized text fields and client type without project/customer names or contact/assignee rows', async(t) => {
  const html = await fixture(t), value = sample();
  const project = { ...value.projects[0], notes: '<script>FICTIONAL_TEXT</script>\nSecond line',
    start: value.today, end: value.today, correctionStart: '', correctionEnd: '', workspaceIds: ['A'], workspaceUnits: { A: 1 }, pendingReasons: [] };
  value.projects = [project];
  const page = await mount(html, value, { width: 212 });
  const card = page.get('timeline-canvas').querySelector('.project-card');
  assert.match(card.textContent, /C-901製作客戶 TEST-01 · VTuber個人/);
  assert.doesNotMatch(card.textContent, /Fictional project|Fictional client/);
  await card.click();
  const dialog = page.get('project-details');
  assert.equal(page.get('project-details-title').textContent, 'C-901');
  assert.match(dialog.textContent, /客戶 TEST-01客戶類型VTuber個人專案主管/);
  for (const field of ['owner', 'status', 'deliveryGoal', 'notes', 'deliverySteps']) assert.ok(dialog.textContent.includes(project[field]), field);
  assert.deepEqual(dialog.querySelectorAll('dt').map((field) => field.textContent), ['客戶類型', '專案主管', '狀態', '目前交付目標', '延長修正／補充', '交付步驟（參考）']);
  assert.equal(dialog.querySelectorAll('img,script').length, 0);
  await page.click('close-project-details');
  await page.click('language-toggle');
  await page.get('timeline-canvas').querySelector('.project-card').click();
  assert.match(dialog.textContent, /Client TEST-01Client typeIndividual VTuberProject lead/);
  assert.match(dialog.textContent, /Project lead.*Status.*Current delivery goal.*Revision \/ additional notes/);
  const pendingValue = sample();
  pendingValue.projects = [{ ...project, customerType: '', workspaceIds: [], workspaceUnits: {}, pendingReasons: ['no-workspace'] }];
  const pendingPage = await mount(html, pendingValue);
  const pending = pendingPage.get('pending-projects').querySelector('.pending-card');
  assert.match(pending.textContent, /客戶 TEST-01 · 未填/);
  await pending.querySelector('button').click();
  assert.match(pendingPage.get('project-details').textContent, /客戶類型未填/);
  assert.ok(pendingPage.get('project-details').textContent.includes(project.deliveryGoal));
  assert.deepEqual(pendingPage.calls, [[]]);
});
test('known-month bars and reservations stay on the timeline with month labels in both languages', async(t) => {
  const value = sample();
  value.projects = [
    { ...value.projects[0], start: '2026-12', end: '2027-01-31', correctionStart: '', correctionEnd: '' },
    { ...value.projects[1], scheduleKind: 'reservation', start: '2027-01', end: '2027-03', correctionStart: '', correctionEnd: '' },
  ];
  const page = await mount(await fixture(t), value);
  assert.equal(page.get('pending-section').hidden, true);
  const card = page.get('timeline-canvas').querySelector('.reservation');
  assert.equal(card.getAttribute('data-start-precision'), 'month');
  assert.match(card.getAttribute('aria-label'), /時段預約.*2027-01 （月份） → 2027-03 （月份）/);
  await card.click();
  assert.match(page.get('project-details').textContent, /時段預約.*2027-01 （月份）/);
  await page.click('close-project-details');
  await page.click('language-toggle');
  const english = page.get('timeline-canvas').querySelector('.reservation');
  assert.match(english.getAttribute('aria-label'), /Reserved period.*2027-01 \(month\)/);
  assert.equal(page.get('legend-reservation').textContent, 'Reserved period');
});
test('historic follow-up endpoints open public fixed statuses and keep a mobile touch target', async(t) => {
  const value = sample();
  value.projects = [{ ...value.projects.find((project) => project.id === 'C-907') }];
  const page = await mount(await fixture(t), value, { width: 212 });
  assert.equal(page.get('pending-section').hidden, true);
  assert.equal(page.get('timeline-canvas').querySelectorAll('.project-card').length, 0);
  assert.equal(page.get('visible-count').textContent, '目前區間 1 案');
  const endpoint = page.get('timeline-canvas').querySelector('.follow-up-endpoint');
  assert.equal(endpoint.tagName, 'BUTTON');
  assert.match(endpoint.getAttribute('aria-label'), /C-907.*客戶確認中.*待收款中/);
  assert.ok(page.get('timeline-canvas').querySelector('.clipped-start'));
  await endpoint.click();
  assert.equal(page.get('project-details').open, true);
  assert.match(page.get('project-details').textContent, /客戶確認中待收款中/);
  assert.match(page.get('project-details').textContent, /不延長製作期間/);
  await page.click('close-project-details');
  await page.click('language-toggle');
  await page.get('timeline-canvas').querySelector('.follow-up-endpoint').click();
  assert.match(page.get('project-details').textContent, /Awaiting client confirmationAwaiting payment/);
  await page.click('close-project-details');
  value.projects[0].followUp = [];
  page.payload(value);
  await page.click('retry');
  assert.equal(page.get('timeline-canvas').querySelectorAll('.follow-up-endpoint').length, 0);
  assert.equal(page.get('visible-count').textContent, '0 projects in view');
});
test('an open page advances tracking at Taipei midnight without a cloud write, reload, or viewport jump', async(t) => {
  const value = sample();
  value.projects = [{ ...value.projects.find((project) => project.id === 'C-907') }];
  const page = await mount(await fixture(t), value, { now: '2026-12-21T15:59:59Z' });
  const viewport = page.get('timeline-viewport');
  viewport.scrollLeft = 5;
  viewport.listeners.get('scroll')();
  const range = page.get('date-range').textContent;
  const before = parseFloat(page.get('timeline-canvas').querySelector('.follow-up-endpoint').style.left);
  page.advanceClock('2026-12-21T16:00:01Z');
  const after = parseFloat(page.get('timeline-canvas').querySelector('.follow-up-endpoint').style.left);
  assert.ok(Math.abs(after - before - 900 / 84) < 1e-9);
  assert.equal(page.get('date-range').textContent, range);
  assert.equal(viewport.scrollLeft, 5);
  assert.equal(page.calls.length, 1);
  const reopened = await mount(await fixture(t), value, { now: '2026-12-21T16:00:01Z' });
  assert.match(reopened.get('date-range').textContent, /^2026-12-18/);
});
test('initial service failure has no demo fallback; retry recovers and private errors never render',async(t)=>{
  const page=await mount(await fixture(t),sample(),{failInitially:true});
  assert.equal(page.get('timeline-grid').hidden,true);
  assert.equal(page.get('retry').hidden,false);
  assert.equal(page.get('previous').disabled,true);
  assert.equal(page.get('pending-section').hidden,true);
  assert.doesNotMatch(page.get('load-notice').textContent,/PRIVATE/);
  await page.click('language-toggle');
  assert.match(page.get('load-message').textContent,/Unable to load/);
  page.fail(false);
  await page.click('retry');
  assert.equal(page.get('timeline-grid').hidden,false);
  assert.equal(page.get('retry').hidden,true);
  assert.equal(page.get('load-notice').hidden,true);
  assert.equal(page.get('previous').disabled,false);
  assert.equal(page.calls.length,2);
});
test('malformed records fail closed while a valid empty schedule remains explicitly empty',async(t)=>{
  const html=await fixture(t);
  const malformed=sample();malformed.projects[0].sourceLinks='PRIVATE_SOURCE_LINK';
  const page=await mount(html,malformed);
  assert.equal(page.get('timeline-grid').hidden,true);
  assert.equal(page.get('retry').hidden,false);
  assert.doesNotMatch(page.document.querySelector('main').textContent,/PRIVATE_SOURCE_LINK/);
  const empty=sample();empty.projects=[];
  const emptyPage=await mount(html,empty,{preferences:new Map([['pm-studio-language','en']])});
  assert.equal(emptyPage.get('timeline-grid').hidden,false);
  assert.match(emptyPage.get('load-message').textContent,/No projects/);
  assert.equal(emptyPage.get('retry').hidden,true);
  assert.equal(emptyPage.get('pending-section').hidden,true);
});

function installStackFocusTracking(page) {
  const addFocus = (node) => {
    node.focus = () => { page.document.activeElement = node; };
    return node;
  };
  const createElement = page.document.createElement;
  page.document.createElement = (...args) => addFocus(createElement(...args));
  page.document.querySelectorAll('button').forEach(addFocus);
}

function assertIconOnlyStackCollapse(button, html) {
  assert.equal(button.textContent.trim(), '', 'collapse uses an icon without a visible label or count');
  assert.equal(button.querySelectorAll('svg').length, 1);
  assert.equal(button.querySelector('svg').getAttribute('aria-hidden'), 'true');
  const css = /\.stack-collapse\s*\{([^}]*)\}/.exec(html)?.[1] || '';
  assert.match(css, /(?:^|;)\s*width:\s*44px\s*;/);
  assert.match(css, /(?:^|;)\s*height:\s*44px\s*;/);
}

test('D stack expansion preserves language, scroll, resize and navigation state without storing it or folding other workspaces', async(t) => {
  const value = sample();
  const base = { ...value.projects[0], start: '2026-12-20', end: '2026-12-30', correctionStart: '', correctionEnd: '', pendingReasons: [], followUp: [] };
  const samePeriod = (id, workspace) => ({ ...base, id, workspaceIds: [workspace], workspaceUnits: { [workspace]: 1 } });
  const otherIds = ['C-971', 'C-972', 'C-973', 'C-974', 'BG-971', 'BG-972'];
  value.projects = [
    samePeriod('O-971', 'D'), samePeriod('O-972', 'D'),
    { ...samePeriod('O-973', 'D'), start: '2027-01-12', end: '2027-01-16' },
    ...otherIds.map((id, index) => samePeriod(id, ['A', 'B', 'C'][Math.floor(index / 2)])),
    { ...value.projects.find((project) => project.id === 'C-904') },
  ];
  const original = JSON.stringify(value), html = await fixture(t);
  const page = await mount(html, value);
  installStackFocusTracking(page);
  const canvas = page.get('timeline-canvas');
  const toggles = () => canvas.querySelectorAll('.project-stack-toggle');
  const normalCards = () => canvas.querySelectorAll('.project-card').filter((card) => !card.classList.contains('project-stack-toggle'));
  assert.equal(toggles().length, 1);
  let toggle = toggles()[0];
  const stackKey = toggle.getAttribute('data-stack-key');
  assert.ok(stackKey);
  assert.equal(toggle.tagName, 'BUTTON');
  assert.equal(toggle.getAttribute('type'), 'button');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.match(toggle.getAttribute('aria-label'), /^展開 2 個專案(?: ·|$)/);
  assert.equal(page.get('pending-count').textContent, '1');
  for (const id of otherIds) assert.ok(normalCards().some((card) => card.getAttribute('data-project-id') === id), id);
  assert.equal(normalCards().filter((card) => ['O-971', 'O-972'].includes(card.getAttribute('data-project-id'))).length, 0);
  const visibleCount = page.get('visible-count').textContent;
  toggle.focus();
  await toggle.click();
  assert.equal(page.document.getElementById('project-details')?.open ?? false, false, 'the first activation only unfolds the stack');
  assert.equal(toggles()[0].getAttribute('aria-expanded'), 'true');
  assert.equal(toggles()[0].getAttribute('aria-label'), '收合 2 個專案');
  assertIconOnlyStackCollapse(toggles()[0], html);
  assert.equal(normalCards().filter((card) => ['O-971', 'O-972'].includes(card.getAttribute('data-project-id'))).length, 2);
  assert.equal(page.get('visible-count').textContent, visibleCount);
  const viewport = page.get('timeline-viewport');
  viewport.scrollLeft = 24;
  viewport.listeners.get('scroll')();
  const leftDate = page.get('date-range').textContent.split(' — ')[0];
  await page.click('language-toggle');
  assert.equal(viewport.scrollLeft, 24);
  assert.equal(toggles()[0].getAttribute('aria-label'), 'Collapse 2 projects');
  assertIconOnlyStackCollapse(toggles()[0], html);
  assert.equal(toggles()[0].getAttribute('data-stack-key'), stackKey);
  assert.equal(toggles()[0].getAttribute('aria-expanded'), 'true');
  page.resize(212);
  assert.equal(page.get('date-range').textContent.split(' — ')[0], leftDate);
  assert.equal(toggles()[0].getAttribute('aria-expanded'), 'true');
  await page.click('next');
  await page.click('previous');
  assert.equal(toggles()[0].getAttribute('aria-expanded'), 'true');
  assert.equal(toggles()[0].getAttribute('data-stack-key'), stackKey);
  const pendingCount = page.get('pending-count').textContent;
  await toggles()[0].click();
  toggle = toggles()[0];
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.match(toggle.getAttribute('aria-label'), /^Expand 2 projects(?: ·|$)/);
  assert.equal(page.document.activeElement, toggle, 'collapsing restores focus to the replacement stack button');
  assert.equal(page.document.getElementById('project-details')?.open ?? false, false);
  assert.equal(page.get('pending-count').textContent, pendingCount);
  for (const id of otherIds) assert.ok(normalCards().some((card) => card.getAttribute('data-project-id') === id), id);
  assert.deepEqual([...page.preferences.keys()], ['pm-studio-language']);
  assert.equal(JSON.stringify(value), original);
  assert.equal(page.calls.length, 1);
  await toggle.click();
  const reopened = await mount(html, value, { preferences: page.preferences });
  assert.equal(reopened.get('timeline-canvas').querySelector('.project-stack-toggle').getAttribute('aria-expanded'), 'false', 'a fresh page starts collapsed');
});
