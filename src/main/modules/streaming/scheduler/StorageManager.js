// 文件系统模块
const fs = require('fs');
// 路径处理模块
const path = require('path');

// 默认最小剩余空间阈值：5GB
const DEFAULT_MIN_FREE_BYTES = 5 * 1024 * 1024 * 1024;

// 默认任务 TTL 天数：30 天
const DEFAULT_TASK_TTL_DAYS = 30;

// 一天的毫秒数
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 存储与空间管理器
 * 负责下载路径管理、磁盘空间检查、保存路径生成与旧任务清理：
 * - getStorageInfo 查询磁盘空间信息
 * - checkSpaceAvailable 检查剩余空间是否充足（默认 5GB 阈值）
 * - generateSavePath 生成保存路径，处理同名冲突
 * - cleanupOldTasks 按 TTL 清理旧任务文件
 * - setDownloadPath 切换下载路径，可选迁移现有文件
 */
class StorageManager
{
    /**
     * 构造存储管理器
     * @param {Object} opts - 配置项
     * @param {string} opts.downloadPath - 初始下载路径（必需）
     * @param {number} [opts.minFreeBytes] - 最小剩余空间阈值，默认 5GB
     * @param {number} [opts.taskTtlDays] - 任务 TTL 天数，默认 30
     */
    constructor(opts)
    {
        if (!opts || !opts.downloadPath)
        {
            throw new Error('downloadPath is required');
        }
        this.downloadPath = opts.downloadPath;
        this.minFreeBytes = opts.minFreeBytes || DEFAULT_MIN_FREE_BYTES;
        this.taskTtlDays = opts.taskTtlDays || DEFAULT_TASK_TTL_DAYS;
    }

    /**
     * 查询磁盘空间信息
     * 使用 fs.statfs 获取磁盘总容量与可用空间
     * @returns {Promise<{total: number, free: number, used: number, downloadPath: string}>}
     */
    async getStorageInfo()
    {
        const stat = await this._statfs(this.downloadPath);
        const total = stat.blocks * stat.bsize;
        const free = stat.bavail * stat.bsize;
        const used = total - free;
        return {
            total,
            free,
            used,
            downloadPath: this.downloadPath
        };
    }

    /**
     * 检查剩余空间是否充足
     * 取 requiredBytes 与 minFreeBytes 中较大值作为阈值
     * @param {number} requiredBytes - 任务所需字节数
     * @returns {Promise<boolean>} 是否充足
     */
    async checkSpaceAvailable(requiredBytes)
    {
        const info = await this.getStorageInfo();
        const threshold = Math.max(requiredBytes || 0, this.minFreeBytes);
        return info.free >= threshold;
    }

    /**
     * 生成保存路径，处理同名冲突
     * 已存在 movie.mp4 时返回 movie(1).mp4，再次冲突返回 movie(2).mp4
     * @param {string} filename - 文件名
     * @returns {Promise<string>} 完整保存路径
     */
    async generateSavePath(filename)
    {
        return this._resolveConflictPath(this.downloadPath, filename);
    }

    /**
     * 清理旧任务文件
     * 扫描下载目录，删除修改时间早于 N 天前的文件
     * @param {number} [beforeDays] - 删除早于 N 天前的文件，默认使用 taskTtlDays
     * @returns {Promise<{removed: number, errors: string[]}>} 清理结果
     */
    async cleanupOldTasks(beforeDays)
    {
        const days = beforeDays !== undefined ? beforeDays : this.taskTtlDays;
        const cutoff = Date.now() - days * ONE_DAY_MS;
        const result = { removed: 0, errors: [] };
        let entries = [];
        try
        {
            entries = fs.readdirSync(this.downloadPath);
        }
        catch (err)
        {
            result.errors.push(`read dir failed: ${err.message}`);
            return result;
        }
        for (const name of entries)
        {
            const filePath = path.join(this.downloadPath, name);
            try
            {
                const stat = fs.statSync(filePath);
                if (stat.isFile() && stat.mtimeMs < cutoff)
                {
                    fs.unlinkSync(filePath);
                    result.removed++;
                }
            }
            catch (err)
            {
                result.errors.push(`${name}: ${err.message}`);
            }
        }
        return result;
    }

    /**
     * 切换下载路径
     * migrate 为 true 时迁移现有文件到新路径
     * @param {string} newPath - 新下载路径
     * @param {boolean} migrate - 是否迁移现有文件
     * @returns {Promise<{migrated: boolean, fileCount: number}>} 切换结果
     */
    async setDownloadPath(newPath, migrate)
    {
        const oldPath = this.downloadPath;
        if (migrate)
        {
            const fileCount = await this._migrateFiles(oldPath, newPath);
            this.downloadPath = newPath;
            return { migrated: true, fileCount };
        }
        this.downloadPath = newPath;
        return { migrated: false, fileCount: 0 };
    }

    /**
     * 获取当前下载路径
     * @returns {string} 当前下载路径
     */
    getDownloadPath()
    {
        return this.downloadPath;
    }

    /**
     * 迁移 oldPath 下的所有文件到 newPath
     * 遇到同名冲突时使用 (1)/(2) 后缀
     * @param {string} oldPath - 原下载路径
     * @param {string} newPath - 新下载路径
     * @returns {Promise<number>} 成功迁移的文件数
     */
    async _migrateFiles(oldPath, newPath)
    {
        if (!fs.existsSync(newPath))
        {
            fs.mkdirSync(newPath, { recursive: true });
        }
        let entries = [];
        try
        {
            entries = fs.readdirSync(oldPath);
        }
        catch (err)
        {
            return 0;
        }
        let fileCount = 0;
        for (const name of entries)
        {
            const src = path.join(oldPath, name);
            try
            {
                const stat = fs.statSync(src);
                if (!stat.isFile())
                {
                    continue;
                }
                const dst = await this._resolveConflictPath(newPath, name);
                this._moveFileSync(src, dst);
                fileCount++;
            }
            catch (err)
            {
                // 单个文件迁移失败忽略，继续处理其他文件
            }
        }
        return fileCount;
    }

    /**
     * 在指定目录中解析同名冲突
     * 已存在 movie.mp4 时返回 movie(1).mp4，依此类推
     * @param {string} dir - 目标目录
     * @param {string} filename - 文件名
     * @returns {Promise<string>} 不冲突的最终路径
     */
    async _resolveConflictPath(dir, filename)
    {
        const ext = path.extname(filename);
        const base = path.basename(filename, ext);
        let candidate = path.join(dir, filename);
        let index = 1;
        while (fs.existsSync(candidate))
        {
            candidate = path.join(dir, `${base}(${index})${ext}`);
            index++;
        }
        return candidate;
    }

    /**
     * 移动文件，跨设备时降级为复制+删除
     * fs.renameSync 在跨磁盘分区（如 C: -> D:，Windows 常见场景）时抛 EXDEV
     * 此时改用 fs.copyFileSync + fs.unlinkSync 兜底，保证迁移成功
     * 其他错误仍向上抛出，交由调用方处理
     * @param {string} src - 源文件路径
     * @param {string} dst - 目标文件路径
     */
    _moveFileSync(src, dst)
    {
        try
        {
            fs.renameSync(src, dst);
        }
        catch (err)
        {
            if (err.code === 'EXDEV')
            {
                fs.copyFileSync(src, dst);
                fs.unlinkSync(src);
                return;
            }
            throw err;
        }
    }

    /**
     * 封装 fs.statfs 为 Promise
     * @param {string} targetPath - 目标路径
     * @returns {Promise<Object>} statfs 结果
     */
    _statfs(targetPath)
    {
        return new Promise((resolve, reject) =>
        {
            fs.statfs(targetPath, (err, stats) =>
            {
                if (err)
                {
                    reject(err);
                    return;
                }
                resolve(stats);
            });
        });
    }
}

module.exports = StorageManager;
