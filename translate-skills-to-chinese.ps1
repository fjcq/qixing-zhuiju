<#
.SYNOPSIS
    技能名称和描述中文化脚本
.DESCRIPTION
    将已安装的技能的名称和描述翻译成中文
    需要以管理员权限运行
.NOTES
    文件编码: UTF-8 with BOM
#>

# 设置控制台编码为UTF-8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$PSDefaultParameterValues['*:Encoding'] = 'utf8'

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  技能名称和描述中文化脚本" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 技能目录路径
$skillsPath = "$env:USERPROFILE\.agents\skills"

# 检查目录是否存在
if (-not (Test-Path $skillsPath)) {
    Write-Host "[错误] 技能目录不存在: $skillsPath" -ForegroundColor Red
    exit 1
}

# 定义中文翻译映射
$translations = @{
    "electron" = @{
        "name" = "Electron桌面应用开发"
        "description" = "使用JavaScript/TypeScript构建跨平台桌面应用程序的Electron框架完整指南，包括主进程、渲染进程、IPC通信、窗口管理和桌面应用开发。"
    }
    "electron-development" = @{
        "name" = "Electron开发指南"
        "description" = "Electron开发最佳实践指南，涵盖跨平台桌面应用开发的完整流程和技术要点。"
    }
    "nodejs-backend-patterns" = @{
        "name" = "Node.js后端模式"
        "description" = "使用Express/Fastify构建生产级Node.js后端服务，实现中间件模式、错误处理、身份验证、数据库集成和API设计最佳实践。"
    }
    "typescript-advanced-types" = @{
        "name" = "TypeScript高级类型"
        "description" = "精通TypeScript高级类型系统，包括泛型、条件类型、映射类型、模板字面量和工具类型，用于构建类型安全的应用程序。"
    }
    "webapp-testing" = @{
        "name" = "Web应用测试"
        "description" = "使用Playwright与本地Web应用交互和测试的工具集，支持验证前端功能、调试UI行为、捕获浏览器截图和查看浏览器日志。"
    }
    "javascript-testing-patterns" = @{
        "name" = "JavaScript测试模式"
        "description" = "使用Jest、Vitest和Testing Library实现全面的测试策略，包括单元测试、集成测试、端到端测试、模拟、测试夹具和测试驱动开发。"
    }
    "e2e-testing-patterns" = @{
        "name" = "E2E测试模式"
        "description" = "使用Playwright和Cypress进行端到端测试，构建可靠的测试套件以捕获bug、提高信心并实现快速部署。"
    }
    "api-security-best-practices" = @{
        "name" = "API安全最佳实践"
        "description" = "实现安全的API设计模式，包括身份验证、授权、输入验证、速率限制和针对常见API漏洞的保护。"
    }
    "performance" = @{
        "name" = "Web性能优化"
        "description" = "优化Web性能以实现更快的加载和更好的用户体验，适用于加速网站、优化性能、减少加载时间、修复慢加载、提高页面速度或性能审计。"
    }
    "api-design-principles" = @{
        "name" = "API设计原则"
        "description" = "掌握REST和GraphQL API设计原则，构建直观、可扩展且易于维护的API，让开发者愉悦使用。"
    }
}

$successCount = 0
$failCount = 0

foreach ($key in $translations.Keys) {
    $skillDir = Join-Path $skillsPath $key
    $skillFile = Join-Path $skillDir "SKILL.md"
    
    # 检查SKILL.md是否存在，如果不存在尝试skill.md
    if (-not (Test-Path $skillFile)) {
        $skillFile = Join-Path $skillDir "skill.md"
    }
    
    if (Test-Path $skillFile) {
        try {
            # 读取文件内容
            $content = Get-Content $skillFile -Raw -Encoding UTF8
            
            # 获取翻译
            $translatedName = $translations[$key]["name"]
            $translatedDesc = $translations[$key]["description"]
            
            # 替换name字段
            $content = $content -replace 'name:\s*.*', "name: $translatedName"
            
            # 替换description字段（支持多行描述）
            $content = $content -replace 'description:\s*.*?(?=\n\w+:|\n---|\n#|$)', "description: $translatedDesc"
            
            # 写回文件（使用UTF-8无BOM编码）
            $utf8NoBom = New-Object System.Text.UTF8Encoding $false
            [System.IO.File]::WriteAllText($skillFile, $content, $utf8NoBom)
            
            Write-Host "[成功] $key -> $translatedName" -ForegroundColor Green
            $successCount++
        }
        catch {
            Write-Host "[失败] $key : $($_.Exception.Message)" -ForegroundColor Red
            $failCount++
        }
    }
    else {
        Write-Host "[跳过] $key : 文件不存在" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  翻译完成" -ForegroundColor Cyan
Write-Host "  成功: $successCount  失败: $failCount" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "请运行 'npx skills list -g' 查看更新后的技能列表" -ForegroundColor White
