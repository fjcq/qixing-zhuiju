// 文件系统模块
const fs = require('fs');
// 加密模块 (SHA256 哈希计算)
const crypto = require('crypto');

// SHA256 hex 字符串长度
const SHA256_HEX_LENGTH = 64;
// SHA256 hex 格式正则 (64 位十六进制, 大小写不敏感)
const SHA256_HEX_REGEX = /^[0-9a-fA-F]{64}$/;

/**
 * 完整性校验器
 * 提供 HTTP (Content-Length + SHA256) 与 Local (存在性 + 大小) 场景的完整性校验
 *
 * 设计要点:
 * - verifyFileSize: 用 fs.promises.stat 获取大小, 与预期值比对
 * - verifySha256: 用 fs.createReadStream + crypto.createHash 流式哈希,
 *   避免一次性加载大文件到内存
 * - verifyLocal: 用 fs.promises.stat 校验存在性, 拒绝目录/特殊文件
 * - 所有方法返回 { ok, ..., reason? } 结构, reason 为字符串错误码
 *
 * Magnet 场景的 piece hash 校验由 magnetHandler.mjs 子进程通过 IPC
 * verify-pieces 协议处理, 不在本类范围
 */
class IntegrityChecker
{
    /**
     * 校验文件大小是否匹配预期
     * @param {string} filePath - 文件绝对路径
     * @param {number} expectedSize - 预期字节数
     * @returns {Promise<{ok: boolean, actualSize: number, expectedSize: number, reason?: string}>}
     */
    async verifyFileSize(filePath, expectedSize)
    {
        // expectedSize 非合法数字 (NaN/Infinity/非数字) 时直接拒绝, 不触碰文件系统
        if (typeof expectedSize !== 'number' || !Number.isFinite(expectedSize))
        {
            return {
                ok: false,
                actualSize: 0,
                expectedSize,
                reason: 'invalid-expected-size'
            };
        }

        let stat;
        try
        {
            stat = await fs.promises.stat(filePath);
        }
        catch (err)
        {
            // 文件不存在
            if (err.code === 'ENOENT')
            {
                return {
                    ok: false,
                    actualSize: 0,
                    expectedSize,
                    reason: 'ENOENT'
                };
            }
            // 其他 stat 错误 (权限拒绝/路径无效等)
            return {
                ok: false,
                actualSize: 0,
                expectedSize,
                reason: err.code || 'unknown'
            };
        }

        const actualSize = stat.size;
        if (actualSize === expectedSize)
        {
            return {
                ok: true,
                actualSize,
                expectedSize
            };
        }
        return {
            ok: false,
            actualSize,
            expectedSize,
            reason: 'size-mismatch'
        };
    }

    /**
     * 校验文件 SHA256 哈希是否匹配预期 (流式计算, 避免大文件一次性加载到内存)
     * @param {string} filePath - 文件绝对路径
     * @param {string} expectedSha256 - 预期 SHA256 (hex, 64 位, 大小写不敏感)
     * @returns {Promise<{ok: boolean, actualSha256: string, expectedSha256: string, reason?: string}>}
     */
    async verifySha256(filePath, expectedSha256)
    {
        // expectedSha256 格式校验: 必须是 64 位 hex 字符串
        if (typeof expectedSha256 !== 'string' || !SHA256_HEX_REGEX.test(expectedSha256))
        {
            return {
                ok: false,
                actualSha256: '',
                expectedSha256,
                reason: 'invalid-expected-sha256'
            };
        }

        // 比较前统一规范化为小写 hex
        const normalizedExpected = expectedSha256.toLowerCase();

        return new Promise((resolve) =>
        {
            const hash = crypto.createHash('sha256');
            const stream = fs.createReadStream(filePath);
            // 标记是否已 resolve, 防止 end/error 重复触发 (理论上 stream 保证互斥, 此处防御)
            let settled = false;

            stream.on('data', (chunk) =>
            {
                hash.update(chunk);
            });

            stream.on('end', () =>
            {
                if (settled)
                {
                    return;
                }
                settled = true;
                const actualSha256 = hash.digest('hex');
                if (actualSha256 === normalizedExpected)
                {
                    resolve({
                        ok: true,
                        actualSha256,
                        expectedSha256: normalizedExpected
                    });
                }
                else
                {
                    resolve({
                        ok: false,
                        actualSha256,
                        expectedSha256: normalizedExpected,
                        reason: 'sha256-mismatch'
                    });
                }
            });

            stream.on('error', (err) =>
            {
                if (settled)
                {
                    return;
                }
                settled = true;
                // 文件不存在 (createReadStream 异步抛出 ENOENT)
                if (err.code === 'ENOENT')
                {
                    resolve({
                        ok: false,
                        actualSha256: '',
                        expectedSha256: normalizedExpected,
                        reason: 'ENOENT'
                    });
                    return;
                }
                // 其他读取错误 (权限/IO 等)
                resolve({
                    ok: false,
                    actualSha256: '',
                    expectedSha256: normalizedExpected,
                    reason: 'read-error',
                    message: err.message
                });
            });
        });
    }

    /**
     * 校验本地文件存在性 (Local 场景)
     * @param {string} filePath - 文件绝对路径
     * @returns {Promise<{ok: boolean, exists: boolean, size: number, reason?: string}>}
     */
    async verifyLocal(filePath)
    {
        let stat;
        try
        {
            stat = await fs.promises.stat(filePath);
        }
        catch (err)
        {
            // 文件不存在
            if (err.code === 'ENOENT')
            {
                return {
                    ok: false,
                    exists: false,
                    size: 0,
                    reason: 'ENOENT'
                };
            }
            // 其他 stat 错误
            return {
                ok: false,
                exists: false,
                size: 0,
                reason: err.code || 'unknown'
            };
        }

        // 拒绝非普通文件 (目录/字符设备/块设备等)
        if (!stat.isFile())
        {
            return {
                ok: false,
                exists: false,
                size: 0,
                reason: 'not-a-file'
            };
        }

        return {
            ok: true,
            exists: true,
            size: stat.size
        };
    }
}

module.exports = IntegrityChecker;
