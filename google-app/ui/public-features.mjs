function matchProject(project) {
  const query = state.search.toLocaleLowerCase();
  return !query || [project.alias, project.goal].some((value) => String(value ?? '').toLocaleLowerCase().includes(query));
}

function makeCard(project, cross, width, phase = 'production', attached = false, segmentIds = [], splitCross = false) {
  const card = create('button', `project-card${cross ? ' cross-workspace' : ''}${width < 180 || attached ? ' short-card' : ''}${phase === 'correction' ? ' correction-card' : ''}${splitCross ? ' same-case-segment' : ''}`);
  card.type = 'button';
  const start = phase === 'correction' ? project.correctionStart : project.start;
  const end = phase === 'correction' ? project.correctionEnd : project.end;
  const renderIds = segmentIds.length ? segmentIds : project.workspaceIds;
  card.setAttribute('aria-label', t('cardLabel', { alias: project.alias, goal: phase === 'correction' ? t('correction') : project.goal || t('productionSchedule'), start: dateText(start), end: dateText(end), areas: renderIds.join(', ') }));
  card.append(create('span', 'card-heading', phase === 'correction' ? `${project.alias} · ${t('correction')}` : project.alias));
  if (!attached) {
    card.append(create('span', 'card-goal', project.goal || t('productionSchedule')));
    const areaText = renderIds.map((id) => { const space = workspaces().find((item) => item.id === id); const count = workspaceUnits(project, space || { id }); return `${id}（${count} ${unitText(space, count)}）`; }).join(' ＋ ');
    card.append(create('span', 'cross-label', splitCross ? t('crossWorkspace', { all: project.workspaceIds.join(' ＋ '), areas: areaText }) : t('workspaceAllocation', { areas: areaText })));
    const bottom = create('span', 'card-bottom');
    bottom.append(create('span', 'card-dates', `${dateText(start)} → ${dateText(end)}`));
    card.append(bottom);
  }
  card.addEventListener('click', () => openProject(project));
  return card;
}

function openProject(project) {
  state.activeProject = project;
  $('detail-id').textContent = t('productionSchedule');
  $('detail-title').textContent = project.alias;
  $('detail-content').replaceChildren();
  detailRow(t('deliveryGoal'), project.goal || t('productionSchedule'));
  detailRow(t('scheduleDates'), `${dateText(project.start)} → ${dateText(project.end)}`);
  if (project.correctionStart || project.correctionEnd) detailRow(t('correction'), `${dateText(project.correctionStart)} → ${dateText(project.correctionEnd)}`);
  detailRow(t('workspace'), project.workspaceIds.map((id) => { const space = workspaces().find((item) => item.id === id); const count = workspaceUnits(project, space || { id }); return `${id}（${count} ${unitText(space, count)}）`; }).join(' ＋ ') || t('pending'));
  if (!$('project-dialog').open) $('project-dialog').showModal();
}
