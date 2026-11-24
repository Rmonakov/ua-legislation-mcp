import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';

const agents = {
  'http:': new http.Agent({ keepAlive: true, maxSockets: 1 }),
  'https:': new https.Agent({ keepAlive: true, maxSockets: 1 }),
};

/**
 * Один GET-запит без автоматичного переходу за перенаправленнями.
 * Повертає { status, headers, body: Buffer } з уже розпакованим тілом.
 */
export function httpGet(url, { headers = {}, timeoutMs = 120000, maxBytes = 120 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(
      u,
      {
        method: 'GET',
        agent: agents[u.protocol],
        headers: { 'Accept-Encoding': 'gzip, deflate', ...headers },
      },
      (res) => {
        const chunks = [];
        let size = 0;
        const enc = String(res.headers['content-encoding'] || '').toLowerCase();
        let stream = res;
        if (enc.includes('gzip')) stream = res.pipe(zlib.createGunzip());
        else if (enc.includes('deflate')) stream = res.pipe(zlib.createInflate());
        else if (enc.includes('br')) stream = res.pipe(zlib.createBrotliDecompress());

        stream.on('data', (c) => {
          size += c.length;
          if (size > maxBytes) {
            req.destroy(new Error(`Відповідь більша за ${Math.round(maxBytes / 1048576)} МБ`));
            return;
          }
          chunks.push(c);
        });
        stream.on('end', () =>
          resolve({ status: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks), wireBytes: Number(res.headers['content-length']) || size }),
        );
        stream.on('error', reject);
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Тайм-аут ${Math.round(timeoutMs / 1000)} с`)));
    req.on('error', reject);
    req.end();
  });
}
