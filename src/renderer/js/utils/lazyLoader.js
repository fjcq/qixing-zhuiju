/**
 * 图片懒加载工具
 * 使用Intersection Observer API实现高性能图片懒加载
 */
class LazyLoader {
    constructor() {
        this.observer = null;
        this.init();
    }

    /**
     * 初始化Intersection Observer
     */
    init() {
        if ('IntersectionObserver' in window) {
            this.observer = new IntersectionObserver(
                entries => {
                    entries.forEach(entry => {
                        if (entry.isIntersecting) {
                            this.loadImage(entry.target);
                            this.observer.unobserve(entry.target);
                        }
                    });
                },
                {
                    root: null,
                    rootMargin: '50px 0px',
                    threshold: 0.01
                }
            );
        }
        console.log('[LazyLoader] 初始化完成');
    }

    /**
     * 观察图片元素
     * @param {HTMLImageElement} img - 图片元素
     */
    observe(img) {
        if (this.observer && img.dataset.src) {
            this.observer.observe(img);
        } else if (img.dataset.src) {
            // 降级方案：直接加载
            this.loadImage(img);
        }
    }

    /**
     * 批量观察图片
     * @param {NodeListOf<HTMLImageElement>} images - 图片元素列表
     */
    observeAll(images) {
        images.forEach(img => this.observe(img));
        console.log(`[LazyLoader] 开始观察 ${images.length} 张图片`);
    }

    /**
     * 加载图片
     * @param {HTMLImageElement} img - 图片元素
     */
    loadImage(img) {
        const src = img.dataset.src;
        if (!src) return;

        img.src = src;
        img.removeAttribute('data-src');

        img.onload = () => {
            img.classList.add('loaded');
        };

        img.onerror = () => {
            img.classList.add('error');
            img.src = 'assets/default-poster.png';
        };
    }

    /**
     * 停止观察所有元素
     */
    disconnect() {
        if (this.observer) {
            this.observer.disconnect();
        }
    }

    /**
     * 刷新观察（用于动态内容更新后）
     * @param {string} selector - 选择器
     */
    refresh(selector = '.video-poster img[data-src]') {
        const images = document.querySelectorAll(selector);
        this.observeAll(images);
    }
}

/**
 * 虚拟列表管理器
 * 用于优化大量视频卡片的渲染性能
 */
class VirtualList {
    /**
     * @param {object} options - 配置选项
     * @param {HTMLElement} options.container - 容器元素
     * @param {number} options.itemHeight - 项目高度
     * @param {number} options.bufferSize - 缓冲区大小
     * @param {Function} options.renderItem - 渲染函数
     */
    constructor(options) {
        this.container = options.container;
        this.itemHeight = options.itemHeight || 310;
        this.bufferSize = options.bufferSize || 5;
        this.renderItem = options.renderItem;
        this.items = [];
        this.visibleStart = 0;
        this.visibleEnd = 0;

        this.init();
    }

    /**
     * 初始化虚拟列表
     */
    init() {
        this.container.style.position = 'relative';
        this.container.style.overflowY = 'auto';

        this.wrapper = document.createElement('div');
        this.wrapper.style.position = 'relative';
        this.container.appendChild(this.wrapper);

        this.content = document.createElement('div');
        this.content.style.position = 'absolute';
        this.content.style.top = '0';
        this.content.style.left = '0';
        this.content.style.width = '100%';
        this.wrapper.appendChild(this.content);

        this.container.addEventListener('scroll', this.handleScroll.bind(this));
        console.log('[VirtualList] 初始化完成');
    }

    /**
     * 设置数据
     * @param {Array} items - 数据列表
     */
    setItems(items) {
        this.items = items;
        this.wrapper.style.height = `${Math.ceil(items.length / 4) * this.itemHeight}px`;
        this.updateVisibleItems();
    }

    /**
     * 处理滚动事件
     */
    handleScroll() {
        requestAnimationFrame(() => this.updateVisibleItems());
    }

    /**
     * 更新可见项目
     */
    updateVisibleItems() {
        const scrollTop = this.container.scrollTop;
        const containerHeight = this.container.clientHeight;

        const start = Math.max(0, Math.floor(scrollTop / this.itemHeight) - this.bufferSize);
        const end = Math.min(
            this.items.length,
            Math.ceil((scrollTop + containerHeight) / this.itemHeight) + this.bufferSize
        );

        if (start !== this.visibleStart || end !== this.visibleEnd) {
            this.visibleStart = start;
            this.visibleEnd = end;
            this.render();
        }
    }

    /**
     * 渲染可见项目
     */
    render() {
        this.content.innerHTML = '';

        const visibleItems = this.items.slice(this.visibleStart, this.visibleEnd);

        visibleItems.forEach((item, index) => {
            const element = this.renderItem(item, this.visibleStart + index);
            element.style.position = 'absolute';
            element.style.top = `${(this.visibleStart + index) * this.itemHeight}px`;
            this.content.appendChild(element);
        });
    }

    /**
     * 滚动到指定索引
     * @param {number} index - 项目索引
     */
    scrollTo(index) {
        this.container.scrollTop = index * this.itemHeight;
    }

    /**
     * 销毁虚拟列表
     */
    destroy() {
        this.container.removeEventListener('scroll', this.handleScroll);
        this.container.innerHTML = '';
    }
}

// 导出给渲染进程使用
window.LazyLoader = LazyLoader;
window.VirtualList = VirtualList;
