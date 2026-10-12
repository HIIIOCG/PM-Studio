import { createPublicPayload } from '../../scripts/public-snapshot.mjs';

/** Read only the same-site, approved public snapshot. There is no fallback data. */
export function createStaticBridge({
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  snapshotUrl = './data/schedule.json',
} = {}) {
  return async function callSnapshot(method, input) {
    if (method !== 'getTimeline' || input !== undefined) throw new Error('公開排程僅支援讀取。');
    if (typeof fetchImpl !== 'function') throw new Error('公開排程目前無法讀取。');
    try {
      const response = await fetchImpl(snapshotUrl, { cache: 'no-store', credentials: 'omit' });
      if (!response?.ok) throw new Error('公開資料讀取失敗。');
      return createPublicPayload(await response.json(), now());
    } catch {
      // Do not expose response content or validation details to public visitors.
      throw new Error('公開排程目前無法讀取，請稍後再試。');
    }
  };
}
