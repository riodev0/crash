const functions = require('firebase-functions');
const admin = require('firebase-admin');
const cors = require('cors')({ origin: true });
const crypto = require('crypto');

admin.initializeApp();

// Helper function for CORS errors
const handleCors = (req, res, handler) => {
  cors(req, res, async () => {
    try {
      await handler();
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: error.message });
    }
  });
};

// Create Game (now HTTP endpoint)
exports.createCrashGame = functions.https.onRequest((req, res) => {
  handleCors(req, res, async () => {
    if (!req.headers.authorization) {
      throw new Error('Authentication required');
    }

    const serverSeed = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(serverSeed).digest('hex');
    
    const gameRef = admin.firestore().collection('crashGames').doc();
    await gameRef.set({
      serverSeedHash: hash,
      clientSeed: req.body.clientSeed || crypto.randomBytes(8).toString('hex'),
      status: "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    res.status(200).json({ 
      gameId: gameRef.id, 
      hash 
    });
  });
});

// Start Game (HTTP endpoint)
exports.startCrashGame = functions.https.onRequest((req, res) => {
  handleCors(req, res, async () => {
    if (!req.headers.authorization) {
      throw new Error('Authentication required');
    }

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
  });
});

// Calculate crash point
function calculateCrashPoint(hash) {
  const PRIME = 2n ** 256n - 189n;
  const h = BigInt('0x' + hash);
  const crashPoint = Number(PRIME - (h % PRIME)) / 2 ** 256;
  return Math.max(1.00, (1 / (1 - crashPoint))).toFixed(2);
}
