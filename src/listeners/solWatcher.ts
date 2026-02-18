import { Connection, PublicKey } from '@solana/web3.js';
import { BuyAlert } from '../types';

export class SolWatcher {
  private connection: Connection;
  private activeSubscriptions: Map<string, number> = new Map();
  private alertCallback: ((alert: BuyAlert) => void) | null = null;
  private processedSignatures: Set<string> = new Set();

  constructor() {
    const rpcUrl = process.env.SOL_RPC_URL;
    if (!rpcUrl) {
      throw new Error('SOL_RPC_URL must be provided!');
    }
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  async startListening(callback: (alert: BuyAlert) => void) {
    this.alertCallback = callback;
    console.log('🏛️  SAFU Watcher: Solana Precision Buy Monitor Active (Waiting for targets)');
  }

  private async getVaultAddress(tokenMint: string): Promise<string | null> {
    try {
      // 1. Check DexScreener FIRST (handles Raydium graduation)
      const resp = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`);
      const data: any = await resp.json();
      
      // Look for Raydium or PumpSwap (Raydium graduated)
      const raydiumPair = data.pairs?.find((p: any) => p.dexId === 'raydium' || p.dexId === 'pumpswap');
      if (raydiumPair && raydiumPair.pairAddress) {
        console.log(`🏛️  SAFU Watcher: Found Raydium/PumpSwap vault: ${raydiumPair.pairAddress}`);
        return raydiumPair.pairAddress;
      }

      // 2. Fallback to Pump.fun Bonding Curve if still in early stages
      if (tokenMint.endsWith('pump')) {
        const PUMP_PROGRAM = new PublicKey('6EF8rrecthR5DkZJv99zz88BfN7m6WkJJrFvK3MvswH');
        const [bondingCurve] = PublicKey.findProgramAddressSync(
          [Buffer.from('bonding-curve'), new PublicKey(tokenMint).toBuffer()],
          PUMP_PROGRAM
        );
        console.log(`🏛️  SAFU Watcher: Found Pump.fun Bonding Curve vault: ${bondingCurve.toString()}`);
        return bondingCurve.toString();
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
          console.log(`🏛️  SAFU Watcher: Attaching listener to vault: ${vault}`);
          const subId = this.connection.onAccountChange(
            new PublicKey(vault),
            async () => {
              if (this.alertCallback) {
                // Fetch more to ensure we don't miss trades in high-speed blocks
                const signatures = await this.connection.getSignaturesForAddress(new PublicKey(vault), { limit: 5 });
                for (const sigInfo of signatures.reverse()) {
                  if (!this.processedSignatures.has(sigInfo.signature)) {
                    this.processedSignatures.add(sigInfo.signature);
                    this.processTransaction(sigInfo.signature, token, this.alertCallback);
                  }
                }
                
                // Keep memory lean
                if (this.processedSignatures.size > 2000) {
                  const toKill = Array.from(this.processedSignatures).slice(0, 500);
                  toKill.forEach(s => this.processedSignatures.delete(s));
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
          marketCap: pair.fdv ? `$${Math.round(pair.fdv).toLocaleString('en-US')}` : 'Unknown'
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

        console.log(`🏛️  SAFU Buy Monitor: [VAULT MATCH] for ${targetTokenMint} (${solSpent.toFixed(3)} SOL)`);
        callback(alert);
      }
    } catch (e) {
      // Quietly ignore
    }
  }
}
