const WORKSPACE_INFO = Object.freeze({
  A: { manager:'COOKRICE', category:['角色模型', 'Character models'], items:['3D人物角色模型', '3D character models'], capacity:['2組+', '2+ groups'] },
  B: { manager:'COOKRICE', category:['角色模型', 'Character models'], items:['3D人物角色模型', '3D character models'], capacity:['2組+', '2+ groups'] },
  C: { manager:'COOKRICE', category:['角色・場景', 'Characters & scenes'], items:['角色、場景及其他 3D 模型', 'Characters, scenes and other 3D models'], capacity:['依案件安排', 'As arranged per project'] },
  D: { manager:'COCO', category:['遊戲外包', 'Game outsourcing'], items:['遊戲 CT 美術外包', 'Outsourced game CT art'], capacity:['依案件安排', 'As arranged per project'] },
});
const WORKSPACE_DIALOG_TEXT = Object.freeze({
  title:['團隊工作區 ', 'Team workspace '],
  manager:['工作區管理人', 'Workspace manager'],
  items:['負責項目', 'Project types'],
  capacity:['可承接數量', 'Capacity'],
  open:['查看工作區資訊', 'View workspace information'],
  close:['關閉工作區資訊', 'Close workspace information'],
});

/** Shared click-activated workspace information for both schedule views. */
export function createWorkspaceHelp({ doc = document, getLanguage }) {
  let dialog;
  const languageIndex = () => getLanguage() === 'en' ? 1 : 0;
  function node(tag, className, text) {
    const element = doc.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function close() {
    if (dialog?.open) dialog.close();
  }
  function show(id) {
    const workspace = WORKSPACE_INFO[id];
    if (!workspace) return;
    if (!dialog) {
      dialog = node('dialog', 'project-details workspace-details');
      dialog.setAttribute('id', 'workspace-details');
      dialog.setAttribute('aria-labelledby', 'workspace-details-title');
      doc.querySelector('main').append(dialog);
      dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    }
    const language = languageIndex();
    const title = node('h2', '', WORKSPACE_DIALOG_TEXT.title[language] + id);
    title.setAttribute('id', 'workspace-details-title');
    const dismiss = node('button', 'details-close', '×');
    dismiss.setAttribute('type', 'button');
    dismiss.setAttribute('aria-label', WORKSPACE_DIALOG_TEXT.close[language]);
    dismiss.addEventListener('click', close);
    const fields = node('dl', 'workspace-fields');
    for (const key of ['manager', 'items', 'capacity']) {
      const value = key === 'manager' ? workspace.manager : workspace[key][language];
      fields.append(node('dt', '', WORKSPACE_DIALOG_TEXT[key][language]), node('dd', '', value));
    }
    dialog.replaceChildren(dismiss, title, fields);
    if (!dialog.open) dialog.showModal();
  }
  function render(label, id) {
    const workspace = WORKSPACE_INFO[id];
    if (!workspace) return;
    const language = languageIndex();
    const button = node('button', 'workspace-trigger');
    button.setAttribute('type', 'button');
    button.setAttribute('data-workspace-id', id);
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-controls', 'workspace-details');
    button.setAttribute('aria-label', WORKSPACE_DIALOG_TEXT.open[language] + ' · ' + id + ' · ' + workspace.category[language]);
    const hint = node('span', 'workspace-info', 'ⓘ');
    hint.setAttribute('aria-hidden', 'true');
    button.append(node('span', 'workspace-letter', id), node('span', 'workspace-description', workspace.category[language]), hint);
    button.addEventListener('click', () => show(id));
    label.append(button);
  }
  return { render, close };
}
