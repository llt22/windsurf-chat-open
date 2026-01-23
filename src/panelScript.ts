/**
 * Webview 面板的 JavaScript 脚本
 */
export function getPanelScript(): string {
  return `
    const vscode = acquireVsCodeApi();
    const inputText = document.getElementById('inputText');
    const promptText = document.getElementById('promptText');
    const countdown = document.getElementById('countdown');
    const imagePreview = document.getElementById('imagePreview');
    const imageModal = document.getElementById('imageModal');
    const modalImage = document.getElementById('modalImage');
    const waitingIndicator = document.getElementById('waitingIndicator');
    const timeoutInput = document.getElementById('timeoutInput');
    const connectionStatus = document.getElementById('connectionStatus');
    let images = [];
    let currentRequestId = '';
    let currentPort = 0;
    let workspaceRoot = ''; // 工作区根目录

    const MAX_IMAGE_COUNT = 10;
    const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
    let timeoutMinutes = 30; // 默认30分钟
    let fileChipIdCounter = 0; // 用于生成唯一的 file-chip ID

    // 支持的文本文件扩展名
    const TEXT_FILE_EXTENSIONS = [
      '.txt', '.md', '.json', '.xml', '.yaml', '.yml', '.toml',
      '.js', '.ts', '.jsx', '.tsx', '.vue', '.html', '.css', '.scss', '.less',
      '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.go', '.rs', '.php',
      '.rb', '.swift', '.kt', '.scala', '.sh', '.bash', '.zsh', '.fish',
      '.sql', '.graphql', '.proto', '.thrift',
      '.log', '.csv', '.ini', '.conf', '.config', '.env',
      '.gitignore', '.dockerignore', '.editorconfig', '.prettierrc', '.eslintrc'
    ];

    // 设置展开/收起
    const settingsToggle = document.getElementById('settingsToggle');
    const configBar = document.getElementById('configBar');
    settingsToggle.addEventListener('click', () => {
      settingsToggle.classList.toggle('expanded');
      configBar.classList.toggle('show');
    });

    // 监听超时时间输入变化
    timeoutInput.addEventListener('change', () => {
      const value = parseInt(timeoutInput.value);
      if (!isNaN(value) && value >= 0) {
        timeoutMinutes = value;
        vscode.postMessage({ type: 'setTimeout', timeoutMinutes: value });
      }
    });

    // 快捷设置按钮
    document.querySelectorAll('.timeout-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const minutes = parseInt(btn.getAttribute('data-minutes'));
        timeoutInput.value = minutes;
        timeoutMinutes = minutes;
        vscode.postMessage({ type: 'setTimeout', timeoutMinutes: minutes });
      });
    });

    document.getElementById('btnSubmit').onclick = submit;
    document.getElementById('btnEnd').onclick = () => {
      waitingIndicator.classList.remove('show');
      vscode.postMessage({ type: 'end', requestId: currentRequestId });
    };
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
      waitingIndicator.classList.remove('show');

      // 从 contenteditable 中提取文本和文件路径
      let text = getTextWithFilePaths();
      const validImages = images.filter(img => img !== null);

      if (text || validImages.length > 0) {
        vscode.postMessage({
          type: 'submit',
          text,
          images: validImages,
          requestId: currentRequestId
        });
        inputText.innerHTML = '';
        images = [];
        imagePreview.innerHTML = '';
      } else {
        vscode.postMessage({ type: 'continue', requestId: currentRequestId });
      }
    }

    // 从 contenteditable 中提取文本，将 file-chip 替换为完整路径
    function getTextWithFilePaths() {
      const clonedNode = inputText.cloneNode(true);
      const fileChips = clonedNode.querySelectorAll('.file-chip');

      fileChips.forEach(chip => {
        const path = chip.getAttribute('data-path');
        const textNode = document.createTextNode(path || chip.textContent);
        chip.parentNode.replaceChild(textNode, chip);
      });

      return clonedNode.textContent.trim();
    }

    // 获取纯文本内容（用于判断是否为空）
    function getPlainText() {
      return inputText.textContent.trim();
    }

    inputText.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault();
        submit();
      } else if (e.key === 'Escape') {
        waitingIndicator.classList.remove('show');
        vscode.postMessage({ type: 'end', requestId: currentRequestId });
      }
    });

    inputText.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) addImage(file);
        }
      }
    });

    // 拖拽文件/文件夹处理
    inputText.addEventListener('drop', (e) => {
      e.preventDefault();
      inputText.classList.remove('drag-over');

      const items = e.dataTransfer?.items;
      if (!items || items.length === 0) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];

        // 处理图片文件
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file && file.type.startsWith('image/')) {
            addImage(file);
          }
        }

        // 处理文件/文件夹路径
        if (item.kind === 'string' && item.type === 'text/uri-list') {
          item.getAsString((uriString) => {
            if (uriString) {
              let filePath = uriString.trim();
              
              // 解析 file:// URI
              if (filePath.startsWith('file:///')) {
                // file:///d:/path/to/file (Windows) -> d:/path/to/file
                // file:///home/user/file (Unix) -> /home/user/file
                filePath = filePath.substring(8); // 移除 file:///
                
                // Unix 路径需要加回开头的 /
                if (!/^[a-zA-Z]:/.test(filePath)) {
                  filePath = '/' + filePath;
                }
              } else if (filePath.startsWith('file://')) {
                filePath = filePath.substring(7); // 移除 file://
              }
              
              // URL 解码
              filePath = decodeURIComponent(filePath);
              
              // 统一路径分隔符为反斜杠（Windows 标准）
              filePath = filePath.replace(/\//g, '\\');

              const pathParts = filePath.split(/[\\\\\\/]/);
              const name = pathParts.pop() || '';

              const isFolder = !name.includes('.') || name.startsWith('.');
              const isTextFile = isTextFileByName(name);

              if (isFolder || isTextFile) {
                insertFileChip(name, filePath, isFolder);
              }
            }
          });
        }
      }
    });

    inputText.addEventListener('dragover', (e) => {
      e.preventDefault();
      inputText.classList.add('drag-over');
    });

    inputText.addEventListener('dragleave', (e) => {
      inputText.classList.remove('drag-over');
    });

    // 在光标位置插入文件芯片
    function insertFileChip(name, path, isFolder) {
      const selection = window.getSelection();
      if (!selection.rangeCount) return;

      // 转换为相对于工作区的路径
      let relativePath = path;
      if (workspaceRoot && path.startsWith(workspaceRoot)) {
        relativePath = path.substring(workspaceRoot.length);
        // 移除开头的路径分隔符
        if (relativePath.startsWith('\\\\') || relativePath.startsWith('/')) {
          relativePath = relativePath.substring(1);
        }
        // 统一使用正斜杠
        relativePath = relativePath.replace(/\\\\/g, '/');
      }

      const range = selection.getRangeAt(0);

      const chip = document.createElement('span');
      chip.className = 'file-chip';
      chip.contentEditable = 'false';
      chip.setAttribute('data-path', relativePath);
      chip.setAttribute('data-id', 'chip-' + (fileChipIdCounter++));

      const icon = document.createElement('span');
      icon.className = 'chip-icon';
      icon.textContent = isFolder ? '📁' : '📄';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'chip-name';
      nameSpan.textContent = name;
      nameSpan.title = relativePath;

      const deleteBtn = document.createElement('span');
      deleteBtn.className = 'chip-delete';
      deleteBtn.textContent = '×';
      deleteBtn.onclick = (e) => {
        e.stopPropagation();
        chip.remove();
      };

      chip.appendChild(icon);
      chip.appendChild(nameSpan);
      chip.appendChild(deleteBtn);

      range.deleteContents();
      range.insertNode(chip);

      const space = document.createTextNode(' ');
      range.setStartAfter(chip);
      range.insertNode(space);

      range.setStartAfter(space);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);

      inputText.focus();
    }

    function addImage(file) {
      // 检查图片数量限制
      if (images.filter(img => img !== null).length >= MAX_IMAGE_COUNT) {
        alert('图片数量超过限制（最多 ' + MAX_IMAGE_COUNT + ' 张）');
        return;
      }

      // 检查图片大小限制
      if (file.size > MAX_IMAGE_SIZE) {
        alert('图片大小超过限制（单张最大 5MB）');
        return;
      }

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

    function isTextFile(file) {
      const fileName = file.name.toLowerCase();
      return TEXT_FILE_EXTENSIONS.some(ext => fileName.endsWith(ext));
    }

    function isTextFileByName(fileName) {
      const lowerName = fileName.toLowerCase();
      return TEXT_FILE_EXTENSIONS.some(ext => lowerName.endsWith(ext));
    }

    let countdownInterval;
    let displayInterval;
    let remainingSeconds = 0;

    function startCountdown() {
      if (countdownInterval) clearInterval(countdownInterval);
      if (displayInterval) clearInterval(displayInterval);

      // 如果超时时间为0，不启动倒计时
      if (timeoutMinutes === 0) {
        countdown.textContent = '⏱️ 不限制';
        return;
      }

      remainingSeconds = timeoutMinutes * 60;
      countdownInterval = setInterval(() => {
        remainingSeconds--;
        if (remainingSeconds <= 0) {
          clearInterval(countdownInterval);
          clearInterval(displayInterval);
          countdown.textContent = '';
        }
      }, 1000);
    }

    function getCountdownText() {
      const minutes = Math.floor(remainingSeconds / 60);
      const seconds = remainingSeconds % 60;
      return '⏱️ ' + minutes + ':' + seconds.toString().padStart(2, '0');
    }

    window.addEventListener('message', (e) => {
      const msg = e.data;
      if (msg.type === 'showPrompt') {
        promptText.textContent = msg.prompt;
        currentRequestId = msg.requestId || '';
        waitingIndicator.classList.add('show');
        inputText.focus();
        if (msg.startTimer) {
          startCountdown();
          if (timeoutMinutes > 0) {
            if (displayInterval) clearInterval(displayInterval);
            displayInterval = setInterval(() => {
              if (remainingSeconds > 0) {
                countdown.textContent = getCountdownText();
              } else {
                clearInterval(displayInterval);
                countdown.textContent = '';
              }
            }, 1000);
          }
        }
      } else if (msg.type === 'setPort') {
        currentPort = msg.port;
        document.getElementById('portInfo').textContent = '端口: ' + msg.port;
        // 服务启动后显示绿色状态
        connectionStatus.classList.remove('disconnected');
        connectionStatus.title = '服务运行中';
      } else if (msg.type === 'setTimeoutMinutes') {
        if (typeof msg.timeoutMinutes === 'number' && msg.timeoutMinutes >= 0) {
          timeoutMinutes = msg.timeoutMinutes;
          timeoutInput.value = msg.timeoutMinutes;
        }
      } else if (msg.type === 'setWorkspaceRoot') {
        // 接收工作区根目录
        if (msg.workspaceRoot) {
          workspaceRoot = msg.workspaceRoot;
          console.log('[WindsurfChatOpen] Workspace root set to:', workspaceRoot);
        }
      }
    });

    vscode.postMessage({ type: 'ready' });
  `;
}

