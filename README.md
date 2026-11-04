# Atendente de IA para WhatsApp

Um atendente que responde seus clientes no WhatsApp usando as informações do **seu** negócio, pela **API oficial da Meta**, com o **provedor de IA que você escolher**. Código aberto (MIT), sem mensalidade de plataforma.

- Responde só com o texto do seu negócio (que você edita na página `/admin`). Não inventa preço nem prazo.
- Se a pergunta sair do que você informou, ou o cliente quiser falar com uma pessoa, ele avisa que vai chamar a equipe e fica quieto com esse cliente por 12 horas.
- Funciona com OpenRouter, OpenAI, Google Gemini ou um modelo rodando no seu computador (Ollama).

**Quanto custa?** Rode `node custo.js 3000` (troque 3000 pelo número de respostas por mês).

---

## Instalação (meta: menos de 45 minutos)

Você vai precisar de:
- Uma conta no Railway (servidor; plano Hobby US$5/mês). Não precisa de GitHub nem de código.
- Uma conta Meta Business e um número de telefone para o WhatsApp
- Uma chave de um provedor de IA (ex.: OpenRouter)

### 1. Crie o app no painel da Meta

1. Acesse developers.facebook.com → **My Apps** → **Create app**.
2. Em **Use cases**, marque **Connect with customers through WhatsApp** e avance até criar o app.
3. No painel do app, abra o caso de uso e vá em **Step 1. Try it out**:
   - A Meta já te dá um **número de teste**.
   - Clique em **Generate token** e guarde o token → isso é o `WHATSAPP_TOKEN`. **Atenção:** esse token vale só ~24 horas. Serve para testar; para uso de verdade, gere um token permanente (veja "Depois do teste").
   - Em **Recipient**, adicione o seu WhatsApp pessoal e clique em **Send message** para conferir que chega.
4. Em **App settings → Basic**, clique em **Show** no **App secret** e guarde → isso é o `APP_SECRET`.
5. **Step 3. Business verification** é opcional (2–10 dias úteis). Pode pular: o bot funciona sem ela.

### 2. Coloque o atendente no ar (Railway)
<!-- TODO: o link final do template é definido depois de publicar o template no Railway. -->
[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template?template=https://github.com/gupolicarpo/atendente-whatsapp)

1. Clique no botão acima e entre no Railway. O app vai rodar na **sua** conta e no **seu** servidor.
2. Preencha as variáveis:
   - `WHATSAPP_TOKEN`, `APP_SECRET` (passo 1)
   - `VERIFY_TOKEN`: invente uma senha **só com letras e números** (ex.: `zap2026teste`). Ela também é a **senha da página /admin**.
   - `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` (e `AI_EXTRA_BODY` no DeepSeek): veja o `.env.example`
3. Adicione um **Volume** ao serviço (clique com o botão direito no serviço → **Attach Volume**) com o caminho de montagem `/data`. Sem isso, o texto do seu negócio some quando o servidor reinicia.
4. Em **Settings → Networking**, gere um domínio público. Copie o endereço (ex.: `seu-app.up.railway.app`).
5. **Teste o servidor:** abra `https://seu-app.up.railway.app/webhook?hub.mode=subscribe&hub.verify_token=SUASENHA&hub.challenge=funcionou`. Tem que aparecer **funcionou**. Se aparecer "HTTP ERROR 403", a senha não bate com o `VERIFY_TOKEN`.

### 3. Escreva as informações do seu negócio
1. Abra `https://seu-app.up.railway.app/admin` (pode ser no celular).
2. Digite a senha (o `VERIFY_TOKEN`) e clique em **Entrar**.
3. Troque o exemplo ("Doces da Ana") pelas suas informações: produtos, preços, horários, entrega, pagamento e também o que você **não** faz.
4. Clique em **Salvar**. Vale na hora, sem reiniciar.

### 4. Ligue o WhatsApp ao servidor
1. No painel da Meta, na configuração do webhook do WhatsApp:
   - **Callback URL**: o endereço do Railway + `/webhook`
   - **Verify token**: a mesma senha do `VERIFY_TOKEN`
2. Clique em **Verify and save** e confira que o campo **messages** está ativado em **Webhook fields**.

### 5. Teste
Mande `quanto custa o bolo de chocolate?` para o número de teste. A resposta deve chegar em poucos segundos. Nos logs do Railway aparecem linhas `[custo]` com os tokens usados em cada resposta.

### Depois do teste
- Troque o token de 24 horas por um **token permanente** (testado em 02/11/2026):
  1. Em business.facebook.com → **Settings → System users**, clique em **Add**, dê um nome (ex.: `atendente-bot`) e escolha **Admin**.
  2. **Assign assets**: o seu app e a sua conta do WhatsApp, com controle total.
  3. **Generate new token** → escolha o app → validade **Never** → permissões `whatsapp_business_messaging` e `whatsapp_business_management`. Copie na hora (só aparece uma vez).
  4. No Railway, troque o valor de `WHATSAPP_TOKEN` pelo token novo.
- Troque o número de teste pelo número do seu negócio em **Step 2. Production setup**. *A validar.*

> Acima de 1.000 respostas por mês, a Meta cobra por resposta. Para isso, cadastre uma forma de pagamento na sua conta Meta Business.

---

## Avançado: rodar no próprio computador
Precisa de Node 18+. Copie `.env.example` para `.env`, preencha, e rode `npm start`. O texto do negócio fica em `negocio.md` na pasta do app (ou em `DATA_DIR`, se definido); a página é `http://localhost:3000/admin`. `BUSINESS_FILE` aponta para outro arquivo e tem prioridade.

## Limitações desta versão
- Só lê mensagens de texto (áudio e imagem recebem um pedido para escrever).
- A memória das conversas some quando o servidor reinicia.
- Um número por instalação.

## Desenvolvimento
```
npm test        # testes com servidores falsos da Meta e da IA
node custo.js   # estimativa de custo mensal
```
