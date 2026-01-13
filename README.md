# WindsurfChat Open

开源版 WindsurfChat - 让 AI 停下来听你说话

## 功能

- 💬 **内嵌面板** - 在 IDE 底部面板显示，不打断编码流程
- 🖼️ **图片支持** - 粘贴或拖拽图片
- ⚡ **快捷键** - Ctrl+Enter 提交，Esc 结束对话
- 🔄 **命令行方案** - 无需 MCP，通过 HTTP + 阻塞脚本实现

## 安装

1. 下载 .vsix 文件
2. VS Code/Windsurf: `Cmd+Shift+P` → `Extensions: Install from VSIX...`

## 使用

1. 安装插件后，打开任意工作区
2. 执行命令 `WindsurfChat: 初始化工作区`
3. 插件会自动复制必要文件到工作区：
   - `windsurfchat/windsurf_chat.js` - 命令行脚本
   - `.windsurfrules` - AI 规则文件
   - `.windsurf_chat_port` - 端口文件

## 工作原理

```
┌─────────────────────────────────────────────────────────────┐
│                     .windsurfrules                          │
│   强制 AI 每次回复调用: node windsurf_chat.js "reason"       │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│               windsurf_chat.js (阻塞)                        │
│   1. 读取 .windsurf_chat_port 获取端口                       │
│   2. HTTP 请求插件，阻塞等待                                 │
│   3. 返回用户选择/指令                                        │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│            VSCode 插件 (HTTP 服务器)                         │
│   监听端口，提供 Webview 面板让用户输入                       │
└─────────────────────────────────────────────────────────────┘
```

## 开发

```bash
npm install
npm run compile
npm run package
```

## License

MIT
