export type Chain = "eth" | "solana";

export interface GroupConfig {
  chatId: string;
  chain: Chain;
  tokenAddress: string;
  minBuyAmount: number; // in USD
  buyEmoji?: string;
  customEmojiId?: string; // Telegram premium custom emoji ID
  emojiStepUsd?: number; // USD amount per emoji (e.g. 10 = 1 emoji per $10)
  socialLink?: string; // Main telegram link to append to buy alerts
  buyMedia?: {
    fileId: string;
    type: 'photo' | 'video' | 'animation';
  };
}


export interface TrendingToken {
  tokenAddress: string;
  symbol: string;
  score: number;
  lastUpdate: number;
  chain: Chain;
}

export interface BuyAlert {
  tokenAddress: string;
  symbol: string;
  amountToken: string;
  amountNative: string; // e.g. "0.089 SOL"
  amountUSD: number;
  marketCap?: string;
  buyer: string;
  txnHash: string;
  chain: Chain;
  dex: string;
  timestamp: number;
  isNewHolder?: boolean;
}
