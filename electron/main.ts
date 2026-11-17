import { app, BrowserWindow, ipcMain } from 'electron';
import { promises as fs } from 'fs';
import { randomUUID } from 'node:crypto';
import path from 'path';
import { pathToFileURL } from 'url';
import { exportNotesPdf } from './notesPdf';
import { dictEngine } from './dictEngine';
import { llmEngine } from './llmEngine';
import type { LlmExplainRequest, LlmModelTier } from '../src/shared/llmTypes';

const APP_USER_MODEL_ID = 'com.quaxstudio.minireader';
const appIconPath = process.platform === 'win32' && app.isPackaged
  ? path.join(process.resourcesPath, 'app-icon.ico')
  : path.join(__dirname, '..', 'dist', process.platform === 'win32' ? 'app-icon.ico' : 'app-icon.png');

if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.epub', '.txt']);
const MAX_OPEN_FILE_BYTES = 512 * 1024 * 1024;
const pendingOpenFiles = new Set<string>();
const approvedOpenFiles = new Set<string>();
let mainWindow: BrowserWindow | null = null;

function normalizeSupportedPath(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const filePath = path.resolve(value);
  if (!SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return null;
  return filePath;
}

async function validateReadablePath(value: unknown) {
  const filePath = normalizeSupportedPath(value);
  if (!filePath) return null;
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > MAX_OPEN_FILE_BYTES) return null;
    return filePath;
  } catch {
    return null;
  }
}

function isTrustedRenderer(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) {
  const url = event.senderFrame?.url || '';
  return url.startsWith('file://') || /^https?:\/\/(localhost|127\.0\.0\.1):3000(?:\/|$)/.test(url);
}

const LLM_TIERS: LlmModelTier[] = ['auto', 'qwen3.5:9b', 'qwen3.5:4b', 'qwen3.5:2b'];

function normalizeTier(value: unknown): LlmModelTier {
  return LLM_TIERS.includes(value as LlmModelTier) ? (value as LlmModelTier) : 'auto';
}

function normalizeExplainRequest(value: unknown): LlmExplainRequest | null {
  if (!value || typeof value !== 'object') return null;
  const payload = value as Record<string, unknown>;
  const span = typeof payload.span === 'string' ? payload.span.trim().slice(0, 200) : '';
  if (!span) return null;

  const kind =
    payload.kind === 'phrase' || payload.kind === 'sentence' ? payload.kind : 'word';

  return {
    span,
    context: typeof payload.context === 'string' ? payload.context.trim().slice(0, 400) : '',
    ruleSummary:
      typeof payload.ruleSummary === 'string' ? payload.ruleSummary.slice(0, 400) : '',
    kind,
  };
}

function queueOpenFiles(paths: string[]) {
  paths.forEach((filePath) => pendingOpenFiles.add(filePath));
  if (mainWindow && !mainWindow.isDestroyed() && paths.length > 0) {
    mainWindow.webContents.send('files:opened', paths);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 760,
    minHeight: 520,
    frame: false,
    transparent: false,
    backgroundColor: '#FCF8F2',
    icon: appIconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  if (process.platform === 'win32') {
    mainWindow.setAppDetails({
      appId: APP_USER_MODEL_ID,
      appIconPath,
      appIconIndex: 0,
      relaunchCommand: process.execPath,
      relaunchDisplayName: 'Mini Reader',
    });
  }

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const appFileUrl = pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).href;
  const notifyWindowState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('window:maximized-changed', mainWindow.isMaximized());
  };
  mainWindow.on('maximize', notifyWindowState);
  mainWindow.on('unmaximize', notifyWindowState);
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url === appFileUrl || url.startsWith(`${appFileUrl}#`)) return;
    if (/^https?:\/\/(localhost|127\.0\.0\.1):3000(?:\/|$)/.test(url)) return;
    event.preventDefault();
  });

  if (!app.isPackaged && (process.env.NODE_ENV === 'development' || process.argv.includes('--dev'))) {
    void mainWindow.loadURL('http://localhost:3000');
  } else {
    void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.webContents.on('did-finish-load', () => {
    const files = [...pendingOpenFiles];
    if (files.length > 0) mainWindow?.webContents.send('files:opened', files);
  });
  mainWindow.on('closed', () => {
    llmEngine.abortAll();
    mainWindow = null;
  });
}

function registerIpcHandlers() {
  ipcMain.handle('dict:lookup', async (event, word: string) => {
    if (!isTrustedRenderer(event)) throw new Error('不受信任的渲染器');
    return dictEngine.lookup(word);
  });

  ipcMain.handle('dict:lemmatize', async (event, word: string) => {
    if (!isTrustedRenderer(event)) throw new Error('不受信任的渲染器');
    return dictEngine.lemmatize(word);
  });

  ipcMain.handle('dict:batch-lookup', async (event, words: string[]) => {
    if (!isTrustedRenderer(event)) throw new Error('不受信任的渲染器');
    return dictEngine.batchLookup(words);
  });

  ipcMain.handle('dict:status', async (event) => {
    if (!isTrustedRenderer(event)) throw new Error('不受信任的渲染器');
    return { available: dictEngine.isAvailable() };
  });

  ipcMain.handle('dict:resolve-span', async (event, raw: unknown) => {
    if (!isTrustedRenderer(event)) throw new Error('不受信任的渲染器');
    if (typeof raw !== 'string') return null;
    return dictEngine.resolveSpan(raw.slice(0, 200));
  });

  ipcMain.handle('llm:status', async (event, payload: unknown) => {
    if (!isTrustedRenderer(event)) throw new Error('不受信任的渲染器');
    const options = (payload ?? {}) as Record<string, unknown>;
    const provider = options.provider === 'bundled' ? 'bundled' : 'ollama';
    return llmEngine.status(provider, normalizeTier(options.tier));
  });

  ipcMain.handle('llm:explain', async (event, payload: unknown) => {
    if (!isTrustedRenderer(event)) throw new Error('不受信任的渲染器');

    const options = (payload ?? {}) as Record<string, unknown>;
    const request = normalizeExplainRequest(options.request);
    if (!request) throw new Error('无效的解释请求');

    const requestId = randomUUID();
    const tier = normalizeTier(options.tier);
    const sender = event.sender;

    // 立即返回 requestId，结果通过事件推回，避免 IPC 握手被推理阻塞。
    void (async () => {
      try {
        const result = await llmEngine.explain(requestId, request, tier, (chars) => {
          if (!sender.isDestroyed()) sender.send('llm:delta', { requestId, chars });
        });
        if (!sender.isDestroyed()) sender.send('llm:done', { requestId, result });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!sender.isDestroyed()) sender.send('llm:error', { requestId, message });
      }
    })();

    return { requestId };
  });

  ipcMain.handle('llm:cancel', async (event, requestId: unknown) => {
    if (!isTrustedRenderer(event)) throw new Error('不受信任的渲染器');
    if (typeof requestId === 'string') llmEngine.cancel(requestId);
    return true;
  });

  ipcMain.handle('notes:export-pdf', async (event, payload) => {
    if (!isTrustedRenderer(event)) throw new Error('不受信任的渲染器');
    return exportNotesPdf(payload);
  });

  ipcMain.handle('window:isMaximized', (event) => {
    if (!isTrustedRenderer(event)) return false;
    return mainWindow?.isMaximized() ?? false;
  });
  ipcMain.on('window:minimize', (event) => {
    if (isTrustedRenderer(event)) mainWindow?.minimize();
  });
  ipcMain.on('window:maximize', (event) => {
    if (!isTrustedRenderer(event)) return;
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.on('window:close', (event) => {
    if (isTrustedRenderer(event)) mainWindow?.close();
  });

  ipcMain.handle('files:read', async (event, values) => {
    if (!isTrustedRenderer(event) || !Array.isArray(values)) return [];
    const result = [];
    for (const value of values) {
      const requestedPath = normalizeSupportedPath(value);
      if (!requestedPath || !approvedOpenFiles.has(requestedPath)) continue;
      approvedOpenFiles.delete(requestedPath);
      const filePath = await validateReadablePath(requestedPath);
      if (!filePath) continue;
      try {
        const data = await fs.readFile(filePath);
        result.push({ name: path.basename(filePath), path: filePath, data });
      } catch {
        // The file may disappear between validation and read.
      }
    }
    return result;
  });

  ipcMain.handle('files:consume-opened', (event) => {
    if (!isTrustedRenderer(event)) return [];
    const files = [...pendingOpenFiles];
    pendingOpenFiles.clear();
    files.forEach((filePath) => approvedOpenFiles.add(filePath));
    return files;
  });
}

const initialArgvFiles = process.argv.slice(1).filter((value) => normalizeSupportedPath(value));
initialArgvFiles.forEach((value) => pendingOpenFiles.add(path.resolve(value)));

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    const paths = commandLine.filter((value) => normalizeSupportedPath(value)).map((value) => path.resolve(value));
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    queueOpenFiles(paths);
  });

  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    const normalized = normalizeSupportedPath(filePath);
    if (normalized) queueOpenFiles([normalized]);
  });

  app.whenReady().then(() => {
    registerIpcHandlers();
    createWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
