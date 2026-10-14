import { normalizeTimelinePayload, PROJECT_DETAIL_FIELDS } from '../../ui/common-contract.mjs';

export const INTERNAL_PROJECT_FIELDS = PROJECT_DETAIL_FIELDS;

// Both authorized reading views share the same bounded text contract.
// Source links, settings and original rows are never accepted.
export function normalizeInternalTimelinePayload(payload) {
  return normalizeTimelinePayload(payload);
}
