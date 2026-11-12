# Checks the SMTP settings in .env by sending ONE clearly-labelled test message, and reports only the outcome (never the password).
#
#   powershell -ExecutionPolicy Bypass -File tools\test-smtp.ps1 -To you@example.com
#
# "Accepted by the mail server" means the provider took the message: it is NOT proof that it reached the inbox. Check the inbox (and spam).
# For the real flow, use Sign up or Forgot password in the app with an address you can read.
# -Plain and -HostOverride/-PortOverride exist only to test this script against the local sink (tools\smtp-sink).
param(
    [Parameter(Mandatory = $true)][string]$To,
    [switch]$Plain,
    [string]$HostOverride = '',
    [int]$PortOverride = 0
)

$envFile = Join-Path (Split-Path $PSScriptRoot -Parent) '.env'
if (-not (Test-Path $envFile)) { Write-Error ".env not found at $envFile"; exit 1 }
$cfg = @{}
foreach ($line in Get-Content -LiteralPath $envFile) { if ($line -match '^\s*([A-Z_]+)=(.*)$') { $cfg[$Matches[1]] = $Matches[2].Trim() } }

$smtpHost = if ($HostOverride) { $HostOverride } else { $cfg['SMTP_HOST'] }
$port = if ($PortOverride -gt 0) { $PortOverride } elseif ($cfg['SMTP_PORT']) { [int]$cfg['SMTP_PORT'] } else { 587 }
$from = $cfg['MAIL_FROM']
$app = if ($cfg['APP_NAME']) { $cfg['APP_NAME'] } else { 'Speakora' }

if ([string]::IsNullOrWhiteSpace($smtpHost)) { Write-Host 'FAIL: SMTP_HOST is empty. Run tools\set-smtp.ps1 first.'; exit 1 }
if ([string]::IsNullOrWhiteSpace($from) -or $from -match '@example\.(com|org|net)') { Write-Host 'FAIL: MAIL_FROM is empty or still an example.com placeholder.'; exit 1 }
if ($port -eq 465) { Write-Host 'FAIL: this checker supports STARTTLS (port 587) only; the application itself supports 465 as well.'; exit 1 }

try {
    $fromAddress = ([System.Net.Mail.MailAddress]::new($from)).Address
    $message = New-Object System.Net.Mail.MailMessage
    $message.From = New-Object System.Net.Mail.MailAddress($fromAddress, $app)
    $message.To.Add($To)
    $message.Subject = "$app test message"
    $message.Body = "This is a test message from $app, sent to check that email delivery works.`r`n`r`nIf you can read this, the mail server accepted the message and it reached your inbox. No action is needed. It is not a verification code."
    $client = New-Object System.Net.Mail.SmtpClient($smtpHost, $port)
    $client.EnableSsl = -not $Plain
    $client.Timeout = 20000
    if ($cfg['SMTP_USER']) { $client.Credentials = New-Object System.Net.NetworkCredential($cfg['SMTP_USER'], $cfg['SMTP_PASSWORD']) }
    $client.Send($message)
    Write-Host "ACCEPTED: the mail server at $smtpHost`:$port accepted a test message from '$app <$fromAddress>' to $To."
    Write-Host 'Now check that inbox (and the spam folder). Only an arrived message proves delivery.'
} catch {
    $detail = $_.Exception.GetBaseException().Message
    $kind = switch -Regex ($detail) {
        '5\.7\.8|535|authenticat|credential|Username and Password' { 'LOGIN REFUSED: the SMTP username or password (SMTP key) is wrong, or the account is not activated.' ; break }
        'sender|5\.7\.1|550|553|not allowed|not verified|unverified' { 'SENDER REFUSED: the MAIL_FROM address is not a verified sender with your provider.'; break }
        'timed out|timeout' { 'TIMEOUT: the server did not answer (wrong host or port, or the network blocks it).'; break }
        'actively refused|No connection|resolve|host' { 'CONNECTION FAILED: cannot reach the server (wrong SMTP_HOST or SMTP_PORT, or no network).'; break }
        'STARTTLS|SSL|secure' { 'TLS PROBLEM: the server needs a secure connection (STARTTLS on port 587).'; break }
        default { 'FAILED.' }
    }
    Write-Host "$kind"
    Write-Host "Server said: $detail"
    exit 1
}
