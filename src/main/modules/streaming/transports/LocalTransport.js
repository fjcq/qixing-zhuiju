// 文件系统模块
const fs = require('fs');
// fs.promises 异步文件操作
const fsp = fs.promises;
// 路径模块
const path = require('path');

// 父类接口
const ITransport = require('./ITransport');
// 分段写入器
const SegmentWriter = require('./SegmentWriter');

// 扩展名 → MIME 映射表 (与 magnetHandler.mjs getContentType 保持一致)
const CONTENT_TYPES = {
    '.mp4': 'video/mp4',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime',
    '.wmv': 'video/x-ms-wmv',
    '.flv': 'video/x-flv',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.flac': 'audio/flac',
    '.aac': 'audio/aac'
};

/**
 * 本地文件传输层实现
 * 直接读取本地文件系统上的视频文件, 无需 HTTP/磁力链封装
 * 继承自 ITransport, 实现 probe/createSegmentReader/createSegmentWriter/cancel
 */
class LocalTransport extends ITransport
{
    /**
     * 构造本地文件传输层
     * @param {Object} [source] - 源描述对象 { type:'local', value:'/abs/path/to/video.mp4' }
     */
    constructor(source)
    {
        super();
        this._source = source || null;
        // segmentId → { stream, reader } 活动分段映射
        this._segments = new Map();
    }

    /**
     * 探测本地文件信息
     * 使用 fs.promises.stat 异步获取文件大小, 推断 contentType
     * 本地文件天然支持 Range, acceptRanges 恒为 true
     * @param {Object} [source] - 源描述对象, 未传则使用构造时的 source
     * @returns {Promise<ProbeResult>} 探测结果 { size, acceptRanges, contentType, fileName }
     * @throws {Error} errorType: 'invalid-path' / 'not-found' / 'not-a-file'
     */
    async probe(source)
    {
        const src = source || this._source;
        if (!src || !src.value || typeof src.value !== 'string')
        {
            throw this._makeError('invalid-path', 'no source path provided');
        }
        this._source = src;
        const filePath = src.value;

        let stats;
        try
        {
            stats = await fsp.stat(filePath);
        }
        catch (err)
        {
            throw this._classifyStatError(err);
        }

        if (stats.isDirectory())
        {
            throw this._makeError('not-a-file', `path is a directory: ${filePath}`);
        }
        if (!stats.isFile())
        {
            throw this._makeError('not-a-file', `path is not a regular file: ${filePath}`);
        }

        const contentType = this._getContentType(filePath);
        const fileName = path.basename(filePath);

        return {
            size: stats.size,
            acceptRanges: true,
            contentType,
            fileName
        };
    }

    /**
     * 创建分段读取器
     * 用 fs.createReadStream(filePath, { start, end }) 创建可读流, 封装为 SegmentReader
     * @param {SegmentReaderOptions} opts - { id, start, end, priority?, onProgress? }
     * @returns {Promise<SegmentReader>} SegmentReader 实例
     * 注意：调用方必须通过 stream.on('data', ...) 消费数据以触发 onProgress 回调。
     */
    async createSegmentReader(opts)
    {
        const { id, start, end, onProgress } = opts;
        const src = this._source;
        if (!src || !src.value)
        {
            throw this._makeError('invalid-path', 'no source bound');
        }
        const filePath = src.value;

        let stream;
        try
        {
            stream = fs.createReadStream(filePath, { start, end });
        }
        catch (err)
        {
            throw this._makeError(
                'read-error',
                `failed to create read stream: ${err.message}`,
                err.code
            );
        }

        const bytesTotal = end - start + 1;
        const reader = {
            id,
            start,
            end,
            stream,
            bytesTotal,
            bytesLoaded: 0,
            abort: () =>
            {
                this._abortSegment(id);
            }
        };

        // 立即注册到 _segments, 以便 cancel 在流就绪前也可生效
        this._segments.set(id, { stream, reader });

        // 监听 data 事件, 更新 bytesLoaded 并回调 onProgress
        stream.on('data', (chunk) =>
        {
            reader.bytesLoaded += chunk.length;
            if (typeof onProgress === 'function')
            {
                try
                {
                    onProgress(reader.bytesLoaded, reader.bytesTotal);
                }
                catch (e)
                {
                    // 回调异常不影响数据流
                }
            }
        });

        // 流正常结束时清理映射
        stream.on('end', () =>
        {
            this._segments.delete(id);
        });

        // 流出错时清理映射, 并将分类后的错误挂到 reader 上
        // 调用方通过 stream.on('error') 接收原始错误, 通过 reader.error 读取分类错误
        stream.on('error', (err) =>
        {
            this._segments.delete(id);
            reader.error = this._makeError(
                'read-error',
                `stream read error: ${err.message}`,
                err.code
            );
        });

        return reader;
    }

    /**
     * 创建分段写入器
     * 本地文件场景下, StreamEngine 通过 reader→writer 管道复制源文件到 savePath
     * 若 savePath 与 source.value 相同 (同一文件), 抛 'same-file' 错误避免覆盖源文件
     * @param {SegmentWriterOptions} opts - { savePath, append? }
     * @returns {Promise<SegmentWriter>} SegmentWriter 实例
     * @throws {Error} errorType: 'same-file' / 'invalid-path'
     */
    async createSegmentWriter(opts)
    {
        const { savePath } = opts;
        if (!savePath || typeof savePath !== 'string')
        {
            throw this._makeError('invalid-path', 'savePath is empty or not a string');
        }
        const src = this._source;
        if (src && src.value
            && path.resolve(savePath) === path.resolve(src.value))
        {
            throw this._makeError(
                'same-file',
                `savePath is identical to source file: ${savePath}`
            );
        }

        // 复用通用 SegmentWriter, 等待文件打开后返回
        const writer = new SegmentWriter(opts);
        await writer.ready;
        return writer;
    }

    /**
     * 取消指定分段
     * 中止进行中的读取流, 未知 segmentId 静默忽略
     * @param {string} segmentId - 分段唯一标识
     * @returns {void}
     */
    cancel(segmentId)
    {
        this._abortSegment(segmentId);
    }

    /**
     * 销毁传输层, 释放所有活动分段资源
     * 在 StreamEngine 切换源或关闭时调用
     * @returns {void}
     */
    destroy()
    {
        for (const id of Array.from(this._segments.keys()))
        {
            this._abortSegment(id);
        }
        this._segments.clear();
    }

    /**
     * 中止指定分段, 销毁底层流并从映射中删除
     * @param {string} segmentId - 分段唯一标识
     * @returns {void}
     */
    _abortSegment(segmentId)
    {
        const seg = this._segments.get(segmentId);
        if (!seg)
        {
            return;
        }
        if (seg.stream)
        {
            try
            {
                seg.stream.destroy();
            }
            catch (e)
            {
                // 忽略销毁异常
            }
        }
        this._segments.delete(segmentId);
    }

    /**
     * 根据文件扩展名推断 MIME 类型
     * 映射表与 magnetHandler.mjs getContentType 保持一致
     * @param {string} filePath - 文件路径
     * @returns {string} MIME 类型, 未知扩展名返回 'application/octet-stream'
     */
    _getContentType(filePath)
    {
        const ext = path.extname(filePath).toLowerCase();
        return CONTENT_TYPES[ext] || 'application/octet-stream';
    }

    /**
     * 分类 fs.stat 错误
     * ENOENT 归 not-found, EISDIR 归 not-a-file, 其他归 read-error
     * @param {Error} err - 原始错误
     * @returns {Error} 带 errorType 的错误对象
     */
    _classifyStatError(err)
    {
        const code = err && err.code;
        const message = (err && err.message) || String(err);
        if (code === 'ENOENT')
        {
            return this._makeError('not-found', `file not found: ${message}`, code);
        }
        if (code === 'EISDIR')
        {
            return this._makeError('not-a-file', `path is a directory: ${message}`, code);
        }
        return this._makeError('read-error', `stat failed: ${message}`, code);
    }

    /**
     * 构造带 errorType 的错误对象
     * @param {string} errorType - 错误类型 (invalid-path/not-found/not-a-file/read-error/same-file)
     * @param {string} message - 错误消息
     * @param {string} [code] - 错误代码
     * @returns {Error} 错误实例, 带 errorType 属性
     */
    _makeError(errorType, message, code)
    {
        const err = new Error(message);
        err.errorType = errorType;
        if (code)
        {
            err.code = code;
        }
        return err;
    }
}

module.exports = LocalTransport;
