import { IpcMain } from 'electron';
import { IPC_INVOKE_CHANNELS } from '../../../shared/contracts/ipc-channels';
import { AnalyticsEngine } from '../analytics/AnalyticsEngine';

/**
 * Register analytics-specific request handlers that are intentionally kept
 * separate from the primary workstation handler collection.
 */
export function registerAnalyticsIpcHandlers(ipcMain: IpcMain): void {
  const safeHandle = (channel: string, handler: (...args: unknown[]) => unknown) => {
    try {
      ipcMain.removeHandler(channel);
    } catch {}

    ipcMain.handle(channel, async (event, ...args) => {
      try {
        return await handler(event, ...args);
      } catch (error) {
        console.error(`[MARS IPC ERROR] Channel '${channel}' failed:`, error);
        throw error;
      }
    });
  };

  safeHandle(
    IPC_INVOKE_CHANNELS.GET_DECISION_REPLAY,
    (_event, tradeId?: unknown, sessionId?: unknown) =>
      AnalyticsEngine.getInstance().getDecisionReplay(
        typeof tradeId === 'string' && tradeId.trim() ? tradeId : undefined,
        typeof sessionId === 'string' && sessionId.trim() ? sessionId : undefined,
      ),
  );

  safeHandle(
    IPC_INVOKE_CHANNELS.RUN_AUTO_BUG_DETECTOR,
    (_event, options?: unknown) => {
      const normalizedOptions =
        typeof options === 'string'
          ? options
          : options && typeof options === 'object'
            ? options as { minTradeCount?: number; minWinRate?: number }
            : undefined;
      return AnalyticsEngine.getInstance().runAutoBugDetector(normalizedOptions);
    },
  );
}
