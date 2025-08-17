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

        // 搜索目标类型（扩展搜索范围以兼容更多设备）
        this.SEARCH_TARGETS = [
            'upnp:rootdevice',                               // 所有UPnP设备（最重要）
            'urn:schemas-upnp-org:device:MediaRenderer:1',  // DLNA媒体渲染器
            'urn:schemas-upnp-org:device:MediaRenderer:2',  // DLNA媒体渲染器v2
            'urn:schemas-upnp-org:device:MediaServer:1',    // DLNA媒体服务器
            'urn:schemas-upnp-org:service:AVTransport:1',   // AV传输服务
            'urn:schemas-upnp-org:service:AVTransport:2',   // AV传输服务v2
            'urn:schemas-upnp-org:service:RenderingControl:1', // 渲染控制服务
            'urn:schemas-upnp-org:service:ConnectionManager:1', // 连接管理服务
            'urn:dial-multiscreen-org:service:dial:1',      // DIAL协议（Chromecast等）
            'ssdp:all'                                      // 搜索所有SSDP设备
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

            // 首先设置事件监听器
            this.setupSocketEvents();

            // 绑定到随机端口并立即开始监听
            await new Promise((resolve, reject) => {
                this.socket.bind(0, '0.0.0.0', () => {
                    const address = this.socket.address();
                    console.log(`[DLNA] 套接字绑定成功，地址: ${address.address}:${address.port}`);

                    // 启用广播
                    this.socket.setBroadcast(true);
                    console.log('[DLNA] 已启用UDP广播');

                    resolve();
                });

                this.socket.once('error', reject);
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
            console.log(`[DLNA] ✅ 收到来自 ${rinfo.address}:${rinfo.port} 的响应，长度: ${msg.length} 字节`);
            console.log(`[DLNA] 消息内容预览: ${msg.toString().substring(0, 100)}...`);
            this.handleSSDPResponse(msg.toString(), rinfo);
        });

        this.socket.on('error', (error) => {
            console.error('[DLNA] 套接字错误:', error);
            this.stopDiscovery();
        });

        this.socket.on('listening', () => {
            const address = this.socket.address();
            console.log(`[DLNA] 套接字开始监听 ${address.address}:${address.port}`);
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
                'USER-AGENT: SimpleDiscovery/1.0',
                '',
                ''
            ].join('\r\n');

            const buffer = Buffer.from(searchMessage);

            console.log(`[DLNA] 准备发送搜索请求到 ${this.SSDP_ADDRESS}:${this.SSDP_PORT}`);
            console.log(`[DLNA] 搜索目标: ${searchTarget}`);
            console.log(`[DLNA] 消息长度: ${buffer.length} 字节`);
            console.log(`[DLNA] 完整消息:\n${searchMessage}`);

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
            console.log(`[DLNA] 收到来自 ${rinfo.address}:${rinfo.port} 的SSDP响应`);
            console.log('='.repeat(60));
            console.log(message);
            console.log('='.repeat(60));

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

            console.log('[DLNA] 解析的响应头:', headers);

            // 检查是否为有效的UPnP设备响应
            if (!headers['location']) {
                console.log('[DLNA] 缺少location头，跳过此响应');
                return;
            }

            // 更宽松的检查：只要有location就认为是有效设备
            const st = headers['st'] || headers['nt'] || 'unknown';
            console.log(`[DLNA] 发现设备类型: ${st}`);

            // 检查是否为NOTIFY消息（设备广播）
            const isNotify = message.startsWith('NOTIFY');
            const isResponse = message.startsWith('HTTP/1.1 200 OK');

            if (!isNotify && !isResponse) {
                console.log('[DLNA] 非标准响应格式，跳过');
                return;
            }

            // 提取设备UUID用于去重
            const usn = headers['usn'] || headers['nt'];
            let deviceUUID = null;
            if (usn) {
                // USN格式通常为: uuid:device-uuid::service-type 或 uuid:device-uuid::upnp:rootdevice
                const uuidMatch = usn.match(/uuid:([^:]+)/);
                if (uuidMatch) {
                    deviceUUID = uuidMatch[1];
                }
            }

            // 生成基于地址和UUID的设备ID（用于去重同一台设备）
            const deviceId = deviceUUID ? `${rinfo.address}_${deviceUUID}` : `${rinfo.address}_${Date.now()}`;

            // 检查是否为已知设备的新服务
            if (this.devices.has(deviceId)) {
                console.log(`[DLNA] 设备 ${deviceId} 已存在，更新服务信息`);
                this.updateDeviceServices(deviceId, headers);
                return;
            }

            console.log(`[DLNA] 发现新设备: ${rinfo.address} - ${st}`);

            // 解析设备信息（现在接受所有UPnP设备）
            this.parseDeviceInfo(deviceId, headers, rinfo);

        } catch (error) {
            console.warn('[DLNA] 解析SSDP响应失败:', error);
        }
    }

    // 解析设备信息
    async parseDeviceInfo(deviceId, headers, rinfo) {
        try {
            const st = headers['st'] || headers['nt'] || 'upnp:device';

            const device = {
                id: deviceId,
                address: rinfo.address,
                port: rinfo.port,
                location: headers['location'],
                st: st,
                usn: headers['usn'] || headers['nt'],
                server: headers['server'] || headers['user-agent'] || '未知设备',
                discoveredAt: new Date(),
                lastSeen: new Date(),
                type: this.getDeviceType(st),
                name: `网络设备 (${rinfo.address})`, // 默认名称
                icon: this.getDeviceIcon(st),
                status: 'available',
                protocol: 'dlna',
                supportedServices: new Set([st]) // 跟踪支持的服务类型
            };

            console.log(`[DLNA] 正在获取设备 ${rinfo.address} 的详细信息...`);

            // 尝试获取设备描述
            try {
                const deviceInfo = await this.fetchDeviceDescription(headers['location']);
                if (deviceInfo) {
                    device.name = deviceInfo.friendlyName || device.name;
                    device.manufacturer = deviceInfo.manufacturer;
                    device.modelName = deviceInfo.modelName;
                    device.modelDescription = deviceInfo.modelDescription;
                    device.services = deviceInfo.services;

                    console.log(`[DLNA] 设备详细信息获取成功: ${device.name}`);

                    // 更精确的设备类型判断
                    if (deviceInfo.deviceType) {
                        device.type = this.getDeviceTypeFromDescription(deviceInfo.deviceType);
                        device.icon = this.getDeviceIcon(deviceInfo.deviceType);
                    }

                    // 检查是否支持媒体渲染功能
                    if (deviceInfo.services) {
                        const hasAVTransport = deviceInfo.services.some(service =>
                            service.serviceType && service.serviceType.includes('AVTransport')
                        );
                        const hasRenderingControl = deviceInfo.services.some(service =>
                            service.serviceType && service.serviceType.includes('RenderingControl')
                        );

                        if (hasAVTransport && hasRenderingControl) {
                            device.type = 'DLNA媒体渲染器';
                            device.icon = '📺';
                            console.log(`[DLNA] 检测到完整的DLNA媒体渲染器: ${device.name}`);
                        } else if (hasAVTransport) {
                            device.type = 'DLNA兼容设备';
                            device.icon = '📱';
                            console.log(`[DLNA] 检测到DLNA兼容设备: ${device.name}`);
                        }
                    }
                } else {
                    console.warn(`[DLNA] 无法获取设备 ${rinfo.address} 的详细信息，使用基本信息`);
                    // 即使无法获取详细信息，也添加设备（可能仍然可以投屏）
                    device.name = `UPnP设备 (${rinfo.address})`;
                }
            } catch (error) {
                console.warn(`[DLNA] 获取设备描述失败 (${device.address}):`, error);
                // 即使获取描述失败，也保留设备
                device.name = `网络设备 (${rinfo.address})`;
                device.type = 'UPnP设备';
            }

            this.devices.set(deviceId, device);
            this.emit('deviceFound', device);

            console.log(`[DLNA] 设备已添加: ${device.name} (${device.address}) - ${device.type}`);

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
        console.log(`[DLNA] 获取设备描述: ${location}`);

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
                timeout: 8000, // 增加超时时间
                headers: {
                    'User-Agent': 'QiXing-ZhuiJu/1.2.5 UPnP/1.0',
                    'Accept': 'text/xml, application/xml',
                    'Connection': 'close'
                },
                maxRedirects: 3
            });

            console.log(`[DLNA] 设备描述获取成功，长度: ${response.data.length}`);
            return this.parseDeviceDescriptionXML(response.data);

        } catch (error) {
            console.warn(`[DLNA] 获取设备描述失败: ${error.message}`);

            // 如果是超时错误，尝试使用HTTP模块重试一次
            if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
                console.log('[DLNA] 超时，尝试使用HTTP模块重试...');
                try {
                    return await this.fetchDeviceDescriptionWithHttp(location);
                } catch (retryError) {
                    console.warn(`[DLNA] 重试也失败: ${retryError.message}`);
                }
            }

            return null;
        }
    }

    // 使用Node.js内置HTTP模块获取设备描述
    async fetchDeviceDescriptionWithHttp(location) {
        console.log(`[DLNA] 使用HTTP模块获取设备描述: ${location}`);

        return new Promise((resolve, reject) => {
            const url = new URL(location);
            const http = url.protocol === 'https:' ? require('https') : require('http');

            const options = {
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: url.pathname + (url.search || ''),
                method: 'GET',
                headers: {
                    'User-Agent': 'QiXing-ZhuiJu/1.2.5 UPnP/1.0',
                    'Accept': 'text/xml, application/xml',
                    'Connection': 'close'
                },
                timeout: 8000
            };

            console.log(`[DLNA] HTTP请求选项:`, {
                hostname: options.hostname,
                port: options.port,
                path: options.path
            });

            const req = http.request(options, (res) => {
                let data = '';

                console.log(`[DLNA] 设备描述响应状态: ${res.statusCode}`);

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    console.log(`[DLNA] 设备描述接收完成，长度: ${data.length}`);
                    try {
                        const deviceInfo = this.parseDeviceDescriptionXML(data);
                        resolve(deviceInfo);
                    } catch (error) {
                        console.error(`[DLNA] 解析设备描述失败: ${error.message}`);
                        reject(error);
                    }
                });
            });

            req.on('error', (error) => {
                console.error(`[DLNA] HTTP请求错误: ${error.message}`);
                reject(error);
            });

            req.on('timeout', () => {
                console.error('[DLNA] HTTP请求超时');
                req.destroy();
                reject(new Error('设备描述请求超时'));
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
        console.log(`[DLNA] 媒体URL: ${mediaUrl}`);
        console.log(`[DLNA] 设备详情:`, {
            id: device.id,
            address: device.address,
            location: device.location,
            services: device.services
        });

        try {
            // 首先验证设备是否仍然可达
            await this.validateDevice(device);

            // 查找AVTransport服务
            let avTransportService = null;

            if (device.services && device.services.length > 0) {
                avTransportService = device.services.find(service =>
                    service.serviceType && service.serviceType.includes('AVTransport')
                );
            }

            // 如果没有找到服务，尝试使用正确的控制URL（基于设备描述XML）
            if (!avTransportService) {
                console.log('[DLNA] 未找到AVTransport服务，尝试获取设备描述并解析服务');

                // 重新获取设备描述以确保有服务信息
                const freshDeviceInfo = await this.fetchDeviceDescription(device.location);
                if (freshDeviceInfo && freshDeviceInfo.services) {
                    device.services = freshDeviceInfo.services;

                    avTransportService = freshDeviceInfo.services.find(service =>
                        service.serviceType && service.serviceType.includes('AVTransport')
                    );
                }

                // 如果还是没有找到，使用默认路径
                if (!avTransportService) {
                    console.log('[DLNA] 仍未找到AVTransport服务，使用默认路径');
                    avTransportService = {
                        serviceType: 'urn:schemas-upnp-org:service:AVTransport:1',
                        controlURL: '_urn:schemas-upnp-org:service:AVTransport_control'
                    };
                }
            }

            console.log(`[DLNA] 使用AVTransport服务:`, avTransportService);

            // 构建控制URL
            const controlUrl = this.buildControlUrl(device.location, avTransportService.controlURL);
            console.log(`[DLNA] 控制URL: ${controlUrl}`);

            // 发送SetAVTransportURI请求（带重试）
            const setUriResult = await this.sendSetAVTransportURIWithRetry(controlUrl, mediaUrl, metadata);

            if (setUriResult.success) {
                // 等待一下让设备准备好
                await new Promise(resolve => setTimeout(resolve, 1000));

                // 开始播放（带重试）
                const playResult = await this.sendPlayWithRetry(controlUrl);

                if (playResult.success) {
                    console.log(`[DLNA] 投屏成功: ${device.name}`);
                    return { success: true, device: device };
                } else {
                    console.warn(`[DLNA] 播放命令失败，但URI设置成功: ${playResult.error}`);
                    // 即使播放命令失败，URI设置成功也算部分成功
                    return { success: true, device: device, warning: '播放可能需要手动开始' };
                }
            } else {
                // 提供更详细的错误信息
                const errorMsg = setUriResult.error || '设置媒体URI失败';
                console.error(`[DLNA] SetAVTransportURI失败: ${errorMsg}`);
                console.error(`[DLNA] 状态码: ${setUriResult.statusCode}`);

                // 根据错误类型提供解决建议
                if (errorMsg.includes('UPnP错误码: 501')) {
                    throw new Error('设备操作失败：媒体URL为空或无效，请确保视频正在播放且为直接视频链接');
                } else if (errorMsg.includes('UPnP错误码: 718')) {
                    throw new Error('设备不支持此媒体格式，请尝试其他播放线路');
                } else if (errorMsg.includes('UPnP错误码: 714')) {
                    throw new Error('媒体URL无效或设备无法访问，请检查网络连接');
                } else if (errorMsg.includes('UPnP错误码: 701')) {
                    throw new Error('设备转换错误，请重试或尝试其他设备');
                } else {
                    throw new Error(`${errorMsg}`);
                }
            }

        } catch (error) {
            console.error(`[DLNA] 投屏失败: ${error.message}`);
            console.error(`[DLNA] 错误详情:`, error);
            throw error;
        }
    }

    // 验证设备是否仍然可达
    async validateDevice(device) {
        console.log(`[DLNA] 验证设备连接: ${device.name} (${device.address})`);

        try {
            // 尝试重新获取设备描述以验证设备是否仍然可达
            const deviceInfo = await this.fetchDeviceDescription(device.location);
            if (!deviceInfo) {
                throw new Error('设备无响应或已离线');
            }

            console.log(`[DLNA] 设备验证成功: ${device.name}`);
            return true;

        } catch (error) {
            console.warn(`[DLNA] 设备验证失败: ${error.message}`);
            throw new Error(`设备 ${device.name} 当前不可达，请检查网络连接`);
        }
    }

    // 带重试的SetAVTransportURI请求
    async sendSetAVTransportURIWithRetry(controlUrl, mediaUrl, metadata, maxRetries = 2) {
        console.log(`[DLNA] 发送SetAVTransportURI请求 (最大重试: ${maxRetries})`);

        for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
            try {
                console.log(`[DLNA] SetAVTransportURI 尝试 ${attempt}/${maxRetries + 1}`);
                const result = await this.sendSetAVTransportURI(controlUrl, mediaUrl, metadata);

                if (result.success) {
                    console.log(`[DLNA] SetAVTransportURI 成功 (尝试 ${attempt})`);
                    return result;
                }

                // 如果不是最后一次尝试，等待后重试
                if (attempt <= maxRetries) {
                    console.log(`[DLNA] SetAVTransportURI 失败，等待 ${attempt * 1000}ms 后重试: ${result.error}`);
                    await new Promise(resolve => setTimeout(resolve, attempt * 1000));
                } else {
                    return result; // 返回最后的失败结果
                }

            } catch (error) {
                console.error(`[DLNA] SetAVTransportURI 尝试 ${attempt} 出错:`, error);

                if (attempt <= maxRetries) {
                    console.log(`[DLNA] 等待 ${attempt * 1000}ms 后重试`);
                    await new Promise(resolve => setTimeout(resolve, attempt * 1000));
                } else {
                    throw error; // 抛出最后的错误
                }
            }
        }
    }

    // 带重试的Play请求
    async sendPlayWithRetry(controlUrl, maxRetries = 2) {
        console.log(`[DLNA] 发送Play请求 (最大重试: ${maxRetries})`);

        for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
            try {
                console.log(`[DLNA] Play 尝试 ${attempt}/${maxRetries + 1}`);
                const result = await this.sendPlay(controlUrl);

                if (result.success) {
                    console.log(`[DLNA] Play 成功 (尝试 ${attempt})`);
                    return result;
                }

                // 如果不是最后一次尝试，等待后重试
                if (attempt <= maxRetries) {
                    console.log(`[DLNA] Play 失败，等待 ${attempt * 500}ms 后重试: ${result.error}`);
                    await new Promise(resolve => setTimeout(resolve, attempt * 500));
                } else {
                    return result; // 返回最后的失败结果
                }

            } catch (error) {
                console.error(`[DLNA] Play 尝试 ${attempt} 出错:`, error);

                if (attempt <= maxRetries) {
                    console.log(`[DLNA] 等待 ${attempt * 500}ms 后重试`);
                    await new Promise(resolve => setTimeout(resolve, attempt * 500));
                } else {
                    throw error; // 抛出最后的错误
                }
            }
        }
    }

    // 构建控制URL
    buildControlUrl(deviceLocation, controlPath) {
        try {
            console.log(`[DLNA] 构建控制URL - 设备位置: ${deviceLocation}, 控制路径: ${controlPath}`);

            const deviceUrl = new URL(deviceLocation);
            let controlUrl;

            if (controlPath.startsWith('http')) {
                // 绝对URL
                controlUrl = controlPath;
            } else if (controlPath.startsWith('/')) {
                // 根路径
                controlUrl = `${deviceUrl.protocol}//${deviceUrl.host}${controlPath}`;
            } else {
                // 相对路径 - 基于设备的主机地址，而不是description.xml路径
                controlUrl = `${deviceUrl.protocol}//${deviceUrl.host}/${controlPath}`;
            }

            console.log(`[DLNA] 构建的控制URL: ${controlUrl}`);
            return controlUrl;

        } catch (error) {
            console.error(`[DLNA] 构建控制URL失败:`, error);
            throw new Error(`无效的控制URL: ${error.message}`);
        }
    }
    // 发送SetAVTransportURI SOAP请求
    async sendSetAVTransportURI(controlUrl, mediaUrl, metadata) {
        console.log(`[DLNA] 发送SetAVTransportURI请求到: ${controlUrl}`);
        console.log(`[DLNA] 媒体URL: ${mediaUrl}`);

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

        console.log(`[DLNA] SOAP请求体:`, soapBody);
        return await this.sendSOAPRequest(controlUrl, soapAction, soapBody);
    }

    // 发送Play SOAP请求
    async sendPlay(controlUrl) {
        console.log(`[DLNA] 发送Play请求到: ${controlUrl}`);

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

        console.log(`[DLNA] Play SOAP请求体:`, soapBody);
        return await this.sendSOAPRequest(controlUrl, soapAction, soapBody);
    }

    // 发送SOAP请求（改进版，增加更好的错误处理）
    async sendSOAPRequest(url, soapAction, soapBody) {
        console.log(`[DLNA] 发送SOAP请求: ${soapAction} -> ${url}`);

        return new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const http = urlObj.protocol === 'https:' ? require('https') : require('http');

            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
                path: urlObj.pathname + (urlObj.search || ''),
                method: 'POST',
                headers: {
                    'Content-Type': 'text/xml; charset="utf-8"',
                    'Content-Length': Buffer.byteLength(soapBody),
                    'SOAPAction': `"${soapAction}"`,
                    'User-Agent': 'QiXing-ZhuiJu/1.2.5 UPnP/1.0',
                    'Connection': 'close'
                },
                timeout: 15000 // 增加超时时间到15秒
            };

            console.log(`[DLNA] 请求选项:`, {
                hostname: options.hostname,
                port: options.port,
                path: options.path,
                method: options.method,
                headers: options.headers
            });

            const req = http.request(options, (res) => {
                let data = '';

                console.log(`[DLNA] 收到响应状态: ${res.statusCode} ${res.statusMessage}`);
                console.log(`[DLNA] 响应头:`, res.headers);

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    console.log(`[DLNA] 响应完成，数据长度: ${data.length}`);
                    console.log(`[DLNA] 响应内容:`, data);

                    if (res.statusCode === 200) {
                        resolve({ success: true, response: data, statusCode: res.statusCode });
                    } else {
                        const errorMsg = `HTTP ${res.statusCode}: ${res.statusMessage || 'Unknown error'}`;
                        console.error(`[DLNA] HTTP错误: ${errorMsg}`);
                        console.error(`[DLNA] 错误响应内容: ${data}`);

                        // 检查是否是SOAP错误
                        if (data.includes('soap:Fault') || data.includes('s:Fault')) {
                            const faultMatch = data.match(/<faultstring[^>]*>([^<]+)<\/faultstring>/i) ||
                                data.match(/<soap:faultstring[^>]*>([^<]+)<\/soap:faultstring>/i);

                            // 尝试提取UPnP错误码
                            const errorCodeMatch = data.match(/<errorCode>(\d+)<\/errorCode>/i);
                            const errorDescMatch = data.match(/<errorDescription>([^<]+)<\/errorDescription>/i);

                            let faultMsg = faultMatch ? faultMatch[1] : '未知SOAP错误';

                            // 如果有UPnP错误信息，添加到错误消息中
                            if (errorCodeMatch || errorDescMatch) {
                                const errorCode = errorCodeMatch ? errorCodeMatch[1] : '未知';
                                const errorDesc = errorDescMatch ? errorDescMatch[1] : '无描述';
                                faultMsg += ` (UPnP错误码: ${errorCode}, 描述: ${errorDesc})`;
                            }

                            console.error(`[DLNA] SOAP Fault详情: ${faultMsg}`);
                            console.error(`[DLNA] 完整SOAP响应: ${data}`);
                            resolve({ success: false, error: `SOAP错误: ${faultMsg}`, statusCode: res.statusCode });
                        } else {
                            resolve({ success: false, error: errorMsg, statusCode: res.statusCode, response: data });
                        }
                    }
                });
            });

            req.on('error', (error) => {
                console.error(`[DLNA] 请求错误:`, error);
                reject(new Error(`网络请求失败: ${error.message}`));
            });

            req.on('timeout', () => {
                console.error('[DLNA] 请求超时');
                req.destroy();
                reject(new Error('SOAP请求超时，设备可能无响应'));
            });

            try {
                req.write(soapBody);
                req.end();
            } catch (error) {
                console.error(`[DLNA] 发送请求失败:`, error);
                reject(new Error(`发送SOAP请求失败: ${error.message}`));
            }
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
