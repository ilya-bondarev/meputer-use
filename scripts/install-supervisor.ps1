param([switch]$Remove)
$ErrorActionPreference = 'Stop'
$taskName = 'MeSystemWindowsExecutorSupervisor'
$schedule = New-Object -ComObject Schedule.Service
$schedule.Connect()
$taskFolder = $schedule.GetFolder('\')
if ($Remove) {
    try { $taskFolder.GetTask($taskName).Stop(0) } catch {}
    $taskFolder.DeleteTask($taskName,0)
    Write-Output 'Supervisor scheduled task removed. Jobs and results were preserved.'
    exit
}
$executorRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$nodePath = (Get-Command node.exe).Source
$task = $schedule.NewTask(0)
$task.RegistrationInfo.Description = 'Resume saved Windows Executor jobs in the current user interactive session. Idle without jobs.'
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
$action.Arguments = '"' + (Join-Path $executorRoot 'src\supervisor.mjs') + '"'
$action.WorkingDirectory = $executorRoot
$registered = $taskFolder.RegisterTaskDefinition($taskName,$task,6,$task.Principal.UserId,$null,3)
$null = $registered.Run($null)
Write-Output 'Supervisor installed and started. Saved active jobs can resume at Windows sign-in.'
