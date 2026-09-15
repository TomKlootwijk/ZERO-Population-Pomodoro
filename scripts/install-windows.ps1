param([switch]$ReplaceFocusPatrol, [switch]$NoLaunch, [switch]$Update)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$packageRoot = Join-Path $projectRoot 'dist\ZERO-win32-x64'
$installRoot = Join-Path $env:LOCALAPPDATA 'Programs\ZERO'
$zeroExe = Join-Path $installRoot 'ZERO.exe'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$backupRoot = Join-Path $env:LOCALAPPDATA 'ZERO\migration'
if ($ReplaceFocusPatrol -and $NoLaunch) { throw 'Replacement requires launching and verifying ZERO first.' }

if (-not (Test-Path -LiteralPath (Join-Path $packageRoot 'ZERO.exe'))) {
    throw 'Build the Windows package first: npm run package:windows'
}
$runningZero = @(Get-Process -Name ZERO -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $zeroExe })
if ($runningZero.Count) {
    if (-not $Update) { throw 'Quit ZERO from its tray menu before updating, or pass -Update.' }
    Start-Process -FilePath $zeroExe -ArgumentList '--quit-for-update' -WindowStyle Hidden | Out-Null
    $deadline = (Get-Date).AddSeconds(8)
    do {
        Start-Sleep -Milliseconds 250
        $runningZero = @(Get-Process -Name ZERO -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $zeroExe })
    } while ($runningZero.Count -and (Get-Date) -lt $deadline)
    # Version 1.1 did not support the graceful update command. Its wall-clock
    # deadline is already saved and catches up when the replacement launches.
    if ($runningZero.Count) { $runningZero | Stop-Process -Force; Start-Sleep -Seconds 1 }
}
New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
Get-ChildItem -LiteralPath $packageRoot | Copy-Item -Destination $installRoot -Recurse -Force

$wsh = New-Object -ComObject WScript.Shell
foreach ($folder in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
    $shortcut = $wsh.CreateShortcut((Join-Path $folder 'ZERO.lnk'))
    $shortcut.TargetPath = $zeroExe
    $shortcut.WorkingDirectory = $installRoot
    $shortcut.Description = 'ZERO population and focus timer'
    $shortcut.IconLocation = "$zeroExe,0"
    $shortcut.Save()
}

if (-not (Test-Path -LiteralPath $runKey)) { New-Item -Path $runKey | Out-Null }
$startupValues = Get-ItemProperty -LiteralPath $runKey
$unrelatedStartup = @{}
foreach ($property in $startupValues.PSObject.Properties) {
    if ($property.Name -notmatch '^PS' -and $property.Name -ne 'ZERO' -and
        (-not $ReplaceFocusPatrol -or $property.Name -ne 'FocusPatrolPomodoro')) {
        $unrelatedStartup[$property.Name] = $property.Value
    }
}
$oldFocus = $startupValues.FocusPatrolPomodoro
$oldZero = $startupValues.ZERO
if ($ReplaceFocusPatrol -and $oldFocus) {
    if ($oldFocus -notmatch '^"([^"]+\\FocusPatrol\.exe)"\s*$') {
        throw 'Unexpected FocusPatrol startup command. Installation copied; startup left unchanged.'
    }
    $focusExe = $Matches[1]
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
    $backupFile = Join-Path $backupRoot ('focuspatrol-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')
    @{savedAt = (Get-Date).ToString('o'); key = $runKey; name = 'FocusPatrolPomodoro'; command = $oldFocus; executable = $focusExe} |
        ConvertTo-Json | Set-Content -LiteralPath $backupFile -Encoding utf8
}
try {
    Set-ItemProperty -Path $runKey -Name 'ZERO' -Value ('"' + $zeroExe + '" --startup')
    if (-not $NoLaunch) {
        Start-Process -FilePath $zeroExe -ArgumentList '--configure-desktop' -WorkingDirectory $installRoot
        Start-Sleep -Seconds 3
        if (-not (Get-Process -Name ZERO -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $zeroExe -and $_.MainWindowHandle -ne 0 })) {
            throw 'ZERO did not remain running. FocusPatrol has been left active.'
        }
    }
} catch {
    if ($null -ne $oldZero) { Set-ItemProperty -Path $runKey -Name 'ZERO' -Value $oldZero }
    else { Remove-ItemProperty -Path $runKey -Name 'ZERO' -ErrorAction SilentlyContinue }
    throw
}

if ($ReplaceFocusPatrol -and $oldFocus) {
    # Limit the replacement to the exact executable registered by FocusPatrol.
    Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $focusExe } | ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force
    }
    Remove-ItemProperty -Path $runKey -Name 'FocusPatrolPomodoro'
    Write-Output "FocusPatrol startup backed up: $backupFile"
}
$finalStartup = Get-ItemProperty -LiteralPath $runKey
foreach ($name in $unrelatedStartup.Keys) {
    if ($finalStartup.$name -cne $unrelatedStartup[$name]) { throw "Unrelated startup entry changed: $name" }
}
Write-Output "Installed ZERO: $zeroExe"
Write-Output 'ZERO starts when this Windows account signs in. Desktop and Start menu shortcuts created.'
