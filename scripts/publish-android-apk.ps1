<#
.SYNOPSIS
  Publishes the signed Android RELEASE apk to ./downloads (served by the web container at /downloads/).

.EXAMPLE
  cd mobile; npm run set-api-url -- https://speak.example.com; cd android; .\gradlew.bat assembleRelease; cd ..\..
  .\scripts\publish-android-apk.ps1 -ExpectedApiUrl https://speak.example.com

  Refuses to publish when the APK is debug-signed, is a debug build, or was built with a local/emulator server address,
  because such a file would install but never work for anyone else.
#>
param(
    [Parameter(Mandatory = $true)][string]$ExpectedApiUrl,
    [string]$Apk = '',
    [string]$OutName = 'speakora.apk'
)
$ErrorActionPreference = 'Stop'
function Fail($m) { Write-Error $m; exit 1 }

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not $Apk) { $Apk = Join-Path $root 'mobile\android\app\build\outputs\apk\release\app-release.apk' }
$Apk = (Resolve-Path $Apk -ErrorAction SilentlyContinue).Path
if (-not $Apk -or -not (Test-Path $Apk)) { Fail 'Release APK not found. Build it first: cd mobile\android; .\gradlew.bat assembleRelease' }
if ($Apk -match '[\\/]debug[\\/]' -or $Apk -match 'debug\.apk$') { Fail 'That is a debug APK. Publish the release build only.' }
if ($ExpectedApiUrl -notmatch '^https://[^/\s]+\.[^/\s]+') { Fail 'ExpectedApiUrl must be your public https address, for example https://speak.example.com' }
$expected = $ExpectedApiUrl.TrimEnd('/')

# 1. Signature: must verify and must not be the public debug key.
$apksigner = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Android\Sdk\build-tools') -Recurse -Filter apksigner.bat -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
if (-not $apksigner) { Fail 'apksigner not found in the Android SDK build-tools.' }
$cert = & $apksigner.FullName verify --print-certs $Apk 2>&1 | Out-String
if ($LASTEXITCODE -ne 0 -or $cert -notmatch 'certificate DN') { Fail "APK signature does not verify:`n$cert" }
if ($cert -match 'Android Debug') { Fail 'The APK is signed with the public debug key. Create the release keystore (see mobile/README.md) and rebuild.' }

# 2. The JavaScript bundle inside the APK carries the baked-in server address.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($Apk)
try {
    $entry = $zip.Entries | Where-Object { $_.FullName -eq 'assets/index.android.bundle' }
    if (-not $entry) { Fail 'The APK has no embedded JavaScript bundle (is it a debug build?).' }
    $ms = New-Object IO.MemoryStream; $s = $entry.Open(); $s.CopyTo($ms); $s.Dispose()
    $text = [Text.Encoding]::GetEncoding(28591).GetString($ms.ToArray())
} finally { $zip.Dispose() }
foreach ($bad in '10.0.2.2', 'localhost', '127.0.0.1', '192.168.') {
    if ($text.Contains($bad)) { Fail "The APK was built with a local server address ('$bad'). Run: cd mobile; npm run set-api-url -- $expected  and rebuild with assembleRelease." }
}
if (-not $text.Contains($expected)) { Fail "The APK does not contain $expected. Run: cd mobile; npm run set-api-url -- $expected  and rebuild with assembleRelease." }

# 3. Publish.
$dir = Join-Path $root 'downloads'
New-Item -ItemType Directory -Force $dir | Out-Null
$dest = Join-Path $dir $OutName
Copy-Item $Apk $dest -Force
$hash = (Get-FileHash $dest -Algorithm SHA256).Hash.ToLower()
[IO.File]::WriteAllText("$dest.sha256", "$hash  $OutName`n")
"Published $dest ($([math]::Round((Get-Item $dest).Length / 1MB, 1)) MB)"
"SHA-256: $hash"
"Public URL once deployed: $expected/downloads/$OutName"
"Set ANDROID_DOWNLOAD_URL=$expected/downloads/$OutName in .env.prod and rebuild the web image."
