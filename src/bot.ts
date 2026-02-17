import { Telegraf, Context, Markup, Scenes, session } from 'telegraf';
import * as dotenv from 'dotenv';
import type { GroupConfig, BuyAlert } from './types/index';
import { SafeguardModule } from './modules/safeguard';
import { SolWatcher } from './listeners/solWatcher';
import { EthWatcher } from './listeners/ethWatcher';
import { TrendingModule } from './modules/trending';
import { ChainUtils } from './utils/chainUtils';
import { PermissionUtils } from './utils/permissionUtils';
import { GoPlusScanner } from './utils/goplusScanner';
import { Connection } from '@solana/web3.js';

dotenv.config();

const bot_token = process.env.BOT_TOKEN!;
export const bot = new Telegraf<Context>(bot_token);
const connection = new Connection(process.env.SOL_RPC_URL!, 'confirmed' as any);

// Initialize Watchers
const solWatcher = new SolWatcher();
const ethWatcher = new EthWatcher();

// In-memory config
const groupConfigs: Record<string, GroupConfig> = {};

// --- Scenes & Session ---
interface WizardSession extends Scenes.WizardSessionData {
  config: {
    chatId: string;
    chain?: 'eth' | 'solana';
    tokenAddress?: string;
    buyEmoji?: string;
    buyMedia?: { fileId: string, type: 'photo' | 'video' };
  }
}

type WizardContext = Context & Scenes.WizardContext<WizardSession>;

const setupWizard = new Scenes.WizardScene<WizardContext>(
  'SETUP_WIZARD',
  async (ctx) => {
    await ctx.reply(
      `🏛️ *SAFU Setup Wizard: Step 1*\n\nWelcome to the SAFU Buy Monitor setup. Select the network you want to monitor:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔗 Ethereum (ETH)', 'setup_chain_eth')],
          [Markup.button.callback('🔗 Solana (SOL)', 'setup_chain_sol')],
        ])
      }
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message || !('text' in ctx.message)) return;
    const tokenAddress = ctx.message.text.trim();
    if (tokenAddress.length < 32) return ctx.reply('❌ Invalid address. Please try again.');
    
    (ctx.wizard.state as any).tokenAddress = tokenAddress;

    // --- Run Security Scan ---
    const chain = (ctx.wizard.state as any).chain || 'eth';
    await ctx.reply('🔍 *Scanning contract integrity...*', { parse_mode: 'Markdown' });
    const scanResult = await GoPlusScanner.scan(tokenAddress, chain);
    (ctx.wizard.state as any).securityScore = scanResult.score;

    await ctx.replyWithMarkdown(GoPlusScanner.formatResult(scanResult));

    await ctx.reply('🏛️ *Step 3: Custom Emoji*\n\nSend a **single emoji** for the buy progress bar, or click Skip.', 
      Markup.inlineKeyboard([[Markup.button.callback('⏩ Skip Emoji', 'skip_emoji')]]));
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message || !('text' in ctx.message)) return;
    (ctx.wizard.state as any).buyEmoji = ctx.message.text.trim();
    
    await ctx.reply('🏛️ *Step 4: Buy Media*\n\nSend an **Image or Video** for the alert, or click Finish.', 
      Markup.inlineKeyboard([[Markup.button.callback('🏁 Finish Setup', 'finish_wizard')]]));
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message) return;
    let fileId = '', type: 'photo' | 'video' = 'photo';
    if ('photo' in ctx.message) {
      fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
      type = 'photo';
    } else if ('video' in ctx.message) {
      fileId = ctx.message.video.file_id;
      type = 'video';
    } else return;

    (ctx.wizard.state as any).buyMedia = { fileId, type };
    
    const state = ctx.wizard.state as any;
    if (state.chatId) {
      groupConfigs[state.chatId] = {
        chatId: state.chatId,
        chain: state.chain,
        tokenAddress: state.tokenAddress,
        buyEmoji: state.buyEmoji,
        buyMedia: state.buyMedia,
        safeguardEnabled: false, welcomeMessage: '', minBuyAmount: 0
      };
      syncBuyMonitor();
    }
    await ctx.reply('🏛️ *Setup Complete!* 🦾\n\nEverything is locked in.', 
      Markup.inlineKeyboard([[Markup.button.callback('🛡️ Enable Safeguard', 'enable_safeguard_final')]]));
    return ctx.scene.leave();
  }
);

setupWizard.action('setup_chain_eth', async (ctx) => {
  const chatId = ctx.chat?.id.toString();
  if (chatId) {
    (ctx.wizard.state as any).chatId = chatId;
    (ctx.wizard.state as any).chain = 'eth';
    await safeAnswer(ctx, 'ETH Selected! 🔗');
    await ctx.reply('🏛️ *Step 2: Token Target*\n\nPlease send the **Ethereum Token Address** (Pair or Token) you want to monitor.', { parse_mode: 'Markdown' });
    return ctx.wizard.selectStep(1); 
  }
});

setupWizard.action('setup_chain_sol', async (ctx) => {
  const chatId = ctx.chat?.id.toString();
  if (chatId) {
    (ctx.wizard.state as any).chatId = chatId;
    (ctx.wizard.state as any).chain = 'solana';
    await safeAnswer(ctx, 'SOL Selected! 🔗');
    await ctx.reply('🏛️ *Step 2: Token Target*\n\nPlease send the **Solana Token Mint Address** you want to monitor.', { parse_mode: 'Markdown' });
    return ctx.wizard.selectStep(1);
  }
});

setupWizard.action('skip_emoji', async (ctx) => {
  await safeAnswer(ctx, 'Skipped! ⏩');
  ctx.wizard.selectStep(3); 
  await ctx.reply('🏛️ *Step 4: Buy Media*\n\nSend an **Image or Video** for the alert, or click Finish.', 
    Markup.inlineKeyboard([[Markup.button.callback('🏁 Finish Setup', 'finish_wizard')]]));
});

setupWizard.action('finish_wizard', async (ctx) => {
  const state = ctx.wizard.state as any;
  if (state.chatId) {
    groupConfigs[state.chatId] = {
      chatId: state.chatId,
      chain: state.chain,
      tokenAddress: state.tokenAddress,
      buyEmoji: state.buyEmoji,
      buyMedia: state.buyMedia,
      safeguardEnabled: false, welcomeMessage: '', minBuyAmount: 0
    };
    syncBuyMonitor();
  }
  await safeAnswer(ctx, 'All set! 🏁');
  await ctx.reply('🏛️ *SAFU Buy Monitor Configured!* 🦾\n\nYour bot is now live.', 
    Markup.inlineKeyboard([[Markup.button.callback('🛡️ Enable Safeguard', 'enable_safeguard_final')]]));
  return ctx.scene.leave();
});

const stage = new Scenes.Stage<WizardContext>([setupWizard], {
  ttl: 300,
});

bot.use(session());
bot.use(stage.middleware() as any);

const broadcastBuyAlert = async (alert: BuyAlert) => {
  const targetGroups = Object.values(groupConfigs).filter(
    config => config.chain === alert.chain && config.tokenAddress && config.tokenAddress.toLowerCase() === alert.tokenAddress.toLowerCase()
  );
  if (targetGroups.length === 0) return;

  TrendingModule.recordBuy(alert).catch(e => console.error('Trending record failed:', e));

  for (const group of targetGroups) {
    try {
      const emoji = group.buyEmoji || '🟢';
      const emojiString = emoji.repeat(15); 
      const explorerUrl = alert.chain === 'solana' ? `https://solscan.io/account/${alert.buyer}` : `https://etherscan.io/address/${alert.buyer}`;
      const txUrl = alert.chain === 'solana' ? `https://solscan.io/tx/${alert.txnHash}` : `https://etherscan.io/tx/${alert.txnHash}`;
      const screenerUrl = alert.chain === 'solana' ? `https://dexscreener.com/solana/${alert.tokenAddress}` : `https://dexscreener.com/ethereum/${alert.tokenAddress}`;

      const messageContent = 
        `🏛️ *${alert.symbol} Buy!*\n` +
        `${emojiString}\n\n` +
        `💸 *Spent:* \`$${alert.amountUSD.toFixed(2)} (${alert.amountNative})\`\n` +
        `💰 *Got:* \`${alert.amountToken} ${alert.symbol}\`\n` +
        `👤 *Buyer:* [\`${alert.buyer.slice(0, 4)}...${alert.buyer.slice(-4)}\`](${explorerUrl})\n` +
        `${alert.isNewHolder ? '🆕 *New Holder*\n' : ''}` +
        `🏛️ *Market Cap:* \`${alert.marketCap}\`\n\n` +
        `🔗 [TX](${txUrl}) | [Screener](${screenerUrl})`;

      if (group.buyMedia) {
        if (group.buyMedia.type === 'photo') {
          await bot.telegram.sendPhoto(group.chatId, group.buyMedia.fileId, { caption: messageContent, parse_mode: 'Markdown' });
        } else {
          await bot.telegram.sendVideo(group.chatId, group.buyMedia.fileId, { caption: messageContent, parse_mode: 'Markdown' });
        }
      } else {
        await bot.telegram.sendMessage(group.chatId, messageContent, { parse_mode: 'Markdown', link_preview_options: { is_disabled: true } } as any);
      }
    } catch (e) {
      console.error(`Failed to send alert to ${group.chatId}:`, e);
    }
  }
};

const syncBuyMonitor = async () => {
  const solTokens = Object.values(groupConfigs).filter(c => c.chain === 'solana').map(c => c.tokenAddress).filter(t => t && t.length >= 32);
  const ethTokens = Object.values(groupConfigs).filter(c => c.chain === 'eth').map(c => c.tokenAddress).filter(t => t && t.startsWith('0x'));
  await solWatcher.updateWatchList(solTokens);
  await ethWatcher.updateWatchList(ethTokens);
};

solWatcher.startListening(broadcastBuyAlert).catch(console.error);
ethWatcher.startListening(broadcastBuyAlert).catch(console.error);
syncBuyMonitor();

bot.catch((err: any, ctx: Context) => {
  console.error(`Error for ${ctx.updateType}:`, err);
  if (err?.description?.includes('query is too old')) return;
});

const safeAnswer = async (ctx: any, text?: string) => {
  try { await ctx.answerCbQuery(text); } catch (e) {}
};

bot.start(async (ctx) => {
  const payload = (ctx as any).startPayload;
  if (payload && payload.startsWith('v_')) {
    const parts = payload.split('_'), chatId = parts[1], userId = parts[2];
    if (ctx.from?.id.toString() !== userId) return ctx.reply('❌ Invalid verification link.');
    return ctx.reply('🛡️ *SAFU Identity Verification*\nPlease verify your identity privately.', { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('I am Human 🛡️', `verify:${userId}:${chatId}`)]]) });
  }
  if (payload && payload.startsWith('j_')) {
    const groupId = payload.split('_')[1], userId = ctx.from?.id;
    return ctx.reply('🏛️ *Welcome to SAFU Gatekeeper*\nPlease verify you are human.', { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🛡️ I am Human', `verify:${userId}:${groupId}:dm`)]]) });
  }
  if (ctx.chat.type === 'private') {
    return ctx.replyWithMarkdown(
      `🏛️ *Welcome to SAFU Bot* 🛡️\n\n` +
      `I am the ultimate suite for community security and intelligence.\n\n` +
      `To secure your group and enable the **Trending Leaderboard**, click the button below to add me as an Admin!`,
      Markup.inlineKeyboard([
        [Markup.button.url('➕ Add SAFU to Group', `https://t.me/${ctx.botInfo.username}?startgroup=true`)]
      ])
    );
  }
});

bot.command('safu_portal', async (ctx) => {
  if (ctx.chat.type === 'private') return ctx.reply('❌ This command must be used inside a group.');
  const isOwner = await PermissionUtils.isUserOwner(ctx);
  if (!isOwner) return; // Silent fail for non-owners in group

  const botAdmin = await PermissionUtils.isBotAdmin(ctx);
  if (!botAdmin) return ctx.reply('⚠️ I need Administrator privileges to create a Safeguard Portal.');

  const botUsername = ctx.botInfo.username;
  const chatId = ctx.chat.id.toString();
  const portalLink = `https://t.me/${botUsername}?start=j_${chatId}`;
  
  ctx.replyWithMarkdown(
    `🛡️ *SAFU Safeguard Portal* 🏛️\n\n` +
    `Use this link to safely invite members. They will be verified in my DMs before joining the group.\n\n` +
    `🔗 *Portal Link:* \`${portalLink}\`\n\n` +
    `_Copy and share this link to block all bots!_`
  );
});

bot.command('setup', async (ctx) => {
  if (ctx.chat.type !== 'private') {
    const isOwner = await PermissionUtils.isUserOwner(ctx);
    if (!isOwner) return; // Silent fail for non-owners in group
    
    const botAdmin = await PermissionUtils.isBotAdmin(ctx);
    if (!botAdmin) return ctx.reply('⚠️ I need Administrator privileges to correctly configure this group.');
  }
  return (ctx as any).scene.enter('SETUP_WIZARD');
});
bot.command('safu_trending', async (ctx) => {
  const leaderboard = await TrendingModule.getLeaderboard(5);
  if (leaderboard.length === 0) return ctx.reply('🏛️ *SAFU Trending* 📈\nNo trades recorded yet.');
  
  let message = `🏛️ *SAFU Trending* 📈\n\n`;
  const now = Date.now();

  for (const [index, token] of leaderboard.entries()) {
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
    const chainPath = actualChain === 'solana' ? 'solana' : 'ethereum';
    const networkLabel = actualChain === 'solana' ? '🔹 SOL' : '🔹 ETH';
    const dexUrl = `https://dexscreener.com/${chainPath}/${token.tokenAddress}`;
    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🔹';

    // Security scan badge
    const scanResult = await GoPlusScanner.scan(token.tokenAddress, actualChain);
    const badge = GoPlusScanner.getBadge(scanResult);
    const titleBadge = badge ? ` ${badge}` : '';
    
    message += `${medal} *${token.symbol}* (${networkLabel})${titleBadge}\n` +
               `   • *Momentum:* \`$${formattedMomentum}/min\`\n` +
               `   • *Status:* \`${timeAgo}\`\n` +
               `   • *CA:* \`${token.tokenAddress}\`\n` +
               `   • 📊 [DexScreener](${dexUrl})\n`;

    if (scanResult.risks.length > 0) {
      message += `   • *Risks:* ${scanResult.risks.join(', ')}\n`;
    }
    message += `\n`;
  }
  
  message += `_Momentum = The "Speed of Money". It's how much USD is being spent on this token every minute. Higher = More buy interest right now!_`;
  ctx.reply(message, { parse_mode: 'Markdown', link_preview_options: { is_disabled: true } } as any);
});

// Debug: Capture Channel IDs
bot.on('channel_post', (ctx) => {
  console.log("🏛️  SAFU Debug: Channel ID Detected ->", ctx.chat.id);
});

bot.action('cmd_setup', async (ctx) => {
  if (ctx.chat?.type !== 'private') {
    const isOwner = await PermissionUtils.isUserOwner(ctx);
    if (!isOwner) return safeAnswer(ctx, '❌ Only the Group Owner can access setup.');
  }
  return (ctx as any).scene.enter('SETUP_WIZARD');
});

bot.action('cmd_trending_welcome', async (ctx) => {
  await safeAnswer(ctx);
  const leaderboard = await TrendingModule.getLeaderboard(5);
  if (leaderboard.length === 0) return ctx.reply('🏛️ *SAFU Trending* 📈\nNo trades recorded yet.');
  let message = `🏛️ *SAFU Trending* 📈\n\n`;
  const now = Date.now();
  leaderboard.forEach((token, index) => {
    const formattedMomentum = token.score.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const actualChain = token.chain || ChainUtils.identifyChain(token.tokenAddress);
    const networkLabel = actualChain === 'solana' ? '🔹 SOL' : '🔹 ETH';
    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🔹';
    message += `${medal} *${token.symbol}* (${networkLabel})\n   • *Momentum:* \`$${formattedMomentum}/min\`\n   • *CA:* \`${token.tokenAddress}\`\n\n`;
  });
  ctx.reply(message, { parse_mode: 'Markdown', link_preview_options: { is_disabled: true } } as any);
});

bot.action('cmd_help_welcome', async (ctx) => {
  await safeAnswer(ctx);
  ctx.replyWithMarkdown(
    `🏛️ *SAFU Bot Help Menu* 🛡️\n\n` +
    `• /setup - Launch the buy monitor setup wizard\n` +
    `• /safu_trending - View the trending leaderboard\n` +
    `• /safu_portal - Get your Safeguard portal link\n` +
    `• /help - Show this menu\n\n` +
    `*SAFU V2 Precision:* Structural Buy Detection active. 🦾`
  );
});

bot.action('cmd_portal_welcome', async (ctx) => {
  await safeAnswer(ctx);
  const isOwner = await PermissionUtils.isUserOwner(ctx);
  if (!isOwner) return ctx.reply('❌ Only the Group Owner can request the portal link.');
  
  const chatId = ctx.chat?.id.toString();
  if (!chatId) return;
  const portalLink = `https://t.me/${ctx.botInfo.username}?start=j_${chatId}`;
  ctx.replyWithMarkdown(
    `🛡️ *SAFU Safeguard Portal* 🏛️\n\n` +
    `🔗 *Portal Link:* \`${portalLink}\`\n\n` +
    `_Admins can share this link to ensure only verified humans enter the group._`
  );
});

bot.action('enable_safeguard_final', async (ctx) => {
  const isOwner = await PermissionUtils.isUserOwner(ctx);
  if (!isOwner) return safeAnswer(ctx, '❌ Only the Group Owner can enable Safeguard.');

  const chatId = ctx.chat?.id.toString();
  if (chatId && groupConfigs[chatId]) {
    groupConfigs[chatId].safeguardEnabled = true;
    await safeAnswer(ctx, 'Safeguard Enabled! 🛡️');
    ctx.reply('✅ *SAFU Safeguard Active.*');
  }
});

bot.on('my_chat_member', async (ctx) => {
  const oldStatus = ctx.myChatMember.old_chat_member.status;
  const newStatus = ctx.myChatMember.new_chat_member.status;

  if (oldStatus !== 'administrator' && newStatus === 'administrator') {
    // Bot was promoted to admin!
    await ctx.replyWithMarkdown(
      `🏛️ *SAFU Bot is ready!* 🛡️\n\n` +
      `I have been granted Admin powers. I'm now ready to handle security and intelligence for this community.\n\n` +
      `🛡️ *Safeguard:* Human-only verification portal.\n` +
      `📈 *Trending:* High-velocity momentum tracking.\n` +
      `🎯 *Buy Monitor:* High-precision buy alerts on ETH & SOL.\n\n` +
      `👉 *Admins:* Quick access below:`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback('🛡️ Portal Link', 'cmd_portal_welcome'),
          Markup.button.callback('🛠️ Setup Monitor', 'cmd_setup')
        ],
        [
          Markup.button.callback('📈 View Trending', 'cmd_trending_welcome'),
          Markup.button.callback('❓ View Help', 'cmd_help_welcome')
        ]
      ])
    );
  }
});

bot.on('new_chat_members', async (ctx) => {
  const newMembers = (ctx.message as any).new_chat_members;
  const isBotAdded = newMembers.some((m: any) => m.id === ctx.botInfo.id);

  if (isBotAdded) {
    const { isBotAdmin, isOwner } = await PermissionUtils.checkAdminAndOwner(ctx);

    if (!isBotAdmin) {
      return ctx.replyWithMarkdown(
        `🏛️ *SAFU Bot has arrived!* 🛡️\n\n` +
        `I am the ultimate security and intelligence suite for your community, but I need **Administrator privileges** to function correctly.\n\n` +
        `🛡️ *Safeguard:* Human-only verification portal.\n` +
        `📈 *Trending:* High-velocity momentum tracking.\n` +
        `🎯 *Buy Monitor:* High-precision buy alerts on ETH & SOL.\n\n` +
        `👉 *Owner:* Please promote me to Admin to unlock these features!`
      );
    }
  }
  await SafeguardModule.handleNewMember(ctx);
});

bot.action(/verify:(.+)/, async (ctx) => { await SafeguardModule.handleVerification(ctx); });

// --- Link Filtering (Admin Exempt) ---
bot.on('message', async (ctx, next) => {
  if (ctx.chat?.type === 'private') return next();
  
  const msg = ctx.message as any;
  const hasLink = (msg.entities || []).some((e: any) => e.type === 'url' || e.type === 'text_link') ||
                  (msg.caption_entities || []).some((e: any) => e.type === 'url' || e.type === 'text_link') ||
                  (msg.text && (msg.text.includes('http://') || msg.text.includes('https://') || msg.text.includes('t.me/')));

  if (hasLink) {
    const isImmune = await PermissionUtils.isAdminOrOwner(ctx);
    if (!isImmune) {
      try {
        await ctx.deleteMessage();
        console.log(`🛡️ SAFU Link Filter: Deleted link from non-admin ${ctx.from?.id} in ${ctx.chat?.id}`);
        // Optional: Send a silent warning or just disappear the link (cleaner)
        return; 
      } catch (e) {
        console.warn('SAFU: Failed to delete link (Insufficient permissions?)');
      }
    }
  }
  return next();
});

bot.command('help', (ctx) => {
  ctx.replyWithMarkdown(
    `🏛️ *SAFU Bot Help Menu* 🛡️\n\n` +
    `• /setup - Launch the buy monitor setup wizard\n` +
    `• /safu_trending - View the trending leaderboard\n` +
    `• /help - Show this menu\n\n` +
    `*SAFU V2 Precision:* Structural Buy Detection active. 🦾`
  );
});

export const launchBot = () => {
  // Set Quick Menu Commands
  bot.telegram.setMyCommands([
    { command: 'setup', description: '🛠️ Configure SAFU Buy Monitor' },
    { command: 'safu_trending', description: '📈 View Trending Leaderboard' },
    { command: 'safu_portal', description: '🛡️ Get Safeguard Portal Link' },
    { command: 'help', description: '❓ Get Help & Info' }
  ]);
  
  return bot.launch().then(() => console.log('SAFU Bot is running...'));
};

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
