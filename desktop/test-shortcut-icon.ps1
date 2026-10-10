param([string]$Makensis = "$env:LOCALAPPDATA\tauri\NSIS\makensis.exe")
$ErrorActionPreference = 'Stop'
$root = Join-Path ([IO.Path]::GetTempPath()) ('hermes-shortcut-icon-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
$link = Join-Path $root 'test shortcut.lnk'
$icon = Join-Path $root 'icon.ico'
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\src-tauri\icons\icon.ico') -Destination $icon
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($link)
$shortcut.TargetPath = (Get-Command notepad.exe).Source
$shortcut.Arguments = '--original-arguments'
$shortcut.WorkingDirectory = $root
$shortcut.Description = 'preserve metadata'
$shortcut.Save()
$target = $shortcut.TargetPath
$template = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\src-tauri\windows\shortcut-icon-test.nsi') -Raw
$template = $template.Replace('@INCLUDE@', (Resolve-Path (Join-Path $PSScriptRoot '..\src-tauri\windows\maintenance.nsh')).Path).Replace('@EXE@',(Join-Path $root 'probe.exe')).Replace('@LINK@',$link).Replace('@ICON@',$icon).Replace('@MISSING@',(Join-Path $root 'missing.lnk'))
$template | Set-Content -LiteralPath (Join-Path $root 'probe.nsi') -Encoding utf8BOM
& $Makensis /V2 (Join-Path $root 'probe.nsi')
if ($LASTEXITCODE -ne 0) { throw 'Shortcut macro did not compile.' }
$info = [Diagnostics.ProcessStartInfo]::new((Join-Path $root 'probe.exe'))
$info.UseShellExecute = $false
$info.CreateNoWindow = $true
$info.WindowStyle = 'Hidden'
$process = [Diagnostics.Process]::Start($info)
if (-not $process.WaitForExit(10000) -or $process.ExitCode -ne 0) { throw "Shortcut macro contract failed: $($process.ExitCode)" }
$actual = $shell.CreateShortcut($link)
if ($actual.IconLocation -ne "$icon,0") { throw "Icon field not updated: $($actual.IconLocation)" }
if ($actual.TargetPath -ne $target -or $actual.Arguments -ne '--original-arguments' -or $actual.WorkingDirectory -ne $root -or $actual.Description -ne 'preserve metadata') { throw 'Unrelated shortcut metadata changed.' }
@{testRoot=$root;iconLocation=$actual.IconLocation;preservedTarget=$true;preservedArguments=$true;missingShortcutRejected=$true} | ConvertTo-Json | Tee-Object -FilePath (Join-Path $root 'receipt.json')
