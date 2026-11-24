# Покрокова інструкція для Windows

Ця інструкція — для Windows 10 і 11. У ній три частини:

1. [Claude Desktop](#частина-1-claude-desktop) — найпростіше, кілька хвилин.
2. [ChatGPT](#частина-2-chatgpt) — довше: сервер працює на вашому комп'ютері, а ChatGPT підключається до нього через тунель.
3. [Інші програми](#частина-3-інші-програми) — Claude Code, Cursor, VS Code, Codex, Gemini CLI.

Наприкінці — [що робити, якщо щось пішло не так](#якщо-щось-пішло-не-так).

## Перш ніж почати

- **Комп'ютер має бути в Україні.** Сервер Ради не приймає з'єднань із-за кордону. Якщо у вас увімкнено VPN із закордонною адресою, вимкніть його на час роботи або налаштуйте виняток для `data.rada.gov.ua`.
- **Права адміністратора не потрібні** (крім установлення програм, якщо Windows попросить).
- **Для ChatGPT потрібен платний тариф:** власні MCP-сервери доступні на Plus, Pro, Business, Enterprise та Edu; власні навички (skills) — на Business, Enterprise, Healthcare та Edu.

---

## Частина 1. Claude Desktop

1. Відкрийте [останній реліз](https://github.com/Rmonakov/ua-legislation-mcp/releases/latest) і завантажте:
   - `ua-legislation-mcp-<версія>.mcpb` — розширення;
   - `npa-ofitsiini-dzherela.zip` — навичка з правилами роботи з НПА.
2. **Розширення.** У Claude Desktop клацніть на своє ім'я внизу ліворуч → **Settings** → **Desktop app** → біля **Extensions** натисніть **Manage** (у старому вигляді налаштувань — просто розділ **Extensions**) → **Advanced settings** → **Install Extension…** → виберіть файл `.mcpb` → **Install**. Налаштування лишіть типовими.

   > Файл треба встановлювати саме тут. Якщо перетягнути його в поле повідомлення чату, він просто прикріпиться до повідомлення.

   > Кнопка **Передати плагін** у каталозі конекторів і плагінів — не для цього файлу: вона приймає плагіни Claude, а `.mcpb` — це розширення.
3. **Навичка.** **Customize → Skills** → **+** → **Create skill** → **Upload a skill** → виберіть `npa-ofitsiini-dzherela.zip`. У **Settings → Capabilities** має бути ввімкнено «Code execution and file creation» (у новому вигляді — «Create and edit files»).
4. **Перевірка.** У новому чаті напишіть: «Знайди Закон про стандартизацію і покажи статтю 23 з датою редакції».

Розширення працює, поки Claude Desktop відкритий. Першого разу пошук за назвою може тривати до хвилини: сервер завантажує офіційний перелік документів (~50 МБ, оновлюється раз на тиждень).

---

## Частина 2. ChatGPT

ChatGPT підключається лише до сервера з публічною адресою HTTPS. Тому:

- **сервер** запускається на вашому комп'ютері (вікно PowerShell № 1);
- **тунель Cloudflare** відкриває до нього доступ з інтернету (вікно PowerShell № 2);
- **ChatGPT** підключається за адресою тунелю.

Поки ви працюєте з ChatGPT, обидва вікна мають бути відкриті, а комп'ютер — увімкнений.

### Підготовка (один раз)

#### Крок 1. Відкрийте PowerShell

**Пуск** → введіть `PowerShell` → **Windows PowerShell**.

#### Крок 2. Перевірте Node.js і git

```powershell
node -v
git --version
```

Очікувано: номери версій, наприклад `v26.13.1` і `git version 2.56.1.windows.1`. Node.js має бути версії 18.17 або новішої.

Якщо котрась команда не знайдена, встановіть програму. Після встановлення **закрийте й знову відкрийте PowerShell**, інакше нова програма не з'явиться:

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
```

#### Крок 3. Встановіть тунель Cloudflare

```powershell
winget install Cloudflare.cloudflared
```

Закрийте й знову відкрийте PowerShell, потім перевірте:

```powershell
cloudflared --version
```

#### Крок 4. Перевірте доступ до порталу Ради

> **Важливо для Windows:** у PowerShell пишіть **`npx.cmd`**, а не `npx`. Звичайний `npx` зазвичай блокується з помилкою `running scripts is disabled on this system`. Змінювати налаштування безпеки Windows для цього не потрібно.

```powershell
npx.cmd -y github:Rmonakov/ua-legislation-mcp --check
```

Перший запуск триває до хвилини: npx завантажує сервер із GitHub і встановлює залежності. Очікувано:

```
Перевірка доступу до https://data.rada.gov.ua (User-Agent: OpenData)…
OK: «Конституція України» — Чинний, редакція від 01.01.2020.
Портал доступний з цього комп'ютера. Сервер готовий до роботи.
```

Повідомлення `npm notice New major version of npm available!` можна ігнорувати: на роботу воно не впливає.

### Запуск (щоразу, коли працюєте з ChatGPT)

#### Крок 5. Вікно № 1 — сервер

```powershell
$s = [guid]::NewGuid().ToString("N"); "Секрет: $s"
npx.cmd -y github:Rmonakov/ua-legislation-mcp --http --port 8787 --secret $s
```

Перший рядок створює випадковий **секрет**, тобто частину адреси, без якої сервером ніхто інший не скористається. Скопіюйте його.

Очікувано:

```
ua-legislation-mcp 0.1.2: HTTP-сервер запущено.
  MCP: http://127.0.0.1:8787/mcp/<секрет>
  Стан: http://127.0.0.1:8787/health
```

**Не закривайте це вікно.**

#### Крок 6. Вікно № 2 — тунель

Відкрийте **нове** вікно PowerShell і виконайте:

```powershell
cloudflared tunnel --url http://localhost:8787
```

За кілька секунд у рамці з'явиться адреса на зразок:

```
https://щось-там-випадкове.trycloudflare.com
```

**Не закривайте і це вікно.**

#### Крок 7. Складіть і перевірте адресу

Адреса для ChatGPT складається з адреси тунелю, `/mcp/` і секрету:

```
https://щось-там-випадкове.trycloudflare.com/mcp/<секрет>
```

Перевірка в браузері:

- `https://щось-там-випадкове.trycloudflare.com/health` → має показати `{"ok":true,…}`;
- повна адреса з `/mcp/<секрет>` → покаже «MCP-сервер працює. Цю адресу вставляють у клієнт MCP…». **Це нормально:** браузер надсилає не той тип запиту, яким користується ChatGPT. Така відповідь означає, що тунель і секрет правильні.

### Підключення в ChatGPT (перший раз)

#### Крок 8. Додайте сервер

1. На [chatgpt.com](https://chatgpt.com) у бічній панелі відкрийте **Plugins** → **+** → **Add custom MCP server**.
2. **Name:** `Законодавство України`. **Description** (необов'язково): `Офіційні тексти НПА з бази «Законодавство України»`.
3. **URL:** адреса з кроку 7 (разом із `/mcp/<секрет>`).
4. **Authentication:** **No authentication**.
5. Підтвердіть попередження (**I understand and want to continue**) → **Create as a plugin**.

> У старому вигляді ChatGPT шлях інший: **Settings → Apps → Advanced settings → Developer mode**, потім **Create app**. Поля ті самі.

#### Крок 9. Перевірте в чаті

У новому чаті ввімкніть плагін через **+** у полі повідомлення і напишіть:

> Знайди Закон про стандартизацію і покажи статтю 23 з датою редакції.

ChatGPT може попросити підтвердити виклик інструмента — це нормально. Усі інструменти сервера лише читають дані.

#### Крок 10. Навичка (необов'язково, але рекомендовано)

Навичка вчить асистента правил роботи з НПА: лише офіційні джерела, дата редакції в кожному посиланні, реєстр джерел у кінці документа.

1. Завантажте `npa-ofitsiini-dzherela.zip` з [останнього релізу](https://github.com/Rmonakov/ua-legislation-mcp/releases/latest).
2. **Plugins → Skills → Create → Upload from your computer** → виберіть архів.

Якщо вкладки **Skills** немає (наприклад, на Plus чи Pro), створіть у ChatGPT проєкт для роботи з НПА й вставте в його інструкції текст [`SKILL.md`](../skills/npa-ofitsiini-dzherela/SKILL.md).

### Наступного разу

1. Повторіть **кроки 5 і 6**: два вікна PowerShell.
2. Адреса тунелю і секрет щоразу **нові**, тож оновіть адресу в налаштуваннях плагіна в **Plugins** (або видаліть плагін і додайте знову, крок 8).
3. Щоб зупинити роботу, закрийте обидва вікна (або натисніть `Ctrl+C` у кожному).

---

## Частина 3. Інші програми

У Windows ці програми запускають `npx` через `cmd /c`:

**Claude Code:**

```powershell
claude mcp add ua-legislation -- cmd /c npx -y github:Rmonakov/ua-legislation-mcp
```

**Cursor** (`%USERPROFILE%\.cursor\mcp.json`), **Gemini CLI** (`%USERPROFILE%\.gemini\settings.json`), ручне налаштування **Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "ua-legislation": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "github:Rmonakov/ua-legislation-mcp"]
    }
  }
}
```

**VS Code** (`.vscode\mcp.json`):

```json
{
  "servers": {
    "ua-legislation": {
      "type": "stdio",
      "command": "cmd",
      "args": ["/c", "npx", "-y", "github:Rmonakov/ua-legislation-mcp"]
    }
  }
}
```

**Codex CLI** (`%USERPROFILE%\.codex\config.toml`):

```toml
[mcp_servers.ua-legislation]
command = "cmd"
args = ["/c", "npx", "-y", "github:Rmonakov/ua-legislation-mcp"]
```

---

## Якщо щось пішло не так

| Що бачите | Що робити |
|---|---|
| `npx.ps1 cannot be loaded because running scripts is disabled` | Пишіть `npx.cmd` замість `npx` (і `npm.cmd` замість `npm`). |
| `node`, `git` або `cloudflared` «is not recognized» | Встановіть програму (кроки 2–3) і **знову відкрийте** PowerShell. |
| `--check` пише «НЕ ВДАЛОСЯ… не відповів» | Перевірте інтернет; вимкніть VPN із закордонною адресою. Сервер Ради пускає лише українські IP. |
| `--check` або сервер пише про 403 | Захист порталу від DDoS тимчасово обмежив вашу адресу. Зачекайте кілька хвилин; якщо не минає — напишіть адміністратору порталу на lawup@rada.gov.ua (вкажіть IP і адресу запиту). |
| `npm notice New major version of npm available!` | Ігноруйте; оновлювати npm не обов'язково. |
| У браузері «MCP-сервер працює…» або «Method not allowed» | Усе гаразд: цю адресу вставляють у ChatGPT, а не відкривають у браузері. |
| ChatGPT не може підключитися | Перевірте, що обидва вікна відкриті; що `…/health` відкривається; що адреса закінчується на `/mcp/<секрет>`; що після перезапуску ви оновили адресу в плагіні. |
| `EADDRINUSE` (порт зайнятий) | Візьміть інший порт, наприклад `--port 8788`, і той самий порт у команді тунелю: `--url http://localhost:8788`. |
| Розширення в Claude встановилося, але інструментів немає | Перезапустіть Claude Desktop і перевірте, що розширення ввімкнене в **Extensions**. |

Не знайшли свого випадку? Створіть [issue](https://github.com/Rmonakov/ua-legislation-mcp/issues) і додайте знімок екрана.
