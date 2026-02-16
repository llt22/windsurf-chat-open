import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { ChatPanelProvider } from './chatPanel';
import { McpManager } from './mcpManager';
import { WsClient } from './wsClient';
import {
  COMMANDS,
  VIEWS,
  STARTUP_DELAY_MS
} from './constants';

interface WaitRequest {
  requestId: string;
  context: string;
  question: string;
  targetPanelId: string;
  choices?: string[];
}

class ExtensionStateManager {
  private mcpManager: McpManager;
  private wsClient: WsClient | null = null;
  private panelProvider: ChatPanelProvider;
  private panelId: string;

  constructor(private context: vscode.ExtensionContext) {
    const version = context.extension.packageJSON.version || '0.0.0';
    this.panelId = 'panel-' + crypto.randomBytes(16).toString('hex');
    this.panelProvider = new ChatPanelProvider(context.extensionUri, version);
    this.mcpManager = new McpManager(context.extensionPath);
  }

  public async activate() {
    console.log('[DevFlow] Activating extension...');

    // 注册 Webview 面板
    this.context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(VIEWS.PANEL, this.panelProvider, {
        webviewOptions: { retainContextWhenHidden: true }
      })
    );

    // 面板用户响应 → 转发给 Central Server
    this.panelProvider.onUserResponse((response) => {
      if (this.wsClient && response.requestId) {
        this.wsClient.send({
          type: 'user_response',
          requestId: response.requestId,
          content: response.text,
          panelId: this.panelId,
          action: response.action,
        });
      }
    });

    // 注册命令
    this.context.subscriptions.push(
      vscode.commands.registerCommand(COMMANDS.FOCUS, () => {
        vscode.commands.executeCommand(COMMANDS.PANEL_FOCUS);
      })
    );

    // 状态栏
    this.createStatusBarItem();

    // 延迟初始化 MCP 和 WebSocket
    setTimeout(async () => {
      try {
        // 初始化 MCP（启动 central server + 写 mcp_config.json）
        const toolName = await this.mcpManager.initialize(this.panelId);
        console.log(`[DevFlow] Tool name: ${toolName}`);

        // 通知面板当前面板ID和工具名
        this.panelProvider.setPanelId(this.panelId);
        this.panelProvider.setToolName(toolName);

        // 连接 Central Server
        this.wsClient = new WsClient(this.panelId, toolName);
        this.wsClient.setMessageHandler((msg) => this.handleWsMessage(msg));

        // 重连前尝试启动 Central Server（另一个 IDE 关闭后接管）
        this.wsClient.onBeforeReconnect(async () => {
          this.mcpManager.startCentralServer();
          await new Promise(r => setTimeout(r, 1000));
        });

        await this.wsClient.connect().catch((err: any) => {
          console.error('[DevFlow] Initial WS connection failed:', err.message);
        });

      } catch (err) {
        console.error('[DevFlow] Initialization failed:', err);
      }
    }, STARTUP_DELAY_MS);

    console.log('[DevFlow] Extension activated');
  }

  private createStatusBarItem() {
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = '$(comment-discussion) DevFlow';
    statusBarItem.tooltip = 'DevFlow - Click to focus panel';
    statusBarItem.command = COMMANDS.FOCUS;
    statusBarItem.show();
    this.context.subscriptions.push(statusBarItem);
  }

  /**
   * 处理来自 Central Server 的 WebSocket 消息
   */
  private async handleWsMessage(msg: any) {
    switch (msg.type) {
      case 'wait_request':
        await this.handleWaitRequest(msg as WaitRequest);
        break;

      case 'server_info':
        if (msg.toolName && msg.toolName !== this.mcpManager.getToolName()) {
          // 服务器已有工具名（另一个 IDE 先启动），同步到本地
          console.log(`[DevFlow] Syncing tool name from server: ${msg.toolName}`);
          this.mcpManager.updateToolName(msg.toolName);
          this.panelProvider.setToolName(msg.toolName);
        }
        break;

      case 'tool_name_update':
        if (msg.toolName) {
          this.mcpManager.updateToolName(msg.toolName);
          this.wsClient?.updateToolName(msg.toolName);
          this.panelProvider.setToolName(msg.toolName);
        }
        break;

      default:
        break;
    }
  }

  /**
   * 处理 MCP 工具调用请求（来自 AI 的等待用户输入请求）
   */
  private async handleWaitRequest(req: WaitRequest) {
    console.log(`[DevFlow] Wait request: ${req.requestId}`);
    const prompt = req.question || '下一步想做什么？';
    await this.panelProvider.showPrompt(prompt, req.requestId, req.context);
  }

  public deactivate() {
    this.wsClient?.dispose();
    this.mcpManager.dispose();
    console.log('[DevFlow] Extension deactivated');
  }
}

let stateManager: ExtensionStateManager | null = null;

export function activate(context: vscode.ExtensionContext) {
  stateManager = new ExtensionStateManager(context);
  stateManager.activate().catch(err => {
    console.error('[DevFlow] Activation error:', err);
  });
}

export function deactivate() {
  stateManager?.deactivate();
}
