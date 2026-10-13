import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script, createContext } from 'node:vm';

const workflow = await readFile(new URL('../../.github/workflows/pages.yml', import.meta.url), 'utf8');
const guard = workflow.match(/node --input-type=module <<'NODE'\r?\n([\s\S]*?)\r?\n\s+NODE\r?\n/);
assert.ok(guard, 'The publication guard must remain executable in the manual workflow.');
const guardScript = new Script(guard[1].replace(/^ {10}/gm, ''));

function runGuard(overrides = {}) {
  const messages = [];
  let status = 0;
  const exited = Symbol('exit');
  const context = createContext({
    process: {
      env: {
        REPOSITORY_PRIVATE: 'false',
        REPOSITORY_FORK: 'false',
        DEFAULT_BRANCH: 'main',
        REQUESTED_REF: 'refs/heads/main',
        ...overrides,
      },
      exit(code) { status = code; throw exited; },
    },
    console: { error(message) { messages.push(message); } },
  });
  try { guardScript.runInContext(context); }
  catch (error) { if (error !== exited) throw error; }
  return { status, messages };
}

test('manual publication accepts only the public original repository on main', () => {
  assert.deepEqual(runGuard(), { status: 0, messages: [] });
  for (const value of ['true', '', undefined]) {
    const result = runGuard({ REPOSITORY_PRIVATE: value });
    assert.equal(result.status, 1);
    assert.ok(result.messages.some((message) => message.includes('Make this repository public')));
  }
  const fork = runGuard({ REPOSITORY_FORK: 'true' });
  assert.equal(fork.status, 1);
  assert.ok(fork.messages.some((message) => message.includes('not a fork')));
  for (const overrides of [
    { DEFAULT_BRANCH: 'master' },
    { REQUESTED_REF: 'refs/heads/review' },
    { REQUESTED_REF: 'refs/tags/release' },
  ]) {
    const result = runGuard(overrides);
    assert.equal(result.status, 1);
    assert.ok(result.messages.some((message) => message.includes('select main')));
  }
});

test('Pages workflow is manual, injects the Script URL from a secret and publishes only its own entrypoint', () => {
  const triggers = workflow.match(/^on:\r?\n([\s\S]*?)^permissions:/m)?.[1];
  assert.ok(triggers);
  assert.deepEqual([...triggers.matchAll(/^  (\w+):/gm)].map((match) => match[1]), ['workflow_dispatch']);
  assert.doesNotMatch(workflow, /pull_request_target|schedule:|git push|ghpages|CNAME|repository:/);
  assert.match(workflow, /node-version: "24"/);
  assert.match(workflow, /PM_STUDIO_APP_URL: \$\{\{ secrets\.PM_STUDIO_APP_URL \}\}/);
  assert.match(workflow, /run: node scripts\/build-public-site\.mjs\r?\n/);
  assert.doesNotMatch(workflow, /--snapshot|schedule\.json|script\.google\.com|PM_STUDIO_APP_URL.*(?:echo|console\.log)/);
  assert.match(workflow, /path: local\/public-site\r?\n/);
  const guardAt = workflow.indexOf('Verify publishing prerequisites');
  const testsAt = workflow.indexOf('node --test ');
  const buildAt = workflow.indexOf('node scripts/build-public-site.mjs');
  const uploadAt = workflow.indexOf('uses: actions/upload-pages-artifact@');
  assert.ok(guardAt >= 0 && guardAt < testsAt && testsAt < buildAt && buildAt < uploadAt);
  const deploy = workflow.split(/^  deploy:\r?\n/m)[1];
  assert.ok(deploy);
  assert.match(deploy, /needs: build/);
  assert.match(deploy, /pages: write/);
  assert.match(deploy, /id-token: write/);
  assert.match(deploy, /name: github-pages/);
  assert.doesNotMatch(workflow.split(/^  deploy:\r?\n/m)[0], /pages: write|id-token: write|contents: write/);
});
