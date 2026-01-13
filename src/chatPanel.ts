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
        case 'updateTimeoutMessage':
          // 保存到配置
          vscode.workspace.getConfiguration('windsurfChatOpen').update('timeoutMessage', message.message, true);
          break;
      }
    });
  }

  showPrompt(prompt: string) {
    if (this._view) {
      this._view.webview.postMessage({ type: 'showPrompt', prompt, startTimer: true });
      this._view.show?.(true);
    }
  }

  autoSubmit(text: string) {
    this._onUserResponse.fire({
      action: 'instruction',
      text,
      images: []
    });
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
      margin-bottom: 16px;
    }
    .header h1 {
      font-size: 15px;
      font-weight: 600;
      margin-bottom: 6px;
    }
    .header-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }
    .version {
      background: var(--vscode-badge-background);
      padding: 2px 6px;
      border-radius: 3px;
    }
    .slogan {
      opacity: 0.8;
    }
    .prompt-area {
      max-height: 120px;
      overflow-y: auto;
      margin-bottom: 12px;
      padding: 6px 0;
      font-size: 13px;
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-word;
      color: var(--vscode-descriptionForeground);
    }
    .prompt-area::before {
      content: '🤖 ';
      color: var(--vscode-descriptionForeground);
      font-size: 13px;
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
      padding: 6px 12px;
      border: 1px solid var(--vscode-widget-border);
      background: transparent;
      color: var(--vscode-foreground);
      border-radius: 3px;
      cursor: pointer;
      font-size: 12px;
      opacity: 0.7;
      transition: opacity 0.2s;
    }
    button:hover {
      opacity: 1;
      background: var(--vscode-list-hoverBackground);
    }
    .btn-primary {
      border-color: var(--vscode-focusBorder);
    }
    .btn-danger {
      color: var(--vscode-errorForeground);
    }
    .image-preview {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 8px;
      padding: 4px;
    }
    .image-preview .img-wrapper {
      position: relative;
      display: inline-block;
    }
    .image-preview img {
      max-width: 60px;
      max-height: 60px;
      border-radius: 4px;
      border: 1px solid var(--vscode-widget-border);
      display: block;
    }
    .image-preview .img-delete {
      position: absolute;
      top: -8px;
      right: -8px;
      width: 20px;
      height: 20px;
      background: #d32f2f;
      color: white;
      border: none;
      border-radius: 50%;
      cursor: pointer;
      z-index: 10;
      padding: 0;
      margin: 0;
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      font-weight: bold;
      line-height: 1;
    }
    .image-preview .img-delete:hover {
      background: #b71c1c;
    }
    .image-preview img {
      cursor: pointer;
    }
    .modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.9);
      z-index: 100;
      justify-content: center;
      align-items: center;
    }
    .modal.show {
      display: flex;
    }
    .modal img {
      max-width: 90%;
      max-height: 90%;
      border-radius: 8px;
    }
    .modal-close {
      position: absolute;
      top: 20px;
      right: 20px;
      color: white;
      font-size: 30px;
      cursor: pointer;
      background: none;
      border: none;
    }
    .timeout-config {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
      padding: 8px;
      background: var(--vscode-input-background);
      border-radius: 4px;
    }
    .timeout-config label {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      white-space: nowrap;
    }
    .timeout-config input {
      flex: 1;
      padding: 4px 8px;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 3px;
      font-size: 12px;
    }
    .timeout-config input:focus {
      outline: 1px solid var(--vscode-focusBorder);
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
    <div class="header-meta">
      <span class="version">v1.0.0</span>
      <span class="slogan">🎉 免费开源 · 安全可控 · 无需配置</span>
    </div>
  </div>
  
  <div class="prompt-area" id="promptArea">等待 AI 输出...</div>
  
  <div class="timeout-config">
    <label>⏱️ 超时消息：</label>
    <input type="text" id="timeoutMessage" placeholder="用户还在思考中，请继续等待..." />
  </div>
  
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
  
  <div class="modal" id="imageModal">
    <button class="modal-close" id="modalClose">×</button>
    <img id="modalImage" src="" alt="preview">
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const inputText = document.getElementById('inputText');
    const promptArea = document.getElementById('promptArea');
    const imagePreview = document.getElementById('imagePreview');
    const imageModal = document.getElementById('imageModal');
    const modalImage = document.getElementById('modalImage');
    const timeoutMessageInput = document.getElementById('timeoutMessage');
    let images = [];

    // 加载保存的超时消息
    const state = vscode.getState() || {};
    timeoutMessageInput.value = state.timeoutMessage || '用户还在思考中，请继续等待...';

    // 保存超时消息
    timeoutMessageInput.addEventListener('input', () => {
      vscode.setState({ ...state, timeoutMessage: timeoutMessageInput.value });
      vscode.postMessage({ type: 'updateTimeoutMessage', message: timeoutMessageInput.value });
    });

    document.getElementById('btnSubmit').onclick = submit;
    document.getElementById('btnContinue').onclick = () => vscode.postMessage({ type: 'continue' });
    document.getElementById('btnEnd').onclick = () => vscode.postMessage({ type: 'end' });
    document.getElementById('modalClose').onclick = closeModal;
    imageModal.onclick = (e) => { if (e.target === imageModal) closeModal(); };

    function showModal(src) {
      modalImage.src = src;
      imageModal.classList.add('show');
    }
    function closeModal() {
      imageModal.classList.remove('show');
    }

    function submit() {
      const text = inputText.value.trim();
      const validImages = images.filter(img => img !== null);
      if (text || validImages.length > 0) {
        vscode.postMessage({ type: 'submit', text, images: validImages });
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
        const index = images.length;
        images.push(dataUrl);
        
        const wrapper = document.createElement('div');
        wrapper.className = 'img-wrapper';
        
        const img = document.createElement('img');
        img.src = dataUrl;
        img.onclick = () => showModal(dataUrl);
        
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'img-delete';
        deleteBtn.textContent = '×';
        deleteBtn.onclick = (e) => { e.stopPropagation(); removeImage(index, wrapper); };
        
        wrapper.appendChild(img);
        wrapper.appendChild(deleteBtn);
        imagePreview.appendChild(wrapper);
      };
      reader.readAsDataURL(file);
    }

    function removeImage(index, wrapper) {
      images[index] = null;
      wrapper.remove();
    }

    let countdownInterval;
    let remainingSeconds = 5 * 60;

    function startCountdown() {
      if (countdownInterval) clearInterval(countdownInterval);
      remainingSeconds = 5 * 60;
      
      countdownInterval = setInterval(() => {
        remainingSeconds--;
        if (remainingSeconds <= 0) {
          clearInterval(countdownInterval);
        }
      }, 1000);
    }

    function getCountdownText() {
      const minutes = Math.floor(remainingSeconds / 60);
      const seconds = remainingSeconds % 60;
      return \`⏱️ \${minutes}:\${seconds.toString().padStart(2, '0')}\`;
    }

    window.addEventListener('message', (e) => {
      const msg = e.data;
      if (msg.type === 'showPrompt') {
        promptArea.textContent = msg.prompt;
        if (msg.startTimer) {
          startCountdown();
          // 每秒更新显示
          const updateDisplay = setInterval(() => {
            if (remainingSeconds > 0) {
              promptArea.textContent = msg.prompt + '\\n' + getCountdownText();
            } else {
              clearInterval(updateDisplay);
            }
          }, 1000);
        }
      }
    });
  </script>
</body>
</html>`;
  }
}
