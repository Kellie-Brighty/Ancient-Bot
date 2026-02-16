import express from 'express';
import * as dotenv from 'dotenv';
import { launchBot, bot } from './bot';
import { AnnouncementModule } from './modules/announcementModule';

dotenv.config();

// --- NUCLEAR BUN PATCH ---
// Problem: Telegraf tries to redact your bot token in error messages by writing to a read-only 'message' property.
// Bun's strict memory model prevents this, causing a 'TypeError: Attempted to assign to readonly property' crash.
// Solution: We forcefully unlock the 'message' property on Error.prototype before the bot starts.
try {
  const originalDescriptor = Object.getOwnPropertyDescriptor(Error.prototype, 'message');
  if (originalDescriptor && !originalDescriptor.writable) {
    Object.defineProperty(Error.prototype, 'message', {
      writable: true,
      configurable: true
    });
    console.log('🛡️  Stability: Bun/Telegraf memory bridge established.');
  }
} catch (e) {
  console.warn('⚠️  Stability: Failed to apply memory bridge, but proceeding anyway.');
}

// Fix for general Bun + Telegraf redaction logic
const handleBunCrash = (err: any) => {
  if (err?.message?.includes('Attempted to assign to readonly property') && err?.stack?.includes('redactToken')) {
    console.warn('⚠️  Stability: Blocked a Telegraf redaction crash.');
    return true;
  }
  return false;
};

process.on('uncaughtException', (err) => {
  if (!handleBunCrash(err)) {
    console.error('Fatal Uncaught Exception:', err);
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason) => {
  if (!handleBunCrash(reason)) {
    console.error('Unhandled Rejection:', reason);
  }
});

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.get('/', (req, res) => {
  res.send('SAFU Bot Server is running 🛡️');
});

// Launch the Telegram Bot
launchBot();

// Initialize Global Announcements if channel ID is provided
const announcementChannelId = process.env.ANNOUNCEMENT_CHANNEL_ID;
if (announcementChannelId) {
  AnnouncementModule.init(bot, announcementChannelId);
} else {
  console.warn('⚠️ SAFU Announcements: No ANNOUNCEMENT_CHANNEL_ID found in .env');
}

app.listen(port, () => {
  console.log(`Express server is listening on port ${port}`);
});
