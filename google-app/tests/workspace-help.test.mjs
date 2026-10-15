import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceHelp } from '../../web/dist/workspace-help.mjs';
import { neutralRefractionGeometry, sampleNeutralRefraction, createNeutralDisplacementPixels } from '../../web/dist/neutral-refraction.mjs';

function helpPage() {
  const timers = new Map();
  const eventTarget = () => ({
    listeners:new Map(),
    addEventListener(name, callback) { const handlers = this.listeners.get(name) || []; handlers.push(callback); this.listeners.set(name, handlers); },
    fire(name, values = {}) { for (const callback of this.listeners.get(name) || []) callback(values); },
  });
  function node(tag) {
    const attributes = new Map(), classes = new Set();
    return {
      ...eventTarget(), tagName:tag, children:[], style:{}, hidden:false, isConnected:true, textContent:'',
      classList:{ add:value => classes.add(value), remove:value => classes.delete(value), contains:value => classes.has(value) },
      append(...children) { this.children.push(...children); },
      setAttribute(name, value) { attributes.set(name,String(value)); },
      getAttribute(name) { return attributes.get(name) ?? null; },
      removeAttribute(name) { attributes.delete(name); },
      get id() { return attributes.get('id'); },
      contains(target) { return target === this || this.children.some(child => child.contains(target)); },
      getBoundingClientRect() {
        if (tag === 'button') return { left:8, right:80, top:620, bottom:698, width:72, height:78 };
        const width = Math.min(280, Number.parseFloat(this.style.maxWidth) || 280);
        const height = Math.min(60, Number.parseFloat(this.style.maxHeight) || 60);
        return { left:0, top:0, right:width, bottom:height, width, height };
      },
    };
  }
  const view = { ...eventTarget(), innerHeight:700,
    setTimeout(callback) { const id = timers.size + 1; timers.set(id,callback); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const doc = { ...eventTarget(), documentElement:{ clientWidth:320 }, defaultView:view, createElement:node };
  let language = 'zh-Hant';
  const help = createWorkspaceHelp({ doc, getLanguage:() => language });
  function render(id) {
    const label = node('div');
    help.render(label,id);
    return { label, button:label.children[0], tooltip:label.children[1] };
  }
  return { doc, view, render, language:value => { language = value; }, flushTimers() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(callback => callback()); } };
}

test('workspace help gives one concise customer-facing sentence in either language', () => {
  const page = helpPage();
  const chinese = ['3D 角色模型製作。','3D 角色模型製作。','角色、場景及其他 3D 模型製作。','遊戲 CT 美術外包。'];
  for (const [index,id] of ['A','B','C','D'].entries()) {
    const { button, tooltip } = page.render(id);
    assert.equal(tooltip.children.length,1);
    assert.equal(tooltip.children[0].textContent,chinese[index]);
    assert.equal(button.getAttribute('aria-describedby'),tooltip.id);
    assert.match(button.getAttribute('aria-label'),/查看案件類型/);
    assert.equal(button.children.at(-1).textContent,'ⓘ');
  }
  page.language('en');
  const english = ['3D character modeling.','3D character modeling.','3D character, scene and other modeling.','Outsourced game CT art.'];
  for (const [index,id] of ['A','B','C','D'].entries()) assert.equal(page.render(id).tooltip.children[0].textContent,english[index]);
});

test('help remains available to hover and keyboard users, pins on click, closes on Escape or outside click, and stays within the viewport', () => {
  const page = helpPage();
  const { button, tooltip } = page.render('C');
  button.fire('pointerenter');
  assert.equal(tooltip.hidden,false);
  assert.ok(Number.parseFloat(tooltip.style.left) >= 8);
  assert.ok(Number.parseFloat(tooltip.style.left) + tooltip.getBoundingClientRect().width <= page.doc.documentElement.clientWidth - 8);
  assert.ok(Number.parseFloat(tooltip.style.top) + tooltip.getBoundingClientRect().height <= page.view.innerHeight - 8);
  button.fire('pointerleave');
  tooltip.fire('pointerenter');
  page.flushTimers();
  assert.equal(tooltip.hidden,false,'the tooltip remains readable when the pointer moves onto it');
  tooltip.fire('pointerleave');
  page.flushTimers();
  assert.equal(tooltip.hidden,true);
  button.fire('focus');
  assert.equal(tooltip.hidden,false);
  page.doc.fire('keydown',{ key:'Escape' });
  assert.equal(tooltip.hidden,true);
  button.fire('pointerenter');
  assert.equal(tooltip.hidden,true,'Escape dismisses help while keyboard focus remains');
  button.fire('blur');
  button.fire('click');
  button.fire('pointerleave');
  page.flushTimers();
  assert.equal(tooltip.hidden,false);
  assert.equal(button.getAttribute('data-help-pinned'),'true');
  page.doc.fire('pointerdown',{ target:tooltip.children[0] });
  assert.equal(tooltip.hidden,false);
  page.doc.fire('pointerdown',{ target:page.doc.createElement('div') });
  assert.equal(tooltip.hidden,true);
  assert.equal(button.getAttribute('data-help-pinned'),null);
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
