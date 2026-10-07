import { contextBridge, ipcRenderer } from 'electron';

const validInvokeChannels = new Set(['window:isMaximized', 'notes:export-pdf', 'files:read', 'files:consume-opened']);
const validSendChannels = new Set(['window:minimize', 'window:maximize', 'window:close']);
const validOnChannels = new Set(['files:opened', 'window:maximized-changed']);
type Listener = (...args: unknown[]) => void;
const listeners = new Map<string, Map<Listener, (...args: unknown[]) => void>>();

contextBridge.exposeInMainWorld('electron', {
  invoke(channel: string, ...args: unknown[]) {
    if (!validInvokeChannels.has(channel)) return Promise.reject(new Error(`Invalid channel: ${channel}`));
    return ipcRenderer.invoke(channel, ...args);
  },
  send(channel: string, ...args: unknown[]) {
    if (validSendChannels.has(channel)) ipcRenderer.send(channel, ...args);
  },
  on(channel: string, callback: Listener) {
    if (!validOnChannels.has(channel)) return;
    const previous = listeners.get(channel)?.get(callback);
    if (previous) ipcRenderer.removeListener(channel, previous);
    const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args);
    if (!listeners.has(channel)) listeners.set(channel, new Map());
    listeners.get(channel)?.set(callback, listener);
    ipcRenderer.on(channel, listener);
  },
  off(channel: string, callback: Listener) {
    const listener = listeners.get(channel)?.get(callback);
    if (!listener) return;
    ipcRenderer.removeListener(channel, listener);
    listeners.get(channel)?.delete(callback);
  },
});
