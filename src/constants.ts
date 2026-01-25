export const LOCAL_DIR_NAME = '.windsurfchatopen';
export const BASE_PORT = 34500;
export const MAX_PORT_ATTEMPTS = 100;
export const DEFAULT_REQUEST_TIMEOUT_MS = 1 * 60 * 1000; // 1 minute
export const TEMP_FILE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
export const TEMP_FILE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
export const WEBVIEW_READY_TIMEOUT_MS = 5000;
export const LONG_TEXT_THRESHOLD = 500;
export const HTTP_SERVER_START_DELAY_MS = 100;
export const MAX_REQUEST_BODY_SIZE = 10 * 1024 * 1024; // 10MB
export const MAX_IMAGE_COUNT = 10;
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB per image

export const COMMANDS = {
    FOCUS: 'windsurfChatOpen.focus',
    SETUP: 'windsurfChatOpen.setup',
    PANEL_FOCUS: 'windsurfChatOpen.panel.focus'
};

export const VIEWS = {
    PANEL: 'windsurfChatOpen.panel'
};

export const RULE_MARKER = '<!-- WINDSURF_CHAT_OPEN_V1 -->';

export const ERROR_MESSAGES = {
    WEBVIEW_NOT_READY: 'Webview 面板未就绪，请重试。如果问题持续，请尝试重新打开面板。',
    PANEL_NOT_AVAILABLE: '面板视图不可用，请重试。如果问题持续，请尝试重新打开面板。',
    REQUEST_SUPERSEDED: 'Request superseded by new request',
    REQUEST_TIMEOUT: 'Timed out waiting for user response',
    REQUEST_CANCELLED: 'Request cancelled',
    EXTENSION_DEACTIVATED: 'Extension deactivated',
    INVALID_JSON: 'Invalid JSON',
    IMAGE_SAVE_FAILED: 'Failed to save image',
    TOO_MANY_IMAGES: '图片数量超过限制（最多 10 张）',
    IMAGE_TOO_LARGE: '图片大小超过限制（单张最大 5MB）'
};
