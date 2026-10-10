param([string]$Makensis = "$env:LOCALAPPDATA\tauri\NSIS\makensis.exe")
$ErrorActionPreference = 'Stop'
$root = Join-Path ([IO.Path]::GetTempPath()) ('hermes-maintenance-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
foreach ($name in @('maintenance.nsh', 'maintenance-test.nsi')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot "..\src-tauri\windows\$name") -Destination $root
}
Push-Location $root
try {
    & $Makensis /V2 maintenance-test.nsi
    if ($LASTEXITCODE -ne 0) { throw 'NSIS policy compilation failed.' }
    $info = [Diagnostics.ProcessStartInfo]::new((Join-Path $root 'policy.exe'))
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.WindowStyle = 'Hidden'
    $p = [Diagnostics.Process]::Start($info)
    if (-not $p.WaitForExit(10000) -or $p.ExitCode -ne 0) { throw 'Maintenance policy contract failed.' }
    'Six compiled NSIS maintenance choices passed.'
} finally { Pop-Location }
