#!/usr/bin/env node
import http from 'node:http';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { loadConfig, VERSION } from '../src/config.js';
import { RadaClient } from '../src/rada-client.js';
import { IndexStore } from '../src/index-store.js';
import { createMcpServer } from '../src/server.js';
import { fmtDate, statusLabel } from '../src/format.js';

const HELP = `ua-legislation-mcp ${VERSION}
MCP-сервер для офіційної бази «Законодавство України» (портал відкритих даних ВРУ, data.rada.gov.ua).

Використання:
  ua-legislation-mcp                      локальний режим (stdio) для Claude Desktop, Claude Code, Cursor, VS Code, Codex, Gemini CLI
  ua-legislation-mcp --http [опції]       HTTP-режим (Streamable HTTP) для ChatGPT, claude.ai та інших віддалених клієнтів
  ua-legislation-mcp --check              перевірити, чи доступний портал з цього комп'ютера

Опції HTTP-режиму:
  --port <n>        порт (типово 8787, або змінна PORT)
  --host <адреса>   адреса (типово 127.0.0.1; 0.0.0.0 — для сервера/контейнера)
  --secret <рядок>  секретний шлях: кінцева точка стає /mcp/<рядок> (або змінна RADA_MCP_SECRET)

Змінні середовища: RADA_PACE_SECONDS (≥5, типово 6), RADA_DAILY_LIMIT (типово 2000),
RADA_DAILY_MB (типово 150), RADA_CACHE_DIR, RADA_INDEX_MAX_AGE_DAYS (типово 7),
RADA_COMPAT_TOOLS (auto|on|off — інструменти search/fetch для ChatGPT), RADA_DEBUG=1.`;

function parseArgs(argv) {
  const a = { http: false, check: false, help: false, version: false, port: null, host: null, secret: null };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--http') a.http = true;
    else if (v === '--check') a.check = true;
    else if (v === '--help' || v === '-h') a.help = true;
    else if (v === '--version' || v === '-v') a.version = true;
    else if (v === '--port') a.port = Number(argv[++i]);
    else if (v === '--host') a.host = argv[++i];
    else if (v === '--secret') a.secret = argv[++i];
    else if (v.startsWith('--port=')) a.port = Number(v.slice(7));
    else if (v.startsWith('--host=')) a.host = v.slice(7);
    else if (v.startsWith('--secret=')) a.secret = v.slice(9);
    else {
      console.error(`Невідомий параметр: ${v}\n\n${HELP}`);
      process.exit(2);
    }
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(HELP);
  process.exit(0);
}
if (args.version) {
  console.log(VERSION);
  process.exit(0);
}

const cfg = loadConfig();
const debug = process.env.RADA_DEBUG === '1';
const log = (msg) => {
  if (debug) process.stderr.write(`[ua-legislation-mcp] ${msg}\n`);
};
const client = new RadaClient(cfg, { log });
const index = new IndexStore(client, cfg, { log });
const compatFor = (mode) => (cfg.compatTools === 'on' ? true : cfg.compatTools === 'off' ? false : mode === 'http');

async function runCheck() {
  console.log(`Перевірка доступу до ${cfg.baseUrl} (User-Agent: OpenData)…`);
  try {
    const card = await client.getCard('254к/96-вр', { fresh: true });
    console.log(`OK: «${String(card.nazva).trim()}» — ${statusLabel(card.status)}, редакція від ${fmtDate(card.poddat)}.`);
    console.log('Портал доступний з цього комп\'ютера. Сервер готовий до роботи.');
    process.exit(0);
  } catch (err) {
    console.error(`НЕ ВДАЛОСЯ: ${err.message}`);
    process.exit(1);
  }
}

async function runStdio() {
  const server = createMcpServer({ client, index, compat: compatFor('stdio') });
  await server.connect(new StdioServerTransport());
  log(`stdio server started, cache: ${cfg.cacheDir}`);
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

async function runHttp() {
  const port = Number.isFinite(args.port) && args.port !== null ? args.port : Number(process.env.PORT) || 8787;
  const host = args.host || process.env.HOST || '127.0.0.1';
  const secret = (args.secret || process.env.RADA_MCP_SECRET || '').trim();
  const mcpPath = secret ? `/mcp/${secret}` : '/mcp';
  const compat = compatFor('http');

  // CORS вимкнено за замовчуванням: інакше будь-яка вебсторінка могла б звертатися до локального сервера.
  const corsOrigin = (process.env.RADA_CORS_ORIGIN || '').trim();

  const httpServer = http.createServer(async (req, res) => {
    if (corsOrigin) {
      res.setHeader('Access-Control-Allow-Origin', corsOrigin);
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID');
      res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    }
    if (req.method === 'OPTIONS' && corsOrigin) {
      res.writeHead(204);
      res.end();
      return;
    }
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname.replace(/\/+$/, '') || '/';

    if (pathname === '/health') {
      sendJson(res, 200, { ok: true, name: 'ua-legislation-mcp', version: VERSION, usage: client.usageInfo() });
      return;
    }
    const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const allowed = pathname === mcpPath || (secret && pathname === '/mcp' && bearer === secret);
    if (!allowed) {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, {
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'MCP-сервер працює. Цю адресу вставляють у клієнт MCP (ChatGPT, claude.ai тощо), а не відкривають у браузері. / MCP server is running; add this URL to an MCP client (POST only).',
        },
        id: null,
      });
      return;
    }
    let body;
    try {
      const raw = await readBody(req);
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      sendJson(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null });
      return;
    }
    try {
      const server = createMcpServer({ client, index, compat });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => {
        transport.close().catch(() => {});
        server.close().catch(() => {});
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      log(`request failed: ${err.stack || err.message}`);
      if (!res.headersSent) sendJson(res, 500, { jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  });

  httpServer.listen(port, host, () => {
    const addr = httpServer.address();
    const shown = `http://${host === '0.0.0.0' ? 'localhost' : host}:${addr.port}${mcpPath}`;
    process.stderr.write(
      `ua-legislation-mcp ${VERSION}: HTTP-сервер запущено.\n` +
        `  MCP: ${shown}\n` +
        `  Стан: http://${host === '0.0.0.0' ? 'localhost' : host}:${addr.port}/health\n` +
        (secret ? '' : '  Порада: для публічної адреси (тунель, сервер) задайте --secret, щоб ніхто інший не користувався вашим підключенням.\n'),
    );
  });

  const shutdown = () => httpServer.close(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (args.check) await runCheck();
else if (args.http) await runHttp();
else await runStdio();
