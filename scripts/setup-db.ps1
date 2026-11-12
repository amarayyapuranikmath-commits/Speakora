<#
Creates the local development role `esp_app` and the databases `english_speaking` and `english_speaking_test`,
verifies the role can use both, and records a generated password in the git-ignored .env.

Run it in YOUR OWN terminal (it prompts for the postgres superuser password):
  powershell -ExecutionPolicy Bypass -File scripts\setup-db.ps1
Non-interactive alternative: set $env:ESP_PG_ADMIN_PASSWORD first (it is cleared at the end).

How secrets are handled
 - Passwords never appear in SQL text or on any command line. They travel in environment variables; the SQL file reads the
   application password with psql's \getenv and quotes it server-side with format('%L').
 - psql output is captured and every secret is redacted before anything is printed.
 - Nothing is changed unless superuser authentication succeeds first, and success is printed only after the application role
   has actually connected to both databases and created/dropped a table in each.
 - An existing .env is never replaced: DB_PASSWORD is kept only if it genuinely authenticates as esp_app, otherwise a fresh
   password is generated; JWT_SECRET is kept unless it is still a placeholder. pg_hba.conf is never touched.
#>
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $root '.env'
$appRole = 'esp_app'
$databases = @('english_speaking', 'english_speaking_test')
$secrets = New-Object System.Collections.Generic.List[string]
$tempSql = $null

$psql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
if (-not (Test-Path $psql)) { $cmd = Get-Command psql.exe -ErrorAction SilentlyContinue; if ($cmd) { $psql = $cmd.Source } }

function Clear-Secrets {
    foreach ($n in 'PGPASSWORD', 'ESP_APP_PW', 'ESP_PG_ADMIN_PASSWORD') { Remove-Item "Env:$n" -ErrorAction SilentlyContinue }
}
function Hide([string]$text) {
    foreach ($s in $secrets) { if ($s) { $text = $text.Replace($s, '***') } }
    return $text
}
function Fail([string]$message) {
    Clear-Secrets
    if ($tempSql -and (Test-Path $tempSql)) { Remove-Item $tempSql -Force -ErrorAction SilentlyContinue }
    Write-Host "FAILED: $(Hide $message)" -ForegroundColor Red
    exit 1
}

# Runs psql with the given arguments (never any secret) and returns @{ Ok; Output } with secrets redacted.
function Invoke-Psql([string[]]$psqlArgs) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue' # native stderr must not throw in Windows PowerShell 5.1
    try {
        $raw = & $psql @psqlArgs 2>&1 | ForEach-Object { "$_" }
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previous }
    return @{ Ok = ($code -eq 0); Output = (Hide ($raw -join "`n")) }
}
function New-Secret([int]$bytes) {
    $b = New-Object byte[] $bytes
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
    return ([Convert]::ToBase64String($b) -replace '[^A-Za-z0-9]', '')
}
function Get-EnvValue([string]$name) {
    if (-not (Test-Path $envFile)) { return $null }
    $m = Select-String -Path $envFile -Pattern "^$name=([^\r\n]*)$" | Select-Object -First 1
    if (-not $m) { return $null }
    $v = ($m.Matches[0].Groups[1].Value -replace '\s+#.*$', '').Trim()
    if ($v -eq '' -or $v -like 'change-me*') { return $null }
    return $v
}
function Set-EnvValue([string]$name, [string]$value) {
    # Replaces only that line (keeps every other line and the file's line endings); appends it if absent.
    $text = [IO.File]::ReadAllText($envFile)
    $pattern = "(?m)^$name=[^\r\n]*"
    if ($text -match $pattern) { $text = [regex]::Replace($text, $pattern, { param($m) "$name=$value" }) }
    else { $text = $text.TrimEnd() + "`r`n$name=$value`r`n" }
    [IO.File]::WriteAllText($envFile, $text, (New-Object Text.UTF8Encoding($false)))
}
# True if the application role can log in to $db with $password.
function Test-AppLogin([string]$db, [string]$password) {
    $env:PGPASSWORD = $password
    $r = Invoke-Psql @('-U', $appRole, '-h', 'localhost', '-d', $db, '-w', '-tA', '-v', 'ON_ERROR_STOP=1', '-c', 'SELECT current_user')
    return ($r.Ok -and $r.Output.Trim() -eq $appRole)
}

if (-not (Test-Path $psql)) { Fail 'psql.exe was not found. Install PostgreSQL or add its bin folder to PATH.' }

# 1. Superuser authentication first. Nothing else happens if this fails.
$adminPw = $env:ESP_PG_ADMIN_PASSWORD
if (-not $adminPw) {
    $secure = Read-Host 'postgres superuser password' -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $adminPw = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}
$secrets.Add($adminPw)
$env:PGPASSWORD = $adminPw
$auth = Invoke-Psql @('-U', 'postgres', '-h', 'localhost', '-w', '-tA', '-c', 'SELECT 1')
if (-not $auth.Ok) { Fail "Could not authenticate as 'postgres'. Nothing was changed. psql said: $($auth.Output)" }

# 2. Decide the application password: keep .env's only if it really works, otherwise generate a fresh one.
if (-not (Test-Path $envFile)) { Copy-Item (Join-Path $root 'env.example') $envFile }
$existing = Get-EnvValue 'DB_PASSWORD'
$appPw = $null
if ($existing) {
    $secrets.Add($existing)
    if (Test-AppLogin $databases[0] $existing) { $appPw = $existing }
}
$passwordIsNew = -not $appPw
if ($passwordIsNew) { $appPw = New-Secret 24 }
$secrets.Add($appPw)

# 3. Create/update the role and databases from a temp SQL file. The file contains no secret: the password is read from
#    the environment by \getenv and quoted by format('%L'), never concatenated into SQL by this script.
$tempSql = Join-Path ([IO.Path]::GetTempPath()) ("esp-setup-" + [guid]::NewGuid().ToString('N') + '.sql')
$sql = @'
\set ON_ERROR_STOP on
\getenv pw ESP_APP_PW
SELECT format('CREATE ROLE esp_app LOGIN PASSWORD %L', :'pw')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'esp_app') \gexec
SELECT format('ALTER ROLE esp_app LOGIN PASSWORD %L', :'pw')
 WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'esp_app') \gexec
SELECT 'CREATE DATABASE english_speaking OWNER esp_app ENCODING ''UTF8'' TEMPLATE template0'
 WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'english_speaking') \gexec
SELECT 'CREATE DATABASE english_speaking_test OWNER esp_app ENCODING ''UTF8'' TEMPLATE template0'
 WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'english_speaking_test') \gexec
'@
[IO.File]::WriteAllText($tempSql, $sql, (New-Object Text.UTF8Encoding($false)))
try {
    $env:PGPASSWORD = $adminPw
    $env:ESP_APP_PW = $appPw
    $run = Invoke-Psql @('-U', 'postgres', '-h', 'localhost', '-w', '-X', '-v', 'ON_ERROR_STOP=1', '-f', $tempSql)
    if (-not $run.Ok) { Fail "Creating the role/databases failed: $($run.Output)" }
    foreach ($db in $databases) {
        $g = Invoke-Psql @('-U', 'postgres', '-h', 'localhost', '-d', $db, '-w', '-X', '-v', 'ON_ERROR_STOP=1', '-c', "GRANT ALL ON SCHEMA public TO $appRole")
        if (-not $g.Ok) { Fail "Granting schema access in '$db' failed: $($g.Output)" }
    }
} finally {
    Remove-Item $tempSql -Force -ErrorAction SilentlyContinue
    Remove-Item Env:ESP_APP_PW -ErrorAction SilentlyContinue
}

# 4. Verify as the application role: it must log in to BOTH databases and be able to create and drop a table.
foreach ($db in $databases) {
    if (-not (Test-AppLogin $db $appPw)) { Fail "The '$appRole' role could not log in to '$db'. .env was NOT modified." }
    $env:PGPASSWORD = $appPw
    $probe = Invoke-Psql @('-U', $appRole, '-h', 'localhost', '-d', $db, '-w', '-X', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE TABLE _esp_probe(i int); DROP TABLE _esp_probe;')
    if (-not $probe.Ok) { Fail "'$appRole' can log in to '$db' but cannot create tables there: $($probe.Output). .env was NOT modified." }
    Write-Host "  verified: $appRole can connect to and create tables in '$db'"
}

# 5. Only now touch .env, and only the values that need it.
$changes = @()
if ($passwordIsNew) { Set-EnvValue 'DB_PASSWORD' $appPw; $changes += 'DB_PASSWORD (fresh password generated)' }
if (-not (Get-EnvValue 'JWT_SECRET')) { Set-EnvValue 'JWT_SECRET' (New-Secret 48); $changes += 'JWT_SECRET (was a placeholder)' }
Clear-Secrets

Write-Host "SUCCESS: role '$appRole' and databases english_speaking, english_speaking_test are ready and verified." -ForegroundColor Green
if ($changes.Count -gt 0) { Write-Host ".env updated: $($changes -join '; ')" } else { Write-Host '.env left unchanged (existing credentials already valid).' }
