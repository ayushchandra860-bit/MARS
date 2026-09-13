import { describe, expect, it } from 'vitest';
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
