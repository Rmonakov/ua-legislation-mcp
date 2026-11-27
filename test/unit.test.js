import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { decodeCp1251, decodeCp1251Fallback, charsetOf, decodeText } from '../src/cp1251.js';
import { normalizeArticleId, extractArticle, findInText, outline, page } from '../src/text.js';
import { parseDocRef, normalizeEdition, summarizeCard, cardToText, encodeNregPath, siteLink, fmtDate, basisLabel, fmtEditionDate, fmtFutureEdition, parsePublications, publicationLabel } from '../src/format.js';
import { loadConfig, defaultCacheDir, VERSION } from '../src/config.js';
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

const clone = (o) => JSON.parse(JSON.stringify(o));
const PUBS = new Map([[1, 'Відомості Верховної Ради України'], [8, 'Голос України'], [9, "Урядовий кур'єр"], [19, 'Офіційний вісник України']]);

test('1. is_archive: портал віддає 0 | 1 (а не isArchive: true)', () => {
  assert.equal(CARD_1315.is_archive, 0, 'фікстура — справжня картка');
  assert.equal(summarizeCard(CARD_1315).isArchive, false);
  assert.doesNotMatch(cardToText(summarizeCard(CARD_1315)), /архівна копія/);
  const arch = { ...clone(CARD_1315), is_archive: 1 };
  assert.equal(summarizeCard(arch).isArchive, true);
  assert.match(cardToText(summarizeCard(arch)), /Увага: картка позначена як архівна копія документа\./);
  assert.equal(summarizeCard({ ...clone(CARD_1315), is_archive: '1' }).isArchive, true);
  const old = clone(CARD_1315);
  delete old.is_archive;
  old.isArchive = true; // такого поля портал не має
  assert.equal(summarizeCard(old).isArchive, false);
});

test('2. коментар до майбутньої редакції: eds[].comment, запасний — hist[].comments', () => {
  const s = summarizeCard(CARD_1315, { today: '20261128' });
  assert.equal(s.futureEditions.length, 1);
  const fe = s.futureEditions[0];
  assert.deepEqual([fe.date, fe.basis, fe.comment], ['30000101', '3153-20', 'з дня припинення чи скасування воєнного стану']);
  assert.equal(fmtFutureEdition(fe), '«з дня припинення чи скасування воєнного стану» (дата не визначена)');
  const text = cardToText(s);
  assert.match(text, /Майбутні редакції \(ще не набрали чинності\): «з дня припинення чи скасування воєнного стану» \(дата не визначена\), підстава № 3153-IX \(nreg 3153-20\)/);
  assert.match(text, /  • «з дня припинення чи скасування воєнного стану» \(дата не визначена\) — підстава № 3153-IX \(nreg 3153-20\) ← майбутня/);

  // Якщо в eds коментаря немає — береться з hist[].comments без службового «! ».
  const noEdsComment = clone(CARD_1315);
  for (const e of noEdsComment.eds) delete e.comment;
  assert.equal(summarizeCard(noEdsComment, { today: '20261128' }).futureEditions[0].comment, 'з дня припинення чи скасування воєнного стану');

  // Без коментаря ніде — як раніше.
  const bare = clone(noEdsComment);
  for (const h of bare.hist) delete h.comments;
  const b = summarizeCard(bare, { today: '20261128' }).futureEditions[0];
  assert.equal(b.comment, null);
  assert.equal(fmtFutureEdition(b), 'дата набрання чинності ще не визначена');
  assert.equal(fmtFutureEdition({ date: '20270101', comment: null }), '01.01.2027');
  assert.equal(fmtFutureEdition({ date: '20270101', comment: 'крім статті 5' }), '01.01.2027 («крім статті 5»)');
  // Минулі редакції без коментарів — без змін.
  assert.ok(s.editions.filter((e) => e.date !== '30000101').every((e) => e.comment === null));
});

test('3. офіційне опублікування: publics «дата:код_видання:реквізити|…» і довідник pubs', () => {
  const list = parsePublications(CARD_1315.publics);
  assert.deepEqual(list, [
    { date: '20140703', source: '8', ref: '№ 124' },
    { date: '20140709', source: '9', ref: '№ 121' },
    { date: '20140715', source: '19', ref: '2014 р., № 54, стор. 32, стаття 1440, код акта 73066/2014' },
    { date: '20140801', source: '1', ref: '2014 р., № 31, стор. 2405, стаття 1058' },
  ]);
  assert.deepEqual(parsePublications(''), []);
  assert.deepEqual(parsePublications(undefined), []);
  assert.deepEqual(parsePublications('Тестова публікація'), [{ date: null, source: null, ref: 'Тестова публікація' }]);

  // Без довідника видань: дата й реквізити, код видання — у дужках, назв не вигадуємо.
  const bare = summarizeCard(CARD_1315);
  assert.equal(publicationLabel(bare.publications[0]), '03.07.2014 — № 124 (код видання 8)');
  assert.match(cardToText(bare), /Офіційне опублікування:\n  • 03\.07\.2014 — № 124 \(код видання 8\)\n  • 09\.07\.2014 — № 121 \(код видання 9\)/);

  // З довідником pubs.txt — назви видань.
  const s = summarizeCard(CARD_1315, { dicts: { pubs: PUBS } });
  assert.deepEqual(s.publications.map(publicationLabel), [
    '03.07.2014 — Голос України, № 124',
    "09.07.2014 — Урядовий кур'єр, № 121",
    '15.07.2014 — Офіційний вісник України, 2014 р., № 54, стор. 32, стаття 1440, код акта 73066/2014',
    '01.08.2014 — Відомості Верховної Ради України, 2014 р., № 31, стор. 2405, стаття 1058',
  ]);
  // Код, якого немає в довіднику, показується як код.
  assert.equal(publicationLabel(summarizeCard({ ...clone(CARD_1315), publics: '20200101:77:№ 5' }, { dicts: { pubs: PUBS } }).publications[0]), '01.01.2020 — № 5 (код видання 77)');
  // Картка без publics — рядка немає.
  assert.doesNotMatch(cardToText(summarizeCard({ ...clone(CARD_1315), publics: '' })), /опублікування/);
});

test('4. англійська назва (anots[].ann_nam) і законопроєкт (projs[])', () => {
  const s = summarizeCard(CARD_1315);
  assert.equal(s.englishTitle, 'On Standardization');
  assert.deepEqual(s.bills, [{ number: '4585', date: '27.03.2014', title: 'Проект Закону про стандартизацію' }]);
  const t = cardToText(s);
  assert.match(t, /Назва англійською: On Standardization/);
  assert.match(t, /Законопроєкт: № 4585 від 27\.03\.2014/);
  const none = summarizeCard({ ...clone(CARD_1315), anots: [], projs: [] });
  assert.equal(none.englishTitle, null);
  assert.deepEqual(none.bills, []);
  assert.doesNotMatch(cardToText(none), /Назва англійською|Законопроєкт/);
  // Інші поля справжньої картки читаються як раніше.
  assert.equal(s.currentEdition, '20250828');
  assert.equal(s.currentBasis, '4196-20');
  assert.equal(s.editions.length, 15);
  assert.equal(s.number, '1315-VII');
});

test('кодування за Content-Type; евристика «�» — лише якщо charset не зазначено', () => {
  assert.equal(charsetOf('text/plain; charset=widows-1251'), 'cp1251', 'так (з помилкою) пише портал');
  assert.equal(charsetOf('text/plain; charset=windows-1251'), 'cp1251');
  assert.equal(charsetOf('text/plain; charset="CP1251"'), 'cp1251');
  assert.equal(charsetOf('text/tab-separated-values; charset=UTF-8'), 'utf8');
  assert.equal(charsetOf('text/plain'), null);
  assert.equal(charsetOf(null), null);
  const cp = encodeCp1251('Про стандартизацію');
  const utf = Buffer.from('Про стандартизацію', 'utf8');
  assert.equal(decodeText(cp, 'text/plain; charset=widows-1251'), 'Про стандартизацію');
  assert.equal(decodeText(utf, 'text/plain; charset=utf-8'), 'Про стандартизацію');
  // Заголовок має перевагу: справжній «�» у UTF-8 тексті не перемикає на Windows-1251.
  const withReplacement = Buffer.from('Тест \uFFFD символ', 'utf8');
  assert.equal(decodeText(withReplacement, 'text/plain; charset=utf-8'), 'Тест \uFFFD символ');
  // Без charset — евристика.
  assert.equal(decodeText(cp, 'text/plain'), 'Про стандартизацію');
  assert.equal(decodeText(utf, null), 'Про стандартизацію');
});

test('версія — лише в package.json; manifest.json синхронізовано', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.equal(VERSION, pkg.version);
  assert.equal(manifest.version, pkg.version, 'запустіть npm run version:sync');
  assert.doesNotMatch(fs.readFileSync(new URL('../src/config.js', import.meta.url), 'utf8'), /VERSION = '\d/);
});
