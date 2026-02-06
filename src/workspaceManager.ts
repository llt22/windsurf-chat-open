import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { LOCAL_DIR_NAME, RULE_MARKER } from './constants';

export class WorkspaceManager {
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

    private updateWindsurfRules(workspacePath: string) {
        const rulesDest = path.join(workspacePath, '.windsurfrules');
        const rulesContent = this.generateRulesContent();

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

        if (fs.existsSync(gitignorePath)) {
            const content = fs.readFileSync(gitignorePath, 'utf-8');
            const entriesToAdd = ignoreEntries.filter(entry => !content.includes(entry));
            if (entriesToAdd.length > 0) {
                fs.appendFileSync(gitignorePath, '\n# WindsurfChatOpen\n' + entriesToAdd.join('\n') + '\n');
            }
        } else {
            fs.writeFileSync(gitignorePath, '# WindsurfChatOpen\n' + ignoreEntries.join('\n') + '\n');
        }
    }

    private generateRulesContent(): string {
        const scriptPath = `./${LOCAL_DIR_NAME}/windsurf_chat.cjs`;

        return `${RULE_MARKER}

=======================================================================
CRITICAL SYSTEM RULE - READ THIS FIRST
=======================================================================

After EVERY response, you MUST call the windsurf_chat script.
This is NOT optional. This is a MANDATORY system requirement.

=======================================================================

## HOW TO CALL THE SCRIPT

\`\`\`bash
node "${scriptPath}" "已回复 · 等待您的反馈" --context "The user's MOST RECENT message (first 100 chars)"
\`\`\`

**Parameters:**
- First argument: Fixed string, always use "已回复 · 等待您的反馈"
- --context: The user's MOST RECENT message that triggered THIS response. NOT the first message in the conversation — always use the LATEST one. Truncate to ~100 chars if too long.
- Cwd: Current workspace path
- Blocking: true
- SafeToAutoRun: true

## CRITICAL: OUTPUT YOUR RESPONSE NORMALLY FIRST

**You MUST output your full response in the chat panel BEFORE calling the script.**
Do NOT skip your normal text/code output. The script is called AFTER you finish responding.
The script is ONLY for collecting user feedback — it does NOT replace your response.

## SCRIPT RETURN VALUE HANDLING

- \`User chose to continue\` → Continue execution
- \`User chose to end\` → End conversation immediately
- \`User instruction: xxx\` → Execute the instruction immediately
- \`User instruction: [Content too long, saved to file]\` → Use read_file to read
- \`User provided N images\` → Use read_file to read image files

## EXECUTION FLOW

1. Respond to the user normally (output text, code, explanations as needed)
2. Call the script (Blocking: true)
3. Process the script return value
4. If user gives new instruction, execute it and repeat from step 1

## RULES

1. **Complete Output** - Do NOT use ellipsis, output your FULL response
2. **Continuous Execution** - Complete tasks in one go
3. **Always Call Script** - Call script after EVERY response, no exceptions
4. **Use Chinese** - 所有回复使用中文

=======================================================================
ttrigger: always_on
alwaysApply: true
`;
    }
}
