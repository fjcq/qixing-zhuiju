// 便携版 Node.js 下载模块（可选增强）
// 适用场景：极少数情况下 Electron 内置 Node.js 不可用（如：用户使用了非常老
//  的 Electron 27 二进制、或用户修改了系统环境让 ELECTRON_RUN_AS_NODE 失效）
// 此时用户可点"下载便携版"按钮，程序自动从国内镜像下载并解压到 userData/node-portable/
//
// 设计要点：
// - 不在主流程中自动下载（避免给绝大多数用户增加首启耗时/网络负担）
// - 只在用户主动点击时才触发
// - 进度通过回调函数返回，UI 可显示下载条
// - 国内镜像优先（淘宝/腾讯），失败回退到 nodejs.org 官方源
// - 下载完成后自动解压到 <portableDir>/<version>/ 目录
// - 关键：解压完成后调用 nodeEnvironment.invalidate() 让下次 resolve 命中

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { app } = require('electron');
const nodeEnvironment = require('./nodeEnvironment');

/**
 * 镜像列表（按优先级）
 * - 淘宝镜像：国内 CDN，速度快且稳定
 * - 腾讯镜像：国内备用
 * - 官方源：兜底（海外节点，国内下载可能慢）
 * 关键：所有 URL 都指向 zip 格式的便携版（win-x64），无需安装
 */
const MIRRORS = [
    {
        name: '淘宝镜像',
        url: version => `https://npmmirror.com/mirrors/node/v${version}/node-v${version}-win-x64.zip`
    },
    {
        name: '腾讯镜像',
        url: version => `https://mirrors.tencent.com/nodejs-release/v${version}/node-v${version}-win-x64.zip`
    },
    {
        name: 'Node.js 官方',
        url: version => `https://nodejs.org/dist/v${version}/node-v${version}-win-x64.zip`
    }
];

/**
 * 默认要下载的 Node.js 版本
 * 选择原则：LTS 长期支持版，与 Electron 内置版本（18.x）兼容
 * 关键：避免选用 19+ 的实验版；推荐 18 或 20
 */
const DEFAULT_VERSION = '18.19.0';

/**
 * 下载文件到磁盘
 * @param {string} url
 * @param {string} destPath
 * @param {function} onProgress - (downloaded, total) => void
 * @returns {Promise<void>}
 */
function downloadFile(url, destPath, onProgress) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const lib = parsed.protocol === 'https:' ? https : http;
        const request = lib.get(url, response => {
            // 跟随重定向（镜像通常 302 跳转到实际文件）
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                const redirectUrl = new URL(response.headers.location, url).toString();
                response.resume();
                downloadFile(redirectUrl, destPath, onProgress).then(resolve).catch(reject);
                return;
            }
            if (response.statusCode !== 200) {
                reject(new Error(`HTTP ${response.statusCode} - ${url}`));
                response.resume();
                return;
            }
            const total = parseInt(response.headers['content-length'] || '0', 10);
            const file = fs.createWriteStream(destPath);
            let downloaded = 0;
            response.on('data', chunk => {
                downloaded += chunk.length;
                if (onProgress && total > 0) {
                    onProgress(downloaded, total);
                }
            });
            response.pipe(file);
            file.on('finish', () => {
                file.close(() => resolve());
            });
            file.on('error', err => {
                try { fs.unlinkSync(destPath); } catch (e) { /* 忽略 */ }
                reject(err);
            });
        });
        request.on('error', err => reject(err));
        request.setTimeout(300000, () => {
            request.destroy(new Error('下载超时（5分钟）'));
        });
    });
}

/**
 * 解压 zip 文件
 * 关键：使用系统 PowerShell 的 Expand-Archive（Windows 自带，无需额外依赖）
 *       比引入 unzip/AdmZip 等第三方库更轻量
 * @param {string} zipPath
 * @param {string} destDir
 * @returns {Promise<void>}
 */
function unzipFile(zipPath, destDir) {
    return new Promise((resolve, reject) => {
        if (process.platform !== 'win32') {
            reject(new Error('便携版下载仅在 Windows 上受支持（macOS/Linux 用户应使用系统 Node.js）'));
            return;
        }
        const { spawn } = require('child_process');
        // PowerShell 命令：Expand-Archive 强制覆盖 -Force
        const ps = spawn('powershell.exe', [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `Expand-Archive -Path "${zipPath}" -DestinationPath "${destDir}" -Force`
        ], { windowsHide: true });
        let stderr = '';
        ps.stderr.on('data', data => { stderr += data.toString(); });
        ps.on('exit', code => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`解压失败 (exit ${code}): ${stderr}`));
            }
        });
        ps.on('error', err => reject(new Error(`PowerShell 启动失败: ${err.message}`)));
    });
}

/**
 * 下载并安装便携版 Node.js
 * 关键：调用方传入 onProgress 回调，UI 实时显示进度
 * @param {object} [opts]
 * @param {string} [opts.version] - 要下载的版本，默认 18.19.0
 * @param {function} [opts.onProgress] - ({phase, percent, message}) => void
 * @returns {Promise<{success: boolean, nodePath?: string, version?: string, error?: string}>}
 */
async function downloadAndInstall(opts = {}) {
    const version = opts.version || DEFAULT_VERSION;
    // eslint-disable-next-line no-empty-function
    const onProgress = opts.onProgress || (() => {});

    // 1) 准备目录
    const portableDir = nodeEnvironment.getPortableDir();
    if (!fs.existsSync(portableDir)) {
        fs.mkdirSync(portableDir, { recursive: true });
    }
    const targetDir = path.join(portableDir, version);
    if (fs.existsSync(targetDir)) {
        // 目录已存在：检查 node.exe 是否就绪
        const exe = path.join(targetDir, 'node.exe');
        if (fs.existsSync(exe)) {
            onProgress({ phase: 'done', percent: 100, message: '便携版已存在' });
            nodeEnvironment.invalidate(); // 关键：让下次 resolve 命中
            return { success: true, nodePath: exe, version };
        }
    }

    // 2) 下载到临时文件
    const tmpDir = app && app.getPath ? app.getPath('temp') : os.tmpdir();
    const zipPath = path.join(tmpDir, `node-portable-${version}-${Date.now()}.zip`);

    let lastError = null;
    for (const mirror of MIRRORS) {
        const url = mirror.url(version);
        try {
            onProgress({ phase: 'downloading', percent: 0, message: `正在从 ${mirror.name} 下载...` });
            await downloadFile(url, zipPath, (downloaded, total) => {
                const percent = total > 0 ? Math.round((downloaded / total) * 80) : 0;
                onProgress({ phase: 'downloading', percent, message: `下载中 ${formatBytes(downloaded)} / ${formatBytes(total)}` });
            });

            // 3) 解压
            onProgress({ phase: 'extracting', percent: 85, message: '正在解压...' });
            await unzipFile(zipPath, portableDir);

            // 4) 修正目录名：zip 解压后是 node-v<version>-win-x64/，重命名为 <version>/
            const extractedName = `node-v${version}-win-x64`;
            const extractedPath = path.join(portableDir, extractedName);
            if (fs.existsSync(extractedPath)) {
                if (fs.existsSync(targetDir)) {
                    // 已存在旧版本：清空后替换
                    fs.rmSync(targetDir, { recursive: true, force: true });
                }
                fs.renameSync(extractedPath, targetDir);
            }

            // 5) 验证
            const exe = path.join(targetDir, 'node.exe');
            if (!fs.existsSync(exe)) {
                throw new Error('解压后未找到 node.exe');
            }
            onProgress({ phase: 'done', percent: 100, message: '便携版安装完成' });

            // 清理 zip
            try { fs.unlinkSync(zipPath); } catch (e) { /* 忽略 */ }

            // 关键：让 nodeEnvironment 下次 resolve 命中新的便携版
            nodeEnvironment.invalidate();
            return { success: true, nodePath: exe, version };
        } catch (err) {
            lastError = err;
            // 清理残留
            try { if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath); } catch (e) { /* 忽略 */ }
            // 继续尝试下一个镜像
            continue;
        }
    }

    return {
        success: false,
        error: `所有镜像均下载失败: ${(lastError && lastError.message) || '未知错误'}`
    };
}

/**
 * 字节数格式化为可读字符串
 */
function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let n = bytes;
    while (n >= 1024 && i < units.length - 1) {
        n /= 1024;
        i++;
    }
    return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

module.exports = {
    downloadAndInstall,
    MIRRORS,
    DEFAULT_VERSION
};
