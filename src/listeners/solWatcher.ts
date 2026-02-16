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
    console.log('🏛️  SAFU Watcher: Solana Precision sniper Active (Waiting for targets)');
  }

  private async getVaultAddress(tokenMint: string): Promise<string | null> {
    try {
      // 1. Check if it's a Pump.fun token
      if (tokenMint.endsWith('pump')) {
        const PUMP_PROGRAM = new PublicKey('6EF8rrecthR5DkZJv99zz88BfN7m6WkJJrFvK3MvswH');
        const [bondingCurve] = PublicKey.findProgramAddressSync(
          [Buffer.from('bonding-curve'), new PublicKey(tokenMint).toBuffer()],
          PUMP_PROGRAM
        );
        return bondingCurve.toString();
      }

      // 2. Otherwise, check DexScreener for Raydium Pair
      const resp = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`);
      const data: any = await resp.json();
      const pair = data.pairs?.find((p: any) => p.dexId === 'raydium');
      
      if (pair && pair.pairAddress) {
        return pair.pairAddress;
      }
    } catch (e) {
      console.error('🏛️  SAFU Watcher: Vault discovery failed:', e);
    }
    return null;
  }

  async updateWatchList(tokens: string[]) {
    const uniqueTokens = Array.from(new Set(tokens.filter(t => t && t.length >= 32)));
    
    // Cleanup old subs
    for (const [token, subId] of this.activeSubscriptions.entries()) {
      if (!uniqueTokens.includes(token)) {
        await this.connection.removeAccountChangeListener(subId);
        this.activeSubscriptions.delete(token);
        console.log(`🏛️  SAFU Watcher: Desubscribed from ${token}`);
      }
    }

    // Add new subs
    for (const token of uniqueTokens) {
      if (!this.activeSubscriptions.has(token)) {
        const vault = await this.getVaultAddress(token);
        if (!vault) {
          console.warn(`🏛️  SAFU Watcher: Could not find vault for ${token}`);
          continue;
        }

        try {
          const subId = this.connection.onAccountChange(
            new PublicKey(vault),
            async () => {
              if (this.alertCallback) {
                const signatures = await this.connection.getSignaturesForAddress(new PublicKey(vault), { limit: 1 });
                if (signatures.length > 0) {
                  this.processTransaction(signatures[0].signature, token, this.alertCallback);
                }
              }
            },
            'confirmed'
          );
          this.activeSubscriptions.set(token, subId);
          console.log(`🏛️  SAFU Watcher: NOW SNIPING [ACCOUNT TRIGGER] for ${token}`);
        } catch (e) {
          console.error(`🏛️  SAFU Watcher: Failed to subscribe to vault ${vault}:`, e);
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

      const buyer = tx.transaction.message.accountKeys[0].pubkey.toString();
      const preSol = tx.meta.preBalances[0] || 0;
      const postSol = tx.meta.postBalances[0] || 0;
      const solSpent = (preSol - postSol) / 1e9;

      if (solSpent < 0.005) return;

      const preBalances = tx.meta.preTokenBalances || [];
      const postBalances = tx.meta.postTokenBalances || [];

      const targetPreBalance = preBalances.find(b => b.mint === targetTokenMint && b.owner === buyer)?.uiTokenAmount.uiAmount || 0;
      const targetPostBalance = postBalances.find(b => b.mint === targetTokenMint && b.owner === buyer)?.uiTokenAmount.uiAmount || 0;
      const tokenDelta = targetPostBalance - targetPreBalance;

      if (solSpent > 0 && tokenDelta > 0) {
        const meta = await this.getTokenMetadata(targetTokenMint);
        const amountUSD = tokenDelta * meta.priceUsd;

        const alert: BuyAlert = {
          tokenAddress: targetTokenMint, 
          symbol: meta.symbol,
          amountToken: tokenDelta.toLocaleString(undefined, { maximumFractionDigits: 0 }),
          amountNative: `${solSpent.toFixed(3)} SOL`,
          amountUSD: amountUSD,
          marketCap: meta.marketCap,
          buyer: buyer,
          txnHash: signature,
          chain: 'solana',
          dex: 'Solana DEX',
          timestamp: Date.now(),
          isNewHolder: targetPreBalance === 0
        };

        console.log(`🏛️  SAFU Sniper: [VAULT MATCH] for ${targetTokenMint} (${solSpent.toFixed(3)} SOL)`);
        callback(alert);
      }
    } catch (e) {
      // Quietly ignore
    }
  }
}
