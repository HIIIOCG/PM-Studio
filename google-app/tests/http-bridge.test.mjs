import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimelineHttpBridge } from '../ui/http-bridge.mjs';

const endpoint = 'https://script.google.com/macros/s/FICTIONAL_PM_STUDIO_HTTP_TEST/exec';
const jsonResponse = (payload) => ({
  ok: true, type: 'cors', headers: new Headers({ 'Content-Type': 'application/json; charset=utf-8' }),
  json: async () => payload,
});

test('each read makes a fresh anonymous simple GET and follows Google redirects without credentials', async () => {
  const calls = [];
  const read = createTimelineHttpBridge(endpoint, async (...args) => {
    calls.push(args);
    return jsonResponse({ revision: calls.length });
  });
  assert.deepEqual(await read(), { revision: 1 });
  assert.deepEqual(await read(), { revision: 2 });
  assert.equal(calls.length, 2);
  for (const [url, options] of calls) {
    assert.equal(url, endpoint);
    assert.deepEqual(Object.keys(options).sort(), ['cache', 'credentials', 'method', 'mode', 'redirect', 'referrerPolicy', 'signal']);
    assert.equal(options.method, 'GET');
    assert.equal(options.mode, 'cors');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'follow');
    assert.equal(options.referrerPolicy, 'no-referrer');
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.signal.aborted, false);
  }
});

test('HTML, unreadable responses, JSON errors and transport failures remain generic', async () => {
  for (const response of [
    { ...jsonResponse({}), ok: false },
    { ...jsonResponse({}), type: 'opaque' },
    { ...jsonResponse({}), type: 'opaqueredirect' },
    { ...jsonResponse({}), headers: new Headers({ 'Content-Type': 'text/html' }) },
    { ...jsonResponse({}), headers: new Headers() },
    jsonResponse({ error: 'PRIVATE_SOURCE_ERROR' }),
    jsonResponse(null), jsonResponse('PRIVATE_HTML'), jsonResponse([]),
    { ...jsonResponse({}), json: async () => { throw Error('PRIVATE_JSON_BODY'); } },
  ]) {
    await assert.rejects(createTimelineHttpBridge(endpoint, async () => response)(), { message: 'Schedule service is unavailable.' });
  }
  await assert.rejects(createTimelineHttpBridge(endpoint, async () => { throw Error('PRIVATE_ROUTER_LINK'); })(), { message: 'Schedule service is unavailable.' });
});

test('unknown endpoints and a missing fetch implementation fail before making a request', async () => {
  let requests = 0;
  for (const value of [undefined, null, '', {}, endpoint + '?source=PRIVATE', endpoint + '#mode',
    endpoint.replace('/macros/s/', '/macros/u/0/s/'), endpoint.replace('script.google.com', 'example.org'), endpoint + '\n']) {
    await assert.rejects(createTimelineHttpBridge(value, async () => { requests++; })(), { message: 'Schedule service is unavailable.' });
  }
  await assert.rejects(createTimelineHttpBridge(endpoint, null)(), { message: 'Schedule service is unavailable.' });
  assert.equal(requests, 0);
});

test('a timed-out read aborts and a later retry starts a separate read', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let requests = 0;
  const read = createTimelineHttpBridge(endpoint, async (url, { signal }) => {
    if (++requests === 2) return jsonResponse({ fresh: true });
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Error('PRIVATE_TIMEOUT'))));
  });
  const pending = assert.rejects(read(), { message: 'Schedule service is unavailable.' });
  t.mock.timers.tick(30000);
  await pending;
  assert.deepEqual(await read(), { fresh: true });
  assert.equal(requests, 2);
});
