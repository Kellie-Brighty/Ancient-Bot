import { Chain } from '../types';

export class ChainUtils {
  static identifyChain(address: string): Chain {
    // Ethereum: Starts with 0x, exactly 42 characters total
    if (/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return 'eth';
    }
    
    // Solana: Base58, usually 32-44 characters
    // Basic check for alphanumeric without 0, O, I, l (Base58 characters)
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
      return 'solana';
    }

    return 'solana'; // Default to solana for SAFU Bot primary focus if ambiguous
  }
}
