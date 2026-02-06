# WindsurfChat Open 代码审查结果

审查日期：2026-02-06
审查范围：当前仓库源码静态审查 + 基础构建与测试可用性验证

## 发现清单（按严重级别）

### 1) 高风险：自动覆盖 `.windsurfrules`，存在用户规则被不可逆清空风险
- 文件定位：`src/workspaceManager.ts:59`、`src/workspaceManager.ts:61`、`src/workspaceManager.ts:63`、`src/extension.ts:65`、`src/extension.ts:86`
- 问题描述：`setup()` 在插件启动和工作区变更时触发，直接删除并重写 `.windsurfrules`。
- 影响：用户自定义规则会丢失，属于不可逆覆盖行为。

### 2) 中风险：本地 HTTP 接口无鉴权，任意本机进程可伪造请求并读取用户回复
- 文件定位：`src/httpService.ts:182`、`src/httpService.ts:199`、`src/httpService.ts:208`、`src/httpService.ts:170`、`lib/windsurf_chat.cjs:124`
- 问题描述：服务仅绑定 `127.0.0.1`，但缺少 token/签名鉴权；端口明文写入工作区文件。
- 影响：同机其他进程可向 `/request` 注入请求并接收用户面板反馈，存在本地进程滥用风险。

### 3) 中风险：仓库内测试脚本失效，CLI 交互回归无法验证
- 文件定位：`test_cli_interaction.js:14`
- 问题描述：脚本引用 `lib/windsurf_chat_cli.js`，但仓库实际仅存在 `lib/windsurf_chat.cjs`。
- 影响：测试无法覆盖 CLI 交互链路，回归风险上升。
- 复现结果：运行 `node test_cli_interaction.js` 报 `MODULE_NOT_FOUND`。

### 4) 低风险：规则配置键名疑似拼写错误
- 文件定位：`src/workspaceManager.ts:138`
- 问题描述：生成规则中为 `ttrigger: always_on`，疑似应为 `trigger`。
- 影响：若规则解析器严格匹配键名，该配置项可能不生效。

### 5) 低风险：缺少标准化自动测试入口
- 文件定位：`package.json:59`
- 问题描述：当前仅有 `compile/watch/package`，无 `test` 脚本。
- 影响：质量闸口依赖人工执行，难以持续稳定回归。

## 已执行验证

- 构建验证：`npm run compile` 成功。
- 测试验证：`node test_cli_interaction.js` 失败（模块路径错误，见第 3 条）。

## 假设与待确认

1. 默认假设 `.windsurfrules` 允许用户自定义并应保留；若产品策略是托管整文件，第 1 条可视为设计取舍。
2. 默认假设同机其他进程不完全可信；若本机进程全部可信，第 2 条可降级。
