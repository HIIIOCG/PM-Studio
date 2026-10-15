import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildInternalGoogleUi } from './build-internal-google-ui.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFile(resolve(root, path), 'utf8');
function browserSource(source) { return source.replace(/^import[^\n]*\n/gm, '').replace(/^export\s+/gm, ''); }
function safeScript(source) { return source.replace(/<\/script/gi, '<\\/script'); }

export async function buildGoogleUi({ view = 'public', outputDir, packageDir = resolve(root, 'local/google-app-bundle') } = {}) {
  if (view === 'internal') return buildInternalGoogleUi({ outputDir: outputDir ?? resolve(root, 'google-app/internal'), packageDir });
  if (view !== 'public') throw new Error('Unknown schedule reading view.');
  outputDir ??= resolve(root, 'google-app');
  const [html, css, ...modules] = await Promise.all([
    read('web/dist/index.html'), read('web/dist/styles.css'), read('web/dist/app.mjs'),
    read('google-app/ui/common-contract.mjs'), read('google-app/ui/bridge.mjs'),
    read('web/dist/localization.mjs'), read('web/dist/workspace-help.mjs'), read('web/dist/neutral-refraction.mjs'), read('google-app/ui/client.mjs'),
  ]);
  const script = '// Generated from PM Studio sources. No project records are embedded.\n(async () => {\n' + modules.map(browserSource).join('\n') + '\n})();';
  const template = html.replace('<link rel="stylesheet" href="/styles.css">', () => '<style>\n' + css + '</style>')
    .replace('<script type="module" src="/app.mjs"></script>', () => '<script>\n' + safeScript(script) + '\n</script>');
  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, 'Index.html'), template);
  if (packageDir) {
    const destination = resolve(packageDir, 'single');
    await mkdir(destination, { recursive: true });
    await writeFile(resolve(destination, 'Index.html'), template);
    await copyFile(resolve(root, 'google-app/Code.gs'), resolve(destination, 'Code.gs'));
    await copyFile(resolve(root, 'google-app/appsscript.json'), resolve(destination, 'appsscript.json'));
  }
  return [{ filename: 'Index.html', html: template }];
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const view = process.argv.includes('--internal') ? 'internal' : 'public';
  await buildGoogleUi({ view });
  console.log(view === 'internal'
    ? 'Teamspace schedule reading built for the existing Script project; package: local/google-app-bundle/internal-readonly/.'
    : 'Single Google UI built: Index.html; package: local/google-app-bundle/single/.');
}
