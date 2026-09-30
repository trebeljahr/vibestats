param([Parameter(Mandatory = $true)][string] $Path)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# The preceding Artifact Signing action installs this pinned module and tools.
Import-Module TrustedSigning -RequiredVersion 0.5.8
$file = Get-Item -LiteralPath $Path
Invoke-TrustedSigning -Endpoint 'https://weu.codesigning.azure.net/' `
    -CodeSigningAccountName 'ricoslabs-signing' `
    -CertificateProfileName 'ricoslabs-public' `
    -Files $file.FullName -FileDigest SHA256 `
    -TimestampRfc3161 'http://timestamp.acs.microsoft.com' -TimestampDigest SHA256 `
    -ExcludeEnvironmentCredential:$true -ExcludeAzureCliCredential:$false

# Tauri restores the original unpatched executable after bundling. Preserve
# the signed, patched copy for comparison with the MSI and artifact upload.
if ($file.Name -ieq 'vibestats.exe') {
    $destination = Join-Path $env:GITHUB_WORKSPACE 'signed-windows'
    New-Item -ItemType Directory -Force -Path $destination | Out-Null
    Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $destination 'vibestats.exe')
}
