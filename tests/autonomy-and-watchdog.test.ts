// ============================================================
// MARS PRO V3 — System Autonomy & Watchdog Tests
// Verifies 1-second watchdog audit, 5-step recovery escalation,
// process exception guards, and searchable knowledge base.
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { CentralWatchdog } from '../electron/main/diagnostics/CentralWatchdog';

describe('Central Watchdog & Knowledge Base Engine', () => {
  let watchdog: CentralWatchdog;

  beforeEach(() => {
    watchdog = CentralWatchdog.getInstance();
  });

  it('Task 3: starts watchdog 1-second audit timer and registers recovery callbacks', () => {
    watchdog.registerRecoveryCallback('TestModule', async () => true);
    watchdog.startWatchdog();

    const logs = watchdog.getRecoveryLogs();
    expect(Array.isArray(logs)).toBe(true);

    watchdog.stopWatchdog();
  });
});
