import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function startPublicPreview({ directory = resolve('local/public-site'), port = 4320 } = {}) {
  const root = resolve(directory);
  for (const file of ['index.html', 'data/schedule.json']) if (!(await stat(resolve(root, file))).isFile()) throw new Error('請先建置公開網站。');
  const server = createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405); response.end(); return; }
    let path;
    try { path = new URL(request.url, 'http://127.0.0.1').pathname; }
    catch { response.writeHead(400); response.end(); return; }
    if (path === '/' || path === '/PM-Studio') { response.writeHead(302, { Location: '/PM-Studio/' }); response.end(); return; }
    const files = { '/PM-Studio/': ['index.html', 'text/html; charset=utf-8'], '/PM-Studio/index.html': ['index.html', 'text/html; charset=utf-8'], '/PM-Studio/data/schedule.json': ['data/schedule.json', 'application/json; charset=utf-8'] };
    const file = files[path];
    if (!file) { response.writeHead(404); response.end(); return; }
    try {
      const body = await readFile(resolve(root, file[0]));
      response.writeHead(200, { 'Content-Type': file[1], 'Content-Length': body.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch { response.writeHead(503); response.end('無法讀取公開網站。'); }
  });
  await new Promise((resolveReady, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolveReady); });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i + 1]) throw new Error('預覽參數缺少值。');
    if (args[i] === '--directory') options.directory = args[i + 1];
    else if (args[i] === '--port' && /^\d{1,5}$/u.test(args[i + 1])) options.port = Number(args[i + 1]);
    else throw new Error('使用 --directory <公開建置目錄> --port <連接埠>。');
  }
  const server = await startPublicPreview(options);
  console.log(`PM Studio 公開頁預覽：http://127.0.0.1:${server.address().port}/PM-Studio/`);
}
