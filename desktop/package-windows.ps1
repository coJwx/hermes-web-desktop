param([string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Package the Windows build on Windows.' }
$workspace = Split-Path $PSScriptRoot -Parent
$config = Get-Content -LiteralPath (Join-Path $workspace 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json
$version = $config.version
$installer = Join-Path $workspace "src-tauri\target\release\bundle\nsis\$($config.productName)_${version}_x64-setup.exe"
$app = Join-Path $workspace 'src-tauri\target\release\hermes-dashboard.exe'
foreach ($source in @($installer, $app)) {
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Build first with pnpm build:exe -- --locked: $source" }
}
if (-not $OutputDirectory) {
    $downloads = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders').'{374DE290-123F-4565-9164-39C4925E467B}'
    if (-not $downloads) { throw 'Cannot resolve Downloads. Specify a normal user-owned OutputDirectory outside the workspace.' }
    $OutputDirectory = Join-Path ([Environment]::ExpandEnvironmentVariables($downloads)) "Hermes-Dashboard-$version"
}
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
if ($OutputDirectory -eq $workspace -or $OutputDirectory.StartsWith($workspace + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Publish outside the workspace: its inherited Low integrity label can make installers unable to write normal directories or HKCU.'
}
if (Test-Path -LiteralPath $OutputDirectory) { throw "Choose a new output directory; existing files will not be replaced: $OutputDirectory" }
New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
$setupName = "Hermes-Dashboard-$version-windows-x64-setup.exe"
# Fresh byte streams inherit the destination's security metadata, not the build tree's.
# Do not change ACLs, elevate, or disable Windows protections to publish an installer.
[IO.File]::WriteAllBytes((Join-Path $OutputDirectory $setupName), [IO.File]::ReadAllBytes($installer))
[IO.File]::WriteAllBytes((Join-Path $OutputDirectory 'hermes-dashboard.exe'), [IO.File]::ReadAllBytes($app))
@"
Hermes Dashboard $version (Windows x64)

安装：双击 $setupName。可使用默认目录，也可选择 D:\Soft\Hermes Dashboard。
备用：直接运行 hermes-dashboard.exe（无需安装，电脑需已有 WebView2）。
请从此正常用户目录运行，不要从开发工作区的 release/target 目录运行旧包。
程序未签名；请核对来源。不要关闭安全软件，也不要删除个人配置。
此客户端连接远程 Hermes，不包含本机 Python 后端。
"@ | Set-Content -LiteralPath (Join-Path $OutputDirectory '使用说明.txt') -Encoding utf8BOM
Get-ChildItem -LiteralPath $OutputDirectory -Filter '*.exe' | Get-FileHash -Algorithm SHA256 | ForEach-Object {
    "$($_.Hash.ToLowerInvariant())  $([IO.Path]::GetFileName($_.Path))"
} | Set-Content -LiteralPath (Join-Path $OutputDirectory 'SHA256SUMS.txt') -Encoding ascii
# ZIP carries bytes, not NTFS integrity labels. Extract into a normal Downloads/Desktop folder.
$archive = Join-Path $OutputDirectory "Hermes-Dashboard-$version-windows-x64.zip"
$files = @(Get-ChildItem -LiteralPath $OutputDirectory -File | Select-Object -ExpandProperty FullName)
Compress-Archive -LiteralPath $files -DestinationPath $archive
Write-Output "Published: $OutputDirectory"
Write-Output "Run desktop/test-installer.ps1 against the published setup before delivery."
