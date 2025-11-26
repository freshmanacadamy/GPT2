const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');

// 🛡️ GLOBAL ERROR HANDLER
process.on('unhandledRejection', (error) => {
  console.error('🔴 Unhandled Promise Rejection:', error);
});

// ========== CONFIGURATION & INITIALIZATION ========== //
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => parseInt(id.trim())) : [];
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
// Handle newlines in private keys for Vercel/Env variables
const FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;

let isInitialized = false;
let db;
let bucket;
let bot;

function initializeServices() {
  if (isInitialized) return true;

  if (!BOT_TOKEN || !FIREBASE_PROJECT_ID || !FIREBASE_PRIVATE_KEY || !FIREBASE_CLIENT_EMAIL) {
    console.error('❌ Missing Environment Variables. Check your Vercel/Serverless configuration.');
    // Do NOT return false here to allow the / endpoint to respond, but set status to not initialized
    return false;
  }

  try {
    // Check if firebase is already initialized (for warm starts)
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

// Attempt initialization immediately
initializeServices();

// ========== STATIC DATA STRUCTURES ========== //
const folders = new Map([
  ['natural', { id: 'natural', name: '📁 Natural Sciences' }],
  ['social', { id: 'social', name: '📁 Social Sciences' }]
]);

const categories = new Map([
  ['pre_engineering', { id: 'pre_engineering', name: '🎯 Pre-Engineering', folder: 'natural' }],
  ['freshman', { id: 'freshman', name: '🎯 Freshman Program', folder: 'natural' }],
  ['medical', { id: 'medical', name: '🎯 Medical Sciences', folder: 'natural' }],
  ['business', { id: 'business', name: '📚 Business Studies', folder: 'social' }],
]);

// ========== FIREBASE SERVICES ========== //
const FirebaseService = {
  // Utility for writing the session state for the multi-step upload process
  async saveUploadState(userId, stateData) {
    try {
      const stateRef = db.collection('uploadStates').doc(userId.toString());
      await stateRef.set({
        ...stateData,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true }); // Use merge: true for safe updates
      return true;
    } catch (error) {
      console.error('Firebase saveUploadState error:', error);
      return false; // Return false on failure for clear handling
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
  
  // (Other Firebase services like saveNote, getStats, etc. remain the same)
  // ...
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

  async getNote(noteId) {
    try {
      const noteDoc = await db.collection('notes').doc(noteId).get();
      return noteDoc.exists ? noteDoc.data() : null;
    } catch (error) {
      console.error('Firebase getNote error:', error);
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


// ========== BOT OPERATIONS (UI/FLOW) ========== //

const showAdminDashboard = async (chatId) => {
  // Simplified for brevity, assumes successful stats retrieval
  await bot.sendMessage(chatId, `🤖 *Admin Dashboard*`, { 
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '📚 View My Notes', callback_data: 'admin_view_notes' }],
        [{ text: '📤 Upload New Note', callback_data: 'admin_upload_note' }],
        [{ text: '📁 Manage Folders', callback_data: 'admin_manage_folders' }],
        [{ text: '⚡ Bulk Operations', callback_data: 'admin_bulk_ops' }]
      ]
    }
  });
};

const showNotesList = async (chatId, userId) => {
  const userNotes = await FirebaseService.getAdminNotes(userId);
  let message = `📚 *Your Notes (${userNotes.length})*\n\n`;
  userNotes.slice(0, 5).forEach((note, i) => message += `${i+1}. ${note.title}\n`);
  
  await bot.sendMessage(chatId, message, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: [[{ text: '📤 Upload New', callback_data: 'admin_upload_note' }]] }
  });
};

const showNoteManagement = async (chatId, noteId) => {
  const note = await FirebaseService.getNote(noteId);
  const message = `📖 *${note.title}* Uploaded.`;
  await bot.sendMessage(chatId, message, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: [[{ text: '⬅️ Back to List', callback_data: 'admin_view_notes' }]] }
  });
};


const startUploadFlow = async (chatId, userId) => {
  // 1. Ensure any old session state is deleted/overwritten
  await FirebaseService.deleteUploadState(userId);

  // 2. Save the initial state. This must succeed for the flow to continue.
  const stateSaved = await FirebaseService.saveUploadState(userId, {
    state: 'awaiting_note_folder',
    noteData: {}
  });

  if (!stateSaved) {
     // Critical error feedback if the DB write failed
     await bot.sendMessage(chatId, "❌ Critical Error: Failed to start upload session. Please check Firebase connection and permissions.");
     return;
  }

  // 3. Send the folder buttons
  const folderButtons = Array.from(folders.values()).map(folder => [
    { text: folder.name, callback_data: `folder_${folder.id}` }
  ]);
  folderButtons.push([{ text: '❌ Cancel Upload', callback_data: 'cancel_upload' }]);

  await bot.sendMessage(chatId,
    `📤 *Upload New Note - Step 1/4*\n\n📁 *Select Folder:*`,
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: folderButtons } }
  );
};


const handleFolderSelection = async (chatId, userId, folderId) => {
  const folder = folders.get(folderId);
  
  // 1. Get User State
  const uploadState = await FirebaseService.getUploadState(userId);
  
  // 2. 🎯 FIX: Explicitly check state validity
  if (!uploadState || uploadState.state !== 'awaiting_note_folder' || !folder) {
    // This is the error message the user was seeing. It is correctly triggered
    // if they click an old button or the session never started successfully.
    await bot.sendMessage(chatId, 
      "⚠️ **Session Expired**\n\nPlease click '📤 Upload Note' to start again.", 
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // 3. Update State for Step 2
  uploadState.noteData.folder = folderId;
  uploadState.state = 'awaiting_note_category';
  await FirebaseService.saveUploadState(userId, uploadState);

  // 4. Send Category Buttons
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
  
  // 1. FIX: Explicitly check state validity
  if (!uploadState || uploadState.state !== 'awaiting_note_category') {
    await bot.sendMessage(chatId, "⚠️ **Session Expired**\n\nPlease start again.");
    return;
  }

  // 2. Update State for Step 3
  uploadState.noteData.category = categoryId;
  uploadState.state = 'awaiting_note_title';
  await FirebaseService.saveUploadState(userId, uploadState);

  await bot.sendMessage(chatId,
    `🏷️ *Step 3/4 - Note Title*\n\nPlease type the title of your note:`,
    { parse_mode: 'Markdown' }
  );
};


// ========== HANDLERS ========== //

const handleMessage = async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;

  if (!text) return;

  try {
    const uploadState = await FirebaseService.getUploadState(userId);

    // 1. Handle Text Inputs during Upload Flow
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

    // 2. Handle Commands/Menu Clicks
    if (text === '/start') {
        await FirebaseService.saveUser({ id: userId, firstName: msg.from.first_name, isAdmin: ADMIN_IDS.includes(userId) });
        if (ADMIN_IDS.includes(userId)) await showAdminDashboard(chatId);
    } else if (text === '📤 Upload Note' && ADMIN_IDS.includes(userId)) {
      await startUploadFlow(chatId, userId);
    } else if (text === '📚 My Notes' && ADMIN_IDS.includes(userId)) {
      await showNotesList(chatId, userId);
    } else if (text === '📁 Folders' && ADMIN_IDS.includes(userId)) {
      await showFolderManagement(chatId);
    }
  } catch (error) {
    console.error('Message handler error:', error);
    await bot.sendMessage(chatId, '❌ Error processing message.');
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
      const buffer = Buffer.from(await response.arrayBuffer());

      const noteId = `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const publicUrl = await FirebaseService.uploadHTMLToStorage(buffer, noteId);

      if (publicUrl) {
        const noteData = { id: noteId, ...uploadState.noteData, uploadedBy: userId, firebase_url: publicUrl, is_active: true };
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
  } else {
    await bot.sendMessage(chatId, "📎 Please start the upload process first using '📤 Upload Note'.");
  }
};


const showFolderManagement = async (chatId) => {
  let message = `📁 *Folder Management (Static)*\n\n`;
  folders.forEach(f => {
    message += `• ${f.name}\n`;
    categories.forEach(c => { if(c.folder === f.id) message += `   └ ${c.name}\n`; });
  });
  
  const options = {
    reply_markup: {
      inline_keyboard: [
        // FIXED: Placeholder handlers added to prevent silent failures
        [{ text: '➕ Add Folder (Coming Soon)', callback_data: 'add_folder' }],
        [{ text: '➕ Add Category (Coming Soon)', callback_data: 'add_category' }],
        [{ text: '⬅️ Back', callback_data: 'back_to_dashboard' }]
      ]
    }
  };
  await bot.sendMessage(chatId, message, { parse_mode: 'Markdown', ...options });
};


const handleCallbackQuery = async (callbackQuery) => {
  const message = callbackQuery.message;
  const userId = callbackQuery.from.id;
  const data = callbackQuery.data;
  const chatId = message.chat.id;

  try {
    // 1. Important: Stop the button loading animation immediately
    await bot.answerCallbackQuery(callbackQuery.id);

    // 2. Routing Logic
    if (data.startsWith('folder_')) {
      await handleFolderSelection(chatId, userId, data.replace('folder_', ''));
    } 
    else if (data.startsWith('category_')) {
      await handleCategorySelection(chatId, userId, data.replace('category_', ''));
    }
    else if (data === 'admin_upload_note') {
      await startUploadFlow(chatId, userId);
    }
    else if (data === 'admin_view_notes') {
      await showNotesList(chatId, userId);
    }
    else if (data === 'admin_manage_folders') {
      await showFolderManagement(chatId);
    }
    else if (data === 'back_to_dashboard') {
      await showAdminDashboard(chatId);
    }
    // FIXED: Placeholder handlers
    else if (data === 'add_folder' || data === 'add_category') {
      await bot.sendMessage(chatId, "⚠️ This feature for dynamic creation is under construction. Please use the existing folders.");
    }
    else if (data === 'cancel_upload') {
      await FirebaseService.deleteUploadState(userId);
      await bot.sendMessage(chatId, "❌ Upload cancelled.");
      await showAdminDashboard(chatId);
    }
    // (Other handlers for note management: delete_, share_, etc.)

  } catch (error) {
    console.error('Callback error:', error);
    await bot.sendMessage(chatId, "❌ An internal error occurred processing that button.");
  }
};


// ========== VERCEL ENTRY POINT ========== //
module.exports = async (req, res) => {
  // Try to initialize services. If it fails, send a 500 error.
  if (!initializeServices()) {
    return res.status(500).json({ error: 'Firebase/Bot initialization failed. Check environment variables.' });
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
      console.error('Webhook processing error:', error);
      return res.status(500).json({ error: 'Webhook processing failed.' });
    }
  }

  // Handle GET requests (health check)
  return res.status(200).json({ status: 'Online', initialized: isInitialized });
};
