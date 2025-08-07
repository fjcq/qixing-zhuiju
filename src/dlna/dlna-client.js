// DLNA客户端 - 支持真正的DLNA/UPnP设备发现和投屏
const dgram = require('dgram');
const { EventEmitter } = require('events');

class DLNAClient extends EventEmitter {
    constructor() {
        super();
        this.devices = new Map();
        this.socket = null;
        this.isScanning = false;
        this.scanTimeout = null;

        // SSDP多播地址和端口
        this.SSDP_ADDRESS = '239.255.255.250';
        this.SSDP_PORT = 1900;

        // 搜索目标类型
        this.SEARCH_TARGETS = [
            'urn:schemas-upnp-org:device:MediaRenderer:1',  // DLNA媒体渲染器
            'urn:schemas-upnp-org:service:AVTransport:1',   // AV传输服务
            'urn:schemas-upnp-org:service:RenderingControl:1', // 渲染控制服务
            'urn:dial-multiscreen-org:service:dial:1',      // DIAL协议（Chromecast等）
            'upnp:rootdevice'                               // 所有UPnP设备
        ];
    }

    // 开始搜索DLNA设备
    async startDiscovery(timeout = 10000) {
        console.log('[DLNA] 开始搜索DLNA设备...');

        try {
            this.devices.clear();
            this.isScanning = true;

            // 创建UDP套接字
            this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

            // 绑定套接字事件
            this.setupSocketEvents();

            // 绑定到随机端口
            await new Promise((resolve, reject) => {
                this.socket.bind(0, '0.0.0.0', () => {
                    const address = this.socket.address();
                    console.log(`[DLNA] 套接字绑定成功，地址: ${address.address}:${address.port}`);

                    // 启用广播
                    this.socket.setBroadcast(true);
                    console.log('[DLNA] 已启用UDP广播');

                    resolve();
                });

                this.socket.on('error', reject);
            });

            // 发送搜索请求
            await this.sendSearchRequests();

            // 设置搜索超时
            this.scanTimeout = setTimeout(() => {
                console.log('[DLNA] 搜索超时，停止发现');
                this.stopDiscovery();
            }, timeout);

            // 设置设备发现最少延迟时间（给设备响应时间）
            setTimeout(() => {
                console.log('[DLNA] 最少延迟时间已过，检查是否有设备响应');
                if (this.devices.size > 0) {
                    console.log(`[DLNA] 已发现 ${this.devices.size} 个设备，考虑提前结束发现`);
                    // 如果已经发现设备，再等待1秒后结束
                    setTimeout(() => {
                        if (this.isScanning) {
                            console.log('[DLNA] 提前结束设备发现');
                            this.stopDiscovery();
                        }
                    }, 1000);
                }
            }, Math.min(3000, timeout / 2)); // 至少等待3秒或超时时间的一半

            return true;

        } catch (error) {
            console.error('[DLNA] 设备搜索启动失败:', error);
            this.stopDiscovery();
            throw error;
        }
    }

    // 停止搜索
    stopDiscovery() {
        console.log('[DLNA] 停止设备搜索');

        this.isScanning = false;

        if (this.scanTimeout) {
            clearTimeout(this.scanTimeout);
            this.scanTimeout = null;
        }

        if (this.socket) {
            try {
                this.socket.close();
            } catch (error) {
                console.warn('[DLNA] 关闭套接字失败:', error);
            }
            this.socket = null;
        }

        this.emit('discoveryComplete', Array.from(this.devices.values()));
    }

    // 设置套接字事件监听
    setupSocketEvents() {
        this.socket.on('message', (msg, rinfo) => {
            console.log(`[DLNA] 收到来自 ${rinfo.address}:${rinfo.port} 的响应，长度: ${msg.length} 字节`);
            this.handleSSDPResponse(msg.toString(), rinfo);
        });

        this.socket.on('error', (error) => {
            console.error('[DLNA] 套接字错误:', error);
            this.stopDiscovery();
        });

        this.socket.on('listening', () => {
            console.log('[DLNA] 套接字开始监听');
        });

        this.socket.on('close', () => {
            console.log('[DLNA] 套接字已关闭');
        });
    }

    // 发送SSDP搜索请求
    async sendSearchRequests() {
        console.log('[DLNA] 开始发送SSDP搜索请求...');

        // 先进行网络诊断
        await this.performNetworkDiagnostics();

        const promises = this.SEARCH_TARGETS.map(target =>
            this.sendSearchRequest(target)
        );

        await Promise.all(promises);
        console.log(`[DLNA] 已发送 ${this.SEARCH_TARGETS.length} 个搜索请求`);
    }

    // 网络诊断
    async performNetworkDiagnostics() {
        try {
            const os = require('os');
            const networkInterfaces = os.networkInterfaces();

            console.log('[DLNA] 网络接口信息:');
            Object.keys(networkInterfaces).forEach(interfaceName => {
                const interfaces = networkInterfaces[interfaceName];
                interfaces.forEach(iface => {
                    if (iface.family === 'IPv4' && !iface.internal) {
                        console.log(`[DLNA] - ${interfaceName}: ${iface.address} (${iface.mac})`);
                    }
                });
            });

            // 检查套接字状态
            if (this.socket) {
                const address = this.socket.address();
                console.log(`[DLNA] 套接字绑定到: ${address.address}:${address.port}`);
            }

        } catch (error) {
            console.warn('[DLNA] 网络诊断失败:', error);
        }
    }

    // 发送单个搜索请求
    sendSearchRequest(searchTarget) {
        return new Promise((resolve, reject) => {
            const searchMessage = [
                'M-SEARCH * HTTP/1.1',
                `HOST: ${this.SSDP_ADDRESS}:${this.SSDP_PORT}`,
                'MAN: "ssdp:discover"',
                'MX: 3',
                `ST: ${searchTarget}`,
                'USER-AGENT: QiXing-ZhuiJu/1.2.5 UPnP/1.0',
                '',
                ''
            ].join('\r\n');

            const buffer = Buffer.from(searchMessage);

            console.log(`[DLNA] 准备发送搜索请求到 ${this.SSDP_ADDRESS}:${this.SSDP_PORT}`);
            console.log(`[DLNA] 搜索目标: ${searchTarget}`);
            console.log(`[DLNA] 消息长度: ${buffer.length} 字节`);

            this.socket.send(buffer, this.SSDP_PORT, this.SSDP_ADDRESS, (error) => {
                if (error) {
                    console.error(`[DLNA] 发送搜索请求失败 (${searchTarget}):`, error);
                    reject(error);
                } else {
                    console.log(`[DLNA] 搜索请求已发送: ${searchTarget}`);
                    resolve();
                }
            });
        });
    }

    // 处理SSDP响应
    handleSSDPResponse(message, rinfo) {
        try {
            console.log(`[DLNA] 处理来自 ${rinfo.address} 的SSDP响应:`);
            console.log('='.repeat(50));
            console.log(message);
            console.log('='.repeat(50));

            const lines = message.split('\r\n');
            const headers = {};

            // 解析HTTP头
            lines.forEach(line => {
                const colonIndex = line.indexOf(':');
                if (colonIndex > 0) {
                    const key = line.substring(0, colonIndex).toLowerCase().trim();
                    const value = line.substring(colonIndex + 1).trim();
                    headers[key] = value;
                }
            });

            console.log('[DLNA] 解析的头部信息:', headers);

            // 检查是否为有效的UPnP设备响应
            if (!headers['location']) {
                console.log('[DLNA] 缺少location头，跳过此响应');
                return;
            }

            if (!headers['st']) {
                console.log('[DLNA] 缺少st头，跳过此响应');
                return;
            }

            // 提取设备UUID用于去重
            const usn = headers['usn'];
            let deviceUUID = null;
            if (usn) {
                // USN格式通常为: uuid:device-uuid::service-type 或 uuid:device-uuid::upnp:rootdevice
                const uuidMatch = usn.match(/uuid:([^:]+)/);
                if (uuidMatch) {
                    deviceUUID = uuidMatch[1];
                }
            }

            // 生成基于地址和UUID的设备ID（用于去重同一台设备）
            const deviceId = deviceUUID ? `${rinfo.address}_${deviceUUID}` : `${rinfo.address}_${headers['location']}`;

            // 检查是否为已知设备的新服务
            if (this.devices.has(deviceId)) {
                console.log(`[DLNA] 设备 ${deviceId} 已存在，更新服务信息`);
                this.updateDeviceServices(deviceId, headers);
                return;
            }

            console.log(`[DLNA] 发现新设备: ${rinfo.address} - ${headers['st']}`);

            // 解析设备信息
            this.parseDeviceInfo(deviceId, headers, rinfo);

        } catch (error) {
            console.warn('[DLNA] 解析SSDP响应失败:', error);
        }
    }

    // 解析设备信息
    async parseDeviceInfo(deviceId, headers, rinfo) {
        try {
            const device = {
                id: deviceId,
                address: rinfo.address,
                port: rinfo.port,
                location: headers['location'],
                st: headers['st'],
                usn: headers['usn'],
                server: headers['server'],
                discoveredAt: new Date(),
                lastSeen: new Date(),
                type: this.getDeviceType(headers['st']),
                name: 'DLNA设备',
                icon: this.getDeviceIcon(headers['st']),
                status: 'available',
                protocol: 'dlna',
                supportedServices: new Set([headers['st']]) // 跟踪支持的服务类型
            };

            // 尝试获取设备描述
            try {
                const deviceInfo = await this.fetchDeviceDescription(headers['location']);
                if (deviceInfo) {
                    device.name = deviceInfo.friendlyName || device.name;
                    device.manufacturer = deviceInfo.manufacturer;
                    device.modelName = deviceInfo.modelName;
                    device.modelDescription = deviceInfo.modelDescription;
                    device.services = deviceInfo.services;

                    // 更精确的设备类型判断
                    if (deviceInfo.deviceType) {
                        device.type = this.getDeviceTypeFromDescription(deviceInfo.deviceType);
                        device.icon = this.getDeviceIcon(deviceInfo.deviceType);
                    }
                }
            } catch (error) {
                console.warn(`[DLNA] 获取设备描述失败 (${device.address}):`, error);
            }

            this.devices.set(deviceId, device);
            this.emit('deviceFound', device);

            console.log(`[DLNA] 设备已添加: ${device.name} (${device.address})`);

        } catch (error) {
            console.error('[DLNA] 解析设备信息失败:', error);
        }
    }

    // 更新已存在设备的服务信息
    updateDeviceServices(deviceId, headers) {
        try {
            const device = this.devices.get(deviceId);
            if (!device) {
                console.warn(`[DLNA] 尝试更新不存在的设备: ${deviceId}`);
                return;
            }

            // 初始化服务数组（如果不存在）
            if (!device.supportedServices) {
                device.supportedServices = new Set();
            }

            // 添加新发现的服务类型
            const serviceType = headers['st'];
            if (serviceType) {
                device.supportedServices.add(serviceType);
                console.log(`[DLNA] 为设备 ${device.name} 添加服务: ${serviceType}`);
            }

            // 更新设备的最后发现时间
            device.lastSeen = new Date();

            // 更新设备信息到Map中
            this.devices.set(deviceId, device);

            console.log(`[DLNA] 设备 ${device.name} 服务信息已更新，支持的服务数量: ${device.supportedServices.size}`);

        } catch (error) {
            console.error('[DLNA] 更新设备服务失败:', error);
        }
    }

    // 获取设备描述XML
    async fetchDeviceDescription(location) {
        try {
            // 使用动态导入或require来加载axios
            let axios;
            try {
                axios = require('axios');
            } catch (error) {
                // 如果axios不可用，使用Node.js内置的http模块
                return await this.fetchDeviceDescriptionWithHttp(location);
            }

            const response = await axios.get(location, {
                timeout: 5000,
                headers: {
                    'User-Agent': 'QiXing-ZhuiJu/1.2.5 UPnP/1.0'
                }
            });

            return this.parseDeviceDescriptionXML(response.data);

        } catch (error) {
            console.warn('[DLNA] 获取设备描述失败:', error);
            return null;
        }
    }

    // 使用Node.js内置HTTP模块获取设备描述
    async fetchDeviceDescriptionWithHttp(location) {
        return new Promise((resolve, reject) => {
            const url = new URL(location);
            const http = url.protocol === 'https:' ? require('https') : require('http');

            const options = {
                hostname: url.hostname,
                port: url.port,
                path: url.pathname + url.search,
                method: 'GET',
                headers: {
                    'User-Agent': 'QiXing-ZhuiJu/1.2.5 UPnP/1.0'
                },
                timeout: 5000
            };

            const req = http.request(options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        const deviceInfo = this.parseDeviceDescriptionXML(data);
                        resolve(deviceInfo);
                    } catch (error) {
                        reject(error);
                    }
                });
            });

            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('请求超时'));
            });

            req.end();
        });
    }

    // 解析设备描述XML（简化实现）
    parseDeviceDescriptionXML(xml) {
        try {
            const deviceInfo = {};

            // 提取友好名称
            const friendlyNameMatch = xml.match(/<friendlyName[^>]*>([^<]+)<\/friendlyName>/i);
            if (friendlyNameMatch) {
                deviceInfo.friendlyName = friendlyNameMatch[1].trim();
            }

            // 提取制造商
            const manufacturerMatch = xml.match(/<manufacturer[^>]*>([^<]+)<\/manufacturer>/i);
            if (manufacturerMatch) {
                deviceInfo.manufacturer = manufacturerMatch[1].trim();
            }

            // 提取型号名称
            const modelNameMatch = xml.match(/<modelName[^>]*>([^<]+)<\/modelName>/i);
            if (modelNameMatch) {
                deviceInfo.modelName = modelNameMatch[1].trim();
            }

            // 提取型号描述
            const modelDescMatch = xml.match(/<modelDescription[^>]*>([^<]+)<\/modelDescription>/i);
            if (modelDescMatch) {
                deviceInfo.modelDescription = modelDescMatch[1].trim();
            }

            // 提取设备类型
            const deviceTypeMatch = xml.match(/<deviceType[^>]*>([^<]+)<\/deviceType>/i);
            if (deviceTypeMatch) {
                deviceInfo.deviceType = deviceTypeMatch[1].trim();
            }

            // 提取服务列表
            const serviceMatches = xml.match(/<service[^>]*>.*?<\/service>/gi);
            if (serviceMatches) {
                deviceInfo.services = serviceMatches.map(serviceXml => {
                    const serviceTypeMatch = serviceXml.match(/<serviceType[^>]*>([^<]+)<\/serviceType>/i);
                    const controlURLMatch = serviceXml.match(/<controlURL[^>]*>([^<]+)<\/controlURL>/i);

                    return {
                        serviceType: serviceTypeMatch ? serviceTypeMatch[1].trim() : '',
                        controlURL: controlURLMatch ? controlURLMatch[1].trim() : ''
                    };
                });
            }

            return deviceInfo;

        } catch (error) {
            console.warn('[DLNA] 解析设备描述XML失败:', error);
            return null;
        }
    }

    // 根据服务类型确定设备类型
    getDeviceType(st) {
        if (st.includes('MediaRenderer')) {
            return 'DLNA媒体渲染器';
        } else if (st.includes('dial')) {
            return 'Chromecast';
        } else if (st.includes('AVTransport')) {
            return 'DLNA设备';
        } else if (st.includes('RenderingControl')) {
            return 'DLNA控制器';
        } else {
            return 'UPnP设备';
        }
    }

    // 根据设备描述确定更精确的设备类型
    getDeviceTypeFromDescription(deviceType) {
        if (deviceType.includes('MediaRenderer')) {
            return 'DLNA媒体渲染器';
        } else if (deviceType.includes('MediaServer')) {
            return 'DLNA媒体服务器';
        } else if (deviceType.includes('InternetGateway')) {
            return '网关设备';
        } else {
            return 'UPnP设备';
        }
    }

    // 获取设备图标
    getDeviceIcon(type) {
        if (type.includes('MediaRenderer') || type.includes('dial')) {
            return '📺';
        } else if (type.includes('MediaServer')) {
            return '💿';
        } else if (type.includes('InternetGateway')) {
            return '🌐';
        } else {
            return '📱';
        }
    }

    // 获取所有发现的设备
    getDevices() {
        return Array.from(this.devices.values());
    }

    // 投屏到DLNA设备
    async castToDevice(deviceId, mediaUrl, metadata = {}) {
        const device = this.devices.get(deviceId);
        if (!device) {
            throw new Error('设备不存在');
        }

        console.log(`[DLNA] 开始投屏到设备: ${device.name} (${device.address})`);

        try {
            // 检查设备是否支持AVTransport服务
            const avTransportService = device.services?.find(service =>
                service.serviceType.includes('AVTransport')
            );

            if (!avTransportService) {
                throw new Error('设备不支持媒体传输服务');
            }

            // 构建控制URL
            const controlUrl = this.buildControlUrl(device.location, avTransportService.controlURL);

            // 发送SetAVTransportURI请求
            const result = await this.sendSetAVTransportURI(controlUrl, mediaUrl, metadata);

            if (result.success) {
                // 开始播放
                await this.sendPlay(controlUrl);
                console.log(`[DLNA] 投屏成功: ${device.name}`);
                return { success: true, device: device };
            } else {
                throw new Error(result.error || '投屏失败');
            }

        } catch (error) {
            console.error(`[DLNA] 投屏失败: ${error.message}`);
            throw error;
        }
    }

    // 构建控制URL
    buildControlUrl(deviceLocation, controlPath) {
        try {
            const deviceUrl = new URL(deviceLocation);
            if (controlPath.startsWith('http')) {
                return controlPath;
            } else if (controlPath.startsWith('/')) {
                return `${deviceUrl.protocol}//${deviceUrl.host}${controlPath}`;
            } else {
                return `${deviceUrl.protocol}//${deviceUrl.host}/${controlPath}`;
            }
        } catch (error) {
            throw new Error(`无效的控制URL: ${error.message}`);
        }
    }

    // 发送SetAVTransportURI SOAP请求
    async sendSetAVTransportURI(controlUrl, mediaUrl, metadata) {
        const soapAction = 'urn:schemas-upnp-org:service:AVTransport:1#SetAVTransportURI';

        const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
    <s:Body>
        <u:SetAVTransportURI xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
            <InstanceID>0</InstanceID>
            <CurrentURI>${this.escapeXml(mediaUrl)}</CurrentURI>
            <CurrentURIMetaData>${this.escapeXml(this.buildMetadata(metadata))}</CurrentURIMetaData>
        </u:SetAVTransportURI>
    </s:Body>
</s:Envelope>`;

        return await this.sendSOAPRequest(controlUrl, soapAction, soapBody);
    }

    // 发送Play SOAP请求
    async sendPlay(controlUrl) {
        const soapAction = 'urn:schemas-upnp-org:service:AVTransport:1#Play';

        const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
    <s:Body>
        <u:Play xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
            <InstanceID>0</InstanceID>
            <Speed>1</Speed>
        </u:Play>
    </s:Body>
</s:Envelope>`;

        return await this.sendSOAPRequest(controlUrl, soapAction, soapBody);
    }

    // 发送SOAP请求
    async sendSOAPRequest(url, soapAction, soapBody) {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const http = urlObj.protocol === 'https:' ? require('https') : require('http');

            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port,
                path: urlObj.pathname + urlObj.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'text/xml; charset="utf-8"',
                    'Content-Length': Buffer.byteLength(soapBody),
                    'SOAPAction': `"${soapAction}"`,
                    'User-Agent': 'QiXing-ZhuiJu/1.2.5 UPnP/1.0'
                },
                timeout: 10000
            };

            const req = http.request(options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    if (res.statusCode === 200) {
                        resolve({ success: true, response: data });
                    } else {
                        resolve({ success: false, error: `HTTP ${res.statusCode}: ${data}` });
                    }
                });
            });

            req.on('error', (error) => {
                reject(error);
            });

            req.on('timeout', () => {
                req.destroy();
                reject(new Error('SOAP请求超时'));
            });

            req.write(soapBody);
            req.end();
        });
    }

    // 构建DIDL-Lite元数据
    buildMetadata(metadata) {
        const title = metadata.title || '未知标题';
        const artist = metadata.artist || '未知艺术家';
        const album = metadata.album || '未知专辑';

        return `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">
    <item id="1" parentID="0" restricted="1">
        <dc:title>${this.escapeXml(title)}</dc:title>
        <dc:creator>${this.escapeXml(artist)}</dc:creator>
        <upnp:album>${this.escapeXml(album)}</upnp:album>
        <upnp:class>object.item.videoItem</upnp:class>
    </item>
</DIDL-Lite>`;
    }

    // XML转义
    escapeXml(text) {
        if (typeof text !== 'string') {
            return '';
        }

        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;');
    }
}

module.exports = DLNAClient;
