/**
 * fileListRenderer
 * 渲染磁力链解析后的文件列表（卡片式）
 * 智能标记"主视频文件"：体积最大的 .mp4/.mkv/.webm/.avi/.flv
 *
 * VIDEO_EXTS 必须与 inputRecognizer.js 的 VIDEO_EXTS 保持一致（spec §4.2 列出的 6 个）
 *
 * 模块包在 IIFE 内，避免 const VIDEO_EXTS 与 inputRecognizer.js 冲突
 */

(function () {
    'use strict';

    const VIDEO_EXTS = ['mp4', 'mkv', 'webm', 'avi', 'flv', 'm3u8'];

    /**
     * 渲染文件列表到容器
     * @param {HTMLElement} container - 容器 DOM
     * @param {Array<{ name: string, length: number, [k: string]: any }>} files - 原始文件列表
     * @param {(file: object, index: number) => void} onPlayClick - 播放回调
     * @returns {{ videos: Array, recommendedIndex: number }}
     */
    function renderFileList(container, files, onPlayClick) {
        if (!container) {
            return { videos: [], recommendedIndex: -1 };
        }

        const videos = (files || []).filter(f => isVideoFile(f.name));

        if (videos.length === 0) {
            container.innerHTML = `
            <div class="play-url-empty">
                <p>该资源不含可播放视频文件</p>
            </div>
        `;
            return { videos: [], recommendedIndex: -1 };
        }

        const recommendedIndex = pickRecommendedIndex(videos);

        container.innerHTML = videos.map((f, i) => {
            const isRecommended = i === recommendedIndex;
            const sizeText = formatFileSize(f.length);
            return `
            <div class="play-url-file-card${isRecommended ? ' is-recommended' : ''}" data-index="${i}">
                <span class="play-url-file-icon">${isRecommended ? '⭐' : '🎬'}</span>
                <div class="play-url-file-info">
                    <div class="play-url-file-name">${escapeHtml(f.name)}</div>
                    <div class="play-url-file-meta">${sizeText}</div>
                </div>
                <button class="play-url-file-play" data-index="${i}">播放</button>
            </div>
        `;
        }).join('');

        // 绑定点击事件
        container.querySelectorAll('.play-url-file-play').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const idx = parseInt(btn.getAttribute('data-index'), 10);
                if (typeof onPlayClick === 'function') {
                    onPlayClick(videos[idx], idx);
                }
            });
        });

        return { videos, recommendedIndex };
    }

    /**
     * 判断是否为视频文件
     */
    function isVideoFile(name) {
        if (!name) return false;
        const ext = name.split('.').pop().toLowerCase();
        return VIDEO_EXTS.includes(ext);
    }

    /**
     * 选择推荐索引（体积最大的视频文件）
     */
    function pickRecommendedIndex(videos) {
        let maxIdx = 0;
        let maxSize = 0;
        videos.forEach((v, i) => {
            const size = v.length || 0;
            if (size > maxSize) {
                maxSize = size;
                maxIdx = i;
            }
        });
        return maxIdx;
    }

    /**
     * 格式化文件大小
     */
    function formatFileSize(bytes) {
        if (!bytes || bytes <= 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let size = bytes;
        let i = 0;
        while (size >= 1024 && i < units.length - 1) {
            size /= 1024;
            i++;
        }
        return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[i]}`;
    }

    /**
     * HTML 转义（防 XSS，磁力链文件名可能含特殊字符）
     */
    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { renderFileList, isVideoFile, formatFileSize, escapeHtml };
    }
    if (typeof window !== 'undefined') {
        window.fileListRenderer = { renderFileList, isVideoFile, formatFileSize, escapeHtml };
    }
})();
