# Preparar o notebook (Windows 11 + WSL 2 + Docker Desktop)

Seu notebook: Acer, Windows 11, i7 de 11ª geração, 16 GB de RAM, RTX 3050.
Tudo do projeto roda **dentro do Ubuntu no WSL 2**, em containers Linux — os mesmos da VPS.

> Tempo estimado: 30–40 minutos na primeira vez (a maior parte é download).

---

## Jeito rápido: instalador automático (recomendado)

O arquivo `windows/instalar-radar-neon.bat` faz todos os passos deste guia sozinho: WSL 2,
Ubuntu 24.04, `.wslconfig`, Docker Desktop **e a integração do Docker com o Ubuntu**, ferramentas,
download do projeto, `make setup`, `make up`, seu login com 2FA e, se quiser, o aceite da Fase 0.
Pode rodar quantas vezes precisar: ele confere cada passo antes de mudar algo e continua de onde
parou.

**Como abrir o instalador**

- **Se o projeto já está no seu Ubuntu** (o seu caso): no terminal do Ubuntu rode
  ```bash
  cd ~/projetos/gta6-channel-studio && git pull && explorer.exe windows
  ```
  Vai abrir uma pasta do Windows: dê **dois cliques** em `instalar-radar-neon.bat`.
- **Num PC do zero**: no GitHub, abra `windows/instalar-radar-neon.bat` → botão **Download raw
  file** → dê dois cliques no arquivo baixado. Se o Windows mostrar "O Windows protegeu o
  computador", clique em **Mais informações → Executar assim mesmo**.

**Durante a instalação**

- Ele pede permissão de administrador (clique **Sim**).
- Algumas perguntas são de sim/não: Enter aceita a opção em maiúscula (`[S/n]` = sim).
- O GitHub pode pedir login: o usuário é `GabrielDuarteBr` e a senha é um **token** (veja o passo 5).
  Se o Git para Windows estiver instalado, o login abre no navegador.
- No fim aparece o **QR code do 2FA** no terminal: escaneie com o app autenticador.
- Se ele pedir para reiniciar o Windows, reinicie e dê dois cliques no `.bat` de novo.
- O registro de tudo fica em `C:\Users\<você>\radar-neon-instalador.log`.
- O resultado do aceite vai para a sua Área de Trabalho (`radar-neon-aceite-fase-0.txt`).

Ele também liga o **início automático do Docker Desktop** junto com o Windows (o estúdio volta
sozinho depois de reiniciar). Dá para desligar em Docker Desktop → Settings → General.

Os passos manuais abaixo continuam valendo se preferir fazer à mão ou se algo der errado.

---

## 1. Ativar o WSL 2 com Ubuntu 24.04 (PowerShell)

1. Clique com o botão direito no menu Iniciar → **Terminal (Admin)** ou **Windows PowerShell (Admin)**.
2. Rode:
   ```powershell
   wsl --install -d Ubuntu-24.04
   ```
3. Reinicie o Windows se ele pedir.
4. Ao abrir o **Ubuntu 24.04** pela primeira vez (menu Iniciar), crie um usuário e senha do Linux
   (podem ser diferentes dos do Windows).
5. Confira no PowerShell que está na versão 2:
   ```powershell
   wsl -l -v
   ```
   A coluna `VERSION` do Ubuntu-24.04 deve mostrar **2**. Se mostrar 1:
   `wsl --set-version Ubuntu-24.04 2`.
6. Deixe o Ubuntu como padrão do WSL (senão o comando `wsl` abre a distro interna do Docker):
   ```powershell
   wsl --set-default Ubuntu-24.04
   ```

> ⚠️ **Confira se está no Ubuntu certo.** O Docker Desktop instala uma distro interna chamada
> `docker-desktop`. Ela **não serve** para o projeto (não tem `sudo`, `apt`, `git` nem `make`).
> Se o terminal mostrar `docker-desktop:~#`, feche e abra o **Ubuntu 24.04** pelo menu Iniciar ou
> rode `wsl -d Ubuntu-24.04` no PowerShell. No Ubuntu certo o prompt fica assim:
> `seu_usuario@NOME-DO-PC:~$`.

## 2. Limitar a memória e as CPUs do WSL (.wslconfig)

Com 16 GB de RAM, reservamos 10 GB para o WSL (onde rodam os containers) e deixamos 6 GB para o
Windows.

1. Descubra quantos **processadores lógicos** o seu i7 tem: Gerenciador de Tarefas
   (Ctrl+Shift+Esc) → **Desempenho** → **CPU** → "Processadores lógicos".
   - Se for **16** (ex.: i7-11800H): use `processors=12`.
   - Se for **8** (ex.: i7-1165G7 / i7-11370H): use `processors=6`.
2. No PowerShell, abra o arquivo (ele será criado se não existir):
   ```powershell
   notepad "$env:USERPROFILE\.wslconfig"
   ```
3. Cole o conteúdo abaixo, ajuste `processors` e salve:
   ```ini
   [wsl2]
   memory=10GB
   processors=12
   swap=8GB
   ```
4. Aplique:
   ```powershell
   wsl --shutdown
   ```
   Depois abra o Ubuntu de novo.

## 3. Instalar o Docker Desktop

1. Baixe em <https://www.docker.com/products/docker-desktop/> e instale (deixe marcada a opção
   **Use WSL 2 instead of Hyper-V**).
2. Abra o Docker Desktop → **Settings**:
   - **General**: marque **Use the WSL 2 based engine**.
   - **Resources → WSL integration**: ative **Ubuntu-24.04**. Clique **Apply & restart**.
   - Com o backend WSL 2, a memória e as CPUs do Docker seguem o `.wslconfig` do passo 2.
3. Uso pessoal/estudo é gratuito no Docker Desktop; empresas grandes precisam de licença paga
   (confira os termos se isso mudar no seu caso).

## 4. Preparar o Ubuntu

No terminal do **Ubuntu 24.04**:

```bash
sudo apt update && sudo apt install -y git make curl openssl
```

```bash
git config --global core.autocrlf input
```

## 5. Baixar o projeto (sempre no disco do Linux, nunca em /mnt/c)

```bash
mkdir -p ~/projetos && cd ~/projetos
```

```bash
git clone https://github.com/GabrielDuarteBr/gta6-channel-studio.git
```

```bash
cd gta6-channel-studio && git switch fase-0-fundacao
```

> O repositório é privado: o Git vai pedir login. Use seu usuário do GitHub e, como senha, um
> **token** (GitHub → Settings → Developer settings → Personal access tokens → Fine-grained, com
> acesso de leitura ao repositório). Ou instale o GitHub CLI (`sudo apt install gh`) e rode
> `gh auth login`.

## 6. Subir o estúdio

```bash
make wsl-check
```

```bash
make setup
```

```bash
make up
```

A primeira vez demora (constrói as imagens). No fim aparece "✅ Painel em http://localhost:3000".

## 7. Criar o seu login (com 2FA)

```bash
make owner
```

Informe e-mail e senha (mínimo 12 caracteres). Vai aparecer um **QR code**: escaneie com um app
autenticador (Google Authenticator, Microsoft Authenticator, Authy, 1Password...). Guarde os
**códigos de recuperação** num lugar seguro.

Abra **http://localhost:3000** no navegador do Windows e entre com e-mail, senha e o código de 6
dígitos do app.

## 8. Aceite da Fase 0

```bash
make accept-0
```

Ele sobe tudo, testa o painel, roda os testes (Node e Python), o login com 2FA no navegador
automatizado, um render de teste do Zeca dentro do container e constrói as imagens de produção. No
fim mostra ✅/❌ por critério. Me mande a saída.

## 9. Fase 1: pesquisa de notícias

### Jeito rápido: `windows/rodar-fase-1.bat` (recomendado)

Dê **dois cliques** no `rodar-fase-1.bat` (não precisa de administrador). Ele faz os passos 9.1 a
9.5 sozinho:

1. confere o Ubuntu, o projeto e o Docker Desktop (abre o Docker se estiver fechado);
2. troca o projeto para a versão da Fase 1. Se algum arquivo do projeto estiver alterado, ele
   guarda a alteração com `git stash` antes; nada é apagado;
3. pede a chave do YouTube e, se você quiser, a da Anthropic. A chave fica escondida (aparece `*`),
   é testada na hora (o teste do YouTube gasta 1 das 10.000 unidades grátis do dia; o da Anthropic
   é gratuito) e é gravada só no `.env`, nunca no log;
4. roda o `make accept-1` e copia o resultado para a Área de Trabalho
   (`radar-neon-aceite-fase-1.txt`);
5. abre a Pauta no navegador.

Para colar a chave na janela preta: **botão direito do mouse** ou **Ctrl+V**, depois **Enter**.
Se o Windows mostrar "O Windows protegeu o computador", clique em **Mais informações → Executar
assim mesmo**. O registro fica em `C:\Users\<você>\radar-neon-fase-1.log`.

Os passos abaixo são o mesmo caminho, feito à mão.

### 9.1 Atualizar o projeto (Ubuntu)

```bash
cd ~/projetos/gta6-channel-studio
```

```bash
git fetch origin
```

```bash
git checkout fase-1-pesquisa
```

```bash
git pull
```

### 9.2 Chave da YouTube Data API (navegador do Windows, ~5 min, grátis)

A pesquisa só lê **metadados** do YouTube (título, data, visualizações), nunca baixa vídeo.

1. Abra https://console.cloud.google.com e entre com a sua conta Google.
2. No topo, clique no seletor de projeto → **Novo projeto** → nome `radar-neon` → **Criar**. Confira
   que ele ficou selecionado no topo.
3. Menu ☰ → **APIs e serviços** → **Biblioteca** → procure **YouTube Data API v3** → **Ativar**.
4. Menu ☰ → **APIs e serviços** → **Credenciais** → **Criar credenciais** → **Chave de API**.
5. Na chave criada, clique em **Editar chave** (ou no nome dela) → em **Restrições de API** escolha
   **Restringir chave** → marque só **YouTube Data API v3** → **Salvar**.
6. Copie a chave (começa com `AIza`). **Não cole a chave no chat do Claude.**

Uso estimado: ~500 das 10.000 unidades diárias grátis (as buscas são limitadas a 4 por dia em
Configurações).

### 9.3 Chave da Anthropic (opcional)

Sem ela, a triagem roda no modo simulado: a pauta funciona, mas os títulos ficam no idioma original
e sem resumo em português. Com ela, o Claude Haiku traduz, resume, classifica e junta notícias
repetidas em idiomas diferentes. Custo estimado: **menos de R$ 0,30 por dia**, dentro do teto que
você definiu.

1. Abra https://console.anthropic.com → **API Keys** → **Create Key** → copie (começa com
   `sk-ant-`).
2. Recomendado: em **Billing/Limits**, defina um limite mensal também do lado da Anthropic.
3. A triagem real só roda com o **modo simulado desligado** (painel → Configurações). Por enquanto
   isso só afeta a triagem: nada é publicado em fase nenhuma sem a sua aprovação.

### 9.4 Colocar as chaves no `.env` (Ubuntu)

```bash
nano .env
```

Ache as linhas `YOUTUBE_API_KEY=` e `ANTHROPIC_API_KEY=` e cole a chave logo depois do `=` (no nano,
colar é botão direito do mouse ou Ctrl+Shift+V). Salve com **Ctrl+O**, **Enter**, e saia com
**Ctrl+X**. Não edite o `.env` pelo Bloco de Notas do Windows (ele troca o fim de linha e quebra as
chaves).

### 9.5 Aceite da Fase 1

```bash
make accept-1
```

Ele sobe tudo, faz uma **coleta real** agora (pela fila, igual ao botão "Coletar agora"), confere
fontes, links, deduplicação, pontuação e o agendamento automático, e roda todos os testes (inclusive
os da Pauta no navegador). Leva de 20 a 40 minutos. O resultado fica em
`radar-neon-aceite-fase-1.txt` e uma cópia vai para a sua Área de Trabalho do Windows. Me mande esse
arquivo.

Para conferir também a coleta automática (espera até 60 min):

```bash
ESPERAR=1 make accept-1
```

No painel: **Pauta** mostra as histórias com nota, fontes e links. **Pauta → Gerenciar fontes**
mostra o estado de cada fonte. Uma fonte com erro pode ter mudado de endereço: corrija ali mesmo.
Para coletar fora do horário: botão **Coletar agora** ou `make coletar`.

## 10. Fase 2: o personagem (Zeca Neon)

A voz do Zeca é o **Google Chirp 3 HD** (1 milhão de caracteres grátis por mês; o nosso uso fica
bem abaixo). Sem a chave, tudo funciona com a voz de **teste** (espeak-ng, robótica e grátis).

### 10.1 Chave da voz do Google (navegador do Windows, ~10 min)

Use o **mesmo projeto** do Google Cloud da chave do YouTube (`radar-neon`).

1. Abra https://console.cloud.google.com e confira que o projeto `radar-neon` está selecionado no
   topo.
2. **Faturamento**: menu ☰ → **Faturamento** → vincule uma conta de faturamento (cartão). A cota
   grátis só vale com faturamento ativo; abaixo dela nada é cobrado.
3. Menu ☰ → **APIs e serviços** → **Biblioteca** → procure **Cloud Text-to-Speech API** →
   **Ativar**.
4. Menu ☰ → **APIs e serviços** → **Credenciais** → **Criar credenciais** → **Chave de API**. Na
   chave criada: **Restrições de API** → **Restringir chave** → marque só **Cloud Text-to-Speech
   API** → **Salvar**. Copie a chave (começa com `AIza`). **Não cole no chat.**
5. Recomendado: **Faturamento** → **Orçamentos e alertas** → **Criar orçamento** (ex.: R$ 5) com
   alertas em 50%, 90% e 100%.

O estúdio também se protege sozinho: para em **95% da cota grátis do mês** (Configurações → Voz do
Zeca → "permitir pagar além da cota", desligado por padrão) e respeita o teto de gasto. A tela
**Personagem** mostra quantos caracteres já foram usados no mês. O mesmo trecho com a mesma voz
fica guardado e não é pago duas vezes.

O `rodar-fase-2.bat` pede essa chave (escondida), testa e grava no `.env`. À mão: `nano .env`, linha
`GOOGLE_TTS_API_KEY=` e depois `make up`.

**Escolher a voz:** `make vozes` gera uma amostra de cada voz masculina em `vozes/` (o `.bat` copia
para a Área de Trabalho, pasta `radar-neon-vozes`). Ouça e escolha em **Configurações → Voz do
Zeca** (ex.: `pt-BR-Chirp3-HD-Charon`). O padrão é `pt-BR-Chirp3-HD-Puck`.

**Modo simulado:** com ele ligado, os clipes usam a voz de teste. Para ouvir a voz do Google num
clipe, escolha **Google** no formulário do clipe (ou `make zeca VOZ=google`). O aceite usa a voz de
teste de propósito (o resultado precisa ser sempre igual).

### Jeito rápido: `windows/rodar-fase-2.bat` (recomendado)

Dê **dois cliques** no `rodar-fase-2.bat` (não precisa de administrador). Ele:

1. confere o Ubuntu, o projeto e o Docker Desktop (abre o Docker se estiver fechado);
2. troca o projeto para a versão da Fase 2 (alterações locais vão para o `git stash`, nada é
   apagado);
3. pede a chave da voz do Google (seção 10.1), testa e grava no `.env`;
4. gera as amostras das vozes (`radar-neon-vozes`) e um clipe do Zeca com a voz do Google
   (`radar-neon-zeca-voz-google.mp4`) na Área de Trabalho;
5. roda o `make accept-2` (de 20 a 40 minutos: a primeira vez reconstrói as imagens, com o Rhubarb
   e a voz de teste);
6. põe na Área de Trabalho o resultado (`radar-neon-aceite-fase-2.txt`) e o vídeo do aceite
   (`radar-neon-zeca-teste.mp4`);
7. abre a tela **Personagem** no navegador.

### Pelo Ubuntu (mesmo caminho, à mão)

```bash
cd ~/projetos/gta6-channel-studio
```

```bash
git fetch origin
```

```bash
git checkout fase-2-personagem
```

```bash
make accept-2
```

### O que olhar no painel (tela Personagem)

- **Expressões, bocas e gestos**: a arte provisória do Zeca, desenhada pelo estúdio.
- **Clipe de teste**: escreva o texto com marcações (`[feliz]`, `[surpreso]`, `[aponta_tela]`,
  `[pausa]`...) e clique em **Gerar clipe de teste**. Em 1 a 3 minutos o vídeo aparece ali mesmo.
- **Bíblia do personagem**: quem o Zeca é e como fala. Cada vez que você salva, vira uma versão nova;
  dá para restaurar uma antiga. As 4 regras com cadeado não podem sair.

Para gerar um clipe pelo Ubuntu: `make zeca` (ou `make zeca VERTICAL=1` para Short).

## 11. Fase 3: notícias em vídeo

Uma história da **Pauta** vira vídeo de notícia: o **Roteirista** (Claude Sonnet 5.5) escreve as
falas do Zeca com fonte em cada afirmação, o **Diretor de arte** escolhe imagens da Biblioteca ou
gera cenários novos (Google), a voz do Zeca é gravada, o **Editor** monta o vídeo longo 16:9 ou o
Short 9:16 com legendas, fonte na tela e selo de rumor, faz 3 thumbnails, e o **Revisor visual**
(Claude olhando quadros do vídeo) aprova ou pede correção (até 3 voltas). Nada é publicado: o vídeo
fica pronto na tela **Produção** para você ver.

### 11.1 Chave das imagens: Gemini API (navegador do Windows, ~5 min)

Mesmo projeto `radar-neon` e mesmo faturamento da voz (seção 10.1). Nada de conta nova.

1. Abra https://console.cloud.google.com e confira o projeto `radar-neon` no topo.
2. Menu ☰ → **APIs e serviços** → **Biblioteca** → procure **Generative Language API** →
   **Ativar**.
3. Menu ☰ → **APIs e serviços** → **Credenciais** → **Criar credenciais** → **Chave de API**.
   **Restrições de API** → **Restringir chave** → marque só **Generative Language API** →
   **Salvar**. Copie a chave (começa com `AIza`). **Não cole no chat.**
4. O alerta de orçamento da seção 10.1 já cobre as imagens (é o mesmo faturamento).

Preço aproximado por imagem (sites de comparação, nov/2026; confira no console): **Imagen 4 Fast
~R$ 0,12**, Gemini Flash Lite Image ~R$ 0,20, Gemini Flash Image ("Nano Banana 2") ~R$ 0,40
(já com câmbio, spread e IOF).
O estúdio respeita o teto de gasto, não gera duas vezes o mesmo pedido e guarda cada imagem na
Biblioteca com o prompt no manifesto.

**Comparar os modelos:** `make imagens` lista os modelos da sua chave; `make imagens COMPARAR=1`
gera as mesmas 3 imagens em até 3 modelos (~R$ 2,40) na pasta `comparativo-imagens/` (o `.bat`
copia para a Área de Trabalho). Escolha em **Configurações → Imagens geradas**.

### 11.2 Chave da Anthropic (Claude)

O Roteirista e o Revisor usam a `ANTHROPIC_API_KEY` da seção 9.3. Sem ela (ou com o modo simulado
ligado), o roteiro e a revisão são de teste e não custam nada.

### Jeito rápido: `windows/rodar-fase-3.bat` (recomendado)

Dê **dois cliques** no `rodar-fase-3.bat`. Ele:

1. confere o Ubuntu, o projeto e o Docker Desktop;
2. troca o projeto para a versão da Fase 3;
3. pede a chave da Gemini API (seção 11.1), testa e grava no `.env` (e a da Anthropic, se faltar);
4. lista os modelos de imagem e, se você quiser, gera o comparativo (`radar-neon-imagens`);
5. pergunta se roda **1 Short e 1 vídeo longo de verdade** (Claude + imagens + voz, ~R$ 3) para
   medir o custo real;
6. roda o `make accept-3` (de 30 a 60 minutos);
7. põe na Área de Trabalho o resultado (`radar-neon-aceite-fase-3.txt`), os vídeos e as
   thumbnails (`radar-neon-fase3-*`);
8. abre a tela **Produção**.

### Pelo Ubuntu (mesmo caminho, à mão)

```bash
cd ~/projetos/gta6-channel-studio
```

```bash
git fetch origin
```

```bash
git checkout fase-3-noticias
```

```bash
make accept-3
```

Com custo real (precisa das chaves): `make accept-3 REAL=1`.

### O que olhar no painel

- **Pauta**: marque uma história como "Virar longo" ou "Virar Short".
- **Produção**: a história aparece em "Na fila da Pauta". Clique em **Produzir** (só aí gasta). Em
  alguns minutos aparecem o vídeo, as 3 thumbnails (a escolhida em destaque), o parecer do
  Revisor, o roteiro com as fontes, o custo e o tempo de render. Limite diário em Configurações.
- **Biblioteca**: envie imagens suas ou importe do site oficial da Rockstar, sempre com licença,
  crédito e prova. Sem manifesto ativo, nada entra no vídeo. "Revogar" tira a mídia dos próximos
  vídeos e mostra quais vídeos a usaram.
- **Arte**: cenários gerados. **Aprovar** deixa o Roteirista reaproveitar (sem pagar de novo);
  **Gerar variação** faz outra versão; **Descartar** tira dos próximos vídeos.

## 12. Fase 4: parceiros e Short de react

Criadores de GTA 6 que **autorizam por escrito** o uso de trechos dos vídeos deles viram
**parceiros**. Com um arquivo do parceiro, o estúdio monta um **Short de react**: o trecho toca
com o crédito na tela e, quando o Zeca comenta, o trecho **pausa**. O clipe nunca passa de metade
do Short (padrão 45%), e "uau" ou "olha isso" não contam como comentário. Nada é publicado e
**nenhuma mensagem é enviada pelo estúdio**: ele só rascunha.

### 12.1 Como funciona

1. **Caçador de parceiros** (toda semana e pelo botão): busca canais de GTA no YouTube só pelos
   dados públicos (nome, descrição, inscritos), dá uma nota com o Claude Haiku e escreve o
   **rascunho da mensagem** pedindo a permissão. Frase como "cortes liberados" na descrição vira
   **indício**, nunca permissão. Você copia o rascunho, revisa e envia por conta própria.
2. Quando o criador responder por escrito, registre a **permissão** (tela Parceiros): como ele
   autorizou (e-mail, mensagem direta, contrato), a prova (o que ele escreveu, quando e onde, ou o
   print), o crédito, o link, a hashtag, se pode monetizar e um teto de segundos por Short.
3. **Arquivos**: o parceiro manda o vídeo original por **link do Dropbox ou do Google Drive**
   (arquivo ou pasta), ou você envia pelo painel. **Nada vem do YouTube.** Cada arquivo vai para a
   Biblioteca com o manifesto ligado à permissão e é **transcrito no seu notebook** (faster-whisper,
   grátis): trechos de fala, música (marcada pelo Whisper) e trocas de cena.
4. **Áudio do clipe**: por padrão vai **só a voz do parceiro**; música, filme e TV de terceiros
   ficam mudos, e trechos com música não entram no corte. Se você ouvir o arquivo e não houver nada
   de terceiros, marque "Ouvi: sem música, filme ou TV de terceiros" e o áudio original vai inteiro.
5. **Produzir Short de react**: o código escolhe trechos candidatos; o **Comentarista** (Claude
   Sonnet 5.5, vendo um quadro de cada trecho e a transcrição) escolhe e escreve as falas; o código
   confere as regras; a voz é gravada; os trechos são cortados; o render monta o Short num dos 3
   layouts (TV neon, tela dividida, cinema, em rodízio); o **Revisor visual** confere crédito,
   pausa e legendas. A descrição sai com o crédito, o link e a hashtag do parceiro.
6. **Revogar** uma permissão tira os direitos dos arquivos dela (o render recusa) e mostra quais
   vídeos usaram esses arquivos. **Suspender** trava sem apagar nada.

Custo estimado por Short de react: **≈ R$ 0,50** (Comentarista e Revisor; a transcrição é local e a
voz fica na cota grátis). O Caçador custa centavos por semana. Os Shorts de react contam no limite
diário de Shorts.

A imagem do worker de mídia passa a ter ~2,8 GB (o modelo Whisper "small" e as bibliotecas de
transcrição). A primeira subida depois de atualizar demora mais.

### 12.2 Chave do Google Drive (opcional, navegador do Windows, ~5 min, grátis)

Só para importar arquivos que o parceiro mandar pelo **Google Drive** (Dropbox e envio pelo painel
funcionam sem chave). Mesmo projeto `radar-neon`.

1. Abra https://console.cloud.google.com e confira o projeto `radar-neon` no topo.
2. Menu ☰ → **APIs e serviços** → **Biblioteca** → procure **Google Drive API** → **Ativar**.
3. Menu ☰ → **APIs e serviços** → **Credenciais** → **Criar credenciais** → **Chave de API**.
   **Restrições de API** → **Restringir chave** → marque só **Google Drive API** → **Salvar**.
   Copie a chave (começa com `AIza`). **Não cole no chat.**
4. O `rodar-fase-4.bat` pede a chave, testa e grava no `.env` como `GOOGLE_DRIVE_API_KEY`.

Peça ao parceiro para compartilhar o arquivo ou a pasta como **"Qualquer pessoa com o link"**.

### Jeito rápido: `windows/rodar-fase-4.bat` (recomendado)

Dê **dois cliques** no `rodar-fase-4.bat`. Ele:

1. confere o Ubuntu, o projeto e o Docker Desktop;
2. troca o projeto para a versão da Fase 4;
3. confere as chaves do YouTube (Caçador) e da Anthropic e pede a do Google Drive (opcional);
4. sobe o estúdio (a primeira vez baixa o modelo Whisper);
5. pergunta se roda **1 Short de react de verdade** (Claude + voz, ~R$ 0,50) para medir o custo;
6. roda o `make accept-4` (de 30 a 60 minutos): parceiro de teste com permissão, vídeo sintético
   importado e transcrito, Short de react, render repetido quadro a quadro, YouTube recusado,
   produção parada sem permissão, Caçador e todos os testes;
7. põe na Área de Trabalho o resultado (`radar-neon-aceite-fase-4.txt`) e o vídeo
   (`radar-neon-fase4-react.mp4`);
8. abre a tela **Parceiros**.

### Pelo Ubuntu (mesmo caminho, à mão)

```bash
cd ~/projetos/gta6-channel-studio
```

```bash
git fetch origin
```

```bash
git checkout fase-4-parceiros
```

```bash
make accept-4
```

Com custo real (precisa das chaves): `make accept-4 REAL=1`. Caçador agora: `make parceiros`.

### O que olhar no painel (tela Parceiros)

- **Candidatos**: nota de encaixe, indício na descrição e o rascunho da mensagem (botão **Copiar
  mensagem**). "Marquei como enviada" só anota que você mandou.
- **Parceiros**: permissões com o status (ativa, suspensa, revogada), importar por link ou enviar
  arquivo, prévia de cada vídeo com a transcrição, a marca do áudio e o botão **Produzir Short de
  react**.
- **Produção**: o Short de react com a porcentagem de clipe e de comentário, o layout, o tipo de
  áudio, se o parceiro permite monetizar e a descrição pronta com o crédito.
- **Configurações → Parceiros / Short de react**: Caçador semanal, termos da busca, limites dos
  arquivos, duração-alvo, teto de clipe (nunca acima de 50%) e layouts do rodízio.

## 13. Etapa final: Conformidade, publicação, métricas, Comando e produção diária

A partir daqui o estúdio trabalha sozinho todo dia e **você só aprova**:

- **Produção diária** (Configurações → Produção diária): às 07:41 (Brasília) escolhe as melhores
  histórias que podem virar vídeo e um vídeo de parceiro novo, até o limite do dia (padrão 1 longo
  + 4 Shorts, cerca de R$ 4,50 por dia no modo real) e dentro do teto de gasto. Se o notebook estiver
  dormindo no horário, roda quando ele acordar (uma vez por dia).
- **Conformidade**: quando um vídeo fica pronto, monta título, descrição (com fontes, créditos e o
  aviso de IA) e tags e confere as regras: direitos de cada mídia, fontes, rumor, regra do react,
  condições do parceiro, aviso de IA, Zeca nunca dizendo que é humano, Rockstar, spoiler e limites
  do YouTube. O Claude Haiku ainda confere se o título é enganoso.
- **Aprovação**: você assiste, edita título e descrição se quiser e escolhe a data. O vídeo sobe
  **privado e agendado**, com a marca de conteúdo sintético. Nada fica público sem você.
- **Calendário**: o que está marcado e o que já foi ao ar.
- **Comando**: converse com o Diretor (Claude) em português. Ele vê a pauta, põe notícias e reacts
  na fila, mostra produções, métricas e custos em reais e **prepara** publicações: publicar sempre
  vira um pedido que você confirma com um clique.
- **Visão geral**: visualizações por dia, horas assistidas, inscritos, por formato e por parceiro,
  e o gasto do mês em reais (as métricas sincronizam a cada 3 horas).
- **Piloto automático** (Configurações): desligado. Se um dia quiser, só liga com o código do app
  autenticador; mesmo ligado, tudo passa pela Conformidade e pelo Revisor visual e sobe privado e
  agendado.

### 13.1 Cliente OAuth do Google (navegador do Windows, ~10 min, grátis)

O painel nunca pede a senha do YouTube: você entra com a conta do canal na tela do Google e ele
guarda só um token cifrado. Para isso o painel precisa de um "cliente OAuth":

1. Abra <https://console.cloud.google.com> no **mesmo projeto** das outras chaves.
2. **APIs e serviços → Biblioteca**: ative **YouTube Data API v3** (já deve estar ativa) e
   **YouTube Analytics API**.
3. **APIs e serviços → Tela de permissão OAuth** (ou "Google Auth Platform"):
   - tipo de usuário **Externo**; nome do app: `Radar Neon Studio`; seu e-mail de suporte e de
     contato;
   - em **Público-alvo**, clique em **Publicar app** (status **Em produção**). Em "teste", o Google
     derruba a conexão a cada 7 dias.
4. **APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth**:
   - tipo de aplicativo: **Aplicativo da Web**; nome: `Radar Neon painel`;
   - **URIs de redirecionamento autorizados**: `http://localhost:3000/api/youtube/callback`
     (exatamente assim);
   - clique em **Criar** e copie o **ID do cliente** (termina em `.apps.googleusercontent.com`) e a
     **Chave secreta do cliente** (começa com `GOCSPX-`).
5. Rode o `rodar-etapa-final.bat` (ele pede os dois valores sem mostrar na tela) ou ponha no `.env`:
   `GOOGLE_OAUTH_CLIENT_ID=...` e `GOOGLE_OAUTH_CLIENT_SECRET=...`, depois `make up`.
6. No painel, **Configurações → Canal do YouTube → Conectar YouTube**. Entre com a conta **do
   canal** e marque **todas** as permissões. Como o app é seu e não foi verificado pelo Google,
   aparece "O Google não verificou este app": clique em **Avançado → Acessar Radar Neon Studio**.

Sem o cliente OAuth tudo continua funcionando: aprovar gera um **pacote manual** (vídeo, thumbnail
e um .txt com título, descrição, tags e lembretes) para você enviar pelo YouTube Studio. Depois de
enviar, cole o link na Aprovação para as métricas contarem.

### 13.2 Auditoria do Google (para publicar pela API)

O YouTube trava como **privado** todo vídeo enviado pela API por um projeto que ainda não passou
pela auditoria do Google. Enquanto isso, o estúdio envia privado e agendado e a Aprovação avisa
quando a hora passou e o vídeo continua privado: publique pelo YouTube Studio (um clique). O texto
pronto para pedir a auditoria está em [`docs/auditoria-youtube.md`](auditoria-youtube.md). A
resposta do Google costuma levar semanas.

### Jeito rápido: `windows/rodar-etapa-final.bat` (recomendado)

Dê **dois cliques** no `rodar-etapa-final.bat`. Ele:

1. confere o Ubuntu, o projeto e o Docker Desktop;
2. troca o projeto para a versão da etapa final (branch `fase-5-canal`);
3. pede o cliente OAuth (opcional; abre a página de credenciais);
4. sobe o estúdio e cria o login do painel se ainda não existir;
5. abre **Configurações** para você clicar em **Conectar YouTube**;
6. roda o `make accept-5` (de 30 a 60 minutos): Short simulado → Conformidade → aprovação → envio
   simulado e agendado, bloqueio de vídeo reprovado, Diretor respondendo no Comando, produção
   diária simulada, conexão com o canal e métricas, e todos os testes. Se você quiser, faz também um
   **envio real de teste**: um Short **privado**, agendado para daqui a 30 dias (apague depois no
   YouTube Studio);
7. põe o resultado na Área de Trabalho (`radar-neon-aceite-etapa-final.txt`);
8. abre a tela **Aprovação**.

### Pelo Ubuntu (mesmo caminho, à mão)

```bash
cd ~/projetos/gta6-channel-studio
```

```bash
git fetch origin
```

```bash
git checkout fase-5-canal
```

```bash
make up
```

```bash
make accept-5
```

Envio real de teste (privado, daqui a 30 dias): `make accept-5 ENVIAR=1`. Conferir a conexão e
sincronizar as métricas: `make publicar`.

### Para deixar rodando todo dia

1. Deixe o modo simulado **desligado** (Configurações) e as chaves no `.env` (Claude, voz do Google,
   imagens Gemini; YouTube para a pesquisa).
2. Confira a **Produção diária** (ligada, 07:41) e os **Horários** de publicação (12:00, 18:00,
   20:30).
3. Deixe o Docker Desktop abrindo com o Windows (Settings → General → **Start Docker Desktop when
   you sign in**) e o notebook ligado na tomada. Se ele dormir, o estúdio continua de onde parou
   quando acordar.
4. Uma vez por dia, abra **Aprovação**, assista e aprove.

## 14. Arte do artista e jeito de falar do Zeca

### 14.1 Trocar a arte do personagem

O Zeca é animado trocando partes do desenho (boca, olhos, sobrancelhas, braço). Por isso a arte do
artista vem **em camadas** (PNG ou SVG, todas do mesmo tamanho), e não como uma imagem só.

1. No painel, abra **Personagem → Arte do artista** e clique em **Baixar modelo para o artista**.
   Mande para o artista o .zip e o guia [`docs/guia-arte-zeca.md`](guia-arte-zeca.md) (o que
   desenhar, nomes dos arquivos, tamanho, ordem das camadas).
2. Quando a arte chegar, extraia a pasta no Windows (botão direito → **Extrair tudo**).
3. Em **Personagem → Arte do artista**:
   - em **Camadas**, abra a pasta, aperte **Ctrl+A** e escolha todos os arquivos;
   - preencha o **Artista** e a **Prova de direitos** (o contrato de cessão ou licença: quem cedeu,
     data e o que o canal pode fazer). Se tiver o contrato em PDF ou foto, anexe;
   - clique em **Enviar arte**. O painel confere tudo e diz exatamente o que faltar ou estiver fora
     do tamanho.
4. A arte entra como **rascunho**. Confira a prévia (8 expressões, 9 bocas e a piscada).
5. Em **Clipe de teste**, escolha a versão em **Arte** e gere um clipe para ver a boca e os gestos.
6. Gostou? Clique em **Usar esta arte**. Os próximos vídeos, Shorts e thumbnails saem com ela.
   Para voltar, há o botão **Voltar para a arte provisória**.

Se a cabeça ou o braço girarem num ponto estranho, envie de novo ajustando **Ajuste fino: pontos de
giro** (pescoço e ombro, em % da tela).

### 14.2 Jeito de falar (personalidade)

O Zeca agora é um **comentarista estilo youtuber**: divertido, animado e sarcástico, falando com
você como um amigo que mostra a notícia, sem tom de telejornal e sem palavrão. O Roteirista e o
Comentarista dos reacts seguem a **bíblia** (Personagem → Bíblia do personagem):

- **Bordões**: um por linha (ele usa no máximo um por vídeo).
- **Jeito de falar (faça)** e **Nunca soe assim**: um por linha.
- **Exemplos (ruim => bom)**: uma frase sem graça e como o Zeca falaria, separadas por `=>`. É o
  que mais ensina o estilo.

Cada salvamento cria uma versão nova da bíblia (dá para restaurar). Se um roteiro sair com cara de
telejornal, sem reação ou sem conversar com quem assiste, o estúdio pede uma segunda versão
melhorada ao Roteirista automaticamente (custa alguns centavos a mais só nesses casos).

Dica de voz: para combinar com a energia nova, teste vozes mais animadas (`make vozes`) e uma
velocidade um pouco maior (Configurações → Voz do Zeca, por exemplo 1,1).

## Valores em reais

Todo valor do painel e dos relatórios aparece em **reais**. As APIs cobram em dólar; o estúdio
converte pela **PTAX de venda do Banco Central** (buscada sozinha a cada 6 horas) e soma o que o
cartão cobra por cima: **spread do banco (4%)** e **IOF de compra internacional (3,5%)**. Dá para
trocar para uma cotação fixa e ajustar os percentuais em **Configurações → Cotação do dólar**. A
cotação em uso aparece na tela **Saúde e custos**.

O **teto de gasto** também é em reais: padrão **R$ 5 por dia** e **R$ 150 por mês**
(Configurações → Orçamento de APIs). Ao atingir, os agentes pausam até o dia (ou o mês) virar.

---

## Comandos do dia a dia

| Comando | Para quê |
|---|---|
| `make up` | sobe tudo |
| `make down` | para tudo (os dados ficam) |
| `make ps` | estado dos serviços |
| `make logs s=web` | logs ao vivo de um serviço |
| `make owner` | recria o login (derruba as sessões abertas) |
| `make coletar` | coleta notícias agora e mostra o resultado por fonte |
| `make zeca` | clipe de teste do Zeca (`VERTICAL=1` para Short, `VOZ=google` para a voz real) |
| `make vozes` | lista as vozes do Google e gera amostras para ouvir |
| `make produzir` | produz um vídeo pela fila (`FORMATO=LONG`, `REAL=1` para de verdade) |
| `make imagens` | modelos de imagem da sua chave (`COMPARAR=1` gera o comparativo) |
| `make parceiros` | roda o Caçador de parceiros agora (só rascunha mensagens) |
| `make publicar` | confere a conexão com o YouTube e sincroniza as métricas |
| `make reset` | **apaga** os dados locais (pede confirmação) |

## O notebook dormiu ou desligou?

Os containers voltam sozinhos quando o Docker Desktop abre (`restart: unless-stopped`). Os jobs
interrompidos são retomados sem duplicar, envios ao YouTube continuam do byte em que pararam e a
produção diária perdida roda uma vez quando o notebook acorda. Se o Docker Desktop não abrir sozinho com o Windows, ative em Settings → General
→ **Start Docker Desktop when you sign in**.

## Claude Code no notebook (opcional)

Se você usar o Claude Code dentro do Ubuntu, o repositório já traz hooks, subagentes, skills,
os plugins do Remotion e do frontend-design e quatro MCPs. Ao abrir o projeto pela primeira vez, o
Claude Code pede para você confiar nessas configurações. Dois MCPs precisam de variáveis no seu
terminal (nunca coloque isso no repositório):

1. Postgres local (só leitura). Pegue a senha em `POSTGRES_PASSWORD` no seu `.env` e adicione ao
   final do `~/.bashrc`:
   ```bash
   export STUDIO_DB_URL="postgresql://studio:SUA_SENHA_DO_ENV@127.0.0.1:55432/studio"
   ```
2. GitHub: crie um token fine-grained (GitHub → Settings → Developer settings → Personal access
   tokens → Fine-grained), só com leitura do repositório `gta6-channel-studio`, e adicione:
   ```bash
   export GITHUB_MCP_PAT="seu_token"
   ```
3. Rode `source ~/.bashrc` e reinicie o Claude Code.

## RTX 3050 (opcional, mais adiante)

O padrão é CPU (igual à VPS). Na Fase 2/3 haverá um arquivo opcional para usar a GPU na transcrição
(faster-whisper com CUDA) e nos cortes do FFmpeg (NVENC). Para isso basta o driver NVIDIA atualizado
no **Windows** (não instale driver NVIDIA dentro do Ubuntu).

## Problemas comuns

- **"Docker não responde"** no `make wsl-check`: abra o Docker Desktop e confira a integração com o
  Ubuntu-24.04 (passo 3).
- **Porta 3000 ocupada**: algum outro programa usa a porta. Feche-o ou me avise para mudar a porta.
- **Lento**: confira se o projeto está em `~/projetos` (e não em `/mnt/c/...`).
- **Proxy corporativo** bloqueando o build: coloque o certificado da empresa em
  `infra/docker/extra-ca.local.pem` e descomente `EXTRA_CA_CERT` no `.env`.
