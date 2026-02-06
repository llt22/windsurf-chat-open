const { spawn } = require('child_process');
const path = require('path');

// 颜色代码
const COLORS = {
    Cyan: "\x1b[36m",
    Reset: "\x1b[0m",
    Green: "\x1b[32m"
};

console.log(COLORS.Cyan + "[测试启动] 正在模拟 AI 调用 CLI 脚本并与之交互..." + COLORS.Reset);

// 启动 CLI 脚本
const child = spawn('node', [path.join(__dirname, 'lib', 'windsurf_chat.cjs'), "这是一次模拟测试"], {
    stdio: ['pipe', 'pipe', 'inherit'] // 我们接管输入和输出
});

// 监听输出
child.stdout.on('data', (data) => {
    const output = data.toString();
    process.stdout.write(output); // 把脚本的输出打印出来

    // 如果看到提示符，就开始模拟打字
    if (output.includes('👉 请输入指令')) {
        console.log(COLORS.Green + "\n[模拟器] 检测到输入请求，正在输入建议..." + COLORS.Reset);

        setTimeout(() => {
            child.stdin.write("这是第一行反馈内容\n");
        }, 500);

        setTimeout(() => {
            child.stdin.write("这是第二行反馈内容\n");
        }, 1000);

        setTimeout(() => {
            console.log(COLORS.Green + "[模拟器] 按下第二次回车提交...\n" + COLORS.Reset);
            child.stdin.write("\n"); // 连续的第二个回车触发结束
        }, 1500);
    }
});

child.on('exit', (code) => {
    console.log(COLORS.Cyan + `\n[测试完成] 脚本正常退出，退出码: ${code}` + COLORS.Reset);
});
