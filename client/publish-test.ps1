$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
$output = Join-Path $repoRoot "artifacts\FactorioSaveRelay-test-win-x64-$stamp"
$project = Join-Path $PSScriptRoot 'FactorioSaveRelay.Client\FactorioSaveRelay.Client.csproj'

dotnet publish $project --configuration Release --runtime win-x64 --self-contained true `
    -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true `
    --output $output
if ($LASTEXITCODE -ne 0) { throw 'Windows client publish failed.' }

$archive = "$output.zip"
Compress-Archive -Path (Join-Path $output '*') -DestinationPath $archive
Write-Output "Test application: $archive"
