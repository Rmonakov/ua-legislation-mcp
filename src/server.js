import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { VERSION } from './config.js';
import { RadaError } from './rada-client.js';
import { basisLabel, cardToText, fmtDate, futureEditionsText, normalizeEdition, parseDocRef, siteLink, statusLabel, summarizeCard, todayYmd } from './format.js';
import { extractArticle, findInText, outline, page } from './text.js';

export const SERVER_INSTRUCTIONS = `Сервер дає доступ до офіційної бази «Законодавство України» Верховної Ради України через портал відкритих даних data.rada.gov.ua.

Правила роботи з нормативно-правовими актами:
1. Тексти НПА бери лише з інструментів цього сервера. Не подавай норми з пам'яті як чинні; якщо текст не отримано — так і скажи.
2. Кожну згадку акта супроводжуй датою редакції і посиланням на конкретну редакцію (рядок «Офіційний текст»).
3. Перед висновком перевір статус і майбутні редакції (get_act_card): якщо норма зміниться, скажи про це прямо.
4. Для довгих актів запитуй окрему статтю (article), зміст (outline) або шукай фрагмент (find), а не весь текст.
5. Сервер робить не більше одного запиту до порталу на кілька секунд — не запитуй зайвого. Повторні звернення беруться з кешу.
6. У кінці результату наведи перелік використаних актів: акт, nreg, статус, дата редакції, посилання.
Агрегатори (protocol.ua, kodeksy.com.ua тощо) не є офіційним джерелом.`;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

function ok(text) {
  return { content: [{ type: 'text', text }] };
}

function fail(err) {
  const msg = err instanceof RadaError ? err.message : `Помилка: ${err?.message || String(err)}`;
  return { content: [{ type: 'text', text: msg }], isError: true };
}

function json(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj) }], structuredContent: obj };
}

function docLine(d, dicts) {
  const org = d.organs[0];
  const parts = [`${d.nreg} — ${d.title}`];
  const meta = [statusLabel(d.status)];
  const type = dicts?.types && d.types[0] ? dicts.types.get(d.types[0]) : null;
  if (type) meta.push(type);
  const pub = dicts?.organs && org?.org ? dicts.organs.get(org.org) : null;
  if (pub) meta.push(pub);
  if (org?.date || org?.num) meta.push([org.date ? `від ${fmtDate(org.date)}` : '', org.num ? `№ ${org.num}` : ''].filter(Boolean).join(' '));
  if (d.edition) meta.push(`редакція від ${fmtDate(d.edition)}`);
  parts.push(`   ${meta.join(' | ')}`);
  return parts.join('\n');
}

function textHeader(summary, edition) {
  const today = todayYmd();
  let edNote = '';
  if (edition && summary.currentEdition && edition !== summary.currentEdition) {
    edNote = edition > today ? ' (майбутня редакція, ще не набрала чинності)' : ` (не поточна; поточна — від ${fmtDate(summary.currentEdition)})`;
  }
  const lines = [
    summary.title,
    `nreg: ${summary.nreg} | Редакція від ${fmtDate(edition)}${edNote} | Статус: ${summary.status.label}`,
    `Офіційний текст: ${siteLink(summary.nreg, edition)}`,
  ];
  if (summary.futureEditions.length && !edNote.includes('майбутня')) {
    lines.push(`Увага: є майбутні редакції — ${futureEditionsText(summary.futureEditions)}. Перевірте, чи стосуються вони потрібних норм.`);
  }
  if (summary.isArchive) lines.push('Увага: картка позначена як архівна копія документа.');
  lines.push('Джерело: офіційна база «Законодавство України» (портал відкритих даних ВРУ, data.rada.gov.ua)');
  return lines.join('\n');
}

/**
 * Створює екземпляр MCP-сервера. Клієнт порталу та індекс спільні для всіх підключень,
 * тож паузи й ліміти діють глобально.
 */
export function createMcpServer({ client, index, compat = false }) {
  const server = new McpServer({ name: 'ua-legislation', version: VERSION }, { instructions: SERVER_INSTRUCTIONS });

  async function searchActs(query, { limit = 10, inForceOnly = false } = {}) {
    const state = await index.ensure();
    if (state === 'ready') {
      return { mode: 'index', docs: index.search(query, { limit, inForceOnly }) };
    }
    // Індекс ще завантажується — офіційний пошук порталу за назвою.
    const r = await client.findByName(query);
    return { mode: 'find', state, found: r };
  }

  server.registerTool(
    'search_acts',
    {
      title: 'Пошук нормативно-правових актів',
      description:
        'Шукає акти в базі «Законодавство України» за словами назви, номером (1315-VII, 1178-2022-п), датою прийняття (05.06.2014) або роком. ' +
        'Повертає код документа nreg, статус, реквізити й дату поточної редакції. nreg потрібен для решти інструментів. ' +
        'Перший пошук завантажує офіційний перелік документів (~50 МБ) і може тривати до хвилини.',
      inputSchema: {
        query: z.string().min(2).describe('Слова з назви та/або номер акта, напр. «про стандартизацію», «1315-VII», «Цивільний кодекс»'),
        in_force_only: z.boolean().optional().describe('Лише чинні акти'),
        limit: z.number().int().min(1).max(50).optional().describe('Скільки результатів повернути (типово 10)'),
      },
      annotations: { title: 'Пошук актів', ...READ_ONLY },
    },
    async ({ query, in_force_only, limit }) => {
      try {
        const r = await searchActs(query, { limit: limit ?? 10, inForceOnly: !!in_force_only });
        if (r.mode === 'index') {
          if (!r.docs.length) return ok(`За запитом «${query}» нічого не знайдено. Спробуйте інші слова з назви або номер акта.`);
          const dicts = await client.getDicts();
          return ok([`Знайдено (${r.docs.length}):`, ...r.docs.map((d) => docLine(d, dicts)), '', 'Далі: get_act_card або get_act_text з потрібним nreg.'].join('\n'));
        }
        const note = r.state === 'building' ? 'Локальний перелік документів ще завантажується; результат з офіційного пошуку порталу.' : 'Локальний перелік документів недоступний; результат з офіційного пошуку порталу.';
        if (r.found.nreg) return ok(`${note}\nОднозначний збіг: nreg ${r.found.nreg}. Перевірте його через get_act_card.`);
        if (r.found.candidates.length) return ok([note, 'Можливі збіги:', ...r.found.candidates.map((c) => `${c.nreg} — ${c.title}`)].join('\n'));
        return ok(`${note}\nНічого не знайдено. Спробуйте ще раз за хвилину — тоді спрацює повний пошук.`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'get_act_card',
    {
      title: 'Картка акта і редакції',
      description:
        'Повертає картку документа: назву, статус (чинний / втратив чинність / не набрав чинності), реквізити, офіційне опублікування, ' +
        'законопроєкт, дату поточної редакції, майбутні редакції (з умовою набрання чинності, якщо дати немає) та історію редакцій з підставами. ' +
        'Використовуй перед будь-яким висновком щодо чинності норми.',
      inputSchema: {
        nreg: z.string().min(1).describe('Код документа nreg (напр. 1315-18, 254к/96-вр, 1178-2022-п) або посилання zakon.rada.gov.ua'),
      },
      annotations: { title: 'Картка акта', ...READ_ONLY },
    },
    async ({ nreg }) => {
      try {
        const ref = parseDocRef(nreg);
        const card = await client.getCard(ref.nreg);
        const dicts = await client.getDicts();
        return ok(cardToText(summarizeCard(card, { dicts })));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'get_act_text',
    {
      title: 'Текст акта (стаття, пошук, зміст)',
      description:
        'Повертає офіційний текст акта в поточній або вказаній редакції. Для довгих актів використовуй article (одна стаття), ' +
        'find (пошук фрагмента з контекстом і назвою статті) або outline (зміст: розділи, глави, статті). ' +
        'Без цих параметрів текст видається частинами по max_chars символів (параметр offset — для продовження). ' +
        'Кожна відповідь містить дату редакції і посилання на неї — наводь їх у результаті.',
      inputSchema: {
        nreg: z.string().min(1).describe('Код документа nreg або посилання zakon.rada.gov.ua (можна з /edРРРРММДД)'),
        edition: z.string().optional().describe('Дата редакції: РРРРММДД або ДД.ММ.РРРР. Без неї — поточна редакція'),
        article: z.string().optional().describe('Номер статті: «23», «23-1», «23¹»'),
        find: z.string().optional().describe('Фрагмент тексту для пошуку в акті'),
        outline: z.boolean().optional().describe('Повернути зміст (розділи, глави, статті) замість тексту'),
        offset: z.number().int().min(0).optional().describe('З якого символу продовжити вивід'),
        max_chars: z.number().int().min(1000).max(150000).optional().describe('Максимум символів у відповіді (типово 30000)'),
        context_lines: z.number().int().min(0).max(10).optional().describe('Скільки рядків контексту показувати навколо збігу find (типово 1)'),
      },
      annotations: { title: 'Текст акта', ...READ_ONLY },
    },
    async ({ nreg, edition, article, find, outline: wantOutline, offset, max_chars, context_lines }) => {
      try {
        const ref = parseDocRef(nreg);
        const ed = normalizeEdition(edition) || ref.edition;
        const { text, edition: usedEd, card } = await client.getText(ref.nreg, ed);
        const summary = summarizeCard(card);
        const head = textHeader(summary, usedEd);
        const maxChars = max_chars ?? 30000;

        if (wantOutline) {
          const o = outline(text);
          if (!o.total) return ok(`${head}\n---\nУ тексті не знайдено заголовків розділів чи статей. Скористайтеся find або читайте текст частинами.`);
          const body = o.items.map((i) => `${i.kind === 'section' ? '' : '  '}${i.text}`).join('\n');
          return ok(`${head}\n---\nЗміст (${o.total}${o.total > o.items.length ? `, показано ${o.items.length}` : ''}):\n${body}`);
        }
        if (article) {
          const a = extractArticle(text, article);
          if (!a.found) {
            const hint = a.suggestions.length ? `Схожі статті:\n${a.suggestions.join('\n')}` : 'Перевірте номер або скористайтеся outline.';
            return ok(`${head}\n---\nСтаттю «${article}» не знайдено. ${hint}`);
          }
          const p = page(a.text, offset ?? 0, maxChars);
          const tail = p.more ? `\n[Показано символи ${p.start}–${p.end} з ${p.total}. Продовження: offset=${p.end}]` : '';
          return ok(`${head}${a.section ? `\nРозташування: ${a.section}` : ''}\n---\n${p.chunk}${tail}`);
        }
        if (find) {
          const r = findInText(text, find, { context: context_lines ?? 1 });
          if (!r.total) return ok(`${head}\n---\nФрагмент «${find}» у тексті не знайдено.`);
          const body = r.matches
            .map((m) => `• ${m.article ? `[${m.article}] ` : ''}(рядок ${m.line})\n${m.snippet}`)
            .join('\n\n');
          return ok(`${head}\n---\nЗбігів: ${r.total}${r.total > r.matches.length ? ` (показано ${r.matches.length})` : ''}\n\n${body}`);
        }
        const p = page(text, offset ?? 0, maxChars);
        const tail = p.more ? `\n[Показано символи ${p.start}–${p.end} з ${p.total}. Продовження: offset=${p.end}. Для довгих актів краще article/find/outline]` : '';
        return ok(`${head}\n---\n${p.chunk}${tail}`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'check_act_editions',
    {
      title: 'Перевірка актуальності редакцій',
      description:
        'Для переліку актів порівнює редакцію, на яку спирається документ, з поточною редакцією в базі; показує зміну статусу і майбутні редакції. ' +
        'Використовуй для повторної перевірки раніше підготовлених аналізів і проєктів (за їхнім реєстром джерел). До 8 актів за виклик.',
      inputSchema: {
        acts: z
          .array(
            z.object({
              nreg: z.string().min(1).describe('Код документа nreg'),
              edition: z.string().optional().describe('Редакція, на яку спирався документ (РРРРММДД або ДД.ММ.РРРР)'),
            }),
          )
          .min(1)
          .max(8),
      },
      annotations: { title: 'Перевірка редакцій', ...READ_ONLY },
    },
    async ({ acts }) => {
      try {
        const out = [];
        let changed = 0;
        for (const a of acts) {
          try {
            const ref = parseDocRef(a.nreg);
            const known = normalizeEdition(a.edition) || ref.edition;
            const card = await client.getCard(ref.nreg, { fresh: true });
            const s = summarizeCard(card);
            const lines = [`${s.nreg} — ${s.title}`, `   Статус: ${s.status.label}`];
            if (known) {
              const same = known === s.currentEdition;
              if (!same) changed += 1;
              lines.push(
                same
                  ? `   Редакція в документі ${fmtDate(known)} = поточна. Змін немає.`
                  : `   ЗМІНИЛОСЬ: у документі редакція від ${fmtDate(known)}, поточна — від ${fmtDate(s.currentEdition)}${s.currentBasis ? ` (підстава ${basisLabel(s.currentBasis)})` : ''}.`,
              );
              if (!same) {
                const between = s.editions.filter((e) => e.date > known && e.date <= (s.currentEdition || e.date));
                if (between.length) lines.push(`   Редакції після ${fmtDate(known)}: ${between.map((e) => `${fmtDate(e.date)}${e.basis ? ` (підстава ${basisLabel(e.basis)})` : ''}`).join('; ')}`);
                lines.push('   Щоб побачити, що змінилося, порівняйте потрібні статті двох редакцій через get_act_text (параметр edition).');
              }
            } else {
              lines.push(`   Поточна редакція: від ${fmtDate(s.currentEdition)}`);
            }
            if (s.futureEditions.length) lines.push(`   Майбутні редакції: ${futureEditionsText(s.futureEditions)}`);
            lines.push(`   ${s.link}`);
            out.push(lines.join('\n'));
          } catch (err) {
            out.push(`${a.nreg} — не вдалося перевірити: ${err.message}`);
          }
        }
        return ok([`Перевірено актів: ${acts.length}; змінилось: ${changed}.`, '', ...out].join('\n'));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'list_recent_updates',
    {
      title: 'Нещодавно оновлені документи',
      description:
        'Стрічка документів, які нещодавно додано або змінено в базі (офіційна стрічка оновлень порталу). ' +
        'Можна відфільтрувати за переліком nreg (чи змінилось щось із моїх актів) або за словами в назві.',
      inputSchema: {
        nregs: z.array(z.string()).optional().describe('Лише ці коди документів'),
        query: z.string().optional().describe('Слова в назві'),
        limit: z.number().int().min(1).max(200).optional().describe('Скільки рядків повернути (типово 30)'),
      },
      annotations: { title: 'Оновлення бази', ...READ_ONLY },
    },
    async ({ nregs, query, limit }) => {
      try {
        let rows = await client.getUpdates();
        const total = rows.length;
        if (nregs?.length) {
          const set = new Set(nregs.map((n) => parseDocRef(n).nreg));
          rows = rows.filter((r) => set.has(r.nreg));
        }
        if (query) {
          const q = query.toLowerCase();
          rows = rows.filter((r) => r.title.toLowerCase().includes(q));
        }
        const shown = rows.slice(0, limit ?? 30);
        if (!shown.length) return ok(`У стрічці оновлень (${total} записів) збігів немає.`);
        return ok(
          [
            `Стрічка оновлень: ${total} записів; збігів: ${rows.length}${rows.length > shown.length ? `, показано ${shown.length}` : ''}.`,
            ...shown.map((r) => `${r.title}${r.card && r.card !== r.nreg ? ` — ${r.card}` : ''}\n   nreg ${r.nreg} | ${r.status}${r.edition ? ` | редакція від ${fmtDate(r.edition)}` : ''}${r.publication ? ` | ${r.publication}` : ''}\n   ${siteLink(r.nreg, r.edition)}`),
          ].join('\n'),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'service_status',
    {
      title: 'Стан сервера',
      description: 'Показує, скільки запитів до порталу зроблено сьогодні, ліміти, паузу між запитами, стан локального переліку документів і теку кешу.',
      inputSchema: {},
      annotations: { title: 'Стан сервера', ...READ_ONLY, openWorldHint: false },
    },
    async () => {
      const u = client.usageInfo();
      const docs = index.docs ? `${index.docs.length} документів (файл від ${index.loadedFrom?.toISOString().slice(0, 10)})` : index._building ? 'завантажується' : 'ще не завантажено';
      return ok(
        [
          `ua-legislation-mcp ${VERSION}`,
          `Портал: ${client.cfg.baseUrl}`,
          `Запитів сьогодні: ${u.requests} з ${u.requestLimit}; обсяг: ${u.megabytes} з ${u.megabyteLimit} МБ`,
          `Пауза між запитами: ${u.paceSeconds} с`,
          `Локальний перелік документів: ${docs}${index.lastError ? `; остання помилка: ${index.lastError.message}` : ''}`,
          `Кеш: ${client.cfg.cacheDir}${client.cacheWarning ? ` (${client.cacheWarning})` : ''}`,
        ].join('\n'),
      );
    },
  );

  if (compat) {
    // Сумісність із ChatGPT (deep research, company knowledge): інструменти search і fetch.
    server.registerTool(
      'search',
      {
        title: 'Search Ukrainian legislation',
        description:
          'Пошук нормативно-правових актів України в офіційній базі «Законодавство України» (Search Ukrainian legislation by title words, number or date). ' +
          'Returns ids (nreg) for the fetch tool.',
        inputSchema: { query: z.string().min(1).describe('Search query: title words, act number or date') },
        annotations: { title: 'Search', ...READ_ONLY },
      },
      async ({ query }) => {
        try {
          const r = await searchActs(query, { limit: 10 });
          let items = [];
          if (r.mode === 'index') items = r.docs.map((d) => ({ id: d.nreg, title: `${d.title} (${statusLabel(d.status)}${d.edition ? `, ред. від ${fmtDate(d.edition)}` : ''})`, url: siteLink(d.nreg, d.edition || null) }));
          else if (r.found.nreg) items = [{ id: r.found.nreg, title: r.found.nreg, url: siteLink(r.found.nreg) }];
          else items = r.found.candidates.map((c) => ({ id: c.nreg, title: c.title, url: siteLink(c.nreg) }));
          return json({ results: items });
        } catch (err) {
          return fail(err);
        }
      },
    );

    server.registerTool(
      'fetch',
      {
        title: 'Fetch act text',
        description:
          'Повертає повний офіційний текст акта за id з search (nreg; для конкретної редакції — nreg@РРРРММДД). Returns full official text with edition date and URL.',
        inputSchema: { id: z.string().min(1).describe('nreg or nreg@YYYYMMDD') },
        annotations: { title: 'Fetch', ...READ_ONLY },
      },
      async ({ id }) => {
        try {
          const ref = parseDocRef(id);
          const { text, edition, card } = await client.getText(ref.nreg, ref.edition);
          const s = summarizeCard(card);
          const LIMIT = 400000;
          const body = text.length > LIMIT ? `${text.slice(0, LIMIT)}\n[Текст обрізано: ${text.length} символів. Для окремих статей використовуйте get_act_text.]` : text;
          return json({
            id: edition ? `${s.nreg}@${edition}` : s.nreg,
            title: `${s.title} (редакція від ${fmtDate(edition)})`,
            text: body,
            url: siteLink(s.nreg, edition),
            metadata: {
              nreg: s.nreg,
              status: s.status.label,
              edition: edition || '',
              future_editions: s.futureEditions.map((e) => e.date).join(','),
              future_editions_text: futureEditionsText(s.futureEditions),
              source: 'Законодавство України (data.rada.gov.ua)',
            },
          });
        } catch (err) {
          return fail(err);
        }
      },
    );
  }

  return server;
}
