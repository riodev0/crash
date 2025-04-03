const functions = require('firebase-functions');
const admin = require('firebase-admin');
const cors = require('cors')({
  origin: [
    'https://riodev0.github.io',
    'https://riodev0.github.io/TB-Crash',
    'http://localhost:3000',
    'http://127.0.0.1:3000'
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Origin'],
  credentials: true
});
const crypto = require('crypto');

admin.initializeApp();

// Helper function to validate auth
const validateAuth = async (req) => {
  if (!req.headers.authorization) {
    throw new Error('Authorization header missing');
  }
  const token = req.headers.authorization.split('Bearer ')[1];
  return admin.auth().verifyIdToken(token);
};

// Provably fair crash point calculation
const calculateCrashPoint = (hash) => {
  const PRIME = 2n ** 256n - 189n;
  const h = BigInt('0x' + hash);
  const crashPoint = Number(PRIME - (h % PRIME)) / 2 ** 256;
  return Math.max(1.00, (1 / (1 - crashPoint))).toFixed(2);
};

// Create Game Endpoint
exports.createCrashGame = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      // Handle preflight
      if (req.method === 'OPTIONS') {
        return res.status(204).send();
      }

      const decodedToken = await validateAuth(req);
      
      const serverSeed = crypto.randomBytes(32).toString('hex');
      const serverSeedHash = crypto.createHash('sha256').update(serverSeed).digest('hex');
      const clientSeed = req.body.clientSeed || crypto.randomBytes(8).toString('hex');
      
      const gameRef = admin.firestore().collection('crashGames').doc();
      await gameRef.set({
        serverSeedHash,
        clientSeed,
        status: "pending",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        userId: decodedToken.uid,
        origin: req.headers.origin || req.headers.referer
      });
      
      res.status(200).json({ 
        gameId: gameRef.id, 
        serverSeedHash,
        message: "Game created successfully"
      });
      
    } catch (error) {
      console.error("Create Game Error:", error);
      res.status(401).json({ 
        error: error.message,
        code: error.code 
      });
    }
  });
});

// Start Game Endpoint
exports.startCrashGame = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      // Handle preflight
      if (req.method === 'OPTIONS') {
        return res.status(204).send();
      }

      const decodedToken = await validateAuth(req);
      
      if (!req.body.gameId) {
        throw new Error('Game ID required');
      }

      const gameRef = admin.firestore().collection('crashGames').doc(req.body.gameId);
      const gameDoc = await gameRef.get();
      
      if (!gameDoc.exists) throw new Error('Game not found');
      if (gameDoc.data().status !== "pending") throw new Error('Game already started');
      if (gameDoc.data().userId !== decodedToken.uid) throw new Error('Unauthorized');
      
      const serverSeed = crypto.randomBytes(32).toString('hex');
      const combined = serverSeed + gameDoc.data().clientSeed;
      const hash = crypto.createHash('sha256').update(combined).digest('hex');
      const crashPoint = calculateCrashPoint(hash);
      
      await gameRef.update({
        serverSeed,
        crashPoint,
        status: "completed",
        completedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      res.status(200).json({ 
        crashPoint,
        message: "Game completed successfully"
      });
      
    } catch (error) {
      console.error("Start Game Error:", error);
      res.status(500).json({ 
        error: error.message,
        code: error.code 
      });
    }
  });
});
