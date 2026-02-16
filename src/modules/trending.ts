import { BuyAlert } from '../types';
import { FirestoreService } from './firestoreService';

interface Trade {
  tokenAddress: string;
  amountUSD: number;
  timestamp: number;
  symbol: string;
  chain: 'eth' | 'solana';
}

export class TrendingModule {
  private static trades: Trade[] = [];
  private static WINDOW_MS = 24 * 60 * 60 * 1000;
  private static VELOCITY_WINDOW_MS = 60 * 60 * 1000;

  static async recordBuy(alert: BuyAlert) {
    const trade: Trade = {
      tokenAddress: alert.tokenAddress,
      amountUSD: alert.amountUSD,
      timestamp: alert.timestamp,
      symbol: alert.symbol,
      chain: alert.chain
    };

    this.trades.push(trade);
    this.cleanup();

    const score = this.calculateVelocityScore(alert.tokenAddress);
    
    await FirestoreService.updateTrendingToken({
      tokenAddress: alert.tokenAddress,
      symbol: alert.symbol,
      score: score,
      lastUpdate: Date.now(),
      chain: alert.chain
    });
  }

  private static cleanup() {
    const cutoff = Date.now() - this.WINDOW_MS;
    this.trades = this.trades.filter(t => t.timestamp > cutoff);
  }

  private static calculateVelocityScore(tokenAddress: string): number {
    const now = Date.now();
    const cutoff = now - this.VELOCITY_WINDOW_MS;
    
    const recentTrades = this.trades.filter(t => 
      t.tokenAddress === tokenAddress && t.timestamp > cutoff
    );

    if (recentTrades.length === 0) return 0;
    const totalVolume = recentTrades.reduce((sum, t) => sum + t.amountUSD, 0);
    
    const firstTradeTime = Math.min(...recentTrades.map(t => t.timestamp));
    const durationMins = Math.max((now - firstTradeTime) / 60000, 1);
    
    return totalVolume / durationMins;
  }

  static async getLeaderboard(limit: number = 10) {
    return await FirestoreService.getTopTrending(limit);
  }
}
