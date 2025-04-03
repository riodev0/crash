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
const functions = firebase.functions();

// Game State Variables
let user = null;
let balance = 0;
let currentGame = null;
let currentBet = null;
let crashPoint = null;
let gameInterval = null;
let autoCashout = 2.00;
let currentMultiplier = 1.00;

// DOM Elements
const balanceEl = document.getElementById('balance');
const betAmountEl = document.getElementById('betAmount');
const placeBetBtn = document.getElementById('placeBetBtn');
const cashoutBtn = document.getElementById('cashoutBtn');
const autoCashoutBtn = document.getElementById('autoCashoutBtn');
const autoCashoutValue = document.getElementById('autoCashoutValue');
const multiplierDisplay = document.getElementById('multiplierDisplay');
const gameMessage = document.getElementById('gameMessage');
const historyList = document.getElementById('historyList');
const usernameEl = document.getElementById('username');

// Initialize Authentication
auth.onAuthStateChanged(async (authUser) => {
  if (authUser) {
    user = authUser;
    usernameEl.textContent = user.email;
    await initializeUser(user.uid);
    loadGameHistory();
  } else {
    window.location.href = '/login';
  }
});

// Initialize User Data
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

// Update Balance Display
function updateBalanceDisplay() {
  balanceEl.textContent = balance.toFixed(2);
}

// Place Bet Function
async function placeBet() {
  if (!user) {
    showMessage('Please sign in to place bets', 'error');
    return;
  }

  const amount = parseFloat(betAmountEl.value);
  if (isNaN(amount) {
    showMessage('Please enter a valid amount', 'error');
    return;
  }

  if (amount <= 0 || amount > balance) {
    showMessage('Invalid bet amount', 'error');
    return;
  }

  placeBetBtn.disabled = true;
  showMessage('Placing bet...', 'success');

  try {
    // Create bet document
    const betRef = await db.collection('crashBets').add({
      userId: user.uid,
      amount: amount,
      status: 'pending',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    currentBet = { id: betRef.id, amount };
    
    // Deduct from balance
    await db.collection('users').doc(user.uid).update({
      balance: firebase.firestore.FieldValue.increment(-amount)
    });
    balance -= amount;
    updateBalanceDisplay();
    
    // Start new game
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
    showMessage('Starting new game...', 'success');
    
    // Call Cloud Function via HTTP request
    const idToken = await auth.currentUser.getIdToken();
    const response = await fetch('https://us-central1-tbgames-d6995.cloudfunctions.net/createCrashGame', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({
        clientSeed: Date.now().toString()
      })
    });
    
    const data = await response.json();
    currentGame = data.gameId;
    
    // Start game after 5 seconds
    setTimeout(async () => {
      try {
        const startResponse = await fetch('https://us-central1-tbgames-d6995.cloudfunctions.net/startCrashGame', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
          },
          body: JSON.stringify({
            gameId: currentGame
          })
        });
        
        const startData = await startResponse.json();
        crashPoint = parseFloat(startData.crashPoint);
        runGameLoop();
        
      } catch (error) {
        console.error("Game start failed:", error);
        showMessage('Game start failed', 'error');
        resetGame();
      }
    }, 5000);
    
  } catch (error) {
    console.error("Game creation failed:", error);
    showMessage('Game creation failed', 'error');
    resetGame();
  }
}

// Run Game Loop
function runGameLoop() {
  let startTime = Date.now();
  let crashed = false;
  
  gameMessage.textContent = 'Game in progress!';
  gameMessage.className = 'game-message success';
  cashoutBtn.disabled = false;
  
  gameInterval = setInterval(() => {
    const elapsed = (Date.now() - startTime) / 1000;
    currentMultiplier = Math.min(crashPoint, 1 + (elapsed * 0.05));
    
    // Update display
    multiplierDisplay.textContent = currentMultiplier.toFixed(2) + 'x';
    cashoutBtn.textContent = `CASH OUT (${currentMultiplier.toFixed(2)}x)`;
    
    // Check for auto cashout
    if (autoCashout && currentMultiplier >= autoCashout) {
      cashout();
      return;
    }
    
    // Check for crash
    if (currentMultiplier >= crashPoint && !crashed) {
      crashed = true;
      endGame(false);
    }
  }, 50);
}

// Cash Out Function
async function cashout() {
  if (!gameInterval) return;
  
  clearInterval(gameInterval);
  const multiplier = parseFloat(multiplierDisplay.textContent);
  await endGame(true, multiplier);
}

// End Game Function
async function endGame(didCashout, multiplier) {
  try {
    const winAmount = didCashout ? currentBet.amount * multiplier : 0;
    
    // Update bet document
    await db.collection('crashBets').doc(currentBet.id).update({
      status: didCashout ? 'cashedout' : 'crashed',
      cashoutMultiplier: didCashout ? multiplier : null,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    // Update user balance if cashed out
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

// Reset Game State
function resetGame() {
  clearInterval(gameInterval);
  currentGame = null;
  currentBet = null;
  crashPoint = null;
  gameInterval = null;
  currentMultiplier = 1.00;
  
  multiplierDisplay.textContent = '1.00x';
  cashoutBtn.textContent = 'CASH OUT (1.00x)';
  cashoutBtn.disabled = true;
  placeBetBtn.disabled = false;
  
  setTimeout(() => {
    gameMessage.textContent = '';
    gameMessage.className = 'game-message';
  }, 3000);
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
    
    if (snapshot.empty) {
      historyList.innerHTML = '<div class="history-item">No games played yet</div>';
      return;
    }
    
    snapshot.forEach(doc => {
      const data = doc.data();
      addToHistory(data.status === 'cashedout', data.cashoutMultiplier || 0, true);
    });
    
  } catch (error) {
    console.error("Failed to load history:", error);
    historyList.innerHTML = '<div class="history-item error">Failed to load history</div>';
  }
}

// Add to History
function addToHistory(won, multiplier, isHistorical = false) {
  const historyItem = document.createElement('div');
  historyItem.className = `history-item ${won ? 'win' : 'lose'}`;
  
  const date = isHistorical 
    ? new Date(doc.data().createdAt.toDate()).toLocaleTimeString()
    : new Date().toLocaleTimeString();
  
  historyItem.innerHTML = `
    <span>${won ? 'Cashed out' : 'Crashed'} at ${multiplier.toFixed(2)}x</span>
    <span>${date}</span>
  `;
  
  if (isHistorical) {
    historyList.appendChild(historyItem);
  } else {
    historyList.insertBefore(historyItem, historyList.firstChild);
    
    // Keep only last 10 items
    if (historyList.children.length > 10) {
      historyList.removeChild(historyList.lastChild);
    }
  }
}

// Utility Functions
function showMessage(text, type) {
  gameMessage.textContent = text;
  gameMessage.className = `game-message ${type}`;
}

function adjustBet(multiplier) {
  if (multiplier === 'max') {
    betAmountEl.value = balance.toFixed(2);
  } else {
    const current = parseFloat(betAmountEl.value) || 0;
    betAmountEl.value = Math.min(balance, current * multiplier).toFixed(2);
  }
}

function clearBet() {
  betAmountEl.value = '';
}

// Set Auto Cashout
function setAutoCashout() {
  const newValue = parseFloat(prompt('Set auto cashout multiplier (e.g. 2.00)', autoCashout));
  if (!isNaN(newValue) {
    autoCashout = newValue;
    autoCashoutValue.textContent = autoCashout.toFixed(2);
  }
}

// Event Listeners
placeBetBtn.addEventListener('click', placeBet);
cashoutBtn.addEventListener('click', cashout);
autoCashoutBtn.addEventListener('click', setAutoCashout);

// Quick Bet Buttons
document.querySelectorAll('.btn-group .btn').forEach(btn => {
  if (!btn.id) {
    btn.addEventListener('click', function() {
      if (this.textContent === '½') adjustBet(0.5);
      else if (this.textContent === '2x') adjustBet(2);
      else if (this.textContent === 'MAX') adjustBet('max');
      else if (this.textContent === 'CLEAR') clearBet();
    });
  }
});
