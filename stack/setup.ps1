# setup.ps1 - One-command setup for MorphArray Stack VS Code Extension (Windows / cross-platform with PowerShell)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Set-Location -LiteralPath $PSScriptRoot

Write-Host 'Setting up MorphArray Stack extension...'

# Clean previous install
Write-Host 'Cleaning previous build artifacts...'
foreach ($path in @('node_modules', 'dist', 'out', 'package-lock.json', '.vscode-test')) {
	if (Test-Path -LiteralPath $path) {
		Remove-Item -LiteralPath $path -Recurse -Force
	}
}

# Install dependencies
Write-Host 'Installing dependencies...'
npm install
if ($LASTEXITCODE -ne 0) {
	exit $LASTEXITCODE
}

# Create required folders
Write-Host 'Creating project structure...'
$null = New-Item -ItemType Directory -Force -Path @('articles', 'templates', 'css', 'dist')

# Create placeholder files (same content as setup.sh)
$baseHtml = @'
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{title}}</title>
    <link rel="stylesheet" href="css/main.css">
</head>
<body>
    <header>
        <h1>{{title}}</h1>
        <p class="date">{{date}}</p>
    </header>

    <main>
        {{content}}
    </main>

    <footer>
        <nav>{{navigation}}</nav>
    </footer>
</body>
</html>
'@

$mainCss = @'
body {
    font-family: system-ui, -apple-system, sans-serif;
    line-height: 1.6;
    max-width: 800px;
    margin: 2rem auto;
    padding: 0 1rem;
}
'@

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $PSScriptRoot 'templates\base.html'), $baseHtml, $utf8NoBom)
[System.IO.File]::WriteAllText((Join-Path $PSScriptRoot 'css\main.css'), $mainCss, $utf8NoBom)

$gitkeep = Join-Path $PSScriptRoot 'articles\.gitkeep'
[System.IO.File]::WriteAllText($gitkeep, '', $utf8NoBom)

Write-Host 'Setup completed successfully!'
Write-Host ''
Write-Host 'Next steps:'
Write-Host '  1. Open this folder in VS Code'
Write-Host '  2. Press F5 to launch the Extension Development Host'
Write-Host "  3. In the new window, run 'MorphArray: Rebuild Dynamic Story' from the Command Palette"
Write-Host ''
Write-Host 'Your extension is ready to develop!'
