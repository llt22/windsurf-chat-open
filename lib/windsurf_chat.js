#!/usr/bin/env node
/**
 * WindsurfChat Open - 命令行脚本
 * 通过 HTTP 与 VSCode 插件通信，等待用户输入
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const GLOBAL_DIR = path.join(os.homedir(), '.windsurf-chat-open');
const DEFAULT_PORT = 34500;

function getPort() {
  // 优先从全局目录读取端口
  const globalPortFile = path.join(GLOBAL_DIR, 'port');
  if (fs.existsSync(globalPortFile)) {
    const port = parseInt(fs.readFileSync(globalPortFile, 'utf-8').trim(), 10);
    if (!isNaN(port)) return port;
  }
  return DEFAULT_PORT;
}

function makeRequest(port, prompt) {
  return new Promise((resolve) => {
    const data = JSON.stringify({
      prompt: prompt,
      requestId: Date.now().toString(),
      workspacePath: process.cwd()
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
          resolve({ action: 'continue', text: '', images: [] });
        }
      });
    });

    req.on('error', (e) => {
      console.error(`[WindsurfChat] 连接失败: ${e.message}`);
      resolve({ action: 'continue', text: '', images: [] });
    });

    req.setTimeout(30 * 60 * 1000, () => {
      req.destroy();
      resolve({ action: 'continue', text: '', images: [] });
    });

    req.write(data);
    req.end();
  });
}

function formatOutput(response) {
  const { action, text, images } = response;

  if (action === 'end') {
    return 'User chose to end';
  }

  if (action === 'continue' && !text && (!images || images.length === 0)) {
    return 'User chose to continue';
  }

  let output = 'User chose to continue\n';

  if (text) {
    output += `User instruction: ${text}`;
  }

  if (images && images.length > 0) {
    output += `\n\n用户提供了 ${images.length} 张图片，请使用 read_file 工具读取以下图片文件：\n`;
    for (const img of images) {
      output += `- ${img}\n`;
    }
  }

  return output;
}

async function main() {
  const prompt = process.argv.slice(2).join(' ') || '等待用户反馈';
  
  console.log(`[WindsurfChat] 脚本启动, 工作区: ${process.cwd()}`);
  
  const port = getPort();
  const response = await makeRequest(port, prompt);
  const output = formatOutput(response);
  
  console.log(output);
}

main().catch(console.error);
