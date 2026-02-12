import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import {
  WEBVIEW_READY_TIMEOUT_MS,
  LONG_TEXT_THRESHOLD,
  COMMANDS,
  ERROR_MESSAGES,
  MAX_IMAGE_COUNT,
  MAX_IMAGE_SIZE
} from './constants';
import { getPanelHtml } from './panelTemplate';

export interface UserResponse {
  action: 'continue' | 'end' | 'instruction' | 'error';
  text: string;
  images: string[];
  files?: Array<{ name: string; path: string; size: number }>;
  requestId?: string;
  error?: string;
}

interface WebviewMessage {
  type: 'ready' | 'continue' | 'end' | 'submit' | 'setTimeout' | 'setNeedReply' | 'getWorkspaceRoot';
  text?: string;
  images?: string[];
  files?: Array<{ name: string; path: string; size: number }>;
  requestId?: string;
  timeoutMinutes?: number;
  needReply?: boolean;
}

export class ChatPanelProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _onUserResponse = new vscode.EventEmitter<UserResponse>();
  public onUserResponse = this._onUserResponse.event;
  private _port: number = 0;
  private _viewReadyResolve?: () => void;
  private _viewReadyPromise?: Promise<void>;
  private _isWebviewReady: boolean = false;
  private _timeoutMinutes: number = 240; // 默认4小时
  private _needReply: boolean = false;

  private _getPortFn?: () => number;
  private _onNeedReplyChanged?: (needReply: boolean) => void;
  private _activePrompts: Map<string, { prompt: string; context?: string; reply?: string }> = new Map();

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _version: string
  ) {
    this._resetViewReadyPromise();
  }

  setNeedReplyChangedCallback(fn: (needReply: boolean) => void) {
    this._onNeedReplyChanged = fn;
  }

  setPortGetter(fn: () => number) {
    this._getPortFn = fn;
  }

  private _resetViewReadyPromise() {
    this._isWebviewReady = false;
    this._viewReadyPromise = new Promise<void>((resolve) => {
      this._viewReadyResolve = resolve;
    });
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    // 重建 webview 时重置 ready 状态，等待新的 'ready' 消息
    this._resetViewReadyPromise();
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = getPanelHtml(this._version);

    webviewView.webview.onDidReceiveMessage((message) => this._handleWebviewMessage(message));
  }

  private _handleWebviewMessage(message: WebviewMessage) {
    const requestId = message.requestId;
    switch (message.type) {
      case 'ready':
        this._isWebviewReady = true;
        this._viewReadyResolve?.();
        // 发送当前端口到前端
        const livePort = this._getPortFn ? this._getPortFn() : this._port;
        if (livePort > 0) {
          this._port = livePort;
          this._view?.webview.postMessage({ type: 'setPort', port: livePort });
        }
        // 发送当前超时配置到前端
        this._view?.webview.postMessage({ type: 'setTimeoutMinutes', timeoutMinutes: this._timeoutMinutes });
        this._view?.webview.postMessage({ type: 'setNeedReply', needReply: this._needReply });
        // 发送工作区根目录到前端
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
          const workspaceRoot = workspaceFolders[0].uri.fsPath;
          this._view?.webview.postMessage({ type: 'setWorkspaceRoot', workspaceRoot });
        }
        // 重放所有活跃的对话到 webview（恢复因 webview 重建而丢失的卡片）
        for (const [rid, data] of this._activePrompts.entries()) {
          this._view?.webview.postMessage({ type: 'showPrompt', prompt: data.prompt, requestId: rid, context: data.context, reply: data.reply, startTimer: true });
        }
        break;
      case 'continue':
        if (requestId) this._activePrompts.delete(requestId);
        this._onUserResponse.fire({ action: 'continue', text: '', images: [], requestId });
        break;
      case 'end':
        if (requestId) this._activePrompts.delete(requestId);
        this._onUserResponse.fire({ action: 'end', text: '', images: [], requestId });
        break;
      case 'submit':
        if (requestId) this._activePrompts.delete(requestId);
        this._handleSubmit(message.text || '', message.images || [], message.files, requestId);
        break;
      case 'setTimeout':
        if (typeof message.timeoutMinutes === 'number' && message.timeoutMinutes >= 0) {
          this._timeoutMinutes = message.timeoutMinutes;
          console.log(`[WindsurfChatOpen] Timeout set to ${this._timeoutMinutes} minutes`);
        }
        break;
      case 'setNeedReply':
        if (typeof message.needReply === 'boolean') {
          this._needReply = message.needReply;
          this._onNeedReplyChanged?.(message.needReply);
          console.log(`[WindsurfChatOpen] NeedReply set to ${this._needReply}`);
        }
        break;
      case 'getWorkspaceRoot':
        // 响应前端请求工作区路径
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
          const root = folders[0].uri.fsPath;
          this._view?.webview.postMessage({ type: 'setWorkspaceRoot', workspaceRoot: root });
        }
        break;
    }
  }

  public getTimeoutMinutes(): number {
    return this._timeoutMinutes;
  }

  public getNeedReply(): boolean {
    return this._needReply;
  }

  async showPrompt(prompt: string, requestId?: string, context?: string, reply?: string) {
    if (!this._view) {
      await vscode.commands.executeCommand(COMMANDS.PANEL_FOCUS);
      const deadline = Date.now() + WEBVIEW_READY_TIMEOUT_MS;
      while (!this._view && Date.now() < deadline) {
        await new Promise<void>(resolve => setTimeout(resolve, 50));
      }
    }

    if (!this._view) {
      this._onUserResponse.fire({
        action: 'error',
        text: '',
        images: [],
        requestId,
        error: ERROR_MESSAGES.PANEL_NOT_AVAILABLE
      });
      return;
    }

    try {
      const readyPromise = this._viewReadyPromise;
      await Promise.race([
        readyPromise,
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('Webview ready timeout')), WEBVIEW_READY_TIMEOUT_MS)
        )
      ]);
    } catch (e) {
      console.error(`[WindsurfChatOpen] ${e}`);
      // Webview not ready, fire error response
      this._onUserResponse.fire({
        action: 'error',
        text: '',
        images: [],
        requestId,
        error: ERROR_MESSAGES.WEBVIEW_NOT_READY
      });
      return;
    }

    if (this._view) {
      this._view.show?.(false);
      if (requestId) {
        this._activePrompts.set(requestId, { prompt, context, reply });
      }
      this._view.webview.postMessage({ type: 'showPrompt', prompt, requestId, context, reply, startTimer: true });
    } else {
      console.error('[WindsurfChatOpen] Panel view not available after focus attempt');
      this._onUserResponse.fire({
        action: 'error',
        text: '',
        images: [],
        requestId,
        error: ERROR_MESSAGES.PANEL_NOT_AVAILABLE
      });
    }
  }


  dismissPrompt(requestId: string) {
    this._activePrompts.delete(requestId);
    this._view?.webview.postMessage({ type: 'dismissPrompt', requestId });
  }

  setPort(port: number) {
    this._port = port;
    this._view?.webview.postMessage({ type: 'setPort', port });
  }

  private _handleSubmit(text: string, images: string[], files?: Array<{ name: string; path: string; size: number }>, requestId?: string) {
    // 验证图片数量
    if (images.length > MAX_IMAGE_COUNT) {
      this._onUserResponse.fire({
        action: 'error',
        text: '',
        images: [],
        requestId,
        error: ERROR_MESSAGES.TOO_MANY_IMAGES
      });
      return;
    }

    const tempDir = os.tmpdir();
    const uniqueId = crypto.randomBytes(4).toString('hex');
    const savedImages: string[] = [];
    const failedImages: number[] = [];
    const oversizedImages: number[] = [];

    // 处理文件路径
    let filesText = '';
    if (files && files.length > 0) {
      filesText = '\n\n用户拖拽了以下文件，请使用 read_file 工具读取：\n';
      files.forEach(file => {
        filesText += `- ${file.path} (${file.name})\n`;
      });
    }

    images.forEach((img, i) => {
      try {
        const base64Data = img.replace(/^data:image\/\w+;base64,/, '');

        // 验证图片大小
        const imageSize = Buffer.byteLength(base64Data, 'base64');
        if (imageSize > MAX_IMAGE_SIZE) {
          oversizedImages.push(i + 1);
          return;
        }

        const imgPath = path.join(tempDir, `wsc_img_${uniqueId}_${i}.png`);
        fs.writeFileSync(imgPath, base64Data, 'base64');
        savedImages.push(imgPath);
      } catch (e) {
        console.error(`[WindsurfChatOpen] ${ERROR_MESSAGES.IMAGE_SAVE_FAILED} ${i}: ${e}`);
        failedImages.push(i + 1);
      }
    });

    let warningPrefix = '';
    if (oversizedImages.length > 0) {
      warningPrefix += `[WindsurfChatOpen 警告] 第 ${oversizedImages.join(', ')} 张图片超过大小限制（5MB），已跳过\n\n`;
    }
    if (failedImages.length > 0) {
      warningPrefix += `[WindsurfChatOpen 警告] 第 ${failedImages.join(', ')} 张图片保存失败\n\n`;
    }

    if (text.length > LONG_TEXT_THRESHOLD) {
      try {
        const txtPath = path.join(tempDir, `windsurf_chat_instruction_${uniqueId}.txt`);
        fs.writeFileSync(txtPath, text, 'utf-8');
        this._onUserResponse.fire({
          action: 'instruction',
          text: `${warningPrefix}[Content too long, saved to file]\n\nUser provided full instruction, please use read_file tool to read the following file:\n- ${txtPath}${filesText}`,
          images: savedImages,
          files: files,
          requestId: requestId
        });
      } catch (e) {
        console.error(`[WindsurfChatOpen] Failed to save text file: ${e}`);
        this._onUserResponse.fire({
          action: 'error',
          text: '',
          images: [],
          requestId,
          error: '保存文本文件失败，请重试'
        });
      }
    } else {
      this._onUserResponse.fire({
        action: 'instruction',
        text: warningPrefix + text + filesText,
        images: savedImages,
        files: files,
        requestId: requestId
      });
    }
  }

}

