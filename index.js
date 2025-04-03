const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');
const cors = require('cors')({
  origin: [
    'https://riodev0.github.io',
    'https://riodev0.github.io/crash', // Added specific path
    'http://localhost:3000',
    'http://127.0.0.1:3000' // Added local IP for testing
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'X-Requested-With'],
  credentials: true
});

admin.initializeApp();

// Helper function to validate origin
const validateOrigin = (origin) => {
  const allowedOrigins = [
    'https://riodev0.github.io',
    'https://riodev0.github.io/crash',
    'http://localhost:3000',
    'http://127.0.0.1:3000'
  ];
  return allowedOrigins.includes(origin);
};

// Generate crash point using provably fair algorithm
const generateCrashPoint = (serverSeed, clientSeed) => {
  const hash = crypto.createHmac('sha256', serverSeed)
    .update(clientSeed)
    .digest('hex');
  
  const hashValue = parseInt(hash.substring(0, 8), 16);
  const crashPoint = (Math.floor((10000 - (hashValue % 5000)) / 100) / 100) + 1;
  
  return Math.min(crashPoint, 10.00); // Cap at 10x for safety
};

exports.createCrashGame = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    // Validate origin from request headers
    const requestOrigin = req.get('origin') || req.get('referer');
    if (!validateOrigin(requestOrigin)) {
      return res.status(403).json({ error: 'Origin not allowed' });
    }

    // Verify authentication
    if (!req.headers.authorization) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      // Verify Firebase auth token
      const token = req.headers.authorization.split('Bearer ')[1];
      const decodedToken = await admin.auth().verifyIdToken(token);
      
      // Validate request body
      if (!req.body || !req.body.clientSeed) {
        return res.status(400).json({ error: 'Invalid request body' });
      }

      // Generate server seed and hash for provable fairness
      const serverSeed = crypto.randomBytes(32).toString('hex');
      const serverSeedHash = crypto.createHash('sha256').update(serverSeed).digest('hex');
      const clientSeed = req.body.clientSeed;
      
      // Create game document
      const gameRef = await admin.firestore().collection('crashGames').add({
        userId: decodedToken.uid,
        serverSeed: serverSeed,
        serverSeedHash: serverSeedHash,
        clientSeed: clientSeed,
        status: 'pending',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        origin: requestOrigin
      });

      return res.status(200).json({
        gameId: gameRef.id,
        serverSeedHash: serverSeedHash,
        message: 'Game created successfully'
      });

    } catch (error) {
      console.error('Error creating game:', error);
      return res.status(500).json({ error: error.message });
    }
  });
});

exports.startCrashGame = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    // Validate origin from request headers
    const requestOrigin = req.get('origin') || req.get('referer');
    if (!validateOrigin(requestOrigin)) {
      return res.status(403).json({ error: 'Origin not allowed' });
    }

    // Verify authentication
    if (!req.headers.authorization) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      // Verify Firebase auth token
      const token = req.headers.authorization.split('Bearer ')[1];
      const decodedToken = await admin.auth().verifyIdToken(token);
      
      // Validate request body
      if (!req.body || !req.body.gameId) {
        return res.status(400).json({ error: 'Game ID required' });
      }

      const gameId = req.body.gameId;
      const gameRef = admin.firestore().collection('crashGames').doc(gameId);
      const gameDoc = await gameRef.get();

      if (!gameDoc.exists) {
        return res.status(404).json({ error: 'Game not found' });
      }

      const gameData = gameDoc.data();

      // Verify game ownership
      if (gameData.userId !== decodedToken.uid) {
        return res.status(403).json({ error: 'Game does not belong to user' });
      }

      // Verify game status
      if (gameData.status !== 'pending') {
        return res.status(400).json({ error: 'Game already started or completed' });
      }

      // Generate crash point
      const crashPoint = generateCrashPoint(gameData.serverSeed, gameData.clientSeed);

      // Update game with result
      await gameRef.update({
        status: 'completed',
        crashPoint: crashPoint,
        completedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return res.status(200).json({
        gameId: gameId,
        crashPoint: crashPoint,
        message: 'Game completed successfully'
      });

    } catch (error) {
      console.error('Error starting game:', error);
      return res.status(500).json({ error: error.message });
    }
  });
});
