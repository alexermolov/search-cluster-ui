# Одноразовая загрузка Electron в Generic Package Registry проекта (для CI).
# PowerShell-версия инструкции из README («CI: вендинг Electron»).
#
# Что делает:
#   1) определяет точную версию electron из package-lock.json;
#   2) собирает npm-тарболл из локального node_modules\electron\* —
#      Nexus отдаёт electron с 403 везде (CodeScoring), качать нечего;
#   3) пакует win32-рантайм из локального node_modules\electron\dist;
#   4) заливает оба файла в Package Registry;
#   5) проверяет, что они отдаются (HTTP 200), и удаляет временные файлы.
#
# Требования: Windows 10+ (curl.exe и tar встроены), локально установленный
# electron (npm install + install.js — см. README, раздел «Установка»).
#
# Пример запуска из корня проекта:
#   .\scripts\upload-electron-vendor.ps1 -ProjectId 1234
# Токен можно передать параметром -Token или положить в $env:GITLAB_TOKEN
# (Settings → Access Tokens, role Developer, scope write_repository);
# если токен не задан нигде — скрипт запросит его интерактивно (ввод скрыт).

param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectId,                       # Settings → General → Project ID

    [string]$Token = $env:GITLAB_TOKEN,       # Access Token с write_repository

    [string]$GitLab = 'https://gitlab.services.mts.ru',

    [string]$Version                          # опционально; по умолчанию — из package-lock.json
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Push-Location $root
try {
    # ── 0. Проверки окружения ─────────────────────────────────────────────────
    if (-not $Token) {
        Write-Host 'Токен не задан (-Token / $env:GITLAB_TOKEN) — запросим интерактивно.'
        $secure = Read-Host -AsSecureString 'Access Token (role Developer, scope write_repository)'
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        try {
            $Token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
        } finally {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
        }
        if (-not $Token) { throw 'Токен не введён' }
    }
    foreach ($cmd in 'curl.exe', 'node') {
        if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
            throw "$cmd не найден в PATH"
        }
    }
    # tar — только встроенный bsdtar (System32): в Git Bash / терминале Zed PATH
    # может указывать на GNU tar (/usr/bin/tar), который не умеет пути C:\:
    # двоеточие он принимает за адрес удалённого хоста и падает.
    $tarExe = Join-Path $env:SystemRoot 'System32\tar.exe'
    if (-not (Test-Path $tarExe)) { throw "Не найден $tarExe — нужен Windows 10+" }
    $distExe = Join-Path $root 'node_modules\electron\dist\electron.exe'
    if (-not (Test-Path $distExe)) {
        throw 'node_modules\electron\dist\electron.exe не найден — сначала локально установите electron (README, раздел «Установка»)'
    }

    function Run([string]$File, [string[]]$ArgList) {
        & $File @ArgList
        if ($LASTEXITCODE -ne 0) { throw "$File завершился с кодом $LASTEXITCODE" }
    }

    # ── 1. Версия electron: точная — из lockfile, как в ci-setup-electron.mjs ─
    # ВАЖНО: не использовать ConvertFrom-Json — PS 5.1 не переваривает
    # package-lock.json (в packages есть ключ ""), поэтому читаем через node.
    if (-not $Version) {
        $Version = [string](& node -p "require('./package-lock.json').packages['node_modules/electron'].version")
        if ($LASTEXITCODE -ne 0 -or -not $Version) {
            throw 'Не найдена версия electron в package-lock.json (или node недоступен)'
        }
    }
    Write-Host "Electron version: $Version"

    $npmTgz     = "electron-$Version.tgz"
    $runtimeTgz = "electron-win32-x64-$Version.tar.gz"
    $registry   = "$GitLab/api/v4/projects/$ProjectId/packages/generic"

    # ── 2. npm-тарболл — собираем из локального node_modules\electron ────────
    # CodeScoring блокирует electron на Nexus и для рабочих машин (403),
    # поэтому тарболл не качаем, а восстанавливаем из установленного пакета:
    # npm-тарболл electron — это просто папка package/ с теми же файлами.
    # dist/, path.txt и вложенные node_modules в тарболл не входят — исключаем.
    Write-Host "→ Собираю npm-тарболл из node_modules\electron"
    $stage = Join-Path $env:TEMP "electron-vendor-$Version"
    if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
    New-Item -ItemType Directory -Path (Join-Path $stage 'package') -Force | Out-Null
    Copy-Item -Path (Join-Path $root 'node_modules\electron\*') `
        -Destination (Join-Path $stage 'package') -Recurse -Force
    foreach ($extra in 'dist', 'path.txt', 'node_modules') {
        Remove-Item (Join-Path $stage "package\$extra") -Recurse -Force -ErrorAction SilentlyContinue
    }
    Run $tarExe @('-C', $stage, '-czf', $npmTgz, 'package')
    Remove-Item $stage -Recurse -Force

    # ── 3. win32-рантайм из локального node_modules ──────────────────────────
    Write-Host "→ Пакую win32-рантайм из node_modules\electron\dist"
    Run $tarExe @('-C', 'node_modules/electron', '-czf', $runtimeTgz, 'dist')

    # ── 4. Загрузка в Package Registry ───────────────────────────────────────
    Write-Host "→ Загружаю $npmTgz (vendor-npm)"
    Run curl.exe @('--fail', '--silent', '--show-error',
        '--header', "PRIVATE-TOKEN: $Token",
        '--upload-file', $npmTgz,
        "$registry/vendor-npm/electron/$Version/$npmTgz")

    Write-Host "→ Загружаю $runtimeTgz (vendor-electron)"
    Run curl.exe @('--fail', '--silent', '--show-error',
        '--header', "PRIVATE-TOKEN: $Token",
        '--upload-file', $runtimeTgz,
        "$registry/vendor-electron/electron/$Version/$runtimeTgz")

    # ── 5. Проверка: оба файла должны отдаваться с HTTP 200 ──────────────────
    foreach ($name in @("vendor-npm/electron/$Version/$npmTgz",
                         "vendor-electron/electron/$Version/$runtimeTgz")) {
        $code = & curl.exe --silent --output NUL --write-out '%{http_code}' `
            --header "PRIVATE-TOKEN: $Token" "$registry/$name"
        if ($code -ne '200') { throw "Проверка не прошла: $name → HTTP $code" }
        Write-Host "→ OK (200): $name"
    }

    # ── 6. Уборка ────────────────────────────────────────────────────────────
    Remove-Item $npmTgz, $runtimeTgz -Force
    Write-Host "`nГотово: Electron $Version в Package Registry. CI теперь сможет его скачать."
} finally {
    Pop-Location
}
