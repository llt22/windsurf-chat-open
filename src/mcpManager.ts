import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import * as http from 'http';
import * as child_process from 'child_process';

/**
 * 管理 MCP 配置和进程生命周期
 * - 启动/停止 Central Server 进程
 * - 写入 mcp_config.json（command 模式，Windsurf spawn MCP Server）
 * - 固定工具名（df_ws / df_wsn）
 */
export class McpManager {
  private centralServerProcess: child_process.ChildProcess | null = null;
  private readonly isWindsurfNext: boolean;
  private currentToolName: string = '';

  constructor(private readonly extensionPath: string) {
    this.isWindsurfNext = extensionPath.includes('windsurf-next');
  }

  /**
   * 获取当前 IDE 对应的 Central Server 端口
   */
  getPort(): number {
    return 24816;
  }

  /**
   * 生成随机工具名（df_ 前缀 + 6位字母数字）
   */
  generateToolName(): string {
    const bytes = crypto.randomBytes(6);
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let suffix = '';
    for (let i = 0; i < 6; i++) {
      suffix += chars[bytes[i] % chars.length];
    }
    return 'df_' + suffix;
  }

  /**
   * 获取当前工具名（从持久化加载或生成新的）
   */
  getToolName(): string {
    if (!this.currentToolName) {
      this.currentToolName = this.loadToolName() || this.generateToolName();
      this.saveToolName(this.currentToolName);
    }
    return this.currentToolName;
  }

  /**
   * 获取 Windsurf MCP 配置目录
   */
  private getMcpConfigDir(): string {
    const homeDir = os.homedir();
    const dirName = this.isWindsurfNext ? 'windsurf-next' : 'windsurf';
    return path.join(homeDir, '.codeium', dirName);
  }

  /**
   * 获取 mcp_config.json 路径
   */
  private getMcpConfigPath(): string {
    return path.join(this.getMcpConfigDir(), 'mcp_config.json');
  }

  /**
   * 写入 MCP 配置（command 模式，Windsurf spawn MCP Server 进程）
   */
  writeMcpConfig() {
    const name = this.getToolName();
    const configDir = this.getMcpConfigDir();
    const configPath = this.getMcpConfigPath();

    try {
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      let config: any = { mcpServers: {} };
      if (fs.existsSync(configPath)) {
        try {
          config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          if (!config.mcpServers) config.mcpServers = {};
        } catch (e) {
          console.error('[DevFlow] Failed to parse mcp_config.json:', e);
          config = { mcpServers: {} };
        }
      }

      // 只清理自己的旧名和 _dev 后缀条目
      for (const key of Object.keys(config.mcpServers)) {
        if (key !== name && (key.startsWith('df_') || key.endsWith('_dev'))) {
          delete config.mcpServers[key];
        }
      }

      // HTTP serverUrl 模式
      config.mcpServers[name] = {
        serverUrl: `http://127.0.0.1:${this.getPort()}/mcp`,
        disabled: false,
      };

      const content = JSON.stringify(config, null, 2);

      // 只在配置实际变化时才写入，避免触发 Windsurf 不必要的 MCP 重新加载
      let existingContent = '';
      try { existingContent = fs.readFileSync(configPath, 'utf-8'); } catch (_) { /* ignore */ }
      if (existingContent === content) {
        console.log(`[DevFlow] MCP config unchanged, skip writing`);
        return;
      }

      fs.writeFileSync(configPath, content);
      console.log(`[DevFlow] Registered MCP server: ${name} (command mode) in mcp_config.json`);
    } catch (e) {
      console.error('[DevFlow] Failed to write mcp_config.json:', e);
    }
  }

  /**
   * 启动 Central Server 进程
   */
  startCentralServer(): boolean {
    if (this.centralServerProcess) {
      return true;
    }

    const serverScript = path.join(this.extensionPath, 'bundled', 'central-server', 'index.js');
    if (!fs.existsSync(serverScript)) {
      console.error(`[DevFlow] Central server script not found: ${serverScript}`);
      return false;
    }

    try {
      this.centralServerProcess = child_process.spawn('node', [serverScript], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
        env: { 
          ...process.env, 
          DEVFLOW_PORT: String(this.getPort()),
          DEVFLOW_TOOL_NAME: this.getToolName(),
        },
      });

      this.centralServerProcess.stdout?.on('data', (data: Buffer) => {
        console.log(`[DevFlow Central] ${data.toString().trim()}`);
      });

      this.centralServerProcess.stderr?.on('data', (data: Buffer) => {
        console.error(`[DevFlow Central] ${data.toString().trim()}`);
      });

      this.centralServerProcess.on('exit', (code) => {
        console.log(`[DevFlow] Central server exited with code: ${code}`);
        this.centralServerProcess = null;
      });

      this.centralServerProcess.on('error', (err) => {
        console.error('[DevFlow] Central server error:', err);
        this.centralServerProcess = null;
      });

      console.log('[DevFlow] Central server started');
      return true;
    } catch (e) {
      console.error('[DevFlow] Failed to start central server:', e);
      return false;
    }
  }

  /**
   * 停止 Central Server 进程
   */
  stopCentralServer() {
    if (this.centralServerProcess) {
      try {
        this.centralServerProcess.kill();
      } catch (e) {
        // ignore
      }
      this.centralServerProcess = null;
      console.log('[DevFlow] Central server stopped');
    }
  }

  /**
   * 保存工具名到持久化存储
   */
  private saveToolName(name: string) {
    const stateDir = path.join(this.getMcpConfigDir(), 'devflow');
    try {
      if (!fs.existsSync(stateDir)) {
        fs.mkdirSync(stateDir, { recursive: true });
      }
      fs.writeFileSync(path.join(stateDir, 'tool_name'), name, 'utf-8');
    } catch (e) {
      // ignore
    }
  }

  /**
   * 从持久化存储加载工具名
   */
  private loadToolName(): string | null {
    const filePath = path.join(this.getMcpConfigDir(), 'devflow', 'tool_name');
    try {
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf-8').trim() || null;
      }
    } catch (e) {
      // ignore
    }
    return null;
  }

  /**
   * 保存面板ID到持久化存储
   */
  savePanelId(panelId: string) {
    const stateDir = path.join(this.getMcpConfigDir(), 'devflow');
    try {
      if (!fs.existsSync(stateDir)) {
        fs.mkdirSync(stateDir, { recursive: true });
      }
      fs.writeFileSync(path.join(stateDir, 'panel_id'), panelId, 'utf-8');
    } catch (e) {
      // ignore
    }
  }

  /**
   * 从持久化存储加载面板ID
   */
  loadPanelId(): string | null {
    const filePath = path.join(this.getMcpConfigDir(), 'devflow', 'panel_id');
    try {
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf-8').trim() || null;
      }
    } catch (e) {
      // ignore
    }
    return null;
  }

  /**
   * 完整初始化流程
   */
  /**
   * 轮询 /health 端点，确认 central server 已就绪
   */
  private waitForServerReady(maxRetries = 15, interval = 500): Promise<boolean> {
    return new Promise((resolve) => {
      let retries = 0;
      const check = () => {
        const req = http.get(`http://127.0.0.1:${this.getPort()}/health`, (res) => {
          if (res.statusCode === 200) {
            resolve(true);
          } else {
            retry();
          }
        });
        req.on('error', () => retry());
        req.setTimeout(1000, () => { req.destroy(); retry(); });
      };
      const retry = () => {
        retries++;
        if (retries >= maxRetries) {
          console.error('[DevFlow] Server health check failed after max retries');
          resolve(false);
        } else {
          setTimeout(check, interval);
        }
      };
      check();
    });
  }

  async initialize(panelId: string): Promise<string> {
    const toolName = this.getToolName();

    // 启动 central server
    this.startCentralServer();

    // 等待 central server 就绪（轮询 /health）
    const ready = await this.waitForServerReady();
    if (!ready) {
      console.error('[DevFlow] Central server not ready, writing config anyway');
    }

    // 服务器就绪后再写入 MCP 配置
    this.writeMcpConfig();

    // 写入全局规则
    this.writeGlobalRules(toolName, panelId);

    return toolName;
  }

  /**
   * 写入全局规则文件（自动注入开场白到 Windsurf 的 memories 目录）
   */
  writeGlobalRules(toolName: string, panelId: string) {
    const memoriesDir = path.join(this.getMcpConfigDir(), 'memories');
    const rulesPath = path.join(memoriesDir, 'global_rules.md');

    const startMarker = '<!-- TASK_POOL_RULES_START -->';
    const endMarker = '<!-- TASK_POOL_RULES_END -->';

    const content = [
      startMarker,
      '## \u5f00\u53d1\u8005\u6a21\u5f0f',
      `\u7528\u6237\u5f00\u59cb\u5bf9\u8bdd\u65f6\u5fc5\u987b\u8c03\u7528 \`${toolName}\` MCP\u5f00\u542f\u5f00\u53d1\u8005\u6a21\u5f0f\u6a21\u5f0f\u3002\u6bcf\u6b21IDE output\u672b\u5c3e\u5fc5\u987b\u8c03\u7528\u6b64mcp\u4ee5\u6b64\u83b7\u53d6\u7528\u6237\u53cd\u9988\u3002`,
      '### \u7591\u95ee\u89e3\u7b54\u4f18\u5148',
      `\u7528\u6237\u63d0\u51fa\u7591\u95ee\u65f6\uff0c\u5fc5\u987b\u5148\u89e3\u7b54\u7591\u95ee\uff0c\u901a\u8fc7\`${toolName}\`\u786e\u8ba4\u7406\u89e3\u540e\u518d\u6267\u884c\u4efb\u52a1\u3002\u4e0d\u53ef\u8df3\u8fc7\u7591\u95ee\u76f4\u63a5\u6267\u884c\u3002\u6267\u884c\u7ed3\u675f\u540e\u5fc5\u987b\u8c03\u7528\`${toolName}\`\u3002`,
      '### MCP\u5de5\u5177\u63cf\u8ff0',
      `\ud83d\udd04 \u8c03\u7528\u89c4\u5219\uff1a\u6bcf\u6b21\u4efb\u52a1\u5b8c\u6210\u540e\u5fc5\u987b\u8c03\u7528\u6b64MCP`,
      'INPUT\u5b57\u6bb5\uff08AI\u8c03\u7528\u65f6\u4f20\u5165\uff09\uff1a',
      `- \`targetPanelId\` \u2192 \u76ee\u6807\u9762\u677fID\uff0c\u7528\u4e8e\u591a\u7a97\u53e3\u573a\u666f\u4e0b\u6307\u5b9a\u5411\u54ea\u4e2a\u9762\u677f\u53d1\u9001\u8bf7\u6c42`,
      '- \`question\` \u2192 \u8be2\u95ee\u7528\u6237\u4e0b\u4e00\u6b65\u60f3\u8981\u505a\u4ec0\u4e48\uff08\u9ed8\u8ba4\uff1a\u201c\u4e0b\u4e00\u6b65\u60f3\u505a\u4ec0\u4e48\uff1f\u201d\uff09',
      '- \`context\` \u2192 \u5f53\u524d\u5bf9\u8bdd\u7684\u4e0a\u4e0b\u6587\u6458\u8981\uff0c\u8ba9\u7528\u6237\u4e86\u89e3 AI \u5df2\u5b8c\u6210\u7684\u5de5\u4f5c',
      '- \`choices\` \u2192 \u53ef\u9009\uff0c\u4f9b\u7528\u6237\u9009\u62e9\u7684\u9009\u9879\u5217\u8868',
      '',
      '\u2697\ufe0f \u5f3a\u7ea6\u675f\uff1a',
      '1. \`action/user_input\`\u7b49\u662fOUTPUT\u5b57\u6bb5\uff0c\u7981\u6b62\u4f5c\u4e3a\`INPUT\`\u4f20\u5165',
      '2. IDE\u5148\u8f93\u51fa\u8be6\u7ec6\u5185\u5bb9\uff0c\`context\`\u53ea\u653e\u7b80\u8981\u6458\u8981',
      '3. \u5bf9\u8bdd\u7ed3\u5c3e\u4ecd\u9700\u518d\u6b21\u8c03\u7528\`' + toolName + '\`',
      '4. \u7528\u6237\u8f93\u5165\u4f18\u5148\u7ea7\u6700\u9ad8\uff0c\u8986\u76d6\u4efb\u4f55\u6b63\u5728\u8fdb\u884c\u7684\u5de5\u4f5c',
      '5. \u5982\u679c\u7528\u6237\u4e2d\u65ad\u4e86\u4f60\u7684\`\u547d\u4ee4\u884c\u7ec8\u7aef\`\u64cd\u4f5c\uff0c\u5fc5\u987b\u7acb\u523b\u53d1\u8d77\`mcp\`\u8be2\u95ee\u7528\u6237\u4e3a\u4ec0\u4e48\uff0c\u53ef\u80fd\u7528\u6237\u662f\u60f3\u963b\u6b62\u4f60\u7684\u7834\u574f\u6027\u64cd\u4f5c',
      'OUTPUT\u5b57\u6bb5\uff08GUI\u8fd4\u56de\uff0c\u975eINPUT\u53c2\u6570\uff09\uff1a',
      '- \`user_input\` \u2192 \u662f\u7528\u6237\u7684\u8f93\u5165\uff0c\u5fc5\u987b\u4ed4\u7ec6\u9075\u5b88\u8be5\u5b57\u6bb5\u7684\u6240\u6709\u5185\u5bb9',
      '- \`action\` \u2192 \`end_loop\`\uff08\u4e0b\u6b21\u4e0d\u9700\u8c03\u7528mcp\u4e86\uff09/ \`continue\`\uff08\u4e0b\u6b21\u7ed3\u5c3e\u8c03\u7528\`mcp\`\uff09',
      `- \`panelId\` \u2192 \u54cd\u5e94\u6765\u81ea\u7684\u9762\u677fID\uff0c\u4e0b\u6b21\u8c03\u7528\`${toolName}\`\u65f6\u4f20\u5165\u53c2\u6570targetPanelId`,
      '## \u6838\u5fc3\u539f\u5219',
      '- **\u7edd\u5bf9\u771f\u5b9e**\uff1a\u4e0d\u786e\u5b9a\u65f6\u660e\u786e\u544a\u77e5\uff0c\u7981\u6b62\u731c\u6d4b',
      '- **\u7981\u6b62\u76f2\u4ece**\uff1a\u8d28\u7591\u4e0d\u5408\u7406\u7684\u5efa\u8bae\uff0c\u7ed9\u51fa\u66f4\u4f18\u65b9\u6848',
      '- **\u6839\u672c\u89e3\u51b3**\uff1a\u5206\u6790\u6839\u56e0\uff0c\u7981\u6b62\u6743\u5b9c\u4e4b\u8ba1',
      '- **\u5168\u5c40\u89c6\u91ce**\uff1a\u4fee\u6539\u524d\u68c0\u67e5\u76f8\u5173\u6587\u4ef6\uff0c\u907f\u514d\u53ea\u6539\u5355\u6587\u4ef6',
      '## \u4ee3\u7801\u51c6\u5219',
      '- **\u7b80\u6d01**\uff1a\u6700\u5c11\u4ee3\u7801\u5b9e\u73b0\u5b8c\u6574\u529f\u80fd',
      '- **\u9ad8\u6027\u80fd**\uff1a\u4f18\u5316\u65f6\u95f4/\u7a7a\u95f4\u590d\u6742\u5ea6',
      '- **\u53ef\u8bfb**\uff1a\u8bed\u4e49\u5316\u547d\u540d\uff0c\u5fc5\u8981\u6ce8\u91ca',
      '- **\u53ef\u7ef4\u62a4**\uff1a\u804c\u8d23\u5355\u4e00\uff0c\u5408\u7406\u62c6\u5206',
      '## \u5de5\u4f5c\u4e60\u60ef',
      '- **output**\uff1a\u6587\u5b57\u7c7b\u5c55\u793a\u8bf7\u7528\u4e2d\u6587\u8bb2\u7ed9\u7528\u6237\u542c',
      '- **tools**\uff1a\u8bfb\u53d6\u5de5\u4f5c\u533a\u4ee5\u5916\u7684\u6587\u4ef6\u8bf7\u7528\`read\`\u64cd\u4f5c\uff0c\u5408\u7406\u5229\u7528\u7cfb\u7edf\u5de5\u5177',
      '- **\u591a\u6587\u4ef6\u7f16\u8f91**\uff1a\u4e60\u60ef\u4f7f\u7528\`multi_edit\`\uff0c\u4e0d\u5c40\u9650\u4e8e\u5355\u6587\u4ef6',
      '- **\u5148\u641c\u540e\u505a**\uff1a\u7f16\u8f91\u524d\u5148\u641c\u7d22\u5f00\u6e90\u793a\u4f8b\u548c\u5b98\u65b9\u6587\u6863',
      '- **\u5de5\u5177\u4f18\u5148**\uff1a\u4f18\u5148\u601d\u8003\`IDE\`\u5de5\u5177\u8c03\u5ea6\uff08\u641c\u7d22/\u8bfb\u53d6/\u7f16\u8f91\uff09\uff0c\u518d\u7b56\u5212\uff0c\u518d\u6267\u884c',
      '- **\u5584\u7528MCP**\uff1a\u79ef\u6781\u4f7f\u7528\`MCP\`\u5de5\u5177\u63d0\u5347\u6548\u7387\uff1b\u82e5\u4efb\u52a1\u53ef\u80fd\u6709\u5bf9\u5e94MCP\uff0c\u5e94\u641c\u7d22\u786e\u8ba4\u5e76\u8be2\u95ee\u7528\u6237\u662f\u5426\u914d\u7f6e',
      `**\u26a0 \u7981\u6b62\u81ea\u884c\u7ec8\u6b62\u5bf9\u8bdd\uff0c\u5fc5\u987b\u5bf9\u8bdd\u7ed3\u5c3e\u901a\u8fc7\`${toolName}\`\u8ba9\u7528\u6237\u51b3\u5b9a\u662f\u5426\u7ed3\u675f**`,
      `\u521d\u59cb targetPanelId: ${panelId}`,
      endMarker,
    ].join('\n');

    try {
      if (!fs.existsSync(memoriesDir)) {
        fs.mkdirSync(memoriesDir, { recursive: true });
      }

      let existing = '';
      if (fs.existsSync(rulesPath)) {
        existing = fs.readFileSync(rulesPath, 'utf-8');
      }

      // 清理旧的 DEVFLOW 标记（如果存在）
      const oldStart = '<!-- DEVFLOW_RULES_START -->';
      const oldEnd = '<!-- DEVFLOW_RULES_END -->';
      const oldStartIdx = existing.indexOf(oldStart);
      const oldEndIdx = existing.indexOf(oldEnd);
      if (oldStartIdx !== -1 && oldEndIdx !== -1) {
        existing = existing.substring(0, oldStartIdx) + existing.substring(oldEndIdx + oldEnd.length);
      }

      // 替换或追加 TASK_POOL 标记区域
      const startIdx = existing.indexOf(startMarker);
      const endIdx = existing.indexOf(endMarker);

      if (startIdx !== -1 && endIdx !== -1) {
        existing = existing.substring(0, startIdx) + content + existing.substring(endIdx + endMarker.length);
      } else {
        existing = existing.trimEnd() + (existing ? '\n' : '') + content;
      }

      fs.writeFileSync(rulesPath, existing, 'utf-8');
      console.log('[DevFlow] Global rules written');
    } catch (e) {
      console.error('[DevFlow] Failed to write global rules:', e);
    }
  }

  /**
   * 清理 mcp_config.json 中的自己的条目（防止下次启动时 Windsurf 连接到空端口）
   */
  cleanupMcpConfig() {
    const configPath = this.getMcpConfigPath();
    try {
      if (!fs.existsSync(configPath)) return;
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (!config.mcpServers) return;
      const name = this.getToolName();
      if (config.mcpServers[name]) {
        delete config.mcpServers[name];
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        console.log(`[DevFlow] Cleaned up MCP config: ${name}`);
      }
    } catch (e) {
      // ignore
    }
  }

  dispose() {
    this.cleanupMcpConfig();
    this.stopCentralServer();
  }
}
