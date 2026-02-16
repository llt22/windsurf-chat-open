// @ts-nocheck
(function () {
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const imageModal = $('imageModal');
  const modalImage = $('modalImage');
  const connectionStatus = $('connectionStatus');
  const convList = $('convList');
  const emptyState = $('emptyState');

  const conversations = new Map();
  let currentPanelId = '';
  let currentToolName = '';
  let workspaceRoot = '';
  const MAX_IMAGE_COUNT = 10;
  const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
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

  // == Conversation Card ==
  function createConversation(rid, prompt, context, reply) {
    const images = [];
    const card = document.createElement('div');
    card.className = 'conv-card';
    card.setAttribute('data-id', rid);

    // Header: dot
    const header = document.createElement('div'); header.className = 'conv-card-header';
    const hLeft = document.createElement('div'); hLeft.className = 'conv-card-header-left';
    const dot = document.createElement('span'); dot.className = 'conv-card-dot';
    hLeft.appendChild(dot);
    header.appendChild(hLeft);

    // Context (user question)
    let contextEl = null;
    if (context) {
      contextEl = document.createElement('div'); contextEl.className = 'conv-card-msg conv-card-context';
      const maxLen = 200;
      contextEl.textContent = context.length > maxLen ? context.substring(0, maxLen) + '\u2026' : context;
      if (context.length > maxLen) contextEl.title = context;
    }

    // Prompt (AI summary)
    const promptEl = document.createElement('div'); promptEl.className = 'conv-card-msg conv-card-prompt'; promptEl.textContent = prompt;

    // Reply (AI response content)
    let replyEl = null;
    if (reply) {
      replyEl = document.createElement('div'); replyEl.className = 'conv-card-msg conv-card-reply';
      const maxLen = 500;
      replyEl.textContent = reply.length > maxLen ? reply.substring(0, maxLen) + '\u2026' : reply;
      if (reply.length > maxLen) replyEl.title = reply;
    }

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
    if (replyEl) card.appendChild(replyEl);
    card.appendChild(promptEl);
    card.appendChild(inputEl); card.appendChild(imgPreview); card.appendChild(actions);

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
      rid, images,
      dom: { card, inputEl, imgPreview }
    };
    conversations.set(rid, conv);
    convList.prepend(card);
    updateEmptyState();
    inputEl.focus();
  }

  function removeConv(rid) {
    const c = conversations.get(rid);
    if (c) {
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

  // == Modal ==
  $('modalClose').onclick = () => { imageModal.classList.remove('show'); };
  imageModal.onclick = (e) => { if (e.target === imageModal) imageModal.classList.remove('show'); };
  function showModal(src) { modalImage.src = src; imageModal.classList.add('show'); }

  // == Message Handler ==
  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg.type === 'showPrompt') {
      createConversation(msg.requestId || Date.now().toString(), msg.prompt, msg.context, msg.reply);
    } else if (msg.type === 'setPanelId') {
      currentPanelId = msg.panelId;
      connectionStatus.classList.remove('disconnected');
      connectionStatus.title = 'Panel: ' + msg.panelId;
    } else if (msg.type === 'setToolName') {
      currentToolName = msg.toolName;
      const toolInfo = $('toolInfo');
      const toolNameEl = $('toolName');
      if (toolInfo && toolNameEl && msg.toolName) {
        toolNameEl.textContent = 'MCP: ' + msg.toolName;
        toolInfo.style.display = 'flex';
      }
    } else if (msg.type === 'dismissPrompt') {
      if (msg.requestId) removeConv(msg.requestId);
    } else if (msg.type === 'setWorkspaceRoot') {
      if (msg.workspaceRoot) { workspaceRoot = msg.workspaceRoot; }
    }
  });

  // == Regenerate Tool Name ==
  $('regenerateBtn').addEventListener('click', () => {
    vscode.postMessage({ type: 'regenerate' });
    const btn = $('regenerateBtn');
    btn.textContent = '✅';
    setTimeout(() => { btn.textContent = '🔄'; }, 2000);
  });

  // == Copy Opener ==
  $('copyOpenerBtn').addEventListener('click', () => {
    if (!currentToolName) return;
    const opener = generateOpener(currentToolName, currentPanelId);
    navigator.clipboard.writeText(opener).then(() => {
      const btn = $('copyOpenerBtn');
      btn.textContent = '\u2705 \u5df2\u590d\u5236';
      setTimeout(() => { btn.textContent = '\uD83D\uDCCB \u590d\u5236\u5f00\u573a\u767d'; }, 2000);
    });
  });

  function generateOpener(toolName, panelId) {
    return [
      `\u6bcf\u6b21\u4efb\u52a1\u6216\u56de\u590d\u7ed3\u675f\u540e\uff0c\u5fc5\u987b\u8c03\u7528 \`${toolName}\` \u5de5\u5177\u6c47\u62a5\u7ed3\u679c\u5e76\u8be2\u95ee\u4e0b\u4e00\u6b65\u3002`,
      `\u53c2\u6570\uff1acontext(\u5df2\u5b8c\u6210\u5de5\u4f5c\u6458\u8981), question(\u8be2\u95ee\u4e0b\u4e00\u6b65), targetPanelId(\u9762\u677fID)`,
      `\u521d\u59cb targetPanelId: ${panelId}`,
      `\u8fd4\u56de\u7684 user_input \u662f\u7528\u6237\u6307\u4ee4\uff0c\u5fc5\u987b\u9075\u5b88\u3002action=continue \u65f6\u7ee7\u7eed\u8c03\u7528\uff0cend_loop \u65f6\u505c\u6b62\u3002`,
      `panelId \u5b57\u6bb5\u4e0b\u6b21\u4f20\u5165 targetPanelId\u3002\u7528\u4e2d\u6587\u56de\u590d\u3002\u7981\u6b62\u81ea\u884c\u7ec8\u6b62\u5bf9\u8bdd\u3002`
    ].join('\n');
  }

  vscode.postMessage({ type: 'ready' });
})();
