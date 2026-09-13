from pathlib import Path
import json, re
R = Path.cwd()

def edit(path, fn):
    p = R / path
    p.write_text(fn(p.read_text(encoding='utf-8')), encoding='utf-8')

def once(s, old, new, label):
    if old not in s: raise RuntimeError(f'{label}: marker not found')
    return s.replace(old, new, 1)

def rx(s, pattern, repl, label, flags=re.S):
    out, n = re.subn(pattern, repl, s, count=1, flags=flags)
    if n != 1: raise RuntimeError(f'{label}: expected 1 regex match, found {n}')
    return out

# Decision engine: fail closed even if its caller bypasses DataQualityGate.
def decision(s):
    if "import { DataQualityGate }" not in s:
        s = once(s, "import { MarketRegimeAnalyzer } from '../market/MarketRegimeAnalyzer';", "import { MarketRegimeAnalyzer } from '../market/MarketRegimeAnalyzer';\nimport { DataQualityGate } from '../market/DataQualityGate';", 'quality gate import')
    marker = "    const trend = obs.trendEvidence?.direction || TrendDirection.NEUTRAL;"
    guard = """    const freshness = obs.freshness ?? computeFreshness(obs.timestamp);
    if (freshness !== DataFreshness.FRESH) {
      return this.wait(WaitReason.DATA_STALE, 0, null, RiskLevel.HIGH, MarketBias.NEUTRAL,
        null, obs.dataQuality, timestamp, obs.observationId);
    }
    if (!DataQualityGate.isSupportedTimeframe(obs.timeframe)) {
      return this.wait(WaitReason.TIMEFRAME_UNAVAILABLE, 0, null, RiskLevel.HIGH, MarketBias.NEUTRAL,
        null, obs.dataQuality, timestamp, obs.observationId);
    }
    if (typeof obs.currentPrice !== 'number' || !Number.isFinite(obs.currentPrice) || obs.currentPrice <= 0) {
      return this.wait(WaitReason.PRICE_UNAVAILABLE, 0, null, RiskLevel.HIGH, MarketBias.NEUTRAL,
        null, obs.dataQuality, timestamp, obs.observationId);
    }
    if (obs.dataQuality === QualityLevel.LOW || obs.dataQuality === QualityLevel.FAILED) {
      return this.wait(WaitReason.DATA_NOT_READY, 0, null, RiskLevel.HIGH, MarketBias.NEUTRAL,
        null, obs.dataQuality, timestamp, obs.observationId);
    }

""" + marker
    if 'WaitReason.TIMEFRAME_UNAVAILABLE, 0' not in s:
        s = once(s, marker, guard, 'decision safety guards')
    return s
edit('electron/main/decision/DecisionEngine.ts', decision)

# WAIT immediately clears an old actionable signal. BUY/SELL still use confirmation.
def stabilizer(s):
    s = once(s, '        confidence: 0,\n        risk: RiskLevel.LOW,', '        confidence: null,\n        risk: null,', 'fallback confidence/risk')
    s = once(s, "        recommendedExpiry: '1 min',", '        recommendedExpiry: null,', 'fallback expiry')
    marker = '    // Very high strength signals bypass hysteresis\n'
    block = """    // WAIT is a first-class safety decision and is never delayed.
    if (String(raw.action) === TradingAction.WAIT) {
      if (this.lastAction !== TradingAction.WAIT) this.lastTransitionTimestamp = now;
      this.lastAction = TradingAction.WAIT;
      this.pendingAction = TradingAction.WAIT;
      this.pendingCount = 0;
      this.lastStableDecision = raw;
      this.lastConfirmedAction = TradingAction.WAIT;
      this.lastConfirmedTimestamp = 0;
      this.confirmedSignalTimestamp = 0;
      this.currentLifecycle = SignalLifecycle.WATCHING;
      return { ...raw, reasons, wasStabilized: false, frameConsistency: this.getFrameConsistency() };
    }

    // Very high strength directional signals bypass hysteresis
"""
    return once(s, marker, block, 'immediate WAIT')
edit('electron/main/decision/SignalStabilizer.ts', stabilizer)

# Use direction-aware visual candle close for support/resistance risk.
def risk(s):
    s = once(s, "import { QualityLevel } from '../../../shared/types/scanner';", "import { CandleDirection, QualityLevel } from '../../../shared/types/scanner';", 'risk import')
    return rx(s, r"      const \{ nearestSupport, nearestResistance \} = observation\.supportResistanceEvidence;\n      const currentPricePx = observation\.candles && observation\.candles\.length > 0\n        \? observation\.candles\[observation\.candles\.length - 1\]\.bodyBottomPx\n        : null;", """      const { nearestSupport, nearestResistance } = observation.supportResistanceEvidence;
      const latestCandle = observation.candles.at(-1) || null;
      const currentPricePx = latestCandle
        ? latestCandle.direction === CandleDirection.BULLISH
          ? Math.min(latestCandle.bodyTopPx, latestCandle.bodyBottomPx)
          : latestCandle.direction === CandleDirection.BEARISH
            ? Math.max(latestCandle.bodyTopPx, latestCandle.bodyBottomPx)
            : (latestCandle.bodyTopPx + latestCandle.bodyBottomPx) / 2
        : null;""", 'direction-aware close')
edit('electron/main/decision/RiskEngine.ts', risk)

edit('shared/types/ipc.ts', lambda s: once(once(s, '  originalConfidence: number;', '  originalConfidence: CanonicalConfidence;', 'nullable confidence'), "    health: 'IN PROFIT' | 'AT ENTRY' | 'AGAINST' | 'NO TRADE';", "    health: 'IN PROFIT' | 'AT ENTRY' | 'AGAINST' | 'QUOTE UNAVAILABLE' | 'NO TRADE';", 'quote health'))
edit('electron/main/trade/TradeLifecycleManager.ts', lambda s: once(s, '    timeframe?: string;', '    timeframe?: string | null;', 'nullable trade timeframe'))

# Correct active-trade health, explanations, and stale execution context.
def controller(s):
    s = rx(s, r"    // 5\. Evidence agreement \(-15 if agreementScore < 0\.35\)\n    const agreement = observation\?\.evidenceBreakdown\?\.agreementScore \?\? 0\.0;\n    if \(agreement < 0\.35\) \{\n      score -= 15;\n    \}", """    const liveEvidence = observation
