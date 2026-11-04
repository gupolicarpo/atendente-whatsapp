// Atendente de IA para WhatsApp — API oficial (Cloud API) + qualquer provedor de IA
// compatível com a API da OpenAI (OpenRouter, OpenAI, Gemini, Anthropic, Ollama local...).
// Sem dependências: só Node.js 18+.

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const env = (name, fallback) => {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Falta a variável de ambiente ${name}`);
  return v;
};

const config = {
  port: Number(env('PORT', 3000)),
  verifyToken: env('VERIFY_TOKEN'),
  appSecret: env('APP_SECRET'),
  whatsappToken: env('WHATSAPP_TOKEN'),
  graphBaseUrl: env('GRAPH_BASE_URL', 'https://graph.facebook.com'),
  graphVersion: env('GRAPH_VERSION', 'v25.0'),
  aiBaseUrl: env('AI_BASE_URL', 'https://openrouter.ai/api/v1'),
  aiApiKey: env('AI_API_KEY', ''),
  aiModel: env('AI_MODEL'),
  aiExtraBody: JSON.parse(env('AI_EXTRA_BODY', '') || '{}'), // opções extras do provedor, ex.: {"thinking":{"type":"disabled"}} no DeepSeek
  businessFile: env('BUSINESS_FILE', ''), // se definido, vence o DATA_DIR
};

// Pasta onde o texto do negócio é salvo: DATA_DIR, ou /data (volume do Railway) se existir e der para gravar, ou a pasta do app.
function resolveDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  try { fs.accessSync('/data', fs.constants.W_OK); return '/data'; } catch { return __dirname; }
}
const dataDir = resolveDataDir();
const savedBusinessFile = path.join(dataDir, 'negocio.md');
const bundledBusinessFile = path.join(__dirname, 'negocio.md');
const MAX_BUSINESS_BYTES = 50 * 1024;

const HANDOFF_MARKER = '[HUMANO]';
const HANDOFF_REPLY = 'Vou passar sua mensagem para a nossa equipe. Já já alguém te responde por aqui. 🙂';
const NON_TEXT_REPLY = 'Por enquanto eu só consigo ler mensagens de texto. Pode escrever sua dúvida?';
const PAUSE_MS = 12 * 60 * 60 * 1000; // depois de chamar um humano, o bot fica quieto 12h com esse cliente
const HISTORY_TURNS = 10;

// Lê o texto ATUAL a cada chamada: salvar em /admin vale na hora, sem reiniciar.
function readBusiness() {
  if (config.businessFile) return fs.readFileSync(config.businessFile, 'utf8');
  if (fs.existsSync(savedBusinessFile)) return fs.readFileSync(savedBusinessFile, 'utf8');
  return fs.readFileSync(bundledBusinessFile, 'utf8');
}
const buildSystemPrompt = () => `Você é o atendente virtual deste negócio no WhatsApp. Responda em português do Brasil, de forma curta e simpática.
Use SOMENTE as informações abaixo. Se a resposta não estiver nelas, ou se o cliente pedir para falar com uma pessoa, reclamar ou negociar, responda apenas: ${HANDOFF_MARKER}
Nunca invente preços, prazos ou políticas.

--- INFORMAÇÕES DO NEGÓCIO ---
${readBusiness()}`;

// Memória simples (some ao reiniciar o servidor).
const seen = new Set();            // ids de mensagens já tratadas (a Meta pode reenviar)
const history = new Map();         // cliente -> últimas mensagens
const pausedUntil = new Map();     // cliente -> horário até quando o bot fica quieto

function validSignature(rawBody, header) {
  if (!header || !header.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', config.appSecret).update(rawBody).digest('hex');
  const received = header.slice('sha256='.length);
  return received.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

async function askAI(contact, text) {
  const turns = history.get(contact) ?? [];
  const res = await fetch(`${config.aiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.aiApiKey}` },
    body: JSON.stringify({
      ...config.aiExtraBody,
      model: config.aiModel,
      messages: [{ role: 'system', content: buildSystemPrompt() }, ...turns, { role: 'user', content: text }],
    }),
  });
  if (!res.ok) throw new Error(`Provedor de IA respondeu ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (data.usage) console.log(`[custo] ${contact}: ${data.usage.prompt_tokens} tokens de entrada, ${data.usage.completion_tokens} de saída`);
  const answer = data.choices[0].message.content.trim();
  history.set(contact, [...turns, { role: 'user', content: text }, { role: 'assistant', content: answer }].slice(-HISTORY_TURNS));
  return answer;
}

async function sendText(phoneNumberId, to, body) {
  const res = await fetch(`${config.graphBaseUrl}/${config.graphVersion}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.whatsappToken}` },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body } }),
  });
  if (!res.ok) throw new Error(`WhatsApp respondeu ${res.status}: ${await res.text()}`);
}

async function handleMessage(phoneNumberId, msg) {
  if (seen.has(msg.id)) return;
  seen.add(msg.id);
  const contact = msg.from;
  if ((pausedUntil.get(contact) ?? 0) > Date.now()) return;

  if (msg.type !== 'text') return sendText(phoneNumberId, contact, NON_TEXT_REPLY);

  const answer = await askAI(contact, msg.text.body);
  if (answer.includes(HANDOFF_MARKER)) {
    pausedUntil.set(contact, Date.now() + PAUSE_MS);
    console.log(`[humano] ${contact} precisa de atendimento humano`);
    return sendText(phoneNumberId, contact, HANDOFF_REPLY);
  }
  return sendText(phoneNumberId, contact, answer);
}

async function handleWebhook(payload) {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      for (const msg of value.messages ?? []) {
        await handleMessage(value.metadata.phone_number_id, msg)
          .catch((err) => console.error(`[erro] mensagem ${msg.id}:`, err.message));
      }
    }
  }
}

// ---- Página /admin: o dono edita o texto do negócio pelo navegador. Senha = VERIFY_TOKEN. ----
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function samePassword(given) {
  const a = crypto.createHash('sha256').update(String(given ?? '')).digest();
  const b = crypto.createHash('sha256').update(config.verifyToken).digest();
  return crypto.timingSafeEqual(a, b);
}

function adminPage({ text = null, message = '', error = false, senha = '' } = {}) {
  const form = text === null
    ? `<label>Senha</label><input type="password" name="senha" autocomplete="current-password" required>
       <p class="ajuda">Para ver e editar o texto, digite a senha e clique em Entrar.</p>
       <button type="submit" name="acao" value="entrar">Entrar</button>`
    : `<input type="hidden" name="senha" value="${esc(senha)}">
       <label>Informações do seu negócio</label>
       <textarea name="negocio" rows="18">${esc(text)}</textarea>
       <p class="ajuda">Escreva produtos, preços, horários, regras e também o que você NÃO faz. O atendente só responde com o que estiver aqui.</p>
       <button type="submit" name="acao" value="salvar">Salvar</button>`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Meu atendente</title><style>
body{font-family:system-ui,sans-serif;margin:0;padding:16px;background:#f5f5f5;color:#222}
main{max-width:720px;margin:0 auto;background:#fff;padding:20px;border-radius:12px}
input,textarea{width:100%;box-sizing:border-box;font-size:16px;padding:10px;margin:6px 0 14px;border:1px solid #bbb;border-radius:8px}
textarea{min-height:300px;font-family:inherit}
button{width:100%;font-size:18px;padding:14px;border:0;border-radius:8px;background:#25a244;color:#fff}
.ajuda{color:#555;font-size:14px}.ok{color:#177a2e;font-weight:bold}.erro{color:#b00020;font-weight:bold}
</style></head><body><main><h1>Meu atendente</h1>
${message ? `<p class="${error ? 'erro' : 'ok'}">${esc(message)}</p>` : ''}
<form method="post" action="/admin">${form}</form></main></body></html>`;
}

function sendHtml(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(html);
}

function saveBusiness(text) {
  const target = config.businessFile || savedBusinessFile;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, target);
}

function handleAdmin(req, res) {
  if (req.method === 'GET') return sendHtml(res, 200, adminPage());
  if (req.method !== 'POST') return res.writeHead(405).end();
  const chunks = [];
  let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size <= MAX_BUSINESS_BYTES * 4) chunks.push(c);
  });
  req.on('end', () => {
    if (size > MAX_BUSINESS_BYTES * 4) return sendHtml(res, 413, adminPage({ message: 'Texto grande demais.', error: true }));
    const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
    const senha = req.headers['x-admin-password'] ?? form.get('senha');
    if (!samePassword(senha)) return sendHtml(res, 401, adminPage({ message: 'Senha incorreta.', error: true }));
    const novo = form.get('negocio');
    if (novo === null) return sendHtml(res, 200, adminPage({ senha, text: readBusiness() }));
    if (Buffer.byteLength(novo, 'utf8') > MAX_BUSINESS_BYTES) {
      return sendHtml(res, 413, adminPage({ senha, text: novo, message: 'Texto grande demais (máximo 50 KB).', error: true }));
    }
    try { saveBusiness(novo); } catch (err) {
      console.error('[erro] ao salvar negocio.md:', err.message);
      return sendHtml(res, 500, adminPage({ senha, text: novo, message: 'Não consegui salvar. Confira o volume em /data.', error: true }));
    }
    sendHtml(res, 200, adminPage({ senha, text: novo, message: 'Salvo ✓' }));
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/admin') return handleAdmin(req, res);
  if (url.pathname !== '/webhook') return res.writeHead(404).end();

  if (req.method === 'GET') {
    const ok = url.searchParams.get('hub.mode') === 'subscribe' &&
      url.searchParams.get('hub.verify_token') === config.verifyToken;
    return ok ? res.writeHead(200).end(url.searchParams.get('hub.challenge')) : res.writeHead(403).end();
  }

  if (req.method === 'POST') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      if (!validSignature(raw, req.headers['x-hub-signature-256'])) return res.writeHead(401).end();
      res.writeHead(200).end(); // responde já; a Meta reenvia se demorar
      handleWebhook(JSON.parse(raw)).catch((err) => console.error('[erro]', err.message));
    });
    return;
  }

  res.writeHead(405).end();
});

if (require.main === module) {
  server.listen(config.port, () => console.log(`Atendente rodando na porta ${config.port}`));
}

module.exports = { server, buildSystemPrompt };
