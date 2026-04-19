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

function Get-EnvFileValue {
  param(
    [string]$LiteralPath,
    [string]$Key,
    [string]$Fallback
  )

  if (-not (Test-Path -LiteralPath $LiteralPath)) {
    return $Fallback
  }

  foreach ($line in Get-Content -LiteralPath $LiteralPath) {
    if ($line -match "^\s*$([regex]::Escape($Key))=(.*)$") {
      $value = $Matches[1].Trim()
      if ($value.StartsWith('"') -and $value.EndsWith('"')) {
        return $value.Trim('"')
      }

      return $value
    }
  }

  return $Fallback
}

function Invoke-Docker {
  param([string[]]$DockerArgs)

  $stdoutPath = [System.IO.Path]::GetTempFileName()
  $stderrPath = [System.IO.Path]::GetTempFileName()

  try {
    $process = Start-Process -FilePath "docker" `
      -ArgumentList $DockerArgs `
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
      throw "docker failed: $($output -join [Environment]::NewLine)"
    }

    return @($output)
  } finally {
    Remove-Item -LiteralPath $stdoutPath, $stderrPath -ErrorAction SilentlyContinue
  }
}

function Get-DockerImageId {
  param([string]$ImageName)

  $result = @(Invoke-Docker -DockerArgs @("image", "inspect", "--format", "{{.Id}}", $ImageName))
  return ($result | Select-Object -First 1).Trim()
}

function Build-DockerImage {
  param(
    [string]$DockerfilePath,
    [string]$ImageTag,
    [string]$BuildContext,
    [string[]]$BuildArgs = @()
  )

  $dockerArgs = @("build", "-f", $DockerfilePath, "-t", $ImageTag)
  foreach ($arg in $BuildArgs) {
    $dockerArgs += @("--build-arg", $arg)
  }
  $dockerArgs += $BuildContext

  $null = Invoke-Docker -DockerArgs $dockerArgs
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
$servicesToComposeBuild = @($Services)

if ($Services -contains "python-service") {
  $pythonVoiceBaseImage = Get-EnvFileValue `
    -LiteralPath $script:EnvFile `
    -Key "PYTHON_VOICE_BASE_IMAGE" `
    -Fallback "stock-screening-boost-python-voice-base:local"
  $composeProjectName = Get-EnvFileValue `
    -LiteralPath $script:EnvFile `
    -Key "COMPOSE_PROJECT_NAME" `
    -Fallback "stock-screening-boost"
  $installRefchecker = Get-EnvFileValue `
    -LiteralPath $script:EnvFile `
    -Key "REFCHECKER_ENABLED" `
    -Fallback "false"
  $pythonVoiceBaseDockerfile = Assert-RequiredPath `
    -LiteralPath (Join-Path $deployMainRoot "deploy/python/Dockerfile.voice-base") `
    -DisplayPath ".worktrees/deploy-main/deploy/python/Dockerfile.voice-base"
  $pythonServiceDockerfile = Assert-RequiredPath `
    -LiteralPath (Join-Path $deployMainRoot "deploy/python/Dockerfile") `
    -DisplayPath ".worktrees/deploy-main/deploy/python/Dockerfile"

  Write-Host "Building python voice base image..."
  Build-DockerImage `
    -DockerfilePath $pythonVoiceBaseDockerfile `
    -ImageTag $pythonVoiceBaseImage `
    -BuildContext $deployMainRoot `
    -BuildArgs @(
      "INSTALL_REFCHECKER=$installRefchecker"
    )

  $pythonVoiceBaseImageId = Get-DockerImageId -ImageName $pythonVoiceBaseImage
  if ([string]::IsNullOrWhiteSpace($pythonVoiceBaseImageId)) {
    throw "Failed to resolve local python voice base image id for '$pythonVoiceBaseImage'."
  }

  $pythonServiceImage = "$composeProjectName-python-service"
  Write-Host "Building python-service image from local voice base..."
  Build-DockerImage `
    -DockerfilePath $pythonServiceDockerfile `
    -ImageTag $pythonServiceImage `
    -BuildContext $deployMainRoot `
    -BuildArgs @(
      "PYTHON_VOICE_BASE_IMAGE=$pythonVoiceBaseImageId"
      "INSTALL_REFCHECKER=$installRefchecker"
    )

  $servicesToComposeBuild = @($Services | Where-Object { $_ -ne "python-service" })
}

Write-Host "Validating docker compose configuration..."
$null = Invoke-Compose -ComposeArgs @("config")

Write-Host "Starting target services..."
if ($Services -contains "python-service") {
  $null = Invoke-Compose -ComposeArgs @("up", "-d", "--no-build", "python-service")
}
if ($servicesToComposeBuild.Count -gt 0) {
  $null = Invoke-Compose -ComposeArgs (@("up", "-d", "--build") + $servicesToComposeBuild)
}

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
