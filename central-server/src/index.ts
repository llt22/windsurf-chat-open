#!/usr/bin/env node
/**
 * DevFlow Central Server
 * 单进程同时提供：
 * - WebSocket（Extension 通信）
 * - HTTP SSE MCP 端点（Windsurf AI 调用）
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import * as crypto from 'crypto';

const PORT = parseInt(process.env.DEVFLOW_PORT || '23985', 10);
const HEARTBEAT_INTERVAL = 30000;
const MCP_TIMEOUT_MS = parseInt(process.env.DEVFLOW_MCP_TIMEOUT || '600000', 10); // 默认 10 分钟

const currentToolName = process.env.DEVFLOW_TOOL_NAME || 'dev_mcp';

interface PanelClient {
  ws: WebSocket;
  panelId: string;
  toolName: string;
}

interface WsMessage {
  type: string;
  msgId?: string;
  panelId?: string;
  toolName?: string;
  requestId?: string;
  context?: string;
  question?: string;
  targetPanelId?: string;
  choices?: string[];
  content?: string;
  action?: string;
  [key: string]: any;
}

// 待处理的 MCP 工具调用（等待用户响应）
interface PendingMcpCall {
  resolve: (result: { content: string; panelId: string; action: string; images?: string[] }) => void;
  timestamp: number;
}

class CentralServer {
  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private panels: Map<string, PanelClient> = new Map();
  private pendingMcpCalls: Map<string, PendingMcpCall> = new Map();
  private sseTransports: Map<string, SSEServerTransport> = new Map();
  private heartbeatTimer?: NodeJS.Timeout;

  start() {
    // HTTP 服务（同时处理 SSE MCP 和 WebSocket upgrade）
    this.httpServer = http.createServer((req, res) => this.handleHttp(req, res));

    // WebSocket 服务（附加到 HTTP 服务）
    this.wss = new WebSocketServer({ server: this.httpServer });

    this.wss.on('connection', (ws) => {
      const clientId = crypto.randomBytes(8).toString('hex');

      ws.on('message', (data: Buffer) => {
        try {
          const msg: WsMessage = JSON.parse(data.toString());
          if (msg.msgId) this.sendAck(ws, msg.msgId);
          this.handleWsMessage(clientId, ws, msg);
        } catch (e) {
          console.error('[DevFlow Central] Parse error:', e);
        }
      });

      ws.on('close', () => {
        this.panels.delete(clientId);
      });

      ws.on('error', (err) => {
        console.error(`[DevFlow Central] WS error: ${err.message}`);
      });
    });

    this.httpServer.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[DevFlow Central] Port ${PORT} in use, exiting`);
        process.exit(1);
      }
      console.error('[DevFlow Central] Server error:', err);
    });

    this.httpServer.listen(PORT, '127.0.0.1', () => {
      console.error(`[DevFlow Central] Listening on http://127.0.0.1:${PORT}`);
      console.error(`[DevFlow Central] MCP tool: ${currentToolName}`);
    });

    this.startHeartbeat();
  }

  // ========== HTTP 处理（MCP SSE）==========

  private handleHttp(req: http.IncomingMessage, res: http.ServerResponse) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);

    if (req.method === 'GET' && url.pathname === '/mcp') {
      this.handleSseConnect(req, res);
    } else if (req.method === 'POST' && url.pathname === '/messages') {
      this.handleSseMessage(req, res, url);
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  }

  private async handleSseConnect(_req: http.IncomingMessage, res: http.ServerResponse) {
    try {
      const transport = new SSEServerTransport('/messages', res);
      const sessionId = transport.sessionId;
      this.sseTransports.set(sessionId, transport);

      transport.onclose = () => {
        this.sseTransports.delete(sessionId);
        console.error(`[DevFlow Central] SSE closed: ${sessionId}`);
      };

      const mcpServer = this.createMcpServer();
      await mcpServer.connect(transport);
      console.error(`[DevFlow Central] SSE connected: ${sessionId}`);
    } catch (e) {
      console.error('[DevFlow Central] SSE connect error:', e);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end('SSE error');
      }
    }
  }

  private async handleSseMessage(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
    const sessionId = url.searchParams.get('sessionId');
    if (!sessionId) {
      res.writeHead(400);
      res.end('Missing sessionId');
      return;
    }

    const transport = this.sseTransports.get(sessionId);
    if (!transport) {
      res.writeHead(404);
      res.end('Session not found');
      return;
    }

    try {
      const body = await this.parseBody(req);
      await transport.handlePostMessage(req, res, body);
    } catch (e) {
      console.error('[DevFlow Central] SSE message error:', e);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end('Error');
      }
    }
  }

  private parseBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(e); }
      });
      req.on('error', reject);
    });
  }

  // ========== MCP Server 工厂 ==========

  private createMcpServer(): McpServer {
    const server = new McpServer({ name: currentToolName, version: '1.0.0' });

    server.tool(
      currentToolName,
      currentToolName,
      {
        context: z.string().describe('当前对话的上下文摘要，你已完成的工作'),
        question: z.string().optional().describe('询问下一步想要做什么'),
        targetPanelId: z.string().optional().describe('目标面板ID'),
        choices: z.array(z.string()).optional().describe('可选的快速回复选项列表'),
      },
      async ({ context, question, targetPanelId, choices }) => {
        try {
          const response = await this.waitForUserResponse(context, question, targetPanelId, choices);
          const contentItems: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [{
            type: 'text' as const,
            text: JSON.stringify({
              user_input: response.content,
              action: response.action,
              panelId: response.panelId,
            }, null, 2),
          }];

          // 读取图片文件并作为 image content 返回
          if (response.images && response.images.length > 0) {
            for (const imgPath of response.images) {
              try {
                if (fs.existsSync(imgPath)) {
                  const data = fs.readFileSync(imgPath).toString('base64');
                  const ext = path.extname(imgPath).toLowerCase();
                  const mimeMap: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' };
                  contentItems.push({
                    type: 'image' as const,
                    data,
                    mimeType: mimeMap[ext] || 'image/png',
                  });
                }
              } catch (e) {
                console.error(`[DevFlow Central] Failed to read image: ${imgPath}`, e);
              }
            }
          }

          return { content: contentItems };
        } catch (err) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                user_input: '系统错误: ' + (err instanceof Error ? err.message : '未知错误'),
                action: 'continue',
              }, null, 2),
            }],
            isError: true,
          };
        }
      }
    );

    return server;
  }

  // ========== 等待用户响应（核心桥接）==========

  private waitForUserResponse(
    context: string, question?: string, targetPanelId?: string, choices?: string[]
  ): Promise<{ content: string; panelId: string; action: string; images?: string[] }> {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomBytes(8).toString('hex');

      // 找目标面板（严格匹配 panelId，不 fallback 到其他面板，避免跨 IDE 路由）
      let targetPanel: PanelClient | undefined;
      if (targetPanelId) {
        for (const panel of this.panels.values()) {
          if (panel.panelId === targetPanelId) {
            targetPanel = panel;
            break;
          }
        }
      }
      if (!targetPanel) {
        // 仅当没有指定 targetPanelId 时才 fallback 到第一个面板
        if (!targetPanelId) {
          targetPanel = this.panels.values().next().value;
        }
      }

      if (!targetPanel || targetPanel.ws.readyState !== WebSocket.OPEN) {
        resolve({ content: `目标面板 ${targetPanelId || '(未指定)'} 不可用，请确保对应 IDE 的 DevFlow 面板已打开`, panelId: '', action: 'continue' });
        return;
      }

      // 注册等待
      this.pendingMcpCalls.set(requestId, { resolve, timestamp: Date.now() });

      // 发送到面板
      this.sendToClient(targetPanel.ws, {
        type: 'wait_request',
        requestId,
        context: context || '',
        question: question || '下一步想做什么？',
        targetPanelId: targetPanel.panelId,
        choices: choices || [],
      });

      console.error(`[DevFlow Central] Wait request ${requestId} → panel ${targetPanel.panelId}`);

      // 超时（可配置，默认 10 分钟）
      setTimeout(() => {
        if (this.pendingMcpCalls.has(requestId)) {
          this.pendingMcpCalls.delete(requestId);
          reject(new Error('等待用户响应超时'));
        }
      }, MCP_TIMEOUT_MS);
    });
  }

  // ========== WebSocket 处理（Extension）==========

  private sendAck(ws: WebSocket, msgId: string) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ack', msgId }));
    }
  }

  private handleWsMessage(clientId: string, ws: WebSocket, msg: WsMessage) {
    switch (msg.type) {
      case 'register_panel':
        this.handlePanelRegister(clientId, ws, msg);
        break;
      case 'user_response':
        this.handleUserResponse(msg);
        break;
    }
  }

  private handlePanelRegister(clientId: string, ws: WebSocket, msg: WsMessage) {
    const panelId = msg.panelId || clientId;
    const toolName = msg.toolName || '';

    // 移除旧的同 panelId 连接
    for (const [id, panel] of this.panels) {
      if (panel.panelId === panelId && id !== clientId) {
        this.panels.delete(id);
      }
    }

    this.panels.set(clientId, { ws, panelId, toolName });
    console.error(`[DevFlow Central] Panel registered: ${panelId}`);

    this.sendToClient(ws, { type: 'server_info', toolName: currentToolName });
  }

  private handleUserResponse(msg: WsMessage) {
    const requestId = msg.requestId;
    if (!requestId) return;

    const pending = this.pendingMcpCalls.get(requestId);
    if (!pending) {
      console.error(`[DevFlow Central] No pending request: ${requestId}`);
      return;
    }

    this.pendingMcpCalls.delete(requestId);
    pending.resolve({
      content: msg.content || '',
      panelId: msg.panelId || '',
      action: msg.action || 'continue',
      images: msg.images || [],
    });
    console.error(`[DevFlow Central] User responded: ${requestId}`);
  }

  private sendToClient(ws: WebSocket, data: any) {
    if (ws.readyState === WebSocket.OPEN) {
      const msgId = crypto.randomBytes(4).toString('hex');
      ws.send(JSON.stringify({ ...data, msgId }));
    }
  }

  // ========== 心跳 ==========

  private startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      if (!this.wss) return;
      this.wss.clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) ws.ping();
      });
    }, HEARTBEAT_INTERVAL);
  }

  stop() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    for (const [, transport] of this.sseTransports) {
      transport.close().catch(() => {});
    }
    this.sseTransports.clear();
    if (this.httpServer) this.httpServer.close();
  }
}

const server = new CentralServer();
server.start();

process.on('SIGTERM', () => { server.stop(); process.exit(0); });
process.on('SIGINT', () => { server.stop(); process.exit(0); });
