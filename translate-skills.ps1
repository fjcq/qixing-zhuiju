# Skill Name Translation Script
Write-Host "Starting skill name translation..." -ForegroundColor Cyan

$skillsPath = "C:\Users\Administrator\.agents\skills"

# Define translations as hashtable
$translations = @{
    "electron" = "Electron Desktop App Development"
    "electron-development" = "Electron Development Guide"
    "nodejs-backend-patterns" = "Node.js Backend Patterns"
    "typescript-advanced-types" = "TypeScript Advanced Types"
    "webapp-testing" = "Web Application Testing"
    "javascript-testing-patterns" = "JavaScript Testing Patterns"
    "e2e-testing-patterns" = "E2E Testing Patterns"
    "api-security-best-practices" = "API Security Best Practices"
    "performance" = "Web Performance Optimization"
    "api-design-principles" = "API Design Principles"
}

foreach ($key in $translations.Keys) {
    $file = Join-Path $skillsPath "$key\SKILL.md"
    if (Test-Path $file) {
        $content = Get-Content $file -Raw -Encoding UTF8
        $oldName = "name: $key"
        $newName = "name: " + $translations[$key]
        $content = $content.Replace($oldName, $newName)
        Set-Content $file -Value $content -NoNewline -Encoding UTF8
        Write-Host "[OK] $key -> $($translations[$key])" -ForegroundColor Green
    } else {
        Write-Host "[SKIP] $key (file not found)" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Translation completed!" -ForegroundColor Green
Write-Host ""
Write-Host "Current skills list:" -ForegroundColor Cyan
npx skills list -g
