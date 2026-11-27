// Декодер Windows-1251: дамп doc.txt і довідники порталу публікуються в цьому кодуванні.

const HIGH =
  'ЂЃ‚ѓ„…†‡€‰Љ‹ЊЌЋЏ' +
  'ђ‘’“”•–—\u0098™љ›њќћџ' +
  ' ЎўЈ¤Ґ¦§Ё©Є«¬­®Ї' +
  '°±Ііґµ¶·ё№є»јЅѕї';

let TABLE = null;
function table() {
  if (TABLE) return TABLE;
  TABLE = new Array(256);
  for (let i = 0; i < 128; i++) TABLE[i] = String.fromCharCode(i);
  for (let i = 0; i < 64; i++) TABLE[128 + i] = HIGH[i];
  for (let i = 0; i < 64; i++) TABLE[192 + i] = String.fromCharCode(0x0410 + i);
  return TABLE;
}

/** Декодує байти Windows-1251 у рядок (без залежності від ICU). */
export function decodeCp1251Fallback(buf) {
  const t = table();
  const parts = [];
  const CHUNK = 65536;
  for (let start = 0; start < buf.length; start += CHUNK) {
    const end = Math.min(buf.length, start + CHUNK);
    let s = '';
    for (let i = start; i < end; i++) s += t[buf[i]];
    parts.push(s);
  }
  return parts.join('');
}

let nativeDecoder;
try {
  nativeDecoder = new TextDecoder('windows-1251');
} catch {
  nativeDecoder = null;
}

export function decodeCp1251(buf) {
  if (nativeDecoder) return nativeDecoder.decode(buf);
  return decodeCp1251Fallback(buf);
}

/**
 * Кодування з заголовка Content-Type: 'cp1251', 'utf8' або null (не зазначено / невідоме).
 * Портал пише назву з помилкою («charset=widows-1251»), тому впізнаємо за «1251».
 */
export function charsetOf(contentType) {
  const m = /charset\s*=\s*"?([^";\s]+)/i.exec(String(contentType ?? ''));
  if (!m) return null;
  const cs = m[1].toLowerCase();
  if (/1251/.test(cs)) return 'cp1251';
  if (/^utf-?8$/.test(cs)) return 'utf8';
  return null;
}

/**
 * Декодує відповідь порталу: спершу за Content-Type; якщо кодування не зазначено —
 * запасна евристика (UTF-8, а якщо з'явилися символи заміни «�» — Windows-1251).
 */
export function decodeText(buf, contentType) {
  const cs = charsetOf(contentType);
  if (cs === 'cp1251') return decodeCp1251(buf);
  if (cs === 'utf8') return buf.toString('utf8');
  const text = buf.toString('utf8');
  return text.includes('�') ? decodeCp1251(buf) : text;
}
