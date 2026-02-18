import { Telegraf, Context, Markup, Scenes, session } from 'telegraf';
import * as dotenv from 'dotenv';
import type { GroupConfig, BuyAlert } from './types/index';

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
export const groupConfigs: Record<string, GroupConfig> = {};

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
  // Step 0: Select chain
  async (ctx) => {
    const sent = await ctx.reply(
      `🏛️ *SAFU Setup Wizard: Step 1*\n\nWelcome to the SAFU Buy Monitor setup. Select the network you want to monitor:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔗 Ethereum (ETH)', 'setup_chain_eth')],
          [Markup.button.callback('🔗 Solana (SOL)', 'setup_chain_sol')],
        ])
      }
    );
    (ctx.wizard.state as any).botMsgId = sent.message_id;
    return ctx.wizard.next();
  },
  // Step 1: Token address input
  async (ctx) => {
    if (!ctx.message || !('text' in ctx.message)) return;
    const tokenAddress = ctx.message.text.trim();

    // Delete user's text message
    try { await ctx.deleteMessage(ctx.message.message_id); } catch (e) {}

    if (tokenAddress.length < 32) {
      // Edit bot message to show error
      const botMsgId = (ctx.wizard.state as any).botMsgId;
      if (botMsgId) {
        await bot.telegram.editMessageText(
          ctx.chat!.id, botMsgId, undefined,
          `🏛️ *Step 2: Token Target*\n\n❌ Invalid address. Please send a valid contract address.`,
          { parse_mode: 'Markdown' } as any
        );
      }
      return;
    }
    
    (ctx.wizard.state as any).tokenAddress = tokenAddress;
    const chain = (ctx.wizard.state as any).chain || 'eth';
    const botMsgId = (ctx.wizard.state as any).botMsgId;

    // Silent security scan (stored for internal use)
    GoPlusScanner.scan(tokenAddress, chain).then(r => {
      (ctx.wizard.state as any).securityScore = r.score;
    }).catch(() => {});

    // Skip straight to emoji step
    if (botMsgId) {
      await bot.telegram.editMessageText(
        ctx.chat!.id, botMsgId, undefined,
        `✅ Token set: \`${tokenAddress}\`\n\n🏛️ *Step 3: Custom Emoji*\n\nSend a *single emoji* for the buy progress bar, or click Skip.`,
        { parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '⏩ Skip Emoji', callback_data: 'skip_emoji' }]] }
        } as any
      );
    }
    return ctx.wizard.next();
  },
  // Step 2: Emoji input
  async (ctx) => {
    if (!ctx.message || !('text' in ctx.message)) return;
    (ctx.wizard.state as any).buyEmoji = ctx.message.text.trim();

    // Delete user's emoji message
    try { await ctx.deleteMessage(ctx.message.message_id); } catch (e) {}

    const botMsgId = (ctx.wizard.state as any).botMsgId;
    if (botMsgId) {
      await bot.telegram.editMessageText(
        ctx.chat!.id, botMsgId, undefined,
        `✅ Emoji set: ${ctx.message.text.trim()}\n\n🏛️ *Step 4: Buy Media*\n\nSend an *Image, Video, or GIF* for the alert, or click Finish.`,
        { parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '🏁 Finish Setup', callback_data: 'finish_wizard' }]] }
        } as any
      );
    }
    return ctx.wizard.next();
  },
  // Step 3: Media input (photo, video, or GIF)
  async (ctx) => {
    if (!ctx.message) return;
    const msg = ctx.message as any;
    let fileId = '', type: 'photo' | 'video' | 'animation' = 'photo';

    if (msg.photo) {
      fileId = msg.photo[msg.photo.length - 1].file_id;
      type = 'photo';
    } else if (msg.animation) {
      fileId = msg.animation.file_id;
      type = 'animation';
    } else if (msg.video) {
      fileId = msg.video.file_id;
      type = 'video';
    } else if (msg.document && msg.document.mime_type?.startsWith('video/')) {
      fileId = msg.document.file_id;
      type = 'animation';
    } else {
      // Delete unsupported message and prompt again
      try { await ctx.deleteMessage(msg.message_id); } catch (e) {}
      const botMsgId = (ctx.wizard.state as any).botMsgId;
      if (botMsgId) {
        await bot.telegram.editMessageText(
          ctx.chat!.id, botMsgId, undefined,
          `❌ Please send a *photo, video, or GIF* — not a sticker.\n\n🏛️ *Step 4: Buy Media*\n\nSend an *Image, Video, or GIF* for the alert, or click Finish.`,
          { parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🏁 Finish Setup', callback_data: 'finish_wizard' }]] }
          } as any
        );
      }
      return;
    }

    console.log(`🏛️ Setup: Media received — type=${type}, fileId=${fileId.slice(0, 20)}...`);

    (ctx.wizard.state as any).buyMedia = { fileId, type };

    // Delete user's media message
    try { await ctx.deleteMessage(ctx.message.message_id); } catch (e) {}
    
    const state = ctx.wizard.state as any;
    if (state.chatId) {
      groupConfigs[state.chatId] = {
        chatId: state.chatId,
        chain: state.chain,
        tokenAddress: state.tokenAddress,
        buyEmoji: state.buyEmoji,
        buyMedia: state.buyMedia,
        minBuyAmount: 0
      };
      syncBuyMonitor();
    }

    const botMsgId = (ctx.wizard.state as any).botMsgId;
    if (botMsgId) {
      await bot.telegram.editMessageText(
        ctx.chat!.id, botMsgId, undefined,
        `🏛️ *SAFU Buy Monitor Configured!* 🦾\n\n\`${state.tokenAddress}\` is now being watched by SAFU. Expect buy alerts.`,
        { parse_mode: 'Markdown' } as any
      );
    }
    return ctx.scene.leave();
  }
);

setupWizard.action('setup_chain_eth', async (ctx) => {
  const chatId = ctx.chat?.id.toString();
  if (chatId) {
    (ctx.wizard.state as any).chatId = chatId;
    (ctx.wizard.state as any).chain = 'eth';
    await safeAnswer(ctx, 'ETH Selected! 🔗');
    
    const botMsgId = (ctx.wizard.state as any).botMsgId;
    if (botMsgId) {
      await bot.telegram.editMessageText(
        ctx.chat!.id, botMsgId, undefined,
        `🏛️ *Step 2: Token Target*\n\nPlease send the *Ethereum Token Address* (Pair or Token) you want to monitor.`,
        { parse_mode: 'Markdown' } as any
      );
    }
    return ctx.wizard.selectStep(1); 
  }
});

setupWizard.action('setup_chain_sol', async (ctx) => {
  const chatId = ctx.chat?.id.toString();
  if (chatId) {
    (ctx.wizard.state as any).chatId = chatId;
    (ctx.wizard.state as any).chain = 'solana';
    await safeAnswer(ctx, 'SOL Selected! 🔗');
    
    const botMsgId = (ctx.wizard.state as any).botMsgId;
    if (botMsgId) {
      await bot.telegram.editMessageText(
        ctx.chat!.id, botMsgId, undefined,
        `🏛️ *Step 2: Token Target*\n\nPlease send the *Solana Token Mint Address* you want to monitor.`,
        { parse_mode: 'Markdown' } as any
      );
    }
    return ctx.wizard.selectStep(1);
  }
});

setupWizard.action('skip_emoji', async (ctx) => {
  await safeAnswer(ctx, 'Skipped! ⏩');
  ctx.wizard.selectStep(3); 

  const botMsgId = (ctx.wizard.state as any).botMsgId;
  if (botMsgId) {
    await bot.telegram.editMessageText(
      ctx.chat!.id, botMsgId, undefined,
      `🏛️ *Step 4: Buy Media*\n\nSend an *Image, Video, or GIF* for the alert, or click Finish.`,
      { parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '🏁 Finish Setup', callback_data: 'finish_wizard' }]] }
      } as any
    );
  }
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
      minBuyAmount: 0
    };
    syncBuyMonitor();
  }
  await safeAnswer(ctx, 'All set! 🏁');

  const botMsgId = (ctx.wizard.state as any).botMsgId;
  if (botMsgId) {
    await bot.telegram.editMessageText(
      ctx.chat!.id, botMsgId, undefined,
      `🏛️ *SAFU Buy Monitor Configured!* 🦾\n\n\`${state.tokenAddress}\` is now being watched by SAFU. Expect buy alerts.`,
      { parse_mode: 'Markdown' } as any
    );
  }
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
        } else if (group.buyMedia.type === 'animation') {
          await bot.telegram.sendAnimation(group.chatId, group.buyMedia.fileId, { caption: messageContent, parse_mode: 'Markdown' });
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



bot.command('setup', async (ctx) => {
  if (ctx.chat.type !== 'private') {
    const isAdmin = await PermissionUtils.isAdminOrOwner(ctx);
    if (!isAdmin) return; // Silent fail for non-admins in group
    
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
    const isAdmin = await PermissionUtils.isAdminOrOwner(ctx);
    if (!isAdmin) return safeAnswer(ctx, '❌ Only Group Admins can access setup.');
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
    `• /help - Show this menu\n\n` +
    `*SAFU V2 Precision:* Structural Buy Detection active. 🦾`
  );
});



bot.on('my_chat_member', async (ctx) => {
  const oldStatus = ctx.myChatMember.old_chat_member.status;
  const newStatus = ctx.myChatMember.new_chat_member.status;

  if (oldStatus !== 'administrator' && newStatus === 'administrator') {
    // Bot was promoted to admin!
    await ctx.replyWithMarkdown(
      `🏛️ *SAFU Bot is ready!* 🛡️\n\n` +
      `I have been granted Admin powers. I'm now ready to power this community.\n\n` +
      `📈 *Trending:* High-velocity momentum tracking.\n` +
      `🎯 *Buy Monitor:* High-precision buy alerts on ETH & SOL.\n\n` +
      `👉 *Admins:* Quick access below:`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback('🛠️ Setup Monitor', 'cmd_setup'),
          Markup.button.callback('📈 View Trending', 'cmd_trending_welcome')
        ],
        [
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
    const { isBotAdmin } = await PermissionUtils.checkAdminAndOwner(ctx);

    if (!isBotAdmin) {
      return ctx.replyWithMarkdown(
        `🏛️ *SAFU Bot has arrived!* 🛡️\n\n` +
        `I need **Administrator privileges** to function correctly.\n\n` +
        `📈 *Trending:* High-velocity momentum tracking.\n` +
        `🎯 *Buy Monitor:* High-precision buy alerts on ETH & SOL.\n\n` +
        `👉 *Admin:* Please promote me to Admin to unlock these features!`
      );
    }
  }
});

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
    { command: 'help', description: '❓ Get Help & Info' }
  ]);
  
  return bot.launch().then(() => console.log('SAFU Bot is running...'));
};

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
