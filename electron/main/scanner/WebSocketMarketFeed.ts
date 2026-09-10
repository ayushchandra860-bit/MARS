import { OHLC } from '../market/QuantitativeEngine';

export class WebSocketMarketFeed {
    private static instance: WebSocketMarketFeed;
    private candleBuffers: Map<string, OHLC[]> = new Map();
    private lastUpdated: Map<string, number> = new Map();
    private readonly MAX_CANDLES = 100;

    private constructor() {}

    public static getInstance(): WebSocketMarketFeed {
        if (!WebSocketMarketFeed.instance) {
            WebSocketMarketFeed.instance = new WebSocketMarketFeed();
        }
        return WebSocketMarketFeed.instance;
    }

    public pushCandle(asset: string, candle: OHLC): void {
        let buffer = this.candleBuffers.get(asset);
        if (!buffer) {
            buffer = [];
            this.candleBuffers.set(asset, buffer);
        }
        buffer.push(candle);
        if (buffer.length > this.MAX_CANDLES) {
            this.candleBuffers.set(asset, buffer.slice(buffer.length - this.MAX_CANDLES));
        }
        this.lastUpdated.set(asset, Date.now());
    }

    public pushHistoricalCandles(asset: string, candles: OHLC[]): void {
        let buffer = this.candleBuffers.get(asset) || [];
        buffer = buffer.concat(candles);
        if (buffer.length > this.MAX_CANDLES) {
            buffer = buffer.slice(buffer.length - this.MAX_CANDLES);
        }
        this.candleBuffers.set(asset, buffer);
        this.lastUpdated.set(asset, Date.now());
    }

    public getCandles(asset: string, limit: number = this.MAX_CANDLES): OHLC[] {
        const buffer = this.candleBuffers.get(asset) || [];
        return buffer.slice(Math.max(0, buffer.length - limit));
    }
}
