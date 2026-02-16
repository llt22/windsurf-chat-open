import * as crypto from 'crypto';
import { WebSocket } from 'ws';
import { CENTRAL_SERVER_URL, WS_RECONNECT_DELAY, WS_MAX_RECONNECT_ATTEMPTS } from './constants';

interface WsMessage {
  type: string;
  msgId?: string;
  [key: string]: any;
}

type MessageHandler = (msg: WsMessage) => void;

/**
 * Extension 端的 WebSocket 客户端
 * 连接 Central Server，处理面板注册和用户响应转发
 */
export class WsClient {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer?: NodeJS.Timeout;
  private isDisposed = false;
  private messageHandler?: MessageHandler;
  private panelId: string;
  private toolName: string;
  private pendingAcks = new Map<string, { resolve: () => void; timer: NodeJS.Timeout }>();
  private beforeReconnectHandler?: () => Promise<void>;

  constructor(panelId: string, toolName: string) {
    this.panelId = panelId;
    this.toolName = toolName;
  }

  onBeforeReconnect(handler: () => Promise<void>) {
    this.beforeReconnectHandler = handler;
  }

  setMessageHandler(handler: MessageHandler) {
    this.messageHandler = handler;
  }

  updateToolName(name: string) {
    this.toolName = name;
  }

  async connect(): Promise<void> {
    if (this.isDisposed) return;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(CENTRAL_SERVER_URL);

        this.ws.on('open', () => {
          console.log('[DevFlow] Connected to central server');
          this.reconnectAttempts = 0;

          // 注册面板
          this.sendWithAck({
            type: 'register_panel',
            panelId: this.panelId,
            toolName: this.toolName || '',
          }).then(() => {
            console.log('[DevFlow] Panel registered');
            resolve();
          }).catch((err) => {
            console.error('[DevFlow] Panel registration failed:', err);
            resolve(); // 不阻塞
          });
        });

        this.ws.on('message', (data: Buffer) => {
          try {
            const msg: WsMessage = JSON.parse(data.toString());

            // 处理 ACK
            if (msg.type === 'ack' && msg.msgId) {
              const pending = this.pendingAcks.get(msg.msgId);
              if (pending) {
                clearTimeout(pending.timer);
                this.pendingAcks.delete(msg.msgId);
                pending.resolve();
              }
              return;
            }

            // 发送 ACK
            if (msg.msgId) {
              this.sendRaw({ type: 'ack', msgId: msg.msgId });
            }

            // 转发给处理器
            this.messageHandler?.(msg);
          } catch (e) {
            console.error('[DevFlow] Message parse error:', e);
          }
        });

        this.ws.on('close', () => {
          console.log('[DevFlow] Disconnected from central server');
          this.ws = null;
          this.cleanupAcks();
          this.scheduleReconnect();
        });

        this.ws.on('error', (err) => {
          console.error('[DevFlow] WebSocket error:', err.message);
          if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            reject(err);
          }
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  private scheduleReconnect() {
    if (this.isDisposed) return;
    if (this.reconnectAttempts >= WS_MAX_RECONNECT_ATTEMPTS) {
      console.error('[DevFlow] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = WS_RECONNECT_DELAY * Math.min(this.reconnectAttempts, 5);
    console.log(`[DevFlow] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.beforeReconnectHandler?.();
      } catch (e) {
        // ignore
      }
      this.connect().catch((err) => {
        console.error('[DevFlow] Reconnect failed:', err.message);
      });
    }, delay);
  }

  sendWithAck(data: WsMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      const msgId = crypto.randomBytes(4).toString('hex');
      const msg = { ...data, msgId };

      const timer = setTimeout(() => {
        this.pendingAcks.delete(msgId);
        reject(new Error('ACK timeout'));
      }, 10000);

      this.pendingAcks.set(msgId, { resolve, timer });
      this.sendRaw(msg);
    });
  }

  send(data: WsMessage) {
    const msgId = crypto.randomBytes(4).toString('hex');
    this.sendRaw({ ...data, msgId });
  }

  private sendRaw(data: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  private cleanupAcks() {
    for (const [, entry] of this.pendingAcks) {
      clearTimeout(entry.timer);
    }
    this.pendingAcks.clear();
  }

  dispose() {
    this.isDisposed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.cleanupAcks();
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {
        // ignore
      }
      this.ws = null;
    }
  }
}
