// @ts-nocheck
(function () {
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const inputText = $('inputText');
  const promptText = $('promptText');
  const countdown = $('countdown');
  const imagePreview = $('imagePreview');
  const imageModal = $('imageModal');
  const modalImage = $('modalImage');
  const waitingIndicator = $('waitingIndicator');
  const timeoutInput = $('timeoutInput');
  const connectionStatus = $('connectionStatus');
  const tabBar = $('tabBar');
  const tabBarInner = $('tabBarInner');
  const settingsToggle = $('settingsToggle');
  const configBar = $('configBar');

  const conversations = new Map();
  let activeRequestId = null;
  let tabCounter = 0;
  let currentPort = 0;
  let workspaceRoot = '';
  const MAX_IMAGE_COUNT = 10;
  const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
  let timeoutMinutes = 240;
  let fileChipIdCounter = 0;
  let _images = [];

  const TEXT_EXTS = [
    '.txt','.md','.json','.xml','.yaml','.yml','.toml',
    '.js','.ts','.jsx','.tsx','.vue','.html','.css','.scss','.less',
    '.py','.java','.c','.cpp','.h','.hpp','.cs','.go','.rs','.php',
    '.rb','.swift','.kt','.scala','.sh','.bash','.zsh','.fish',
    '.sql','.graphql','.proto','.thrift',
    '.log','.csv','.ini','.conf','.config','.env',
    '.gitignore','.dockerignore','.editorconfig','.prettierrc','.eslintrc'
  ];
  function isTextFileByName(n) { return TEXT_EXTS.some(e => n.toLowerCase().endsWith(e)); }

  // == Tab ==
  function createConversation(requestId, prompt) {
    tabCounter++;
    conversations.set(requestId, {
      requestId, prompt, tabIndex: tabCounter,
      inputHtml: '', images: [], imagePreviewHtml: '',
      countdownStartTime: Date.now(),
      remainingSeconds: timeoutMinutes === 0 ? -1 : timeoutMinutes * 60,
      countdownInterval: null, displayInterval: null, isCountdownRunning: false
    });
    addTab(requestId, tabCounter, prompt);
    switchToConversation(requestId);
    startConvCountdown(requestId);
  }

  function addTab(rid, idx, prompt) {
    const short = (prompt || '').replace(/\s+/g, ' ').trim().substring(0, 20) || ('\u5BF9\u8BDD ' + idx);
    const t = document.createElement('div'); t.className = 'tab-item'; t.setAttribute('data-id', rid);
    const dot = document.createElement('span'); dot.className = 'tab-dot';
    const lbl = document.createElement('span'); lbl.className = 'tab-label'; lbl.textContent = short; lbl.title = prompt || '';
    const cls = document.createElement('span'); cls.className = 'tab-close'; cls.textContent = '\u00D7';
    cls.onclick = (e) => { e.stopPropagation(); endConversation(rid); };
    t.appendChild(dot); t.appendChild(lbl); t.appendChild(cls);
    t.onclick = () => switchToConversation(rid);
    tabBarInner.appendChild(t);
    updateTabBarVisibility();
  }

  function updateTabBarVisibility() { tabBar.classList.toggle('show', conversations.size > 0); }

  function saveCurrentConvState() {
    if (!activeRequestId) return;
    const c = conversations.get(activeRequestId); if (!c) return;
    c.inputHtml = inputText.innerHTML; c.images = _images.slice(); c.imagePreviewHtml = imagePreview.innerHTML;
  }

  function switchToConversation(rid) {
    if (activeRequestId === rid) { updateTabHighlight(rid); return; }
    saveCurrentConvState();
    activeRequestId = rid;
    const c = conversations.get(rid); if (!c) return;
    promptText.textContent = c.prompt;
    waitingIndicator.classList.add('show');
    inputText.innerHTML = c.inputHtml;
    _images = c.images.slice();
    imagePreview.innerHTML = c.imagePreviewHtml;
    restoreCountdownDisplay(c);
    updateTabHighlight(rid);
    inputText.focus();
  }

  function updateTabHighlight(rid) {
    tabBarInner.querySelectorAll('.tab-item').forEach(t => t.classList.toggle('active', t.getAttribute('data-id') === rid));
  }

  function removeConversation(rid) {
    const c = conversations.get(rid);
    if (c) { if (c.countdownInterval) clearInterval(c.countdownInterval); if (c.displayInterval) clearInterval(c.displayInterval); }
    conversations.delete(rid);
    const el = tabBarInner.querySelector('[data-id="' + rid + '"]'); if (el) el.remove();
    updateTabBarVisibility();
    if (activeRequestId === rid) {
      activeRequestId = null;
      const keys = Array.from(conversations.keys());
      if (keys.length > 0) { switchToConversation(keys[keys.length - 1]); }
      else { promptText.textContent = '\u7B49\u5F85 AI \u8F93\u51FA...'; waitingIndicator.classList.remove('show'); countdown.textContent = ''; inputText.innerHTML = ''; _images = []; imagePreview.innerHTML = ''; }
    }
  }

  function endConversation(rid) { vscode.postMessage({ type: 'end', requestId: rid }); removeConversation(rid); }

  // == Countdown ==
  function fmtCD(s) { return '\u23F1\uFE0F ' + Math.floor(s/60) + ':' + (s%60).toString().padStart(2,'0'); }
  function restoreCountdownDisplay(c) {
    if (!c.isCountdownRunning && c.remainingSeconds === -1) countdown.textContent = '\u23F1\uFE0F \u4E0D\u9650\u5236';
    else if (c.isCountdownRunning && c.remainingSeconds > 0) countdown.textContent = fmtCD(c.remainingSeconds);
    else countdown.textContent = '';
  }
  function startConvCountdown(rid) {
    const c = conversations.get(rid); if (!c) return;
    if (c.countdownInterval) clearInterval(c.countdownInterval);
    if (c.displayInterval) clearInterval(c.displayInterval);
    if (timeoutMinutes === 0) { c.remainingSeconds = -1; c.isCountdownRunning = false; if (activeRequestId === rid) countdown.textContent = '\u23F1\uFE0F \u4E0D\u9650\u5236'; return; }
    c.remainingSeconds = timeoutMinutes * 60; c.countdownStartTime = Date.now(); c.isCountdownRunning = true;
    c.countdownInterval = setInterval(() => {
      c.remainingSeconds--;
      if (c.remainingSeconds <= 0) { clearInterval(c.countdownInterval); clearInterval(c.displayInterval); c.countdownInterval = null; c.displayInterval = null; c.isCountdownRunning = false; if (activeRequestId === rid) countdown.textContent = ''; }
    }, 1000);
    c.displayInterval = setInterval(() => {
      if (activeRequestId === rid) { if (c.remainingSeconds > 0) countdown.textContent = fmtCD(c.remainingSeconds); else { countdown.textContent = ''; clearInterval(c.displayInterval); c.displayInterval = null; } }
    }, 1000);
  }
  function updateCountdownForNewTimeout() {
    for (const [,c] of conversations.entries()) {
      if (!c.isCountdownRunning) continue;
      const nr = timeoutMinutes * 60 - Math.floor((Date.now() - c.countdownStartTime) / 1000);
      if (nr <= 0) { c.remainingSeconds = 0; if (c.countdownInterval) clearInterval(c.countdownInterval); if (c.displayInterval) clearInterval(c.displayInterval); c.countdownInterval = null; c.displayInterval = null; c.isCountdownRunning = false; }
      else c.remainingSeconds = nr;
    }
    if (activeRequestId) { const c = conversations.get(activeRequestId); if (c) restoreCountdownDisplay(c); }
  }

  // == Settings ==
  settingsToggle.addEventListener('click', () => { settingsToggle.classList.toggle('expanded'); configBar.classList.toggle('show'); });
  document.querySelectorAll('.timeout-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => { timeoutInput.value = parseInt(btn.getAttribute('data-minutes')); });
  });
  $('confirmConfigBtn').addEventListener('click', () => {
    const v = parseInt(timeoutInput.value);
    if (!isNaN(v) && v >= 0) { timeoutMinutes = v; vscode.postMessage({ type: 'setTimeout', timeoutMinutes: v }); updateCountdownForNewTimeout(); settingsToggle.classList.remove('expanded'); configBar.classList.remove('show'); }
  });

  // == Submit / End ==
  $('btnSubmit').onclick = submit;
  $('btnEnd').onclick = () => { if (activeRequestId) endConversation(activeRequestId); };
  $('modalClose').onclick = closeModal;
  imageModal.onclick = (e) => { if (e.target === imageModal) closeModal(); };
  function showModal(src) { modalImage.src = src; imageModal.classList.add('show'); }
  function closeModal() { imageModal.classList.remove('show'); }

  function submit() {
    if (!activeRequestId) return;
    const rid = activeRequestId;
    const text = getTextWithFilePaths();
    const valid = _images.filter(i => i !== null);
    if (text || valid.length > 0) vscode.postMessage({ type: 'submit', text, images: valid, requestId: rid });
    else vscode.postMessage({ type: 'continue', requestId: rid });
    removeConversation(rid);
  }

  function getTextWithFilePaths() {
    const cl = inputText.cloneNode(true);
    cl.querySelectorAll('.file-chip').forEach(chip => {
      let p = chip.getAttribute('data-path') || '';
      if (workspaceRoot && p.startsWith(workspaceRoot)) {
        p = p.substring(workspaceRoot.length);
        while (p.startsWith('\\') || p.startsWith('/')) p = p.substring(1);
      }
      p = p.replace(/\\/g, '/');
      chip.parentNode.replaceChild(document.createTextNode(p || chip.textContent), chip);
    });
    return cl.textContent.trim();
  }

  // == Keyboard ==
  inputText.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); submit(); }
    else if (e.key === 'Escape' && activeRequestId) endConversation(activeRequestId);
  });

  // == Paste ==
  inputText.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items; if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) { e.preventDefault(); const f = item.getAsFile(); if (f) addImage(f); }
    }
  });

  // == Drag ==
  inputText.addEventListener('drop', handleDrop);
  inputText.addEventListener('dragover', (e) => { e.preventDefault(); inputText.classList.add('drag-over'); });
  inputText.addEventListener('dragleave', () => { inputText.classList.remove('drag-over'); });

  function handleDrop(e) {
    e.preventDefault(); inputText.classList.remove('drag-over');
    const dx = e.clientX, dy = e.clientY, items = e.dataTransfer?.items;
    if (!items || !items.length) return;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === 'file') { const f = it.getAsFile(); if (f && f.type.startsWith('image/')) addImage(f); }
      if (it.kind === 'string' && it.type === 'text/uri-list') {
        it.getAsString((u) => {
          if (!u) return; let fp = u.trim();
          if (fp.startsWith('file:///')) { fp = fp.substring(8); if (!/^[a-zA-Z]:/.test(fp)) fp = '/' + fp; }
          else if (fp.startsWith('file://')) fp = fp.substring(7);
          fp = decodeURIComponent(fp);
          const pts = fp.split(/[\\/]/), nm = pts.pop() || '';
          const isDir = !nm.includes('.') || nm.startsWith('.');
          if (isDir || isTextFileByName(nm)) insertFileChipAtPosition(nm, fp, isDir, dx, dy);
        });
      }
    }
  }

  // == File Chip ==
  function insertFileChipAtPosition(name, path, isFolder, x, y) {
    let range;
    if (document.caretRangeFromPoint) range = document.caretRangeFromPoint(x, y);
    else if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(x, y); range = document.createRange(); range.setStart(p.offsetNode, p.offset); }
    if (!range) { const sel = window.getSelection(); if (!sel.rangeCount) return; range = sel.getRangeAt(0); }
    const chip = document.createElement('span');
    chip.className = 'file-chip'; chip.contentEditable = 'false';
    chip.setAttribute('data-path', path); chip.setAttribute('data-id', 'chip-' + (fileChipIdCounter++));
    const icon = document.createElement('span'); icon.className = 'chip-icon'; icon.textContent = isFolder ? '\uD83D\uDCC1' : '\uD83D\uDCC4';
    const ns = document.createElement('span'); ns.className = 'chip-name'; ns.textContent = name; ns.title = path;
    const del = document.createElement('span'); del.className = 'chip-delete'; del.textContent = '\u00D7';
    del.onclick = (e) => { e.stopPropagation(); chip.remove(); };
    chip.appendChild(icon); chip.appendChild(ns); chip.appendChild(del);
    range.deleteContents(); range.insertNode(chip);
    const sp = document.createTextNode(' '); range.setStartAfter(chip); range.insertNode(sp);
    range.setStartAfter(sp); range.collapse(true);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    inputText.focus();
  }

  // == Image ==
  function addImage(file) {
    if (_images.filter(i => i !== null).length >= MAX_IMAGE_COUNT) { alert('图片数量超过限制（最多 ' + MAX_IMAGE_COUNT + ' 张）'); return; }
    if (file.size > MAX_IMAGE_SIZE) { alert('图片大小超过限制（单张最大 5MB）'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const url = ev.target.result, idx = _images.length; _images.push(url);
      const w = document.createElement('div'); w.className = 'img-wrapper';
      const img = document.createElement('img'); img.src = url; img.onclick = () => showModal(url);
      const d = document.createElement('button'); d.className = 'img-delete'; d.textContent = '\u00D7';
      d.onclick = (e) => { e.stopPropagation(); _images[idx] = null; w.remove(); };
      w.appendChild(img); w.appendChild(d); imagePreview.appendChild(w);
    };
    reader.readAsDataURL(file);
  }

  // == Message Handler ==
  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg.type === 'showPrompt') {
      createConversation(msg.requestId || Date.now().toString(), msg.prompt);
    } else if (msg.type === 'setPort') {
      currentPort = msg.port;
      $('portInfo').textContent = '\u7AEF\u53E3: ' + msg.port;
      connectionStatus.classList.remove('disconnected');
      connectionStatus.title = '\u670D\u52A1\u8FD0\u884C\u4E2D';
    } else if (msg.type === 'setTimeoutMinutes') {
      if (typeof msg.timeoutMinutes === 'number' && msg.timeoutMinutes >= 0) {
        timeoutMinutes = msg.timeoutMinutes;
        timeoutInput.value = msg.timeoutMinutes;
        updateCountdownForNewTimeout();
      }
    } else if (msg.type === 'setWorkspaceRoot') {
      if (msg.workspaceRoot) { workspaceRoot = msg.workspaceRoot; }
    }
  });

  vscode.postMessage({ type: 'ready' });
})();

