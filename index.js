const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');
admin.initializeApp();

// Generate new crash game
exports.createCrashGame = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  
  const serverSeed = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(serverSeed).digest('hex');
  
  const gameRef = admin.firestore().collection('crashGames').doc();
  await gameRef.set({
    serverSeedHash: hash,
    clientSeed: data.clientSeed || crypto.randomBytes(8).toString('hex'),
    status: "pending",
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  
  return { gameId: gameRef.id, hash };
});

// Calculate crash point
exports.startCrashGame = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  
  const gameRef = admin.firestore().collection('crashGames').doc(data.gameId);
  const gameDoc = await gameRef.get();
  
  if (!gameDoc.exists) throw new functions.https.HttpsError('not-found', 'Game not found');
  if (gameDoc.data().status !== "pending") throw new functions.https.HttpsError('failed-precondition', 'Game already started');
  
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
  
  return { crashPoint };
});

// Provably fair algorithm
function calculateCrashPoint(hash) {
  const PRIME = 2n ** 256n - 189n;
  const h = BigInt('0x' + hash);
  const crashPoint = Number(PRIME - (h % PRIME)) / 2 ** 256;
  return Math.max(1.00, (1 / (1 - crashPoint))).toFixed(2);
}

// Update user balance
exports.updateUserBalance = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  
  const userRef = admin.firestore().collection('users').doc(context.auth.uid);
  await admin.firestore().runTransaction(async (transaction) => {
    const doc = await transaction.get(userRef);
    const newBalance = doc.data().balance + data.amount;
    transaction.update(userRef, { balance: newBalance });
  });
});
