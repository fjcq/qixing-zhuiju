/**
 * 全局错误处理模块
 * 提供统一的错误捕获、日志记录和用户通知功能
 */

/**
 * 错误类型枚举
 */
const ErrorTypes = {
    NETWORK: 'NETWORK_ERROR',
    VALIDATION: 'VALIDATION_ERROR',
    PLAYER: 'PLAYER_ERROR',
    IPC: 'IPC_ERROR',
    DLNA: 'DLNA_ERROR',
    STORAGE: 'STORAGE_ERROR',
    UNKNOWN: 'UNKNOWN_ERROR'
};

/**
 * 错误日志记录器
 * @param {string} type - 错误类型
 * @param {Error|string} error - 错误对象或消息
 * @param {object} context - 上下文信息
 */
function logError(type, error, context = {}) {
    const timestamp = new Date().toISOString();
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : '';

    const logEntry = {
        timestamp,
        type,
        message: errorMessage,
        stack: errorStack,
        context
    };

    // 输出到控制台
    console.error(`[${timestamp}] [${type}] ${errorMessage}`);
    if (errorStack) {
        console.error(errorStack);
    }

    // 在开发模式下输出更详细的信息
    if (process.env.NODE_ENV === 'development' || process.argv.includes('--dev')) {
        console.error('[ERROR-CONTEXT]', JSON.stringify(context, null, 2));
    }

    return logEntry;
}

/**
 * 用户友好的错误消息映射
 */
const userFriendlyMessages = {
    [ErrorTypes.NETWORK]: '网络连接失败，请检查网络设置',
    [ErrorTypes.VALIDATION]: '数据验证失败，请检查输入',
    [ErrorTypes.PLAYER]: '播放器错误，请尝试重新加载',
    [ErrorTypes.IPC]: '进程通信错误，请重启应用',
    [ErrorTypes.DLNA]: '投屏功能错误，请检查设备连接',
    [ErrorTypes.STORAGE]: '数据存储错误，请检查存储空间',
    [ErrorTypes.UNKNOWN]: '发生未知错误，请稍后重试'
};

/**
 * 获取用户友好的错误消息
 * @param {string} type - 错误类型
 * @returns {string} 用户友好的错误消息
 */
function getUserFriendlyMessage(type) {
    return userFriendlyMessages[type] || userFriendlyMessages[ErrorTypes.UNKNOWN];
}

/**
 * 全局错误处理器
 */
class GlobalErrorHandler {
    constructor() {
        this.errorHistory = [];
        this.maxHistorySize = 100;
        this.listeners = new Map();
    }

    /**
     * 处理错误
     * @param {string} type - 错误类型
     * @param {Error|string} error - 错误对象
     * @param {object} context - 上下文
     * @returns {object} 错误处理结果
     */
    handleError(type, error, context = {}) {
        // 记录错误日志
        const logEntry = logError(type, error, context);

        // 添加到历史记录
        this.addToHistory(logEntry);

        // 通知监听器
        this.notifyListeners(type, logEntry);

        // 返回处理结果
        return {
            success: false,
            error: getUserFriendlyMessage(type),
            type,
            originalError: error instanceof Error ? error.message : String(error),
            timestamp: logEntry.timestamp
        };
    }

    /**
     * 添加错误到历史记录
     * @param {object} logEntry - 日志条目
     */
    addToHistory(logEntry) {
        this.errorHistory.push(logEntry);
        if (this.errorHistory.length > this.maxHistorySize) {
            this.errorHistory.shift();
        }
    }

    /**
     * 获取错误历史
     * @returns {Array} 错误历史记录
     */
    getErrorHistory() {
        return [...this.errorHistory];
    }

    /**
     * 清空错误历史
     */
    clearErrorHistory() {
        this.errorHistory = [];
    }

    /**
     * 添加错误监听器
     * @param {string} type - 错误类型
     * @param {Function} listener - 监听函数
     */
    addListener(type, listener) {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, []);
        }
        this.listeners.get(type).push(listener);
    }

    /**
     * 移除错误监听器
     * @param {string} type - 错误类型
     * @param {Function} listener - 监听函数
     */
    removeListener(type, listener) {
        if (this.listeners.has(type)) {
            const listeners = this.listeners.get(type);
            const index = listeners.indexOf(listener);
            if (index > -1) {
                listeners.splice(index, 1);
            }
        }
    }

    /**
     * 通知所有监听器
     * @param {string} type - 错误类型
     * @param {object} logEntry - 日志条目
     */
    notifyListeners(type, logEntry) {
        // 通知特定类型的监听器
        if (this.listeners.has(type)) {
            this.listeners.get(type).forEach(listener => {
                try {
                    listener(logEntry);
                } catch (e) {
                    console.error('[ERROR-HANDLER] 监听器执行失败:', e);
                }
            });
        }

        // 通知通用监听器
        if (this.listeners.has('*')) {
            this.listeners.get('*').forEach(listener => {
                try {
                    listener(logEntry);
                } catch (e) {
                    console.error('[ERROR-HANDLER] 通用监听器执行失败:', e);
                }
            });
        }
    }
}

/**
 * 创建全局错误处理器实例
 */
const globalErrorHandler = new GlobalErrorHandler();

/**
 * 初始化主进程全局错误处理
 */
function setupMainProcessErrorHandling() {
    // 捕获未处理的Promise拒绝
    process.on('unhandledRejection', (reason, promise) => {
        console.error('[MAIN] 未处理的Promise拒绝:');
        console.error(reason);
        globalErrorHandler.handleError(
            ErrorTypes.UNKNOWN,
            reason instanceof Error ? reason : String(reason),
            { source: 'unhandledRejection' }
        );
    });

    // 捕获未捕获的异常
    process.on('uncaughtException', error => {
        console.error('[MAIN] 未捕获的异常:');
        console.error(error);
        globalErrorHandler.handleError(
            ErrorTypes.UNKNOWN,
            error,
            { source: 'uncaughtException' }
        );
    });

    console.log('[MAIN] 全局错误处理已初始化');
}

/**
 * 初始化渲染进程全局错误处理
 */
function setupRendererProcessErrorHandling() {
    // 捕获未处理的Promise拒绝
    window.addEventListener('unhandledrejection', event => {
        console.error('[RENDERER] 未处理的Promise拒绝:');
        console.error(event.reason);
        globalErrorHandler.handleError(
            ErrorTypes.UNKNOWN,
            event.reason instanceof Error ? event.reason : String(event.reason),
            { source: 'unhandledrejection' }
        );
    });

    // 捕获全局错误
    window.addEventListener('error', event => {
        console.error('[RENDERER] 全局错误:');
        console.error(event.error);
        globalErrorHandler.handleError(
            ErrorTypes.UNKNOWN,
            event.error || event.message,
            { source: 'globalError', filename: event.filename, lineno: event.lineno }
        );
    });

    console.log('[RENDERER] 全局错误处理已初始化');
}

module.exports = {
    ErrorTypes,
    logError,
    getUserFriendlyMessage,
    globalErrorHandler,
    setupMainProcessErrorHandling,
    setupRendererProcessErrorHandling
};
