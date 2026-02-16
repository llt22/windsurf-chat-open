# DevFlow Panel

让 AI 停下来听你说话 — 随时介入对话，精准反馈指令。

## 核心特性

- **MCP 协议通信** — 通过 HTTP SSE 与 Windsurf AI 交互，无需额外进程
- **多 IDE 支持** — Windsurf / Windsurf-next 共用同一服务，自动同步
- **图片反馈** — 粘贴/拖拽图片到输入框，直接发送给 AI
- **文件引用** — 输入框引用工作区文件，AI 可直接查看
- **动态工具名** — 支持手动重新生成 MCP 工具名（防检测）
- **浅色/深色主题自适应**

## 架构

```
Extension (VSCode 插件)
  ↕ WebSocket
Central Server (端口 23985)
  ↕ HTTP SSE (/mcp)
Windsurf AI (MCP 工具调用)
```

- **Extension** — 管理面板 UI、用户交互、MCP 配置写入
- **Central Server** — 单进程提供 WebSocket + HTTP SSE MCP 端点
- **Windsurf AI** — 通过 `mcp_config.json` 中的 `serverUrl` 调用 MCP 工具

## 快速开始

### 1. 安装插件

从 [Releases](https://github.com/nicepkg/windsurf-chat-open/releases) 下载 `.vsix` 文件：

```
Ctrl+Shift+P → Extensions: Install from VSIX...
```

### 2. 重启 IDE

安装后重启 Windsurf，插件会自动：
- 启动 Central Server
- 注册 MCP 工具到 `~/.codeium/windsurf/mcp_config.json`（或 `windsurf-next`）
- 注入规则到 `global_rules.md`

### 3. 使用面板

点击底部状态栏 **DevFlow** 或使用快捷键 `Ctrl+Shift+D` 打开面板。

## 命令

| 命令 | 说明 |
|---|---|
| `DevFlow: Focus Panel` | 聚焦到 DevFlow 面板 |
| `DevFlow: Regenerate MCP Tool Name` | 手动生成新的 MCP 工具名 |

## 多 IDE 共用

两个 IDE 同时运行时：
1. 先启动的 IDE 占用 Central Server（端口 23985）
2. 后启动的 IDE 自动连接已有服务，同步工具名
3. 先启动的 IDE 关闭后，另一个 IDE 自动接管服务器

## 从旧版迁移（v2.x → v3.0）

v3.0 使用 MCP 协议替代了旧版的脚本注入方式，需要清理旧版自动生成的文件：

### 1. 卸载旧版插件

```
Ctrl+Shift+P → Extensions: Uninstall → 搜索旧插件名卸载
```

### 2. 清理项目中的旧文件

删除每个项目根目录下旧版自动创建的文件：

```bash
# 删除旧版工作目录和规则文件
rm -rf .windsurfchatopen/
rm -f .windsurfrules
```

Windows PowerShell：
```powershell
Remove-Item -Recurse -Force .windsurfchatopen -ErrorAction SilentlyContinue
Remove-Item -Force .windsurfrules -ErrorAction SilentlyContinue
```

### 3. 清理全局提示词

打开 Windsurf 设置，删除旧版全局提示词中的相关内容（如"遵循工作区规则，每次回复结束前调用脚本"）。

### 4. 安装新版

按上方「快速开始」步骤安装 v3.0 即可。

## 开源协议

MIT License
