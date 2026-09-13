      currentPrice: nextPrice,
    };
    if (snapshot.asset) patch.asset = snapshot.asset;
    if (snapshot.timeframe) patch.timeframe = snapshot.timeframe;"""
    s = once(s, old_patch, new_patch, 'nullable quote patch')
    marker = """      };
    }

    const quoteKey = [patch.asset || this.latestPayload?.asset || '', patch.currentPrice || this.latestPayload?.currentPrice || '', patch.timeframe || '', patch.platformMode || ''].join('|');"""
    replacement = """      };
    } else if (priorMonitor) {
      patch.tradeMonitor = {
        ...priorMonitor, currentPrice: null, pnlPoints: null, pnlPct: null,
        health: 'QUOTE UNAVAILABLE', healthReason: 'Live quote unavailable; indicative P&L is paused.',
      };
    }

    const quoteKey = [patch.asset || this.latestPayload?.asset || '', patch.currentPrice ?? '', patch.timeframe || '', patch.platformMode || ''].join('|');"""
    s = once(s, marker, replacement, 'monitor quote clear')
    s = once(s, '    const unified = {\n      ...state,', "    const hasLivePrice = !!livePayload && Object.prototype.hasOwnProperty.call(livePayload, 'currentPrice');\n    const unified = {\n      ...state,", 'explicit live price')
    s = once(s, '      currentPrice: livePayload?.currentPrice ?? state.currentPrice ?? null,', '      currentPrice: hasLivePrice ? livePayload.currentPrice : state.currentPrice ?? null,', 'keep explicit null')
    return once(s, '      lastUpdate: Date.now(),', '      lastUpdate: state.lastUpdate ?? livePayload?.lastUpdate ?? Date.now(),', 'source timestamp')
edit('electron/main/overlay/OverlayManager.ts', overlay)

# Honest UI language and no fabricated defaults.
def panel(s):
    s = once(s, "(state?.recommendedExpiry || anyState.expiry || '1 min')", "(state?.recommendedExpiry || anyState.expiry || '\\u2014')", 'expiry UI')
    s = once(s, "(state?.risk || anyState.riskLevel || 'LOW')", "(state?.risk || anyState.riskLevel || 'UNASSESSED')", 'risk UI')
    s = once(s, "{actionText === 'WAIT' ? 'WAIT SCORE' : 'CONFIDENCE'}", "{actionText === 'WAIT' ? 'WAIT STRENGTH' : calibrationActive ? 'CALIBRATED EST.' : 'EVIDENCE CONF.'}", 'confidence UI')
    s = once(s, ": calibrationActive ? 'JOURNAL-BASED WIN PROB' : 'Trade Probability'}", ": calibrationActive ? 'JOURNAL-BASED; NOT GUARANTEED' : 'NOT A WIN PROBABILITY'}", 'probability UI')
    s = once(s, '>WAIT SCORE</span>', '>WAIT STRENGTH</span>', 'wait UI')
    s = once(s, '>RISK</div>', '>SETUP RISK</div>', 'setup risk UI')
    return once(s, '>WIN PROB</div>', '>ENTRY SCORE</div>', 'entry score UI')
edit('frontend/src/overlay/SignalPanel.tsx', panel)

# Version, documentation, focused regression contract.
pkgp = R/'package.json'; pkg=json.loads(pkgp.read_text()); pkg['version']='3.0.1-rc.5'; pkgp.write_text(json.dumps(pkg,indent=2)+'\n')
lockp=R/'package-lock.json'; lock=json.loads(lockp.read_text()); lock['version']='3.0.1-rc.5'; lock['packages']['']['version']='3.0.1-rc.5'; lockp.write_text(json.dumps(lock,indent=2)+'\n')
edit('.github/workflows/windows-installer.yml', lambda s: once(s,'default: v3.0.1-rc.4','default: v3.0.1-rc.5','installer version'))
edit('tests/rc3-final-performance-contract.test.ts', lambda s: s.replace("3.0.1-rc.4","3.0.1-rc.5"))

readme=R/'README.md'; t=readme.read_text()
if '## Core product contract' not in t:
    t=t.replace('## Safety boundary\n', '## Core product contract\n\nMARS is a **manual-trading decision-support system**, not an auto-trader or prediction guarantee. BUY, SELL, and WAIT are all valid outputs. WAIT is intentional when data is stale, incomplete, conflicting, low quality, or missing quote/timeframe context. Uncalibrated confidence is evidence strength, not win probability. See [docs/PRODUCT-PRINCIPLES.md](docs/PRODUCT-PRINCIPLES.md).\n\n## Safety boundary\n')
readme.write_text(t)
(R/'docs/PRODUCT-PRINCIPLES.md').write_text('''# MARS PRO V3 Product Principles

MARS is manual trading decision support, not an auto-trader or prediction guarantee.

- BUY, SELL, and WAIT are valid outputs; unsafe or unclear context must immediately return WAIT.
- Actionable signals require fresh data, a valid asset, positive quote, supported timeframe, and usable chart/candle quality.
- Evidence confidence is not win probability. Setup risk is uncertainty, not promised profit/loss.
- Market context must combine trend, momentum, structure, volatility, support/resistance, candles, regime, timeframe, and quality; indicator voting alone cannot force a trade.
- Missing/stale quotes must clear price and indicative P&L instead of leaving frozen values.
- Placed-trade lifecycle, setup health, and indicative P&L are separate.
- All executions remain auditable; only verified clean LIVE outcomes with complete finite features may train the LIVE model.
- Release automation cannot guarantee profitability. Production-ready claims require a logged-in user-device DEMO end-to-end test.
''')
(R/'tests/decision-support-safety.test.ts').write_text('''import { describe, expect, it } from 'vitest';
import { DataQualityGate } from '../electron/main/market/DataQualityGate';
import { SignalStabilizer } from '../electron/main/decision/SignalStabilizer';
import { PlatformMode, QualityGateRejection } from '../shared/types/canonical';
import { MarketBias } from '../shared/types/market';
import { CandleDirection, QualityLevel } from '../shared/types/scanner';
import { RiskLevel, TradingAction } from '../shared/types/decision';

const observation=(x:any={}):any=>({observationId:'safe',sessionId:'s',frameId:'f',timestamp:Date.now(),platformMode:PlatformMode.LIVE,captureQuality:QualityLevel.HIGH,chartQuality:QualityLevel.HIGH,candleQuality:QualityLevel.HIGH,dataQuality:QualityLevel.HIGH,candles:Array.from({length:4},(_,i)=>({xPx:i*10,wickTopPx:1,bodyTopPx:3,bodyBottomPx:7,wickBottomPx:9,direction:CandleDirection.BULLISH,bodySizePx:4,rangePx:8,quality:.9})),asset:'EUR/USD',timeframe:'1m',currentPrice:1.1,...x});
const raw=(action:TradingAction):any=>({action,reason:String(action),reasons:[String(action)],signalStrength:action===TradingAction.WAIT?.2:.95,confidence:action===TradingAction.WAIT?null:.9,risk:action===TradingAction.WAIT?RiskLevel.HIGH:RiskLevel.LOW,marketBias:action===TradingAction.BUY?MarketBias.BULLISH:MarketBias.NEUTRAL,recommendedExpiry:action===TradingAction.WAIT?null:'1 min',dataQuality:QualityLevel.HIGH,timestamp:Date.now()});

describe('decision-support safety',()=>{
 it('blocks stale, missing timeframe, missing quote and low quality',()=>{const g=new DataQualityGate();expect(g.evaluate(observation({timestamp:Date.now()-6000})).rejection).toBe(QualityGateRejection.STALE_DATA);expect(g.evaluate(observation({timeframe:null})).rejection).toBe(QualityGateRejection.INVALID_TIMEFRAME);expect(g.evaluate(observation({currentPrice:null})).rejection).toBe(QualityGateRejection.INVALID_PRICE);expect(g.evaluate(observation({dataQuality:QualityLevel.LOW})).passed).toBe(false);});
 it('immediately replaces BUY with WAIT',()=>{const s=new SignalStabilizer();expect(s.stabilize(raw(TradingAction.BUY)).action).toBe(TradingAction.BUY);expect(s.stabilize(raw(TradingAction.WAIT))).toMatchObject({action:TradingAction.WAIT,wasStabilized:false});});
});
''')

gitignore=R/'.gitignore'; gi=gitignore.read_text();
if '*.db.bak' not in gi: gitignore.write_text(gi.replace('*.db-wal\n','*.db-wal\n*.db.bak\n'))
for p in (R/'tests').glob('*.db.bak'): p.unlink()
print('RC5 text patch applied')
