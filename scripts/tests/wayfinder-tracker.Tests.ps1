$ErrorActionPreference = 'Stop'

$scriptPath = Join-Path $PSScriptRoot '..\wayfinder-tracker.ps1'

function New-FakeGh {
    param([Parameter(Mandatory = $true)]$Fixture)

    $fakeDirectory = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $fakeDirectory | Out-Null
    $fixturePath = Join-Path $fakeDirectory 'fixture.json'
    $logPath = Join-Path $fakeDirectory 'calls.jsonl'
    $fakeScriptPath = Join-Path $fakeDirectory 'fake-gh.ps1'

    $Fixture | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $fixturePath -Encoding UTF8
    @'
$ErrorActionPreference = 'Stop'
$fixture = Get-Content -LiteralPath $env:WAYFINDER_FAKE_FIXTURE -Raw -Encoding UTF8 | ConvertFrom-Json
$body = $env:WAYFINDER_GH_STDIN
[pscustomobject]@{ arguments = @($args); body = $body } |
    ConvertTo-Json -Depth 10 -Compress |
    Add-Content -LiteralPath $env:WAYFINDER_FAKE_LOG -Encoding UTF8

if ($args[0] -eq 'repo') {
    [pscustomobject]@{ nameWithOwner = $fixture.repository } | ConvertTo-Json -Compress
    return
}

if ($args[0] -ne 'api') {
    throw 'Unexpected gh command: ' + ($args -join ' ')
}

$method = 'GET'
$methodIndex = [array]::IndexOf($args, '--method')
if ($methodIndex -ge 0) {
    $method = $args[$methodIndex + 1]
}
$endpoint = $args[3]
$response = @($fixture.responses | Where-Object { $_.method -eq $method -and $_.endpoint -eq $endpoint })[0]
if ($null -eq $response) {
    throw "No fake response for $method $endpoint"
}
$response.json
'@ | Set-Content -LiteralPath $fakeScriptPath -Encoding UTF8

    return [pscustomobject]@{
        Command = $fakeScriptPath
        Fixture = $fixturePath
        Log = $logPath
    }
}

function Invoke-Tracker {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)]$FakeGh
    )

    $previousGhPath = $env:WAYFINDER_GH_PATH
    $previousFixture = $env:WAYFINDER_FAKE_FIXTURE
    $previousLog = $env:WAYFINDER_FAKE_LOG
    try {
        $env:WAYFINDER_GH_PATH = $FakeGh.Command
        $env:WAYFINDER_FAKE_FIXTURE = $FakeGh.Fixture
        $env:WAYFINDER_FAKE_LOG = $FakeGh.Log
        $output = & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $scriptPath @Arguments 2>&1
        return [pscustomobject]@{
            ExitCode = $LASTEXITCODE
            Output = ($output | Out-String)
        }
    }
    finally {
        $env:WAYFINDER_GH_PATH = $previousGhPath
        $env:WAYFINDER_FAKE_FIXTURE = $previousFixture
        $env:WAYFINDER_FAKE_LOG = $previousLog
    }
}

function Read-FakeGhCalls {
    param([Parameter(Mandatory = $true)]$FakeGh)

    @(Get-Content -LiteralPath $FakeGh.Log -Encoding UTF8 | ForEach-Object { $_ | ConvertFrom-Json })
}

Describe 'wayfinder-tracker command interface' {
    It 'rejects missing operation parameters as JSON without invoking gh' {
        $output = & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $scriptPath frontier 2>&1
        $exitCode = $LASTEXITCODE

        $exitCode | Should Not Be 0
        $result = $output | Out-String | ConvertFrom-Json
        $result.ok | Should Be $false
        $result.error.code | Should Be 'invalid_arguments'
    }

    It 'rejects invalid numbers and unknown arguments as JSON' {
        $invalidNumber = & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $scriptPath frontier -Map nope 2>&1
        $LASTEXITCODE | Should Not Be 0
        ($invalidNumber | Out-String | ConvertFrom-Json).error.code | Should Be 'invalid_arguments'

        $unknown = & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $scriptPath inspect -Map 10 -Other 20 2>&1
        $LASTEXITCODE | Should Not Be 0
        ($unknown | Out-String | ConvertFrom-Json).error.code | Should Be 'invalid_arguments'

        $irrelevant = & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $scriptPath inspect -Map 10 -Ticket 20 2>&1
        $LASTEXITCODE | Should Not Be 0
        ($irrelevant | Out-String | ConvertFrom-Json).error.code | Should Be 'invalid_arguments'
    }

    It 'resolves the repository and sends the ticket database ID when attaching' {
        $fakeGh = New-FakeGh ([ordered]@{
            repository = 'acme/widgets'
            responses = @(
                [ordered]@{ method = 'GET'; endpoint = 'repos/acme/widgets/issues/20'; json = '{"number":20,"id":2020,"node_id":"I_20","state":"open"}' }
                [ordered]@{ method = 'GET'; endpoint = 'repos/acme/widgets/issues/10/sub_issues'; json = '[{"number":19,"id":1919}]' }
                [ordered]@{ method = 'POST'; endpoint = 'repos/acme/widgets/issues/10/sub_issues'; json = '{"number":20,"id":2020}' }
            )
        })

        $invocation = Invoke-Tracker -Arguments @('attach', '-Map', '10', '-Ticket', '20') -FakeGh $fakeGh

        $invocation.ExitCode | Should Be 0
        $result = $invocation.Output | ConvertFrom-Json
        $result.ok | Should Be $true
        $result.repository | Should Be 'acme/widgets'
        $result.changed | Should Be $true
        $calls = Read-FakeGhCalls $fakeGh
        $post = @($calls | Where-Object { $_.arguments[2] -eq 'POST' })[0]
        ($post.body | ConvertFrom-Json).sub_issue_id | Should Be 2020
    }

    It 'returns open unclaimed unblocked tickets in map order as the frontier' {
        $fakeGh = New-FakeGh ([ordered]@{
            repository = 'acme/widgets'
            responses = @(
                [ordered]@{ method = 'GET'; endpoint = 'repos/acme/widgets/issues/10'; json = '{"number":10,"id":1010,"state":"open","title":"Map"}' }
                [ordered]@{ method = 'GET'; endpoint = 'repos/acme/widgets/issues/10/sub_issues'; json = '[{"number":21,"id":2021,"state":"open","title":"First","assignees":[]},{"number":22,"id":2022,"state":"open","title":"Claimed","assignees":[{"login":"dev"}]},{"number":23,"id":2023,"state":"open","title":"Blocked","assignees":[]},{"number":24,"id":2024,"state":"closed","title":"Done","assignees":[]},{"number":25,"id":2025,"state":"open","title":"Second","assignees":[]}]' }
                [ordered]@{ method = 'GET'; endpoint = 'repos/acme/widgets/issues/21/dependencies/blocked_by'; json = '[]' }
                [ordered]@{ method = 'GET'; endpoint = 'repos/acme/widgets/issues/23/dependencies/blocked_by'; json = '[{"number":30,"id":3030,"state":"open","title":"Gate"}]' }
                [ordered]@{ method = 'GET'; endpoint = 'repos/acme/widgets/issues/25/dependencies/blocked_by'; json = '[{"number":31,"id":3031,"state":"closed","title":"Old gate"}]' }
            )
        })

        $invocation = Invoke-Tracker -Arguments @('frontier', '-Map', '10') -FakeGh $fakeGh

        $invocation.ExitCode | Should Be 0
        $result = $invocation.Output | ConvertFrom-Json
        @($result.frontier).Count | Should Be 2
        $result.frontier[0].number | Should Be 21
        $result.frontier[1].number | Should Be 25
        $result.default.number | Should Be 21
    }

    It 'does not attach a ticket that is already a child of the map' {
        $fakeGh = New-FakeGh ([ordered]@{
            repository = 'acme/widgets'
            responses = @(
                [ordered]@{ method = 'GET'; endpoint = 'repos/acme/widgets/issues/20'; json = '{"number":20,"id":2020,"state":"open"}' }
                [ordered]@{ method = 'GET'; endpoint = 'repos/acme/widgets/issues/10/sub_issues'; json = '[{"number":20,"id":2020,"state":"open"}]' }
            )
        })

        $invocation = Invoke-Tracker -Arguments @('attach', '-Map', '10', '-Ticket', '20') -FakeGh $fakeGh

        $invocation.ExitCode | Should Be 0
        ($invocation.Output | ConvertFrom-Json).changed | Should Be $false
        @((Read-FakeGhCalls $fakeGh) | Where-Object { $_.arguments[2] -eq 'POST' }).Count | Should Be 0
    }

    It 'detaches using the child database ID and is idempotent when absent' {
        $present = New-FakeGh ([ordered]@{
            repository = 'acme/widgets'
            responses = @(
                [ordered]@{ method = 'GET'; endpoint = 'repos/acme/widgets/issues/10/sub_issues'; json = '[{"number":20,"id":2020}]' }
                [ordered]@{ method = 'DELETE'; endpoint = 'repos/acme/widgets/issues/10/sub_issue'; json = '{}' }
            )
        })
        $changed = Invoke-Tracker -Arguments @('detach', '-Map', '10', '-Ticket', '20') -FakeGh $present
        $changed.ExitCode | Should Be 0
        ($changed.Output | ConvertFrom-Json).changed | Should Be $true
        $delete = @((Read-FakeGhCalls $present) | Where-Object { $_.arguments[2] -eq 'DELETE' })[0]
        ($delete.body | ConvertFrom-Json).sub_issue_id | Should Be 2020

        $absent = New-FakeGh ([ordered]@{
            repository = 'acme/widgets'
            responses = @([ordered]@{ method = 'GET'; endpoint = 'repos/acme/widgets/issues/10/sub_issues'; json = '[]' })
        })
        $unchanged = Invoke-Tracker -Arguments @('detach', '-Map', '10', '-Ticket', '20') -FakeGh $absent
        ($unchanged.Output | ConvertFrom-Json).changed | Should Be $false
    }

    It 'adds and removes dependencies using the blocker database ID' {
        $blocking = New-FakeGh ([ordered]@{
            repository = 'acme/widgets'
            responses = @(
                [ordered]@{ method = 'GET'; endpoint = 'repos/acme/widgets/issues/30'; json = '{"number":30,"id":3030}' }
                [ordered]@{ method = 'GET'; endpoint = 'repos/acme/widgets/issues/20/dependencies/blocked_by'; json = '[]' }
                [ordered]@{ method = 'POST'; endpoint = 'repos/acme/widgets/issues/20/dependencies/blocked_by'; json = '{}' }
            )
        })
        $blocked = Invoke-Tracker -Arguments @('block', '-Ticket', '20', '-By', '30') -FakeGh $blocking
        $blocked.ExitCode | Should Be 0
        $post = @((Read-FakeGhCalls $blocking) | Where-Object { $_.arguments[2] -eq 'POST' })[0]
        ($post.body | ConvertFrom-Json).issue_id | Should Be 3030

        $unblocking = New-FakeGh ([ordered]@{
            repository = 'acme/widgets'
            responses = @(
                [ordered]@{ method = 'GET'; endpoint = 'repos/acme/widgets/issues/30'; json = '{"number":30,"id":3030}' }
                [ordered]@{ method = 'GET'; endpoint = 'repos/acme/widgets/issues/20/dependencies/blocked_by'; json = '[{"number":30,"id":3030}]' }
                [ordered]@{ method = 'DELETE'; endpoint = 'repos/acme/widgets/issues/20/dependencies/blocked_by/3030'; json = '{}' }
            )
        })
        $unblocked = Invoke-Tracker -Arguments @('unblock', '-Ticket', '20', '-By', '30') -FakeGh $unblocking
        $unblocked.ExitCode | Should Be 0
        @((Read-FakeGhCalls $unblocking) | Where-Object { $_.arguments[3] -eq 'repos/acme/widgets/issues/20/dependencies/blocked_by/3030' }).Count | Should Be 1
    }

    It 'does not rewrite dependencies that already have the requested state' {
        $alreadyBlocked = New-FakeGh ([ordered]@{
            repository = 'acme/widgets'
            responses = @(
                [ordered]@{ method = 'GET'; endpoint = 'repos/acme/widgets/issues/30'; json = '{"number":30,"id":3030}' }
                [ordered]@{ method = 'GET'; endpoint = 'repos/acme/widgets/issues/20/dependencies/blocked_by'; json = '[{"number":30,"id":3030}]' }
            )
        })
        $blockResult = Invoke-Tracker -Arguments @('block', '-Ticket', '20', '-By', '30') -FakeGh $alreadyBlocked
        ($blockResult.Output | ConvertFrom-Json).changed | Should Be $false
        @((Read-FakeGhCalls $alreadyBlocked) | Where-Object { $_.arguments[2] -eq 'POST' }).Count | Should Be 0

        $alreadyUnblocked = New-FakeGh ([ordered]@{
            repository = 'acme/widgets'
            responses = @(
                [ordered]@{ method = 'GET'; endpoint = 'repos/acme/widgets/issues/30'; json = '{"number":30,"id":3030}' }
                [ordered]@{ method = 'GET'; endpoint = 'repos/acme/widgets/issues/20/dependencies/blocked_by'; json = '[]' }
            )
        })
        $unblockResult = Invoke-Tracker -Arguments @('unblock', '-Ticket', '20', '-By', '30') -FakeGh $alreadyUnblocked
        ($unblockResult.Output | ConvertFrom-Json).changed | Should Be $false
        @((Read-FakeGhCalls $alreadyUnblocked) | Where-Object { $_.arguments[2] -eq 'DELETE' }).Count | Should Be 0
    }

    It 'reorders a child after another child using both database IDs' {
        $fakeGh = New-FakeGh ([ordered]@{
            repository = 'acme/widgets'
            responses = @(
                [ordered]@{ method = 'GET'; endpoint = 'repos/acme/widgets/issues/10/sub_issues'; json = '[{"number":20,"id":2020},{"number":21,"id":2021},{"number":22,"id":2022}]' }
                [ordered]@{ method = 'PATCH'; endpoint = 'repos/acme/widgets/issues/10/sub_issues/priority'; json = '{}' }
            )
        })
        $invocation = Invoke-Tracker -Arguments @('reorder', '-Map', '10', '-Ticket', '20', '-After', '22') -FakeGh $fakeGh

        $invocation.ExitCode | Should Be 0
        $patchCall = @((Read-FakeGhCalls $fakeGh) | Where-Object { $_.arguments[2] -eq 'PATCH' })[0]
        $body = $patchCall.body | ConvertFrom-Json
        $body.sub_issue_id | Should Be 2020
        $body.after_id | Should Be 2022
    }

    It 'does not reorder children that are already adjacent' {
        $fakeGh = New-FakeGh ([ordered]@{
            repository = 'acme/widgets'
            responses = @([ordered]@{ method = 'GET'; endpoint = 'repos/acme/widgets/issues/10/sub_issues'; json = '[{"number":21,"id":2021},{"number":20,"id":2020}]' })
        })
        $invocation = Invoke-Tracker -Arguments @('reorder', '-Map', '10', '-Ticket', '20', '-After', '21') -FakeGh $fakeGh

        ($invocation.Output | ConvertFrom-Json).changed | Should Be $false
        @((Read-FakeGhCalls $fakeGh) | Where-Object { $_.arguments[2] -eq 'PATCH' }).Count | Should Be 0
    }

    It 'inspects child order and both dependency directions' {
        $fakeGh = New-FakeGh ([ordered]@{
            repository = 'acme/widgets'
            responses = @(
                [ordered]@{ method = 'GET'; endpoint = 'repos/acme/widgets/issues/10'; json = '{"number":10,"id":1010,"title":"Map","state":"open"}' }
                [ordered]@{ method = 'GET'; endpoint = 'repos/acme/widgets/issues/10/sub_issues'; json = '[{"number":20,"id":2020,"title":"Ticket","state":"open","assignees":[]}]' }
                [ordered]@{ method = 'GET'; endpoint = 'repos/acme/widgets/issues/20/dependencies/blocked_by'; json = '[{"number":30,"id":3030,"title":"Gate","state":"open"}]' }
                [ordered]@{ method = 'GET'; endpoint = 'repos/acme/widgets/issues/20/dependencies/blocking'; json = '[{"number":40,"id":4040,"title":"Later","state":"open"}]' }
            )
        })
        $invocation = Invoke-Tracker -Arguments @('inspect', '-Map', '10') -FakeGh $fakeGh

        $invocation.ExitCode | Should Be 0
        $result = $invocation.Output | ConvertFrom-Json
        $result.children[0].issue.number | Should Be 20
        $result.children[0].blockedBy[0].number | Should Be 30
        $result.children[0].blocking[0].number | Should Be 40
        $subIssueCall = @((Read-FakeGhCalls $fakeGh) | Where-Object { $_.arguments[3] -eq 'repos/acme/widgets/issues/10/sub_issues' })[0]
        ($subIssueCall.arguments -join ' ') | Should Match '-f per_page=100'
    }
}
