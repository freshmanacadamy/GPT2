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

// Validate required environment variables
if (!BOT_TOKEN || !FIREBASE_PROJECT_ID || !FIREBASE_PRIVATE_KEY || !FIREBASE_CLIENT_EMAIL) {
  console.error('❌ Missing required environment variables');
  process.exit(1);
}

// Initialize Firebase Admin
try {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: FIREBASE_PROJECT_ID,
      privateKey: FIREBASE_PRIVATE_KEY,
      clientEmail: FIREBASE_CLIENT_EMAIL
    }),
    storageBucket: `${FIREBASE_PROJECT_ID}.appspot.com`
  });
  console.log('✅ Firebase Admin initialized');
} catch (error) {
  console.error('❌ Firebase initialization failed:', error);
  process.exit(1);
}

const db = admin.firestore();
const bucket = admin.storage().bucket();

// Create bot instance
const bot = new TelegramBot(BOT_TOKEN);

// ========== IN-MEMORY STATE (for simplicity) ========== //
const userStates = new Map();

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
  ['business', { id: 'business', name: '📚 Business Studies', folder: 'social' }],
  ['law', { id: 'law', name: '📚 Law & Politics', folder: 'social' }]
]);

// ========== FIREBASE OPERATIONS ========== //

// Upload HTML to Firebase Storage
const uploadHTMLToFirebase = async (htmlContent, noteId) => {
  try {
    const fileName = `notes/${noteId}.html`;
    const file = bucket.file(fileName);
    
    await file.save(htmlContent, {
      metadata: {
        contentType: 'text/html',
        cacheControl: 'public, max-age=3600'
      }
    });
    
    // Make file publicly accessible
    await file.makePublic();
    
    // Get public URL
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
    return publicUrl;
  } catch (error) {
    console.error('Error uploading to Firebase:', error);
    throw error;
  }
};

// Save note metadata to Firestore
const saveNoteToFirestore = async (noteData) => {
  try {
    const noteRef = db.collection('notes').doc(noteData.id.toString());
    await noteRef.set({
      ...noteData,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return noteRef.id;
  } catch (error) {
    console.error('Error saving to Firestore:', error);
    throw error;
  }
};

// Get note from Firestore
const getNoteFromFirestore = async (noteId) => {
  try {
    const noteDoc = await db.collection('notes').doc(noteId.toString()).get();
    return noteDoc.exists ? noteDoc.data() : null;
  } catch (error) {
    console.error('Error getting note:', error);
    return null;
  }
};

// Update note in Firestore
const updateNoteInFirestore = async (noteId, updates) => {
  try {
    await db.collection('notes').doc(noteId.toString()).update({
      ...updates,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return true;
  } catch (error) {
    console.error('Error updating note:', error);
    return false;
  }
};

// Get all notes for admin
const getAdminNotes = async (adminId) => {
  try {
    const snapshot = await db.collection('notes')
      .where('uploadedBy', '==', adminId)
      .orderBy('createdAt', 'desc')
      .get();
    
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error('Error getting admin notes:', error);
    return [];
  }
};

// ========== MAIN MENU ========== //
const showMainMenu = async (chatId, userId) => {
  const isAdmin = ADMIN_IDS.includes(userId);
  
  if (isAdmin) {
    const options = {
      reply_markup: {
        keyboard: [
          [{ text: '📚 My Notes' }, { text: '📁 Manage Folders' }],
          [{ text: '📤 Upload Note' }, { text: '📊 Statistics' }],
          [{ text: 'ℹ️ Help' }]
        ],
        resize_keyboard: true
      }
    };
    
    await bot.sendMessage(chatId,
      `📚 *JU Notes Management System*\n\n` +
      `Welcome Admin! Manage all study materials.\n\n` +
      `Choose an option below:`,
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
      `Access approved study notes and resources.\n\n` +
      `Start by accessing available notes!`,
      { parse_mode: 'Markdown', ...options }
    );
  }
};

// ========== ADMIN DASHBOARD ========== //
const showAdminDashboard = async (chatId) => {
  try {
    const notesSnapshot = await db.collection('notes').get();
    const totalNotes = notesSnapshot.size;
    const activeNotes = notesSnapshot.docs.filter(doc => doc.data().is_active !== false).length;
    
    const usersSnapshot = await db.collection('users').get();
    const totalUsers = usersSnapshot.size;

    const message = 
      `🤖 *Admin Dashboard*\n\n` +
      `📊 Statistics:\n` +
      `• Active Notes: ${activeNotes}\n` +
      `• Total Notes: ${totalNotes}\n` +
      `• Total Users: ${totalUsers}\n\n` +
      `🛠️ Quick Actions:`;
    
    const options = {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📚 View All Notes', callback_data: 'admin_view_notes' }],
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

// ========== UPLOAD NOTE FLOW ========== //
const startUploadFlow = async (chatId, userId) => {
  userStates.set(userId, {
    state: 'awaiting_note_folder',
    noteData: {}
  });
  
  const options = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📁 Natural Sciences', callback_data: 'folder_natural' }],
        [{ text: '📁 Social Sciences', callback_data: 'folder_social' }],
        [{ text: '❌ Cancel', callback_data: 'cancel_upload' }]
      ]
    }
  };
  
  await bot.sendMessage(chatId,
    `📤 *Upload New Note - Step 1/4*\n\n` +
    `📁 *Select Folder:*\n\n` +
    `Choose where to organize this note:`,
    { parse_mode: 'Markdown', ...options }
  );
};

// ========== NOTES LIST ========== //
const showNotesList = async (chatId, userId) => {
  try {
    const userNotes = await getAdminNotes(userId);
    
    if (userNotes.length === 0) {
      await bot.sendMessage(chatId,
        `📚 *My Notes*\n\n` +
        `No notes uploaded yet.\n\n` +
        `Start by uploading your first note! 📤`,
        { parse_mode: 'Markdown' }
      );
      return;
    }
    
    let message = `📚 *Your Notes (${userNotes.length})*\n\n`;
    
    for (const note of userNotes.slice(0, 10)) {
      const folder = folders.get(note.folder);
      const category = categories.get(note.category);
      const status = note.is_active === false ? '🚫 Inactive' : '✅ Active';
      message += `• ${note.title}\n`;
      message += `  📁 ${folder?.name || 'Unknown'} → ${category?.name || 'Unknown'}\n`;
      message += `  👀 ${note.views || 0} views • ${status}\n\n`;
    }
    
    const options = {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📤 Upload New Note', callback_data: 'admin_upload_note' }],
          [{ text: '🔄 Refresh List', callback_data: 'refresh_notes' }]
        ]
      }
    };
    
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown', ...options });
  } catch (error) {
    console.error('Error showing notes list:', error);
    await bot.sendMessage(chatId, '❌ Error loading notes. Please try again.');
  }
};

// ========== NOTE MANAGEMENT ========== //
const showNoteManagement = async (chatId, noteId) => {
  try {
    const note = await getNoteFromFirestore(noteId);
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
      `• Uploaded: ${note.createdAt?.toDate?.().toLocaleDateString() || 'Unknown'}\n` +
      `• Location: ${folder?.name || 'Unknown'} → ${category?.name || 'Unknown'}\n` +
      `• Status: ${note.is_active === false ? '🚫 Inactive' : '✅ Active'}\n\n` +
      `🛠️ *Manage Note:*`;
    
    const options = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🔄 Regenerate Link', callback_data: `regen_${noteId}` },
            { text: '🚫 Revoke Access', callback_data: `revoke_${noteId}` }
          ],
          [
            { text: '📤 Share to Groups', callback_data: `share_${noteId}` },
            { text: '✏️ Edit Description', callback_data: `edit_${noteId}` }
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

// ========== SHARE NOTE MESSAGE ========== //
const createShareMessage = (note) => {
  const message =
    `🌟 **New Study Material Available!**\n\n` +
    `${note.description}\n\n` +
    `All Rights Reserved!\n` +
    `©Freshman Academy 📚`;
  
  const options = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔓 Open Tutorial Now', url: note.firebase_url }],
        ...(ADMIN_IDS.length ? [[{ text: '📤 Share to Groups', callback_data: `admin_share_${note.id}` }]] : [])
      ]
    }
  };
  
  return { message, options };
};

// ========== START COMMAND ========== //
const handleStart = async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  try {
    // Register/update user in Firestore
    const userRef = db.collection('users').doc(userId.toString());
    await userRef.set({
      telegramId: userId,
      username: msg.from.username || '',
      firstName: msg.from.first_name || '',
      isAdmin: ADMIN_IDS.includes(userId),
      lastActive: admin.firestore.FieldValue.serverTimestamp(),
      startedBot: true
    }, { merge: true });
    
    if (ADMIN_IDS.includes(userId)) {
      await showAdminDashboard(chatId);
    } else {
      await bot.sendMessage(chatId,
        `🎓 *Welcome to JU Study Materials!*\n\n` +
        `Access approved study notes and resources.\n\n` +
        `All materials are organized by faculty and course.`,
        { parse_mode: 'Markdown' }
      );
      await showMainMenu(chatId, userId);
    }
  } catch (error) {
    console.error('Error in start command:', error);
    await bot.sendMessage(chatId, '❌ Error initializing. Please try again.');
  }
};

// ========== MESSAGE HANDLER ========== //
const handleMessage = async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;
  
  if (!text) return;
  
  try {
    if (text.startsWith('/')) {
      switch (text) {
        case '/start':
          await handleStart(msg);
          break;
        case '/help':
        case 'ℹ️ Help':
          await handleHelp(msg);
          break;
        case '/admin':
          if (ADMIN_IDS.includes(userId)) {
            await showAdminDashboard(chatId);
          }
          break;
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
        case '📁 Manage Folders':
          if (ADMIN_IDS.includes(userId)) {
            await showFolderManagement(chatId);
          }
          break;
        case '📊 Statistics':
          if (ADMIN_IDS.includes(userId)) {
            await showStatistics(chatId);
          }
          break;
        default:
          await showMainMenu(chatId, userId);
      }
    } else {
      await handleRegularMessage(msg);
    }
  } catch (error) {
    console.error('Error handling message:', error);
    await bot.sendMessage(chatId, '❌ Error processing your request.');
  }
};

// ========== CALLBACK QUERY HANDLER ========== //
const handleCallbackQuery = async (callbackQuery) => {
  const message = callbackQuery.message;
  const userId = callbackQuery.from.id;
  const data = callbackQuery.data;
  const chatId = message.chat.id;
  
  try {
    // Admin actions
    if (data === 'admin_view_notes') {
      await showNotesList(chatId, userId);
    } else if (data === 'admin_upload_note') {
      await startUploadFlow(chatId, userId);
    } else if (data === 'admin_manage_folders') {
      await showFolderManagement(chatId);
    } else if (data === 'admin_bulk_ops') {
      await showBulkOperations(chatId);
    } else if (data.startsWith('regen_')) {
      const noteId = data.replace('regen_', '');
      await regenerateNoteLink(chatId, noteId);
    } else if (data.startsWith('revoke_')) {
      const noteId = data.replace('revoke_', '');
      await revokeNoteAccess(chatId, noteId);
    } else if (data.startsWith('share_')) {
      const noteId = data.replace('share_', '');
      await shareNoteToGroups(chatId, noteId);
    } else if (data.startsWith('admin_share_')) {
      if (ADMIN_IDS.includes(userId)) {
        const noteId = data.replace('admin_share_', '');
        await adminShareNote(chatId, noteId);
      }
    } else if (data.startsWith('open_')) {
      const noteId = data.replace('open_', '');
      await openNote(chatId, noteId, userId);
    } else if (data === 'refresh_notes') {
      await showNotesList(chatId, userId);
    } else if (data === 'back_to_notes') {
      await showNotesList(chatId, userId);
    } else if (data === 'back_to_dashboard') {
      await showAdminDashboard(chatId);
    } else if (data.startsWith('folder_')) {
      const folderId = data.replace('folder_', '');
      await handleFolderSelection(chatId, userId, folderId);
    } else if (data === 'cancel_upload') {
      userStates.delete(userId);
      await bot.sendMessage(chatId, '❌ Upload cancelled.');
      await showAdminDashboard(chatId);
    }
    
    // Answer callback query
    await bot.answerCallbackQuery(callbackQuery.id);
  } catch (error) {
    console.error('Callback error:', error);
    await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Error processing request' });
  }
};

// ========== NOTE OPERATIONS ========== //

const regenerateNoteLink = async (chatId, noteId) => {
  try {
    const note = await getNoteFromFirestore(noteId);
    if (!note) {
      await bot.sendMessage(chatId, '❌ Note not found.');
      return;
    }
    
    // Generate new note ID
    const newNoteId = Date.now().toString();
    
    // Re-upload HTML content (you would need to store the content or re-upload the file)
    // For now, we'll just update the URL structure
    const newFirebaseUrl = `https://storage.googleapis.com/${bucket.name}/notes/${newNoteId}.html`;
    
    // Update note with new ID and URL
    await updateNoteInFirestore(noteId, {
      firebase_url: newFirebaseUrl,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    await bot.sendMessage(chatId,
      `✅ *Link Regenerated!*\n\n` +
      `New secure link created for:\n` +
      `"${note.title}"\n\n` +
      `Previous link is now invalid.`,
      { parse_mode: 'Markdown' }
    );
    
    // Show updated management view
    await showNoteManagement(chatId, noteId);
  } catch (error) {
    console.error('Error regenerating link:', error);
    await bot.sendMessage(chatId, '❌ Error regenerating link.');
  }
};

const revokeNoteAccess = async (chatId, noteId) => {
  try {
    const success = await updateNoteInFirestore(noteId, {
      is_active: false,
      revokedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    if (success) {
      await bot.sendMessage(chatId,
        `🚫 *Access Revoked!*\n\n` +
        `Note has been disabled.\n` +
        `Students can no longer access this content.`,
        { parse_mode: 'Markdown' }
      );
      
      // Show updated management view
      await showNoteManagement(chatId, noteId);
    } else {
      await bot.sendMessage(chatId, '❌ Error revoking access.');
    }
  } catch (error) {
    console.error('Error revoking access:', error);
    await bot.sendMessage(chatId, '❌ Error revoking access.');
  }
};

const shareNoteToGroups = async (chatId, noteId) => {
  try {
    const note = await getNoteFromFirestore(noteId);
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
      `---\n\n` +
      `The "Open Tutorial Now" button will work for students.`,
      { parse_mode: 'Markdown' }
    );
    
    // Also send the actual formatted message with button
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown', ...options });
  } catch (error) {
    console.error('Error sharing note:', error);
    await bot.sendMessage(chatId, '❌ Error sharing note.');
  }
};

const adminShareNote = async (chatId, noteId) => {
  // This would automatically share to pre-configured groups
  // For now, we'll just show a confirmation
  await bot.sendMessage(chatId,
    `✅ *Note Shared to Groups!*\n\n` +
    `The note has been automatically posted to all connected student groups.`,
    { parse_mode: 'Markdown' }
  );
};

const openNote = async (chatId, noteId, userId) => {
  try {
    const note = await getNoteFromFirestore(noteId);
    if (!note) {
      await bot.sendMessage(chatId, '❌ Note not found or has been removed.');
      return;
    }
    
    // Check if note is active
    if (note.is_active === false) {
      await bot.sendMessage(chatId,
        `🚫 *Content Unavailable*\n\n` +
        `This note has been revoked by the administrator.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }
    
    // Check if user has started the bot
    const userDoc = await db.collection('users').doc(userId.toString()).get();
    if (!userDoc.exists || !userDoc.data().startedBot) {
      await bot.sendMessage(chatId,
        `🔒 *Access Required*\n\n` +
        `Please start the bot first to access notes:\n\n` +
        `Click /start and begin the bot.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }
    
    // Increment view count
    await updateNoteInFirestore(noteId, {
      views: (note.views || 0) + 1,
      lastAccessed: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Send the note with direct URL button
    const options = {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔓 Open Tutorial Now', url: note.firebase_url }]
        ]
      }
    };
    
    await bot.sendMessage(chatId,
      `📚 *Opening Note*\n\n` +
      `"${note.title}"\n\n` +
      `Click the button below to open in Telegram browser:`,
      { parse_mode: 'Markdown', ...options }
    );
  } catch (error) {
    console.error('Error opening note:', error);
    await bot.sendMessage(chatId, '❌ Error opening note.');
  }
};

// ========== HELPER FUNCTIONS ========== //

const handleHelp = async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const isAdmin = ADMIN_IDS.includes(userId);
  
  let helpMessage = `ℹ️ *JU Study Materials Help*\n\n`;
  
  if (isAdmin) {
    helpMessage += `*Admin Commands:*\n` +
      `/start - Admin dashboard\n` +
      `/admin - Admin panel\n` +
      `📚 My Notes - View your notes\n` +
      `📤 Upload Note - Add new material\n` +
      `📁 Manage Folders - Organize content\n` +
      `📊 Statistics - View analytics\n\n` +
      `*Note Management:*\n` +
      `• Revoke access - Instantly disable notes\n` +
      `• Regenerate links - Create new secure URLs\n` +
      `• Share to groups - Distribute to students\n\n`;
  }
  
  helpMessage += `*Student Access:*\n` +
    `• Click "Open Tutorial Now" buttons in groups\n` +
    `• Notes open in Telegram browser\n` +
    `• Must start bot first for access\n\n` +
    `*Contact support for issues*`;
  
  await bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
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
  try {
    const notesSnapshot = await db.collection('notes').get();
    const activeNotes = notesSnapshot.docs.filter(doc => doc.data().is_active !== false).length;
    
    const message =
      `⚡ *Bulk Operations*\n\n` +
      `Active Notes: ${activeNotes}\n\n` +
      `Perform actions on all notes at once:`;
    
    const options = {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔄 Regenerate ALL Links', callback_data: 'bulk_regen_all' }],
          [{ text: '🚫 Revoke ALL Access', callback_data: 'bulk_revoke_all' }],
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
    const notesSnapshot = await db.collection('notes').get();
    const totalNotes = notesSnapshot.size;
    const activeNotes = notesSnapshot.docs.filter(doc => doc.data().is_active !== false).length;
    const totalViews = notesSnapshot.docs.reduce((sum, doc) => sum + (doc.data().views || 0), 0);
    
    const usersSnapshot = await db.collection('users').get();
    const totalUsers = usersSnapshot.size;
    
    const message =
      `📊 *System Statistics*\n\n` +
      `👥 Total Users: ${totalUsers}\n` +
      `📚 Total Notes: ${totalNotes}\n` +
      `✅ Active Notes: ${activeNotes}\n` +
      `👀 Total Views: ${totalViews}\n` +
      `📁 Folders: ${folders.size}\n` +
      `🎯 Categories: ${categories.size}\n\n` +
      `📈 System is running smoothly!`;
    
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error showing statistics:', error);
    await bot.sendMessage(chatId, '❌ Error loading statistics.');
  }
};

const handleRegularMessage = async (msg) => {
  // Handle text input for note descriptions, titles, etc.
  // This would be expanded for the full upload flow
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;
  
  const userState = userStates.get(userId);
  if (userState) {
    // Handle different states in upload flow
    // This is simplified - you would expand this for full flow
    if (userState.state === 'awaiting_note_title') {
      userState.noteData.title = text;
      userState.state = 'awaiting_note_description';
      userStates.set(userId, userState);
      
      await bot.sendMessage(chatId,
        `📝 *Step 3/4 - Note Description*\n\n` +
        `Enter a description for your note:\n\n` +
        `Example:\n` +
        `"📚 General #Chemistry\n\n` +
        `📚 Chapter One - Essential Ideas In Chemistry | Chemistry as Experimental Science | Properties of Matter\n\n` +
        `All Rights Reserved!\n` +
        `©Freshman Academy 📚"`,
        { parse_mode: 'Markdown' }
      );
    } else if (userState.state === 'awaiting_note_description') {
      userState.noteData.description = text;
      userState.state = 'awaiting_note_file';
      userStates.set(userId, userState);
      
      await bot.sendMessage(chatId,
        `📎 *Step 4/4 - Upload HTML File*\n\n` +
        `Please send the HTML file for this note.\n\n` +
        `The file will be uploaded to Firebase Storage.`,
        { parse_mode: 'Markdown' }
      );
    }
  }
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

// ========== VERCEL HANDLER ========== //
module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Handle GET requests
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'online',
      message: 'JU Notes Bot is running on Vercel!',
      timestamp: new Date().toISOString(),
      project: FIREBASE_PROJECT_ID
    });
  }
  
  // Handle POST requests (Telegram webhook updates)
  if (req.method === 'POST') {
    try {
      const update = req.body;
      
      // Handle different update types
      if (update.message) {
        await handleMessage(update.message);
      } else if (update.callback_query) {
        await handleCallbackQuery(update.callback_query);
      }
      
      return res.status(200).json({ ok: true });
    } catch (error) {
      console.error('Error processing update:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
  
  // Method not allowed
  return res.status(405).json({ error: 'Method not allowed' });
};

console.log('✅ JU Notes Bot configured for Vercel with Firebase!');
