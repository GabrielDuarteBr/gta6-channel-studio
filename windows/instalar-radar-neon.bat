<# : Instalador do Radar Neon para Windows (arquivo hibrido: .bat + PowerShell)
@echo off
setlocal
title Instalador do Radar Neon
rem Copia para uma pasta local (funciona mesmo aberto de \\wsl.localhost ou de Downloads)
set "SRC=%~f0"
set "WORK=%TEMP%\radar-neon-instalador"
if /i not "%~dp0"=="%WORK%\" (
  if not exist "%WORK%" mkdir "%WORK%"
  copy /y "%SRC%" "%WORK%\instalar-radar-neon.bat" >nul
  set "SRC=%WORK%\instalar-radar-neon.bat"
)
rem Pede permissao de administrador (WSL e Docker Desktop precisam)
fltmc >nul 2>&1
if errorlevel 1 (
  echo Pedindo permissao de administrador...
  powershell -NoProfile -Command "Start-Process -FilePath '%SRC%' -Verb RunAs"
  exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$BatchPath='%SRC%'; $code=[IO.File]::ReadAllText($BatchPath,[Text.Encoding]::UTF8); Invoke-Expression $code"
echo.
pause
exit /b
#>

# =============================================================================
#  Radar Neon — instalador do ambiente no Windows 11
#  Automatiza o docs/notebook-setup.md: WSL 2, Ubuntu 24.04, .wslconfig,
#  Docker Desktop + integração com o Ubuntu, ferramentas, clone do projeto,
#  make setup / make up, login do painel e (opcional) o aceite da Fase 0.
#  Pode rodar quantas vezes quiser: cada passo confere antes de mudar algo.
# =============================================================================

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
$env:WSL_UTF8 = '1'

$RepoUrl = 'https://github.com/GabrielDuarteBr/gta6-channel-studio.git'
$Branch = 'fase-0-fundacao'
$PreferredDistro = 'Ubuntu-24.04'
$ProjectRel = 'projetos/gta6-channel-studio'

# Pasta de trabalho em LOCALAPPDATA (caminho longo; o WSL enxerga em /mnt/c/...).
$Work = Join-Path $env:LOCALAPPDATA 'radar-neon-instalador'
New-Item -ItemType Directory -Force -Path $Work | Out-Null
$LogFile = Join-Path $env:USERPROFILE 'radar-neon-instalador.log'
try { Start-Transcript -Path $LogFile -Append | Out-Null } catch { }

# Caminhos reais são descobertos no passo 6 (Find-DockerDesktop); estes são só o padrão.
$DockerDesktopExe = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
$DockerCli = Join-Path $env:ProgramFiles 'Docker\Docker\resources\bin\docker.exe'
$DockerSettingsFiles = @(
  (Join-Path $env:APPDATA 'Docker\settings-store.json'),
  (Join-Path $env:APPDATA 'Docker\settings.json')
)
$Utf8NoBom = New-Object System.Text.UTF8Encoding $false

$TotalSteps = 12
$script:StepNo = 0
$script:Distro = $null
$script:LinuxUser = $null

# ----------------------------------------------------------------- utilitários
function Write-Step([string]$Title) {
  $script:StepNo++
  Write-Host ''
  Write-Host ('[{0}/{1}] {2}' -f $script:StepNo, $TotalSteps, $Title) -ForegroundColor Magenta
}
function Write-Ok([string]$Message) { Write-Host "  [OK] $Message" -ForegroundColor Green }
function Write-Info([string]$Message) { Write-Host "  $Message" -ForegroundColor Gray }
function Write-Attention([string]$Message) { Write-Host "  [!] $Message" -ForegroundColor Yellow }
function Stop-Install([string]$Message) {
  Write-Host ''
  Write-Host "  [X] $Message" -ForegroundColor Red
  Write-Host ''
  Write-Host '  Quando resolver, rode o instalador de novo: ele continua de onde parou.'
  Write-Host "  Log completo (mande para o Claude se precisar de ajuda): $LogFile"
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
function Get-DistroVersion([string]$Name) {
  foreach ($line in (Remove-Nul (& wsl.exe --list --verbose 2>$null))) {
    $parts = ($line -replace '^\*', '').Trim() -split '\s+'
    if ($parts.Count -ge 3 -and $parts[0] -eq $Name) { return $parts[-1] }
  }
  return $null
}
# Grava um script bash (LF, sem BOM), trocando @@NOME@@ pelos valores, e devolve o caminho no WSL.
function Save-LinuxScript([string]$Name, [string]$Content, [hashtable]$Values) {
  foreach ($key in $Values.Keys) { $Content = $Content.Replace("@@$key@@", (ConvertTo-BashLiteral ([string]$Values[$key]))) }
  $file = Join-Path $Work $Name
  [IO.File]::WriteAllText($file, ($Content -replace "`r`n", "`n"), $Utf8NoBom)
  return (ConvertTo-WslPath $file)
}
# Roda um script no Ubuntu usando o próprio terminal (permite perguntas, senhas e QR code).
function Invoke-LinuxScript {
  param([string]$Name, [string]$Content, [switch]$AsRoot, [hashtable]$Values = @{})
  $wslPath = Save-LinuxScript $Name $Content $Values
  $argList = @('-d', $script:Distro)
  if ($AsRoot) { $argList += @('-u', 'root') }
  $argList += @('--exec', 'bash', $wslPath)
  $line = ($argList | ForEach-Object { ConvertTo-CommandLineArg $_ }) -join ' '
  $proc = Start-Process -FilePath 'wsl.exe' -ArgumentList $line -NoNewWindow -PassThru
  $null = $proc.Handle
  $proc.WaitForExit()
  return [int]$proc.ExitCode
}
# Roda um script no Ubuntu e devolve a saída (para checagens sem interação).
function Get-LinuxScriptOutput([string]$Name, [string]$Content, [hashtable]$Values) {
  $wslPath = Save-LinuxScript $Name $Content $Values
  return Remove-Nul (& wsl.exe -d $script:Distro --exec bash $wslPath 2>$null)
}
# Pastas onde o Docker Desktop pode estar: processo aberto, registro de programas
# instalados (máquina e usuário), pastas conhecidas e docker.exe no PATH.
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
  $exes = @(Get-DockerDesktopCandidates | ForEach-Object { Join-Path $_ 'Docker Desktop.exe' })
  # Último recurso: procura o executável nas pastas de programas (até 3 níveis).
  foreach ($root in @($env:ProgramFiles, (Join-Path $env:LOCALAPPDATA 'Programs'))) {
    if ($root -and (Test-Path -LiteralPath $root)) {
      $exes += @(Get-ChildItem -LiteralPath $root -Filter 'Docker Desktop.exe' -Recurse -Depth 3 -ErrorAction SilentlyContinue |
        ForEach-Object { $_.FullName })
    }
  }
  foreach ($exe in $exes) {
    if ($exe -and (Test-Path -LiteralPath $exe)) {
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
function Write-DockerDiagnostics {
  Write-Info 'Diagnóstico (vai para o log):'
  foreach ($dir in (Get-DockerDesktopCandidates | Select-Object -Unique)) {
    $mark = if (Test-Path -LiteralPath $dir) { 'existe' } else { 'não existe' }
    Write-Info "    $dir  ($mark)"
  }
  $where = & where.exe docker 2>$null
  if ($where) { $where | ForEach-Object { Write-Info "    docker no PATH: $_" } }
}
function Test-DockerEngine {
  if (-not (Test-Path $DockerCli)) { return $false }
  # SilentlyContinue: o "motor ainda desligado" é esperado aqui e não deve sujar o log.
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'SilentlyContinue'
  $null = & $DockerCli info --format '{{.ServerVersion}}' 2>$null
  $ok = ($LASTEXITCODE -eq 0)
  $ErrorActionPreference = $previous
  return $ok
}
function Stop-DockerDesktop {
  if (Test-Path $DockerCli) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'SilentlyContinue'
    $null = & $DockerCli desktop stop 2>$null
    $ErrorActionPreference = $previous
  }
  Start-Sleep -Seconds 3
  Get-Process -Name 'Docker Desktop', 'com.docker.backend', 'com.docker.build' -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
}
function Start-DockerDesktop {
  # Pelo Explorer, o Docker Desktop abre como usuário comum (não como administrador).
  Start-Process -FilePath 'explorer.exe' -ArgumentList ('"{0}"' -f $DockerDesktopExe)
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
$LinuxTools = @'
#!/usr/bin/env bash
set -euo pipefail
user=@@USER@@
export DEBIAN_FRONTEND=noninteractive
echo "  Atualizando a lista de pacotes do Ubuntu (pode levar um minuto)..."
# Espera até 3 min se o Ubuntu estiver atualizando sozinho (apt ocupado).
apt-get -o DPkg::Lock::Timeout=180 update -qq
apt-get -o DPkg::Lock::Timeout=180 install -y -qq git make curl openssl ca-certificates python3 >/dev/null
echo "  [OK] git, make, curl, openssl e python3 instalados"
if getent group docker >/dev/null && ! id -nG "$user" | tr ' ' '\n' | grep -qx docker; then
  usermod -aG docker "$user"
  echo "  [OK] usuário $user adicionado ao grupo docker"
fi
'@

$LinuxCreateUser = @'
#!/usr/bin/env bash
set -euo pipefail
user=@@USER@@
if ! id "$user" >/dev/null 2>&1; then
  useradd -m -s /bin/bash -G sudo "$user"
fi
if grep -q '^\[user\]' /etc/wsl.conf 2>/dev/null; then
  sed -i "/^\[user\]/,/^\[/ s/^default=.*/default=$user/" /etc/wsl.conf
  grep -q "^default=$user" /etc/wsl.conf || sed -i "/^\[user\]/a default=$user" /etc/wsl.conf
else
  printf '\n[user]\ndefault=%s\n' "$user" >> /etc/wsl.conf
fi
echo "  [OK] usuário $user criado e definido como padrão"
'@

$DockerSettingsEditor = @'
import json, os, shutil, sys, time

check_only = sys.argv[1] == "--check"  # só confere: sai com 10 se algo precisa mudar
distro = sys.argv[2]
paths = sys.argv[3:]
WANT = {"WslEngineEnabled": True, "EnableIntegrationWithDefaultWslDistro": True, "AutoStart": True}
needs_change = False

for path in paths:
    if not os.path.exists(path):
        continue
    name = os.path.basename(path)
    with open(path, encoding="utf-8-sig") as f:  # tolera BOM ao ler
        data = json.load(f)
    pascal = name == "settings-store.json"

    def key_for(wanted):
        for k in data:
            if k.lower() == wanted.lower():
                return k
        return wanted if pascal else wanted[0].lower() + wanted[1:]

    before = json.dumps(data, sort_keys=True)
    for wanted, value in WANT.items():
        data[key_for(wanted)] = value
    k = key_for("IntegratedWslDistros")
    distros = data.get(k) if isinstance(data.get(k), list) else []
    if distro not in distros:
        distros.append(distro)
    data[k] = distros

    if json.dumps(data, sort_keys=True) == before:
        print(f"  [OK] {name}: integração com {distro} já está ativada")
        continue
    needs_change = True
    if check_only:
        continue
    backup = f"{path}.bak-radar-neon-{time.strftime('%Y%m%d-%H%M%S')}"
    shutil.copy2(path, backup)
    with open(path, "w", encoding="utf-8", newline="\n") as f:  # sem BOM
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"  [OK] {name}: integração com {distro} ativada (backup: {os.path.basename(backup)})")

sys.exit(10 if (check_only and needs_change) else 0)
'@

$LinuxDockerCheck = @'
#!/usr/bin/env bash
p=$(command -v docker || true)
if [ -z "$p" ]; then echo "  docker: não encontrado dentro do Ubuntu"; exit 2; fi
real=$(readlink -f "$p")
echo "  docker CLI: $real"
if out=$(docker version --format '{{.Server.Version}}' 2>&1); then
  echo "  [OK] Docker Engine $out respondendo dentro do Ubuntu"
  exit 0
fi
echo "  Erro: $(echo "$out" | grep -m1 -iE 'error|denied|cannot|connect|found' || echo "$out" | head -1)"
case "$out" in
  *"ermission denied"*) exit 3 ;;
  *"could not be found in this WSL"*|*"WSL integration"*) exit 4 ;;  # integração desligada
esac
# Só é "Docker do apt" se o binário pertencer a um pacote instalado no Ubuntu.
if dpkg -S "$real" >/dev/null 2>&1; then exit 5; fi
exit 4
'@

$LinuxAddDockerGroup = @'
#!/usr/bin/env bash
user=@@USER@@
getent group docker >/dev/null || groupadd docker
usermod -aG docker "$user" && echo "  [OK] $user agora está no grupo docker"
'@

$LinuxRemoveAptDocker = @'
#!/usr/bin/env bash
set -uo pipefail
export DEBIAN_FRONTEND=noninteractive
pkgs=""
for p in docker.io docker-ce docker-ce-cli docker-compose-plugin docker-buildx-plugin containerd.io podman-docker docker-compose; do
  dpkg -s "$p" >/dev/null 2>&1 && pkgs="$pkgs $p"
done
if [ -n "$pkgs" ]; then
  systemctl stop docker docker.socket 2>/dev/null || true
  apt-get -o DPkg::Lock::Timeout=180 remove -y -qq $pkgs >/dev/null && echo "  [OK] removido do Ubuntu:$pkgs (os dados não foram apagados)"
else
  echo "  Nenhum pacote docker do apt encontrado."
fi
'@

$LinuxProjectExists = @'
#!/usr/bin/env bash
if [ -d "$HOME/"@@PROJECT@@"/.git" ]; then echo sim; else echo nao; fi
'@

$LinuxProject = @'
#!/usr/bin/env bash
set -euo pipefail
repo=@@REPO@@
branch=@@BRANCH@@
dir="$HOME/"@@PROJECT@@
gcm=@@GCM@@
git config --global core.autocrlf input
if [ -n "$gcm" ] && [ -z "$(git config --global credential.helper || true)" ]; then
  git config --global credential.helper "$gcm"
  echo "  [OK] login do GitHub pelo navegador (Git Credential Manager do Windows)"
fi
mkdir -p "$(dirname "$dir")"
if [ -d "$dir/.git" ]; then
  cd "$dir"
  echo "  O projeto já existe em $dir — atualizando..."
  git fetch --quiet origin || echo "  [!] não consegui falar com o GitHub agora; sigo com a versão local"
  if git diff --quiet && git diff --cached --quiet; then
    git pull --ff-only --quiet || echo "  [!] não deu para atualizar automaticamente; sigo com a versão local"
  else
    echo "  [!] há alterações locais no projeto; não vou atualizar para não perder nada"
  fi
else
  echo "  Baixando o projeto do GitHub..."
  git clone --branch "$branch" "$repo" "$dir"
fi
cd "$dir"
echo "  [OK] projeto em $dir (branch $(git rev-parse --abbrev-ref HEAD))"
'@

$LinuxStack = @'
#!/usr/bin/env bash
set -uo pipefail
cd "$HOME/"@@PROJECT@@ || exit 1
bash scripts/wsl-check.sh || true
echo
make setup || exit 1
echo
echo "  Subindo o estúdio. Na primeira vez ele constrói as imagens: 10 a 30 minutos."
if ! make up; then
  dest=@@DEST@@
  [ -f diagnostico.txt ] && cp diagnostico.txt "$dest" 2>/dev/null && echo "  Diagnóstico salvo em: $dest"
  exit 1
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

$LinuxAccept = @'
#!/usr/bin/env bash
set -o pipefail
cd "$HOME/"@@PROJECT@@ || exit 1
dest=@@DEST@@
make accept-0 2>&1 | tee accept-0.log
code=${PIPESTATUS[0]}
cp accept-0.log "$dest" 2>/dev/null || echo "  [!] não consegui copiar o resultado para $dest"
exit "$code"
'@

# =============================================================================
Clear-Host
Write-Host ''
Write-Host '  RADAR NEON — instalador do estúdio no Windows' -ForegroundColor Magenta
Write-Host '  Prepara WSL 2 + Ubuntu + Docker Desktop e sobe o painel em http://localhost:3000'
Write-Host "  Log: $LogFile"

# ----------------------------------------------------------------- 1. Windows
Write-Step 'Conferindo o Windows'
$os = Get-CimInstance Win32_OperatingSystem
$build = [int]$os.BuildNumber
Write-Info ('{0} (build {1})' -f $os.Caption, $build)
if ($build -lt 19041) { Stop-Install 'O WSL 2 precisa do Windows 10 2004 (build 19041) ou mais novo. Atualize o Windows.' }
$cs = Get-CimInstance Win32_ComputerSystem
$me = [Security.Principal.WindowsIdentity]::GetCurrent().Name
if ($cs.UserName -and ($cs.UserName -ne $me)) {
  Stop-Install ("O instalador está rodando como '$me', mas quem está usando o Windows é '$($cs.UserName)'. " +
    'O WSL e o Docker são por usuário: entre numa conta que seja administradora e rode de novo.')
}
$ramGB = [math]::Round($cs.TotalPhysicalMemory / 1GB)
$cpus = [int]$cs.NumberOfLogicalProcessors
Write-Ok "RAM: $ramGB GB · processadores lógicos: $cpus"

# ----------------------------------------------------------------- 2. WSL
Write-Step 'WSL 2'
$null = & wsl.exe --status 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Info 'Instalando o WSL (componentes do Windows)...'
  & wsl.exe --install --no-distribution
  Write-Attention 'O WSL foi instalado. REINICIE o Windows e rode este instalador de novo.'
  Write-Info 'Se aparecer erro de virtualização: ligue o notebook, aperte F2 na tela da Acer e ative'
  Write-Info '"Intel Virtualization Technology" (VT-x) na BIOS.'
  Stop-Install 'Reinicialização necessária.'
}
Write-Info 'Atualizando o WSL...'
& wsl.exe --update 2>$null | Out-Null
& wsl.exe --set-default-version 2 2>$null | Out-Null
Write-Ok 'WSL 2 pronto'

# ----------------------------------------------------------------- 3. Ubuntu
Write-Step 'Ubuntu 24.04'
$distros = Get-Distros
if ($distros -contains $PreferredDistro) {
  $script:Distro = $PreferredDistro
} else {
  $script:Distro = $distros | Where-Object { $_ -like 'Ubuntu*' } | Select-Object -First 1
}
if (-not $script:Distro) {
  Write-Info 'Instalando o Ubuntu 24.04. Quando ele pedir, crie um USUÁRIO e uma SENHA do Linux'
  Write-Info '(anote a senha: o sudo vai pedir). Se ele abrir o terminal do Ubuntu, digite: exit'
  & wsl.exe --install -d $PreferredDistro
  if ((Get-Distros) -contains $PreferredDistro) { $script:Distro = $PreferredDistro }
  else { Stop-Install 'O Ubuntu não terminou de instalar. Reinicie o Windows e rode o instalador de novo.' }
}
Write-Ok "distro: $($script:Distro)"
if ((Get-DistroVersion $script:Distro) -eq '1') {
  Write-Info 'Convertendo para WSL 2 (alguns minutos)...'
  & wsl.exe --set-version $script:Distro 2
}
& wsl.exe --set-default $script:Distro | Out-Null
Write-Ok "$($script:Distro) é a distro padrão do WSL (versão $(Get-DistroVersion $script:Distro))"

$ErrorActionPreference = 'SilentlyContinue'
$script:LinuxUser = Remove-Nul (& wsl.exe -d $script:Distro --exec id -un 2>$null) | Select-Object -First 1
$ErrorActionPreference = 'Continue'
if (-not $script:LinuxUser -or $script:LinuxUser -eq 'root') {
  Write-Attention 'O Ubuntu está sem usuário comum. Vamos criar um.'
  $suggest = ($env:USERNAME.ToLower() -replace '[^a-z0-9_-]', '')
  if ($suggest -notmatch '^[a-z]') { $suggest = 'dono' }
  $name = Read-Host "  Nome do usuário Linux (Enter = $suggest)"
  if ([string]::IsNullOrWhiteSpace($name)) { $name = $suggest }
  $name = $name.Trim().ToLower()
  if ($name -notmatch '^[a-z][a-z0-9_-]{0,30}$') { Stop-Install 'Nome inválido: use letras minúsculas, números, - ou _.' }
  if ((Invoke-LinuxScript -Name 'criar-usuario.sh' -Content $LinuxCreateUser -AsRoot -Values @{ USER = $name }) -ne 0) {
    Stop-Install 'Não consegui criar o usuário no Ubuntu.'
  }
  Write-Info "Agora defina a senha do usuário $name (digite duas vezes; nada aparece enquanto digita):"
  & wsl.exe -d $script:Distro -u root --exec passwd $name
  & wsl.exe --terminate $script:Distro | Out-Null
  $script:LinuxUser = $name
}
Write-Ok "usuário Linux: $($script:LinuxUser)"

# ----------------------------------------------------------------- 4. Ferramentas no Ubuntu
Write-Step 'Ferramentas no Ubuntu (git, make, curl, openssl)'
if ((Invoke-LinuxScript -Name 'ferramentas.sh' -Content $LinuxTools -AsRoot -Values @{ USER = $script:LinuxUser }) -ne 0) {
  Stop-Install 'Falhou ao instalar pacotes no Ubuntu. Confira a internet e rode de novo.'
}

# ----------------------------------------------------------------- 5. .wslconfig
Write-Step 'Memória e processadores do WSL (.wslconfig)'
if ($ramGB -ge 16) { $memGB = $ramGB - 6 } else { $memGB = [math]::Max(4, [math]::Floor($ramGB * 0.6)) }
if ($cpus -ge 12) { $procs = $cpus - 4 } else { $procs = [math]::Max(2, $cpus - 2) }
$wslConfigPath = Join-Path $env:USERPROFILE '.wslconfig'
$desired = "[wsl2]`r`nmemory=${memGB}GB`r`nprocessors=$procs`r`nswap=8GB`r`n"
$needShutdown = $false
$writeConfig = $true
if (Test-Path $wslConfigPath) {
  $current = [IO.File]::ReadAllText($wslConfigPath)
  Write-Info 'Seu .wslconfig atual:'
  ($current -split "`r?`n") | Where-Object { $_ -ne '' } | ForEach-Object { Write-Info "    $_" }
  $hasLimits = ($current -match '(?m)^\s*memory\s*=') -and ($current -match '(?m)^\s*processors\s*=')
  if (($current -replace '\s', '') -eq ($desired -replace '\s', '')) {
    $writeConfig = $false   # já está com o recomendado: não mexe (e não reinicia o WSL)
  } else {
    $writeConfig = Read-YesNo "Trocar pelo recomendado (memory=${memGB}GB, processors=$procs, swap=8GB)?" (-not $hasLimits)
  }
}
if ($writeConfig) {
  if (Test-Path $wslConfigPath) { Copy-Item $wslConfigPath "$wslConfigPath.bak-radar-neon-$(Get-Date -Format yyyyMMdd-HHmmss)" }
  [IO.File]::WriteAllText($wslConfigPath, $desired, $Utf8NoBom)
  $needShutdown = $true
  Write-Ok "memory=${memGB}GB, processors=$procs, swap=8GB gravado em $wslConfigPath"
} else {
  Write-Ok 'mantido o .wslconfig atual'
}

# ----------------------------------------------------------------- 6. Docker Desktop
Write-Step 'Docker Desktop'
if (-not (Find-DockerDesktop)) {
  Write-Info 'Não encontrei o Docker Desktop. Ele é gratuito para uso pessoal.'
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Start-Process 'https://www.docker.com/products/docker-desktop/'
    Stop-Install 'Instale o Docker Desktop pelo site que abri (marque "Use WSL 2") e rode o instalador de novo.'
  }
  if (-not (Read-YesNo 'Instalar o Docker Desktop agora pelo winget (~600 MB)?' $true)) {
    Stop-Install 'O Docker Desktop é necessário.'
  }
  & winget install -e --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements
  if (-not (Find-DockerDesktop)) {
    Write-DockerDiagnostics
    Stop-Install ('O winget diz que o Docker Desktop está instalado, mas não achei o programa. Abra o Docker Desktop ' +
      'pelo menu Iniciar (deixe aberto) e rode o instalador de novo; se continuar, mande o log para o Claude.')
  }
  Write-Attention 'Se o instalador do Docker pediu para sair da conta ou reiniciar, faça isso e rode este instalador de novo.'
}
Write-Ok "Docker Desktop: $DockerDesktopExe"

# ----------------------------------------------------------------- 7. Integração Docker <-> Ubuntu
Write-Step "Ligando o Docker Desktop ao $($script:Distro)"
if (-not ($DockerSettingsFiles | Where-Object { Test-Path $_ })) {
  Write-Info 'Abrindo o Docker Desktop pela primeira vez para ele criar as configurações...'
  Write-Info 'Se aparecer uma janela pedindo para aceitar os termos, aceite (pode pular o login).'
  Start-DockerDesktop
  $deadline = (Get-Date).AddMinutes(5)
  while (-not ($DockerSettingsFiles | Where-Object { Test-Path $_ }) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 5 }
  Start-Sleep -Seconds 10
}
$editorPath = Join-Path $Work 'docker-settings.py'
[IO.File]::WriteAllText($editorPath, ($DockerSettingsEditor -replace "`r`n", "`n"), $Utf8NoBom)
$settingsArgs = @()
foreach ($f in $DockerSettingsFiles) { if (Test-Path $f) { $settingsArgs += (ConvertTo-WslPath $f) } }
$editorBase = @('-d', $script:Distro, '--exec', 'python3', (ConvertTo-WslPath $editorPath))
& wsl.exe @($editorBase + @('--check', $script:Distro) + $settingsArgs)
$settingsNeedChange = ($LASTEXITCODE -eq 10)
if ($settingsNeedChange -or $needShutdown) {
  Write-Info 'Fechando o Docker Desktop para ajustar a configuração...'
  Stop-DockerDesktop
  if ($needShutdown) {
    Write-Info 'Reiniciando o WSL para aplicar o .wslconfig...'
    & wsl.exe --shutdown
    Start-Sleep -Seconds 5
  }
  if ($settingsNeedChange) {
    & wsl.exe @($editorBase + @('--apply', $script:Distro) + $settingsArgs)
    if ($LASTEXITCODE -ne 0) { Write-Attention 'Não consegui editar a configuração do Docker; vou tentar seguir assim mesmo.' }
  }
}
if (-not (Test-DockerEngine)) {
  Write-Info 'Abrindo o Docker Desktop e esperando o motor ligar (até 5 minutos)...'
  Start-DockerDesktop
}
if (-not (Wait-DockerEngine 300)) {
  Stop-Install 'O Docker Desktop não ficou pronto. Abra-o, aceite os termos se pedir, espere "Engine running" e rode o instalador de novo.'
}
Write-Ok 'Docker Engine ligado'

# ----------------------------------------------------------------- 8. Docker dentro do Ubuntu
Write-Step 'Testando o Docker dentro do Ubuntu'
$dockerOk = $false
$autoWaits = 0
$manualTries = 0
$aptRemoved = $false
$groupFixed = $false
while (-not $dockerOk) {
  $code = Invoke-LinuxScript -Name 'docker-check.sh' -Content $LinuxDockerCheck
  if ($code -eq 0) { $dockerOk = $true; break }

  if (($code -eq 3) -and (-not $groupFixed)) {
    $groupFixed = $true
    Write-Info 'Dando ao seu usuário acesso ao Docker...'
    $null = Invoke-LinuxScript -Name 'grupo-docker.sh' -Content $LinuxAddDockerGroup -AsRoot -Values @{ USER = $script:LinuxUser }
    & wsl.exe --terminate $script:Distro | Out-Null
    continue
  }

  if (($code -eq 5) -and (-not $aptRemoved)) {
    $aptRemoved = $true
    Write-Attention 'Existe um Docker instalado DENTRO do Ubuntu (pelo apt). Ele briga com o Docker Desktop.'
    if (-not (Read-YesNo 'Remover esse Docker do Ubuntu e usar o do Docker Desktop? (seus arquivos não são apagados)' $true)) {
      Stop-Install 'Sem remover o Docker do apt, a integração com o Docker Desktop não funciona.'
    }
    $null = Invoke-LinuxScript -Name 'remover-docker-apt.sh' -Content $LinuxRemoveAptDocker -AsRoot
    & wsl.exe --terminate $script:Distro | Out-Null
    continue
  }

  # Integração ainda não ativa: às vezes leva um pouco para o Docker Desktop instalá-la no Ubuntu.
  if ($autoWaits -lt 3) {
    $autoWaits++
    Write-Info "A integração pode levar até um minuto para chegar ao Ubuntu. Aguardando ($autoWaits/3)..."
    & wsl.exe --terminate $script:Distro | Out-Null
    Start-Sleep -Seconds 20
    continue
  }

  # Não pegou sozinho: guia para ligar pela tela do Docker Desktop (2 cliques).
  $manualTries++
  if ($manualTries -gt 3) { break }
  Write-Host ''
  Write-Attention 'Falta ligar a integração na tela do Docker Desktop (vou abrir para você):'
  Write-Info '  1. MAXIMIZE a janela do Docker Desktop (com ela estreita, a opção some).'
  Write-Info '  2. Clique na engrenagem (Settings, no alto à direita) e depois em "Resources".'
  Write-Info '  3. Na coluna da DIREITA da página, clique em "WSL integration".'
  Write-Info "  4. Ligue 'Enable integration with my default WSL distro' e a chave '$($script:Distro)'."
  Write-Info '  5. Clique em "Apply & restart" e espere "Engine running" no canto inferior esquerdo.'
  Start-DockerDesktop
  $null = Read-Host '  Quando terminar, aperte Enter aqui para eu testar de novo'
  & wsl.exe --terminate $script:Distro | Out-Null
  $null = Wait-DockerEngine 180
  Start-Sleep -Seconds 10
}
if (-not $dockerOk) {
  Stop-Install ('O Docker ainda não responde dentro do Ubuntu. Mande para o Claude um print da tela ' +
    'Docker Desktop > Settings > Resources > WSL integration (janela maximizada) e o log.')
}

# ----------------------------------------------------------------- 9. Projeto
Write-Step 'Projeto Radar Neon (GitHub)'
$gcmWin = Join-Path $env:ProgramFiles 'Git\mingw64\bin\git-credential-manager.exe'
$gcmWsl = ''
if (Test-Path $gcmWin) { $gcmWsl = (ConvertTo-WslPath $gcmWin).Replace(' ', '\ ') }
$exists = Get-LinuxScriptOutput 'projeto-existe.sh' $LinuxProjectExists @{ PROJECT = $ProjectRel }
if (($exists -notcontains 'sim') -and (-not $gcmWsl)) {
  Write-Attention 'O repositório é privado: o GitHub vai pedir login aqui no terminal.'
  Write-Info 'Username: seu usuário do GitHub (GabrielDuarteBr)'
  Write-Info 'Password: NÃO é a senha. Use um token: GitHub > Settings > Developer settings >'
  Write-Info 'Personal access tokens > Fine-grained, com leitura do repositório gta6-channel-studio.'
  Write-Info '(Nada aparece enquanto você cola o token; é normal.)'
}
$projectValues = @{ REPO = $RepoUrl; BRANCH = $Branch; PROJECT = $ProjectRel; GCM = $gcmWsl }
if ((Invoke-LinuxScript -Name 'projeto.sh' -Content $LinuxProject -Values $projectValues) -ne 0) {
  Stop-Install 'Não consegui baixar o projeto do GitHub (login ou internet). Rode de novo para tentar outra vez.'
}

# ----------------------------------------------------------------- 10. Subir o estúdio
Write-Step 'Subindo o estúdio (make setup + make up)'
$diagCopy = Join-Path ([Environment]::GetFolderPath('Desktop')) 'radar-neon-diagnostico.txt'
if ((Invoke-LinuxScript -Name 'subir.sh' -Content $LinuxStack -Values @{ PROJECT = $ProjectRel; DEST = (ConvertTo-WslPath $diagCopy) }) -ne 0) {
  Stop-Install ("O `"make up`" falhou. Mande para o Claude o arquivo da sua Área de Trabalho: $diagCopy " +
    '(se ele não existir, mande um print desta janela rolando um pouco para cima).')
}
Write-Ok 'estúdio no ar'

# ----------------------------------------------------------------- 11. Login do painel
Write-Step 'Seu login do painel (e-mail, senha e 2FA)'
$owners = Get-LinuxScriptOutput 'contar-dono.sh' $LinuxOwnerCount @{ PROJECT = $ProjectRel }
$ownerCount = 0
if ($owners.Count -gt 0) { [void][int]::TryParse([string]$owners[-1], [ref]$ownerCount) }
$createOwner = $true
if ($ownerCount -gt 0) {
  Write-Ok 'o login do painel já existe'
  $createOwner = Read-YesNo 'Recriar o login (novo QR do 2FA; derruba as sessões abertas)?' $false
} else {
  Write-Info 'Tenha o app autenticador do celular à mão (Google Authenticator, Microsoft Authenticator, Authy...).'
}
if ($createOwner) {
  if ((Invoke-LinuxScript -Name 'dono.sh' -Content $LinuxOwner -Values @{ PROJECT = $ProjectRel }) -ne 0) {
    Stop-Install 'Não consegui criar o login. Rode de novo ou, no Ubuntu: cd ~/projetos/gta6-channel-studio && make owner'
  }
}

# ----------------------------------------------------------------- 12. Final
Write-Step 'Pronto!'
Start-Process 'http://localhost:3000'
Write-Ok 'Painel aberto no navegador: http://localhost:3000'
Write-Info 'Comandos do dia a dia (no Ubuntu, dentro de ~/projetos/gta6-channel-studio):'
Write-Info '  make ps · make logs s=web · make down · make up'
Write-Host ''
if (Read-YesNo 'Rodar agora o aceite da Fase 0 (testes completos, 20 a 40 minutos)?' $true) {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $acceptCopy = Join-Path $desktop 'radar-neon-aceite-fase-0.txt'
  $code = Invoke-LinuxScript -Name 'aceite.sh' -Content $LinuxAccept -Values @{ PROJECT = $ProjectRel; DEST = (ConvertTo-WslPath $acceptCopy) }
  Write-Host ''
  if ($code -eq 0) { Write-Ok 'aceite da Fase 0 passou!' } else { Write-Attention 'algum critério do aceite falhou (veja acima).' }
  Write-Info "Resultado salvo em: $acceptCopy  -> mande esse arquivo para o Claude."
}
Write-Host ''
Write-Info "Log da instalação: $LogFile"
try { Stop-Transcript | Out-Null } catch { }
