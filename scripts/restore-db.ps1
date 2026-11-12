<#
Restores a dump. DESTRUCTIVE: replaces the objects in the target database. Stop the backend first.
  powershell -ExecutionPolicy Bypass -File scripts\restore-db.ps1 -DumpFile backups\x.dump -TargetDatabase english_speaking_test -IUnderstandThisOverwritesData
#>
param([Parameter(Mandatory)][string]$DumpFile, [Parameter(Mandatory)][string]$TargetDatabase, [switch]$IUnderstandThisOverwritesData, [string]$PgBin = 'C:\Program Files\PostgreSQL\18\bin')
$ErrorActionPreference = 'Stop'
if (-not $IUnderstandThisOverwritesData) { throw 'Refusing: pass -IUnderstandThisOverwritesData to confirm that the target database will be overwritten.' }
if (-not (Test-Path $DumpFile)) { throw "No such file: $DumpFile" }
if (-not $env:PGPASSWORD) {
    $m = Select-String -Path (Join-Path (Split-Path $PSScriptRoot -Parent) '.env') -Pattern '^DB_PASSWORD=([^\r\n]*)$' | Select-Object -First 1
    $env:PGPASSWORD = $m.Matches[0].Groups[1].Value
}
try {
    & "$PgBin\pg_restore.exe" --list $DumpFile | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'The dump file is not a valid PostgreSQL archive.' }
    & "$PgBin\pg_restore.exe" -U esp_app -h localhost -w --clean --if-exists --no-owner --no-privileges --exit-on-error --dbname=$TargetDatabase $DumpFile
    if ($LASTEXITCODE -ne 0) { throw "pg_restore failed with exit code $LASTEXITCODE" }
    Write-Host "restore ok into $TargetDatabase"
} finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }