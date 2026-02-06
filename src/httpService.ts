import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    BASE_PORT,
    MAX_PORT_ATTEMPTS,
    LOCAL_DIR_NAME,
    DEFAULT_REQUEST_TIMEOUT_MS,
    MAX_REQUEST_BODY_SIZE,
    ERROR_MESSAGES
} from './constants';

export interface RequestData {
    prompt: string;
    requestId: string;
    timeoutMinutes?: number;
}

interface ErrorResponse {
    action: 'error';
    error: string;
    text: string;
    images: string[];
}

interface TimeoutResponse {
    action: 'timeout_continue';
    message: string;
    text: string;
    images: string[];
}

const MS_PER_MINUTE = 60 * 1000;

export class HttpService {
    private server: http.Server | null = null;
    private port: number = 0;
    private pendingRequests: Map<string, {
        res: http.ServerResponse,
        timer: NodeJS.Timeout | undefined,
        createdAt: number,
        initialTimeoutMinutes: number
    }> = new Map();
    private triedPorts: Set<number> = new Set();
    private connectionCheckInterval?: NodeJS.Timeout;
    private getTimeoutMinutes: () => number;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly onRequest: (data: RequestData) => Promise<void>,
        getTimeoutMinutes: () => number
    ) {
        this.getTimeoutMinutes = getTimeoutMinutes;
    }

    public getPort(): number {
        return this.port;
    }

    public async start(): Promise<number> {
        this.cleanupAllPortFiles();
        this.server = http.createServer((req, res) => this.handleIncomingRequest(req, res));

        // 设置服务器超时时间为0（不限制）
        this.server.timeout = 0;
        this.server.keepAliveTimeout = 0;
        this.server.headersTimeout = 0;

        // 设置 TCP Keep-Alive，防止连接被操作系统/防火墙断开
        this.server.on('connection', (socket) => {
            socket.setKeepAlive(true, 30000); // 30秒发送一次 TCP keep-alive
            socket.setTimeout(0); // 不超时
        });

        // 启动连接状态检测
        this.startConnectionCheck();

        return new Promise((resolve, reject) => {
            this.tryListen(BASE_PORT, 0, resolve, reject);
        });
    }

    private startConnectionCheck() {
        // 每30秒检查一次连接状态
        this.connectionCheckInterval = setInterval(() => {
            const now = Date.now();
            for (const [requestId, pending] of this.pendingRequests.entries()) {
                // 检查响应对象是否还可写
                if (pending.res.writableEnded || pending.res.destroyed) {
                    console.log(`[WindsurfChatOpen] Connection closed for request ${requestId}, cleaning up`);
                    this.clearPendingRequest(requestId, false);
                }
            }
        }, 30000);
    }

    private cleanupAllPortFiles() {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders) return;

        for (const folder of folders) {
            const portFile = path.join(folder.uri.fsPath, LOCAL_DIR_NAME, 'port');
            if (fs.existsSync(portFile)) {
                try {
                    fs.unlinkSync(portFile);
                } catch (e) {
                    console.error(`[WindsurfChatOpen] Failed to delete port file in ${folder.name}: ${e}`);
                }
            }
        }
    }

    private tryListen(port: number, attempt: number, resolve: (port: number) => void, reject: (err: any) => void) {
        if (attempt >= MAX_PORT_ATTEMPTS) {
            reject(new Error('Could not find an available port'));
            return;
        }

        // 避免重复尝试相同端口
        if (this.triedPorts.has(port)) {
            const nextPort = this.getNextPort(port);
            this.tryListen(nextPort, attempt + 1, resolve, reject);
            return;
        }

        this.triedPorts.add(port);

        const onListenError = (err: any) => {
            if (err.code === 'EADDRINUSE') {
                const nextPort = this.getNextPort(port);
                this.tryListen(nextPort, attempt + 1, resolve, reject);
            } else {
                reject(err);
            }
        };

        this.server!.once('error', onListenError);

        this.server!.listen(port, '127.0.0.1', () => {
            this.server!.removeListener('error', onListenError);
            this.port = port;
            this.writePortFiles(port);
            resolve(port);
        });
    }

    private getNextPort(currentPort: number): number {
        let nextPort = currentPort + 1;
        if (nextPort > BASE_PORT + MAX_PORT_ATTEMPTS) {
            nextPort = BASE_PORT;
        }
        return nextPort;
    }

    public writePortFiles(port: number) {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders) return;

        for (const folder of folders) {
            const workspacePath = folder.uri.fsPath;
            const localDir = path.join(workspacePath, LOCAL_DIR_NAME);
            const portFile = path.join(localDir, 'port');

            try {
                if (!fs.existsSync(localDir)) {
                    fs.mkdirSync(localDir, { recursive: true });
                }
                fs.writeFileSync(portFile, port.toString(), 'utf-8');
            } catch (e) {
                console.error(`[WindsurfChatOpen] Failed to write port file in ${folder.name}: ${e}`);
            }
        }
    }

    private handleIncomingRequest(req: http.IncomingMessage, res: http.ServerResponse) {
        // 设置连接保活
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Keep-Alive', 'timeout=0');

        if (req.method === 'POST' && req.url === '/request') {
            let body = '';
            let bodySize = 0;

            req.on('data', chunk => {
                bodySize += chunk.length;
                if (bodySize > MAX_REQUEST_BODY_SIZE) {
                    req.destroy();
                    res.writeHead(413, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Request body too large' }));
                    return;
                }
                body += chunk;
            });

            req.on('end', async () => {
                try {
                    const data = JSON.parse(body) as RequestData;

                    // 验证必需字段
                    if (!data.prompt || typeof data.prompt !== 'string') {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Invalid prompt field' }));
                        return;
                    }

                    const requestId = this.validateRequestId(data.requestId);

                    this.clearPendingRequest(requestId, true, this.createErrorResponse(ERROR_MESSAGES.REQUEST_SUPERSEDED));

                    const initialTimeoutMinutes = data.timeoutMinutes ?? this.getTimeoutMinutes();

                    this.pendingRequests.set(requestId, {
                        res,
                        timer: undefined,
                        createdAt: Date.now(),
                        initialTimeoutMinutes
                    });

                    this.startTimeoutCheck(requestId);

                    try {
                        await this.onRequest({ ...data, requestId, timeoutMinutes: initialTimeoutMinutes });
                    } catch (e: any) {
                        console.error('[WindsurfChatOpen] Failed to handle request:', e);
                        this.sendResponse(this.createErrorResponse(String(e?.message || e || 'Request handling failed')), requestId);
                    }

                } catch (e) {
                    if (!res.writableEnded) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: ERROR_MESSAGES.INVALID_JSON }));
                    }
                }
            });

            req.on('error', (err) => {
                console.error('[WindsurfChatOpen] Request error:', err);
                if (!res.writableEnded) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Request error' }));
                }
            });
        } else if (req.method === 'GET' && req.url === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'ok',
                port: this.port,
                pendingRequests: this.pendingRequests.size
            }));
        } else if (req.method === 'GET' && req.url === '/status') {
            // 返回详细状态信息，用于调试
            const requests = Array.from(this.pendingRequests.entries()).map(([id, pending]) => ({
                requestId: id,
                createdAt: pending.createdAt,
                age: Date.now() - pending.createdAt,
                hasTimer: !!pending.timer,
                writable: !pending.res.writableEnded && !pending.res.destroyed
            }));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                port: this.port,
                pendingRequests: requests
            }));
        } else {
            res.writeHead(404);
            res.end('Not Found');
        }
    }

    private validateRequestId(requestId?: string): string {
        if (!requestId || typeof requestId !== 'string' || requestId.trim() === '') {
            return Date.now().toString();
        }
        return requestId.trim();
    }

    private createErrorResponse(error: string): ErrorResponse {
        return {
            action: 'error',
            error,
            text: '',
            images: []
        };
    }

    private createTimeoutResponse(elapsed: number, currentTimeoutMinutes: number): TimeoutResponse {
        return {
            action: 'timeout_continue',
            message: `已等待 ${Math.floor(elapsed / MS_PER_MINUTE)} 分钟，当前超时设置为 ${currentTimeoutMinutes} 分钟`,
            text: '',
            images: []
        };
    }

    private startTimeoutCheck(requestId: string) {
        const pending = this.pendingRequests.get(requestId);
        if (!pending) return;

        // 获取最新的超时配置
        const currentTimeoutMinutes = this.getTimeoutMinutes();
        const timeoutMs = currentTimeoutMinutes === 0 ? 0 : currentTimeoutMinutes * MS_PER_MINUTE;

        // 如果设置为不限制，清除定时器
        if (timeoutMs === 0) {
            if (pending.timer) {
                clearTimeout(pending.timer);
                pending.timer = undefined;
            }
            return;
        }

        // 计算已等待时间
        const elapsed = Date.now() - pending.createdAt;
        const remaining = timeoutMs - elapsed;

        // 如果已超时，发送继续等待提示
        if (remaining <= 0) {
            if (!pending.res.writableEnded) {
                pending.res.writeHead(200, { 'Content-Type': 'application/json' });
                pending.res.end(JSON.stringify(this.createTimeoutResponse(elapsed, currentTimeoutMinutes)));
                this.pendingRequests.delete(requestId);
            }
            return;
        }

        // 设置新的定时器
        if (pending.timer) {
            clearTimeout(pending.timer);
        }
        pending.timer = setTimeout(() => {
            this.startTimeoutCheck(requestId);
        }, remaining);
    }

    private clearPendingRequest(requestId: string, sendResponse: boolean = false, responseData?: ErrorResponse) {
        const pending = this.pendingRequests.get(requestId);
        if (pending) {
            if (pending.timer) {
                clearTimeout(pending.timer);
            }
            if (sendResponse && !pending.res.writableEnded) {
                try {
                    pending.res.writeHead(200, { 'Content-Type': 'application/json' });
                    pending.res.end(JSON.stringify(responseData || this.createErrorResponse(ERROR_MESSAGES.REQUEST_CANCELLED)));
                } catch (e) {
                    console.error('[WindsurfChatOpen] Failed to send response:', e);
                }
            }
            this.pendingRequests.delete(requestId);
        }
    }

    public sendResponse(response: any, requestId?: string) {
        const id = requestId;
        if (!id || !this.pendingRequests.has(id)) {
            console.warn(`[WindsurfChatOpen] No pending request found for ID: ${id}`);
            return;
        }

        const pending = this.pendingRequests.get(id)!;

        // 检查响应对象是否还可写
        if (pending.res.writableEnded || pending.res.destroyed) {
            console.warn(`[WindsurfChatOpen] Response object already closed for request ${id}, connection may have been lost`);
            this.clearPendingRequest(id);
            return;
        }

        try {
            pending.res.writeHead(200, {
                'Content-Type': 'application/json',
                'Connection': 'keep-alive'
            });
            pending.res.end(JSON.stringify(response));
            console.log(`[WindsurfChatOpen] Response sent successfully for request ${id}`);
        } catch (e) {
            console.error(`[WindsurfChatOpen] Failed to send response for request ${id}:`, e);
        }

        this.clearPendingRequest(id);
    }

    public dispose() {
        // 停止连接检测
        if (this.connectionCheckInterval) {
            clearInterval(this.connectionCheckInterval);
            this.connectionCheckInterval = undefined;
        }

        this.cleanupAllPortFiles();
        for (const requestId of Array.from(this.pendingRequests.keys())) {
            this.clearPendingRequest(requestId, true, this.createErrorResponse(ERROR_MESSAGES.EXTENSION_DEACTIVATED));
        }
        if (this.server) {
            this.server.close();
            this.server = null;
        }
    }
}
