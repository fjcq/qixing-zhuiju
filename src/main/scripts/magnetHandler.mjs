/**
 * 磁力链处理脚本
 * 使用系统Node.js运行，避免Electron内置Node 18的限制
 * 使用webtorrent v2.x，通过magnet-runtime独立目录安装
 *
 * 通信协议：通过stdin/stdout JSON消息通信
 * 输入：{ action: 'resolve'|'play', magnetUri, fileName?, infoHash? }
 * 输出：{ type: 'files'|'progress'|'ready'|'error', ... }
 *
 * 注意：webtorrent v2.x 是纯 ESM（package.json "type": "module"），
 *       不能用 createRequire/require 加载（会报 ERR_REQUIRE_ESM）。
 *       必须用动态 import()，且 ESM 的 import 不支持 NODE_PATH，
 *       所以 webtorrent 路径由主进程通过 WEBTORRENT_PATH 环境变量传绝对路径进来
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { pathToFileURL } from 'url';

// 关键：webtorrent v2.x 是纯 ESM（"type": "module"），
//       createRequire/require 是 CommonJS 机制，无法加载 ESM（ERR_REQUIRE_ESM）
//       改用顶层 await import(URL)；绝对路径由主进程通过 env 传入，
//       避免依赖 NODE_PATH（ESM import 不识别 NODE_PATH）
//       Windows 下绝对路径必须包成 file:// URL（ERR_UNSUPPORTED_ESM_URL_SCHEME），
//       POSIX 平台直接用 file:// 形式也通用，所以统一走 pathToFileURL
//       ESM 还不支持目录导入（ERR_UNSUPPORTED_DIR_IMPORT），必须指向入口 index.js
const WEBTORRENT_PATH = process.env.WEBTORRENT_PATH;
if (!WEBTORRENT_PATH) {
    process.stderr.write('FATAL: WEBTORRENT_PATH 环境变量未设置（主进程应在 spawn 时传入 webtorrent 绝对路径）\n');
    process.exit(1);
}
const webtorrentEntry = WEBTORRENT_PATH.endsWith(path.sep)
    ? path.join(WEBTORRENT_PATH, 'index.js')
    : WEBTORRENT_PATH + path.sep + 'index.js';
const WebTorrentModule = await import(pathToFileURL(webtorrentEntry).href);
// ESM 模块的构造函数导出位置：default 上或模块本身（取决于包是否同时提供 default export）
const WebTorrent = WebTorrentModule.default || WebTorrentModule;

// 全局错误处理，防止子进程崩溃
process.on('uncaughtException', err => {
    // 忽略客户端关闭连接导致的流错误
    if (err.message && err.message.includes('Writable stream closed prematurely')) {
        return;
    }
    sendMessage({ type: 'error', error: `未捕获异常: ${err.message}` });
});

process.on('unhandledRejection', err => {
    if (err && err.message && err.message.includes('Writable stream closed prematurely')) {
        return;
    }
    sendMessage({ type: 'error', error: `未处理的Promise拒绝: ${err?.message || err}` });
});

// 全局客户端实例
let client = null;
let currentTorrent = null;
let fileServer = null;
let fileServerPort = 0;
// 文件流进度上报定时器（提为模块级，以便在新 torrent 播放时清理旧的）
// 关键：旧实现是 startFileStream 内的 const，无法从外部清理
// 后果：用户连续播放多个文件时，每个旧文件的 1s 进度上报都还在跑
// 会向主进程/播放器发送过时进度，干扰新文件的 UI 状态
let streamPeerCheckInterval = null;

// 存储目录：默认系统临时目录，启动时由主进程通过 init 消息覆盖
let MAGNET_DIR = path.join(os.tmpdir(), 'qixing-torrents');
if (!fs.existsSync(MAGNET_DIR)) {
    fs.mkdirSync(MAGNET_DIR, { recursive: true });
}

/**
 * 发送磁力状态变化到主进程（用于实时更新下载清单进度）
 */
function sendMagnetStatus(infoHash, payload) {
    sendMessage({
        type: 'magnet-status',
        infoHash,
        ...payload
    });
}

/**
 * 单个磁力的存储子目录：MAGNET_DIR/<infoHash>/
 * 与主进程 DownloadManager.getMagnetPath 行为一致：
 * - infoHash 仅保留小写十六进制字符
 * - 自动创建子目录
 * - infoHash 为空时返回根目录（不常见路径）
 */
function getMagnetPath(infoHash) {
    if (!infoHash) return MAGNET_DIR;
    const safe = String(infoHash).toLowerCase().replace(/[^a-f0-9]/g, '');
    const dir = path.join(MAGNET_DIR, safe);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

/**
 * 可靠的tracker列表（已测试验证可达性，按响应速度排序）
 * 优先使用HTTP/HTTPS tracker（国内网络友好），UDP tracker作为备用
 * 数据来源：ngosang/trackerslist + CSDN国内电信测试 + 自测验证
 */
const TRACKER_LIST = [
    // 国内IP直连tracker（响应最快，122-134ms）
    'http://211.75.210.221:6969/announce',
    'http://60.249.37.20:80/announce',
    'http://211.75.205.189:6969/announce',
    // 国际HTTP tracker（已验证可达，444-630ms）
    'http://216.144.239.90:6969/announce',
    'http://95.217.167.10:6969/announce',
    'http://107.189.2.131:1337/announce',
    'http://37.120.182.83:80/announce',
    'http://tracker.dler.org:6969/announce',
    'http://tracker2.dler.org:80/announce',
    'http://tracker.waaa.moe:6969/announce',
    // HTTPS tracker（加密传输，国内更稳定）
    'https://tracker.zhuqiy.com:443/announce',
    'https://tracker.nekomi.cn:443/announce',
    // 国内域名tracker
    'http://tracker.renfei.net:8080/announce',
    'http://tracker1.itzmx.com:8080/announce',
    'http://tracker.zhuqiy.top:80/announce',
    // WSS tracker（WebSocket，可穿透防火墙）
    'wss://tracker.openwebtorrent.com',
    'wss://tracker.btorrent.xyz',
    // UDP tracker（备用，国内网络可能不稳定）
    'udp://93.158.213.92:1337/announce',
    'udp://216.144.239.90:6969/announce',
    'udp://95.217.167.10:6969/announce',
    'udp://tracker.opentrackr.org:1337/announce',
    'udp://open.demonii.com:1337/announce',
    'udp://open.stealth.si:80/announce',
    'udp://tracker.torrent.eu.org:451/announce',
    'udp://explodie.org:6969/announce',
    'udp://p4p.arenabg.com:1337/announce',
    'udp://tracker.dler.org:6969/announce',
    'udp://exodus.desync.com:6969/announce'
];

/**
 * DHT bootstrap节点（包含国内可达的节点）
 */
const DHT_BOOTSTRAP_NODES = [
    'router.bittorrent.com:6881',
    'router.utorrent.com:6881',
    'dht.transmissionbt.com:6881',
    'dht.aelitis.com:6881',
    'router.silotis.us:6881'
];

/**
 * 当前使用的tracker列表（可动态更新）
 */
let activeTrackers = [...TRACKER_LIST];

/**
 * 从ngosang/trackerslist获取最新tracker列表
 * 每日自动更新，合并到本地列表中
 */
async function fetchLatestTrackers() {
    const urls = [
        'https://cdn.jsdelivr.net/gh/ngosang/trackerslist@master/trackers_best.txt',
        'https://cdn.jsdelivr.net/gh/ngosang/trackerslist@master/trackers_all_http.txt'
    ];

    const fetched = [];
    for (const url of urls) {
        try {
            const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
            if (resp.ok) {
                const text = await resp.text();
                const trackers = text.split('\n')
                    .map(line => line.trim())
                    .filter(line => line && line.startsWith('http'));
                fetched.push(...trackers);
            }
        } catch (err) {
            sendMessage({ type: 'log', message: `获取tracker列表失败(${url}): ${err.message}` });
        }
    }

    if (fetched.length > 0) {
        // 合并去重，远程tracker排在本地已验证tracker之后
        const existing = new Set(activeTrackers);
        const newTrackers = fetched.filter(t => !existing.has(t));
        activeTrackers = [...TRACKER_LIST, ...newTrackers];
        sendMessage({ type: 'log', message: `tracker列表已更新: 本地${TRACKER_LIST.length}个 + 远程${newTrackers.length}个` });
    }
}

// 启动时异步获取最新tracker列表
fetchLatestTrackers();
// 每6小时更新一次
setInterval(fetchLatestTrackers, 6 * 60 * 60 * 1000);

/**
 * 发送JSON消息到父进程
 */
function sendMessage(msg) {
    process.stdout.write(JSON.stringify(msg) + '\n');
}

/**
 * 获取或创建WebTorrent客户端
 */
function getClient() {
    if (!client) {
        client = new WebTorrent({
            maxConns: 200,
            dht: {
                bootstrap: DHT_BOOTSTRAP_NODES,
                concurrency: 16
            },
            tracker: true,
            utp: true,
            lsd: true
        });
        client.on('error', err => {
            sendMessage({ type: 'error', error: err.message });
        });

        // 监听DHT事件
        client.dht?.on('listening', () => {
            sendMessage({ type: 'log', message: 'DHT正在监听' });
        });
        // peer事件触发频率极高（DHT入网后每秒数十上百个），按"遇错才输出"策略静默
        client.dht?.on('peer', (peer) => {
            // 静默处理，避免日志刷屏
        });
        client.dht?.on('warning', err => {
            sendMessage({ type: 'log', message: `DHT警告: ${err.message}` });
        });
    }
    return client;
}

/**
 * 解析磁力链接，获取文件列表
 * 先尝试HTTP缓存API，再使用P2P
 */
async function resolveMagnet(magnetUri, infoHash) {
    const c = getClient();

    // 检查是否已存在相同infoHash且元数据已就绪的torrent
    const existingTorrent = c.get(infoHash);
    if (existingTorrent && existingTorrent.files && existingTorrent.files.length > 0) {
        sendMessage({ type: 'log', message: '复用已存在的torrent实例' });
        currentTorrent = existingTorrent;
        const files = existingTorrent.files.map(f => ({
            name: f.name,
            length: f.length,
            path: f.path
        }));
        return files;
    }

    // 先尝试HTTP缓存API获取torrent文件
    const torrentBuffer = await fetchTorrentFromCache(infoHash);

    let torrentId = magnetUri;
    if (torrentBuffer) {
        torrentId = torrentBuffer;
        sendMessage({ type: 'log', message: '使用HTTP缓存API获取的torrent文件' });
    }

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('解析磁力链接超时（60秒），请检查网络连接或尝试其他链接'));
        }, 60000);

        try {
            sendMessage({ type: 'log', message: `使用${activeTrackers.length}个tracker: ${activeTrackers.slice(0, 5).join(', ')}...` });

            // 捕获重复添加错误，降级为等待已有torrent
            let addFailed = false;
            try {
                c.add(torrentId, {
                    path: getMagnetPath(infoHash),
                    announce: activeTrackers
                }, torrent => {
                    clearTimeout(timeout);
                    currentTorrent = torrent;

                    // 输出torrent使用的所有tracker
                    const trackerUrls = torrent.announce || [];
                    sendMessage({ type: 'log', message: `torrent使用${trackerUrls.length}个tracker` });

                    // 监听torrent事件
                    torrent.on('wire', (wire, addr) => {
                        sendMessage({ type: 'wire', address: addr });
                    });

                    torrent.on('done', () => {
                        sendMessage({ type: 'done' });
                        // 通知主进程：整个 torrent 下载完成
                        const totalLength = Number(torrent.length || 0);
                        sendMagnetStatus(torrent.infoHash, {
                            status: 'completed',
                            fileName: torrent.name,
                            downloaded: totalLength,
                            total: totalLength,
                            progress: 100
                        });
                    });

                    torrent.on('warning', err => {
                        sendMessage({ type: 'warning', message: err.message });
                    });

                    torrent.on('error', err => {
                        sendMessage({ type: 'error', error: err.message });
                    });

                    // 返回文件列表
                    const files = torrent.files.map(f => ({
                        name: f.name,
                        length: f.length,
                        path: f.path
                    }));

                    resolve(files);
                });
            } catch (addErr) {
                // 磁力链接已存在（重复添加），尝试获取并等待已有torrent
                if (addErr.message && addErr.message.includes('duplicate')) {
                    addFailed = true;
                    sendMessage({ type: 'log', message: '检测到重复torrent，等待元数据就绪...' });
                } else {
                    throw addErr;
                }
            }

            // 降级方案：等待已存在的torrent完成元数据解析
            if (addFailed) {
                const pendingTorrent = c.get(infoHash);
                if (pendingTorrent && typeof pendingTorrent.on === 'function') {
                    pendingTorrent.on('ready', () => {
                        clearTimeout(timeout);
                        currentTorrent = pendingTorrent;
                        const files = pendingTorrent.files.map(f => ({
                            name: f.name,
                            length: f.length,
                            path: f.path
                        }));
                        resolve(files);
                    });
                    pendingTorrent.on('error', err => {
                        clearTimeout(timeout);
                        reject(err);
                    });
                } else {
                    clearTimeout(timeout);
                    reject(new Error('无法获取已有的torrent实例'));
                }
            }
        } catch (err) {
            clearTimeout(timeout);
            reject(err);
        }

        c.on('error', err => {
            clearTimeout(timeout);
            // 过滤 "Cannot add duplicate torrent" 异步错误：
            // webtorrent v2 在 c.add 传入已存在 infoHash 时，既会异步触发 error 事件，
            // 也会调用 ready 回调（传入已存在的 torrent 实例）。这里忽略该错误，
            // 让 ready 回调的 resolve 正常生效，避免误判为解析失败。
            if (err && err.message && /duplicate torrent/i.test(err.message)) {
                sendMessage({ type: 'log', message: '忽略duplicate错误，等待ready回调处理' });
                return;
            }
            reject(err);
        });
    });
}

/**
 * 验证Buffer是否为有效的torrent文件
 * torrent文件本质上是Bencode编码的字典，必须以'd' (0x64) 开头
 * 缓存服务（如btcache.me）在找不到资源时会返回HTTP 200 + HTML错误页，
 * 必须用此函数过滤，否则后续webtorrent.add()会抛"Invalid torrent identifier"
 * @param {Buffer} buf - 待验证的Buffer
 * @returns {boolean}
 */
function isValidTorrentBuffer(buf) {
    if (!Buffer.isBuffer(buf) || buf.length < 2) {
        return false;
    }
    // Bencode字典以'd' (0x64) 开头，其他类型（列表'l'、整数'i'、字符串长度数字）都不合法
    return buf[0] === 0x64;
}

/**
 * 通过HTTP缓存API获取torrent文件
 */
async function fetchTorrentFromCache(infoHash) {
    if (!infoHash) return null;

    const upperHash = infoHash.toUpperCase();
    const cachePath = path.join(MAGNET_DIR, `${infoHash}.torrent`);

    // 如果本地已有缓存，先校验有效性；HTML错误页等无效内容会导致webtorrent解析失败
    if (fs.existsSync(cachePath)) {
        try {
            const cachedBuf = fs.readFileSync(cachePath);
            if (isValidTorrentBuffer(cachedBuf)) {
                sendMessage({ type: 'log', message: '使用本地缓存的torrent文件' });
                return cachedBuf;
            }
            // 缓存内容无效（可能是上次保存的HTML错误页），删除后重新从网络获取
            sendMessage({ type: 'log', message: '本地缓存torrent文件无效（首字节非Bencode字典标识），已删除并重新获取' });
            try { fs.unlinkSync(cachePath); } catch (e) { /* 忽略删除失败 */ }
        } catch (e) {
            sendMessage({ type: 'log', message: `读取本地缓存失败: ${e.message}` });
        }
    }

    const cacheUrls = [
        `https://itorrents.org/torrent/${upperHash}.torrent`,
        `https://btcache.me/torrent/${upperHash}`,
        `https://torrage.info/torrent/${upperHash}.torrent`
    ];

    for (let i = 0; i < cacheUrls.length; i++) {
        try {
            sendMessage({ type: 'log', message: `尝试缓存服务 ${i + 1}/${cacheUrls.length}: ${cacheUrls[i]}` });

            const response = await fetch(cacheUrls[i], {
                signal: AbortSignal.timeout(15000)
            });

            if (response.ok) {
                const buffer = Buffer.from(await response.arrayBuffer());
                if (isValidTorrentBuffer(buffer)) {
                    // 缓存到本地
                    fs.writeFileSync(cachePath, buffer);
                    sendMessage({ type: 'log', message: `缓存服务返回数据, 大小: ${buffer.length} 字节` });
                    return buffer;
                }
                // 内容不是torrent文件（常见于404页面返回HTML），跳过此服务
                const preview = buffer.subarray(0, Math.min(40, buffer.length)).toString('utf8').replace(/[\r\n]/g, ' ');
                sendMessage({ type: 'log', message: `缓存服务 ${i + 1} 返回非torrent内容（首字节0x${buffer[0]?.toString(16) || '00'}，前40字节: "${preview}"），跳过` });
            }
        } catch (err) {
            sendMessage({ type: 'log', message: `缓存服务 ${i + 1} 失败: ${err.message}` });
        }
    }

    return null;
}

/**
 * 播放磁力链接中的指定文件
 * 创建HTTP流服务器，边下载边播放
 * @param {string} magnetUri - 磁力链接
 * @param {string} fileName - 文件名
 * @param {string} infoHash - info hash
 * @param {string} cachedTorrentPath - 主进程resolve阶段已缓存的torrent文件路径（可选）
 */
async function playMagnetFile(magnetUri, fileName, infoHash, cachedTorrentPath) {
    const c = getClient();

    // 通知主进程：开始下载（让下载页能立即看到"正在下载"任务）
    sendMagnetStatus(infoHash, {
        status: 'downloading',
        fileName,
        downloaded: 0,
        total: 0,
        progress: 0
    });

    // 优先使用主进程已缓存的torrent文件，避免重复网络获取
    let torrentId = magnetUri;

    // 统一使用本地缓存路径读取（主进程传入的cachedTorrentPath本质也是同一个文件）
    const localCachePath = path.join(MAGNET_DIR, `${infoHash}.torrent`);
    let usedLocalCache = false;
    if (fs.existsSync(localCachePath)) {
        try {
            const cachedBuf = fs.readFileSync(localCachePath);
            if (isValidTorrentBuffer(cachedBuf)) {
                torrentId = cachedBuf;
                usedLocalCache = true;
                sendMessage({
                    type: 'log', message: cachedTorrentPath === localCachePath
                        ? '使用主进程缓存的torrent文件'
                        : '使用本地缓存的torrent文件'
                });
            } else {
                // 缓存内容无效（HTML错误页等），删除后走网络获取
                sendMessage({ type: 'log', message: '缓存的torrent文件无效（首字节非Bencode字典标识），已删除并重新获取' });
                try { fs.unlinkSync(localCachePath); } catch (e) { /* 忽略删除失败 */ }
            }
        } catch (e) {
            sendMessage({ type: 'log', message: `读取本地缓存失败: ${e.message}` });
        }
    }

    // 没有有效缓存时，最后尝试从网络获取
    if (!usedLocalCache) {
        const torrentBuffer = await fetchTorrentFromCache(infoHash);
        if (torrentBuffer) {
            torrentId = torrentBuffer;
            sendMessage({ type: 'log', message: '使用HTTP缓存API获取的torrent文件' });
        }
    }

    return new Promise((resolve, reject) => {
        let peerCheckInterval = null;
        let noPeerTimeout = null;
        let slowTimeout = null;
        let stallWatchdog = null;

        // 停滞检测阈值：自上次收到新数据起，N 秒内完全无进展才判失败
        // 替代原来的"固定 2 分钟总超时"——原来不论下载有没有在跑，到点就 reject，
        // 慢速但确实在传输的场景会被误判为"连接超时"，与用户实际感受严重不符
        const STALL_TIMEOUT_MS = 120000;
        const STALL_CHECK_INTERVAL_MS = 10000;
        // 记录上一次观察到的已下载字节数 + 上次进展时刻
        let lastDownloadedBytes = 0;
        let lastProgressAt = Date.now();
        // 是否曾经收到过数据：用于区分"从一开始就连不上"和"中途停滞"
        let hasReceivedData = false;

        /**
         * 清理本次 play 启动的所有定时器/定时任务（停滞检测、peer 检查、警告）
         * 集中到一个函数，避免在 done/error/addFailed 等多个分支里重复散落的 clear
         */
        function clearAllTimers() {
            if (stallWatchdog) {
                clearTimeout(stallWatchdog);
                stallWatchdog = null;
            }
            if (peerCheckInterval) {
                clearInterval(peerCheckInterval);
                peerCheckInterval = null;
            }
            if (noPeerTimeout) {
                clearTimeout(noPeerTimeout);
                noPeerTimeout = null;
            }
            if (slowTimeout) {
                clearTimeout(slowTimeout);
                slowTimeout = null;
            }
        }

        /**
         * 停滞检测：每 10 秒观察一次 torrent.downloaded 是否仍在增长
         * 仍在增长就刷新基准时间；连续 STALL_TIMEOUT_MS 无增长才拒绝
         * @param {object} t 当前 webtorrent torrent 实例
         */
        function scheduleStallCheck(t) {
            if (stallWatchdog) {
                clearTimeout(stallWatchdog);
            }
            stallWatchdog = setTimeout(() => {
                const currentDownloaded = Number(t.downloaded || 0);
                if (currentDownloaded > lastDownloadedBytes) {
                    // 收到新数据，刷新基准
                    lastDownloadedBytes = currentDownloaded;
                    lastProgressAt = Date.now();
                    hasReceivedData = true;
                    scheduleStallCheck(t);
                    return;
                }
                const stalledFor = Date.now() - lastProgressAt;
                if (stalledFor < STALL_TIMEOUT_MS) {
                    // 还没到阈值，再等下一轮
                    scheduleStallCheck(t);
                    return;
                }
                // 真正停滞：根据"是否曾经收到过数据"给出更准确的提示
                clearAllTimers();
                const seconds = Math.round(stalledFor / 1000);
                const message = hasReceivedData
                    ? `下载停滞（${seconds} 秒无新数据），可能网络不稳定或 peer 已离线`
                    : `连接超时（${seconds} 秒未接收到数据），该资源可能无人做种或网络连接受限`;
                reject(new Error(message));
            }, STALL_CHECK_INTERVAL_MS);
        }

        // 异步解析"是否已有可复用的 torrent" —— webtorrent v2.x 的 client.get() 是 async 的
        // 必须 await 出真正的 torrent 对象（否则拿到的是 Promise，复用判断会失效）
        function findReusableTorrent(targetHash) {
            if (currentTorrent && currentTorrent.infoHash === targetHash.toLowerCase()) {
                return Promise.resolve(currentTorrent);
            }
            return Promise.resolve(c.get(targetHash));
        }

        findReusableTorrent(infoHash).then(reuseTorrent => {
            if (reuseTorrent && reuseTorrent.files && reuseTorrent.files.length > 0) {
                sendMessage({ type: 'log', message: '复用已存在的torrent实例' });
                clearAllTimers();
                currentTorrent = reuseTorrent;
                startFileStream(reuseTorrent, fileName, resolve, reject);
                return;
            }

            sendMessage({ type: 'log', message: `播放使用${activeTrackers.length}个tracker` });

            // 发送连接中状态
            sendMessage({
                type: 'progress',
                infoHash,
                fileName,
                progress: 0,
                downloaded: 0,
                total: 0,
                wires: 0,
                downloadSpeed: 0,
                numPeers: 0,
                status: 'connecting'
            });

            // 捕获重复添加错误，降级为等待已有torrent
            let addFailed = false;
            try {
                c.add(torrentId, {
                    path: getMagnetPath(infoHash),
                    announce: activeTrackers
                }, torrent => {
                    currentTorrent = torrent;

                    // 初始化停滞检测的基准值
                    // 若 torrent 启动时已有缓存进度（如断点续传），按"有数据"处理，
                    // 避免把"已下载部分"误判为"刚启动还没收到数据"
                    lastDownloadedBytes = Number(torrent.downloaded || 0);
                    if (lastDownloadedBytes > 0) {
                        hasReceivedData = true;
                        lastProgressAt = Date.now();
                    }

                    // 启动停滞检测：只要还在下载就不会 reject，
                    // 真正"长时间无新数据"才提示用户（且区分"从一开始就没连上"vs"中途卡住"）
                    scheduleStallCheck(torrent);

                    // 输出torrent使用的所有tracker
                    const trackerUrls = torrent.announce || [];
                    sendMessage({ type: 'log', message: `torrent使用${trackerUrls.length}个tracker` });

                    // 定期检查peer连接状态
                    peerCheckInterval = setInterval(() => {
                        const numPeers = torrent.numPeers || 0;
                        const wires = torrent.wires ? torrent.wires.length : 0;
                        const speed = Number(torrent.downloadSpeed);

                        if (numPeers === 0 && wires === 0) {
                            sendMessage({
                                type: 'progress',
                                infoHash: torrent.infoHash,
                                fileName,
                                progress: Math.round(torrent.progress * 100),
                                downloaded: Number(torrent.downloaded),
                                total: Number(torrent.length),
                                wires,
                                downloadSpeed: speed,
                                numPeers,
                                status: 'no-peers'
                            });
                        } else if (wires > 0 && speed === 0) {
                            sendMessage({
                                type: 'progress',
                                infoHash: torrent.infoHash,
                                fileName,
                                progress: Math.round(torrent.progress * 100),
                                downloaded: Number(torrent.downloaded),
                                total: Number(torrent.length),
                                wires,
                                downloadSpeed: speed,
                                numPeers,
                                status: 'connected-waiting'
                            });
                        } else {
                            // 正常下载中或下载完成：始终发送进度
                            const progressPercent = Math.round(torrent.progress * 100);
                            const isComplete = progressPercent >= 100;
                            sendMessage({
                                type: 'progress',
                                infoHash: torrent.infoHash,
                                fileName,
                                progress: progressPercent,
                                downloaded: Number(torrent.downloaded),
                                total: Number(torrent.length),
                                wires,
                                downloadSpeed: speed,
                                numPeers,
                                status: isComplete ? 'completed' : 'downloading'
                            });
                        }
                    }, 5000);

                    // 30秒无peer连接警告
                    noPeerTimeout = setTimeout(() => {
                        if (torrent.numPeers === 0 && torrent.wires.length === 0) {
                            sendMessage({
                                type: 'progress',
                                infoHash: torrent.infoHash,
                                fileName,
                                progress: 0,
                                downloaded: 0,
                                total: Number(torrent.length),
                                wires: 0,
                                downloadSpeed: 0,
                                numPeers: 0,
                                status: 'no-peers-warning'
                            });
                        }
                    }, 30000);

                    // 60秒无下载速度警告
                    slowTimeout = setTimeout(() => {
                        if (torrent.downloadSpeed === 0 && torrent.progress === 0) {
                            sendMessage({
                                type: 'progress',
                                infoHash: torrent.infoHash,
                                fileName,
                                progress: 0,
                                downloaded: Number(torrent.downloaded),
                                total: Number(torrent.length),
                                wires: torrent.wires.length,
                                downloadSpeed: 0,
                                numPeers: torrent.numPeers,
                                status: 'slow-warning'
                            });
                        }
                    }, 60000);

                    // 监听下载进度（resolve 阶段，用于解析进度条，对应 magnet-progress 事件）
                    // 高频回调但只影响主窗口的外链页面，播放器窗口不监听此事件
                    torrent.on('download', bytes => {
                        const file = torrent.files.find(f => f.name === fileName);
                        if (file) {
                            sendMessage({
                                type: 'progress',
                                infoHash: torrent.infoHash,
                                fileName: file.name,
                                progress: Math.round(torrent.progress * 100),
                                downloaded: Number(torrent.downloaded),
                                total: Number(torrent.length),
                                wires: torrent.wires.length,
                                downloadSpeed: Number(torrent.downloadSpeed),
                                numPeers: torrent.numPeers,
                                eta: calcEta(torrent),
                                status: 'downloading'
                            });
                        }
                    });

                    torrent.on('done', () => {
                        // done 时统一清理所有定时器（停滞检测 + peer 检查 + 警告）
                        clearAllTimers();
                        sendMessage({
                            type: 'progress',
                            infoHash: torrent.infoHash,
                            fileName,
                            progress: 100,
                            downloaded: Number(torrent.length),
                            total: Number(torrent.length),
                            wires: torrent.wires.length,
                            downloadSpeed: 0,
                            numPeers: torrent.numPeers,
                            status: 'done'
                        });
                        // 通知主进程：torrent 整体完成，更新下载清单状态
                        sendMagnetStatus(torrent.infoHash, {
                            status: 'completed',
                            fileName,
                            downloaded: Number(torrent.length),
                            total: Number(torrent.length),
                            progress: 100
                        });
                    });

                    startFileStream(torrent, fileName, resolve, reject);
                });
            } catch (addErr) {
                // 磁力链接已存在（重复添加），尝试获取并等待已有torrent
                if (addErr.message && addErr.message.includes('duplicate')) {
                    addFailed = true;
                    sendMessage({ type: 'log', message: '检测到重复torrent，等待元数据就绪...' });
                } else {
                    throw addErr;
                }
            }

            // 降级方案：等待已存在的torrent完成元数据解析
            // webtorrent v2.x 的 client.get() 是 async 的，需要 await
            if (addFailed) {
                Promise.resolve(c.get(infoHash)).then(pendingTorrent => {
                    if (pendingTorrent && typeof pendingTorrent.on === 'function') {
                        // 重复添加场景：c.add 回调不会触发，停滞检测也不会自动启动
                        // 这里手动补上，行为与首次添加路径保持一致
                        lastDownloadedBytes = Number(pendingTorrent.downloaded || 0);
                        if (lastDownloadedBytes > 0) {
                            hasReceivedData = true;
                            lastProgressAt = Date.now();
                        }
                        scheduleStallCheck(pendingTorrent);
                        pendingTorrent.on('ready', () => {
                            clearAllTimers();
                            currentTorrent = pendingTorrent;
                            startFileStream(pendingTorrent, fileName, resolve, reject);
                        });
                        pendingTorrent.on('error', err => {
                            clearAllTimers();
                            reject(err);
                        });
                    } else {
                        clearAllTimers();
                        reject(new Error('无法获取已有的torrent实例'));
                    }
                }).catch(getErr => {
                    clearAllTimers();
                    reject(getErr);
                });
            }
        }).catch(err => {
            clearAllTimers();
            reject(err);
        });

        c.on('error', err => {
            clearAllTimers();
            // 过滤 "Cannot add duplicate torrent" 异步错误：
            // webtorrent v2 在 c.add 传入已存在 infoHash 时，既会异步触发 error 事件，
            // 也会调用 ready 回调（传入已存在的 torrent 实例）。这里忽略该错误，
            // 让 ready 回调的 resolve 正常生效，避免误判为播放失败。
            if (err && err.message && /duplicate torrent/i.test(err.message)) {
                sendMessage({ type: 'log', message: '忽略duplicate错误，等待ready回调处理' });
                return;
            }
            reject(err);
        });
    });
}

/**
 * 创建HTTP文件流服务器
 */
function startFileStream(torrent, fileName, resolve, reject) {
    const file = torrent.files.find(f => f.name === fileName);
    if (!file) {
        reject(new Error(`文件不存在: ${fileName}`));
        return;
    }

    // 取消选择其他文件，只下载选中的文件
    torrent.files.forEach(f => {
        if (f.name !== fileName) {
            f.deselect();
        }
    });

    // 创建HTTP流服务器（无论文件是否下载完成，都通过HTTP提供，避免file://协议限制）
    if (fileServer) {
        try { fileServer.close(); } catch (e) { /* 忽略 */ }
    }

    // 清理上一个文件的进度上报定时器（防止多个旧 interval 同时跑导致进度混乱）
    // 关键：模块级的 streamPeerCheckInterval 在 startFileStream 入口统一清理
    // 否则用户连播 N 个文件就会有 N 个 1s interval 在后台乱发 progress
    if (streamPeerCheckInterval) {
        clearInterval(streamPeerCheckInterval);
        streamPeerCheckInterval = null;
    }

    // 检查文件是否已下载完成
    const filePath = path.join(getMagnetPath(torrent.infoHash), file.path);
    const isDownloaded = fs.existsSync(filePath) && fs.statSync(filePath).size === file.length;
    if (isDownloaded) {
        sendMessage({ type: 'log', message: '文件已下载完成，通过HTTP流服务器播放本地文件' });
        // 文件已下载完成：延迟发送一次 progress（100%），让播放器信息栏显示"已完成"状态
        // 延迟确保播放器窗口 webContents 已就绪
        setTimeout(() => {
            sendMessage({
                type: 'progress',
                infoHash: torrent.infoHash,
                fileName,
                progress: 100,
                downloaded: Number(file.length),
                total: Number(file.length),
                wires: 0,
                downloadSpeed: 0,
                numPeers: 0,
                status: 'completed'
            });
        }, 300);
    } else {
        // 文件未下载完成：立即发送一次 connecting 状态，并启动定期检查
        sendMessage({
            type: 'progress',
            infoHash: torrent.infoHash,
            fileName,
            progress: Math.round((torrent.progress || 0) * 100),
            downloaded: Number(torrent.downloaded || 0),
            total: Number(file.length),
            wires: torrent.wires ? torrent.wires.length : 0,
            downloadSpeed: Number(torrent.downloadSpeed || 0),
            numPeers: torrent.numPeers || 0,
            eta: calcEta(torrent),
            status: 'downloading'
        });
        // 启动定期进度上报（每 1 秒）
        // 频率比之前 5 秒更平滑，同时控制 IPC 流量在合理范围（每条 ~150B，约 150B/s）
        // 不再用 torrent.on('download') 高频回调，避免刷爆 IPC 通道
        // 复用模块级 streamPeerCheckInterval（提为模块级后下次进入 startFileStream 时可清理）
        streamPeerCheckInterval = setInterval(() => {
            const numPeers = torrent.numPeers || 0;
            const wires = torrent.wires ? torrent.wires.length : 0;
            const speed = Number(torrent.downloadSpeed || 0);
            const progressPercent = Math.round((torrent.progress || 0) * 100);
            sendMessage({
                type: 'progress',
                infoHash: torrent.infoHash,
                fileName,
                progress: progressPercent,
                downloaded: Number(torrent.downloaded || 0),
                total: Number(file.length),
                wires,
                downloadSpeed: speed,
                numPeers,
                eta: calcEta(torrent),
                status: progressPercent >= 100 ? 'completed' : (wires > 0 ? 'downloading' : 'connecting')
            });
            // 同步通知主进程更新下载清单进度（节流由主进程负责）
            sendMagnetStatus(torrent.infoHash, {
                status: 'downloading',
                fileName,
                downloaded: Number(torrent.downloaded || 0),
                total: Number(file.length),
                progress: progressPercent
            });
            // 下载完成后停止上报
            if (progressPercent >= 100) {
                clearInterval(streamPeerCheckInterval);
            }
        }, 1000);
    }

    fileServer = http.createServer((req, res) => {
        // 支持Range请求，实现拖动进度条
        const range = req.headers.range;
        const fileSize = file.length;

        // 客户端关闭连接时静默处理，避免FileStream崩溃
        res.on('close', () => {
            // 连接被客户端关闭（正常行为，如seek/暂停/关闭播放器）
        });

        if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunkSize = end - start + 1;

            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunkSize,
                'Content-Type': getContentType(fileName),
                'Access-Control-Allow-Origin': '*'
            });

            if (isDownloaded) {
                // 文件已下载完成，直接从本地文件读取（更快更稳定）
                const readStream = fs.createReadStream(filePath, { start, end });
                readStream.on('error', () => { /* 忽略流错误 */ });
                readStream.pipe(res).on('error', () => { /* 忽略管道错误 */ });
            } else {
                // 文件未下载完成，通过webtorrent流式读取
                const stream = file.createReadStream({ start, end });
                stream.on('error', () => { /* 静默处理流错误 */ });
                stream.pipe(res).on('error', () => { /* 静默处理管道错误 */ });
            }
        } else {
            res.writeHead(200, {
                'Content-Length': fileSize,
                'Content-Type': getContentType(fileName),
                'Access-Control-Allow-Origin': '*'
            });

            if (isDownloaded) {
                const readStream = fs.createReadStream(filePath);
                readStream.on('error', () => { /* 忽略流错误 */ });
                readStream.pipe(res).on('error', () => { /* 忽略管道错误 */ });
            } else {
                const stream = file.createReadStream();
                stream.on('error', () => { /* 静默处理流错误 */ });
                stream.pipe(res).on('error', () => { /* 静默处理管道错误 */ });
            }
        }
    });

    fileServer.listen(0, () => {
        fileServerPort = fileServer.address().port;
        const encodedName = encodeURIComponent(fileName);
        const streamUrl = `http://localhost:${fileServerPort}/${encodedName}`;

        sendMessage({ type: 'log', message: `文件流服务器启动: 端口${fileServerPort}` });

        resolve({
            streamUrl,
            isLocal: false
        });
    });

    fileServer.on('error', err => {
        reject(new Error(`文件流服务器启动失败: ${err.message}`));
    });
}

/**
 * 计算剩余下载时间（秒）
 * 优先用 webtorrent 的 timeRemaining，否则用剩余字节 / 当前速度
 * @param {object} torrent webtorrent 实例
 * @returns {number|null} 剩余秒数；无法计算时返回 null
 */
function calcEta(torrent) {
    if (!torrent) return null;
    if (typeof torrent.timeRemaining === 'number' && isFinite(torrent.timeRemaining) && torrent.timeRemaining > 0) {
        return Math.round(torrent.timeRemaining / 1000);
    }
    const speed = Number(torrent.downloadSpeed || 0);
    const remaining = Number(torrent.length || 0) - Number(torrent.downloaded || 0);
    if (speed > 0 && remaining > 0) {
        return Math.round(remaining / speed);
    }
    return null;
}

/**
 * 根据文件扩展名获取Content-Type
 */
function getContentType(fileName) {
    const ext = path.extname(fileName).toLowerCase();
    const types = {
        '.mp4': 'video/mp4',
        '.mkv': 'video/x-matroska',
        '.avi': 'video/x-msvideo',
        '.mov': 'video/quicktime',
        '.wmv': 'video/x-ms-wmv',
        '.flv': 'video/x-flv',
        '.webm': 'video/webm',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.flac': 'audio/flac',
        '.aac': 'audio/aac'
    };
    return types[ext] || 'application/octet-stream';
}

/**
 * 销毁当前torrent和客户端
 */
function destroy() {
    if (streamPeerCheckInterval) {
        clearInterval(streamPeerCheckInterval);
        streamPeerCheckInterval = null;
    }
    if (fileServer) {
        try { fileServer.close(); } catch (e) { /* 忽略关闭错误 */ }
        fileServer = null;
    }
    if (currentTorrent) {
        try { currentTorrent.destroy(); } catch (e) { /* 忽略销毁错误 */ }
        currentTorrent = null;
    }
    if (client) {
        try { client.destroy(); } catch (e) { /* 忽略销毁错误 */ }
        client = null;
    }
    sendMessage({ type: 'destroyed' });
}

/**
 * 处理stdin消息
 */
process.stdin.setEncoding('utf8');
let inputBuffer = '';

process.stdin.on('data', chunk => {
    inputBuffer += chunk;
    const lines = inputBuffer.split('\n');
    inputBuffer = lines.pop(); // 保留未完成的行

    for (const line of lines) {
        if (!line.trim()) continue;
        try {
            const msg = JSON.parse(line);

            switch (msg.action) {
                case 'init':
                    // 主进程启动后立即发送：更新存储目录（默认是临时目录，主进程指定后改为应用数据目录）
                    if (msg.magnetDir) {
                        try {
                            if (!fs.existsSync(msg.magnetDir)) {
                                fs.mkdirSync(msg.magnetDir, { recursive: true });
                            }
                            MAGNET_DIR = msg.magnetDir;
                            sendMessage({ id: msg.id, type: 'initialized', magnetDir: MAGNET_DIR });
                        } catch (e) {
                            sendMessage({ id: msg.id, type: 'error', error: `设置存储目录失败: ${e.message}` });
                        }
                    } else {
                        sendMessage({ id: msg.id, type: 'initialized', magnetDir: MAGNET_DIR });
                    }
                    break;

                case 'resolve':
                    resolveMagnet(msg.magnetUri, msg.infoHash)
                        .then(files => {
                            sendMessage({ id: msg.id, type: 'files', files });
                        })
                        .catch(err => {
                            sendMessage({ id: msg.id, type: 'error', error: err.message });
                        });
                    break;

                case 'play':
                    playMagnetFile(msg.magnetUri, msg.fileName, msg.infoHash, msg.cachedTorrentPath)
                        .then(result => {
                            sendMessage({ id: msg.id, type: 'ready', streamUrl: result.streamUrl, isLocal: result.isLocal });
                        })
                        .catch(err => {
                            sendMessage({ id: msg.id, type: 'error', error: err.message });
                        });
                    break;

                case 'pause':
                    // 暂停指定 infoHash 的 torrent（未指定则回退到 currentTorrent 兼容旧调用）
                    // 找不到时返回 TORRENT_NOT_FOUND 码，主进程据此判断是软成功（已停）还是真错误
                    // 注意：webtorrent v2.x 的 client.get() 是 async 的，必须 await
                    {
                        const c = getClient();
                        const hash = (msg.infoHash || '').toLowerCase();
                        const lookup = hash ? c.get(hash) : Promise.resolve(currentTorrent);
                        Promise.resolve(lookup).then(torrent => {
                            if (torrent) {
                                try {
                                    torrent.pause();
                                    sendMagnetStatus(torrent.infoHash, {
                                        status: 'paused',
                                        fileName: msg.fileName || undefined
                                    });
                                    sendMessage({ id: msg.id, type: 'paused' });
                                } catch (e) {
                                    sendMessage({ id: msg.id, type: 'error', error: '暂停失败: ' + e.message });
                                }
                            } else {
                                // 子进程里没有这个 torrent（多见于播放器关闭后子进程被销毁）
                                // 返回 TORRENT_NOT_FOUND 码，渲染端应将 UI 状态直接置为 paused
                                sendMessage({
                                    id: msg.id,
                                    type: 'error',
                                    error: '当前没有活动的 torrent',
                                    code: 'TORRENT_NOT_FOUND'
                                });
                            }
                        }).catch(err => {
                            sendMessage({ id: msg.id, type: 'error', error: '查询 torrent 失败: ' + err.message });
                        });
                    }
                    break;

                case 'resume':
                    // 恢复指定 infoHash 的 torrent；找不到时返回 TORRENT_NOT_FOUND，
                    // 渲染端据此决定是否回退到 magnet-replay 重新启动（断点续传）
                    // 注意：webtorrent v2.x 的 client.get() 是 async 的，必须 await
                    {
                        const c = getClient();
                        const hash = (msg.infoHash || '').toLowerCase();
                        const lookup = hash ? c.get(hash) : Promise.resolve(currentTorrent);
                        Promise.resolve(lookup).then(torrent => {
                            if (torrent) {
                                try {
                                    torrent.resume();
                                    sendMagnetStatus(torrent.infoHash, {
                                        status: 'downloading',
                                        fileName: msg.fileName || undefined
                                    });
                                    sendMessage({ id: msg.id, type: 'resumed' });
                                } catch (e) {
                                    sendMessage({ id: msg.id, type: 'error', error: '恢复失败: ' + e.message });
                                }
                            } else {
                                sendMessage({
                                    id: msg.id,
                                    type: 'error',
                                    error: '当前没有活动的 torrent',
                                    code: 'TORRENT_NOT_FOUND'
                                });
                            }
                        }).catch(err => {
                            sendMessage({ id: msg.id, type: 'error', error: '查询 torrent 失败: ' + err.message });
                        });
                    }
                    break;

                case 'remove':
                    // 销毁指定 torrent（默认 currentTorrent，下载管理页可按 infoHash 精确删除）
                    // 关键：旧实现只支持删除 currentTorrent，但下载管理页可能同时有多个未播的 torrent
                    // infoHash 优先（精确删除）；空则回退到 currentTorrent
                    // 异步：data handler 本身是同步的（要处理 stdin buffer 切分），所以用 .then() 而不是 await
                    (async () => {
                        const targetHash = (msg.infoHash || '').toLowerCase();
                        let targetTorrent = null;
                        if (targetHash) {
                            const t = await Promise.resolve(c.get(targetHash));
                            if (t) targetTorrent = t;
                        }
                        if (!targetTorrent) {
                            targetTorrent = currentTorrent;
                        }
                        if (targetTorrent) {
                            try {
                                const hash = targetTorrent.infoHash;
                                targetTorrent.destroy({ destroyStore: true }, () => {
                                    sendMagnetStatus(hash, { status: 'removed' });
                                });
                                if (targetTorrent === currentTorrent) {
                                    currentTorrent = null;
                                }
                                sendMessage({ id: msg.id, type: 'removed' });
                            } catch (e) {
                                sendMessage({ id: msg.id, type: 'error', error: '删除失败: ' + e.message });
                            }
                        } else {
                            sendMessage({ id: msg.id, type: 'error', error: '当前没有活动的 torrent' });
                        }
                    })();
                    break;

                case 'destroy':
                    destroy();
                    break;

                default:
                    sendMessage({ id: msg.id, type: 'error', error: `未知操作: ${msg.action}` });
            }
        } catch (err) {
            sendMessage({ type: 'error', error: `消息解析失败: ${err.message}` });
        }
    }
});

process.stdin.on('end', () => {
    destroy();
});

// 进程退出时清理
process.on('exit', () => {
    destroy();
});

process.on('SIGINT', () => {
    destroy();
    process.exit(0);
});

sendMessage({ type: 'ready', message: '磁力链处理脚本已启动' });
