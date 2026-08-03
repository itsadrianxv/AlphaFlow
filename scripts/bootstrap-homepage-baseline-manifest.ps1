param(
    [string]$TargetTradeDate = $env:HOMEPAGE_BOOTSTRAP_TARGET_TRADE_DATE
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $repoRoot "docker\docker-compose.yml"
$arguments = @("compose", "-f", $composeFile, "exec", "-T", "web", "npm", "run", "homepage:bootstrap-baseline", "--")

if ($TargetTradeDate) {
    $arguments += "--target-trade-date=$TargetTradeDate"
}

& docker @arguments
