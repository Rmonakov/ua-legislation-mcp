import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeCp1251, decodeCp1251Fallback } from '../src/cp1251.js';
import { normalizeArticleId, extractArticle, findInText, outline, page } from '../src/text.js';
import { parseDocRef, normalizeEdition, summarizeCard, encodeNregPath, siteLink, fmtDate, basisLabel, fmtEditionDate } from '../src/format.js';
import { loadConfig, defaultCacheDir } from '../src/config.js';
import { parseDocLine, normalizeForSearch } from '../src/index-store.js';
import { TEXT_1315_CURRENT, CARD_1315, encodeCp1251 } from './fake-rada.js';

test('cp1251: резервний декодер збігається з вбудованим і правильно читає українські літери', () => {
  const all = Buffer.from([...Array(256).keys()]);
  const fb = decodeCp1251Fallback(all);
  assert.equal(fb.length, 256);
  let native = null;
  try {
    native = new TextDecoder('windows-1251').decode(all);
  } catch {
    /* без ICU */
  }
  if (native) assert.equal(fb, native);
  const s = 'Ґанок, їжак, єнот, Іван — № 5 «тест»';
  assert.equal(decodeCp1251(encodeCp1251(s)), s);
});

test('номер статті нормалізується', () => {
  assert.equal(normalizeArticleId('23'), '23');
  assert.equal(normalizeArticleId('Стаття 23.'), '23');
  assert.equal(normalizeArticleId('23¹'), '23-1');
  assert.equal(normalizeArticleId('23 – 1'), '23-1');
  assert.equal(normalizeArticleId('ст. 23-1'), '23-1');
});

test('витяг статті: межі, примітки, розділ', () => {
  const a = extractArticle(TEXT_1315_CURRENT, '23');
  assert.equal(a.found, true);
  assert.match(a.text, /^Стаття 23\. Тестова стаття/);
  assert.match(a.text, /в редакції Закону № 4196-IX/);
  assert.match(a.text, /Друга частина/);
  assert.doesNotMatch(a.text, /Стаття 23-1/);
  assert.equal(a.section, 'Розділ II. ОРГАНИ СТАНДАРТИЗАЦІЇ');
  const b = extractArticle(TEXT_1315_CURRENT, '23¹');
  assert.equal(b.found, true);
  assert.match(b.text, /Додаткова стаття/);
  const c = extractArticle(TEXT_1315_CURRENT, '25');
  assert.equal(c.found, false);
  const d = extractArticle(TEXT_1315_CURRENT, '23-5');
  assert.equal(d.found, false);
  assert.ok(d.suggestions.some((s) => s.startsWith('Стаття 23')));
});

test('пошук у тексті показує статтю і контекст; зміст; сторінки', () => {
  const r = findInText(TEXT_1315_CURRENT, 'добровільно');
  assert.equal(r.total, 1);
  assert.equal(r.matches[0].article, 'Стаття 23. Тестова стаття');
  assert.match(r.matches[0].snippet, /добровільно/);
  const o = outline(TEXT_1315_CURRENT);
  assert.deepEqual(
    o.items.map((i) => i.text),
    ['Розділ I. ЗАГАЛЬНІ ПОЛОЖЕННЯ', 'Стаття 1. Визначення термінів', 'Стаття 2. Сфера дії Закону', 'Розділ II. ОРГАНИ СТАНДАРТИЗАЦІЇ', 'Стаття 23. Тестова стаття', 'Стаття 23-1. Додаткова стаття', 'Стаття 24. Прикінцеві положення'],
  );
  const sec = findInText(TEXT_1315_CURRENT, 'органи');
  assert.equal(sec.matches[0].article, 'Розділ II. ОРГАНИ СТАНДАРТИЗАЦІЇ', 'назва розділу не належить попередній статті');
  const p = page('abcdef', 2, 3);
  assert.deepEqual([p.chunk, p.start, p.end, p.more], ['cde', 2, 5, true]);
});

test('розбір посилань і кодів документів', () => {
  assert.deepEqual(parseDocRef('1315-18'), { nreg: '1315-18', edition: null });
  assert.deepEqual(parseDocRef('1315-18@20200419'), { nreg: '1315-18', edition: '20200419' });
  assert.deepEqual(parseDocRef('https://zakon.rada.gov.ua/laws/show/1315-18/ed20250828#n123'), { nreg: '1315-18', edition: '20250828' });
  assert.deepEqual(parseDocRef('https://zakon.rada.gov.ua/laws/show/254%D0%BA/96-%D0%B2%D1%80'), { nreg: '254к/96-вр', edition: null });
  assert.deepEqual(parseDocRef('https://zakon.rada.gov.ua/go/1178-2022-п'), { nreg: '1178-2022-п', edition: null });
  assert.deepEqual(parseDocRef('https://zakon.rada.gov.ua/laws/show/1315-18/print'), { nreg: '1315-18', edition: null });
  assert.equal(encodeNregPath('254к/96-вр'), '254%D0%BA/96-%D0%B2%D1%80');
  assert.equal(siteLink('1315-18', '20250828'), 'https://zakon.rada.gov.ua/laws/show/1315-18/ed20250828');
  assert.equal(normalizeEdition('28.08.2025'), '20250828');
  assert.equal(normalizeEdition('ed20250828'), '20250828');
  assert.equal(normalizeEdition('2025-08-28'), '20250828');
  assert.equal(normalizeEdition(undefined), null);
  assert.throws(() => normalizeEdition('вчора'));
  assert.equal(fmtDate('20250828'), '28.08.2025');
});

test('картка: поточна і майбутні редакції', () => {
  const s = summarizeCard(CARD_1315, { today: '20261124' });
  assert.equal(s.currentEdition, '20250828');
  assert.equal(s.status.label, 'Чинний');
  assert.deepEqual(s.futureEditions.map((e) => e.date), ['30000101']);
  assert.equal(s.futureEditions[0].basis, '3153-20');
  assert.equal(fmtEditionDate('30000101'), 'дата набрання чинності ще не визначена');
  assert.equal(fmtEditionDate('20270101'), '01.01.2027');
  assert.equal(basisLabel('4196-20'), '№ 4196-IX (nreg 4196-20)');
  assert.equal(basisLabel('2581-19'), '№ 2581-VIII (nreg 2581-19)');
  assert.equal(basisLabel('4196-IX'), '№ 4196-IX');
  assert.equal(basisLabel('1178-2022-п'), 'nreg 1178-2022-п');
  assert.equal(basisLabel(null), '');
  assert.equal(s.link, 'https://zakon.rada.gov.ua/laws/show/1315-18/ed20250828');
});

test('налаштування: до офіційного порталу пауза не менша за 5 с', () => {
  assert.equal(loadConfig({ RADA_PACE_SECONDS: '1' }).paceMs, 5000);
  assert.equal(loadConfig({}).paceMs, 6000);
  assert.equal(loadConfig({ RADA_PACE_SECONDS: '' }).paceMs, 6000);
  assert.equal(loadConfig({ RADA_BASE_URL: 'http://127.0.0.1:1', RADA_PACE_SECONDS: '0' }).paceMs, 0);
  assert.equal(loadConfig({ RADA_DAILY_LIMIT: '999999' }).dailyRequestLimit, 100000);
});

test('налаштування: незамінені шаблони Claude Desktop і відносні шляхи ігноруються', () => {
  const c = loadConfig({ RADA_CACHE_DIR: '${user_config.cache_dir}', RADA_PACE_SECONDS: '${user_config.pace_seconds}', RADA_DAILY_LIMIT: '${user_config.daily_limit}' });
  assert.equal(c.cacheDir, defaultCacheDir());
  assert.equal(c.paceMs, 6000);
  assert.equal(c.dailyRequestLimit, 2000);
  assert.equal(loadConfig({ RADA_CACHE_DIR: 'relative/dir' }).cacheDir, defaultCacheDir());
});

test('рядок дампу doc.txt: назва з табуляціями, видавник, номер', () => {
  const d = parseDocLine('8\t100-20\tПро\tтест\tз табуляцією\t5\t1\t1:20200101:100-IX\t\t0\t20200101');
  assert.equal(d.nreg, '100-20');
  assert.equal(d.title, 'Про тест з табуляцією');
  assert.equal(d.status, 5);
  assert.deepEqual(d.organs, [{ org: 1, date: '20200101', num: '100-IX' }]);
  assert.equal(normalizeForSearch('Про «Тест» — №5'), 'про тест - 5');
});
