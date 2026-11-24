import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startFakeRada } from './fake-rada.js';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cli.js');
let fake;
let tmp;

before(async () => {
  fake = await startFakeRada();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ua-leg-mcp-'));
});
after(async () => {
  await fake.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const env = (dir) => ({ ...process.env, RADA_BASE_URL: fake.url, RADA_PACE_SECONDS: '0', RADA_CACHE_DIR: dir });
const text = (r) => r.content.map((c) => c.text).join('\n');

test('stdio: інструменти, інструкції й робочі виклики', async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: [CLI], env: env(fs.mkdtempSync(path.join(tmp, 's-'))) });
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(transport);
  try {
    assert.match(client.getInstructions() || '', /Законодавство України/);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, ['check_act_editions', 'get_act_card', 'get_act_text', 'list_recent_updates', 'search_acts', 'service_status']);
    assert.ok(tools.every((t) => t.annotations?.readOnlyHint === true));

    const s = await client.callTool({ name: 'search_acts', arguments: { query: 'про стандартизацію' } });
    assert.match(text(s), /1315-18 — Про стандартизацію/);
    assert.match(text(s), /Закон \| Верховна Рада України \| від 05\.06\.2014 № 1315-VII/);

    const card = await client.callTool({ name: 'get_act_card', arguments: { nreg: 'https://zakon.rada.gov.ua/laws/show/1315-18' } });
    const ct = text(card);
    assert.match(ct, /Статус: Чинний/);
    assert.match(ct, /Поточна редакція: від 28\.08\.2025, підстава № 4196-IX \(nreg 4196-20\)/);
    assert.match(ct, /Майбутні редакції \(ще не набрали чинності\): дата набрання чинності ще не визначена — підстава № 3153-IX \(nreg 3153-20\)/);
    assert.doesNotMatch(ct, /3000/);
    assert.doesNotMatch(ct, /Дата набрання чинності поточною редакцією/);
    assert.match(ct, /Вид: Закон/);

    const art = await client.callTool({ name: 'get_act_text', arguments: { nreg: '1315-18', article: '23' } });
    const at = text(art);
    assert.match(at, /Редакція від 28\.08\.2025/);
    assert.match(at, /Офіційний текст: https:\/\/zakon\.rada\.gov\.ua\/laws\/show\/1315-18\/ed20250828/);
    assert.match(at, /Увага: є майбутні редакції — дата набрання чинності ще не визначена \(підстава № 3153-IX/);
    assert.match(at, /Стаття 23\. Тестова стаття[\s\S]*добровільно/);
    assert.doesNotMatch(at, /Стаття 24/);

    const old = await client.callTool({ name: 'get_act_text', arguments: { nreg: '1315-18', article: '23', edition: '19.04.2020' } });
    assert.match(text(old), /не поточна; поточна — від 28\.08\.2025/);
    assert.match(text(old), /обов'язково/);

    const f = await client.callTool({ name: 'get_act_text', arguments: { nreg: '1315-18', find: 'добровільно' } });
    assert.match(text(f), /\[Стаття 23\. Тестова стаття\]/);

    const o = await client.callTool({ name: 'get_act_text', arguments: { nreg: '1315-18', outline: true } });
    assert.match(text(o), /Зміст \(7\)/);

    const pg = await client.callTool({ name: 'get_act_text', arguments: { nreg: '1315-18', max_chars: 1000 } });
    assert.match(text(pg), /ЗАКОН УКРАЇНИ/);

    const chk = await client.callTool({ name: 'check_act_editions', arguments: { acts: [{ nreg: '1315-18', edition: '20200419' }, { nreg: '254к/96-вр', edition: '20200101' }] } });
    const kt = text(chk);
    assert.match(kt, /змінилось: 1/);
    assert.match(kt, /ЗМІНИЛОСЬ: у документі редакція від 19\.04\.2020, поточна — від 28\.08\.2025/);
    assert.match(kt, /Конституція України[\s\S]*= поточна/);

    const upd = await client.callTool({ name: 'list_recent_updates', arguments: { nregs: ['1315-18'] } });
    assert.match(text(upd), /Про стандартизацію — Верховна Рада України; Закон від 05\.06\.2014 № 1315-VII\n   nreg 1315-18 \| Чинний \| редакція від 28\.08\.2025/);
    assert.match(text(upd), /збігів: 1/);

    const bad = await client.callTool({ name: 'get_act_card', arguments: { nreg: 'no-such' } });
    assert.equal(bad.isError, true);
    assert.match(text(bad), /не знайдено/);

    const st = await client.callTool({ name: 'service_status', arguments: {} });
    assert.match(text(st), /Запитів сьогодні: \d+/);
  } finally {
    await client.close();
  }
});

async function startHttp(dir, extraArgs = []) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [CLI, '--http', '--port', String(port), ...extraArgs], { env: env(dir), stdio: ['ignore', 'ignore', 'pipe'] });
  await new Promise((resolve, reject) => {
    let buf = '';
    const t = setTimeout(() => reject(new Error(`HTTP server did not start: ${buf}`)), 10000);
    child.stderr.on('data', (d) => {
      buf += d;
      if (buf.includes('HTTP-сервер запущено')) {
        clearTimeout(t);
        resolve();
      }
    });
    child.on('exit', (c) => reject(new Error(`exited ${c}: ${buf}`)));
  });
  return { port, child };
}

test('HTTP (для ChatGPT): секретний шлях, search/fetch, стан', async () => {
  const { port, child } = await startHttp(fs.mkdtempSync(path.join(tmp, 'h-')), ['--secret', 's3cr3t']);
  try {
    const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    assert.equal(health.ok, true);
    const wrong = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(wrong.status, 404);
    const get = await fetch(`http://127.0.0.1:${port}/mcp/s3cr3t`);
    assert.equal(get.status, 405);
    assert.match((await get.json()).error.message, /MCP-сервер працює/);

    const client = new Client({ name: 'test-http', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp/s3cr3t`)));
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    assert.ok(names.includes('search') && names.includes('fetch') && names.includes('get_act_text'));

    const s = await client.callTool({ name: 'search', arguments: { query: 'стандартизацію' } });
    assert.ok(s.structuredContent.results.length >= 1);
    assert.deepEqual(JSON.parse(s.content[0].text), s.structuredContent);
    const first = s.structuredContent.results[0];
    assert.equal(first.id, '1315-18');
    assert.equal(first.url, 'https://zakon.rada.gov.ua/laws/show/1315-18/ed20250828');

    const f = await client.callTool({ name: 'fetch', arguments: { id: '1315-18@20200419' } });
    assert.equal(f.structuredContent.id, '1315-18@20200419');
    assert.match(f.structuredContent.text, /обов'язково/);
    assert.equal(f.structuredContent.url, 'https://zakon.rada.gov.ua/laws/show/1315-18/ed20200419');
    assert.equal(f.structuredContent.metadata.future_editions, '30000101');
    await client.close();

    // Bearer-токен на /mcp теж приймається
    const c2 = new Client({ name: 'test-bearer', version: '1.0.0' });
    await c2.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), { requestInit: { headers: { Authorization: 'Bearer s3cr3t' } } }));
    assert.ok((await c2.listTools()).tools.length >= 8);
    await c2.close();
  } finally {
    child.kill();
  }
});

test('--check повідомляє про доступність порталу', async () => {
  const run = (baseUrl) =>
    new Promise((resolve) => {
      const p = spawn(process.execPath, [CLI, '--check'], { env: { ...env(fs.mkdtempSync(path.join(tmp, 'k-'))), RADA_BASE_URL: baseUrl, RADA_TIMEOUT_SECONDS: '10' } });
      let out = '';
      p.stdout.on('data', (d) => (out += d));
      p.stderr.on('data', (d) => (out += d));
      p.on('exit', (code) => resolve({ code, out }));
    });
  const okRun = await run(fake.url);
  assert.equal(okRun.code, 0, okRun.out);
  assert.match(okRun.out, /Конституція України/);
  const badRun = await run('http://127.0.0.1:9');
  assert.equal(badRun.code, 1);
  assert.match(badRun.out, /НЕ ВДАЛОСЯ/);
});
