const TelegramBot = require('node-telegram-bot-api');
const { put } = require('@vercel/blob');

// 🛡️ GLOBAL ERROR HANDLER
process.on('unhandledRejection', (error) => {
  console.error('🔴 Unhandled Promise Rejection:', error);
});

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(Number) : [];

console.log('🔧 Environment Check:');
console.log('- BOT_TOKEN:', BOT_TOKEN ? '✅' : '❌');
console.log('- ADMIN_IDS:', ADMIN_IDS);

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN is required');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: false });

// ========== SIMPLE IN-MEMORY + BLOB STORAGE ========== //
// Store metadata in memory (resets on cold start) but files in Blob (persistent)
let notes = new Map();
let uploadStates = new Map();

const StorageService = {
  async saveNote(noteData) {
    try {
      notes.set(noteData.id, noteData);
      console.log('💾 Note saved to memory:', noteData.id);
      return true;
    } catch (error) {
      console.error('Save note error:', error);
      return false;
    }
  },

  async getNote(noteId) {
    return notes.get(noteId) || null;
  },

  async getAdminNotes(userId) {
    const userNotes = Array.from(notes.values())
      .filter(note => note.uploadedBy === userId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return userNotes;
  },

  async saveUploadState(userId, stateData) {
    try {
      uploadStates.set(userId, stateData);
      return true;
    } catch (error) {
      console.error('Save state error:', error);
      return false;
    }
  },

  async getUploadState(userId) {
    return uploadStates.get(userId) || null;
  },

  async deleteUploadState(userId) {
    uploadStates.delete(userId);
    return true;
  },

  async getStats() {
    const totalNotes = notes.size;
    const activeNotes = Array.from(notes.values()).filter(note => note.is_active !== false).length;
    const totalViews = Array.from(notes.values()).reduce((sum, note) => sum + (note.views || 0), 0);
    
    return { totalNotes, activeNotes, totalViews };
  }
};

// ========== BLOB STORAGE SERVICE ========== //
const BlobService = {
  async uploadHTML(htmlContent, fileName) {
    try {
      console.log('📤 Uploading to Blob Storage:', fileName);
      const { url } = await put(fileName, htmlContent, {
        access: 'public',
        contentType: 'text/html'
      });
      console.log('✅ Blob upload successful:', url);
      return url;
    } catch (error) {
      console.error('❌ Blob upload error:', error);
      return null;
    }
  }
};

// ========== BOT HANDLERS ========== //
const handleStart = async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  if (ADMIN_IDS.includes(userId)) {
    const stats = await StorageService.getStats();
    
    await bot.sendMessage(chatId,
      `🤖 *Notes Bot - Blob Storage*\n\n` +
      `💾 Metadata: Memory (resets on restart)\n` +
      `📁 Files: Vercel Blob Storage (persistent)\n` +
      `📊 Notes: ${stats.totalNotes} total\n\n` +
      `✅ Files are permanently stored\n\n` +
      `Choose an action:`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📤 Upload HTML File', callback_data: 'upload_html' }],
            [{ text: `📚 View Notes (${stats.totalNotes})`, callback_data: 'view_notes' }],
            [{ text: '🧪 Test Upload', callback_data: 'test_upload' }]
          ]
        }
      }
    );
  } else {
    await bot.sendMessage(chatId, 
      `🎓 *Study Materials*\n\n` +
      `Access notes shared by your instructors.`,
      { parse_mode: 'Markdown' }
    );
  }
};

const startUploadFlow = async (chatId, userId) => {
  await StorageService.saveUploadState(userId, {
    state: 'awaiting_file',
    noteData: {}
  });

  await bot.sendMessage(chatId,
    `📤 *Upload HTML File*\n\n` +
    `Please send me an HTML file now!\n\n` +
    `I'll store it permanently in Vercel Blob Storage.`,
    { parse_mode: 'Markdown' }
  );
};

const handleDocument = async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const document = msg.document;

  console.log('📎 Document received:', document?.file_name);

  if (!ADMIN_IDS.includes(userId)) {
    await bot.sendMessage(chatId, '❌ Admin access required.');
    return;
  }

  const uploadState = await StorageService.getUploadState(userId);
  
  if (uploadState && uploadState.state === 'awaiting_file' && document) {
    const isHTML = document.file_name?.toLowerCase().endsWith('.html');
    
    if (isHTML) {
      try {
        // Show processing message
        const processingMsg = await bot.sendMessage(chatId, `⏳ Step 1: Downloading from Telegram...`);
        
        // Step 1: Get file from Telegram
        console.log('🔹 Step 1: Downloading from Telegram...');
        const fileLink = await bot.getFileLink(document.file_id);
        const response = await fetch(fileLink);
        
        if (!response.ok) {
          throw new Error(`Telegram download failed: ${response.status}`);
        }
        
        const htmlContent = await response.text();
        console.log('✅ Downloaded:', htmlContent.length, 'bytes');
        
        // Step 2: Upload to Blob Storage
        await bot.editMessageText(`⏳ Step 2: Uploading to Blob Storage...`, {
          chat_id: chatId,
          message_id: processingMsg.message_id
        });
        
        console.log('🔹 Step 2: Uploading to Blob...');
        const fileName = `notes/${Date.now()}_${document.file_name}`;
        const blobUrl = await BlobService.uploadHTML(htmlContent, fileName);
        
        if (!blobUrl) {
          throw new Error('Blob Storage upload failed');
        }
        console.log('✅ Blob URL:', blobUrl);
        
        // Step 3: Save metadata
        await bot.editMessageText(`⏳ Step 3: Saving note info...`, {
          chat_id: chatId,
          message_id: processingMsg.message_id
        });
        
        console.log('🔹 Step 3: Saving metadata...');
        const noteId = `note_${Date.now()}`;
        const noteData = {
          id: noteId,
          title: document.file_name.replace('.html', ''),
          description: `Uploaded via Vercel Blob Storage`,
          file_name: document.file_name,
          file_size: document.file_size,
          blob_url: blobUrl,
          uploadedBy: userId,
          views: 0,
          is_active: true,
          createdAt: new Date().toISOString()
        };

        const saved = await StorageService.saveNote(noteData);
        
        if (saved) {
          await StorageService.deleteUploadState(userId);
          await bot.deleteMessage(chatId, processingMsg.message_id);
          
          console.log('✅ Upload completed successfully');
          
          await bot.sendMessage(chatId,
            `✅ *Upload Successful!*\n\n` +
            `📁 File: ${document.file_name}\n` +
            `📦 Size: ${(document.file_size / 1024).toFixed(2)} KB\n` +
            `🔗 Permanent URL: ${blobUrl}\n\n` +
            `🎉 File is now permanently stored!\n\n` +
            `Share this URL with students: ${blobUrl}`,
            { parse_mode: 'Markdown' }
          );
        } else {
          throw new Error('Failed to save note metadata');
        }

      } catch (error) {
        console.error('❌ Upload error:', error);
        await bot.sendMessage(chatId,
          `❌ *Upload Failed*\n\n` +
          `Error: ${error.message}\n\n` +
          `Please try again.`,
          { parse_mode: 'Markdown' }
        );
      }
    } else {
      await bot.sendMessage(chatId, 
        `❌ *Wrong File Type*\n\n` +
        `Please send an HTML file (.html extension)\n` +
        `You sent: ${document.file_name}`,
        { parse_mode: 'Markdown' }
      );
    }
  } else {
    await bot.sendMessage(chatId,
      `📎 Please start upload first by clicking "Upload HTML File"`,
      { parse_mode: 'Markdown' }
    );
  }
};

const showNotesList = async (chatId, userId) => {
  const userNotes = await StorageService.getAdminNotes(userId);
  
  if (userNotes.length === 0) {
    await bot.sendMessage(chatId,
      `📚 *No Notes Yet*\n\n` +
      `Upload your first HTML file!`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📤 Upload First Note', callback_data: 'upload_html' }]
          ]
        }
      }
    );
    return;
  }

  let message = `📚 *Your Notes (${userNotes.length})*\n\n`;
  
  userNotes.forEach((note, index) => {
    message += `${index + 1}. ${note.title}\n`;
    message += `   📦 ${(note.file_size / 1024).toFixed(2)} KB\n`;
    message += `   🔗 ${note.blob_url ? '✅ Stored' : '❌ Missing'}\n\n`;
  });

  message += `💡 *Note:* Metadata resets on server restart, but files remain in Blob Storage.`;

  await bot.sendMessage(chatId, message, { 
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '📤 Upload New Note', callback_data: 'upload_html' }],
        [{ text: '🔄 Refresh', callback_data: 'view_notes' }]
      ]
    }
  });
};

const testUpload = async (chatId) => {
  try {
    // Test Blob Storage with a small HTML
    const testHTML = `<html><body><h1>Test File</h1><p>Blob Storage Test</p></body></html>`;
    const testUrl = await BlobService.uploadHTML(testHTML, `test-${Date.now()}.html`);
    
    await bot.sendMessage(chatId,
      `🧪 *Upload Test Results*\n\n` +
      `🔹 Blob Storage: ${testUrl ? '✅ Working' : '❌ Failed'}\n` +
      `🔹 Test URL: ${testUrl || 'None'}\n\n` +
      `🎉 Blob Storage is ready for uploads!`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    await bot.sendMessage(chatId,
      `❌ *Test Failed*\n\n` +
      `Error: ${error.message}`,
      { parse_mode: 'Markdown' }
    );
  }
};

const handleCallbackQuery = async (callbackQuery) => {
  const message = callbackQuery.message;
  const userId = callbackQuery.from.id;
  const data = callbackQuery.data;
  const chatId = message.chat.id;

  try {
    await bot.answerCallbackQuery(callbackQuery.id);

    if (data === 'upload_html') {
      await startUploadFlow(chatId, userId);
    } else if (data === 'view_notes') {
      await showNotesList(chatId, userId);
    } else if (data === 'test_upload') {
      await testUpload(chatId);
    }

  } catch (error) {
    console.error('Callback error:', error);
  }
};

const handleMessage = async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (text === '/start') {
    await handleStart(msg);
  }
};

// ========== VERCEL HANDLER ========== //
module.exports = async (req, res) => {
  console.log(`🌐 ${req.method} request to ${req.url}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const stats = await StorageService.getStats();
    return res.status(200).json({
      status: '🟢 Blob Notes Bot Online',
      storage: {
        blob_storage: 'Active',
        memory_storage: 'Active (resets on cold start)'
      },
      stats: stats,
      timestamp: new Date().toISOString()
    });
  }

  if (req.method === 'POST') {
    try {
      const update = req.body;
      console.log('📦 Update received');
      
      if (update.message) {
        if (update.message.text) await handleMessage(update.message);
        else if (update.message.document) await handleDocument(update.message);
      } else if (update.callback_query) {
        await handleCallbackQuery(update.callback_query);
      }

      return res.status(200).json({ ok: true });
    } catch (error) {
      console.error('Webhook error:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};

console.log('✅ Blob Notes Bot Started!');
console.log('📁 Storage: Blob Storage (persistent) + Memory (temp)');
console.log('🚀 Ready for uploads!');
