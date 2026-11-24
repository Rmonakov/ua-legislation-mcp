# ua-legislation-mcp — «Законодавство України» для ШІ-асистентів

MCP-сервер, який дає ШІ-асистентам (Claude, ChatGPT, Cursor, VS Code Copilot, Codex, Gemini CLI та іншим) доступ до **офіційної бази «Законодавство України»** Верховної Ради через **портал відкритих даних [data.rada.gov.ua](https://data.rada.gov.ua)**.

Асистент отримує офіційний текст потрібної редакції, а не переказ із пам'яті чи копію з агрегатора. До кожної відповіді додаються дата редакції й посилання на неї на zakon.rada.gov.ua.

> Неофіційний проєкт, не пов'язаний з Апаратом Верховної Ради України. Дані належать їхньому розпоряднику й поширюються як відкриті дані; посилайтеся на джерело.

## Швидкий старт (Claude Desktop, Windows і macOS)

1. Завантажте з [останнього релізу](https://github.com/Rmonakov/ua-legislation-mcp/releases/latest) два файли:
   - `ua-legislation-mcp-<версія>.mcpb` — розширення (сам сервер);
   - `npa-ofitsiini-dzherela.zip` — навичка з правилами роботи з НПА (необов'язково, але рекомендовано).
2. **Розширення:** у Claude Desktop відкрийте **Settings → Desktop app → Extensions (Manage)** (у старому вигляді — **Settings → Extensions**) → **Advanced settings** → **Install Extension…** і виберіть файл `.mcpb`. Налаштування можна лишити типовими.
3. **Навичка:** **Customize → Skills** → **+** → **Create skill** → **Upload a skill** → виберіть `npa-ofitsiini-dzherela.zip`. Має бути ввімкнено «Code execution and file creation» (у новому вигляді — «Create and edit files») у **Settings → Capabilities**.
4. Перевірте: у новому чаті попросіть, наприклад, «Знайди Закон про стандартизацію і покажи статтю 23 з датою редакції».

**Windows: покрокова інструкція** для Claude Desktop і ChatGPT, з усіма командами й розв'язанням типових проблем — [docs/windows.md](docs/windows.md).

Розширення працює, поки застосунок Claude відкритий на комп'ютері з українською IP-адресою (див. нижче). Інші клієнти (ChatGPT, Claude Code, Cursor, VS Code, Codex, Gemini CLI) — у розділі [Встановлення](#встановлення).

**Поділитися з колегами:** надішліть посилання на репозиторій (https://github.com/Rmonakov/ua-legislation-mcp) або одразу на [останній реліз](https://github.com/Rmonakov/ua-legislation-mcp/releases/latest).

## Що вміє

| Інструмент | Для чого |
|---|---|
| `search_acts` | Пошук актів за словами назви, номером (`1315-VII`, `1178-2022-п`), датою прийняття (`05.06.2014`) чи роком. Повертає код документа `nreg`. |
| `get_act_card` | Картка акта: статус (чинний / втратив чинність / не набрав чинності…), реквізити, поточна редакція, **майбутні редакції**, історія редакцій з підставами. |
| `get_act_text` | Офіційний текст поточної або будь-якої попередньої редакції: окрема стаття (`article`), пошук фрагмента з назвою статті (`find`), зміст (`outline`) або весь текст частинами. |
| `check_act_editions` | Чи змінилися акти, на які спирається ваш документ: порівнює редакцію з документа з поточною, показує майбутні зміни. |
| `list_recent_updates` | Офіційна стрічка нещодавно оновлених документів, з фільтром за вашими актами. |
| `service_status` | Скільки запитів зроблено сьогодні, ліміти, кеш. |
| `search`, `fetch` | Сумісність із ChatGPT (deep research, company knowledge). Вмикаються автоматично в HTTP-режимі. |

Сервер також передає асистенту правила роботи з НПА: не цитувати норми з пам'яті як чинні, зазначати дату редакції, перевіряти майбутні редакції й наводити перелік використаних актів.

## Навичка для Claude: правила роботи з НПА

У теці [`skills/npa-ofitsiini-dzherela`](skills/npa-ofitsiini-dzherela/SKILL.md) лежить навичка (skill), яка вчить Claude працювати з нормативно-правовими актами:

- брати тексти лише з офіційної бази й не подавати норми з пам'яті як чинні;
- прив'язувати кожну згадку акта до дати редакції;
- перевіряти статус і майбутні редакції;
- закінчувати кожен аналіз чи проєкт реєстром джерел;
- повторно перевіряти документи за цим реєстром.

Готовий архів для завантаження — `npa-ofitsiini-dzherela.zip` у кожному [релізі](https://github.com/Rmonakov/ua-legislation-mcp/releases/latest). Встановлення: **Customize → Skills → + → Create skill → Upload a skill**. **ChatGPT** підтримує той самий формат навичок (Agent Skills): **Plugins → Skills → Create → Upload from your computer** і той самий `npa-ofitsiini-dzherela.zip` (власні навички доступні на тарифах Business, Enterprise, Healthcare, Edu). Якщо вкладки Skills немає, вставте текст [`SKILL.md`](skills/npa-ofitsiini-dzherela/SKILL.md) в інструкції проєкту ChatGPT. Основні правила сервер і так передає асистенту.

## Важливо: запускайте сервер з українською IP-адресою

Сервер Ради може не приймати з'єднань із-за кордону: під час розробки портал відкритих даних обривав з'єднання з хмарних серверів поза Україною. Тому MCP-сервер має працювати **на комп'ютері або сервері в Україні**. Перевірити можна однією командою:

```bash
npx -y github:Rmonakov/ua-legislation-mcp --check
```

Якщо бачите `OK: «Конституція України» — Чинний…`, усе гаразд. У PowerShell на Windows пишіть `npx.cmd` замість `npx`.

Потрібен [Node.js](https://nodejs.org) 18.17 або новіший. Claude Desktop має власний Node.js, тож для розширення `.mcpb` нічого додатково ставити не треба.

## Встановлення

> Команди нижче встановлюють сервер прямо з GitHub (`github:Rmonakov/ua-legislation-mcp`), тож на комп'ютері мають бути [Node.js](https://nodejs.org) 18.17+ і [git](https://git-scm.com). Для розширення `.mcpb` у Claude Desktop нічого з цього не потрібно.
>
> **Windows:** якщо PowerShell пише `running scripts is disabled on this system`, пишіть `npx.cmd` замість `npx` (наприклад, `npx.cmd -y github:Rmonakov/ua-legislation-mcp --check`). Змінювати налаштування безпеки для цього не потрібно.

### Claude Desktop (найпростіше)

1. Завантажте файл `ua-legislation-mcp-<версія>.mcpb` з [останнього релізу](https://github.com/Rmonakov/ua-legislation-mcp/releases/latest).
2. Відкрийте його подвійним кліком або встановіть через **Settings → Desktop app → Extensions (Manage) → Advanced settings → Install Extension…** і натисніть **Install**.
3. За потреби змініть паузу між запитами чи добовий ліміт у налаштуваннях розширення.

Розширення працює в усіх чатах і проєктах Claude Desktop. Сесії Claude, пов'язані з цим комп'ютером, теж його бачать, поки застосунок відкритий.

Ручне налаштування замість `.mcpb` — у файлі `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ua-legislation": {
      "command": "npx",
      "args": ["-y", "github:Rmonakov/ua-legislation-mcp"]
    }
  }
}
```

На Windows, якщо `npx` не запускається, вкажіть `"command": "cmd"` і `"args": ["/c", "npx", "-y", "github:Rmonakov/ua-legislation-mcp"]`.

### Claude Code

```bash
claude mcp add ua-legislation -- npx -y github:Rmonakov/ua-legislation-mcp
```

### Cursor

`~/.cursor/mcp.json` (або `.cursor/mcp.json` у проєкті):

```json
{
  "mcpServers": {
    "ua-legislation": { "command": "npx", "args": ["-y", "github:Rmonakov/ua-legislation-mcp"] }
  }
}
```

### VS Code (GitHub Copilot, режим агента)

`.vscode/mcp.json`:

```json
{
  "servers": {
    "ua-legislation": { "type": "stdio", "command": "npx", "args": ["-y", "github:Rmonakov/ua-legislation-mcp"] }
  }
}
```

### OpenAI Codex CLI

`~/.codex/config.toml`:

```toml
[mcp_servers.ua-legislation]
command = "npx"
args = ["-y", "github:Rmonakov/ua-legislation-mcp"]
```

### Gemini CLI

`~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "ua-legislation": { "command": "npx", "args": ["-y", "github:Rmonakov/ua-legislation-mcp"] }
  }
}
```

### Будь-який інший клієнт MCP

Локальний режим (stdio): команда `npx`, аргументи `-y github:Rmonakov/ua-legislation-mcp`.

### ChatGPT, claude.ai та інші віддалені клієнти (HTTP)

> На Windows дивіться [покрокову інструкцію](docs/windows.md#частина-2-chatgpt): там усі команди для PowerShell, перевірки й типові проблеми.

ChatGPT і веб-версія Claude підключаються лише до MCP-сервера за публічною адресою HTTPS. Тому сервер запускається в HTTP-режимі на комп'ютері чи сервері в Україні, а назовні його відкриває тунель.

1. Запустіть сервер із секретним шляхом. Секрет — довгий випадковий рядок; без нього вашим підключенням міг би користуватися будь-хто:
   ```bash
   npx -y github:Rmonakov/ua-legislation-mcp --http --port 8787 --secret <довгий-випадковий-рядок>
   ```
2. Відкрийте до нього доступ тунелем, наприклад Cloudflare Tunnel (програма `cloudflared`):
   ```bash
   cloudflared tunnel --url http://localhost:8787
   ```
   Або `ngrok http 8787`. Ви отримаєте адресу на зразок `https://xxxx.trycloudflare.com`.
3. Адреса MCP-сервера: `https://xxxx.trycloudflare.com/mcp/<довгий-випадковий-рядок>`.
4. **ChatGPT:** у налаштуваннях увімкніть режим розробника (Developer mode) і створіть застосунок (конектор) для власного MCP-сервера з цією адресою. Автентифікація: **No authentication**. Потрібен план Plus, Pro, Business, Enterprise або Edu. Розташування налаштувань у ChatGPT змінюється, тож дивіться [документацію OpenAI](https://developers.openai.com/api/docs/guides/developer-mode).
   **claude.ai:** Settings → Connectors → додати власний конектор з тією самою адресою.

Сервер у цьому режимі має працювати весь час, поки ви ним користуєтеся. Постійна адреса потребує іменованого тунелю або власного сервера (VPS) в Україні; тоді запускайте його з `--host 0.0.0.0` за зворотним проксі з HTTPS.

Інструменти `search` і `fetch` у HTTP-режимі відповідають схемі OpenAI для deep research, тож сервер можна використовувати і як джерело для глибокого дослідження.

## Налаштування

Усі налаштування задаються змінними середовища (у `.mcpb` — у вікні налаштувань розширення):

| Змінна | Типово | Опис |
|---|---|---|
| `RADA_PACE_SECONDS` | `6` | Пауза між запитами до порталу. Менше 5 с задати не можна. |
| `RADA_DAILY_LIMIT` | `2000` | Добовий ліміт запитів (портал дозволяє до 100 000). |
| `RADA_DAILY_MB` | `150` | Добовий ліміт обсягу, МБ (портал дозволяє до 200). |
| `RADA_CACHE_DIR` | системна тека кешу | Де зберігати картки, тексти редакцій і перелік документів. |
| `RADA_CARD_TTL_MINUTES` | `360` | Скільки вважати картку свіжою (перевірка `check_act_editions` завжди бере свіжу). |
| `RADA_INDEX_MAX_AGE_DAYS` | `7` | Як часто оновлювати локальний перелік документів для пошуку. |
| `RADA_COMPAT_TOOLS` | `auto` | `on` / `off` — інструменти `search`/`fetch` для ChatGPT (`auto`: лише в HTTP-режимі). |
| `RADA_MCP_SECRET` | — | Секретний шлях для HTTP-режиму (те саме, що `--secret`). |
| `RADA_CORS_ORIGIN` | — | Дозволити звернення з браузера (CORS) для HTTP-режиму, напр. `https://example.com`. Типово вимкнено. |
| `RADA_DEBUG` | — | `1` — писати журнал запитів у stderr. |

## Як сервер дотримується правил порталу

Правила сайту «Законодавство України» забороняють автоматизоване копіювання текстів зі сторінок сайту. Для програм Рада надає окремий канал — портал відкритих даних. Цей сервер:

- звертається **лише** до `data.rada.gov.ua` і ніколи не відкриває сторінки zakon.rada.gov.ua (їх він тільки показує як посилання для людей);
- надсилає `User-Agent: OpenData`, як вимагає портал;
- робить запити суворо по одному, з паузою щонайменше 5 секунд (типово 6), тобто не більше 12 на хвилину при дозволених 60;
- дотримується добових лімітів, а на відповідь «429» або «403» зупиняється, а не повторює запит;
- кешує все, що можна: тексти редакцій незмінні й зберігаються назавжди, картки — на 6 годин, перелік документів (~50 МБ) оновлюється раз на тиждень.

## Як працювати з НПА

Рекомендований порядок для аналізів і проєктів актів:

1. Знайти акт: `search_acts` → `nreg`.
2. Перевірити статус і редакції: `get_act_card`. Якщо є майбутні редакції, оцінити, чи зачіпають вони потрібні норми.
3. Читати лише потрібне: `get_act_text` з `article`, `find` чи `outline`.
4. У кінці документа навести реєстр джерел: акт, `nreg`, статус, дата редакції, посилання на конкретну редакцію (`…/ed РРРРММДД`).
5. Пізніше перевірити актуальність: `check_act_editions` за цим реєстром. Якщо щось змінилося, порівняти статті двох редакцій через `get_act_text` з параметром `edition`.

Окремо копій законів вести не треба: база Ради сама зберігає всі редакції, а документ фіксує, на яку саме він спирався.

## Розробка

```bash
npm install
npm test            # модульні тести та повні тести через протокол MCP на імітації порталу
npm run check       # перевірка доступу до справжнього порталу
npm run start:http  # HTTP-режим локально
npx @anthropic-ai/mcpb pack . dist/ua-legislation-mcp.mcpb   # пакет для Claude Desktop
```

Випуск нової версії: оновіть номер версії в `package.json`, `manifest.json` і `src/config.js`, допишіть `CHANGELOG.md`, а потім на GitHub створіть реліз (**Releases → Draft a new release**, тег `vX.Y.Z`, **Publish release**). GitHub Actions прожене тести й додасть до релізу файли `ua-legislation-mcp-X.Y.Z.mcpb` і `npa-ofitsiini-dzherela.zip`.

Структура: `src/rada-client.js` — клієнт порталу (черга, паузи, ліміти, кеш); `src/index-store.js` — локальний пошук за офіційним переліком документів; `src/text.js` — статті, пошук, зміст; `src/server.js` — інструменти MCP; `bin/cli.js` — запуск у режимах stdio та HTTP. Тести працюють на імітації порталу з вигаданими даними й до справжнього порталу не звертаються.

Пропозиції й виправлення — через issues і pull requests.

## Подяки

Відомості про кінцеві точки порталу відкритих даних звірено з відкритим проєктом [shevchukdp/rada_client](https://github.com/shevchukdp/rada_client) (MIT). Код цього проєкту написано окремо.

## Ліцензія

Код — [MIT](LICENSE). Дані бази «Законодавство України» — відкриті дані Верховної Ради України; умови їх використання визначає розпорядник.

---

**English summary.** An MCP server that gives AI assistants (Claude, ChatGPT, Cursor, VS Code, Codex, Gemini CLI) access to Ukraine's official legislation database via the Verkhovna Rada open-data API (`data.rada.gov.ua`): act search, cards with all editions (including future ones), article-level text, change checks. It runs over stdio or Streamable HTTP and follows the portal's rules (`User-Agent: OpenData`, ≥5 s between requests, daily caps, caching). The Rada servers may refuse connections from outside Ukraine, so run it on a machine with a Ukrainian IP (`npx -y github:Rmonakov/ua-legislation-mcp --check`). Unofficial project.
