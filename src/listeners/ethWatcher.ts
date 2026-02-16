import { ethers } from 'ethers';
import { BuyAlert } from '../types/index';

const UNISWAP_V2_ABI = [
  "event Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)"
];

const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'.toLowerCase();

export class EthWatcher {
  private provider: ethers.JsonRpcProvider;
  private activeSubscriptions: Map<string, ethers.Contract> = new Map();
  private alertCallback: ((alert: BuyAlert) => void) | null = null;

  constructor() {
    const rpcUrl = process.env.ETH_RPC_URL;
    if (!rpcUrl) {
      throw new Error('ETH_RPC_URL must be provided!');
    }
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
  }

  async startListening(callback: (alert: BuyAlert) => void) {
    this.alertCallback = callback;
    console.log('🏛️  Ancient Watcher: Ethereum Precision Sniper Active (Waiting for targets)');
  }

  private async getPairInfo(tokenAddress: string) {
    try {
      const resp = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`);
      const data: any = await resp.json();
      // Find the main Uniswap V2 pool with WETH
      const pair = data.pairs?.find((p: any) => 
        p.dexId === 'uniswap' && 
        (p.quoteToken.address.toLowerCase() === WETH || p.baseToken.address.toLowerCase() === WETH)
      );
      return pair;
    } catch (e) {
      return null;
    }
  }

  async updateWatchList(tokenAddresses: string[]) {
    const uniqueTokens = Array.from(new Set(tokenAddresses.filter(t => t && t.startsWith('0x'))));

    // Clear old subs
    for (const [token, contract] of this.activeSubscriptions.entries()) {
      if (!uniqueTokens.includes(token)) {
        contract.removeAllListeners();
        this.activeSubscriptions.delete(token);
        console.log(`🏛️  Ancient Watcher: Desubscribed from ETH token ${token}`);
      }
    }

    // Add new subs
    for (const token of uniqueTokens) {
      if (!this.activeSubscriptions.has(token)) {
        const pair = await this.getPairInfo(token);
        if (!pair || !pair.pairAddress) {
          console.warn(`🏛️  Ancient Watcher: Could not find Uniswap pair for ETH token ${token}`);
          continue;
        }

        try {
          const contract = new ethers.Contract(pair.pairAddress, UNISWAP_V2_ABI, this.provider);
          
          contract.on("Swap", async (sender, amount0In, amount1In, amount0Out, amount1Out, to, event) => {
            if (!this.alertCallback) return;

            // Determine if it's a BUY
            // Rule: ETH goes IN, Token comes OUT
            // amount0 is usually Token, amount1 is usually WETH (but can be reversed)
            const isToken0Weth = pair.quoteToken.address.toLowerCase() === WETH ? pair.quoteToken.symbol === 'WETH' : pair.baseToken.address.toLowerCase() === WETH;
            
            // Re-fetch pair info for tokens/weth order if needed, but DexScreener tells us
            const isWeth0 = pair.baseToken.address.toLowerCase() === WETH;
            
            let ethAmount = 0n;
            let tokenAmount = 0n;

            if (isWeth0) {
              // WETH is Token0
              if (amount0In > 0n && amount1Out > 0n) {
                ethAmount = amount0In;
                tokenAmount = amount1Out;
              }
            } else {
              // WETH is Token1
              if (amount1In > 0n && amount0Out > 0n) {
                ethAmount = amount1In;
                tokenAmount = amount0Out;
              }
            }

            if (ethAmount > 0n && tokenAmount > 0n) {
              const solSpent = Number(ethers.formatEther(ethAmount));
              
              // --- DUST FILTER ---
              // Ignore trades below ~ $1 (approx 0.0004 ETH) to prevent flooding/rate-limits
              if (solSpent < 0.0004) return; 

              const amountTokenStr = Number(ethers.formatUnits(tokenAmount, 18)).toLocaleString(undefined, { maximumFractionDigits: 0 });
              
              const alert: BuyAlert = {
                tokenAddress: token,
                symbol: pair.baseToken.symbol,
                amountToken: amountTokenStr,
                amountNative: `${solSpent.toFixed(4)} ETH`,
                amountUSD: solSpent * (parseFloat(pair.priceUsd) / (parseFloat(pair.priceNative) || 1)), // Rough estimate from pair
                marketCap: pair.fdv ? `$${(pair.fdv / 1000).toFixed(1)}K` : 'Unknown',
                buyer: to,
                txnHash: event.log.transactionHash,
                chain: 'eth',
                dex: 'Uniswap V2',
                timestamp: Date.now(),
                isNewHolder: true // Hard to check on ETH without deep state call, default to true
              };

              console.log(`🏛️  Ancient Sniper: [ETH MATCH] for ${token} by ${to} (${solSpent.toFixed(4)} ETH)`);
              this.alertCallback(alert);
            }
          });

          this.activeSubscriptions.set(token, contract);
          console.log(`🏛️  Ancient Watcher: Now SNIPING ETH alerts for ${token} (Pool: ${pair.pairAddress})`);
        } catch (e) {
          console.error(`🏛️  Ancient Watcher: Failed to subscribe to ETH token ${token}:`, e);
        }
      }
    }
  }
}
