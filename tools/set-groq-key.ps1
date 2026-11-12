<#
  Stores GROQ_API_KEY in the local .env file without ever showing it.

  Run it yourself in a terminal (never paste a key into a chat or a command line):
      powershell -ExecutionPolicy Bypass -File tools\set-groq-key.ps1

  - The key is typed at a hidden prompt, so it is not echoed and does not enter your shell history.
  - It is written only to .env (which git ignores). The key is never printed.
  - Restart the backend afterwards so it picks the key up.
#>
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root '.env'
if (-not (Test-Path $envFile)) { Copy-Item (Join-Path $root 'env.example') $envFile }

$secure = Read-Host 'Paste your Groq API key (input is hidden)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
$key = $key.Trim()
if ($key.Length -lt 20 -or $key -match '\s') { throw 'That does not look like an API key (too short or contains spaces). Nothing was changed.' }

$lines = [System.Collections.Generic.List[string]](Get-Content $envFile)
$index = -1
for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match '^\s*GROQ_API_KEY\s*=') { $index = $i; break } }
if ($index -ge 0) { $lines[$index] = "GROQ_API_KEY=$key" } else { $lines.Add("GROQ_API_KEY=$key") }
# UTF-8 without a byte-order mark, which is what the backend's .env reader expects.
[IO.File]::WriteAllLines($envFile, $lines, (New-Object Text.UTF8Encoding($false)))
$key = $null

Write-Host 'GROQ_API_KEY saved to .env (git-ignored). Restart the backend, then open Admin > System > "Test coach".'
