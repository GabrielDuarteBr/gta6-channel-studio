<# : Fase 2 do Radar Neon no Windows (arquivo hibrido: .bat + PowerShell)
@echo off
setlocal
title Radar Neon - Fase 2 (personagem e voz)
rem Copia para uma pasta local (funciona mesmo aberto de \\wsl.localhost ou de Downloads)
set "SRC=%~f0"
set "WORK=%TEMP%\radar-neon-fase-2"
if /i not "%~dp0"=="%WORK%\" (
  if not exist "%WORK%" mkdir "%WORK%"
  copy /y "%SRC%" "%WORK%\rodar-fase-2.bat" >nul
  set "SRC=%WORK%\rodar-fase-2.bat"
)
rem Roda como usuario comum: o WSL e o Docker Desktop sao por usuario.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$BatchPath='%SRC%'; $code=[IO.File]::ReadAllText($BatchPath,[Text.Encoding]::UTF8); Invoke-Expression $code"
echo.
pause
exit /b
#>

# =============================================================================
#  Radar Neon — Fase 2 (personagem Zeca Neon e a voz do Google) no seu PC
#  1. confere Ubuntu, projeto e Docker Desktop (liga o Docker se estiver fechado)
#  2. atualiza o projeto para a branch da Fase 2
#  3. pede a chave da voz do Google (escondida), testa e grava no .env
#  4. gera amostras das vozes e um clipe do Zeca com a voz do Google (Área de Trabalho)
#  5. roda o aceite da Fase 2 (make accept-2) e salva o resultado na Área de Trabalho
#  6. abre a tela Personagem no navegador
#  Pré-requisito: o instalar-radar-neon.bat já ter rodado uma vez (Fase 0).
#  A chave nunca aparece na tela, no log nem na linha de comando.
# =============================================================================

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
$env:WSL_UTF8 = '1'

$Branch = 'fase-2-personagem'
$PreferredDistro = 'Ubuntu-24.04'
$ProjectRel = 'projetos/gta6-channel-studio'
$ReportName = 'radar-neon-aceite-fase-2.txt'
$VideoName = 'radar-neon-zeca-teste.mp4'
$GoogleVideoName = 'radar-neon-zeca-voz-google.mp4'
$VoicesFolder = 'radar-neon-vozes'

$Work = Join-Path $env:LOCALAPPDATA 'radar-neon-fase-2'
New-Item -ItemType Directory -Force -Path $Work | Out-Null
$LogFile = Join-Path $env:USERPROFILE 'radar-neon-fase-2.log'
try { Start-Transcript -Path $LogFile -Append | Out-Null } catch { }

$Desktop = [Environment]::GetFolderPath('Desktop')
$Utf8NoBom = New-Object System.Text.UTF8Encoding $false
$DockerDesktopExe = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
$DockerCli = Join-Path $env:ProgramFiles 'Docker\Docker\resources\bin\docker.exe'

$TotalSteps = 7
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
  if git stash push --quiet -m "radar-neon: guardado antes da fase 2 em $(date '+%d/%m/%Y %H:%M')"; then
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
for n in GOOGLE_TTS_API_KEY; do
  v=$(grep -E "^$n=" .env | tail -1 | cut -d= -f2- | tr -d '\r[:space:]')
  if [ -n "$v" ]; then echo "$n=definida"; else echo "$n=vazia"; fi
done
'@

# Testa uma chave lida da entrada padrão e imprime só o resultado (ok, invalida...).
# Google TTS: lista de vozes pt-BR (não gasta caracteres da cota).
$LinuxKeyCheck = @'
#!/usr/bin/env bash
IFS= read -r key || true
key=$(printf '%s' "$key" | tr -d '\r')
case "$key" in ''|*[!A-Za-z0-9_-]*) echo invalida; exit 0 ;; esac
body=$(mktemp)
trap 'rm -f "$body"' EXIT
# A chave vai para o curl pela entrada padrão (-K -), nunca como argumento.
code=$(printf 'url = "https://texttospeech.googleapis.com/v1/voices?languageCode=pt-BR"\nheader = "x-goog-api-key: %s"\n' "$key" |
  curl -sS -m 20 -o "$body" -w '%{http_code}' -K - 2>/dev/null) || code=000
reason=$(python3 -c '
import json, sys
try:
    err = json.load(open(sys.argv[1])).get("error") or {}
except Exception:
    sys.exit(0)
reason = ""
if isinstance(err, dict):
    errors = err.get("errors") or []
    if errors and isinstance(errors[0], dict):
        reason = errors[0].get("reason", "")
    for detail in err.get("details") or []:
        if not reason and isinstance(detail, dict):
            reason = detail.get("reason", "")
    reason = reason or err.get("status", "") or err.get("type", "")
print(reason)
' "$body" 2>/dev/null)
case "$code" in
  200) echo ok ;;
  000) echo sem-rede ;;
  401) echo invalida ;;
  429) echo cota ;;
  400|403)
    case "$reason" in
      *keyInvalid*|*API_KEY_INVALID*|*badRequest*|*authentication_error*) echo invalida ;;
      *accessNotConfigured*|*SERVICE_DISABLED*) echo api-desativada ;;
      *BILLING*) echo faturamento ;;
      *quotaExceeded*|*dailyLimitExceeded*|*RATE_LIMIT*) echo cota ;;
      *) echo "restrita ${reason:-HTTP $code}" ;;
    esac ;;
  *) echo "erro HTTP $code${reason:+ ($reason)}" ;;
esac
'@

# Grava NOME=valor no .env. O valor chega pela entrada padrão e nunca é impresso.
$LinuxSetKey = @'
#!/usr/bin/env bash
set -uo pipefail
cd "$HOME/"@@PROJECT@@ || { echo sem-projeto; exit 0; }
name=@@NAME@@
IFS= read -r value || true
value=$(printf '%s' "$value" | tr -d '\r')
case "$value" in ''|*[!A-Za-z0-9_-]*) echo invalida; exit 0 ;; esac
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
video=@@VIDEO@@
make accept-2
code=$?
for f in "$report" "$video"; do
  if [ -f "$f" ] && cp "$f" "$desk/" 2>/dev/null; then echo "  Copiado para a Área de Trabalho: $f"; fi
done
exit "$code"
'@

# Amostras das vozes Chirp 3 HD (masculinas) + clipe do Zeca com a voz do Google.
$LinuxGoogleVoice = @'
#!/usr/bin/env bash
set -uo pipefail
cd "$HOME/"@@PROJECT@@ || exit 1
desk=@@DESKDIR@@
folder=@@FOLDER@@
gvideo=@@GVIDEO@@
COMPOSE="docker compose -f infra/docker-compose.yml --env-file .env"
echo "  Subindo o estúdio com a versão nova (a primeira vez reconstrói as imagens)..."
make up || exit 2
echo
echo "  Amostras das vozes masculinas do Google (cada uma ~100 caracteres da cota grátis)..."
if make vozes; then
  mkdir -p "$desk/$folder"
  $COMPOSE cp worker-media:/data/work/vozes/. "$desk/$folder/" >/dev/null 2>&1 && echo "  [OK] amostras em: $folder (Área de Trabalho)"
else
  echo "  [!] não consegui gerar as amostras (veja a mensagem acima)"
fi
echo
echo "  Clipe do Zeca com a voz do Google..."
out=$(make zeca VOZ=google 2>&1)
echo "$out" | tail -4
video=$(echo "$out" | grep -E '^\{"resumo"' | tail -1 | python3 -c 'import json,sys; print(json.load(sys.stdin).get("resumo",{}).get("video",""))' 2>/dev/null)
if [ -n "$video" ] && $COMPOSE cp "render:/data/work/$video" "$desk/$gvideo" >/dev/null 2>&1; then
  echo "  [OK] vídeo na Área de Trabalho: $gvideo"
else
  echo "  [!] o clipe com a voz do Google não saiu (veja a mensagem acima)"
fi
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

# Pede uma chave, confere o formato, testa na API e grava no .env.
function Set-ApiKey {
  param([string]$Name, [string]$Label, [string]$Pattern, [string]$Prefix)
  for ($try = 1; $try -le 3; $try++) {
    $value = Read-Secret "Cole a $Label e aperte Enter (só Enter = pular)"
    if ($null -eq $value) { $value = '' }
    $value = $value.Trim()
    if ($value -eq '') { Write-Info 'pulado'; return $false }
    if ($value -notmatch $Pattern) {
      $value = $null
      Write-Attention "Isso não parece uma $Label (ela começa com $Prefix). Confira se copiou inteira."
      continue
    }
    Write-Info 'Testando a chave...'
    $result = [string](Get-LinuxScriptOutputWithSecret 'testar-chave.sh' $LinuxKeyCheck @{} $value | Select-Object -Last 1)
    $save = $false
    switch -Wildcard ($result) {
      'ok' { Write-Ok 'chave aceita'; $save = $true }
      'cota' { Write-Ok 'chave aceita (a cota de hoje está no limite; ela volta amanhã)'; $save = $true }
      'sem-rede' { Write-Attention 'Não consegui testar agora (internet?). Vou gravar assim mesmo.'; $save = $true }
      'invalida' { Write-Attention 'A chave foi recusada: ela não existe ou foi copiada pela metade.' }
      'api-desativada' { Write-Attention 'A chave existe, mas a Cloud Text-to-Speech API não está ATIVADA no projeto (guia, seção 10.1, passo 3).' }
      'faturamento' { Write-Attention 'O faturamento do projeto não está ativado (guia, seção 10.1, passo 2). A cota grátis só vale com cartão cadastrado.' }
      'restrita*' { Write-Attention "A chave foi recusada por uma restrição ($result). Ela precisa liberar a Cloud Text-to-Speech API (guia, seção 10.1, passo 4)." }
      default { Write-Attention "Resposta inesperada ao testar: $result. Vou gravar assim mesmo; o aceite mostra se funcionou."; $save = $true }
    }
    if (-not $save) {
      $value = $null
      if (-not (Read-YesNo 'Tentar outra chave?' $true)) { return $false }
      continue
    }
    $saved = [string](Get-LinuxScriptOutputWithSecret 'gravar-chave.sh' $LinuxSetKey @{ PROJECT = $ProjectRel; NAME = $Name } $value | Select-Object -Last 1)
    $value = $null
    if ($saved -eq 'ok') { Write-Ok "$Name gravada no .env (só no seu computador)"; return $true }
    Write-Attention "Não consegui gravar a chave no .env ($saved)."
    return $false
  }
  return $false
}

# =============================================================================
Clear-Host
Write-Host ''
Write-Host '  RADAR NEON — Fase 2: o personagem Zeca Neon e a voz do Google' -ForegroundColor Magenta
Write-Host '  Atualiza o projeto, configura a voz, gera amostras, roda o aceite e abre a tela Personagem.'
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
Write-Step "Atualizando o projeto para a Fase 2 (branch $Branch)"
$code = Invoke-LinuxScript -Name 'atualizar.sh' -Content $LinuxUpdate -Values @{ PROJECT = $ProjectRel; BRANCH = $Branch }
if ($code -ne 0) {
  Stop-Run 'Não consegui atualizar o projeto (veja a mensagem acima). Se o GitHub pediu login e falhou, rode de novo.'
}

# ----------------------------------------------------------------- 4. Chave da voz do Google
Write-Step 'Voz do Zeca: chave do Google Cloud Text-to-Speech (fica só no .env)'
# A chave não vai para o log: a gravação do log pausa durante este passo.
try { Stop-Transcript | Out-Null } catch { }
$status = Get-LinuxScriptOutput 'status-chaves.sh' $LinuxKeyStatus @{ PROJECT = $ProjectRel }
if ($status -contains 'SEM_ENV') { Stop-Run 'O .env não existe. Rode o instalar-radar-neon.bat.' }
$googleSet = $status -contains 'GOOGLE_TTS_API_KEY=definida'
$googlePattern = '^AIza[0-9A-Za-z_-]{35}$'
if ($googleSet) {
  Write-Ok 'GOOGLE_TTS_API_KEY já está no .env'
  if (Read-YesNo 'Trocar por outra chave?' $false) {
    $null = Set-ApiKey -Name 'GOOGLE_TTS_API_KEY' -Label 'chave do Google (Text-to-Speech)' -Pattern $googlePattern -Prefix 'AIza'
  }
} else {
  Write-Info 'No mesmo projeto do Google Cloud da chave do YouTube (guia: docs/notebook-setup.md, seção 10.1):'
  Write-Info '  1. Faturamento: vincule um cartão (a cota grátis de 1 milhão de caracteres/mês só vale assim).'
  Write-Info '  2. Ative a "Cloud Text-to-Speech API".'
  Write-Info '  3. Crie uma chave de API e restrinja à "Cloud Text-to-Speech API".'
  Write-Info '  4. Recomendado: crie um orçamento com alerta (ex.: R$ 5) em Faturamento > Orçamentos.'
  Write-Info 'O estúdio também trava sozinho em 95% da cota grátis do mês.'
  if (Read-YesNo 'Abrir a página da Cloud Text-to-Speech API no navegador agora?' $true) {
    Start-Process 'https://console.cloud.google.com/apis/library/texttospeech.googleapis.com'
  }
  $googleSet = Set-ApiKey -Name 'GOOGLE_TTS_API_KEY' -Label 'chave do Google (Text-to-Speech)' -Pattern $googlePattern -Prefix 'AIza'
}
try { Start-Transcript -Path $LogFile -Append | Out-Null } catch { }
if (-not $googleSet) {
  Write-Attention 'Sem a chave, a fase segue com a voz de teste (robótica). Dá para rodar este arquivo de novo depois.'
}

# ----------------------------------------------------------------- 5. Vozes do Google
Write-Step 'Amostras das vozes e um clipe com a voz do Google'
if ($googleSet) {
  $voiceValues = @{ PROJECT = $ProjectRel; DESKDIR = (ConvertTo-WslPath $Desktop); FOLDER = $VoicesFolder; GVIDEO = $GoogleVideoName }
  $null = Invoke-LinuxScript -Name 'voz-google.sh' -Content $LinuxGoogleVoice -Values $voiceValues
  $voicesPath = Join-Path $Desktop $VoicesFolder
  if (Test-Path -LiteralPath $voicesPath) {
    Write-Ok "Ouça as amostras em: $voicesPath"
    Write-Info 'Para trocar a voz: painel > Configurações > Voz do Zeca (ex.: pt-BR-Chirp3-HD-Charon).'
  }
  $gPath = Join-Path $Desktop $GoogleVideoName
  if (Test-Path -LiteralPath $gPath) { Write-Ok "Zeca com a voz do Google: $gPath" }
} else {
  Write-Info 'Pulado (sem chave do Google).'
}

# ----------------------------------------------------------------- 6. Aceite da Fase 2
Write-Step 'Aceite da Fase 2 (make accept-2)'
Write-Info 'Gera o clipe do Zeca duas vezes e compara quadro a quadro, gera um Short e roda todos os'
Write-Info 'testes (o aceite usa a voz de teste, para o resultado ser sempre igual). Leva de 20 a 40 min.'
$acceptValues = @{ PROJECT = $ProjectRel; DESKDIR = (ConvertTo-WslPath $Desktop); REPORT = $ReportName; VIDEO = $VideoName }
$acceptCode = Invoke-LinuxScript -Name 'aceite.sh' -Content $LinuxAccept -Values $acceptValues
Write-Host ''
if ($acceptCode -eq 0) { Write-Ok 'o aceite da Fase 2 passou!' }
else { Write-Attention 'algum critério do aceite falhou (veja o resultado por critério logo acima).' }
$reportPath = Join-Path $Desktop $ReportName
if (Test-Path -LiteralPath $reportPath) { Write-Info "Resultado: $reportPath  -> mande esse arquivo para o Claude." }
else { Write-Attention "Não achei o resultado na Área de Trabalho. Ele fica também em ~/$ProjectRel/$ReportName no Ubuntu." }

# ----------------------------------------------------------------- 7. Painel
Write-Step 'Painel'
$owners = Get-LinuxScriptOutput 'contar-dono.sh' $LinuxOwnerCount @{ PROJECT = $ProjectRel }
$ownerCount = 0
if ($owners.Count -gt 0) { [void][int]::TryParse([string]$owners[-1], [ref]$ownerCount) }
if ($ownerCount -eq 0) {
  Write-Attention 'Ainda não existe login do painel.'
  if (Read-YesNo 'Criar agora (e-mail, senha e 2FA com o app do celular)?' $true) {
    $null = Invoke-LinuxScript -Name 'dono.sh' -Content $LinuxOwner -Values @{ PROJECT = $ProjectRel }
  }
}
Start-Process 'http://localhost:3000/personagem'
Write-Ok 'Tela Personagem aberta no navegador: http://localhost:3000/personagem'
Write-Info 'Ali dá para gerar clipes (voz de teste ou Google) e ver o uso da cota grátis do mês.'
Write-Host ''
Write-Info "Log desta execução: $LogFile"
try { Stop-Transcript | Out-Null } catch { }
if ($acceptCode -ne 0) { exit 1 }
