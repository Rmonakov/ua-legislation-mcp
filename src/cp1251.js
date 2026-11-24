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
