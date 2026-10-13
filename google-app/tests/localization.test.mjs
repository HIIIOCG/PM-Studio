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

async function mount(html, value, { preferences = new Map(), blockedStorage = false, failInitially = false, width = 900, measureHidden = false } = {}) {
  const { document, elements } = browserDocument(html);
  const viewport = elements.get('timeline-viewport');
  Object.defineProperty(viewport, 'clientWidth', { get() { return measureHidden && elements.get('timeline-grid').hidden ? 0 : width; } });
  let onResize;
  let fail=failInitially, payload=value;
  const calls=[];
  const runner={withSuccessHandler(fn){this.ok=fn;return this;},withFailureHandler(fn){this.bad=fn;return this;},getTimeline(...args){calls.push(args);if(fail)this.bad(new Error('PRIVATE_SOURCE_ID'));else this.ok(payload);}};
  const context=createContext({document,Intl,Date,Map,Set,console,google:{script:{run:runner}},
    localStorage:{getItem(key){if(blockedStorage)throw new Error('blocked');return preferences.get(key)||null;},setItem(key,value){if(blockedStorage)throw new Error('blocked');preferences.set(key,value);}},
    ResizeObserver:class{constructor(callback){onResize=callback;}observe(){}},
  });
  for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) await new Script(match[1]).runInContext(context);
  const get=(id)=>{const node=elements.get(id);assert.ok(node,id);return node;};
  return {document,get,calls,preferences,fail(value){fail=value;},payload(value){payload=value;},click(id){return get(id).click();},
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
  const malformed=sample();malformed.projects[0].name='PRIVATE_NAME';
  const page=await mount(html,malformed);
  assert.equal(page.get('timeline-grid').hidden,true);
  assert.equal(page.get('retry').hidden,false);
  assert.doesNotMatch(page.document.querySelector('main').textContent,/PRIVATE_NAME/);
  const empty=sample();empty.projects=[];
  const emptyPage=await mount(html,empty,{preferences:new Map([['pm-studio-language','en']])});
  assert.equal(emptyPage.get('timeline-grid').hidden,false);
  assert.match(emptyPage.get('load-message').textContent,/No projects/);
  assert.equal(emptyPage.get('retry').hidden,true);
  assert.equal(emptyPage.get('pending-section').hidden,true);
});
