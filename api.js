const TelegramBot = require('node-telegram-bot-api');

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

// ========== SIMPLE IN-MEMORY STORAGE ========== //
global.notesStorage = global.notesStorage || new Map();
global.uploadStatesStorage = global.uploadStatesStorage || new Map();

const StorageService = {
  async saveNote(noteData) {
    try {
      global.notesStorage.set(noteData.id, noteData);
      console.log('💾 Note saved:', noteData.id);
      return true;
    } catch (error) {
      console.error('Save note error:', error);
      return false;
    }
  },

  async getNote(noteId) {
    return global.notesStorage.get(noteId) || null;
  },

  async getAdminNotes(userId) {
    const userNotes = Array.from(global.notesStorage.values())
      .filter(note => note.uploadedBy === userId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return userNotes;
  },

  async saveUploadState(userId, stateData) {
    try {
      global.uploadStatesStorage.set(userId, stateData);
      return true;
    } catch (error) {
      console.error('Save state error:', error);
      return false;
    }
  },

  async getUploadState(userId) {
    return global.uploadStatesStorage.get(userId) || null;
  },

  async deleteUploadState(userId) {
    global.uploadStatesStorage.delete(userId);
    return true;
  },

  async getStats() {
    const totalNotes = global.notesStorage.size;
    const activeNotes = Array.from(global.notesStorage.values()).filter(note => note.is_active !== false).length;
    const totalViews = Array.from(global.notesStorage.values()).reduce((sum, note) => sum + (note.views || 0), 0);
    
    return { totalNotes, activeNotes, totalViews };
  }
};

// ========== BOT HANDLERS ========== //
const handleStart = async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  if (ADMIN_IDS.includes(userId)) {
    const stats = await StorageService.getStats();
    
    await bot.sendMessage(chatId,
      `🤖 Notes Bot - Direct Links\n\n` +
      `💾 Storage: Telegram File Server\n` +
      `📊 Notes: ${stats.totalNotes} total\n\n` +
      `✅ Files stored on Telegram servers\n` +
      `🔗 Direct links that always work\n\n` +
      `Choose an action:`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📤 Upload HTML File', callback_data: 'upload_html' }],
            [{ text: `📚 View Notes (${stats.totalNotes})`, callback_data: 'view_notes' }],
            [{ text: '🔄 Reset Storage', callback_data: 'reset_storage' }]
          ]
        }
      }
    );
  } else {
    await bot.sendMessage(chatId, 
      `🎓 Study Materials\n\n` +
      `Access notes shared by your instructors.\n\n` +
      `Contact admin for access.`
    );
  }
};

const startUploadFlow = async (chatId, userId) => {
  await StorageService.saveUploadState(userId, {
    state: 'awaiting_file',
    noteData: {}
  });

  await bot.sendMessage(chatId,
    `📤 Upload HTML File\n\n` +
    `Please send me an HTML file now!\n\n` +
    `I'll create a direct link that students can access.`
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
        const processingMsg = await bot.sendMessage(chatId, `⏳ Processing your HTML file...`);
        
        // Get direct file link from Telegram
        console.log('🔹 Getting Telegram file link...');
        const fileLink = await bot.getFileLink(document.file_id);
        console.log('✅ Telegram file link:', fileLink);
        
        // Create note with direct Telegram link
        const noteId = `note_${Date.now()}`;
        const noteTitle = document.file_name.replace('.html', '');
        const noteData = {
          id: noteId,
          title: noteTitle,
          description: `📚 ${noteTitle}\n\nUploaded via Telegram Bot\n\nAll Rights Reserved!\n©Freshman Academy 📚`,
          file_name: document.file_name,
          file_size: document.file_size,
          telegram_file_url: fileLink,
          uploadedBy: userId,
          views: 0,
          is_active: true,
          createdAt: new Date().toISOString()
        };

        // Save note metadata
        const saved = await StorageService.saveNote(noteData);
        
        if (saved) {
          await StorageService.deleteUploadState(userId);
          await bot.deleteMessage(chatId, processingMsg.message_id);
          
          console.log('✅ Upload completed successfully');
          
          // Create simple share message without complex formatting
          const shareMessage = 
            `🌟 New Study Material Available!\n\n` +
            `📚 ${noteTitle}\n\n` +
            `All Rights Reserved!\n` +
            `©Freshman Academy 📚`;
          
          // Send success message WITHOUT Markdown parsing
          await bot.sendMessage(chatId,
            `✅ Upload Successful!\n\n` +
            `📁 File: ${document.file_name}\n` +
            `📦 Size: ${(document.file_size / 1024).toFixed(2)} KB\n\n` +
            `🎉 File is ready to share!`
          );

          // Send the formatted share message with button (NO Markdown)
          await bot.sendMessage(chatId, shareMessage, {
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔓 Open Tutorial Now', url: fileLink }],
                [{ text: '📤 Share to Groups', callback_data: `share_${noteId}` }]
              ]
            }
          });

        } else {
          throw new Error('Failed to save note metadata');
        }

      } catch (error) {
        console.error('❌ Upload error:', error);
        await bot.sendMessage(chatId,
          `❌ Upload Failed\n\n` +
          `Error: ${error.message}\n\n` +
          `Please try again.`
        );
      }
    } else {
      await bot.sendMessage(chatId, 
        `❌ Wrong File Type\n\n` +
        `Please send an HTML file (.html extension)\n` +
        `You sent: ${document.file_name}`
      );
    }
  } else {
    await bot.sendMessage(chatId,
      `📎 Please start upload first by clicking "Upload HTML File"`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📤 Start Upload', callback_data: 'upload_html' }]
          ]
        }
      }
    );
  }
};

const showNotesList = async (chatId, userId) => {
  const userNotes = await StorageService.getAdminNotes(userId);
  
  if (userNotes.length === 0) {
    await bot.sendMessage(chatId,
      `📚 No Notes Yet\n\n` +
      `Upload your first HTML file to get started!`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📤 Upload First Note', callback_data: 'upload_html' }]
          ]
        }
      }
    );
    return;
  }

  let message = `📚 Your Notes (${userNotes.length})\n\n`;
  
  userNotes.forEach((note, index) => {
    message += `${index + 1}. ${note.title}\n`;
    message += `   📦 ${(note.file_size / 1024).toFixed(2)} KB\n`;
    message += `   👀 ${note.views} views\n`;
    message += `   🔗 ${note.telegram_file_url ? '✅ Active' : '❌ No Link'}\n\n`;
  });

  await bot.sendMessage(chatId, message, { 
    reply_markup: {
      inline_keyboard: [
        [{ text: '📤 Upload New Note', callback_data: 'upload_html' }],
        [{ text: '🔄 Refresh List', callback_data: 'view_notes' }]
      ]
    }
  });
};

const shareNotePreview = async (chatId, noteId) => {
  const note = await StorageService.getNote(noteId);
  
  if (!note) {
    await bot.sendMessage(chatId, '❌ Note not found.');
    return;
  }

  // Simple message without Markdown formatting
  const shareMessage = 
    `🌟 New Study Material Available!\n\n` +
    `📚 ${note.title}\n\n` +
    `All Rights Reserved!\n` +
    `©Freshman Academy 📚`;

  // Send preview WITHOUT Markdown
  await bot.sendMessage(chatId,
    `📤 Share This Message\n\n` +
    `Copy and paste to your groups:\n\n` +
    `---\n` +
    `${shareMessage}\n` +
    `---`
  );

  // Send the actual message with button (NO Markdown)
  await bot.sendMessage(chatId, shareMessage, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔓 Open Tutorial Now', url: note.telegram_file_url }]
      ]
    }
  });
};

const resetStorage = async (chatId) => {
  global.notesStorage.clear();
  global.uploadStatesStorage.clear();
  
  await bot.sendMessage(chatId,
    `🔄 Storage Reset\n\n` +
    `All notes and upload states have been cleared.\n` +
    `You can start fresh now!`
  );
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
    } else if (data === 'reset_storage') {
      await resetStorage(chatId);
    } else if (data.startsWith('share_')) {
      const noteId = data.replace('share_', '');
      await shareNotePreview(chatId, noteId);
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
  } else if (text === '/reset') {
    await resetStorage(chatId);
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
      status: '🟢 Telegram Notes Bot Online',
      storage: 'Telegram File Server + Memory',
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

console.log('✅ Telegram Notes Bot Started!');
console.log('📁 Storage: Telegram File Links (Always Works)');
console.log('🚀 Ready for uploads!');
