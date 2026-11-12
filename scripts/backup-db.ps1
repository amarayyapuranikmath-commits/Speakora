<#
PostgreSQL backup for the Windows dev machine (production uses backup-db.sh). Custom-format dump, verified, with retention.
  powershell -ExecutionPolicy Bypass -File scripts\backup-db.ps1 [-Database english_speaking] [-OutDir backups] [-KeepDays 14]
Credentials: DB_PASSWORD from the git-ignored .env, or PGPASSWORD if already set. The password is passed by environment, never on a command line.
#>
param([string]$Database = 'english_speaking', [string]$OutDir = (Join-Path (Split-Path $PSScriptRoot -Parent) 'backups'), [int]$KeepDays = 14, [string]$PgBin = 'C:\Program Files\PostgreSQL\18\bin')
$ErrorActionPreference = 'Stop'
if (-not $env:PGPASSWORD) {
    $envFile = Join-Path (Split-Path $PSScriptRoot -Parent) '.env'
    $m = Select-String -Path $envFile -Pattern '^DB_PASSWORD=([^\r\n]*)$' | Select-Object -First 1
    if (-not $m) { throw 'No DB_PASSWORD in .env and PGPASSWORD is not set.' }
    $env:PGPASSWORD = $m.Matches[0].Groups[1].Value
}
try {
    New-Item -ItemType Directory -Force $OutDir | Out-Null
    $file = Join-Path $OutDir ("{0}-{1}.dump" -f $Database, (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ'))
    & "$PgBin\pg_dump.exe" -U esp_app -h localhost -w --format=custom --no-owner --no-privileges --file="$file.partial" $Database
    if ($LASTEXITCODE -ne 0) { throw "pg_dump failed with exit code $LASTEXITCODE" }
    # A dump that cannot be listed is not a backup: verify before keeping it.
    & "$PgBin\pg_restore.exe" --list "$file.partial" | Out-Null
    if ($LASTEXITCODE -ne 0) { Remove-Item "$file.partial" -Force; throw 'The dump failed verification and was discarded.' }
    Move-Item "$file.partial" $file
    Write-Host ("backup ok: {0} ({1:N0} bytes)" -f $file, (Get-Item $file).Length)
    Get-ChildItem $OutDir -Filter "$Database-*.dump" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) } | ForEach-Object { Write-Host "removing old backup $($_.Name)"; Remove-Item $_.FullName -Force }
    return $file
} finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }