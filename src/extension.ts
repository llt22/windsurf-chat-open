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
    this.mcpManager = new McpManager(context.extensionPath);
    this.panelId = this.mcpManager.loadPanelId() || 'panel-' + crypto.randomBytes(16).toString('hex');
    this.mcpManager.savePanelId(this.panelId);
    this.panelProvider = new ChatPanelProvider(context.extensionUri, version);
  }

  public async activate() {
    console.log('[DevFlow] Activating extension...');

    // 立即写入 global_rules.md，确保 memories 系统读取到最新的 panelId 和 toolName
    const toolName = this.mcpManager.getToolName();
    this.mcpManager.writeGlobalRules(toolName, this.panelId);
    console.log(`[DevFlow] Global rules updated: tool=${toolName}, panel=${this.panelId}`);

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
          images: response.images,
        });
      }
    });

    // 注册命令
    this.context.subscriptions.push(
      vscode.commands.registerCommand(COMMANDS.FOCUS, () => {
        vscode.commands.executeCommand(COMMANDS.PANEL_FOCUS);
      }),
      vscode.commands.registerCommand(COMMANDS.REGENERATE, () => {
        this.regenerateToolName();
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
        const port = this.mcpManager.getPort();
        this.wsClient = new WsClient(this.panelId, toolName, port);
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
        // 服务器返回信息（各 IDE 独立，无需同步 toolName）
        console.log(`[DevFlow] Server info received, tool: ${msg.toolName}`);
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

  private regenerateToolName() {
    const newName = this.mcpManager.generateToolName();
    this.mcpManager.updateToolName(newName);
    this.mcpManager.writeGlobalRules(newName, this.panelId);
    this.wsClient?.updateToolName(newName);
    this.panelProvider.setToolName(newName);
    vscode.window.showInformationMessage(`DevFlow: MCP tool name regenerated → ${newName}`);
    console.log(`[DevFlow] Tool name regenerated: ${newName}`);
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
