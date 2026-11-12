param([string]$Jar = "", [int]$HeapMb = 384, [string]$Secret = "", [int]$Port = 8096)
# Starts a backend for load tests, isolated from the real application:
#   its own port (8096), its own PostgreSQL schema (loadtest, inside the integration-test database), its own Redis database (6), a random JWT secret
#   written to tools/loadtest/work, and NO email, TURN provider or AI provider (those variables are blanked, so nothing external is ever contacted).
# Usage: powershell -File tools\loadtest\start-backend.ps1 -Jar backend\target\platform-0.1.0-SNAPSHOT.jar [-HeapMb 384] [-Port 8096] [-Secret <same secret for a second instance>]
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$work = Join-Path $PSScriptRoot "work"; New-Item -ItemType Directory -Force $work | Out-Null
if (-not $Jar) { $Jar = Join-Path $root "backend\target\platform-0.1.0-SNAPSHOT.jar" }
if (-not (Test-Path $Jar)) { throw "no jar at $Jar (build it first: mvn -o package -DskipTests, in a copy of backend/ if the dev backend is running)" }
$existing = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($existing) { throw "port $Port is already in use by pid $($existing.OwningProcess); not touching it" }
if (-not $Secret) { $Secret = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 48 | ForEach-Object { [char]$_ }) }
Set-Content -Path (Join-Path $work "lt-secret.txt") -Value $Secret -NoNewline
$env:JWT_SECRET = $Secret; $env:SMTP_HOST = ""; $env:TURNIX_API_TOKEN = ""; $env:GROQ_API_KEY = ""
$env:TRUSTED_PROXIES = "127.0.0.1,::1"   # so each simulated user can present its own X-Forwarded-For, as behind a real proxy
$env:DB_URL = "jdbc:postgresql://localhost:5432/english_speaking_test?currentSchema=loadtest"
$env:SPRING_DATA_REDIS_DATABASE = "6"; $env:SERVER_PORT = "$Port"
$jvm = @("-Xms128m", "-Xmx${HeapMb}m", "-XX:+UseSerialGC", "-Xss512k", "-jar", (Resolve-Path $Jar).Path, "--app.mail-daily-limit=0", "--management.endpoints.web.exposure.include=health,prometheus", "--server.tomcat.mbeanregistry.enabled=true")
$p = Start-Process -FilePath "java" -ArgumentList $jvm -WorkingDirectory (Join-Path $root "backend") -RedirectStandardOutput (Join-Path $work "backend-$Port.out.log") -RedirectStandardError (Join-Path $work "backend-$Port.err.log") -WindowStyle Hidden -PassThru
"started pid $($p.Id) on port $Port (heap ${HeapMb} MB). Stop it with: Stop-Process -Id $($p.Id)"
