// @ts-nocheck
(function () {
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const imageModal = $('imageModal');
  const modalImage = $('modalImage');
  const timeoutInput = $('timeoutInput');
  const connectionStatus = $('connectionStatus');
  const settingsToggle = $('settingsToggle');
  const configBar = $('configBar');
  const convList = $('convList');
  const emptyState = $('emptyState');

  const conversations = new Map();
  let currentPort = 0;
  let workspaceRoot = '';
  const MAX_IMAGE_COUNT = 10;
  const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
  let timeoutMinutes = 240;
  let fileChipIdCounter = 0;

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

  function updateEmptyState() {
    emptyState.classList.toggle('hidden', conversations.size > 0);
  }

  function fmtCD(s) { return '\u23F1\uFE0F ' + Math.floor(s/60) + ':' + (s%60).toString().padStart(2,'0'); }

  // == Conversation Card ==
  function createConversation(rid, prompt, context) {
    const images = [];
    const card = document.createElement('div');
    card.className = 'conv-card';
    card.setAttribute('data-id', rid);

    // Header: dot + countdown + close
    const header = document.createElement('div'); header.className = 'conv-card-header';
    const hLeft = document.createElement('div'); hLeft.className = 'conv-card-header-left';
    const dot = document.createElement('span'); dot.className = 'conv-card-dot';
    const cdEl = document.createElement('span'); cdEl.className = 'conv-card-countdown';
    hLeft.appendChild(dot); hLeft.appendChild(cdEl);
    const closeBtn = document.createElement('button'); closeBtn.className = 'conv-card-close'; closeBtn.textContent = '\u00D7'; closeBtn.title = '\u7ED3\u675F\u5BF9\u8BDD';
    closeBtn.onclick = () => endConv(rid);
    header.appendChild(hLeft); header.appendChild(closeBtn);

    // Context (user question)
    let contextEl = null;
    if (context) {
      contextEl = document.createElement('div'); contextEl.className = 'conv-card-context';
      const maxLen = 200;
      contextEl.textContent = context.length > maxLen ? context.substring(0, maxLen) + '\u2026' : context;
      if (context.length > maxLen) contextEl.title = context;
    }

    // Prompt (AI summary)
    const promptEl = document.createElement('div'); promptEl.className = 'conv-card-prompt'; promptEl.textContent = prompt;

    // Input
    const inputEl = document.createElement('div'); inputEl.className = 'conv-card-input'; inputEl.contentEditable = 'true';

    // Image preview
    const imgPreview = document.createElement('div'); imgPreview.className = 'image-preview';

    // Actions
    const actions = document.createElement('div'); actions.className = 'conv-card-actions';
    const submitBtn = document.createElement('button'); submitBtn.className = 'btn-primary'; submitBtn.textContent = '\u63D0\u4EA4';
    submitBtn.onclick = () => submitConv(rid);
    const endBtn = document.createElement('button'); endBtn.className = 'btn-danger'; endBtn.textContent = '\u7ED3\u675F';
    endBtn.onclick = () => endConv(rid);
    const hint = document.createElement('span'); hint.className = 'hint'; hint.textContent = 'Ctrl+Enter \u63D0\u4EA4 | Esc \u7ED3\u675F';
    actions.appendChild(submitBtn); actions.appendChild(endBtn); actions.appendChild(hint);

    card.appendChild(header);
    if (contextEl) card.appendChild(contextEl);
    card.appendChild(promptEl); card.appendChild(inputEl); card.appendChild(imgPreview); card.appendChild(actions);

    // Keyboard
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); submitConv(rid); }
      else if (e.key === 'Escape') endConv(rid);
    });

    // Paste image
    inputEl.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items; if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) { e.preventDefault(); const f = item.getAsFile(); if (f) addImageToCard(rid, f); }
      }
    });

    // Drag
    inputEl.addEventListener('drop', (e) => { handleCardDrop(e, rid); });
    inputEl.addEventListener('dragover', (e) => { e.preventDefault(); inputEl.classList.add('drag-over'); });
    inputEl.addEventListener('dragleave', () => { inputEl.classList.remove('drag-over'); });

    // Store conv state
    const conv = {
      rid, prompt, images,
      countdownStartTime: Date.now(),
      remainingSeconds: timeoutMinutes === 0 ? -1 : timeoutMinutes * 60,
      countdownInterval: null, displayInterval: null, isCountdownRunning: false,
      dom: { card, inputEl, imgPreview, countdown: cdEl }
    };
    conversations.set(rid, conv);
    convList.prepend(card);
    updateEmptyState();
    inputEl.focus();
    startCountdown(rid);
  }

  function removeConv(rid) {
    const c = conversations.get(rid);
    if (c) {
      if (c.countdownInterval) clearInterval(c.countdownInterval);
      if (c.displayInterval) clearInterval(c.displayInterval);
      if (c.dom.card.parentNode) c.dom.card.remove();
    }
    conversations.delete(rid);
    updateEmptyState();
  }

  function endConv(rid) { vscode.postMessage({ type: 'end', requestId: rid }); removeConv(rid); }

  function submitConv(rid) {
    const c = conversations.get(rid); if (!c) return;
    const text = getCardText(c.dom.inputEl);
    const valid = c.images.filter(i => i !== null);
    if (text || valid.length > 0) vscode.postMessage({ type: 'submit', text, images: valid, requestId: rid });
    else vscode.postMessage({ type: 'continue', requestId: rid });
    removeConv(rid);
  }

  function getCardText(inputEl) {
    const cl = inputEl.cloneNode(true);
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

  // == Countdown ==
  function startCountdown(rid) {
    const c = conversations.get(rid); if (!c) return;
    if (timeoutMinutes === 0) { c.remainingSeconds = -1; c.isCountdownRunning = false; c.dom.countdown.textContent = '\u23F1\uFE0F \u4E0D\u9650\u5236'; return; }
    c.remainingSeconds = timeoutMinutes * 60; c.countdownStartTime = Date.now(); c.isCountdownRunning = true;
    c.dom.countdown.textContent = fmtCD(c.remainingSeconds);
    c.countdownInterval = setInterval(() => {
      c.remainingSeconds--;
      if (c.remainingSeconds <= 0) { clearInterval(c.countdownInterval); clearInterval(c.displayInterval); c.countdownInterval = null; c.displayInterval = null; c.isCountdownRunning = false; c.dom.countdown.textContent = ''; }
    }, 1000);
    c.displayInterval = setInterval(() => {
      if (c.remainingSeconds > 0) c.dom.countdown.textContent = fmtCD(c.remainingSeconds);
      else { c.dom.countdown.textContent = ''; clearInterval(c.displayInterval); c.displayInterval = null; }
    }, 1000);
  }

  // == Image ==
  function addImageToCard(rid, file) {
    const c = conversations.get(rid); if (!c) return;
    if (c.images.filter(i => i !== null).length >= MAX_IMAGE_COUNT) { alert('\u56FE\u7247\u6570\u91CF\u8D85\u8FC7\u9650\u5236'); return; }
    if (file.size > MAX_IMAGE_SIZE) { alert('\u56FE\u7247\u5927\u5C0F\u8D85\u8FC7\u9650\u5236\uFF085MB\uFF09'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const url = ev.target.result, idx = c.images.length; c.images.push(url);
      const w = document.createElement('div'); w.className = 'img-wrapper';
      const img = document.createElement('img'); img.src = url; img.onclick = () => showModal(url);
      const d = document.createElement('button'); d.className = 'img-delete'; d.textContent = '\u00D7';
      d.onclick = (e) => { e.stopPropagation(); c.images[idx] = null; w.remove(); };
      w.appendChild(img); w.appendChild(d); c.dom.imgPreview.appendChild(w);
    };
    reader.readAsDataURL(file);
  }

  // == Drag ==
  function handleCardDrop(e, rid) {
    e.preventDefault();
    const c = conversations.get(rid); if (!c) return;
    c.dom.inputEl.classList.remove('drag-over');
    const dx = e.clientX, dy = e.clientY, items = e.dataTransfer?.items;
    if (!items || !items.length) return;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === 'file') { const f = it.getAsFile(); if (f && f.type.startsWith('image/')) addImageToCard(rid, f); }
      if (it.kind === 'string' && it.type === 'text/uri-list') {
        it.getAsString((u) => {
          if (!u) return; let fp = u.trim();
          if (fp.startsWith('file:///')) { fp = fp.substring(8); if (!/^[a-zA-Z]:/.test(fp)) fp = '/' + fp; }
          else if (fp.startsWith('file://')) fp = fp.substring(7);
          fp = decodeURIComponent(fp);
          const pts = fp.split(/[\\/]/), nm = pts.pop() || '';
          const isDir = !nm.includes('.') || nm.startsWith('.');
          if (isDir || isTextFileByName(nm)) insertChipInCard(c.dom.inputEl, nm, fp, isDir, dx, dy);
        });
      }
    }
  }

  // == File Chip ==
  function insertChipInCard(inputEl, name, path, isFolder, x, y) {
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
    inputEl.focus();
  }

  // == Settings ==
  settingsToggle.addEventListener('click', () => { settingsToggle.classList.toggle('expanded'); configBar.classList.toggle('show'); });
  document.querySelectorAll('.timeout-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => { timeoutInput.value = parseInt(btn.getAttribute('data-minutes')); });
  });
  $('confirmConfigBtn').addEventListener('click', () => {
    const v = parseInt(timeoutInput.value);
    if (!isNaN(v) && v >= 0) {
      timeoutMinutes = v;
      vscode.postMessage({ type: 'setTimeout', timeoutMinutes: v });
      updateAllCountdowns();
      settingsToggle.classList.remove('expanded');
      configBar.classList.remove('show');
    }
  });

  // == Modal ==
  $('modalClose').onclick = () => { imageModal.classList.remove('show'); };
  imageModal.onclick = (e) => { if (e.target === imageModal) imageModal.classList.remove('show'); };
  function showModal(src) { modalImage.src = src; imageModal.classList.add('show'); }

  function updateAllCountdowns() {
    for (const [, c] of conversations.entries()) {
      if (!c.isCountdownRunning) continue;
      const nr = timeoutMinutes * 60 - Math.floor((Date.now() - c.countdownStartTime) / 1000);
      if (nr <= 0) {
        c.remainingSeconds = 0;
        if (c.countdownInterval) clearInterval(c.countdownInterval);
        if (c.displayInterval) clearInterval(c.displayInterval);
        c.countdownInterval = null; c.displayInterval = null; c.isCountdownRunning = false;
        if (c.dom) c.dom.countdown.textContent = '';
      } else {
        c.remainingSeconds = nr;
        if (c.dom) c.dom.countdown.textContent = fmtCD(nr);
      }
    }
  }

  // == Message Handler ==
  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg.type === 'showPrompt') {
      createConversation(msg.requestId || Date.now().toString(), msg.prompt, msg.context);
    } else if (msg.type === 'setPort') {
      currentPort = msg.port;
      $('portInfo').textContent = '\u7AEF\u53E3: ' + msg.port;
      connectionStatus.classList.remove('disconnected');
      connectionStatus.title = '\u670D\u52A1\u8FD0\u884C\u4E2D';
    } else if (msg.type === 'setTimeoutMinutes') {
      if (typeof msg.timeoutMinutes === 'number' && msg.timeoutMinutes >= 0) {
        timeoutMinutes = msg.timeoutMinutes;
        timeoutInput.value = msg.timeoutMinutes;
        updateAllCountdowns();
      }
    } else if (msg.type === 'setWorkspaceRoot') {
      if (msg.workspaceRoot) { workspaceRoot = msg.workspaceRoot; }
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
