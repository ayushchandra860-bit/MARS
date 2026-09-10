// ============================================================
// MARS PRO V3 — Preload Script
// Context-isolated IPC Bridge for Control Center & Overlay Windows.
// ============================================================

import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, IPC_INVOKE_CHANNELS } from '../../shared/contracts/ipc-channels';

// Explicitly Whitelisted Channels to prevent silent drops.
// Derived purely from the shared contract — legacy hardcoded strings were
// removed so the whitelist can never drift from the constants.
const ALLOWED_LISTEN_CHANNELS = new Set(Object.values(IPC_CHANNELS || {}));

const ALLOWED_INVOKE_CHANNELS = new Set(Object.values(IPC_INVOKE_CHANNELS || {}));

/**
 * Expose Control Center API via marsApi
 */
contextBridge.exposeInMainWorld('marsApi', {
  invoke: (channel: string, ...args: unknown[]): Promise<unknown> => {
    if (!ALLOWED_INVOKE_CHANNELS.has(channel as any)) {
      return Promise.reject(new Error(`IPC invoke channel not allowed: ${channel}`));
    }
    return ipcRenderer.invoke(channel, ...args);
  },

  on: (channel: string, callback: (...args: unknown[]) => void): (() => void) => {
    if (!ALLOWED_LISTEN_CHANNELS.has(channel as any)) {
      console.warn(`[PRELOAD WARN] Blocked unauthorized listen channel: ${channel}`);
      return () => {};
    }

    const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => {
      callback(...args);
    };

    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },

  once: (channel: string, callback: (...args: unknown[]) => void): void => {
    if (!ALLOWED_LISTEN_CHANNELS.has(channel as any)) {
      console.warn(`[PRELOAD WARN] Blocked unauthorized once channel: ${channel}`);
      return;
    }

    ipcRenderer.once(channel, (_event: Electron.IpcRendererEvent, ...args: unknown[]) => {
      callback(...args);
    });
  },
});

/**
 * Expose Overlay API via electronAPI (Guarantees OverlayApp.tsx binding)
 */
contextBridge.exposeInMainWorld('electronAPI', {
  switchTab: (tabId: string) => {
    return ipcRenderer.invoke('switch-tab', tabId);
  },

  onSignalUpdate: (callback: (data: any) => void) => {
    const handler = (_event: any, value: any) => callback(value);
    ipcRenderer.on(IPC_CHANNELS.OVERLAY_STATE_UPDATE, handler);

    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.OVERLAY_STATE_UPDATE, handler);
    };
  },

  onDeveloperDiagnostics: (callback: (data: any) => void) => {
    const handler = (_event: any, value: any) => callback(value);
    ipcRenderer.on(IPC_CHANNELS.DEVELOPER_DIAGNOSTICS, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.DEVELOPER_DIAGNOSTICS, handler);
    };
  },
});