import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceHelp } from '../../web/dist/workspace-help.mjs';
import { neutralRefractionGeometry, sampleNeutralRefraction, createNeutralDisplacementPixels } from '../../web/dist/neutral-refraction.mjs';

function helpPage() {
  function node(tag) {
    const attributes = new Map();
    const element = {
      tagName:tag, children:[], open:false, _text:'', listeners:new Map(),
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this._text = ''; this.children = children; },
      setAttribute(name, value) { attributes.set(name,String(value)); },
      getAttribute(name) { return attributes.get(name) ?? null; },
      addEventListener(name, callback) { const handlers = this.listeners.get(name) || []; handlers.push(callback); this.listeners.set(name, handlers); },
      fire(name, values = {}) { for (const callback of this.listeners.get(name) || []) callback(values); },
      showModal() { this.open = true; },
      close() { this.open = false; },
    };
    Object.defineProperty(element,'textContent',{ get() { return this._text + this.children.map(child => child.textContent).join(''); }, set(value) { this._text = String(value); this.children = []; } });
    Object.defineProperty(element,'innerHTML',{ set() { throw new Error('Workspace information must render as plain text.'); } });
    return element;
  }
  const main = node('main');
  const doc = { createElement:node, querySelector:selector => selector === 'main' ? main : null };
  let language = 'zh-Hant';
  const help = createWorkspaceHelp({ doc, getLanguage:() => language });
  function render(id) {
    const label = node('div');
    help.render(label,id);
    return { label, button:label.children[0] };
  }
  return { main, render, help, get dialog() { return main.children[0]; }, language:value => { language = value; } };
}

test('workspace dialogs show the authorized manager, project types and capacity as plain text in either language', () => {
  const page = helpPage();
  const chinese = [
    ['COOKRICE','3D人物角色模型','2組+'],
    ['COOKRICE','3D人物角色模型','2組+'],
    ['COOKRICE','角色、場景及其他 3D 模型','依案件安排'],
    ['COCO','遊戲 CT 美術外包','依案件安排'],
  ];
  for (const [index,id] of ['A','B','C','D'].entries()) {
    const { button } = page.render(id);
    assert.equal(button.tagName,'button');
    assert.equal(button.getAttribute('type'),'button');
    assert.equal(button.getAttribute('aria-haspopup'),'dialog');
    assert.equal(button.getAttribute('aria-controls'),'workspace-details');
    button.fire('click');
    const dialog = page.dialog;
    assert.equal(dialog.getAttribute('aria-labelledby'),'workspace-details-title');
    assert.equal(dialog.children[1].textContent,'團隊工作區 '+id);
    const fields = dialog.children[2].children;
    assert.deepEqual(fields.filter(field => field.tagName === 'dt').map(field => field.textContent),['工作區管理人','負責項目','可承接數量']);
    assert.deepEqual(fields.filter(field => field.tagName === 'dd').map(field => field.textContent),chinese[index]);
    dialog.children[0].fire('click');
  }
  assert.equal(page.main.children.length,1,'all workspace buttons reuse the same modal');
  page.language('en');
  const { button } = page.render('A');
  button.fire('click');
  assert.equal(page.dialog.children[1].textContent,'Team workspace A');
  assert.deepEqual(page.dialog.children[2].children.map(field => field.textContent),['Workspace manager','COOKRICE','Project types','3D character models','Capacity','2+ groups']);
  assert.equal(page.dialog.children[0].getAttribute('aria-label'),'Close workspace information');
});

test('workspace information opens only on button activation and closes with the close button or native Escape cancellation', () => {
  const page = helpPage();
  const { label, button } = page.render('C');
  button.fire('pointerenter');
  button.fire('focus');
  assert.equal(page.dialog,undefined);
  assert.equal(label.children.length,1,'there is no adjacent tooltip');
  assert.equal(button.getAttribute('aria-describedby'),null);
  assert.equal(button.getAttribute('title'),null);
  button.fire('click');
  assert.equal(page.dialog.open,true);
  page.dialog.children[0].fire('click');
  assert.equal(page.dialog.open,false);
  button.fire('click');
  let cancelled = false;
  page.dialog.fire('cancel',{ preventDefault() { cancelled = true; } });
  assert.equal(cancelled,true);
  assert.equal(page.dialog.open,false);
  button.fire('click');
  page.render('D');
  assert.equal(page.dialog.open,true,'timeline label redraws do not dismiss the modal');
  page.help.close();
  assert.equal(page.dialog.open,false);
});

test('refraction bends only the bounded edge region and leaves the center optically neutral', () => {
  const geometry = neutralRefractionGeometry(240,48,{ strength:4, bezel:7, radius:12 });
  assert.equal(sampleNeutralRefraction(120,24,geometry).dx,0);
  assert.equal(sampleNeutralRefraction(120,24,geometry).dy,0);
  const left = sampleNeutralRefraction(3,24,geometry);
  const right = sampleNeutralRefraction(237,24,geometry);
  assert.ok(left.dx > 0 && Math.abs(left.dx) <= 3.5);
  assert.equal(left.dx,-right.dx);
  const map = createNeutralDisplacementPixels(240,48,geometry);
  const center = (24 * map.width + 120) * 4;
  assert.deepEqual([...map.data.slice(center,center+4)],[128,128,128,255]);
  assert.throws(() => createNeutralDisplacementPixels(4097,48),RangeError);
  const thin = neutralRefractionGeometry(2,48,{ strength:4, bezel:7, radius:12 });
  assert.ok(thin.strength <= .5 && thin.radius <= 1);
});
