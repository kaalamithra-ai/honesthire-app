# download-chimera.ps1
# Fetches the official Chimera Windows amd64 artifact into downloads/ and records
# what was found so the next step can verify + extract deterministically.
$ErrorActionPreference = 'Stop'
$root = split-path -parent $MyInvocation.MyCommand.Definition
$dl = join-path $root 'downloads'
if (-not (Test-Path $dl)) { New-Item -Path $dl -ItemType Directory -Force | Out-Null }

# Release index source: official Chimera releases.
$releases = 'https://github.com/chimera-search/chimera/releases'
Write-Output "NOTE: artifact selection must be verified against the official Chimera releases page: $releases"
Write-Output "NOTE: no release asset URL is hardcoded here until the release layout is confirmed."

# Placeholder behavior until the real release asset pattern is confirmed:
# - list what exists in downloads/
# - exit with a clear next step
Write-Output "downloads/ currently contains:"
Get-ChildItem -Path $dl -ErrorAction SilentlyContinue | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize
Write-Output "NEXT: confirm the exact Chimera release version and asset names, then populate this script with the verified download + checksum/signature checks."