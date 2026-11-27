import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { USER_AGENT } from './config.js';
import { httpGet } from './http.js';
import { decodeCp1251, decodeText } from './cp1251.js';
import { encodeNregPath, safeName, todayYmd } from './format.js';

export class RadaError extends Error {
  constructor(kind, message, status = 0) {
    super(message);
    this.name = 'RadaError';
    this.kind = kind;
    this.status = status;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeFileAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function isWritableDir(dir) {
  try {
    if (!dir || !path.isAbsolute(dir)) return false;
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

/** Код документа з посилання стрічки: …/go/<nreg>/edРРРРММДД або …/laws/show/<nreg>. */
function nregFromLink(link) {
  const m = String(link).match(/\/(?:go|laws\/show|laws\/main)\/(.+?)(?:\/ed\d{8})?\/?(?:[?#].*)?$/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/**
 * Клієнт офіційного порталу відкритих даних Верховної Ради.
 * Усі запити йдуть по черзі, з паузою між ними, з User-Agent «OpenData»,
 * з добовими лімітами й кешем на диску.
 */
export class RadaClient {
  constructor(cfg, { log = () => {} } = {}) {
    this.cfg = cfg;
    this.log = log;
    this.cacheWarning = null;
    // Тека кешу має бути доступна для запису; інакше — тимчасова тека системи.
    if (!isWritableDir(cfg.cacheDir)) {
      const fallback = path.join(os.tmpdir(), 'ua-legislation-mcp');
      this.cacheWarning = `Тека кешу «${cfg.cacheDir}» недоступна для запису; використовується ${fallback}.`;
      log(this.cacheWarning);
      cfg.cacheDir = fallback;
      if (!isWritableDir(fallback)) this.cacheWarning += ' Тимчасова тека теж недоступна — кеш вимкнено.';
    }
    this.dir = cfg.cacheDir;
    this._chain = Promise.resolve();
    this._lastStart = 0;
    this._cooldownUntil = 0;
    this._usageFile = path.join(this.dir, 'usage.json');
    this.usage = readJson(this._usageFile) || { day: todayYmd(), requests: 0, bytes: 0 };
    this._memo = new Map();
  }

  // ---------- черга, паузи, ліміти ----------

  _rollDay() {
    const day = todayYmd();
    if (this.usage.day !== day) this.usage = { day, requests: 0, bytes: 0 };
  }

  _saveUsage() {
    try {
      writeFileAtomic(this._usageFile, JSON.stringify(this.usage));
    } catch {
      /* кеш недоступний — не критично */
    }
  }

  usageInfo() {
    this._rollDay();
    return {
      day: this.usage.day,
      requests: this.usage.requests,
      requestLimit: this.cfg.dailyRequestLimit,
      megabytes: Math.round((this.usage.bytes / 1048576) * 10) / 10,
      megabyteLimit: Math.round(this.cfg.dailyByteLimit / 1048576),
      paceSeconds: this.cfg.paceMs / 1000,
    };
  }

  /** Ставить запит у чергу: одночасно виконується лише один. */
  _enqueue(fn) {
    const run = this._chain.then(fn, fn);
    this._chain = run.catch(() => {});
    return run;
  }

  /**
   * Один запит до порталу. Додаткові заголовки (умовні If-None-Match / If-Modified-Since)
   * дозволені, але User-Agent завжди рівно «OpenData».
   */
  async _fetch(pathname, { followRedirects = true, headers = {} } = {}) {
    return this._enqueue(async () => {
      this._rollDay();
      if (Date.now() < this._cooldownUntil) {
        const s = Math.ceil((this._cooldownUntil - Date.now()) / 1000);
        throw new RadaError('rate_limited', `Портал попросив зменшити частоту запитів. Повторіть приблизно через ${s} с.`, 429);
      }
      if (this.usage.requests >= this.cfg.dailyRequestLimit) {
        throw new RadaError('daily_limit', `Досягнуто добового ліміту запитів (${this.cfg.dailyRequestLimit}). Ліміт оновиться завтра; змінити його можна змінною RADA_DAILY_LIMIT.`);
      }
      if (this.usage.bytes >= this.cfg.dailyByteLimit) {
        throw new RadaError('daily_limit', `Досягнуто добового ліміту обсягу (${Math.round(this.cfg.dailyByteLimit / 1048576)} МБ).`);
      }
      const wait = this._lastStart + this.cfg.paceMs - Date.now();
      if (wait > 0) await sleep(wait);
      this._lastStart = Date.now();

      const url = this.cfg.baseUrl + pathname;
      this.log(`GET ${url}`);
      let res;
      try {
        res = await httpGet(url, { headers: { ...headers, 'User-Agent': USER_AGENT }, timeoutMs: this.cfg.timeoutMs });
      } catch (err) {
        this.usage.requests += 1;
        this._saveUsage();
        throw new RadaError(
          'network',
          `Сервер ${new URL(this.cfg.baseUrl).host} не відповів (${err.code || err.message}). ` +
            'Сервер Ради може не приймати з\'єднань з-за кордону: запускайте цей MCP-сервер на комп\'ютері або сервері з українською IP-адресою.',
        );
      }
      this.usage.requests += 1;
      this.usage.bytes += res.wireBytes || res.body.length;
      this._saveUsage();

      if (res.status === 429) {
        this._cooldownUntil = Date.now() + 60_000;
        throw new RadaError('rate_limited', 'Портал повернув 429 (забагато запитів). Запити призупинено на 1 хвилину.', 429);
      }
      if (res.status === 403) {
        throw new RadaError(
          'forbidden',
          'Портал повернув 403 (доступ заборонено). Можливі причини: тимчасове блокування IP захистом від DDoS або змінені вимоги порталу. Зачекайте кілька хвилин; якщо не минає — напишіть адміністратору lawup@rada.gov.ua (вкажіть IP і адресу запиту).',
          403,
        );
      }
      if (res.status === 304) return res; // не змінилося — візьмемо з кешу
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.location;
        if (!followRedirects || !loc) return res;
        const next = new URL(loc, url);
        const base = new URL(this.cfg.baseUrl);
        if (next.host !== base.host) return res; // за межі порталу не переходимо
        return { redirectTo: next.pathname + next.search };
      }
      if (res.status === 404) throw new RadaError('not_found', 'Не знайдено (404).', 404);
      if (res.status >= 400) throw new RadaError('http', `Портал повернув помилку HTTP ${res.status}.`, res.status);
      return res;
    });
  }

  async _get(pathname, opts = {}) {
    let p = pathname;
    for (let i = 0; i < 3; i++) {
      const res = await this._fetch(p, opts);
      if (res.redirectTo) {
        p = res.redirectTo;
        continue;
      }
      return res;
    }
    throw new RadaError('http', 'Забагато перенаправлень.');
  }

  // ---------- кеш ----------

  _cachePath(...parts) {
    return path.join(this.dir, ...parts);
  }

  _readCached(file, ttlMs) {
    try {
      const st = fs.statSync(file);
      if (ttlMs !== Infinity && Date.now() - st.mtimeMs > ttlMs) return null;
      return fs.readFileSync(file);
    } catch {
      return null;
    }
  }

  _writeCached(file, data) {
    try {
      writeFileAtomic(file, data);
      return true;
    } catch (err) {
      this.log(`cache write failed: ${err.message}`);
      return false;
    }
  }

  /**
   * Файл із кешем і умовним запитом. Поки кеш свіжий (ttlMs) — портал не запитуємо.
   * Коли застарів — запитуємо з If-None-Match / If-Modified-Since (ETag і Last-Modified
   * зберігаються поруч у *.meta.json); на 304 «не змінилося» беремо кеш і подовжуємо його строк.
   * Так великі файли (doc.txt ~52 МБ, довідники, r.tsv) не завантажуються повторно без потреби.
   */
  async _getConditional(pathname, file, ttlMs) {
    const metaFile = `${file}.meta.json`;
    let cached = null;
    let ageMs = Infinity;
    try {
      const st = fs.statSync(file);
      ageMs = Date.now() - st.mtimeMs;
      cached = fs.readFileSync(file);
    } catch {
      cached = null;
    }
    const meta = cached ? readJson(metaFile) || {} : {};
    // ttlMs <= 0 — завжди перевіряти на порталі (вік щойно записаного файлу може бути навіть від'ємним).
    if (cached && ttlMs > 0 && ageMs < ttlMs) {
      return { body: cached, contentType: meta.contentType || null, fromCache: true, notModified: false };
    }
    const headers = {};
    if (cached && meta.etag) headers['If-None-Match'] = meta.etag;
    if (cached && meta.lastModified) headers['If-Modified-Since'] = meta.lastModified;
    const res = await this._get(pathname, { headers });
    if (res.status === 304) {
      if (!cached) throw new RadaError('http', 'Портал відповів 304 без збереженої копії.', 304);
      try {
        const now = new Date();
        fs.utimesSync(file, now, now); // кеш знову свіжий
      } catch {
        /* не критично */
      }
      return { body: cached, contentType: meta.contentType || null, fromCache: true, notModified: true };
    }
    const contentType = String(res.headers['content-type'] || '') || null;
    try {
      fs.unlinkSync(metaFile); // старий ETag не повинен залишитися при нових даних
    } catch {
      /* не було */
    }
    if (this._writeCached(file, res.body)) {
      const next = {
        etag: res.headers.etag || null,
        lastModified: res.headers['last-modified'] || null,
        contentType,
        savedAt: new Date().toISOString(),
      };
      this._writeCached(metaFile, JSON.stringify(next));
    }
    return { body: res.body, contentType, fromCache: false, notModified: false };
  }

  // ---------- кінцеві точки ----------

  /** Картка документа з переліком редакцій: /laws/card/{nreg}.json */
  async getCard(nreg, { fresh = false } = {}) {
    const file = this._cachePath('cards', `${safeName(nreg)}.json`);
    if (!fresh) {
      const cached = this._readCached(file, this.cfg.cardTtlMs);
      if (cached) {
        const j = JSON.parse(cached.toString('utf8'));
        if (j && j.nreg) return j;
      }
    }
    let res;
    try {
      res = await this._get(`/laws/card/${encodeNregPath(nreg)}.json`);
    } catch (err) {
      if (err instanceof RadaError && err.kind === 'not_found') {
        throw new RadaError('not_found', `Документ з кодом «${nreg}» не знайдено в базі. Перевірте nreg (див. інструмент search_acts).`, 404);
      }
      throw err;
    }
    let card;
    try {
      card = JSON.parse(stripBom(res.body.toString('utf8')));
    } catch {
      throw new RadaError('parse', `Портал повернув картку «${nreg}» у неочікуваному форматі.`);
    }
    if (!card || typeof card !== 'object' || !card.nreg) {
      throw new RadaError('not_found', `Документ з кодом «${nreg}» не знайдено в базі.`);
    }
    this._writeCached(file, JSON.stringify(card));
    return card;
  }

  /**
   * Текст документа. Без edition — поточна редакція (дата береться з картки),
   * з edition — конкретна редакція. Редакції незмінні, тому кешуються назавжди.
   */
  async getText(nreg, edition = null) {
    let card = await this.getCard(nreg);
    const ed = edition || (card.poddat ? String(card.poddat) : null);
    if (edition && Array.isArray(card.eds) && card.eds.length) {
      const known = card.eds.some((e) => String(e.datred) === edition);
      if (!known) {
        const list = card.eds.map((e) => String(e.datred)).slice(-15).join(', ');
        throw new RadaError('not_found', `У картці «${nreg}» немає редакції ${edition}. Відомі редакції (останні): ${list}.`, 404);
      }
    }
    const file = ed ? this._cachePath('texts', `${safeName(nreg)}@${ed}.txt`) : null;
    if (file) {
      const cached = this._readCached(file, Infinity);
      if (cached) return { text: cached.toString('utf8'), edition: ed, card, fromCache: true };
    }
    // Текст завжди запитуємо за датою редакції, щоб дата в відповіді точно відповідала тексту.
    let usedEd = ed;
    let res;
    try {
      if (!ed) throw new RadaError('not_found', 'no edition');
      res = await this._get(`/laws/show/${encodeNregPath(nreg)}/ed${ed}.txt`);
    } catch (err) {
      if (!(err instanceof RadaError && err.kind === 'not_found') || edition) throw err;
      // Резерв: поточний текст без дати — тоді беремо свіжу картку, щоб правильно підписати редакцію.
      card = await this.getCard(nreg, { fresh: true });
      usedEd = card.poddat ? String(card.poddat) : null;
      res = await this._get(`/laws/show/${encodeNregPath(nreg)}.txt`);
    }
    const ct = String(res.headers['content-type'] || '');
    let text = stripBom(res.body.toString('utf8'));
    if (/windows-1251|cp1251/i.test(ct)) text = decodeCp1251(res.body);
    if (/<html[\s>]/i.test(text.slice(0, 500))) {
      throw new RadaError('parse', 'Портал повернув HTML-сторінку замість тексту документа.');
    }
    if (usedEd) this._writeCached(this._cachePath('texts', `${safeName(nreg)}@${usedEd}.txt`), text);
    return { text, edition: usedEd, card, fromCache: false };
  }

  /** Стрічка оновлених документів: /laws/main/r.tsv */
  async getUpdates() {
    const r = await this._getConditional('/laws/main/r.tsv', this._cachePath('updates.tsv'), this.cfg.updatesTtlMs);
    // Кодування — за Content-Type (для копії з кешу — збереженим); евристика лише як запасна.
    const text = decodeText(r.body, r.contentType);
    // Колонки: num, card (опис: видавник; вид від дата), nazva, status, publics, link, size, file.
    // Код документа (nreg) беремо з посилання: у колонці card — опис, а не код.
    const rows = [];
    for (const line of stripBom(text).split(/\r?\n/).slice(1)) {
      const f = line.split('\t').map((x) => x.trim());
      if (f.length < 6) continue;
      const linkIdx = f.findIndex((x) => /^(https?:\/\/|\/(go|laws)\/)/i.test(x));
      const link = linkIdx >= 0 ? f[linkIdx] : '';
      let nreg = link ? nregFromLink(link) : null;
      if (!nreg && /^[^\s;]+$/.test(f[1])) nreg = f[1];
      if (!nreg) continue;
      const ed = (link.match(/\/ed(\d{8})/) || [])[1] || null;
      rows.push({ nreg, card: f[1], title: f[2], status: f[3], publication: f[4], link, edition: ed });
    }
    return rows;
  }

  /** Довідник (typ, organs, pubs, stan) як Map id → назва. Кеш 30 днів, далі — умовний запит. */
  async getDict(name) {
    if (this._memo.has(`dict:${name}`)) return this._memo.get(`dict:${name}`);
    const { body: buf } = await this._getConditional(`/ogd/zak/laws/data/csv/${name}.txt`, this._cachePath('dicts', `${name}.txt`), this.cfg.dictTtlMs);
    const map = new Map();
    for (const line of decodeCp1251(buf).split(/\r?\n/)) {
      const i = line.indexOf('\t');
      if (i < 1) continue;
      const id = Number(line.slice(0, i).trim());
      const label = line.slice(i + 1).trim();
      if (Number.isFinite(id) && label) map.set(id, label);
    }
    this._memo.set(`dict:${name}`, map);
    return map;
  }

  /**
   * Довідники видів, видавників і видань (pubs — коди видань у полі publics картки).
   * Якщо видів і видавників немає — null; без довідника видань картка покаже коди.
   */
  async getDicts() {
    let types;
    let organs;
    try {
      types = await this.getDict('typ');
      organs = await this.getDict('organs');
    } catch (err) {
      this.log(`dicts unavailable: ${err.message}`);
      return null;
    }
    let pubs = null;
    try {
      pubs = await this.getDict('pubs');
    } catch (err) {
      this.log(`pubs dict unavailable: ${err.message}`);
    }
    return { types, organs, pubs };
  }

  /**
   * Повний перелік карток (doc.txt, ~52 МБ) — для локального пошуку за назвою.
   * Викликається, коли локальна копія застаріла: умовний запит, на 304 — наявна копія.
   * Повертає { body, notModified }.
   */
  async downloadDump(targetFile) {
    const r = await this._getConditional('/ogd/zak/laws/data/csv/doc.txt', targetFile, 0);
    return { body: r.body, notModified: r.notModified };
  }

  /** Офіційний пошук за назвою: /laws/find/a?text=… (перенаправлення = однозначний збіг). */
  async findByName(text) {
    const res = await this._get(`/laws/find/a?text=${encodeURIComponent(text)}`, { followRedirects: false });
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      const loc = decodeURIComponent(String(res.headers.location));
      const m = loc.match(/\/laws\/(?:main|show)\/([^?#]+)/);
      if (m) return { nreg: m[1].replace(/\/ed\d{8}$/, '').replace(/\/$/, ''), candidates: [] };
    }
    const html = res.body.toString('utf8');
    const candidates = [];
    const seen = new Set();
    const re = /href="[^"]*\/laws\/(?:show|main)\/([^"?#]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(html)) && candidates.length < 20) {
      let nreg;
      try {
        nreg = decodeURIComponent(m[1]).replace(/\/ed\d{8}$/, '').replace(/\/$/, '');
      } catch {
        continue;
      }
      const title = m[2].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
      if (!title || seen.has(nreg) || /^(laws|main|card)$/.test(nreg)) continue;
      seen.add(nreg);
      candidates.push({ nreg, title });
    }
    return { nreg: null, candidates };
  }
}
