/**
 * IPC安全验证工具
 * 提供输入验证、URL验证和数据清理功能
 */

import { ErrorType } from '../../types';

/**
 * URL验证结果
 */
interface ValidationResult {
    valid: boolean;
    error?: string;
    sanitized?: string | object;
}

/**
 * URL验证器
 * 检查URL是否为有效的HTTP/HTTPS URL
 * @param url - 待验证的URL
 * @returns 是否有效
 */
export function isValidUrl(url: unknown): url is string {
    if (typeof url !== 'string') return false;
    if (url.length === 0 || url.length > 2048) return false;

    try {
        const urlObj = new URL(url);
        return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
    } catch {
        return false;
    }
}

/**
 * 安全URL验证器
 * 检查URL是否为安全的视频/图片资源URL
 * @param url - 待验证的URL
 * @returns 验证结果
 */
export function validateMediaUrl(url: unknown): ValidationResult {
    if (!url) {
        return { valid: false, error: 'URL不能为空' };
    }

    if (typeof url !== 'string') {
        return { valid: false, error: 'URL必须是字符串' };
    }

    if (url.length > 2048) {
        return { valid: false, error: 'URL长度超过限制' };
    }

    const dangerousProtocols = ['javascript:', 'data:', 'vbscript:', 'file:'];
    const lowerUrl = url.toLowerCase().trim();

    for (const protocol of dangerousProtocols) {
        if (lowerUrl.startsWith(protocol)) {
            return { valid: false, error: `不允许的协议: ${protocol}` };
        }
    }

    if (!isValidUrl(url)) {
        return { valid: false, error: '无效的URL格式' };
    }

    return { valid: true, sanitized: url };
}

/**
 * 设备ID验证器
 * @param deviceId - 设备ID
 * @returns 验证结果
 */
export function validateDeviceId(deviceId: unknown): ValidationResult {
    if (!deviceId) {
        return { valid: false, error: '设备ID不能为空' };
    }

    if (typeof deviceId !== 'string') {
        return { valid: false, error: '设备ID必须是字符串' };
    }

    if (deviceId.length > 256) {
        return { valid: false, error: '设备ID长度超过限制' };
    }

    const safePattern = /^[a-zA-Z0-9\-_:]+$/;
    if (!safePattern.test(deviceId)) {
        return { valid: false, error: '设备ID包含非法字符' };
    }

    return { valid: true, sanitized: deviceId };
}

/**
 * 视频数据接口
 */
interface VideoData {
    url?: string;
    title?: string;
    poster?: string;
    episodeIndex?: number;
    vod_id?: string;
}

/**
 * 视频数据验证器
 * @param videoData - 视频数据对象
 * @returns 验证结果
 */
export function validateVideoData(videoData: unknown): ValidationResult {
    if (!videoData || typeof videoData !== 'object') {
        return { valid: false, error: '无效的视频数据' };
    }

    const data = videoData as VideoData;
    const sanitized: VideoData = {};
    const errors: string[] = [];

    if (data.url) {
        const urlResult = validateMediaUrl(data.url);
        if (!urlResult.valid) {
            errors.push(`视频URL无效: ${urlResult.error}`);
        } else {
            sanitized.url = data.url.trim();
        }
    }

    if (data.title !== undefined) {
        if (typeof data.title !== 'string') {
            errors.push('标题必须是字符串');
        } else if (data.title.length > 500) {
            errors.push('标题长度超过限制');
        } else {
            sanitized.title = data.title.trim().substring(0, 500);
        }
    }

    if (data.poster !== undefined && data.poster) {
        const posterResult = validateMediaUrl(data.poster);
        if (!posterResult.valid) {
            errors.push(`海报URL无效: ${posterResult.error}`);
        } else {
            sanitized.poster = data.poster.trim();
        }
    }

    if (data.episodeIndex !== undefined) {
        const index = Number(data.episodeIndex);
        if (!Number.isInteger(index) || index < 0) {
            errors.push('集数索引必须是非负整数');
        } else {
            sanitized.episodeIndex = index;
        }
    }

    if (errors.length > 0) {
        return { valid: false, error: errors.join('; ') };
    }

    return { valid: true, sanitized };
}

/**
 * 搜索关键词验证器
 * @param keyword - 搜索关键词
 * @returns 验证结果
 */
export function validateSearchKeyword(keyword: unknown): ValidationResult {
    if (keyword === undefined || keyword === null) {
        return { valid: true, sanitized: '' };
    }

    if (typeof keyword !== 'string') {
        return { valid: false, error: '关键词必须是字符串' };
    }

    if (keyword.length > 100) {
        return { valid: false, error: '关键词长度超过限制' };
    }

    const sanitized = keyword
        .replace(/[<>"'\\]/g, '')
        .trim()
        .substring(0, 100);

    return { valid: true, sanitized };
}

/**
 * 分页参数验证结果
 */
interface PaginationValidationResult extends ValidationResult {
    sanitized?: {
        page: number;
        pageSize: number;
    };
}

/**
 * 分页参数验证器
 * @param page - 页码
 * @param pageSize - 每页数量
 * @returns 验证结果
 */
export function validatePagination(page: unknown, pageSize: unknown): PaginationValidationResult {
    const defaultPage = 1;
    const defaultPageSize = 20;
    const maxPageSize = 100;

    let sanitizedPage = defaultPage;
    let sanitizedPageSize = defaultPageSize;

    if (page !== undefined) {
        const numPage = Number(page);
        if (!Number.isInteger(numPage) || numPage < 1) {
            return { valid: false, error: '页码必须是正整数' };
        }
        sanitizedPage = Math.min(numPage, 10000);
    }

    if (pageSize !== undefined) {
        const numPageSize = Number(pageSize);
        if (!Number.isInteger(numPageSize) || numPageSize < 1) {
            return { valid: false, error: '每页数量必须是正整数' };
        }
        sanitizedPageSize = Math.min(numPageSize, maxPageSize);
    }

    return {
        valid: true,
        sanitized: {
            page: sanitizedPage,
            pageSize: sanitizedPageSize
        }
    };
}

/**
 * 站点数据接口
 */
interface SiteData {
    name?: string;
    url?: string;
    type?: 'json' | 'xml';
    blockedRoutes?: string;
}

/**
 * 站点数据验证器
 * @param siteData - 站点数据
 * @returns 验证结果
 */
export function validateSiteData(siteData: unknown): ValidationResult {
    if (!siteData || typeof siteData !== 'object') {
        return { valid: false, error: '无效的站点数据' };
    }

    const data = siteData as SiteData;
    const errors: string[] = [];
    const sanitized: SiteData = {};

    if (!data.name || typeof data.name !== 'string') {
        errors.push('站点名称不能为空');
    } else if (data.name.length > 100) {
        errors.push('站点名称长度超过限制');
    } else {
        sanitized.name = data.name.trim().substring(0, 100);
    }

    if (!data.url || typeof data.url !== 'string') {
        errors.push('站点URL不能为空');
    } else {
        if (!isValidUrl(data.url)) {
            errors.push('站点URL格式无效');
        } else {
            sanitized.url = data.url.trim();
        }
    }

    if (data.type !== undefined) {
        const validTypes: Array<'json' | 'xml'> = ['json', 'xml'];
        if (!validTypes.includes(data.type)) {
            errors.push(`站点类型必须是: ${validTypes.join(', ')}`);
        } else {
            sanitized.type = data.type;
        }
    } else {
        sanitized.type = 'json';
    }

    if (data.blockedRoutes !== undefined) {
        if (typeof data.blockedRoutes !== 'string') {
            errors.push('屏蔽线路必须是字符串');
        } else if (data.blockedRoutes.length > 1000) {
            errors.push('屏蔽线路配置长度超过限制');
        } else {
            sanitized.blockedRoutes = data.blockedRoutes.substring(0, 1000);
        }
    }

    if (errors.length > 0) {
        return { valid: false, error: errors.join('; ') };
    }

    return { valid: true, sanitized };
}

/**
 * 通用输入清理器
 * 移除潜在的XSS攻击向量
 * @param input - 输入字符串
 * @returns 清理后的字符串
 */
export function sanitizeInput(input: unknown): string {
    if (typeof input !== 'string') return '';

    return input
        .replace(/[<>]/g, '')
        .replace(/javascript:/gi, '')
        .replace(/on\w+=/gi, '')
        .trim();
}

/**
 * IPC处理函数类型
 */
type IPCHandler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>;

/**
 * 创建安全的IPC处理器包装函数
 * @param handler - 原始处理函数
 * @param validator - 验证函数
 * @returns 包装后的安全处理函数
 */
export function createSecureHandler<T>(
    handler: IPCHandler,
    validator: (...args: unknown[]) => ValidationResult
): IPCHandler {
    return async (event, ...args) => {
        try {
            const validation = validator(...args);

            if (!validation.valid) {
                console.error('[SECURITY] IPC验证失败:', validation.error);
                return {
                    success: false,
                    error: validation.error || '参数验证失败'
                };
            }

            const sanitizedArgs = validation.sanitized !== undefined
                ? [validation.sanitized]
                : args;

            return await handler(event, ...sanitizedArgs);
        } catch (error) {
            console.error('[SECURITY] IPC处理错误:', error);
            return {
                success: false,
                error: '处理请求时发生错误'
            };
        }
    };
}
