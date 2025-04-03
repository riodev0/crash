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

// Enable Firestore persistence for better offline support
db.enablePersistence()
  .catch((err) => {
    console.log("Firestore persistence failed: ", err);
  });

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
const usernameEl = document.getElementById('username');
const autoCashoutInput = document.getElementById('autoCashout');

// Initialize Auth
auth.onAuthStateChanged(async (authUser) => {
  if (authUser) {
    user = authUser;
    usernameEl.textContent = user.email || 'Anonymous';
    await initializeUser(user.uid);
    await loadGameHistory();
  } else {
    // Redirect to login page if not authenticated
    if (!window.location.pathname.includes('login.html')) {
      window.location.href = '/login.html';
    }
  }
});

// Initialize User with enhanced error handling
async function initializeUser(uid) {
  try {
    const userRef = db.collection('users').doc(uid);
    const doc = await userRef.get();
    
    if (!doc.exists) {
      await userRef.set({
        balance: 1000.00,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        lastLogin: new Date().toISOString()
      });
      balance = 1000.00;
    } else {
      balance = doc.data().balance;
      // Update last login time
      await userRef.update({
        lastLogin: new Date().toISOString()
      });
    }
    updateBalanceDisplay();
  } catch (error) {
    console.error("User initialization failed:", error);
    showMessage('Failed to load user data', 'error');
  }
}

// Enhanced Place Bet function with validation
async function placeBet() {
  if (!user) {
    showMessage('Please sign in to place bets', 'error');
    return;
  }

  const amount = parseFloat(betAmountEl.value);
  if (isNaN(amount) || amount <= 0) {
    showMessage('Please enter a valid amount', 'error');
    return;
  }

  if (amount > balance) {
    showMessage('Insufficient balance', 'error');
    return;
  }

  placeBetBtn.disabled = true;
  showMessage('Processing bet...', 'success');

  try {
    // Create bet document with additional metadata
    const betRef = await db.collection('crashBets').add({
      userId: user.uid,
      amount: amount,
      status: 'pending',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      clientTimestamp: new Date().toISOString(),
      userAgent: navigator.userAgent
    });
    
    currentBet = { id: betRef.id, amount };
    
    // Update balance using transaction for atomic operation
    await db.runTransaction(async (transaction) => {
      const userRef = db.collection('users').doc(user.uid);
      const doc = await transaction.get(userRef);
      const newBalance = doc.data().balance - amount;
      transaction.update(userRef, { balance: newBalance });
      balance = newBalance;
      updateBalanceDisplay();
    });

    await startNewGame();
  } catch (error) {
    console.error("Bet placement failed:", error);
    showMessage('Bet failed: ' + error.message, 'error');
    placeBetBtn.disabled = false;
  }
}

// Start New Game with enhanced CORS handling
async function startNewGame() {
  try {
    const token = await auth.currentUser.getIdToken();
    
    // Create game with enhanced error handling
    const createResponse = await fetch('https://us-central1-tbgames-d6995.cloudfunctions.net/createCrashGame', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        clientSeed: Date.now().toString(),
        origin: window.location.origin
      })
    });

    if (!createResponse.ok) {
      const errorData = await createResponse.json();
      throw new Error(errorData.error || 'Failed to create game');
    }

    const createData = await createResponse.json();
    currentGame = createData.gameId;
    
    // Start countdown with visual feedback
    let countdown = 5;
    const countdownInterval = setInterval(() => {
      showMessage(`Game starting in ${countdown}...`, 'success');
      countdown--;
      if (countdown < 0) {
        clearInterval(countdownInterval);
        startGameRound(token);
      }
    }, 1000);

  } catch (error) {
    console.error("Game creation failed:", error);
    showMessage('Game creation failed: ' + error.message, 'error');
    resetGame();
  }
}

// Start game round after countdown
async function startGameRound(token) {
  try {
    const startResponse = await fetch('https://us-central1-tbgames-d6995.cloudfunctions.net/startCrashGame', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        gameId: currentGame,
        origin: window.location.origin
      })
    });

    if (!startResponse.ok) {
      const errorData = await startResponse.json();
      throw new Error(errorData.error || 'Failed to start game');
    }

    const startData = await startResponse.json();
    crashPoint = parseFloat(startData.crashPoint);
    runGameLoop();
  } catch (error) {
    console.error("Game start failed:", error);
    showMessage('Game start failed: ' + error.message, 'error');
    resetGame();
  }
}

// Run Game Loop with smooth animation
function runGameLoop() {
  let startTime = Date.now();
  let crashed = false;
  let animationFrameId;
  
  gameMessage.textContent = 'Game in progress!';
  cashoutBtn.disabled = false;
  
  function gameFrame() {
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
      return;
    }
    
    animationFrameId = requestAnimationFrame(gameFrame);
  }
  
  gameFrame();
  
  // Store the animation frame ID for cleanup
  gameInterval = animationFrameId;
}

// Cash Out with confirmation
async function cashout() {
  if (!gameInterval) return;
  
  // Cancel the animation frame
  cancelAnimationFrame(gameInterval);
  
  const multiplier = parseFloat(multiplierDisplay.textContent);
  const winAmount = currentBet.amount * multiplier;
  
  if (!confirm(`Cash out at ${multiplier.toFixed(2)}x for $${winAmount.toFixed(2)}?`)) {
    // Continue game if user cancels
    runGameLoop();
    return;
  }
  
  await endGame(true, multiplier);
}

// End Game with complete cleanup
async function endGame(didCashout, multiplier) {
  try {
    const winAmount = didCashout ? currentBet.amount * multiplier : 0;
    
    // Update bet document with result
    await db.collection('crashBets').doc(currentBet.id).update({
      status: didCashout ? 'cashedout' : 'crashed',
      cashoutMultiplier: didCashout ? multiplier : null,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      resultAmount: didCashout ? winAmount : -currentBet.amount
    });
    
    // Update balance if cashed out
    if (didCashout) {
      await db.runTransaction(async (transaction) => {
        const userRef = db.collection('users').doc(user.uid);
        const doc = await transaction.get(userRef);
        const newBalance = doc.data().balance + winAmount;
        transaction.update(userRef, { balance: newBalance });
        balance = newBalance;
        updateBalanceDisplay();
      });
      
      showMessage(`Cashed out at ${multiplier.toFixed(2)}x! Won $${winAmount.toFixed(2)}`, 'success');
      playSound('cashout');
    } else {
      showMessage(`Crashed at ${crashPoint.toFixed(2)}x`, 'error');
      playSound('crash');
    }
    
    // Add to history
    addToHistory(didCashout, multiplier);
    
  } catch (error) {
    console.error("Game end failed:", error);
    showMessage('Game end failed. Please refresh the page.', 'error');
  } finally {
    resetGame();
  }
}

// Enhanced Load Game History with pagination
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
    console.error("Failed to load history:", error);
    if (error.code === 'failed-precondition') {
      historyList.innerHTML = '<div class="history-item error">Please create a Firestore index</div>';
    } else {
      historyList.innerHTML = '<div class="history-item error">Failed to load history</div>';
    }
  }
}

// Simple sound effects
function playSound(type) {
  if (type === 'cashout') {
    const audio = new Audio('https://assets.mixkit.co/sfx/preview/mixkit-winning-chimes-2015.mp3');
    audio.volume = 0.3;
    audio.play().catch(e => console.log("Audio play failed:", e));
  } else if (type === 'crash') {
    const audio = new Audio('https://assets.mixkit.co/sfx/preview/mixkit-explosion-hit-1694.mp3');
    audio.volume = 0.2;
    audio.play().catch(e => console.log("Audio play failed:", e));
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
  historyList.appendChild(historyItem);
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
  
  setTimeout(() => {
    gameMessage.textContent = '';
    gameMessage.className = 'game-message';
  }, 3000);
}

// Event Listeners with debouncing
placeBetBtn.addEventListener('click', () => {
  placeBetBtn.disabled = true;
  setTimeout(() => placeBetBtn.disabled = false, 1000);
  placeBet();
});

cashoutBtn.addEventListener('click', () => {
  cashoutBtn.disabled = true;
  setTimeout(() => cashoutBtn.disabled = false, 1000);
  cashout();
});

// Quick bet buttons
document.querySelectorAll('.bet-button').forEach(button => {
  button.addEventListener('click', (e) => {
    const action = e.target.dataset.action;
    if (action === 'half') adjustBet(0.5);
    else if (action === 'double') adjustBet(2);
    else if (action === 'max') adjustBet('max');
    else if (action === 'clear') clearBet();
  });
});

// Auto cashout input
autoCashoutInput.addEventListener('change', (e) => {
  const value = parseFloat(e.target.value);
  if (!isNaN(value) && value >= 1.0) {
    autoCashout = value;
  } else {
    autoCashout = null;
  }
});

// Adjust bet amount
function adjustBet(multiplier) {
  const current = parseFloat(betAmountEl.value) || 0;
  if (multiplier === 'max') {
    betAmountEl.value = balance.toFixed(2);
  } else {
    betAmountEl.value = Math.min(balance, current * multiplier).toFixed(2);
  }
}

// Clear bet amount
function clearBet() {
  betAmountEl.value = '';
}

// Initialize the game
window.addEventListener('DOMContentLoaded', () => {
  // Check if user is returning from authentication
  if (window.location.hash.includes('access_token')) {
    // Handle Firebase auth redirect
    auth.getRedirectResult().then(() => {
      window.location.hash = '';
    });
  }
});
