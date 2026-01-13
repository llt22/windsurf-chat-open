import * as vscode from 'vscode';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ChatPanelProvider } from './chatPanel';

const GLOBAL_DIR_NAME = '.windsurf-chat-open';
const DEFAULT_PORT = 34500;
const MAX_PORT_RETRIES = 10;

let httpServer: http.Server | null = null;
let httpServerPort = 0;
let pendingCallback: ((response: any) => void) | null = null;
let panelProvider: ChatPanelProvider | null = null;

function getGlobalDir(): string {
  return path.join(os.homedir(), GLOBAL_DIR_NAME);
}

export function activate(context: vscode.ExtensionContext) {
  console.log('[WindsurfChatOpen] 插件激活中...');

  // 清理超过 24 小时的旧临时文件
  cleanOldTempFiles();

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

  // 固定端口 + 自动重试
  tryListenPort(DEFAULT_PORT, 0, context);
}

function tryListenPort(port: number, retryCount: number, context: vscode.ExtensionContext) {
  httpServer!.once('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE' && retryCount < MAX_PORT_RETRIES) {
      console.log(`[WindsurfChatOpen] 端口 ${port} 被占用，尝试 ${port + 1}`);
      tryListenPort(port + 1, retryCount + 1, context);
    } else {
      console.error(`[WindsurfChatOpen] 无法启动 HTTP 服务器: ${err.message}`);
    }
  });

  httpServer!.listen(port, '127.0.0.1', () => {
    httpServerPort = port;
    console.log(`[WindsurfChatOpen] HTTP 服务器启动在端口 ${httpServerPort}`);
    setupGlobalFiles(context);
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

function setupGlobalFiles(context: vscode.ExtensionContext) {
  const globalDir = getGlobalDir();

  // 创建全局目录
  if (!fs.existsSync(globalDir)) {
    fs.mkdirSync(globalDir, { recursive: true });
  }

  // 复制脚本到全局目录
  const scriptSrc = path.join(context.extensionPath, 'lib', 'windsurf_chat.js');
  const scriptDest = path.join(globalDir, 'windsurf_chat.js');
  if (fs.existsSync(scriptSrc)) {
    fs.copyFileSync(scriptSrc, scriptDest);
  }

  // 写入端口文件到全局目录
  const portFile = path.join(globalDir, 'port');
  fs.writeFileSync(portFile, String(httpServerPort));

  console.log(`[WindsurfChatOpen] 全局文件已设置: ${globalDir}`);
}

function setupWorkspace(context: vscode.ExtensionContext) {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    vscode.window.showWarningMessage('请先打开一个工作区');
    return;
  }

  const globalDir = getGlobalDir();
  const scriptPath = path.join(globalDir, 'windsurf_chat.js');

  for (const folder of folders) {
    const workspacePath = folder.uri.fsPath;

    // 生成 .windsurfrules（使用全局脚本路径）
    const rulesDest = path.join(workspacePath, '.windsurfrules');
    if (!fs.existsSync(rulesDest)) {
      const rulesContent = generateRulesContent(scriptPath);
      fs.writeFileSync(rulesDest, rulesContent);
    }

    // 自动添加到 .gitignore（只需忽略 .windsurfrules 如果用户不想提交）
    // 但通常 .windsurfrules 应该提交，所以不添加到 gitignore
  }

  vscode.window.showInformationMessage('WindsurfChatOpen 工作区初始化完成');
}

function generateRulesContent(scriptPath: string): string {
  // 转换路径分隔符为正斜杠（跨平台兼容）
  const normalizedPath = scriptPath.replace(/\\/g, '/');
  
  return `<!-- WINDSURF_CHAT_OPEN_V1 -->

=======================================================================
CRITICAL SYSTEM RULE - READ THIS FIRST
=======================================================================

YOU MUST CALL windsurf_chat SCRIPT BEFORE ENDING EVERY RESPONSE.
This is NOT optional. This is a MANDATORY system requirement.

=======================================================================

## SCRIPT COMMAND (MUST USE)

\`\`\`bash
node "${normalizedPath}" "Task completion reason"
\`\`\`

**Important Notes:**
- Cwd parameter: Current workspace path
- Blocking: true
- SafeToAutoRun: true

**Script Return Value Handling:**
- \`User chose to continue\` → Continue execution
- \`User chose to end\` → End conversation immediately
- \`User instruction: xxx\` → Execute immediately
- \`User instruction: [Content too long, saved to file]\` → Use read_file to read
- \`User provided N images\` → Use read_file to read image files

## MANDATORY RULES

1. **Complete Output** - Do NOT use ellipsis
2. **Continuous Execution** - Complete tasks in one go
3. **End Confirmation** - Call script before ending
4. **Use Chinese** - 所有回复使用中文

## EXECUTION FLOW

1. Complete task
2. Call script with Blocking: true
3. Process script output
4. If user instruction, execute immediately

=======================================================================
ttrigger: always_on
alwaysApply: true
`;
}


function cleanOldTempFiles() {
  const tempDir = os.tmpdir();
  const maxAge = 24 * 60 * 60 * 1000; // 24 小时
  const now = Date.now();
  const prefixes = ['wsc_img_', 'windsurf_chat_open_'];

  try {
    const files = fs.readdirSync(tempDir);
    let cleaned = 0;

    for (const file of files) {
      if (!prefixes.some(p => file.startsWith(p))) continue;

      const filePath = path.join(tempDir, file);
      try {
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > maxAge) {
          fs.unlinkSync(filePath);
          cleaned++;
        }
      } catch {
        // 忽略单个文件错误
      }
    }

    if (cleaned > 0) {
      console.log(`[WindsurfChatOpen] 已清理 ${cleaned} 个旧临时文件`);
    }
  } catch (e) {
    console.error(`[WindsurfChatOpen] 清理临时文件失败: ${e}`);
  }
}

export function deactivate() {
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
  console.log('[WindsurfChatOpen] 插件已停用');
}
