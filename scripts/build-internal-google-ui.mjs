import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFile(resolve(root, path), 'utf8');
function browserSource(source) { return source.replace(/^import[^\n]*\n/gm, '').replace(/^export\s+/gm, ''); }
function safeScript(source) { return source.replace(/<\/script/gi, '<\\/script'); }
const internalCss = `
.internal-access-note { margin: -10px 0 22px; color: #a6bfce; font-size: 12px; line-height: 1.7; }
.project-name { font-size: 11px; color: #c5d6e2; font-weight: 500; }
.pending-card .project-name { overflow-wrap: anywhere; }
`;

export function combineInternalCode(publicCode, internalCode) {
  if ((publicCode.match(/^function doGet\(/gm) || []).length !== 1 || (publicCode.match(/^function getTimeline\(/gm) || []).length !== 1) throw new Error('Unexpected shared schedule source.');
  const helpers = publicCode.replace(/^function doGet\(/m, 'function publicDoGet_(').replace(/^function getTimeline\(/m, 'function publicGetTimeline_(');
  return '// Generated teamspace reading variant for the existing PM Studio Script project. No project records are embedded.\n' + helpers + '\n\n' + internalCode;
}

function verifyInternalManifest(source) {
  const manifest = JSON.parse(source);
  if (manifest.webapp?.executeAs !== 'USER_DEPLOYING' || manifest.webapp?.access !== 'ANYONE_ANONYMOUS'
    || manifest.oauthScopes?.length !== 1 || manifest.oauthScopes[0] !== 'https://www.googleapis.com/auth/spreadsheets.readonly') throw new Error('Teamspace reading must use anonymous read-only access.');
  return manifest;
}

export async function buildInternalGoogleUi({ outputDir = resolve(root, 'google-app/internal'), packageDir = resolve(root, 'local/google-app-bundle') } = {}) {
  const [html, css, ...modules] = await Promise.all([
    read('web/dist/index.html'), read('web/dist/styles.css'), read('web/dist/app.mjs'),
    read('google-app/ui/common-contract.mjs'), read('google-app/ui/bridge.mjs'),
    read('web/dist/localization.mjs'), read('google-app/internal/ui/internal-contract.mjs'), read('google-app/internal/ui/client.mjs'),
  ]);
  const script = '// Generated from PM Studio sources. No project records are embedded.\n(async () => {\n' + modules.map(browserSource).join('\n') + '\n})();';
  const template = html.replace('<title>PM Studio｜專案排程</title>', '<title>PM Studio｜團隊專案排程</title>')
    .replace('<h1 id="schedule-title">專案排程</h1>', '<h1 id="schedule-title">團隊專案排程</h1>')
    .replace('<p id="preview-note"', '<p id="internal-access-note" class="internal-access-note">排程畫面為唯讀。</p>\n    <p id="preview-note"')
    .replace('<link rel="stylesheet" href="/styles.css">', () => '<style>\n' + css + internalCss + '</style>')
    .replace('<script type="module" src="/app.mjs"></script>', () => '<script>\n' + safeScript(script) + '\n</script>');
  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, 'Index.html'), template);
  if (packageDir) {
    const [publicCode, internalCode, manifest] = await Promise.all([read('google-app/Code.gs'), read('google-app/internal/Code.gs'), read('google-app/internal/appsscript.json')]);
    verifyInternalManifest(manifest);
    const destination = resolve(packageDir, 'internal-readonly');
    await mkdir(destination, { recursive: true });
    await writeFile(resolve(destination, 'Index.html'), template);
    await writeFile(resolve(destination, 'Code.gs'), combineInternalCode(publicCode, internalCode));
    await writeFile(resolve(destination, 'appsscript.json'), manifest);
  }
  return [{ filename: 'Index.html', html: template }];
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildInternalGoogleUi();
  console.log('Teamspace schedule reading built for the existing Script project; package: local/google-app-bundle/internal-readonly/.');
}
