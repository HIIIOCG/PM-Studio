import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm, readdir } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { embedFontStyles, validateWoff2 } from '../../scripts/font-styles.mjs';
import { buildPublicSite, renderPublicEntry, renderTeamspaceEntry } from '../../scripts/build-public-site.mjs';
import { buildGoogleUi } from '../../scripts/build-google-ui.mjs';
import { createGooglePreviewServer } from '../../scripts/serve-google-preview.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const local = resolve(root, 'local');
const assets = resolve(root, 'web/dist/fonts');
const stylesheet = () => readFile(resolve(root, 'web/dist/styles.css'), 'utf8');
const publicUrl = 'https://script.google.com/macros/s/FICTIONAL_FONT_PUBLIC_TEST_001/exec';
const teamUrl = 'https://script.google.com/macros/s/FICTIONAL_FONT_TEAMSPACE_TEST_001/exec';
const faces = css => [...css.matchAll(/@font-face\s*\{[^}]*\}/g)].map(match => match[0]);

async function temporaryDirectory(t) {
  await mkdir(local, { recursive: true });
  const directory = await mkdtemp(resolve(local, 'font-loading-test-'));
  t.after(async () => {
    assert(directory.startsWith(local + sep));
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test('the two variable fonts embed exact WOFF2 bytes and full OFL notices without changing other CSS', async () => {
  const source = await stylesheet(), result = await embedFontStyles(source);
  assert.equal(faces(result).length, 2);
  const embedded = [...result.matchAll(/url\(["']?data:font\/woff2;base64,([A-Za-z0-9+/=]+)["']?\)/g)];
  assert.equal(embedded.length, 2);
  let restored = result.slice(0, result.indexOf('\n/* Font licenses ('));
  for (const [index, name] of ['Inter', 'NotoSansTC'].entries()) {
    const bytes = await readFile(resolve(assets, name + '.woff2'));
    const decoded = Buffer.from(embedded[index][1], 'base64');
    assert.deepEqual(decoded, bytes);
    assert.deepEqual(validateWoff2(decoded).weight, { min: 100, max: 900 });
    assert.match(faces(result)[index], /font-weight:\s*100\s+900\s*;/);
    assert.match(faces(result)[index], /font-display:\s*swap\s*;/);
    assert(result.includes((await readFile(resolve(assets, name + '-OFL.txt'), 'utf8')).trim()));
    restored = restored.replace('data:font/woff2;base64,' + embedded[index][1], '/fonts/' + name + '.woff2');
  }
  assert.equal(restored, source);
  assert.doesNotMatch(result, /url\(\s*["']?(?:https?:|\/\/|\/fonts\/)/);
});

test('font embedding refuses missing files and every unapproved font source', async t => {
  const css = await stylesheet(), empty = await temporaryDirectory(t);
  await assert.rejects(embedFontStyles(css, { fontDirectory: empty }), { code: 'ENOENT' });
  for (const url of ['https://fonts.example/font.woff2', '//fonts.example/font.woff2', '/fonts/Other.woff2',
    '/fonts/../private.woff2', '/fonts/Inter.woff2?version=1', 'data:font/woff2;base64,d09GMg==']) {
    await assert.rejects(embedFontStyles(css.replace('/fonts/Inter.woff2', url)), /Only the two exact bundled/);
  }
  await assert.rejects(embedFontStyles(css.replace('/fonts/NotoSansTC.woff2', '/fonts/Inter.woff2')), /Only the two exact bundled/);
  await assert.rejects(embedFontStyles(css.replace('100 900', '400')), /Only the two exact bundled/);
  await assert.rejects(embedFontStyles(css + '\n.extra { background:url(/fonts/Other.woff2); }'), /Unexpected font asset URL/);
});

test('corrupt WOFF2 headers, truncation and compressed table streams fail before publication', async () => {
  const original = await readFile(resolve(assets, 'Inter.woff2'));
  const variants = [Buffer.from('wOF2'), original.subarray(0, original.length - 8)];
  const wrongMagic = Buffer.from(original); wrongMagic.write('wOFF', 0); variants.push(wrongMagic);
  const wrongLength = Buffer.from(original); wrongLength.writeUInt32BE(original.length + 1, 8); variants.push(wrongLength);
  const noTables = Buffer.from(original); noTables.writeUInt16BE(0, 12); variants.push(noTables);
  const wrongDecodedLength = Buffer.from(original); wrongDecodedLength.writeUInt32BE(original.readUInt32BE(16) + 4, 16); variants.push(wrongDecodedLength);
  const corruptCompressed = Buffer.from(original); corruptCompressed.fill(0, 4096); variants.push(corruptCompressed);
  for (const bytes of variants) assert.throws(() => validateWoff2(bytes), /Invalid bundled variable WOFF2/);
});

test('a valid variable replacement cannot substitute for the approved full-coverage font', async t => {
  const directory = await temporaryDirectory(t), inter = await readFile(resolve(assets, 'Inter.woff2'));
  assert.deepEqual(validateWoff2(inter).weight, { min: 100, max: 900 });
  for (const name of ['Inter', 'NotoSansTC']) {
    await writeFile(resolve(directory, name + '.woff2'), inter);
    await writeFile(resolve(directory, name + '-OFL.txt'), await readFile(resolve(assets, name + '-OFL.txt')));
  }
  await assert.rejects(embedFontStyles(await stylesheet(), { fontDirectory: directory }), /approved full-coverage WOFF2 asset/);
});

test('missing or unsafe font licenses stop embedding instead of publishing an incomplete notice', async t => {
  const directory = await temporaryDirectory(t), css = await stylesheet();
  await writeFile(resolve(directory, 'Inter.woff2'), await readFile(resolve(assets, 'Inter.woff2')));
  await assert.rejects(embedFontStyles(css, { fontDirectory: directory }), { code: 'ENOENT' });
  for (const text of ['Copyright only', 'Copyright\nSIL OPEN FONT LICENSE Version 1.1\n*/ body { display:none }',
    'Copyright\nSIL OPEN FONT LICENSE Version 1.1\n</style><script>']) {
    await writeFile(resolve(directory, 'Inter-OFL.txt'), text);
    await assert.rejects(embedFontStyles(css, { fontDirectory: directory }), /copyright and OFL license/);
  }
});

test('Pages and both Google UI builds share embedded fonts while Pages still publishes only three files', async t => {
  const directory = await temporaryDirectory(t), css = await embedFontStyles(await stylesheet());
  const publicHtml = await renderPublicEntry(publicUrl), teamHtml = await renderTeamspaceEntry(teamUrl);
  const googlePublic = await buildGoogleUi({ outputDir: resolve(directory, 'google-public'), packageDir: null });
  const googleTeam = await buildGoogleUi({ view: 'internal', outputDir: resolve(directory, 'google-team'), packageDir: null });
  for (const html of [publicHtml, teamHtml, googlePublic[0].html, googleTeam[0].html]) {
    assert(html.includes(css));
    assert.equal(faces(html).length, 2);
    assert.doesNotMatch(html, /url\(\s*["']?(?:https?:|\/\/|\/fonts\/)|<link[^>]+rel=["'](?:stylesheet|preload)/);
  }
  assert(publicHtml.includes(publicUrl) && !publicHtml.includes(teamUrl));
  assert(teamHtml.includes(teamUrl) && !teamHtml.includes(publicUrl));
  const outputDir = resolve(directory, 'pages');
  await buildPublicSite({ appUrl: publicUrl, teamspaceAppUrl: teamUrl, outputDir });
  assert.deepEqual((await readdir(outputDir)).sort(), ['.nojekyll', 'index.html', 'teamspace']);
  assert.deepEqual(await readdir(resolve(outputDir, 'teamspace')), ['index.html']);
  assert.equal(await readFile(resolve(outputDir, 'index.html'), 'utf8'), publicHtml);
  assert.equal(await readFile(resolve(outputDir, 'teamspace/index.html'), 'utf8'), teamHtml);
});

test('the fictional preview CSP permits embedded fonts without opening a remote font source', async t => {
  const directory = await temporaryDirectory(t), htmlPath = resolve(directory, 'preview.html');
  await writeFile(htmlPath, '<html><head></head><body></body></html>');
  const server = createGooglePreviewServer({ htmlPath });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  try {
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/');
    assert.equal(response.status, 200);
    const csp = response.headers.get('content-security-policy');
    assert.match(csp, /(?:^|; )font-src data:(?:;|$)/);
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /connect-src 'self'/);
    assert.doesNotMatch(csp, /font-src[^;]*(?:https:|\*|'self')/);
    await response.text();
  } finally { await new Promise(done => server.close(done)); }
});
