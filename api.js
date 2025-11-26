const TelegramBot = require('node-telegram-bot-api');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(Number) : [];

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN is required');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: false });

// Simple storage
let htmlFiles = new Map();
let uploadStates = new Map();

// Handle start command
const handleStart = async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  if (ADMIN_IDS.includes(userId)) {
    await bot.sendMessage(chatId,
      `🤖 HTML Upload Bot\n\n` +
      `Send me an HTML file and I'll create a viewable link.`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📤 Upload HTML File', callback_data: 'upload_html' }]
          ]
        }
      }
    );
  }
};

// Start upload flow
const startUpload = async (chatId, userId) => {
  uploadStates.set(userId, 'waiting_for_file');
  await bot.sendMessage(chatId, '📤 Please send your HTML file now...');
};

// Handle HTML file upload
const handleHTMLUpload = async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const document = msg.document;

  if (!ADMIN_IDS.includes(userId)) return;

  const uploadState = uploadStates.get(userId);
  
  if (uploadState === 'waiting_for_file' && document) {
    const isHTML = document.file_name?.toLowerCase().endsWith('.html');
    
    if (isHTML) {
      try {
        const processingMsg = await bot.sendMessage(chatId, '⏳ Processing your file...');
        
        // Get file from Telegram
        const fileLink = await bot.getFileLink(document.file_id);
        const response = await fetch(fileLink);
        const htmlContent = await response.text();
        
        // Store HTML content
        const fileId = `file_${Date.now()}`;
        htmlFiles.set(fileId, {
          content: htmlContent,
          name: document.file_name,
          uploadedAt: new Date()
        });

        uploadStates.delete(userId);
        await bot.deleteMessage(chatId, processingMsg.message_id);
        
        // Create view URL
        const viewUrl = `https://${process.env.VERCEL_URL || 'your-app.vercel.app'}/api/view/${fileId}`;
        
        // Send success with button
        await bot.sendMessage(chatId,
          `✅ Upload Successful!\n\n` +
          `📁 ${document.file_name}\n` +
          `📦 ${(document.file_size / 1024).toFixed(2)} KB\n\n` +
          `Click below to view:`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔓 Open HTML', url: viewUrl }]
              ]
            }
          }
        );

      } catch (error) {
        await bot.sendMessage(chatId, `❌ Upload failed: ${error.message}`);
      }
    } else {
      await bot.sendMessage(chatId, '❌ Please send an HTML file (.html)');
    }
  }
};

// Handle callback queries
const handleCallback = async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const userId = callbackQuery.from.id;
  const data = callbackQuery.data;

  await bot.answerCallbackQuery(callbackQuery.id);

  if (data === 'upload_html' && ADMIN_IDS.includes(userId)) {
    await startUpload(chatId, userId);
  }
};

// Handle messages
const handleMessage = async (msg) => {
  const text = msg.text;
  if (text === '/start') await handleStart(msg);
};

// HTML Viewer API Route
const handleViewRequest = async (req, res) => {
  const fileId = req.url.split('/').pop();
  
  if (htmlFiles.has(fileId)) {
    const file = htmlFiles.get(fileId);
    res.setHeader('Content-Type', 'text/html');
    res.send(file.content);
  } else {
    res.status(404).send('File not found');
  }
};

// Main handler
module.exports = async (req, res) => {
  if (req.method === 'GET' && req.url.startsWith('/api/view/')) {
    return handleViewRequest(req, res);
  }

  if (req.method === 'POST') {
    try {
      const update = req.body;
      
      if (update.message) {
        if (update.message.text) await handleMessage(update.message);
        else if (update.message.document) await handleHTMLUpload(update.message);
      } else if (update.callback_query) {
        await handleCallback(update.callback_query);
      }

      return res.status(200).json({ ok: true });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(200).json({ status: 'Bot is running' });
};

console.log('✅ Simple HTML Bot Started!');
