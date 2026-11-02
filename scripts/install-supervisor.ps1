param([switch]$Remove)
$ErrorActionPreference = 'Stop'
$taskName = 'WindowsExecutorSupervisor'
$executorRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$expectedArguments = '"' + (Join-Path $executorRoot 'src\supervisor.mjs') + '"'
$schedule = New-Object -ComObject Schedule.Service
$schedule.Connect()
$taskFolder = $schedule.GetFolder('\')
$existing = $null
try { $existing = $taskFolder.GetTask($taskName) }
catch { if ($_.Exception.HResult -ne -2147024894) { throw } }
if ($null -ne $existing) {
    $actions = $existing.Definition.Actions
    if ($actions.Count -ne 1 -or $actions.Item(1).Arguments -ne $expectedArguments -or $actions.Item(1).WorkingDirectory -ne $executorRoot) {
        throw 'This scheduled-task name belongs to another installation. Manage it from that installation first.'
    }
}
if ($Remove) {
    if ($null -eq $existing) { Write-Output 'Supervisor scheduled task is not installed.'; exit }
    if ($existing.State -eq 4) { $existing.Stop(0) }
    $taskFolder.DeleteTask($taskName,0)
    Write-Output 'Supervisor scheduled task removed. Jobs and results were preserved.'
    exit
}
$nodePath = (Get-Command node.exe).Source
$task = $schedule.NewTask(0)
$task.RegistrationInfo.Description = 'Resume saved meputer-use jobs in the current user interactive session. Idle without jobs.'
$task.Principal.UserId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$task.Principal.LogonType = 3
$task.Principal.RunLevel = 0
$task.Settings.Enabled = $true
$task.Settings.Hidden = $true
$task.Settings.ExecutionTimeLimit = 'PT0S'
$task.Settings.DisallowStartIfOnBatteries = $false
$task.Settings.StopIfGoingOnBatteries = $false
$task.Settings.StartWhenAvailable = $true
$task.Settings.MultipleInstances = 2
$task.Settings.RestartCount = 3
$task.Settings.RestartInterval = 'PT1M'
$trigger = $task.Triggers.Create(9)
$trigger.UserId = $task.Principal.UserId
$trigger.Delay = 'PT30S'
$action = $task.Actions.Create(0)
$action.Path = $nodePath
$action.Arguments = $expectedArguments
$action.WorkingDirectory = $executorRoot
$registered = $taskFolder.RegisterTaskDefinition($taskName,$task,6,$task.Principal.UserId,$null,3)
$null = $registered.Run($null)
Write-Output 'Supervisor installed and started. Saved active jobs can resume at Windows sign-in.'
