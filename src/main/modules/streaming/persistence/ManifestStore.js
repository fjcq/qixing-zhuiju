// 文件系统模块
const fs = require('fs');
// 路径处理模块
const path = require('path');

// 临时文件后缀
const TMP_SUFFIX = '.tmp';

/**
 * 清单持久化存储器
 * 负责原子写 manifest.json 文件，记录所有下载任务（活动 + 历史）：
 * - load 从磁盘加载清单到内存，文件缺失或损坏时初始化为空
 * - save 使用 .tmp → rename 原子写策略，避免写入过程中崩溃损坏文件
 * - add/update/remove 提供 CRUD 接口，操作后自动触发 save
 * - getAll/get/findByStatus/findBySource 提供查询接口，返回浅拷贝
 *
 * 任务对象字段由调用方维护，ManifestStore 仅负责存取，不验证结构。
 */
class ManifestStore
{
    /**
     * 构造清单存储器
     * @param {Object} opts - 配置项
     * @param {string} opts.manifestPath - manifest.json 文件路径（必需）
     * @param {number} [opts.saveDelayMs=0] - 防抖写延迟毫秒，默认 0 立即写
     */
    constructor(opts)
    {
        if (!opts || !opts.manifestPath)
        {
            throw new Error('manifestPath is required');
        }
        this.manifestPath = opts.manifestPath;
        this.tmpPath = `${opts.manifestPath}${TMP_SUFFIX}`;
        this.saveDelayMs = opts.saveDelayMs !== undefined ? opts.saveDelayMs : 0;
        // 任务 id → 任务对象的映射
        this._tasks = new Map();
        // 防抖写定时器
        this._saveTimer = null;
    }

    /**
     * 从磁盘加载 manifest.json 到内存
     * 文件不存在或解析失败时初始化为空 Map
     * @returns {Promise<this>} 支持链式调用
     */
    async load()
    {
        let raw;
        try
        {
            raw = await fs.promises.readFile(this.manifestPath, 'utf8');
        }
        catch (err)
        {
            // 文件不存在时初始化为空
            if (err.code === 'ENOENT')
            {
                this._tasks = new Map();
                return this;
            }
            throw err;
        }
        let data;
        try
        {
            data = JSON.parse(raw);
        }
        catch (err)
        {
            // JSON 解析失败时初始化为空，避免损坏文件阻塞启动
            this._tasks = new Map();
            return this;
        }
        this._tasks = new Map();
        const tasks = this._extractTasks(data);
        for (const task of tasks)
        {
            if (task && task.id)
            {
                // 浅拷贝避免外部修改影响内存
                this._tasks.set(task.id, { ...task });
            }
        }
        return this;
    }

    /**
     * 将内存数据原子写入磁盘
     * 先写入 .tmp 文件，再 rename 到目标路径
     * rename 失败时清理 .tmp 并抛出错误，原文件保持不变
     * @returns {Promise<void>}
     */
    async save()
    {
        // 立即写模式
        if (this.saveDelayMs <= 0)
        {
            await this._writeNow();
            return;
        }
        // 防抖写模式：合并短时间内的多次 save 为一次磁盘写入
        if (this._saveTimer)
        {
            clearTimeout(this._saveTimer);
        }
        await new Promise((resolve, reject) =>
        {
            this._saveTimer = setTimeout(() =>
            {
                this._saveTimer = null;
                this._writeNow().then(resolve, reject);
            }, this.saveDelayMs);
        });
    }

    /**
     * 返回所有任务的数组（浅拷贝）
     * @returns {Array<Object>} 任务数组
     */
    getAll()
    {
        const result = [];
        for (const task of this._tasks.values())
        {
            result.push({ ...task });
        }
        return result;
    }

    /**
     * 返回单个任务的浅拷贝
     * @param {string} taskId - 任务标识
     * @returns {Object|undefined} 任务对象或 undefined
     */
    get(taskId)
    {
        const task = this._tasks.get(taskId);
        return task ? { ...task } : undefined;
    }

    /**
     * 添加任务（要求 task.id 存在）
     * 自动补充 createdAt/updatedAt 时间戳
     * 重复 id 时覆盖旧任务
     * @param {Object} task - 任务对象
     * @returns {Promise<void>}
     */
    async add(task)
    {
        if (!task || !task.id)
        {
            throw new Error('task.id is required');
        }
        const now = Date.now();
        const newTask = {
            ...task,
            createdAt: task.createdAt !== undefined ? task.createdAt : now,
            updatedAt: now
        };
        this._tasks.set(task.id, newTask);
        await this.save();
    }

    /**
     * 合并 patch 到现有任务
     * 自动更新 updatedAt
     * @param {string} taskId - 任务标识
     * @param {Object} patch - 待合并的字段
     * @returns {Promise<boolean>} 任务存在返回 true，否则返回 false
     */
    async update(taskId, patch)
    {
        const existing = this._tasks.get(taskId);
        if (!existing)
        {
            return false;
        }
        const updated = {
            ...existing,
            ...patch,
            updatedAt: Date.now()
        };
        this._tasks.set(taskId, updated);
        await this.save();
        return true;
    }

    /**
     * 删除任务
     * @param {string} taskId - 任务标识
     * @returns {Promise<boolean>} 是否删除成功
     */
    async remove(taskId)
    {
        if (!this._tasks.has(taskId))
        {
            return false;
        }
        this._tasks.delete(taskId);
        await this.save();
        return true;
    }

    /**
     * 返回指定状态的所有任务（浅拷贝数组）
     * @param {string} status - 任务状态
     * @returns {Array<Object>} 匹配状态的任务数组
     */
    findByStatus(status)
    {
        const result = [];
        for (const task of this._tasks.values())
        {
            if (task.status === status)
            {
                result.push({ ...task });
            }
        }
        return result;
    }

    /**
     * 返回匹配 source.type 和 source.value 的任务
     * 用于避免重复添加相同 URL 的任务
     * @param {string} sourceType - 资源类型（url/magnet/local）
     * @param {string} sourceValue - 资源值（URL/magnet URI/本地路径）
     * @returns {Array<Object>} 匹配的任务数组
     */
    findBySource(sourceType, sourceValue)
    {
        const result = [];
        for (const task of this._tasks.values())
        {
            if (task.source &&
                task.source.type === sourceType &&
                task.source.value === sourceValue)
            {
                result.push({ ...task });
            }
        }
        return result;
    }

    /**
     * 从解析后的 JSON 数据中提取任务数组
     * 兼容 { tasks: [...] } 与 [...] 两种格式
     * @param {Object|Array} data - 解析后的数据
     * @returns {Array<Object>} 任务数组
     */
    _extractTasks(data)
    {
        if (Array.isArray(data))
        {
            return data;
        }
        if (data && Array.isArray(data.tasks))
        {
            return data.tasks;
        }
        return [];
    }

    /**
     * 立即执行原子写
     * 写 .tmp → rename 到目标路径
     * rename 失败时清理 .tmp 文件，保证原文件不被损坏
     * @returns {Promise<void>}
     */
    async _writeNow()
    {
        const tasks = Array.from(this._tasks.values());
        const payload = JSON.stringify({ tasks }, null, 2);
        // 确保目标目录存在（recursive 模式下目录已存在不抛错）
        const dir = path.dirname(this.manifestPath);
        await fs.promises.mkdir(dir, { recursive: true });
        await fs.promises.writeFile(this.tmpPath, payload, 'utf8');
        try
        {
            await fs.promises.rename(this.tmpPath, this.manifestPath);
        }
        catch (err)
        {
            // rename 失败时清理 .tmp，避免残留文件污染下次启动
            try
            {
                await fs.promises.unlink(this.tmpPath);
            }
            catch (unlinkErr)
            {
                // 忽略清理失败，原文件保持不变已是关键保障
            }
            throw err;
        }
    }
}

module.exports = ManifestStore;
