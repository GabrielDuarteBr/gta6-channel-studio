<# : Atualizacao do Radar Neon no Windows (arquivo hibrido: .bat + PowerShell)
@echo off
setlocal
title Radar Neon - Aplicar os commits novos (Zeca com personalidade e arte do artista)
rem Copia para uma pasta local (funciona mesmo aberto de \\wsl.localhost ou de Downloads)
set "SRC=%~f0"
set "WORK=%TEMP%\radar-neon-atualizar"
if /i not "%~dp0"=="%WORK%\" (
  if not exist "%WORK%" mkdir "%WORK%"
  copy /y "%SRC%" "%WORK%\atualizar-radar-neon.bat" >nul
  set "SRC=%WORK%\atualizar-radar-neon.bat"
)
rem Roda como usuario comum: o WSL e o Docker Desktop sao por usuario.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$BatchPath='%SRC%'; $code=[IO.File]::ReadAllText($BatchPath,[Text.Encoding]::UTF8); Invoke-Expression $code"
echo.
pause
exit /b
#>

# =============================================================================
#  Radar Neon — aplicar no seu PC os commits novos do GitHub
#  1. confere Ubuntu, projeto e Docker Desktop (liga o Docker se estiver fechado)
#  2. traz os commits novos da branch abaixo e mostra a lista do que entrou
#     (alterações feitas à mão neste PC são guardadas com "git stash", nada é apagado)
#  3. sobe o estúdio (reconstrói as imagens e aplica as mudanças do banco sozinho)
#  4. gera um clipe de teste do Zeca com o jeito novo e põe na Área de Trabalho (opcional)
#  5. abre a tela Personagem (Arte do artista e Bíblia)
#  Pré-requisito: o instalar-radar-neon.bat já ter rodado uma vez (Fase 0).
#  Este arquivo não envia nada ao GitHub nem ao YouTube: só baixa e aplica.
# =============================================================================

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
$env:WSL_UTF8 = '1'

# Branch com os commits mais recentes (inclui tudo da etapa final).
$Branch = 'personagem-arte-estilo'
$PreferredDistro = 'Ubuntu-24.04'
$ProjectRel = 'projetos/gta6-channel-studio'
$VideoName = 'radar-neon-zeca-jeito-novo.mp4'

$Work = Join-Path $env:LOCALAPPDATA 'radar-neon-atualizar'
New-Item -ItemType Directory -Force -Path $Work | Out-Null
$LogFile = Join-Path $env:USERPROFILE 'radar-neon-atualizar.log'
try { Start-Transcript -Path $LogFile -Append | Out-Null } catch { }

$Desktop = [Environment]::GetFolderPath('Desktop')
$Utf8NoBom = New-Object System.Text.UTF8Encoding $false
$DockerDesktopExe = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
$DockerCli = Join-Path $env:ProgramFiles 'Docker\Docker\resources\bin\docker.exe'

$TotalSteps = 6
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


# Traz os commits novos (só avança, nunca apaga) e lista o que entrou.
$LinuxUpdate = @'
#!/usr/bin/env bash
set -uo pipefail
cd "$HOME/"@@PROJECT@@ || { echo "  [X] projeto não encontrado"; exit 2; }
branch=@@BRANCH@@
before=$(git rev-parse HEAD 2>/dev/null || echo "")
echo "  Buscando os commits novos no GitHub..."
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
  if git stash push --quiet -m "radar-neon: guardado antes da atualização em $(date '+%d/%m/%Y %H:%M')"; then
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
  echo "  [X] não consegui aplicar os commits da branch $branch sem perder nada"
  exit 7
fi
after=$(git rev-parse HEAD)
if [ -n "$before" ] && [ "$before" = "$after" ]; then
  echo "  [OK] já estava em dia: nenhum commit novo"
else
  range="$after"
  if [ -n "$before" ]; then
    base=$(git merge-base "$before" "$after" 2>/dev/null || echo "")
    if [ -n "$base" ]; then range="$base..$after"; fi
  fi
  n=$(git rev-list --count "$range")
  echo "  [OK] $n commit(s) aplicado(s) (mais novo primeiro):"
  git log --format='      %h  %s' -n 25 "$range"
  if [ "$n" -gt 25 ]; then echo "      ... e mais $((n - 25)) mais antigos"; fi
fi
echo "  Versão agora: $(git log -1 --format='%h %s')"
if [ ! -f .env ]; then
  echo "  Criando o .env (senhas novas)..."
  make setup || exit 8
fi
'@

# Só diz se a chave de voz do Google está preenchida; o valor nunca é impresso.
$LinuxKeyStatus = @'
#!/usr/bin/env bash
cd "$HOME/"@@PROJECT@@ || exit 1
if [ ! -f .env ]; then echo SEM_ENV; exit 0; fi
v=$(grep -E "^GOOGLE_TTS_API_KEY=" .env | tail -1 | cut -d= -f2- | tr -d '\r[:space:]')
if [ -n "$v" ]; then echo "GOOGLE_TTS_API_KEY=definida"; else echo "GOOGLE_TTS_API_KEY=vazia"; fi
'@

$LinuxUp = @'
#!/usr/bin/env bash
set -uo pipefail
cd "$HOME/"@@PROJECT@@ || exit 1
echo "  Subindo o estúdio com a versão nova (reconstrói as imagens; pode levar uns 10 minutos)..."
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

# Clipe de teste com o roteiro de demonstração no tom novo; copia o vídeo para a Área de Trabalho.
$LinuxClip = @'
#!/usr/bin/env bash
set -uo pipefail
cd "$HOME/"@@PROJECT@@ || exit 1
desk=@@DESKDIR@@
name=@@VIDEO@@
voz=@@VOZ@@
COMPOSE="docker compose -f infra/docker-compose.yml --env-file .env"
echo "  Gerando o clipe (voz, bocas e render; uns 2 a 5 minutos)..."
if [ "$voz" = google ]; then out=$(make zeca VOZ=google 2>&1); else out=$(make zeca 2>&1); fi
echo "$out" | grep -E '^(Vídeo|Expressões|❌)' | sed 's/^/  /'
video=$(echo "$out" | grep -E '^\{"resumo"' | tail -1 | python3 -c 'import json,sys; print(json.load(sys.stdin).get("resumo",{}).get("video",""))' 2>/dev/null)
if [ -n "$video" ] && $COMPOSE cp "render:/data/work/$video" "$desk/$name" >/dev/null 2>&1; then
  echo "  [OK] vídeo na Área de Trabalho: $name"
  exit 0
fi
echo "  [!] o clipe não saiu (veja a mensagem acima)"
exit 1
'@

# =============================================================================
Clear-Host
Write-Host ''
Write-Host '  RADAR NEON — aplicar os commits novos' -ForegroundColor Magenta
Write-Host '  Zeca com personalidade de youtuber, 8 expressões e arte do artista em camadas.'
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

# ----------------------------------------------------------------- 3. Commits
Write-Step "Aplicando os commits novos (branch $Branch)"
$code = Invoke-LinuxScript -Name 'atualizar.sh' -Content $LinuxUpdate -Values @{ PROJECT = $ProjectRel; BRANCH = $Branch }
if ($code -ne 0) {
  Stop-Run 'Não consegui aplicar os commits (veja a mensagem acima). Se o GitHub pediu login e falhou, rode de novo.'
}

# ----------------------------------------------------------------- 4. Subir o estúdio
Write-Step 'Subindo o estúdio'
$upCode = Invoke-LinuxScript -Name 'subir.sh' -Content $LinuxUp -Values @{ PROJECT = $ProjectRel }
if ($upCode -ne 0) {
  Stop-Run 'O estúdio não subiu inteiro (veja acima). Rode este arquivo de novo; se repetir, mande o log para o Claude.'
}
Write-Ok 'estúdio no ar em http://localhost:3000'
$owners = Get-LinuxScriptOutput 'contar-dono.sh' $LinuxOwnerCount @{ PROJECT = $ProjectRel }
$ownerCount = 0
if ($owners.Count -gt 0) { [void][int]::TryParse([string]$owners[-1], [ref]$ownerCount) }
if ($ownerCount -eq 0) {
  Write-Attention 'Ainda não existe login do painel.'
  if (Read-YesNo 'Criar agora (e-mail, senha e 2FA com o app do celular)?' $true) {
    $null = Invoke-LinuxScript -Name 'dono.sh' -Content $LinuxOwner -Values @{ PROJECT = $ProjectRel }
  }
}

# ----------------------------------------------------------------- 5. Clipe de teste
Write-Step 'Clipe de teste do Zeca com o jeito novo (opcional)'
Write-Info 'Roteiro: "Bora, que tem novidade no radar! ... Isso é rumor, hein, calma lá. ... Faz sentido isso?"'
Write-Info 'Usa a arte em uso (a provisória, até você ativar a do artista) e as expressões novas.'
if (Read-YesNo 'Gerar o clipe agora?' $true) {
  $voz = 'padrao'
  $status = Get-LinuxScriptOutput 'status-chaves.sh' $LinuxKeyStatus @{ PROJECT = $ProjectRel }
  if ($status -contains 'GOOGLE_TTS_API_KEY=definida') {
    Write-Info 'Com a voz do Google (Chirp 3 HD), o clipe usa ~250 caracteres da cota grátis mensal (R$ 0,00).'
    if (Read-YesNo 'Usar a voz do Google? (Não = voz de teste, robótica)' $true) { $voz = 'google' }
  }
  $clipValues = @{ PROJECT = $ProjectRel; DESKDIR = (ConvertTo-WslPath $Desktop); VIDEO = $VideoName; VOZ = $voz }
  $clipCode = Invoke-LinuxScript -Name 'clipe.sh' -Content $LinuxClip -Values $clipValues
  $videoPath = Join-Path $Desktop $VideoName
  if ($clipCode -eq 0 -and (Test-Path -LiteralPath $videoPath)) {
    Write-Ok "Abrindo o vídeo: $videoPath"
    Start-Process -FilePath $videoPath
  } else {
    Write-Attention 'O clipe não saiu. O resto da atualização está ok; dá para gerar pelo painel (Personagem → Clipe de teste).'
  }
} else {
  Write-Info 'Pulado. Dá para gerar pelo painel: Personagem → Clipe de teste.'
}

# ----------------------------------------------------------------- 6. Painel
Write-Step 'Painel'
Start-Process 'http://localhost:3000/personagem'
Write-Ok 'Tela Personagem aberta: http://localhost:3000/personagem'
Write-Info 'Arte do artista: "Baixar modelo para o artista", envio das camadas com a prova de direitos,'
Write-Info '  prévia, clipe de teste com a versão nova e "Usar esta arte". Guia: docs/guia-arte-zeca.md'
Write-Info 'Bíblia do personagem: bordões, "Jeito de falar", "Nunca soe assim" e exemplos "ruim => bom".'
Write-Info 'Falta ainda o aceite da etapa final: rodar-etapa-final.bat (ele usa esta mesma versão).'
Write-Host ''
Write-Info "Log desta execução: $LogFile"
try { Stop-Transcript | Out-Null } catch { }
