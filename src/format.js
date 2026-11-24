import { SITE_BASE } from './config.js';

/** Довідник станів документа (#stan) бази «Законодавство України». */
export const STATUS_LABELS = {
  0: 'Не визначено',
  1: 'Втратив чинність',
  2: 'Набирає чинності',
  3: 'Дію зупинено',
  4: 'Дію відновлено',
  5: 'Чинний',
  6: 'Не набрав чинності',
  7: 'Не застосовується на території України',
  8: 'Частково набрав чинності',
  9: 'Втратив чинність, крім окремих положень',
};

export function statusLabel(code) {
  const n = Number(code);
  return STATUS_LABELS[n] ?? `Невідомий стан (${code})`;
}

/** 20250828 → 28.08.2025 */
export function fmtDate(ymd) {
  const s = String(ymd ?? '').trim();
  if (!/^\d{8}$/.test(s)) return s || '—';
  return `${s.slice(6, 8)}.${s.slice(4, 6)}.${s.slice(0, 4)}`;
}

/** База позначає «дата набрання чинності ще не визначена» умовною датою 01.01.3000. */
export function isUndeterminedDate(ymd) {
  return /^\d{8}$/.test(String(ymd)) && String(ymd) >= '29990101';
}

/** Дата майбутньої редакції для людини. */
export function fmtEditionDate(ymd) {
  return isUndeterminedDate(ymd) ? 'дата набрання чинності ще не визначена' : fmtDate(ymd);
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV'];

/**
 * Підстава редакції в картці — це код (nreg) акта, що вніс зміни, напр. «4196-20».
 * Для актів Верховної Ради показуємо також звичний номер: «№ 4196-IX (nreg 4196-20)».
 */
export function basisLabel(basis) {
  const b = String(basis ?? '').trim();
  if (!b) return '';
  const m = b.match(/^(\d+)-(\d{2})$/);
  if (m) {
    const conv = Number(m[2]) - 11;
    if (conv >= 1 && conv < ROMAN.length) return `№ ${m[1]}-${ROMAN[conv]} (nreg ${b})`;
  }
  return /^\d+-[IVX]+$/.test(b) ? `№ ${b}` : `nreg ${b}`;
}

/** Приймає «20250828», «28.08.2025», «2025-08-28» → «20250828» або null. */
export function normalizeEdition(input) {
  if (input === undefined || input === null) return null;
  const s = String(input).trim().replace(/^ed/i, '');
  if (!s) return null;
  let m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}${m[2]}${m[3]}`;
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m) return `${m[3]}${m[2].padStart(2, '0')}${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}${m[2]}${m[3]}`;
  throw new Error(`Не вдалося розпізнати дату редакції «${input}». Формат: РРРРММДД або ДД.ММ.РРРР.`);
}

/** Сьогоднішня дата за київським часом у форматі РРРРММДД. */
export function todayYmd(now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Kyiv',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const get = (t) => parts.find((p) => p.type === t)?.value;
    return `${get('year')}${get('month')}${get('day')}`;
  } catch {
    const d = now;
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  }
}

/**
 * Нормалізує код документа (nreg): прибирає адресу сайту, якщо користувач вставив посилання,
 * і зайві пробіли. Повертає { nreg, edition } (edition може бути null).
 */
export function parseDocRef(input) {
  let s = String(input ?? '').trim();
  if (!s) throw new Error('Не вказано код документа (nreg), наприклад 1315-18.');
  let edition = null;
  const at = s.match(/^(.+?)@(\d{8})$/);
  if (at) {
    s = at[1];
    edition = at[2];
  }
  const url = s.match(/^https?:\/\/[^/]+\/(?:laws\/(?:show|card|main)|go)\/(.+)$/i);
  if (url) {
    s = url[1].split(/[?#]/)[0];
    try {
      s = decodeURIComponent(s);
    } catch {
      /* лишаємо як є */
    }
    s = s.replace(/\.(txt|json|htm|html)$/i, '').replace(/\/(card\d*|print)$/i, '');
    const ed = s.match(/^(.+)\/ed(\d{8})$/);
    if (ed) {
      s = ed[1];
      edition = edition || ed[2];
    }
  }
  s = s.replace(/\s+/g, '');
  return { nreg: s, edition };
}

/** Кодуємо кожен сегмент окремо, скісні риски лишаємо (254к/96-вр). */
export function encodeNregPath(nreg) {
  return String(nreg)
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

/** Посилання для людей: конкретна редакція на zakon.rada.gov.ua. */
export function siteLink(nreg, edition) {
  const base = `${SITE_BASE}/laws/show/${nreg}`;
  return edition ? `${base}/ed${edition}` : base;
}

/** Безпечне ім'я файлу для кешу. */
export function safeName(s) {
  return String(s).replace(/[^A-Za-z0-9._-]/g, (c) => `_${c.codePointAt(0).toString(16)}_`);
}

/** Аналіз картки: поточна редакція, майбутні редакції, статус. */
export function summarizeCard(card, { dicts = null, today = todayYmd() } = {}) {
  const eds = Array.isArray(card.eds) ? card.eds : [];
  const editions = eds
    .map((e) => ({
      date: String(e.datred ?? ''),
      basis: (e.pidstava ?? '').toString().trim() || null,
    }))
    .filter((e) => /^\d{8}$/.test(e.date))
    .sort((a, b) => a.date.localeCompare(b.date));
  const future = editions.filter((e) => e.date > today);
  const current = card.poddat ? String(card.poddat) : null;
  const inForce = card.pridat ? String(card.pridat) : null;

  const typeIds = String(card.types ?? '')
    .split('|')
    .map((x) => x.trim())
    .filter(Boolean);
  const typeLabels = dicts?.types ? typeIds.map((id) => dicts.types.get(Number(id)) || id) : [];
  const publisher = dicts?.organs && card.org ? dicts.organs.get(Number(card.org)) || null : null;

  return {
    nreg: card.nreg,
    title: String(card.nazva ?? '').trim(),
    status: { code: Number(card.status ?? 0), label: statusLabel(card.status) },
    number: (card.orgnum ?? '').toString().trim() || null,
    adopted: card.orgdat ? String(card.orgdat) : null,
    currentEdition: current,
    currentEditionInForce: inForce,
    currentBasis: (card.pidstava ?? '').toString().trim() || null,
    editions,
    futureEditions: future,
    types: typeLabels,
    publisher,
    minjust: (card.minjust ?? '').toString().trim() || null,
    isArchive: card.isArchive === true,
    link: siteLink(card.nreg, current),
  };
}

export function cardToText(s) {
  const lines = [];
  lines.push(s.title || '(без назви)');
  lines.push(`nreg: ${s.nreg}`);
  lines.push(`Статус: ${s.status.label}`);
  if (s.types.length) lines.push(`Вид: ${s.types.join(', ')}`);
  if (s.publisher) lines.push(`Видавник: ${s.publisher}`);
  const adopted = [s.adopted ? `від ${fmtDate(s.adopted)}` : null, s.number ? `№ ${s.number}` : null].filter(Boolean);
  if (adopted.length) lines.push(`Реквізити: ${adopted.join(' ')}`);
  if (s.minjust) lines.push(`Реєстрація в Мін'юсті: ${s.minjust}`);
  if (s.currentEdition) {
    let line = `Поточна редакція: від ${fmtDate(s.currentEdition)}`;
    if (s.currentBasis) line += `, підстава ${basisLabel(s.currentBasis)}`;
    lines.push(line);
  }
  if (s.futureEditions.length) {
    lines.push(
      `Майбутні редакції (ще не набрали чинності): ${s.futureEditions
        .map((e) => `${fmtEditionDate(e.date)}${e.basis ? ` — підстава ${basisLabel(e.basis)}` : ''}`)
        .join('; ')}`,
    );
  } else {
    lines.push('Майбутні редакції: не зазначено в картці');
  }
  if (s.isArchive) lines.push('Увага: це архівна копія документа.');
  if (/\(редакц[іїя][^)]*до\s/i.test(s.title)) {
    lines.push('Увага: схоже, це архівна редакція кодексу («редакції до …»), а не чинний текст.');
  }
  const last = s.editions.slice(-12);
  lines.push(`Редакцій у картці: ${s.editions.length}${s.editions.length > last.length ? ` (показано останні ${last.length})` : ''}`);
  for (const e of last) {
    lines.push(`  • ${s.futureEditions.includes(e) ? fmtEditionDate(e.date) : fmtDate(e.date)}${e.basis ? ` — підстава ${basisLabel(e.basis)}` : ''}${e.date === s.currentEdition ? ' ← поточна' : ''}${s.futureEditions.includes(e) ? ' ← майбутня' : ''}`);
  }
  lines.push(`Офіційний текст поточної редакції: ${s.link}`);
  return lines.join('\n');
}
