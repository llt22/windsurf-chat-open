import * as vscode from 'vscode';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { ChatPanelProvider } from './chatPanel';

let httpServer: http.Server | null = null;
let httpServerPort = 0;
let pendingCallback: ((response: any) => void) | null = null;
let panelProvider: ChatPanelProvider | null = null;

export function activate(context: vscode.ExtensionContext) {
  console.log('[WindsurfChatOpen] 插件激活中...');

  panelProvider = new ChatPanelProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('windsurfChatOpen.panel', panelProvider, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  panelProvider.onUserResponse((response) => {
    if (pendingCallback) {
      pendingCallback(response);
      pendingCallback = null;
    }
  });

  startHttpServer(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('windsurfChatOpen.focus', () => {
      vscode.commands.executeCommand('windsurfChatOpen.panel.focus');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('windsurfChatOpen.setup', () => {
      setupWorkspace(context);
    })
  );

  if (vscode.workspace.workspaceFolders?.length) {
    setupWorkspace(context);
  }

  console.log('[WindsurfChatOpen] 插件激活完成');
}

function startHttpServer(context: vscode.ExtensionContext) {
  httpServer = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/request') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          handleRequest(data, res);
        } catch (e) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
    } else if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200);
      res.end('OK');
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  httpServer.listen(0, '127.0.0.1', () => {
    const addr = httpServer!.address() as { port: number };
    httpServerPort = addr.port;
    console.log(`[WindsurfChatOpen] HTTP 服务器启动在端口 ${httpServerPort}`);
    updatePortFile();
  });

  context.subscriptions.push({
    dispose: () => {
      if (httpServer) {
        httpServer.close();
        httpServer = null;
      }
    }
  });
}

function handleRequest(data: { prompt: string; requestId: string }, res: http.ServerResponse) {
  if (panelProvider) {
    panelProvider.showPrompt(data.prompt);
  }

  pendingCallback = (response) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  };

  setTimeout(() => {
    if (pendingCallback) {
      pendingCallback({ action: 'continue', text: '', images: [] });
      pendingCallback = null;
    }
  }, 30 * 60 * 1000);
}

function updatePortFile() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return;

  for (const folder of folders) {
    const portFile = path.join(folder.uri.fsPath, '.windsurf_chat_port');
    try {
      fs.writeFileSync(portFile, String(httpServerPort));
    } catch (e) {
      console.error(`[WindsurfChatOpen] 无法写入端口文件: ${e}`);
    }
  }
}

function setupWorkspace(context: vscode.ExtensionContext) {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    vscode.window.showWarningMessage('请先打开一个工作区');
    return;
  }

  for (const folder of folders) {
    const workspacePath = folder.uri.fsPath;
    const windsurfchatDir = path.join(workspacePath, 'windsurfchat');

    if (!fs.existsSync(windsurfchatDir)) {
      fs.mkdirSync(windsurfchatDir, { recursive: true });
    }

    const scriptSrc = path.join(context.extensionPath, 'lib', 'windsurf_chat.js');
    const scriptDest = path.join(windsurfchatDir, 'windsurf_chat.js');
    if (fs.existsSync(scriptSrc)) {
      fs.copyFileSync(scriptSrc, scriptDest);
    }

    const rulesSrc = path.join(context.extensionPath, 'rules', 'windsurfrules.txt');
    const rulesDest = path.join(workspacePath, '.windsurfrules');
    if (fs.existsSync(rulesSrc) && !fs.existsSync(rulesDest)) {
      fs.copyFileSync(rulesSrc, rulesDest);
    }

    const portFile = path.join(workspacePath, '.windsurf_chat_port');
    fs.writeFileSync(portFile, String(httpServerPort));

    // 自动添加到 .gitignore
    updateGitignore(workspacePath);
  }

  vscode.window.showInformationMessage('WindsurfChatOpen 工作区初始化完成');
}

function updateGitignore(workspacePath: string) {
  // 检查是否是 git 仓库
  const gitDir = path.join(workspacePath, '.git');
  if (!fs.existsSync(gitDir)) {
    console.log('[WindsurfChatOpen] 非 git 仓库，跳过 .gitignore 更新');
    return;
  }

  const gitignorePath = path.join(workspacePath, '.gitignore');
  const entriesToAdd = [
    'windsurfchat/',
    '.windsurf_chat_port',
  ];

  try {
    let content = '';
    let fileExists = false;
    if (fs.existsSync(gitignorePath)) {
      content = fs.readFileSync(gitignorePath, 'utf-8');
      fileExists = true;
    }

    const lines = content.split('\n').map(l => l.trim());
    const newEntries: string[] = [];

    for (const entry of entriesToAdd) {
      if (!lines.includes(entry)) {
        newEntries.push(entry);
      }
    }

    if (newEntries.length > 0) {
      if (fileExists) {
        // 追加到现有文件
        const separator = content.endsWith('\n') || content === '' ? '' : '\n';
        const header = content.includes('# WindsurfChatOpen') ? '' : '\n# WindsurfChatOpen\n';
        fs.appendFileSync(gitignorePath, `${separator}${header}${newEntries.join('\n')}\n`);
      } else {
        // 创建新文件
        fs.writeFileSync(gitignorePath, `# WindsurfChatOpen\n${newEntries.join('\n')}\n`);
      }
      console.log(`[WindsurfChatOpen] 已添加到 .gitignore: ${newEntries.join(', ')}`);
    }
  } catch (e) {
    console.error(`[WindsurfChatOpen] 更新 .gitignore 失败: ${e}`);
  }
}

export function deactivate() {
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
  console.log('[WindsurfChatOpen] 插件已停用');
}
