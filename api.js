const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');
const fetch = require('node-fetch');

// 🛡️ GLOBAL ERROR HANDLER
process.on('unhandledRejection', (error) => {
  console.error('🔴 Unhandled Promise Rejection:', error);
});

// ========== CONFIGURATION ========== //
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(Number) : [];
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;

// Debug environment variables (without exposing private key)
console.log('🔧 Environment Check:');
console.log('BOT_TOKEN:', BOT_TOKEN ? '✅ Set' : '❌ Missing');
console.log('FIREBASE_PROJECT_ID:', FIREBASE_PROJECT_ID || '❌ Missing');
console.log('FIREBASE_CLIENT_EMAIL:', FIREBASE_CLIENT_EMAIL || '❌ Missing');
console.log('FIREBASE_PRIVATE_KEY:', FIREBASE_PRIVATE_KEY ? '✅ Set' : '❌ Missing');

// Initialize Firebase
let db, bucket, isFirebaseReady = false;

try {
  if (FIREBASE_PROJECT_ID && FIREBASE_PRIVATE_KEY && FIREBASE_CLIENT_EMAIL) {
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
    isFirebaseReady = true;
    console.log('✅ Firebase initialized successfully');
    console.log('📦 Storage Bucket:', bucket.name);
  } else {
    console.log('❌ Firebase environment variables missing');
  }
} catch (error) {
  console.error('❌ Firebase initialization failed:', error.message);
  isFirebaseReady = false;
}

// Create bot instance
const bot = new TelegramBot(BOT_TOKEN, { polling: false });

// ========== FIREBASE SERVICES ========== //
const testFirebaseConnection = async () => {
  if (!isFirebaseReady) return false;
  
  try {
    console.log('🧪 Testing Firebase connection...');
    
    // Test Firestore
    const testRef = db.collection('connection_tests').doc('test');
    await testRef.set({ 
      timestamp: new Date(), 
      test: 'connection_ok',
      message: 'Firebase is working!'
    });
    console.log('✅ Firestore connection OK');
    
    // Test Storage by creating a small test file
    const testFile = bucket.file('connection_test.txt');
    await testFile.save('Firebase connection test', {
      metadata: {
        contentType: 'text/plain'
      }
    });
    console.log('✅ Storage connection OK');
    
    return true;
  } catch (error) {
    console.error('❌ Firebase connection test failed:', error.message);
    return false;
  }
};

const uploadToFirebaseStorage = async (fileBuffer, fileName) => {
  if (!isFirebaseReady) {
    console.error('❌ Firebase not ready for upload');
    return null;
  }

  try {
    console.log('🔥 Starting Firebase Storage upload...');
    console.log('📁 File name:', fileName);
    console.log('📦 Buffer size:', fileBuffer.length, 'bytes');

    // Create file reference
    const file = bucket.file(`uploads/${fileName}`);
    
    console.log('📤 Uploading file to storage...');
    
    // Upload the file with simple options
    await file.save(fileBuffer, {
      metadata: {
        contentType: 'text/html',
        cacheControl: 'public, max-age=3600'
      }
    });
    
    console.log('✅ File saved to storage');

    // Make file publicly accessible
    console.log('🔓 Making file public...');
    await file.makePublic();
    console.log('✅ File made public');

    // Get public URL
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/uploads/${fileName}`;
    console.log('🔗 Generated public URL:', publicUrl);
    
    // Verify the URL is accessible
    try {
      const response = await fetch(publicUrl, { method: 'HEAD' });
      console.log('🌐 URL accessibility check:', response.status);
    } catch (urlError) {
      console.log('⚠️ URL might not be immediately accessible:', urlError.message);
    }
    
    return publicUrl;
  } catch (error) {
    console.error('❌ Firebase Storage upload failed:', error);
    console.error('Error details:', error.message);
    console.error('Error code:', error.code);
    return null;
  }
};

const saveToFirestore = async (noteData) => {
  if (!isFirebaseReady) return false;

  try {
    console.log('💾 Saving to Firestore...');
    
    const noteRef = db.collection('notes').doc(noteData.id);
    await noteRef.set({
      ...noteData,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    console.log('✅ Saved to Firestore:', noteData.id);
    return true;
  } catch (error) {
    console.error('❌ Firestore save failed:', error);
    return false;
  }
};

// ========== BOT HANDLERS ========== //
const handleStart = async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  const isAdmin = ADMIN_IDS.includes(userId);
  
  if (isAdmin) {
    // Test Firebase connection first
    const firebaseStatus = isFirebaseReady ? '✅ Connected' : '❌ Disconnected';
    
    await bot.sendMessage(chatId,
      `FIREBASE UPLOAD TEST BOT\n\n` +
      `Firebase Status: ${firebaseStatus}\n\n` +
      `Click below to test upload:`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📤 TEST FIREBASE UPLOAD', callback_data: 'test_upload' }],
            [{ text: '🔄 TEST FIREBASE CONNECTION', callback_data: 'test_connection' }]
          ]
        }
      }
    );
  } else {
    await bot.sendMessage(chatId, 'Admin access required.');
  }
};

const startTestUpload = async (chatId) => {
  if (!isFirebaseReady) {
    await bot.sendMessage(chatId,
      `❌ FIREBASE NOT READY\n\n` +
      `Firebase is not properly configured.\n` +
      `Check your environment variables.`
    );
    return;
  }

  await bot.sendMessage(chatId,
    `FIREBASE UPLOAD TEST\n\n` +
    `Send me an HTML file to test:\n` +
    `1. Download from Telegram\n` +
    `2. Upload to Firebase Storage\n` +
    `3. Save info to Firestore\n` +
    `4. Get public URL\n\n` +
    `I'll show you each step.`
  );
};

const testConnection = async (chatId) => {
  await bot.sendMessage(chatId, '🧪 Testing Firebase connection...');
  
  const connectionOk = await testFirebaseConnection();
  
  if (connectionOk) {
    await bot.sendMessage(chatId,
      `✅ FIREBASE CONNECTION SUCCESS!\n\n` +
      `• Firestore: ✅ Working\n` +
      `• Storage: ✅ Working\n\n` +
      `Ready for file uploads!`
    );
  } else {
    await bot.sendMessage(chatId,
      `❌ FIREBASE CONNECTION FAILED\n\n` +
      `Check:\n` +
      `1. Environment variables\n` +
      `2. Firebase service account permissions\n` +
      `3. Project ID and credentials`
    );
  }
};

const handleDocument = async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const document = msg.document;

  console.log('📎 Document received:', {
    file_name: document.file_name,
    file_size: document.file_size,
    mime_type: document.mime_type
  });

  // Check Firebase connection
  if (!isFirebaseReady) {
    await bot.sendMessage(chatId,
      `❌ FIREBASE NOT CONFIGURED\n\n` +
      `Cannot upload files. Check Firebase setup.`
    );
    return;
  }

  // Check if it's HTML
  const isHTML = document.file_name?.toLowerCase().endsWith('.html');
  
  if (isHTML) {
    try {
      // Step 1: Download from Telegram
      await bot.sendMessage(chatId, '🔄 Step 1: Downloading from Telegram...');
      
      const fileLink = await bot.getFileLink(document.file_id);
      console.log('📥 Telegram file link:', fileLink);
      
      const response = await fetch(fileLink);
      if (!response.ok) {
        throw new Error(`Telegram download failed: ${response.status}`);
      }
      
      const fileBuffer = Buffer.from(await response.arrayBuffer());
      console.log('✅ Downloaded from Telegram:', fileBuffer.length, 'bytes');

      // Step 2: Upload to Firebase Storage
      await bot.sendMessage(chatId, '🔄 Step 2: Uploading to Firebase Storage...');
      
      const fileName = `test_${Date.now()}_${Math.random().toString(36).substr(2, 6)}.html`;
      const publicUrl = await uploadToFirebaseStorage(fileBuffer, fileName);

      if (!publicUrl) {
        throw new Error('Firebase Storage upload failed - check server logs');
      }

      // Step 3: Save to Firestore
      await bot.sendMessage(chatId, '🔄 Step 3: Saving to database...');
      
      const noteData = {
        id: `note_${Date.now()}`,
        title: document.file_name,
        file_name: document.file_name,
        file_size: document.file_size,
        uploaded_by: userId,
        firebase_url: publicUrl,
        is_active: true,
        views: 0,
        uploaded_at: new Date()
      };

      const saved = await saveToFirestore(noteData);

      if (saved) {
        // Success!
        await bot.sendMessage(chatId,
          `✅ FIREBASE UPLOAD SUCCESS!\n\n` +
          `📁 File: ${document.file_name}\n` +
          `📦 Size: ${(document.file_size / 1024).toFixed(2)} KB\n` +
          `🔗 Public URL: ${publicUrl}\n\n` +
          `📊 Saved to: Firestore notes collection\n` +
          `🗂️ Storage path: uploads/${fileName}\n\n` +
          `🎉 File is now live on Firebase!`
        );
        
        console.log('🎉 Complete upload success for file:', document.file_name);
      } else {
        throw new Error('Firestore save failed');
      }

    } catch (error) {
      console.error('❌ Upload pipeline error:', error);
      await bot.sendMessage(chatId,
        `❌ UPLOAD FAILED\n\n` +
        `Error: ${error.message}\n\n` +
        `Check Vercel logs for detailed error information.`
      );
    }
  } else {
    await bot.sendMessage(chatId,
      `❌ WRONG FILE TYPE\n\n` +
      `Please send an HTML file (.html extension)\n` +
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
    } else if (data === 'test_connection') {
      await testConnection(chatId);
    }

  } catch (error) {
    console.error('Callback error:', error);
    await bot.answerCallbackQuery(callbackQuery.id, { 
      text: 'Error processing button' 
    });
  }
};

const handleMessage = async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) return;

  if (text === '/start') {
    await handleStart(msg);
  } else if (text === '/test') {
    await testConnection(chatId);
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
      status: 'Firebase Upload Test Bot Online',
      firebase_ready: isFirebaseReady,
      project_id: FIREBASE_PROJECT_ID,
      timestamp: new Date().toISOString()
    });
  }

  if (req.method === 'POST') {
    try {
      const update = req.body;
      console.log('📦 Update received:', update.update_id);

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

console.log('✅ Firebase Upload Test Bot Started!');
console.log('🔧 Firebase Status:', isFirebaseReady ? 'READY' : 'NOT READY');
console.log('🎯 Commands:');
console.log('   /start - Show test menu');
console.log('   /test - Test Firebase connection');
console.log('   Click "TEST FIREBASE UPLOAD" → Send HTML file');
