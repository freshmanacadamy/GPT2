const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');

// 🛡️ GLOBAL ERROR HANDLER
process.on('unhandledRejection', (error) => {
  console.error('🔴 Unhandled Promise Rejection:', error);
});
process.on('uncaughtException', (error) => {
  console.error('🔴 Uncaught Exception:', error);
});

// Get environment variables
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(Number) : [];
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
const BOT_USERNAME = process.env.BOT_USERNAME || 'your_bot_username';

// Validate environment variables
if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN is required');
  process.exit(1);
}

// Initialize Firebase
if (FIREBASE_PROJECT_ID && FIREBASE_PRIVATE_KEY && FIREBASE_CLIENT_EMAIL) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: FIREBASE_PROJECT_ID,
        privateKey: FIREBASE_PRIVATE_KEY,
        clientEmail: FIREBASE_CLIENT_EMAIL
      }),
      storageBucket: `${FIREBASE_PROJECT_ID}.appspot.com`
    });
    console.log('✅ Firebase initialized');
  } catch (error) {
    console.error('❌ Firebase init failed:', error);
  }
}

const db = admin?.firestore();
const bucket = admin?.storage()?.bucket();

// Create bot instance
const bot = new TelegramBot(BOT_TOKEN, { polling: false });

// In-memory storage (fallback)
const users = new Map();
const notes = new Map();
const userStates = new Map();
let noteCounter = 1;

// ========== SIMPLE BUTTON TEST ========== //
const testButtons = async (chatId) => {
  const options = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🔄 Test Button 1", callback_data: "test_1" }],
        [{ text: "🚫 Test Button 2", callback_data: "test_2" }],
        [{ text: "✅ Test Button 3", callback_data: "test_3" }]
      ]
    }
  };
  
  await bot.sendMessage(chatId, "🧪 Testing buttons - click one!", options);
};

// ========== MAIN MENU ========== //
const showMainMenu = async (chatId, userId) => {
  const isAdmin = ADMIN_IDS.includes(userId);
  
  if (isAdmin) {
    const options = {
      reply_markup: {
        keyboard: [
          [{ text: '📚 My Notes' }, { text: '📤 Upload Note' }],
          [{ text: '🧪 Test Buttons' }, { text: '📊 Stats' }]
        ],
        resize_keyboard: true
      }
    };
    
    await bot.sendMessage(chatId,
      `🤖 *Admin Panel*\n\n` +
      `Welcome! Choose an option:`,
      { parse_mode: 'Markdown', ...options }
    );
  } else {
    await bot.sendMessage(chatId,
      `🎓 Welcome to Study Materials!\n\n` +
      `Contact admin for access.`,
      { parse_mode: 'Markdown' }
    );
  }
};

// ========== NOTES MANAGEMENT ========== //
const showNotesList = async (chatId, userId) => {
  const userNotes = Array.from(notes.values())
    .filter(note => note.uploadedBy === userId)
    .slice(0, 5);

  if (userNotes.length === 0) {
    // Create sample note for testing
    const sampleNote = {
      id: 'sample_1',
      title: 'Sample Chemistry Notes',
      description: 'Test description',
      views: 0,
      is_active: true,
      uploadedBy: userId
    };
    notes.set(sampleNote.id, sampleNote);
    
    await showNoteManagement(chatId, 'sample_1');
    return;
  }

  let message = `📚 *Your Notes (${userNotes.length})*\n\n`;
  userNotes.forEach((note, index) => {
    message += `${index + 1}. ${note.title}\n`;
    message += `   👀 ${note.views} views • ${note.is_active ? '✅ Active' : '🚫 Inactive'}\n\n`;
  });

  const options = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📤 Upload New Note', callback_data: 'upload_note' }],
        [{ text: '🔄 Refresh', callback_data: 'refresh_notes' }]
      ]
    }
  };

  await bot.sendMessage(chatId, message, { parse_mode: 'Markdown', ...options });
};

// ========== NOTE MANAGEMENT ========== //
const showNoteManagement = async (chatId, noteId) => {
  const note = notes.get(noteId);
  if (!note) {
    await bot.sendMessage(chatId, '❌ Note not found.');
    return;
  }

  const message =
    `📖 *${note.title}*\n\n` +
    `📝 ${note.description}\n\n` +
    `📊 Stats: ${note.views} views • ${note.is_active ? '✅ Active' : '🚫 Inactive'}\n\n` +
    `🛠️ Manage:`;

  const options = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🔄 Regenerate', callback_data: `regen_${noteId}` },
          { text: '🚫 Revoke', callback_data: `revoke_${noteId}` }
        ],
        [
          { text: '📤 Share', callback_data: `share_${noteId}` },
          { text: '🗑️ Delete', callback_data: `delete_${noteId}` }
        ],
        [
          { text: '⬅️ Back', callback_data: 'back_notes' }
        ]
      ]
    }
  };

  await bot.sendMessage(chatId, message, { parse_mode: 'Markdown', ...options });
};

// ========== SHARE NOTE ========== //
const shareNotePreview = async (chatId, noteId) => {
  const note = notes.get(noteId);
  if (!note) return;

  const message =
    `🌟 **New Study Material Available!**\n\n` +
    `${note.description}\n\n` +
    `All Rights Reserved!\n` +
    `©Freshman Academy 📚`;

  const options = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔓 Open Tutorial Now', callback_data: `open_${noteId}` }]
      ]
    }
  };

  await bot.sendMessage(chatId, 
    `📤 *Share this message:*\n\n${message}`, 
    { parse_mode: 'Markdown' }
  );
  
  // Send the actual shareable message
  await bot.sendMessage(chatId, message, { parse_mode: 'Markdown', ...options });
};

// ========== START COMMAND ========== //
const handleStart = async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  console.log(`🚀 Start command from user ${userId}`);
  
  // Register user
  users.set(userId, {
    id: userId,
    username: msg.from.username,
    firstName: msg.from.first_name,
    isAdmin: ADMIN_IDS.includes(userId)
  });

  await bot.sendMessage(chatId,
    `🎓 *Welcome to Study Materials!*\n\n` +
    `I'm alive and buttons should work! 🎯`,
    { parse_mode: 'Markdown' }
  );
  
  await showMainMenu(chatId, userId);
};

// ========== MESSAGE HANDLER ========== //
const handleMessage = async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;

  console.log(`📨 Message from ${userId}: ${text}`);

  if (!text) return;

  try {
    if (text.startsWith('/')) {
      switch (text) {
        case '/start':
          await handleStart(msg);
          break;
        case '/test':
          await testButtons(chatId);
          break;
        default:
          await showMainMenu(chatId, userId);
      }
    } else {
      switch (text) {
        case '📚 My Notes':
          await showNotesList(chatId, userId);
          break;
        case '📤 Upload Note':
          await bot.sendMessage(chatId, '📤 Upload feature coming soon...');
          break;
        case '🧪 Test Buttons':
          await testButtons(chatId);
          break;
        case '📊 Stats':
          await bot.sendMessage(chatId, `📊 Stats: ${users.size} users, ${notes.size} notes`);
          break;
        default:
          await showMainMenu(chatId, userId);
      }
    }
  } catch (error) {
    console.error('❌ Message handler error:', error);
    await bot.sendMessage(chatId, '❌ Error processing message.');
  }
};

// ========== CALLBACK QUERY HANDLER ========== //
const handleCallbackQuery = async (callbackQuery) => {
  const message = callbackQuery.message;
  const userId = callbackQuery.from.id;
  const data = callbackQuery.data;
  const chatId = message.chat.id;

  console.log(`🔄 Callback from ${userId}: ${data}`);

  try {
    // ANSWER CALLBACK IMMEDIATELY (IMPORTANT!)
    await bot.answerCallbackQuery(callbackQuery.id);

    // Handle different callback types
    if (data.startsWith('test_')) {
      const testNum = data.replace('test_', '');
      await bot.sendMessage(chatId, `✅ Test button ${testNum} worked! 🎉`);
    }
    else if (data === 'upload_note') {
      await bot.sendMessage(chatId, '📤 Upload feature coming soon...');
    }
    else if (data === 'refresh_notes') {
      await showNotesList(chatId, userId);
    }
    else if (data.startsWith('regen_')) {
      const noteId = data.replace('regen_', '');
      await bot.sendMessage(chatId, `🔄 Regenerated link for note!`);
      await showNoteManagement(chatId, noteId);
    }
    else if (data.startsWith('revoke_')) {
      const noteId = data.replace('revoke_', '');
      const note = notes.get(noteId);
      if (note) {
        note.is_active = false;
        notes.set(noteId, note);
      }
      await bot.sendMessage(chatId, `🚫 Access revoked for note!`);
      await showNoteManagement(chatId, noteId);
    }
    else if (data.startsWith('share_')) {
      const noteId = data.replace('share_', '');
      await shareNotePreview(chatId, noteId);
    }
    else if (data.startsWith('open_')) {
      const noteId = data.replace('open_', '');
      const note = notes.get(noteId);
      if (note) {
        note.views = (note.views || 0) + 1;
        await bot.sendMessage(chatId, 
          `📖 Opening: ${note.title}\n\n` +
          `This would open in Telegram Web App!`
        );
      }
    }
    else if (data.startsWith('delete_')) {
      const noteId = data.replace('delete_', '');
      notes.delete(noteId);
      await bot.sendMessage(chatId, `🗑️ Note deleted!`);
      await showNotesList(chatId, userId);
    }
    else if (data === 'back_notes') {
      await showNotesList(chatId, userId);
    }
    else {
      await bot.sendMessage(chatId, `❓ Unknown button: ${data}`);
    }

  } catch (error) {
    console.error('❌ Callback error:', error);
    await bot.answerCallbackQuery(callbackQuery.id, { 
      text: '❌ Error processing button' 
    });
  }
};

// ========== VERCEL HANDLER ========== //
module.exports = async (req, res) => {
  console.log(`🌐 Request: ${req.method} ${req.url}`);
  
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Handle GET requests
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'online',
      message: 'Bot is running!',
      timestamp: new Date().toISOString(),
      users: users.size,
      notes: notes.size
    });
  }

  // Handle POST requests (Telegram webhook)
  if (req.method === 'POST') {
    try {
      const update = req.body;
      console.log('📦 Update received:', update.update_id);

      if (update.message) {
        await handleMessage(update.message);
      } else if (update.callback_query) {
        await handleCallbackQuery(update.callback_query);
      } else {
        console.log('🔍 Unknown update type:', update);
      }

      return res.status(200).json({ ok: true });
    } catch (error) {
      console.error('❌ Webhook error:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};

console.log('✅ Bot server started!');
console.log('🔧 Debug mode: All callbacks will be logged');
