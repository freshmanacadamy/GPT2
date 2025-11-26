const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');

// 🛡️ GLOBAL ERROR HANDLER
process.on('unhandledRejection', (error) => {
  console.error('🔴 Unhandled Promise Rejection:', error);
});

// ========== CONFIGURATION ========== //
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => parseInt(id.trim())) : [];
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;

// Initialization State
let isInitialized = false;
let db;
let bucket;
let bot;

function initializeServices() {
  if (isInitialized) return true;

  if (!BOT_TOKEN || !FIREBASE_PROJECT_ID || !FIREBASE_PRIVATE_KEY || !FIREBASE_CLIENT_EMAIL) {
    console.error('❌ Missing Environment Variables');
    return false;
  }

  try {
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: FIREBASE_PROJECT_ID,
          privateKey: FIREBASE_PRIVATE_KEY,
          clientEmail: FIREBASE_CLIENT_EMAIL
        }),
        storageBucket: `${FIREBASE_PROJECT_ID}.appspot.com`
      });
    }
    
    db = admin.firestore();
    bucket = admin.storage().bucket();
    bot = new TelegramBot(BOT_TOKEN, { polling: false }); 
    
    isInitialized = true;
    console.log('✅ Services initialized successfully');
    return true;
  } catch (error) {
    console.error('❌ Initialization failed:', error);
    return false;
  }
}

// Start immediately
initializeServices();

// ========== DATA STRUCTURES ========== //
// (In a real app, these might come from the DB, but we keep them static for stability now)
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

// ========== FIREBASE SERVICES ========== //
const FirebaseService = {
  async saveUser(userData) {
    try {
      const userRef = db.collection('users').doc(userData.id.toString());
      await userRef.set({
        ...userData,
        lastActive: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
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
      await db.collection('notes').doc(noteId).update({
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
      const idToCheck = parseInt(adminId);
      const snapshot = await db.collection('notes')
        .where('uploadedBy', '==', idToCheck)
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
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

  async uploadHTMLToStorage(fileBuffer, noteId) {
    try {
      const fileName = `notes/${noteId}.html`;
      const file = bucket.file(fileName);
      
      await file.save(fileBuffer, {
        metadata: {
          contentType: 'text/html',
          cacheControl: 'public, max-age=3600'
        }
      });
      
      const [url] = await file.getSignedUrl({
        action: 'read',
        expires: '01-01-2500'
      });
      
      return url;
    } catch (error) {
      console.error('Firebase uploadHTML error:', error);
      return null;
    }
  },

  async getStats() {
    try {
      const [notesSnapshot, usersSnapshot] = await Promise.all([
        db.collection('notes').get(),
        db.collection('users').get()
      ]);
      
      return { 
        totalNotes: notesSnapshot.size, 
        activeNotes: notesSnapshot.docs.filter(doc => doc.data().is_active !== false).length,
        totalUsers: usersSnapshot.size, 
        totalViews: notesSnapshot.docs.reduce((sum, doc) => sum + (doc.data().views || 0), 0)
      };
    } catch (error) {
      console.error('Firebase getStats error:', error);
      return { totalNotes: 0, activeNotes: 0, totalUsers: 0, totalViews: 0 };
    }
  }
};

// ========== UI FUNCTIONS ========== //
const showMainMenu = async (chatId, userId) => {
  const isAdmin = ADMIN_IDS.includes(userId);
  if (isAdmin) {
    await bot.sendMessage(chatId, `🤖 *JU Notes Admin Panel*\nSelect an option:`, { 
      parse_mode: 'Markdown',
      reply_markup: {
        keyboard: [
          [{ text: '📚 My Notes' }, { text: '📤 Upload Note' }],
          [{ text: '📁 Folders' }, { text: '📊 Statistics' }],
          [{ text: '🛠️ Test Buttons' }]
        ],
        resize_keyboard: true
      }
    });
  } else {
    await bot.sendMessage(chatId, `📚 *JU Study Materials*`, { 
      parse_mode: 'Markdown',
      reply_markup: {
        keyboard: [[{ text: '🔓 Access Notes' }, { text: '📞 Contact Admin' }]],
        resize_keyboard: true
      }
    });
  }
};

const showAdminDashboard = async (chatId) => {
  const stats = await FirebaseService.getStats();
  const message = `🤖 *Dashboard*\n\nNotes: ${stats.activeNotes}\nUsers: ${stats.totalUsers}`;
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
  const userNotes = await FirebaseService.getAdminNotes(userId);
  if (userNotes.length === 0) {
    await bot.sendMessage(chatId, `No notes found. Upload one!`, {
      reply_markup: { inline_keyboard: [[{ text: '📤 Upload Note', callback_data: 'admin_upload_note' }]] }
    });
    return;
  }
  let message = `📚 *Your Notes (${userNotes.length})*\n\n`;
  userNotes.slice(0, 10).forEach((note, i) => message += `${i+1}. ${note.title}\n`);
  
  await bot.sendMessage(chatId, message, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '📤 Upload New', callback_data: 'admin_upload_note' }],
        [{ text: '⬅️ Back', callback_data: 'back_to_dashboard' }]
      ]
    }
  });
};

const showNoteManagement = async (chatId, noteId) => {
  const note = await FirebaseService.getNote(noteId);
  if (!note) {
    await bot.sendMessage(chatId, '❌ Note not found.');
    return;
  }
  const message = `📖 *${note.title}*\nStatus: ${note.is_active ? 'Active' : 'Inactive'}`;
  const options = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🗑️ Delete', callback_data: `delete_${noteId}` }, { text: '📤 Share', callback_data: `share_${noteId}` }],
        [{ text: '⬅️ Back', callback_data: 'back_to_notes' }]
      ]
    }
  };
  await bot.sendMessage(chatId, message, { parse_mode: 'Markdown', ...options });
};

const startUploadFlow = async (chatId, userId) => {
  // Clear any existing state first
  await FirebaseService.deleteUploadState(userId);
  
  await FirebaseService.saveUploadState(userId, {
    state: 'awaiting_note_folder',
    noteData: {}
  });

  const folderButtons = Array.from(folders.values()).map(folder => [
    { text: folder.name, callback_data: `folder_${folder.id}` }
  ]);
  
  folderButtons.push([{ text: '❌ Cancel Upload', callback_data: 'cancel_upload' }]);

  await bot.sendMessage(chatId,
    `📤 *Upload New Note - Step 1/4*\n\n📁 *Select Folder:*`,
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: folderButtons } }
  );
};

// ========== LOGIC HANDLERS ========== //

const handleFolderSelection = async (chatId, userId, folderId) => {
  // 1. Check if folder exists
  const folder = folders.get(folderId);
  if (!folder) {
    await bot.sendMessage(chatId, "❌ Invalid folder selected.");
    return;
  }

  // 2. Check User State
  const uploadState = await FirebaseService.getUploadState(userId);
  
  // 3. 🚨 FIX: Add explicit error handling if state is lost
  if (!uploadState || uploadState.state !== 'awaiting_note_folder') {
    await bot.sendMessage(chatId, 
      "⚠️ **Session Expired**\n\nPlease click '📤 Upload Note' to start again.", 
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // 4. Update State
  uploadState.noteData.folder = folderId;
  uploadState.state = 'awaiting_note_category';
  await FirebaseService.saveUploadState(userId, uploadState);

  // 5. Show Categories
  const folderCategories = Array.from(categories.values()).filter(cat => cat.folder === folderId);
  const categoryButtons = folderCategories.map(cat => [{ text: cat.name, callback_data: `category_${cat.id}` }]);
  categoryButtons.push([{ text: '❌ Cancel', callback_data: 'cancel_upload' }]);

  await bot.sendMessage(chatId,
    `🎯 *Step 2/4 - Select Category*\n\nSelected: ${folder.name}\nChoose a category:`,
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: categoryButtons } }
  );
};

const handleCategorySelection = async (chatId, userId, categoryId) => {
  const uploadState = await FirebaseService.getUploadState(userId);
  
  if (!uploadState || uploadState.state !== 'awaiting_note_category') {
    await bot.sendMessage(chatId, "⚠️ **Session Expired**\n\nPlease start again.");
    return;
  }

  uploadState.noteData.category = categoryId;
  uploadState.state = 'awaiting_note_title';
  await FirebaseService.saveUploadState(userId, uploadState);

  await bot.sendMessage(chatId,
    `🏷️ *Step 3/4 - Note Title*\n\nPlease type the title of your note:`,
    { parse_mode: 'Markdown' }
  );
};

// ========== MAIN HANDLERS ========== //

const handleMessage = async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;

  if (!text) return;

  const uploadState = await FirebaseService.getUploadState(userId);

  // Handle Text Inputs for Upload Flow
  if (uploadState) {
    if (uploadState.state === 'awaiting_note_title') {
      uploadState.noteData.title = text;
      uploadState.state = 'awaiting_note_description';
      await FirebaseService.saveUploadState(userId, uploadState);
      await bot.sendMessage(chatId, `📝 *Step 3/4 - Description*\n\nEnter a description:`, { parse_mode: 'Markdown' });
      return;
    } 
    else if (uploadState.state === 'awaiting_note_description') {
      uploadState.noteData.description = text;
      uploadState.state = 'awaiting_note_file';
      await FirebaseService.saveUploadState(userId, uploadState);
      await bot.sendMessage(chatId, `📎 *Step 4/4 - File*\n\nPlease upload the .html file now.`, { parse_mode: 'Markdown' });
      return;
    }
  }

  // Handle Commands/Menu
  if (text === '/start') {
    const userData = {
      id: userId,
      firstName: msg.from.first_name || 'User',
      isAdmin: ADMIN_IDS.includes(userId),
      startedBot: true
    };
    await FirebaseService.saveUser(userData);
    if (userData.isAdmin) await showAdminDashboard(chatId);
    else await showMainMenu(chatId, userId);
  } else if (text === '📤 Upload Note' && ADMIN_IDS.includes(userId)) {
    await startUploadFlow(chatId, userId);
  } else if (text === '📚 My Notes' && ADMIN_IDS.includes(userId)) {
    await showNotesList(chatId, userId);
  } else if (text === '📁 Folders' && ADMIN_IDS.includes(userId)) {
    await showFolderManagement(chatId);
  } else if (text === '🛠️ Test Buttons') {
    await testButtons(chatId);
  }
};

const handleDocument = async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const document = msg.document;

  const uploadState = await FirebaseService.getUploadState(userId);
  
  if (uploadState && uploadState.state === 'awaiting_note_file' && document) {
    if (!document.file_name?.toLowerCase().endsWith('.html')) {
      await bot.sendMessage(chatId, "❌ Please upload an .html file");
      return;
    }

    const processingMsg = await bot.sendMessage(chatId, "⏳ Processing...");
    
    try {
      const fileLink = await bot.getFileLink(document.file_id);
      const response = await fetch(fileLink);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const noteId = `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const publicUrl = await FirebaseService.uploadHTMLToStorage(buffer, noteId);

      if (publicUrl) {
        const noteData = {
          id: noteId,
          ...uploadState.noteData,
          uploadedBy: userId,
          views: 0,
          is_active: true,
          firebase_url: publicUrl,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        };
        await FirebaseService.saveNote(noteData);
        await FirebaseService.deleteUploadState(userId);
        await bot.deleteMessage(chatId, processingMsg.message_id);
        await bot.sendMessage(chatId, "✅ Upload Complete!");
        await showNoteManagement(chatId, noteId);
      }
    } catch (e) {
      console.error(e);
      await bot.sendMessage(chatId, "❌ Upload Failed: " + e.message);
    }
  }
};

const showFolderManagement = async (chatId) => {
  let message = `📁 *Folder Management*\n\n`;
  folders.forEach(f => {
    message += `• ${f.name}\n`;
    categories.forEach(c => { if(c.folder === f.id) message += `   └ ${c.name}\n`; });
  });
  
  const options = {
    reply_markup: {
      inline_keyboard: [
        // 🚨 THESE BUTTONS NOW HAVE HANDLERS BELOW
        [{ text: '➕ Add Folder', callback_data: 'add_folder' }],
        [{ text: '➕ Add Category', callback_data: 'add_category' }],
        [{ text: '⬅️ Back', callback_data: 'back_to_dashboard' }]
      ]
    }
  };
  await bot.sendMessage(chatId, message, { parse_mode: 'Markdown', ...options });
};

// ========== CALLBACK QUERY HANDLER (THE FIX) ========== //
const handleCallbackQuery = async (callbackQuery) => {
  const message = callbackQuery.message;
  const userId = callbackQuery.from.id;
  const data = callbackQuery.data;
  const chatId = message.chat.id;

  try {
    // Stop the loading animation on the button
    await bot.answerCallbackQuery(callbackQuery.id);

    // 🚨 ROUTING LOGIC
    if (data.startsWith('folder_')) {
      await handleFolderSelection(chatId, userId, data.replace('folder_', ''));
    } 
    else if (data.startsWith('category_')) {
      await handleCategorySelection(chatId, userId, data.replace('category_', ''));
    }
    // 🚨 FIX: Added Handlers for Add Folder/Category
    else if (data === 'add_folder' || data === 'add_category') {
      await bot.sendMessage(chatId, "⚠️ Dynamic folder creation is coming soon!\n\nFor now, please use the standard folders provided.");
    }
    else if (data === 'cancel_upload') {
      await FirebaseService.deleteUploadState(userId);
      await bot.sendMessage(chatId, "❌ Upload cancelled.");
      await showAdminDashboard(chatId);
    }
    // Admin Navigation
    else if (data === 'admin_upload_note') await startUploadFlow(chatId, userId);
    else if (data === 'admin_view_notes') await showNotesList(chatId, userId);
    else if (data === 'admin_manage_folders') await showFolderManagement(chatId);
    else if (data === 'admin_bulk_ops') await bot.sendMessage(chatId, "⚡ Feature coming soon.");
    else if (data === 'back_to_dashboard') await showAdminDashboard(chatId);
    
    // Note Actions
    else if (data.startsWith('delete_')) {
      await FirebaseService.deleteNote(data.replace('delete_', ''));
      await bot.sendMessage(chatId, "🗑️ Note deleted.");
      await showNotesList(chatId, userId);
    }
    else if (data.startsWith('share_')) {
      const noteId = data.replace('share_', '');
      const note = await FirebaseService.getNote(noteId);
      if(note) await bot.sendMessage(chatId, `Copy to share:\n\n${note.title}\n${note.description}\n\n[Link](${note.firebase_url})`, {parse_mode: 'Markdown'});
    }
    // Test
    else if (data.startsWith('test_')) {
      await bot.sendMessage(chatId, `✅ Button ${data} works!`);
    }

  } catch (error) {
    console.error('Callback error:', error);
    await bot.sendMessage(chatId, "❌ An error occurred processing that button.");
  }
};

const testButtons = async (chatId) => {
  await bot.sendMessage(chatId, "🧪 Test Panel", {
    reply_markup: {
      inline_keyboard: [[{ text: "Test 1", callback_data: "test_1" }]]
    }
  });
};

// ========== SERVER ENTRY POINT ========== //
module.exports = async (req, res) => {
  if (!initializeServices()) return res.status(500).json({ error: 'Init failed' });

  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();

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
      console.error(error);
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(200).json({ status: 'Online' });
};
