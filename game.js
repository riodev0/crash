import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';

// Initialize Firebase
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const functions = getFunctions(app);

// Game state
let currentGame = null;
let currentBet = null;
let balance = 0;
let crashPoint = 1.0;

// DOM elements
const balanceEl = document.getElementById('balance');
const betAmountEl = document.getElementById('betAmount');
const placeBetBtn = document.getElementById('placeBetBtn');
const cashoutBtn = document.getElementById('cashoutBtn');
const multiplierDisplay = document.getElementById('multiplierDisplay');

// Initialize user
onAuthStateChanged(auth, async (user) => {
  if (user) {
    await initializeUser(user.uid);
    setupGame();
  } else {
    window.location.href = '/login';
  }
});

async function initializeUser(uid) {
  const userRef = doc(db, 'users', uid);
  const userSnap = await getDoc(userRef);
  
  if (!userSnap.exists()) {
    await setDoc(userRef, {
      balance: 1000.00,
      createdAt: serverTimestamp()
    });
    balance = 1000.00;
  } else {
    balance = userSnap.data().balance;
  }
  balanceEl.textContent = balance.toFixed(2);
}

async function placeBet() {
  const amount = parseFloat(betAmountEl.value);
  if (isNaN(amount) || amount <= 0 || amount > balance) return;

  placeBetBtn.disabled = true;
  
  try {
    // Create bet
    const betRef = await addDoc(collection(db, 'crashBets'), {
      userId: auth.currentUser.uid,
      amount: amount,
      status: "pending",
      createdAt: serverTimestamp()
    });
    
    // Deduct balance
    await updateBalance(-amount);
    
    // Start game
    currentBet = betRef.id;
    startNewGame();
  } catch (error) {
    console.error("Bet failed:", error);
    placeBetBtn.disabled = false;
  }
}

async function startNewGame() {
  try {
    const createGame = httpsCallable(functions, 'createCrashGame');
    const { data: { gameId } } = await createGame();
    currentGame = gameId;
    
    // Start game after 5s countdown
    setTimeout(async () => {
      const startGame = httpsCallable(functions, 'startCrashGame');
      const { data: { crashPoint: point } } = await startGame({ gameId });
      crashPoint = point;
      runGameLoop();
    }, 5000);
  } catch (error) {
    console.error("Game start failed:", error);
  }
}

function runGameLoop() {
  let startTime = Date.now();
  let crashed = false;
  
  const gameInterval = setInterval(() => {
    const elapsed = (Date.now() - startTime) / 1000;
    const multiplier = Math.min(crashPoint, 1 + (elapsed * 0.05));
    
    multiplierDisplay.textContent = multiplier.toFixed(2) + 'x';
    cashoutBtn.textContent = `Cash Out (${multiplier.toFixed(2)}x)`;
    
    if (multiplier >= crashPoint) {
      clearInterval(gameInterval);
      endGame(false);
    }
  }, 50);
  
  cashoutBtn.disabled = false;
  cashoutBtn.onclick = () => {
    clearInterval(gameInterval);
    endGame(true);
  };
}

async function endGame(didCashout) {
  const multiplier = parseFloat(multiplierDisplay.textContent);
  const updateBet = httpsCallable(functions, 'updateUserBalance');
  
  try {
    await updateBet({
      betId: currentBet,
      status: didCashout ? "cashedout" : "crashed",
      multiplier: didCashout ? multiplier : null
    });
    
    if (didCashout) {
      await updateBalance(currentBetAmount * multiplier);
    }
  } catch (error) {
    console.error("Game end failed:", error);
  }
  
  resetGame();
}

function resetGame() {
  currentGame = null;
  currentBet = null;
  multiplierDisplay.textContent = '1.00x';
  cashoutBtn.disabled = true;
  placeBetBtn.disabled = false;
}

// Initialize
placeBetBtn.onclick = placeBet;
cashoutBtn.disabled = true;
