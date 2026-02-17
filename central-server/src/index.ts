#!/usr/bin/env node
/**
 * DevFlow Central Server
 * HTTP + WebSocket + MCP SSE
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';

const PORT = parseInt(process.env.DEVFLOW_PORT || '24816', 10);
const TOOL_NAME = process.env.DEVFLOW_TOOL_NAME || 'dev_mcp';
const VERSION = '3.0.0';
const HEARTBEAT_INTERVAL = 30000;

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
  images?: string[];
  [key: string]: any;
}

// ========== 面板管理 ==========

const panels: Map<string, PanelClient> = new Map();
let currentToolName = TOOL_NAME;

// ========== MCP 请求等待队列 ==========

interface PendingMcpRequest {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  timestamp: number;
}
const pendingMcpRequests: Map<string, PendingMcpRequest> = new Map();

// 超时清理（30分钟）
setInterval(() => {
  const now = Date.now();
  for (const [id, req] of pendingMcpRequests) {
    if (now - req.timestamp > 30 * 60 * 1000) {
      req.reject(new Error('Request timeout'));
      pendingMcpRequests.delete(id);
    }
  }
}, 60000);

// ========== WebSocket 工具 ==========

function sendToWs(ws: WebSocket, data: any) {
  if (ws.readyState === WebSocket.OPEN) {
    const msgId = crypto.randomBytes(4).toString('hex');
    ws.send(JSON.stringify({ ...data, msgId }));
  }
}

function sendAck(ws: WebSocket, msgId: string) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'ack', msgId }));
  }
}

// ========== MCP 工具调用处理 ==========

function handleMcpToolCall(
  context: string,
  question?: string,
  targetPanelId?: string,
  choices?: string[]
): Promise<any> {
  const requestId = crypto.randomBytes(8).toString('hex');

  let targetPanel: PanelClient | undefined;
  if (targetPanelId) {
    for (const panel of panels.values()) {
      if (panel.panelId === targetPanelId) {
        targetPanel = panel;
        break;
      }
    }
  }
  if (!targetPanel && !targetPanelId) {
    targetPanel = panels.values().next().value;
  }

  if (!targetPanel || targetPanel.ws.readyState !== WebSocket.OPEN) {
    return Promise.resolve({
      content: `面板 ${targetPanelId || '(未指定)'} 不可用`,
      panelId: '',
      action: 'continue',
    });
  }

  return new Promise((resolve, reject) => {
    pendingMcpRequests.set(requestId, { resolve, reject, timestamp: Date.now() });

    sendToWs(targetPanel!.ws, {
      type: 'wait_request',
      requestId,
      context: context || '',
      question: question || '下一步想做什么？',
      targetPanelId: targetPanel!.panelId,
      choices: choices || [],
    });

    console.error(`[Central] MCP request ${requestId} → panel ${targetPanel!.panelId}`);
  });
}

// ========== WebSocket 消息处理 ==========

function handleWsMessage(clientId: string, ws: WebSocket, msg: WsMessage) {
  switch (msg.type) {
    case 'register_panel': {
      const panelId = msg.panelId || clientId;
      const toolName = msg.toolName || '';
      for (const [id, panel] of panels) {
        if (panel.panelId === panelId && id !== clientId) panels.delete(id);
      }
      panels.set(clientId, { ws, panelId, toolName });
      if (toolName && !currentToolName) currentToolName = toolName;
      console.error(`[Central] Panel registered: ${panelId}`);
      sendToWs(ws, { type: 'server_info', toolName: currentToolName || toolName });
      break;
    }
    case 'user_response': {
      const reqId = msg.requestId;
      if (!reqId) return;
      const pending = pendingMcpRequests.get(reqId);
      if (pending) {
        pendingMcpRequests.delete(reqId);
        pending.resolve({
          content: msg.content || '',
          panelId: msg.panelId || '',
          action: msg.action || 'continue',
          images: msg.images || [],
        });
        console.error(`[Central] User response for ${reqId}`);
      }
      break;
    }
  }
}

// ========== MCP Server (SSE) ==========

const mcpServer = new McpServer({ name: TOOL_NAME, version: VERSION });

mcpServer.tool(
  TOOL_NAME,
  TOOL_NAME,
  {
    context: z.string().describe('当前对话的上下文摘要，你已完成的工作'),
    question: z.string().optional().describe('询问下一步想要做什么'),
    targetPanelId: z.string().optional().describe('目标面板ID'),
    choices: z.array(z.string()).optional().describe('可选的快速回复选项列表'),
  },
  async ({ context, question, targetPanelId, choices }) => {
    try {
      const response = await handleMcpToolCall(context, question, targetPanelId, choices);
      const contentItems: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [{
        type: 'text' as const,
        text: JSON.stringify({
          user_input: response.content,
          action: response.action || 'continue',
          panelId: response.panelId,
        }, null, 2),
      }];

      if (response.images?.length > 0) {
        for (const imgPath of response.images) {
          try {
            if (fs.existsSync(imgPath)) {
              const data = fs.readFileSync(imgPath).toString('base64');
              const ext = path.extname(imgPath).toLowerCase();
              const mimeMap: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
              contentItems.push({ type: 'image' as const, data, mimeType: mimeMap[ext] || 'image/png' });
            }
          } catch (e) { /* ignore */ }
        }
      }

      return { content: contentItems };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ user_input: '系统错误', action: 'continue' }, null, 2) }],
        isError: true,
      };
    }
  }
);

// ========== SSE Transport 管理 ==========

const sseTransports: Map<string, SSEServerTransport> = new Map();

async function handleMcpRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);

  if (url.pathname === '/mcp' || url.pathname === '/mcp/') {
    if (req.method === 'GET') {
      // SSE 连接建立
      const transport = new SSEServerTransport('/mcp', res);
      sseTransports.set(transport.sessionId, transport);
      transport.onclose = () => { sseTransports.delete(transport.sessionId); };

      await mcpServer.connect(transport);
      await transport.start();
    } else if (req.method === 'POST') {
      // 消息路由到对应的 SSE transport
      const sessionId = url.searchParams.get('sessionId');
      const transport = sessionId ? sseTransports.get(sessionId) : undefined;
      if (transport) {
        await transport.handlePostMessage(req, res);
      } else {
        res.writeHead(400);
        res.end('Invalid session');
      }
    } else {
      res.writeHead(405);
      res.end('Method not allowed');
    }
  } else if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', version: VERSION }));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
}

// ========== 启动服务器 ==========

const httpServer = http.createServer(handleMcpRequest);
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  const clientId = crypto.randomBytes(8).toString('hex');

  ws.on('message', (data: Buffer) => {
    try {
      const msg: WsMessage = JSON.parse(data.toString());
      if (msg.msgId) sendAck(ws, msg.msgId);
      handleWsMessage(clientId, ws, msg);
    } catch (e) {
      console.error('[Central] Parse error:', e);
    }
  });

  ws.on('close', () => {
    panels.delete(clientId);
  });

  ws.on('error', (err) => {
    console.error(`[Central] WS error: ${err.message}`);
  });
});

// 心跳
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.ping();
  });
}, HEARTBEAT_INTERVAL);

httpServer.on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[Central] Port ${PORT} in use, exiting`);
    process.exit(1);
  }
  console.error('[Central] Server error:', err);
});

httpServer.listen(PORT, '127.0.0.1', () => {
  console.error(`[Central] Listening on http://127.0.0.1:${PORT}`);
});

process.on('SIGTERM', () => { httpServer.close(); process.exit(0); });
process.on('SIGINT', () => { httpServer.close(); process.exit(0); });
