import { normalizeTimelinePayload } from '../../ui/common-contract.mjs';

export const INTERNAL_ONLY_PROJECT_FIELDS = Object.freeze(['name', 'customer', 'contact', 'assignee']);
export const INTERNAL_PROJECT_FIELDS = Object.freeze(['name', 'customer', 'owner', 'status', 'deliveryGoal', 'notes', 'contact', 'assignee', 'deliverySteps']);

// Teamspace adds only its four explicit text fields to the public schedule.
// Shared text, dates and enums retain the strict common validation; source links,
// settings and original rows are never accepted in either contract.
export function normalizeInternalTimelinePayload(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.projects)) throw new Error('Invalid internal schedule.');
  const extras = payload.projects.map((project) => {
    if (!project || typeof project !== 'object' || Array.isArray(project)) throw new Error('Invalid internal project.');
    const fields = {};
    for (const key of INTERNAL_ONLY_PROJECT_FIELDS) {
      if (!Object.hasOwn(project, key) || typeof project[key] !== 'string' || project[key].length > 4000) throw new Error('Invalid internal project text.');
      fields[key] = project[key];
    }
    return fields;
  });
  const publicProjects = payload.projects.map((project) => Object.fromEntries(Object.entries(project).filter(([key]) => !INTERNAL_ONLY_PROJECT_FIELDS.includes(key))));
  const schedule = normalizeTimelinePayload({ ...payload, projects: publicProjects });
  return { ...schedule, projects: schedule.projects.map((project, index) => ({ ...project, ...extras[index] })) };
}
