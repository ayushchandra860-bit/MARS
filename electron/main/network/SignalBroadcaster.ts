// ============================================================
// MARS PRO V3 — Signal Broadcaster
// WebSocket server that broadcasts live signals, trade updates,
// and market intel to connected phone apps (PWA/native).
// ============================================================

import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { TradingAction } from '../../../shared/types/decision';

export interface SignalMessage {
  type: 'signal' | 'trade_update' | 'market_intel' | 'settings_sync' | 'pong';
  timestamp: number;
  data: any;
}

export class SignalBroadcaster {
  private static instance: SignalBroadcaster | null = null;
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();
  private server: Server | null = null;
  private port: number = 0;

  private constructor() {}

  public static getInstance(): SignalBroadcaster {
    if (!SignalBroadcaster.instance) {
      SignalBroadcaster.instance = new SignalBroadcaster();
    }
    return SignalBroadcaster.instance;
  }

  /**
   * Start the WebSocket server on a random available port.
   * Returns the port number for the phone app to connect to.
   */
  public start(): Promise<number> {
    return new Promise((resolve, reject) => {
      if (this.wss) {
        resolve(this.port);
        return;
      }

      this.server = new Server();
      this.wss = new WebSocketServer({ server: this.server });

      this.wss.on('connection', (ws: WebSocket) => {
        this.clients.add(ws);
        console.log(`[MARS BROADCASTER] Client connected (total: ${this.clients.size})`);

        // Send welcome message with current state
        ws.send(JSON.stringify({
          type: 'signal',
          timestamp: Date.now(),
          data: {
            action: 'WAIT',
            confidence: 0,
            reason: 'Connected to MARS PRO',
            asset: null,
          },
        }));

        ws.on('message', (message: Buffer) => {
          try {
            const msg = JSON.parse(message.toString());
            this.handleClientMessage(ws, msg);
          } catch (e) {
            // Ignore invalid messages
          }
        });

        ws.on('close', () => {
          this.clients.delete(ws);
          console.log(`[MARS BROADCASTER] Client disconnected (total: ${this.clients.size})`);
        });

        ws.on('error', () => {
          this.clients.delete(ws);
        });
      });

      // Listen on port 0 (random available port)
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address();
        if (addr && typeof addr === 'object') {
          this.port = addr.port;
          console.log(`[MARS BROADCASTER] WebSocket server running on ws://127.0.0.1:${this.port}`);
          resolve(this.port);
        } else {
          reject(new Error('Failed to get server address'));
        }
      });

      this.server.on('error', reject);
    });
  }

  /**
   * Stop the WebSocket server and disconnect all clients.
   */
  public stop(): void {
    for (const client of this.clients) {
      try {
        client.close();
      } catch (e) {}
    }
    this.clients.clear();
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    this.port = 0;
    console.log('[MARS BROADCASTER] Server stopped');
  }

  /**
   * Broadcast a signal update to all connected clients.
   */
  public broadcastSignal(data: {
    action: TradingAction | string;
    confidence: number;
    signalStrength: number;
    reason: string;
    reasons: string[];
    asset: string | null;
    expiry: string | null;
    risk: string;
    regime: string | null;
    winProbability: number | null;
  }): void {
    this.broadcast({
      type: 'signal',
      timestamp: Date.now(),
      data,
    });
  }

  /**
   * Broadcast a trade update (active trade P&L, health, etc.)
   */
  public broadcastTradeUpdate(data: {
    signalId: string;
    action: TradingAction | string;
    asset: string;
    entryPrice: number | null;
    currentPrice: number | null;
    pnlPct: number | null;
    pnlPoints: number | null;
    remainingSeconds: number;
    health: string;
    healthReason: string;
    targetPoints: number | null;
    stopPoints: number | null;
    winProb: number | null;
  }): void {
    this.broadcast({
      type: 'trade_update',
      timestamp: Date.now(),
      data,
    });
  }

  /**
   * Broadcast market intel (regime, momentum, pressure, S/R).
   */
  public broadcastMarketIntel(data: {
    regime: string | null;
    momentum: string | null;
    pressure: string | null;
    pressureBuyPct: number | null;
    support: { distancePts: number } | null;
    resistance: { distancePts: number } | null;
    proximityAlert: string | null;
  }): void {
    this.broadcast({
      type: 'market_intel',
      timestamp: Date.now(),
      data,
    });
  }

  /**
   * Get the number of connected clients.
   */
  public getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Get the server port (for display in UI).
   */
  public getPort(): number {
    return this.port;
  }

  /**
   * Check if the server is running.
   */
  public isRunning(): boolean {
    return this.wss !== null;
  }

  // --- Private ---

  private broadcast(message: SignalMessage): void {
    const json = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(json);
        } catch (e) {
          this.clients.delete(client);
        }
      }
    }
  }

  private handleClientMessage(ws: WebSocket, msg: any): void {
    if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
    }
    // Future: handle trade registration from phone, settings sync, etc.
  }
}
