const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');

// 🛡️ GLOBAL ERROR HANDLER
process.on('unhandledRejection', (error) => {
  console.error('🔴 Unhandled Promise Rejection:', error);
});

// ========== CONFIGURATION ========== //
const BOT_TOKEN = process.env.BOT_TOKEN;
// Ensure ADMIN_IDS is always an array of numbers
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => parseInt(id.trim())) : [];
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
// Handle newlines in private keys for Vercel/Env variables
const FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;

// Initialization State
let isInitialized = false;
let db;
let bucket;
let bot;

// Initialize Firebase & Bot (Wrapped to be safe for Serverless)
function initializeServices() {
  if (isInitialized) return true;

  if (!BOT_TOKEN || !FIREBASE_PROJECT_ID || !FIREBASE_PRIVATE_KEY || !FIREBASE_CLIENT_EMAIL) {
    console.error('❌ Missing Environment Variables');
    return false;
  }

  try {
    // Check if firebase is already initialized to prevent "App already exists" error
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
    bot = new TelegramBot(BOT_TOKEN, { polling: false }); // Webhook mode
    
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

// ========== DATA STRUCTURES ========== //
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
      // Ensure adminId matches the type stored in DB (Number)
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

  // 🛠️ FIXED: Real File Upload Logic with Signed URLs
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
      
      // FIXED: Use Signed URL instead of makePublic() for better compatibility
      // This creates a URL valid for ~500 years
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
      
      const totalNotes = notesSnapshot.size;
      const activeNotes = notesSnapshot.docs.filter(doc => doc.data().is_active !== false).length;
      const totalUsers = usersSnapshot.size;
      const totalViews = notesSnapshot.docs.reduce((sum, doc) => sum + (doc.data().views || 0), 0);
      
      return { totalNotes, activeNotes, totalUsers, totalViews };
    } catch (error) {
      console.error('Firebase getStats error:', error);
      return { totalNotes: 0, activeNotes: 0, totalUsers: 0, totalViews: 0 };
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
    const note = await FirebaseService.getNote(noteId);

    if (!note) {
      await bot.sendMessage(chatId, '❌ Note not found. It may have been deleted.');
      return;
    }

    const folder = folders.get(note.folder);
    const category = categories.get(note.category);
    // Safe date handling
    const uploadedDate = note.createdAt?.toDate 
      ? note.createdAt.toDate().toLocaleDateString() 
      : new Date().toLocaleDateString();

    const message =
      `📖 *${note.title}*\n\n` +
      `📝 *Description:*\n${note.description || 'No description'}\n\n` +
      `📊 *Statistics:*\n` +
      `• Views: ${note.views || 0} students\n` +
      `• Status: ${note.is_active === false ? '🚫 Inactive' : '✅ Active'}\n` +
      `• Location: ${folder?.name || 'Unknown'} → ${category?.name || 'Unknown'}\n` +
      `• Uploaded: ${uploadedDate}\n\n` +
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
  try {
    await FirebaseService.saveUploadState(userId, {
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
  } catch (error) {
    console.error('Error starting upload flow:', error);
    await bot.sendMessage(chatId, '❌ Error starting upload process.');
  }
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
    const note = await FirebaseService.getNote(noteId);

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

// ========== HANDLERS ========== //

const handleStart = async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  console.log(`🚀 Start command from user ${userId}`);

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
      await bot.sendMessage(chatId,
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

const handleMessage = async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;

  console.log(`📨 Message from ${userId}: ${text}`);

  if (!text) return;

  try {
    // Check upload state first
    const uploadState = await FirebaseService.getUploadState(userId);
    if (uploadState) {
      if (uploadState.state === 'awaiting_note_title') {
        uploadState.noteData.title = text;
        uploadState.state = 'awaiting_note_description';
        await FirebaseService.saveUploadState(userId, uploadState);
        
        await bot.sendMessage(chatId,
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
      }
      else if (uploadState.state === 'awaiting_note_description') {
        uploadState.noteData.description = text;
        uploadState.state = 'awaiting_note_file';
        await FirebaseService.saveUploadState(userId, uploadState);
        
        await bot.sendMessage(chatId,
          `📎 *Step 4/4 - Upload HTML File*\n\n` +
          `🎉 Almost done! Now send me the HTML file.\n\n` +
          `*How to upload:*\n` +
          `1. Click the 📎 paperclip icon\n` +
          `2. Select "Document" (or File)\n` +
          `3. Choose your .html file\n` +
          `4. Send it to me\n\n` +
          `I'll handle the rest automatically! 🚀`,
          { parse_mode: 'Markdown' }
        );
        return;
      }
    }

    // Process normal commands
    if (text.startsWith('/')) {
      switch (text) {
        case '/start': await handleStart(msg); break;
        case '/admin': 
          if (ADMIN_IDS.includes(userId)) await showAdminDashboard(chatId);
          break;
        case '/test': await testButtons(chatId); break;
        default: await showMainMenu(chatId, userId);
      }
    } else {
      switch (text) {
        case '📚 My Notes':
          if (ADMIN_IDS.includes(userId)) await showNotesList(chatId, userId);
          break;
        case '📤 Upload Note':
          if (ADMIN_IDS.includes(userId)) await startUploadFlow(chatId, userId);
          break;
        case '📁 Folders':
          if (ADMIN_IDS.includes(userId)) await showFolderManagement(chatId);
          break;
        case '📊 Statistics':
          if (ADMIN_IDS.includes(userId)) await showStatistics(chatId);
          break;
        case '🛠️ Test Buttons': await testButtons(chatId); break;
        default: await showMainMenu(chatId, userId);
      }
    }
  } catch (error) {
    console.error('Message handler error:', error);
    await bot.sendMessage(chatId, '❌ Error processing message.');
  }
};

// 🛠️ FIXED: Document Handler with REAL Download/Upload
const handleDocument = async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const document = msg.document;

  console.log(`📎 Document from ${userId}:`, document?.file_name);

  try {
    const uploadState = await FirebaseService.getUploadState(userId);
    
    if (uploadState && uploadState.state === 'awaiting_note_file' && document) {
      if (!document.file_name?.toLowerCase().endsWith('.html')) {
        await bot.sendMessage(chatId,
          `❌ *Invalid File Type*\n\n` +
          `Please send an HTML file (.html extension).\n\n` +
          `Current file: ${document.file_name}`,
          { parse_mode: 'Markdown' }
        );
        return;
      }

      const processingMsg = await bot.sendMessage(chatId, `⏳ Downloading and processing file...`);

      // 1. Get the download link from Telegram
      const fileLink = await bot.getFileLink(document.file_id);
      
      // 2. Download the file using native fetch (Node 18+)
      const response = await fetch(fileLink);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // 3. Generate unique note ID
      const noteId = `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // 4. Upload to Firebase Storage
      const publicUrl = await FirebaseService.uploadHTMLToStorage(buffer, noteId);

      if (!publicUrl) {
        throw new Error('Failed to upload file to storage');
      }

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
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      };

      // 5. Save metadata to Firestore
      const noteSaved = await FirebaseService.saveNote(noteData);
      
      if (noteSaved) {
        await FirebaseService.deleteUploadState(userId);
        await bot.deleteMessage(chatId, processingMsg.message_id);

        await bot.sendMessage(chatId,
          `✅ *Note Uploaded Successfully!*\n\n` +
          `📖 *Title:* ${noteData.title}\n` +
          `📁 *Location:* ${folders.get(noteData.folder)?.name} → ${categories.get(noteData.category)?.name}\n\n` +
          `🎉 Your note is now live and ready to share!`,
          { parse_mode: 'Markdown' }
        );

        await showNoteManagement(chatId, noteData.id);
      } else {
        throw new Error('Failed to save note to database');
      }

    } else {
      await bot.sendMessage(chatId,
        `📎 I see you sent a file, but you're not in upload mode.\n\n` +
        `Use "📤 Upload Note" to start the upload process.`
      );
    }
  } catch (error) {
    console.error('Document upload error:', error);
    await bot.sendMessage(chatId,
      `❌ *Upload Failed*\n\n` +
      `Error: ${error.message}\n\n` +
      `Please try again.`
    );
  }
};

const handleCallbackQuery = async (callbackQuery) => {
  const message = callbackQuery.message;
  const userId = callbackQuery.from.id;
  const data = callbackQuery.data;
  const chatId = message.chat.id;

  try {
    // Only answer if we can
    try { await bot.answerCallbackQuery(callbackQuery.id); } catch (e) {}

    if (data.startsWith('test_')) {
      const testNum = data.replace('test_', '');
      await bot.sendMessage(chatId, `✅ Test button ${testNum} worked! 🎉`);
    }
    else if (data === 'admin_view_notes') await showNotesList(chatId, userId);
    else if (data === 'admin_upload_note') await startUploadFlow(chatId, userId);
    else if (data === 'admin_manage_folders') await showFolderManagement(chatId);
    else if (data === 'admin_bulk_ops') await showBulkOperations(chatId);
    else if (data === 'refresh_notes') await showNotesList(chatId, userId);
    else if (data === 'back_to_notes') await showNotesList(chatId, userId);
    else if (data === 'back_to_dashboard') await showAdminDashboard(chatId);
    else if (data.startsWith('folder_')) await handleFolderSelection(chatId, userId, data.replace('folder_', ''));
    else if (data.startsWith('category_')) await handleCategorySelection(chatId, userId, data.replace('category_', ''));
    else if (data.startsWith('regen_')) await regenerateNoteLink(chatId, data.replace('regen_', ''));
    else if (data.startsWith('revoke_')) await revokeNoteAccess(chatId, data.replace('revoke_', ''));
    else if (data.startsWith('share_')) await shareNoteToGroups(chatId, data.replace('share_', ''));
    else if (data.startsWith('open_')) await openNote(chatId, data.replace('open_', ''), userId);
    else if (data.startsWith('delete_')) await deleteNote(chatId, data.replace('delete_', ''), userId);
    else if (data === 'cancel_upload') {
      await FirebaseService.deleteUploadState(userId);
      await bot.sendMessage(chatId, '❌ Upload cancelled.');
      await showAdminDashboard(chatId);
    }

  } catch (error) {
    console.error('Callback error:', error);
    await bot.sendMessage(chatId, '❌ Error processing button');
  }
};

// Helper Functions
const testButtons = async (chatId) => {
  const options = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🔄 Test Button 1", callback_data: "test_1" }],
        [{ text: "📚 View Notes", callback_data: "admin_view_notes" }]
      ]
    }
  };
  await bot.sendMessage(chatId, "🧪 **Button Test Panel**", { parse_mode: 'Markdown', ...options });
};

const showFolderManagement = async (chatId) => {
  let message = `📁 *Folder Management*\n\n`;
  folders.forEach(folder => {
    message += `${folder.name}\n`;
    categories.forEach(cat => {
      if (cat.folder === folder.id) message += `  └─ ${cat.name}\n`;
    });
    message += `\n`;
  });
  const options = { reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'back_to_dashboard' }]] } };
  await bot.sendMessage(chatId, message, { parse_mode: 'Markdown', ...options });
};

const showBulkOperations = async (chatId) => {
  const options = { reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'back_to_dashboard' }]] } };
  await bot.sendMessage(chatId, "⚡ Bulk Operations are not yet implemented.", options);
};

const showStatistics = async (chatId) => {
  const stats = await FirebaseService.getStats();
  const message = `📊 *System Stats*\n\nUsers: ${stats.totalUsers}\nNotes: ${stats.totalNotes}`;
  await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
};

const handleFolderSelection = async (chatId, userId, folderId) => {
  const uploadState = await FirebaseService.getUploadState(userId);
  if (uploadState && uploadState.state === 'awaiting_note_folder') {
    uploadState.noteData.folder = folderId;
    uploadState.state = 'awaiting_note_category';
    await FirebaseService.saveUploadState(userId, uploadState);

    const folderCategories = Array.from(categories.values()).filter(cat => cat.folder === folderId);
    const categoryButtons = folderCategories.map(cat => [{ text: cat.name, callback_data: `category_${cat.id}` }]);
    categoryButtons.push([{ text: '❌ Cancel', callback_data: 'cancel_upload' }]);

    await bot.sendMessage(chatId, `🎯 Select Category:`, { reply_markup: { inline_keyboard: categoryButtons } });
  }
};

const handleCategorySelection = async (chatId, userId, categoryId) => {
  const uploadState = await FirebaseService.getUploadState(userId);
  if (uploadState && uploadState.state === 'awaiting_note_category') {
    uploadState.noteData.category = categoryId;
    uploadState.state = 'awaiting_note_title';
    await FirebaseService.saveUploadState(userId, uploadState);
    await bot.sendMessage(chatId, `🏷️ Enter Note Title:`);
  }
};

const regenerateNoteLink = async (chatId, noteId) => {
  const newNoteId = `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  // Note: We don't actually move the file in storage here, just changing the URL reference in DB
  // In a real app, you might want to re-upload or copy the file. 
  // For now, we assume the URL is what matters.
  await bot.sendMessage(chatId, `⚠️ To regenerate the link properly, please re-upload the note.`);
};

const revokeNoteAccess = async (chatId, noteId) => {
  await FirebaseService.updateNote(noteId, { is_active: false });
  await bot.sendMessage(chatId, `🚫 Access Revoked.`);
  await showNoteManagement(chatId, noteId);
};

const openNote = async (chatId, noteId, userId) => {
  const note = await FirebaseService.getNote(noteId);
  if (!note || note.is_active === false) {
    await bot.sendMessage(chatId, `🚫 Unavailable.`);
    return;
  }
  const user = await FirebaseService.getUser(userId);
  if (!user || !user.startedBot) {
    await bot.sendMessage(chatId, `🔒 Please start the bot first.`);
    return;
  }
  await FirebaseService.updateNote(noteId, { views: (note.views || 0) + 1 });
  await bot.sendMessage(chatId, `📚 Opening...`, { reply_markup: { inline_keyboard: [[{ text: '🔓 Open', url: note.firebase_url }]] } });
};

const deleteNote = async (chatId, noteId, userId) => {
  await FirebaseService.deleteNote(noteId);
  await bot.sendMessage(chatId, `🗑️ Deleted.`);
  await showNotesList(chatId, userId);
};

// ========== VERCEL ENTRY POINT ========== //
module.exports = async (req, res) => {
  // Ensure services are ready
  if (!initializeServices()) {
    return res.status(500).json({ error: 'Failed to initialize services' });
  }

  // Handle CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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
      console.error('Webhook error:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(200).json({ status: 'Online', time: new Date().toISOString() });
};

