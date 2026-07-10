// 播放优先模式下全局桶容量比例
const PLAYBACK_MODE_RATIO = 0.5;

// 令牌桶限速器
class SpeedLimiter
{
    /**
     * 构造限速器
     * @param {Object} opts - 配置项
     * @param {number} opts.globalBps - 全局每秒字节数，0 表示不限制
     * @param {number} [opts.windowMs=100] - 定时补充令牌的窗口毫秒数
     */
    constructor(opts)
    {
        this.globalBps = (opts && opts.globalBps) || 0;
        this.windowMs = (opts && opts.windowMs) || 100;
        this.taskLimits = new Map();
        this.taskBuckets = new Map();
        this.globalBucket = this.globalBps;
        this.playbackActive = false;
        this._lastRefill = Date.now();
        this._timer = setInterval(() => this._refill(), this.windowMs);
        if (this._timer.unref)
        {
            this._timer.unref();
        }
    }

    /**
     * 设置单个任务的限速
     * @param {string} taskId - 任务标识
     * @param {number} bps - 该任务每秒字节数
     */
    setTaskLimit(taskId, bps)
    {
        this.taskLimits.set(taskId, bps);
        if (!this.taskBuckets.has(taskId))
        {
            this.taskBuckets.set(taskId, bps);
        }
    }

    /**
     * 清除单个任务的限速
     * @param {string} taskId - 任务标识
     */
    clearTaskLimit(taskId)
    {
        this.taskLimits.delete(taskId);
        this.taskBuckets.delete(taskId);
    }

    /**
     * 设置播放优先模式
     * 播放模式激活时，全局桶上限降为 50%，并重置到新上限
     * @param {boolean} active - 是否激活播放
     */
    setPlaybackActive(active)
    {
        const newActive = !!active;
        if (this.playbackActive === newActive)
        {
            return;
        }
        this.playbackActive = newActive;
        if (this.globalBps > 0)
        {
            const effectiveBps = newActive
                ? Math.floor(this.globalBps * PLAYBACK_MODE_RATIO) : this.globalBps;
            this.globalBucket = effectiveBps;
        }
    }

    /**
     * 尝试消费令牌
     * @param {number|string} taskIdOrBytes - 任务标识或字节数（无任务限速时）
     * @param {number} [bytes] - 字节数（指定任务时）
     * @returns {boolean} 是否允许消费
     */
    tryConsume(taskIdOrBytes, bytes)
    {
        if (typeof taskIdOrBytes === 'number' && bytes === undefined)
        {
            return this._tryConsumeGlobal(taskIdOrBytes);
        }
        return this._tryConsumeWithTask(taskIdOrBytes, bytes);
    }

    /**
     * 全局桶消费逻辑
     * @param {number} bytes - 字节数
     * @returns {boolean} 是否允许消费
     */
    _tryConsumeGlobal(bytes)
    {
        if (this.globalBps === 0)
        {
            return true;
        }
        this._refill();
        if (this.globalBucket >= bytes)
        {
            this.globalBucket -= bytes;
            return true;
        }
        return false;
    }

    /**
     * 带任务限速的消费逻辑，取任务桶与全局桶的小值
     * @param {string} taskId - 任务标识
     * @param {number} bytes - 字节数
     * @returns {boolean} 是否允许消费
     */
    _tryConsumeWithTask(taskId, bytes)
    {
        const taskLimit = this.taskLimits.get(taskId);
        if (taskLimit !== undefined && taskLimit > 0)
        {
            this._refill();
            const taskBucket = this.taskBuckets.get(taskId) || 0;
            if (taskBucket < bytes)
            {
                return false;
            }
            // 先检查全局桶，不足则直接返回，不扣减任务桶
            if (this.globalBps > 0 && !this._tryConsumeGlobal(bytes))
            {
                return false;
            }
            // 全局桶已扣减成功，再扣减任务桶
            this.taskBuckets.set(taskId, taskBucket - bytes);
            return true;
        }
        if (this.globalBps > 0)
        {
            return this._tryConsumeGlobal(bytes);
        }
        return true;
    }

    /**
     * 补充令牌桶
     * 按窗口制补充：仅在经过时间达到 windowMs 时才补充令牌
     * 避免毫秒精度下短时间内反复补充导致限速失效
     */
    _refill()
    {
        const now = Date.now();
        const elapsed = now - this._lastRefill;
        if (elapsed < this.windowMs)
        {
            return;
        }
        this._lastRefill = now;
        if (this.globalBps > 0)
        {
            const effectiveBps = this.playbackActive
                ? Math.floor(this.globalBps * PLAYBACK_MODE_RATIO) : this.globalBps;
            const refill = Math.floor((elapsed / 1000) * effectiveBps);
            this.globalBucket = Math.min(effectiveBps, this.globalBucket + refill);
        }
        for (const [taskId, bps] of this.taskLimits.entries())
        {
            if (bps <= 0)
            {
                continue;
            }
            const refill = Math.floor((elapsed / 1000) * bps);
            const current = this.taskBuckets.get(taskId) || 0;
            this.taskBuckets.set(taskId, Math.min(bps, current + refill));
        }
    }

    /**
     * 销毁限速器，清理定时器
     */
    destroy()
    {
        if (this._timer)
        {
            clearInterval(this._timer);
            this._timer = null;
        }
    }
}

module.exports = SpeedLimiter;
