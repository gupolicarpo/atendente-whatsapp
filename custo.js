// Quanto custa por mês? Uso: node custo.js [respostas_por_mes]
// Preços verificados em 02/11/2026 — confira as fontes antes de usar, eles mudam.

const respostas = Number(process.argv[2] ?? 3000);

const DOLAR = 5.40;                 // USD/BRL, fechamento 30/10/2026 (renovainvest.com.br)
const WHATSAPP_GRATIS = 1000;       // respostas grátis por mês por número
const WHATSAPP_POR_RESPOSTA = 0.035; // R$, desde 01/10/2026 (Forbes Brasil, 01/10/2026)
const HOSPEDAGEM_USD = 5;           // Railway Hobby, US$5/mês com US$5 de uso incluso (docs.railway.com)
// Medido no teste real de 02/11/2026 (DeepSeek, negocio.md de exemplo): ~430 tokens de entrada e ~24 de saída por resposta.
// Um negocio.md maior aumenta a entrada; arredondamos para cima.
const TOKENS_ENTRADA = 500;
const TOKENS_SAIDA = 40;

const modelos = {                   // US$ por milhão de tokens (entrada, saída) — lista de 17/10/2026 (dev.to/freetierkits)
  'deepseek-flash': [0.30, 1.20],   // preço de pico; fora do pico é metade
  'gemini-2.5-flash-lite': [0.10, 0.40],
  'gpt-4.1-mini': [0.40, 1.60],
};

const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const whatsapp = Math.max(0, respostas - WHATSAPP_GRATIS) * WHATSAPP_POR_RESPOSTA;
const hospedagem = HOSPEDAGEM_USD * DOLAR;

console.log(`\n${respostas} respostas por mês\n`);
for (const [nome, [entrada, saida]] of Object.entries(modelos)) {
  const ia = respostas * (TOKENS_ENTRADA * entrada + TOKENS_SAIDA * saida) / 1e6 * DOLAR;
  console.log(`Nosso app com ${nome}: ${brl(whatsapp + ia + hospedagem)}  (WhatsApp ${brl(whatsapp)} + IA ${brl(ia)} + servidor ${brl(hospedagem)})`);
}

// Agente de IA da própria Meta: US$2 por milhão de tokens desde 01/08/2026 (Forbes Brasil, 01/10/2026).
// Tokens por resposta não são públicos; a Wati (revendedora da API, 09/10/2026) estima ~US$0,05 por resposta.
const meta = respostas * 0.05 * DOLAR;
console.log(`Agente da Meta (estimativa da Wati, só a IA): ${brl(meta)}`);

// Agência: ~R$1.200 de implantação + ~R$600/mês com plataforma, mensagens e manutenção (Digisac, 05/10/2026).
console.log(`Agência: ${brl(600)}/mês + ${brl(1200)} de implantação\n`);
