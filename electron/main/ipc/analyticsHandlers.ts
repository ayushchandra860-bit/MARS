import { BrowserWindow, IpcMain } from 'electron';
import { IPC_INVOKE_CHANNELS } from '../../../shared/contracts/ipc-channels';
import { AnalyticsEngine } from '../analytics/AnalyticsEngine';
import { validateAutoBugOptions, validateOptionalIdentifier } from './inputValidation';
import { assertTrustedIpcSender } from './trustedSender';

export function registerAnalyticsIpcHandlers(ipcMain: IpcMain, mainWindow: BrowserWindow): void {
  const safeHandle = (channel: string, handler: (...args: unknown[]) => unknown) => {
    try { ipcMain.removeHandler(channel); } catch {}
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        assertTrustedIpcSender(event, mainWindow);
        return await handler(event, ...args);
      } catch (error) {
        console.error(`[MARS IPC ERROR] Channel '${channel}' rejected or failed:`, error);
        throw error;
      }
    });
  };

  safeHandle(
    IPC_INVOKE_CHANNELS.GET_DECISION_REPLAY,
    (_event, tradeId?: unknown, sessionId?: unknown) =>
      AnalyticsEngine.getInstance().getDecisionReplay(
        validateOptionalIdentifier(tradeId, 'tradeId'),
        validateOptionalIdentifier(sessionId, 'sessionId'),
      ),
  );

  safeHandle(
    IPC_INVOKE_CHANNELS.RUN_AUTO_BUG_DETECTOR,
    (_event, options?: unknown) =>
      AnalyticsEngine.getInstance().runAutoBugDetector(validateAutoBugOptions(options)),
  );
}
