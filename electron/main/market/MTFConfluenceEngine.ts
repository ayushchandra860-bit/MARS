import { OHLC } from './QuantitativeEngine';

export class MTFConfluenceEngine {
  public static evaluateMTF(candles500: OHLC[]): { mtfScore: number; bullishConfluence: number; bearishConfluence: number; alignedTimeframes: string[] } {
    let mtfScore = 0;
    let bullishConfluence = 0;
    let bearishConfluence = 0;
    const alignedTimeframes: string[] = [];

    if (!candles500 || candles500.length === 0) {
      return { mtfScore: 50, bullishConfluence: 0, bearishConfluence: 0, alignedTimeframes: [] };
    }

    // Evaluate 1m, 2m, 3m, 4m, 5m candle trend alignments
    const timeframes = [1, 2, 3, 4, 5];
    for (const tf of timeframes) {
      const step = Math.max(1, tf);
      const resampled: OHLC[] = [];
      for (let i = 0; i < candles500.length; i += step) {
        const slice = candles500.slice(i, i + step);
        if (slice.length > 0) {
          const open = slice[0].open;
          const close = slice[slice.length - 1].close;
          const high = Math.max(...slice.map(s => s.high));
          const low = Math.min(...slice.map(s => s.low));
          resampled.push({ open, high, low, close });
        }
      }

      if (resampled.length >= 2) {
        const last = resampled[resampled.length - 1];
        const prev = resampled[resampled.length - 2];
        if (last.close > prev.close && last.close > last.open) {
          bullishConfluence += 20;
          alignedTimeframes.push(`${tf}m BULLISH`);
        } else if (last.close < prev.close && last.close < last.open) {
          bearishConfluence += 20;
          alignedTimeframes.push(`${tf}m BEARISH`);
        }
      }
    }

    mtfScore = Math.max(bullishConfluence, bearishConfluence);
    return {
      mtfScore,
      bullishConfluence,
      bearishConfluence,
      alignedTimeframes,
    };
  }
}
