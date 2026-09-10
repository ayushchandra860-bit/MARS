# MARS Ecosystem Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use inline execution in this session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make MARS behave like one trading ecosystem: signal creation, user trade click, result, journal, analytics, and calibration all use the same linked data.

**Architecture:** Confirmed BUY/SELL signals are recorded once in `signal_history`. Trades are recorded only when the user actually clicks BUY/SELL, and are linked to the active signal if valid. Journal, analytics, and calibration read the same clean completed-trade dataset and exclude unresolved/no-price/manual garbage.

**Tech Stack:** Electron main process, React overlay/control center, sql.js database, TypeScript, Vitest.

## Global Constraints

- Do not guarantee market profit or 90% real-world accuracy; implement stricter validation and honest calibration.
- Never auto-create a trade just because a signal appears.
- Calibration can use only completed, priced, linked, decisive trades.
- WAIT state must not look like actionable BUY/SELL confidence.
- Installer must be rebuilt after code verification.

---

### Task 1: Data-flow regression tests

**Files:**
- Create/modify: `tests/mars-ecosystem-unification.test.ts`

**Interfaces:**
- Consumes: `TradeRepository`, `SignalHistoryRepository`, `AnalyticsEngine`, `CalibrationDatasetManager`
- Produces: tests proving signal/trade linking and clean analytics rules

- [ ] Write tests for: signal without trade, clicked trade linked to signal, unlinked/no-price trades excluded, analytics sees same clean dataset.
- [ ] Run tests and confirm they fail before implementation.

### Task 2: Signal/trade lifecycle cleanup

**Files:**
- Modify: `electron/main/lifecycle/AnalysisController.ts`
- Modify: `electron/main/view/EmbeddedBrowserManager.ts`

**Interfaces:**
- Confirmed signal: saved to `signal_history`
- User click: creates trade with current asset, entry price, expiry, signal id

- [ ] Remove auto-trade creation from signal/audio path.
- [ ] Ensure browser click always goes through `AnalysisController` when available.
- [ ] Block fallback arrow-asset trades from polluting calibration.

### Task 3: Shared clean dataset

**Files:**
- Modify: `electron/main/brain/CalibrationDatasetManager.ts`
- Modify: `electron/main/analytics/AnalyticsEngine.ts`
- Modify: `electron/main/ipc/handlers.ts`

**Interfaces:**
- `getCalibrationObservations()` returns clean linked completed trades.
- Analytics initializes DB before reports.

- [ ] Add strict clean-trade filter.
- [ ] Make runtime validation report only actionable corruption, not expected active trades.
- [ ] Initialize AnalyticsEngine with DB.

### Task 4: Overlay clarity and live confidence

**Files:**
- Modify: `frontend/src/overlay/SignalPanel.tsx`
- Modify: `electron/main/lifecycle/AnalysisController.ts`

**Interfaces:**
- WAIT shows setup/market score, not trade confidence.
- BUY/SELL shows signal confidence.

- [ ] Keep WAIT visually non-actionable.
- [ ] Pin active linked trade context until expiry.
- [ ] Show smooth second-level status updates.

### Task 5: Verification and package

**Files:**
- Package output: `release/MARS PRO V3 Setup 3.0.0.exe`

- [ ] Run targeted tests.
- [ ] Run typecheck.
- [ ] Run package.
- [ ] Verify installer timestamp.
