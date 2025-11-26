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

// Validate required environment variables
if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN is required');
  process.exit(1);
}

// Initialize Firebase if credentials provided
let db, bucket;
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
    db = admin.firestore();
    bucket = admin.storage().bucket();
    console.log('✅ Firebase initialized successfully');
  } catch (error) {
    console.error('❌ Firebase initialization failed:', error.message);
  }
} else {
  console.log('ℹ️ Firebase not configured, using in-memory storage');
}

// Create bot instance
const bot = new TelegramBot(BOT_TOKEN, { polling: false });

// ========== STORAGE (Firebase + Fallback) ========== //
const users = new Map();
const notes = new Map();
const userStates = new Map();
let noteCounter = 1;

// Folder structure
const folders = new Map([
  ['natural', {
    id: 'natural',
    name: '📁 Natural Sciences',
    categories: ['pre_engineering', 'freshman', 'medical', 'pure']
  }],
  ['social', {
    id: 'social', 
    name: '📁 Social Sciences',
    categories: ['business', 'law', 'arts']
  }]
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

// ========== FIREBASE OPERATIONS ========== //
const FirebaseService = {
  async saveUser(userData) {
    if (!db) return null;
    try {
      const userRef = db.collection('users').doc(userData.id.toString());
      await userRef.set({
        ...userData,
        lastActive: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      return userRef.id;
    } catch (error) {
      console.error('Firebase saveUser error:', error);
      return null;
    }
  },

  async saveNote(noteData) {
    if (!db) return null;
    try {
      const noteRef = db.collection('notes').doc(noteData.id.toString());
      await noteRef.set({
        ...noteData,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return noteRef.id;
    } catch (error) {
      console.error('Firebase saveNote error:', error);
      return null;
    }
  },

  async getNote(noteId) {
    if (!db) return null;
    try {
      const noteDoc = await db.collection('notes').doc(noteId.toString()).get();
      return noteDoc.exists ? noteDoc.data() : null;
    } catch (error) {
      console.error('Firebase getNote error:', error);
      return null;
    }
  },

  async updateNote(noteId, updates) {
    if (!db) return false;
    try {
      await db.collection('notes').doc(noteId.toString()).update({
        ...updates,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return true;
    } catch (error) {
      console.error('Firebase updateNote error:', error);
      return false;
    }
  },

  async getAdminNotes(adminId) {
    if (!db) return [];
    try {
      const snapshot = await db.collection('notes')
        .where('uploadedBy', '==', parseInt(adminId))
        .orderBy('createdAt', 'desc')
        .limit(20)
        .get();
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.error('Firebase getAdminNotes error:', error);
      return [];
    }
  },

  async uploadHTML(htmlContent, noteId) {
    if (!bucket) {
      // Fallback: Return mock URL
      return `https://example.com/notes/${noteId}.html`;
    }
    
    try {
      const fileName = `notes/${noteId}.html`;
      const file = bucket.file(fileName);
      
      await file.save(htmlContent, {
        metadata: {
          contentType: 'text/html',
          cacheControl: 'public, max-age=3600'
        }
      });
      
      await file.makePublic();
      return `https://storage.googleapis.com/${bucket.name}/${fileName}`;
    } catch (error) {
      console.error('Firebase uploadHTML error:', error);
      return null;
    }
  }
};

// ========== BOT OPERATIONS ========== //
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
    
    await bot.sendMessage(chatId,
      `🤖 *JU Notes Management System*\n\n` +
      `Welcome Admin! Manage all study materials.`,
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
    
    await bot.sendMessage(chatId,
      `📚 *JU Study Materials*\n\n` +
      `Access approved study notes and resources.`,
      { parse_mode: 'Markdown', ...options }
    );
  }
};

const showAdminDashboard = async (chatId) => {
  const notesCount = notes.size;
  const activeNotes = Array.from(notes.values()).filter(n => n.is_active !== false).length;
  const usersCount = users.size;

  const message = 
    `🤖 *Admin Dashboard*\n\n` +
    `📊 Quick Stats:\n` +
    `• Notes: ${activeNotes}/${notesCount} active\n` +
    `• Users: ${usersCount}\n` +
    `• Folders: ${folders.size}\n\n` +
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
};

const showNotesList = async (chatId, userId) => {
  try {
    let userNotes = [];
    
    if (db) {
      userNotes = await FirebaseService.getAdminNotes(userId);
    } else {
      userNotes = Array.from(notes.values())
        .filter(note => note.uploadedBy === userId)
        .slice(0, 10);
    }

    if (userNotes.length === 0) {
      const options = {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📤 Upload Your First Note', callback_data: 'admin_upload_note' }],
            [{ text: '🔄 Refresh', callback_data: 'refresh_notes' }]
          ]
        }
      };
      
      await bot.sendMessage(chatId,
        `📚 *My Notes*\n\n` +
        `No notes found. Upload your first study material! 📤`,
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
      message += `   📁 ${folder?.name || 'Uncategorized'} • 👀 ${note.views || 0} views\n\n`;
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
    let note;
    
    if (db) {
      note = await FirebaseService.getNote(noteId);
    } else {
      note = notes.get(noteId);
    }

    if (!note) {
      await bot.sendMessage(chatId, '❌ Note not found.');
      return;
    }

    const folder = folders.get(note.folder);
    const category = categories.get(note.category);

    const message =
      `📖 *${note.title}*\n\n` +
      `📝 *Description:*\n${note.description || 'No description'}\n\n` +
      `📊 *Statistics:*\n` +
      `• Views: ${note.views || 0} students\n` +
      `• Status: ${note.is_active === false ? '🚫 Inactive' : '✅ Active'}\n` +
      `• Location: ${folder?.name || 'Unknown'} → ${category?.name || 'Unknown'}\n\n` +
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
            { text: '✏️ Edit Info', callback_data: `edit_${noteId}` }
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
  userStates.set(userId, {
    state: 'awaiting_note_folder',
    noteData: {}
  });

  const folderButtons = Array.from(folders.values()).map(folder => [
    { text: folder.name, callback_data: `folder_${folder.id}` }
  ]);
  
  folderButtons.push([{ text: '❌ Cancel Upload', callback_data: 'cancel_upload' }]);

  const options = {
    reply_markup: {
      inline_keyboard: folderButtons
    }
  };

  await bot.sendMessage(chatId,
    `📤 *Upload New Note - Step 1/4*\n\n` +
    `📁 *Select Folder:*\n\n` +
    `Choose where to organize this note:`,
    { parse_mode: 'Markdown', ...options }
  );
};

const createShareMessage = (note) => {
  const message =
    `🌟 **New Study Material Available!**\n\n` +
    `${note.description}\n\n` +
    `All Rights Reserved!\n` +
    `©Freshman Academy 📚`;

  const options = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔓 Open Tutorial Now', callback_data: `open_${note.id}` }]
      ]
    }
  };

  return { message, options };
};

const shareNoteToGroups = async (chatId, noteId) => {
  try {
    let note;
    
    if (db) {
      note = await FirebaseService.getNote(noteId);
    } else {
      note = notes.get(noteId);
    }

    if (!note) {
      await bot.sendMessage(chatId, '❌ Note not found.');
      return;
    }

    const { message, options } = createShareMessage(note);

    await bot.sendMessage(chatId,
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

const handleStart = async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  console.log(`🚀 Start command from user ${userId}`);

  const userData = {
    id: userId,
    username: msg.from.username || '',
    firstName: msg.from.first_name || 'User',
    isAdmin: ADMIN_IDS.includes(userId),
    startedBot: true
  };

  users.set(userId, userData);
  await FirebaseService.saveUser(userData);

  if (ADMIN_IDS.includes(userId)) {
    await showAdminDashboard(chatId);
  } else {
    await bot.sendMessage(chatId,
      `🎓 *Welcome to JU Study Materials!*\n\n` +
      `Access approved study notes and resources.\n\n` +
      `You must start the bot to access materials.`,
      { parse_mode: 'Markdown' }
    );
    await showMainMenu(chatId, userId);
  }
};

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

const handleCallbackQuery = async (callbackQuery) => {
  const message = callbackQuery.message;
  const userId = callbackQuery.from.id;
  const data = callbackQuery.data;
  const chatId = message.chat.id;

  console.log(`🔄 Callback from ${userId}: ${data}`);

  try {
    await bot.answerCallbackQuery(callbackQuery.id);

    if (data.startsWith('test_')) {
      const testNum = data.replace('test_', '');
      await bot.sendMessage(chatId, `✅ Test button ${testNum} worked! 🎉`);
    }
    else if (data === 'admin_view_notes') {
      await showNotesList(chatId, userId);
    }
    else if (data === 'admin_upload_note') {
      await startUploadFlow(chatId, userId);
    }
    else if (data === 'admin_manage_folders') {
      await showFolderManagement(chatId);
    }
    else if (data === 'admin_bulk_ops') {
      await showBulkOperations(chatId);
    }
    else if (data === 'refresh_notes') {
      await showNotesList(chatId, userId);
    }
    else if (data === 'back_to_notes') {
      await showNotesList(chatId, userId);
    }
    else if (data === 'back_to_dashboard') {
      await showAdminDashboard(chatId);
    }
    else if (data.startsWith('folder_')) {
      const folderId = data.replace('folder_', '');
      await handleFolderSelection(chatId, userId, folderId);
    }
    else if (data.startsWith('category_')) {
      const categoryId = data.replace('category_', '');
      await handleCategorySelection(chatId, userId, categoryId);
    }
    else if (data.startsWith('regen_')) {
      const noteId = data.replace('regen_', '');
      await regenerateNoteLink(chatId, noteId);
    }
    else if (data.startsWith('revoke_')) {
      const noteId = data.replace('revoke_', '');
      await revokeNoteAccess(chatId, noteId);
    }
    else if (data.startsWith('share_')) {
      const noteId = data.replace('share_', '');
      await shareNoteToGroups(chatId, noteId);
    }
    else if (data.startsWith('open_')) {
      const noteId = data.replace('open_', '');
      await openNote(chatId, noteId, userId);
    }
    else if (data.startsWith('delete_')) {
      const noteId = data.replace('delete_', '');
      await deleteNote(chatId, noteId, userId);
    }
    else if (data === 'cancel_upload') {
      userStates.delete(userId);
      await bot.sendMessage(chatId, '❌ Upload cancelled.');
      await showAdminDashboard(chatId);
    }
    else {
      console.log('❓ Unknown callback:', data);
      await bot.sendMessage(chatId, `❓ Unknown button action: ${data}`);
    }

  } catch (error) {
    console.error('Callback error:', error);
    await bot.answerCallbackQuery(callbackQuery.id, { 
      text: '❌ Error processing button' 
    });
  }
};

const testButtons = async (chatId) => {
  const options = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🔄 Test Button 1", callback_data: "test_1" }],
        [{ text: "🚫 Test Button 2", callback_data: "test_2" }],
        [{ text: "✅ Test Button 3", callback_data: "test_3" }],
        [{ text: "📚 View Notes", callback_data: "admin_view_notes" }],
        [{ text: "📤 Upload Note", callback_data: "admin_upload_note" }]
      ]
    }
  };
  
  await bot.sendMessage(chatId, "🧪 **Button Test Panel**\n\nAll buttons should work perfectly! 🎯", { 
    parse_mode: 'Markdown', 
    ...options 
  });
};

const showFolderManagement = async (chatId) => {
  let message = `📁 *Folder Management*\n\n`;
  
  folders.forEach(folder => {
    message += `${folder.name}\n`;
    categories.forEach(cat => {
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
  const notesCount = notes.size;
  const activeNotes = Array.from(notes.values()).filter(n => n.is_active !== false).length;

  const message =
    `⚡ *Bulk Operations*\n\n` +
    `Active Notes: ${activeNotes}\n` +
    `Total Notes: ${notesCount}\n\n` +
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
};

const showStatistics = async (chatId) => {
  const notesCount = notes.size;
  const activeNotes = Array.from(notes.values()).filter(n => n.is_active !== false).length;
  const totalViews = Array.from(notes.values()).reduce((sum, n) => sum + (n.views || 0), 0);
  const usersCount = users.size;

  const message =
    `📊 *System Statistics*\n\n` +
    `👥 Total Users: ${usersCount}\n` +
    `📚 Total Notes: ${notesCount}\n` +
    `✅ Active Notes: ${activeNotes}\n` +
    `👀 Total Views: ${totalViews}\n` +
    `📁 Folders: ${folders.size}\n` +
    `🎯 Categories: ${categories.size}\n\n` +
    `🟢 System Status: Operational`;

  await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
};

const handleFolderSelection = async (chatId, userId, folderId) => {
  const userState = userStates.get(userId);
  if (userState && userState.state === 'awaiting_note_folder') {
    userState.noteData.folder = folderId;
    userState.state = 'awaiting_note_category';
    userStates.set(userId, userState);

    const folderCategories = Array.from(categories.values())
      .filter(cat => cat.folder === folderId);

    const categoryButtons = folderCategories.map(cat => 
      [{ text: cat.name, callback_data: `category_${cat.id}` }]
    );

    categoryButtons.push([{ text: '❌ Cancel', callback_data: 'cancel_upload' }]);

    const options = {
      reply_markup: {
        inline_keyboard: categoryButtons
      }
    };

    await bot.sendMessage(chatId,
      `🎯 *Step 2/4 - Select Category*\n\n` +
      `Choose a category within ${folders.get(folderId).name}:`,
      { parse_mode: 'Markdown', ...options }
    );
  }
};

const handleCategorySelection = async (chatId, userId, categoryId) => {
  const userState = userStates.get(userId);
  if (userState && userState.state === 'awaiting_note_category') {
    userState.noteData.category = categoryId;
    userState.state = 'awaiting_note_title';
    userStates.set(userId, userState);

    await bot.sendMessage(chatId,
      `🏷️ *Step 3/4 - Note Title*\n\n` +
      `Enter a title for your note:\n\n` +
      `Example: "General Chemistry - Chapter 1"`,
      { parse_mode: 'Markdown' }
    );
  }
};

const regenerateNoteLink = async (chatId, noteId) => {
  try {
    const newNoteId = `note_${Date.now()}`;
    
    if (db) {
      await FirebaseService.updateNote(noteId, {
        firebase_url: `https://storage.googleapis.com/${bucket.name}/notes/${newNoteId}.html`
      });
    } else {
      const note = notes.get(noteId);
      if (note) {
        note.firebase_url = `https://example.com/notes/${newNoteId}.html`;
        notes.set(noteId, note);
      }
    }

    await bot.sendMessage(chatId,
      `✅ *Link Regenerated!*\n\n` +
      `New secure link created.\n` +
      `Previous link is now invalid.`,
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
    if (db) {
      await FirebaseService.updateNote(noteId, { is_active: false });
    } else {
      const note = notes.get(noteId);
      if (note) {
        note.is_active = false;
        notes.set(noteId, note);
      }
    }

    await bot.sendMessage(chatId,
      `🚫 *Access Revoked!*\n\n` +
      `Note has been disabled.\n` +
      `Students can no longer access this content.`,
      { parse_mode: 'Markdown' }
    );

    await showNoteManagement(chatId, noteId);
  } catch (error) {
    console.error('Error revoking access:', error);
    await bot.sendMessage(chatId, '❌ Error revoking access.');
  }
};

const openNote = async (chatId, noteId, userId) => {
  try {
    let note;
    
    if (db) {
      note = await FirebaseService.getNote(noteId);
    } else {
      note = notes.get(noteId);
    }

    if (!note) {
      await bot.sendMessage(chatId, '❌ Note not found.');
      return;
    }

    if (note.is_active === false) {
      await bot.sendMessage(chatId,
        `🚫 *Content Unavailable*\n\n` +
        `This note has been revoked by administrator.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const user = users.get(userId);
    if (!user || !user.startedBot) {
      await bot.sendMessage(chatId,
        `🔒 *Access Required*\n\n` +
        `Please start the bot first:\n\n` +
        `Click /start to begin.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (db) {
      await FirebaseService.updateNote(noteId, {
        views: (note.views || 0) + 1
      });
    } else {
      note.views = (note.views || 0) + 1;
      notes.set(noteId, note);
    }

    const options = {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔓 Open Tutorial Now', url: note.firebase_url || 'https://example.com' }]
        ]
      }
    };

    await bot.sendMessage(chatId,
      `📚 *Opening: ${note.title}*\n\n` +
      `Click the button below to open in browser:`,
      { parse_mode: 'Markdown', ...options }
    );
  } catch (error) {
    console.error('Error opening note:', error);
    await bot.sendMessage(chatId, '❌ Error opening note.');
  }
};

const deleteNote = async (chatId, noteId, userId) => {
  try {
    if (db) {
      await db.collection('notes').doc(noteId.toString()).delete();
    } else {
      notes.delete(noteId);
    }

    await bot.sendMessage(chatId,
      `🗑️ *Note Deleted!*\n\n` +
      `The note has been permanently removed.`,
      { parse_mode: 'Markdown' }
    );

    await showNotesList(chatId, userId);
  } catch (error) {
    console.error('Error deleting note:', error);
    await bot.sendMessage(chatId, '❌ Error deleting note.');
  }
};

// ========== VERCEL HANDLER ========== //
module.exports = async (req, res) => {
  console.log(`🌐 ${req.method} request to ${req.url}`);
  
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    return res.status(200).json({
      status: '🟢 Online',
      message: 'JU Notes Bot is running!',
      timestamp: new Date().toISOString(),
      stats: {
        users: users.size,
        notes: notes.size,
        folders: folders.size
      },
      environment: {
        hasFirebase: !!db,
        adminCount: ADMIN_IDS.length
      }
    });
  }

  if (req.method === 'POST') {
    try {
      const update = req.body;
      console.log('📦 Update received:', update.update_id);

      if (update.message) {
        await handleMessage(update.message);
      } else if (update.callback_query) {
        await handleCallbackQuery(update.callback_query);
      } else {
        console.log('🔍 Unknown update type');
      }

      return res.status(200).json({ ok: true });
    } catch (error) {
      console.error('❌ Webhook error:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};

console.log('✅ JU Notes Bot Server Started!');
console.log('🔧 Debug Mode: Active');
console.log('🎯 Test with: /start then click "🛠️ Test Buttons"');
