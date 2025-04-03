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

// Game State
let user = null;
let balance = 0;
let currentGame = null;
let currentBet = null;
let crashPoint = null;
let gameInterval = null;
let autoCashout = 2.00;

// DOM Elements
const balanceEl = document.getElementById('balance');
const betAmountEl = document.getElementById('betAmount');
const placeBetBtn = document.getElementById('placeBetBtn');
const cashoutBtn = document.getElementById('cashoutBtn');
const multiplierDisplay = document.getElementById('multiplierDisplay');
const gameMessage = document.getElementById('gameMessage');
const historyList = document.getElementById('historyList');

// Initialize Auth
auth.onAuthStateChanged(async (authUser) => {
  if (authUser) {
    user = authUser;
    await initializeUser(user.uid);
    loadGameHistory();
  } else {
    window.location.href = '/login.html';
  }
});

// Initialize User
async function initializeUser(uid) {
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
}

// Place Bet
async function placeBet() {
  const amount = parseFloat(betAmountEl.value);
  
  if (!user) {
    showMessage('Please sign in to place bets', 'error');
    return;
  }
  
  if (isNaN(amount) || amount <= 0 || amount > balance) {
    showMessage('Invalid bet amount', 'error');
    return;
  }

  try {
    placeBetBtn.disabled = true;
    showMessage('Placing bet...', 'success');
    
    // Create bet
    const betRef = await db.collection('crashBets').add({
      userId: user.uid,
      amount: amount,
      status: 'pending',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    currentBet = { id: betRef.id, amount };
    
    // Deduct balance
    await db.collection('users').doc(user.uid).update({
      balance: firebase.firestore.FieldValue.increment(-amount)
    });
    balance -= amount;
    updateBalanceDisplay();
    
    // Start game
    await startNewGame();
    
  } catch (error) {
    console.error("Bet failed:", error);
    showMessage('Bet failed: ' + error.message, 'error');
    placeBetBtn.disabled = false;
  }
}

// Start New Game
async function startNewGame() {
  try {
    const token = await auth.currentUser.getIdToken();
    
    // Create game
    const createResponse = await fetch('https://us-central1-tbgames-d6995.cloudfunctions.net/createCrashGame', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        clientSeed: Date.now().toString()
      })
    });
    
    if (!createResponse.ok) throw new Error('Failed to create game');
    
    const createData = await createResponse.json();
    currentGame = createData.gameId;
    
    // Start game after 5s
    setTimeout(async () => {
      try {
        const startResponse = await fetch('https://us-central1-tbgames-d6995.cloudfunctions.net/startCrashGame', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            gameId: currentGame
          })
        });
        
        if (!startResponse.ok) throw new Error('Failed to start game');
        
        const startData = await startResponse.json();
        crashPoint = parseFloat(startData.crashPoint);
        runGameLoop();
        
      } catch (error) {
        console.error("Game start failed:", error);
        showMessage('Game start failed: ' + error.message, 'error');
        resetGame();
      }
    }, 5000);
    
  } catch (error) {
    console.error("Game creation failed:", error);
    showMessage('Game creation failed: ' + error.message, 'error');
    resetGame();
  }
}

// Run Game Loop
function runGameLoop() {
  let startTime = Date.now();
  let crashed = false;
  
  gameMessage.textContent = 'Game in progress!';
  cashoutBtn.disabled = false;
  
  gameInterval = setInterval(() => {
    const elapsed = (Date.now() - startTime) / 1000;
    const multiplier = Math.min(crashPoint, 1 + (elapsed * 0.05));
    
    multiplierDisplay.textContent = multiplier.toFixed(2) + 'x';
    cashoutBtn.textContent = `CASH OUT (${multiplier.toFixed(2)}x)`;
    
    // Auto cashout
    if (autoCashout && multiplier >= autoCashout) {
      cashout();
      return;
    }
    
    // Crash detection
    if (multiplier >= crashPoint && !crashed) {
      crashed = true;
      endGame(false);
    }
  }, 50);
}

// Cash Out
async function cashout() {
  if (!gameInterval) return;
  
  clearInterval(gameInterval);
  const multiplier = parseFloat(multiplierDisplay.textContent);
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
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    // Update balance if won
    if (didCashout) {
      await db.collection('users').doc(user.uid).update({
        balance: firebase.firestore.FieldValue.increment(winAmount)
      });
      balance += winAmount;
      updateBalanceDisplay();
      showMessage(`Cashed out at ${multiplier.toFixed(2)}x! Won $${winAmount.toFixed(2)}`, 'success');
    } else {
      showMessage(`Crashed at ${crashPoint.toFixed(2)}x`, 'error');
    }
    
    // Add to history
    addToHistory(didCashout, multiplier);
    
  } catch (error) {
    console.error("Game end failed:", error);
    showMessage('Game end failed', 'error');
  } finally {
    resetGame();
  }
}

// Load Game History
async function loadGameHistory() {
  if (!user) return;
  
  try {
    const snapshot = await db.collection('crashBets')
      .where('userId', '==', user.uid)
      .orderBy('createdAt', 'desc')
      .limit(10)
      .get();
    
    historyList.innerHTML = '';
    
    snapshot.forEach(doc => {
      const data = doc.data();
      const date = data.createdAt?.toDate?.() || new Date();
      addToHistory(data.status === 'cashedout', data.cashoutMultiplier || 0, date);
    });
    
  } catch (error) {
    console.error("Failed to load history:", error);
    historyList.innerHTML = '<div class="history-item error">Failed to load history</div>';
  }
}

// Utility Functions
function updateBalanceDisplay() {
  balanceEl.textContent = balance.toFixed(2);
}

function showMessage(text, type) {
  gameMessage.textContent = text;
  gameMessage.className = `game-message ${type}`;
}

function addToHistory(won, multiplier, date) {
  const historyItem = document.createElement('div');
  historyItem.className = `history-item ${won ? 'win' : 'lose'}`;
  historyItem.innerHTML = `
    <span>${won ? 'Cashed out' : 'Crashed'} at ${multiplier.toFixed(2)}x</span>
    <span>${date.toLocaleTimeString()}</span>
  `;
  historyList.prepend(historyItem);
  
  // Keep only last 10 items
  if (historyList.children.length > 10) {
    historyList.removeChild(historyList.lastChild);
  }
}

function resetGame() {
  clearInterval(gameInterval);
  currentGame = null;
  currentBet = null;
  gameInterval = null;
  
  multiplierDisplay.textContent = '1.00x';
  cashoutBtn.textContent = 'CASH OUT (1.00x)';
  cashoutBtn.disabled = true;
  placeBetBtn.disabled = false;
  
  setTimeout(() => {
    gameMessage.textContent = '';
    gameMessage.className = 'game-message';
  }, 3000);
}

// Event Listeners
placeBetBtn.addEventListener('click', placeBet);
cashoutBtn.addEventListener('click', cashout);
