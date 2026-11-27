import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { RadaClient, RadaError } from '../src/rada-client.js';
import { IndexStore } from '../src/index-store.js';
import { startFakeRada, R_TSV, DOC_TXT } from './fake-rada.js';

let fake;
let tmp;
const mk = (extra = {}) => {
  const cfg = loadConfig({ RADA_BASE_URL: fake.url, RADA_PACE_SECONDS: '0', RADA_CACHE_DIR: fs.mkdtempSync(path.join(tmp, 'c-')), ...extra });
  return { cfg, client: new RadaClient(cfg) };
};

before(async () => {
  fake = await startFakeRada();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ua-leg-'));
});
after(async () => {
  await fake.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('усі запити йдуть з User-Agent OpenData; gzip розпаковується', async () => {
  const { client } = mk();
  const card = await client.getCard('1315-18');
  assert.equal(card.nazva, 'Про стандартизацію');
  assert.ok(fake.requests.every((r) => r.ua === 'OpenData'));
});

test('пауза між запитами витримується і запити йдуть по черзі', async () => {
  const { client } = mk({ RADA_PACE_SECONDS: '0.3' });
  const start = fake.requests.length;
  await Promise.all([client.getCard('1315-18', { fresh: true }), client.getCard('254к/96-вр', { fresh: true }), client.getUpdates()]);
  const reqs = fake.requests.slice(start);
  assert.equal(reqs.length, 3);
  for (let i = 1; i < reqs.length; i++) assert.ok(reqs[i].at - reqs[i - 1].at >= 280, `інтервал ${reqs[i].at - reqs[i - 1].at} мс`);
});

test('картка і текст кешуються; редакція береться з картки', async () => {
  const { client } = mk();
  const n0 = fake.requests.length;
  const t1 = await client.getText('1315-18');
  assert.equal(t1.edition, '20250828');
  assert.equal(t1.fromCache, false);
  assert.ok(!t1.text.startsWith('﻿'));
  const t2 = await client.getText('1315-18');
  assert.equal(t2.fromCache, true);
  assert.equal(fake.requests.length - n0, 2, 'картка + текст, далі все з кешу');
  const old = await client.getText('1315-18', '20200419');
  assert.match(old.text, /обов'язково/);
  const paths = fake.requests.slice(n0).map((r) => r.path);
  assert.ok(paths.includes('/laws/show/1315-18/ed20250828.txt'), 'поточний текст запитується за датою редакції');
});

test('якщо текст за датою недоступний — резерв зі свіжою карткою', async () => {
  const { client } = mk();
  const n0 = fake.requests.length;
  const t = await client.getText('254к/96-вр');
  assert.equal(t.edition, '20200101');
  const paths = fake.requests.slice(n0).map((r) => r.path);
  assert.deepEqual(paths, ['/laws/card/254к/96-вр.json', '/laws/show/254к/96-вр/ed20200101.txt', '/laws/card/254к/96-вр.json', '/laws/show/254к/96-вр.txt']);
  const again = await client.getText('254к/96-вр');
  assert.equal(again.fromCache, true);
});

test('кирилиця і скісна риска в nreg кодуються правильно', async () => {
  const { client } = mk();
  const t = await client.getText('254к/96-вр');
  assert.match(t.text, /КОНСТИТУЦІЯ/);
});

test('зрозумілі помилки: невідомий акт, невідома редакція, 429 і добовий ліміт', async () => {
  const { client } = mk();
  await assert.rejects(client.getCard('no-such'), (e) => e instanceof RadaError && e.kind === 'not_found' && /no-such/.test(e.message));
  await assert.rejects(client.getText('1315-18', '19990101'), (e) => e.kind === 'not_found' && /20250828/.test(e.message));
  await assert.rejects(client.getCard('rate-limit'), (e) => e.kind === 'rate_limited');
  await assert.rejects(client.getCard('1315-18', { fresh: true }), (e) => e.kind === 'rate_limited' && /через/.test(e.message));

  const lim = mk({ RADA_DAILY_LIMIT: '1' });
  await lim.client.getCard('1315-18');
  await assert.rejects(lim.client.getCard('254к/96-вр'), (e) => e.kind === 'daily_limit');
});

test('недоступний сервер → пояснення про українську IP-адресу', async () => {
  const cfg = loadConfig({ RADA_BASE_URL: 'http://127.0.0.1:9', RADA_PACE_SECONDS: '0', RADA_CACHE_DIR: fs.mkdtempSync(path.join(tmp, 'n-')), RADA_TIMEOUT_SECONDS: '10' });
  const client = new RadaClient(cfg);
  await assert.rejects(client.getCard('1315-18'), (e) => e.kind === 'network' && /українською IP/.test(e.message));
});

test('стрічка оновлень і довідники', async () => {
  const { client } = mk();
  const rows = await client.getUpdates();
  assert.equal(rows.length, 4);
  assert.equal(rows[0].nreg, '1315-18');
  assert.equal(rows[0].edition, '20250828');
  assert.equal(rows[0].card, 'Верховна Рада України; Закон від 05.06.2014 № 1315-VII');
  assert.equal(rows[2].nreg, '1178-2022-п');
  assert.equal(rows[3].nreg, 'v0001500-26');
  const dicts = await client.getDicts();
  assert.equal(dicts.types.get(1), 'Закон');
  assert.equal(dicts.organs.get(2), 'Кабінет Міністрів України');
  assert.equal(dicts.pubs.get(19), 'Офіційний вісник України');
});

test('офіційний пошук за назвою: однозначний збіг і кандидати', async () => {
  const { client } = mk();
  assert.equal((await client.findByName('про стандартизацію')).nreg, '1315-18');
  const r = await client.findByName('публічної');
  assert.equal(r.nreg, null);
  assert.deepEqual(r.candidates.map((c) => c.nreg), ['2939-17', '1178-2022-п']);
  assert.equal(r.candidates[0].title, 'Про доступ до публічної інформації');
});

test('локальний індекс: пошук за назвою, номером, роком і датою; архівні копії приховано', async () => {
  const { cfg, client } = mk();
  const idx = new IndexStore(client, cfg);
  assert.equal(await idx.ensure(), 'ready');
  assert.equal(idx.docs.length, 8);
  const r1 = idx.search('стандартизацію');
  assert.equal(r1[0].nreg, '1315-18');
  assert.ok(r1.some((d) => d.nreg === '999-18'));
  assert.equal(idx.search('стандартизацію', { inForceOnly: true }).length, 1);
  assert.equal(idx.search('№ 1315-VII')[0].nreg, '1315-18');
  assert.equal(idx.search('Закон України від 05.06.2014 № 1315-VII')[0].nreg, '1315-18');
  assert.equal(idx.search('стандартизацію 2014')[0].nreg, '1315-18');
  assert.equal(idx.search('1178-2022-п')[0].nreg, '1178-2022-п');
  const civ = idx.search('цивільний кодекс');
  assert.deepEqual(civ.map((d) => d.nreg), ['435-15']);
  assert.equal(idx.search('цивільний кодекс', { includeArchive: true }).length, 2);
  assert.deepEqual(idx.search('неіснуюча назва'), []);
});

test('недоступна для запису тека кешу → тимчасова тека з попередженням', async () => {
  const notADir = path.join(tmp, 'file-not-dir');
  fs.writeFileSync(notADir, 'x');
  const cfg = loadConfig({ RADA_BASE_URL: fake.url, RADA_PACE_SECONDS: '0', RADA_CACHE_DIR: path.join(notADir, 'cache') });
  const client = new RadaClient(cfg);
  assert.match(client.cacheWarning, /недоступна для запису/);
  assert.equal(cfg.cacheDir, path.join(os.tmpdir(), 'ua-legislation-mcp'));
  assert.equal((await client.getCard('1315-18', { fresh: true })).nreg, '1315-18');
});

test('індекс працює з пам\'яті, якщо файл не зберігся, і не завантажується вдруге', async () => {
  const { cfg, client } = mk();
  const idx = new IndexStore(client, cfg);
  const blocker = path.join(tmp, 'blocker-file');
  fs.writeFileSync(blocker, 'x');
  idx.file = path.join(blocker, 'index', 'doc.txt'); // запис неможливий
  const before = fake.requests.filter((r) => r.path.endsWith('/doc.txt')).length;
  assert.equal(await idx.ensure(), 'ready');
  assert.equal(idx.search('стандартизацію')[0].nreg, '1315-18');
  assert.equal(await idx.ensure(), 'ready');
  const after = fake.requests.filter((r) => r.path.endsWith('/doc.txt')).length;
  assert.equal(after - before, 1);
});

test('після невдалого завантаження індексу повтор не раніше ніж за 30 хвилин', async () => {
  const { cfg } = mk();
  let calls = 0;
  const stub = { downloadDump: async () => { calls += 1; throw new Error('boom'); } };
  const idx = new IndexStore(stub, cfg);
  assert.equal(await idx.ensure({ waitMs: 1000 }), 'unavailable');
  assert.equal(await idx.ensure({ waitMs: 1000 }), 'unavailable');
  assert.equal(calls, 1);
  assert.match(idx.lastError.message, /boom/);
});

const ago = (ms) => new Date(Date.now() - ms);
function resetFake() {
  fake.state.rTsv = R_TSV;
  fake.state.docTxt = DOC_TXT;
  fake.state.rTsvCharset = 'utf-8';
  fake.state.etag = true;
  fake.state.lastModified = new Date('2026-07-27T07:57:35Z');
}

test('умовні запити: ETag і Last-Modified зберігаються, на 304 береться кеш; User-Agent — OpenData', async () => {
  resetFake();
  const { cfg, client } = mk();
  const dump = path.join(cfg.cacheDir, 'index', 'doc.txt');
  const n0 = fake.requests.length;
  const first = await client.downloadDump(dump);
  assert.equal(first.notModified, false);
  const meta = JSON.parse(fs.readFileSync(`${dump}.meta.json`, 'utf8'));
  assert.match(meta.etag, /^"[0-9a-f]+"$/);
  assert.equal(meta.lastModified, fake.state.lastModified.toUTCString());
  assert.match(meta.contentType, /widows-1251/);
  const second = await client.downloadDump(dump);
  assert.equal(second.notModified, true);
  assert.ok(second.body.equals(first.body), 'на 304 — збережена копія');
  const reqs = fake.requests.slice(n0);
  assert.deepEqual(reqs.map((r) => r.path), ['/ogd/zak/laws/data/csv/doc.txt', '/ogd/zak/laws/data/csv/doc.txt']);
  assert.equal(reqs[0].inm, undefined, 'перший запит — звичайний');
  assert.equal(reqs[1].inm, meta.etag);
  assert.equal(reqs[1].ims, meta.lastModified);
  assert.ok(reqs.every((r) => r.ua === 'OpenData'));

  // Довідник і стрічка оновлень: у межах строку — з кешу, без запитів.
  await client.getDict('typ');
  await client.getUpdates();
  const n1 = fake.requests.length;
  client._memo.clear();
  await client.getDict('typ');
  await client.getUpdates();
  assert.equal(fake.requests.length, n1);
  // Строк минув — умовний запит, 304, дані з кешу.
  cfg.dictTtlMs = 0;
  cfg.updatesTtlMs = 0;
  client._memo.clear();
  assert.equal((await client.getDict('typ')).get(1), 'Закон');
  assert.equal((await client.getUpdates())[0].nreg, '1315-18');
  const cond = fake.requests.slice(n1);
  assert.deepEqual(cond.map((r) => r.path), ['/ogd/zak/laws/data/csv/typ.txt', '/laws/main/r.tsv']);
  assert.ok(cond.every((r) => r.inm && r.ims && r.ua === 'OpenData'));
});

test('після 304 строк кешу подовжується; змінений файл завантажується заново', async () => {
  resetFake();
  const { cfg, client } = mk();
  const file = path.join(cfg.cacheDir, 'updates.tsv');
  await client.getUpdates();
  fs.utimesSync(file, ago(3600_000), ago(3600_000)); // застарів
  const n0 = fake.requests.length;
  await client.getUpdates(); // умовний запит → 304
  await client.getUpdates(); // строк подовжено → з кешу
  assert.equal(fake.requests.length - n0, 1);
  try {
    fake.state.rTsv = R_TSV.replace('Про тестовий курс', 'Про новий тестовий курс');
    fake.state.lastModified = new Date(fake.state.lastModified.getTime() + 60_000);
    fs.utimesSync(file, ago(3600_000), ago(3600_000));
    const rows = await client.getUpdates();
    assert.equal(rows[3].title, 'Про новий тестовий курс');
    const meta = JSON.parse(fs.readFileSync(`${file}.meta.json`, 'utf8'));
    assert.equal(meta.lastModified, fake.state.lastModified.toUTCString());
  } finally {
    resetFake();
  }
});

test('портал без ETag: умовний запит лише з If-Modified-Since', async () => {
  resetFake();
  fake.state.etag = false;
  try {
    const { cfg, client } = mk();
    await client.getDict('organs');
    const meta = JSON.parse(fs.readFileSync(path.join(cfg.cacheDir, 'dicts', 'organs.txt.meta.json'), 'utf8'));
    assert.equal(meta.etag, null);
    cfg.dictTtlMs = 0;
    client._memo.clear();
    const n0 = fake.requests.length;
    assert.equal((await client.getDict('organs')).get(1), 'Верховна Рада України');
    const [r] = fake.requests.slice(n0);
    assert.equal(r.inm, undefined);
    assert.equal(r.ims, fake.state.lastModified.toUTCString());
  } finally {
    resetFake();
  }
});

test('стрічка оновлень: кодування за Content-Type (портал пише «charset=widows-1251»), і з кешу теж', async () => {
  resetFake();
  fake.state.rTsvCharset = 'widows-1251';
  try {
    const { cfg, client } = mk();
    const rows = await client.getUpdates();
    assert.equal(rows[0].title, 'Про стандартизацію');
    assert.equal(rows[0].card, 'Верховна Рада України; Закон від 05.06.2014 № 1315-VII');
    const n0 = fake.requests.length;
    assert.equal((await client.getUpdates())[1].title, 'Про доступ до публічної інформації', 'з кешу — за збереженим Content-Type');
    assert.equal(fake.requests.length, n0);
    // Кеш попередньої версії (без *.meta.json) — запасна евристика.
    fs.unlinkSync(path.join(cfg.cacheDir, 'updates.tsv.meta.json'));
    assert.equal((await client.getUpdates())[0].title, 'Про стандартизацію');
  } finally {
    resetFake();
  }
});

test('індекс: застарілий перелік перевіряється умовним запитом; на 304 не перечитується', async () => {
  resetFake();
  const { cfg, client } = mk();
  const idx = new IndexStore(client, cfg);
  assert.equal(await idx.ensure(), 'ready');
  const docsBefore = idx.docs;
  fs.utimesSync(idx.file, ago(8 * 86_400_000), ago(8 * 86_400_000));
  idx._loadedAt = ago(8 * 86_400_000).getTime();
  const n0 = fake.requests.length;
  assert.equal(await idx.ensure(), 'ready', 'старий індекс доступний, поки йде перевірка');
  if (idx._building) await idx._building;
  const reqs = fake.requests.slice(n0);
  assert.deepEqual(reqs.map((r) => r.path), ['/ogd/zak/laws/data/csv/doc.txt']);
  assert.ok(reqs[0].inm);
  assert.equal(idx.docs, docsBefore, 'той самий індекс у пам\'яті');
  assert.ok(idx._fileAge() < 60_000, 'строк локальної копії подовжено');
  assert.ok(Date.now() - idx._loadedAt < 60_000);
});
