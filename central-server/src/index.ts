#!/usr/bin/env node
/**
 * DevFlow Central Server
 * 纯 WebSocket 桥接：Extension ↔ MCP Server
 */

import { WebSocketServer, WebSocket } from 'ws';
import * as crypto from 'crypto';

const PORT = parseInt(process.env.DEVFLOW_PORT || '23985', 10);
const HEARTBEAT_INTERVAL = 30000;

interface PanelClient {
  ws: WebSocket;
  panelId: string;
  toolName: string;
}

interface McpClient {
  ws: WebSocket;
  id: string;
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
  images?: string[];
  [key: string]: any;
}

class CentralServer {
  private wss: WebSocketServer | null = null;
  private panels: Map<string, PanelClient> = new Map();
  private mcpClients: Map<string, McpClient> = new Map();
  private pendingRequests: Map<string, { mcpClientId: string; timestamp: number }> = new Map();
  private heartbeatTimer?: NodeJS.Timeout;
  private currentToolName: string = '';

  start() {
    this.wss = new WebSocketServer({ port: PORT, host: '127.0.0.1' });

    this.wss.on('listening', () => {
      console.error(`[DevFlow Central] Listening on ws://127.0.0.1:${PORT}`);
    });

    this.wss.on('connection', (ws) => {
      const clientId = crypto.randomBytes(8).toString('hex');

      ws.on('message', (data: Buffer) => {
        try {
          const msg: WsMessage = JSON.parse(data.toString());
          if (msg.msgId) this.sendAck(ws, msg.msgId);
          this.handleMessage(clientId, ws, msg);
        } catch (e) {
          console.error('[DevFlow Central] Parse error:', e);
        }
      });

      ws.on('close', () => {
        this.removeClient(clientId);
      });

      ws.on('error', (err) => {
        console.error(`[DevFlow Central] WS error: ${err.message}`);
      });
    });

    this.wss.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[DevFlow Central] Port ${PORT} in use, exiting`);
        process.exit(1);
      }
      console.error('[DevFlow Central] Server error:', err);
    });

    this.startHeartbeat();
  }

  private sendAck(ws: WebSocket, msgId: string) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ack', msgId }));
    }
  }

  private handleMessage(clientId: string, ws: WebSocket, msg: WsMessage) {
    switch (msg.type) {
      case 'register_panel':
        this.handlePanelRegister(clientId, ws, msg);
        break;
      case 'register_mcp':
        this.handleMcpRegister(clientId, ws);
        break;
      case 'wait_request':
        this.handleWaitRequest(clientId, msg);
        break;
      case 'user_response':
        this.handleUserResponse(msg);
        break;
    }
  }

  // ========== Panel（Extension）注册 ==========

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

    if (toolName && !this.currentToolName) {
      this.currentToolName = toolName;
    }

    console.error(`[DevFlow Central] Panel registered: ${panelId} (tool: ${toolName})`);

    this.sendToClient(ws, {
      type: 'server_info',
      toolName: this.currentToolName || toolName,
    });

    this.broadcastPanelsUpdate();
  }

  // ========== MCP Server 注册 ==========

  private handleMcpRegister(clientId: string, ws: WebSocket) {
    this.mcpClients.set(clientId, { ws, id: clientId });
    console.error(`[DevFlow Central] MCP client registered: ${clientId}`);

    this.sendToClient(ws, {
      type: 'panels_update',
      panels: this.getPanelIds(),
    });

    if (this.currentToolName) {
      this.sendToClient(ws, {
        type: 'tool_name_update',
        toolName: this.currentToolName,
      });
    }
  }

  // ========== MCP → Panel：等待用户输入 ==========

  private handleWaitRequest(mcpClientId: string, msg: WsMessage) {
    const targetPanelId = msg.targetPanelId;
    const requestId = crypto.randomBytes(8).toString('hex');

    // 找目标面板（严格匹配 panelId）
    let targetPanel: PanelClient | undefined;
    if (targetPanelId) {
      for (const panel of this.panels.values()) {
        if (panel.panelId === targetPanelId) {
          targetPanel = panel;
          break;
        }
      }
    }

    // 没有指定 targetPanelId 时才 fallback 到第一个面板
    if (!targetPanel && !targetPanelId) {
      targetPanel = this.panels.values().next().value;
    }

    if (!targetPanel || targetPanel.ws.readyState !== WebSocket.OPEN) {
      const mcpClient = this.mcpClients.get(mcpClientId);
      if (mcpClient && mcpClient.ws.readyState === WebSocket.OPEN) {
        this.sendToClient(mcpClient.ws, {
          type: 'user_response',
          content: `目标面板 ${targetPanelId || '(未指定)'} 不可用，请确保 DevFlow 面板已打开`,
          panelId: '',
          action: 'continue',
        });
      }
      return;
    }

    // 记录待处理请求
    this.pendingRequests.set(requestId, { mcpClientId, timestamp: Date.now() });

    // 转发给面板
    this.sendToClient(targetPanel.ws, {
      type: 'wait_request',
      requestId,
      context: msg.context || '',
      question: msg.question || '下一步想做什么？',
      targetPanelId: targetPanel.panelId,
      choices: msg.choices || [],
    });

    console.error(`[DevFlow Central] Wait request ${requestId} → panel ${targetPanel.panelId}`);
  }

  // ========== Panel → MCP：用户响应 ==========

  private handleUserResponse(msg: WsMessage) {
    const requestId = msg.requestId;
    if (!requestId) return;

    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      console.error(`[DevFlow Central] No pending request: ${requestId}`);
      return;
    }

    this.pendingRequests.delete(requestId);

    // 转发给 MCP 客户端
    const mcpClient = this.mcpClients.get(pending.mcpClientId);
    if (mcpClient && mcpClient.ws.readyState === WebSocket.OPEN) {
      this.sendToClient(mcpClient.ws, {
        type: 'user_response',
        content: msg.content || '',
        panelId: msg.panelId || '',
        action: msg.action || 'continue',
        images: msg.images || [],
      });
      console.error(`[DevFlow Central] User response → MCP ${pending.mcpClientId}`);
    }
  }

  // ========== 工具方法 ==========

  private sendToClient(ws: WebSocket, data: any) {
    if (ws.readyState === WebSocket.OPEN) {
      const msgId = crypto.randomBytes(4).toString('hex');
      ws.send(JSON.stringify({ ...data, msgId }));
    }
  }

  private broadcastPanelsUpdate() {
    const panelIds = this.getPanelIds();
    for (const mcp of this.mcpClients.values()) {
      if (mcp.ws.readyState === WebSocket.OPEN) {
        this.sendToClient(mcp.ws, { type: 'panels_update', panels: panelIds });
      }
    }
  }

  private getPanelIds(): string[] {
    return Array.from(this.panels.values()).map(p => p.panelId);
  }

  private removeClient(clientId: string) {
    if (this.panels.has(clientId)) {
      this.panels.delete(clientId);
      this.broadcastPanelsUpdate();
    }
    if (this.mcpClients.has(clientId)) {
      this.mcpClients.delete(clientId);
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
    if (this.wss) this.wss.close();
  }
}

const server = new CentralServer();
server.start();

process.on('SIGTERM', () => { server.stop(); process.exit(0); });
process.on('SIGINT', () => { server.stop(); process.exit(0); });
