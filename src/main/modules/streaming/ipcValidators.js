// streaming IPC 参数校验器与辅助工具
// 提供白名单常量、参数校验函数、错误响应构造器与 handler 包装器
// 从 ipcGateway.js 拆分以控制单文件行数 ≤500

// 资源类型白名单（与 ITransport.js 一致）
const VALID_SOURCE_TYPES = ['url', 'magnet', 'local'];
// 优先级白名单（与 DownloadQueue.js 一致）
const VALID_PRIORITIES = ['high', 'normal', 'low'];
// 下载模式白名单
const VALID_MODES = ['stream', 'download'];

// 全部 streaming IPC 频道名称（cleanup 时用于按名移除 handler）
const STREAMING_CHANNELS = [
    'streaming:start', 'streaming:pause', 'streaming:resume', 'streaming:cancel',
    'streaming:setPriority', 'streaming:setSpeedLimit', 'streaming:listTasks',
    'streaming:getTask', 'streaming:verify', 'streaming:setStoragePath',
    'streaming:getStorageInfo', 'streaming:cleanup', 'streaming:retry'
];

/**
 * 校验 taskId 是否为非空字符串
 * @param {*} taskId - 待校验值
 * @returns {boolean}
 */
function isValidTaskId(taskId)
{
    return typeof taskId === 'string' && taskId.length > 0;
}

/**
 * 构造失败响应对象
 * @param {Error} err - 错误对象
 * @returns {{success: false, error: string, errorType?: string}}
 */
function fail(err)
{
    return {
        success: false,
        error: err.message || String(err),
        errorType: err.errorType
    };
}

/**
 * 包装 IPC handler，统一 try/catch 错误处理
 * 业务逻辑只需返回 { success, ... }，抛出的异常自动转为失败响应
 * @param {Function} fn - (event, params) => Promise<result>
 * @returns {Function} 包装后的 ipcMain.handle 回调
 */
function wrapHandler(fn)
{
    return async (event, params) =>
    {
        try
        {
            return await fn(event, params);
        }
        catch (err)
        {
            return fail(err);
        }
    };
}

module.exports = {
    VALID_SOURCE_TYPES,
    VALID_PRIORITIES,
    VALID_MODES,
    STREAMING_CHANNELS,
    isValidTaskId,
    fail,
    wrapHandler
};
