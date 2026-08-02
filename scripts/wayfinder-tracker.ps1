$ErrorActionPreference = 'Stop'
$script:JsonDepth = 20
$script:GhCommand = if ($env:WAYFINDER_GH_PATH) { $env:WAYFINDER_GH_PATH } else { 'gh' }
$script:Repository = $null
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

function Write-JsonResult {
    param([Parameter(Mandatory = $true)]$Value)

    $Value | ConvertTo-Json -Depth $script:JsonDepth -Compress
}

function Stop-WayfinderTracker {
    param(
        [Parameter(Mandatory = $true)][string]$Code,
        [Parameter(Mandatory = $true)][string]$Message
    )

    Write-JsonResult ([ordered]@{
        ok = $false
        error = [ordered]@{
            code = $Code
            message = $Message
        }
    })
    exit 1
}

function Invoke-Gh {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        $Body
    )

    if ($script:GhCommand.EndsWith('.ps1', [System.StringComparison]::OrdinalIgnoreCase)) {
        $previousInput = $env:WAYFINDER_GH_STDIN
        try {
            if ($PSBoundParameters.ContainsKey('Body')) {
                $env:WAYFINDER_GH_STDIN = $Body | ConvertTo-Json -Depth $script:JsonDepth -Compress
            }
            else {
                $env:WAYFINDER_GH_STDIN = ''
            }
            $output = & $script:GhCommand @Arguments 2>&1
            $exitCode = 0
        }
        finally {
            $env:WAYFINDER_GH_STDIN = $previousInput
        }
    }
    elseif ($PSBoundParameters.ContainsKey('Body')) {
        $inputJson = $Body | ConvertTo-Json -Depth $script:JsonDepth -Compress
        $temporaryBodyPath = [System.IO.Path]::GetTempFileName()
        try {
            [System.IO.File]::WriteAllText(
                $temporaryBodyPath,
                $inputJson,
                [System.Text.UTF8Encoding]::new($false)
            )
            $inputArguments = @($Arguments)
            $inputIndex = [Array]::IndexOf($inputArguments, '--input')
            if ($inputIndex -lt 0 -or ($inputIndex + 1) -ge $inputArguments.Count) {
                throw 'Body requests must include an --input argument.'
            }
            $inputArguments[$inputIndex + 1] = $temporaryBodyPath
            $output = & $script:GhCommand @inputArguments 2>&1
            $exitCode = $LASTEXITCODE
        }
        finally {
            Remove-Item -LiteralPath $temporaryBodyPath -Force -ErrorAction SilentlyContinue
        }
    }
    else {
        $output = & $script:GhCommand @Arguments 2>&1
        $exitCode = $LASTEXITCODE
    }
    if ($exitCode -ne 0) {
        $details = @($output | ForEach-Object { $_.ToString() }) -join "`n"
        throw "gh failed with exit code ${exitCode}: $details"
    }

    $json = $output | Out-String
    if ([string]::IsNullOrWhiteSpace($json)) {
        return $null
    }
    return $json | ConvertFrom-Json
}

function Get-Repository {
    if ($null -eq $script:Repository) {
        $result = Invoke-Gh -Arguments @('repo', 'view', '--json', 'nameWithOwner')
        if ([string]::IsNullOrWhiteSpace($result.nameWithOwner)) {
            throw 'gh repo view did not return nameWithOwner.'
        }
        $script:Repository = $result.nameWithOwner
    }
    return $script:Repository
}

function Invoke-GhApi {
    param(
        [Parameter(Mandatory = $true)][string]$Method,
        [Parameter(Mandatory = $true)][string]$Endpoint,
        $Body,
        [hashtable]$Query
    )
    $arguments = @(
        'api', '--method', $Method, $Endpoint,
        '-H', 'Accept: application/vnd.github+json',
        '-H', 'X-GitHub-Api-Version: 2022-11-28'
    )
    if ($null -ne $Query) {
        foreach ($name in @($Query.Keys | Sort-Object)) {
            $arguments += @('-f', "$name=$($Query[$name])")
        }
    }
    if ($PSBoundParameters.ContainsKey('Body')) {
        $arguments += @('--input', '-')
        return Invoke-Gh -Arguments $arguments -Body $Body
    }
    return Invoke-Gh -Arguments $arguments
}

function Get-Issue {
    param([Parameter(Mandatory = $true)][int]$Number)

    $repository = Get-Repository
    return Invoke-GhApi -Method GET -Endpoint "repos/$repository/issues/$Number"
}

function Get-SubIssues {
    param([Parameter(Mandatory = $true)][int]$MapNumber)

    $repository = Get-Repository
    $issues = Invoke-GhApi -Method GET -Endpoint "repos/$repository/issues/$MapNumber/sub_issues" -Query @{ per_page = 100 }
    foreach ($issue in @($issues)) {
        foreach ($item in @($issue)) {
            $item
        }
    }
}

function Get-BlockedBy {
    param([Parameter(Mandatory = $true)][int]$TicketNumber)

    $repository = Get-Repository
    $issues = Invoke-GhApi -Method GET -Endpoint "repos/$repository/issues/$TicketNumber/dependencies/blocked_by" -Query @{ per_page = 100 }
    foreach ($issue in @($issues)) {
        foreach ($item in @($issue)) {
            $item
        }
    }
}

function ConvertTo-TicketSummary {
    param([Parameter(Mandatory = $true)]$Issue)

    foreach ($item in @($Issue)) {
        if ($item -is [System.Array]) {
            ConvertTo-TicketSummary -Issue $item
            continue
        }
        [ordered]@{
            number = [int]$item.number
            id = [long]$item.id
            title = $item.title
            state = $item.state
            url = $item.html_url
            assignees = @($item.assignees | ForEach-Object { $_.login })
        }
    }
}

function Write-ChangeResult {
    param(
        [Parameter(Mandatory = $true)][string]$OperationName,
        [Parameter(Mandatory = $true)][string]$RepositoryName,
        [Parameter(Mandatory = $true)][bool]$Changed,
        [Parameter(Mandatory = $true)][hashtable]$Details
    )

    $result = [ordered]@{
        ok = $true
        operation = $OperationName
        repository = $RepositoryName
        changed = $Changed
    }
    foreach ($entry in $Details.GetEnumerator()) {
        $result[$entry.Key] = $entry.Value
    }
    Write-JsonResult $result
}

$requirements = @{
    inspect = @('Map')
    frontier = @('Map')
    attach = @('Map', 'Ticket')
    detach = @('Map', 'Ticket')
    block = @('Ticket', 'By')
    unblock = @('Ticket', 'By')
    reorder = @('Map', 'Ticket', 'After')
}

$Operation = if ($args.Count -gt 0) { [string]$args[0] } else { '' }
$parsedArguments = @{}
$argumentIndex = 1
while ($argumentIndex -lt $args.Count) {
    $name = [string]$args[$argumentIndex]
    if ($name -notmatch '^-(Map|Ticket|By|After)$') {
        Stop-WayfinderTracker -Code 'invalid_arguments' -Message "Unknown argument: $name"
    }
    if (($argumentIndex + 1) -ge $args.Count) {
        Stop-WayfinderTracker -Code 'invalid_arguments' -Message "Missing value for $name."
    }
    $key = $name.Substring(1)
    if ($parsedArguments.ContainsKey($key)) {
        Stop-WayfinderTracker -Code 'invalid_arguments' -Message "Argument $name was provided more than once."
    }
    $value = 0
    if (-not [int]::TryParse([string]$args[$argumentIndex + 1], [ref]$value) -or $value -le 0) {
        Stop-WayfinderTracker -Code 'invalid_arguments' -Message "$name must be a positive issue number."
    }
    $parsedArguments[$key] = $value
    $argumentIndex += 2
}

$Map = if ($parsedArguments.ContainsKey('Map')) { $parsedArguments.Map } else { 0 }
$Ticket = if ($parsedArguments.ContainsKey('Ticket')) { $parsedArguments.Ticket } else { 0 }
$By = if ($parsedArguments.ContainsKey('By')) { $parsedArguments.By } else { 0 }
$After = if ($parsedArguments.ContainsKey('After')) { $parsedArguments.After } else { 0 }

if (-not $requirements.ContainsKey($Operation)) {
    Stop-WayfinderTracker -Code 'invalid_arguments' -Message 'Operation must be inspect, frontier, attach, detach, block, unblock, or reorder.'
}

foreach ($name in $requirements[$Operation]) {
    if (-not $parsedArguments.ContainsKey($name)) {
        Stop-WayfinderTracker -Code 'invalid_arguments' -Message "-$name must be a positive issue number."
    }
}
foreach ($name in $parsedArguments.Keys) {
    if ($requirements[$Operation] -notcontains $name) {
        Stop-WayfinderTracker -Code 'invalid_arguments' -Message "-$name is not valid for the $Operation operation."
    }
}
if ($Operation -eq 'reorder' -and $Ticket -eq $After) {
    Stop-WayfinderTracker -Code 'invalid_arguments' -Message '-Ticket and -After must identify different issues.'
}

try {
    switch ($Operation) {
        'inspect' {
            $repository = Get-Repository
            $mapIssue = Get-Issue -Number $Map
            $children = @()
            foreach ($child in (Get-SubIssues -MapNumber $Map)) {
                $blockedBy = @(Get-BlockedBy -TicketNumber $child.number)
                $blocking = @(Invoke-GhApi -Method GET -Endpoint "repos/$repository/issues/$($child.number)/dependencies/blocking" -Query @{ per_page = 100 })
                $children += [ordered]@{
                    issue = ConvertTo-TicketSummary -Issue $child
                    blockedBy = @($blockedBy | ForEach-Object { ConvertTo-TicketSummary -Issue $_ })
                    blocking = @($blocking | ForEach-Object { ConvertTo-TicketSummary -Issue $_ })
                }
            }
            Write-JsonResult ([ordered]@{
                ok = $true
                operation = $Operation
                repository = $repository
                map = ConvertTo-TicketSummary -Issue $mapIssue
                children = @($children)
            })
        }
        'frontier' {
            $repository = Get-Repository
            $mapIssue = Get-Issue -Number $Map
            $children = Get-SubIssues -MapNumber $Map
            $frontier = @()
            foreach ($child in $children) {
                if ($child.state -ne 'open' -or @($child.assignees).Count -gt 0) {
                    continue
                }
                $openBlockers = @(Get-BlockedBy -TicketNumber $child.number | Where-Object { $_.state -eq 'open' })
                if ($openBlockers.Count -eq 0) {
                    $frontier += ConvertTo-TicketSummary -Issue $child
                }
            }
            $default = if ($frontier.Count -gt 0) { $frontier[0] } else { $null }
            Write-JsonResult ([ordered]@{
                ok = $true
                operation = $Operation
                repository = $repository
                map = ConvertTo-TicketSummary -Issue $mapIssue
                frontier = @($frontier)
                default = $default
            })
        }
        'attach' {
            $repository = Get-Repository
            $issue = Get-Issue -Number $Ticket
            $children = Get-SubIssues -MapNumber $Map
            $existing = @($children | Where-Object { $_.id -eq $issue.id })
            if ($existing.Count -gt 0) {
                Write-ChangeResult -OperationName $Operation -RepositoryName $repository -Changed $false -Details @{ map = $Map; ticket = $Ticket }
                exit 0
            }
            $body = [ordered]@{ sub_issue_id = [long]$issue.id; replace_parent = $true }
            Invoke-GhApi -Method POST -Endpoint "repos/$repository/issues/$Map/sub_issues" -Body $body | Out-Null
            Write-ChangeResult -OperationName $Operation -RepositoryName $repository -Changed $true -Details @{ map = $Map; ticket = $Ticket }
        }
        'detach' {
            $repository = Get-Repository
            $children = Get-SubIssues -MapNumber $Map
            $existing = @($children | Where-Object { $_.number -eq $Ticket })
            if ($existing.Count -eq 0) {
                Write-ChangeResult -OperationName $Operation -RepositoryName $repository -Changed $false -Details @{ map = $Map; ticket = $Ticket }
                exit 0
            }
            Invoke-GhApi -Method DELETE -Endpoint "repos/$repository/issues/$Map/sub_issue" -Body ([ordered]@{ sub_issue_id = [long]$existing[0].id }) | Out-Null
            Write-ChangeResult -OperationName $Operation -RepositoryName $repository -Changed $true -Details @{ map = $Map; ticket = $Ticket }
        }
        'block' {
            $repository = Get-Repository
            $blocker = Get-Issue -Number $By
            $blockers = Get-BlockedBy -TicketNumber $Ticket
            if (@($blockers | Where-Object { $_.id -eq $blocker.id }).Count -gt 0) {
                Write-ChangeResult -OperationName $Operation -RepositoryName $repository -Changed $false -Details @{ ticket = $Ticket; by = $By }
                exit 0
            }
            Invoke-GhApi -Method POST -Endpoint "repos/$repository/issues/$Ticket/dependencies/blocked_by" -Body ([ordered]@{ issue_id = [long]$blocker.id }) | Out-Null
            Write-ChangeResult -OperationName $Operation -RepositoryName $repository -Changed $true -Details @{ ticket = $Ticket; by = $By }
        }
        'unblock' {
            $repository = Get-Repository
            $blocker = Get-Issue -Number $By
            $blockers = Get-BlockedBy -TicketNumber $Ticket
            $existing = @($blockers | Where-Object { $_.id -eq $blocker.id })
            if ($existing.Count -eq 0) {
                Write-ChangeResult -OperationName $Operation -RepositoryName $repository -Changed $false -Details @{ ticket = $Ticket; by = $By }
                exit 0
            }
            Invoke-GhApi -Method DELETE -Endpoint "repos/$repository/issues/$Ticket/dependencies/blocked_by/$([long]$blocker.id)" | Out-Null
            Write-ChangeResult -OperationName $Operation -RepositoryName $repository -Changed $true -Details @{ ticket = $Ticket; by = $By }
        }
        'reorder' {
            $repository = Get-Repository
            $children = Get-SubIssues -MapNumber $Map
            $ticketIndex = -1
            $afterIndex = -1
            for ($index = 0; $index -lt $children.Count; $index++) {
                if ($children[$index].number -eq $Ticket) { $ticketIndex = $index }
                if ($children[$index].number -eq $After) { $afterIndex = $index }
            }
            if ($ticketIndex -lt 0 -or $afterIndex -lt 0) {
                throw 'Both -Ticket and -After must be children of the map.'
            }
            if ($ticketIndex -eq ($afterIndex + 1)) {
                Write-ChangeResult -OperationName $Operation -RepositoryName $repository -Changed $false -Details @{ map = $Map; ticket = $Ticket; after = $After }
                exit 0
            }
            $body = [ordered]@{ sub_issue_id = [long]$children[$ticketIndex].id; after_id = [long]$children[$afterIndex].id }
            Invoke-GhApi -Method PATCH -Endpoint "repos/$repository/issues/$Map/sub_issues/priority" -Body $body | Out-Null
            Write-ChangeResult -OperationName $Operation -RepositoryName $repository -Changed $true -Details @{ map = $Map; ticket = $Ticket; after = $After }
        }
        default {
            Write-JsonResult ([ordered]@{ ok = $true; operation = $Operation })
        }
    }
}
catch {
    Stop-WayfinderTracker -Code 'github_error' -Message $_.Exception.Message
}
