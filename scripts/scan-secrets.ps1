param([string]$Source = (Join-Path $PSScriptRoot '..'))
$ErrorActionPreference = 'Stop'
function Get-Sha256([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose(); $stream.Dispose() }
}
$sourcePath = (Resolve-Path -LiteralPath $Source).Path
$version = '8.30.1'
$archiveHash = 'd29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e'
$binaryHash = '17157e2ee8b76fc8b1d8bee607a250e34b8a8023c8bc81822d4b5ee4d78fcb7c'
$cache = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) ('WindowsExecutor\devtools\gitleaks-' + $version)
New-Item -ItemType Directory -Path $cache -Force | Out-Null
$archive = Join-Path $cache 'gitleaks.zip'
if (-not (Test-Path -LiteralPath $archive)) {
    $url = 'https://github.com/gitleaks/gitleaks/releases/download/v' + $version + '/gitleaks_' + $version + '_windows_x64.zip'
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $archive -TimeoutSec 60
}
if ((Get-Sha256 $archive) -ne $archiveHash) { throw 'Gitleaks archive checksum mismatch.' }
$binary = Join-Path $cache 'gitleaks.exe'
if (-not (Test-Path -LiteralPath $binary)) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($archive)
    try {
        $entry = $zip.GetEntry('gitleaks.exe')
        if ($null -eq $entry) { throw 'Gitleaks executable is missing from the verified archive.' }
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $binary, $true)
    } finally { $zip.Dispose() }
}
if ((Get-Sha256 $binary) -ne $binaryHash) { throw 'Gitleaks executable checksum mismatch.' }
if (Test-Path -LiteralPath (Join-Path $sourcePath '.git')) {
    & $binary git '--log-opts=--all' --redact=100 --no-banner $sourcePath
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & $binary git --staged --redact=100 --no-banner $sourcePath
} else {
    & $binary dir --redact=100 --no-banner $sourcePath
}
exit $LASTEXITCODE
