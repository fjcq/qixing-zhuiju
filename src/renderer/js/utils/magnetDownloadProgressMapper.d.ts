/**
 * magnetDownloadProgressMapper 类型声明
 * 对应 src/renderer/js/utils/magnetDownloadProgressMapper.js
 */

/**
 * 子进程 magnet-download-progress 事件 payload
 */
export interface MagnetDownloadProgressPayload {
    /** 子进程状态 */
    status?: string;
    /** 下载百分比 0-100 */
    progress?: number;
    /** 当前 peer 数 */
    numPeers?: number;
    /** 下载速度(bytes/s) */
    downloadSpeed?: number;
}

/**
 * 阶段对象
 */
export interface MagnetDownloadStage {
    stageId: string;
    stageText: string;
    progress: number;
    variant: string;
}

/**
 * 把子进程 download progress 消息映射到阶段对象
 */
export declare function mapMagnetDownloadProgress(
    payload: MagnetDownloadProgressPayload
): MagnetDownloadStage;

/**
 * 钳制数值到 [min, max] 范围
 */
export declare function clampPercent(
    value: number,
    min?: number,
    max?: number,
    fallback?: number
): number;
