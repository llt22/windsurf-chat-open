export const CENTRAL_SERVER_PORT_WINDSURF = 23985;
export const CENTRAL_SERVER_PORT_WINDSURF_NEXT = 23986;
export const WS_RECONNECT_DELAY = 2000;
export const WS_MAX_RECONNECT_ATTEMPTS = 10;
export const WEBVIEW_READY_TIMEOUT_MS = 5000;
export const MAX_IMAGE_COUNT = 10;
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB per image
export const LONG_TEXT_THRESHOLD = 500;
export const STARTUP_DELAY_MS = 500;

export const COMMANDS = {
    FOCUS: 'devflow.focus',
    PANEL_FOCUS: 'devflow.panel.focus',
    REGENERATE: 'devflow.regenerate'
};

export const VIEWS = {
    PANEL: 'devflow.panel'
};

export const ERROR_MESSAGES = {
    WEBVIEW_NOT_READY: 'Webview 面板未就绪，请重试。',
    PANEL_NOT_AVAILABLE: '面板视图不可用，请重试。',
    WS_NOT_CONNECTED: 'WebSocket 未连接',
};
