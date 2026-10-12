import { cleanText, validateEnvelope, normalizePlacement } from './common-contract.mjs';

export function normalizePublicPayload(value) {
  const envelope = validateEnvelope(value, 'public');
  const topKeys = new Set(['mode', 'today', 'syncedAt', 'projects', 'workspaces', 'warnings', 'permissions', 'preview']);
  if (Object.keys(value).some((key) => !topKeys.has(key)) || value.permissions?.canEditLayout === true) throw new Error('公開排程資料不符。');
  const allowed = new Set(['alias', 'goal', 'start', 'end', 'correctionStart', 'correctionEnd', 'workspaceIds', 'workspaceUnits']);
  const aliases = new Set();
  const projects = value.projects.map((project) => {
    if (!project || typeof project !== 'object' || Array.isArray(project)
      || Object.keys(project).some((key) => !allowed.has(key))) throw new Error('公開案件包含未允許的欄位。');
    const alias = cleanText(project.alias, 80);
    if (!/^專案 \d{3,}$/.test(alias) || aliases.has(alias)) throw new Error('匿名名稱無效或重複。');
    aliases.add(alias);
    return { id: alias, name: alias, alias, goal: cleanText(project.goal, 300),
      start: cleanText(project.start, 20), end: cleanText(project.end, 20),
      correctionStart: cleanText(project.correctionStart, 20), correctionEnd: cleanText(project.correctionEnd, 20),
      dateBasis: 'current', ...normalizePlacement(project, envelope.workspaces) };
  });
  return { ...envelope, mode: 'public', projects, permissions: { canEditLayout: false }, warnings: [] };
}
