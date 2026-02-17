#!/usr/bin/env node
/**
 * DevFlow MCP Server
 * stdio MCP 服务，通过 WebSocket 与 Central Server 通信
 */

import * as fs from 'fs';
import * as path from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import WebSocket from 'ws';

const WS_PORT = process.env.DEVFLOW_PORT || '23985';
const WS_URL = `ws://127.0.0.1:${WS_PORT}`;
const RECONNECT_DELAY = 2000;
const MAX_RETRIES = 5;
const MSG_TIMEOUT = 30000;

// 启动诊断：写标记文件，确认 Windsurf 是否 spawn 了本进程
const DIAG_FILE = path.join(require('os').tmpdir(), `devflow-mcp-started-${WS_PORT}.txt`);
try {
  fs.writeFileSync(DIAG_FILE, `started at ${new Date().toISOString()}\npid=${process.pid}\ntool=${process.env.DEVFLOW_TOOL_NAME}\nport=${WS_PORT}\n`);
} catch (_) { /* ignore */ }

let currentToolName = process.env.DEVFLOW_TOOL_NAME || 'dev_mcp';
let wsConnection: WebSocket | null = null;
let waitResolve: ((value: any) => void) | null = null;
let waitReject: ((reason?: any) => void) | null = null;
let lastWaitRequest: any = null;
let isReconnecting = false;

// 消息确认追踪
const pendingMessages = new Map<string, {
  resolve: () => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
  retries: number;
}>();

function generateMsgId(): string {
  return Math.random().toString(36).substring(2, 10);
}

function sendWithAck(ws: WebSocket, data: any): Promise<void> {
  return new Promise((resolve, reject) => {
    const msgId = generateMsgId();
    const msg = { ...data, msgId };

    const entry = {
      resolve,
      reject,
      timer: setTimeout(() => {}, 0),
      retries: 0,
    };

    const doSend = () => {
      if (ws.readyState !== WebSocket.OPEN) {
        pendingMessages.delete(msgId);
        reject(new Error('WebSocket not open'));
        return;
      }
      ws.send(JSON.stringify(msg));
    };

    const onTimeout = () => {
      entry.retries++;
      if (entry.retries >= MAX_RETRIES) {
        pendingMessages.delete(msgId);
        console.error(`[DevFlow MCP] Message ${msgId} failed after ${MAX_RETRIES} retries`);
        reject(new Error(`Message failed after ${MAX_RETRIES} retries`));
      } else {
        console.error(`[DevFlow MCP] Retrying message ${msgId} (${entry.retries + 1})`);
        doSend();
        entry.timer = setTimeout(onTimeout, MSG_TIMEOUT);
      }
    };

    entry.timer = setTimeout(onTimeout, MSG_TIMEOUT);
    pendingMessages.set(msgId, entry);
    doSend();
  });
}

function handleAck(msgId: string) {
  const entry = pendingMessages.get(msgId);
  if (entry) {
    clearTimeout(entry.timer);
    pendingMessages.delete(msgId);
    entry.resolve();
  }
}

function sendAck(ws: WebSocket, msgId: string) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'ack', msgId }));
  }
}

async function connectWebSocket(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
      resolve(wsConnection);
      return;
    }

    const ws = new WebSocket(WS_URL);

    ws.on('open', async () => {
      console.error('[DevFlow MCP] Connected to central server:', WS_URL);
      wsConnection = ws;

      try {
        await sendWithAck(ws, { type: 'register_mcp' });
        console.error('[DevFlow MCP] Registered with central server');

        // 如果有未完成的等待请求，重新发送
        if (isReconnecting && lastWaitRequest && waitResolve) {
          console.error('[DevFlow MCP] Re-sending wait request after reconnection');
          const reqMsg = {
            type: 'wait_request',
            context: lastWaitRequest.context,
            question: lastWaitRequest.question || '下一步想做什么？',
            targetPanelId: lastWaitRequest.targetPanelId || undefined,
            timestamp: Date.now(),
          };
          if (lastWaitRequest.choices?.length > 0) {
            (reqMsg as any).choices = lastWaitRequest.choices;
          }
          await sendWithAck(ws, reqMsg);
          console.error('[DevFlow MCP] Wait request re-sent after reconnection');
        }
        isReconnecting = false;
      } catch (e: any) {
        console.error('[DevFlow MCP] Registration failed:', e.message);
      }

      resolve(ws);
    });

    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());

        // 处理 ACK
        if (msg.type === 'ack' && msg.msgId) {
          handleAck(msg.msgId);
          return;
        }

        // 发送 ACK
        if (msg.msgId) {
          sendAck(ws, msg.msgId);
        }

        // 处理面板列表更新
        if (msg.type === 'panels_update') {
          console.error('[DevFlow MCP] Panels:', msg.panels);
        }
        // 处理工具名更新
        else if (msg.type === 'tool_name_update' && msg.toolName) {
          if (msg.toolName !== currentToolName) {
            console.error(`[DevFlow MCP] Tool name updated: ${currentToolName} → ${msg.toolName}`);
            currentToolName = msg.toolName;
          }
        }
        // 处理用户响应
        else if (msg.type === 'user_response' && waitResolve) {
          lastWaitRequest = null;
          waitResolve({
            content: msg.content,
            panelId: msg.panelId,
            action: msg.action,
            images: msg.images || [],
          });
          waitResolve = null;
          waitReject = null;
        }
      } catch (e) {
        console.error('[DevFlow MCP] Message parse error:', e);
      }
    });

    ws.on('close', () => {
      console.error('[DevFlow MCP] Disconnected from central server');
      wsConnection = null;

      // 清理待确认消息
      for (const [, entry] of pendingMessages) {
        clearTimeout(entry.timer);
        entry.reject(new Error('Connection closed'));
      }
      pendingMessages.clear();

      // 如果有待处理的等待请求，尝试重连
      if (waitResolve && lastWaitRequest) {
        console.error('[DevFlow MCP] Has pending wait request, reconnecting...');
        isReconnecting = true;
        setTimeout(() => {
          if (waitResolve && lastWaitRequest) {
            connectWebSocket().catch((err) => {
              console.error('[DevFlow MCP] Reconnect failed:', err.message);
              if (waitReject) {
                waitReject(new Error('Reconnect failed'));
                waitResolve = null;
                waitReject = null;
                lastWaitRequest = null;
              }
            });
          }
        }, RECONNECT_DELAY);
      } else if (waitReject) {
        waitReject(new Error('Connection lost'));
        waitResolve = null;
        waitReject = null;
      }
    });

    ws.on('error', (err: Error) => {
      console.error('[DevFlow MCP] WebSocket error:', err.message);
      if (wsConnection === null) {
        reject(err);
      }
    });
  });
}

async function sendWaitRequest(
  context: string,
  question?: string,
  targetPanelId?: string,
  choices?: string[]
): Promise<any> {
  const ws = await connectWebSocket();

  lastWaitRequest = { context, question, targetPanelId, choices };

  return new Promise((resolve, reject) => {
    waitResolve = (response) => {
      lastWaitRequest = null;
      resolve(response);
    };
    waitReject = (err) => {
      lastWaitRequest = null;
      reject(err);
    };

    const reqMsg: any = {
      type: 'wait_request',
      context,
      question: question || '下一步想做什么？',
      targetPanelId: targetPanelId || undefined,
      timestamp: Date.now(),
    };

    if (choices && choices.length > 0) {
      reqMsg.choices = choices;
    }

    sendWithAck(ws, reqMsg)
      .then(() => {
        console.error('[DevFlow MCP] Wait request sent' + (targetPanelId ? ` (panel: ${targetPanelId})` : ''));
      })
      .catch((err) => {
        console.error('[DevFlow MCP] Failed to send wait request:', err.message);
        lastWaitRequest = null;
        reject(err);
      });
  });
}

// 初始化 WebSocket 连接
connectWebSocket().catch((err) => {
  console.error('[DevFlow MCP] Initial connection failed:', err.message);
});

// 创建 MCP Server
const mcpServer = new McpServer({
  name: currentToolName,
  version: '1.0.0',
});

// 注册工具
mcpServer.tool(
  currentToolName,
  `${currentToolName}`,
  {
    context: z.string().describe('当前对话的上下文摘要，你已完成的工作'),
    question: z.string().optional().describe('询问下一步想要做什么'),
    targetPanelId: z.string().optional().describe('目标面板ID'),
    choices: z.array(z.string()).optional().describe('可选的快速回复选项列表'),
  },
  async ({ context, question, targetPanelId, choices }: { context: string; question?: string; targetPanelId?: string; choices?: string[] }) => {
    try {
      const response = await sendWaitRequest(context, question, targetPanelId, choices);
      const contentItems: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [{
        type: 'text' as const,
        text: JSON.stringify({
          user_input: response.content,
          action: response.action || 'continue',
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
              contentItems.push({ type: 'image' as const, data, mimeType: mimeMap[ext] || 'image/png' });
            }
          } catch (e) {
            console.error(`[DevFlow MCP] Failed to read image: ${imgPath}`, e);
          }
        }
      }

      return { content: contentItems };
    } catch (err) {
      const errorResult: any = {
        user_input: '系统错误: ' + (err instanceof Error ? err.message : '未知错误'),
        action: 'continue',
      };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(errorResult, null, 2) }],
        isError: true,
      };
    }
  }
);

// 启动 MCP Server
async function main() {
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error('[DevFlow MCP] Server started via stdio');
}

main().catch((err) => {
  console.error('[DevFlow MCP] Fatal error:', err);
  process.exit(1);
});
