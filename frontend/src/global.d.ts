import { IpcChannel, IpcInvokeChannel } from '../../shared/contracts/ipc-channels';

declare global {
  interface Window {
    marsApi: {
      on(channel: IpcChannel | string, func: (...args: any[]) => void): () => void;
      once(channel: IpcChannel | string, func: (...args: any[]) => void): void;
      removeListener(channel: IpcChannel | string, func: (...args: any[]) => void): void;
      invoke(channel: IpcInvokeChannel | string, ...args: any[]): Promise<any>;
      send?(channel: string, ...args: any[]): void;
    };
    electronAPI?: {
      onSignalUpdate(callback: (data: any) => void): () => void;
    };
  }
}

export {};
