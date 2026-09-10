import { useEffect, useRef } from 'react';
import { IpcChannel, IpcInvokeChannel } from '../../../shared/contracts/ipc-channels';

/**
 * Hook to listen for IPC messages from the main process.
 */
export function useIpcListener<T extends (...args: any[]) => void>(
  channel: IpcChannel,
  callback: T,
  _dependencies: any[] = []
) {
  const callbackRef = useRef<T>(callback);

  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    if (!window.marsApi) return;

    const handler = (...args: any[]) => {
      if (callbackRef.current) {
        callbackRef.current(...args);
      }
    };

    const removeListener = window.marsApi.on(channel, handler);

    return () => {
      if (typeof removeListener === 'function') {
        removeListener();
      } else if (window.marsApi.removeListener) {
        window.marsApi.removeListener(channel, handler);
      }
    };
  }, [channel]);
}

/**
 * Utility to invoke IPC commands.
 * A hung Electron handler must not leave a button, spinner, or route stuck forever.
 */
const IPC_TIMEOUT_MS = 12_000;

export function invokeIpc<T = any>(
  channel: IpcInvokeChannel,
  ...args: any[]
): Promise<T> {
  if (!window.marsApi) {
    return Promise.reject(new Error('marsApi not available'));
  }
  const request = window.marsApi.invoke(channel, ...args);
  const timeout = new Promise<never>((_, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`IPC request timed out: ${channel}`));
    }, IPC_TIMEOUT_MS);
    request.finally(() => window.clearTimeout(timer)).catch(() => undefined);
  });
  return Promise.race([request, timeout]);
}
