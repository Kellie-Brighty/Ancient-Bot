import { Telegraf, Context, Markup } from 'telegraf';

export class SafeguardModule {
  private static KICK_TIMEOUT = 120000; // 120 seconds
  private static pendingTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private static verifiedUsers: Set<string> = new Set(); // Track users verified via Option 2

  static async handleNewMember(ctx: Context) {
    const newMembers = (ctx.message as any).new_chat_members;
    const botId = ctx.botInfo.id;
    const chatId = ctx.chat!.id.toString();

    for (const member of newMembers) {
      if (member.id === botId) continue;
      
      // If user verified via Option 2, skip the challenge
      if (this.verifiedUsers.has(member.id.toString())) {
        console.log(`Safeguard: User ${member.id} already verified. Skipping challenge.`);
        
        // Friendly welcome for the stealth-verified user
        await ctx.replyWithMarkdown(
          `Welcome [${member.first_name}](tg://user?id=${member.id})! 🏛️\n\n` +
          `Your identity has been verified by *SAFU Gatekeeper*. Enjoy the group!`
        );

        this.verifiedUsers.delete(member.id.toString()); // Clean up
        continue;
      }

      try {
        // Attempt to mute (only works in Supergroups)
        try {
          await ctx.restrictChatMember(member.id, {
            permissions: {
              can_send_messages: false,
              can_send_other_messages: false,
              can_add_web_page_previews: false,
            },
          });
        } catch (restrictError) {
          console.warn(`Safeguard: Could not mute member (basic group or DM). Skipping mute.`);
        }

        const botUsername = ctx.botInfo.username;
        const welcomeMsg = `Welcome [${member.first_name}](tg://user?id=${member.id})! 🏛️\n\nFor security, you must verify your identity privately. Click the button below to start the verification in my DMs.`;
        
        const captchaMsg = await ctx.replyWithMarkdown(
          welcomeMsg,
          Markup.inlineKeyboard([
            [Markup.button.url('🛡️ Click to Verify', `https://t.me/${botUsername}?start=v_${chatId}_${member.id}`)]
          ])
        );

        // Schedule Auto-Kick
        const timeoutKey = `${chatId}:${member.id}`;
        const timeout = setTimeout(async () => {
          try {
            await ctx.telegram.deleteMessage(chatId, captchaMsg.message_id);
            await ctx.banChatMember(member.id);
            await ctx.unbanChatMember(member.id); 
            console.log(`Kicked unverified user ${member.id} from chat ${chatId}`);
            this.pendingTimeouts.delete(timeoutKey);
          } catch (error) {
            console.log(`User ${member.id} probably verified or message already deleted.`);
          }
        }, this.KICK_TIMEOUT);

        this.pendingTimeouts.set(timeoutKey, timeout);

      } catch (error) {
        console.error('Safeguard: Failed to restrict or send captcha:', error);
      }
    }
  }

  static async handleVerification(ctx: Context) {
    const callbackData = (ctx as any).callbackQuery.data;
    const parts = callbackData.split(':');
    const userId = parseInt(parts[1]);
    const groupId = parts[2] ? parts[2] : ctx.chat?.id.toString();
    const clickerId = ctx.from?.id;
    const isPrivateFlow = parts[3] === 'dm';

    if (clickerId !== userId) {
      try {
        return await ctx.answerCbQuery('This challenge is not for you! ❌');
      } catch (e) {
        return;
      }
    }

    // Cancel auto-kick timeout (if any)
    if (groupId) {
      const timeoutKey = `${groupId}:${userId}`;
      const timeout = this.pendingTimeouts.get(timeoutKey);
      if (timeout) {
        clearTimeout(timeout);
        this.pendingTimeouts.delete(timeoutKey);
      }
    }

    try {
      if (isPrivateFlow && groupId) {
        // Option 2: Generate a private invite link
        try {
          // Track verification to skip group challenge later
          this.verifiedUsers.add(userId.toString());
          
          console.log(`Safeguard: ⚔️ Clearing previous bans for ${userId} in ${groupId}`);
          try {
            await ctx.telegram.unbanChatMember(groupId, userId, { only_if_banned: true });
          } catch (e) {
            // Ignore if already unbanned
          }

          console.log(`Safeguard: 🛠️ Generating robust invite for user ${userId} to access group ${groupId}`);
          
          const invite = await ctx.telegram.createChatInviteLink(groupId, {
            name: `SAFU_${userId}_${Date.now()}`
          });
          
          console.log(`Safeguard: ✅ Robust link generated: ${invite.invite_link}`);

          const now = new Date().toLocaleTimeString();
          await ctx.answerCbQuery('Verification successful! 🛡️');
          await ctx.deleteMessage();
          await ctx.reply(
            `✅ *Verification Success!* [${now}]\n\n` +
            `Welcome back, ${ctx.from!.first_name}. You have been approved for entry.\n\n` +
            `[🏛️ Join the Group](${invite.invite_link})\n\n` +
            `_Note: Your previous group restrictions have been cleared._`,
            { 
              parse_mode: 'Markdown',
              disable_web_page_preview: true, 
              link_preview_options: { is_disabled: true } 
            } as any
          );
          return;
        } catch (inviteError: any) {
          console.error(`Safeguard: ❌ Failed to generate invite for ${groupId}:`, inviteError);
          
          // MISSION CRITICAL: Auto-handle group -> supergroup migration
          if (inviteError.description?.includes('upgraded to a supergroup')) {
            const newId = inviteError.parameters?.migrate_to_chat_id;
            
            if (newId) {
              const newIdStr = newId.toString();
              console.log(`Safeguard: 🔄 Auto-migrating verification from ${groupId} to ${newIdStr}`);
              try {
                // Clear ban in the NEW supergroup too
                try {
                  await ctx.telegram.unbanChatMember(newIdStr, userId, { only_if_banned: true });
                } catch (e) {}

                // Retry with the NEW supergroup ID immediately
                const newInvite = await ctx.telegram.createChatInviteLink(newIdStr, {
                  name: `SAFU_Migrate_${userId}_${Date.now()}`
                });

                const nowMigrate = new Date().toLocaleTimeString();
                await ctx.answerCbQuery('Success! (Group Upgraded) 🛡️');
                await ctx.deleteMessage();
                await ctx.reply(
                  `✅ *Verification Success!* [${nowMigrate}]\n\n` +
                  `Your group was recently upgraded. Use this fresh link to join into the new Supergroup:\n\n` +
                  `[🏛️ Join the Group](${newInvite.invite_link})`,
                  { 
                    parse_mode: 'Markdown',
                    disable_web_page_preview: true,
                    link_preview_options: { is_disabled: true } 
                  } as any
                );
                return;
              } catch (retryError) {
                console.error('Safeguard: ❌ Auto-migration retry failed:', retryError);
              }
            }
            
            const helpText = newId 
              ? `Note: This group was recently upgraded. Please ask an admin to run /getlink again with ID: \`${newId}\``
              : `Note: This group was recently upgraded. Admins must run /getlink again inside the group.`;
            
            return ctx.reply(`❌ Verification successful, but the group link is outdated.\n\n${helpText}`, { parse_mode: 'Markdown' });
          }

          return ctx.reply('❌ Verification successful, but I failed to generate an invite link. Please contact an admin.');
        }
      }

      // Option 1: Unmute in existing group
      if (groupId && groupId !== ctx.chat?.id.toString()) {
        try {
          await ctx.telegram.restrictChatMember(groupId, userId, {
            permissions: {
              can_send_messages: true,
              can_send_other_messages: true,
              can_add_web_page_previews: true,
            },
          });
        } catch (e) {
          console.warn(`Safeguard: Could not unmute in ${groupId}.`);
        }
      } else if (ctx.chat?.type === 'supergroup') {
        try {
          await ctx.restrictChatMember(userId, {
            permissions: {
              can_send_messages: true,
              can_send_other_messages: true,
              can_add_web_page_previews: true,
            },
          });
        } catch (e) {
          console.warn('Safeguard: Could not unmute locally.');
        }
      }

      await ctx.answerCbQuery('Verification successful! 🛡️');
      await ctx.deleteMessage();
      ctx.reply(`Verification successful for ${ctx.from!.first_name}! Welcome to the group.`);
    } catch (error) {
      console.error('Safeguard: Verification failed:', error);
      try {
        await ctx.answerCbQuery('Failed to verify. Please contact an admin.');
      } catch (e) {}
    }
  }
}
