import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { Script } from 'node:vm';
import { buildGoogleUi } from '../../scripts/build-google-ui.mjs';

const deployments = [
  { view: 'internal', manifest: 'appsscript.json', backend: 'Code.gs', html: 'Index.html',
    executeAs: 'USER_ACCESSING', access: 'ANYONE', scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/userinfo.email'
    ] },
  { view: 'public', manifest: 'public-appsscript.json', backend: 'PublicCode.gs', html: 'PublicIndex.html',
    executeAs: 'USER_DEPLOYING', access: 'ANYONE_ANONYMOUS', scopes: ['https://www.googleapis.com/auth/spreadsheets'] }
];

function validateManifest(manifest, deployment) {
  // https://developers.google.com/apps-script/manifest lists NONE and STACKDRIVER, not CLOUD.
  assert.equal(manifest.exceptionLogging, 'STACKDRIVER');
  assert.equal(manifest.timeZone, 'Asia/Taipei');
  assert.equal(manifest.runtimeVersion, 'V8');
  assert.deepEqual(manifest.webapp, { executeAs: deployment.executeAs, access: deployment.access });
  assert.deepEqual(manifest.oauthScopes.slice().sort(), deployment.scopes.slice().sort());
}

for (const deployment of deployments) {
  test(`${deployment.view} manifest uses valid logging, correct execution identity and exact scopes`, async () => {
    const manifest = JSON.parse(await readFile(new URL(`../${deployment.manifest}`, import.meta.url), 'utf8'));
    validateManifest(manifest, deployment);
  });
}

test('built deployments contain separate complete, parseable backend/HTML/manifest packages', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'pm-studio-manifest-'));
  try {
    const packageDir = resolve(directory, 'packages');
    await buildGoogleUi({ outputDir: resolve(directory, 'ui'), packageDir });
    for (const deployment of deployments) {
      const target = resolve(packageDir, deployment.view);
      assert.deepEqual((await readdir(target)).sort(), [deployment.backend, deployment.html, 'appsscript.json'].sort());
      const builtManifest = JSON.parse(await readFile(resolve(target, 'appsscript.json'), 'utf8'));
      const sourceManifest = JSON.parse(await readFile(new URL(`../${deployment.manifest}`, import.meta.url), 'utf8'));
      validateManifest(builtManifest, deployment);
      assert.deepEqual(builtManifest, sourceManifest);
      const backend = await readFile(resolve(target, deployment.backend), 'utf8');
      new Script(backend);
      const html = await readFile(resolve(target, deployment.html), 'utf8');
      assert.match(html, /<!DOCTYPE html>/i);
      const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
      assert.ok(scripts.length, 'The HTML must contain its bundled client.');
      for (const [, script] of scripts) new Script(script);
      if (deployment.view === 'public') {
        assert.doesNotMatch(backend, /INTERNAL_SHEET_ID|INTERNAL_FOLDER_ID|function saveLayout|function publishApprovedSnapshot/);
        assert.doesNotMatch(html, /saveLayout|\/api\/projects|\/api\/layout/);
      }
    }
  } finally {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe temporary cleanup path.');
    await rm(directory, { recursive: true, force: true });
  }
});
