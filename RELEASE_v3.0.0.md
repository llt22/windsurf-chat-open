# DevFlow Panel v3.0.0

## 🚀 全新架构

从旧版脚本注入方式升级为 **MCP 协议通信**，更稳定、更优雅。

### 架构变化

```
Extension (VSCode 插件)
  ↕ WebSocket
Central Server (端口 23985)
  ↕ HTTP SSE (/mcp)
Windsurf AI (MCP 工具调用)
```

- 单进程 Central Server 同时提供 WebSocket + HTTP SSE MCP 端点
- 使用 `serverUrl` 模式注册 MCP（与 Windsurf 原生一致）
- 不再需要独立的 MCP Server 进程

## ✨ 新特性

- **MCP 协议通信** — 通过 HTTP SSE 与 Windsurf AI 交互，零额外进程
- **多 IDE 支持** — Windsurf / Windsurf-next 共用同一服务，自动同步工具名
- **手动重生成工具名** — 面板 🔄 按钮或命令面板 `DevFlow: Regenerate MCP Tool Name`
- **图片反馈** — 粘贴 / 拖拽图片到输入框
- **文件引用** — 输入框引用工作区文件
- **浅色 / 深色主题自适应**

## 📦 安装

1. 下载 `devflow-panel-3.0.0.vsix`
2. `Ctrl+Shift+P` → `Extensions: Install from VSIX...`
3. 重启 IDE

安装后插件会自动：
- 启动 Central Server
- 注册 MCP 工具到 `mcp_config.json`
- 注入规则到 `global_rules.md`

## ⌨️ 命令

| 命令 | 快捷键 | 说明 |
|---|---|---|
| `DevFlow: Focus Panel` | `Ctrl+Shift+D` | 聚焦面板 |
| `DevFlow: Regenerate MCP Tool Name` | — | 生成新的 MCP 工具名 |

## 🔄 多 IDE 共用

两个 IDE 同时运行时：
1. 先启动的 IDE 占用 Central Server（端口 23985）
2. 后启动的 IDE 自动连接已有服务，同步工具名
3. 先启动的 IDE 关闭后，另一个 IDE 自动接管

## ⚠️ 从旧版迁移

旧版使用脚本注入方式已被 Windsurf 检测并封禁，无法继续使用。v3.0 改用 MCP 协议通信，需要清理旧版残留文件：

1. 卸载旧版插件
2. 删除项目中旧版自动生成的 `.windsurfchatopen/` 目录和 `.windsurfrules` 文件
3. 清理 Windsurf 全局提示词中旧版相关内容
4. 安装新版
