// 下载管理模块 - 集中管理已下载的影视内容
// 支持：列表/重命名/删除/移动/搜索/分类筛选/排序/URL 下载任务
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');
const https = require('https');
const http = require('http');
const { URL } = require('url');

/**
 * 下载管理器
 * 负责：磁盘文件 + 元数据清单的增删改查，以及 URL 下载任务的派发与状态广播
 */
class DownloadManager {
    constructor() {
        // 默认下载目录：用户数据目录下的 downloads/
        // 测试覆盖：通过 QIXING_USER_DATA_DIR 环境变量指定下载根目录，避免依赖 electron.app
        const userData = process.env.QIXING_USER_DATA_DIR || (app && app.getPath ? app.getPath('userData') : null);
        this.downloadDir = userData ? path.join(userData, 'downloads') : path.join(require('os').tmpdir(), 'qixing-downloads');
        // 元数据清单：每个下载文件一条记录（含来源、大小、时间、缩略图等）
        this.manifestPath = path.join(this.downloadDir, 'manifest.json');
        this.manifest = []; // [{ id, name, path, size, mtime, sourceType, sourceUrl, addedAt, ext, thumbnail }]
        // 活动下载任务：id -> { id, url, name, totalBytes, downloadedBytes, status, savePath, error }
        this.activeTasks = new Map();
        this._initialized = false;
    }

    /**
     * 初始化：确保目录存在、加载 manifest、对账磁盘
     * 关键：磁盘是权威源 —— manifest 丢了/损坏/不一致都能从磁盘恢复
     */
    initialize() {
        if (this._initialized) return;
        try {
            if (!fs.existsSync(this.downloadDir)) {
                fs.mkdirSync(this.downloadDir, { recursive: true });
            }
            this._loadManifest();
            // 启动时对账：磁盘文件 ∪ manifest 记录，去掉已失效的 URL/import 记录
            this._reconcileWithDisk();
            this._initialized = true;
            console.log('[DOWNLOAD] 初始化完成, 目录:', this.downloadDir, '条目数:', this.manifest.length);
        } catch (error) {
            console.error('[DOWNLOAD] 初始化失败:', error);
        }
    }

    /**
     * 把磁盘与 manifest 对齐（磁盘是权威源）
     * - 扫描 downloadDir 下所有文件，磁盘上有但 manifest 没有的 → 补登记（最小元数据）
     * - 磁力未完成（downloading/paused/error）状态的文件即使磁盘上没有也保留：
     *   webtorrent 用 chunk 写入，未下载到第一个块时文件还不存在
     * - URL/import 记录在磁盘上找不到时 → 删除（用户手动删了）
     * - 磁力已完成记录但磁盘文件也找不到 → 删除（用户手动删了完整文件）
     * - 启动时把 in-progress 磁力状态统一归位为 paused：上次会话崩溃/正常关闭时
     *   记录可能停留在 downloading 状态，但本次启动的磁力子进程尚未启动，
     *   UI 显示"下载中"是误导（实际无 torrent 在跑），点击暂停也无法成功。
     *   归位为 paused 后用户在列表里看到的是真实可恢复的状态，点继续才会真正拉起子进程
     */
    _reconcileWithDisk() {
        // 1) 扫描磁盘
        const diskEntries = this._scanDownloadDir();

        // 2) 把磁盘上有但 manifest 没有的文件补登记
        let added = 0;
        for (const entry of diskEntries) {
            const existing = this.manifest.find(m => m.path === entry.path);
            if (!existing) {
                this.manifest.unshift(this._buildRecordFromDiskEntry(entry));
                added++;
            } else {
                // 已有记录：用磁盘上最新的 mtime/size 刷新（磁盘是最新事实）
                try {
                    const stat = fs.statSync(entry.path);
                    existing.mtime = stat.mtimeMs;
                    existing.size = stat.size;
                } catch (e) { /* 忽略单条 stat 失败 */ }
            }
        }

        // 3) 启动时归位 in-progress 磁力状态为 paused
        // 关键：子进程未启动前 "downloading" 是误导（点击暂停也无效）
        // 必须在 _loadFiles 返回给渲染端前改完，否则 UI 一闪就错了
        let demoted = 0;
        for (const item of this.manifest) {
            if (item.sourceType === 'magnet' && item.status && item.status !== 'completed') {
                if (item.status !== 'paused') {
                    item.status = 'paused';
                    demoted++;
                }
                // 启动时清空实时指标（旧值已无意义）
                item.downloadSpeed = 0;
                item.numPeers = 0;
                item.wires = 0;
                item.eta = null;
            }
        }

        // 4) 处理 manifest 中磁盘没有的记录
        const before = this.manifest.length;
        this.manifest = this.manifest.filter(item => {
            // 磁力未完成状态：磁盘文件可能尚未存在 → 保留
            if (item.sourceType === 'magnet' && item.status !== 'completed') {
                return true;
            }
            // 其他情况：磁盘找不到 = 失效
            try {
                return item.path && fs.existsSync(item.path);
            } catch (e) {
                return false;
            }
        });
        const pruned = before - this.manifest.length;

        if (added > 0 || pruned > 0 || demoted > 0) {
            this._saveManifest();
            console.log(`[DOWNLOAD] 对账完成: 新增 ${added} 条, 清理 ${pruned} 条, 归位 ${demoted} 条`);
        }
    }

    /**
     * 扫描下载目录，返回所有文件条目
     * 目录约定：
     *   downloadDir/magnet/<infoHash>/<filename> → 磁力下载（按 infoHash 子目录隔离）
     *   downloadDir/<其他子目录或根>/<filename>  → URL/import 下载
     * @returns {Array<{path: string, sourceType: 'magnet'|'import', infoHash?: string, stat: fs.Stats}>}
     */
    _scanDownloadDir() {
        const result = [];
        if (!fs.existsSync(this.downloadDir)) return result;
        // 1) 扫描 magnet/<infoHash>/<file>
        const magnetRoot = this.getMagnetDir();
        if (fs.existsSync(magnetRoot)) {
            let infoHashDirs = [];
            try {
                infoHashDirs = fs.readdirSync(magnetRoot, { withFileTypes: true })
                    .filter(d => d.isDirectory());
            } catch (e) { /* 忽略目录读取失败 */ }
            for (const dirent of infoHashDirs) {
                const infoHash = dirent.name;
                const dirPath = path.join(magnetRoot, infoHash);
                let files = [];
                try {
                    files = fs.readdirSync(dirPath, { withFileTypes: true })
                        .filter(f => f.isFile());
                } catch (e) { /* 忽略单目录失败 */ }
                for (const fileDirent of files) {
                    const filePath = path.join(dirPath, fileDirent.name);
                    try {
                        const stat = fs.statSync(filePath);
                        result.push({
                            path: filePath,
                            sourceType: 'magnet',
                            infoHash,
                            fileName: fileDirent.name,
                            stat
                        });
                    } catch (e) { /* 忽略 stat 失败 */ }
                }
            }
        }
        // 2) 扫描 downloadDir 根 + 子目录（排除 magnet/）的非目录文件
        const skipDirs = new Set(['magnet', 'node_modules', '.git']);
        const walk = (dir, relParts) => {
            let entries = [];
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch (e) { return; }
            for (const ent of entries) {
                if (ent.isDirectory()) {
                    if (skipDirs.has(ent.name)) continue;
                    walk(path.join(dir, ent.name), relParts.concat(ent.name));
                } else if (ent.isFile()) {
                    const filePath = path.join(dir, ent.name);
                    try {
                        const stat = fs.statSync(filePath);
                        // 跳过 manifest.json 自身
                        if (filePath === this.manifestPath) continue;
                        result.push({
                            path: filePath,
                            sourceType: 'import',
                            fileName: ent.name,
                            folder: relParts.join('/') || '',
                            stat
                        });
                    } catch (e) { /* 忽略 */ }
                }
            }
        };
        walk(this.downloadDir, []);
        return result;
    }

    /**
     * 从磁盘扫描结果构建一条最小 manifest 记录
     * （用于补登记：磁盘有文件但 manifest 没记录 —— 之前 manifest 丢失/损坏时）
     */
    _buildRecordFromDiskEntry(entry) {
        const baseName = entry.fileName;
        const ext = this._getExt(baseName);
        const record = {
            id: this._generateId(),
            name: baseName,
            path: entry.path,
            size: entry.stat.size,
            mtime: entry.stat.mtimeMs,
            addedAt: entry.stat.mtimeMs,
            sourceType: entry.sourceType,
            sourceUrl: '',
            ext,
            thumbnail: ''
        };
        if (entry.sourceType === 'magnet') {
            // 磁盘补登记的磁力：信息不全，但至少要把 infoHash/folder 写好
            record.infoHash = entry.infoHash;
            record.folder = 'magnet';
            record.status = 'completed'; // 磁盘上有文件视为完成
        } else {
            // URL/import 补登记：folder 反映磁盘上的子目录
            record.folder = entry.folder || '';
        }
        return record;
    }

    /**
     * 加载 manifest.json
     */
    _loadManifest() {
        try {
            if (fs.existsSync(this.manifestPath)) {
                const raw = fs.readFileSync(this.manifestPath, 'utf-8');
                this.manifest = JSON.parse(raw);
                if (!Array.isArray(this.manifest)) this.manifest = [];
            } else {
                this.manifest = [];
            }
        } catch (error) {
            console.error('[DOWNLOAD] 加载 manifest 失败，使用空清单:', error.message);
            this.manifest = [];
        }
    }

    /**
     * 持久化 manifest.json（原子写入：先写 .tmp 再 rename，避免崩溃产生半截文件）
     */
    _saveManifest() {
        try {
            const tmpPath = this.manifestPath + '.tmp';
            fs.writeFileSync(tmpPath, JSON.stringify(this.manifest, null, 2), 'utf-8');
            fs.renameSync(tmpPath, this.manifestPath);
        } catch (error) {
            console.error('[DOWNLOAD] 保存 manifest 失败:', error);
        }
    }

    /**
     * 兼容旧测试的别名 —— 内部走磁盘对账
     */
    _pruneMissing() {
        this._reconcileWithDisk();
    }

    /**
     * 生成稳定的 12 位 ID
     */
    _generateId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    /**
     * 从文件路径获取扩展名（小写，不含点）
     */
    _getExt(filePath) {
        const ext = path.extname(filePath).toLowerCase().replace(/^\./, '');
        return ext || '';
    }

    /**
     * 把字节数格式化为可读字符串（B/KB/MB/GB）
     */
    static formatSize(bytes) {
        if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let i = 0;
        let n = bytes;
        while (n >= 1024 && i < units.length - 1) {
            n /= 1024;
            i++;
        }
        return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
    }

    /**
     * 列出已下载文件（不含正在下载中的）
     * @param {object} options
     * @param {string} options.search - 名称模糊匹配关键字
     * @param {string} options.sourceType - 来源筛选（url/magnet/import）
     * @param {string} options.sortBy - 排序字段 name/size/mtime
     * @param {string} options.sortDir - asc/desc
     */
    listFiles(options = {}) {
        const { search = '', sourceType = '', sortBy = 'mtime', sortDir = 'desc' } = options;
        let result = this.manifest.slice();

        // 名称搜索（不区分大小写）
        const kw = String(search || '').trim().toLowerCase();
        if (kw) {
            result = result.filter(item => (item.name || '').toLowerCase().includes(kw));
        }

        // 来源筛选
        if (sourceType) {
            result = result.filter(item => item.sourceType === sourceType);
        }

        // 排序
        const dir = sortDir === 'asc' ? 1 : -1;
        result.sort((a, b) => {
            let va = a[sortBy];
            let vb = b[sortBy];
            if (sortBy === 'size' || sortBy === 'addedAt' || sortBy === 'mtime') {
                va = Number(va) || 0;
                vb = Number(vb) || 0;
            } else {
                va = String(va || '').toLowerCase();
                vb = String(vb || '').toLowerCase();
            }
            if (va < vb) return -1 * dir;
            if (va > vb) return 1 * dir;
            return 0;
        });

        return result;
    }

    /**
     * 列出活动下载任务
     */
    listActiveTasks() {
        return Array.from(this.activeTasks.values()).map(t => ({
            id: t.id,
            name: t.name,
            url: t.url,
            status: t.status,
            downloadedBytes: t.downloadedBytes,
            totalBytes: t.totalBytes,
            progress: t.totalBytes > 0 ? Math.min(100, (t.downloadedBytes / t.totalBytes) * 100) : 0,
            error: t.error || null
        }));
    }

    /**
     * 添加一条已存在的文件记录（用于外部导入）
     * @param {object} info
     * @param {string} info.name - 显示名
     * @param {string} info.filePath - 磁盘绝对路径
     * @param {string} [info.sourceType='import'] - url/magnet/import
     * @param {string} [info.sourceUrl] - 原始来源 URL
     * @param {string} [info.thumbnail] - 缩略图（仅当存在同目录同名图片时填入）
     */
    addExistingFile(info) {
        if (!info || !info.filePath || !fs.existsSync(info.filePath)) {
            return { success: false, error: '文件不存在' };
        }
        const stat = fs.statSync(info.filePath);
        const ext = this._getExt(info.filePath);
        const record = {
            id: this._generateId(),
            name: info.name || path.basename(info.filePath),
            path: info.filePath,
            size: stat.size,
            mtime: stat.mtimeMs,
            addedAt: Date.now(),
            sourceType: info.sourceType || 'import',
            sourceUrl: info.sourceUrl || '',
            ext,
            thumbnail: info.thumbnail || ''
        };
        this.manifest.unshift(record);
        this._saveManifest();
        return { success: true, record };
    }

    /**
     * 重命名文件
     * @param {string} id
     * @param {string} newName - 新的文件名（必须带扩展名）
     */
    renameFile(id, newName) {
        const item = this.manifest.find(m => m.id === id);
        if (!item) return { success: false, error: '记录不存在' };
        if (!newName || typeof newName !== 'string') return { success: false, error: '名称无效' };

        // 清洗文件名：去掉路径分隔符
        const safeName = newName.replace(/[\\/:*?"<>|]/g, '_').trim();
        if (!safeName) return { success: false, error: '名称无效' };

        // 保持原扩展名一致（若用户没带扩展名则补回原扩展名）
        const origExt = path.extname(item.name);
        const newExt = path.extname(safeName);
        const finalName = newExt ? safeName : (safeName + origExt);

        const dir = path.dirname(item.path);
        const newPath = path.join(dir, finalName);
        if (newPath === item.path) {
            item.name = finalName;
            this._saveManifest();
            return { success: true, record: item };
        }
        if (fs.existsSync(newPath)) {
            return { success: false, error: '目标文件已存在' };
        }
        try {
            fs.renameSync(item.path, newPath);
            item.name = finalName;
            item.path = newPath;
            this._saveManifest();
            return { success: true, record: item };
        } catch (error) {
            return { success: false, error: '重命名失败: ' + error.message };
        }
    }

    /**
     * 删除文件（移到回收站逻辑较复杂，这里直接物理删除；后续可接入 trash 模块）
     * @param {string} id
     */
    deleteFile(id) {
        const idx = this.manifest.findIndex(m => m.id === id);
        if (idx === -1) return { success: false, error: '记录不存在' };
        const item = this.manifest[idx];
        try {
            if (item.path && fs.existsSync(item.path)) {
                fs.unlinkSync(item.path);
            }
        } catch (error) {
            // 文件已不存在也允许从清单移除
            console.warn('[DOWNLOAD] 物理删除失败（已从清单移除）:', error.message);
        }
        this.manifest.splice(idx, 1);
        this._saveManifest();
        return { success: true };
    }

    /**
     * 移动文件到子目录（目前只允许在下载根目录下创建子目录）
     * @param {string} id
     * @param {string} subDir - 子目录名（相对 downloads/），留空表示移动到 downloads/ 根
     */
    moveFile(id, subDir) {
        const item = this.manifest.find(m => m.id === id);
        if (!item) return { success: false, error: '记录不存在' };
        const safeSub = String(subDir || '').replace(/[\\:*?"<>|]/g, '_').trim();
        const targetDir = safeSub ? path.join(this.downloadDir, safeSub) : this.downloadDir;
        try {
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }
        } catch (e) {
            return { success: false, error: '创建目录失败: ' + e.message };
        }
        const targetPath = path.join(targetDir, item.name);
        if (targetPath === item.path) {
            item.folder = safeSub;
            this._saveManifest();
            return { success: true, record: item };
        }
        if (fs.existsSync(targetPath)) {
            return { success: false, error: '目标位置已存在同名文件' };
        }
        try {
            fs.renameSync(item.path, targetPath);
            item.path = targetPath;
            item.folder = safeSub;
            this._saveManifest();
            return { success: true, record: item };
        } catch (error) {
            return { success: false, error: '移动失败: ' + error.message };
        }
    }

    /**
     * 打开文件所在目录（用系统资源管理器）
     * - 普通文件 / URL 下载文件：showItemInFolder 高亮该文件
     * - 磁力文件：若文件尚未下载完成（磁盘上不存在），
     *   回退到打开 infoHash 目录（magnet/<hash>/）让用户至少看到正在下载的内容位置
     */
    revealInFolder(id) {
        const item = this.manifest.find(m => m.id === id);
        if (!item) return { success: false, error: '记录不存在' };
        try {
            const { shell } = require('electron');
            const fileExists = item.path && fs.existsSync(item.path);
            if (fileExists) {
                shell.showItemInFolder(item.path);
                return { success: true };
            }
            // 磁力文件但磁盘上还没生成：打开 infoHash 目录
            if (item.sourceType === 'magnet' && item.infoHash) {
                const dir = this.getMagnetPath(item.infoHash);
                if (fs.existsSync(dir)) {
                    const errMsg = shell.openPath(dir);
                    if (errMsg) {
                        return { success: false, error: errMsg, openedDir: dir };
                    }
                    return { success: true, openedDir: dir, message: '文件尚未下载完成，已打开所在目录' };
                }
                return { success: false, error: '磁力目录不存在: ' + dir };
            }
            // 普通文件但磁盘上不存在：直接返回失败
            return { success: false, error: '文件不存在: ' + (item.path || '(空路径)') };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * 启动一个 URL 下载任务（http/https）
     * 立即返回 taskId，状态通过 'download-task-progress' 事件广播到所有渲染窗口
     * @param {object} opts
     * @param {string} opts.url
     * @param {string} [opts.fileName] - 可选；不传则从 URL/Content-Disposition 推断
     */
    startUrlDownload(opts) {
        if (!opts || !opts.url) return { success: false, error: 'URL 不能为空' };
        let parsedUrl;
        try {
            parsedUrl = new URL(opts.url);
        } catch (e) {
            return { success: false, error: 'URL 格式无效' };
        }
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
            return { success: false, error: '仅支持 http/https 协议' };
        }

        // 文件名推断：用户指定 > URL 末段 > Content-Disposition > 随机
        let fileName = opts.fileName || path.basename(parsedUrl.pathname) || `download_${Date.now()}`;
        // 去掉 URL 编码字符
        try { fileName = decodeURIComponent(fileName); } catch (e) { /* 忽略 */ }
        // 清洗非法字符
        fileName = fileName.replace(/[\\/:*?"<>|]/g, '_').trim() || `download_${Date.now()}`;
        const savePath = path.join(this.downloadDir, fileName);
        // 同名自动追加序号
        let finalPath = savePath;
        let counter = 1;
        while (fs.existsSync(finalPath)) {
            const ext = path.extname(fileName);
            const stem = fileName.slice(0, fileName.length - ext.length);
            finalPath = path.join(this.downloadDir, `${stem} (${counter})${ext}`);
            counter++;
        }
        const finalName = path.basename(finalPath);

        const taskId = this._generateId();
        const task = {
            id: taskId,
            url: opts.url,
            name: finalName,
            savePath: finalPath,
            totalBytes: 0,
            downloadedBytes: 0,
            status: 'downloading',
            error: null,
            abortController: null
        };
        this.activeTasks.set(taskId, task);
        this._broadcastProgress(task);

        // 异步执行
        this._doHttpDownload(task).catch(err => {
            task.status = 'error';
            task.error = err.message;
            this._broadcastProgress(task);
        });
        return { success: true, taskId, name: finalName };
    }

    /**
     * 取消一个活动任务（删除已下载部分）
     */
    cancelTask(taskId) {
        const task = this.activeTasks.get(taskId);
        if (!task) return { success: false, error: '任务不存在' };
        try {
            if (task.abortController) task.abortController.abort();
        } catch (e) { /* 忽略 */ }
        // 清理磁盘上的不完整文件
        try {
            if (fs.existsSync(task.savePath)) fs.unlinkSync(task.savePath);
        } catch (e) { /* 忽略 */ }
        this.activeTasks.delete(taskId);
        return { success: true };
    }

    /**
     * 实际执行 HTTP GET 写入磁盘
     * @param {object} task 任务对象
     * @param {number} [maxRedirects=10] 最大重定向次数，防止恶意/异常服务器链式跳转导致栈溢出
     */
    _doHttpDownload(task, maxRedirects = 10) {
        return new Promise((resolve, reject) => {
            const lib = task.url.startsWith('https') ? https : http;
            const req = lib.get(task.url, response => {
                if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                    // 跟随重定向，超过最大次数则拒绝（避免栈溢出）
                    if (maxRedirects <= 0) {
                        response.resume(); // 释放当前响应
                        reject(new Error('太多重定向'));
                        return;
                    }
                    const redirectUrl = new URL(response.headers.location, task.url).toString();
                    response.resume(); // 释放
                    task.url = redirectUrl;
                    this._doHttpDownload(task, maxRedirects - 1).then(resolve).catch(reject);
                    return;
                }
                if (response.statusCode !== 200) {
                    reject(new Error(`HTTP ${response.statusCode}`));
                    return;
                }
                const total = parseInt(response.headers['content-length'] || '0', 10);
                task.totalBytes = Number.isFinite(total) ? total : 0;
                this._broadcastProgress(task);

                const fileStream = fs.createWriteStream(task.savePath);
                response.pipe(fileStream);

                response.on('data', chunk => {
                    task.downloadedBytes += chunk.length;
                    this._broadcastProgress(task, true); // 节流：true 表示由调用方控制频率
                });

                fileStream.on('finish', () => {
                    fileStream.close(() => {
                        try {
                            const stat = fs.statSync(task.savePath);
                            const ext = this._getExt(task.savePath);
                            const record = {
                                id: this._generateId(),
                                name: task.name,
                                path: task.savePath,
                                size: stat.size,
                                mtime: stat.mtimeMs,
                                addedAt: Date.now(),
                                sourceType: 'url',
                                sourceUrl: task.url,
                                ext,
                                thumbnail: ''
                            };
                            this.manifest.unshift(record);
                            this._saveManifest();
                            task.status = 'completed';
                            this._broadcastProgress(task);
                            // 完成后从活动任务中清除（保留约 3s 让前端收到完成事件）
                            setTimeout(() => this.activeTasks.delete(task.id), 3000);
                            resolve();
                        } catch (e) {
                            reject(e);
                        }
                    });
                });

                fileStream.on('error', err => {
                    try { fs.unlinkSync(task.savePath); } catch (e) { /* 忽略 */ }
                    reject(err);
                });
            });
            req.on('error', err => reject(err));
            req.setTimeout(30000, () => req.destroy(new Error('连接超时')));
            task.abortController = req;
        });
    }

    /**
     * 广播任务进度到所有窗口（节流 200ms）
     */
    _broadcastProgress(task, throttled = false) {
        if (throttled) {
            const now = Date.now();
            if (task._lastBroadcast && now - task._lastBroadcast < 200) return;
            task._lastBroadcast = now;
        }
        const payload = {
            id: task.id,
            name: task.name,
            url: task.url,
            status: task.status,
            downloadedBytes: task.downloadedBytes,
            totalBytes: task.totalBytes,
            progress: task.totalBytes > 0 ? Math.min(100, (task.downloadedBytes / task.totalBytes) * 100) : 0,
            error: task.error || null
        };
        for (const win of BrowserWindow.getAllWindows()) {
            if (win && !win.isDestroyed()) {
                win.webContents.send('download-task-progress', payload);
            }
        }
    }

    /**
     * 获取下载根目录
     */
    getDownloadDir() {
        return this.downloadDir;
    }

    /**
     * 列出子目录（用于"移动到"对话框）
     */
    listFolders() {
        try {
            if (!fs.existsSync(this.downloadDir)) return [];
            return fs.readdirSync(this.downloadDir, { withFileTypes: true })
                .filter(d => d.isDirectory())
                .map(d => d.name);
        } catch (e) {
            return [];
        }
    }

    /**
     * 磁力链专属子目录：userData/downloads/magnet/
     * 每个 infoHash 一个独立子目录（避免不同磁力文件路径冲突）
     */
    getMagnetDir() {
        const dir = path.join(this.downloadDir, 'magnet');
        try {
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        } catch (e) {
            console.error('[DOWNLOAD] 创建 magnet 目录失败:', e.message);
        }
        return dir;
    }

    /**
     * 单个磁力的存储子目录：magnetDir/<infoHash>/
     * 用于 WebTorrent 的 path 选项，从断点恢复时复用同一目录
     */
    getMagnetPath(infoHash) {
        if (!infoHash) return this.getMagnetDir();
        const safe = String(infoHash).toLowerCase().replace(/[^a-f0-9]/g, '');
        const dir = path.join(this.getMagnetDir(), safe);
        try {
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        } catch (e) {
            console.error('[DOWNLOAD] 创建 magnet 子目录失败:', e.message);
        }
        return dir;
    }

    /**
     * 登记一个磁力下载任务（创建时即记录，无论完成与否）
     * @param {object} meta
     * @param {string} meta.name - 显示名（torrent.name 或 file.name）
     * @param {string} meta.filePath - 磁盘绝对路径（包含 WebTorrent 子目录）
     * @param {string} meta.magnetUri - 原始 magnet 链接
     * @param {string} meta.infoHash - 种子 info hash
     * @param {number} [meta.totalSize=0] - 完整文件大小
     * @param {number} [meta.downloaded=0] - 当前已下载字节
     * @param {string} [meta.status='downloading'] - downloading/paused/completed/error
     * @returns {{success: boolean, record?: object, error?: string}}
     */
    addMagnetFile(meta) {
        if (!meta || !meta.infoHash) {
            return { success: false, error: '缺少 infoHash' };
        }
        // 已存在则更新（按 infoHash+name 唯一标识）
        const existing = this.manifest.find(m =>
            m.sourceType === 'magnet' &&
            m.infoHash === meta.infoHash &&
            m.name === (meta.name || path.basename(meta.filePath || ''))
        );
        if (existing) {
            // 增量更新
            if (meta.filePath && meta.filePath !== existing.path) existing.path = meta.filePath;
            if (Number.isFinite(meta.totalSize) && meta.totalSize > 0) existing.totalSize = meta.totalSize;
            if (Number.isFinite(meta.downloaded)) existing.size = meta.downloaded;
            if (meta.status) existing.status = meta.status;
            // 回填 magnetUri：旧记录 sourceUrl 为空时（如首次自动创建漏写），
            // 后续再调用 addMagnetFile 时如果传入了 magnetUri 也能补上 —— "继续"按钮的回退路径才能工作
            if (meta.magnetUri && !existing.sourceUrl) existing.sourceUrl = meta.magnetUri;
            existing.mtime = Date.now();
            this._saveManifest();
            return { success: true, record: existing, updated: true };
        }
        const record = {
            id: this._generateId(),
            name: meta.name || (meta.filePath ? path.basename(meta.filePath) : `magnet_${meta.infoHash.slice(0, 8)}`),
            path: meta.filePath || '',
            size: Number.isFinite(meta.downloaded) ? meta.downloaded : 0,
            totalSize: Number.isFinite(meta.totalSize) ? meta.totalSize : 0,
            mtime: Date.now(),
            addedAt: Date.now(),
            sourceType: 'magnet',
            sourceUrl: meta.magnetUri || '',
            infoHash: meta.infoHash,
            status: meta.status || 'downloading',
            ext: meta.ext || (meta.filePath ? this._getExt(meta.filePath) : ''),
            thumbnail: '',
            folder: 'magnet'
        };
        this.manifest.unshift(record);
        this._saveManifest();
        return { success: true, record, updated: false };
    }

    /**
     * 更新磁力文件进度（高频调用，内部节流持久化）
     * @param {string} infoHash
     * @param {string} fileName - 用于匹配同名记录
     * @param {object} payload - { downloaded, total, status, filePath? }
     */
    updateMagnetProgress(infoHash, fileName, payload) {
        if (!infoHash) return;
        const item = this.manifest.find(m =>
            m.sourceType === 'magnet' &&
            m.infoHash === infoHash &&
            (!fileName || m.name === fileName)
        );
        if (!item) return false;
        if (Number.isFinite(payload.downloaded)) item.size = payload.downloaded;
        if (Number.isFinite(payload.total) && payload.total > 0) item.totalSize = payload.total;
        if (payload.status) item.status = payload.status;
        if (payload.filePath) item.path = payload.filePath;
        item.mtime = Date.now();
        // 节流：每 2s 最多写一次磁盘（高频进度不必实时落盘）
        const now = Date.now();
        if (!item._lastSave || now - item._lastSave > 2000) {
            this._saveManifest();
            item._lastSave = now;
        }
        return true;
    }

    /**
     * 强制刷盘（用于关键状态切换：暂停/完成/错误）
     */
    flushMagnet(item) {
        if (item) delete item._lastSave;
        this._saveManifest();
    }

    /**
     * 删除磁力记录并清理磁盘文件
     * @param {string} id
     * @param {object} [opts]
     * @param {boolean} [opts.removeFiles=true] - 是否同时删除磁盘文件
     * @param {boolean} [opts.removeDir=true] - 是否同时删除 infoHash 目录
     */
    removeMagnetFile(id, opts = {}) {
        const { removeFiles = true, removeDir = true } = opts;
        const idx = this.manifest.findIndex(m => m.id === id);
        if (idx === -1) return { success: false, error: '记录不存在' };
        const item = this.manifest[idx];
        if (removeFiles && item.path) {
            try {
                if (fs.existsSync(item.path)) fs.unlinkSync(item.path);
            } catch (e) { /* 忽略文件删除失败 */ }
        }
        // 删除所属 infoHash 目录（如果为空）
        if (removeDir && item.infoHash) {
            const dir = this.getMagnetPath(item.infoHash);
            try {
                if (fs.existsSync(dir)) {
                    const remaining = fs.readdirSync(dir);
                    if (remaining.length === 0) fs.rmdirSync(dir);
                }
            } catch (e) { /* 忽略目录删除失败 */ }
        }
        this.manifest.splice(idx, 1);
        this._saveManifest();
        return { success: true };
    }

    /**
     * 暂停时记录磁盘上已下载的实际大小（用于恢复后正确显示进度）
     */
    refreshMagnetSize(id) {
        const item = this.manifest.find(m => m.id === id);
        if (!item || !item.path) return;
        try {
            if (fs.existsSync(item.path)) {
                const stat = fs.statSync(item.path);
                item.size = stat.size;
                item.mtime = stat.mtimeMs;
                this._saveManifest();
            }
        } catch (e) { /* 忽略 */ }
    }
}

module.exports = DownloadManager;
