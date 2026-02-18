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
    // For Solana, try RugCheck first (better coverage), then GoPlus fallback
    if (chain === 'solana') {
      const rugResult = await this.scanWithRugCheck(tokenAddress);
      if (rugResult) return rugResult;
    }

    // GoPlus scan (primary for ETH, fallback for SOL)
    return this.scanWithGoPlus(tokenAddress, chain);
  }

  /**
   * RugCheck.xyz scanner for Solana tokens (better SPL coverage).
   */
  private static async scanWithRugCheck(tokenAddress: string): Promise<SecurityResult | null> {
    const url = `https://api.rugcheck.xyz/v1/tokens/${tokenAddress}/report/summary`;
    try {
      console.log(`🛡️ RugCheck: Scanning SOL token: ${tokenAddress}`);
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!res.ok) {
        console.log(`🛡️ RugCheck: HTTP ${res.status} — falling back to GoPlus`);
        return null;
      }

      const data = await res.json();
      console.log(`🛡️ RugCheck: Response received. Score: ${data.score}, Risks: ${data.risks?.length || 0}`);

      const risks: string[] = [];

      // Parse RugCheck risk array
      if (data.risks && Array.isArray(data.risks)) {
        for (const risk of data.risks) {
          const name = risk.name || risk.description || 'Unknown risk';
          const level = risk.level || '';
          if (level === 'danger' || level === 'critical') {
            risks.push(`🚨 ${name}`);
          } else if (level === 'warn' || level === 'warning') {
            risks.push(`⚠️ ${name}`);
          }
        }
      }

      // Determine score
      const hasCritical = risks.some(r => r.includes('🚨'));
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
      console.error('🛡️ RugCheck Error:', error);
      return null;
    }
  }

  /**
   * GoPlus scanner (primary for ETH).
   */
  private static async scanWithGoPlus(tokenAddress: string, chain: 'eth' | 'solana'): Promise<SecurityResult> {
    const chainId = chain === 'eth' ? '1' : 'solana';
    const url = `${GOPLUS_BASE}/token_security/${chainId}?contract_addresses=${tokenAddress}`;

    try {
      console.log(`🛡️ GoPlus: Scanning ${chain.toUpperCase()} token: ${tokenAddress}`);
      console.log(`🛡️ GoPlus: URL -> ${url}`);

      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' }
      });

      const data = await res.json();
      console.log(`🛡️ GoPlus: Response code=${data.code}, message=${data.message || 'none'}`);
      console.log(`🛡️ GoPlus: Raw result keys:`, data.result ? Object.keys(data.result) : 'NO RESULT');

      if (data.code !== 1 || !data.result) {
        console.log(`🛡️ GoPlus: No valid response. Full body:`, JSON.stringify(data).substring(0, 500));
        return { isSafe: true, risks: [], score: 'SAFE', summary: '✅ No data available (new token?)' };
      }

      const key = Object.keys(data.result)[0];
      if (!key) {
        console.log(`🛡️ GoPlus: Result object empty. Token may be too new.`);
        return { isSafe: true, risks: [], score: 'SAFE', summary: '✅ No data available' };
      }

      const token = data.result[key];
      console.log(`🛡️ GoPlus: Token data found. Keys:`, Object.keys(token).join(', '));
      const risks: string[] = [];

      // --- ETH-specific checks ---
      if (chain === 'eth') {
        // Check if contract is renounced (owner is zero address)
        const isRenounced = !token.owner_address || 
          token.owner_address === '0x0000000000000000000000000000000000000000' ||
          token.owner_address === '0x000000000000000000000000000000000000dead';

        // ALWAYS dangerous — these don't depend on ownership
        if (token.is_honeypot === '1') risks.push('🍯 Honeypot (Cannot Sell)');
        if (token.can_take_back_ownership === '1') risks.push('🔓 Ownership can be reclaimed');
        if (token.hidden_owner === '1') risks.push('👤 Hidden Owner detected');
        if (token.selfdestruct === '1') risks.push('💀 Contract can self-destruct');
        if (token.cannot_sell_all === '1') risks.push('📉 Cannot sell all tokens');
        if (token.cannot_buy === '1') risks.push('🚫 Cannot buy this token');
        if (token.owner_change_balance === '1') risks.push('⚠️ Owner can change balances');
        if (token.is_proxy === '1') risks.push('🔄 Upgradeable proxy contract');

        // Owner-dependent flags — ONLY flag if NOT renounced
        if (!isRenounced) {
          if (token.is_mintable === '1') risks.push('🖨️ Mintable (Dev can print tokens)');
          if (token.is_blacklisted === '1') risks.push('🚫 Has Blacklist function');
          if (token.transfer_pausable === '1') risks.push('⏸️ Transfers can be paused');
          if (token.slippage_modifiable === '1') risks.push('📊 Slippage can be modified');
          if (token.personal_slippage_modifiable === '1') risks.push('🎯 Per-user slippage control');
          if (token.is_whitelisted === '1') risks.push('📋 Has Whitelist function');
          if (token.external_call === '1') risks.push('📡 External contract calls');
          if (token.trading_cooldown === '1') risks.push('⏳ Trading cooldown enabled');
        }

        // Anti-whale is PROTECTIVE — never flag it
        // if (token.is_anti_whale === '1') — intentionally skipped

        // Tax checks — always relevant (hardcoded in contract)
        const buyTax = parseFloat(token.buy_tax || '0');
        const sellTax = parseFloat(token.sell_tax || '0');
        if (buyTax > 0.1) risks.push(`💸 High Buy Tax: ${(buyTax * 100).toFixed(1)}%`);
        if (sellTax > 0.1) risks.push(`💸 High Sell Tax: ${(sellTax * 100).toFixed(1)}%`);

        if (isRenounced && risks.length === 0) {
          console.log(`🛡️ GoPlus: Token is renounced + clean ✅`);
        }
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
      const hasCritical = risks.some(r => 
        r.includes('Honeypot') || r.includes('change balances') || r.includes('reclaimed') ||
        r.includes('self-destruct') || r.includes('Cannot Sell') || r.includes('Cannot buy')
      );
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
