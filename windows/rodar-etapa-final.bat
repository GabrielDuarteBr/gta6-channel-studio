<# : Etapa final do Radar Neon no Windows (arquivo hibrido: .bat + PowerShell)
@echo off
setlocal
title Radar Neon - Etapa final (publicacao, Comando e producao diaria)
rem Copia para uma pasta local (funciona mesmo aberto de \\wsl.localhost ou de Downloads)
set "SRC=%~f0"
set "WORK=%TEMP%\radar-neon-etapa-final"
if /i not "%~dp0"=="%WORK%\" (
  if not exist "%WORK%" mkdir "%WORK%"
  copy /y "%SRC%" "%WORK%\rodar-etapa-final.bat" >nul
  set "SRC=%WORK%\rodar-etapa-final.bat"
)
rem Roda como usuario comum: o WSL e o Docker Desktop sao por usuario.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$BatchPath='%SRC%'; $code=[IO.File]::ReadAllText($BatchPath,[Text.Encoding]::UTF8); Invoke-Expression $code"
echo.
pause
exit /b
#>

# =============================================================================
#  Radar Neon — Etapa final (Fases 5 a 7) no seu PC
#  1. confere Ubuntu, projeto e Docker Desktop (liga o Docker se estiver fechado)
#  2. atualiza o projeto para a branch da etapa final
#  3. pede o cliente OAuth do Google (ID e segredo) para conectar o canal — opcional
#  4. sobe o estúdio
#  5. abre Configurações para você clicar em "Conectar YouTube" (login do Google, sem senha aqui)
#  6. roda o aceite (make accept-5) e salva o resultado na Área de Trabalho
#  7. abre a tela Aprovação no navegador
#  Pré-requisito: o instalar-radar-neon.bat já ter rodado uma vez (Fase 0).
#  Os valores nunca aparecem na tela, no log nem na linha de comando.
# =============================================================================

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
$env:WSL_UTF8 = '1'

$Branch = 'personagem-arte-estilo'
$PreferredDistro = 'Ubuntu-24.04'
$ProjectRel = 'projetos/gta6-channel-studio'
$ReportName = 'radar-neon-aceite-etapa-final.txt'

$Work = Join-Path $env:LOCALAPPDATA 'radar-neon-etapa-final'
New-Item -ItemType Directory -Force -Path $Work | Out-Null
$LogFile = Join-Path $env:USERPROFILE 'radar-neon-etapa-final.log'
try { Start-Transcript -Path $LogFile -Append | Out-Null } catch { }

$Desktop = [Environment]::GetFolderPath('Desktop')
$Utf8NoBom = New-Object System.Text.UTF8Encoding $false
$DockerDesktopExe = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
$DockerCli = Join-Path $env:ProgramFiles 'Docker\Docker\resources\bin\docker.exe'

$TotalSteps = 8
$script:StepNo = 0
$script:Distro = $null

# ----------------------------------------------------------------- utilitários
function Write-Step([string]$Title) {
  $script:StepNo++
  Write-Host ''
  Write-Host ('[{0}/{1}] {2}' -f $script:StepNo, $TotalSteps, $Title) -ForegroundColor Magenta
}
function Write-Ok([string]$Message) { Write-Host "  [OK] $Message" -ForegroundColor Green }
function Write-Info([string]$Message) { Write-Host "  $Message" -ForegroundColor Gray }
function Write-Attention([string]$Message) { Write-Host "  [!] $Message" -ForegroundColor Yellow }
function Stop-Run([string]$Message) {
  Write-Host ''
  Write-Host "  [X] $Message" -ForegroundColor Red
  Write-Host ''
  Write-Host '  Quando resolver, rode este arquivo de novo: ele confere tudo antes de mudar algo.'
  Write-Host "  Log (mande para o Claude se precisar de ajuda): $LogFile"
  try { Stop-Transcript | Out-Null } catch { }
  exit 1
}
function Read-YesNo([string]$Question, [bool]$Default) {
  if ($Default) { $suffix = '[S/n]' } else { $suffix = '[s/N]' }
  $answer = Read-Host "  $Question $suffix"
  if ([string]::IsNullOrWhiteSpace($answer)) { return $Default }
  return @('s', 'sim', 'y', 'yes') -contains $answer.Trim().ToLower()
}
function Remove-Nul([object[]]$Lines) {
  return @($Lines | ForEach-Object { ([string]$_ -replace "`0", '').Trim() } | Where-Object { $_ -ne '' })
}
function ConvertTo-WslPath([string]$WindowsPath) {
  $drive = $WindowsPath.Substring(0, 1).ToLower()
  $rest = $WindowsPath.Substring(2) -replace '\\', '/'
  return "/mnt/$drive$rest"
}
# Aspas no padrão da linha de comando do Windows (para caminhos com espaço).
function ConvertTo-CommandLineArg([string]$Value) {
  if ($Value -eq '') { return '""' }
  if ($Value -notmatch '[\s"]') { return $Value }
  $out = '"'
  $slashes = 0
  foreach ($ch in $Value.ToCharArray()) {
    if ($ch -eq '\') { $slashes++; continue }
    if ($ch -eq '"') { $out += ('\' * ($slashes * 2 + 1)) + '"'; $slashes = 0; continue }
    $out += ('\' * $slashes) + $ch
    $slashes = 0
  }
  return $out + ('\' * ($slashes * 2)) + '"'
}
# Valor seguro dentro de um script bash (aspas simples).
function ConvertTo-BashLiteral([string]$Value) { return "'" + $Value.Replace("'", "'\''") + "'" }
function Get-Distros { return Remove-Nul (& wsl.exe --list --quiet 2>$null) }
# Grava um script bash (LF, sem BOM), trocando @@NOME@@ pelos valores, e devolve o caminho no WSL.
function Save-LinuxScript([string]$Name, [string]$Content, [hashtable]$Values) {
  foreach ($key in $Values.Keys) { $Content = $Content.Replace("@@$key@@", (ConvertTo-BashLiteral ([string]$Values[$key]))) }
  $file = Join-Path $Work $Name
  [IO.File]::WriteAllText($file, ($Content -replace "`r`n", "`n"), $Utf8NoBom)
  return (ConvertTo-WslPath $file)
}
# Roda um script no Ubuntu usando o próprio terminal (permite perguntas e login do GitHub).
function Invoke-LinuxScript {
  param([string]$Name, [string]$Content, [hashtable]$Values = @{})
  $wslPath = Save-LinuxScript $Name $Content $Values
  $argList = @('-d', $script:Distro, '--exec', 'bash', $wslPath)
  $line = ($argList | ForEach-Object { ConvertTo-CommandLineArg $_ }) -join ' '
  $proc = Start-Process -FilePath 'wsl.exe' -ArgumentList $line -NoNewWindow -PassThru
  $null = $proc.Handle
  $proc.WaitForExit()
  return [int]$proc.ExitCode
}
# Roda um script no Ubuntu e devolve a saída (checagens sem interação).
function Get-LinuxScriptOutput([string]$Name, [string]$Content, [hashtable]$Values) {
  $wslPath = Save-LinuxScript $Name $Content $Values
  return Remove-Nul (& wsl.exe -d $script:Distro --exec bash $wslPath 2>$null)
}
# Igual ao anterior, mas manda um segredo pela ENTRADA PADRÃO (nunca na linha de comando).
function Get-LinuxScriptOutputWithSecret([string]$Name, [string]$Content, [hashtable]$Values, [string]$Secret) {
  $wslPath = Save-LinuxScript $Name $Content $Values
  return Remove-Nul ($Secret | & wsl.exe -d $script:Distro --exec bash $wslPath 2>$null)
}
# Lê um texto sem mostrar na tela (aparece * no lugar). Colar: botão direito ou Ctrl+V.
function Read-Secret([string]$Prompt) {
  $secure = Read-Host "  $Prompt" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

# ----------------------------------------------------------------- Docker Desktop
function Get-DockerDesktopCandidates {
  $dirs = New-Object System.Collections.Generic.List[string]
  Get-Process -Name 'Docker Desktop' -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.Path) { $dirs.Add((Split-Path -Parent $_.Path)) }
  }
  $uninstallKeys = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  foreach ($key in $uninstallKeys) {
    Get-ItemProperty -Path $key -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName -like 'Docker Desktop*' } |
      ForEach-Object {
        foreach ($value in @($_.InstallLocation, $_.DisplayIcon, $_.UninstallString)) {
          if (-not $value) { continue }
          $path = ([string]$value -split ',')[0].Trim().Trim('"')
          if ($path -match '^(.+?\.exe)') { $path = Split-Path -Parent $Matches[1] }
          if ($path) { $dirs.Add($path) }
        }
      }
  }
  foreach ($base in @($env:ProgramFiles, $env:ProgramW6432, (Join-Path $env:LOCALAPPDATA 'Programs'), $env:LOCALAPPDATA)) {
    if ($base) {
      $dirs.Add((Join-Path $base 'Docker\Docker'))
      $dirs.Add((Join-Path $base 'Docker'))
      $dirs.Add((Join-Path $base 'DockerDesktop'))
    }
  }
  $cmd = Get-Command docker.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($cmd -and $cmd.Source) { $dirs.Add((Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $cmd.Source)))) }
  return $dirs
}
function Find-DockerDesktop {
  foreach ($dir in (Get-DockerDesktopCandidates)) {
    $exe = Join-Path $dir 'Docker Desktop.exe'
    if (Test-Path -LiteralPath $exe) {
      $script:DockerDesktopExe = (Resolve-Path -LiteralPath $exe).Path
      $cli = Join-Path (Split-Path -Parent $script:DockerDesktopExe) 'resources\bin\docker.exe'
      if (-not (Test-Path -LiteralPath $cli)) {
        $onPath = Get-Command docker.exe -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($onPath) { $cli = $onPath.Source }
      }
      $script:DockerCli = $cli
      return $true
    }
  }
  return $false
}
function Test-DockerEngine {
  if (-not (Test-Path $script:DockerCli)) { return $false }
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'SilentlyContinue'
  $null = & $script:DockerCli info --format '{{.ServerVersion}}' 2>$null
  $ok = ($LASTEXITCODE -eq 0)
  $ErrorActionPreference = $previous
  return $ok
}
function Start-DockerDesktop {
  # Pelo Explorer, o Docker Desktop abre como usuário comum.
  Start-Process -FilePath 'explorer.exe' -ArgumentList ('"{0}"' -f $script:DockerDesktopExe)
}
function Wait-DockerEngine([int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  Write-Host '  ' -NoNewline
  while ((Get-Date) -lt $deadline) {
    if (Test-DockerEngine) { Write-Host ''; return $true }
    Write-Host '.' -NoNewline
    Start-Sleep -Seconds 5
  }
  Write-Host ''
  return $false
}

# ----------------------------------------------------------------- scripts Linux
$LinuxProjectExists = @'
#!/usr/bin/env bash
if [ -d "$HOME/"@@PROJECT@@"/.git" ]; then echo sim; else echo nao; fi
'@

$LinuxDockerCheck = @'
#!/usr/bin/env bash
if docker info --format '{{.ServerVersion}}' >/dev/null 2>&1; then echo ok; else echo falha; fi
'@

$LinuxUpdate = @'
#!/usr/bin/env bash
set -uo pipefail
cd "$HOME/"@@PROJECT@@ || { echo "  [X] projeto não encontrado"; exit 2; }
branch=@@BRANCH@@
echo "  Buscando a versão nova no GitHub..."
if ! git fetch --quiet origin; then
  echo "  [X] não consegui falar com o GitHub (internet ou login)"
  exit 3
fi
if ! git rev-parse --verify --quiet "origin/$branch" >/dev/null; then
  echo "  [X] a branch $branch não existe no GitHub"
  exit 4
fi
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "  [!] Há arquivos do projeto alterados neste computador:"
  git status --short --untracked-files=no | sed 's/^/      /'
  if git stash push --quiet -m "radar-neon: guardado antes da etapa final em $(date '+%d/%m/%Y %H:%M')"; then
    echo "  [OK] guardei essas alterações (nada foi apagado; para ver: git stash list)"
  else
    echo "  [X] não consegui guardar as alterações; não vou trocar de versão"
    exit 5
  fi
fi
if git show-ref --verify --quiet "refs/heads/$branch"; then
  git checkout --quiet "$branch" || exit 6
else
  git checkout --quiet -b "$branch" --track "origin/$branch" || exit 6
fi
if ! git merge --quiet --ff-only "origin/$branch"; then
  echo "  [X] não consegui atualizar a branch $branch sem perder nada"
  exit 7
fi
echo "  [OK] versão: $(git log -1 --format='%h %s')"
if [ ! -f .env ]; then
  echo "  Criando o .env (senhas novas)..."
  make setup || exit 8
fi
'@

# Só diz se cada chave está preenchida; o valor nunca é impresso.
$LinuxKeyStatus = @'
#!/usr/bin/env bash
cd "$HOME/"@@PROJECT@@ || exit 1
if [ ! -f .env ]; then echo SEM_ENV; exit 0; fi
for n in YOUTUBE_API_KEY ANTHROPIC_API_KEY GOOGLE_TTS_API_KEY GEMINI_API_KEY GOOGLE_OAUTH_CLIENT_ID GOOGLE_OAUTH_CLIENT_SECRET; do
  v=$(grep -E "^$n=" .env | tail -1 | cut -d= -f2- | tr -d '\r[:space:]')
  if [ -n "$v" ]; then echo "$n=definida"; else echo "$n=vazia"; fi
done
'@

# Grava NOME=valor no .env. O valor chega pela entrada padrão e nunca é impresso.
$LinuxSetKey = @'
#!/usr/bin/env bash
set -uo pipefail
cd "$HOME/"@@PROJECT@@ || { echo sem-projeto; exit 0; }
name=@@NAME@@
IFS= read -r value || true
value=$(printf '%s' "$value" | tr -d '\r')
case "$value" in ''|*[!A-Za-z0-9_.-]*) echo invalida; exit 0 ;; esac
if [ ! -f .env ]; then echo sem-env; exit 0; fi
printf '%s' "$value" | python3 -c '
import os, sys
name, value = sys.argv[1], sys.stdin.read()
with open(".env", encoding="utf-8") as f:
    lines = f.read().splitlines()
out, done = [], False
for line in lines:
    if line.startswith(name + "="):
        if not done:
            out.append(name + "=" + value)
            done = True
        continue
    out.append(line)
if not done:
    out.append(name + "=" + value)
tmp = ".env.tmp-radar-neon"
with open(tmp, "w", encoding="utf-8", newline="\n") as f:
    f.write("\n".join(out) + "\n")
os.chmod(tmp, 0o600)
os.replace(tmp, ".env")
' "$name" && echo ok || echo erro
'@

$LinuxAccept = @'
#!/usr/bin/env bash
set -o pipefail
cd "$HOME/"@@PROJECT@@ || exit 1
desk=@@DESKDIR@@
report=@@REPORT@@
real=@@REAL@@
make accept-5 ENVIAR="$real"
code=$?
for f in "$report"; do
  if [ -f "$f" ] && cp "$f" "$desk/" 2>/dev/null; then echo "  Copiado para a Área de Trabalho: $f"; fi
done
exit "$code"
'@

# Sobe o estúdio com a versão nova (a 1ª vez reconstrói as imagens e baixa o modelo Whisper).
$LinuxUp = @'
#!/usr/bin/env bash
set -uo pipefail
cd "$HOME/"@@PROJECT@@ || exit 1
echo "  Subindo o estúdio com a versão nova (reconstrói as imagens do painel e dos agentes)..."
make up || exit 2
'@

$LinuxOwnerCount = @'
#!/usr/bin/env bash
cd "$HOME/"@@PROJECT@@ || exit 1
n=$(docker compose -f infra/docker-compose.yml --env-file .env exec -T postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select count(*) from \"User\""' 2>/dev/null | tr -d '[:space:]')
echo "${n:-0}"
'@

$LinuxOwner = @'
#!/usr/bin/env bash
cd "$HOME/"@@PROJECT@@ || exit 1
make owner
'@

# Grava um valor do cliente OAuth no .env (sem teste de API: o teste é o login no painel).
function Set-OAuthValue {
  param([string]$Name, [string]$Label, [string]$Pattern, [string]$Hint)
  for ($try = 1; $try -le 3; $try++) {
    $value = Read-Secret "Cole o $Label e aperte Enter (só Enter = pular)"
    if ($null -eq $value) { $value = '' }
    $value = $value.Trim()
    if ($value -eq '') { Write-Info 'pulado'; return $false }
    if ($value -notmatch $Pattern) {
      $value = $null
      Write-Attention "Isso não parece o $Label ($Hint). Confira se copiou inteiro."
      continue
    }
    $saved = [string](Get-LinuxScriptOutputWithSecret 'gravar-chave.sh' $LinuxSetKey @{ PROJECT = $ProjectRel; NAME = $Name } $value | Select-Object -Last 1)
    $value = $null
    if ($saved -eq 'ok') { Write-Ok "$Name gravado no .env (só no seu computador)"; return $true }
    Write-Attention "Não consegui gravar no .env ($saved)."
    return $false
  }
  return $false
}

# =============================================================================
Clear-Host
Write-Host ''
Write-Host '  RADAR NEON — Etapa final: Conformidade, publicação, métricas, Comando e produção diária' -ForegroundColor Magenta
Write-Host '  Atualiza o projeto, conecta o canal (opcional), roda o aceite e abre a tela Aprovação.'
Write-Host "  Log: $LogFile"

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Attention 'Não precisa abrir como administrador. Se o Ubuntu não for encontrado, feche e abra com dois cliques normais.'
}

# ----------------------------------------------------------------- 1. Ubuntu e projeto
Write-Step 'Ubuntu e projeto'
$null = & wsl.exe --status 2>$null
if ($LASTEXITCODE -ne 0) { Stop-Run 'O WSL não está instalado. Rode primeiro o instalar-radar-neon.bat.' }
$distros = Get-Distros
if ($distros -contains $PreferredDistro) { $script:Distro = $PreferredDistro }
else { $script:Distro = $distros | Where-Object { $_ -like 'Ubuntu*' } | Select-Object -First 1 }
if (-not $script:Distro) { Stop-Run 'Não achei o Ubuntu no WSL. Rode primeiro o instalar-radar-neon.bat.' }
Write-Ok "distro: $($script:Distro)"
$exists = Get-LinuxScriptOutput 'projeto-existe.sh' $LinuxProjectExists @{ PROJECT = $ProjectRel }
if ($exists -notcontains 'sim') {
  Stop-Run "Não achei o projeto em ~/$ProjectRel no Ubuntu. Rode primeiro o instalar-radar-neon.bat."
}
Write-Ok "projeto em ~/$ProjectRel"

# ----------------------------------------------------------------- 2. Docker Desktop
Write-Step 'Docker Desktop'
if (-not (Find-DockerDesktop)) { Stop-Run 'Não achei o Docker Desktop. Rode primeiro o instalar-radar-neon.bat.' }
if (-not (Test-DockerEngine)) {
  Write-Info 'Abrindo o Docker Desktop e esperando o motor ligar (até 5 minutos)...'
  Start-DockerDesktop
  if (-not (Wait-DockerEngine 300)) {
    Stop-Run 'O Docker Desktop não ficou pronto. Abra-o pelo menu Iniciar, espere "Engine running" e rode de novo.'
  }
}
Write-Ok 'Docker Engine ligado'
$dockerOk = $false
for ($i = 1; $i -le 4; $i++) {
  if ((Get-LinuxScriptOutput 'docker-check.sh' $LinuxDockerCheck @{}) -contains 'ok') { $dockerOk = $true; break }
  Write-Info "O Docker ainda não responde dentro do Ubuntu. Aguardando ($i/4)..."
  & wsl.exe --terminate $script:Distro | Out-Null
  Start-Sleep -Seconds 20
}
if (-not $dockerOk) {
  Stop-Run 'O Docker não responde dentro do Ubuntu. Rode o instalar-radar-neon.bat (ele religa a integração) e depois este arquivo.'
}
Write-Ok 'Docker respondendo dentro do Ubuntu'

# ----------------------------------------------------------------- 3. Atualizar o projeto
Write-Step "Atualizando o projeto para a etapa final (branch $Branch)"
$code = Invoke-LinuxScript -Name 'atualizar.sh' -Content $LinuxUpdate -Values @{ PROJECT = $ProjectRel; BRANCH = $Branch }
if ($code -ne 0) {
  Stop-Run 'Não consegui atualizar o projeto (veja a mensagem acima). Se o GitHub pediu login e falhou, rode de novo.'
}

# ----------------------------------------------------------------- 4. Cliente OAuth do Google
Write-Step 'Conexão com o canal: cliente OAuth do Google (fica só no .env)'
try { Stop-Transcript | Out-Null } catch { }
$status = Get-LinuxScriptOutput 'status-chaves.sh' $LinuxKeyStatus @{ PROJECT = $ProjectRel }
if ($status -contains 'SEM_ENV') { Stop-Run 'O .env não existe. Rode o instalar-radar-neon.bat.' }
$anthropicSet = $status -contains 'ANTHROPIC_API_KEY=definida'
$ttsSet = $status -contains 'GOOGLE_TTS_API_KEY=definida'
$clientIdSet = $status -contains 'GOOGLE_OAUTH_CLIENT_ID=definida'
$clientSecretSet = $status -contains 'GOOGLE_OAUTH_CLIENT_SECRET=definida'
if ($clientIdSet -and $clientSecretSet) {
  Write-Ok 'Cliente OAuth já está no .env'
} else {
  Write-Info 'Para publicar pela API e ler as métricas, o painel precisa de um cliente OAuth do Google.'
  Write-Info 'Passo a passo (5 minutos): docs/notebook-setup.md, seção 13. Resumo:'
  Write-Info '  1. No MESMO projeto do Google Cloud das outras chaves, ative "YouTube Data API v3" e "YouTube Analytics API".'
  Write-Info '  2. Tela de consentimento OAuth: tipo Externo, seu e-mail, e PUBLIQUE o app ("Em produção").'
  Write-Info '  3. Credenciais → Criar credenciais → ID do cliente OAuth → tipo "Aplicativo da Web".'
  Write-Info '     URI de redirecionamento autorizado: http://localhost:3000/api/youtube/callback'
  Write-Info '  4. Copie o "ID do cliente" e a "Chave secreta do cliente".'
  Write-Info 'Sem isso tudo funciona igual, mas aprovar gera um PACOTE para você enviar pelo YouTube Studio.'
  if (Read-YesNo 'Abrir a página de credenciais do Google Cloud agora?' $true) {
    Start-Process 'https://console.cloud.google.com/apis/credentials'
  }
  if (-not $clientIdSet) {
    $clientIdSet = Set-OAuthValue -Name 'GOOGLE_OAUTH_CLIENT_ID' -Label 'ID do cliente' -Pattern '^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$' -Hint 'termina em .apps.googleusercontent.com'
  }
  if ($clientIdSet -and -not $clientSecretSet) {
    $clientSecretSet = Set-OAuthValue -Name 'GOOGLE_OAUTH_CLIENT_SECRET' -Label 'segredo do cliente' -Pattern '^GOCSPX-[A-Za-z0-9_-]{20,}$' -Hint 'começa com GOCSPX-'
  }
}
try { Start-Transcript -Path $LogFile -Append | Out-Null } catch { }
$oauthReady = $clientIdSet -and $clientSecretSet
if (-not $anthropicSet) { Write-Attention 'Sem ANTHROPIC_API_KEY: o Diretor do Comando e a Conformidade ficam no modo de teste. Configure pelo rodar-fase-3.bat.' }

# ----------------------------------------------------------------- 5. Subir o estúdio
Write-Step 'Subindo o estúdio'
$upCode = Invoke-LinuxScript -Name 'subir.sh' -Content $LinuxUp -Values @{ PROJECT = $ProjectRel }
if ($upCode -ne 0) { Write-Attention 'O estúdio não subiu inteiro (veja acima). O aceite tenta de novo e mostra o que falhou.' }
$owners = Get-LinuxScriptOutput 'contar-dono.sh' $LinuxOwnerCount @{ PROJECT = $ProjectRel }
$ownerCount = 0
if ($owners.Count -gt 0) { [void][int]::TryParse([string]$owners[-1], [ref]$ownerCount) }
if ($ownerCount -eq 0) {
  Write-Attention 'Ainda não existe login do painel.'
  if (Read-YesNo 'Criar agora (e-mail, senha e 2FA com o app do celular)?' $true) {
    $null = Invoke-LinuxScript -Name 'dono.sh' -Content $LinuxOwner -Values @{ PROJECT = $ProjectRel }
  }
}

# ----------------------------------------------------------------- 6. Conectar o YouTube
Write-Step 'Conectar o canal do YouTube (no navegador)'
if ($oauthReady) {
  Start-Process 'http://localhost:3000/configuracoes#youtube'
  Write-Info 'No painel (Configurações), clique em "Conectar YouTube", entre com a conta DO CANAL e marque TODAS as permissões.'
  Write-Info 'Se o Google avisar "app não verificado", clique em Avançado → Acessar (o app é seu).'
  Write-Info 'Nunca digite a senha do YouTube em outro lugar: o painel só guarda um token cifrado.'
  $null = Read-Host '  Quando aparecer "Conectado" no painel, volte aqui e aperte Enter (ou só Enter para pular)'
} else {
  Write-Info 'Pulado (sem cliente OAuth). Dá para conectar depois: rode este arquivo de novo.'
}

# ----------------------------------------------------------------- 7. Aceite
Write-Step 'Aceite da etapa final (make accept-5)'
$enviar = '0'
if ($oauthReady) {
  Write-Info 'Opcional: o aceite pode fazer um ENVIO REAL de teste: um Short sobe PRIVADO, agendado para daqui a 30 dias,'
  Write-Info 'com a marca de conteúdo sintético. Ninguém vê. Depois de conferir no YouTube Studio, apague o vídeo.'
  if (Read-YesNo 'Fazer o envio real de teste?' $false) { $enviar = '1' }
}
Write-Info 'O aceite produz um Short simulado, passa pela Conformidade, aprova e agenda (simulado), confere o bloqueio,'
Write-Info 'conversa com o Diretor, roda a produção diária (simulada) e os testes. De 30 a 60 min.'
$acceptValues = @{ PROJECT = $ProjectRel; DESKDIR = (ConvertTo-WslPath $Desktop); REPORT = $ReportName; REAL = $enviar }
$acceptCode = Invoke-LinuxScript -Name 'aceite.sh' -Content $LinuxAccept -Values $acceptValues
Write-Host ''
if ($acceptCode -eq 0) { Write-Ok 'o aceite da etapa final passou!' }
else { Write-Attention 'algum critério do aceite falhou (veja o resultado por critério logo acima).' }
$reportPath = Join-Path $Desktop $ReportName
if (Test-Path -LiteralPath $reportPath) { Write-Info "Resultado: $reportPath  -> mande esse arquivo para o Claude." }
else { Write-Attention "Não achei o resultado na Área de Trabalho. Ele fica também em ~/$ProjectRel/$ReportName no Ubuntu." }

# ----------------------------------------------------------------- 8. Painel
Write-Step 'Painel'
Start-Process 'http://localhost:3000/aprovacao'
Write-Ok 'Tela Aprovação aberta: http://localhost:3000/aprovacao'
Write-Info 'Todo dia às 07:41 o estúdio produz até 1 longo + 4 Shorts (Configurações → Produção diária).'
Write-Info 'Tudo espera você em Aprovação. No Comando, peça em português: "faça um react do vídeo novo do parceiro X".'
Write-Info 'Para ficar público pela API, o Google precisa auditar o projeto (texto pronto em docs/auditoria-youtube.md).'
Write-Host ''
Write-Info "Log desta execução: $LogFile"
try { Stop-Transcript | Out-Null } catch { }
if ($acceptCode -ne 0) { exit 1 }
