      ? this.decisionEngine.getEvidenceEngine().evaluate(observation)
      : null;
    const agreement = liveEvidence?.agreementScore ?? null;
    if (agreement !== null && agreement < 0.35) score -= 15;
    else if (agreement === null) score -= 5;""", 'real agreement')
    old = """  public generateTradeExplanation(stabilized: any, observation?: any): TradeExplanation {
    return {
      trend: observation?.trendEvidence?.direction || 'NEUTRAL',
      momentum: observation?.momentumEvidence?.level || 'MODERATE',
      structure: observation?.structureEvidence?.structure || 'INSUFFICIENT_DATA',
      risk: stabilized.risk,
      support: observation?.supportLevel ? `${observation.supportLevel.distancePts} PTS BELOW` : 'UNKNOWN',
      resistance: observation?.resistanceLevel ? `${observation.resistanceLevel.distancePts} PTS ABOVE` : 'UNKNOWN',
    };
  }"""
    new = """  public generateTradeExplanation(stabilized: any, observation?: any): TradeExplanation {
    const sr = observation?.supportResistanceEvidence;
    const visual = (level: any, side: string): string =>
      level ? `${level.interactionState || 'DETECTED'} • VISUAL ${side}` : 'UNAVAILABLE';
    return {
      trend: observation?.trendEvidence?.direction || 'UNAVAILABLE',
      momentum: observation?.momentumEvidence?.level || 'UNAVAILABLE',
      structure: observation?.structureEvidence?.structure || 'INSUFFICIENT_DATA',
      risk: stabilized?.risk || 'UNASSESSED',
      support: visual(sr?.nearestSupport, 'BELOW'),
      resistance: visual(sr?.nearestResistance, 'ABOVE'),
    };
  }"""
    s = once(s, old, new, 'honest explanation')
    s = once(s, '      const health = this.evaluateTradeHealth({ action: activeTrade.direction }, observation);', '      const health = this.currentTradeHealth;', 'active health once')
    s = rx(s, r"    const health = this\.evaluateTradeHealth\(\n      this\.lastOverlayState\?\.decision \? \{ action: this\.lastOverlayState\.decision \} : \{ action: this\.activeSignal\.action \},\n      observation\n    \);", '    const health = this.currentTradeHealth;', 'entry health once')
    s = rx(s, r"  private getLatestObservedPrice\(observation\?: any\): number \| null \{.*?\n  \}", """  private getLatestObservedPrice(observation?: any): number | null {
    const observedAt = typeof observation?.timestamp === 'number' ? observation.timestamp : 0;
    if (!observedAt || Date.now() - observedAt > 5000 || observedAt - Date.now() > 1000) return null;
    const candidate = observation?.currentPrice;
    const numeric = typeof candidate === 'number' ? candidate : Number(String(candidate || '').replace(/,/g, ''));
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
  }""", 'fresh observed price')
    old_context = """      asset: observation?.asset || this.lastOverlayState?.asset || null,
      timeframe: observation?.timeframe || this.lastOverlayState?.timeframe || null,
      currentPrice: typeof observation?.currentPrice === 'number'
        ? String(observation.currentPrice)
        : this.lastOverlayState?.currentPrice || null,"""
    new_context = """      asset: observation?.asset || activeTrade?.asset || null,
      timeframe: observation?.timeframe || activeTrade?.timeframe || null,
      currentPrice: typeof observation?.currentPrice === 'number'
        && Number.isFinite(observation.currentPrice) && observation.currentPrice > 0
        ? String(observation.currentPrice)
        : null,"""
    s = once(s, old_context, new_context, 'clear degraded context')
    s = once(s, "      timeframe: observation?.timeframe || '1m',", '      timeframe: observation?.timeframe || null,', 'generated timeframe')
    s = once(s, "      : (nodeInfo.asset || nodeInfo.assetName || this.lastOverlayState?.asset || null);", "      : ((event as any).asset || nodeInfo.asset || nodeInfo.assetName || null);", 'click asset')
    s = once(s, """    const priceCandidates = [
      this.getLatestObservedPrice(this.lastObservationWithFeatures),
      nodeInfo.entryPrice,
      nodeInfo.price,
      this.lastOverlayState?.currentPrice,
    ];""", """    const priceCandidates = [
      (event as any).entryPrice,
      nodeInfo.entryPrice,
      nodeInfo.price,
      this.getLatestObservedPrice(this.lastObservationWithFeatures),
    ];""", 'click price')
    return once(s, "      timeframe: this.lastObservationWithFeatures?.timeframe || '1m',", '      timeframe: this.lastObservationWithFeatures?.timeframe || null,', 'manual timeframe')
edit('electron/main/lifecycle/AnalysisController.ts', controller)

# Explicitly clear quote and indicative P&L instead of preserving frozen values.
def overlay(s):
    s = once(s, '    if (!snapshot || Date.now() - snapshot.observedAt > 5000) return;', """    if (!snapshot) return;
    if (Date.now() - snapshot.observedAt > 5000) {
      const priorMonitor = this.latestPayload?.tradeMonitor;
      const stalePatch: Record<string, any> = { currentPrice: null, lastUpdate: snapshot.observedAt };
      if (priorMonitor) stalePatch.tradeMonitor = {
        ...priorMonitor, currentPrice: null, pnlPoints: null, pnlPct: null,
        health: 'QUOTE UNAVAILABLE', healthReason: 'Live quote is stale; indicative P&L is paused.',
      };
      this.latestPayload = { ...(this.latestPayload || {}), ...stalePatch };
      this.sendPayload(stalePatch);
      return;
    }""", 'stale quote clear')
    old_patch = """    const patch: Record<string, any> = {
      lastUpdate: snapshot.observedAt,
      platformMode: snapshot.platformMode,
    };
    if (snapshot.asset) patch.asset = snapshot.asset;
    if (snapshot.timeframe) patch.timeframe = snapshot.timeframe;
    if (nextPrice !== null) patch.currentPrice = nextPrice;"""
    new_patch = """    const patch: Record<string, any> = {
      lastUpdate: snapshot.observedAt,
      platformMode: snapshot.platformMode,
