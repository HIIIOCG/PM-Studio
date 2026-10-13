import { writeFile, mkdir, readdir, lstat, mkdtemp, rename, rm } from 'node:fs/promises';
import { realpath as resolveFilesystemPath } from 'node:fs';
import { promisify } from 'node:util';
import { basename, dirname, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// The callback resolver follows junctions and works in restricted Windows hosts
// where the native promises resolver cannot open a directory handle.
const realpath = promisify(resolveFilesystemPath);

export function validateAppUrl(value) {
  // Match the original string: URL normalization must not admit credentials,
  // escaped characters, alternate ports, query strings, or a different origin.
  if (typeof value !== 'string' || /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,200}\/exec$/u.exec(value)?.[0] !== value) {
    throw new Error('請以 PM_STUDIO_APP_URL 提供已驗證的 Google Apps Script 正式執行網址。');
  }
  return value;
}

export function renderPublicEntry(appUrl) {
  const url = validateAppUrl(appUrl);
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>PM Studio</title>
<style>
:root{color-scheme:light dark;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#111518;color:#e8ecef}
*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0}iframe{position:fixed;inset:0;width:100%;height:100%;height:100dvh;border:0;background:#111518}
#connection{position:fixed;inset:0;display:grid;place-content:center;padding:24px;text-align:center;pointer-events:none;background:#111518}
#connection[hidden]{display:none}#connection p{margin:8px 0;font-size:14px;line-height:1.6}#connection a{pointer-events:auto;color:inherit}
.open-schedule{position:fixed;right:8px;bottom:8px;padding:5px 9px;border:1px solid #647078;border-radius:6px;background:#192126;color:#dce6ec;font-size:11px;text-decoration:none;opacity:.86}.open-schedule:focus-visible{outline:3px solid #88cced;outline-offset:2px}
</style>
</head>
<body>
<iframe id="schedule" src="${url}" title="PM Studio 專案排程" referrerpolicy="no-referrer"></iframe>
<div id="connection" role="status"><p id="connection-message">正在連接排程…</p><p>若排程未顯示，可<a href="${url}" target="_blank" rel="noopener noreferrer">另開排程</a>。</p></div>
<a class="open-schedule" href="${url}" target="_blank" rel="noopener noreferrer" aria-label="在新分頁開啟排程">另開排程 ↗</a>
<script>
const frame = document.getElementById('schedule');
const connection = document.getElementById('connection');
const message = document.getElementById('connection-message');
const slowLoad = setTimeout(() => { message.textContent = '連接時間較長，請稍候或另開排程。'; }, 20000);
frame.addEventListener('load', () => { clearTimeout(slowLoad); connection.hidden = true; });
frame.addEventListener('error', () => { clearTimeout(slowLoad); connection.hidden = false; message.textContent = '目前無法連接排程，請稍後再試或另開排程。'; });
</script>
<noscript><style>#connection{display:none}</style></noscript>
</body>
</html>
`;
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

async function validateOutputDirectory(outputDir, workspace, complete = false) {
  requireContainedPath(workspace, outputDir);
  let info;
  try { info = await lstat(outputDir); }
  catch (error) { if (error.code === 'ENOENT' && !complete) return { exists: false, legacy: false }; throw error; }
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('公開網站輸出不能使用符號連結或非資料夾。');
  requireContainedPath(workspace, await realpath(outputDir));
  // Refuse unknown files instead of accidentally packaging an internal deployment.
  const entries = await readdir(outputDir, { withFileTypes: true });
  const permitted = complete ? ['index.html', '.nojekyll'] : ['index.html', 'data', '.nojekyll'];
  if (entries.some((entry) => !permitted.includes(entry.name)
    || (entry.name === 'data' ? !entry.isDirectory() : !entry.isFile()))
    || (complete && entries.length !== 2)) {
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
  return { exists: true, legacy: entries.some((entry) => entry.name === 'data') };
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
  outputDir = resolve(root, 'local/public-site'),
  renderEntry = renderPublicEntry,
  installDirectory = rename,
} = {}) {
  const verifiedUrl = validateAppUrl(appUrl);
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
    await validateOutputDirectory(staging, workspace, true);
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
