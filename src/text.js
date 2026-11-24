// Робота з чистим текстом акта: зміст, окрема стаття, пошук у тексті, посторінковий вивід.
// Тексти порталу: один логічний абзац на рядок; історія змін — у фігурних дужках {…}.

const SUP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };

/** «23¹» → «23-1», «23 – 1» → «23-1», «23.» → «23». */
export function normalizeArticleId(id) {
  let s = String(id ?? '').trim().toLowerCase();
  s = s.replace(/^стаття\s+/, '').replace(/^ст\.?\s*/, '');
  s = s.replace(/[‐-―]/g, '-');
  s = s.replace(/\s*-\s*/g, '-');
  s = s.replace(/([0-9])([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g, (_, d, sup) => `${d}-${[...sup].map((c) => SUP[c]).join('')}`);
  s = s.replace(/[.\s]+$/, '');
  return s;
}

const ARTICLE_RE = /^стаття\s+([^\s.]+(?:\s*[-‐-―]\s*\d+)?)/;
const SECTION_RE = /^(розділ|глава|параграф|підрозділ|книга)(\s|$)/;

/** Розбиває текст на рядки з позначками: заголовки статей/розділів і примітки {…}. */
export function classifyLines(text) {
  const lines = String(text).split(/\r?\n/);
  const out = [];
  let inBrace = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    let kind = 'text';
    let articleId = null;
    if (inBrace) {
      kind = 'meta';
      if (t.includes('}')) inBrace = false;
    } else if (t.startsWith('{')) {
      kind = 'meta';
      inBrace = !t.includes('}');
    } else if (t) {
      const low = t.toLowerCase();
      const m = low.match(ARTICLE_RE);
      if (m) {
        kind = 'article';
        articleId = normalizeArticleId(m[1]);
      } else if (SECTION_RE.test(low)) {
        kind = 'section';
      }
    }
    out.push({ n: i + 1, text: raw, kind, articleId });
  }
  // Назва розділу великими літерами одразу після «Розділ II» — частина заголовка розділу.
  for (let i = 0; i < out.length; i++) {
    if (out[i].kind !== 'section') continue;
    let j = i + 1;
    while (j < out.length && !out[j].text.trim()) j++;
    const t = out[j]?.text.trim() || '';
    if (out[j] && out[j].kind === 'text' && /\p{Lu}/u.test(t) && !/\p{Ll}/u.test(t)) out[j].kind = 'section_title';
  }
  return out;
}

const isBoundary = (l) => l.kind === 'article' || l.kind === 'section' || l.kind === 'section_title';

/** Заголовок розділу разом із назвою: «Розділ II ОРГАНИ СТАНДАРТИЗАЦІЇ». */
function sectionHeading(lines, i) {
  const head = lines[i].text.trim();
  let j = i + 1;
  while (j < lines.length && !lines[j].text.trim()) j++;
  return lines[j]?.kind === 'section_title' ? `${head}. ${lines[j].text.trim()}` : head;
}

export function outline(text, { max = 800 } = {}) {
  const lines = classifyLines(text);
  const items = [];
  lines.forEach((l, i) => {
    if (l.kind === 'section') items.push({ line: l.n, kind: 'section', text: sectionHeading(lines, i) });
    else if (l.kind === 'article') items.push({ line: l.n, kind: 'article', text: l.text.trim() });
  });
  return { total: items.length, items: items.slice(0, max) };
}

/** Повертає текст статті (з примітками про зміни) або підказку з найближчими номерами. */
export function extractArticle(text, articleId) {
  const want = normalizeArticleId(articleId);
  const lines = classifyLines(text);
  const idx = lines.findIndex((l) => l.kind === 'article' && l.articleId === want);
  if (idx === -1) {
    const base = want.split('-')[0];
    const near = lines
      .filter((l) => l.kind === 'article' && (l.articleId === base || l.articleId.startsWith(`${base}-`)))
      .slice(0, 15)
      .map((l) => l.text.trim());
    return { found: false, want, suggestions: near };
  }
  let end = lines.length;
  for (let j = idx + 1; j < lines.length; j++) {
    if (isBoundary(lines[j])) {
      end = j;
      break;
    }
  }
  const body = lines
    .slice(idx, end)
    .map((l) => l.text)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  // Найближчий розділ/глава вище — для контексту.
  let section = null;
  for (let j = idx - 1; j >= 0; j--) {
    if (lines[j].kind === 'section') {
      section = sectionHeading(lines, j);
      break;
    }
  }
  return { found: true, want, startLine: lines[idx].n, endLine: lines[end - 1]?.n ?? lines[idx].n, section, text: body };
}

/** Пошук фрагмента в тексті з контекстом і назвою статті, де він трапився. */
export function findInText(text, query, { context = 1, maxMatches = 40 } = {}) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return { total: 0, matches: [] };
  const lines = classifyLines(text);
  const matches = [];
  let total = 0;
  let heading = null;
  let section = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.kind === 'section') {
      section = sectionHeading(lines, i);
      heading = null;
    }
    if (l.kind === 'article') heading = l.text.trim();
    if (!l.text.toLowerCase().includes(q)) continue;
    total += 1;
    if (matches.length >= maxMatches) continue;
    const from = Math.max(0, i - context);
    const to = Math.min(lines.length - 1, i + context);
    const snippet = lines
      .slice(from, to + 1)
      .map((x) => x.text.trim())
      .filter(Boolean)
      .join('\n');
    matches.push({ line: l.n, article: heading || (l.kind === 'section' || l.kind === 'section_title' ? section : null), section, snippet });
  }
  return { total, matches };
}

/** Посторінковий вивід за символами. */
export function page(text, offset = 0, maxChars = 30000) {
  const total = text.length;
  const start = Math.max(0, Math.min(offset, total));
  const end = Math.min(total, start + maxChars);
  return { chunk: text.slice(start, end), start, end, total, more: end < total };
}
