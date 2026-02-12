import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ChatPanelProvider } from './chatPanel';
import { HttpService, RequestData } from './httpService';
import { WorkspaceManager } from './workspaceManager';
import {
  COMMANDS,
  VIEWS,
  TEMP_FILE_MAX_AGE_MS,
  TEMP_FILE_CLEANUP_INTERVAL_MS,
  HTTP_SERVER_START_DELAY_MS
} from './constants';

class ExtensionStateManager {
  private httpService: HttpService;
  private workspaceManager: WorkspaceManager;
  private panelProvider: ChatPanelProvider;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(private context: vscode.ExtensionContext) {
    const version = context.extension.packageJSON.version || '0.0.0';
    this.panelProvider = new ChatPanelProvider(context.extensionUri, version);
    this.httpService = new HttpService(
      context, 
      (data) => this.handleRequest(data),
      () => this.panelProvider.getTimeoutMinutes(),
      (requestId) => this.panelProvider.dismissPrompt(requestId)
    );
    this.workspaceManager = new WorkspaceManager(context.extensionPath);
    this.panelProvider.setPortGetter(() => this.httpService.getPort());
  }

  public async activate() {
    console.log('[WindsurfChatOpen] Activating extension...');

    this.cleanOldTempFiles();
    this.startPeriodicCleanup();

    this.context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(VIEWS.PANEL, this.panelProvider, {
        webviewOptions: { retainContextWhenHidden: true }
      })
    );

    this.panelProvider.onUserResponse((response) => {
      this.httpService.sendResponse(response, response.requestId);
    });

    // Register commands
    this.context.subscriptions.push(
      vscode.commands.registerCommand(COMMANDS.FOCUS, () => {
        vscode.commands.executeCommand(COMMANDS.PANEL_FOCUS);
      }),
      vscode.commands.registerCommand(COMMANDS.SETUP, () => {
        this.workspaceManager.setup();
      })
    );

    // Listen for workspace folder changes
    this.context.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        console.log('[WindsurfChatOpen] Workspace folders changed, re-running setup...');
        if (vscode.workspace.workspaceFolders?.length) {
          this.workspaceManager.setup();
          // Re-write port files for new folders
          if (this.httpService.getPort() > 0) {
            this.httpService.writePortFiles(this.httpService.getPort());
          }
        }
      })
    );

    // Status bar item
    this.createStatusBarItem();

    // Start HTTP server
    setTimeout(async () => {
      try {
        const port = await this.httpService.start();
        if (port > 0) {
          console.log(`[WindsurfChatOpen] HTTP Server started on port ${port}`);
          this.panelProvider.setPort(port);

          if (vscode.workspace.workspaceFolders?.length) {
            this.workspaceManager.setup();
          }
        }
      } catch (err) {
        vscode.window.showErrorMessage(`WindsurfChatOpen failed to start: ${err}`);
      }
    }, HTTP_SERVER_START_DELAY_MS);

    console.log('[WindsurfChatOpen] Extension activated');
  }

  private createStatusBarItem() {
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = '$(comment-discussion) windsurf-chat-open';
    statusBarItem.tooltip = 'WindsurfChat Open - Click to focus panel';
    statusBarItem.command = COMMANDS.FOCUS;
    statusBarItem.show();
    this.context.subscriptions.push(statusBarItem);
  }

  private async handleRequest(data: RequestData) {
    console.log(`[WindsurfChatOpen] Received request: ${data.requestId}`);
    // 如果请求中没有超时配置，使用面板的配置
    if (data.timeoutMinutes === undefined) {
      data.timeoutMinutes = this.panelProvider.getTimeoutMinutes();
    }
    await this.panelProvider.showPrompt(data.prompt, data.requestId, data.context);
  }


  private startPeriodicCleanup() {
    this.cleanupTimer = setInterval(() => {
      this.cleanOldTempFiles();
    }, TEMP_FILE_CLEANUP_INTERVAL_MS);

    this.context.subscriptions.push({
      dispose: () => {
        if (this.cleanupTimer) {
          clearInterval(this.cleanupTimer);
        }
      }
    });
  }

  private cleanOldTempFiles() {
    const tempDir = os.tmpdir();
    const now = Date.now();
    const prefixes = ['wsc_img_', 'windsurf_chat_instruction_'];

    try {
      const files = fs.readdirSync(tempDir);
      let count = 0;
      for (const file of files) {
        if (prefixes.some(p => file.startsWith(p))) {
          const filePath = path.join(tempDir, file);
          try {
            const stat = fs.statSync(filePath);
            if (now - stat.mtimeMs > TEMP_FILE_MAX_AGE_MS) {
              fs.unlinkSync(filePath);
              count++;
            }
          } catch (e) {
            // 忽略单个文件的错误，继续处理其他文件
          }
        }
      }
      if (count > 0) {
        console.log(`[WindsurfChatOpen] Cleaned ${count} old temp files`);
      }
    } catch (e) {
      console.error(`[WindsurfChatOpen] Failed to clean temp files: ${e}`);
    }
  }

  public deactivate() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.httpService.dispose();
    console.log('[WindsurfChatOpen] Extension deactivated');
  }
}

let stateManager: ExtensionStateManager | null = null;

export function activate(context: vscode.ExtensionContext) {
  stateManager = new ExtensionStateManager(context);
  stateManager.activate().catch(err => {
    console.error('[WindsurfChatOpen] Activation error:', err);
  });
}

export function deactivate() {
  stateManager?.deactivate();
}
