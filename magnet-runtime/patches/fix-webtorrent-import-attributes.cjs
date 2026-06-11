// @ts-nocheck
/**
 * Patch webtorrent 以兼容 Node.js < 22
 *
 * 问题背景：
 *   webtorrent@2.3.6 在 3 个文件中使用了 ES2025 Import Attributes 语法：
 *     `import info from './package.json' with { type: 'json' }`
 *   这个语法需要 Node.js 22+ 才默认支持。
 *   Electron 27 内置的 Node.js 18.17.1 不支持，导致子进程崩溃。
 *
 * 修复方案：
 *   把 import attributes 语法替换为 createRequire + CommonJS require：
 *     `import { createRequire } from 'module'`
 *     `const require = createRequire(import.meta.url)`
 *     `const info = require('./package.json')`
 *   CJS require 加载 JSON 在所有 Node 版本都支持。
 *
 * 为什么需要这个脚本：
 *   每次 `npm install` 会重新安装 webtorrent，覆盖 patch。
 *   通过 magnet-runtime 的 postinstall 钩子自动重新应用 patch。
 *
 * 用法：
 *   node patches/fix-webtorrent-import-attributes.cjs
 *
 * 影响文件（截至 webtorrent@2.3.6）：
 *   - node_modules/webtorrent/index.js
 *   - node_modules/webtorrent/lib/webconn.js
 *   - node_modules/webtorrent/lib/torrent.js
 */

const fs = require('fs');
const path = require('path');

const NODE_MODULES = path.resolve(__dirname, '..', 'node_modules');
const WEBTORRENT_DIR = path.join(NODE_MODULES, 'webtorrent');

const TARGET_FILES = [
    { file: path.join(WEBTORRENT_DIR, 'index.js'), rel: './package.json' },
    { file: path.join(WEBTORRENT_DIR, 'lib', 'webconn.js'), rel: '../package.json' },
    { file: path.join(WEBTORRENT_DIR, 'lib', 'torrent.js'), rel: '../package.json' }
];

// 旧语句（必须唯一匹配；带换行以避免误匹配）
const OLD_PATTERN = /^import info from ('[^']+') with \{ type: 'json' \}$/m;

// 新语句：用 createRequire + CJS require 加载 JSON，兼容 Node 18
const NEW_REPLACEMENT = (relPath) =>
    `import { createRequire } from 'module'\n` +
    `const _webtorrentRequire = createRequire(import.meta.url)\n` +
    `const info = _webtorrentRequire(${JSON.stringify(relPath)})`;

function patchFile(target) {
    if (!fs.existsSync(target.file)) {
        console.warn(`[patch] 跳过（文件不存在）: ${path.relative(NODE_MODULES, target.file)}`);
        return false;
    }
    const original = fs.readFileSync(target.file, 'utf8');
    if (!OLD_PATTERN.test(original)) {
        // 可能已经被 patch 过（语句被替换），跳过
        if (original.includes('_webtorrentRequire')) {
            console.log(`[patch] 已 patch 过: ${path.relative(NODE_MODULES, target.file)}`);
            return true;
        }
        console.warn(`[patch] 未找到目标语句，跳过: ${path.relative(NODE_MODULES, target.file)}`);
        return false;
    }
    const patched = original.replace(OLD_PATTERN, NEW_REPLACEMENT(target.rel));
    fs.writeFileSync(target.file, patched, 'utf8');
    console.log(`[patch] 已修复: ${path.relative(NODE_MODULES, target.file)}`);
    return true;
}

function main() {
    if (!fs.existsSync(WEBTORRENT_DIR)) {
        console.error(`[patch] 错误: webtorrent 未安装（${WEBTORRENT_DIR}）`);
        process.exit(0); // 不要让 postinstall 失败
    }
    console.log('[patch] 修复 webtorrent 以兼容 Node.js < 22（Import Attributes）');
    let patched = 0;
    for (const target of TARGET_FILES) {
        if (patchFile(target)) patched++;
    }
    console.log(`[patch] 完成，共处理 ${patched} 个文件`);
}

if (require.main === module) {
    main();
}

module.exports = { patchFile, TARGET_FILES };
