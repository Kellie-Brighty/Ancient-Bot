import { ethers } from 'ethers';
import { BuyAlert } from '../types/index';

const UNISWAP_V2_ABI = [
  "event Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)"
];

const ERC20_ABI = [
  "function decimals() view returns (uint8)"
];

const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'.toLowerCase();

export class EthWatcher {
  private provider: ethers.JsonRpcProvider;
  private activeSubscriptions: Map<string, ethers.Contract> = new Map();
  private alertCallback: ((alert: BuyAlert) => void) | null = null;
  private decimalsCache: Map<string, number> = new Map();

  private async getTokenDecimals(tokenAddress: string): Promise<number> {
    if (this.decimalsCache.has(tokenAddress)) return this.decimalsCache.get(tokenAddress)!;
    try {
      const contract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
      const decimals = await contract.decimals();
      const d = Number(decimals);
      this.decimalsCache.set(tokenAddress, d);
      return d;
    } catch (e) {
      return 18; // fallback
    }
  }

  constructor() {
    const rpcUrl = process.env.ETH_RPC_URL;
    if (!rpcUrl) {
      throw new Error('ETH_RPC_URL must be provided!');
    }
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
  }

  async startListening(callback: (alert: BuyAlert) => void) {
    this.alertCallback = callback;
    console.log('🏛️  SAFU Watcher: Ethereum Precision Buy Monitor Active (Waiting for targets)');
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
        console.log(`🏛️  SAFU Watcher: Desubscribed from ETH token ${token}`);
      }
    }

    // Add new subs
    for (const token of uniqueTokens) {
      if (!this.activeSubscriptions.has(token)) {
        const pair = await this.getPairInfo(token);
        if (!pair || !pair.pairAddress) {
          console.warn(`🏛️  SAFU Watcher: Could not find Uniswap pair for ETH token ${token}`);
          continue;
        }

        try {
          const contract = new ethers.Contract(pair.pairAddress, UNISWAP_V2_ABI, this.provider);
          
          contract.on("Swap", async (sender, amount0In, amount1In, amount0Out, amount1Out, to, event) => {
            if (!this.alertCallback) return;

            // Determine if it's a BUY
            // Rule: ETH goes IN, Token comes OUT
            // In Uniswap V2, token0 is the address that is lexicographically smaller.
            const isWeth0 = WETH < token.toLowerCase();
            
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

              // Fetch FRESH pair data for real-time market cap
              const freshPair = await this.getPairInfo(token) || pair;

              // Get actual token decimals (not always 18)
              const decimals = await this.getTokenDecimals(token);
              const amountTokenStr = Number(ethers.formatUnits(tokenAmount, decimals)).toLocaleString(undefined, { maximumFractionDigits: 0 });
              
              const alert: BuyAlert = {
                tokenAddress: token,
                symbol: freshPair.baseToken.symbol,
                amountToken: amountTokenStr,
                amountNative: `${solSpent.toFixed(4)} ETH`,
                amountUSD: solSpent * (parseFloat(freshPair.priceUsd) / (parseFloat(freshPair.priceNative) || 1)),
                marketCap: freshPair.fdv ? `$${Math.round(freshPair.fdv).toLocaleString('en-US')}` : 'Unknown',
                buyer: to,
                txnHash: event.log.transactionHash,
                chain: 'eth',
                dex: 'Uniswap V2',
                timestamp: Date.now(),
                isNewHolder: true
              };

              console.log(`🏛️  SAFU Buy Monitor: [ETH MATCH] for ${token} by ${to} (${solSpent.toFixed(4)} ETH)`);
              this.alertCallback(alert);
            }
          });

          this.activeSubscriptions.set(token, contract);
          console.log(`🏛️  SAFU Watcher: Now SNIPING ETH alerts for ${token} (Pool: ${pair.pairAddress})`);
        } catch (e) {
          console.error(`🏛️  SAFU Watcher: Failed to subscribe to ETH token ${token}:`, e);
        }
      }
    }
  }
}
