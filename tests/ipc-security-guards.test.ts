import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { assertTrustedIpcSender } from '../electron/main/ipc/trustedSender';
import { validateDisplayId, validateKnowledgeQuery, validateSavedFramePath } from '../electron/main/ipc/domainValidation';

function trustedMocks() {
  const topFrame = { routingId: 1 };
  const webContents = { id: 7, isDestroyed: () => false, mainFrame: topFrame };
  const mainWindow = { isDestroyed: () => false, webContents };
  const event = { sender: webContents, senderFrame: topFrame };
  return { topFrame, webContents, mainWindow, event } as any;
}

describe('trusted privileged IPC sender guard', () => {
  it('accepts only the configured main-window top frame', () => {
    const { mainWindow, event } = trustedMocks();
    expect(() => assertTrustedIpcSender(event, mainWindow)).not.toThrow();
  });
  it('rejects a different renderer process', () => {
    const { mainWindow, event } = trustedMocks();
    event.sender = { ...event.sender, id: 8 };
    expect(() => assertTrustedIpcSender(event, mainWindow)).toThrow(/Unauthorized IPC sender/);
  });
  it('rejects an iframe even inside the trusted renderer', () => {
    const { mainWindow, event } = trustedMocks();
    event.senderFrame = { routingId: 2 };
    expect(() => assertTrustedIpcSender(event, mainWindow)).toThrow(/top-level frame/);
  });
  it('rejects destroyed or unavailable privileged windows', () => {
    const { mainWindow, event } = trustedMocks();
    mainWindow.isDestroyed = () => true;
    expect(() => assertTrustedIpcSender(event, mainWindow)).toThrow(/unavailable/);
  });
});

describe('domain-specific IPC validation', () => {
  it('allows only bounded knowledge filters', () => {
    expect(validateKnowledgeQuery({ asset: 'EUR/USD', regime: 'TRENDING', outcome: 'win', minConfidence: 0.7, limit: 25 }))
      .toEqual({ asset: 'EUR/USD', regime: 'TRENDING', outcome: 'WIN', minConfidence: 0.7, limit: 25 });
    expect(() => validateKnowledgeQuery({ sql: 'DROP TABLE trades' })).toThrow(/unknown knowledge filter/);
    expect(() => validateKnowledgeQuery({ outcome: 'PROFIT' })).toThrow(/unsupported knowledge outcome/);
    expect(() => validateKnowledgeQuery({ minConfidence: 101 })).toThrow(/outside the allowed range/);
  });

  it('contains replay files inside diagnostics and accepts image extensions only', () => {
    const root = path.resolve('tests', 'diagnostics');
    const approved = path.join(root, 'nested', 'frame.PNG');
    expect(validateSavedFramePath(approved, root)).toBe(path.resolve(approved));
    expect(() => validateSavedFramePath(path.join(root, '..', 'secret.png'), root)).toThrow(/inside the MARS diagnostics/);
    expect(() => validateSavedFramePath(path.join(root, 'payload.json'), root)).toThrow(/extension is unsupported/);
    expect(() => validateSavedFramePath(root, root)).toThrow(/inside the MARS diagnostics/);
  });

  it('accepts only currently available display IDs', () => {
    expect(validateDisplayId('display-2', ['display-1', 'display-2'])).toBe('display-2');
    expect(() => validateDisplayId('display-3', ['display-1', 'display-2'])).toThrow(/not currently available/);
  });
});
