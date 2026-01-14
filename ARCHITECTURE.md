# WindsurfChat Open - 架构流程

## 核心调用流程

```mermaid
graph TB
    A[VSCode 插件启动] --> B[生成随机端口]
    B --> C[写入 .windsurfchatopen/port]
    C --> D[启动 HTTP 服务器<br/>127.0.0.1:端口]
    
    E[AI 完成任务] --> F[调用 windsurf_chat.js]
    F --> G[读取 port 文件]
    G --> H[HTTP POST 到插件<br/>127.0.0.1:端口]
    H --> I[插件显示 WebView 面板]
    I --> J[等待用户输入]
    
    J --> K{用户操作}
    K -->|提交指令| L[返回用户输入给脚本]
    K -->|结束对话| M[返回结束信号]
    K -->|空提交| N[返回继续信号]
    
    L --> O[AI 执行新指令]
    M --> P[AI 停止]
    N --> Q[AI 继续]
    
    O --> E
    Q --> E
```

## 端口隔离机制

```
工作区 A
├── .windsurfchatopen/
│   ├── port (35386)
│   └── windsurf_chat.js
└── HTTP 服务器: 127.0.0.1:35386

工作区 B
├── .windsurfchatopen/
│   ├── port (41203)
│   └── windsurf_chat.js
└── HTTP 服务器: 127.0.0.1:41203
```

**关键点**：
- 每个工作区独立端口，互不干扰
- 脚本通过 `__dirname` 定位 `port` 文件
- 端口范围：30000-60000 随机生成
- 脚本默认端口：34500（port 文件不存在时）

## 数据流

```
AI → windsurf_chat.js → 读取 port → HTTP POST → 插件 → WebView
                                                        ↓
AI ← 脚本输出 ← HTTP 响应 ← 插件 ← 用户输入 ← WebView
```
