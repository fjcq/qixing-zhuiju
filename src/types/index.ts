/**
 * 七星追剧 - 核心类型定义
 * 定义项目中使用的所有核心接口和类型
 */

/**
 * 视频站点配置
 */
export interface Site {
    /** 站点唯一标识 */
    id: string;
    /** 站点名称 */
    name: string;
    /** 站点API地址 */
    url: string;
    /** API类型 */
    type: 'json' | 'xml';
    /** 是否激活 */
    isActive: boolean;
    /** 屏蔽的线路列表 */
    blockedRoutes?: string;
    /** 创建时间 */
    createdAt?: number;
    /** 更新时间 */
    updatedAt?: number;
}

/**
 * 视频基本信息
 */
export interface Video {
    /** 视频ID */
    vod_id: string;
    /** 视频名称 */
    vod_name: string;
    /** 视频海报 */
    vod_pic?: string;
    /** 视频备注/更新信息 */
    vod_remarks?: string;
    /** 视频类型 */
    type_name?: string;
    /** 视频年份 */
    vod_year?: string;
    /** 视频地区 */
    vod_area?: string;
    /** 视频导演 */
    vod_director?: string;
    /** 视频演员 */
    vod_actor?: string;
    /** 视频简介 */
    vod_blurb?: string;
    /** 视频内容 */
    vod_content?: string;
    /** 播放线路 */
    vod_play_url?: string;
    /** 播放来源 */
    vod_play_from?: string;
}

/**
 * 视频详情
 */
export interface VideoDetail extends Video {
    /** 视频评分 */
    vod_score?: string;
    /** 视频语言 */
    vod_lang?: string;
    /** 视频时长 */
    vod_duration?: string;
    /** 豆瓣ID */
    douban_id?: string;
    /** 豆瓣评分 */
    douban_score?: string;
    /** IMDb ID */
    imdb_id?: string;
    /** IMDb评分 */
    imdb_score?: string;
    /** 创建时间 */
    vod_time?: string;
    /** 更新时间 */
    vod_time_add?: string;
    /** 总集数 */
    vod_total?: number;
    /** 周几更新 */
    vod_weekday?: string;
    /** 当前播放集数 */
    currentPlayUrl?: string;
}

/**
 * 播放历史记录
 */
export interface PlayHistory {
    /** 视频ID */
    vod_id: string;
    /** 视频名称 */
    vod_name: string;
    /** 视频海报 */
    vod_pic?: string;
    /** 视频类型 */
    type_name?: string;
    /** 当前集数索引 */
    current_episode: number;
    /** 集数名称 */
    episode_name: string;
    /** 观看时间 */
    watch_time: number;
    /** 站点名称 */
    site_name: string;
    /** 播放进度百分比 */
    progress?: number;
    /** 播放时长（秒） */
    play_duration?: number;
    /** 视频URL */
    video_url?: string;
}

/**
 * 收藏记录
 */
export interface Favorite {
    /** 视频ID */
    vod_id: string;
    /** 视频名称 */
    vod_name: string;
    /** 视频海报 */
    vod_pic?: string;
    /** 视频类型 */
    type_name?: string;
    /** 收藏时间 */
    favorite_time: number;
    /** 站点名称 */
    site_name: string;
}

/**
 * 播放线路
 */
export interface PlayRoute {
    /** 线路名称 */
    name: string;
    /** 线路别名 */
    alias?: string;
    /** 播放地址列表 */
    urls: PlayUrl[];
}

/**
 * 播放地址
 */
export interface PlayUrl {
    /** 集数名称 */
    name: string;
    /** 播放地址 */
    url: string;
}

/**
 * API搜索响应
 */
export interface SearchResponse {
    /** 视频列表 */
    list: Video[];
    /** 总页数 */
    pagecount: number;
    /** 当前页 */
    page: number;
    /** 总记录数 */
    total?: number;
    /** 是否有更多 */
    hasMore?: boolean;
}

/**
 * DLNA设备信息
 */
export interface DLNADevice {
    /** 设备ID */
    id: string;
    /** 设备名称 */
    name: string;
    /** 设备地址 */
    host: string;
    /** 设备端口 */
    port: number;
    /** 设备型号 */
    model?: string;
    /** 制造商 */
    manufacturer?: string;
    /** 控制地址 */
    controlURL?: string;
    /** 发现时间 */
    discoveredAt?: number;
}

/**
 * DLNA投屏状态
 */
export interface DLNACastState {
    /** 是否正在投屏 */
    isCasting: boolean;
    /** 当前设备ID */
    deviceId?: string;
    /** 当前播放URL */
    currentUrl?: string;
    /** 播放状态 */
    playState?: 'playing' | 'paused' | 'stopped';
    /** 当前播放位置（秒） */
    position?: number;
    /** 总时长（秒） */
    duration?: number;
}

/**
 * 应用更新信息
 */
export interface UpdateInfo {
    /** 是否有更新 */
    hasUpdate: boolean;
    /** 最新版本 */
    latestVersion?: string;
    /** 当前版本 */
    currentVersion: string;
    /** 更新说明 */
    releaseNotes?: string;
    /** 下载地址 */
    downloadUrl?: string;
    /** 发布日期 */
    releaseDate?: string;
}

/**
 * 弹幕配置
 */
export interface DanmakuConfig {
    /** 是否启用弹幕 */
    enabled: boolean;
    /** 弹幕透明度 */
    opacity: number;
    /** 弹幕速度 */
    speed: number;
    /** 弹幕字体大小 */
    fontSize: number;
    /** 显示区域 */
    displayArea: number;
    /** 弹幕数量限制 */
    maxCount: number;
}

/**
 * 弹幕项
 */
export interface DanmakuItem {
    /** 弹幕内容 */
    content: string;
    /** 出现时间（秒） */
    time: number;
    /** 弹幕类型 */
    type: 'scroll' | 'top' | 'bottom';
    /** 弹幕颜色 */
    color: string;
    /** 弹幕字体大小 */
    fontSize?: number;
}

/**
 * 窗口状态
 */
export interface WindowState {
    /** 是否最大化 */
    isMaximized: boolean;
    /** 是否全屏 */
    isFullScreen: boolean;
    /** 窗口位置 */
    bounds?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
}

/**
 * 应用配置
 */
export interface AppConfig {
    /** 主题 */
    theme: 'light' | 'dark' | 'system';
    /** 语言 */
    language: 'zh-CN' | 'en-US';
    /** 自动检查更新 */
    autoCheckUpdate: boolean;
    /** 记住窗口位置 */
    rememberWindowPosition: boolean;
    /** 硬件加速 */
    hardwareAcceleration: boolean;
    /** 弹幕配置 */
    danmaku: DanmakuConfig;
}

/**
 * IPC响应包装
 */
export interface IPCResponse<T = unknown> {
    /** 是否成功 */
    success: boolean;
    /** 响应数据 */
    data?: T;
    /** 错误信息 */
    error?: string;
    /** 错误类型 */
    errorType?: string;
}

/**
 * 错误类型枚举
 */
export type ErrorType =
    | 'NETWORK_ERROR'
    | 'VALIDATION_ERROR'
    | 'PLAYER_ERROR'
    | 'IPC_ERROR'
    | 'DLNA_ERROR'
    | 'STORAGE_ERROR'
    | 'UNKNOWN_ERROR';

/**
 * 错误日志条目
 */
export interface ErrorLogEntry {
    /** 时间戳 */
    timestamp: string;
    /** 错误类型 */
    type: ErrorType;
    /** 错误消息 */
    message: string;
    /** 错误堆栈 */
    stack?: string;
    /** 上下文信息 */
    context?: Record<string, unknown>;
}
