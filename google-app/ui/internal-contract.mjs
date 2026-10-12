import { cleanText, validateEnvelope, normalizePlacement } from './common-contract.mjs';

export function normalizeInternalPayload(value) {
  const envelope = validateEnvelope(value, 'internal');
  const ids = new Set();
  const fields = ['id', 'name', 'goal', 'requirements', 'customer', 'owner', 'executor', 'status',
    'originalStart', 'originalEnd', 'start', 'end', 'correctionStart', 'correctionEnd',
    'dateBasis', 'supplement', 'deliverySteps'];
  const projects = value.projects.map((project) => {
    if (!project || typeof project !== 'object' || Array.isArray(project)) throw new Error('案件資料無效。');
    const normalized = Object.fromEntries(fields.map((key) => [key, cleanText(project[key])]));
    if (!/^(?:C|BG|P|D|O|DEMO)-\d{3,}$/.test(normalized.id) || ids.has(normalized.id)) throw new Error('案號缺少或重複。');
    ids.add(normalized.id);
    return { ...normalized, ...normalizePlacement(project, envelope.workspaces) };
  });
  const canEditLayout = value.permissions?.canEditLayout === true;
  const revision = cleanText(value.revision, 200);
  if (canEditLayout && !revision) throw new Error('缺少資料版本，無法更新配置。');
  const sourceUrl = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[\w-]+(?:\/|$)/.test(value.sourceUrl || '') ? value.sourceUrl : '';
  return { ...envelope, mode: 'internal', projects, revision, sourceUrl,
    permissions: { canEditLayout }, warnings: Array.isArray(value.warnings) ? value.warnings.filter((item) => typeof item === 'string').map((item) => cleanText(item, 300)) : [] };
}
