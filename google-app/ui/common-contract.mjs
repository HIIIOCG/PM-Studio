export const PENDING_REASONS = Object.freeze(['no-workspace', 'workspace-values', 'production-dates', 'correction-dates', 'customer-code']);
export const SCHEDULE_WARNINGS = Object.freeze(['project-id-missing', 'project-id-invalid']);
function scheduleKeys(value, allowed, required = allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key)) || required.some((key) => !(key in value))) throw new Error('Invalid schedule fields.');
}
function scheduleDateValue(value) {
  if (typeof value !== 'string' || (value !== '' && !/^\d{4}-\d{2}(?:-\d{2})?$/.test(value))) throw new Error('Invalid schedule date.');
  return value;
}
export function normalizeTimelinePayload(payload) {
  scheduleKeys(payload, ['schemaVersion', 'today', 'syncedAt', 'projects', 'workspaces', 'warnings']);
  if (payload.schemaVersion !== 2 || !/^\d{4}-\d{2}-\d{2}$/.test(payload.today) || !Number.isFinite(new Date(payload.today + 'T00:00:00Z').getTime()) || new Date(payload.today + 'T00:00:00Z').toISOString().slice(0, 10) !== payload.today) throw new Error('Invalid schedule version or day.');
  if (typeof payload.syncedAt !== 'string' || !Number.isFinite(Date.parse(payload.syncedAt))) throw new Error('Invalid read time.');
  if (!Array.isArray(payload.workspaces) || payload.workspaces.length !== 4) throw new Error('Invalid workspaces.');
  const workspaces = payload.workspaces.map((space, index) => {
    scheduleKeys(space, ['id', 'name', 'usualLoad'], ['id', 'name']);
    if (space.id !== ['A', 'B', 'C', 'D'][index] || typeof space.name !== 'string' || space.name.length > 80) throw new Error('Invalid workspace.');
    if ('usualLoad' in space && (!Number.isInteger(space.usualLoad) || space.usualLoad < 1)) throw new Error('Invalid usual load.');
    return { ...space };
  });
  if (!Array.isArray(payload.warnings) || payload.warnings.some((value) => !SCHEDULE_WARNINGS.includes(value))) throw new Error('Invalid warning.');
  if (!Array.isArray(payload.projects) || payload.projects.length > 1000) throw new Error('Invalid projects.');
  const ids = new Set();
  const projects = payload.projects.map((project) => {
    scheduleKeys(project, ['id', 'customerCode', 'start', 'end', 'correctionStart', 'correctionEnd', 'workspaceIds', 'workspaceUnits', 'pendingReasons']);
    if (typeof project.id !== 'string' || !/^(?:C|BG|P|D|O)-\d{3,}$/.test(project.id) || ids.has(project.id)) throw new Error('Invalid project ID.');
    ids.add(project.id);
    if (typeof project.customerCode !== 'string' || (project.customerCode !== '' && !/^[A-Z]+-\d+$/.test(project.customerCode))) throw new Error('Invalid customer code.');
    for (const key of ['start', 'end', 'correctionStart', 'correctionEnd']) scheduleDateValue(project[key]);
    if (!Array.isArray(project.workspaceIds) || new Set(project.workspaceIds).size !== project.workspaceIds.length || project.workspaceIds.some((id) => !['A', 'B', 'C', 'D'].includes(id))) throw new Error('Invalid workspace assignment.');
    scheduleKeys(project.workspaceUnits, project.workspaceIds);
    if (Object.values(project.workspaceUnits).some((value) => !Number.isSafeInteger(value) || value < 1)) throw new Error('Invalid workspace units.');
    if (!Array.isArray(project.pendingReasons) || project.pendingReasons.some((value) => !PENDING_REASONS.includes(value))) throw new Error('Invalid pending reason.');
    return { ...project, workspaceIds: [...project.workspaceIds], workspaceUnits: { ...project.workspaceUnits }, pendingReasons: [...new Set(project.pendingReasons)] };
  });
  return { schemaVersion: 2, today: payload.today, syncedAt: payload.syncedAt, workspaces, projects, warnings: [...new Set(payload.warnings)] };
}
