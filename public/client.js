// ── TELL client.js v7 — Two rounds of 3 ──

const socket = io({
  reconnection: true,
  reconnectionDelay: 500,
  reconnectionAttempts: 10
});

socket.on('reconnect', () => {
  if (roomCode && !gameData && myName) {
    socket.emit('rejoin_room', { code: roomCode, name: myName });
  }
});

// ── STATE ──
let myName = '', oppName = '', myColour = 'red';
let gameData = null;
let currentGameRound = 0;  // 0 or 1
let currentQuestionIdx = 0;
let myPicks = {};           // "gameRound_questionIdx" -> faceIndex
let oppPicks = {};
let usedFaces = new Set();
let timerInterval = null;
let pickedThisRound = false;
let finalPicks = {};
let finalOppPicks = {};
let finalSelectedCard = null;
let _finalChanges = 0;
let _finalSubmitted = false;

const _urlParams = new URLSearchParams(window.location.search);
let roomCode = _urlParams.get('room') || '';

// ── AUDIO ──
let _music = null;
let _audioUnlocked = false;
const _audioElements = {};
let _pendingAudio = null;

function startMusic() {
  if (_music) return;
  unlockAudio();
  _music = new Audio('/telltheme.mp3');
  _music.loop = true;
  _music.volume = 0.15;
  _music.play().catch(() => {});
}
function stopMusic() {
  if (_music) { _music.pause(); _music.currentTime = 0; _music = null; }
}

function showAudioButton() {
  const btn = document.getElementById('audio-play-btn');
  if (!btn) return;
  btn.style.display = 'flex';
  btn.onclick = () => { unlockAudio(); playPendingAudio(); };
}
function hideAudioButton() {
  const btn = document.getElementById('audio-play-btn');
  if (!btn) return;
  btn.style.display = 'none';
  btn.onclick = null;
}

function preloadAudio(questions) {
  questions.forEach(q => {
    if (!q.audio || _audioElements[q.audio]) return;
    const a = new Audio(`/audio/${q.audio}`);
    a.preload = 'auto'; a.volume = 0.9;
    a.playsInline = true;
    a.setAttribute('playsinline', '');
    a.setAttribute('webkit-playsinline', '');
    _audioElements[q.audio] = a;
    a.load();
  });
}

function playQuestion(filename) {
  _pendingAudio = filename;
  showAudioButton();
}

function playPendingAudio() {
  if (!_pendingAudio) return;
  const filename = _pendingAudio;
  const a = _audioElements[filename] || new Audio(`/audio/${filename}`);
  _audioElements[filename] = a;
  a.playsInline = true;
  a.setAttribute('playsinline','');
  a.setAttribute('webkit-playsinline','');
  a.volume = 0.9; a.currentTime = 0;
  const p = a.play();
  if (p && typeof p.then === 'function') {
    p.then(() => { _pendingAudio = null; hideAudioButton(); })
     .catch(() => showAudioButton());
  } else { _pendingAudio = null; hideAudioButton(); }
}

function unlockAudio() {
  const first = !_audioUnlocked;
  _audioUnlocked = true;
  try {
    const ctx = getAudioCtx();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  } catch(e) {}
  if (first && _pendingAudio) playPendingAudio();
}

document.addEventListener('touchstart', unlockAudio, { passive: true });
document.addEventListener('click', unlockAudio);

// ── SPLASH ──
window.addEventListener('load', () => {
  setTimeout(() => {
    if (roomCode) {
      show('screen-joiner');
      setTimeout(() => document.getElementById('input-joiner-name').focus(), 100);
    } else {
      show('screen-creator');
      setTimeout(() => document.getElementById('input-creator-name').focus(), 100);
    }
  }, 3500);
});

// ── INPUTS ──
document.getElementById('input-creator-name').addEventListener('input', function() {
  document.getElementById('btn-challenge').disabled = !this.value.trim();
});
document.getElementById('input-joiner-name').addEventListener('input', function() {
  document.getElementById('btn-join').disabled = !this.value.trim();
});
document.getElementById('input-creator-name').addEventListener('keydown', e => { if (e.key === 'Enter') createGame(); });
document.getElementById('input-joiner-name').addEventListener('keydown', e => { if (e.key === 'Enter') joinGame(); });

// ── CREATE ──
function createGame() {
  myName = document.getElementById('input-creator-name').value.trim();
  if (!myName) return;
  socket.emit('create_room', { name: myName });
}
socket.on('room_created', ({ code }) => {
  roomCode = code;
  window._inviteLink = `${location.origin}?room=${code}`;
  show('screen-waiting');
  socket.emit('rejoin_room', { code, name: myName });
});

// ── JOIN ──
function joinGame() {
  myName = document.getElementById('input-joiner-name').value.trim();
  if (!myName || !roomCode) return;
  startMusic();
  document.getElementById('btn-join').disabled = true;
  document.getElementById('btn-join').textContent = 'JOINING…';
  socket.emit('join_room', { name: myName, code: roomCode });
}
socket.on('join_error', ({ message }) => {
  const errEl = document.getElementById('join-error-msg');
  if (errEl) { errEl.textContent = message === 'Room not found.' ? 'Room not found. Ask your opponent to create a new game.' : message; errEl.classList.remove('hidden'); }
  document.getElementById('btn-join').disabled = false;
  document.getElementById('btn-join').textContent = 'TRY AGAIN';
});

// ── SHARE ──
function shareInvite() {
  startMusic();
  const link = window._inviteLink;
  const showWaiting = () => {
    document.querySelector('.share-invite-btn').classList.add('hidden');
    document.getElementById('waiting-status').classList.remove('hidden');
  };
  if (navigator.share) {
    navigator.share({ title: 'TELL', text: 'I challenge you to a game of TELL 👀', url: link })
      .then(showWaiting).catch(() => showWaiting());
  } else {
    navigator.clipboard.writeText(link).then(() => { alert('Link copied!'); showWaiting(); });
  }
}

// ── CARD IMAGE PATH ──
function cardImg(face, side = 'back') {
  const file = side === 'front' ? face.front : face.back;
  return `/data/Game%201%20Cards/${encodeURIComponent(file)}`;
}

// ── GAME START ──
socket.on('game_start', ({ game, players }) => {
  const me = players.find(p => p.name === myName) || players[0];
  const opp = players.find(p => p.name !== myName) || players[1];
  myColour = me.playerIndex === 0 ? 'red' : 'blue';
  oppName = opp.name;
  gameData = game;
  myPicks = {}; oppPicks = {}; usedFaces = new Set();

  // Preload all audio
  game.rounds.forEach(r => preloadAudio(r.questions));

  show('screen-game');
  updateHeader();
  setTimeout(showLetsPlay, 1000);
});

function updateHeader() {
  const myHex  = myColour === 'red' ? '#e53e3e' : '#3182ce';
  const oppHex = myColour === 'red' ? '#3182ce' : '#e53e3e';
  const el = (id) => document.getElementById(id);
  el('hdr-my-name').textContent  = myName.toUpperCase();
  el('hdr-my-name').style.color  = myHex;
  el('hdr-opp-name').textContent = oppName.toUpperCase();
  el('hdr-opp-name').style.color = oppHex;
  el('hdr-my-score').textContent  = '0';
  el('hdr-opp-score').textContent = '0';
}

// ── LET'S PLAY ──
function showLetsPlay() {
  showPopupText("Let's Play Tell!", '34px', 2500, () => {
    if (gameData) flipCardsToFace(gameData.rounds[0].faces);
  });
}

function flipCardsToFace(faces) {
  const cards = document.querySelectorAll('#faces-row .face-card');
  cards.forEach((card, i) => {
    setTimeout(() => {
      const img = card.querySelector('img');
      card.classList.add('flipping');
      setTimeout(() => {
        img.src = cardImg(faces[i], 'back');
        card.classList.remove('flipping');
        card.classList.add('face-up');
      }, 350);
    }, i * 450);
  });
}

// ── RENDER 3 CARDS ──
function renderCards(faces, containerId = 'faces-row', clickable = true) {
  const row = document.getElementById(containerId);
  if (!row) return;
  row.innerHTML = '';
  faces.forEach((face, i) => {
    const card = document.createElement('div');
    card.className = 'face-card locked';
    card.dataset.index = i;
    card.innerHTML = `<img src="${cardImg(face, 'front')}" alt="${face.name}"><div class="face-num">${i+1}</div>`;
    if (clickable) card.addEventListener('click', () => handleCardClick(i, containerId));
    row.appendChild(card);
  });
}

function handleCardClick(index, containerId) {
  if (containerId === 'faces-row') {
    if (pickedThisRound) return;
    const card = document.querySelector(`#faces-row .face-card[data-index="${index}"]`);
    if (!card || card.classList.contains('locked')) return;
    submitPick(index);
  } else if (containerId === 'final-faces-row') {
    handleFinalCardPick(index);
  }
}

// ── QUESTION START ──
socket.on('question_start', ({ gameRound, questionIdx, totalQuestions, question, faces }) => {
  currentGameRound = gameRound;
  currentQuestionIdx = questionIdx;
  pickedThisRound = false;

  document.getElementById('hdr-round').textContent = `R${gameRound + 1} · Q${questionIdx + 1}/3`;
  document.getElementById('status-bar').textContent = '';

  // Render 3 cards if new round
  if (questionIdx === 0) {
    renderCards(faces);
    setTimeout(() => flipCardsToFace(faces), 100);
    renderStrip(3);
    // Preload this round's audio
    if (gameData) preloadAudio(gameData.rounds[gameRound].questions);
  }

  // Reset card states
  document.querySelectorAll('#faces-row .face-card').forEach((c, i) => {
    c.classList.remove('my-pick','opp-pick','both-pick','locked','used-face');
    if (usedFaces.has(`${gameRound}_${i}`)) { c.classList.add('used-face','locked'); }
  });

  highlightActiveSlot(questionIdx);

  // Queue audio and show round popup
  if (gameData) {
    const q = gameData.rounds[gameRound].questions[questionIdx];
    if (q && q.audio) playQuestion(q.audio);
  }

  showRoundPopup(`TELL R${gameRound+1} Q${questionIdx+1}`, () => {
    document.querySelectorAll('#faces-row .face-card').forEach((c, i) => {
      if (!usedFaces.has(`${gameRound}_${i}`)) c.classList.remove('locked');
    });
    startTimer('timer-fill', 15, () => {
      if (!pickedThisRound) {
        const avail = [0,1,2].find(i => !usedFaces.has(`${gameRound}_${i}`));
        submitPick(avail !== undefined ? avail : 0);
      }
    });
  });
});

// ── SUBMIT PICK ──
function submitPick(faceIndex) {
  pickedThisRound = true;
  stopTimer();
  const key = `${currentGameRound}_${currentQuestionIdx}`;
  myPicks[key] = faceIndex;
  usedFaces.add(`${currentGameRound}_${faceIndex}`);

  document.querySelectorAll('#faces-row .face-card').forEach((c, i) => {
    c.classList.add('locked');
    c.classList.toggle('my-pick', i === faceIndex);
  });

  document.getElementById('status-bar').textContent = 'WAITING FOR OPPONENT…';
  socket.emit('submit_pick', { faceIndex });
}

// ── LIVE PICK ──
socket.on('pick_made', ({ submitterName, faceIndex }) => {
  if (submitterName !== myName) {
    document.querySelectorAll('#faces-row .face-card').forEach((c, i) => {
      if (i === faceIndex) {
        if (c.classList.contains('my-pick')) c.classList.add('both-pick');
        else c.classList.add('opp-pick');
      }
    });
  }
});

// ── QUESTION REVEAL ──
socket.on('question_reveal', ({ gameRound, questionIdx, picks }) => {
  const myKey  = `${gameRound}_${questionIdx}`;
  const oppKey = myKey;
  if (picks[myName])  myPicks[myKey]  = picks[myName][questionIdx];
  if (picks[oppName]) oppPicks[myKey] = picks[oppName][questionIdx];
  stopTimer();
  document.getElementById('status-bar').textContent = '';
  revealStripSlot(questionIdx, picks, gameRound);
});

// ── STRIP ──
function renderStrip(count = 3) {
  const strip = document.getElementById('answer-strip');
  strip.innerHTML = '';
  const leftName = myColour === 'red' ? myName : oppName;
  const rightName = myColour === 'red' ? oppName : myName;
  const leftColour = '#e53e3e';
  const rightColour = '#3182ce';

  document.getElementById('strip-left-label').textContent = leftName.toUpperCase();
  document.getElementById('strip-left-label').style.color = leftColour;
  document.getElementById('strip-right-label').textContent = rightName.toUpperCase();
  document.getElementById('strip-right-label').style.color = rightColour;

  for (let i = 0; i < count; i++) {
    const row = document.createElement('div');
    row.className = 'strip-row';
    row.id = `strip-row-${i}`;
    row.innerHTML = `
      <div class="strip-thumb-cell" id="strip-left-${i}"><div class="strip-thumb"></div></div>
      <div class="strip-name-cell" id="strip-name-${i}"><span class="strip-qnum">Q${i+1}</span></div>
      <div class="strip-thumb-cell" id="strip-right-${i}"><div class="strip-thumb"></div></div>
    `;
    strip.appendChild(row);
  }
}

function revealStripSlot(questionIdx, picks, gameRound) {
  const faces = gameData.rounds[gameRound].faces;
  const q = gameData.rounds[gameRound].questions[questionIdx];

  const nameMid = document.getElementById(`strip-name-${questionIdx}`);
  if (nameMid) { nameMid.innerHTML = `<span class="strip-answer-name">${faces[q.answerIndex].name}</span>`; }

  const redPicks  = myColour === 'red' ? picks[myName]  : picks[oppName];
  const bluePicks = myColour === 'red' ? picks[oppName] : picks[myName];

  const leftEl  = document.getElementById(`strip-left-${questionIdx}`);
  const rightEl = document.getElementById(`strip-right-${questionIdx}`);

  if (leftEl && redPicks && redPicks[questionIdx] !== undefined) {
    const face = faces[redPicks[questionIdx]];
    const correct = redPicks[questionIdx] === q.answerIndex;
    const thumb = leftEl.querySelector('.strip-thumb');
    thumb.innerHTML = `<img src="${cardImg(face)}" alt="${face.name}">`;
    thumb.classList.add(correct ? 'correct-pick' : 'wrong-pick');
  }
  if (rightEl && bluePicks && bluePicks[questionIdx] !== undefined) {
    const face = faces[bluePicks[questionIdx]];
    const correct = bluePicks[questionIdx] === q.answerIndex;
    const thumb = rightEl.querySelector('.strip-thumb');
    thumb.innerHTML = `<img src="${cardImg(face)}" alt="${face.name}">`;
    thumb.classList.add(correct ? 'correct-pick' : 'wrong-pick');
  }
}

function highlightActiveSlot(idx) {
  document.querySelectorAll('.strip-row').forEach(r => r.classList.remove('active-round'));
  const row = document.getElementById(`strip-row-${idx}`);
  if (row) row.classList.add('active-round');
}

// ── FINAL PHASE ──
socket.on('final_phase', ({ gameRound, picks, questions, faces }) => {
  _finalSubmitted = false;
  _finalChanges = 0;
  finalSelectedCard = null;
  finalPicks = { ...(picks[myName] || {}) };
  finalOppPicks = { ...(picks[oppName] || {}) };

  showGenericPopup(`FINAL CHANCE\nROUND ${gameRound + 1}`, () => {
    show('screen-final');
    renderFinalPhase(questions, faces);
    startTimer('final-timer-fill', 25, submitFinal);
  });
});

function renderFinalPhase(questions, faces) {
  const myRow = document.getElementById('final-my-cards');
  myRow.innerHTML = '';
  faces.forEach((face, i) => {
    const roundKey = parseInt(Object.keys(finalPicks).find(r => finalPicks[r] === i));
    const name = !isNaN(roundKey) ? answerName(questions[roundKey]) : '—';
    const col = document.createElement('div');
    col.className = 'final-card-col';
    col.innerHTML = `
      <div class="final-card-img"><img src="${cardImg(face)}" alt="${face.name}"></div>
      <button class="final-name-btn" id="fcb-${i}" onclick="tapFinalCard(${i})">${name}</button>
    `;
    myRow.appendChild(col);
  });

  document.getElementById('final-opp-label').textContent = `${oppName.toUpperCase()}'S CHOICES`;
  const oppRow = document.getElementById('final-opp-cards');
  oppRow.innerHTML = '';
  faces.forEach((face, i) => {
    const roundKey = parseInt(Object.keys(finalOppPicks).find(r => finalOppPicks[r] === i));
    const name = !isNaN(roundKey) ? answerName(questions[roundKey]) : '—';
    const col = document.createElement('div');
    col.className = 'final-card-col';
    col.innerHTML = `
      <div class="final-card-img"><img src="${cardImg(face)}" alt="${face.name}"></div>
      <div class="final-name-btn opp-name-btn">${name}</div>
    `;
    oppRow.appendChild(col);
  });
}

function answerName(q) { return (q || '').split(',')[0].trim(); }

function tapFinalCard(faceIndex) {
  if (finalSelectedCard === null) {
    finalSelectedCard = faceIndex;
    document.querySelectorAll('.final-name-btn:not(.opp-name-btn)').forEach(b => b.classList.remove('selected'));
    const btn = document.getElementById(`fcb-${faceIndex}`);
    if (btn) btn.classList.add('selected');
  } else {
    if (finalSelectedCard === faceIndex) {
      finalSelectedCard = null;
      document.querySelectorAll('.final-name-btn').forEach(b => b.classList.remove('selected'));
      return;
    }
    swapFinalCards(finalSelectedCard, faceIndex);
    finalSelectedCard = null;
    document.querySelectorAll('.final-name-btn').forEach(b => b.classList.remove('selected'));
  }
}

function swapFinalCards(faceA, faceB) {
  const roundA = parseInt(Object.keys(finalPicks).find(r => finalPicks[r] === faceA));
  const roundB = parseInt(Object.keys(finalPicks).find(r => finalPicks[r] === faceB));
  if (!isNaN(roundA)) finalPicks[roundA] = faceB;
  if (!isNaN(roundB)) finalPicks[roundB] = faceA;
  _finalChanges++;
  const btnA = document.getElementById(`fcb-${faceA}`);
  const btnB = document.getElementById(`fcb-${faceB}`);
  if (btnA && btnB) {
    const t = btnA.textContent; btnA.textContent = btnB.textContent; btnB.textContent = t;
    [btnA, btnB].forEach(b => { b.classList.add('swapped'); setTimeout(() => b.classList.remove('swapped'), 400); });
  }
}

function submitFinal() {
  if (_finalSubmitted) return;
  _finalSubmitted = true;
  stopTimer();
  document.getElementById('status-bar').textContent = 'LOCKED IN — WAITING FOR OPPONENT…';
  socket.emit('submit_final', { picks: finalPicks, changes: _finalChanges });
  _finalChanges = 0;
}

// ── ROUND RESULT ──
socket.on('round_result', ({ gameRound, roundScores, totalScores, changes, results, faces }) => {
  stopTimer();

  const myRoundScore  = roundScores[myName]  || 0;
  const oppRoundScore = roundScores[oppName] || 0;
  const myTotal  = totalScores[myName]  || 0;
  const oppTotal = totalScores[oppName] || 0;
  const myChanges  = changes[myName]  || 0;
  const oppChanges = changes[oppName] || 0;

  // Update header scores
  document.getElementById('hdr-my-score').textContent  = myTotal;
  document.getElementById('hdr-opp-score').textContent = oppTotal;

  const myHex  = myColour === 'red' ? '#e53e3e' : '#3182ce';
  const oppHex = myColour === 'red' ? '#3182ce' : '#e53e3e';

  // Bluff popup first
  const bluffText = `${myName.toUpperCase()} made ${myChanges} change${myChanges !== 1 ? 's' : ''}.\n${oppName.toUpperCase()} made ${oppChanges} change${oppChanges !== 1 ? 's' : ''}.\n\nWho blinked?`;

  showGenericPopup(bluffText, () => {
    // Round scores popup
    const isLastRound = gameRound === 1;
    const scoreText = isLastRound
      ? `FINAL SCORE\n${myName.toUpperCase()} ${myTotal} — ${oppTotal} ${oppName.toUpperCase()}`
      : `ROUND ${gameRound + 1}\n${myName.toUpperCase()} ${myRoundScore} — ${oppRoundScore} ${oppName.toUpperCase()}\nTotal: ${myTotal} — ${oppTotal}`;

    showGenericPopup(scoreText, () => {
      if (isLastRound) {
        // Stay on game screen — game_over will come shortly
        show('screen-game');
      } else {
        // Round 2 coming — go back to game screen
        show('screen-game');
        usedFaces = new Set(); // reset for round 2
        renderStrip(3);
      }
    });
  });
});

// ── GAME OVER ──
socket.on('game_over', ({ scores, results, changes, faces }) => {
  stopMusic();
  const myScore  = scores[myName]  || 0;
  const oppScore = scores[oppName] || 0;
  const myChanges  = changes ? (changes[myName]  || 0) : 0;
  const oppChanges = changes ? (changes[oppName] || 0) : 0;
  const myResults  = results[myName]  || {};
  const oppResults = results[oppName] || {};
  const won  = myScore > oppScore;
  const draw = myScore === oppScore;
  const myHex  = myColour === 'red' ? '#e53e3e' : '#3182ce';
  const oppHex = myColour === 'red' ? '#3182ce' : '#e53e3e';

  show('screen-result');
  document.getElementById('result-verdict').textContent = '';
  document.getElementById('result-scores').textContent = '';

  const makeRow = (name, playerResults, colour) => {
    const cards = Object.keys(playerResults).sort((a,b) => a-b).map(round => {
      const r = playerResults[round];
      const face = (faces || [])[r.picked];
      const correctFace = (faces || [])[r.correct];
      if (!face) return '';
      return `
        <div class="result-card-col">
          <div class="result-card-img ${r.right ? 'correct' : 'wrong'}">
            <img src="${cardImg(face)}" alt="${face.name}">
            <div class="result-card-icon">${r.right ? '✓' : '✗'}</div>
          </div>
          <div class="result-card-name ${r.right ? 'name-correct' : 'name-wrong'}">${face.name}</div>
          ${!r.right && correctFace ? `<div class="result-card-answer">✓ ${correctFace.name}</div>` : ''}
        </div>`;
    }).join('');
    const score = Object.values(playerResults).filter(r => r.right).length;
    return `
      <div class="result-player-section">
        <h3 class="result-player-name" style="color:${colour}">${name.toUpperCase()} — ${score}/6</h3>
        <div class="result-cards-row">${cards}</div>
      </div>`;
  };

  document.getElementById('result-breakdown').innerHTML =
    makeRow(myName, myResults, myHex) +
    makeRow(oppName, oppResults, oppHex);

  setTimeout(() => {
    const winText = won  ? `🏆 ${myName.toUpperCase()} WINS!` :
                    draw ? `IT'S A DRAW!` :
                           `🏆 ${oppName.toUpperCase()} WINS!`;
    showGenericPopup(winText, () => {
      if (won) launchFireworks();
      const v = document.getElementById('result-verdict');
      v.textContent = won ? 'YOU WIN' : draw ? 'DRAW' : 'YOU LOSE';
      v.className   = won ? 'win'     : draw ? 'draw' : 'lose';
    });
  }, 10000);
});

function shareResult() {
  const msg = `Come play TELL with me 👀 ${location.origin}`;
  if (navigator.share) navigator.share({ title: 'TELL', text: msg, url: location.origin });
  else { navigator.clipboard.writeText(msg); alert('Link copied!'); }
}

socket.on('opponent_left', () => { alert('Opponent disconnected. You win!'); location.href = location.origin; });

// ── TIMER ──
function startTimer(fillId, seconds, onExpire) {
  stopTimer();
  const fill = document.getElementById(fillId);
  if (!fill) return;
  let ticks = seconds * 10; const total = ticks;
  fill.style.width = '100%'; fill.style.background = '#D4A843';
  timerInterval = setInterval(() => {
    ticks--;
    const pct = (ticks / total) * 100;
    fill.style.width = pct + '%';
    if (pct < 40) { fill.style.background = '#e53e3e'; if (ticks % 10 === 0 && ticks > 0) beep(); }
    else fill.style.background = '#D4A843';
    if (ticks <= 0) { stopTimer(); onExpire(); }
  }, 100);
}
function stopTimer() { if (timerInterval) { clearInterval(timerInterval); timerInterval = null; } }

// ── AUDIO ENGINE ──
let _audioCtx = null;
function getAudioCtx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
}
function beep() {
  try {
    const ctx = getAudioCtx(), osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.08);
  } catch(e) {}
}
function boxingBell() {
  try { const ctx = getAudioCtx(), t = ctx.currentTime; ringBell(ctx,t); ringBell(ctx,t+0.6); ringBell(ctx,t+1.2); } catch(e) {}
}
function ringBell(ctx, st) {
  [440,880,1320,2200].forEach((freq,i) => {
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type='sine'; osc.frequency.value=freq;
    const vol=[0.4,0.3,0.15,0.08][i];
    gain.gain.setValueAtTime(vol,st); gain.gain.exponentialRampToValueAtTime(0.001,st+1.8);
    osc.start(st); osc.stop(st+1.8);
  });
}

// ── POPUPS ──
function showRoundPopup(label, callback) { boxingBell(); showPopupText(label, '44px', 1800, callback); }
function showGenericPopup(text, callback) { showPopupText(text, '26px', 3000, callback); }

function showPopupText(text, fontSize, duration, callback) {
  const popup = document.getElementById('popup-letsplay');
  const textEl = popup.querySelector('.popup-text');
  const img = popup.querySelector('img');
  img.style.display = 'none';
  textEl.textContent = text; textEl.style.fontSize = fontSize;
  textEl.style.whiteSpace = 'pre-line'; textEl.style.textAlign = 'center';
  popup.classList.add('show');
  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return; dismissed = true;
    popup.onclick = null;
    popup.classList.remove('show');
    img.style.display = ''; textEl.style.fontSize = ''; textEl.style.whiteSpace = '';
    setTimeout(() => { playPendingAudio(); if (callback) callback(); }, 300);
  };
  popup.onclick = dismiss;
  setTimeout(dismiss, duration);
}

// ── SCREEN ──
function show(id) { document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id)); }

// ── FIREWORKS ──
function launchFireworks() {
  const canvas = document.getElementById('fireworks-canvas');
  canvas.style.display = 'block'; canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d'), particles = [], colours = ['#e53e3e','#D4A843','#3182ce','#27ae60','#9b59b6'];
  function burst(x,y) { for(let i=0;i<80;i++){const a=Math.random()*Math.PI*2,s=Math.random()*6+2; particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,alpha:1,colour:colours[Math.floor(Math.random()*colours.length)],size:Math.random()*4+2});} }
  let bursts=0; const bi=setInterval(()=>{burst(Math.random()*canvas.width,Math.random()*canvas.height*0.6);if(++bursts>=6)clearInterval(bi);},400);
  function frame(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.x+=p.vx;p.y+=p.vy;p.vy+=0.15;p.alpha-=0.018;if(p.alpha<=0){particles.splice(i,1);continue;}ctx.globalAlpha=p.alpha;ctx.fillStyle=p.colour;ctx.beginPath();ctx.arc(p.x,p.y,p.size,0,Math.PI*2);ctx.fill();}
    ctx.globalAlpha=1;
    if(particles.length>0||bursts<6)requestAnimationFrame(frame);else canvas.style.display='none';
  }
  frame();
}