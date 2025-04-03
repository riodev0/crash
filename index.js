const functions = require('firebase-functions');
const admin = require('firebase-admin');
const cors = require('cors')({ 
  origin: ['https://riodev0.github.io', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
});
const crypto = require('crypto');

admin.initializeApp();

// Helper middleware
const validateAuth = async (req) => {
  if (!req.headers.authorization) {
    throw new Error('Authorization header missing');
  }
  const token = req.headers.authorization.split('Bearer ')[1];
  return admin.auth().verifyIdToken(token);
};

// Create Game
exports.createCrashGame = functions.https.onRequest(async (req, res) => {
  cors(req, res, async () => {
    try {
      const decodedToken = await validateAuth(req);
      
      const serverSeed = crypto.randomBytes(32).toString('hex');
      const hash = crypto.createHash('sha256').update(serverSeed).digest('hex');
      
      const gameRef = admin.firestore().collection('crashGames').doc();
      await gameRef.set({
        serverSeedHash: hash,
        clientSeed: req.body.clientSeed || crypto.randomBytes(8).toString('hex'),
        status: "pending",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        userId: decodedToken.uid
      });
      
      res.status(200).json({ 
        gameId: gameRef.id, 
        hash 
      });
      
    } catch (error) {
      console.error("Error:", error);
      res.status(401).json({ error: error.message });
    }
  });
});

// Start Game
exports.startCrashGame = functions.https.onRequest(async (req, res) => {
  cors(req, res, async () => {
    try {
      await validateAuth(req);
      
      const gameRef = admin.firestore().collection('crashGames').doc(req.body.gameId);
      const gameDoc = await gameRef.get();
      
      if (!gameDoc.exists) throw new Error('Game not found');
      if (gameDoc.data().status !== "pending") throw new Error('Game already started');
      
      const serverSeed = crypto.randomBytes(32).toString('hex');
      const combined = serverSeed + gameDoc.data().clientSeed;
      const hash = crypto.createHash('sha256').update(combined).digest('hex');
      const crashPoint = calculateCrashPoint(hash);
      
      await gameRef.update({
        serverSeed,
        crashPoint,
        status: "active",
        startedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      res.status(200).json({ crashPoint });
      
    } catch (error) {
      console.error("Error:", error);
      res.status(500).json({ error: error.message });
    }
  });
});

// Calculate crash point
function calculateCrashPoint(hash) {
  const PRIME = 2n ** 256n - 189n;
  const h = BigInt('0x' + hash);
  const crashPoint = Number(PRIME - (h % PRIME)) / 2 ** 256;
  return Math.max(1.00, (1 / (1 - crashPoint))).toFixed(2);
}
