// 下载管理模块 - 集中管理已下载的影视内容（任务-文件两层结构）
// 支持：任务级 CRUD / 文件级管理 / 列表 / 重命名 / 删除 / 移动 / 搜索 / URL 下载任务
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');
const https = require('https');
const http = require('http');
const { URL } = require('url');

/**
 * 下载管理器
 * manifest 结构（任务-文件两层）：
 *   [{ id, type, name, status, infoHash, magnetUri, files: [...], sourceType, sourceUrl, folder, thumbnail, totalSize, downloaded, progress, addedAt, mtime }]
 * files 元素：{ id, name, path, size, downloaded, status, priority, ext, addedAt, thumbnail }
 */
class DownloadManager {
    constructor() {
        // 默认下载目录：用户数据目录下的 downloads/
        // 测试覆盖：通过 QIXING_USER_DATA_DIR 环境变量指定下载根目录，避免依赖 electron.app
        const userData = process.env.QIXING_USER_DATA_DIR || (app && app.getPath ? app.getPath('userData') : null);
        this.downloadDir = userData ? path.join(userData, 'downloads') : path.join(require('os').tmpdir(), 'qixing-downloads');
        // 元数据清单：每个任务一条记录（task.files 存储该任务下的文件列表）
        this.manifestPath = path.join(this.downloadDir, 'manifest.json');
        this.manifest = []; // [{ id, type, name, status, files: [...], ... }]
        // 活动下载任务：id -> { id, url, name, totalBytes, downloadedBytes, status, savePath, error }
        this.activeTasks = new Map();
        this._initialized = false;
    }

    /**
     * 初始化：确保目录存在、加载 manifest、迁移旧结构、对账磁盘
     * 关键：磁盘是权威源 —— manifest 丢了/损坏/不一致都能从磁盘恢复
     */
    initialize() {
        if (this._initialized) return;
        try {
            if (!fs.existsSync(this.downloadDir)) {
                fs.mkdirSync(this.downloadDir, { recursive: true });
            }
            this._loadManifest();
            // 启动时迁移旧 manifest（文件级 → 任务级）
            this._migrateLegacyManifest();
            // 启动时对账：磁盘文件 ∪ manifest 记录，去掉已失效的 URL/import 记录
            this._reconcileWithDisk();
            this._initialized = true;
            console.log('[DOWNLOAD] 初始化完成, 目录:', this.downloadDir, '任务数:', this.manifest.length);
        } catch (error) {
            console.error('[DOWNLOAD] 初始化失败:', error);
        }
    }

    /**
     * 迁移旧 manifest（文件级）到新结构（任务级）
     * 旧结构：每条记录是单个文件，磁力文件按 infoHash + name 唯一
     * 新结构：每条记录是任务，task.files = [...] 存储文件列表
     * 迁移规则：
     *   - 磁力文件：按 infoHash 聚合，同 infoHash 的多个文件合并为一个 task
     *   - URL/import 文件：每个文件转为单文件 task（files 数组只有 1 项）
     *   - 保留所有元数据（path, size, status, addedAt 等）
     */
    _migrateLegacyManifest() {
        if (this.manifest.length === 0) return;
        // 检测是否已是新结构（有 files 字段则跳过）
        const needsMigration = this.manifest.some(item => !Array.isArray(item.files));
        if (!needsMigration) return;

        console.log('[DOWNLOAD] 检测到旧 manifest 结构，开始迁移...');
        const oldItems = this.manifest;
        this.manifest = [];

        // 1) 磁力文件按 infoHash 聚合
        const magnetGroups = new Map(); // infoHash -> [oldItem]
        const nonMagnetItems = [];
        for (const item of oldItems) {
            if (item.sourceType === 'magnet' && item.infoHash) {
                const group = magnetGroups.get(item.infoHash) || [];
                group.push(item);
                magnetGroups.set(item.infoHash, group);
            } else {
                nonMagnetItems.push(item);
            }
        }

        // 2) 磁力任务：每个 infoHash 创建一个 task
        for (const [infoHash, files] of magnetGroups) {
            const first = files[0];
            const taskFiles = files.map(f => ({
                id: 'file_' + this._generateId(),
                name: f.name,
                path: f.path || '',
                size: Number.isFinite(f.size) ? f.size : 0,
                downloaded: Number.isFinite(f.size) ? f.size : 0,
                status: f.status || 'completed',
                priority: 1,
                ext: f.ext || this._getExt(f.name || ''),
                addedAt: f.addedAt || Date.now(),
                thumbnail: f.thumbnail || ''
            }));
            const task = {
                id: 'task_' + this._generateId(),
                type: 'magnet',
                name: first.name || `magnet_${infoHash.slice(0, 8)}`,
                status: this._aggregateTaskStatus(taskFiles),
                addedAt: Math.min(...files.map(f => f.addedAt || Date.now())),
                mtime: Date.now(),
                infoHash,
                magnetUri: first.sourceUrl || '',
                files: taskFiles,
                sourceType: 'magnet',
                sourceUrl: first.sourceUrl || '',
                folder: 'magnet',
                thumbnail: ''
            };
            this._recomputeTaskStats(task);
            this.manifest.push(task);
        }

        // 3) URL/import 文件：每个文件转为单文件 task
        for (const item of nonMagnetItems) {
            const taskFile = {
                id: 'file_' + this._generateId(),
                name: item.name,
                path: item.path || '',
                size: Number.isFinite(item.size) ? item.size : 0,
                downloaded: Number.isFinite(item.size) ? item.size : 0,
                status: 'completed',
                priority: 1,
                ext: item.ext || this._getExt(item.name || ''),
                addedAt: item.addedAt || Date.now(),
                thumbnail: item.thumbnail || ''
            };
            const task = {
                id: 'task_' + this._generateId(),
                type: item.sourceType || 'import',
                name: item.name,
                status: 'completed',
                addedAt: item.addedAt || Date.now(),
                mtime: item.mtime || Date.now(),
                files: [taskFile],
                sourceType: item.sourceType || 'import',
                sourceUrl: item.sourceUrl || '',
                folder: item.folder || '',
                thumbnail: item.thumbnail || ''
            };
            this._recomputeTaskStats(task);
            this.manifest.push(task);
        }

        this._saveManifest();
        console.log('[DOWNLOAD] 迁移完成:', oldItems.length, '条旧记录 →', this.manifest.length, '个任务');
    }

    /**
     * 聚合任务状态（根据 files 数组计算 task.status）
     * @param {Array} files - 任务文件列表
     * @returns {'downloading'|'paused'|'completed'|'error'}
     */
    _aggregateTaskStatus(files) {
        const active = files.filter(f => f.priority > 0);
        if (active.length === 0) return 'completed';
        if (active.some(f => f.status === 'error')) return 'error';
        if (active.every(f => f.status === 'completed')) return 'completed';
        if (active.every(f => f.status === 'paused')) return 'paused';
        return 'downloading';
    }

    /**
     * 重新计算任务的聚合统计（totalSize/downloaded/progress/status）
     * @param {object} task - 任务记录
     */
    _recomputeTaskStats(task) {
        if (!Array.isArray(task.files)) task.files = [];
        const active = task.files.filter(f => f.priority > 0);
        task.totalSize = active.reduce((sum, f) => sum + (Number(f.size) || 0), 0);
        task.downloaded = active.reduce((sum, f) => sum + (Number(f.downloaded) || 0), 0);
        task.progress = task.totalSize > 0 ? Math.min(100, (task.downloaded / task.totalSize) * 100) : 0;
        task.status = this._aggregateTaskStatus(task.files);
    }

    /**
     * 添加磁力任务（带选中的文件列表）
     * @param {object} meta
     * @param {string} meta.magnetUri - 原始磁力链
     * @param {string} meta.infoHash - 种子 info hash
     * @param {string} meta.taskName - 任务名（torrent.name）
     * @param {Array} meta.selectedFiles - 选中的文件列表 [{ name, size, ext }]
     * @param {Array} meta.allFiles - 所有文件列表（含未选中的，priority=0）
     * @returns {{success: boolean, task?: object, error?: string}}
     */
    addMagnetTask(meta) {
        if (!meta || !meta.infoHash) {
            return { success: false, error: '缺少 infoHash' };
        }
        // 已存在则更新（按 infoHash 唯一，兼容 sourceType 判断）
        const existing = this.manifest.find(m =>
            (m.type === 'magnet' || m.sourceType === 'magnet') && m.infoHash === meta.infoHash
        );
        if (existing) {
            // 增量更新：合并文件列表
            if (!Array.isArray(existing.files)) existing.files = [];
            const existingNames = new Set(existing.files.map(f => f.name));
            for (const sf of (meta.selectedFiles || [])) {
                if (!existingNames.has(sf.name)) {
                    existing.files.push({
                        id: 'file_' + this._generateId(),
                        name: sf.name,
                        path: path.join(this.getMagnetPath(meta.infoHash), sf.name),
                        size: sf.size || 0,
                        downloaded: 0,
                        status: 'downloading',
                        priority: 1,
                        ext: sf.ext || this._getExt(sf.name),
                        addedAt: Date.now(),
                        thumbnail: ''
                    });
                }
            }
            if (meta.magnetUri && !existing.magnetUri) existing.magnetUri = meta.magnetUri;
            if (meta.magnetUri && !existing.sourceUrl) existing.sourceUrl = meta.magnetUri;
            existing.type = 'magnet';
            existing.sourceType = 'magnet';
            this._recomputeTaskStats(existing);
            existing.mtime = Date.now();
            this._saveManifest();
            return { success: true, task: existing, updated: true };
        }
        // 创建新任务
        const allFiles = meta.allFiles || meta.selectedFiles || [];
        const selectedNames = new Set((meta.selectedFiles || []).map(f => f.name));
        const taskFiles = allFiles.map(f => ({
            id: 'file_' + this._generateId(),
            name: f.name,
            path: path.join(this.getMagnetPath(meta.infoHash), f.name),
            size: f.size || 0,
            downloaded: 0,
            status: selectedNames.has(f.name) ? 'downloading' : 'skipped',
            priority: selectedNames.has(f.name) ? 1 : 0,
            ext: f.ext || this._getExt(f.name),
            addedAt: Date.now(),
            thumbnail: ''
        }));
        const task = {
            id: 'task_' + this._generateId(),
            type: 'magnet',
            name: meta.taskName || `magnet_${meta.infoHash.slice(0, 8)}`,
            status: 'downloading',
            addedAt: Date.now(),
            mtime: Date.now(),
            infoHash: meta.infoHash,
            magnetUri: meta.magnetUri || '',
            files: taskFiles,
            sourceType: 'magnet',
            sourceUrl: meta.magnetUri || '',
            folder: 'magnet',
            thumbnail: ''
        };
        this._recomputeTaskStats(task);
        this.manifest.unshift(task);
        this._saveManifest();
        return { success: true, task, updated: false };
    }

    /**
     * 列出所有任务（聚合视图，不含完整 files 数组，减少 IPC 传输）
     * 兼容字段：单文件 task 暴露 path/size/ext/folder，方便旧调用方读取
     * @param {object} options - search/type/sortBy/sortDir
     */
    listTasks(options = {}) {
        const { search = '', type = '', sortBy = 'mtime', sortDir = 'desc' } = options;
        let result = this.manifest.map(t => {
            const singleFile = Array.isArray(t.files) && t.files.length === 1 ? t.files[0] : null;
            return {
                id: t.id,
                type: t.type,
                name: t.name,
                status: t.status,
                addedAt: t.addedAt,
                mtime: t.mtime,
                infoHash: t.infoHash || '',
                totalSize: t.totalSize || 0,
                downloaded: t.downloaded || 0,
                progress: t.progress || 0,
                downloadSpeed: t.downloadSpeed || 0,
                numPeers: t.numPeers || 0,
                eta: t.eta || null,
                fileCount: Array.isArray(t.files) ? t.files.length : 0,
                completedFileCount: Array.isArray(t.files) ? t.files.filter(f => f.status === 'completed').length : 0,
                activeFileCount: Array.isArray(t.files) ? t.files.filter(f => f.priority > 0).length : 0,
                sourceType: t.sourceType,
                sourceUrl: t.sourceUrl,
                thumbnail: t.thumbnail,
                folder: t.folder || '',
                // 兼容字段：单文件 task 暴露文件级 path/size/ext，方便旧调用方读取
                path: singleFile ? singleFile.path : '',
                size: singleFile ? (singleFile.downloaded || 0) : (t.downloaded || 0),
                ext: singleFile ? (singleFile.ext || '') : ''
            };
        });

        const kw = String(search || '').trim().toLowerCase();
        if (kw) {
            result = result.filter(t => (t.name || '').toLowerCase().includes(kw));
        }
        if (type) {
            result = result.filter(t => t.type === type);
        }

        const dir = sortDir === 'asc' ? 1 : -1;
        result.sort((a, b) => {
            let va = a[sortBy];
            let vb = b[sortBy];
            if (sortBy === 'totalSize' || sortBy === 'addedAt' || sortBy === 'mtime' || sortBy === 'progress' || sortBy === 'size') {
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
     * 获取任务详情（含完整 files 数组）
     * @param {string} taskId
     */
    getTask(taskId) {
        const task = this.manifest.find(t => t.id === taskId);
        if (!task) return null;
        return JSON.parse(JSON.stringify(task)); // 深拷贝避免外部修改
    }

    /**
     * 删除整个任务（含所有文件 + infoHash 目录）
     * @param {string} taskId
     */
    deleteTask(taskId) {
        const idx = this.manifest.findIndex(t => t.id === taskId);
        if (idx === -1) return { success: false, error: '任务不存在' };
        const task = this.manifest[idx];
        const errors = [];
        // 删除所有文件
        for (const f of task.files) {
            if (f.path) {
                try {
                    if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
                } catch (e) {
                    errors.push(`文件 ${f.name} 删除失败: ${e.message}`);
                }
                // 删除 .complete 标记
                try {
                    const marker = f.path + '.complete';
                    if (fs.existsSync(marker)) fs.unlinkSync(marker);
                } catch (e) { /* 忽略 */ }
            }
        }
        // 递归删除 infoHash 目录（磁力任务）
        if (task.type === 'magnet' && task.infoHash) {
            try {
                const dir = this.getMagnetPath(task.infoHash);
                if (fs.existsSync(dir)) {
                    fs.rmSync(dir, { recursive: true, force: true });
                }
            } catch (e) {
                errors.push(`目录删除失败: ${e.message}`);
            }
        }
        this.manifest.splice(idx, 1);
        this._saveManifest();
        if (errors.length > 0) {
            console.warn('[DOWNLOAD] 任务删除部分失败:', errors.join('; '));
        }
        return { success: true, warnings: errors.length > 0 ? errors : undefined };
    }

    /**
     * 删除任务内单个文件
     * @param {string} taskId
     * @param {string} fileId
     */
    deleteTaskFile(taskId, fileId) {
        const task = this.manifest.find(t => t.id === taskId);
        if (!task) return { success: false, error: '任务不存在' };
        const fIdx = task.files.findIndex(f => f.id === fileId);
        if (fIdx === -1) return { success: false, error: '文件不存在' };
        const file = task.files[fIdx];
        // 删除磁盘文件 + .complete 标记
        if (file.path) {
            try {
                if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
            } catch (e) { /* 忽略 */ }
            try {
                const marker = file.path + '.complete';
                if (fs.existsSync(marker)) fs.unlinkSync(marker);
            } catch (e) { /* 忽略 */ }
        }
        task.files.splice(fIdx, 1);
        // 如果任务内没有文件了，删除整个任务
        if (task.files.length === 0) {
            return this.deleteTask(taskId);
        }
        this._recomputeTaskStats(task);
        task.mtime = Date.now();
        this._saveManifest();
        return { success: true };
    }

    /**
     * 设置文件下载优先级（0=不下载, 1=正常, 2=高优先级）
     * @param {string} taskId
     * @param {string} fileId
     * @param {number} priority
     */
    setFilePriority(taskId, fileId, priority) {
        const task = this.manifest.find(t => t.id === taskId);
        if (!task) return { success: false, error: '任务不存在' };
        const file = task.files.find(f => f.id === fileId);
        if (!file) return { success: false, error: '文件不存在' };
        file.priority = priority;
        if (priority === 0) {
            file.status = 'skipped';
        } else if (file.status === 'skipped') {
            file.status = 'downloading';
        }
        this._recomputeTaskStats(task);
        task.mtime = Date.now();
        this._saveManifest();
        return { success: true };
    }

    /**
     * 把磁盘与 manifest 对齐（磁盘是权威源）
     * 新结构：按 infoHash 扫描 magnet/ 目录，更新对应 task.files
     * - 扫描磁盘上有但 manifest 没有的文件 → 补登记为单文件 task
     * - 磁力未完成状态的 task 即使磁盘上没有文件也保留
     * - URL/import task 磁盘上找不到文件 → 删除
     * - 启动时归位 in-progress 磁力状态为 paused
     */
    _reconcileWithDisk() {
        // 0) 先迁移可能存在的旧结构记录（防御性：测试或外部代码可能直接 push 旧记录）
        this._migrateLegacyManifest();

        // 1) 扫描磁盘
        const diskEntries = this._scanDownloadDir();

        // 2) 把磁盘上有但 manifest 没有的文件补登记为单文件 task
        let added = 0;
        for (const entry of diskEntries) {
            const existing = this._findTaskByPath(entry.path);
            if (!existing) {
                this.manifest.unshift(this._buildTaskFromDiskEntry(entry));
                added++;
            } else {
                // 已有记录：用磁盘上最新的 mtime/size 刷新对应 file
                try {
                    const stat = fs.statSync(entry.path);
                    const file = existing.files.find(f => f.path === entry.path);
                    if (file) {
                        file.size = stat.size;
                        if (file.status === 'completed' || file.status === 'downloading') {
                            file.downloaded = stat.size;
                        }
                    }
                    existing.mtime = stat.mtimeMs;
                } catch (e) { /* 忽略单条 stat 失败 */ }
            }
        }

        // 3) 启动时归位 in-progress 磁力状态为 paused
        // 关键：子进程未启动前 "downloading" 是误导（点击暂停也无效）
        let demoted = 0;
        for (const task of this.manifest) {
            if (task.type === 'magnet' && task.status && task.status !== 'completed') {
                if (task.status !== 'paused') {
                    task.status = 'paused';
                    for (const f of task.files) {
                        if (f.priority > 0 && f.status !== 'completed') {
                            f.status = 'paused';
                        }
                    }
                    demoted++;
                }
                // 启动时清空实时指标（旧值已无意义）
                task.downloadSpeed = 0;
                task.numPeers = 0;
                task.eta = null;
            }
        }

        // 4) 处理 manifest 中磁盘没有的记录
        const before = this.manifest.length;
        this.manifest = this.manifest.filter(task => {
            // 磁力未完成状态：磁盘文件可能尚未存在 → 保留
            if (task.type === 'magnet' && task.status !== 'completed') {
                return true;
            }
            // 其他情况：检查 task.files 中是否至少有一个文件存在
            if (!Array.isArray(task.files) || task.files.length === 0) return false;
            return task.files.some(f => {
                try {
                    return f.path && fs.existsSync(f.path);
                } catch (e) {
                    return false;
                }
            });
        });
        const pruned = before - this.manifest.length;

        // 5) 重新计算所有任务的聚合统计
        for (const task of this.manifest) {
            this._recomputeTaskStats(task);
        }

        if (added > 0 || pruned > 0 || demoted > 0) {
            this._saveManifest();
            console.log(`[DOWNLOAD] 对账完成: 新增 ${added} 条, 清理 ${pruned} 条, 归位 ${demoted} 条`);
        }
    }

    /**
     * 在 manifest 中查找包含指定路径文件的 task
     * @param {string} filePath
     * @returns {object|null}
     */
    _findTaskByPath(filePath) {
        for (const task of this.manifest) {
            if (Array.isArray(task.files) && task.files.some(f => f.path === filePath)) {
                return task;
            }
        }
        return null;
    }

    /**
     * 从磁盘扫描结果构建一条单文件 task 记录
     * （用于补登记：磁盘有文件但 manifest 没记录 —— 之前 manifest 丢失/损坏时）
     */
    _buildTaskFromDiskEntry(entry) {
        const baseName = entry.fileName;
        const ext = this._getExt(baseName);
        const isMagnet = entry.sourceType === 'magnet';
        const file = {
            id: 'file_' + this._generateId(),
            name: baseName,
            path: entry.path,
            size: entry.stat.size,
            downloaded: entry.stat.size,
            status: 'completed',
            priority: 1,
            ext,
            addedAt: entry.stat.mtimeMs,
            thumbnail: ''
        };
        const task = {
            id: 'task_' + this._generateId(),
            type: isMagnet ? 'magnet' : 'import',
            name: baseName,
            status: 'completed',
            addedAt: entry.stat.mtimeMs,
            mtime: entry.stat.mtimeMs,
            files: [file],
            sourceType: entry.sourceType,
            sourceUrl: '',
            folder: isMagnet ? 'magnet' : (entry.folder || ''),
            thumbnail: ''
        };
        if (isMagnet) {
            task.infoHash = entry.infoHash;
            task.magnetUri = '';
        }
        this._recomputeTaskStats(task);
        return task;
    }

    /**
     * 扫描下载目录，返回所有文件条目
     * 目录约定：
     *   downloadDir/magnet/<infoHash>/<filename> → 磁力下载（按 infoHash 子目录隔离）
     *   downloadDir/<其他子目录或根>/<filename>  → URL/import 下载
     * @returns {Array<{path, sourceType, infoHash?, fileName, folder?, stat}>}
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
     * 列出文件（兼容旧调用方，返回任务列表）
     * 旧调用方期望返回文件数组，新结构返回任务数组
     * 为兼容，保留 listFiles 方法但内部调 listTasks
     * @param {object} options - search/sourceType/sortBy/sortDir
     */
    listFiles(options = {}) {
        // 旧调用方传 sourceType 筛选，新结构按 type 筛选；sortBy=size 映射为 totalSize
        const { sourceType, sortBy, ...rest } = options;
        const merged = { ...rest };
        if (sourceType) merged.type = sourceType;
        if (sortBy === 'size') merged.sortBy = 'totalSize';
        return this.listTasks(merged);
    }

    /**
     * 列出活动下载任务（URL 下载进行中的）
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
     * 新结构下创建单文件 task，返回 record 指向 task.files[0]（兼容旧调用方读取 record.id/size/ext）
     * @param {object} info
     * @param {string} info.name - 显示名
     * @param {string} info.filePath - 磁盘绝对路径
     * @param {string} [info.sourceType='import'] - url/magnet/import
     * @param {string} [info.sourceUrl] - 原始来源 URL
     * @param {string} [info.thumbnail] - 缩略图
     */
    addExistingFile(info) {
        if (!info || !info.filePath || !fs.existsSync(info.filePath)) {
            return { success: false, error: '文件不存在' };
        }
        const stat = fs.statSync(info.filePath);
        const ext = this._getExt(info.filePath);
        const displayName = info.name || path.basename(info.filePath);
        const sourceType = info.sourceType || 'import';
        const file = {
            id: 'file_' + this._generateId(),
            name: displayName,
            path: info.filePath,
            size: stat.size,
            downloaded: stat.size,
            status: 'completed',
            priority: 1,
            ext,
            addedAt: Date.now(),
            thumbnail: info.thumbnail || '',
            // 兼容字段：旧调用方读取 file.sourceType / file.folder
            sourceType,
            folder: ''
        };
        const task = {
            id: 'task_' + this._generateId(),
            type: sourceType,
            name: displayName,
            status: 'completed',
            addedAt: Date.now(),
            mtime: Date.now(),
            files: [file],
            sourceType,
            sourceUrl: info.sourceUrl || '',
            folder: '',
            thumbnail: info.thumbnail || ''
        };
        this._recomputeTaskStats(task);
        this.manifest.unshift(task);
        this._saveManifest();
        return { success: true, record: file, task };
    }

    /**
     * 重命名文件（兼容旧调用方）
     * id 可以是 taskId 或 fileId：
     *   - taskId：对单文件 task 重命名（task.name + task.files[0].name）
     *   - fileId：重命名对应 file
     * @param {string} id
     * @param {string} newName - 新的文件名（必须带扩展名）
     */
    renameFile(id, newName) {
        if (!newName || typeof newName !== 'string') return { success: false, error: '名称无效' };
        // 清洗文件名：去掉路径分隔符
        const safeName = newName.replace(/[\\/:*?"<>|]/g, '_').trim();
        if (!safeName) return { success: false, error: '名称无效' };

        // 查找 task + file（先按 taskId，再按 fileId）
        let task = this.manifest.find(t => t.id === id);
        let file = null;
        if (task) {
            file = Array.isArray(task.files) && task.files.length > 0 ? task.files[0] : null;
        } else {
            for (const t of this.manifest) {
                const f = (Array.isArray(t.files) ? t.files : []).find(f => f.id === id);
                if (f) {
                    task = t;
                    file = f;
                    break;
                }
            }
        }
        if (!task || !file) return { success: false, error: '记录不存在' };

        // 保持原扩展名一致（若用户没带扩展名则补回原扩展名）
        const origExt = path.extname(file.name);
        const newExt = path.extname(safeName);
        const finalName = newExt ? safeName : (safeName + origExt);

        const dir = path.dirname(file.path);
        const newPath = path.join(dir, finalName);
        if (newPath === file.path) {
            file.name = finalName;
            if (task.files.length === 1) task.name = finalName;
            task.mtime = Date.now();
            this._saveManifest();
            return { success: true, record: file };
        }
        if (fs.existsSync(newPath)) {
            return { success: false, error: '目标文件已存在' };
        }
        try {
            fs.renameSync(file.path, newPath);
            file.name = finalName;
            file.path = newPath;
            if (task.files.length === 1) task.name = finalName;
            task.mtime = Date.now();
            this._saveManifest();
            return { success: true, record: file };
        } catch (error) {
            return { success: false, error: '重命名失败: ' + error.message };
        }
    }

    /**
     * 删除文件（兼容旧调用方）
     * 旧调用方传入 id（可能是 taskId 或 fileId），通过遍历所有 task.files 找到对应项
     * @param {string} id
     */
    deleteFile(id) {
        // 先尝试作为 taskId 删除（旧调用方可能传 task.id）
        const task = this.manifest.find(t => t.id === id);
        if (task) {
            return this.deleteTask(id);
        }
        // 作为 fileId 删除
        for (const t of this.manifest) {
            const f = (Array.isArray(t.files) ? t.files : []).find(f => f.id === id);
            if (f) {
                return this.deleteTaskFile(t.id, id);
            }
        }
        return { success: false, error: '记录不存在' };
    }

    /**
     * 移动文件到子目录（兼容旧调用方）
     * id 可以是 taskId 或 fileId，仅对非磁力单文件 task 生效
     * @param {string} id
     * @param {string} subDir - 子目录名（相对 downloads/），留空表示移动到 downloads/ 根
     */
    moveFile(id, subDir) {
        // 查找 task + file
        let task = this.manifest.find(t => t.id === id);
        let file = null;
        if (task) {
            file = Array.isArray(task.files) && task.files.length > 0 ? task.files[0] : null;
        } else {
            for (const t of this.manifest) {
                const f = (Array.isArray(t.files) ? t.files : []).find(f => f.id === id);
                if (f) {
                    task = t;
                    file = f;
                    break;
                }
            }
        }
        if (!task || !file) return { success: false, error: '记录不存在' };
        // 磁力任务不允许移动（路径受 infoHash 目录约束）
        if (task.type === 'magnet') {
            return { success: false, error: '磁力文件不支持移动' };
        }
        const safeSub = String(subDir || '').replace(/[\\:*?"<>|]/g, '_').trim();
        const targetDir = safeSub ? path.join(this.downloadDir, safeSub) : this.downloadDir;
        try {
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }
        } catch (e) {
            return { success: false, error: '创建目录失败: ' + e.message };
        }
        const targetPath = path.join(targetDir, file.name);
        if (targetPath === file.path) {
            task.folder = safeSub;
            file.folder = safeSub; // 兼容字段
            task.mtime = Date.now();
            this._saveManifest();
            return { success: true, record: file };
        }
        if (fs.existsSync(targetPath)) {
            return { success: false, error: '目标位置已存在同名文件' };
        }
        try {
            fs.renameSync(file.path, targetPath);
            file.path = targetPath;
            task.folder = safeSub;
            file.folder = safeSub; // 兼容字段
            task.mtime = Date.now();
            this._saveManifest();
            return { success: true, record: file };
        } catch (error) {
            return { success: false, error: '移动失败: ' + error.message };
        }
    }

    /**
     * 打开文件所在目录（用系统资源管理器）
     * - 普通文件 / URL 下载文件：showItemInFolder 高亮该文件
     * - 磁力文件：若文件尚未下载完成（磁盘上不存在），
     *   回退到打开 infoHash 目录（magnet/<hash>/）让用户至少看到正在下载的内容位置
     * @param {string} id - taskId 或 fileId
     */
    revealInFolder(id) {
        // 查找 task + file
        let task = this.manifest.find(t => t.id === id);
        let file = null;
        if (task) {
            file = Array.isArray(task.files) && task.files.length > 0 ? task.files[0] : null;
        } else {
            for (const t of this.manifest) {
                const f = (Array.isArray(t.files) ? t.files : []).find(f => f.id === id);
                if (f) {
                    task = t;
                    file = f;
                    break;
                }
            }
        }
        if (!task || !file) return { success: false, error: '记录不存在' };
        try {
            const { shell } = require('electron');
            const fileExists = file.path && fs.existsSync(file.path);
            if (fileExists) {
                shell.showItemInFolder(file.path);
                return { success: true };
            }
            // 磁力文件但磁盘上还没生成：打开 infoHash 目录
            if (task.type === 'magnet' && task.infoHash) {
                const dir = this.getMagnetPath(task.infoHash);
                if (fs.existsSync(dir)) {
                    const errMsg = shell.openPath(dir);
                    if (errMsg) {
                        return { success: false, error: errMsg, openedDir: dir };
                    }
                    return { success: true, openedDir: dir, message: '文件尚未下载完成，已打开所在目录' };
                }
                return { success: false, error: '磁力目录不存在: ' + dir };
            }
            return { success: false, error: '文件不存在: ' + (file.path || '(空路径)') };
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
        try { fileName = decodeURIComponent(fileName); } catch (e) { /* 忽略 */ }
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
                    if (maxRedirects <= 0) {
                        response.resume();
                        reject(new Error('太多重定向'));
                        return;
                    }
                    const redirectUrl = new URL(response.headers.location, task.url).toString();
                    response.resume();
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
                    this._broadcastProgress(task, true);
                });

                fileStream.on('finish', () => {
                    fileStream.close(() => {
                        try {
                            // 完成后登记为单文件 task
                            const stat = fs.statSync(task.savePath);
                            const ext = this._getExt(task.savePath);
                            const file = {
                                id: 'file_' + this._generateId(),
                                name: task.name,
                                path: task.savePath,
                                size: stat.size,
                                downloaded: stat.size,
                                status: 'completed',
                                priority: 1,
                                ext,
                                addedAt: Date.now(),
                                thumbnail: '',
                                sourceType: 'url',
                                folder: ''
                            };
                            const dlTask = {
                                id: 'task_' + this._generateId(),
                                type: 'url',
                                name: task.name,
                                status: 'completed',
                                addedAt: Date.now(),
                                mtime: Date.now(),
                                files: [file],
                                sourceType: 'url',
                                sourceUrl: task.url,
                                folder: '',
                                thumbnail: ''
                            };
                            this._recomputeTaskStats(dlTask);
                            this.manifest.unshift(dlTask);
                            this._saveManifest();
                            task.status = 'completed';
                            this._broadcastProgress(task);
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
     * 添加磁力文件（兼容旧调用方）
     * 旧调用方传 { name, filePath, magnetUri, infoHash, ... }
     * 内部转为 addMagnetTask 调用，返回 record 字段指向 task（保持旧调用方读取 record.id/sourceUrl 契约）
     * @param {object} meta
     * @returns {{success: boolean, record?: object, updated?: boolean, error?: string}}
     */
    addMagnetFile(meta) {
        if (!meta || !meta.infoHash) {
            return { success: false, error: '缺少 infoHash' };
        }
        const fileName = meta.name || (meta.filePath ? path.basename(meta.filePath) : `magnet_${meta.infoHash.slice(0, 8)}`);
        const fileExt = meta.ext || this._getExt(fileName);
        const result = this.addMagnetTask({
            magnetUri: meta.magnetUri || '',
            infoHash: meta.infoHash,
            taskName: fileName,
            selectedFiles: [{
                name: fileName,
                size: meta.totalSize || 0,
                ext: fileExt
            }],
            allFiles: [{
                name: fileName,
                size: meta.totalSize || 0,
                ext: fileExt
            }]
        });
        if (!result.success) return result;
        // 回填 filePath / downloaded / status（addMagnetTask 默认 downloaded=0, status=downloading）
        const newFile = result.task.files[0];
        if (meta.filePath) newFile.path = meta.filePath;
        if (Number.isFinite(meta.downloaded)) newFile.downloaded = meta.downloaded;
        if (meta.status) newFile.status = meta.status;
        this._recomputeTaskStats(result.task);
        this._saveManifest();
        // 返回 record 指向 task（旧调用方按 record.id/sourceUrl/status 访问）
        return { success: true, record: result.task, task: result.task, updated: result.updated };
    }

    /**
     * 更新磁力任务进度（高频调用，内部节流持久化）
     * @param {string} infoHash
     * @param {string} fileName - 用于匹配同名 file
     * @param {object} payload - { downloaded, total, status, filePath? }
     */
    updateMagnetProgress(infoHash, fileName, payload) {
        if (!infoHash) return false;
        const task = this.manifest.find(m =>
            (m.type === 'magnet' || m.sourceType === 'magnet') && m.infoHash === infoHash
        );
        if (!task) return false;
        if (!Array.isArray(task.files)) task.files = [];
        const file = task.files.find(f => !fileName || f.name === fileName);
        if (!file) return false;
        if (Number.isFinite(payload.downloaded)) file.downloaded = payload.downloaded;
        if (Number.isFinite(payload.total) && payload.total > 0) file.size = payload.total;
        if (payload.status) file.status = payload.status;
        if (payload.filePath) file.path = payload.filePath;
        task.mtime = Date.now();
        this._recomputeTaskStats(task);
        // 节流：每 2s 最多写一次磁盘（高频进度不必实时落盘）
        const now = Date.now();
        if (!task._lastSave || now - task._lastSave > 2000) {
            this._saveManifest();
            task._lastSave = now;
        }
        return true;
    }

    /**
     * 强制刷盘（用于关键状态切换：暂停/完成/错误）
     * 兼容旧调用：参数可以是 task 对象或 falsy
     */
    flushMagnet(task) {
        if (task) delete task._lastSave;
        this._saveManifest();
    }

    /**
     * 删除磁力记录并彻底清理磁盘文件（兼容旧调用方）
     * id 可以是 taskId 或 fileId：
     *   - taskId：删除整个 task（含所有文件 + infoHash 目录）
     *   - fileId：删除 task 内对应文件
     * @param {string} id - manifest 记录 ID
     * @param {object} [opts] - 兼容旧签名（内部按 deleteTask/deleteTaskFile 自动处理）
     */
    removeMagnetFile(id, opts = {}) {
        // 先作为 taskId 删除
        const task = this.manifest.find(t => t.id === id);
        if (task) {
            return this.deleteTask(id);
        }
        // 作为 fileId 删除
        for (const t of this.manifest) {
            const f = (Array.isArray(t.files) ? t.files : []).find(f => f.id === id);
            if (f) {
                return this.deleteTaskFile(t.id, id);
            }
        }
        return { success: false, error: '记录不存在' };
    }

    /**
     * 暂停时记录磁盘上已下载的实际大小（用于恢复后正确显示进度）
     * @param {string} id - taskId 或 fileId
     */
    refreshMagnetSize(id) {
        // 查找 task + file
        let task = this.manifest.find(t => t.id === id);
        let file = null;
        if (task) {
            file = Array.isArray(task.files) && task.files.length > 0 ? task.files[0] : null;
        } else {
            for (const t of this.manifest) {
                const f = (Array.isArray(t.files) ? t.files : []).find(f => f.id === id);
                if (f) {
                    task = t;
                    file = f;
                    break;
                }
            }
        }
        if (!task || !file || !file.path) return;
        try {
            if (fs.existsSync(file.path)) {
                const stat = fs.statSync(file.path);
                file.size = stat.size;
                file.downloaded = stat.size;
                task.mtime = stat.mtimeMs;
                this._recomputeTaskStats(task);
                this._saveManifest();
            }
        } catch (e) { /* 忽略 */ }
    }
}

module.exports = DownloadManager;
