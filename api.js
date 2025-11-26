const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');

// 🛡️ GLOBAL ERROR HANDLER
process.on('unhandledRejection', (error) => {
  console.error('🔴 Unhandled Promise Rejection:', error);
});

// ========== SIMPLE CONFIG ========== //
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(Number) : [];
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;

// Initialize Firebase
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
  console.log('✅ Firebase initialized');
} catch (error) {
  console.error('❌ Firebase init failed:', error);
}

// Create bot instance
const bot = new TelegramBot(BOT_TOKEN, { polling: false });

// ========== FIREBASE UPLOAD ========== //
const uploadToFirebase = async (fileBuffer, fileName) => {
  try {
    const file = bucket.file(`test_uploads/${fileName}`);
    
    await file.save(fileBuffer, {
      metadata: {
        contentType: 'text/html',
        cacheControl: 'public, max-age=3600'
      }
    });
    
    // Make file publicly accessible
    await file.makePublic();
    
    // Get public URL
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/test_uploads/${fileName}`;
    return publicUrl;
  } catch (error) {
    console.error('Firebase upload error:', error);
    return null;
  }
};

const saveToFirestore = async (noteData) => {
  try {
    const noteRef = db.collection('test_notes').doc(noteData.id);
    await noteRef.set({
      ...noteData,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return true;
  } catch (error) {
    console.error('Firestore save error:', error);
    return false;
  }
};

// ========== SIMPLE UPLOAD FLOW ========== //
const handleStart = async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  const isAdmin = ADMIN_IDS.includes(userId);
  
  if (isAdmin) {
    await bot.sendMessage(chatId,
      `FIREBASE TEST BOT\n\n` +
      `Click to test HTML upload to Firebase:`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📤 TEST FIREBASE UPLOAD', callback_data: 'test_upload' }]
          ]
        }
      }
    );
  } else {
    await bot.sendMessage(chatId, 'Admin access required.');
  }
};

const startTestUpload = async (chatId) => {
  await bot.sendMessage(chatId,
    `FIREBASE UPLOAD TEST\n\n` +
    `Send me an HTML file - I will:\n` +
    `1. Save to Firebase Storage\n` +
    `2. Save info to Firestore\n` +
    `3. Show you the public URL`
  );
};

const handleDocument = async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const document = msg.document;

  console.log('📎 Document received:', document.file_name);

  // Check if it's HTML
  const isHTML = document.file_name?.toLowerCase().endsWith('.html');
  
  if (isHTML) {
    try {
      // Show processing message
      const processingMsg = await bot.sendMessage(chatId, '🔄 Downloading from Telegram...');

      // 1. Download from Telegram
      const fileLink = await bot.getFileLink(document.file_id);
      const response = await fetch(fileLink);
      const fileBuffer = Buffer.from(await response.arrayBuffer());

      await bot.editMessageText('🔄 Uploading to Firebase Storage...', {
        chat_id: chatId,
        message_id: processingMsg.message_id
      });

      // 2. Upload to Firebase Storage
      const fileName = `test_${Date.now()}.html`;
      const publicUrl = await uploadToFirebase(fileBuffer, fileName);

      if (!publicUrl) {
        throw new Error('Failed to upload to Firebase Storage');
      }

      await bot.editMessageText('🔄 Saving to Firestore...', {
        chat_id: chatId,
        message_id: processingMsg.message_id
      });

      // 3. Save metadata to Firestore
      const noteData = {
        id: `note_${Date.now()}`,
        title: document.file_name,
        file_name: document.file_name,
        file_size: document.file_size,
        uploaded_by: userId,
        firebase_url: publicUrl,
        uploaded_at: new Date()
      };

      const saved = await saveToFirestore(noteData);

      if (saved) {
        await bot.deleteMessage(chatId, processingMsg.message_id);
        
        await bot.sendMessage(chatId,
          `✅ FIREBASE UPLOAD SUCCESS!\n\n` +
          `File: ${document.file_name}\n` +
          `Size: ${(document.file_size / 1024).toFixed(2)} KB\n` +
          `Firebase URL: ${publicUrl}\n\n` +
          `📁 Saved to: test_uploads/${fileName}\n` +
          `📊 Saved to: test_notes collection\n\n` +
          `🎉 File is now live on Firebase!`
        );
      } else {
        throw new Error('Failed to save to Firestore');
      }

    } catch (error) {
      console.error('Upload error:', error);
      await bot.sendMessage(chatId,
        `❌ UPLOAD FAILED\n\n` +
        `Error: ${error.message}`
      );
    }
  } else {
    await bot.sendMessage(chatId,
      `❌ WRONG FILE TYPE\n\n` +
      `Please send an HTML file (.html)\n` +
      `You sent: ${document.file_name}`
    );
  }
};

const handleCallbackQuery = async (callbackQuery) => {
  const message = callbackQuery.message;
  const data = callbackQuery.data;
  const chatId = message.chat.id;

  try {
    await bot.answerCallbackQuery(callbackQuery.id);

    if (data === 'test_upload') {
      await startTestUpload(chatId);
    }

  } catch (error) {
    console.error('Callback error:', error);
    await bot.answerCallbackQuery(callbackQuery.id, { 
      text: 'Error' 
    });
  }
};

const handleMessage = async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) return;

  if (text === '/start') {
    await handleStart(msg);
  }
};

// ========== VERCEL HANDLER ========== //
module.exports = async (req, res) => {
  console.log(`🌐 ${req.method} request to ${req.url}`);

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'Firebase Test Bot Online',
      has_firebase: !!db,
      timestamp: new Date().toISOString()
    });
  }

  if (req.method === 'POST') {
    try {
      const update = req.body;

      if (update.message) {
        if (update.message.text) {
          await handleMessage(update.message);
        } else if (update.message.document) {
          await handleDocument(update.message);
        }
      } else if (update.callback_query) {
        await handleCallbackQuery(update.callback_query);
      }

      return res.status(200).json({ ok: true });
    } catch (error) {
      console.error('❌ Webhook error:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};

console.log('✅ Firebase Test Bot Started!');
console.log('🎯 Test: /start → Click button → Send HTML file');
