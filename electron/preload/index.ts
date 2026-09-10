// ============================================================
// MARS PRO V3 — Main Renderer Preload
// A context-isolated, contract-only bridge. No Electron or Node object escapes.
// ============================================================

import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, IPC_INVOKE_CHANNELS } from '../../shared/contracts/ipc-channels';

const ALLOWED_LISTEN_CHANNELS = new Set<string>(Object.values(IPC_CHANNELS));
const ALLOWED_INVOKE_CHANNELS = new Set<string>(Object.values(IPC_INVOKE_CHANNELS));

contextBridge.exposeInMainWorld('marsApi', {
  invoke: (channel: string, ...args: unknown[]): Promise<unknown> => {
    if (!ALLOWED_INVOKE_CHANNELS.has(channel)) {
      return Promise.reject(new Error(`IPC invoke channel not allowed: ${channel}`));
    }
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (channel: string, callback: (...args: unknown[]) => void): (() => void) => {
    if (!ALLOWED_LISTEN_CHANNELS.has(channel)) return () => {};
    const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
  once: (channel: string, callback: (...args: unknown[]) => void): void => {
    if (!ALLOWED_LISTEN_CHANNELS.has(channel)) return;
    ipcRenderer.once(channel, (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args));
  },
});

contextBridge.exposeInMainWorld('electronAPI', {
  switchTab: (tabId: string) => ipcRenderer.invoke(IPC_INVOKE_CHANNELS.SWITCH_TAB, tabId),
  onSignalUpdate: (callback: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => callback(value);
    ipcRenderer.on(IPC_CHANNELS.OVERLAY_STATE_UPDATE, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.OVERLAY_STATE_UPDATE, handler);
  },
  onDeveloperDiagnostics: (callback: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => callback(value);
    ipcRenderer.on(IPC_CHANNELS.DEVELOPER_DIAGNOSTICS, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.DEVELOPER_DIAGNOSTICS, handler);
  },
});
