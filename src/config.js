import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Офіційний портал відкритих даних Верховної Ради (машинний канал бази «Законодавство України»). */
export const OFFICIAL_BASE = 'https://data.rada.gov.ua';
/** Сайт для людей: посилання, які показуємо користувачам. */
export const SITE_BASE = 'https://zakon.rada.gov.ua';
/** User-Agent, який портал вимагає для анонімного доступу до TXT/JSON. */
export const USER_AGENT = 'OpenData';
/** Нижня межа паузи між запитами до офіційного порталу (секунди). */
export const MIN_PACE_SECONDS = 5;

export const PACKAGE_NAME = 'ua-legislation-mcp';
/** Версія — лише в package.json (manifest.json оновлює scripts/sync-version.mjs). */
export const VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

/**
 * Порожні значення і незамінені шаблони на кшталт «${user_config.cache_dir}»
 * (так Claude Desktop передає незаповнені необов'язкові поля) вважаємо не заданими.
 */
export function clean(value) {
  if (value === undefined || value === null) return '';
  const s = String(value).trim();
  if (/^\$\{[^}]*\}$/.test(s)) return '';
  return s;
}

function num(value, fallback) {
  const s = clean(value);
  if (s === '') return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

export function defaultCacheDir() {
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(base, PACKAGE_NAME);
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Caches', PACKAGE_NAME);
  }
  const base = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  return path.join(base, PACKAGE_NAME);
}

/**
 * Налаштування читаються зі змінних середовища, щоб однаково працювати
 * в усіх клієнтах MCP (Claude, ChatGPT, Cursor, VS Code, Codex, Gemini CLI тощо).
 */
export function loadConfig(env = process.env) {
  const baseUrl = (clean(env.RADA_BASE_URL) || OFFICIAL_BASE).replace(/\/+$/, '');
  const cacheDirRaw = clean(env.RADA_CACHE_DIR);
  // Відносний шлях залежав би від робочої теки клієнта (у Windows це може бути C:\Windows\System32).
  const cacheDir = cacheDirRaw && path.isAbsolute(cacheDirRaw) ? cacheDirRaw : defaultCacheDir();
  const official = baseUrl === OFFICIAL_BASE;

  let paceSeconds = num(env.RADA_PACE_SECONDS, 6);
  // До офіційного порталу — не частіше одного запиту на 5 секунд, хоч би що задав користувач.
  if (official && paceSeconds < MIN_PACE_SECONDS) paceSeconds = MIN_PACE_SECONDS;
  if (paceSeconds < 0) paceSeconds = 0;

  const dailyLimit = Math.max(1, Math.min(num(env.RADA_DAILY_LIMIT, 2000), 100000));
  const dailyMb = Math.max(1, Math.min(num(env.RADA_DAILY_MB, 150), 200));

  return {
    baseUrl,
    official,
    paceMs: Math.round(paceSeconds * 1000),
    cacheDir,
    dailyRequestLimit: dailyLimit,
    dailyByteLimit: dailyMb * 1024 * 1024,
    cardTtlMs: Math.max(0, num(env.RADA_CARD_TTL_MINUTES, 360)) * 60_000,
    updatesTtlMs: 30 * 60_000,
    dictTtlMs: 30 * 86_400_000,
    indexMaxAgeMs: Math.max(1, num(env.RADA_INDEX_MAX_AGE_DAYS, 7)) * 86_400_000,
    timeoutMs: Math.max(10, num(env.RADA_TIMEOUT_SECONDS, 120)) * 1000,
    // auto: інструменти search/fetch для ChatGPT вмикаються лише в режимі HTTP.
    compatTools: (clean(env.RADA_COMPAT_TOOLS) || 'auto').toLowerCase(),
  };
}
