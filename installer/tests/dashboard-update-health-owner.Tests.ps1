$ErrorActionPreference = 'Stop'
$scriptFile = Join-Path $PSScriptRoot '..\scripts\update-dashboard-github.ps1'
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($scriptFile, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "Updater hat PowerShell-Parserfehler: $($errors[0].Message)" }
foreach ($name in @('Test-DashboardPortOwner', 'Health-Ready')) {
    $definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    if (-not $definition) { throw "$name fehlt" }
    Invoke-Expression $definition.Extent.Text
}
$dash = Join-Path ([IO.Path]::GetTempPath()) ("friday health owner " + [guid]::NewGuid().ToString('N'))
$script:owner = $null
$script:listening = $true
function Invoke-WebRequest { [pscustomobject]@{ StatusCode = 200 } }
function Start-Sleep { }
function Get-NetTCPConnection { if ($script:listening) { [pscustomobject]@{ OwningProcess = 4242 } } }
function Get-CimInstance { $script:owner }

# 1) Die neu gestartete Control API dieser Installation antwortet.
$script:owner = [pscustomobject]@{ CommandLine = "`"C:\Program Files\nodejs\node.exe`" $dash\apps\control-api\dist\main.js" }
if (-not (Health-Ready)) { throw 'Die eigene Control API wurde nicht als bereit erkannt.' }

# 2) Ein altes Dashboard aus einem anderen Ordner haelt den Port und antwortet mit 200.
$script:owner = [pscustomobject]@{ CommandLine = '"C:\Program Files\nodejs\node.exe" C:\Alt\dashboard\apps\control-api\dist\main.js' }
if (Health-Ready) { throw 'Ein fremdes Dashboard auf dem Port wurde als erfolgreiches Update gewertet.' }

# 3) Ein ganz anderes Programm antwortet auf dem Port.
$script:owner = [pscustomobject]@{ CommandLine = 'C:\Tools\proxy.exe --port 3100' }
if (Health-Ready) { throw 'Ein fremdes Programm auf dem Port wurde als Dashboard gewertet.' }

# 4) Niemand lauscht (Antwort kam z. B. ueber eine Weiterleitung).
$script:listening = $false
$script:owner = [pscustomobject]@{ CommandLine = "node $dash\apps\control-api\dist\main.js" }
if (Health-Ready) { throw 'Ohne lauschenden Prozess wurde das Dashboard als bereit gewertet.' }

Write-Host 'PASS dashboard-update-health-owner'
