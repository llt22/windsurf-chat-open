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

export class ChatPanelProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _onUserResponse = new vscode.EventEmitter<UserResponse>();
  public onUserResponse = this._onUserResponse.event;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = this._getHtml();

    webviewView.webview.onDidReceiveMessage((message) => {
      switch (message.type) {
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
  }

  showPrompt(prompt: string) {
    if (this._view) {
      this._view.webview.postMessage({ type: 'showPrompt', prompt });
      this._view.show?.(true);
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
        console.log(`[WindsurfChatOpen] 图片已保存: ${imgPath}`);
      } catch (e) {
        console.error(`[WindsurfChatOpen] 保存图片失败: ${e}`);
      }
    }

    if (text.length > 500) {
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
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WindsurfChat</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      padding: 12px;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--vscode-widget-border);
    }
    .header h1 {
      font-size: 14px;
      font-weight: 600;
    }
    .version {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-badge-background);
      padding: 2px 6px;
      border-radius: 4px;
    }
    .prompt-area {
      max-height: 120px;
      overflow-y: auto;
      margin-bottom: 12px;
      padding: 8px;
      background: var(--vscode-input-background);
      border-radius: 4px;
      font-size: 13px;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .prompt-area:empty {
      display: none;
    }
    .input-area {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    textarea {
      width: 100%;
      min-height: 60px;
      padding: 8px;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 4px;
      resize: vertical;
      font-family: inherit;
      font-size: 13px;
    }
    textarea:focus {
      outline: 1px solid var(--vscode-focusBorder);
    }
    .buttons {
      display: flex;
      gap: 8px;
    }
    button {
      flex: 1;
      padding: 8px 12px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
    }
    .btn-primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .btn-primary:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .btn-secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .btn-danger {
      background: #d32f2f;
      color: white;
    }
    .image-preview {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 8px;
    }
    .image-preview img {
      max-width: 80px;
      max-height: 80px;
      border-radius: 4px;
      border: 1px solid var(--vscode-widget-border);
    }
    .hint {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-top: 4px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>WindsurfChat Open</h1>
    <span class="version">v1.0.0</span>
  </div>
  
  <div class="prompt-area" id="promptArea">等待 AI 输出...</div>
  
  <div class="input-area">
    <textarea id="inputText" placeholder="输入反馈或指令...支持拖拽图片"></textarea>
    <div class="image-preview" id="imagePreview"></div>
    <div class="buttons">
      <button class="btn-primary" id="btnSubmit">提交 (Ctrl+Enter)</button>
      <button class="btn-secondary" id="btnContinue">继续</button>
      <button class="btn-danger" id="btnEnd">结束</button>
    </div>
    <div class="hint">Ctrl+Enter 提交 | Esc 结束对话</div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const inputText = document.getElementById('inputText');
    const promptArea = document.getElementById('promptArea');
    const imagePreview = document.getElementById('imagePreview');
    let images = [];

    document.getElementById('btnSubmit').onclick = submit;
    document.getElementById('btnContinue').onclick = () => vscode.postMessage({ type: 'continue' });
    document.getElementById('btnEnd').onclick = () => vscode.postMessage({ type: 'end' });

    function submit() {
      const text = inputText.value.trim();
      if (text || images.length > 0) {
        vscode.postMessage({ type: 'submit', text, images });
        inputText.value = '';
        images = [];
        imagePreview.innerHTML = '';
      } else {
        vscode.postMessage({ type: 'continue' });
      }
    }

    inputText.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault();
        submit();
      } else if (e.key === 'Escape') {
        vscode.postMessage({ type: 'end' });
      }
    });

    inputText.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) addImage(file);
        }
      }
    });

    inputText.addEventListener('drop', (e) => {
      e.preventDefault();
      const files = e.dataTransfer?.files;
      if (!files) return;
      for (const file of files) {
        if (file.type.startsWith('image/')) addImage(file);
      }
    });

    inputText.addEventListener('dragover', (e) => e.preventDefault());

    function addImage(file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target.result;
        images.push(dataUrl);
        const img = document.createElement('img');
        img.src = dataUrl;
        imagePreview.appendChild(img);
      };
      reader.readAsDataURL(file);
    }

    window.addEventListener('message', (e) => {
      const msg = e.data;
      if (msg.type === 'showPrompt') {
        promptArea.textContent = msg.prompt;
      }
    });
  </script>
</body>
</html>`;
  }
}
