/**
 * 探测结果
 * @typedef {Object} ProbeResult
 * @property {number} size - 文件总大小（字节）
 * @property {boolean} acceptRanges - 是否支持 Range 请求
 * @property {number} [bitrate] - 可选，视频码率（bps）
 * @property {string} contentType - MIME 类型，如 'video/mp4'
 * @property {string} fileName - 建议保存的文件名
 */

/**
 * 分段读取器
 * @typedef {Object} SegmentReader
 * @property {string} id - 分段唯一标识
 * @property {number} start - 起始字节偏移（含）
 * @property {number} end - 结束字节偏移（含）
 * @property {import('stream').Readable} stream - 可读流，消费方用 .on('data') 或 pipe 监听
 * @property {number} bytesTotal - 该段总字节数（end - start + 1）
 * @property {number} bytesLoaded - 已加载字节数，随读取实时更新
 * @property {() => void} abort - 中止读取，关闭底层连接并释放资源
 */

/**
 * 分段写入器
 * @typedef {Object} SegmentWriter
 * @property {string} savePath - 文件保存绝对路径
 * @property {boolean} append - 是否以追加模式写入（续传场景为 true）
 * @property {number} bytesWritten - 已写入字节数，随写入实时更新
 * @property {(chunk: Buffer) => Promise<void>} write - 写入一块数据
 * @property {() => Promise<void>} end - 结束写入，flush 并关闭文件
 * @property {() => Promise<void>} abort - 中止并清理，删除部分写入的文件
 */

/**
 * 分段读取器创建参数
 * @typedef {Object} SegmentReaderOptions
 * @property {string} id - 分段唯一标识
 * @property {number} start - 起始字节偏移（含）
 * @property {number} end - 结束字节偏移（含）
 * @property {'high'|'normal'|'low'} [priority] - 优先级，默认 'normal'
 * @property {(loaded: number, total: number) => void} [onProgress] - 进度回调
 */

/**
 * 分段写入器创建参数
 * @typedef {Object} SegmentWriterOptions
 * @property {string} savePath - 文件保存绝对路径
 * @property {boolean} [append] - 是否追加模式，默认 false
 */

/**
 * 传输层统一接口（抽象基类）
 * 所有传输层实现（HttpTransport / MagnetTransport / LocalTransport）必须继承本类
 * 并覆盖全部方法。直接调用基类方法将抛出 'ITransport: method <name> not implemented'。
 */
class ITransport
{
    /**
     * 探测源信息（不发下载）
     * 子类应通过 HEAD 请求或元数据查询获取源信息
     *
     * @param {Object} source - 源描述对象
     * @param {string} source.type - 源类型：'url' | 'magnet' | 'local'
     * @param {string} source.value - URL / magnet URI / 本地路径
     * @param {string} [source.infoHash] - 仅磁力场景的 infoHash
     * @returns {Promise<ProbeResult>} 探测结果
     * @throws {Error} 子类未覆盖时抛出 'ITransport: method probe not implemented'
     */
    async probe(source)
    {
        throw new Error('ITransport: method probe not implemented');
    }

    /**
     * 创建分段读取器
     * 子类应返回实现 SegmentReader 接口的对象，并启动字节范围读取
     *
     * @param {SegmentReaderOptions} opts - 读取器参数
     * @returns {Promise<SegmentReader>} 分段读取器实例
     * @throws {Error} 子类未覆盖时抛出 'ITransport: method createSegmentReader not implemented'
     */
    createSegmentReader(opts)
    {
        throw new Error('ITransport: method createSegmentReader not implemented');
    }

    /**
     * 创建分段写入器
     * 子类应返回实现 SegmentWriter 接口的对象，并准备好目标文件
     *
     * @param {SegmentWriterOptions} opts - 写入器参数
     * @returns {Promise<SegmentWriter>} 分段写入器实例
     * @throws {Error} 子类未覆盖时抛出 'ITransport: method createSegmentWriter not implemented'
     */
    createSegmentWriter(opts)
    {
        throw new Error('ITransport: method createSegmentWriter not implemented');
    }

    /**
     * 取消指定分段
     * 中止该分段进行中的读取/写入，并清理资源
     *
     * @param {string} segmentId - 分段唯一标识
     * @returns {void}
     * @throws {Error} 子类未覆盖时抛出 'ITransport: method cancel not implemented'
     */
    cancel(segmentId)
    {
        throw new Error('ITransport: method cancel not implemented');
    }
}

module.exports = ITransport;
