import { Context } from 'telegraf';

export class PermissionUtils {
  static async isBotAdmin(ctx: Context): Promise<boolean> {
    if (ctx.chat?.type === 'private') return true;
    try {
      const me = await ctx.getChatMember(ctx.botInfo.id);
      return me.status === 'administrator';
    } catch (e) {
      return false;
    }
  }

  static async isUserOwner(ctx: Context, userId?: number): Promise<boolean> {
    if (ctx.chat?.type === 'private') return true;
    const targetId = userId || ctx.from?.id;
    if (!targetId) return false;

    try {
      const member = await ctx.getChatMember(targetId);
      return member.status === 'creator';
    } catch (e) {
      return false;
    }
  }

  static async isAdminOrOwner(ctx: Context, userId?: number): Promise<boolean> {
    if (ctx.chat?.type === 'private') return true;

    // Allow anonymous group admins (they send as the chat itself)
    if (ctx.senderChat?.id === ctx.chat?.id) return true;
    
    // Allow linked channel auto-forwards (which appear as automatic forwarded messages)
    if ((ctx.message as any)?.is_automatic_forward) return true;

    const targetId = userId || ctx.from?.id;
    if (!targetId) return false;

    try {
      const member = await ctx.getChatMember(targetId);
      return member.status === 'administrator' || member.status === 'creator';
    } catch (e) {
      return false;
    }
  }

  static async checkAdminAndOwner(ctx: Context): Promise<{ isBotAdmin: boolean, isOwner: boolean }> {
    const [botAdmin, userOwner] = await Promise.all([
      this.isBotAdmin(ctx),
      this.isUserOwner(ctx)
    ]);
    return { isBotAdmin: botAdmin, isOwner: userOwner };
  }
}
