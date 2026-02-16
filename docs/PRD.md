# Ancient Bot: Product Requirements Document (PRD)

## 1. Executive Summary

Ancient Bot is a comprehensive cross-chain security and intelligence suite designed for Telegram communities. It solves the fragmentation of current tools by combining advanced group security (Safeguard Plus) with multi-chain "Smart Buy" alerts (ETH/SOL) and real-time capital flow intelligence.

## 2. Problem Statement

- **Fragmented Tools**: Group admins currently need 3-4 different bots for security, buy alerts, and trending stats.
- **Low-Context Alerts**: Standard buy bots only show volume, not _who_ is buying or where they are coming from.
- **Sophisticated Botting**: Basic captchas are easily bypassed by modern raid bots.

**Why Now?** The rapid shift of capital between Solana and Ethereum/Base requires a unified intelligence layer that helps users track "smart money" transitions in real-time.

## 3. Target Users

- **Primary Persona**: Crypto Group Admins & Community Managers who need to secure their groups while driving engagement.
- **Secondary Persona**: Active De-Fi Traders looking for high-conviction buy signals based on developer reputation and holder overlap.

## 4. Solution Overview

Ancient Bot provides a single "Command Center" for Telegram communities.

- **Value Prop**: Total security meet high-signal intelligence.
- **Differentiators**: Cross-chain capital flow tracking and "Developer Reputation" scoring.

## 5. Feature Requirements

### MVP (P0)

- **Safeguard**: Join captcha (Inline Keyboard) and mute/unmute logic.
- **Multi-Chain Buy Bot**: Watcher for ETH (Uniswap) and SOL (Raydium) swaps.
- **Firebase Persistence**: Store group configs and verified user states.
- **Trending System**: Basic scoring (+1 per buy, +10 for whales) with leaderboards.

### Phase 2 (P1)

- **Holder Overlap**: Show what % of buyers hold other trending tokens.
- **Dev Rep**: Flag developers with previous rug/exploit history.
- **Cross-Chain Dashboard**: Capital flow metrics between ETH and SOL.

## 6. User Stories

1. As an admin, I want to restrict new members so that raid bots cannot spam my group. Ancient Bot should handle this automatically.
2. As a trader, I want to see "Smart Buy" alerts so that I can follow high-conviction tokens.
3. As a developer, I want to see which tokens are trending so that I can gauge market sentiment.

## 7. Technical Considerations

- **Stack**: TypeScript, Node.js, Express, Firebase Firestore.
- **Integrations**: Telegraf.js, Alchemy (ETH), Helius (SOL), DexScreener API.
- **Scalability**: Use background watchers (listeners) separate from the Express webhook handler.

## 8. Success Metrics

- **North Star**: Number of active groups using Ancient for security.
- **Leading Indicator**: Frequency of `/trending` command calls.

---

## 9. Implementation Plan (Architecture)

### Tech Stack

- **Bot Engine**: Telegraf.js
- **Backend/API**: Node.js/Express
- **Database**: Firebase Firestore (Real-time updates, simple schema)
- **Chain Watchers**: Ethers.js (ETH), Solana Web3.js + Helius Webhooks (SOL)

### Phases

1. **Foundation**: Types, Firebase Setup, Basic Telegraf setup for Ancient Bot.
2. **Security**: Safeguard module (Join/Captcha).
3. **Analytics**: Buy Listeners (ETH/SOL).
4. **Trending**: Scoring and Leaderboard logic.
