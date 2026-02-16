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

  static async checkAdminAndOwner(ctx: Context): Promise<{ isBotAdmin: boolean, isOwner: boolean }> {
    const [botAdmin, userOwner] = await Promise.all([
      this.isBotAdmin(ctx),
      this.isUserOwner(ctx)
    ]);
    return { isBotAdmin: botAdmin, isOwner: userOwner };
  }
}
