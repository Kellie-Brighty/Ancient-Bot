import { TrendingToken, BuyAlert } from '../types/index';

export class TrendingModule {
  private static WHALE_THRESHOLD_USD = 1000;
  private static DECAY_PERCENTAGE = 0.1; // 10% decay
  private static DECAY_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

  // In-memory store for now
  private tokens: Record<string, TrendingToken> = {};

  constructor() {
    // Start decay loop
    setInterval(() => this.applyDecay(), TrendingModule.DECAY_INTERVAL_MS);
  }

  handleBuy(alert: BuyAlert) {
    const { tokenAddress, symbol, amountUSD, chain } = alert;

    if (!this.tokens[tokenAddress]) {
      this.tokens[tokenAddress] = {
        tokenAddress,
        symbol,
        score: 0,
        lastBuyAt: new Date(),
        totalVolume: 0,
        chain
      };
    }

    const token = this.tokens[tokenAddress];
    
    // Scoring logic
    const points = amountUSD >= TrendingModule.WHALE_THRESHOLD_USD ? 10 : 1;
    token.score += points;
    token.totalVolume += amountUSD;
    token.lastBuyAt = new Date();

    console.log(`Updated score for ${symbol}: ${token.score} (+${points})`);
  }

  private applyDecay() {
    console.log('Applying point decay to trending tokens...');
    for (const address in this.tokens) {
      this.tokens[address].score *= (1 - TrendingModule.DECAY_PERCENTAGE);
      
      // Remove tokens with very low scores to keep memory clean
      if (this.tokens[address].score < 0.1) {
        delete this.tokens[address];
      }
    }
  }

  getTopTokens(limit: number = 10): TrendingToken[] {
    return Object.values(this.tokens)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
