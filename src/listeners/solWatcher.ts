import { Connection, PublicKey } from '@solana/web3.js';
import { BuyAlert } from '../types';

export class SolWatcher {
  private connection: Connection;
  private activeSubscriptions: Map<string, number> = new Map();
  private alertCallback: ((alert: BuyAlert) => void) | null = null;

  constructor() {
    const rpcUrl = process.env.SOL_RPC_URL;
    if (!rpcUrl) {
      throw new Error('SOL_RPC_URL must be provided!');
    }
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  async startListening(callback: (alert: BuyAlert) => void) {
    this.alertCallback = callback;
    console.log('🏛️  Ancient Watcher: Solana Precision Sniper Active (Waiting for targets)');
  }

  async updateWatchList(tokens: string[]) {
    const uniqueTokens = Array.from(new Set(tokens.filter(t => t && t.length >= 32)));
    
    for (const [token, subId] of this.activeSubscriptions.entries()) {
      if (!uniqueTokens.includes(token)) {
        await this.connection.removeOnLogsListener(subId);
        this.activeSubscriptions.delete(token);
        console.log(`🏛️  Ancient Watcher: Desubscribed from ${token}`);
      }
    }

    for (const token of uniqueTokens) {
      if (!this.activeSubscriptions.has(token)) {
        try {
          const subId = this.connection.onLogs(
            new PublicKey(token),
            async ({ logs, err, signature }) => {
              if (err) return;
              
              // Low-precision trigger: basically any transaction involving this token
              // We'll do the high-precision balance check in processTransaction
              if (this.alertCallback) {
                this.processTransaction(signature, token, this.alertCallback);
              }
            },
            'confirmed'
          );
          this.activeSubscriptions.set(token, subId);
          console.log(`🏛️  Ancient Watcher: Now SNIPING alerts for ${token}`);
        } catch (e) {
          console.error(`🏛️  Ancient Watcher: Failed to subscribe to ${token}:`, e);
        }
      }
    }
  }

  private async getTokenMetadata(mint: string) {
    try {
      const resp = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
      const data: any = await resp.json();
      const pair = data.pairs?.[0];
      if (pair) {
        return {
          symbol: pair.baseToken.symbol,
          priceUsd: parseFloat(pair.priceUsd) || 0,
          marketCap: pair.fdv ? `$${(pair.fdv / 1000).toFixed(1)}K` : 'Unknown'
        };
      }
    } catch (e) {
      // Ignore
    }
    return { symbol: 'TOKEN', priceUsd: 0, marketCap: 'Unknown' };
  }

  private async processTransaction(signature: string, targetTokenMint: string, callback: (alert: BuyAlert) => void) {
    try {
      const tx = await this.connection.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed'
      });

      if (!tx || !tx.meta) return;

      // 1. Identify the Signer (Buyer)
      const buyer = tx.transaction.message.accountKeys[0].pubkey.toString();
      
      // 2. Identify SOL Movement (preSol - postSol)
      const preSol = tx.meta.preBalances[0] || 0;
      const postSol = tx.meta.postBalances[0] || 0;
      const solSpent = (preSol - postSol) / 1e9;

      // --- DUST FILTER ---
      // Ignore trades below 0.005 SOL (approx $1) to prevent flooding/rate-limits
      if (solSpent < 0.005) return;

      // 3. Identify Token Movement for the specific mint we're watching
      const preBalances = tx.meta.preTokenBalances || [];
      const postBalances = tx.meta.postTokenBalances || [];

      const targetPreBalance = preBalances.find(b => b.mint === targetTokenMint && b.owner === buyer)?.uiTokenAmount.uiAmount || 0;
      const targetPostBalance = postBalances.find(b => b.mint === targetTokenMint && b.owner === buyer)?.uiTokenAmount.uiAmount || 0;
      
      const tokenDelta = targetPostBalance - targetPreBalance;

      // 4. THE ULTIMATE BUY CHECK
      // If user spent SOL and gained Tokens, it is 100% a BUY.
      if (solSpent > 0 && tokenDelta > 0) {
        const amountTokenStr = tokenDelta.toLocaleString(undefined, { maximumFractionDigits: 0 });

        // Fetch Live Metadata for the Alert
        const meta = await this.getTokenMetadata(targetTokenMint);
        const amountUSD = tokenDelta * meta.priceUsd;

        const alert: BuyAlert = {
          tokenAddress: targetTokenMint, 
          symbol: meta.symbol,
          amountToken: amountTokenStr,
          amountNative: `${solSpent.toFixed(3)} SOL`,
          amountUSD: amountUSD,
          marketCap: meta.marketCap,
          buyer: buyer,
          txnHash: signature,
          chain: 'solana',
          dex: 'Solana DEX', // Could be anything, balance check is chain-agnostic
          timestamp: Date.now(),
          isNewHolder: targetPreBalance === 0
        };

        console.log(`🏛️  Ancient Sniper: [ACCURATE MATCH] for ${targetTokenMint} by ${buyer} (${solSpent.toFixed(3)} SOL)`);
        callback(alert);
      }
    } catch (e) {
      // Quietly ignore parsing errors
    }
  }
}
