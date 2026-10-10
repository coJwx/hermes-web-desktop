param(
    [Parameter(Mandatory)][string]$Installer,
    [Parameter(Mandatory)][string]$Application,
    [string]$PreviousInstaller,
    [string]$TestParent = [IO.Path]::GetTempPath()
)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'This test requires real Windows.' }
$Installer = (Resolve-Path -LiteralPath $Installer).Path
$Application = (Resolve-Path -LiteralPath $Application).Path
$root = Join-Path (Resolve-Path -LiteralPath $TestParent).Path ('hermes-installer-e2e-' + [guid]::NewGuid().ToString('N'))
$destination = Join-Path $root '中文 路径\Hermes Dashboard'
$registration = 'HKCU:\Software\hermes\Hermes Dashboard'
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Hermes Dashboard'
# The real installer writes HKCU. Refuse to replace an existing user's registration.
foreach ($key in @($registration, $uninstallKey)) {
    if (Test-Path -LiteralPath $key) { throw "Existing registration must be preserved; use a clean Windows user: $key" }
}
New-Item -ItemType Directory -Path $root | Out-Null
$checks = [System.Collections.Generic.List[object]]::new()
# Tauri changes only its bundle marker while packing, then restores the standalone exe.
$bytes = [IO.File]::ReadAllBytes($Application)
$marker = [Text.Encoding]::ASCII.GetBytes('__TAURI_BUNDLE_TYPE_VAR_UNK')
$offset = [Text.Encoding]::ASCII.GetString($bytes).IndexOf([Text.Encoding]::ASCII.GetString($marker), [StringComparison]::Ordinal)
if ($offset -lt 0) { throw 'Standalone Tauri bundle marker missing.' }
[Text.Encoding]::ASCII.GetBytes('NSS').CopyTo($bytes, $offset + $marker.Length - 3)
$expectedHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes))
function Start-TestProcess([string]$File, [string]$Arguments = '') {
    # Launch our locally built artifact directly, without an interactive shell-open prompt.
    $info = [System.Diagnostics.ProcessStartInfo]::new($File, $Arguments)
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    return [System.Diagnostics.Process]::Start($info)
}
function Run-Installer([string]$Mode = "/S") {
    $process = Start-TestProcess $Installer "$Mode /NS /D=$destination"
    if (-not $process.WaitForExit(120000)) { throw "Installer timed out; inspect PID $($process.Id)." }
    if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
    $exe = Join-Path $destination 'hermes-dashboard.exe'
    if ((Get-FileHash -LiteralPath $exe).Hash -ne $expectedHash) {
        throw 'Installed executable differs from the built application.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $destination 'uninstall.exe'))) { throw 'Uninstaller missing.' }
    $registered = (Get-ItemProperty -LiteralPath $uninstallKey).InstallLocation.Trim('"')
    if ($registered -ne $destination) { throw "Unexpected install location: $registered" }
}
$installed = $false
$app = $null
try {
    $installed = $true
    if ($PreviousInstaller) {
        $previous = (Resolve-Path -LiteralPath $PreviousInstaller).Path
        $process = Start-TestProcess $previous "/S /NS /D=$destination"
        if (-not $process.WaitForExit(120000) -or $process.ExitCode -ne 0) { throw 'Previous installer failed.' }
        $oldExe = Join-Path $destination 'hermes-dashboard.exe'
        if (-not (Test-Path -LiteralPath $oldExe)) { throw 'Old executable missing.' }
        $oldVersion = (Get-ItemProperty -LiteralPath $uninstallKey).DisplayVersion
        $data = Join-Path $destination 'hermes-dashboard-data'
        New-Item -ItemType Directory -Path $data -Force | Out-Null
        $marker = Join-Path $data 'upgrade-sentinel.txt'
        'keep-existing-user-data' | Set-Content -LiteralPath $marker
        $markerHash = (Get-FileHash -LiteralPath $marker).Hash
        # Simulate a broken old uninstall without removing anything from a real installation.
        Rename-Item -LiteralPath (Join-Path $destination 'uninstall.exe') -NewName 'uninstall-old-test-backup.exe'
        # /P exercises the maintenance-page decision, unlike /S which skips that page.
        Run-Installer '/P'
        if ((Get-FileHash -LiteralPath $marker).Hash -ne $markerHash) { throw 'Upgrade changed existing data.' }
        if ((Get-ItemProperty -LiteralPath $uninstallKey).DisplayVersion -eq $oldVersion) { throw 'Upgrade did not update registration.' }
        $checks.Add(@{check='old-version-missing-uninstaller-passive-upgrade'; result='pass'; previousVersion=$oldVersion})
    } else { Run-Installer }
    if (-not $PreviousInstaller) { $checks.Add(@{check='fresh-nested-unicode-path'; result='pass'; exitCode=0}) }
    # A portable profile isolates the launch test from the real user's AppData.
    $profile = Join-Path $destination 'hermes-dashboard-data'
    New-Item -ItemType Directory -Path $profile -Force | Out-Null
    $settings = Join-Path $profile 'connection.json'
    '{"backend_url":"http://127.0.0.1:9/"}' | Set-Content -LiteralPath $settings -Encoding utf8NoBOM
    $sentinel = (Get-FileHash -LiteralPath $settings).Hash
    Run-Installer
    if ((Get-FileHash -LiteralPath $settings).Hash -ne $sentinel) { throw 'Reinstall changed user data.' }
    $checks.Add(@{check='reinstall-preserves-profile'; result='pass'; exitCode=0})
    $app = Start-TestProcess (Join-Path $destination 'hermes-dashboard.exe')
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    do {
        Start-Sleep -Milliseconds 250
        $app.Refresh()
        if ($app.HasExited) { throw "Installed app exited during startup: $($app.ExitCode)" }
    } while (($app.MainWindowHandle -eq 0 -or $app.MainWindowTitle -notlike '*后端连接*') -and [DateTime]::UtcNow -lt $deadline)
    if ($app.MainWindowTitle -notlike '*后端连接*') { throw "Connection window did not start: $($app.MainWindowTitle)" }
    $children = @(Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $app.Id -and $_.Name -eq 'msedgewebview2.exe' })
    if ($children.Count -eq 0) { throw 'WebView2 child process missing.' }
    $checks.Add(@{check='installed-app-launch'; result='pass'; windowTitle=$app.MainWindowTitle; webviewChildren=$children.Count})
    if (-not $app.CloseMainWindow()) { throw 'Could not request normal application close.' }
    if (-not $app.WaitForExit(15000)) { throw 'Application did not close normally.' }
    $app = $null
    # Window shutdown precedes WebView2 teardown; wait for our browser child, not a fixed sleep.
    foreach ($child in $children) {
        $browser = Get-Process -Id $child.ProcessId -ErrorAction SilentlyContinue
        if ($null -ne $browser -and -not $browser.WaitForExit(15000)) { throw 'WebView2 did not finish shutdown.' }
    }
    $uninstaller = Join-Path $destination 'uninstall.exe'
    # _?= keeps NSIS in the known test directory so WaitForExit waits for the real uninstall.
    $process = Start-TestProcess $uninstaller "/S _?=$destination"
    if (-not $process.WaitForExit(60000) -or $process.ExitCode -ne 0) { throw "Test uninstall failed (exit $($process.ExitCode))." }
    if (Test-Path -LiteralPath (Join-Path $destination 'hermes-dashboard.exe')) { throw 'Uninstall left application executable.' }
    if (Test-Path -LiteralPath $uninstallKey) { throw 'Uninstall left application registration.' }
    if ((Get-FileHash -LiteralPath $settings).Hash -ne $sentinel) { throw 'Uninstall changed portable user data.' }
    $checks.Add(@{check='uninstall-preserves-profile'; result='pass'; exitCode=0})
    $installed = $false
    # NSIS deliberately preserves this preference key; remove only our exact test registration.
    if (Test-Path -LiteralPath $registration) {
        if ((Get-Item -LiteralPath $registration).GetValue('') -ne $destination) { throw 'Registration changed concurrently; refusing cleanup.' }
        Remove-Item -LiteralPath $registration
    }
    $receipt = @{installer=$Installer; installerSha256=(Get-FileHash -LiteralPath $Installer).Hash; applicationSha256=(Get-FileHash -LiteralPath $Application).Hash; destination=$destination; checks=$checks}
    $receipt | ConvertTo-Json -Depth 5 | Tee-Object -FilePath (Join-Path $root 'receipt.json')
} finally {
    if ($null -ne $app -and -not $app.HasExited) {
        # Only stop the process started by this test, never other Hermes copies.
        $app.Kill()
        $app.WaitForExit()
    }
    if ($installed) { Write-Warning "Test install retained for diagnosis: $destination" }
}
