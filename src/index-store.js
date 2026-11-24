import fs from 'node:fs';
import path from 'node:path';
import { decodeCp1251 } from './cp1251.js';

// Локальний індекс назв усіх документів бази — з офіційного дампу doc.txt порталу відкритих даних.
// Колонки: dokid, nreg, nazva (може містити табуляції), status, types, organs, minjust, npix, poddat.

export function normalizeForSearch(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[’ʼ`´‘]/g, "'")
    .replace(/[«»"„“”]/g, ' ')
    .replace(/[‐-―]/g, '-')
    .replace(/№/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseDocLine(line) {
  const f = line.split('\t');
  if (f.length < 9) return null;
  const dokid = Number(f[0]);
  if (!Number.isFinite(dokid)) return null;
  const nreg = f[1].trim();
  if (!nreg) return null;
  const n = f.length;
  const title = f.slice(2, n - 6).join(' ').trim();
  const organs = f[n - 4]
    .split('|')
    .filter(Boolean)
    .map((s) => {
      const [org, date, num] = s.split(':');
      return { org: Number(org) || 0, date: date || '', num: (num || '').trim() };
    });
  return {
    nreg,
    title,
    status: Number(f[n - 6]) || 0,
    types: f[n - 5].split('|').map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0),
    organs,
    minjust: f[n - 3].trim(),
    edition: f[n - 1].trim(),
  };
}

export class IndexStore {
  constructor(client, cfg, { log = () => {} } = {}) {
    this.client = client;
    this.cfg = cfg;
    this.log = log;
    this.file = path.join(cfg.cacheDir, 'index', 'doc.txt');
    this.docs = null;
    this.loadedFrom = null;
    this._building = null;
    this.lastError = null;
  }

  _fileAge() {
    try {
      return Date.now() - fs.statSync(this.file).mtimeMs;
    } catch {
      return Infinity;
    }
  }

  _load(buffer = null) {
    const buf = buffer || fs.readFileSync(this.file);
    const text = decodeCp1251(buf);
    const docs = [];
    for (const line of text.split(/\r?\n/)) {
      const d = parseDocLine(line);
      if (!d) continue;
      d.norm = normalizeForSearch(d.title);
      d.numsNorm = d.organs.map((o) => normalizeForSearch(o.num)).filter(Boolean);
      docs.push(d);
    }
    this.docs = docs;
    try {
      this.loadedFrom = buffer ? new Date() : fs.statSync(this.file).mtime;
    } catch {
      this.loadedFrom = new Date();
    }
    // Вік даних: для файлу — час його запису, для щойно завантаженого — зараз.
    this._loadedAt = this.loadedFrom.getTime();
    this.log(`index loaded: ${docs.length} docs`);
  }

  _startBuild() {
    if (this._building) return this._building;
    // Після невдачі не завантажуємо ~50 МБ знову щонайменше 30 хвилин.
    if (this._failedAt && Date.now() - this._failedAt < 30 * 60_000) return Promise.resolve();
    this._building = (async () => {
      try {
        const buf = await this.client.downloadDump(this.file);
        this._load(buf);
        this.lastError = null;
        this._failedAt = 0;
      } catch (err) {
        this.lastError = err;
        this._failedAt = Date.now();
        this.log(`index build failed: ${err.message}`);
      } finally {
        this._building = null;
      }
    })();
    return this._building;
  }

  /**
   * Гарантує наявність індексу. Якщо файл свіжий — завантажує з диска.
   * Якщо застарів — використовує наявний і оновлює у фоні.
   * Якщо файлу немає — починає завантаження і чекає не довше waitMs.
   */
  async ensure({ waitMs = 45000 } = {}) {
    const age = this._fileAge();
    if (!this.docs && age !== Infinity) {
      try {
        this._load();
      } catch (err) {
        this.log(`index load failed: ${err.message}`);
      }
    }
    // Індекс уже в пам'яті й свіжий (навіть якщо файл не вдалося зберегти) — нічого не робимо.
    const memFresh = this.docs && this._loadedAt && Date.now() - this._loadedAt < this.cfg.indexMaxAgeMs;
    if (age > this.cfg.indexMaxAgeMs && !memFresh) {
      const p = this._startBuild();
      if (!this.docs) {
        await Promise.race([p, new Promise((r) => setTimeout(r, waitMs))]);
      }
    }
    return this.docs ? 'ready' : this._building ? 'building' : 'unavailable';
  }

  /** Пошук за словами назви або за номером акта (1315-VII, 1178-2022-п). */
  search(query, { limit = 10, inForceOnly = false, includeArchive = false } = {}) {
    if (!this.docs) return [];
    const q = normalizeForSearch(query);
    if (!q) return [];
    const rawTokens = q.split(/[\s,;:()]+/).map((t) => t.replace(/^[.]+|[.]+$/g, '')).filter(Boolean);
    const yearTokens = rawTokens.filter((t) => /^(19|20)\d{2}$/.test(t));
    const dateTokens = rawTokens
      .map((t) => t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/))
      .filter(Boolean)
      .map((m) => `${m[3]}${m[2].padStart(2, '0')}${m[1].padStart(2, '0')}`);
    const isDate = (t) => /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(t);
    const numberTokens = rawTokens.filter(
      (t) => /\d/.test(t) && !yearTokens.includes(t) && !isDate(t) && /^[\p{L}\d][\p{L}\d\-/]*$/u.test(t),
    );
    const STOP = ['від', 'про', 'та', 'і', 'й', 'на', 'закон', 'україни'];
    const wordTokens = rawTokens.filter(
      (t) => !/\d/.test(t) && t.length >= 2 && !STOP.includes(t),
    );
    const phrase = rawTokens.filter((t) => !/\d/.test(t) && !['закон', 'україни'].includes(t)).join(' ');
    const numMatch = (d, t) =>
      d.numsNorm.some((n) => n === t || n.startsWith(`${t}-`) || n.startsWith(`${t}/`)) ||
      d.nreg.toLowerCase() === t ||
      d.nreg.toLowerCase().startsWith(`${t}-`);

    const results = [];
    for (const d of this.docs) {
      if (inForceOnly && d.status !== 5) continue;
      if (!includeArchive && /\(редакц[іїя][^)]*до\s/i.test(d.title)) continue;
      let numHit = false;
      if (numberTokens.length) {
        numHit = numberTokens.every((t) => numMatch(d, t));
        if (!numHit) continue;
      }
      if (yearTokens.length && !yearTokens.every((y) => d.organs.some((o) => o.date.startsWith(y)))) continue;
      if (dateTokens.length && !dateTokens.every((dt) => d.organs.some((o) => o.date === dt))) continue;
      if (wordTokens.length && !wordTokens.every((t) => d.norm.includes(t))) continue;
      if (!numberTokens.length && !wordTokens.length && !dateTokens.length) continue;
      let score = 0;
      if (d.status === 5) score += 100;
      else if (d.status === 1) score -= 30;
      if (numHit) score += 200;
      if (phrase && d.norm.includes(phrase)) score += 60;
      if (phrase && (d.norm === phrase || d.norm === `про ${phrase}`)) score += 80;
      score -= Math.min(40, d.norm.length / 25);
      results.push({ d, score });
    }
    results.sort((a, b) => b.score - a.score || b.d.edition.localeCompare(a.d.edition));
    return results.slice(0, limit).map((r) => r.d);
  }
}
