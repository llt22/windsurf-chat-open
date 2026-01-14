import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

export interface UserResponse {
  action: 'continue' | 'end' | 'instruction';
  text: string;
  images: string[];
}

const WEBVIEW_READY_TIMEOUT_MS = 5000;
const LONG_TEXT_THRESHOLD = 500;

export class ChatPanelProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _onUserResponse = new vscode.EventEmitter<UserResponse>();
  public onUserResponse = this._onUserResponse.event;
  private _port: number = 0;
  private _viewReadyResolve?: () => void;
  private _viewReadyPromise?: Promise<void>;

  constructor(private readonly _extensionUri: vscode.Uri) {
    this._resetViewReadyPromise();
  }

  private _resetViewReadyPromise() {
    this._viewReadyPromise = new Promise<void>((resolve) => {
      this._viewReadyResolve = resolve;
    });
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = this._getHtml();

    // 面板初始化后，如果已有端口信息则发送
    if (this._port > 0) {
      webviewView.webview.postMessage({ type: 'setPort', port: this._port });
    }

    webviewView.webview.onDidReceiveMessage((message) => {
      switch (message.type) {
        case 'ready':
          if (this._viewReadyResolve) {
            this._viewReadyResolve();
          }
          break;
        case 'continue':
          this._onUserResponse.fire({ action: 'continue', text: '', images: [] });
          break;
        case 'end':
          this._onUserResponse.fire({ action: 'end', text: '', images: [] });
          break;
        case 'submit':
          this._handleSubmit(message.text, message.images || []);
          break;
      }
    });

    // 面板被隐藏时重置 ready promise
    webviewView.onDidChangeVisibility(() => {
      if (!webviewView.visible) {
        this._resetViewReadyPromise();
      }
    });
  }

  async showPrompt(prompt: string) {
    // 如果面板未初始化，先打开面板
    if (!this._view) {
      await vscode.commands.executeCommand('windsurfChatOpen.panel.focus');
    }

    // 等待 webview 真正就绪（带超时保护）
    try {
      await Promise.race([
        this._viewReadyPromise,
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('Webview 就绪超时')), WEBVIEW_READY_TIMEOUT_MS)
        )
      ]);
    } catch {
      // 超时后继续尝试发送消息
    }

    if (this._view) {
      this._view.show?.(false);
      this._view.webview.postMessage({ type: 'showPrompt', prompt, startTimer: true });
    }
  }

  setPort(port: number) {
    this._port = port;
    if (this._view) {
      this._view.webview.postMessage({ type: 'setPort', port });
    }
  }

  private _handleSubmit(text: string, images: string[]) {
    const tempDir = os.tmpdir();
    const timestamp = Date.now();
    const uniqueId = crypto.randomBytes(4).toString('hex');
    const savedImages: string[] = [];

    for (let i = 0; i < images.length; i++) {
      try {
        const imgPath = path.join(tempDir, `wsc_img_${uniqueId}_${i}.png`);
        const base64Data = images[i].replace(/^data:image\/\w+;base64,/, '');
        fs.writeFileSync(imgPath, base64Data, 'base64');
        savedImages.push(imgPath);
      } catch {
        // 忽略单个图片保存失败
      }
    }

    if (text.length > LONG_TEXT_THRESHOLD) {
      const txtPath = path.join(tempDir, `windsurf_chat_instruction_${timestamp}.txt`);
      fs.writeFileSync(txtPath, text, 'utf-8');
      this._onUserResponse.fire({
        action: 'instruction',
        text: `[Content too long, saved to file]\n\nUser provided full instruction, please use read_file tool to read the following file:\n- ${txtPath}`,
        images: savedImages
      });
    } else {
      this._onUserResponse.fire({
        action: 'instruction',
        text,
        images: savedImages
      });
    }
  }

  private _getHtml(): string {
    // 使用单独的模板模块
    const { getPanelHtml } = require('./panelTemplate');
    return getPanelHtml();
  }
}
