import * as dotenv from 'dotenv';
dotenv.config();

export interface SecurityResult {
  isSafe: boolean;
  risks: string[];
  score: 'SAFE' | 'CAUTION' | 'DANGER';
  summary: string;
}

const GOPLUS_BASE = 'https://api.gopluslabs.io/api/v1';

export class GoPlusScanner {

  /**
   * Scan a token contract for security risks.
   * @param tokenAddress - The contract address to scan.
   * @param chain - 'eth' or 'solana'.
   */
  static async scan(tokenAddress: string, chain: 'eth' | 'solana'): Promise<SecurityResult> {
    const chainId = chain === 'eth' ? '1' : 'solana';
    const url = `${GOPLUS_BASE}/token_security/${chainId}?contract_addresses=${tokenAddress}`;

    try {
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' }
      });

      const data = await res.json();

      if (data.code !== 1 || !data.result) {
        return { isSafe: true, risks: [], score: 'SAFE', summary: '✅ No data available (new token?)' };
      }

      const key = Object.keys(data.result)[0];
      if (!key) {
        return { isSafe: true, risks: [], score: 'SAFE', summary: '✅ No data available' };
      }

      const token = data.result[key];
      const risks: string[] = [];

      // --- ETH-specific checks ---
      if (chain === 'eth') {
        if (token.is_honeypot === '1') risks.push('🍯 Honeypot (Cannot Sell)');
        if (token.is_mintable === '1') risks.push('🖨️ Mintable (Dev can print tokens)');
        if (token.owner_change_balance === '1') risks.push('⚠️ Owner can change balances');
        if (token.can_take_back_ownership === '1') risks.push('🔓 Ownership can be reclaimed');
        if (token.is_blacklisted === '1') risks.push('🚫 Has Blacklist function');
        if (token.cannot_sell_all === '1') risks.push('📉 Cannot sell all tokens');
        if (token.trading_cooldown === '1') risks.push('⏳ Trading cooldown enabled');

        const buyTax = parseFloat(token.buy_tax || '0');
        const sellTax = parseFloat(token.sell_tax || '0');
        if (buyTax > 0.1) risks.push(`💸 High Buy Tax: ${(buyTax * 100).toFixed(1)}%`);
        if (sellTax > 0.1) risks.push(`💸 High Sell Tax: ${(sellTax * 100).toFixed(1)}%`);
      }

      // --- SOL-specific checks ---
      if (chain === 'solana') {
        if (token.is_honeypot === '1') risks.push('🍯 Honeypot (Cannot Sell)');
        if (token.mintable?.status === '1') risks.push('🖨️ Mint Authority Active');
        if (token.freezable?.status === '1') risks.push('🧊 Freeze Authority Active');
        if (token.is_mutable === '1') risks.push('✏️ Metadata is Mutable');
        if (token.default_account_state_enabled === '1') risks.push('⚠️ Default account state enabled');
      }

      // --- Determine score ---
      const hasCritical = risks.some(r => r.includes('Honeypot') || r.includes('change balances') || r.includes('reclaimed'));
      let score: SecurityResult['score'] = 'SAFE';
      let summary = '✅ Contract looks clean. No major risks detected.';

      if (risks.length > 0 && !hasCritical) {
        score = 'CAUTION';
        summary = `⚠️ ${risks.length} risk(s) found. Proceed with caution.`;
      }
      if (hasCritical) {
        score = 'DANGER';
        summary = `🚨 CRITICAL RISK DETECTED. This token may be malicious.`;
      }

      return { isSafe: risks.length === 0, risks, score, summary };
    } catch (error) {
      console.error('🛡️ GoPlus Scanner Error:', error);
      return { isSafe: true, risks: [], score: 'SAFE', summary: '⚠️ Scan unavailable. Proceed with caution.' };
    }
  }

  /**
   * Format a security result into a Telegram-ready string.
   */
  static formatResult(result: SecurityResult): string {
    const badge = result.score === 'SAFE' ? '✅' : result.score === 'CAUTION' ? '⚠️' : '🚨';
    let msg = `${badge} *SAFU Security Scan*\n\n`;
    msg += `*Verdict:* ${result.summary}\n`;

    if (result.risks.length > 0) {
      msg += `\n*Risks Found:*\n`;
      result.risks.forEach(r => { msg += `  • ${r}\n`; });
    }

    return msg;
  }

  /**
   * Get a short badge for trending display.
   */
  static getBadge(result: SecurityResult): string {
    if (result.score === 'DANGER') return '🚨 DANGER';
    if (result.score === 'CAUTION') return '⚠️ CAUTION';
    return '';
  }
}
