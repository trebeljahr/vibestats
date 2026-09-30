# Fail closed: only upload artifacts after app, installer, and packaged app pass.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$release = Join-Path $PSScriptRoot '../src-tauri/target/release'
$app = Get-Item (Join-Path $env:GITHUB_WORKSPACE 'signed-windows/vibestats.exe')
$installers = @(Get-ChildItem (Join-Path $release 'bundle/msi') -Filter '*.msi' -File)
if ($installers.Count -ne 1) { throw "Expected one MSI, found $($installers.Count)" }
$evidence = [System.Collections.Generic.List[object]]::new()

function Assert-Signature([System.IO.FileInfo] $File, [string] $Kind) {
    $signature = Get-AuthenticodeSignature -LiteralPath $File.FullName
    if ($signature.Status -ne 'Valid') {
        throw "Invalid signature on $($File.Name): $($signature.Status)"
    }
    $publisher = $signature.SignerCertificate.GetNameInfo(
        [System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
    if ($publisher -cne 'Ricos Labs LLC') { throw "Unexpected publisher: $publisher" }
    if ($null -eq $signature.TimeStamperCertificate) { throw "Missing timestamp: $($File.Name)" }
    $hash = (Get-FileHash -LiteralPath $File.FullName -Algorithm SHA256).Hash
    $evidence.Add([pscustomobject]@{
        kind = $Kind
        file = $File.Name
        sha256 = $hash
        status = [string]$signature.Status
        publisher = $publisher
        subject = $signature.SignerCertificate.Subject
        thumbprint = $signature.SignerCertificate.Thumbprint
        timestampSubject = $signature.TimeStamperCertificate.Subject
    })
    Write-Host "Verified $Kind $($File.Name): $publisher; SHA256 $hash"
    return $hash
}

$appHash = Assert-Signature $app 'application'
$null = Assert-Signature $installers[0] 'installer'
$extract = Join-Path $env:RUNNER_TEMP ('vibestats-msi-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $extract | Out-Null
try {
    # Administrative extraction does not launch the application.
    $process = Start-Process msiexec.exe -Wait -PassThru -ArgumentList @(
        '/a', ('"' + $installers[0].FullName + '"'), '/qn',
        ('TARGETDIR="' + $extract + '"'))
    if ($process.ExitCode -ne 0) { throw "MSI extraction failed: $($process.ExitCode)" }
    $embedded = @(Get-ChildItem $extract -Recurse -File -Filter 'vibestats.exe')
    if ($embedded.Count -ne 1) { throw "Expected one embedded app, found $($embedded.Count)" }
    $embeddedHash = Assert-Signature $embedded[0] 'embedded-application'
    if ($embeddedHash -ne $appHash) { throw 'Packaged app differs from signed app' }
    [pscustomobject]@{
        commit = $env:GITHUB_SHA
        runId = $env:GITHUB_RUN_ID
        verifiedAtUtc = [DateTime]::UtcNow.ToString('o')
        artifacts = $evidence.ToArray()
    } | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 'windows-signatures.json'
} finally {
    Remove-Item -LiteralPath $extract -Recurse -Force
}
