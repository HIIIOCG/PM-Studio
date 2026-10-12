async function saveAssignment(ids) {
  const project = state.activeProject;
  if (!project || !state.payload?.permissions?.canEditLayout) return;
  const assignments = Object.fromEntries(state.payload.projects.map((item) => [item.id, item.id === project.id ? ids : item.workspaceIds ?? []]));
  let activeAllocation;
  try { activeAllocation = readWorkspaceAllocations(ids); }
  catch (error) { $('assignment-error').textContent = error.message; $('assignment-error').hidden = false; return; }
  const allocations = Object.fromEntries(state.payload.projects.map((item) => [item.id, item.id === project.id ? activeAllocation : item.workspaceUnits ?? {}]));
  $('save-assignment').disabled = true; $('clear-assignment').disabled = true;
  try {
    const payload = normalizeInternalPayload(await callGoogle('saveLayout', { assignments, allocations, revision: state.payload.revision }));
    state.payload = payload;
    state.realPayload = payload;
    $('project-dialog').close();
    render();
    notify(ids.length ? `${project.id} 已安排至工作區 ${ids.join(' ＋ ')}。` : `${project.id} 已移回待安排。`);
  } catch (error) { $('assignment-error').textContent = error.message; $('assignment-error').hidden = false; }
  finally { $('save-assignment').disabled = false; $('clear-assignment').disabled = false; }
}

$('assignment-form').addEventListener('submit', (event) => { event.preventDefault(); saveAssignment([...$('workspace-options').querySelectorAll('input[data-workspace]:checked')].map((input) => input.dataset.workspace)); });
$('clear-assignment').addEventListener('click', () => saveAssignment([]));
$('layout-demo').addEventListener('click', () => {
  if (!state.payload) return;
  if (state.isIllustration) {
    state.payload = state.realPayload;
    state.isIllustration = false;
    $('layout-demo').textContent = '版型示意';
  } else {
    state.realPayload = state.payload;
    const sample = createDemo(new Date(`${today}T04:00:00Z`));
    state.payload = normalizeInternalPayload({ ...sample, mode: 'internal', preview: true, permissions: { canEditLayout: false }, revision: '' });
    state.isIllustration = true;
    $('layout-demo').textContent = '回到專案排程';
  }
  notify('');
  render();
});
