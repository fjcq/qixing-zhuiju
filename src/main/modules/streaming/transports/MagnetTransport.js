// HTTP 模块
const http = require('http');
// HTTPS 模块
const https = require('https');
// 路径模块
const path = require('path');

// 父类接口
const ITransport = require('./ITransport');
// 令牌桶限速 Transform（独立模块, 供 magnetHandler.mjs 通过 createRequire 加载）
const ThrottleTransform = require('../ThrottleTransform');

// 支持的视频扩展名集合
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm']);

// 扩展名 → MIME 映射表
const CONTENT_TYPES = {
    '.mp4': 'video/mp4',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime',
    '.wmv': 'video/x-ms-wmv',
    '.flv': 'video/x-flv',
    '.webm': 'video/webm'
};

/**
 * 磁力链传输层实现
 * 包装 magnetHandler.mjs 子进程 stdio JSON 通信协议
 * 通过依赖注入的 bridge 与子进程交互，自身不 spawn 子进程
 * 继承自 ITransport, 实现 probe/createSegmentReader/createSegmentWriter/cancel
 */
class MagnetTransport extends ITransport
{
    /**
     * 构造磁力链传输层
     * @param {Object} opts - 构造参数
     * @param {Object} opts.bridge - bridge 依赖, 必须提供 async send(action, params) → reply 方法
     * @param {Object} [opts.source] - 源描述对象 { type:'magnet', value, infoHash, fileName? }
     */
    constructor(opts)
    {
        super();
        const { bridge, source } = opts || {};
        if (!bridge || typeof bridge.send !== 'function')
        {
            throw new Error('MagnetTransport: bridge.send is required');
        }
        this._bridge = bridge;
        this._source = source || null;
        // segmentId → { req, reader } 活动分段映射
        this._segments = new Map();
        // probe 阶段缓存的 resolve 结果 { files, file }
        this._resolveCache = null;
        // play 阶段缓存的 streamUrl 信息 { streamUrl, isLocal, fileName, infoHash }
        this._playCache = null;
        // bridge 进度事件订阅句柄集合
        this._progressListeners = new Set();
        // 是否已订阅 bridge 的 progress 事件
        this._bridgeSubscribed = false;
    }

    /**
     * 探测磁力源信息
     * 调用 bridge.send('resolve', ...) 获取文件列表, 按 fileName 或最大视频文件策略选择
     * @param {Object} [source] - 源描述对象, 未传则使用构造时的 source
     * @returns {Promise<Object>} ProbeResult { size, acceptRanges, contentType, fileName }
     */
    async probe(source)
    {
        const src = source || this._source;
        if (!src || !src.value)
        {
            throw this._makeError('invalid-url', 'no magnet source provided');
        }
        this._source = src;

        // 已缓存则直接复用
        if (this._resolveCache)
        {
            const file = this._resolveCache.file;
            return {
                size: file.length,
                acceptRanges: true,
                contentType: this._getContentType(file.name),
                fileName: file.name
            };
        }

        // 调用 bridge 解析文件列表
        const reply = await this._bridge.send('resolve', {
            magnetUri: src.value,
            infoHash: src.infoHash || ''
        });
        if (!reply || reply.type === 'error')
        {
            throw this._makeError('server', (reply && reply.error) || 'resolve failed');
        }
        const files = (reply.files || []).map(f => ({
            name: f.name, length: f.length, path: f.path
        }));
        if (!files.length)
        {
            throw this._makeError('invalid-url', 'magnet resolved with no files');
        }

        const file = this._selectFile(files, src.fileName);
        this._resolveCache = { files, file };

        return {
            size: file.length,
            acceptRanges: true,
            contentType: this._getContentType(file.name),
            fileName: file.name
        };
    }

    /**
     * 创建分段读取器
     * 首次调用发起 play action 拿到 streamUrl, 后续调用复用并基于 HTTP Range 请求读取
     * @param {Object} opts - { id, start, end, priority?, onProgress? }
     * @returns {Promise<Object>} SegmentReader 实例
     */
    async createSegmentReader(opts)
    {
        const { id, start, end, onProgress } = opts;
        const src = this._source;
        if (!src || !src.value)
        {
            throw this._makeError('invalid-url', 'no magnet source bound');
        }

        // 确保 play 已拿到 streamUrl
        const playInfo = await this._ensurePlayStream();
        const parsedUrl = this._parseUrl(playInfo.streamUrl);

        return new Promise((resolve, reject) =>
        {
            const lib = parsedUrl.protocol === 'https:' ? https : http;
            const req = lib.request({
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
                path: parsedUrl.pathname + (parsedUrl.search || ''),
                method: 'GET',
                headers: { Range: `bytes=${start}-${end}` }
            }, (res) =>
            {
                if (res.statusCode !== 206 && res.statusCode !== 200)
                {
                    res.resume();
                    this._segments.delete(id);
                    reject(this._classifyStatusError(res.statusCode));
                    return;
                }

                const reader = {
                    id,
                    start,
                    end,
                    stream: res,
                    bytesTotal: end - start + 1,
                    bytesLoaded: 0,
                    abort: () =>
                    {
                        try { req.destroy(); } catch (e) { /* 忽略销毁异常 */ }
                    }
                };

                // 延迟挂载 data 监听器, 防止小响应在调用方准备好之前流尽
                let internalAttached = false;
                const attachInternal = () =>
                {
                    if (internalAttached) return;
                    internalAttached = true;
                    res.removeListener('newListener', onNewListener);
                    res.prependListener('data', (chunk) =>
                    {
                        reader.bytesLoaded += chunk.length;
                        if (typeof onProgress === 'function')
                        {
                            try { onProgress(reader.bytesLoaded, reader.bytesTotal); }
                            catch (e) { /* 回调异常不影响数据流 */ }
                        }
                    });
                };
                const onNewListener = (event) =>
                {
                    if (event === 'data') attachInternal();
                };
                res.on('newListener', onNewListener);
                res.on('end', () => { this._segments.delete(id); });
                res.on('error', () => { this._segments.delete(id); });

                this._segments.set(id, { req, reader });
                resolve(reader);
            });

            req.on('error', (err) =>
            {
                this._segments.delete(id);
                reject(this._classifyError(err));
            });

            // 立即注册, 以便 cancel 在请求建立阶段也能生效
            this._segments.set(id, { req });
            req.end();
        });
    }

    /**
     * 创建分段写入器（代理 writer）
     * 磁力场景下文件由 webtorrent 直接写磁盘, 传输层不主动写, 避免与 webtorrent 冲突
     * bytesWritten 通过订阅 bridge 的 progress 事件更新（若 bridge 提供 on 方法）
     * @param {Object} opts - { savePath, append? }
     * @returns {Promise<Object>} SegmentWriter 代理实例
     */
    async createSegmentWriter(opts)
    {
        const { savePath, append } = opts || {};
        const writer = {
            savePath,
            append: !!append,
            bytesWritten: 0,
            write: async () => { /* no-op: 文件由 webtorrent 写盘 */ },
            end: async () => { /* no-op */ },
            abort: async () =>
            {
                const src = this._source;
                if (!src || !src.infoHash) return;
                try
                {
                    await this._bridge.send('remove', {
                        infoHash: src.infoHash,
                        fileName: this._resolveCache ? this._resolveCache.file.name : undefined
                    });
                }
                catch (e) { /* 忽略 abort 错误 */ }
            }
        };

        // 若 bridge 提供 on 方法, 订阅 progress 事件更新 bytesWritten
        if (typeof this._bridge.on === 'function' && !this._bridgeSubscribed)
        {
            this._bridgeSubscribed = true;
            const cb = (payload) =>
            {
                if (!payload) return;
                const src = this._source;
                if (payload.infoHash && src && payload.infoHash !== src.infoHash) return;
                if (typeof payload.downloaded === 'number')
                {
                    writer.bytesWritten = payload.downloaded;
                }
            };
            this._bridge.on('progress', cb);
            this._progressListeners.add(cb);
        }

        return writer;
    }

    /**
     * 取消指定分段
     * 中止进行中的 HTTP 请求, 从 _segments 删除; 未知 segmentId 静默忽略
     * @param {string} segmentId - 分段唯一标识
     * @returns {void}
     */
    cancel(segmentId)
    {
        const seg = this._segments.get(segmentId);
        if (!seg) return;
        if (seg.req)
        {
            try { seg.req.destroy(); } catch (e) { /* 忽略销毁异常 */ }
        }
        this._segments.delete(segmentId);
    }

    /**
     * 设置分段优先级（扩展方法, magnetHandler 当前未实现, 调用失败时静默）
     * @param {string} infoHash - 磁力 infoHash
     * @param {number} priority - 优先级
     * @returns {Promise<Object|undefined>} reply 或 undefined
     */
    async setPriority(infoHash, priority)
    {
        return this._sendOptional('set-priority', { infoHash, priority });
    }

    /**
     * 设置下载速度限制（扩展方法, magnetHandler 当前未实现, 调用失败时静默）
     * @param {string} infoHash - 磁力 infoHash
     * @param {number} bytesPerSec - 每秒字节数
     * @returns {Promise<Object|undefined>} reply 或 undefined
     */
    async setSpeedLimit(infoHash, bytesPerSec)
    {
        return this._sendOptional('set-speed-limit', { infoHash, bytesPerSec });
    }

    /**
     * 校验已下载的 piece（扩展方法, magnetHandler 当前未实现, 调用失败时静默）
     * @param {string} infoHash - 磁力 infoHash
     * @returns {Promise<Object|undefined>} reply 或 undefined
     */
    async verifyPieces(infoHash)
    {
        return this._sendOptional('verify-pieces', { infoHash });
    }

    /**
     * 销毁传输层, 清理资源
     * 取消所有活动分段, 移除 bridge 进度监听; 不主动 destroy 子进程（由 bridge 持有者管理）
     * @returns {Promise<void>}
     */
    async destroy()
    {
        // 取消所有活动分段
        for (const id of Array.from(this._segments.keys()))
        {
            this.cancel(id);
        }
        this._segments.clear();

        // 移除 bridge 进度监听
        if (typeof this._bridge.off === 'function')
        {
            for (const cb of this._progressListeners)
            {
                try { this._bridge.off('progress', cb); } catch (e) { /* 忽略 */ }
            }
        }
        this._progressListeners.clear();
    }

    // ===================== 内部 helper =====================

    /**
     * 选择下载/播放的文件
     * 优先使用指定的 fileName; 否则选最大的视频文件; 找不到视频则选最大文件
     * @param {Array<{name:number,length:number,path:string}>} files - 文件列表
     * @param {string} [fileName] - 指定的文件名
     * @returns {{name:string,length:number,path:string}} 选中的文件
     */
    _selectFile(files, fileName)
    {
        if (fileName)
        {
            const hit = files.find(f => f.name === fileName);
            if (hit) return hit;
        }
        let bestVideo = null;
        let bestAny = files[0];
        for (const f of files)
        {
            if (f.length > bestAny.length) bestAny = f;
            const ext = path.extname(f.name).toLowerCase();
            if (VIDEO_EXTENSIONS.has(ext))
            {
                if (!bestVideo || f.length > bestVideo.length) bestVideo = f;
            }
        }
        return bestVideo || bestAny;
    }

    /**
     * 确保已 play 拿到 streamUrl（带缓存）
     * 首次调用发起 bridge.send('play', ...), 后续直接复用 _playCache
     * @returns {Promise<{streamUrl:string,isLocal:boolean}>}
     */
    async _ensurePlayStream()
    {
        if (this._playCache) return this._playCache;
        const src = this._source;
        const file = this._resolveCache ? this._resolveCache.file : null;
        if (!file)
        {
            throw this._makeError('invalid-url', 'probe must be called before createSegmentReader');
        }
        const reply = await this._bridge.send('play', {
            magnetUri: src.value,
            fileName: file.name,
            infoHash: src.infoHash || ''
        });
        if (!reply || reply.type === 'error' || !reply.streamUrl)
        {
            throw this._makeError('server', (reply && reply.error) || 'play failed');
        }
        this._playCache = {
            streamUrl: reply.streamUrl,
            isLocal: !!reply.isLocal,
            fileName: file.name,
            infoHash: src.infoHash || ''
        };
        return this._playCache;
    }

    /**
     * 发送可选 action（失败时 console.warn 并返回 undefined, 不抛出）
     * 用于 set-priority / set-speed-limit / verify-pieces 等扩展命令
     * @param {string} action - bridge action
     * @param {Object} params - 参数
     * @returns {Promise<Object|undefined>} reply 或 undefined
     */
    async _sendOptional(action, params)
    {
        try
        {
            const reply = await this._bridge.send(action, params);
            if (reply && reply.type === 'error')
            {
                console.warn(`[MagnetTransport] ${action} 失败:`, reply.error);
                return undefined;
            }
            return reply;
        }
        catch (err)
        {
            console.warn(`[MagnetTransport] ${action} 异常:`, err && err.message);
            return undefined;
        }
    }

    /**
     * 解析 streamUrl 为 URL 对象
     * @param {string} urlStr - URL 字符串
     * @returns {URL} 解析后的 URL 对象
     * @throws {Error} 无效 URL 时抛出 (errorType='invalid-url')
     */
    _parseUrl(urlStr)
    {
        try
        {
            return new URL(urlStr);
        }
        catch (e)
        {
            throw this._makeError('invalid-url', `invalid stream url: ${urlStr}`);
        }
    }

    /**
     * 根据文件扩展名推断 Content-Type
     * @param {string} fileName - 文件名
     * @returns {string} MIME 类型
     */
    _getContentType(fileName)
    {
        const ext = path.extname(fileName || '').toLowerCase();
        return CONTENT_TYPES[ext] || 'application/octet-stream';
    }

    /**
     * 分类 HTTP 状态码错误
     * 416 归 invalid-url, 其他 4xx/5xx 归 server
     * @param {number} statusCode - HTTP 状态码
     * @returns {Error} 带 errorType 的错误对象
     */
    _classifyStatusError(statusCode)
    {
        if (statusCode === 416)
        {
            return this._makeError('invalid-url', 'HTTP 416 Range Not Satisfiable');
        }
        return this._makeError('server', `HTTP ${statusCode}`);
    }

    /**
     * 分类网络请求错误（统一归 network）
     * @param {Error} err - 原始错误
     * @returns {Error} 带 errorType 的错误对象
     */
    _classifyError(err)
    {
        const code = err && err.code;
        const message = (err && err.message) || String(err);
        return this._makeError('network', message, code);
    }

    /**
     * 构造带 errorType 的错误对象
     * @param {string} errorType - 错误类型 (invalid-url/network/server)
     * @param {string} message - 错误消息
     * @param {string} [code] - 错误代码
     * @returns {Error} 错误实例, 带 errorType 属性
     */
    _makeError(errorType, message, code)
    {
        const err = new Error(message);
        err.errorType = errorType;
        if (code) err.code = code;
        return err;
    }
}

module.exports = MagnetTransport;
module.exports.ThrottleTransform = ThrottleTransform;
