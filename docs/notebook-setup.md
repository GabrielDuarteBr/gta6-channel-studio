# Preparar o notebook (Windows 11 + WSL 2 + Docker Desktop)

Seu notebook: Acer, Windows 11, i7 de 11ª geração, 16 GB de RAM, RTX 3050.
Tudo do projeto roda **dentro do Ubuntu no WSL 2**, em containers Linux — os mesmos da VPS.

> Tempo estimado: 30–40 minutos na primeira vez (a maior parte é download).

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

   [experimental]
   autoMemoryReclaim=gradual
   ```
   > Se a sua versão do WSL avisar que `autoMemoryReclaim` mudou de seção, mova a linha para
   > `[wsl2]` — a documentação da Microsoft é a referência.
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

---

## Comandos do dia a dia

| Comando | Para quê |
|---|---|
| `make up` | sobe tudo |
| `make down` | para tudo (os dados ficam) |
| `make ps` | estado dos serviços |
| `make logs s=web` | logs ao vivo de um serviço |
| `make owner` | recria o login (derruba as sessões abertas) |
| `make reset` | **apaga** os dados locais (pede confirmação) |

## O notebook dormiu ou desligou?

Os containers voltam sozinhos quando o Docker Desktop abre (`restart: unless-stopped`). Os jobs
interrompidos são retomados sem duplicar (a partir da Fase 1, com o agendador; o aceite completo
disso é na Fase 7). Se o Docker Desktop não abrir sozinho com o Windows, ative em Settings → General
→ **Start Docker Desktop when you sign in**.

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
