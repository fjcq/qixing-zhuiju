// 默认 TTL: 24 小时（毫秒）
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

// 默认最大条目数
const DEFAULT_MAX_ENTRIES = 100;

/**
 * 磁力解析结果缓存
 * 按 infoHash 缓存磁力链解析结果 { files, totalSize, cachedAt }，避免同一磁力链重复解析
 *
 * 设计要点：
 * - TTL 24h：缓存条目 24 小时后过期，get 时懒删除
 * - LRU 淘汰：最多 100 条，超出时淘汰 Map 第一个（最久未访问）
 * - Map 保持插入顺序实现 LRU：访问时删除并重新插入，使最新访问的在 Map 末尾
 * - get 返回深拷贝，避免外部修改污染内部状态
 *
 * 命中缓存时调用方可跳过 resolve 阶段，直接进入 FILES_READY 状态，实现同链秒开。
 */
class MagnetResolveCache
{
    /**
     * 构造缓存
     * @param {Object} [opts] - 配置项
     * @param {number} [opts.ttlMs=86400000] - TTL 毫秒数，默认 24 小时
     * @param {number} [opts.maxEntries=100] - 最大条目数，默认 100
     */
    constructor(opts)
    {
        this.ttlMs = (opts && opts.ttlMs !== undefined) ? opts.ttlMs : DEFAULT_TTL_MS;
        this.maxEntries = (opts && opts.maxEntries !== undefined) ? opts.maxEntries : DEFAULT_MAX_ENTRIES;
        // infoHash → { files, totalSize, cachedAt } 的映射
        // Map 按插入顺序遍历，第一个即最久未访问的条目
        this._entries = new Map();
    }

    /**
     * 读取缓存
     * 命中且未过期时返回深拷贝，并刷新访问顺序到 Map 末尾
     * 未命中或已过期返回 null，过期条目自动删除
     * @param {string} infoHash - 磁力链 infoHash
     * @returns {Object|null} { files, totalSize, cachedAt } 或 null
     */
    get(infoHash)
    {
        const entry = this._entries.get(infoHash);
        if (!entry)
        {
            return null;
        }
        // TTL 检查：过期则删除并返回 null
        if (this._isExpired(entry))
        {
            this._entries.delete(infoHash);
            return null;
        }
        // 刷新访问顺序：删除并重新插入到 Map 末尾
        this._entries.delete(infoHash);
        this._entries.set(infoHash, entry);
        // 返回深拷贝，避免外部修改污染内部状态
        return structuredClone(entry);
    }

    /**
     * 写入缓存
     * 记录 cachedAt = Date.now()，若 infoHash 已存在先删除再插入（刷新顺序）
     * 超出 maxEntries 时淘汰 Map 第一个（最久未访问的）
     * @param {string} infoHash - 磁力链 infoHash
     * @param {Array<Object>} files - 解析得到的文件列表
     * @param {number} totalSize - 所有文件总字节数
     */
    set(infoHash, files, totalSize)
    {
        // 已存在则先删除，保证重新插入到 Map 末尾
        if (this._entries.has(infoHash))
        {
            this._entries.delete(infoHash);
        }
        // 深拷贝 files，避免调用方修改输入数组污染内部缓存（与 get 防御对称）
        const entry = {
            files: structuredClone(files),
            totalSize,
            cachedAt: Date.now()
        };
        this._entries.set(infoHash, entry);
        // LRU 淘汰：超出上限时删除 Map 第一个
        if (this._entries.size > this.maxEntries)
        {
            const oldest = this._entries.keys().next().value;
            this._entries.delete(oldest);
        }
    }

    /**
     * 判断条目是否存在
     * 仅检查存在性，不刷新访问顺序，不检查 TTL
     * @param {string} infoHash - 磁力链 infoHash
     * @returns {boolean} 是否存在
     */
    has(infoHash)
    {
        return this._entries.has(infoHash);
    }

    /**
     * 删除指定条目
     * @param {string} infoHash - 磁力链 infoHash
     * @returns {boolean} 是否删除成功
     */
    delete(infoHash)
    {
        return this._entries.delete(infoHash);
    }

    /**
     * 清空所有缓存
     */
    clear()
    {
        this._entries.clear();
    }

    /**
     * 返回当前缓存条目数
     * 不区分是否过期（过期条目仅在 get 时懒删除）
     * @returns {number} 条目数
     */
    size()
    {
        return this._entries.size;
    }

    /**
     * 判断条目是否已过期
     * @param {Object} entry - 缓存条目
     * @returns {boolean} 是否过期
     */
    _isExpired(entry)
    {
        return (Date.now() - entry.cachedAt) >= this.ttlMs;
    }
}

module.exports = MagnetResolveCache;
