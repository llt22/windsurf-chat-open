import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { LOCAL_DIR_NAME, RULE_MARKER } from './constants';

export class WorkspaceManager {
    private _needReply: boolean = false;

    constructor(private readonly extensionPath: string) { }

    public setup() {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders?.length) {
            vscode.window.showWarningMessage('Please open a workspace first');
            return;
        }

        const scriptSrc = path.join(this.extensionPath, 'lib', 'windsurf_chat.cjs');

        for (const folder of folders) {
            const workspacePath = folder.uri.fsPath;
            const localDir = path.join(workspacePath, LOCAL_DIR_NAME);

            // Create directory if not exists
            if (!fs.existsSync(localDir)) {
                fs.mkdirSync(localDir, { recursive: true });
            }

            // Remove old .js script if exists (migration from v1.6.0 to v1.6.1+)
            const oldScriptPath = path.join(localDir, 'windsurf_chat.js');
            if (fs.existsSync(oldScriptPath)) {
                fs.unlinkSync(oldScriptPath);
                console.log(`[WindsurfChatOpen] Removed old script: ${oldScriptPath}`);
            }

            // Copy script to project directory (always overwrite to ensure latest version)
            const scriptDest = path.join(localDir, 'windsurf_chat.cjs');
            if (fs.existsSync(scriptSrc)) {
                fs.copyFileSync(scriptSrc, scriptDest);
            } else {
                console.error(`[WindsurfChatOpen] Script source not found: ${scriptSrc}`);
                vscode.window.showWarningMessage(`WindsurfChatOpen: Script file not found at ${scriptSrc}`);
            }

            // Generate or update .windsurfrules
            this.updateWindsurfRules(workspacePath);

            // Update .gitignore
            this.updateGitignore(workspacePath);

            console.log(`[WindsurfChatOpen] Workspace setup complete for: ${localDir}`);
        }

        vscode.window.showInformationMessage('WindsurfChatOpen workspace initialization complete');
    }

    public updateRulesWithNeedReply(needReply: boolean) {
        this._needReply = needReply;
        const folders = vscode.workspace.workspaceFolders;
        if (!folders?.length) return;
        for (const folder of folders) {
            this.updateWindsurfRules(folder.uri.fsPath);
        }
    }

    private updateWindsurfRules(workspacePath: string) {
        const rulesDest = path.join(workspacePath, '.windsurfrules');
        const rulesContent = this.generateRulesContent(this._needReply);

        // Always delete and recreate to ensure latest rules
        if (fs.existsSync(rulesDest)) {
            fs.unlinkSync(rulesDest);
        }
        fs.writeFileSync(rulesDest, rulesContent);
        console.log(`[WindsurfChatOpen] Created/Updated .windsurfrules`);
    }

    private updateGitignore(workspacePath: string) {
        const gitignorePath = path.join(workspacePath, '.gitignore');
        const ignoreEntries = [LOCAL_DIR_NAME + '/', '.windsurfrules'];

        let content = '';
        if (fs.existsSync(gitignorePath)) {
            content = fs.readFileSync(gitignorePath, 'utf-8');
        }

        const lines = content ? content.split('\n').map(l => l.trim()) : [];
        const entriesToAdd = ignoreEntries.filter(entry => !lines.includes(entry));

        if (entriesToAdd.length === 0) {
            return;
        }

        let appendStr = '';
        if (!lines.includes('# WindsurfChatOpen')) {
            appendStr += (content && !content.endsWith('\n') ? '\n' : '') + '# WindsurfChatOpen\n';
        }
        appendStr += entriesToAdd.join('\n') + '\n';

        fs.appendFileSync(gitignorePath, appendStr);
    }

    private generateRulesContent(needReply: boolean = false): string {
        const scriptPath = `./${LOCAL_DIR_NAME}/windsurf_chat.cjs`;
        const replyParam = needReply ? ' --reply "YOUR_RESPONSE_CONTENT"' : '';
        const replyParamDoc = needReply ? `\n- --reply: 你刚才输出给用户的回复内容。` : '';

        return `${RULE_MARKER}

每次回复后，必须调用以下脚本。先正常输出回复，再调用脚本。

\`\`\`bash
node "${scriptPath}" "已回复 · 等待您的反馈" --context "用户最近一条消息（截取前100字）"${replyParam}
\`\`\`

**参数说明：**
- 第一个参数：固定字符串，始终使用 "已回复 · 等待您的反馈"
- --context: 触发本次回复的用户**最近一条**消息，不是对话中的第一条。超过100字时截断。${replyParamDoc}
- Cwd: 当前工作区路径
- Blocking: true
- SafeToAutoRun: true

## 脚本返回值处理

- \`User chose to continue\` → 继续执行
- \`User chose to end\` → **立即停止。不要再调用脚本，不要再输出任何内容。**
- \`User instruction: xxx\` → 立即执行用户指令
- \`User instruction: [Content too long, saved to file]\` → 使用 read_file 读取
- \`User provided N images\` → 使用 read_file 读取图片文件

## 规则

1. **完整输出** - 不要省略，输出完整回复
2. **必须调脚本** - 每次回复后都要调用脚本，无例外
3. **使用中文** - 所有回复使用中文

trigger: always_on
alwaysApply: true
`;
    }
}
