param(
  [string]$Version = "",
  [string]$Server = "server",
  [string]$RemoteDir = "/www/wwwroot/secret-room-downloads",
  [switch]$SkipBuild,
  [switch]$SkipDeploy,
  [switch]$SkipSmoke
)

$ErrorActionPreference = "Stop"

function Write-Step($Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Find-AndroidTool($Name) {
  $sdk = $env:ANDROID_HOME
  if (-not $sdk) { $sdk = $env:ANDROID_SDK_ROOT }
  if (-not $sdk) { $sdk = Join-Path $env:LOCALAPPDATA "Android\Sdk" }
  $tool = Get-ChildItem -LiteralPath (Join-Path $sdk "build-tools") -Recurse -Include "$Name.bat","$Name.exe" -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending |
    Select-Object -First 1
  if (-not $tool) { throw "Cannot find $Name under Android SDK build-tools." }
  return $tool.FullName
}

function Get-JsonFile($Path) {
  return Get-Content -LiteralPath $Path -Encoding UTF8 | ConvertFrom-Json
}

function Save-JsonFile($Path, $Value) {
  $json = $Value | ConvertTo-Json -Depth 8
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText((Resolve-Path $Path), $json + [Environment]::NewLine, $utf8NoBom)
}

$repo = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repo

if (-not $Version) {
  $package = Get-JsonFile "package.json"
  $Version = [string]$package.version
}

$javaHome = "C:\Program Files\Android\Android Studio\jbr"
if (Test-Path -LiteralPath $javaHome) {
  $env:JAVA_HOME = $javaHome
  $env:Path = "$env:JAVA_HOME\bin;$env:Path"
}
if (-not $env:ANDROID_HOME) {
  $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA "Android\Sdk"
}
if (-not $env:ANDROID_SDK_ROOT) {
  $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
}

$releaseProperties = Join-Path $repo "apps\mobile\android\local-signing\release.properties"
if (-not (Test-Path -LiteralPath $releaseProperties)) {
  throw "Missing local signing file: $releaseProperties. Create it from apps/mobile/android/local-signing/release.properties.example."
}

if (-not $SkipBuild) {
  Write-Step "Build web assets for Capacitor"
  npx -y pnpm@9.15.4 --filter "@secret-room/mobile" build:web

  Write-Step "Copy web assets into Android project"
  npx -y pnpm@9.15.4 --filter "@secret-room/mobile" copy

  Write-Step "Build signed Android release APK"
  Push-Location "apps\mobile\android"
  try {
    .\gradlew.bat assembleRelease
  } finally {
    Pop-Location
  }
}

$signedApk = Join-Path $repo "apps\mobile\android\app\build\outputs\apk\release\app-release.apk"
$unsignedApk = Join-Path $repo "apps\mobile\android\app\build\outputs\apk\release\app-release-unsigned.apk"
if (-not (Test-Path -LiteralPath $signedApk)) {
  if (Test-Path -LiteralPath $unsignedApk) {
    throw "Only unsigned APK exists. Check release signing configuration."
  }
  throw "Release APK not found: $signedApk"
}

$releaseName = "SecretRoom-$Version.apk"
$releaseApk = Join-Path $repo "download\releases\$releaseName"
New-Item -ItemType Directory -Path (Split-Path -Parent $releaseApk) -Force | Out-Null
Copy-Item -LiteralPath $signedApk -Destination $releaseApk -Force

$apksigner = Find-AndroidTool "apksigner"
$zipalign = Find-AndroidTool "zipalign"

Write-Step "Verify APK signature and alignment"
& $apksigner verify --verbose --print-certs $releaseApk
& $zipalign -c -p 4 $releaseApk

$hash = (Get-FileHash -LiteralPath $releaseApk -Algorithm SHA256).Hash.ToLowerInvariant()
$bytes = (Get-Item -LiteralPath $releaseApk).Length
$sizeMb = "{0:0.00}" -f ($bytes / 1MB)
$updatedAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss zzz")

$manifestPath = Join-Path $repo "download\releases\manifest.json"
$manifest = Get-JsonFile $manifestPath
$manifest.android | Add-Member -NotePropertyName "available" -NotePropertyValue $true -Force
$manifest.android | Add-Member -NotePropertyName "version" -NotePropertyValue $Version -Force
$manifest.android | Add-Member -NotePropertyName "updatedAt" -NotePropertyValue $updatedAt -Force
$manifest.android | Add-Member -NotePropertyName "size" -NotePropertyValue "$sizeMb MB" -Force
$manifest.android | Add-Member -NotePropertyName "bytes" -NotePropertyValue $bytes -Force
$manifest.android | Add-Member -NotePropertyName "sha256" -NotePropertyValue $hash -Force
$manifest.android | Add-Member -NotePropertyName "url" -NotePropertyValue "/download/releases/$releaseName" -Force
$notesBytes = [Convert]::FromBase64String("QW5kcm9pZCBBUEvvvJrmm7TmlrDlupTnlKjlm77moIfvvIzkv67lpI3miYvmnLrkuIvovb3pobXlj6/og73kv53lrZjkuLogNCBLQiDnvZHpobXmlofku7bnmoTpl67popjvvIzkv53nlZnpmLLmiKrlm74v5b2V5bGP44CB5Y+M5Lq65a+G6IGK44CB5Zu+54mHL+inhumikea2iOaBr+WSjOemu+e6v+WvhuS/oeiDveWKm+OAgg==")
$manifest.android | Add-Member -NotePropertyName "notes" -NotePropertyValue ([System.Text.Encoding]::UTF8.GetString($notesBytes)) -Force
Save-JsonFile $manifestPath $manifest

Write-Step "Release artifact"
Write-Host "APK: $releaseApk"
Write-Host "Size: $sizeMb MB / $bytes bytes"
Write-Host "SHA256: $hash"

if (-not $SkipDeploy) {
  Write-Step "Deploy download page, assets, manifest, and APK"
  ssh $Server "mkdir -p '$RemoteDir/assets' '$RemoteDir/releases'"
  scp "download\index.html" "${Server}:/tmp/secret-room-download-index.html"
  scp "download\assets\app-icon.png" "${Server}:/tmp/secret-room-app-icon.png"
  scp $manifestPath "${Server}:/tmp/secret-room-manifest.json"
  scp $releaseApk "${Server}:/tmp/$releaseName"
  ssh $Server "cp /tmp/secret-room-download-index.html '$RemoteDir/index.html'"
  ssh $Server "cp /tmp/secret-room-app-icon.png '$RemoteDir/assets/app-icon.png'"
  ssh $Server "cp /tmp/secret-room-manifest.json '$RemoteDir/releases/manifest.json'"
  ssh $Server "cp '/tmp/$releaseName' '$RemoteDir/releases/$releaseName'"
  ssh $Server "chmod 644 '$RemoteDir/index.html' '$RemoteDir/assets/app-icon.png' '$RemoteDir/releases/manifest.json' '$RemoteDir/releases/$releaseName'"
}

if (-not $SkipSmoke) {
  Write-Step "Public smoke test"
  curl.exe -k -f -I "https://8.138.150.200/download" | Out-Host
  curl.exe -k -f -I "https://8.138.150.200/download/releases/$releaseName" | Out-Host
  $tempApk = Join-Path $env:TEMP $releaseName
  curl.exe -k -L -f -o $tempApk "https://8.138.150.200/download/releases/$releaseName"
  $publicHash = (Get-FileHash -LiteralPath $tempApk -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($publicHash -ne $hash) {
    throw "Public APK hash mismatch. expected=$hash actual=$publicHash"
  }
  Write-Host "Public APK hash OK: $publicHash"
}
