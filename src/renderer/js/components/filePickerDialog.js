/**
 * 文件选择对话框组件
 * 用于添加磁力链时让用户勾选要下载的文件
 *
 * 使用方式：
 *   const dialog = new FilePickerDialog();
 *   const result = await dialog.show({ files, taskName });
 *   if (result.confirmed) {
 *       const selectedFiles = result.selectedFiles; // [{name, size, ext}]
 *   }
 *
 * 设计原则：
 *   - 默认勾选所有视频文件（mp4/mkv/webm/avi/mov/flv/wmv/ts/mpeg/mpg）
 *   - 显示每个文件大小 + 已选总大小
 *   - 支持全选/全不选/反选（仅作用于当前搜索筛选后的可见文件）
 *   - 支持按文件名实时搜索筛选
 *   - 模态对话框，点击遮罩层不关闭（防止误操作丢失选择）
 *   - ESC 键关闭（视为取消）
 *   - 关闭按钮/取消按钮关闭（视为取消）
 *   - 确认按钮返回选中的文件列表
 *
 * 模块包在 IIFE 内，避免全局污染
 * 同时暴露到 window 全局（Electron renderer）和 module.exports（Jest 测试）
 */
(function () {
    'use strict';

    /**
     * 默认勾选的视频文件扩展名集合
     */
    const VIDEO_EXTS = new Set([
        'mp4', 'mkv', 'webm', 'avi', 'mov',
        'flv', 'wmv', 'ts', 'mpeg', 'mpg'
    ]);

    /**
     * 格式化文件大小为人类可读字符串
     * @param {number} bytes - 字节数
     * @returns {string} 形如 "1.5 MB"
     */
    function formatSize(bytes) {
        if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let n = bytes;
        let i = 0;
        while (n >= 1024 && i < units.length - 1) {
            n /= 1024;
            i++;
        }
        const digits = (n >= 10 || i === 0) ? 0 : 1;
        return `${n.toFixed(digits)} ${units[i]}`;
    }

    /**
     * 从文件名提取小写扩展名
     * @param {string} name - 文件名
     * @returns {string} 扩展名（无点前缀），无扩展名时返回空字符串
     */
    function getExt(name) {
        if (!name || typeof name !== 'string') return '';
        const idx = name.lastIndexOf('.');
        if (idx < 0 || idx === name.length - 1) return '';
        return name.slice(idx + 1).toLowerCase();
    }

    /**
     * HTML 转义（防 XSS，磁力链文件名可能含特殊字符）
     * @param {string} str - 原始字符串
     * @returns {string} 转义后的字符串
     */
    function escapeHtml(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * 文件选择对话框组件
     */
    class FilePickerDialog {
        /**
         * 构造函数
         */
        constructor() {
            this._overlay = null;
            this._resolve = null;
            this._onKeydown = null;
            this._fileItems = null;
            this._listEl = null;
            this._emptyEl = null;
            this._toolbar = null;
        }

        /**
         * 显示文件选择对话框
         * @param {object} options - 选项
         * @param {string} [options.taskName='选择下载文件'] - 任务名（用于标题显示）
         * @param {Array<{name: string, size: number, ext?: string}>} [options.files=[]] - 文件列表
         * @returns {Promise<{confirmed: boolean, selectedFiles?: Array}>}
         */
        show(options = {}) {
            const { taskName = '选择下载文件', files = [] } = options;
            return new Promise(resolve => {
                this._resolve = resolve;
                this._overlay = this._buildDom(taskName, files);
                document.body.appendChild(this._overlay);
                this._bindEvents();
                this._updateStats();
                this._onKeydown = e => {
                    if (e.key === 'Escape') {
                        this._close(false);
                    }
                };
                document.addEventListener('keydown', this._onKeydown);
            });
        }

        /**
         * 构建对话框 DOM 结构
         * @param {string} taskName - 任务名
         * @param {Array} files - 文件列表
         * @returns {HTMLElement} overlay 根元素
         */
        _buildDom(taskName, files) {
            const overlay = document.createElement('div');
            overlay.className = 'file-picker';

            const dialog = document.createElement('div');
            dialog.className = 'file-picker__dialog';

            // 头部（标题 + 关闭按钮）
            const header = document.createElement('div');
            header.className = 'file-picker__header';
            header.innerHTML = `
                <h3 class="file-picker__title">${escapeHtml(taskName)}</h3>
                <button type="button" class="file-picker__close" title="关闭" aria-label="关闭">×</button>
            `;

            // 工具栏（搜索框 + 全选 + 反选 + 统计）
            const toolbar = document.createElement('div');
            toolbar.className = 'file-picker__toolbar';
            toolbar.innerHTML = `
                <input type="text" class="file-picker__search" placeholder="搜索文件名…" />
                <label class="file-picker__select-all">
                    <input type="checkbox" /> 全选
                </label>
                <button type="button" class="file-picker__invert">反选</button>
                <span class="file-picker__stats"></span>
            `;

            // 文件列表
            const listEl = document.createElement('div');
            listEl.className = 'file-picker__list';

            const fileItems = files.map((f, idx) => {
                const ext = f.ext || getExt(f.name);
                const isVideo = VIDEO_EXTS.has(ext);
                const defaultChecked = isVideo;
                const itemEl = document.createElement('label');
                let cls = 'file-picker__file';
                if (isVideo) cls += ' file-picker__file--video';
                if (defaultChecked) cls += ' file-picker__file--selected';
                itemEl.className = cls;
                itemEl.dataset.idx = String(idx);
                itemEl.innerHTML = `
                    <input type="checkbox" class="file-picker__file-checkbox"${defaultChecked ? ' checked' : ''} />
                    <span class="file-picker__file-icon">${isVideo ? '🎬' : '📄'}</span>
                    <span class="file-picker__file-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
                    <span class="file-picker__file-size">${formatSize(f.size)}</span>
                `;
                listEl.appendChild(itemEl);
                return {
                    el: itemEl,
                    file: f,
                    checked: defaultChecked,
                    visible: true
                };
            });

            // 空状态提示（搜索无结果时显示）
            const emptyEl = document.createElement('div');
            emptyEl.className = 'file-picker__empty';
            emptyEl.textContent = '没有匹配的文件';
            emptyEl.style.display = 'none';
            listEl.appendChild(emptyEl);

            // 底部按钮
            const footer = document.createElement('div');
            footer.className = 'file-picker__footer';
            footer.innerHTML = `
                <button type="button" class="btn-secondary file-picker__cancel">取消</button>
                <button type="button" class="btn-primary file-picker__confirm">开始下载</button>
            `;

            dialog.appendChild(header);
            dialog.appendChild(toolbar);
            dialog.appendChild(listEl);
            dialog.appendChild(footer);
            overlay.appendChild(dialog);

            // 缓存 DOM 引用，供事件处理使用
            this._fileItems = fileItems;
            this._listEl = listEl;
            this._emptyEl = emptyEl;
            this._toolbar = toolbar;

            return overlay;
        }

        /**
         * 绑定所有事件（复选框、全选、反选、搜索、按钮）
         */
        _bindEvents() {
            // 关闭/取消/确认按钮
            this._overlay.querySelector('.file-picker__close')
                .addEventListener('click', () => this._close(false));
            this._overlay.querySelector('.file-picker__cancel')
                .addEventListener('click', () => this._close(false));
            this._overlay.querySelector('.file-picker__confirm')
                .addEventListener('click', () => this._close(true));

            // 点击遮罩层：故意不关闭，防止误操作丢失选择
            this._overlay.addEventListener('click', e => {
                if (e.target === this._overlay) {
                    // 保留用户选择，不响应遮罩点击
                }
            });

            // 单个文件复选框
            this._fileItems.forEach(it => {
                const cb = it.el.querySelector('.file-picker__file-checkbox');
                cb.addEventListener('change', () => {
                    it.checked = cb.checked;
                    it.el.classList.toggle('file-picker__file--selected', it.checked);
                    this._updateStats();
                });
            });

            // 全选/全不选（仅作用于当前可见文件）
            const selectAllCb = this._toolbar.querySelector('.file-picker__select-all input');
            selectAllCb.addEventListener('change', () => {
                this._fileItems.forEach(it => {
                    if (!it.visible) return;
                    it.checked = selectAllCb.checked;
                    const cb = it.el.querySelector('.file-picker__file-checkbox');
                    cb.checked = selectAllCb.checked;
                    it.el.classList.toggle('file-picker__file--selected', it.checked);
                });
                this._updateStats();
            });

            // 反选（仅作用于当前可见文件）
            this._toolbar.querySelector('.file-picker__invert')
                .addEventListener('click', () => {
                    this._fileItems.forEach(it => {
                        if (!it.visible) return;
                        it.checked = !it.checked;
                        const cb = it.el.querySelector('.file-picker__file-checkbox');
                        cb.checked = it.checked;
                        it.el.classList.toggle('file-picker__file--selected', it.checked);
                    });
                    this._updateStats();
                });

            // 搜索框实时筛选
            const searchInput = this._toolbar.querySelector('.file-picker__search');
            searchInput.addEventListener('input', () => {
                this._applyFilter(searchInput.value);
                this._updateStats();
            });
        }

        /**
         * 应用搜索筛选：根据关键词显示/隐藏文件项
         * @param {string} query - 搜索关键词（不区分大小写）
         */
        _applyFilter(query) {
            const q = (query || '').trim().toLowerCase();
            let visibleCount = 0;
            this._fileItems.forEach(it => {
                const name = (it.file.name || '').toLowerCase();
                const match = !q || name.includes(q);
                it.visible = match;
                it.el.classList.toggle('file-picker__file--hidden', !match);
                it.el.style.display = match ? '' : 'none';
                if (match) visibleCount++;
            });
            this._emptyEl.style.display = visibleCount === 0 ? '' : 'none';
        }

        /**
         * 更新底部统计文本与全选复选框状态
         */
        _updateStats() {
            const statsEl = this._toolbar.querySelector('.file-picker__stats');
            const selectAllCb = this._toolbar.querySelector('.file-picker__select-all input');

            // 已选数量与总大小（统计所有文件，不仅是可见）
            const selected = this._fileItems.filter(it => it.checked);
            const totalSize = selected.reduce((sum, it) => sum + (it.file.size || 0), 0);
            statsEl.textContent = `已选 ${selected.length} / ${this._fileItems.length} 个，共 ${formatSize(totalSize)}`;

            // 全选复选框状态：基于当前可见文件
            const visibleItems = this._fileItems.filter(it => it.visible);
            if (visibleItems.length === 0) {
                selectAllCb.checked = false;
                selectAllCb.indeterminate = false;
                return;
            }
            const selectedVisibleCount = visibleItems.filter(it => it.checked).length;
            selectAllCb.checked = selectedVisibleCount === visibleItems.length;
            selectAllCb.indeterminate = (
                selectedVisibleCount > 0 &&
                selectedVisibleCount < visibleItems.length
            );
        }

        /**
         * 关闭对话框并解析 Promise
         * @param {boolean} confirmed - 用户是否点击确认
         */
        _close(confirmed) {
            if (!this._overlay) return;
            document.body.removeChild(this._overlay);
            if (this._onKeydown) {
                document.removeEventListener('keydown', this._onKeydown);
            }
            const result = { confirmed };
            if (confirmed) {
                result.selectedFiles = this._fileItems
                    .filter(it => it.checked)
                    .map(it => it.file);
            }
            const resolve = this._resolve;
            // 清空引用，避免重复关闭
            this._overlay = null;
            this._resolve = null;
            this._onKeydown = null;
            this._fileItems = null;
            this._listEl = null;
            this._emptyEl = null;
            this._toolbar = null;
            if (resolve) resolve(result);
        }
    }

    // 暴露到 window 全局（兼容 Electron renderer）
    if (typeof window !== 'undefined') {
        window.FilePickerDialog = FilePickerDialog;
    }
    // 兼容 module.exports（Jest 测试）
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { FilePickerDialog, VIDEO_EXTS };
    }
})();
