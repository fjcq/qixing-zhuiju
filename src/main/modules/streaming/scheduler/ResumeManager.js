// 断点续传管理器
class ResumeManager
{
    /**
     * 构造续传管理器
     */
    constructor()
    {
        // 任务 → 已下载区间数组的映射
        this.taskRanges = new Map();
    }

    /**
     * 添加一段已下载区间，并触发合并
     * @param {string} taskId - 任务标识
     * @param {number} start - 区间起始字节（含）
     * @param {number} end - 区间结束字节（不含）
     */
    addRange(taskId, start, end)
    {
        if (!this.taskRanges.has(taskId))
        {
            this.taskRanges.set(taskId, []);
        }
        this.taskRanges.get(taskId).push({ start, end });
        this._merge(taskId);
    }

    /**
     * 合并相邻或重叠的区间，保证区间集合互不相交且按起始位置升序
     * @param {string} taskId - 任务标识
     */
    _merge(taskId)
    {
        const ranges = this.taskRanges.get(taskId);
        if (ranges.length <= 1)
        {
            return;
        }
        ranges.sort((a, b) => a.start - b.start);
        const merged = [ranges[0]];
        for (let i = 1; i < ranges.length; i++)
        {
            const last = merged[merged.length - 1];
            const cur = ranges[i];
            // last.end >= cur.start 表示相邻或重叠
            if (last.end >= cur.start)
            {
                last.end = Math.max(last.end, cur.end);
            }
            else
            {
                merged.push(cur);
            }
        }
        this.taskRanges.set(taskId, merged);
    }

    /**
     * 获取下一个下载起始位置
     * 空任务返回 0；已有区间则返回最后一段的结束位置，但不超过总字节数
     * @param {string} taskId - 任务标识
     * @param {number} totalBytes - 文件总字节数，用于上限保护
     * @returns {number} 下一个待下载字节位置
     */
    getNextStart(taskId, totalBytes)
    {
        const ranges = this.taskRanges.get(taskId) || [];
        if (ranges.length === 0)
        {
            return 0;
        }
        return Math.min(ranges[ranges.length - 1].end, totalBytes);
    }

    /**
     * 获取任务已下载区间集合的浅拷贝
     * @param {string} taskId - 任务标识
     * @returns {Array<{start: number, end: number}>} 区间数组
     */
    getRanges(taskId)
    {
        return (this.taskRanges.get(taskId) || []).map(r => ({ start: r.start, end: r.end }));
    }

    /**
     * 统计任务已下载字节数（合并后区间总和）
     * @param {string} taskId - 任务标识
     * @returns {number} 已下载字节数
     */
    getDownloadedBytes(taskId)
    {
        return (this.taskRanges.get(taskId) || []).reduce((sum, r) => sum + (r.end - r.start), 0);
    }

    /**
     * 判断任务是否已完整下载
     * 要求合并后存在从 0 起始且 end 不小于总字节数的区间
     * @param {string} taskId - 任务标识
     * @param {number} totalBytes - 文件总字节数
     * @returns {boolean} 是否完整下载
     */
    isComplete(taskId, totalBytes)
    {
        const ranges = this.taskRanges.get(taskId) || [];
        if (ranges.length === 0)
        {
            return false;
        }
        return ranges[0].start === 0 && ranges[0].end >= totalBytes;
    }

    /**
     * 序列化任务区间，用于持久化存储
     * @param {string} taskId - 任务标识
     * @returns {Array<{start: number, end: number}>} 可序列化的区间数组
     */
    serialize(taskId)
    {
        return this.getRanges(taskId);
    }

    /**
     * 反序列化任务区间
     * @param {string} taskId - 任务标识
     * @param {Array<{start: number, end: number}>} ranges - 序列化的区间数组
     */
    deserialize(taskId, ranges)
    {
        if (!Array.isArray(ranges))
        {
            return;
        }
        this.taskRanges.set(taskId, ranges.map(r => ({ start: r.start, end: r.end })));
        this._merge(taskId);
    }

    /**
     * 清除指定任务的区间数据
     * @param {string} taskId - 任务标识
     */
    clear(taskId)
    {
        this.taskRanges.delete(taskId);
    }
}

module.exports = ResumeManager;
