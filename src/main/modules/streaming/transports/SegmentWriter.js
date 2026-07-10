// 文件系统模块
const fs = require('fs');

/**
 * 分段写入器
 * 封装 fs.createWriteStream, 提供 Promise 风格的 write/end/abort 接口
 * 字段/方法签名与 ITransport.SegmentWriter typedef 完全一致
 */
class SegmentWriter
{
    /**
     * 构造分段写入器
     * 同步启动文件打开流程, 调用方需 await writer.ready 等待文件就绪
     * @param {Object} opts - 写入器参数
     * @param {string} opts.savePath - 文件保存绝对路径
     * @param {boolean} [opts.append=false] - 是否追加模式, 默认覆盖
     */
    constructor(opts)
    {
        const { savePath, append } = opts;
        this.savePath = savePath;
        this.append = !!append;
        this.bytesWritten = 0;

        const flags = append ? 'a' : 'w';
        this._stream = fs.createWriteStream(savePath, { flags });

        // 等待文件打开, 失败则 reject (如目录不存在)
        this._ready = new Promise((resolve, reject) =>
        {
            const onOpen = () =>
            {
                this._stream.removeListener('error', onError);
                resolve();
            };
            const onError = (err) =>
            {
                this._stream.removeListener('open', onOpen);
                reject(err);
            };
            this._stream.once('open', onOpen);
            this._stream.once('error', onError);
        });
    }

    /**
     * 文件就绪 Promise, 调用方应在写入前 await
     * @returns {Promise<void>}
     */
    get ready()
    {
        return this._ready;
    }

    /**
     * 写入一块数据
     * @param {Buffer} chunk - 待写入数据
     * @returns {Promise<void>} 写入完成 resolve, 失败 reject
     */
    write(chunk)
    {
        return new Promise((resolve, reject) =>
        {
            const onError = (err) =>
            {
                this._stream.removeListener('error', onError);
                reject(err);
            };
            this._stream.once('error', onError);
            this._stream.write(chunk, () =>
            {
                this._stream.removeListener('error', onError);
                this.bytesWritten += chunk.length;
                resolve();
            });
        });
    }

    /**
     * 结束写入, flush 并关闭文件
     * @returns {Promise<void>} 关闭完成 resolve, 失败 reject
     */
    end()
    {
        return new Promise((resolve, reject) =>
        {
            const onError = (err) =>
            {
                this._stream.removeListener('error', onError);
                reject(err);
            };
            this._stream.once('error', onError);
            this._stream.end(() =>
            {
                this._stream.removeListener('error', onError);
                resolve();
            });
        });
    }

    /**
     * 中止并清理, 删除部分写入的文件
     * @returns {Promise<void>} 始终 resolve (即使文件已被删除)
     */
    abort()
    {
        return new Promise((resolve) =>
        {
            // 抑制 destroy 过程中可能触发的 error 事件
            this._stream.on('error', () => {});
            this._stream.destroy();
            try
            {
                fs.unlinkSync(this.savePath);
            }
            catch (e)
            {
                // 文件可能已被删除, 忽略
            }
            resolve();
        });
    }
}

module.exports = SegmentWriter;
