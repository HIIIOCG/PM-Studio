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
  card.setAttribute('aria-label', `${project.alias}，${phase === 'correction' ? '追加修正' : project.goal || '製作排程'}，${dateText(start)} 至 ${dateText(end)}，工作區 ${renderIds.join('、')}`);
  card.append(create('span', 'card-heading', phase === 'correction' ? `${project.alias} · 追加修正` : project.alias));
  if (!attached) {
    card.append(create('span', 'card-goal', project.goal || '製作排程'));
    const areaText = renderIds.map((id) => { const space = workspaces().find((item) => item.id === id); return `${id}（${workspaceUnits(project, space || { id })} ${space?.unit || '項目'}）`; }).join(' ＋ ');
    card.append(create('span', 'cross-label', splitCross ? `同案跨區 ${project.workspaceIds.join(' ＋ ')} · 本段 ${areaText}` : `工作區 ${areaText}`));
    const bottom = create('span', 'card-bottom');
    bottom.append(create('span', 'card-dates', `${dateText(start)} → ${dateText(end)}`));
    card.append(bottom);
  }
  card.addEventListener('click', () => openProject(project));
  return card;
}

function openProject(project) {
  $('detail-id').textContent = '製作排程';
  $('detail-title').textContent = project.alias;
  $('detail-content').replaceChildren();
  detailRow('交付目標', project.goal || '製作排程');
  detailRow('排程日期', `${dateText(project.start)} → ${dateText(project.end)}`);
  if (project.correctionStart || project.correctionEnd) detailRow('追加修正', `${dateText(project.correctionStart)} → ${dateText(project.correctionEnd)}`);
  detailRow('工作區', project.workspaceIds.map((id) => { const space = workspaces().find((item) => item.id === id); return `${id}（${workspaceUnits(project, space || { id })} ${space?.unit || '項目'}）`; }).join(' ＋ ') || '待安排');
  $('project-dialog').showModal();
}
