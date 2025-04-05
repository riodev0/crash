// Initialize Firebase
const firebaseConfig = {
    apiKey: "AIzaSyDfK_HayFBawYzgIcGXQsQ4ynyCrVHHL8A",
    authDomain: "tbgames-d6995.firebaseapp.com",
    projectId: "tbgames-d6995",
    storageBucket: "tbgames-d6995.appspot.com",
    messagingSenderId: "578117532273",
    appId: "1:578117532273:web:3e52426b147f1c7e5af9d0",
    measurementId: "G-VWLDSR92KV"
};

const app = firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const functions = firebase.functions();

// Game state variables
let currentUser = null;
let userData = null;
let gameActive = false;
let currentMultiplier = 1.0;
let currentBet = 0;
let crashPoint = 1.0;
let gameInterval = null;
let currentGameId = null;
let startTime = 0;
let autoCashoutEnabled = false;
let autoCashoutValue = 0;
let pathData = "M0,300";

// DOM elements
const balanceEl = document.getElementById('balance');
const multiplierEl = document.getElementById('multiplier');
const betAmountEl = document.getElementById('bet-amount');
const autoCashoutEl = document.getElementById('auto-cashout');
const placeBetBtn = document.getElementById('place-bet');
const cashOutBtn = document.getElementById('cash-out');
const historyList = document.getElementById('history-list');
const accountBtn = document.getElementById('account-btn');
const accountModal = document.getElementById('account-modal');
const referralModal = document.getElementById('referral-modal');
const userEmailEl = document.getElementById('user-email');
const userReferralCodeEl = document.getElementById('user-referral-code');
const referralCountEl = document.getElementById('referral-count');
const referralEarningsEl = document.getElementById('referral-earnings');
const logoutBtn = document.getElementById('logout-btn');
const referralBtn = document.getElementById('referral-btn');
const copyBtn = document.getElementById('copy-btn');
const graphPath = document.getElementById('graph-path');
const graphGrid = document.getElementById('graph-grid');

// Initialize grid
function initGrid() {
    let gridHTML = '';
    // Horizontal grid lines and labels (multiplier)
    for (let i = 1; i <= 10; i++) {
        const y = 300 - (i * 30);
        gridHTML += `<line class="grid-line" x1="0" y1="${y}" x2="1000" y2="${y}" />`;
        gridHTML += `<text class="grid-text" x="990" y="${y + 4}">${i}x</text>`;
    }
    // Vertical grid lines and labels (time)
    for (let i = 1; i <= 10; i++) {
        const x = i * 100;
        gridHTML += `<line class="grid-line" x1="${x}" y1="0" x2="${x}" y2="300" />`;
        gridHTML += `<text class="grid-text" x="${x - 5}" y="295">${i}s</text>`;
    }
    graphGrid.innerHTML = gridHTML;
}

function formatMoney(value) {
    return value.toFixed(2);
}

// Secure bet placement
async function placeBet() {
    const betAmount = parseFloat(betAmountEl.value);
    const autoCashout = parseFloat(autoCashoutEl.value) || null;
    
    if (isNaN(betAmount) || betAmount < 1) {
        alert('Please enter a valid bet amount');
        return;
    }
    
    if (autoCashout && (autoCashout < 1.00)) {
        alert('Auto cashout must be at least 1.00x');
        return;
    }
    
    try {
        const placeBetCall = functions.httpsCallable('placeBet');
        const result = await placeBetCall({ 
            amount: betAmount, 
            autoCashout 
        });
        
        currentGameId = result.data.gameId;
        currentBet = betAmount;
        crashPoint = parseFloat(result.data.crashPoint);
        startGame();
        
    } catch (error) {
        console.error("Bet error:", error);
        alert(error.message);
    }
}

// Start game with secure server values
function startGame() {
    gameActive = true;
    currentMultiplier = 1.0;
    startTime = Date.now();
    pathData = "M0,300";
    
    placeBetBtn.disabled = true;
    cashOutBtn.disabled = false;
    
    gameInterval = setInterval(updateMultiplier, 50);
    graphPath.setAttribute('d', pathData);
}

function updateMultiplier() {
    const elapsed = (Date.now() - startTime) / 1000;
    currentMultiplier = 1 + Math.pow(elapsed, 1.5) * 0.2;
    
    // Auto cashout check
    if (autoCashoutEnabled && currentMultiplier >= autoCashoutValue) {
        cashOut();
        return;
    }
    
    // Crash check
    if (currentMultiplier >= crashPoint) {
        endGame(false);
        return;
    }
    
    multiplierEl.textContent = currentMultiplier.toFixed(2) + 'x';
    updateGraph(elapsed);
}

function updateGraph(elapsed) {
    const x = Math.min(1000, elapsed * 100);
    const y = 300 - (currentMultiplier * 30);
    pathData += ` L${x},${y}`;
    graphPath.setAttribute('d', pathData);
    
    if (currentMultiplier > crashPoint * 0.8) {
        graphPath.style.stroke = 'var(--secondary)';
    } else {
        graphPath.style.stroke = 'var(--primary)';
    }
}

// Secure cashout
async function cashOut() {
    if (!gameActive) return;
    
    try {
        const cashOutCall = functions.httpsCallable('cashOut');
        const result = await cashOutCall({ 
            gameId: currentGameId,
            multiplier: currentMultiplier 
        });
        
        endGame(true);
        alert(`Cashed out at ${currentMultiplier.toFixed(2)}x! Won $${formatMoney(result.data.winnings)}`);
        
    } catch (error) {
        console.error("Cashout error:", error);
        alert(error.message);
    }
}

function endGame(cashedOut) {
    clearInterval(gameInterval);
    gameActive = false;
    
    placeBetBtn.disabled = false;
    cashOutBtn.disabled = true;
    
    if (cashedOut) {
        multiplierEl.textContent = currentMultiplier.toFixed(2) + 'x (Cashed Out)';
    } else {
        multiplierEl.textContent = 'CRASHED at ' + crashPoint.toFixed(2) + 'x';
        graphPath.style.stroke = 'var(--danger)';
    }
    
    refreshUserData();
}

// Your existing account functions
async function refreshUserData() {
    if (!currentUser) return;
    
    const doc = await db.collection('users').doc(currentUser.uid).get();
    if (doc.exists) {
        userData = doc.data();
        balanceEl.textContent = formatMoney(userData.balance);
        userEmailEl.textContent = currentUser.email;
        
        if (userData.referralCode) {
            userReferralCodeEl.value = userData.referralCode;
            referralCountEl.textContent = userData.referrals?.length || 0;
            referralEarningsEl.textContent = formatMoney(userData.referralEarnings || 0);
        }
    }
}

async function loadHistory() {
    const snapshot = await db.collection('crash_games')
        .where('userId', '==', currentUser.uid)
        .orderBy('createdAt', 'desc')
        .limit(7)
        .get();
    
    historyList.innerHTML = '';
    snapshot.forEach(doc => {
        const game = doc.data();
        const item = document.createElement('div');
        item.className = 'history-item ' + (game.status === 'crashed' ? 'crashed' : 'cashed-out');
        
        const multiplier = game.finalMultiplier?.toFixed(2) + 'x' || '1.00x';
        const bet = '$' + formatMoney(game.betAmount);
        const result = game.status === 'crashed' ? 'CRASHED' : 'CASHED OUT';
        
        item.innerHTML = `
            <span>${new Date(game.createdAt?.toDate()).toLocaleTimeString()}</span>
            <span>${multiplier} (${result})</span>
            <span>${bet}</span>
        `;
        historyList.appendChild(item);
    });
}

// Event listeners
placeBetBtn.addEventListener('click', placeBet);
cashOutBtn.addEventListener('click', cashOut);

document.querySelectorAll('.quick-bet').forEach(btn => {
    btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-action');
        let currentValue = parseFloat(betAmountEl.value) || 0;
        const balance = parseFloat(balanceEl.textContent) || 0;
        
        switch(action) {
            case 'half': betAmountEl.value = (currentValue / 2).toFixed(2); break;
            case 'double': betAmountEl.value = (currentValue * 2).toFixed(2); break;
            case 'max': betAmountEl.value = balance.toFixed(2); break;
        }
    });
});

// Your existing modal handlers
accountBtn.addEventListener('click', () => accountModal.style.display = 'flex');
referralBtn.addEventListener('click', () => {
    accountModal.style.display = 'none';
    referralModal.style.display = 'flex';
});
copyBtn.addEventListener('click', () => {
    userReferralCodeEl.select();
    document.execCommand('copy');
    alert('Referral code copied!');
});
logoutBtn.addEventListener('click', () => auth.signOut());

document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
        accountModal.style.display = 'none';
        referralModal.style.display = 'none';
    });
});

window.addEventListener('click', (e) => {
    if (e.target === accountModal) accountModal.style.display = 'none';
    if (e.target === referralModal) referralModal.style.display = 'none';
});

// Auth state handler
auth.onAuthStateChanged(async user => {
    if (!user) {
        window.location.href = 'https://riodev0.github.io/login';
        return;
    }
    
    currentUser = user;
    await refreshUserData();
    loadHistory();
    initGrid();
});
