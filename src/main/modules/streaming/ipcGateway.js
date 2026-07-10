// streaming IPC 网关模块
// 职责：
// 1. 注册所有 streaming:* IPC 频道（invoke），参数校验后转发到 StreamEngine/StorageManager
// 2. 启动本地 HTTP 服务器（/stream/<taskId> 路由，支持 Range + CORS）
// 3. 监听 StreamEngine 与 RetryController 事件，转发到所有渲染窗口
// 4. 暴露 cleanup 函数，应用退出时移除 handler/监听器并关闭 HTTP 服务器
//
// 辅助模块：
// - ipcValidators.js: 白名单常量、参数校验、错误响应构造、handler 包装器
// - streamServer.js: HTTP 服务器、事件转发

// Electron ipcMain 模块
const { ipcMain } = require('electron');
// 校验器与辅助工具
const {
    VALID_SOURCE_TYPES,
    VALID_PRIORITIES,
    VALID_MODES,
    STREAMING_CHANNELS,
    isValidTaskId,
    wrapHandler
} = require('./ipcValidators');
// HTTP 服务器与事件转发
const { createStreamServer, attachEventForwarders } = require('./streamServer');

/**
 * 注册所有 streaming:* IPC 频道
 * 使用 wrapHandler 统一 try/catch，业务函数只需返回 { success, ... }
 * @param {Object} deps - { streamEngine, storageManager, retryController, speedLimiter }
 */
function registerIpcHandlers({ streamEngine, storageManager, retryController, speedLimiter })
{
    // 启动下载任务
    ipcMain.handle('streaming:start', wrapHandler(async (event, params) =>
    {
        if (!params || typeof params !== 'object')
        {
            return { success: false, error: 'params must be an object' };
        }
        if (!params.source || !VALID_SOURCE_TYPES.includes(params.source.type))
        {
            return { success: false, error: 'invalid source.type' };
        }
        if (typeof params.source.value !== 'string' || !params.source.value)
        {
            return { success: false, error: 'invalid source.value' };
        }
        if (params.autoPlay === undefined)
        {
            return { success: false, error: 'autoPlay is required' };
        }
        if (params.priority && !VALID_PRIORITIES.includes(params.priority))
        {
            return { success: false, error: 'invalid priority' };
        }
        if (params.mode && !VALID_MODES.includes(params.mode))
        {
            return { success: false, error: 'invalid mode' };
        }
        const result = await streamEngine.start({
            source: params.source,
            savePath: params.savePath,
            priority: params.priority,
            speedLimit: params.speedLimit,
            autoPlay: params.autoPlay,
            mode: params.mode
        });
        return { success: true, taskId: result.taskId, playUrl: result.playUrl };
    }));

    // 暂停任务
    ipcMain.handle('streaming:pause', wrapHandler(async (event, params) =>
    {
        if (!params || !isValidTaskId(params.taskId))
        {
            return { success: false, error: 'invalid taskId' };
        }
        await streamEngine.pause(params.taskId);
        return { success: true };
    }));

    // 恢复任务
    ipcMain.handle('streaming:resume', wrapHandler(async (event, params) =>
    {
        if (!params || !isValidTaskId(params.taskId))
        {
            return { success: false, error: 'invalid taskId' };
        }
        await streamEngine.resume(params.taskId);
        return { success: true };
    }));

    // 取消任务，removeFiles=true 时删除已下载文件
    ipcMain.handle('streaming:cancel', wrapHandler(async (event, params) =>
    {
        if (!params || !isValidTaskId(params.taskId))
        {
            return { success: false, error: 'invalid taskId' };
        }
        const removeFiles = params.removeFiles === true;
        await streamEngine.cancel(params.taskId, removeFiles);
        return { success: true };
    }));

    // 设置任务优先级（同步更新 downloadQueue 与 manifest）
    ipcMain.handle('streaming:setPriority', wrapHandler(async (event, params) =>
    {
        if (!params || !isValidTaskId(params.taskId))
        {
            return { success: false, error: 'invalid taskId' };
        }
        if (!VALID_PRIORITIES.includes(params.priority))
        {
            return { success: false, error: 'invalid priority' };
        }
        streamEngine.downloadQueue.setPriority(params.taskId, params.priority);
        await streamEngine.manifestStore.update(
            params.taskId, { priority: params.priority });
        return { success: true };
    }));

    // 设置限速（taskId 为空时设置全局）
    ipcMain.handle('streaming:setSpeedLimit', wrapHandler(async (event, params) =>
    {
        if (!params || typeof params.bytesPerSec !== 'number'
            || params.bytesPerSec < 0)
        {
            return { success: false, error: 'invalid bytesPerSec' };
        }
        if (params.taskId)
        {
            speedLimiter.setTaskLimit(params.taskId, params.bytesPerSec);
        }
        else
        {
            // SpeedLimiter 未暴露 setGlobalLimit，直接赋值 globalBps
            // globalBucket 会在下次 _refill 时收敛到新上限
            speedLimiter.globalBps = params.bytesPerSec;
        }
        return { success: true };
    }));

    // 列出任务，支持按 status / sourceType 过滤
    ipcMain.handle('streaming:listTasks', wrapHandler(async (event, params) =>
    {
        let tasks = streamEngine.manifestStore.getAll();
        if (params && params.status)
        {
            tasks = tasks.filter(t => t.status === params.status);
        }
        if (params && params.sourceType)
        {
            tasks = tasks.filter(t => t.source && t.source.type === params.sourceType);
        }
        return { success: true, tasks };
    }));

    // 获取单个任务
    ipcMain.handle('streaming:getTask', wrapHandler(async (event, params) =>
    {
        if (!params || !isValidTaskId(params.taskId))
        {
            return { success: false, error: 'invalid taskId' };
        }
        const task = streamEngine.manifestStore.get(params.taskId);
        if (!task)
        {
            return { success: false, error: 'task not found' };
        }
        return { success: true, task };
    }));

    // 校验文件完整性（触发 'integrity' 事件并返回结果）
    ipcMain.handle('streaming:verify', wrapHandler(async (event, params) =>
    {
        if (!params || !isValidTaskId(params.taskId))
        {
            return { success: false, error: 'invalid taskId' };
        }
        const integrity = await streamEngine.verify(params.taskId);
        return { success: true, integrity };
    }));

    // 设置下载路径，migrate=true 时迁移现有文件
    ipcMain.handle('streaming:setStoragePath', wrapHandler(async (event, params) =>
    {
        if (!params || typeof params.path !== 'string' || !params.path)
        {
            return { success: false, error: 'invalid path' };
        }
        const migrate = params.migrate === true;
        const result = await storageManager.setDownloadPath(params.path, migrate);
        return { success: true, migrated: result.migrated };
    }));

    // 获取存储信息（总容量/可用/已用/下载路径）
    ipcMain.handle('streaming:getStorageInfo', wrapHandler(async () =>
    {
        const info = await storageManager.getStorageInfo();
        return {
            success: true,
            total: info.total,
            free: info.free,
            used: info.used,
            downloadPath: info.downloadPath
        };
    }));

    // 清理旧任务文件（删除早于 beforeDays 天的文件）
    ipcMain.handle('streaming:cleanup', wrapHandler(async (event, params) =>
    {
        const beforeDays = params && params.beforeDays;
        if (typeof beforeDays !== 'number' || beforeDays < 1)
        {
            return { success: false, error: 'invalid beforeDays' };
        }
        const result = await storageManager.cleanupOldTasks(beforeDays);
        return { success: true, removed: result.removed };
    }));

    // 手动重试任务（仅对 error/paused 状态有效）
    ipcMain.handle('streaming:retry', wrapHandler(async (event, params) =>
    {
        if (!params || !isValidTaskId(params.taskId))
        {
            return { success: false, error: 'invalid taskId' };
        }
        const task = streamEngine.manifestStore.get(params.taskId);
        if (!task)
        {
            return { success: false, error: 'task not found' };
        }
        if (task.status !== 'error' && task.status !== 'paused')
        {
            return {
                success: false,
                error: `task is in ${task.status} state, cannot retry`
            };
        }
        // 清除重试状态，允许后续错误再次触发指数退避
        retryController.clear(params.taskId);
        // resume 会更新状态为 downloading 并触发 _runTask
        await streamEngine.resume(params.taskId);
        return { success: true };
    }));
}

/**
 * 设置 streaming IPC 网关
 * 启动 HTTP 服务器、注册 IPC 频道、挂接事件转发，返回 cleanup 函数
 * @param {Object} deps - 依赖对象
 * @param {Object} deps.streamEngine - StreamEngine 实例
 * @param {Object} deps.storageManager - StorageManager 实例
 * @param {Object} deps.retryController - RetryController 实例
 * @param {Object} deps.speedLimiter - SpeedLimiter 实例
 * @param {number} [deps.streamPort=0] - 本地 HTTP 服务器端口（0=随机）
 * @param {Function} [deps.onReady] - 服务器启动后的回调 (port) => void
 * @returns {Function} cleanup 函数，应用退出时调用以关闭服务器与移除监听器
 */
function setupStreamingIPC({
    streamEngine,
    storageManager,
    retryController,
    speedLimiter,
    streamPort = 0,
    onReady
})
{
    if (!streamEngine || !storageManager || !retryController || !speedLimiter)
    {
        throw new Error(
            'setupStreamingIPC: streamEngine/storageManager/retryController/speedLimiter are required');
    }

    // 1. 启动本地 HTTP 服务器（/stream/<taskId> 路由）
    const server = createStreamServer(streamEngine, streamPort, onReady);

    // 2. 注册所有 streaming:* IPC 频道
    registerIpcHandlers({ streamEngine, storageManager, retryController, speedLimiter });

    // 3. 挂接 StreamEngine 与 RetryController 事件转发
    attachEventForwarders(streamEngine, retryController);

    // 4. 返回 cleanup 函数：移除 handler、解绑事件、关闭服务器
    return function cleanup()
    {
        for (const ch of STREAMING_CHANNELS)
        {
            // rawListeners 返回已注册的处理器数组；存在时才移除
            if (ipcMain.rawListeners(ch).length > 0)
            {
                ipcMain.removeHandler(ch);
            }
        }
        streamEngine.removeAllListeners();
        retryController.removeAllListeners();
        server.close();
    };
}

module.exports = { setupStreamingIPC };
