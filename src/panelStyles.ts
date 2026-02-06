/**
 * Webview 面板的 CSS 样式
 */
export function getPanelStyles(): string {
  return `
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
    .header-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      background: var(--vscode-editor-background);
      border-radius: 4px;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .header h1 {
      font-size: 15px;
      font-weight: 600;
      margin: 0;
    }
    .version {
      background: var(--vscode-badge-background);
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }
    .header-right {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .prompt-area {
      max-height: 120px;
      overflow-y: auto;
      margin-bottom: 12px;
      padding: 6px 0;
      font-size: 13px;
      line-height: 1.6;
      color: var(--vscode-descriptionForeground);
    }
    #promptText {
      white-space: pre-wrap;
      word-break: break-word;
    }
    #promptText::before {
      content: '🤖 ';
    }
    .countdown {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      opacity: 0.7;
      margin-left: 8px;
    }
    .waiting-indicator {
      display: none;
      background: var(--vscode-inputValidation-infoBackground);
      border: 1px solid var(--vscode-inputValidation-infoBorder);
      border-radius: 4px;
      padding: 8px 12px;
      margin-bottom: 12px;
      animation: pulse 1.5s ease-in-out infinite;
    }
    .waiting-indicator.show {
      display: block;
    }
    .waiting-indicator-text {
      font-size: 13px;
      font-weight: 600;
      color: var(--vscode-inputValidation-infoForeground);
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.6; }
    }
    .input-area {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    #inputText {
      width: 100%;
      min-height: 60px;
      padding: 8px;
      border: 1px solid var(--vscode-input-border, rgba(128, 128, 128, 0.35));
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 4px;
      font-family: inherit;
      font-size: 13px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-word;
    }
    #inputText:focus {
      outline: 1px solid var(--vscode-focusBorder);
    }
    #inputText:empty:before {
      content: attr(data-placeholder);
      color: var(--vscode-input-placeholderForeground);
      opacity: 0.6;
    }
    .file-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 6px;
      margin: 0 2px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      border: 1px solid var(--vscode-widget-border);
      border-radius: 3px;
      font-size: 12px;
      cursor: default;
      user-select: none;
      vertical-align: middle;
      white-space: nowrap;
    }
    .file-chip .chip-icon {
      font-size: 14px;
      line-height: 1;
    }
    .file-chip .chip-name {
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .file-chip .chip-delete {
      margin-left: 2px;
      cursor: pointer;
      opacity: 0.7;
      font-weight: bold;
      font-size: 14px;
      line-height: 1;
      padding: 0 2px;
    }
    .file-chip .chip-delete:hover {
      opacity: 1;
      color: var(--vscode-errorForeground);
    }
    #inputText.drag-over {
      border-color: var(--vscode-focusBorder);
      background: var(--vscode-list-dropBackground);
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
      cursor: pointer;
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
    .hint {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-top: 4px;
    }
    .settings-toggle {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      padding: 0;
      background: transparent;
      color: var(--vscode-foreground);
      border: none;
      border-radius: 3px;
      cursor: pointer;
      font-size: 14px;
      transition: background 0.1s;
      opacity: 0.7;
    }
    .settings-toggle:hover {
      background: var(--vscode-toolbar-hoverBackground);
      opacity: 1;
    }
    .settings-toggle-icon {
      transition: transform 0.2s;
      display: inline-block;
    }
    .settings-toggle.expanded .settings-toggle-icon {
      transform: rotate(45deg);
    }
    .port-display {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }
    .connection-status {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--vscode-testing-iconPassed);
    }
    .connection-status.disconnected {
      background: var(--vscode-testing-iconFailed);
    }
    .config-bar {
      display: none;
      flex-direction: column;
      gap: 12px;
      margin-bottom: 12px;
      padding: 12px;
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-widget-border);
      border-radius: 4px;
      font-size: 12px;
      overflow: hidden;
      max-height: 0;
      opacity: 0;
      transition: max-height 0.3s ease, opacity 0.3s ease, padding 0.3s ease;
    }
    .config-bar.show {
      display: flex;
      max-height: 200px;
      opacity: 1;
    }
    .config-bar-row {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .config-item {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .config-item label {
      color: var(--vscode-descriptionForeground);
    }
    .config-item input {
      width: 80px;
      padding: 4px 8px;
      border: 1px solid var(--vscode-input-border, rgba(128, 128, 128, 0.35));
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 3px;
      font-size: 12px;
    }
    .config-item input:focus {
      outline: 1px solid var(--vscode-focusBorder);
    }
    .config-item .hint-text {
      color: var(--vscode-descriptionForeground);
      opacity: 0.7;
    }
    .timeout-presets {
      display: flex;
      gap: 6px;
      margin-left: 8px;
    }
    .timeout-preset-btn {
      padding: 2px 8px;
      font-size: 11px;
      border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border-radius: 3px;
      cursor: pointer;
      transition: background 0.1s;
    }
    .timeout-preset-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    .timeout-preset-btn:active {
      transform: translateY(1px);
    }
    .confirm-config-btn {
      padding: 4px 16px;
      margin-left: auto;
      font-size: 12px;
      border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-radius: 3px;
      cursor: pointer;
      transition: background 0.1s;
    }
    .confirm-config-btn:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .confirm-config-btn:active {
      transform: translateY(1px);
    }
    .tab-bar {
      display: none;
      margin-bottom: 8px;
      border-bottom: 1px solid var(--vscode-widget-border);
    }
    .tab-bar.show {
      display: block;
    }
    .tab-bar-inner {
      display: flex;
      gap: 0;
      overflow-x: auto;
      scrollbar-width: thin;
    }
    .tab-bar-inner::-webkit-scrollbar {
      height: 3px;
    }
    .tab-bar-inner::-webkit-scrollbar-thumb {
      background: var(--vscode-scrollbarSlider-background);
      border-radius: 3px;
    }
    .tab-item {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      font-size: 12px;
      cursor: pointer;
      white-space: nowrap;
      border-bottom: 2px solid transparent;
      color: var(--vscode-descriptionForeground);
      transition: color 0.15s, border-color 0.15s;
      flex-shrink: 0;
    }
    .tab-item:hover {
      color: var(--vscode-foreground);
      background: var(--vscode-list-hoverBackground);
    }
    .tab-item.active {
      color: var(--vscode-foreground);
      border-bottom-color: var(--vscode-focusBorder);
    }
    .tab-item .tab-label {
      max-width: 120px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .tab-item .tab-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--vscode-testing-iconPassed);
      flex-shrink: 0;
      animation: pulse 1.5s ease-in-out infinite;
    }
    .tab-item .tab-close {
      font-size: 14px;
      line-height: 1;
      opacity: 0;
      cursor: pointer;
      padding: 0 2px;
      transition: opacity 0.15s;
    }
    .tab-item:hover .tab-close {
      opacity: 0.7;
    }
    .tab-item .tab-close:hover {
      opacity: 1;
      color: var(--vscode-errorForeground);
    }
  `;
}

