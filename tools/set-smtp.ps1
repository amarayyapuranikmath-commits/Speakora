# Puts your SMTP settings into the git-ignored .env file, asking for the password without showing it.
# Nothing is printed except which keys were written. Run from the project folder:
#
#   powershell -ExecutionPolicy Bypass -File tools\set-smtp.ps1 -Provider Brevo
#   powershell -ExecutionPolicy Bypass -File tools\set-smtp.ps1 -Provider Gmail
#   powershell -ExecutionPolicy Bypass -File tools\set-smtp.ps1 -SmtpHost smtp.example.net -Port 587     (any other provider)
#
# Then restart the backend and run tools\test-smtp.ps1 to check the login without sending anything to a user.
param(
    [ValidateSet('Brevo', 'Gmail', 'Custom')]
    [string]$Provider = 'Custom',
    [string]$SmtpHost = '',
    [int]$Port = 587
)

$presets = @{
    Brevo = @{ Host = 'smtp-relay.brevo.com'; UserPrompt = 'Brevo SMTP login (Brevo > Settings > SMTP & API; it looks like a1b2c3@smtp-brevo.com)'
               FromPrompt = 'Sender address (MAIL_FROM). It must be a sender you verified in Brevo (Settings > Senders, Domains & Dedicated IPs)'
               PasswordPrompt = 'Brevo SMTP key (NOT the API key; typing is hidden)' }
    Gmail = @{ Host = 'smtp.gmail.com'; UserPrompt = 'Gmail address'
               FromPrompt = 'Sender address (MAIL_FROM) [Enter = same as the Gmail address]'
               PasswordPrompt = 'Gmail app password (16 characters; typing is hidden)' }
    Custom = @{ Host = $SmtpHost; UserPrompt = 'SMTP username'; FromPrompt = 'Sender address (MAIL_FROM), verified with your provider'
                PasswordPrompt = 'SMTP password (typing is hidden)' }
}
$p = $presets[$Provider]
if ([string]::IsNullOrWhiteSpace($p.Host)) { Write-Error 'Give -Provider Brevo, -Provider Gmail, or -SmtpHost <host>.'; exit 1 }
if ($SmtpHost) { $p.Host = $SmtpHost }

$envFile = Join-Path (Split-Path $PSScriptRoot -Parent) '.env'
if (-not (Test-Path $envFile)) { Write-Error ".env not found at $envFile"; exit 1 }

$user = Read-Host $p.UserPrompt
$from = Read-Host $p.FromPrompt
if ([string]::IsNullOrWhiteSpace($from) -and $Provider -eq 'Gmail') { $from = $user }
if ([string]::IsNullOrWhiteSpace($from)) { Write-Error 'A sender address is required (MAIL_FROM).'; exit 1 }
$secure = Read-Host $p.PasswordPrompt -AsSecureString
$password = [System.Net.NetworkCredential]::new('', $secure).Password -replace '\s', ''   # providers show keys in groups with spaces

if ([string]::IsNullOrWhiteSpace($user) -or [string]::IsNullOrWhiteSpace($password)) { Write-Error 'Username and password are required.'; exit 1 }

$values = [ordered]@{ SMTP_HOST = $p.Host; SMTP_PORT = "$Port"; SMTP_USER = $user; SMTP_PASSWORD = $password; MAIL_FROM = $from }
$lines = [System.Collections.Generic.List[string]](Get-Content -LiteralPath $envFile)
foreach ($key in $values.Keys) {
    $index = -1
    for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match "^$key=") { $index = $i; break } }
    if ($index -ge 0) { $lines[$index] = "$key=$($values[$key])" } else { $lines.Add("$key=$($values[$key])") }
}
[System.IO.File]::WriteAllLines($envFile, $lines, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Saved to .env: $($values.Keys -join ', ') (the password is not shown). Now restart the backend, then run tools\test-smtp.ps1."
