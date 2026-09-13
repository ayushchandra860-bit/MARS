# MARS PRO V3

MARS PRO V3 is an experimental Windows market-analysis workstation for Olymp Trade. It captures the embedded chart, derives technical evidence, presents BUY/SELL/WAIT guidance, and records manually executed trades for review and model calibration.

> **Research status:** MARS has not demonstrated a reliable live-money edge. Confidence values are decision-support scores unless separately validated on clean, forward-tested data. Fixed-time trading can lose the entire stake and no software can guarantee profit.

## Core product contract

MARS is a **manual-trading decision-support system**, not an auto-trader or prediction guarantee. BUY, SELL, and WAIT are all valid outputs. WAIT is intentional when data is stale, incomplete, conflicting, low quality, or missing quote/timeframe context. Uncalibrated confidence is evidence strength, not win probability. See [docs/PRODUCT-PRINCIPLES.md](docs/PRODUCT-PRINCIPLES.md).

## Safety boundary

- MARS does not place trades automatically.
- It does not connect to an unofficial Olymp Trade trading API.
- Trade execution remains manual.
- Paper/demo validation should be completed before considering real-money use.
- Never use martingale staking.

## Download the Windows app

After the build workflow is merged into `main`:

1. Open the repository's **Actions** tab.
2. Select the latest successful **Windows Installer** run.
3. Download `MARS-PRO-V3-Windows-<run number>` from **Artifacts**.
4. Extract the ZIP and run either the installer EXE or portable EXE.
5. Verify the file using the included `SHA256SUMS.txt`.

Tagged builds are published on the repository's **Releases** page. Development builds are currently unsigned, so Windows SmartScreen may show an unknown-publisher warning.

Detailed instructions: [`docs/BUILDING-WINDOWS.md`](docs/BUILDING-WINDOWS.md)

## Development

Requirements: Node.js 22 LTS and npm 10+.

```powershell
npm ci
npm run dev
```

## Test and build

```powershell
npm run test
npm run typecheck
npm run build
npm run package
```

`npm run package` runs tests once, performs strict Electron and frontend typechecking, creates a clean build, verifies required artifacts, and then produces Windows x64 NSIS and portable executables in `release/`.

## Architecture

| Path | Purpose |
|---|---|
| `electron/main/lifecycle/AnalysisController.ts` | Coordinates scan, feature, decision, stabilization, and lifecycle stages |
| `electron/main/decision/DecisionEngine.ts` | Deterministic technical decision engine |
| `electron/main/decision/MLEngine.ts` | Lightweight logistic-regression component |
| `electron/main/scanner/` | Screen capture, OCR, and candle acquisition |
| `electron/main/trade/` | Manual trade observation and lifecycle tracking |
| `electron/main/database/` | Local sql.js persistence |
| `frontend/src/control-center/` | Settings, analytics, diagnostics, and journal UI |
| `frontend/src/overlay/` | Floating signal overlay |
| `shared/` | Shared types and IPC contracts |
| `tests/` | Vitest unit and integration tests |

## Current hardening priorities

1. Enforce market-price versus pixel-coordinate unit safety.
2. Correlate platform results with exact trades rather than timing heuristics.
3. Preserve demo/live provenance through storage and calibration.
4. Serialize and atomically persist database snapshots.
5. Apply strict renderer-origin, IPC-sender, and runtime input validation.
6. Validate signal probability and expected value using forward paper trades.

## Disclaimer

MARS is experimental analytical software, not financial advice or a promise of profit. Use only funds you can afford to lose and check the applicable broker terms and regulations in your jurisdiction.
