export const PENDING_REASONS = Object.freeze(['no-workspace', 'workspace-values', 'production-dates', 'correction-dates', 'customer-code', 'customer-type', 'schedule-kind', 'follow-up-values']);
export const CUSTOMER_TYPES = Object.freeze(['VTuber個人', 'VTuber公司', '遊戲公司', '其他']);
export const PROJECT_DETAIL_FIELDS = Object.freeze(['name', 'customer', 'owner', 'status', 'deliveryGoal', 'notes', 'contact', 'assignee', 'deliverySteps']);
export const SCHEDULE_WARNINGS = Object.freeze(['project-id-missing', 'project-id-invalid']);
export const SCHEDULE_KINDS = Object.freeze(['production', 'reservation']);
export const FOLLOW_UP_STATUSES = Object.freeze(['customer-confirmation', 'payment']);
function scheduleKeys(value, allowed, required = allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key)) || required.some((key) => !(key in value))) throw new Error('Invalid schedule fields.');
}
function scheduleDateValue(value) {
  if (typeof value !== 'string' || (value !== '' && !/^\d{4}-\d{2}(?:-\d{2})?$/.test(value))) throw new Error('Invalid schedule date.');
  return value;
}
export function normalizeTimelinePayload(payload) {
  scheduleKeys(payload, ['schemaVersion', 'today', 'syncedAt', 'projects', 'workspaces', 'warnings']);
  if (payload.schemaVersion !== 3 || !/^\d{4}-\d{2}-\d{2}$/.test(payload.today) || !Number.isFinite(new Date(payload.today + 'T00:00:00Z').getTime()) || new Date(payload.today + 'T00:00:00Z').toISOString().slice(0, 10) !== payload.today) throw new Error('Invalid schedule version or day.');
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
    scheduleKeys(project, ['id', 'customerCode', 'customerType', 'start', 'end', 'correctionStart', 'correctionEnd', 'scheduleKind', 'followUp', 'workspaceIds', 'workspaceUnits', 'pendingReasons', ...PROJECT_DETAIL_FIELDS]);
    if (typeof project.id !== 'string' || !/^(?:C|BG|P|D|O)-\d{3,}$/.test(project.id) || ids.has(project.id)) throw new Error('Invalid project ID.');
    ids.add(project.id);
    if (typeof project.customerCode !== 'string' || (project.customerCode !== '' && !/^[A-Z]+-\d+$/.test(project.customerCode))) throw new Error('Invalid customer code.');
    if (typeof project.customerType !== 'string' || (project.customerType !== '' && !CUSTOMER_TYPES.includes(project.customerType))) throw new Error('Invalid customer type.');
    for (const key of PROJECT_DETAIL_FIELDS) {
      if (typeof project[key] !== 'string' || project[key].length > 4000) throw new Error('Invalid project text.');
    }
    for (const key of ['start', 'end', 'correctionStart', 'correctionEnd']) scheduleDateValue(project[key]);
    if (!SCHEDULE_KINDS.includes(project.scheduleKind)) throw new Error('Invalid schedule kind.');
    if (!Array.isArray(project.followUp) || project.followUp.length > FOLLOW_UP_STATUSES.length
      || new Set(project.followUp).size !== project.followUp.length || project.followUp.some((value) => !FOLLOW_UP_STATUSES.includes(value))) throw new Error('Invalid follow-up status.');
    if (!Array.isArray(project.workspaceIds) || new Set(project.workspaceIds).size !== project.workspaceIds.length || project.workspaceIds.some((id) => !['A', 'B', 'C', 'D'].includes(id))) throw new Error('Invalid workspace assignment.');
    scheduleKeys(project.workspaceUnits, project.workspaceIds);
    if (Object.values(project.workspaceUnits).some((value) => !Number.isSafeInteger(value) || value < 1)) throw new Error('Invalid workspace units.');
    if (!Array.isArray(project.pendingReasons) || project.pendingReasons.some((value) => !PENDING_REASONS.includes(value))) throw new Error('Invalid pending reason.');
    return { ...project, followUp: [...project.followUp], workspaceIds: [...project.workspaceIds], workspaceUnits: { ...project.workspaceUnits }, pendingReasons: [...new Set(project.pendingReasons)] };
  });
  return { schemaVersion: 3, today: payload.today, syncedAt: payload.syncedAt, workspaces, projects, warnings: [...new Set(payload.warnings)] };
}
