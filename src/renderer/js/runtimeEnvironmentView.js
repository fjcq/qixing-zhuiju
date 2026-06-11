/**
 * Node.js 运行环境状态视图（渲染端）
 * 负责把 RuntimeEnvironmentService 返回的状态对象渲染为「关于」页里的卡片
 *
 * 关键设计：
 * - 不修改全局状态：只读 RuntimeEnvironmentService，不写 localStorage
 * - HTML 拼接全部走 _escapeHtml 防 XSS（与项目其他视图一致）
 * - 提供 load() / refresh() / openPortableDir() 三个方法
 * - 自动在「关于」页首次显示时加载状态（用户感知不到检测耗时）
 *
 * 使用示例：
 *   const view = new RuntimeEnvironmentView();
 *   view.bind();   // 挂载到 DOM + 绑定事件
 *   // 用户切换到「关于」页时调用
 *   await view.load();
 */
(function() {
    'use strict';

    /**
     * HTML 转义工具（与 components.js / fileListRenderer.js 保持一致）
     * 实际能安全用于：属性值（`"..."` 包围）和元素文本内容
     * 文本内容只需转义 & < > 三字符；多转义 " ' 是 over-escape 但安全
     */
    function escapeHtml(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    class RuntimeEnvironmentView {
        /**
         * 构造函数
         */
        constructor() {
            this.runtimeEnv = null;
            this._cardEl = null;
            this._refreshBtnEl = null;
            this._openDirBtnEl = null;
            this._bound = false;
        }

        /**
         * 初始化服务实例（延迟到 bind 时才创建，确保 window.electron 已就绪）
         */
        _ensureService() {
            if (!this.runtimeEnv && window.RuntimeEnvironmentService) {
                this.runtimeEnv = new window.RuntimeEnvironmentService();
            }
        }

        /**
         * 挂载到 DOM + 绑定事件
         * 多次调用安全：只在第一次真正执行
         */
        bind() {
            if (this._bound) return;
            this._ensureService();
            this._cardEl = document.getElementById('runtime-env-card');
            this._refreshBtnEl = document.getElementById('runtime-env-refresh-btn');
            this._openDirBtnEl = document.getElementById('runtime-env-open-dir-btn');
            if (this._refreshBtnEl) {
                this._refreshBtnEl.addEventListener('click', () => this.refresh());
            }
            if (this._openDirBtnEl) {
                this._openDirBtnEl.addEventListener('click', () => this.openPortableDir());
            }
            this._bound = true;
        }

        /**
         * 加载并渲染状态（首次进入「关于」页时调用）
         * 失败时也渲染错误状态卡片，避免一直显示「检测中…」
         */
        async load() {
            this.bind();
            if (!this._cardEl) return;
            this._renderLoading();
            if (!this.runtimeEnv) {
                this._renderError('运行环境服务未初始化');
                return;
            }
            try {
                const status = await this.runtimeEnv.getStatus();
                this._render(status);
            } catch (err) {
                this._renderError(err && err.message || String(err));
            }
        }

        /**
         * 强制刷新（点「刷新」按钮）
         */
        async refresh() {
            this.bind();
            if (!this._cardEl) return;
            if (!this.runtimeEnv) {
                this._renderError('运行环境服务未初始化');
                return;
            }
            this._renderLoading();
            try {
                const status = await this.runtimeEnv.refresh();
                this._render(status);
            } catch (err) {
                this._renderError(err && err.message || String(err));
            }
        }

        /**
         * 打开便携版 Node.js 安装目录
         */
        async openPortableDir() {
            this.bind();
            if (!this.runtimeEnv) return;
            await this.runtimeEnv.openPortableDir();
        }

        /**
         * 下载便携版 Node.js
         * 用户点击"下载便携版"按钮时调用
         * 关键：进度通过 onProgress 实时更新；下载完成后自动刷新状态
         */
        async downloadPortable() {
            this.bind();
            if (!this.runtimeEnv) return;
            if (this._downloadBtnEl) {
                this._downloadBtnEl.disabled = true;
            }
            this._showDownloadProgress('准备下载...', 0);
            try {
                const result = await this.runtimeEnv.downloadPortable({
                    onProgress: payload => {
                        this._showDownloadProgress(payload.message || '处理中...', payload.percent || 0);
                    }
                });
                if (result && result.success) {
                    this._showDownloadProgress('下载完成，正在刷新状态...', 100);
                    // 刷新状态
                    await this.refresh();
                } else {
                    this._showDownloadProgress(`下载失败: ${(result && result.error) || '未知错误'}`, 0, true);
                }
            } catch (err) {
                this._showDownloadProgress(`下载异常: ${err && err.message || String(err)}`, 0, true);
            } finally {
                if (this._downloadBtnEl) {
                    this._downloadBtnEl.disabled = false;
                }
            }
        }

        /**
         * 显示下载进度
         */
        _showDownloadProgress(message, percent, isError = false) {
            if (!this._downloadProgressEl) {
                // 首次调用时创建进度条
                this._downloadProgressEl = document.createElement('div');
                this._downloadProgressEl.className = 'runtime-env-download-progress';
                this._downloadProgressEl.style.display = 'none';
                const actionsEl = document.querySelector('.runtime-env-actions');
                if (actionsEl && actionsEl.parentNode) {
                    actionsEl.parentNode.insertBefore(this._downloadProgressEl, actionsEl.nextSibling);
                }
            }
            const el = this._downloadProgressEl;
            el.style.display = 'block';
            el.className = `runtime-env-download-progress${isError ? ' runtime-env-download-error' : ''}`;
            const safePct = Math.max(0, Math.min(100, Number(percent) || 0));
            el.innerHTML = `<div class="runtime-env-download-message">${escapeHtml(message)}</div>` +
                '<div class="runtime-env-progress-track">' +
                `<div class="runtime-env-progress-bar" style="width: ${safePct}%"></div>` +
                '</div>' +
                `<div class="runtime-env-download-percent">${safePct}%</div>`;
        }

        /**
         * 隐藏下载进度条
         */
        _hideDownloadProgress() {
            if (this._downloadProgressEl) {
                this._downloadProgressEl.style.display = 'none';
            }
        }

        /**
         * 渲染加载中状态
         */
        _renderLoading() {
            if (!this._cardEl) return;
            this._cardEl.innerHTML = '<div class="runtime-env-loading">检测中…</div>';
        }

        /**
         * 渲染错误状态
         */
        _renderError(message) {
            if (!this._cardEl) return;
            this._cardEl.innerHTML = `<div class="runtime-env-error">检测失败：${escapeHtml(message)}</div>`;
        }

        /**
         * 获取来源对应的图标（emoji）
         * 关键：图标映射放在视图层,不依赖 service 层 API
         *       即使 service.getSourceIcon 被移除/重命名,view 仍能正常显示
         * @param {string} source - 来源标识（electron-bundled/portable/system/none）
         * @returns {string} emoji 字符
         */
        _getSourceIcon(source) {
            switch (source) {
                case 'electron-bundled': return '⚡';
                case 'portable': return '📦';
                case 'system': return '🖥️';
                case 'none': return '❓';
                default: return '❓';
            }
        }

        /**
         * 渲染状态对象为 HTML
         * @param {object} status
         */
        _render(status) {
            if (!this._cardEl) return;
            if (!status) {
                this._renderError('未返回状态');
                return;
            }

            // 来源图标 + 标签
            // 关键：图标映射放在视图层（私有方法）,不依赖 service 层的 getSourceIcon
            //       1) 关注点分离：UI 表现由 view 层负责
            //       2) 防御性编程：service 层方法被移除/重命名时 view 仍能工作
            const icon = this._getSourceIcon(status.source);
            const label = escapeHtml(status.sourceLabel || '未找到');

            // 状态颜色
            const statusClass = status.ok ? 'runtime-env-ok' : 'runtime-env-warn';
            const statusText = status.ok ? '✓ 就绪' : '⚠ 异常';

            // 详细信息行
            const detailRows = [];
            if (status.version) {
                detailRows.push(this._renderRow('版本', escapeHtml(status.version)));
            }
            if (status.description) {
                detailRows.push(this._renderRow('说明', escapeHtml(status.description)));
            }
            if (status.magnetRuntimeOk) {
                detailRows.push(this._renderRow('磁力链依赖', '<span class="runtime-env-mini-ok">✓ 完整</span>'));
            } else if (status.magnetRuntimePath) {
                detailRows.push(this._renderRow('磁力链依赖', '<span class="runtime-env-mini-warn">⚠ 缺失（请重新安装应用）</span>'));
            }
            if (status.portableAvailable) {
                detailRows.push(this._renderRow('便携版', '<span class="runtime-env-mini-ok">已就绪</span>'));
            }

            // 问题列表
            let issuesHtml = '';
            if (status.issues && status.issues.length > 0) {
                const issueItems = status.issues.map(issue => `<li>${escapeHtml(issue)}</li>`).join('');
                issuesHtml = `<div class="runtime-env-issues"><strong>提示：</strong><ul>${issueItems}</ul></div>`;
            }

            // 主状态卡片
            const html = [
                `<div class="runtime-env-status ${statusClass}">`,
                `  <div class="runtime-env-status-icon">${icon}</div>`,
                '  <div class="runtime-env-status-text">',
                `    <div class="runtime-env-source">${label}</div>`,
                `    <div class="runtime-env-state">${statusText}</div>`,
                '  </div>',
                '</div>',
                '<div class="runtime-env-details">',
                detailRows.join(''),
                '</div>',
                issuesHtml
            ].join('');

            this._cardEl.innerHTML = html;

            // 渲染完成后，根据状态决定是否显示"下载便携版"按钮
            // 关键：仅在没有任何可用 Node.js 时才显示（避免 UI 噪声）
            this._updateDownloadButtonVisibility(status);
        }

        /**
         * 根据状态决定是否显示"下载便携版"按钮
         * 关键：仅在 source=none 或 electron-bundled 不可用 + 无便携版时显示
         */
        _updateDownloadButtonVisibility(status) {
            if (!this._downloadBtnEl) {
                this._downloadBtnEl = document.getElementById('runtime-env-download-btn');
            }
            if (!this._downloadBtnEl) {
                // 首次创建按钮
                this._downloadBtnEl = document.createElement('button');
                this._downloadBtnEl.id = 'runtime-env-download-btn';
                this._downloadBtnEl.className = 'btn-primary';
                this._downloadBtnEl.textContent = '下载便携版 Node.js';
                this._downloadBtnEl.title = '自动从国内镜像下载约 30MB 的便携版 Node.js';
                this._downloadBtnEl.addEventListener('click', () => this.downloadPortable());
                const actionsEl = document.querySelector('.runtime-env-actions');
                if (actionsEl) {
                    actionsEl.appendChild(this._downloadBtnEl);
                }
            }
            // 显示条件：无任何可用 Node.js 时
            const needsDownload = !status.ok ||
                (status.source === 'none') ||
                (!status.electronBundled && !status.portableAvailable);
            this._downloadBtnEl.style.display = needsDownload ? '' : 'none';
        }

        /**
         * 渲染单行信息
         */
        _renderRow(label, valueHtml) {
            return '<div class="runtime-env-row">' +
                `<span class="runtime-env-label">${escapeHtml(label)}</span>` +
                `<span class="runtime-env-value">${valueHtml}</span>` +
                '</div>';
        }
    }

    // 暴露到 window（渲染端）和 module.exports（测试）
    if (typeof window !== 'undefined') {
        window.RuntimeEnvironmentView = RuntimeEnvironmentView;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = RuntimeEnvironmentView;
    }
})();
