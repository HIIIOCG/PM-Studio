import { readFile, writeFile, mkdir, readdir, lstat, mkdtemp, rename, rm } from 'node:fs/promises';
import { realpath as resolveFilesystemPath } from 'node:fs';
import { promisify } from 'node:util';
import { basename, dirname, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGoogleUi } from './build-google-ui.mjs';
import { validatePublicSnapshot } from './public-snapshot.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// The callback resolver follows junctions and works in restricted Windows hosts
// where the native promises resolver cannot open a directory handle.
const realpath = promisify(resolveFilesystemPath);

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
  catch (error) { if (error.code === 'ENOENT' && !complete) return false; throw error; }
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('公開網站輸出不能使用符號連結或非資料夾。');
  requireContainedPath(workspace, await realpath(outputDir));
  // Refuse unknown files instead of accidentally packaging an internal deployment.
  const entries = await readdir(outputDir, { withFileTypes: true });
  if (entries.some((entry) => !['index.html', 'data', '.nojekyll'].includes(entry.name)
    || (entry.name === 'data' ? !entry.isDirectory() : !entry.isFile()))
    || (complete && entries.length !== 3)) {
    throw new Error('輸出資料夾含有未允許的檔案，請選擇獨立的公開網站資料夾。');
  }
  const dataPath = resolve(outputDir, 'data');
  try {
    const dataEntries = await readdir(dataPath, { withFileTypes: true });
    if (dataEntries.some((entry) => entry.name !== 'schedule.json' || !entry.isFile())
      || (complete && dataEntries.length !== 1)) {
      throw new Error('公開資料資料夾含有未允許的檔案。');
    }
  } catch (error) { if (error.code !== 'ENOENT' || complete) throw error; }
  return true;
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
  snapshotPath,
  outputDir = resolve(root, 'local/public-site'),
  buildUi = buildGoogleUi,
  installDirectory = rename,
} = {}) {
  if (!snapshotPath) throw new Error('必須以 --snapshot 指定人工核准的匿名排程快照。');
  const snapshot = validatePublicSnapshot(JSON.parse(await readFile(resolve(snapshotPath), 'utf8')));
  const workspace = await realpath(root);
  const target = await workspaceTarget(resolve(outputDir), workspace);
  await validateOutputDirectory(target, workspace);
  const staging = await mkdtemp(resolve(dirname(target), '.pm-studio-public-stage-'));
  let backupRoot, preserveBackup = false, failure;
  const cleanupWarnings = [];
  try {
    requireContainedPath(workspace, await realpath(staging));
    await mkdir(resolve(staging, 'data'));
    await buildUi({ outputDir: staging, packageDir: null, views: ['public'], transport: 'static' });
    await writeFile(resolve(staging, 'data/schedule.json'), `${JSON.stringify(snapshot, null, 2)}\n`, { flag: 'wx' });
    await writeFile(resolve(staging, '.nojekyll'), '', { flag: 'wx' });
    await validateOutputDirectory(staging, workspace, true);
    // Validate again immediately before replacing a previously clean publication.
    if (await validateOutputDirectory(target, workspace)) {
      backupRoot = await mkdtemp(resolve(dirname(target), '.pm-studio-public-backup-'));
      requireContainedPath(workspace, await realpath(backupRoot));
      await rename(target, resolve(backupRoot, 'site'));
    }
    try {
      await installDirectory(staging, target);
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
  return { outputDir: target, projectCount: snapshot.projects.length, publishedAt: snapshot.publishedAt,
    ...(cleanupWarnings.length ? { cleanupWarnings } : {}) };
}

function cliOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!['--snapshot', '--output'].includes(flag) || !value || value.startsWith('--')
      || Object.hasOwn(options, flag)) throw new Error('用法：node scripts/build-public-site.mjs --snapshot <核准快照> [--output <輸出資料夾>]');
    options[flag] = value;
  }
  return { snapshotPath: options['--snapshot'], ...(options['--output'] ? { outputDir: options['--output'] } : {}) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await buildPublicSite(cliOptions(process.argv.slice(2)));
    console.log(`公開網站已建立：${relative(root, result.outputDir)}；共 ${result.projectCount} 案。此步驟尚未部署網站。`);
    for (const warning of result.cleanupWarnings || []) console.warn(warning);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
