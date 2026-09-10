// ============================================================
// MARS PRO V3 — Preload Script (Overlay)
// Clean context-isolated IPC bridge for floating overlay windows.
// ============================================================

import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, IPC_INVOKE_CHANNELS } from '../../shared/contracts/ipc-channels';

const ALLOWED_SEND_CHANNELS = [
  'mars:overlay:mouse-enter-interactive',
  'mars:overlay:mouse-leave-interactive',
];

// Derived purely from the shared contract — legacy hardcoded strings
// ('signal-update', 'developer-diagnostics') were removed.
const ALLOWED_LISTEN_CHANNELS = [
  IPC_CHANNELS.OVERLAY_STATE_UPDATE,
  IPC_CHANNELS.OVERLAY_SHOW,
  IPC_CHANNELS.OVERLAY_HIDE,
  IPC_CHANNELS.DEVELOPER_DIAGNOSTICS,
];

contextBridge.exposeInMainWorld('marsApi', {
  invoke: (channel: string, ...args: unknown[]): Promise<unknown> => {
    const allowedChannels = Object.values(IPC_INVOKE_CHANNELS || {});
    if (!allowedChannels.includes(channel as any)) {
      return Promise.reject(new Error(`IPC channel not allowed: ${channel}`));
    }
    return ipcRenderer.invoke(channel, ...args);
  },

  send: (channel: string, ...args: unknown[]): void => {
    if (ALLOWED_SEND_CHANNELS.includes(channel)) {
      ipcRenderer.send(channel, ...args);
    }
  },

  on: (channel: string, callback: (...args: unknown[]) => void): (() => void) => {
    if (!ALLOWED_LISTEN_CHANNELS.includes(channel as any)) {
      console.warn(`[OVERLAY PRELOAD] Blocked listen on unauthorized channel: ${channel}`);
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
    if (!ALLOWED_LISTEN_CHANNELS.includes(channel as any)) {
      console.warn(`[OVERLAY PRELOAD] Blocked once on unauthorized channel: ${channel}`);
      return;
    }
    ipcRenderer.once(channel, (_event: Electron.IpcRendererEvent, ...args: unknown[]) => {
      callback(...args);
    });
  },
});

contextBridge.exposeInMainWorld('electronAPI', {
  // Listeners register on the canonical channels only — the legacy
  // 'signal-update' / 'developer-diagnostics' strings were never emitted by
  // the main process, so dual registration only ever produced dead handlers.
  onSignalUpdate: (callback: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.OVERLAY_STATE_UPDATE, handler);

    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.OVERLAY_STATE_UPDATE, handler);
    };
  },

  onDeveloperDiagnostics: (callback: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.DEVELOPER_DIAGNOSTICS, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.DEVELOPER_DIAGNOSTICS, handler);
    };
  },
});