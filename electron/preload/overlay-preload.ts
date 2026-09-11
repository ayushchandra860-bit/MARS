// ============================================================
// MARS PRO V3 — Read-only Overlay Preload
// Overlay renderers receive display state only; no privileged invokes.
// ============================================================

import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../../shared/contracts/ipc-channels';

const ALLOWED_LISTEN_CHANNELS = new Set<string>([
  IPC_CHANNELS.OVERLAY_STATE_UPDATE,
  IPC_CHANNELS.OVERLAY_SHOW,
  IPC_CHANNELS.OVERLAY_HIDE,
]);

const on = (channel: string, callback: (...args: unknown[]) => void): (() => void) => {
  if (!ALLOWED_LISTEN_CHANNELS.has(channel)) return () => {};
  const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('marsApi', {
  on,
  once: (channel: string, callback: (...args: unknown[]) => void): void => {
    if (!ALLOWED_LISTEN_CHANNELS.has(channel)) return;
    ipcRenderer.once(channel, (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args));
  },
});

contextBridge.exposeInMainWorld('electronAPI', {
  onSignalUpdate: (callback: (data: unknown) => void) => on(IPC_CHANNELS.OVERLAY_STATE_UPDATE, callback),
});
