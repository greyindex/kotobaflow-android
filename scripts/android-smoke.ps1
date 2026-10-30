[CmdletBinding()]
param(
  [string]$Serial = 'emulator-5554',
  [string]$ApkPath = '',
  [string]$PackageName = 'lol.kotobaflow.app',
  [int]$WaitSeconds = 6,
  [string]$OutputDirectory = ''
)

$ErrorActionPreference = 'Stop'

# Windows PowerShell 5.1 can leave $PSScriptRoot empty in param() defaults.
if (-not $ApkPath) {
  $ApkPath = Join-Path $PSScriptRoot '..\android\app\build\outputs\apk\debug\app-debug.apk'
}
if (-not $OutputDirectory) {
  $OutputDirectory = Join-Path $PSScriptRoot '..\artifacts\android-smoke'
}

$adbPath = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
$resolvedApkPath = [System.IO.Path]::GetFullPath($ApkPath)
$resolvedOutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)

if (-not (Test-Path -LiteralPath $adbPath -PathType Leaf)) {
  throw "找不到 adb：$adbPath"
}
if (-not (Test-Path -LiteralPath $resolvedApkPath -PathType Leaf)) {
  throw "找不到 APK：$resolvedApkPath"
}

# Windows PowerShell 5.1 turns native stderr into a terminating error under
# Stop even when it is discarded; the state text is checked instead.
$ErrorActionPreference = 'Continue'
$deviceState = "$(& $adbPath -s $Serial get-state 2>$null)".Trim()
$ErrorActionPreference = 'Stop'
if ($deviceState -ne 'device') {
  throw "设备 $Serial 不可用，当前状态：$deviceState"
}

New-Item -ItemType Directory -Force -Path $resolvedOutputDirectory | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$logPath = Join-Path $resolvedOutputDirectory "$stamp-logcat.txt"
$screenshotPath = Join-Path $resolvedOutputDirectory "$stamp-screen.png"
$activityPath = Join-Path $resolvedOutputDirectory "$stamp-activity.txt"
$resultPath = Join-Path $resolvedOutputDirectory "$stamp-result.json"

& $adbPath -s $Serial install -r $resolvedApkPath
& $adbPath -s $Serial logcat -c
& $adbPath -s $Serial shell am force-stop $PackageName
& $adbPath -s $Serial shell monkey -p $PackageName -c android.intent.category.LAUNCHER 1
Start-Sleep -Seconds ([Math]::Max(1, $WaitSeconds))

# 5.1's `>` re-encodes native output as text; copy the PNG bytes directly.
$startInfo = New-Object System.Diagnostics.ProcessStartInfo
$startInfo.FileName = $adbPath
$startInfo.Arguments = "-s $Serial exec-out screencap -p"
$startInfo.UseShellExecute = $false
$startInfo.RedirectStandardOutput = $true
$screencap = [System.Diagnostics.Process]::Start($startInfo)
$screenshotFile = [System.IO.File]::Create($screenshotPath)
try {
  $screencap.StandardOutput.BaseStream.CopyTo($screenshotFile)
} finally {
  $screenshotFile.Dispose()
}
$screencap.WaitForExit()
$activityOutput = (& $adbPath -s $Serial shell dumpsys activity activities) -join [Environment]::NewLine
$logOutput = (& $adbPath -s $Serial logcat -d -v threadtime) -join [Environment]::NewLine
$activityOutput | Set-Content -LiteralPath $activityPath -Encoding utf8
$logOutput | Set-Content -LiteralPath $logPath -Encoding utf8

$fatalMarkers = @(
  $logOutput -split "`r?`n" |
    Where-Object {
      $_ -match 'FATAL EXCEPTION|Process: ' + [Regex]::Escape($PackageName)
    }
)
$resumed = @(
  $activityOutput -split "`r?`n" |
    Where-Object { $_ -match 'mResumedActivity|topResumedActivity' }
)
$result = [ordered]@{
  timestamp = $stamp
  serial = $Serial
  package = $PackageName
  apk = $resolvedApkPath
  waitSeconds = $WaitSeconds
  screenshot = $screenshotPath
  activityDump = $activityPath
  logcat = $logPath
  resumedActivity = $resumed
  fatalMarkers = $fatalMarkers
  passed = $fatalMarkers.Count -eq 0 -and ($resumed -join "`n") -match [Regex]::Escape($PackageName)
}
$result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $resultPath -Encoding utf8
$result.result = $resultPath
$result | ConvertTo-Json -Depth 5

if (-not $result.passed) {
  throw "Android 冷启动烟测失败，详见：$resultPath"
}
