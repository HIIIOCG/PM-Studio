const WORKSPACE_COPY = Object.freeze({
  'zh-Hant': {
    A: ['角色模型', '3D 角色模型製作。'],
    B: ['角色模型', '3D 角色模型製作。'],
    C: ['角色・場景', '角色、場景及其他 3D 模型製作。'],
    D: ['遊戲 CT 美術', '遊戲 CT 美術外包。'],
  },
  en: {
    A: ['Character models', '3D character modeling.'],
    B: ['Character models', '3D character modeling.'],
    C: ['Characters & scenes', '3D character, scene and other modeling.'],
    D: ['Game CT art', 'Outsourced game CT art.'],
  },
});

/** One shared workspace help controller for either read-only schedule view. */
export function createWorkspaceHelp({ doc = document, view = doc.defaultView, getLanguage }) {
  let sequence = 0;
  let active = null;
  let closeTimer = null;
  const cancelClose = () => {
    if (closeTimer !== null) view.clearTimeout(closeTimer);
    closeTimer = null;
  };
  function close(record = active, dismiss = false) {
    if (!record) return;
    cancelClose();
    record.tooltip.hidden = true;
    record.pinned = false;
    record.button.classList.remove('is-help-open');
    record.button.removeAttribute('data-help-pinned');
    if (dismiss) record.dismissed = true;
    if (active === record) active = null;
  }
  function position() {
    const record = active;
    if (!record) return;
    if (!record.button.isConnected) { close(record); return; }
    const trigger = record.button.getBoundingClientRect();
    const viewportWidth = doc.documentElement.clientWidth;
    const viewportHeight = view.innerHeight;
    if (trigger.bottom < 0 || trigger.top > viewportHeight || trigger.right < 0 || trigger.left > viewportWidth) {
      close(record);
      return;
    }
    const margin = 8;
    const gap = 10;
    record.tooltip.style.maxWidth = Math.max(0, viewportWidth - margin * 2) + 'px';
    record.tooltip.style.maxHeight = Math.max(0, viewportHeight - margin * 2) + 'px';
    const tip = record.tooltip.getBoundingClientRect();
    const clamp = (value, maximum) => Math.max(margin, Math.min(value, Math.max(margin, maximum)));
    let left, top;
    if (trigger.right + gap + tip.width <= viewportWidth - margin) {
      left = trigger.right + gap;
      top = clamp(trigger.top, viewportHeight - tip.height - margin);
    } else {
      left = clamp(trigger.left, viewportWidth - tip.width - margin);
      if (trigger.bottom + gap + tip.height <= viewportHeight - margin) top = trigger.bottom + gap;
      else if (trigger.top - gap - tip.height >= margin) top = trigger.top - gap - tip.height;
      else top = clamp(trigger.bottom + gap, viewportHeight - tip.height - margin);
    }
    record.tooltip.style.left = Math.round(left) + 'px';
    record.tooltip.style.top = Math.round(top) + 'px';
  }
  function open(record) {
    if (record.dismissed || !record.button.isConnected) return;
    cancelClose();
    if (active && active !== record) close();
    active = record;
    record.tooltip.hidden = false;
    record.button.classList.add('is-help-open');
    position();
  }
  function maybeClose(record) {
    cancelClose();
    if (record.pinned || record.focused || record.overTrigger || record.overTip) return;
    closeTimer = view.setTimeout(() => {
      closeTimer = null;
      if (!record.pinned && !record.focused && !record.overTrigger && !record.overTip) close(record);
    }, 110);
  }
  function node(tag, className, text) {
    const element = doc.createElement(tag);
    element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function render(label, id) {
    if (active && !active.button.isConnected) close();
    const english = getLanguage() === 'en';
    const copy = WORKSPACE_COPY[english ? 'en' : 'zh-Hant'][id];
    if (!copy) return;
    const button = node('button', 'workspace-trigger');
    button.setAttribute('type', 'button');
    button.setAttribute('data-workspace-id', id);
    button.setAttribute('aria-label', english
      ? 'Workspace ' + id + ' · ' + copy[0] + '. View project types'
      : '工作區 ' + id + ' · ' + copy[0] + '，查看案件類型');
    const hint = node('span', 'workspace-info', 'ⓘ');
    hint.setAttribute('aria-hidden', 'true');
    button.append(node('span', 'workspace-letter', id), node('span', 'workspace-description', copy[0]), hint);
    const tooltip = node('div', 'workspace-help-tooltip');
    tooltip.append(node('span', 'workspace-help-copy', copy[1]));
    tooltip.setAttribute('id', 'workspace-help-' + (++sequence));
    tooltip.setAttribute('role', 'tooltip');
    tooltip.hidden = true;
    button.setAttribute('aria-describedby', tooltip.id);
    label.append(button, tooltip);
    const record = { button, tooltip, pinned:false, focused:false, overTrigger:false, overTip:false, dismissed:false };
    button.addEventListener('pointerenter', () => {
      record.overTrigger = true;
      if (!record.focused) record.dismissed = false;
      open(record);
    });
    button.addEventListener('pointerleave', () => { record.overTrigger = false; maybeClose(record); });
    tooltip.addEventListener('pointerenter', () => { record.overTip = true; cancelClose(); });
    tooltip.addEventListener('pointerleave', () => { record.overTip = false; maybeClose(record); });
    button.addEventListener('focus', () => { record.focused = true; record.dismissed = false; open(record); });
    button.addEventListener('blur', () => { record.focused = false; record.pinned = false; record.dismissed = false; maybeClose(record); });
    button.addEventListener('click', () => {
      if (record.pinned) { close(record, true); return; }
      record.dismissed = false;
      record.pinned = true;
      open(record);
      button.setAttribute('data-help-pinned', 'true');
    });
  }
  doc.addEventListener?.('pointerdown', event => {
    if (active && (!active.button.isConnected || (!active.button.contains(event.target) && !active.tooltip.contains(event.target)))) close(active, true);
  }, true);
  doc.addEventListener?.('keydown', event => { if (event.key === 'Escape' && active) close(active, true); });
  view?.addEventListener('resize', position, { passive:true });
  doc.addEventListener?.('scroll', position, { capture:true, passive:true });
  return { render, close:() => close() };
}
