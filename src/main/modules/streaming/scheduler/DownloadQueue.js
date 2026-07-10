// 优先级权重表：数值越大优先级越高
const PRIORITY_WEIGHTS = { high: 3, normal: 2, low: 1 };

// 默认优先级
const DEFAULT_PRIORITY = 'normal';

// 默认最大并发数
const DEFAULT_MAX_CONCURRENT = 3;

/**
 * 下载优先级队列
 * 负责多任务并发控制与抢占式调度：
 * - 低于 maxConcurrent 时立即激活入队任务
 * - 超过并发限制时排队等待，高优先级任务插队到队首
 * - 高优先级任务入队可抢占已在活动的低优先级任务
 * - 活动/排队任务完成、暂停、取消、出错后自动调度下一个
 */
class DownloadQueue
{
    /**
     * 构造下载队列
     * @param {Object} [opts] - 配置项
     * @param {number} [opts.maxConcurrent=3] - 最大并发下载数
     */
    constructor(opts)
    {
        this.maxConcurrent = (opts && opts.maxConcurrent) || DEFAULT_MAX_CONCURRENT;
        // 全部任务的集合：id -> task
        this.tasks = new Map();
        // 活动任务 id 的顺序列表（按激活先后排序）
        this.activeOrder = [];
    }

    /**
     * 入队一个任务
     * 低于并发上限时立即激活；否则尝试抢占低优先级活动任务
     * @param {Object} task - 任务对象，至少包含 id 与 priority
     * @returns {Object} 入队结果，可能包含 preempted 字段（被抢占的任务 id）
     */
    enqueue(task)
    {
        const t = Object.assign({ status: 'queued', priority: DEFAULT_PRIORITY }, task);
        this.tasks.set(t.id, t);
        const result = { ...t };
        if (this.activeOrder.length < this.maxConcurrent)
        {
            t.status = 'downloading';
            this.activeOrder.push(t.id);
        }
        else
        {
            const preemptedId = this._tryPreempt(t.priority);
            if (preemptedId)
            {
                result.preempted = preemptedId;
            }
        }
        return result;
    }

    /**
     * 尝试抢占活动任务
     * 在活动任务中查找优先级低于新任务的最低优先级任务，暂停它并激活队首任务
     * @param {string} newPriority - 新任务的优先级
     * @returns {string|null} 被抢占的任务 id，未抢占时返回 null
     */
    _tryPreempt(newPriority)
    {
        const newW = PRIORITY_WEIGHTS[newPriority] || DEFAULT_PRIORITY;
        let lowestId = null;
        let lowestW = Infinity;
        for (const id of this.activeOrder)
        {
            const t = this.tasks.get(id);
            if (!t)
            {
                continue;
            }
            const w = PRIORITY_WEIGHTS[t.priority] || 2;
            if (w < newW && w < lowestW)
            {
                lowestW = w;
                lowestId = id;
            }
        }
        if (lowestId)
        {
            this._pauseInternal(lowestId, 'preempted');
            const newId = this._findNewestQueued();
            if (newId)
            {
                const nt = this.tasks.get(newId);
                nt.status = 'downloading';
                this.activeOrder.push(newId);
            }
        }
        return lowestId;
    }

    /**
     * 在 Map 中查找最新的排队任务（按插入顺序）
     * @returns {string|null} 排队任务 id 或 null
     */
    _findNewestQueued()
    {
        for (const [id, t] of this.tasks)
        {
            if (t.status === 'queued')
            {
                return id;
            }
        }
        return null;
    }

    /**
     * 内部暂停实现，从活动列表中移除并设置状态
     * @param {string} taskId - 任务标识
     * @param {string} reason - 暂停原因：'user' 或 'preempted'
     */
    _pauseInternal(taskId, reason)
    {
        const t = this.tasks.get(taskId);
        if (!t)
        {
            return;
        }
        t.status = 'paused';
        t.pauseReason = reason;
        const idx = this.activeOrder.indexOf(taskId);
        if (idx >= 0)
        {
            this.activeOrder.splice(idx, 1);
        }
    }

    /**
     * 用户主动暂停任务，并尝试激活下一个排队任务
     * @param {string} taskId - 任务标识
     */
    pause(taskId)
    {
        this._pauseInternal(taskId, 'user');
        this._scheduleNext();
    }

    /**
     * 恢复暂停的任务，重新进入排队状态并触发调度
     * @param {string} taskId - 任务标识
     */
    resume(taskId)
    {
        const t = this.tasks.get(taskId);
        if (!t || t.status !== 'paused')
        {
            return;
        }
        t.status = 'queued';
        delete t.pauseReason;
        this._scheduleNext();
    }

    /**
     * 标记任务完成，释放槽位并激活下一个排队任务
     * @param {string} taskId - 任务标识
     */
    complete(taskId)
    {
        const t = this.tasks.get(taskId);
        if (!t)
        {
            return;
        }
        t.status = 'completed';
        t.completedAt = Date.now();
        const idx = this.activeOrder.indexOf(taskId);
        if (idx >= 0)
        {
            this.activeOrder.splice(idx, 1);
        }
        this._scheduleNext();
    }

    /**
     * 取消任务，从全部集合与活动列表中移除，并触发调度
     * @param {string} taskId - 任务标识
     */
    cancel(taskId)
    {
        const idx = this.activeOrder.indexOf(taskId);
        if (idx >= 0)
        {
            this.activeOrder.splice(idx, 1);
        }
        this.tasks.delete(taskId);
        this._scheduleNext();
    }

    /**
     * 标记任务出错，释放槽位并触发调度
     * @param {string} taskId - 任务标识
     * @param {*} error - 错误信息
     */
    markError(taskId, error)
    {
        const t = this.tasks.get(taskId);
        if (!t)
        {
            return;
        }
        t.status = 'error';
        t.error = error;
        const idx = this.activeOrder.indexOf(taskId);
        if (idx >= 0)
        {
            this.activeOrder.splice(idx, 1);
        }
        this._scheduleNext();
    }

    /**
     * 调整任务优先级
     * 排队中的任务被设为 high 时，若活动列表已满，触发抢占逻辑
     * @param {string} taskId - 任务标识
     * @param {string} priority - 新优先级：'high' | 'normal' | 'low'
     */
    setPriority(taskId, priority)
    {
        const t = this.tasks.get(taskId);
        if (!t)
        {
            return;
        }
        t.priority = priority;
        if (t.status === 'queued' && priority === 'high')
        {
            if (this.activeOrder.length >= this.maxConcurrent)
            {
                this._tryPreempt('high');
            }
        }
    }

    /**
     * 调度下一个排队任务填补空闲槽位
     * 在并发限制内按优先级与入队顺序激活排队任务
     */
    _scheduleNext()
    {
        while (this.activeOrder.length < this.maxConcurrent)
        {
            const nextId = this._pickNextQueued();
            if (!nextId)
            {
                break;
            }
            this.tasks.get(nextId).status = 'downloading';
            this.activeOrder.push(nextId);
        }
    }

    /**
     * 按优先级降序、相同优先级按入队先后选择下一个排队任务
     * @returns {string|null} 选中的任务 id 或 null
     */
    _pickNextQueued()
    {
        const queued = Array.from(this.tasks.values()).filter(t => t.status === 'queued');
        if (queued.length === 0)
        {
            return null;
        }
        queued.sort((a, b) =>
        {
            const d = (PRIORITY_WEIGHTS[b.priority] || 2) - (PRIORITY_WEIGHTS[a.priority] || 2);
            return d !== 0 ? d : (a.addedAt || 0) - (b.addedAt || 0);
        });
        return queued[0].id;
    }

    /**
     * 获取活动任务列表（按激活顺序）
     * @returns {Array<Object>} 活动任务对象的浅拷贝数组
     */
    getActiveTasks()
    {
        return this.activeOrder
            .map(id => this.tasks.get(id))
            .filter(Boolean)
            .map(t => ({ ...t }));
    }

    /**
     * 获取排队任务列表（按优先级降序、入队先后）
     * @returns {Array<Object>} 排队任务对象的浅拷贝数组
     */
    getQueuedTasks()
    {
        return Array.from(this.tasks.values())
            .filter(t => t.status === 'queued')
            .sort((a, b) =>
            {
                const d = (PRIORITY_WEIGHTS[b.priority] || 2) - (PRIORITY_WEIGHTS[a.priority] || 2);
                return d !== 0 ? d : (a.addedAt || 0) - (b.addedAt || 0);
            })
            .map(t => ({ ...t }));
    }

    /**
     * 获取指定任务的浅拷贝
     * @param {string} taskId - 任务标识
     * @returns {Object|undefined} 任务对象或 undefined
     */
    getTask(taskId)
    {
        const t = this.tasks.get(taskId);
        return t ? { ...t } : undefined;
    }

    /**
     * 列出所有任务的浅拷贝
     * @returns {Array<Object>} 全部任务对象的浅拷贝数组
     */
    listAll()
    {
        return Array.from(this.tasks.values()).map(t => ({ ...t }));
    }
}

module.exports = DownloadQueue;
