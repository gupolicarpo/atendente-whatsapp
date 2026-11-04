// Testa o atendente com servidores falsos que imitam a Meta (WhatsApp) e o provedor de IA.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atendente-'));

const calls = { ai: [], whatsapp: [] };
let nextAnswer = 'Olá!';

const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const json = JSON.parse(body);
    if (req.url === '/ai/chat/completions') {
      calls.ai.push({ headers: req.headers, json });
      res.end(JSON.stringify({ choices: [{ message: { content: nextAnswer } }], usage: { prompt_tokens: 500, completion_tokens: 40 } }));
    } else {
      calls.whatsapp.push({ url: req.url, headers: req.headers, json });
      res.end(JSON.stringify({ messages: [{ id: 'wamid.resposta' }] }));
    }
  });
});

let base;
let server;
before(async () => {
  await new Promise((r) => fake.listen(0, r));
  const fakeUrl = `http://localhost:${fake.address().port}`;
  Object.assign(process.env, {
    VERIFY_TOKEN: 'senha-webhook', APP_SECRET: 'segredo-app', WHATSAPP_TOKEN: 'token-wa',
    GRAPH_BASE_URL: fakeUrl, AI_BASE_URL: `${fakeUrl}/ai`, AI_API_KEY: 'chave-ia', AI_MODEL: 'modelo-barato',
    DATA_DIR: dataDir,
    AI_EXTRA_BODY: '{"thinking":{"type":"disabled"}}',
  });
  ({ server } = require('../server.js'));
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => { server.close(); fake.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

const reset = () => { calls.ai = []; calls.whatsapp = []; };
const wait = async (cond) => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
};
const sign = (raw) => 'sha256=' + crypto.createHmac('sha256', 'segredo-app').update(raw).digest('hex');
const payload = (msg) => JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [{ id: 'WABA', changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp', metadata: { phone_number_id: '123456' }, messages: [msg],
  } }] }],
});
const post = (raw, signature = sign(raw)) => fetch(`${base}/webhook`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature }, body: raw,
});
const textMsg = (id, from, body) => ({ id, from, timestamp: '1', type: 'text', text: { body } });

test('verificação do webhook: senha certa devolve o challenge, errada é recusada', async () => {
  const ok = await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=senha-webhook&hub.challenge=abc123`);
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), 'abc123');
  const bad = await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=errada&hub.challenge=abc123`);
  assert.equal(bad.status, 403);
});

test('mensagem com assinatura falsa é recusada e não gera resposta', async () => {
  reset();
  const res = await post(payload(textMsg('m0', '5531999990000', 'oi')), 'sha256=' + 'f'.repeat(64));
  assert.equal(res.status, 401);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(calls.ai.length + calls.whatsapp.length, 0);
});

test('pergunta de cliente: chama a IA com as informações do negócio e responde pelo WhatsApp', async () => {
  reset();
  nextAnswer = 'O bolo de chocolate de 1 kg custa R$ 90.';
  const res = await post(payload(textMsg('m1', '5531999990001', 'quanto custa o bolo de chocolate?')));
  assert.equal(res.status, 200);
  await wait(() => calls.whatsapp.length === 1);

  const ai = calls.ai[0];
  assert.equal(ai.headers.authorization, 'Bearer chave-ia');
  assert.equal(ai.json.model, 'modelo-barato');
  assert.deepEqual(ai.json.thinking, { type: 'disabled' });
  assert.match(ai.json.messages[0].content, /Bolo de chocolate \(1 kg, serve 10 pessoas\): R\$ 90/);
  assert.equal(ai.json.messages.at(-1).content, 'quanto custa o bolo de chocolate?');

  const wa = calls.whatsapp[0];
  assert.equal(wa.url, '/v25.0/123456/messages');
  assert.equal(wa.headers.authorization, 'Bearer token-wa');
  assert.deepEqual(wa.json, { messaging_product: 'whatsapp', to: '5531999990001', type: 'text', text: { body: 'O bolo de chocolate de 1 kg custa R$ 90.' } });
});

test('a conversa guarda contexto: a segunda pergunta leva a primeira junto', async () => {
  reset();
  nextAnswer = 'Sim, entregamos por R$ 15 até 10 km.';
  await post(payload(textMsg('m1b', '5531999990001', 'e vocês entregam?')));
  await wait(() => calls.whatsapp.length === 1);
  const contents = calls.ai[0].json.messages.map((m) => m.content);
  assert.ok(contents.includes('quanto custa o bolo de chocolate?'));
  assert.ok(contents.includes('O bolo de chocolate de 1 kg custa R$ 90.'));
});

test('mensagem repetida pela Meta (mesmo id) só é respondida uma vez', async () => {
  reset();
  nextAnswer = 'Abrimos de segunda a sábado, das 9h às 19h.';
  const raw = payload(textMsg('m2', '5531999990002', 'que horas abre?'));
  await post(raw);
  await post(raw);
  await wait(() => calls.whatsapp.length >= 1);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(calls.ai.length, 1);
  assert.equal(calls.whatsapp.length, 1);
});

test('fora do que o negócio informou: chama um humano e o bot fica quieto com esse cliente', async () => {
  reset();
  nextAnswer = '[HUMANO]';
  await post(payload(textMsg('m3', '5531999990003', 'quero reclamar do meu pedido')));
  await wait(() => calls.whatsapp.length === 1);
  assert.match(calls.whatsapp[0].json.text.body, /nossa equipe/);

  await post(payload(textMsg('m4', '5531999990003', 'alô?')));
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(calls.ai.length, 1);
  assert.equal(calls.whatsapp.length, 1);
});

test('áudio ou imagem: responde pedindo texto, sem gastar com a IA', async () => {
  reset();
  await post(payload({ id: 'm5', from: '5531999990004', timestamp: '1', type: 'audio', audio: { id: 'x' } }));
  await wait(() => calls.whatsapp.length === 1);
  assert.equal(calls.ai.length, 0);
  assert.match(calls.whatsapp[0].json.text.body, /texto/);
});

const adminPost = (fields) => fetch(`${base}/admin`, {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields),
});

test('/admin sem senha mostra só o formulário de senha, sem vazar o texto', async () => {
  const res = await fetch(`${base}/admin`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /type="password"/);
  assert.ok(!html.includes('Doces da Ana') && !html.includes('Bolo de chocolate'));
});

test('/admin com senha errada: 401 e nada revelado', async () => {
  const res = await adminPost({ senha: 'errada', negocio: 'hackeado' });
  assert.equal(res.status, 401);
  const html = await res.text();
  assert.ok(!html.includes('Bolo de chocolate'));
  assert.ok(!fs.existsSync(path.join(dataDir, 'negocio.md')));
});

test('/admin com senha certa salva, a IA passa a usar o texto novo e ele fica no DATA_DIR', async () => {
  const res = await adminPost({ senha: 'senha-webhook', negocio: 'Pizzaria do Ze: pizza grande R$ 55.' });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Salvo ✓/);
  assert.equal(fs.readFileSync(path.join(dataDir, 'negocio.md'), 'utf8'), 'Pizzaria do Ze: pizza grande R$ 55.');
  assert.deepEqual(fs.readdirSync(dataDir), ['negocio.md']);

  reset();
  nextAnswer = 'R$ 55.';
  await post(payload(textMsg('m6', '5531999990006', 'quanto é a pizza?')));
  await wait(() => calls.ai.length === 1);
  assert.ok(calls.ai[0].json.messages[0].content.includes('Pizzaria do Ze: pizza grande R$ 55.'));
  assert.ok(!calls.ai[0].json.messages[0].content.includes('Doces da Ana'));
});
