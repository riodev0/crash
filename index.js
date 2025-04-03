import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

// Initialize Firebase
const firebaseConfig = {
  apiKey: "AIzaSyDfK_HayFBawYzgIcGXQsQ4ynyCrVHHL8A",
  authDomain: "tbgames-d6995.firebaseapp.com",
  projectId: "tbgames-d6995",
  storageBucket: "tbgames-d6995.appspot.com",
  messagingSenderId: "578117532273",
  appId: "1:578117532273:web:3e52426b147f1c7e5af9d0"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app);

// Game state
let user = null;
let balance = 0;
let currentGame = null;
let currentBet = null;
let crashPoint = null;
let gameInterval = null;

// Initialize auth
onAuthStateChanged(auth, async (authUser) => {
  if (authUser) {
    user = authUser;
    await initializeUser(user.uid);
    await loadGameHistory();
  } else {
    window.location.href = '/login.html';
  }
});

// Initialize user data
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
  updateBalanceDisplay();
}

// Place bet function
async function placeBet() {
  if (!user) {
    showMessage('Please sign in to place bets', 'error');
    return;
  }

  const amount = parseFloat(document.getElementById('betAmount').value);
  if (isNaN(amount) {
    showMessage('Please enter a valid amount', 'error');
    return;
  }

  try {
    // Create bet document
    const betRef = await addDoc(collection(db, 'crashBets'), {
      userId: user.uid,
      amount: amount,
      status: "pending",
      createdAt: serverTimestamp()
    });
    
    // Deduct from balance
    await updateUserBalance(-amount);
    currentBet = betRef.id;
    await startNewGame();
    
  } catch (error) {
    console.error("Bet failed:", error);
    showMessage('Bet failed: ' + error.message, 'error');
  }
}

// Start new game
async function startNewGame() {
  try {
    const response = await fetch(`https://us-central1-tbgames-d6995.cloudfunctions.net/createCrashGame`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${await auth.currentUser.getIdToken()}`
      },
      body: JSON.stringify({
        clientSeed: Date.now().toString()
      })
    });

    const data = await response.json();
    currentGame = data.gameId;

    // Start game after delay
    setTimeout(async () => {
      const startResponse = await fetch(`https://us-central1-tbgames-d6995.cloudfunctions.net/startCrashGame`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${await auth.currentUser.getIdToken()}`
        },
        body: JSON.stringify({
          gameId: currentGame
        })
      });

      const startData = await startResponse.json();
      crashPoint = startData.crashPoint;
      runGameLoop();
    }, 5000);

  } catch (error) {
    console.error("Game start failed:", error);
    showMessage('Game start failed', 'error');
    resetGame();
  }
}

// Run game loop
function runGameLoop() {
  let startTime = Date.now();
  let currentMultiplier = 1.0;
  
  gameInterval = setInterval(() => {
    const elapsed = (Date.now() - startTime) / 1000;
    currentMultiplier = Math.min(crashPoint, 1 + (elapsed * 0.05));
    
    document.getElementById('multiplierDisplay').textContent = currentMultiplier.toFixed(2) + 'x';
    document.getElementById('cashoutBtn').textContent = `Cash Out (${currentMultiplier.toFixed(2)}x)`;
    
    if (currentMultiplier >= crashPoint) {
      endGame(false);
    }
  }, 50);
}

// Update other functions similarly...
