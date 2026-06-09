/**
 * inputRecognizer
 * 智能识别用户输入内容的类型：URL / 本地文件 / 磁力链 / 未知
 * 纯函数，无副作用，可独立单测
 */

const TYPE_URL = 'url';
const TYPE_LOCAL = 'local';
const TYPE_MAGNET = 'magnet';
const TYPE_UNKNOWN = 'unknown';
const TYPE_EMPTY = 'empty';

const VIDEO_EXTS = ['m3u8', 'mp4', 'mkv', 'webm', 'avi', 'flv'];

/**
 * 检测输入内容类型
 * @param {string} input - 用户输入的字符串
 * @returns {{ type: string, hash?: string, magnetUri?: string, path?: string, subtype?: string, url?: string }}
 */
function detectInputType(input) {
    const str = (input || '').trim();
    if (!str) {
        return { type: TYPE_EMPTY };
    }

    // 1. 标准 magnet URI
    if (str.startsWith('magnet:')) {
        return parseMagnetUri(str);
    }

    // 2. 纯 40 位 hex Info Hash
    if (/^[a-fA-F0-9]{40}$/.test(str)) {
        return {
            type: TYPE_MAGNET,
            hash: str,
            magnetUri: `magnet:?xt=urn:btih:${str}`
        };
    }

    // 3. 纯 32 位 base32 Info Hash（严格大写无 /i 标志）
    if (/^[A-Z2-7]{32}$/.test(str)) {
        return {
            type: TYPE_MAGNET,
            hash: str,
            magnetUri: `magnet:?xt=urn:btih:${str}`
        };
    }

    // 4. file:// URI
    if (str.startsWith('file://')) {
        return {
            type: TYPE_LOCAL,
            path: fileUriToPath(str)
        };
    }

    // 5. Windows 盘符路径
    if (/^[A-Za-z]:[\\/]/.test(str)) {
        return { type: TYPE_LOCAL, path: str };
    }

    // 6. UNC 路径
    if (str.startsWith('\\\\')) {
        return { type: TYPE_LOCAL, path: str };
    }

    // 7. POSIX 绝对路径
    if (str.startsWith('/')) {
        return { type: TYPE_LOCAL, path: str };
    }

    // 8. http(s) URL
    if (/^https?:\/\//i.test(str)) {
        return parseHttpUrl(str);
    }

    return { type: TYPE_UNKNOWN };
}

/**
 * 解析 magnet URI 提取 hash
 * @param {string} uri magnet 链接
 * @returns {{ type: string, hash: string, magnetUri: string }}
 */
function parseMagnetUri(uri) {
    const match = uri.match(/urn:btih:([a-fA-F0-9]{40}|[A-Z2-7]{32})/i);
    return {
        type: TYPE_MAGNET,
        hash: match ? match[1] : '',
        magnetUri: uri
    };
}

/**
 * 解析 http(s) URL，提取视频后缀
 * @param {string} url 媒体 URL
 * @returns {{ type: string, subtype?: string, url: string }}
 */
function parseHttpUrl(url) {
    const pathname = url.split('?')[0].toLowerCase();
    for (const ext of VIDEO_EXTS) {
        if (pathname.endsWith('.' + ext)) {
            return { type: TYPE_URL, subtype: ext, url };
        }
    }
    return { type: TYPE_URL, url };
}

/**
 * 将 file:// URI 转为本地路径
 * @param {string} uri file URI
 * @returns {string} 本地路径
 */
function fileUriToPath(uri) {
    let p = uri.replace(/^file:\/\/\//, '');
    if (/^[A-Za-z]:/.test(p)) {
        p = p.replace(/\//g, '\\');
    }
    return decodeURIComponent(p);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        detectInputType,
        TYPE_URL,
        TYPE_LOCAL,
        TYPE_MAGNET,
        TYPE_UNKNOWN,
        TYPE_EMPTY
    };
}
