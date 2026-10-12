export function cleanText(value, max = 4000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function validateEnvelope(value, mode) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.mode !== mode || !Array.isArray(value.projects) || !Array.isArray(value.workspaces)) {
    throw new Error('排程資料或存取版本不符。');
  }
  const ids = new Set();
  const allowed = ['A', 'B', 'C', 'D'];
  const workspaces = value.workspaces.map((item) => {
    if (!item || !allowed.includes(item.id) || ids.has(item.id)) throw new Error('工作區資料無效。');
    ids.add(item.id);
    return { id: item.id, name: cleanText(item.name, 80) || `工作區 ${item.id}`,
      capacity: item.id === 'A' || item.id === 'B' ? 2 : null,
      unit: item.id === 'A' || item.id === 'B' ? '角色' : '項目' };
  });
  if (!workspaces.length) throw new Error('缺少工作區資料。');
  return { workspaces, today: /^\d{4}-\d{2}-\d{2}$/.test(value.today || '') ? value.today : '',
    syncedAt: cleanText(value.syncedAt, 80), preview: value.preview === true };
}

export function normalizePlacement(project, workspaces) {
  const ids = new Set(workspaces.map((item) => item.id));
  const supplied = Array.isArray(project.workspaceIds) ? project.workspaceIds : [];
  if (supplied.length > workspaces.length || supplied.some((id) => !ids.has(id))
    || new Set(supplied).size !== supplied.length) throw new Error('工作區配置無效。');
  const units = {};
  for (const id of supplied) {
    const n = project.workspaceUnits?.[id] ?? 1;
    if (!Number.isInteger(n) || n < 1 || n > (id === 'A' || id === 'B' ? 2 : 1000)) throw new Error('工作區使用數量無效。');
    units[id] = n;
  }
  return { workspaceIds: [...supplied], workspaceUnits: units };
}
