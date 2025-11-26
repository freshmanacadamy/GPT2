const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');

// 🛡️ GLOBAL ERROR HANDLER
process.on('unhandledRejection', (error) => {
  console.error('🔴 Unhandled Promise Rejection:', error);
});

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(Number) : [];
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;

// Validate environment variables
console.log('🔧 Environment Check:');
console.log('- BOT_TOKEN:', BOT_TOKEN ? '✅' : '❌');
console.log('- FIREBASE_PROJECT_ID:', FIREBASE_PROJECT_ID || '❌');
console.log('- FIREBASE_CLIENT_EMAIL:', FIREBASE_CLIENT_EMAIL || '❌');
console.log('- FIREBASE_PRIVATE_KEY:', FIREBASE_PRIVATE_KEY ? '✅' : '❌');

if (!BOT_TOKEN || !FIREBASE_PROJECT_ID || !FIREBASE_PRIVATE_KEY || !FIREBASE_CLIENT_EMAIL) {
  console.error('❌ Missing environment variables');
  process.exit(1);
}

// Initialize Firebase with NEW database
let db, bucket;
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
  console.log('✅ New Firebase database initialized successfully');
  
} catch (error) {
  console.error('❌ Firebase initialization failed:', error.message);
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: false });

// ========== FIREBASE SERVICE ========== //
const FirebaseService = {
  async testConnection() {
    try {
      const testRef = db.collection('config').doc('bot_status');
      await testRef.set({ 
        status: 'active', 
        lastTest: admin.firestore.FieldValue.serverTimestamp(),
        message: 'Bot connected successfully to new database'
      });
      return true;
    } catch (error) {
      console.error('Firebase test failed:', error);
      return false;
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
      console.error('Save note error:', error);
      return false;
    }
  },

  async getAdminNotes(adminId) {
    try {
      const snapshot = await db.collection('notes')
        .where('uploadedBy', '==', parseInt(adminId))
        .orderBy('createdAt', 'desc')
        .limit(20)
        .get();
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.error('Get notes error:', error);
      return [];
    }
  },

  async saveUploadState(userId, stateData) {
    try {
      const stateRef = db.collection('upload_states').doc(userId.toString());
      await stateRef.set({
        ...stateData,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      return true;
    } catch (error) {
      console.error('Save state error:', error);
      return false;
    }
  },

  async getUploadState(userId) {
    try {
      const stateDoc = await db.collection('upload_states').doc(userId.toString()).get();
      return stateDoc.exists ? stateDoc.data() : null;
    } catch (error) {
      console.error('Get state error:', error);
      return null;
    }
  },

  async deleteUploadState(userId) {
    try {
      await db.collection('upload_states').doc(userId.toString()).delete();
      return true;
    } catch (error) {
      console.error('Delete state error:', error);
      return false;
    }
  }
};

// ========== BOT HANDLERS ========== //
const handleStart = async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  if (ADMIN_IDS.includes(userId)) {
    // Test Firebase connection first
    const firebaseWorking = await FirebaseService.testConnection();
    
    const status = firebaseWorking ? '✅ Connected' : '❌ Failed';
    
    await bot.sendMessage(chatId,
      `🤖 *New Database Test*\n\n` +
      `🔥 Firebase: ${status}\n` +
      `📊 New Project: ${FIREBASE_PROJECT_ID}\n\n` +
      `Test the upload flow:`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📤 Upload HTML File', callback_data: 'upload_html' }],
            [{ text: '🧪 Test Again', callback_data: 'test_firebase' }]
          ]
        }
      }
    );
  } else {
    await bot.sendMessage(chatId, '❌ Admin access required.');
  }
};

const startUploadFlow = async (chatId, userId) => {
  await FirebaseService.saveUploadState(userId, {
    state: 'awaiting_file',
    noteData: {}
  });

  await bot.sendMessage(chatId,
    `📤 *Upload to NEW Database*\n\n` +
    `Send me an HTML file to test the new Firebase setup.`,
    { parse_mode: 'Markdown' }
  );
};

const handleDocument = async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const document = msg.document;

  if (!ADMIN_IDS.includes(userId)) return;

  const uploadState = await FirebaseService.getUploadState(userId);
  
  if (uploadState && uploadState.state === 'awaiting_file' && document) {
    const isHTML = document.file_name?.toLowerCase().endsWith('.html');
    
    if (isHTML) {
      try {
        const noteId = `note_${Date.now()}`;
        const noteData = {
          id: noteId,
          title: document.file_name,
          description: 'Uploaded to new database',
          file_name: document.file_name,
          file_size: document.file_size,
          uploadedBy: userId,
          views: 0,
          is_active: true,
          firebase_url: `https://storage.googleapis.com/${bucket.name}/notes/${noteId}.html`
        };

        const saved = await FirebaseService.saveNote(noteData);
        
        if (saved) {
          await FirebaseService.deleteUploadState(userId);
          
          await bot.sendMessage(chatId,
            `✅ *Success! Saved to NEW Database*\n\n` +
            `📁 File: ${document.file_name}\n` +
            `🔥 Database: ${FIREBASE_PROJECT_ID}\n` +
            `🆔 Note ID: ${noteId}\n\n` +
            `🎉 Your new Firebase database is working!`,
            { parse_mode: 'Markdown' }
          );
        } else {
          throw new Error('Failed to save to database');
        }

      } catch (error) {
        await bot.sendMessage(chatId,
          `❌ *Upload Failed*\n\n` +
          `Error: ${error.message}`,
          { parse_mode: 'Markdown' }
        );
      }
    } else {
      await bot.sendMessage(chatId, '❌ Please send an HTML file.');
    }
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
    } else if (data === 'test_firebase') {
      await handleStart({ chat: { id: chatId }, from: { id: userId } });
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
    return res.status(200).json({
      status: '🟢 New Database Bot Online',
      project: FIREBASE_PROJECT_ID,
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

console.log('✅ New Database Bot Started!');
console.log('🔥 Project:', FIREBASE_PROJECT_ID);
