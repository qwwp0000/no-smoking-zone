// 极简静态服务器：node start.mjs 然后访问 http://localhost:8080
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] || 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
};

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  let file = path.join(root, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(root)) { res.writeHead(403).end('forbidden'); return; }
  fs.stat(file, (err, st) => {
    if (err || st.isDirectory()) file = path.join(root, 'index.html');
    fs.stat(file, (e2, st2) => {
      if (e2) { res.writeHead(404).end('not found'); return; }
      const total = st2.size;
      const type = TYPES[path.extname(file)] || 'application/octet-stream';
      // 支持 HTTP Range：<audio>/<video> 通常先发带 Range 的请求，服务器不支持范围请求时
      // 媒体的首次加载会被浏览器中止（net::ERR_ABORTED），导致背景音乐播不出来。
      const range = req.headers.range;
      if (range) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
        let start = m && m[1] ? parseInt(m[1], 10) : 0;
        let end = m && m[2] ? parseInt(m[2], 10) : total - 1;
        if (Number.isNaN(start)) start = 0;
        if (Number.isNaN(end) || end >= total) end = total - 1;
        if (start > end || start >= total) {
          res.writeHead(416, { 'Content-Range': `bytes */${total}` }).end();
          return;
        }
        res.writeHead(206, {
          'Content-Type': type,
          'Content-Range': `bytes ${start}-${end}/${total}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
          'Cache-Control': 'no-store, must-revalidate',
        });
        fs.createReadStream(file, { start, end }).pipe(res);
        return;
      }
      res.writeHead(200, {
        'Content-Type': type,
        'Accept-Ranges': 'bytes',
        'Content-Length': total,
        'Cache-Control': 'no-store, must-revalidate',
      });
      fs.createReadStream(file).pipe(res);
    });
  });
}).listen(port, () => {
  console.log(`这不是吸烟区 · 原型已启动：http://localhost:${port}`);
});