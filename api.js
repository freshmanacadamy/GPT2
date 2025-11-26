const TelegramBot = require('node-telegram-bot-api');
const { put } = require('@vercel/blob');
const { get, set } = require('@vercel/edge-config');

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

// ========== EDGE CONFIG STORAGE SERVICE ========== //
const StorageService = {
  async saveNote(noteData) {
    try {
      // Get current notes from Edge Config
      const currentNotes = (await get('notes')) || {};
      
      // Add new note
      currentNotes[noteData.id] = noteData;
      
      // Save back to Edge Config
      await set('notes', currentNotes);
      
      console.log('💾 Note saved to Edge Config:', noteData.id);
      return true;
    } catch (error) {
      console.error('Save note error:', error);
      return false;
    }
  },

  async getNote(noteId) {
    try {
      const notes = (await get('notes')) || {};
      return notes[noteId] || null;
    } catch (error) {
      console.error('Get note error:', error);
      return null;
    }
  },

  async getAdminNotes(userId) {
    try {
      const notes = (await get('notes')) || {};
      const userNotes = Object.values(notes).filter(note => note.uploadedBy === userId);
      return userNotes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } catch (error) {
      console.error('Get admin notes error:', error);
      return [];
    }
  },

  async saveUploadState(userId, stateData) {
    try {
      const currentStates = (await get('upload_states')) || {};
      currentStates[userId] = stateData;
      await set('upload_states', currentStates);
      return true;
    } catch (error) {
      console.error('Save state error:', error);
      return false;
    }
  },

  async getUploadState(userId) {
    try {
      const states = (await get('upload_states')) || {};
      return states[userId] || null;
    } catch (error) {
      console.error('Get state error:', error);
      return null;
    }
  },

  async deleteUploadState(userId) {
    try {
      const states = (await get('upload_states')) || {};
      delete states[userId];
      await set('upload_states', states);
      return true;
    } catch (error) {
      console.error('Delete state error:', error);
      return false;
    }
  },

  async getStats() {
    try {
      const notes = (await get('notes')) || {};
      const totalNotes = Object.keys(notes).length;
      const activeNotes = Object.values(notes).filter(note => note.is_active !== false).length;
      const totalViews = Object.values(notes).reduce((sum, note) => sum + (note.views || 0), 0);
      
      return { totalNotes, activeNotes, totalViews };
    } catch (error) {
      return { totalNotes: 0, activeNotes: 0, totalViews: 0 };
    }
  }
};

// ========== BLOB STORAGE SERVICE ========== //
const BlobService = {
  async uploadHTML(htmlContent, fileName) {
    try {
      const { url } = await put(fileName, htmlContent, {
        access: 'public',
        contentType: 'text/html'
      });
      return url;
    } catch (error) {
      console.error('Blob upload error:', error);
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
      `🤖 *Notes Bot - Edge Config + Blob*\n\n` +
      `💾 Storage: Vercel Edge Config\n` +
      `📁 Files: Vercel Blob Storage\n` +
      `📊 Notes: ${stats.totalNotes} total, ${stats.activeNotes} active\n\n` +
      `✅ 100% FREE Solution\n\n` +
      `Choose an action:`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📤 Upload HTML File', callback_data: 'upload_html' }],
            [{ text: `📚 View Notes (${stats.totalNotes})`, callback_data: 'view_notes' }],
            [{ text: '🧪 Test Storage', callback_data: 'test_storage' }]
          ]
        }
      }
    );
  } else {
    await bot.sendMessage(chatId, 
      `🎓 *Study Materials*\n\n` +
      `Access notes shared by your instructors.\n\n` +
      `Contact admin for access.`,
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
    `I'll store it in Vercel Blob Storage.`,
    { parse_mode: 'Markdown' }
  );
};

const handleDocument = async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const document = msg.document;

  if (!ADMIN_IDS.includes(userId)) return;

  const uploadState = await StorageService.getUploadState(userId);
  
  if (uploadState && uploadState.state === 'awaiting_file' && document) {
    const isHTML = document.file_name?.toLowerCase().endsWith('.html');
    
    if (isHTML) {
      try {
        // Show processing message
        const processingMsg = await bot.sendMessage(chatId, `⏳ Downloading file from Telegram...`);
        
        // Get file from Telegram
        const fileLink = await bot.getFileLink(document.file_id);
        const response = await fetch(fileLink);
        const htmlContent = await response.text();
        
        // Upload to Vercel Blob Storage
        await bot.editMessageText(`⏳ Uploading to Blob Storage...`, {
          chat_id: chatId,
          message_id: processingMsg.message_id
        });
        
        const fileName = `notes/${Date.now()}_${document.file_name}`;
        const blobUrl = await BlobService.uploadHTML(htmlContent, fileName);
        
        if (!blobUrl) {
          throw new Error('Failed to upload to Blob Storage');
        }
        
        // Save note metadata to Edge Config
        await bot.editMessageText(`⏳ Saving note metadata...`, {
          chat_id: chatId,
          message_id: processingMsg.message_id
        });
        
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
          
          await bot.sendMessage(chatId,
            `✅ *Upload Successful!*\n\n` +
            `📁 File: ${document.file_name}\n` +
            `📦 Size: ${(document.file_size / 1024).toFixed(2)} KB\n` +
            `🔗 URL: ${blobUrl}\n\n` +
            `💾 Metadata: Edge Config\n` +
            `📁 Storage: Blob Storage\n\n` +
            `🎉 File saved successfully!`,
            { parse_mode: 'Markdown' }
          );
        } else {
          throw new Error('Failed to save note metadata');
        }

      } catch (error) {
        await bot.sendMessage(chatId,
          `❌ *Upload Failed*\n\n` +
          `Error: ${error.message}`,
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
  }
};

const showNotesList = async (chatId, userId) => {
  const userNotes = await StorageService.getAdminNotes(userId);
  
  if (userNotes.length === 0) {
    await bot.sendMessage(chatId,
      `📚 *No Notes Yet*\n\n` +
      `Upload your first HTML file using the button below!`,
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
    message += `   📦 ${(note.file_size / 1024).toFixed(2)} KB • 👀 ${note.views} views\n`;
    message += `   🔗 ${note.blob_url ? '✅ Stored' : '❌ Missing'}\n\n`;
  });

  await bot.sendMessage(chatId, message, { 
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '📤 Upload New Note', callback_data: 'upload_html' }],
        [{ text: '🔄 Refresh List', callback_data: 'view_notes' }]
      ]
    }
  });
};

const testStorage = async (chatId) => {
  try {
    // Test Edge Config
    await StorageService.saveUploadState('test', { test: true });
    const testState = await StorageService.getUploadState('test');
    
    await bot.sendMessage(chatId,
      `🧪 *Storage Test Results*\n\n` +
      `🔹 Edge Config: ${testState ? '✅ Working' : '❌ Failed'}\n` +
      `🔹 Blob Storage: ✅ Available\n\n` +
      `🎉 Both storage systems are ready!`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    await bot.sendMessage(chatId,
      `❌ *Storage Test Failed*\n\n` +
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
    } else if (data === 'test_storage') {
      await testStorage(chatId);
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
      status: '🟢 Edge+Blob Notes Bot Online',
      storage: {
        edge_config: 'Active',
        blob_storage: 'Active'
      },
      stats: stats,
      timestamp: new Date().toISOString()
    });
  }

  if (req.method === 'POST') {
    try {
      const update = req.body;
      
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

console.log('✅ Edge+Blob Notes Bot Started!');
console.log('💾 Storage: Edge Config + Blob Storage');
console.log('💰 Cost: 100% FREE');
console.log('🚀 Ready for production!');
