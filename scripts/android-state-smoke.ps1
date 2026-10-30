[CmdletBinding()]
param(
  [string]$Serial = 'emulator-5554',
  [string]$ApkPath = '',
  [string]$PackageName = 'lol.kotobaflow.app',
  [int]$WaitSeconds = 5,
  [string]$OutputDirectory = '',
  [switch]$AllowPhysical
)

$ErrorActionPreference = 'Stop'

# Windows PowerShell 5.1 can leave $PSScriptRoot empty in param() defaults.
if (-not $ApkPath) {
  $ApkPath = Join-Path $PSScriptRoot '..\android\app\build\outputs\apk\debug\app-debug.apk'
}
if (-not $OutputDirectory) {
  $OutputDirectory = Join-Path $PSScriptRoot '..\artifacts\android-state-smoke'
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
if (-not $AllowPhysical -and $Serial -notmatch '^emulator-') {
  throw "状态烟测默认只允许模拟器：$Serial；如需真机验收请显式传入 -AllowPhysical。"
}

function Invoke-AdbCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  # Windows PowerShell 5.1 turns redirected native stderr into an error record,
  # which Stop makes terminating; failures are judged by the exit code instead.
  $ErrorActionPreference = 'Continue'
  $output = & $adbPath -s $Serial @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "ADB 命令失败 [$($Arguments -join ' ')]：$($output -join [Environment]::NewLine)"
  }
  return ($output | ForEach-Object { "$_" }) -join [Environment]::NewLine
}

# 5.1's `>` re-encodes native output as text; copy the PNG bytes directly.
function Save-DeviceScreenshot {
  param(
    [Parameter(Mandatory = $true)][string]$Path
  )

  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $adbPath
  $startInfo.Arguments = "-s $Serial exec-out screencap -p"
  $startInfo.UseShellExecute = $false
  $startInfo.RedirectStandardOutput = $true
  $process = [System.Diagnostics.Process]::Start($startInfo)
  $file = [System.IO.File]::Create($Path)
  try {
    $process.StandardOutput.BaseStream.CopyTo($file)
  } finally {
    $file.Dispose()
  }
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) {
    throw "截图失败：$Path"
  }
}

function Set-DeviceSetting {
  param(
    [Parameter(Mandatory = $true)][string]$Namespace,
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Value
  )

  Invoke-AdbCommand -Arguments @('shell', 'settings', 'put', $Namespace, $Name, $Value) | Out-Null
}

function Get-DeviceSetting {
  param(
    [Parameter(Mandatory = $true)][string]$Namespace,
    [Parameter(Mandatory = $true)][string]$Name
  )

  return (Invoke-AdbCommand -Arguments @('shell', 'settings', 'get', $Namespace, $Name)).Trim()
}

function Restore-DeviceSetting {
  param(
    [Parameter(Mandatory = $true)][string]$Namespace,
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Value
  )

  if ([string]::IsNullOrWhiteSpace($Value) -or $Value -eq 'null') {
    # Deleting font_scale while another scale is active makes Android write
    # 1.0 back once the configuration change settles; delete again until the
    # setting stays unset.
    for ($attempt = 0; $attempt -lt 3; $attempt++) {
      Invoke-AdbCommand -Arguments @('shell', 'settings', 'delete', $Namespace, $Name) | Out-Null
      Start-Sleep -Seconds 2
      if ((Get-DeviceSetting -Namespace $Namespace -Name $Name) -eq 'null') {
        return
      }
    }
    throw "$Namespace/$Name 删除后仍有值：$(Get-DeviceSetting -Namespace $Namespace -Name $Name)"
  } else {
    Set-DeviceSetting -Namespace $Namespace -Name $Name -Value $Value
  }
}

function Get-NightMode {
  $output = Invoke-AdbCommand -Arguments @('shell', 'cmd', 'uimode', 'night')
  $match = [Regex]::Match($output, 'Night mode:\s*(yes|no|auto)')
  if ($match.Success) {
    return $match.Groups[1].Value
  }
  return 'unknown'
}

function Set-NightMode {
  param(
    [Parameter(Mandatory = $true)][ValidateSet('yes', 'no', 'auto')][string]$Mode
  )

  Invoke-AdbCommand -Arguments @('shell', 'cmd', 'uimode', 'night', $Mode) | Out-Null
}

function Get-ActivitySnapshot {
  $activity = Invoke-AdbCommand -Arguments @('shell', 'dumpsys', 'activity', 'activities')
  $logcat = Invoke-AdbCommand -Arguments @('shell', 'logcat', '-d', '-v', 'threadtime')
  $resumed = @(
    $activity -split "`r?`n" |
      Where-Object {
        $_ -match 'mResumedActivity|topResumedActivity' -and
        $_ -match [Regex]::Escape($PackageName)
      }
  )
  $fatalMarkers = @(
    $logcat -split "`r?`n" |
      Where-Object {
        $_ -match 'FATAL EXCEPTION|Process: ' + [Regex]::Escape($PackageName)
      }
  )
  return [ordered]@{
    activity = $activity
    logcat = $logcat
    resumed = $resumed
    fatalMarkers = $fatalMarkers
    passed = $fatalMarkers.Count -eq 0 -and ($resumed -join "`n") -match [Regex]::Escape($PackageName)
  }
}

function Save-AppObservation {
  param(
    [Parameter(Mandatory = $true)][string]$Label
  )

  $activityPath = Join-Path $resolvedOutputDirectory "$Label-activity.txt"
  $logPath = Join-Path $resolvedOutputDirectory "$Label-logcat.txt"
  $screenshotPath = Join-Path $resolvedOutputDirectory "$Label-screen.png"
  $snapshot = Get-ActivitySnapshot
  $snapshot.activity | Set-Content -LiteralPath $activityPath -Encoding utf8
  $snapshot.logcat | Set-Content -LiteralPath $logPath -Encoding utf8
  Save-DeviceScreenshot -Path $screenshotPath
  return [ordered]@{
    activityPath = $activityPath
    logPath = $logPath
    screenshotPath = $screenshotPath
    resumed = $snapshot.resumed
    fatalMarkers = $snapshot.fatalMarkers
    passed = $snapshot.passed
  }
}

function Start-AppAndObserve {
  param(
    [Parameter(Mandatory = $true)][string]$Label
  )

  Invoke-AdbCommand -Arguments @('shell', 'logcat', '-c') | Out-Null
  Invoke-AdbCommand -Arguments @('shell', 'am', 'force-stop', $PackageName) | Out-Null
  Invoke-AdbCommand -Arguments @('shell', 'monkey', '-p', $PackageName, '-c', 'android.intent.category.LAUNCHER', '1') | Out-Null
  Start-Sleep -Seconds ([Math]::Max(1, $WaitSeconds))
  return Save-AppObservation -Label $Label
}

function Get-CurrentRotation {
  $display = Invoke-AdbCommand -Arguments @('shell', 'dumpsys', 'display')
  $viewportMatch = [Regex]::Match($display, 'mViewports=.*?orientation=(\d+)')
  if ($viewportMatch.Success) {
    return [int]$viewportMatch.Groups[1].Value
  }
  $overrideMatch = [Regex]::Match($display, 'mOverrideDisplayInfo=.*?rotation (\d+)')
  if ($overrideMatch.Success) {
    return [int]$overrideMatch.Groups[1].Value
  }
  return -1
}

function Get-InputMethodVisible {
  $inputMethod = Invoke-AdbCommand -Arguments @('shell', 'dumpsys', 'input_method')
  $currentLine = @(
    $inputMethod -split "`r?`n" |
      Where-Object { $_ -match 'mShowRequested=.*mInputShown=(true|false)' }
  ) | Select-Object -Last 1
  return [ordered]@{
    shown = $null -ne $currentLine -and $currentLine -match 'mInputShown=true'
    stateLine = [string]$currentLine
  }
}

New-Item -ItemType Directory -Force -Path $resolvedOutputDirectory | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$resultPath = Join-Path $resolvedOutputDirectory "$stamp-result.json"
$observations = [ordered]@{}
$failures = [System.Collections.Generic.List[string]]::new()

$oldFontScale = Get-DeviceSetting -Namespace 'system' -Name 'font_scale'
$oldAccelerometerRotation = Get-DeviceSetting -Namespace 'system' -Name 'accelerometer_rotation'
$oldUserRotation = Get-DeviceSetting -Namespace 'system' -Name 'user_rotation'
$oldNightMode = Get-NightMode
$screenWidth = 1080
$screenHeight = 2400
$screenDensity = 420

try {
  # An override (wm size / wm density) is what the app actually sees.
  $wmSize = Invoke-AdbCommand -Arguments @('shell', 'wm', 'size')
  $sizeMatch = [Regex]::Match($wmSize, 'Override size: (\d+)x(\d+)')
  if (-not $sizeMatch.Success) { $sizeMatch = [Regex]::Match($wmSize, 'Physical size: (\d+)x(\d+)') }
  if ($sizeMatch.Success) {
    $screenWidth = [int]$sizeMatch.Groups[1].Value
    $screenHeight = [int]$sizeMatch.Groups[2].Value
  }
  $wmDensity = Invoke-AdbCommand -Arguments @('shell', 'wm', 'density')
  $densityMatch = [Regex]::Match($wmDensity, 'Override density: (\d+)')
  if (-not $densityMatch.Success) { $densityMatch = [Regex]::Match($wmDensity, 'Physical density: (\d+)') }
  if ($densityMatch.Success) {
    $screenDensity = [int]$densityMatch.Groups[1].Value
  }
  # Phones (shorter side under 600 dp) stay in portrait; tablets turn.
  $shortestDp = [Math]::Floor([Math]::Min($screenWidth, $screenHeight) * 160 / $screenDensity)
  $phoneScreen = $shortestDp -lt 600

  $observations.baseline = Start-AppAndObserve -Label "$stamp-baseline"
  if (-not $observations.baseline.passed) {
    $failures.Add('baseline launch')
  }

  $searchX = [int]($screenWidth * 0.815)
  $searchY = [int]($screenHeight * 0.071)
  Invoke-AdbCommand -Arguments @('shell', 'input', 'tap', "$searchX", "$searchY") | Out-Null
  Start-Sleep -Seconds 2
  $keyboardShown = Get-InputMethodVisible
  $observations.keyboard = [ordered]@{
    tap = [ordered]@{ x = $searchX; y = $searchY }
    shown = $keyboardShown
  }
  if (-not $keyboardShown.shown) {
    $failures.Add('keyboard did not become visible after tapping global search')
  } else {
    Invoke-AdbCommand -Arguments @('shell', 'input', 'text', 'koto') | Out-Null
    Invoke-AdbCommand -Arguments @('shell', 'input', 'keyevent', '4') | Out-Null
    Start-Sleep -Seconds 1
    $keyboardHidden = Get-InputMethodVisible
    $observations.keyboard.hiddenAfterBack = $keyboardHidden
    if ($keyboardHidden.shown) {
      $failures.Add('keyboard remained visible after Android back')
    }
    Invoke-AdbCommand -Arguments @('shell', 'input', 'keyevent', '4') | Out-Null
    Start-Sleep -Seconds 1
    $observations.keyboard.afterPanelBack = Save-AppObservation -Label "$stamp-keyboard-back"
    if (-not $observations.keyboard.afterPanelBack.passed) {
      $failures.Add('app was not resumed after closing search with Android back')
    }
  }

  Set-DeviceSetting -Namespace 'system' -Name 'accelerometer_rotation' -Value '0'
  Set-DeviceSetting -Namespace 'system' -Name 'user_rotation' -Value '1'
  Start-Sleep -Seconds 3
  # A phone keeps the app upright against the landscape request.
  $expectedLandscapeRotation = if ($phoneScreen) { 0 } else { 1 }
  $observations.landscape = [ordered]@{
    expectedRotation = $expectedLandscapeRotation
    rotation = Get-CurrentRotation
    app = Save-AppObservation -Label "$stamp-landscape"
  }
  if ($observations.landscape.rotation -ne $expectedLandscapeRotation -or -not $observations.landscape.app.passed) {
    $failures.Add('landscape request')
  }

  Set-DeviceSetting -Namespace 'system' -Name 'user_rotation' -Value '0'
  Start-Sleep -Seconds 3
  $observations.portraitRestore = [ordered]@{
    rotation = Get-CurrentRotation
    app = Save-AppObservation -Label "$stamp-portrait-restore"
  }
  if ($observations.portraitRestore.rotation -ne 0 -or -not $observations.portraitRestore.app.passed) {
    $failures.Add('portrait restore')
  }

  Invoke-AdbCommand -Arguments @('shell', 'input', 'keyevent', '3') | Out-Null
  Start-Sleep -Seconds 2
  Invoke-AdbCommand -Arguments @('shell', 'am', 'start', '-W', '-n', "$PackageName/.MainActivity") | Out-Null
  Start-Sleep -Seconds ([Math]::Max(1, $WaitSeconds))
  $observations.backgroundRestore = Save-AppObservation -Label "$stamp-background-restore"
  if (-not $observations.backgroundRestore.passed) {
    $failures.Add('background restore')
  }

  Set-NightMode -Mode 'yes'
  $observations.darkMode = [ordered]@{
    mode = Get-NightMode
    app = Start-AppAndObserve -Label "$stamp-dark-mode"
  }
  if ($observations.darkMode.mode -ne 'yes' -or -not $observations.darkMode.app.passed) {
    $failures.Add('dark mode launch')
  }
  if ($oldNightMode -in @('yes', 'no', 'auto')) {
    Set-NightMode -Mode $oldNightMode
  }
  Start-Sleep -Seconds 2

  $fontResults = [ordered]@{}
  foreach ($scale in @('1.0', '1.15', '1.3')) {
    Set-DeviceSetting -Namespace 'system' -Name 'font_scale' -Value $scale
    $fontResults[$scale] = Start-AppAndObserve -Label "$stamp-font-$($scale.Replace('.', '_'))"
    if (-not $fontResults[$scale].passed) {
      $failures.Add("font scale $scale launch")
    }
  }
  $observations.fontScale = $fontResults
} catch {
  $failures.Add($_.Exception.Message)
} finally {
  try { Restore-DeviceSetting -Namespace 'system' -Name 'font_scale' -Value $oldFontScale } catch { $failures.Add("restore font_scale: $($_.Exception.Message)") }
  try { Restore-DeviceSetting -Namespace 'system' -Name 'accelerometer_rotation' -Value $oldAccelerometerRotation } catch { $failures.Add("restore accelerometer_rotation: $($_.Exception.Message)") }
  try { Restore-DeviceSetting -Namespace 'system' -Name 'user_rotation' -Value $oldUserRotation } catch { $failures.Add("restore user_rotation: $($_.Exception.Message)") }
  try {
    if ($oldNightMode -in @('yes', 'no', 'auto')) {
      Set-NightMode -Mode $oldNightMode
    }
  } catch { $failures.Add("restore night mode: $($_.Exception.Message)") }
}

$passed = $failures.Count -eq 0
$result = [ordered]@{
  timestamp = $stamp
  serial = $Serial
  package = $PackageName
  apk = $resolvedApkPath
  outputDirectory = $resolvedOutputDirectory
  originalSettings = [ordered]@{
    fontScale = $oldFontScale
    accelerometerRotation = $oldAccelerometerRotation
    userRotation = $oldUserRotation
    nightMode = $oldNightMode
  }
  restoredSettings = [ordered]@{
    fontScale = Get-DeviceSetting -Namespace 'system' -Name 'font_scale'
    accelerometerRotation = Get-DeviceSetting -Namespace 'system' -Name 'accelerometer_rotation'
    userRotation = Get-DeviceSetting -Namespace 'system' -Name 'user_rotation'
    nightMode = Get-NightMode
  }
  screen = [ordered]@{ width = $screenWidth; height = $screenHeight; density = $screenDensity; shortestDp = $shortestDp; phone = $phoneScreen }
  observations = $observations
  failures = $failures
  passed = $passed
}
$result | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $resultPath -Encoding utf8
$result.result = $resultPath
$result | ConvertTo-Json -Depth 10

if (-not $passed) {
  throw "Android 状态烟测失败，详见：$resultPath"
}
exit 0
