# Skill Name Chinese Translation Script
Write-Host "Starting skill name Chinese translation..." -ForegroundColor Cyan

$skillsPath = "C:\Users\Administrator\.agents\skills"

# Define Chinese translations
$translations = @{
    "Electron Desktop App Development" = "Electron桌面应用开发"
    "Electron Development Guide" = "Electron开发指南"
    "Node.js Backend Patterns" = "Node.js后端架构模式"
    "TypeScript Advanced Types" = "TypeScript高级类型"
    "Web Application Testing" = "Web应用测试"
    "JavaScript Testing Patterns" = "JavaScript测试模式"
    "E2E Testing Patterns" = "E2E端到端测试"
    "API Security Best Practices" = "API安全最佳实践"
    "Web Performance Optimization" = "Web性能优化"
    "API Design Principles" = "API设计原则"
}

foreach ($key in $translations.Keys) {
    $folders = Get-ChildItem $skillsPath -Directory
    foreach ($folder in $folders) {
        $file = Join-Path $folder.FullName "SKILL.md"
        if (Test-Path $file) {
            $content = Get-Content $file -Raw -Encoding UTF8
            if ($content -match "name: $([regex]::Escape($key))") {
                $content = $content.Replace("name: $key", "name: " + $translations[$key])
                Set-Content $file -Value $content -NoNewline -Encoding UTF8
                Write-Host "[OK] $key -> $($translations[$key])" -ForegroundColor Green
            }
        }
    }
}

Write-Host ""
Write-Host "Chinese translation completed!" -ForegroundColor Green
