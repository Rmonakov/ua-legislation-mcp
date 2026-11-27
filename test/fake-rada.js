// Імітація порталу data.rada.gov.ua для тестів.
// Тексти актів вигадані (тестові). Картка 1315-18 — справжня, отримана з порталу (test/fixtures).
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import zlib from 'node:zlib';
import { decodeCp1251Fallback } from '../src/cp1251.js';

let REVERSE = null;
export function encodeCp1251(str) {
  if (!REVERSE) {
    REVERSE = new Map();
    const all = Buffer.from([...Array(256).keys()]);
    const dec = decodeCp1251Fallback(all);
    for (let i = 0; i < 256; i++) REVERSE.set(dec[i], i);
  }
  const out = Buffer.alloc(str.length);
  for (let i = 0; i < str.length; i++) out[i] = REVERSE.get(str[i]) ?? 0x3f;
  return out;
}

export const DOC_TXT = [
  '1\t1315-18\tПро стандартизацію\t5\t1\t1:20140605:1315-VII\t\t0\t20250828',
  '2\t254к/96-вр\tКонституція України\t5\t3\t1:19960628:254к/96-ВР\t\t0\t20200101',
  '3\t1178-2022-п\tПро затвердження Порядку тестування\t5\t5\t2:20221018:1178\t\t0\t20241115',
  '4\t435-15\tЦивільний кодекс України\t5\t7\t1:20030116:435-IV\t\t0\t20251001',
  '5\t435-15a\tЦивільний кодекс України (редакції до 01.01.2004)\t5\t7\t1:20030116:435-IV\t\t0\t20031231',
  '6\t2939-17\tПро доступ до публічної інформації\t5\t1\t1:20110113:2939-VI\t\t0\t20240601',
  '7\t999-18\tПро стандартизацію продукції (тестовий, втратив чинність)\t1\t1\t1:20100101:999-VII\t\t0\t20100101',
  '8\t100-20\tПро\tтест\tз табуляцією\t5\t1\t1:20200101:100-IX\t\t0\t20200101',
].join('\r\n');

export const TYP_TXT = '1\tЗакон\r\n3\tКонституція\r\n5\tПостанова\r\n7\tКодекс\r\n';
export const ORGANS_TXT = '1\tВерховна Рада України\r\n2\tКабінет Міністрів України\r\n';
// Фрагмент довідника видань pubs.txt (коди, що трапляються в полі publics картки).
export const PUBS_TXT = "1\tВідомості Верховної Ради України\r\n8\tГолос України\r\n9\tУрядовий кур'єр\r\n19\tОфіційний вісник України\r\n";

/** Справжня картка /laws/card/1315-18.json (is_archive, eds[].comment, hist[].comments, publics, anots, projs). */
export const CARD_1315 = JSON.parse(fs.readFileSync(new URL('./fixtures/1315-18.card.json', import.meta.url), 'utf8'));

export const CARD_CONST = {
  nreg: '254к/96-вр',
  nazva: 'Конституція України',
  status: 5,
  orgdat: 19960628,
  orgnum: '254к/96-ВР',
  poddat: 20200101,
  eds: [{ datred: 19960628 }, { datred: 20200101 }],
  types: '3',
  org: 1,
};

export const TEXT_1315_CURRENT = [
  'ЗАКОН УКРАЇНИ',
  'Про стандартизацію',
  '{Відомості Верховної Ради (ВВР), 2014, № 31, ст.1058}',
  '{Із змінами, внесеними згідно із Законом',
  ' № 4196-IX від 01.01.2025 (тестові дані)}',
  'Цей Закон установлює тестові правові засади.',
  'Розділ I',
  'ЗАГАЛЬНІ ПОЛОЖЕННЯ',
  'Стаття 1. Визначення термінів',
  '1. Тестове визначення стандарту.',
  'Стаття 2. Сфера дії Закону',
  '1. Тестова сфера дії.',
  'Розділ II',
  'ОРГАНИ СТАНДАРТИЗАЦІЇ',
  'Стаття 23. Тестова стаття',
  '1. Національні стандарти застосовуються добровільно.',
  '{Частина перша статті 23 в редакції Закону № 4196-IX}',
  '2. Друга частина тестової статті.',
  'Стаття 23-1. Додаткова стаття',
  '1. Текст додаткової статті.',
  'Стаття 24. Прикінцеві положення',
  '1. Кінець тестового тексту.',
].join('\r\n');

export const TEXT_1315_2020 = TEXT_1315_CURRENT.replace('застосовуються добровільно', "застосовуються обов'язково").replace(/Стаття 23-1[\s\S]*?(?=Стаття 24)/, '');

export const TEXT_CONST = 'КОНСТИТУЦІЯ УКРАЇНИ\r\nСтаття 1. Тестова стаття конституції.\r\n';

export const R_TSV = [
  'num\tcard\tnazva\tstatus\tpublics\tlink\tsize\tfile',
  '1.\tВерховна Рада України; Закон від 05.06.2014 № 1315-VII\tПро стандартизацію\tЧинний\tТестова публікація\thttps://zakon.rada.gov.ua/go/1315-18/ed20250828\t1000\td1.htm',
  '2.\tВерховна Рада України; Закон від 13.01.2011 № 2939-VI\tПро доступ до публічної інформації\tЧинний\t\thttps://zakon.rada.gov.ua/go/2939-17/ed20240601\t2000\td6.htm',
  '3.\tКабінет Міністрів України; Постанова від 18.10.2022 № 1178\tПро затвердження Порядку тестування\tЧинний\t\thttps://zakon.rada.gov.ua/go/1178-2022-%D0%BF/ed20241115\t500\td3.htm',
  '4.\tНаціональний банк; Повідомлення від 24.11.2026\tПро тестовий курс\tНе визначено\tНе опубліковано\thttps://zakon.rada.gov.ua/go/v0001500-26/ed20261124\t300\td9.htm',
].join('\n');

export function startFakeRada({ gzip = true } = {}) {
  const requests = [];
  // Змінний стан для тестів: вміст файлів, кодування стрічки оновлень, ETag і Last-Modified.
  const state = {
    docTxt: DOC_TXT,
    rTsv: R_TSV,
    rTsvCharset: 'utf-8', // 'utf-8' | 'widows-1251' (так пише портал) | null — без charset
    etag: true,
    lastModified: new Date('2026-07-27T07:57:35Z'),
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = decodeURIComponent(url.pathname);
    requests.push({
      path: p,
      query: url.search,
      ua: req.headers['user-agent'],
      inm: req.headers['if-none-match'],
      ims: req.headers['if-modified-since'],
      at: Date.now(),
    });

    const send = (status, body, type = 'text/plain; charset=utf-8', extra = {}) => {
      let buf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
      const headers = { 'Content-Type': type, ...extra };
      if (gzip && /gzip/.test(req.headers['accept-encoding'] || '')) {
        buf = zlib.gzipSync(buf);
        headers['Content-Encoding'] = 'gzip';
      }
      headers['Content-Length'] = buf.length;
      res.writeHead(status, headers);
      res.end(buf);
    };

    // Великі файли й довідники: ETag / Last-Modified і відповідь 304 на умовний запит.
    const sendConditional = (body, type) => {
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
      const etag = `"${crypto.createHash('md5').update(buf).digest('hex').slice(0, 12)}"`;
      const extra = { 'Last-Modified': state.lastModified.toUTCString() };
      if (state.etag) extra.ETag = etag;
      const inm = req.headers['if-none-match'];
      const ims = req.headers['if-modified-since'];
      let notModified = false;
      if (inm && state.etag) notModified = inm === etag;
      else if (ims) notModified = new Date(ims).getTime() >= state.lastModified.getTime();
      if (notModified) {
        res.writeHead(304, extra);
        return res.end();
      }
      return send(200, buf, type, extra);
    };

    if (req.headers['user-agent'] !== 'OpenData') return send(403, 'Forbidden');

    if (p === '/laws/card/1315-18.json') return send(200, JSON.stringify(CARD_1315), 'application/json');
    if (p === '/laws/card/254к/96-вр.json') return send(200, JSON.stringify(CARD_CONST), 'application/json');
    if (p === '/laws/card/rate-limit.json') return send(429, 'Too Many Requests');
    if (p === '/laws/show/1315-18.txt') return send(200, `﻿${TEXT_1315_CURRENT}`);
    if (p === '/laws/show/1315-18/ed20200419.txt') return send(200, TEXT_1315_2020);
    if (p === '/laws/show/1315-18/ed20250828.txt') return send(200, TEXT_1315_CURRENT);
    if (p === '/laws/show/254к/96-вр.txt') return send(200, TEXT_CONST);
    if (p === '/laws/main/r.tsv') {
      if (state.rTsvCharset === 'widows-1251') return sendConditional(encodeCp1251(state.rTsv), 'text/plain; charset=widows-1251');
      if (state.rTsvCharset === 'utf-8') return sendConditional(state.rTsv, 'text/tab-separated-values; charset=utf-8');
      return sendConditional(state.rTsv, 'text/tab-separated-values');
    }
    if (p === '/ogd/zak/laws/data/csv/doc.txt') return sendConditional(encodeCp1251(state.docTxt), 'text/plain; charset=widows-1251');
    if (p === '/ogd/zak/laws/data/csv/typ.txt') return sendConditional(encodeCp1251(TYP_TXT), 'text/plain; charset=widows-1251');
    if (p === '/ogd/zak/laws/data/csv/organs.txt') return sendConditional(encodeCp1251(ORGANS_TXT), 'text/plain; charset=widows-1251');
    if (p === '/ogd/zak/laws/data/csv/pubs.txt') return sendConditional(encodeCp1251(PUBS_TXT), 'text/plain; charset=widows-1251');
    if (p === '/laws/find/a') {
      const text = url.searchParams.get('text') || '';
      if (/стандартиз/i.test(text)) {
        res.writeHead(302, { Location: '/laws/main/1315-18' });
        return res.end();
      }
      return send(
        200,
        '<html><body><a href="/laws/show/2939-17">Про доступ до <b>публічної</b> інформації</a>' +
          '<a href="/laws/show/1178-2022-%D0%BF">Про затвердження Порядку тестування</a></body></html>',
        'text/html; charset=utf-8',
      );
    }
    return send(404, 'Not found');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}`, requests, state, close: () => new Promise((r) => server.close(r)) });
    });
  });
}
