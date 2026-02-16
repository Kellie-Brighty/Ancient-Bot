import { db } from '../config/firebase';
import { GroupConfig, TrendingToken } from '../types/index';

export class FirestoreService {
  private static GROUPS_COLLECTION = 'groups';
  private static TRENDING_COLLECTION = 'trending';

  static async saveGroupConfig(config: GroupConfig) {
    if (!db) return;
    await db.collection(this.GROUPS_COLLECTION).doc(config.chatId).set(config, { merge: true });
    console.log(`Saved config for group ${config.chatId}`);
  }

  static async getGroupConfig(chatId: string): Promise<GroupConfig | null> {
    if (!db) return null;
    const doc = await db.collection(this.GROUPS_COLLECTION).doc(chatId).get();
    return doc.exists ? (doc.data() as GroupConfig) : null;
  }

  static async updateTrendingToken(token: TrendingToken) {
    if (!db) return;
    await db.collection(this.TRENDING_COLLECTION).doc(token.tokenAddress).set(token, { merge: true });
  }

  static async getTopTrending(limit: number = 10): Promise<TrendingToken[]> {
    if (!db) return [];
    const snapshot = await db.collection(this.TRENDING_COLLECTION)
      .orderBy('score', 'desc')
      .limit(limit)
      .get();
    
    return snapshot.docs.map((doc: any) => doc.data() as TrendingToken);
  }
}
