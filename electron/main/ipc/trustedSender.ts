import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';

/** Only the trusted top-level control-center renderer may invoke privileged IPC. */
export function assertTrustedIpcSender(
  event: IpcMainInvokeEvent,
  mainWindow: BrowserWindow,
): void {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
    throw new Error('Privileged renderer is unavailable.');
  }
  if (event.sender.id !== mainWindow.webContents.id) {
    throw new Error('Unauthorized IPC sender.');
  }
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) {
    throw new Error('Privileged IPC is restricted to the trusted top-level frame.');
  }
}
