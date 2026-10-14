import { readFile, writeFile, mkdir, readdir, lstat, mkdtemp, rename, rm } from 'node:fs/promises';
import { realpath as resolveFilesystemPath } from 'node:fs';
import { promisify } from 'node:util';
import { basename, dirname, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// The callback resolver follows junctions and works in restricted Windows hosts
// where the native promises resolver cannot open a directory handle.
const realpath = promisify(resolveFilesystemPath);

function validateExecutionUrl(value, setting) {
  // Match the original string: URL normalization must not admit credentials,
  // escaped characters, alternate ports, query strings, or a different origin.
  if (typeof value !== 'string' || /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,200}\/exec$/u.exec(value)?.[0] !== value) {
    throw new Error(`請以 ${setting} 提供已驗證的 Google Apps Script 正式執行網址。`);
  }
  return value;
}

export function validateAppUrl(value) {
  return validateExecutionUrl(value, 'PM_STUDIO_APP_URL');
}

export function validateTeamspaceAppUrl(value) {
  return validateExecutionUrl(value, 'PM_STUDIO_TEAMSPACE_APP_URL');
}

function browserSource(source) {
  return source.replace(/^import[^\n]*\n/gm, '').replace(/^export\s+/gm, '');
}

function safeScript(source) {
  return source.replace(/<\/script/gi, '<\\/script');
}

async function renderDirectEntry(appUrl, teamspace) {
  const url = teamspace ? validateTeamspaceAppUrl(appUrl) : validateAppUrl(appUrl);
  const read = (path) => readFile(resolve(root, path), 'utf8');
  const paths = [
    'web/dist/index.html', 'web/dist/styles.css', 'web/dist/app.mjs',
    'google-app/ui/common-contract.mjs', 'google-app/ui/http-bridge.mjs',
    'web/dist/localization.mjs',
    ...(teamspace ? ['google-app/internal/ui/internal-contract.mjs'] : []),
    teamspace ? 'google-app/internal/ui/client.mjs' : 'google-app/ui/client.mjs',
  ];
  const [sourceHtml, sourceCss, ...modules] = await Promise.all(paths.map(read));
  // Reuse the same view client, changing only its transport in the Pages bundle.
  const initializer = /^const readSchedule = createGoogleBridge\(\);\r?$/gm;
  const client = modules.at(-1);
  if ([...client.matchAll(initializer)].length !== 1) throw new Error('Unexpected schedule client entry.');
  modules[modules.length - 1] = client.replace(initializer,
    'const readSchedule = createTimelineHttpBridge(timelineReadUrl);');
  const script = '// Generated from PM Studio sources. No project records are embedded.\n(async () => {\n'
    + 'const timelineReadUrl = ' + JSON.stringify(url) + ';\n'
    + modules.map(browserSource).join('\n') + '\n})();';
  const teamspaceCss = teamspace ? '\n.internal-access-note { margin: -10px 0 22px; color: #a6bfce; font-size: 12px; line-height: 1.7; }\n.project-name { font-size: 11px; color: #c5d6e2; font-weight: 500; }\n.pending-card .project-name { overflow-wrap: anywhere; }\n' : '';
  let html = sourceHtml
    .replace('<meta name="color-scheme" content="dark">',
      '<meta name="color-scheme" content="dark">\n  <meta name="referrer" content="no-referrer">'
      + (teamspace ? '\n  <meta name="robots" content="noindex,nofollow">' : ''))
    .replace('<link rel="stylesheet" href="/styles.css">', () => '<style>\n' + sourceCss + teamspaceCss + '</style>')
    .replace('<script type="module" src="/app.mjs"></script>', () => '<script>\n' + safeScript(script) + '\n</script>');
  if (teamspace) html = html
    .replace('<title>PM Studio｜專案排程</title>', '<title>PM Studio｜團隊專案排程</title>')
    .replace('<h1 id="schedule-title">專案排程</h1>', '<h1 id="schedule-title">團隊專案排程</h1>')
    .replace('<p id="preview-note"', '<p id="internal-access-note" class="internal-access-note">排程畫面為唯讀。</p>\n    <p id="preview-note"');
  if (/<iframe\b|google\.script\.run|createGoogleBridge\(/.test(html)) throw new Error('Unexpected Google UI transport.');
  return html;
}

export function renderPublicEntry(appUrl) {
  return renderDirectEntry(appUrl, false);
}

export function renderTeamspaceEntry(appUrl) {
  return renderDirectEntry(appUrl, true);
}

function requireContainedPath(workspace, target) {
  const path = relative(workspace, target);
  if (!path || path === '..' || path.startsWith(`..\\`) || path.startsWith('../') || isAbsolute(path)) {
    throw new Error('公開網站輸出必須位於工作區內的獨立資料夾。');
  }
}

async function workspaceTarget(outputDir, workspace) {
  requireContainedPath(root, outputDir);
  // Walk from the actual workspace. Reject junctions before creating or moving files.
  let parent = workspace;
  const parts = relative(root, dirname(outputDir)).split(sep).filter(Boolean);
  for (const part of parts) {
    const next = resolve(parent, part);
    let info;
    try { info = await lstat(next); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await mkdir(next);
      info = await lstat(next);
    }
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('公開網站輸出路徑不能包含符號連結或非資料夾。');
    parent = await realpath(next);
    requireContainedPath(workspace, parent);
  }
  const target = resolve(parent, basename(outputDir));
  requireContainedPath(workspace, target);
  return target;
}

async function validateOutputDirectory(outputDir, workspace, complete = false, includeTeamspace = false) {
  requireContainedPath(workspace, outputDir);
  let info;
  try { info = await lstat(outputDir); }
  catch (error) { if (error.code === 'ENOENT' && !complete) return { exists: false, legacy: false }; throw error; }
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('公開網站輸出不能使用符號連結或非資料夾。');
  requireContainedPath(workspace, await realpath(outputDir));
  // Refuse unknown files instead of accidentally packaging an internal deployment.
  const entries = await readdir(outputDir, { withFileTypes: true });
  const permitted = complete
    ? ['index.html', '.nojekyll', ...(includeTeamspace ? ['teamspace'] : [])]
    : ['index.html', 'data', '.nojekyll', 'teamspace', 'internal'];
  if (entries.some((entry) => !permitted.includes(entry.name)
    || (['data', 'teamspace', 'internal'].includes(entry.name) ? !entry.isDirectory() : !entry.isFile()))
    || (complete && entries.length !== 2 + Number(includeTeamspace))) {
    throw new Error('輸出資料夾含有未允許的檔案，請選擇獨立的公開網站資料夾。');
  }
  const dataPath = resolve(outputDir, 'data');
  try {
    const dataEntries = await readdir(dataPath, { withFileTypes: true });
    if (dataEntries.some((entry) => entry.name !== 'schedule.json' || !entry.isFile())
      || dataEntries.length !== 1) {
      throw new Error('公開資料資料夾含有未允許的檔案。');
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Accept the exact old entry only while validating an existing output, so
  // migration can replace it atomically without publishing an old route alias.
  for (const entryName of ['teamspace', 'internal']) {
    if (!entries.some((entry) => entry.name === entryName)) continue;
    const entryPath = resolve(outputDir, entryName);
    const entryInfo = await lstat(entryPath);
    if (entryInfo.isSymbolicLink() || !entryInfo.isDirectory()) throw new Error('團隊入口不能使用符號連結或非資料夾。');
    requireContainedPath(workspace, await realpath(entryPath));
    const entryFiles = await readdir(entryPath, { withFileTypes: true });
    if (entryFiles.length !== 1 || entryFiles[0].name !== 'index.html' || !entryFiles[0].isFile()) {
      throw new Error('團隊入口資料夾含有未允許的檔案。');
    }
  }
  return { exists: true, legacy: entries.some((entry) => ['data', 'internal'].includes(entry.name)) };
}

async function removeOwnedDirectory(directory, workspace) {
  requireContainedPath(workspace, directory);
  if (!basename(directory).startsWith('.pm-studio-public-')) throw new Error('暫存清理路徑無效。');
  let info;
  try { info = await lstat(directory); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('暫存清理路徑無效。');
  const actual = await realpath(directory);
  requireContainedPath(workspace, actual);
  if (relative(actual, directory)) throw new Error('暫存清理路徑已變更。');
  await rm(actual, { recursive: true, force: true });
}

export async function buildPublicSite({
  appUrl = process.env.PM_STUDIO_APP_URL,
  teamspaceAppUrl = process.env.PM_STUDIO_TEAMSPACE_APP_URL,
  outputDir = resolve(root, 'local/public-site'),
  renderEntry = renderPublicEntry,
  renderTeamspace = renderTeamspaceEntry,
  installDirectory = rename,
} = {}) {
  const verifiedUrl = validateAppUrl(appUrl);
  const verifiedTeamspaceUrl = teamspaceAppUrl === undefined || teamspaceAppUrl === ''
    ? undefined : validateTeamspaceAppUrl(teamspaceAppUrl);
  const workspace = await realpath(root);
  const target = await workspaceTarget(resolve(outputDir), workspace);
  await validateOutputDirectory(target, workspace);
  const staging = await mkdtemp(resolve(dirname(target), '.pm-studio-public-stage-'));
  let backupRoot, preserveBackup = false, failure;
  const cleanupWarnings = [];
  try {
    requireContainedPath(workspace, await realpath(staging));
    await writeFile(resolve(staging, 'index.html'), await renderEntry(verifiedUrl), { flag: 'wx' });
    await writeFile(resolve(staging, '.nojekyll'), '', { flag: 'wx' });
    if (verifiedTeamspaceUrl) {
      await mkdir(resolve(staging, 'teamspace'));
      await writeFile(resolve(staging, 'teamspace/index.html'), await renderTeamspace(verifiedTeamspaceUrl), { flag: 'wx' });
    }
    await validateOutputDirectory(staging, workspace, true, Boolean(verifiedTeamspaceUrl));
    // Validate again immediately before replacing a previously clean publication.
    const previous = await validateOutputDirectory(target, workspace);
    if (previous.exists) {
      backupRoot = await mkdtemp(resolve(dirname(target), '.pm-studio-public-backup-'));
      requireContainedPath(workspace, await realpath(backupRoot));
      await rename(target, resolve(backupRoot, 'site'));
    }
    try {
      await installDirectory(staging, target);
      // Retain the complete old snapshot site for recovery during migration.
      preserveBackup = previous.legacy;
    } catch (error) {
      if (backupRoot) {
        try { await rename(resolve(backupRoot, 'site'), target); }
        catch (restoreError) {
          preserveBackup = true;
          throw new AggregateError([error, restoreError], `公開網站安裝失敗；原有完整版本已保留於 ${backupRoot}。`);
        }
      }
      throw error;
    }
  } catch (error) { failure = error; }
  finally {
    for (const directory of [staging, ...(backupRoot && !preserveBackup ? [backupRoot] : [])]) {
      try { await removeOwnedDirectory(directory, workspace); }
      catch (error) { cleanupWarnings.push(`暫存資料尚未清除：${directory}（${error.message}）`); }
    }
  }
  if (failure) {
    if (cleanupWarnings.length) throw new AggregateError([failure], `${failure.message}；${cleanupWarnings.join('；')}`);
    throw failure;
  }
  return { outputDir: target,
    ...(preserveBackup ? { previousSiteBackup: resolve(backupRoot, 'site') } : {}),
    ...(cleanupWarnings.length ? { cleanupWarnings } : {}) };
}

function cliOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (flag !== '--output' || !value || value.startsWith('--')
      || Object.hasOwn(options, flag)) throw new Error('用法：設定 PM_STUDIO_APP_URL 後執行 node scripts/build-public-site.mjs [--output <輸出資料夾>]');
    options[flag] = value;
  }
  return { ...(options['--output'] ? { outputDir: options['--output'] } : {}) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await buildPublicSite(cliOptions(process.argv.slice(2)));
    console.log(`公開網站入口已建立：${relative(root, result.outputDir)}。此步驟尚未部署網站。`);
    if (result.previousSiteBackup) console.log(`舊版完整備份：${relative(root, result.previousSiteBackup)}`);
    for (const warning of result.cleanupWarnings || []) console.warn(warning);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
