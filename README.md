# SAFU Bot 🛡️💎🦾

SAFU Bot is a high-performance, professional-grade Telegram community management and buy alert system. It features **100% accurate structural buy detection** for both Solana and Ethereum, a guided setup wizard, and robust security modules.

## 🚀 Key Features

### 🏛️ Multi-Chain Precision Sniper

- **Balance-Check Logic**: 100% accurate buy detection on Solana and Ethereum. No "keyword guessing"—the bot analyzes actual movement of SOL/ETH and Tokens on the blockchain.
- **Zero-Noise Monitoring**: Built-in **Dust Filters** ($1 threshold for SOL/ETH) to ignore bot spam and prevent Telegram rate limiting.
- **Live Analytics**: Integrated with DexScreener for real-time symbols, USD prices, and Market Cap data.
- **Multi-DEX Support**: Automatically detects trades on Raydium, Pump.fun, Jupiter, Uniswap V2, and more.
- **Holder Check**: Automatic `🆕 New Holder` detection on Solana.

### 🛡️ Safeguard Security

- **Anti-Bot Captcha**: Protect your group from raids with an automated verification system.
- **Member Verification**: New members are automatically restricted until they verify via a secure DM flow.
- **Stability Headers**: Hardened for the Bun runtime to prevent memory crashes.

### 🧙‍♂️ Guided Setup Wizard

- **Interactive 4-Step Flow**:
  1.  **Network**: Select SOL or ETH.
  2.  **Target**: Paste the Token Address.
  3.  **Branding**: Set a custom **Buy Emoji**.
  4.  **Media**: Set a high-fidelity **Photo or Video** for alerts.
- **Activation Control**: Monitoring starts only after you finish the wizard.

## 🛠️ Technical Stack

- **Runtime**: [Bun](https://bun.sh) (Ultra-fast JavaScript/TypeScript runtime)
- **Framework**: [Telegraf](https://telegraf.js.org/) (Telegram Bot API)
- **Solana**: [@solana/web3.js](https://solana-labs.github.io/solana-web3.js/)
- **Ethereum**: [ethers.js](https://docs.ethers.org/v6/)
- **Database**: Firebase Firestore (Ready for scaling)

## 📦 Installation

1.  **Clone the Repository**:

    ```bash
    git clone https://github.com/Kellie-Brighty/Ancient-Bot.git
    cd Ancient-Bot
    ```

2.  **Install Dependencies**:

    ```bash
    bun install
    ```

3.  **Configure Environment**:
    Create a `.env` file based on `.env.example`:

    ```env
    BOT_TOKEN=your_telegram_bot_token
    SOL_RPC_URL=your_solana_rpc
    ETH_RPC_URL=your_ethereum_rpc
    ```

4.  **Run Development**:
    ```bash
    bun dev
    ```

## 📜 Usage

1.  Add the bot to your Telegram group and make it an Admin.
2.  Use `/setup` to launch the guided wizard.
3.  Configure your chain, token, and premium visuals.
4.  Use `/safu_trending` to view the **Trending Leaderboard**.
5.  Ready to rock! 🛡️💎🦾

## 🛡️ License

MIT License. Created by SAFU.
