/**
 * Electron相关类型定义
 */

import { IpcMainInvokeEvent, IpcRendererEvent } from 'electron';

/**
 * IPC通道名称类型
 */
export type IPCChannel =
    | 'open-player'
    | 'open-external-url'
    | 'cast-to-dlna-device'
    | 'stop-dlna-casting'
    | 'pause-dlna-casting'
    | 'seek-dlna-casting'
    | 'set-volume-dlna-casting'
    | 'get-dlna-position-info'
    | 'discover-cast-devices'
    | 'get-version'
    | 'check-update'
    | 'install-update'
    | 'cancel-update'
    | 'get-app-path'
    | 'show-item-in-folder'
    | 'window:minimize'
    | 'window:maximize'
    | 'window:close';

/**
 * 窗口操作API
 */
export interface WindowAPI {
    /** 最小化窗口 */
    minimize: () => Promise<void>;
    /** 最大化/还原窗口 */
    maximize: () => Promise<void>;
    /** 关闭窗口 */
    close: () => Promise<void>;
    /** 切换全屏 */
    toggleFullscreen: () => Promise<void>;
    /** 获取窗口状态 */
    getState: () => Promise<WindowState>;
}

/**
 * DLNA操作API
 */
export interface DLNAAPI {
    /** 发现设备 */
    discoverDevices: () => Promise<DLNADevice[]>;
    /** 投屏到设备 */
    cast: (deviceId: string, mediaUrl: string, metadata?: Record<string, unknown>) => Promise<IPCResponse>;
    /** 停止投屏 */
    stop: (deviceId: string) => Promise<IPCResponse>;
    /** 暂停投屏 */
    pause: (deviceId: string) => Promise<IPCResponse>;
    /** 恢复播放 */
    resume: (deviceId: string) => Promise<IPCResponse>;
    /** 跳转位置 */
    seek: (deviceId: string, position: number) => Promise<IPCResponse>;
    /** 设置音量 */
    setVolume: (deviceId: string, volume: number) => Promise<IPCResponse>;
    /** 获取播放位置 */
    getPositionInfo: (deviceId: string) => Promise<IPCResponse<{ position: number; duration: number }>>;
}

/**
 * 更新操作API
 */
export interface UpdateAPI {
    /** 检查更新 */
    check: () => Promise<IPCResponse<UpdateInfo>>;
    /** 安装更新 */
    install: () => Promise<void>;
    /** 取消更新 */
    cancel: () => Promise<void>;
    /** 监听更新进度 */
    onProgress: (callback: (progress: number) => void) => () => void;
    /** 监听更新可用 */
    onUpdateAvailable: (callback: (info: UpdateInfo) => void) => () => void;
}

/**
 * 应用API
 */
export interface AppAPI {
    /** 获取版本 */
    getVersion: () => Promise<string>;
    /** 获取应用路径 */
    getPath: (name: 'home' | 'appData' | 'userData' | 'temp' | 'desktop') => Promise<string>;
    /** 在文件管理器中显示 */
    showItemInFolder: (path: string) => Promise<void>;
}

/**
 * Shell API
 */
export interface ShellAPI {
    /** 打开外部链接 */
    openExternal: (url: string) => Promise<IPCResponse>;
    /** 打开路径 */
    openPath: (path: string) => Promise<void>;
}

/**
 * Electron暴露给渲染进程的API
 */
export interface ElectronAPI {
    /** 窗口操作 */
    window: WindowAPI;
    /** DLNA操作 */
    dlna: DLNAAPI;
    /** 更新操作 */
    update: UpdateAPI;
    /** 应用操作 */
    app: AppAPI;
    /** Shell操作 */
    shell: ShellAPI;
    /** IPC调用 */
    invoke: <T = unknown>(channel: IPCChannel, ...args: unknown[]) => Promise<T>;
    /** 监听事件 */
    on: (channel: string, callback: (event: IpcRendererEvent, ...args: unknown[]) => void) => () => void;
    /** 发送消息 */
    send: (channel: string, ...args: unknown[]) => void;
}

/**
 * 扩展Window接口
 */
declare global {
    interface Window {
        electron: ElectronAPI;
        SearchController: typeof import('../renderer/js/controllers/SearchController').SearchController;
        HistoryController: typeof import('../renderer/js/controllers/HistoryController').HistoryController;
        SettingsController: typeof import('../renderer/js/controllers/SettingsController').SettingsController;
        Utils: typeof import('../renderer/js/utils/utils').Utils;
        ApiService: typeof import('../renderer/js/api').ApiService;
        StorageService: typeof import('../renderer/js/storage').StorageService;
        ComponentService: typeof import('../renderer/js/components').ComponentService;
        app: unknown;
    }
}

export {};
