param([string]$BaseUrl = 'http://127.0.0.1:4317')
$ErrorActionPreference = 'Stop'
$toolRoot = Split-Path $PSScriptRoot -Parent
$runtimeRoot = Join-Path $toolRoot 'runtime'
$profileRoot = Join-Path $runtimeRoot 'browser'
$browserCache = Join-Path $runtimeRoot 'browser-cache'
$temporaryRoot = Join-Path $runtimeRoot 'temp'
New-Item -ItemType Directory -Force -Path $profileRoot,$browserCache,$temporaryRoot,(Join-Path $toolRoot 'acceptance') | Out-Null
$env:TEMP = $temporaryRoot
$env:TMP = $temporaryRoot
try {
    $health = Invoke-RestMethod -Uri ($BaseUrl + '/api/health')
    if ($health.application -ne 'research-workbench') { throw 'The URL is not this workbench.' }
} catch { throw 'Start the workbench at BaseUrl before browser acceptance.' }

$debugActive = $false
try { $null = Invoke-RestMethod -Uri 'http://127.0.0.1:9337/json/version'; $debugActive = $true } catch {}
if ($debugActive) {
    $owned = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('--remote-debugging-port=9337') -and $_.CommandLine.Contains($profileRoot) }
    if (-not $owned) { throw 'Port 9337 belongs to another browser; refusing to attach.' }
} else {
    $browserExe = @('C:\Program Files\Google\Chrome\Application\chrome.exe','C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe') | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $browserExe) { throw 'Chrome or Edge is required only for browser acceptance.' }
    $arguments = @('--headless=new','--remote-debugging-address=127.0.0.1','--remote-debugging-port=9337',"--user-data-dir=$profileRoot","--disk-cache-dir=$browserCache",'--no-first-run','--no-default-browser-check','--disable-sync','--disable-background-networking','--disable-component-update','--disable-extensions','--disable-default-apps','--no-proxy-server','--window-size=1440,1000','about:blank')
    $testBrowser = Start-Process -FilePath $browserExe -ArgumentList $arguments -WorkingDirectory $toolRoot -WindowStyle Hidden -PassThru
    $testBrowser.Id | Set-Content -LiteralPath (Join-Path $runtimeRoot 'acceptance-browser.pid')
    for ($attempt=0; $attempt -lt 30; $attempt++) {
        try { $null=Invoke-RestMethod -Uri 'http://127.0.0.1:9337/json/version'; break } catch { Start-Sleep -Milliseconds 200 }
    }
}
Push-Location $toolRoot
try {
    & node --disable-warning=ExperimentalWarning scripts/browser-test.mjs $BaseUrl 2>&1 | Tee-Object -FilePath acceptance/browser-tests.txt
    if ($LASTEXITCODE -ne 0) { throw 'Browser acceptance failed; inspect acceptance/browser-results.json.' }
} finally { Pop-Location }
