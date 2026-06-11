/**
 * 磁力下载进度事件 → 阶段对象映射器
 *
 * 输入: 子进程 magnetHandler.mjs 发送的 progress 消息
 *       (主进程转发为 magnet-download-progress IPC 事件)
 * 输出: { stageId, stageText, progress, variant }
 *       - stageId: 'P1' | 'P2' | 'P2.1' | 'P2.2' | 'P3' | 'P4' | 'P5' | 'P6'
 *       - stageText: 显示给用户的二级阶段文本
 *       - progress: 主进度条百分比(0-100)
 *       - variant: 'info' | 'warning' | 'success' | 'error'
 *
 * 关键: 进度数字必须经 isFinite 钳制,挡掉 NaN / 负数 / 越界值,
 *       防止 style="width: NaN%" 注入或显示异常
 */

/**
 * 钳制数值到 [min, max] 范围,过滤 NaN/Infinity
 * @param {number} value 待处理数值
 * @param {number} min 最小值
 * @param {number} max 最大值
 * @param {number} fallback 兜底值
 * @returns {number} 安全数值
 */
function clampPercent(value, min, max, fallback) {
    if (min === undefined) min = 0;
    if (max === undefined) max = 100;
    if (fallback === undefined) fallback = 0;
    if (value == null || !isFinite(value)) return fallback;
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

/**
 * 把子进程 download progress 消息映射到阶段对象
 * @param {Object} payload magnet-download-progress 事件 payload
 * @param {string} [payload.status] 子进程状态: connecting | downloading | completed | no-peers-warning | slow-warning | ...
 * @param {number} [payload.progress] 下载百分比 0-100
 * @param {number} [payload.numPeers] 当前 peer 数
 * @param {number} [payload.downloadSpeed] 下载速度(bytes/s)
 * @returns {{stageId: string, stageText: string, progress: number, variant: string}}
 */
function mapMagnetDownloadProgress(payload) {
    const status = (payload && payload.status) || 'unknown';
    const rawProgress = payload && payload.progress;
    const numPeers = (payload && payload.numPeers) || 0;
    const hasProgress = payload && payload.progress !== undefined;

    // 进度优先用子进程给的真实值,缺省时按阶段用兜底
    const progress = clampPercent(rawProgress, 0, 100, 0);

    switch (status) {
        case 'connecting':
            return {
                stageId: 'P2.1',
                stageText: '② 连接 DHT/P2P 网络',
                // 子进程显式报 0 时用 10 给用户视觉反馈,字段缺失则保持 0
                progress: !hasProgress ? 0 : (progress > 0 ? progress : 10),
                variant: 'info'
            };
        case 'downloading': {
            const peerText = numPeers > 0 ? ' (' + numPeers + ' peers)' : '';
            return {
                stageId: 'P2.2',
                stageText: '② 下载中: ' + progress + '%' + peerText,
                progress: progress,
                variant: 'info'
            };
        }
        case 'no-peers-warning':
            return {
                stageId: 'P2.1',
                stageText: '⚠ 暂未找到 peer,等待连接中...',
                progress: progress,
                variant: 'warning'
            };
        case 'slow-warning':
            return {
                stageId: 'P2.2',
                stageText: '⚠ 下载速度较慢,请耐心等待',
                progress: progress,
                variant: 'warning'
            };
        case 'completed':
            return {
                stageId: 'P6',
                stageText: '⑥ 播放就绪',
                progress: 100,
                variant: 'success'
            };
        default:
            // 未知状态:透传数据,兜底 info variant
            return {
                stageId: 'P2',
                stageText: '② ' + status + ' (' + progress + '%)',
                progress: progress,
                variant: 'info'
            };
    }
}

// 双暴露:Electron renderer 走 window 全局,Jest 走 module.exports
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { mapMagnetDownloadProgress, clampPercent };
} else {
    window.MagnetDownloadProgressMapper = { mapMagnetDownloadProgress, clampPercent };
}
