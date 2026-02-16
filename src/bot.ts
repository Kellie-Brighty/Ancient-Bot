import { Telegraf, Context, Markup } from 'telegraf';
import * as dotenv from 'dotenv';
import type { GroupConfig, BuyAlert } from './types/index';
import { SafeguardModule } from './modules/safeguard';
import { SolWatcher } from './listeners/solWatcher';
import { EthWatcher } from './listeners/ethWatcher';

dotenv.config();

const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error('BOT_TOKEN must be provided!');
}

const bot = new Telegraf(token);

// Initialize Watchers
const solWatcher = new SolWatcher();
const ethWatcher = new EthWatcher();

// In-memory config for now
const groupConfigs: Record<string, GroupConfig> = {};
const awaitingConfig: Record<number, { chatId: string, step: 'token' | 'emoji' | 'media' }> = {};

// --- Buy Alert Broadcaster ---

const broadcastBuyAlert = async (alert: BuyAlert) => {
  // Find groups watching this chain AND this specific token
  const targetGroups = Object.values(groupConfigs).filter(
    config => 
      config.chain === alert.chain && 
      config.tokenAddress &&
      config.tokenAddress.toLowerCase() === alert.tokenAddress.toLowerCase()
  );

  if (targetGroups.length === 0) return;

  for (const group of targetGroups) {
    try {
      const emoji = group.buyEmoji || '🟢';
      const emojiString = emoji.repeat(15); 

      const explorerUrl = alert.chain === 'solana' 
        ? `https://solscan.io/account/${alert.buyer}`
        : `https://etherscan.io/address/${alert.buyer}`;
      
      const txUrl = alert.chain === 'solana'
        ? `https://solscan.io/tx/${alert.txnHash}`
        : `https://etherscan.io/tx/${alert.txnHash}`;

      const screenerUrl = alert.chain === 'solana'
        ? `https://dexscreener.com/solana/${alert.tokenAddress}`
        : `https://dexscreener.com/ethereum/${alert.tokenAddress}`;

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
          await bot.telegram.sendPhoto(group.chatId, group.buyMedia.fileId, {
            caption: messageContent,
            parse_mode: 'Markdown'
          });
        } else {
          await bot.telegram.sendVideo(group.chatId, group.buyMedia.fileId, {
            caption: messageContent,
            parse_mode: 'Markdown'
          });
        }
      } else {
        await bot.telegram.sendMessage(group.chatId, messageContent, {
          parse_mode: 'Markdown',
          link_preview_options: { is_disabled: true }
        } as any);
      }
    } catch (e) {
      console.error(`Failed to send alert to ${group.chatId}:`, e);
    }
  }
};

const syncSniper = async () => {
  const solTokens = Object.values(groupConfigs)
    .filter(c => c.chain === 'solana')
    .map(c => c.tokenAddress)
    .filter(t => t && t.length >= 32);

  const ethTokens = Object.values(groupConfigs)
    .filter(c => c.chain === 'eth')
    .map(c => c.tokenAddress)
    .filter(t => t && t.startsWith('0x'));
  
  await solWatcher.updateWatchList(solTokens);
  await ethWatcher.updateWatchList(ethTokens);
};

// Start Listeners
solWatcher.startListening(broadcastBuyAlert).catch(console.error);
ethWatcher.startListening(broadcastBuyAlert).catch(console.error);
syncSniper(); // Initial sync

// --- Error Handling ---

bot.catch((err: any, ctx: Context) => {
  console.error(`Error for ${ctx.updateType}:`, err);
  // Prevent crash on minor Telegram errors
  if (err?.description?.includes('query is too old')) return;
});

// Helper for safe callback answering
const safeAnswer = async (ctx: any, text?: string) => {
  try {
    await ctx.answerCbQuery(text);
  } catch (e) {
    // Ignore expired queries
  }
};

// --- Commands ---

bot.start(async (ctx) => {
  const payload = (ctx as any).startPayload;

  if (payload && payload.startsWith('v_')) {
    // Option 1: Deep-linked mute verification: v_{chatId}_{userId}
    const parts = payload.split('_');
    const chatId = parts[1];
    const userId = parts[2];

    if (ctx.from?.id.toString() !== userId) {
      return ctx.reply('❌ This verification link is not for you.');
    }

    return ctx.reply(
      '🛡️ *Identity Verification*\n\nPlease click the button below to confirm you are human and gain full access to the group.',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('I am Human 🛡️', `verify:${userId}:${chatId}`)]
        ])
      }
    );
  }

  if (payload && payload.startsWith('j_')) {
    // Option 2: Private Invite Flow: j_{chatId}
    const groupId = payload.split('_')[1];
    const userId = ctx.from?.id;

    return ctx.reply(
      '🏛️ *Welcome to Ancient Gatekeeper*\n\nYou are requesting entry to a protected group. Please verify you are human to receive your invite link.',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🛡️ I am Human', `verify:${userId}:${groupId}:dm`)]
        ])
      }
    );
  }

  const welcomeText = 
    `🏛️ *Welcome to Ancient Bot* 🏛️\n\n` +
    `The ultimate all-in-one suite for Telegram community security and cross-chain intelligence.\n\n` +
    `🚀 *Core Features:*\n` +
    `• *Safeguard Plus*: AI-powered captcha and auto-kick for raid protection.\n` +
    `• *Smart Buy Alerts*: Multi-chain (ETH/SOL) monitoring with whale detection.\n` +
    `• *Nexus Trending*: Data-driven leaderboard based on volume and social engagement.\n\n` +
    ` Ready to level up your group?\n` +
    `• Use /setup to configure your chat.\n` +
    `• Use /getlink to generate a secure, private invitation link.\n\n` +
    `Click below to start the configuration.`;

  ctx.replyWithMarkdown(
    welcomeText,
    Markup.inlineKeyboard([
      [Markup.button.callback('🛠️ Launch Setup', 'cmd_setup')],
      [Markup.button.url('📚 View Docs', 'https://github.com')],
    ])
  );
});

bot.command('setup', async (ctx) => {
  sendSetupMenu(ctx);
});

bot.command('getlink', async (ctx) => {
  if (ctx.chat.type === 'private') {
    return ctx.reply('❌ This command must be used inside a group.');
  }

  // Check if user is admin
  const admins = await ctx.getChatAdministrators();
  const isAdmin = admins.some(admin => admin.user.id === ctx.from!.id);
  
  if (!isAdmin) {
    return ctx.reply('❌ Only group administrators can use this command.');
  }

  const chatId = ctx.chat.id.toString();
  const botUsername = ctx.botInfo.username;
  const link = `https://t.me/${botUsername}?start=j_${chatId}`;

  console.log(`Bot Settings: 🛠️ Generating deep-link for Group ID: ${chatId}`);

  ctx.reply(
    `🏛️ *Ancient Gatekeeper Link*\n\nShare this link to invite new members. They will be required to verify in my DMs before receiving an entry link.\n\n\`${link}\``,
    { parse_mode: 'Markdown' }
  );
});

bot.action('cmd_setup', async (ctx) => {
  await safeAnswer(ctx);
  sendSetupMenu(ctx);
});

function sendSetupMenu(ctx: Context) {
  try {
    ctx.reply(
      `🏛️ *Ancient Setup Wizard: Step 1*\n\nWelcome to the Ancient Sniper setup. First, select the network you want to monitor in this group:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔗 Ethereum (ETH)', 'setup_chain_eth')],
          [Markup.button.callback('🔗 Solana (SOL)', 'setup_chain_sol')],
        ])
      }
    );
  } catch (e) {
    console.error('Failed to send setup menu:', e);
  }
}

// --- Action Handlers ---

bot.action('setup_chain_eth', async (ctx) => {
  const chatId = ctx.chat?.id.toString();
  const userId = ctx.from?.id;
  if (chatId && userId) {
    groupConfigs[chatId] = { ...(groupConfigs[chatId] || { safeguardEnabled: false, welcomeMessage: '', tokenAddress: '', minBuyAmount: 0 }), chatId, chain: 'eth' };
    awaitingConfig[userId] = { chatId, step: 'token' };
    await safeAnswer(ctx, 'ETH Selected! 🔗');
    ctx.reply('🏛️ *Step 2: Token Target*\n\nPlease send the **Ethereum Token Address** (Pair or Token) you want to monitor.', { parse_mode: 'Markdown' });
  }
});

bot.action('setup_chain_sol', async (ctx) => {
  const chatId = ctx.chat?.id.toString();
  const userId = ctx.from?.id;
  if (chatId && userId) {
    groupConfigs[chatId] = { ...(groupConfigs[chatId] || { safeguardEnabled: false, welcomeMessage: '', tokenAddress: '', minBuyAmount: 0 }), chatId, chain: 'solana' };
    awaitingConfig[userId] = { chatId, step: 'token' };
    await safeAnswer(ctx, 'SOL Selected! 🔗');
    ctx.reply('🏛️ *Step 2: Token Target*\n\nPlease send the **Solana Token Mint Address** you want to monitor.', { parse_mode: 'Markdown' });
  }
});

bot.action('skip_emoji', async (ctx) => {
  const userId = ctx.from?.id;
  if (userId && awaitingConfig[userId]) {
    awaitingConfig[userId].step = 'media';
    await safeAnswer(ctx, 'Skipped! ⏩');
    ctx.reply('🏛️ *Step 4: Buy Media*\n\nSend an **Image or Video** for the alert, or click Finish below to use the default view.', 
      Markup.inlineKeyboard([[Markup.button.callback('🏁 Finish Setup', 'finish_wizard')]]));
  }
});

bot.action('finish_wizard', async (ctx) => {
  const userId = ctx.from?.id;
  if (userId) {
    const state = awaitingConfig[userId];
    if (state) {
      // Final Sync before closing
      syncSniper();
    }
    delete awaitingConfig[userId];
    await safeAnswer(ctx, 'All set! 🏁');
    
    ctx.reply('🏛️ *Ancient Sniper Configured!* 🦾\n\nYour bot is now live. Would you also like to enable the **Safeguard** (Member Verification) for this group?', 
      Markup.inlineKeyboard([
        [Markup.button.callback('🛡️ Enable Safeguard', 'enable_safeguard_final')],
        [Markup.button.callback('❌ No, skip for now', 'close_wizard')]
      ]));
  }
});

bot.action('enable_safeguard_final', async (ctx) => {
  const chatId = ctx.chat?.id.toString();
  if (chatId && groupConfigs[chatId]) {
    groupConfigs[chatId].safeguardEnabled = true;
    await safeAnswer(ctx, 'Safeguard Enabled! 🛡️');
    ctx.reply('✅ *Safeguard Active.* New members must now verify to speak.');
  }
});

bot.action('close_wizard', async (ctx) => {
  await safeAnswer(ctx);
  ctx.reply('👍 *Wizard Closed.* You can always change settings with /setup.');
});

// Capture Wizard Input (Text)
bot.on('text', async (ctx, next) => {
  const userId = ctx.from?.id;
  const state = awaitingConfig[userId];
  if (!state || ctx.chat.id.toString() !== state.chatId) return next();

  if (state.step === 'token') {
    const tokenAddress = ctx.message.text.trim();
    if (tokenAddress.length < 32) return ctx.reply('❌ Invalid address.');
    
    groupConfigs[state.chatId].tokenAddress = tokenAddress;
    state.step = 'emoji';
    
    return ctx.reply('🏛️ *Step 3: Custom Emoji*\n\nSend a **single emoji** to use for the buy progress bar, or click Skip.', 
      Markup.inlineKeyboard([[Markup.button.callback('⏩ Skip Emoji', 'skip_emoji')]]));
  }

  if (state.step === 'emoji') {
    const emoji = ctx.message.text.trim();
    groupConfigs[state.chatId].buyEmoji = emoji;
    state.step = 'media';
    
    return ctx.reply('🏛️ *Step 4: Buy Media*\n\nSend an **Image or Video** for the alert, or click Finish below.', 
      Markup.inlineKeyboard([[Markup.button.callback('🏁 Finish Setup', 'finish_wizard')]]));
  }
  
  return next();
});

// Capture Wizard Input (Media)
bot.on(['photo', 'video'], async (ctx, next) => {
  const userId = ctx.from?.id;
  const state = awaitingConfig[userId];
  if (!state || state.step !== 'media' || ctx.chat.id.toString() !== state.chatId) return next();

  let fileId = '';
  let type: 'photo' | 'video' = 'photo';
  if ('photo' in ctx.message) {
    fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    type = 'photo';
  } else if ('video' in ctx.message) {
    fileId = ctx.message.video.file_id;
    type = 'video';
  }

  groupConfigs[state.chatId].buyMedia = { fileId, type };
  
  // Final Sync for Media
  syncSniper();
  
  delete awaitingConfig[userId];

  return ctx.reply('🏛️ *Setup Complete!* 🦾\n\nEverything is locked in. Would you like to enable the **Safeguard** (Member Verification)?', 
    Markup.inlineKeyboard([
      [Markup.button.callback('🛡️ Enable Safeguard', 'enable_safeguard_final')],
      [Markup.button.callback('❌ No, skip for now', 'close_wizard')]
    ]));
});

// --- Events ---

bot.on('new_chat_members', async (ctx) => {
  if (ctx.botInfo.id === ctx.message.new_chat_members[0].id) {
    ctx.reply('Ancient Bot is here! Secure your group with /setup.');
  }
  await SafeguardModule.handleNewMember(ctx);
});

bot.action(/verify:(.+)/, async (ctx) => {
  await SafeguardModule.handleVerification(ctx);
});

// --- Start Bot ---

export const launchBot = () => {
  bot.launch().then(() => {
    console.log('Ancient Bot is running...');
  });
};

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
