# Starts a backend jar for measuring, isolated from the real application:
#   - its own PostgreSQL schema ("perf" inside the integration-test database), so no real data is read, written or migrated
#   - its own Redis database (5), so the real app's matching queue and rate limits never see these users
#   - no outgoing email, no daily mail cap, port 8090
# Usage:  powershell -File tools\perf\start-backend.ps1 -Jar <path\to\platform.jar> [-Stats] [-Log <file>]
#   -Stats  turns on Hibernate statistics (logged per session) so tools\perf\sql-count.cjs can count JDBC statements; it adds a little overhead,
#           so latency measurements are taken without it.
# The working directory is the real backend folder only so that ../.env (secrets) is found; the jar is whatever -Jar points to.
param(
  [Parameter(Mandatory = $true)][string]$Jar,
  [switch]$Stats,
  [string]$Log = (Join-Path $env:TEMP 'perf-backend.log'),
  [int]$Port = 8090
)
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$existing = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($existing) { Stop-Process -Id $existing.OwningProcess -Force; Start-Sleep 2 }
$arguments = @('-jar', (Resolve-Path $Jar).Path, "--server.port=$Port",
  '--DB_URL=jdbc:postgresql://localhost:5432/english_speaking_test?currentSchema=perf',
  '--spring.data.redis.database=5',
  '--SMTP_HOST=', '--SMTP_USER=', '--SMTP_PASSWORD=', '--app.mail-daily-limit=0',
  '--CORS_ALLOWED_ORIGINS=http://localhost:4180,http://localhost:4181,http://localhost:4182,http://localhost:5173,http://localhost:5180')
if ($Stats) {
  $arguments += '--spring.jpa.properties.hibernate.generate_statistics=true'
  $arguments += '--logging.level.org.hibernate.engine.internal.StatisticalLoggingSessionEventListener=INFO'
}
Start-Process -FilePath java -ArgumentList $arguments -WorkingDirectory (Join-Path $root 'backend') -WindowStyle Hidden `
  -RedirectStandardOutput $Log -RedirectStandardError ($Log + '.err')
for ($i = 0; $i -lt 90; $i++) {
  Start-Sleep 2
  try { Invoke-WebRequest -UseBasicParsing "http://localhost:$Port/api/topics" -ErrorAction Stop | Out-Null } catch {
    if ($_.Exception.Response) { "backend up after $($i * 2 + 2) s (log: $Log)"; exit 0 }
  }
}
"backend did not start; see $Log.err"; exit 1
