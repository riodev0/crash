const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

// Helper function to calculate crash point
function calculateCrashPoint() {
  const rand = Math.random();
  const houseEdge = 0.05;
  return Math.max(1, (1 - houseEdge) / (1 - rand)).toFixed(2);
}

// Helper function to log suspicious activity
async function logSuspiciousActivity(userId, type, details) {
  await admin.firestore().collection('suspiciousActivities').add({
    userId,
    type,
    details,
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  });
}

// Place a new bet
exports.placeBet = functions.https.onCall(async (data, context) => {
  // Authentication check
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }

  const userId = context.auth.uid;
  const { amount, autoCashout } = data;

  // Input validation
  if (typeof amount !== 'number' || amount < 1 || amount > 10000) {
    await logSuspiciousActivity(userId, 'invalid_bet_amount', data);
    throw new functions.https.HttpsError('invalid-argument', 'Invalid bet amount');
  }

  if (autoCashout && (typeof autoCashout !== 'number' || autoCashout < 1 || autoCashout > 100)) {
    await logSuspiciousActivity(userId, 'invalid_auto_cashout', data);
    throw new functions.https.HttpsError('invalid-argument', 'Invalid auto cashout value');
  }

  const userRef = admin.firestore().collection('users').doc(userId);
  const batch = admin.firestore().batch();

  return await admin.firestore().runTransaction(async (transaction) => {
    const userDoc = await transaction.get(userRef);
    
    // Check if user exists
    if (!userDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'User not found');
    }

    const userData = userDoc.data();
    
    // Check balance
    if (userData.balance < amount) {
      await logSuspiciousActivity(userId, 'insufficient_balance_attempt', {
        attemptedBet: amount,
        actualBalance: userData.balance
      });
      throw new functions.https.HttpsError('failed-precondition', 'Insufficient balance');
    }

    // Deduct balance
    transaction.update(userRef, {
      balance: admin.firestore.FieldValue.increment(-amount),
      lastBetAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Generate crash point securely
    const crashPoint = calculateCrashPoint();
    
    // Create game record
    const gameRef = admin.firestore().collection('crash_games').doc();
    transaction.set(gameRef, {
      userId,
      username: userData.email,
      betAmount: amount,
      autoCashout: autoCashout || null,
      crashPoint: parseFloat(crashPoint),
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return { 
      success: true, 
      gameId: gameRef.id,
      betAmount: amount,
      remainingBalance: userData.balance - amount
    };
  });
});

// Cash out from a game
exports.cashOut = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }

  const userId = context.auth.uid;
  const { gameId, clientMultiplier } = data;

  // Input validation
  if (typeof gameId !== 'string' || gameId.length === 0) {
    await logSuspiciousActivity(userId, 'invalid_game_id', data);
    throw new functions.https.HttpsError('invalid-argument', 'Invalid game ID');
  }

  if (typeof clientMultiplier !== 'number' || clientMultiplier < 1) {
    await logSuspiciousActivity(userId, 'invalid_multiplier', data);
    throw new functions.https.HttpsError('invalid-argument', 'Invalid multiplier');
  }

  const gameRef = admin.firestore().collection('crash_games').doc(gameId);
  const userRef = admin.firestore().collection('users').doc(userId);

  return await admin.firestore().runTransaction(async (transaction) => {
    const gameDoc = await transaction.get(gameRef);
    const userDoc = await transaction.get(userRef);
    
    // Validate documents exist
    if (!gameDoc.exists || !userDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Game or user not found');
    }

    const gameData = gameDoc.data();
    const userData = userDoc.data();
    
    // Validate game ownership
    if (gameData.userId !== userId) {
      await logSuspiciousActivity(userId, 'unauthorized_cashout_attempt', {
        attemptedGame: gameId,
        actualOwner: gameData.userId
      });
      throw new functions.https.HttpsError('permission-denied', 'Not your game');
    }

    // Validate game status
    if (gameData.status !== 'pending') {
      throw new functions.https.HttpsError('failed-precondition', 'Game already completed');
    }

    // Calculate actual multiplier server-side
    const gameStart = gameData.createdAt.toDate();
    const elapsedSeconds = (Date.now() - gameStart.getTime()) / 1000;
    const serverMultiplier = 1 + Math.pow(elapsedSeconds, 1.5) * 0.2;
    
    // Validate multiplier isn't tampered with
    if (Math.abs(clientMultiplier - serverMultiplier) > 0.1) {
      await logSuspiciousActivity(userId, 'multiplier_tampering', {
        clientMultiplier,
        serverMultiplier,
        gameId
      });
      throw new functions.https.HttpsError('failed-precondition', 'Multiplier validation failed');
    }

    // Check if game would have crashed
    if (serverMultiplier >= gameData.crashPoint) {
      transaction.update(gameRef, {
        status: 'crashed',
        finalMultiplier: serverMultiplier,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      throw new functions.https.HttpsError('failed-precondition', 'Game already crashed');
    }

    // Calculate and award winnings
    const winnings = gameData.betAmount * serverMultiplier;
    
    // Update game record
    transaction.update(gameRef, {
      status: 'cashed_out',
      finalMultiplier: serverMultiplier,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Update user balance
    transaction.update(userRef, {
      balance: admin.firestore.FieldValue.increment(winnings),
      lastCashOutAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return { 
      success: true,
      cashedOutAt: serverMultiplier,
      winnings: winnings,
      newBalance: userData.balance + winnings
    };
  });
});

// Admin function to fix balances if needed
exports.adminAdjustBalance = functions.https.onCall(async (data, context) => {
  if (!context.auth || !context.auth.token.admin) {
    throw new functions.https.HttpsError('permission-denied', 'Admin access required');
  }

  const { userId, amount, reason } = data;
  
  // Input validation
  if (typeof amount !== 'number') {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid amount');
  }

  const userRef = admin.firestore().collection('users').doc(userId);
  const adminCommandRef = admin.firestore().collection('adminCommands').doc();

  await admin.firestore().runTransaction(async (transaction) => {
    // Record the admin action
    transaction.set(adminCommandRef, {
      type: 'balance_adjustment',
      adminId: context.auth.uid,
      userId,
      amount,
      reason: reason || 'No reason provided',
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    // Update user balance
    transaction.update(userRef, {
      balance: admin.firestore.FieldValue.increment(amount),
      lastAdminAdjustment: admin.firestore.FieldValue.serverTimestamp()
    });
  });

  return { success: true, userId, amount };
});
