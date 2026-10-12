import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { realpath as realpathCallback } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { parseFeedCsv, snapshotFromFeedRows } from './public-snapshot.mjs';

const canonicalPath = (path) => new Promise((resolvePath, reject) => realpathCallback(path, (error, result) => error ? reject(error) : resolvePath(result)));
const activeExports = new Set();

export async function exportPublicSnapshot({ feedPath, outputPath, publishedAt = new Date().toISOString() } = {}) {
  if (!feedPath || !outputPath) throw new Error('請明確指定已核准匿名表的匯出檔與輸出位置。');
  const input = resolve(feedPath), output = resolve(outputPath);
  const comparePath = (path) => process.platform === 'win32' ? path.toLowerCase() : path;
  const actualInput = await canonicalPath(input);
  let actualOutput = output;
  try { actualOutput = await canonicalPath(output); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (comparePath(input) === comparePath(output) || comparePath(actualInput) === comparePath(actualOutput)) throw new Error('輸出不可覆蓋匿名表匯出來源。');
  const content = (await readFile(input, 'utf8')).replace(/^\uFEFF/u, '');
  let rows;
  if (extname(input).toLowerCase() === '.csv') rows = parseFeedCsv(content);
  else {
    const value = JSON.parse(content);
    if (Array.isArray(value)) rows = value;
    else if (value && Object.keys(value).length === 1 && Array.isArray(value.values)) rows = value.values;
    else throw new Error('匿名匯出 JSON 必須只包含資料列或 values。');
  }
  const snapshot = snapshotFromFeedRows(rows, publishedAt);
  await mkdir(dirname(output), { recursive: true });
  const outputKey = comparePath(actualOutput);
  if (activeExports.has(outputKey)) throw new Error('此公開快照正在匯出，請完成後再試。');
  activeExports.add(outputKey);
  const temporary = `${output}.tmp-${randomUUID()}`;
  let created = false;
  try {
    await writeFile(temporary, JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx' });
    created = true;
    await rename(temporary, output);
  } finally {
    try { if (created) await rm(temporary, { force: true }); }
    finally { activeExports.delete(outputKey); }
  }
  return snapshot;
}

export async function main(args = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = { '--feed': 'feedPath', '--output': 'outputPath', '--published-at': 'publishedAt' }[args[i]];
    if (!key || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('使用 --feed <匿名表 CSV 或 JSON> --output <公開快照 JSON> [--published-at <UTC 時間>]。');
    if (Object.hasOwn(options, key)) throw new Error('參數不可重複。');
    options[key] = args[i + 1];
  }
  const snapshot = await exportPublicSnapshot(options);
  console.log(`公開快照已匯出：${snapshot.projects.length} 筆；發布時間 ${snapshot.publishedAt}。`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('公開快照匯出失敗。請核對檔案、六欄匿名表結構與內容；既有公開檔不會以示意資料取代。'); process.exitCode = 1; });
}
