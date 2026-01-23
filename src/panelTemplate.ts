import { getPanelStyles } from './panelStyles';
import { getPanelScript } from './panelScript';

/**
 * 获取 webview 的 HTML 内容
 */
export function getPanelHtml(version: string = '0.0.0'): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WindsurfChat</title>
  <style>
    ${getPanelStyles()}
  </style>
</head>
<body>
  <div class="header">
    <div class="header-bar">
      <div class="header-left">
        <h1>WindsurfChat Open</h1>
        <span class="version">v${version}</span>
      </div>
      <div class="header-right">
        <button class="settings-toggle" id="settingsToggle" title="设置">
          <span class="settings-toggle-icon">⚙️</span>
        </button>
        <div class="port-display">
          <span id="portInfo">端口: --</span>
          <span class="connection-status" id="connectionStatus"></span>
        </div>
      </div>
    </div>
  </div>

  <div class="config-bar" id="configBar">
    <div class="config-bar-row">
      <div class="config-item">
        <label for="timeoutInput">超时时间:</label>
        <input type="number" id="timeoutInput" min="0" step="1" value="30" />
        <span>分钟</span>
        <span class="hint-text">(0=不限制)</span>
      </div>
      <div class="timeout-presets">
        <button class="timeout-preset-btn" data-minutes="0">不限制</button>
        <button class="timeout-preset-btn" data-minutes="30">30分钟</button>
        <button class="timeout-preset-btn" data-minutes="60">1小时</button>
        <button class="timeout-preset-btn" data-minutes="240">4小时</button>
        <button class="timeout-preset-btn" data-minutes="480">8小时</button>
      </div>
    </div>
  </div>
  
  <div class="waiting-indicator" id="waitingIndicator">
    <span class="waiting-indicator-text">✨ AI 等待你的输入...</span>
    <span id="countdown" class="countdown"></span>
  </div>
  
  <div class="prompt-area">
    <div id="promptText">等待 AI 输出...</div>
  </div>
  
  <div class="input-area">
    <div id="inputText" contenteditable="true" data-placeholder="输入反馈或指令...支持拖拽图片、文本文件和文件夹"></div>
    <div class="image-preview" id="imagePreview"></div>
    <div class="buttons">
      <button class="btn-primary" id="btnSubmit">提交 (Ctrl+Enter)</button>
      <button class="btn-danger" id="btnEnd">结束对话</button>
    </div>
    <div class="hint">空提交=继续 | Ctrl+Enter 提交 | Esc 结束</div>
  </div>
  
  <div class="modal" id="imageModal">
    <button class="modal-close" id="modalClose">×</button>
    <img id="modalImage" src="" alt="preview">
  </div>

  <script>
    ${getPanelScript()}
  </script>
</body>
</html>`;
}

