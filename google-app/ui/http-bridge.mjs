export function createTimelineHttpBridge(endpoint, request = globalThis.fetch) {
  return async function readTimeline() {
    const unavailable = () => new Error('Schedule service is unavailable.');
    if (typeof endpoint !== 'string'
      || /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,200}\/exec$/u.exec(endpoint)?.[0] !== endpoint
      || typeof request !== 'function') throw unavailable();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      // Omitting credentials on the entire redirect chain isolates the read
      // from the visitor's Google accounts. Each call reads the current source.
      const response = await request(endpoint, {
        method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store',
        redirect: 'follow', referrerPolicy: 'no-referrer', signal: controller.signal,
      });
      if (!response.ok || ['opaque', 'opaqueredirect'].includes(response.type)
        || !/^application\/json(?:\s*;|\s*$)/i.test(response.headers.get('content-type') || '')) throw unavailable();
      const payload = await response.json();
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)
        || Object.hasOwn(payload, 'error')) throw unavailable();
      // The public and teamspace normalizers validate their own exact schemas.
      return payload;
    } catch {
      // Never expose response HTML, service errors, URLs, or source identifiers.
      throw unavailable();
    } finally {
      clearTimeout(timer);
    }
  };
}
