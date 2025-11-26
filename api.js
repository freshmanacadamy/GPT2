const TelegramBot = require('node-telegram-bot-api');

// 🛡️ GLOBAL ERROR HANDLER
process.on('unhandledRejection', (error) => {
  console.error('🔴 Unhandled Promise Rejection:', error);
});

// ========== SIMPLE CONFIG ========== //
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(Number) : [];

// Create bot instance
const bot = new TelegramBot(BOT_TOKEN, { polling: false });

// Simple storage (for testing only)
let testNotes = [];

// ========== SIMPLE UPLOAD FLOW ========== //
const handleStart = async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  const isAdmin = ADMIN_IDS.includes(userId);
  
  if (isAdmin) {
    // NO MARKDOWN - plain text
    await bot.sendMessage(chatId,
      `SIMPLE TEST BOT\n\n` +
      `Click the button below to test HTML upload:`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📤 TEST UPLOAD', callback_data: 'test_upload' }]
          ]
        }
      }
    );
  } else {
    await bot.sendMessage(chatId, 'Admin access required.');
  }
};

const startTestUpload = async (chatId) => {
  // NO MARKDOWN - plain text
  await bot.sendMessage(chatId,
    `TEST UPLOAD STARTED\n\n` +
    `Please send me an HTML file now!\n\n` +
    `I'll show you what I receive.`
  );
};

const handleDocument = async (msg) => {
  const chatId = msg.chat.id;
  const document = msg.document;

  console.log('📎 DOCUMENT RECEIVED:', {
    file_name: document.file_name,
    file_size: document.file_size,
    mime_type: document.mime_type
  });

  // Check if it's HTML
  const isHTML = document.file_name?.toLowerCase().endsWith('.html');
  
  if (isHTML) {
    try {
      // Get file info from Telegram
      const fileLink = await bot.getFileLink(document.file_id);
      
      // Create simple note record
      const noteId = `test_${Date.now()}`;
      testNotes.push({
        id: noteId,
        title: `Test Note ${testNotes.length + 1}`,
        file_name: document.file_name,
        file_size: document.file_size,
        telegram_file_link: fileLink,
        uploadedAt: new Date()
      });

      // NO MARKDOWN - plain text to avoid parsing errors
      await bot.sendMessage(chatId,
        `✅ HTML FILE RECEIVED!\n\n` +
        `File: ${document.file_name}\n` +
        `Size: ${(document.file_size / 1024).toFixed(2)} KB\n` +
        `Type: ${document.mime_type || 'Unknown'}\n\n` +
        `🎉 Upload successful! Bot can receive HTML files.`
      );

    } catch (error) {
      console.error('Upload error:', error);
      // NO MARKDOWN - plain text
      await bot.sendMessage(chatId,
        `❌ UPLOAD FAILED\n\n` +
        `Error: ${error.message}`
      );
    }
  } else {
    // NO MARKDOWN - plain text
    await bot.sendMessage(chatId,
      `❌ WRONG FILE TYPE\n\n` +
      `Please send an HTML file (.html extension)\n` +
      `You sent: ${document.file_name}`
    );
  }
};

const handleCallbackQuery = async (callbackQuery) => {
  const message = callbackQuery.message;
  const data = callbackQuery.data;
  const chatId = message.chat.id;

  try {
    await bot.answerCallbackQuery(callbackQuery.id);

    if (data === 'test_upload') {
      await startTestUpload(chatId);
    }

  } catch (error) {
    console.error('Callback error:', error);
    await bot.answerCallbackQuery(callbackQuery.id, { 
      text: 'Error' 
    });
  }
};

const handleMessage = async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) return;

  if (text === '/start') {
    await handleStart(msg);
  }
};

// ========== VERCEL HANDLER ========== //
module.exports = async (req, res) => {
  console.log(`🌐 ${req.method} request to ${req.url}`);

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'Simple Test Bot Online',
      notes_count: testNotes.length,
      timestamp: new Date().toISOString()
    });
  }

  if (req.method === 'POST') {
    try {
      const update = req.body;
      console.log('📦 Update:', update.update_id);

      if (update.message) {
        if (update.message.text) {
          await handleMessage(update.message);
        } else if (update.message.document) {
          await handleDocument(update.message);
        }
      } else if (update.callback_query) {
        await handleCallbackQuery(update.callback_query);
      }

      return res.status(200).json({ ok: true });
    } catch (error) {
      console.error('❌ Webhook error:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};

console.log('✅ Simple Test Bot Started!');
console.log('🎯 Commands: /start → Click "TEST UPLOAD" → Send HTML file');
