// api.js
// JU Notes Bot – Vercel Serverless + Firebase + Telegram

const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');
const https = require('https');

// 🛡️ GLOBAL ERROR HANDLER (useful on Vercel logs)
process.on('unhandledRejection', (error) => {
  console.error('🔴 Unhandled Promise Rejection:', error);
});
process.on('uncaughtException', (error) => {
  console.error('🔴 Uncaught Exception:', error);
});

// ========== ENVIRONMENT VARIABLES ========== //
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = process.env.ADMIN_IDS
  ? process.env.ADMIN_IDS.split(',').map((id) => Number(id.trim()))
  : [];

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY
  ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
  : undefined;
const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;

// Validate environment variables
if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN is required');
}
if (!FIREBASE_PROJECT_ID || !FIREBASE_PRIVATE_KEY || !FIREBASE_CLIENT_EMAIL) {
  console.error('❌ Firebase configuration is required');
}

// ========== FIREBASE INITIALIZATION (SAFE FOR SERVERLESS) ========== //
if (!admin.apps.length && FIREBASE_PROJECT_ID && FIREBASE_PRIVATE_KEY && FIREBASE_CLIENT_EMAIL) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: FIREBASE_PROJECT_ID,
        privateKey: FIREBASE_PRIVATE_KEY,
        clientEmail: FIREBASE_CLIENT_EMAIL
      }),
      storageBucket: `${FIREBASE_PROJECT_ID}.appspot.com`
    });
    console.log('✅ Firebase initialized successfully');
  } catch (error) {
    console.error('❌ Firebase initialization failed:', error);
  }
}

const db = admin.firestore();
const bucket = admin.storage().bucket();

// ========== TELEGRAM BOT INSTANCE (NO POLLING) ========== //
let bot = global._juNotesBot;
if (!bot && BOT_TOKEN) {
  bot = new TelegramBot(BOT_TOKEN, { polling: false });
  global._juNotesBot = bot;
  console.log('✅ Telegram bot instance created');
}

// ========== DOMAIN DATA (FOLDERS & CATEGORIES) ========== //
const folders = new Map([
  [
    'natural',
    {
      id: 'natural',
      name: '📁 Natural Sciences',
      categories: ['pre_engineering', 'freshman', 'medical', 'pure']
    }
  ],
  [
    'social',
    {
      id: 'social',
      name: '📁 Social Sciences',
      categories: ['business', 'law', 'arts']
    }
  ]
]);

const categories = new Map([
  ['pre_engineering', { id: 'pre_engineering', name: '🎯 Pre-Engineering', folder: 'natural' }],
  ['freshman', { id: 'freshman', name: '🎯 Freshman Program', folder: 'natural' }],
  ['medical', { id: 'medical', name: '🎯 Medical Sciences', folder: 'natural' }],
  ['pure', { id: 'pure', name: '🎯 Pure Sciences', folder: 'natural' }],
  ['business', { id: 'business', name: '📚 Business Studies', folder: 'social' }],
  ['law', { id: 'law', name: '📚 Law & Politics', folder: 'social' }],
  ['arts', { id: 'arts', name: '📚 Arts & Humanities', folder: 'social' }]
]);

// ========== FIREBASE SERVICES ========== //
const FirebaseService = {
  async saveUser(userData) {
    try {
      const userRef = db.collection('users').doc(userData.id.toString());
      await userRef.set(
        {
          ...userData,
          lastActive: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
      return true;
    } catch (error) {
      console.error('Firebase saveUser error:', error);
      return false;
    }
  },

  async getUser(userId) {
    try {
      const userDoc = await db.collection('users').doc(userId.toString()).get();
      return userDoc.exists ? userDoc.data() : null;
    } catch (error) {
      console.error('Firebase getUser error:', error);
      return null;
    }
  },

  async saveNote(noteData) {
    try {
      const noteRef = db.collection('notes').doc(noteData.id);
      await noteRef.set({
        ...noteData,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return true;
    } catch (error) {
      console.error('Firebase saveNote error:', error);
      return false;
    }
  },

  async getNote(noteId) {
    try {
      const noteDoc = await db.collection('notes').doc(noteId).get();
      return noteDoc.exists ? noteDoc.data() : null;
    } catch (error) {
      console.error('Firebase getNote error:', error);
      return null;
    }
  },

  async updateNote(noteId, updates) {
    try {
      await db
        .collection('notes')
        .doc(noteId)
        .update({
          ...updates,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      return true;
    } catch (error) {
      console.error('Firebase updateNote error:', error);
      return false;
    }
  },

  async deleteNote(noteId) {
    try {
      await db.collection('notes').doc(noteId).delete();
      return true;
    } catch (error) {
      console.error('Firebase deleteNote error:', error);
      return false;
    }
  },

  async getAdminNotes(adminId) {
    try {
      const snapshot = await db
        .collection('notes')
        .where('uploadedBy', '==', Number(adminId))
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();
      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.error('Firebase getAdminNotes error:', error);
      return [];
    }
  },

  async saveUploadState(userId, stateData) {
    try {
      const stateRef = db.collection('uploadStates').doc(userId.toString());
      await stateRef.set({
        ...stateData,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return true;
    } catch (error) {
      console.error('Firebase saveUploadState error:', error);
      return false;
    }
  },

  async getUploadState(userId) {
    try {
      const stateDoc = await db.collection('uploadStates').doc(userId.toString()).get();
      return stateDoc.exists ? stateDoc.data() : null;
    } catch (error) {
      console.error('Firebase getUploadState error:', error);
      return null;
    }
  },

  async deleteUploadState(userId) {
    try {
      await db.collection('uploadStates').doc(userId.toString()).delete();
      return true;
    } catch (error) {
      console.error('Firebase deleteUploadState error:', error);
      return false;
    }
  },

  async getStats() {
    try {
      const [notesSnapshot, usersSnapshot] = await Promise.all([
        db.collection('notes').get(),
        db.collection('users').get()
      ]);

      const totalNotes = notesSnapshot.size;
      const activeNotes = notesSnapshot.docs.filter((doc) => doc.data().is_active !== false).length;
      const totalUsers = usersSnapshot.size;
      const totalViews = notesSnapshot.docs.reduce(
        (sum, doc) => sum + (doc.data().views || 0),
        0
      );

      return { totalNotes, activeNotes, totalUsers, totalViews };
    } catch (error) {
      console.error('Firebase getStats error:', error);
      return { totalNotes: 0, activeNotes: 0, totalUsers: 0, totalViews: 0 };
    }
  }
};

// ========== TELEGRAM FILE → FIREBASE STORAGE UPLOAD ========== //
async function uploadTelegramHtmlToStorage(document) {
  if (!bot) throw new Error('Bot not initialized');

  const fileId = document.file_id;

  const fileInfo = await bot.getFile(fileId); // { file_path: 'documents/file_...' }
  const filePath = fileInfo.file_path;
  const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;

  const noteId = `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const storagePath = `notes/${noteId}.html`;
  const file = bucket.file(storagePath);

  console.log('⬇️ Downloading from Telegram:', fileUrl);
  console.log('⬆️ Uploading to Storage path:', storagePath);

  await new Promise((resolve, reject) => {
    const writeStream = file.createWriteStream({
      metadata: {
        contentType: 'text/html',
        cacheControl: 'public, max-age=3600'
      }
    });

    https
      .get(fileUrl, (response) => {
        if (response.statusCode !== 200) {
          return reject(
            new Error(`Failed to download file from Telegram. Status: ${response.statusCode}`)
          );
        }
        response.pipe(writeStream);
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      })
      .on('error', reject);
  });

  await file.makePublic();
  const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

  return { noteId, storagePath, publicUrl };
}

// ========== BOT UI HELPERS ========== //
const showMainMenu = async (chatId, userId) => {
  const isAdmin = ADMIN_IDS.includes(userId);

  if (isAdmin) {
    const options = {
      reply_markup: {
        keyboard: [
          [{ text: '📚 My Notes' }, { text: '📤 Upload Note' }],
          [{ text: '📁 Folders' }, { text: '📊 Statistics' }],
          [{ text: '🛠️ Test Buttons' }]
        ],
        resize_keyboard: true
      }
    };

    await bot.sendMessage(
      chatId,
      `🤖 *JU Notes Management System*\n\nWelcome Admin! Manage all study materials.`,
      { parse_mode: 'Markdown', ...options }
    );
  } else {
    const options = {
      reply_markup: {
        keyboard: [
          [{ text: '🔓 Access Notes' }, { text: '📞 Contact Admin' }],
          [{ text: 'ℹ️ Help' }]
        ],
        resize_keyboard: true
      }
    };

    await bot.sendMessage(
      chatId,
      `📚 *JU Study Materials*\n\nAccess approved study notes and resources.`,
      { parse_mode: 'Markdown', ...options }
    );
  }
};

const showAdminDashboard = async (chatId) => {
  try {
    const stats = await FirebaseService.getStats();

    const message =
      `🤖 *Admin Dashboard*\n\n` +
      `📊 Quick Stats:\n` +
      `• Notes: ${stats.activeNotes}/${stats.totalNotes} active\n` +
      `• Users: ${stats.totalUsers}\n` +
      `• Total Views: ${stats.totalViews}\n\n` +
      `🛠️ Quick Actions:`;

    const options = {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📚 View My Notes', callback_data: 'admin_view_notes' }],
          [{ text: '📤 Upload New Note', callback_data: 'admin_upload_note' }],
          [{ text: '📁 Manage Folders', callback_data: 'admin_manage_folders' }],
          [{ text: '⚡ Bulk Operations', callback_data: 'admin_bulk_ops' }]
        ]
      }
    };

    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown', ...options });
  } catch (error) {
    console.error('Error showing dashboard:', error);
    await bot.sendMessage(chatId, '❌ Error loading dashboard. Please try again.');
  }
};

const showNotesList = async (chatId, userId) => {
  try {
    const userNotes = await FirebaseService.getAdminNotes(userId);

    if (userNotes.length === 0) {
      const options = {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📤 Upload Your First Note', callback_data: 'admin_upload_note' }],
            [{ text: '🔄 Refresh', callback_data: 'refresh_notes' }]
          ]
        }
      };

      await bot.sendMessage(
        chatId,
        `📚 *My Notes*\n\nNo notes found. Upload your first study material! 📤`,
        { parse_mode: 'Markdown', ...options }
      );
      return;
    }

    let message = `📚 *Your Notes (${userNotes.length})*\n\n`;

    userNotes.forEach((note, index) => {
      const folder = folders.get(note.folder);
      const category = categories.get(note.category);
      const status = note.is_active === false ? '🚫' : '✅';
      message += `${index + 1}. ${status} ${note.title}\n`;
      message += `   📁 ${folder?.name || 'Uncategorized'} • 👀 ${note.views || 0} views\n`;
      message += `   🆔 ${note.id}\n\n`;
    });

    const options = {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📤 Upload New Note', callback_data: 'admin_upload_note' }],
          [{ text: '🔄 Refresh List', callback_data: 'refresh_notes' }],
          [{ text: '⚡ Bulk Actions', callback_data: 'admin_bulk_ops' }]
        ]
      }
    };

    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown', ...options });
  } catch (error) {
    console.error('Error showing notes list:', error);
    await bot.sendMessage(chatId, '❌ Error loading notes. Please try again.');
  }
};

const showNoteManagement = async (chatId, noteId) => {
  try {
    const note = await FirebaseService.getNote(noteId);

    if (!note) {
      await bot.sendMessage(chatId, '❌ Note not found. It may have been deleted.');
      return;
    }

    const folder = folders.get(note.folder);
    const category = categories.get(note.category);

    const createdAtStr =
      note.createdAt && note.createdAt.toDate
        ? note.createdAt.toDate().toLocaleDateString()
        : 'Unknown';

    const message =
      `📖 *${note.title}*\n\n` +
      `📝 *Description:*\n${note.description || 'No description'}\n\n` +
      `📊 *Statistics:*\n` +
      `• Views: ${note.views || 0} students\n` +
      `• Status: ${note.is_active === false ? '🚫 Inactive' : '✅ Active'}\n` +
      `• Location: ${folder?.name || 'Unknown'} → ${category?.name || 'Unknown'}\n` +
      `• Uploaded: ${createdAtStr}\n\n` +
      `🛠️ *Management:*`;

    const options = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🔄 Regenerate Link', callback_data: `regen_${noteId}` },
            { text: '🚫 Revoke Access', callback_data: `revoke_${noteId}` }
          ],
          [
            { text: '📤 Share Note', callback_data: `share_${noteId}` },
            { text: '✏️ Edit Info (Coming)', callback_data: 'edit_disabled' }
          ],
          [
            { text: '🗑️ Delete Note', callback_data: `delete_${noteId}` },
            { text: '⬅️ Back to Notes', callback_data: 'back_to_notes' }
          ]
        ]
      }
    };

    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown', ...options });
  } catch (error) {
    console.error('Error showing note management:', error);
    await bot.sendMessage(chatId, '❌ Error loading note details.');
  }
};

const startUploadFlow = async (chatId, userId) => {
  try {
    await FirebaseService.saveUploadState(userId, {
      state: 'awaiting_note_folder',
      noteData: {}
    });

    const folderButtons = Array.from(folders.values()).map((folder) => [
      { text: folder.name, callback_data: `folder_${folder.id}` }
    ]);

    folderButtons.push([{ text: '❌ Cancel Upload', callback_data: 'cancel_upload' }]);

    const options = {
      reply_markup: {
        inline_keyboard: folderButtons
      }
    };

    await bot.sendMessage(
      chatId,
      `📤 *Upload New Note - Step 1/4*\n\n` +
        `📁 *Select Folder:*\n\nChoose where to organize this note:`,
      { parse_mode: 'Markdown', ...options }
    );
  } catch (error) {
    console.error('Error starting upload flow:', error);
    await bot.sendMessage(chatId, '❌ Error starting upload process.');
  }
};

// ========== SHARE MESSAGE CREATION ========== //
const createShareMessage = (note) => {
  const message =
    `🌟 *New Study Material Available!*\n\n` +
    `${note.description || note.title}\n\n` +
    `All Rights Reserved!\n` +
    `©Freshman Academy 📚`;

  const options = {
    reply_markup: {
      inline_keyboard: [[{ text: '🔓 Open Tutorial Now', callback_data: `open_${note.id}` }]]
    }
  };

  return { message, options };
};

const shareNoteToGroups = async (chatId, noteId) => {
  try {
    const note = await FirebaseService.getNote(noteId);

    if (!note) {
      await bot.sendMessage(chatId, '❌ Note not found.');
      return;
    }

    const { message, options } = createShareMessage(note);

    await bot.sendMessage(
      chatId,
      `📤 *Share This Message*\n\n` +
        `Copy and paste this to your groups:\n\n` +
        `---\n` +
        `${message}\n` +
        `---`,
      { parse_mode: 'Markdown' }
    );

    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown', ...options });
  } catch (error) {
    console.error('Error sharing note:', error);
    await bot.sendMessage(chatId, '❌ Error sharing note.');
  }
};

// ========== CORE HANDLERS ========== //
const handleStart = async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  console.log(`🚀 /start from user ${userId}`);

  try {
    const userData = {
      id: userId,
      username: msg.from.username || '',
      firstName: msg.from.first_name || 'User',
      isAdmin: ADMIN_IDS.includes(userId),
      startedBot: true
    };

    await FirebaseService.saveUser(userData);

    if (ADMIN_IDS.includes(userId)) {
      await showAdminDashboard(chatId);
    } else {
      await bot.sendMessage(
        chatId,
        `🎓 *Welcome to JU Study Materials!*\n\n` +
          `Access approved study notes and resources.\n\n` +
          `You must start the bot to access materials.`,
        { parse_mode: 'Markdown' }
      );
      await showMainMenu(chatId, userId);
    }
  } catch (error) {
    console.error('Error in start command:', error);
    await bot.sendMessage(chatId, '❌ Error initializing. Please try again.');
  }
};

// MESSAGE HANDLER
const handleMessage = async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;

  console.log(`📨 Message from ${userId}:`, text);

  if (!text) return;

  try {
    // Check upload state first
    const uploadState = await FirebaseService.getUploadState(userId);
    if (uploadState) {
      if (uploadState.state === 'awaiting_note_title') {
        uploadState.noteData.title = text;
        uploadState.state = 'awaiting_note_description';
        await FirebaseService.saveUploadState(userId, uploadState);

        await bot.sendMessage(
          chatId,
          `📝 *Step 3/4 - Note Description*\n\n` +
            `Enter a description for your note:\n\n` +
            `You can use formatting like:\n` +
            `• Hashtags: #Chemistry #Science\n` +
            `• Emojis: 📚 🔬\n` +
            `• Multiple lines\n\n` +
            `*Example:*\n` +
            `"📚 General #Chemistry\n\n` +
            `📚 Chapter One - Essential Ideas In Chemistry\n` +
            `• Chemistry as Experimental Science\n` +
            `• Properties of Matter\n\n` +
            `All Rights Reserved!\n` +
            `©Freshman Academy 📚"`,
          { parse_mode: 'Markdown' }
        );
        return;
      } else if (uploadState.state === 'awaiting_note_description') {
        uploadState.noteData.description = text;
        uploadState.state = 'awaiting_note_file';
        await FirebaseService.saveUploadState(userId, uploadState);

        await bot.sendMessage(
          chatId,
          `📎 *Step 4/4 - Upload HTML File*\n\n` +
            `🎉 Almost done! Now send me the HTML file.\n\n` +
            `*How to upload:*\n` +
            `1. Click the 📎 paperclip icon\n` +
            `2. Select "Document"\n` +
            `3. Choose your .html file\n` +
            `4. Send it to me\n\n` +
            `I'll handle the rest automatically! 🚀`,
          { parse_mode: 'Markdown' }
        );
        return;
      }
    }

    // Process normal commands if not in upload flow
    if (text.startsWith('/')) {
      switch (text) {
        case '/start':
          await handleStart(msg);
          break;
        case '/admin':
          if (ADMIN_IDS.includes(userId)) {
            await showAdminDashboard(chatId);
          }
          break;
        case '/test':
          await testButtons(chatId);
          break;
        default:
          await showMainMenu(chatId, userId);
      }
    } else {
      // Text buttons
      switch (text) {
        case '📚 My Notes':
          if (ADMIN_IDS.includes(userId)) {
            await showNotesList(chatId, userId);
          }
          break;
        case '📤 Upload Note':
          if (ADMIN_IDS.includes(userId)) {
            await startUploadFlow(chatId, userId);
          }
          break;
        case '📁 Folders':
          if (ADMIN_IDS.includes(userId)) {
            await showFolderManagement(chatId);
          }
          break;
        case '📊 Statistics':
          if (ADMIN_IDS.includes(userId)) {
            await showStatistics(chatId);
          }
          break;
        case '🛠️ Test Buttons':
          await testButtons(chatId);
          break;
        default:
          await showMainMenu(chatId, userId);
      }
    }
  } catch (error) {
    console.error('Message handler error:', error);
    await bot.sendMessage(chatId, '❌ Error processing message.');
  }
};

// DOCUMENT HANDLER
const handleDocument = async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const document = msg.document;

  console.log(`📎 Document from ${userId}:`, document?.file_name);

  try {
    const uploadState = await FirebaseService.getUploadState(userId);

    if (uploadState && uploadState.state === 'awaiting_note_file' && document) {
      if (!document.file_name?.toLowerCase().endsWith('.html')) {
        await bot.sendMessage(
          chatId,
          `❌ *Invalid File Type*\n\n` +
            `Please send an HTML file (.html extension).\n\n` +
            `Current file: ${document.file_name}\n` +
            `Required: .html file`,
          { parse_mode: 'Markdown' }
        );
        return;
      }

      await bot.sendMessage(chatId, `⏳ Processing your HTML file...`);

      // 1️⃣ Upload Telegram HTML to Storage
      const { noteId, storagePath, publicUrl } = await uploadTelegramHtmlToStorage(document);

      // 2️⃣ Build note data
      const noteData = {
        id: noteId,
        title: uploadState.noteData.title,
        description: uploadState.noteData.description,
        folder: uploadState.noteData.folder,
        category: uploadState.noteData.category,
        uploadedBy: userId,
        views: 0,
        is_active: true,
        firebase_url: publicUrl,
        storagePath
      };

      // 3️⃣ Save note to Firestore
      const noteSaved = await FirebaseService.saveNote(noteData);

      if (noteSaved) {
        // Clear upload state
        await FirebaseService.deleteUploadState(userId);

        await bot.sendMessage(
          chatId,
          `✅ *Note Uploaded Successfully!*\n\n` +
            `📖 *Title:* ${noteData.title}\n` +
            `📁 *Location:* ${folders.get(noteData.folder)?.name} → ${
              categories.get(noteData.category)?.name
            }\n\n` +
            `🎉 Your note is now live and ready to share!`,
          { parse_mode: 'Markdown' }
        );

        // Show management with the correct note ID
        await showNoteManagement(chatId, noteData.id);
      } else {
        throw new Error('Failed to save note to database');
      }
    } else {
      await bot.sendMessage(
        chatId,
        `📎 I see you sent a file, but you're not in upload mode.\n\n` +
          `Use "📤 Upload Note" to start the upload process.`
      );
    }
  } catch (error) {
    console.error('Document upload error:', error);
    await bot.sendMessage(
      chatId,
      `❌ *Upload Failed*\n\nError: ${error.message}\n\nPlease try again.`
    );
  }
};

// CALLBACK QUERY HANDLER
const handleCallbackQuery = async (callbackQuery) => {
  const message = callbackQuery.message;
  const userId = callbackQuery.from.id;
  const data = callbackQuery.data;
  const chatId = message.chat.id;

  console.log(`🔄 Callback from ${userId}: ${data}`);
  console.log('📋 Available folders:', Array.from(folders.keys()));

  try {
    await bot.answerCallbackQuery(callbackQuery.id);

    if (data.startsWith('test_')) {
      const testNum = data.replace('test_', '');
      await bot.sendMessage(chatId, `✅ Test button ${testNum} worked! 🎉`);
    } else if (data === 'admin_view_notes') {
      await showNotesList(chatId, userId);
    } else if (data === 'admin_upload_note') {
      await startUploadFlow(chatId, userId);
    } else if (data === 'admin_manage_folders') {
      await showFolderManagement(chatId);
    } else if (data === 'add_folder') {
      await handleAddFolder(chatId, userId);
    } else if (data === 'add_category') {
      await handleAddCategory(chatId, userId);
    } else if (data === 'admin_bulk_ops') {
      await showBulkOperations(chatId);
    } else if (data === 'refresh_notes') {
      await showNotesList(chatId, userId);
    } else if (data === 'back_to_notes') {
      await showNotesList(chatId, userId);
    } else if (data === 'back_to_dashboard') {
      await showAdminDashboard(chatId);
    } else if (data.startsWith('folder_')) {
      const folderId = data.replace('folder_', '');
      await handleFolderSelection(chatId, userId, folderId);
    } else if (data.startsWith('category_')) {
      const categoryId = data.replace('category_', '');
      await handleCategorySelection(chatId, userId, categoryId);
    } else if (data.startsWith('regen_')) {
      const noteId = data.replace('regen_', '');
      await regenerateNoteLink(chatId, noteId);
    } else if (data.startsWith('revoke_')) {
      const noteId = data.replace('revoke_', '');
      await revokeNoteAccess(chatId, noteId);
    } else if (data.startsWith('share_')) {
      const noteId = data.replace('share_', '');
      await shareNoteToGroups(chatId, noteId);
    } else if (data.startsWith('open_')) {
      const noteId = data.replace('open_', '');
      await openNote(chatId, noteId, userId);
    } else if (data.startsWith('delete_')) {
      const noteId = data.replace('delete_', '');
      await deleteNote(chatId, noteId, userId);
    } else if (data === 'cancel_upload') {
      await FirebaseService.deleteUploadState(userId);
      await bot.sendMessage(chatId, '❌ Upload cancelled.');
      await showAdminDashboard(chatId);
    } else if (data === 'bulk_regen_all') {
      await bulkRegenerateAll(chatId);
    } else if (data === 'bulk_revoke_all') {
      await bulkRevokeAll(chatId);
    } else if (data === 'bulk_share_all') {
      await bulkShareAll(chatId);
    } else if (data === 'edit_disabled') {
      await bot.sendMessage(chatId, '✏️ Edit feature will be available soon.');
    } else {
      console.log('❓ Unknown callback:', data);
      await bot.sendMessage(chatId, `❓ Unknown button action: ${data}`);
    }
  } catch (error) {
    console.error('Callback error:', error);
    try {
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: '❌ Error processing button'
      });
    } catch (_) {
      // ignore
    }
  }
};

// ========== OTHER UI / MANAGEMENT HELPERS ========== //
const testButtons = async (chatId) => {
  const options = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔄 Test Button 1', callback_data: 'test_1' }],
        [{ text: '🚫 Test Button 2', callback_data: 'test_2' }],
        [{ text: '✅ Test Button 3', callback_data: 'test_3' }],
        [{ text: '📚 View Notes', callback_data: 'admin_view_notes' }],
        [{ text: '📤 Upload Note', callback_data: 'admin_upload_note' }]
      ]
    }
  };

  await bot.sendMessage(
    chatId,
    '🧪 *Button Test Panel*\n\nAll buttons should work perfectly! 🎯',
    {
      parse_mode: 'Markdown',
      ...options
    }
  );
};

const showFolderManagement = async (chatId) => {
  let message = `📁 *Folder Management*\n\n`;

  folders.forEach((folder) => {
    message += `${folder.name}\n`;
    categories.forEach((cat) => {
      if (cat.folder === folder.id) {
        message += `  └─ ${cat.name}\n`;
      }
    });
    message += `\n`;
  });

  const options = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '➕ Add Folder', callback_data: 'add_folder' }],
        [{ text: '➕ Add Category', callback_data: 'add_category' }],
        [{ text: '⬅️ Back to Dashboard', callback_data: 'back_to_dashboard' }]
      ]
    }
  };

  await bot.sendMessage(chatId, message, { parse_mode: 'Markdown', ...options });
};

const showBulkOperations = async (chatId) => {
  try, stats:
    const stats = await FirebaseService.getStats();

    const message =
      `⚡ *Bulk Operations*\n\n` +
      `Active Notes: ${stats.activeNotes}\n` +
      `Total Notes: ${stats.totalNotes}\n\n` +
      `Perform actions on all notes:`;

    const options = {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔄 Regenerate ALL Links', callback_data: 'bulk_regen_all' }],
          [{ text: '🚫 Revoke ALL Access', callback_data: 'bulk_revoke_all' }],
          [{ text: '📤 Share ALL Notes', callback_data: 'bulk_share_all' }],
          [{ text: '⬅️ Back to Dashboard', callback_data: 'back_to_dashboard' }]
        ]
      }
    };

    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown', ...options });
  } catch (error) {
    console.error('Error showing bulk operations:', error);
    await bot.sendMessage(chatId, '❌ Error loading bulk operations.');
  }
};

const showStatistics = async (chatId) => {
  try {
    const stats = await FirebaseService.getStats();

    const message =
      `📊 *System Statistics*\n\n` +
      `👥 Total Users: ${stats.totalUsers}\n` +
      `📚 Total Notes: ${stats.totalNotes}\n` +
      `✅ Active Notes: ${stats.activeNotes}\n` +
      `👀 Total Views: ${stats.totalViews}\n` +
      `📁 Folders: ${folders.size}\n` +
      `🎯 Categories: ${categories.size}\n\n` +
      `🟢 System Status: Operational`;

    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error showing statistics:', error);
    await bot.sendMessage(chatId, '❌ Error loading statistics.');
  }
};

const handleFolderSelection = async (chatId, userId, folderId) => {
  try {
    const uploadState = await FirebaseService.getUploadState(userId);
    if (uploadState && uploadState.state === 'awaiting_note_folder') {
      uploadState.noteData.folder = folderId;
      uploadState.state = 'awaiting_note_category';
      await FirebaseService.saveUploadState(userId, uploadState);

      const folderCategories = Array.from(categories.values()).filter(
        (cat) => cat.folder === folderId
      );

      const categoryButtons = folderCategories.map((cat) => [
        { text: cat.name, callback_data: `category_${cat.id}` }
      ]);

      categoryButtons.push([{ text: '❌ Cancel', callback_data: 'cancel_upload' }]);

      const options = {
        reply_markup: {
          inline_keyboard: categoryButtons
        }
      };

      await bot.sendMessage(
        chatId,
        `🎯 *Step 2/4 - Select Category*\n\n` +
          `Choose a category within ${folders.get(folderId).name}:`,
        { parse_mode: 'Markdown', ...options }
      );
    }
  } catch (error) {
    console.error('Error handling folder selection:', error);
    await bot.sendMessage(chatId, '❌ Error processing folder selection.');
  }
};

const handleCategorySelection = async (chatId, userId, categoryId) => {
  try {
    const uploadState = await FirebaseService.getUploadState(userId);
    if (uploadState && uploadState.state === 'awaiting_note_category') {
      uploadState.noteData.category = categoryId;
      uploadState.state = 'awaiting_note_title';
      await FirebaseService.saveUploadState(userId, uploadState);

      await bot.sendMessage(
        chatId,
        `🏷️ *Step 3/4 - Note Title*\n\nEnter a title for your note:\n\n` +
          `Example: "General Chemistry - Chapter 1"`,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (error) {
    console.error('Error handling category selection:', error);
    await bot.sendMessage(chatId, '❌ Error processing category selection.');
  }
};

const regenerateNoteLink = async (chatId, noteId) => {
  try {
    const note = await FirebaseService.getNote(noteId);
    if (!note) {
      await bot.sendMessage(chatId, '❌ Note not found.');
      return;
    }

    const oldPath = note.storagePath || `notes/${note.id}.html`;
    const newNoteId = `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const newPath = `notes/${newNoteId}.html`;

    await bucket.file(oldPath).copy(bucket.file(newPath));

    await bucket.file(newPath).makePublic();
    const newUrl = `https://storage.googleapis.com/${bucket.name}/${newPath}`;

    await FirebaseService.updateNote(noteId, {
      firebase_url: newUrl,
      storagePath: newPath
    });

    await bot.sendMessage(
      chatId,
      `✅ *Link Regenerated!*\n\nNew secure link created.\nPrevious link is now outdated.`,
      { parse_mode: 'Markdown' }
    );

    await showNoteManagement(chatId, noteId);
  } catch (error) {
    console.error('Error regenerating link:', error);
    await bot.sendMessage(chatId, '❌ Error regenerating link.');
  }
};

const revokeNoteAccess = async (chatId, noteId) => {
  try {
    await FirebaseService.updateNote(noteId, { is_active: false });

    await bot.sendMessage(
      chatId,
      `🚫 *Access Revoked!*\n\nNote has been disabled.\nStudents can no longer access this content.`,
      { parse_mode: 'Markdown' }
    );

    await showNoteManagement(chatId, noteId);
  } catch (error) {
    console.error('Error revoking access:', error);
    await bot.sendMessage(chatId, '❌ Error revoking access.');
  }
};

const handleAddFolder = async (chatId) => {
  await bot.sendMessage(
    chatId,
    `📁 *Add New Folder*\n\nThis feature is coming soon!\n\n` +
      `For now, you can use the existing folders:\n` +
      `• 📁 Natural Sciences\n` +
      `• 📁 Social Sciences`,
    { parse_mode: 'Markdown' }
  );
};

const handleAddCategory = async (chatId) => {
  await bot.sendMessage(
    chatId,
    `🎯 *Add New Category*\n\nThis feature is coming soon!\n\n` +
      `For now, you can use existing categories:\n` +
      `• 🎯 Pre-Engineering\n` +
      `• 🎯 Freshman Program\n` +
      `• 🎯 Medical Sciences\n` +
      `• 🎯 Pure Sciences\n` +
      `• 📚 Business Studies\n` +
      `• 📚 Law & Politics\n` +
      `• 📚 Arts & Humanities`,
    { parse_mode: 'Markdown' }
  );
};

const openNote = async (chatId, noteId, userId) => {
  try {
    const note = await FirebaseService.getNote(noteId);
    if (!note) {
      await bot.sendMessage(chatId, '❌ Note not found or has been removed.');
      return;
    }

    if (note.is_active === false) {
      await bot.sendMessage(
        chatId,
        `🚫 *Content Unavailable*\n\nThis note has been revoked by the administrator.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const user = await FirebaseService.getUser(userId);
    if (!user || !user.startedBot) {
      await bot.sendMessage(
        chatId,
        `🔒 *Access Required*\n\nPlease start the bot first:\n\nClick /start to begin.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    await FirebaseService.updateNote(noteId, {
      views: (note.views || 0) + 1
    });

    const options = {
      reply_markup: {
        inline_keyboard: [[{ text: '🔓 Open Tutorial Now', url: note.firebase_url }]]
      }
    };

    await bot.sendMessage(
      chatId,
      `📚 *Opening: ${note.title}*\n\nClick the button below to open in browser:`,
      { parse_mode: 'Markdown', ...options }
    );
  } catch (error) {
    console.error('Error opening note:', error);
    await bot.sendMessage(chatId, '❌ Error opening note.');
  }
};

const deleteNote = async (chatId, noteId, userId) => {
  try {
    const note = await FirebaseService.getNote(noteId);

    if (note && note.storagePath) {
      try {
        await bucket.file(note.storagePath).delete();
      } catch (e) {
        console.warn('⚠️ Could not delete file from storage:', e.message);
      }
    }

    await FirebaseService.deleteNote(noteId);

    await bot.sendMessage(
      chatId,
      `🗑️ *Note Deleted!*\n\nThe note has been permanently removed.`,
      { parse_mode: 'Markdown' }
    );

    await showNotesList(chatId, userId);
  } catch (error) {
    console.error('Error deleting note:', error);
    await bot.sendMessage(chatId, '❌ Error deleting note.');
  }
};

// ========== BULK OPERATIONS ========== //
const bulkRegenerateAll = async (chatId) => {
  try {
    const snapshot = await db.collection('notes').get();
    const docs = snapshot.docs;

    for (const doc of docs) {
      const note = doc.data();
      const noteId = doc.id;
      const oldPath = note.storagePath || `notes/${noteId}.html`;
      const newId = `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const newPath = `notes/${newId}.html`;

      try {
        await bucket.file(oldPath).copy(bucket.file(newPath));
        await bucket.file(newPath).makePublic();
        const newUrl = `https://storage.googleapis.com/${bucket.name}/${newPath}`;
        await FirebaseService.updateNote(noteId, {
          firebase_url: newUrl,
          storagePath: newPath
        });
      } catch (e) {
        console.error(`Error regenerating link for note ${noteId}:`, e);
      }
    }

    await bot.sendMessage(
      chatId,
      `✅ *Bulk Link Regeneration Complete!*\n\nAll notes processed (errors, if any, logged).`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('Error in bulkRegenerateAll:', error);
    await bot.sendMessage(chatId, '❌ Error during bulk link regeneration.');
  }
};

const bulkRevokeAll = async (chatId) => {
  try {
    const snapshot = await db.collection('notes').get();
    const batch = db.batch();

    snapshot.docs.forEach((doc) => {
      batch.update(doc.ref, { is_active: false });
    });

    await batch.commit();

    await bot.sendMessage(
      chatId,
      `🚫 *Bulk Revoke Complete!*\n\nAll notes have been disabled.`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('Error in bulkRevokeAll:', error);
    await bot.sendMessage(chatId, '❌ Error during bulk revoke.');
  }
};

const bulkShareAll = async (chatId) => {
  try {
    const snapshot = await db
      .collection('notes')
      .where('is_active', '!=', false)
      .limit(10)
      .get();

    if (snapshot.empty) {
      await bot.sendMessage(chatId, 'ℹ️ No active notes to share.');
      return;
    }

    let message =
      `📤 *Bulk Share Preview*\n\n` +
      `Here are some notes you can promote in your groups:\n\n`;

    snapshot.docs.forEach((doc, idx) => {
      const note = doc.data();
      message += `${idx + 1}. ${note.title}\n`;
      message += `   🔗 ${note.firebase_url}\n\n`;
    });

    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error in bulkShareAll:', error);
    await bot.sendMessage(chatId, '❌ Error during bulk share preview.');
  }
};

// ========== VERCEL SERVERLESS HANDLER ========== //
module.exports = async (req, res) => {
  console.log(`🌐 ${req.method} request to ${req.url}`);

  // CORS headers (optional but nice for GET)
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET,OPTIONS,PATCH,DELETE,POST,PUT'
  );
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Health check / info endpoint
  if (req.method === 'GET') {
    try {
      const stats = await FirebaseService.getStats();
      return res.status(200).json({
        status: '🟢 Online',
        message: 'JU Notes Bot is running!',
        timestamp: new Date().toISOString(),
        stats: {
          users: stats.totalUsers,
          notes: stats.totalNotes,
          activeNotes: stats.activeNotes,
          folders: folders.size
        },
        environment: {
          hasFirebase: !!FIREBASE_PROJECT_ID,
          adminCount: ADMIN_IDS.length
        }
      });
    } catch (error) {
      console.error('GET / error:', error);
      return res.status(500).json({ error: 'Failed to get stats' });
    }
  }

  // Telegram webhook
  if (req.method === 'POST') {
    try {
      const update = req.body;
      console.log('📦 Update received:', update.update_id, JSON.stringify(update));

      if (update.message) {
        if (update.message.text) {
          await handleMessage(update.message);
        } else if (update.message.document) {
          await handleDocument(update.message);
        } else {
          console.log('🔍 Unknown message type:', Object.keys(update.message));
        }
      } else if (update.callback_query) {
        await handleCallbackQuery(update.callback_query);
      } else {
        console.log('🔍 Unknown update type:', Object.keys(update));
      }

      return res.status(200).json({ ok: true });
    } catch (error) {
      console.error('❌ Webhook error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};

console.log('✅ JU Notes Bot Serverless Handler Loaded!');
console.log('🔧 Firebase Persistence Enabled');
console.log('🚀 Ready for production');
console.log('🎯 Test with: /start → "🛠️ Test Buttons"');
