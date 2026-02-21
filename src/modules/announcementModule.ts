import { Telegraf, Markup } from 'telegraf';
import { TrendingModule } from './trending';
import { ChainUtils } from '../utils/chainUtils';
import { GoPlusScanner } from '../utils/goplusScanner';
import type { BuyAlert, TrendingToken } from '../types';

export class AnnouncementModule {
  private static bot: Telegraf;
  private static channelId: string;
  private static lastPinnedMessageId: number | null = null;
  private static lastLeaderboardHash: string = '';

  static init(bot: Telegraf, channelId: string) {
    this.bot = bot;
    this.channelId = channelId;
    console.log(`🏛️ SAFU Announcements: Live Trending Channel initialized for ${this.channelId}`);
  }

  /**
   * Called by TrendingModule after every recordBuy().
   * Handles both pinned leaderboard updates and individual buy alerts.
   */
  static async onBuyRecorded(alert: BuyAlert) {
    if (!this.channelId) return;

    try {
      // 1. Check if leaderboard order changed → update pin
      await this.checkAndUpdatePin();

      // 2. If this token is in the Top 10 AND clean, post buy alert to channel
      const leaderboard = await TrendingModule.getLeaderboard(10);
      const position = leaderboard.findIndex(
        t => t.tokenAddress.toLowerCase() === alert.tokenAddress.toLowerCase()
      );

      if (position !== -1) {
        const chain = alert.chain || ChainUtils.identifyChain(alert.tokenAddress);
        const scanResult = await GoPlusScanner.scan(alert.tokenAddress, chain);
        if (scanResult.risks.length === 0) {
          await this.postBuyToChannel(alert, position + 1);
        }
      }
    } catch (error) {
      console.error('❌ SAFU Announcements: Error processing buy:', error);
    }
  }

  /**
   * Check if leaderboard changed and re-pin if needed.
   */
  private static async checkAndUpdatePin() {
    const leaderboard = await TrendingModule.getLeaderboard(10);
    if (leaderboard.length === 0) return;

    // Build hash of current order to detect changes
    const currentHash = leaderboard.map(t => t.tokenAddress).join('|');
    if (currentHash === this.lastLeaderboardHash) return;

    this.lastLeaderboardHash = currentHash;
    console.log('🏛️ SAFU Announcements: Leaderboard changed — updating pin');

    await this.pinLeaderboard(leaderboard);
  }

  /**
   * Build and pin the compact Top 10 leaderboard.
   */
  private static async pinLeaderboard(leaderboard: TrendingToken[]) {
    const positionEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

    // Filter: only show clean tokens (no risks)
    const cleanTokens: TrendingToken[] = [];
    for (const token of leaderboard) {
      const chain = token.chain || ChainUtils.identifyChain(token.tokenAddress);
      const scanResult = await GoPlusScanner.scan(token.tokenAddress, chain);
      if (scanResult.risks.length === 0) {
        cleanTokens.push(token);
      }
    }

    if (cleanTokens.length === 0) return;

    // Lazy-import to avoid circular deps
    const { groupConfigs } = await import('../bot');

    const lines: string[] = [];
    for (const [i, token] of cleanTokens.entries()) {
      if (i >= 10) break;

      // Fetch live market cap from DexScreener
      let mcapStr = '';
      try {
        const resp = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${token.tokenAddress}`);
        const data: any = await resp.json();
        const pair = data.pairs?.[0];
        if (pair?.fdv) {
          const fdv = pair.fdv;
          mcapStr = fdv >= 1e9 ? `$${(fdv/1e9).toFixed(1)}B` : fdv >= 1e6 ? `$${(fdv/1e6).toFixed(1)}M` : `$${(fdv/1000).toFixed(1)}K`;
        }
      } catch (e) { /* ignore */ }

      // Find the group that has this token and get invite link
      let groupLink = '';
      try {
        let groupLink = token.socialLink || '';
        if (!groupLink) {
          const groupEntry = Object.entries(groupConfigs).find(
            ([_, config]) => config.tokenAddress?.toLowerCase() === token.tokenAddress.toLowerCase()
          );
          if (groupEntry) {
            groupLink = groupEntry[1].socialLink || '';
            if (!groupLink) {
              const chat = await this.bot.telegram.getChat(groupEntry[0]);
              if ('invite_link' in chat && chat.invite_link) {
                groupLink = chat.invite_link;
              } else if ('username' in chat && chat.username) {
                groupLink = `https://t.me/${chat.username}`;
              } else {
                // Try to export an invite link
                try {
                  groupLink = await this.bot.telegram.exportChatInviteLink(groupEntry[0]);
                } catch (e) { /* no permission to create link */ }
              }
            }
          }
        }
      } catch (e) { /* ignore */ }

      const symbol = groupLink 
        ? `[${token.symbol}](${groupLink})`
        : token.symbol;
      
      const mcapDisplay = mcapStr ? `  ${mcapStr}` : '';
      lines.push(`${positionEmojis[i]}  ${symbol}${mcapDisplay} ✅`);
    }

    const botUsername = (this.bot as any).botInfo?.username || 'SAFUBot';
    const message = lines.join('\n') +
      `\n\n✅ security scanned\n` +
      `🟢 @${botUsername} updates trending every trade`;

    try {
      if (this.lastPinnedMessageId) {
        // Edit existing pinned message in place
        await this.bot.telegram.editMessageText(
          this.channelId,
          this.lastPinnedMessageId,
          undefined,
          message,
          { parse_mode: 'Markdown', link_preview_options: { is_disabled: true } } as any
        );
        console.log(`🏛️ SAFU Announcements: Updated pinned leaderboard #${this.lastPinnedMessageId}`);
      } else {
        // First time: send + pin
        const sent = await this.bot.telegram.sendMessage(this.channelId, message, {
          parse_mode: 'Markdown',
          link_preview_options: { is_disabled: true }
        } as any);

        await this.bot.telegram.pinChatMessage(this.channelId, sent.message_id, {
          disable_notification: true
        } as any);

        this.lastPinnedMessageId = sent.message_id;
        console.log(`🏛️ SAFU Announcements: Pinned leaderboard message #${sent.message_id}`);
      }
    } catch (error) {
      console.error('❌ SAFU Announcements: Failed to pin leaderboard:', error);
    }
  }

  /**
   * Post an individual buy alert to the channel with position badge and inline buttons.
   */
  private static async postBuyToChannel(alert: BuyAlert, position: number) {
    const positionEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
    const posBadge = positionEmojis[position - 1] || `#${position}`;

    const chain = alert.chain || ChainUtils.identifyChain(alert.tokenAddress);
    const explorerUrl = chain === 'solana'
      ? `https://solscan.io/tx/${alert.txnHash}`
      : `https://etherscan.io/tx/${alert.txnHash}`;
    const screenerUrl = chain === 'solana'
      ? `https://dexscreener.com/solana/${alert.tokenAddress}`
      : `https://dexscreener.com/ethereum/${alert.tokenAddress}`;
    const buyerUrl = chain === 'solana'
      ? `https://solscan.io/account/${alert.buyer}`
      : `https://etherscan.io/address/${alert.buyer}`;
    const networkLabel = chain === 'solana' ? 'SOL' : 'ETH';

    const symbolDisplay = alert.socialLink 
      ? `[${alert.symbol}](${alert.socialLink})`
      : `*${alert.symbol}*`;

    const message =
      `${posBadge} | ${symbolDisplay} ${networkLabel}\n\n` +
      `${symbolDisplay} Buy!\n` +
      `${('🟢').repeat(Math.min(Math.ceil(alert.amountUSD / 50), 15))}\n\n` +
      `💰 ${alert.amountNative} ($${alert.amountUSD.toFixed(2)})\n` +
      `📊 [${alert.buyer.slice(0, 6)}...${alert.buyer.slice(-4)}](${buyerUrl}) | [Txn](${explorerUrl})\n` +
      `${alert.isNewHolder ? '✅ *New Holder*\n' : ''}` +
      `🏛️ Market Cap $${alert.marketCap || 'N/A'}`;

    const botUsername = (this.bot as any).botInfo?.username || 'SAFUBot';

    try {
      await this.bot.telegram.sendMessage(this.channelId, message, {
        parse_mode: 'Markdown',
        link_preview_options: { is_disabled: true },
        reply_markup: {
          inline_keyboard: [
            [
              { text: '➕ Add SAFU to your Group', url: `https://t.me/${botUsername}?startgroup=true` }
            ]
          ]
        }
      } as any);
    } catch (error) {
      console.error('❌ SAFU Announcements: Failed to post buy alert:', error);
    }
  }
}
