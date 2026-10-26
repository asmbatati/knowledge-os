# Start the Knowledge OS when the owner logs in (the vault's x/SYSTEM/Study Coach Plan 2026-10.md, decision 7).
#
#   powershell -NoProfile -File autostart.ps1 -Install   # register \Vault\knowledge-os-server: at logon, hidden,
#                                                        # restarted if it stops; it does not start it now
#   powershell -NoProfile -File autostart.ps1 -Status    # is it registered, and is the site answering on its port
#   powershell -NoProfile -File autostart.ps1 -Remove    # unregister it
#
# It is not a vault job: it takes no job lock and runs no model on its own. register_jobs.ps1 registers and
# unregisters only the jobs it lists, and the jobs' watcher reads their logs, so this task sits beside them without
# being one. The site still gives way to the night jobs as it always has (the quiet hours, a bank never written while
# a job runs). If HOME's servers panel starts it while this one runs, the second finds the port taken and stops.

param([switch]$Install, [switch]$Remove, [switch]$Status)

$ErrorActionPreference = 'Stop'
$TaskPath = '\Vault\'
$Name = 'knowledge-os-server'
$Site = $PSScriptRoot
$Port = 4190
try { $Port = [int]((Get-Content -Raw (Join-Path $Site 'knowledge-os.json') | ConvertFrom-Json).port) } catch {}

function Find-PythonW {
    $py = (Get-Command python -ErrorAction SilentlyContinue).Source
    if ($py) {
        $w = Join-Path (Split-Path $py) 'pythonw.exe'
        if (Test-Path $w) { return $w }
    }
    $w = (Get-Command pythonw -ErrorAction SilentlyContinue).Source
    if ($w) { return $w }
    throw 'pythonw.exe was not found: install Python, or put it on PATH'
}

if ($Install) {
    $pyw = Find-PythonW
    # --wait-for-vault: a vault on Google Drive may not be mounted when the logon task runs (22 Oct 2026: the site stopped
    # with "no learning road" and stayed down all day), so the server waits up to 30 minutes for it instead.
    $action = New-ScheduledTaskAction -Execute $pyw -Argument ('"' + (Join-Path $Site 'server.py') + '" --wait-for-vault 1800') -WorkingDirectory $Site
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
        -MultipleInstances IgnoreNew
    Unregister-ScheduledTask -TaskName $Name -TaskPath $TaskPath -Confirm:$false -ErrorAction SilentlyContinue
    Register-ScheduledTask -TaskName $Name -TaskPath $TaskPath -Action $action -Trigger $trigger -Settings $settings `
        -Description ('Not a job: the Knowledge OS site (' + $Site + '), started at logon on 127.0.0.1:' + $Port +
                      '. Study Coach Plan 2026-10, decision 7. Remove with autostart.ps1 -Remove.') | Out-Null
    Write-Output "registered  $TaskPath$Name  (at logon: $pyw server.py, port $Port)"
    return
}

if ($Remove) {
    Unregister-ScheduledTask -TaskName $Name -TaskPath $TaskPath -Confirm:$false -ErrorAction SilentlyContinue
    Write-Output "removed  $TaskPath$Name"
    return
}

$t = Get-ScheduledTask -TaskName $Name -TaskPath $TaskPath -ErrorAction SilentlyContinue
$listening = [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
if ($t) {
    $i = $t | Get-ScheduledTaskInfo
    Write-Output ("{0}{1}: {2}, last run {3}, result {4}; port {5} {6}" -f $TaskPath, $Name, $t.State, $i.LastRunTime,
        $i.LastTaskResult, $Port, $(if ($listening) { 'answering' } else { 'not listening' }))
} else {
    Write-Output ("{0}{1}: not registered; port {2} {3}" -f $TaskPath, $Name, $Port,
        $(if ($listening) { 'answering (started another way)' } else { 'not listening' }))
}
