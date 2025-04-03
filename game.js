// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyDfK_HayFBawYzgIcGXQsQ4ynyCrVHHL8A",
  authDomain: "tbgames-d6995.firebaseapp.com",
  projectId: "tbgames-d6995",
  storageBucket: "tbgames-d6995.appspot.com",
  messagingSenderId: "578117532273",
  appId: "1:578117532273:web:3e52426b147f1c7e5af9d0"
};

// Initialize Firebase
const app = firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Enable persistence
db.enablePersistence().catch(err => {
  console.log("Persistence failed:", err);
});

// Game State
let user = null;
let balance = 0;
let currentGame = null;
let currentBet = null;
let crashPoint = null;
let gameInterval = null;

// DOM Elements
const balanceEl = document.getElementById('balance');
const betAmountEl = document.getElementById('betAmount');
const placeBetBtn = document.getElementById('placeBetBtn');
const cashoutBtn = document.getElementById('cashoutBtn');
const multiplierDisplay = document.getElementById('multiplierDisplay');
const gameMessage = document.getElementById('gameMessage');
const historyList = document.getElementById('historyList');

// Auth State Handler
auth.onAuthStateChanged(async (authUser) => {
  if (authUser) {
    user = authUser;
    await initializeUser(user.uid);
    await loadGameHistory();
  } else {
    window.location.href = '/login.html';
  }
});

// Initialize User
async function initializeUser(uid) {
  try {
    const userRef = db.collection('users').doc(uid);
    const doc = await userRef.get();
    
    if (!doc.exists) {
      await userRef.set({
        balance: 1000.00,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      balance = 1000.00;
    } else {
      balance = doc.data().balance;
    }
    updateBalanceDisplay();
  } catch (error) {
    console.error("User init failed:", error);
    showMessage('Failed to load user data', 'error');
  }
}

// Load Game History (Fixed)
async function loadGameHistory() {
  if (!user) return;
  
  try {
    const snapshot = await db.collection('crashBets')
      .where('userId', '==', user.uid)
      .orderBy('createdAt', 'desc')
      .limit(10)
      .get();
    
    historyList.innerHTML = '';
    
    if (snapshot.empty) {
      historyList.innerHTML = '<div class="history-item">No games played yet</div>';
      return;
    }
    
    snapshot.forEach(doc => {
      const betData = doc.data();
      const date = betData.createdAt?.toDate?.() || new Date();
      addToHistory(betData.status === 'cashedout', betData.cashoutMultiplier || 0, date);
    });
  } catch (error) {
    console.error("History load failed:", error);
    historyList.innerHTML = '<div class="history-item error">Failed to load history</div>';
  }
}

// Place Bet Function
async function placeBet() {
  if (!user) {
    showMessage('Please sign in to play', 'error');
    return;
  }

  const amount = parseFloat(betAmountEl.value);
  if (isNaN(amount) || amount <= 0 || amount > balance) {
    showMessage('Invalid bet amount', 'error');
    return;
  }

  try {
    placeBetBtn.disabled = true;
    showMessage('Placing bet...', 'info');

    // Create bet document
    const betRef = await db.collection('crashBets').add({
      userId: user.uid,
      amount: amount,
      status: 'pending',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    currentBet = { id: betRef.id, amount };
    
    // Update balance
    await db.collection('users').doc(user.uid).update({
      balance: firebase.firestore.FieldValue.increment(-amount)
    });
    balance -= amount;
    updateBalanceDisplay();
    
    // Start game
    const token = await auth.currentUser.getIdToken();
    const response = await fetch('https://us-central1-tbgames-d6995.cloudfunctions.net/createCrashGame', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        clientSeed: Date.now().toString(),
        origin: window.location.origin
      })
    });

    if (!response.ok) throw new Error('Game creation failed');
    
    const data = await response.json();
    currentGame = data.gameId;
    
    // Start game after 5 seconds
    setTimeout(async () => {
      try {
        const startResponse = await fetch('https://us-central1-tbgames-d6995.cloudfunctions.net/startCrashGame', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            gameId: currentGame,
            origin: window.location.origin
          })
        });

        if (!startResponse.ok) throw new Error('Game start failed');
        
        const startData = await startResponse.json();
        crashPoint = parseFloat(startData.crashPoint);
        runGameLoop();
      } catch (error) {
        console.error("Game start error:", error);
        showMessage('Game failed to start', 'error');
        resetGame();
      }
    }, 5000);
    
  } catch (error) {
    console.error("Bet error:", error);
    showMessage('Bet failed: ' + error.message, 'error');
    placeBetBtn.disabled = false;
  }
}

// Game Loop
function runGameLoop() {
  let startTime = Date.now();
  let crashed = false;
  
  gameMessage.textContent = 'Game in progress!';
  cashoutBtn.disabled = false;
  
  function gameFrame() {
    const elapsed = (Date.now() - startTime) / 1000;
    const multiplier = Math.min(crashPoint, 1 + (elapsed * 0.05));
    
    multiplierDisplay.textContent = multiplier.toFixed(2) + 'x';
    cashoutBtn.textContent = `CASH OUT (${multiplier.toFixed(2)}x)`;
    
    if (multiplier >= crashPoint && !crashed) {
      crashed = true;
      endGame(false);
      return;
    }
    
    gameInterval = requestAnimationFrame(gameFrame);
  }
  
  gameFrame();
}

// Cash Out
async function cashout() {
  if (!gameInterval) return;
  
  cancelAnimationFrame(gameInterval);
  const multiplier = parseFloat(multiplierDisplay.textContent);
  const winAmount = currentBet.amount * multiplier;
  
  if (!confirm(`Cash out at ${multiplier.toFixed(2)}x for $${winAmount.toFixed(2)}?`)) {
    runGameLoop();
    return;
  }
  
  await endGame(true, multiplier);
}

// End Game
async function endGame(didCashout, multiplier) {
  try {
    const winAmount = didCashout ? currentBet.amount * multiplier : 0;
    
    // Update bet
    await db.collection('crashBets').doc(currentBet.id).update({
      status: didCashout ? 'cashedout' : 'crashed',
      cashoutMultiplier: didCashout ? multiplier : null,
      resultAmount: didCashout ? winAmount : -currentBet.amount
    });
    
    // Update balance if won
    if (didCashout) {
      await db.collection('users').doc(user.uid).update({
        balance: firebase.firestore.FieldValue.increment(winAmount)
      });
      balance += winAmount;
      updateBalanceDisplay();
      showMessage(`Cashed out at ${multiplier.toFixed(2)}x!`, 'success');
    } else {
      showMessage(`Crashed at ${crashPoint.toFixed(2)}x`, 'error');
    }
    
    // Add to history
    addToHistory(didCashout, multiplier);
    
  } catch (error) {
    console.error("Game end error:", error);
    showMessage('Game completion failed', 'error');
  } finally {
    resetGame();
  }
}

// Helper Functions
function updateBalanceDisplay() {
  balanceEl.textContent = balance.toFixed(2);
}

function showMessage(text, type) {
  gameMessage.textContent = text;
  gameMessage.className = `game-message ${type}`;
}

function addToHistory(won, multiplier, date = new Date()) {
  const historyItem = document.createElement('div');
  historyItem.className = `history-item ${won ? 'win' : 'lose'}`;
  historyItem.innerHTML = `
    <span>${won ? 'Cashed out' : 'Crashed'} at ${multiplier.toFixed(2)}x</span>
    <span>${date.toLocaleTimeString()}</span>
  `;
  historyList.prepend(historyItem);
}

function resetGame() {
  if (gameInterval) {
    cancelAnimationFrame(gameInterval);
  }
  
  currentGame = null;
  currentBet = null;
  gameInterval = null;
  
  multiplierDisplay.textContent = '1.00x';
  cashoutBtn.textContent = 'CASH OUT (1.00x)';
  cashoutBtn.disabled = true;
  placeBetBtn.disabled = false;
}

// Event Listeners
placeBetBtn.addEventListener('click', placeBet);
cashoutBtn.addEventListener('click', cashout);
