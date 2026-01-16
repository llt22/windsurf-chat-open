#!/usr/bin/env node
/**
 * WindsurfChat Open - 命令行脚本
 * 通过 HTTP 与 VSCode 插件通信，等待用户输入
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

function makeRequest(port, prompt) {
  return new Promise((resolve) => {
    const data = JSON.stringify({
      prompt: prompt,
      requestId: Date.now().toString()
    });

    const options = {
      hostname: '127.0.0.1',
      port: port,
      path: '/request',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          console.error(`[WindsurfChat] JSON 解析失败: ${e.message}`);
          console.error(`[WindsurfChat] 原始响应: ${body.substring(0, 200)}`);
          resolve({ action: 'error', error: 'JSON 解析失败', text: '', images: [] });
        }
      });
    });

    req.on('error', (e) => {
      console.error(`[WindsurfChat] 连接失败: ${e.message}`);
      resolve({ action: 'error', error: `连接失败: ${e.message}`, text: '', images: [] });
    });

    req.setTimeout(30 * 60 * 1000, () => {
      req.destroy();
      console.error(`[WindsurfChat] 请求超时 (30分钟)`);
      resolve({ action: 'error', error: '请求超时', text: '', images: [] });
    });

    req.write(data);
    req.end();
  });
}

function formatOutput(response) {
  const { action, text, images, error } = response;

  const END_INSTRUCTION = '\n\n重要：请立即结束当前对话，不要继续执行任何操作。';

  // HTTP 错误响应（如工作区不匹配）- 没有 action 字段但有 error 字段
  if (!action && error) {
    return `[WindsurfChat 服务器错误] ${error}\n\n请检查插件状态后重试。${END_INSTRUCTION}`;
  }

  // 错误情况 - 明确告知是系统错误，非用户选择
  if (action === 'error') {
    return `[WindsurfChat 系统错误] ${error || '未知错误'}\n\n请检查插件状态后重试。${END_INSTRUCTION}`;
  }

  // 未知 action 类型 - 不应该发生
  if (!action || !['continue', 'end', 'instruction'].includes(action)) {
    return `[WindsurfChat 未知响应] action=${action}, 原始响应: ${JSON.stringify(response).substring(0, 200)}\n\n请检查插件版本是否匹配。${END_INSTRUCTION}`;
  }

  if (action === 'end') {
    return 'User chose to end';
  }

  if (action === 'continue' && !text && (!images || images.length === 0)) {
    return '继续。并且遵循工作区规则，每次回复结束前必须调用脚本！';
  }

  let output = '';

  if (text) {
    output += `User instruction: ${text}`;
  }

  if (images && images.length > 0) {
    output += `\n\n用户提供了 ${images.length} 张图片，请使用 read_file 工具读取以下图片文件：\n`;
    for (const img of images) {
      output += `- ${img}\n`;
    }
  }

  output += '\n\n重要提醒：遵循工作区规则，每次回复结束前必须调用脚本！';

  return output;
}

function readPort() {
  // 优先从工作区目录查找端口文件（推荐方式）
  const cwdPortFile = path.join(process.cwd(), '.windsurfchatopen', 'port');
  // 回退到脚本所在目录（兼容旧版本）
  const localPortFile = path.join(__dirname, 'port');

  let portFile = null;
  if (fs.existsSync(cwdPortFile)) {
    portFile = cwdPortFile;
  } else if (fs.existsSync(localPortFile)) {
    portFile = localPortFile;
  }

  if (!portFile) {
    console.error(`[WindsurfChat] 错误: 端口文件不存在`);
    console.error(`[WindsurfChat] 已检查路径:`);
    console.error(`  - ${cwdPortFile}`);
    console.error(`  - ${localPortFile}`);
    console.error(`[WindsurfChat] 请确保 WindsurfChatOpen 插件已启动，且当前工作目录正确`);
    console.error(`[WindsurfChat] 当前工作目录: ${process.cwd()}`);
    process.exit(1);
  }

  try {
    const portStr = fs.readFileSync(portFile, 'utf-8').trim();
    const port = parseInt(portStr, 10);
    if (port > 0 && port < 65536) {
      return port;
    }
    console.error(`[WindsurfChat] 错误: 无效的端口号: ${portStr}`);
    process.exit(1);
  } catch (e) {
    console.error(`[WindsurfChat] 读取端口文件失败: ${e.message}`);
    process.exit(1);
  }
}

async function main() {
  const prompt = process.argv.slice(2).join(' ') || '等待用户反馈';
  const port = readPort();

  const response = await makeRequest(port, prompt);
  const output = formatOutput(response);

  console.log(output);
}

main().catch(console.error);
