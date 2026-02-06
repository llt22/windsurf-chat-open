import * as fs from 'fs';
import * as path from 'path';

/**
 * 获取 webview 资源文件所在目录
 * 开发时在 src/webview/，编译后在 dist/webview/
 */
function getWebviewDir(): string {
  // 优先使用 dist/webview（编译后），其次 src/webview（开发时）
  const distDir = path.join(__dirname, 'webview');
  if (fs.existsSync(distDir)) {
    return distDir;
  }
  return path.join(__dirname, '..', 'src', 'webview');
}

/**
 * 获取 webview 的 HTML 内容（从独立文件加载）
 */
export function getPanelHtml(version: string = '0.0.0'): string {
  const dir = getWebviewDir();
  const html = fs.readFileSync(path.join(dir, 'panel.html'), 'utf-8');
  const css = fs.readFileSync(path.join(dir, 'panel.css'), 'utf-8');
  const js = fs.readFileSync(path.join(dir, 'panel.js'), 'utf-8');

  return html
    .replace('{{STYLES}}', css)
    .replace('{{SCRIPT}}', js)
    .replace('{{VERSION}}', version);
}

