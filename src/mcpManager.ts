import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
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
    return this.isWindsurfNext ? 23986 : 23985;
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
    const mcpServerScript = path.join(this.extensionPath, 'bundled', 'mcp-server', 'index.js');

    try {
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      // 读取现有配置
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

      // 清理旧的 df_ 开头的条目
      for (const key of Object.keys(config.mcpServers)) {
        if (key.startsWith('df_')) {
          delete config.mcpServers[key];
        }
      }

      // 写入 command 模式配置（Windsurf 直接 spawn MCP Server 进程）
      config.mcpServers[name] = {
        command: 'node',
        args: [mcpServerScript],
        disabled: false,
        env: {
          DEVFLOW_TOOL_NAME: name,
          DEVFLOW_PORT: String(this.getPort()),
        },
      };

      const content = JSON.stringify(config, null, 2);
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
  async initialize(panelId: string): Promise<string> {
    const toolName = this.getToolName();

    // 启动 central server
    this.startCentralServer();

    // 等待 central server 启动
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 写入 MCP 配置（command 模式）
    this.writeMcpConfig();

    // 写入全局规则（自动注入开场白）
    this.writeGlobalRules(toolName, panelId);

    return toolName;
  }

  /**
   * 写入全局规则文件（自动注入开场白到 Windsurf 的 memories 目录）
   */
  writeGlobalRules(toolName: string, panelId: string) {
    const memoriesDir = path.join(this.getMcpConfigDir(), 'memories');
    const rulesPath = path.join(memoriesDir, 'global_rules.md');

    const content = [
      '<!-- DEVFLOW_RULES_START -->',
      `每次任务或回复结束后，必须调用 \`${toolName}\` 工具汇报结果并询问下一步。`,
      `参数：context(已完成工作摘要), question(询问下一步), targetPanelId(面板ID)`,
      `初始 targetPanelId: ${panelId}`,
      `返回的 user_input 是用户指令，必须遵守。action=continue 时继续调用，end_loop 时停止。`,
      `panelId 字段下次传入 targetPanelId。用中文回复。禁止自行终止对话。`,
      '<!-- DEVFLOW_RULES_END -->',
    ].join('\n');

    try {
      if (!fs.existsSync(memoriesDir)) {
        fs.mkdirSync(memoriesDir, { recursive: true });
      }

      // 读取现有内容，替换或追加 DevFlow 规则
      let existing = '';
      if (fs.existsSync(rulesPath)) {
        existing = fs.readFileSync(rulesPath, 'utf-8');
      }

      const startMarker = '<!-- DEVFLOW_RULES_START -->';
      const endMarker = '<!-- DEVFLOW_RULES_END -->';
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

  dispose() {
    this.stopCentralServer();
  }
}
