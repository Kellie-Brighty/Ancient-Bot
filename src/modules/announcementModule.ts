import { Telegraf } from 'telegraf';
import { TrendingModule } from './trending';
import { ChainUtils } from '../utils/chainUtils';

export class AnnouncementModule {
  private static bot: Telegraf;
  private static channelId: string;
  private static interval: any = null;

  static init(bot: Telegraf, channelId: string) {
    this.bot = bot;
    this.channelId = channelId;
    console.log(`🏛️ SAFU Announcements: Initialized for channel ${this.channelId}`);
    
    // Start Heartbeat: 5 minutes for production
    this.startHeartbeat(300000);
  }

  private static startHeartbeat(ms: number) {
    if (this.interval) clearInterval(this.interval);
    
    this.interval = setInterval(async () => {
      try {
        await this.postTrendingUpdate();
      } catch (error) {
        console.error('❌ SAFU Announcements: Heartbeat error:', error);
      }
    }, ms);
  }

  private static async postTrendingUpdate() {
    const leaderboard = await TrendingModule.getLeaderboard(5);
    if (leaderboard.length === 0) return;

    let message = `🔥 *SAFU GLOBAL TRENDING* 🔥\n\n`;
    const now = Date.now();

    leaderboard.forEach((token, index) => {
      const diffSeconds = Math.floor((now - token.lastUpdate) / 1000);
      const diffMinutes = Math.floor(diffSeconds / 60);
      
      let timeAgo = 'Just now';
      if (diffMinutes > 0) {
        timeAgo = diffMinutes === 1 ? '1 minute ago' : `${diffMinutes} minutes ago`;
      } else if (diffSeconds > 10) {
        timeAgo = `${diffSeconds} seconds ago`;
      }

      const formattedMomentum = token.score.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });

      const actualChain = token.chain || ChainUtils.identifyChain(token.tokenAddress);
      const networkLabel = actualChain === 'solana' ? '🔹 SOL' : '🔹 ETH';
      const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🔹';
      
      message += `${medal} *${token.symbol}* (${networkLabel})\n` +
                 `   • *Momentum:* \`$${formattedMomentum}/min\`\n` +
                 `   • *Status:* \`${timeAgo}\`\n` +
                 `   • *CA:* \`${token.tokenAddress}\`\n\n`;
    });

    message += `_Momentum = "Speed of Money". Higher = Faster Buy Interest!_ 🦾\n` +
               `👉 [Add SAFU to your Group](https://t.me/${(this.bot as any).botInfo?.username}?startgroup=true)`;

    await this.bot.telegram.sendMessage(this.channelId, message, { 
      parse_mode: 'Markdown',
      link_preview_options: { is_disabled: true }
    } as any);
  }
}
