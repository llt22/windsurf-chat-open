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
  type: 'ready' | 'continue' | 'end' | 'submit' | 'getWorkspaceRoot' | 'regenerate';
  text?: string;
  images?: string[];
  files?: Array<{ name: string; path: string; size: number }>;
  requestId?: string;
}

export class ChatPanelProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _onUserResponse = new vscode.EventEmitter<UserResponse>();
  public onUserResponse = this._onUserResponse.event;
  private _viewReadyResolve?: () => void;
  private _viewReadyPromise?: Promise<void>;
  private _isWebviewReady: boolean = false;
  private _panelId: string = '';
  private _toolName: string = '';
  private _activePrompts: Map<string, { prompt: string; context?: string }> = new Map();

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _version: string
  ) {
    this._resetViewReadyPromise();
  }

  setPanelId(panelId: string) {
    this._panelId = panelId;
    this._view?.webview.postMessage({ type: 'setPanelId', panelId });
  }

  setToolName(toolName: string) {
    this._toolName = toolName;
    this._view?.webview.postMessage({ type: 'setToolName', toolName });
  }

  private _resetViewReadyPromise() {
    this._isWebviewReady = false;
    this._viewReadyPromise = new Promise<void>((resolve) => {
      this._viewReadyResolve = resolve;
    });
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
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
        // 发送面板 ID 和工具名
        if (this._panelId) {
          this._view?.webview.postMessage({ type: 'setPanelId', panelId: this._panelId });
        }
        if (this._toolName) {
          this._view?.webview.postMessage({ type: 'setToolName', toolName: this._toolName });
        }
        // 发送工作区根目录
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
          this._view?.webview.postMessage({ type: 'setWorkspaceRoot', workspaceRoot: workspaceFolders[0].uri.fsPath });
        }
        // 重放活跃的对话卡片
        for (const [rid, data] of this._activePrompts.entries()) {
          this._view?.webview.postMessage({ type: 'showPrompt', prompt: data.prompt, requestId: rid, context: data.context, startTimer: true });
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
      case 'getWorkspaceRoot':
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
          this._view?.webview.postMessage({ type: 'setWorkspaceRoot', workspaceRoot: folders[0].uri.fsPath });
        }
        break;
      case 'regenerate':
        vscode.commands.executeCommand(COMMANDS.REGENERATE);
        break;
    }
  }

  async showPrompt(prompt: string, requestId?: string, context?: string) {
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
      await Promise.race([
        this._viewReadyPromise,
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('Webview ready timeout')), WEBVIEW_READY_TIMEOUT_MS)
        )
      ]);
    } catch (e) {
      console.error(`[DevFlow] ${e}`);
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
        this._activePrompts.set(requestId, { prompt, context });
      }
      this._view.webview.postMessage({ type: 'showPrompt', prompt, requestId, context, startTimer: true });
    } else {
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

  private _handleSubmit(text: string, images: string[], files?: Array<{ name: string; path: string; size: number }>, requestId?: string) {
    if (images.length > MAX_IMAGE_COUNT) {
      this._onUserResponse.fire({
        action: 'error',
        text: '',
        images: [],
        requestId,
        error: '图片数量超过限制'
      });
      return;
    }

    const tempDir = os.tmpdir();
    const uniqueId = crypto.randomBytes(4).toString('hex');
    const savedImages: string[] = [];

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
        const imageSize = Buffer.byteLength(base64Data, 'base64');
        if (imageSize > MAX_IMAGE_SIZE) return;

        const imgPath = path.join(tempDir, `df_img_${uniqueId}_${i}.png`);
        fs.writeFileSync(imgPath, base64Data, 'base64');
        savedImages.push(imgPath);
      } catch (e) {
        console.error(`[DevFlow] Image save failed ${i}: ${e}`);
      }
    });

    if (text.length > LONG_TEXT_THRESHOLD) {
      try {
        const txtPath = path.join(tempDir, `df_instruction_${uniqueId}.txt`);
        fs.writeFileSync(txtPath, text, 'utf-8');
        this._onUserResponse.fire({
          action: 'instruction',
          text: `[Content too long, saved to file]\n\nUser provided full instruction, please use read_file tool to read the following file:\n- ${txtPath}${filesText}`,
          images: savedImages,
          files,
          requestId
        });
      } catch (e) {
        this._onUserResponse.fire({
          action: 'error',
          text: '',
          images: [],
          requestId,
          error: '保存文本文件失败'
        });
      }
    } else {
      this._onUserResponse.fire({
        action: 'instruction',
        text: text + filesText,
        images: savedImages,
        files,
        requestId
      });
    }
  }
}
