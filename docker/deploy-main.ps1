[CmdletBinding()]
param(
  [string[]]$Services = @(),
  [string[]]$RequiredEnv = @()
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Split-ListArgument {
  param([string[]]$Values)

  $result = @()
  foreach ($value in $Values) {
    if ([string]::IsNullOrWhiteSpace($value)) {
      continue
    }

    $result += $value.Split(",", [System.StringSplitOptions]::RemoveEmptyEntries) |
      ForEach-Object { $_.Trim() } |
      Where-Object { $_ }
  }

  return @($result)
}

function Assert-RequiredPath {
  param(
    [string]$LiteralPath,
    [string]$DisplayPath
  )

  if (-not (Test-Path -LiteralPath $LiteralPath)) {
    throw "Missing required path: $DisplayPath"
  }

  return (Resolve-Path -LiteralPath $LiteralPath).Path
}

function Resolve-RepositoryRoot {
  param([string]$FallbackRoot)

  if (-not [string]::IsNullOrWhiteSpace($env:CODEX_DEPLOY_MAIN_REPO_ROOT)) {
    return $env:CODEX_DEPLOY_MAIN_REPO_ROOT
  }

  try {
    $commonDir = & git rev-parse --path-format=absolute --git-common-dir 2>$null

    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($commonDir)) {
      return Split-Path -Parent $commonDir.Trim()
    }
  } catch {
  }

  return $FallbackRoot
}

function Invoke-Compose {
  param([string[]]$ComposeArgs)

  $stdoutPath = [System.IO.Path]::GetTempFileName()
  $stderrPath = [System.IO.Path]::GetTempFileName()

  try {
    $process = Start-Process -FilePath "docker" `
      -ArgumentList (@(
        "compose",
        "--project-directory", $script:ProjectDirectory,
        "-f", $script:ComposeFile,
        "--env-file", $script:EnvFile
      ) + $ComposeArgs) `
      -NoNewWindow `
      -Wait `
      -PassThru `
      -RedirectStandardOutput $stdoutPath `
      -RedirectStandardError $stderrPath

    $output = @()
    if (Test-Path -LiteralPath $stdoutPath) {
      $output += Get-Content -LiteralPath $stdoutPath
    }
    if (Test-Path -LiteralPath $stderrPath) {
      $output += Get-Content -LiteralPath $stderrPath
    }

    if ($process.ExitCode -ne 0) {
      throw "docker compose failed: $($output -join [Environment]::NewLine)"
    }

    return @($output)
  } finally {
    Remove-Item -LiteralPath $stdoutPath, $stderrPath -ErrorAction SilentlyContinue
  }
}

$Services = @(Split-ListArgument -Values $Services)
$RequiredEnv = @(Split-ListArgument -Values $RequiredEnv)

if ($Services.Count -eq 0) {
  throw "At least one service must be provided via -Services."
}

$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-RepositoryRoot -FallbackRoot (Split-Path -Parent $scriptDirectory)
$deployMainRoot = Join-Path $repoRoot ".worktrees/deploy-main"
$composeFilePath = Join-Path $deployMainRoot "deploy/docker-compose.yml"
$envFilePath = Join-Path $deployMainRoot ".env"
$projectDirectoryPath = Join-Path $deployMainRoot "deploy"

$null = Assert-RequiredPath -LiteralPath $deployMainRoot -DisplayPath ".worktrees/deploy-main"
$script:ComposeFile = Assert-RequiredPath `
  -LiteralPath $composeFilePath `
  -DisplayPath ".worktrees/deploy-main/deploy/docker-compose.yml"
$script:EnvFile = Assert-RequiredPath `
  -LiteralPath $envFilePath `
  -DisplayPath ".worktrees/deploy-main/.env"
$script:ProjectDirectory = Assert-RequiredPath `
  -LiteralPath $projectDirectoryPath `
  -DisplayPath ".worktrees/deploy-main/deploy"

Write-Host "Validating docker compose configuration..."
$null = Invoke-Compose -ComposeArgs @("config")

Write-Host "Starting target services..."
$null = Invoke-Compose -ComposeArgs (@("up", "-d", "--build") + $Services)

Write-Host "Checking running services..."
$runningServices = @(Invoke-Compose -ComposeArgs (@("ps", "--services", "--status", "running") + $Services))
$runningLookup = @{}
foreach ($serviceName in $runningServices) {
  if (-not [string]::IsNullOrWhiteSpace($serviceName)) {
    $runningLookup[$serviceName.Trim()] = $true
  }
}

foreach ($service in $Services) {
  if (-not $runningLookup.ContainsKey($service)) {
    throw "Service failed to reach running state: $service"
  }
}

if ($RequiredEnv.Count -gt 0) {
  foreach ($service in $Services) {
    Write-Host "Checking required env vars in $service..."
    $envOutput = @(Invoke-Compose -ComposeArgs @("exec", "-T", $service, "sh", "-lc", "env"))

    foreach ($envName in $RequiredEnv) {
      $escapedName = [regex]::Escape($envName)
      if (-not ($envOutput -join [Environment]::NewLine -match "(?m)^$escapedName=")) {
        throw "Missing required env var '$envName' in service '$service'"
      }
    }
  }
}

Write-Host "deploy-main verification completed successfully."
