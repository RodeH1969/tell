// ── TELL client.js v4 ──

const socket = io();

// ── STATE ──
let myName = '', oppName = '';
let gameData = null;
let myPicks = {};
let oppPicks = {};
let currentRound = 0;
let timerInterval = null;
let pickedThisRound = false;
let finalSelectedQ = null;
let finalPicks = {};

// Read room code immediately — do NOT wait for splash timeout
const _urlParams = new URLSearchParams(window.location.search);
let roomCode = _urlParams.get('room') || '';

// ── SPLASH → correct screen ──
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

// ── ENABLE BUTTONS ──
document.getElementById('input-creator-name').addEventListener('input', function() {
  document.getElementById('btn-challenge').disabled = !this.value.trim();
});
document.getElementById('input-joiner-name').addEventListener('input', function() {
  document.getElementById('btn-join').disabled = !this.value.trim();
});
document.getElementById('input-creator-name').addEventListener('keydown', e => { if (e.key === 'Enter') createGame(); });
document.getElementById('input-joiner-name').addEventListener('keydown', e => { if (e.key === 'Enter') joinGame(); });

// ── CREATE GAME ──
function createGame() {
  myName = document.getElementById('input-creator-name').value.trim();
  if (!myName) return;
  socket.emit('create_room', { name: myName });
}

socket.on('room_created', ({ code }) => {
  roomCode = code;
  window._inviteLink = `${location.origin}?room=${code}`;
  show('screen-waiting');
});

// ── JOIN GAME ──
function joinGame() {
  myName = document.getElementById('input-joiner-name').value.trim();
  if (!myName || !roomCode) return;
  document.getElementById('btn-join').disabled = true;
  document.getElementById('btn-join').textContent = 'JOINING…';
  socket.emit('join_room', { name: myName, code: roomCode });
}

socket.on('join_error', ({ message }) => {
  const errEl = document.getElementById('join-error-msg');
  if (errEl) {
    errEl.textContent = message === 'Room not found.'
      ? 'Room not found. The link may have expired — ask your opponent to create a new game.'
      : message;
    errEl.classList.remove('hidden');
  }
  document.getElementById('btn-join').disabled = false;
  document.getElementById('btn-join').textContent = 'TRY AGAIN';
});

// ── SHARE INVITE ──
function shareInvite() {
  const link = window._inviteLink;
  const showWaiting = () => {
    // Hide the share button, show waiting state
    document.querySelector('.share-invite-btn').classList.add('hidden');
    document.getElementById('waiting-status').classList.remove('hidden');
  };
  if (navigator.share) {
    navigator.share({ title: 'TELL', text: 'I challenge you to a game of TELL 👀', url: link })
      .then(showWaiting)
      .catch(() => showWaiting());
  } else {
    navigator.clipboard.writeText(link).then(() => {
      alert('Link copied! Send it to your opponent.');
      showWaiting();
    });
  }
}

// ── GAME START ──
socket.on('game_start', ({ myName: mn, oppName: on, game }) => {
  myName = mn;
  oppName = on;
  gameData = game;
  myPicks = {};
  oppPicks = {};

  show('screen-game');
  document.getElementById('hdr-my-name').textContent = myName.toUpperCase();
  document.getElementById('hdr-opp-name').textContent = oppName.toUpperCase();
  document.getElementById('strip-my-name').textContent = myName.toUpperCase();
  document.getElementById('strip-opp-name').textContent = oppName.toUpperCase();

  // Render cards showing FRONT (logo side) — locked
  renderCards('faces-row', 'front');
  renderStrip();

  // After 1s show popup, then flip cards to back (faces)
  setTimeout(showLetsPlay, 1000);
});

// ── LETS PLAY POPUP ──
function showLetsPlay() {
  const popup = document.getElementById('popup-letsplay');
  popup.classList.remove('hidden');
  requestAnimationFrame(() => popup.classList.add('show'));

  setTimeout(() => {
    popup.classList.remove('show');
    setTimeout(() => {
      popup.classList.add('hidden');
      flipCardsToFace();
    }, 350);
  }, 2500);
}

// ── FLIP CARDS: swap src from front to back one by one ──
function flipCardsToFace() {
  const cards = document.querySelectorAll('#faces-row .face-card');
  cards.forEach((card, i) => {
    setTimeout(() => {
      const img = card.querySelector('img');
      const backFile = gameData.faces[i].back;
      card.classList.add('flipping');
      setTimeout(() => {
        img.src = `/data/Game%201%20Cards/${encodeURIComponent(backFile)}`;
        card.classList.remove('flipping');
        card.classList.add('face-up');
      }, 350);
    }, i * 450);
  });
}

// ── RENDER CARDS ──
function renderCards(containerId, side = 'front') {
  const row = document.getElementById(containerId);
  row.innerHTML = '';
  gameData.faces.forEach((face, i) => {
    const card = document.createElement('div');
    card.className = 'face-card locked';
    card.dataset.index = i;
    const imgFile = side === 'front' ? face.front : face.back;
    card.innerHTML = `
      <img src="/data/Game%201%20Cards/${encodeURIComponent(imgFile)}" alt="${face.name}">
      <div class="face-num">${i + 1}</div>
    `;
    card.addEventListener('click', () => handleCardClick(i, containerId));
    row.appendChild(card);
  });
}

function handleCardClick(index, containerId) {
  if (containerId === 'faces-row') {
    if (pickedThisRound) return;
    const card = document.querySelector(`#faces-row .face-card[data-index="${index}"]`);
    if (card && card.classList.contains('locked') && !card.classList.contains('face-up')) return;
    submitPick(index);
  } else if (containerId === 'final-faces-row') {
    handleFinalFacePick(index);
  }
}

// ── ROUND START ──
socket.on('round_start', ({ round, totalRounds, question }) => {
  currentRound = round;
  pickedThisRound = false;

  document.getElementById('hdr-round').textContent = `${round} / ${totalRounds}`;
  document.getElementById('status-bar').textContent = '';

  // Clear question until popup closes
  document.getElementById('question-text').textContent = '';

  // Lock cards during popup
  document.querySelectorAll('#faces-row .face-card').forEach(c => {
    c.classList.remove('my-pick','opp-pick','both-pick');
    c.classList.add('locked');
  });

  highlightActiveSlot(round);

  // Show TELL 1 / TELL 2 etc popup with bell, then start round
  showRoundPopup(round, () => {
    document.getElementById('question-text').textContent = question;

    // Unlock cards
    document.querySelectorAll('#faces-row .face-card').forEach(c => {
      c.classList.remove('locked');
    });

    startTimer('timer-fill', 15, () => {
      if (!pickedThisRound) submitPick(0);
    });
  });
});

// ── SUBMIT PICK ──
function submitPick(faceIndex) {
  pickedThisRound = true;
  stopTimer();
  myPicks[currentRound] = faceIndex;

  document.querySelectorAll('#faces-row .face-card').forEach((c, i) => {
    c.classList.toggle('my-pick', i === faceIndex);
    c.classList.add('locked');
  });

  document.getElementById('status-bar').textContent = 'WAITING FOR OPPONENT…';
  socket.emit('submit_pick', { faceIndex });
}

// ── LIVE PICK ──
socket.on('pick_made', ({ byMe, faceIndex }) => {
  if (!byMe) {
    document.querySelectorAll('#faces-row .face-card').forEach((c, i) => {
      if (i === faceIndex) {
        if (c.classList.contains('my-pick')) c.classList.add('both-pick');
        else c.classList.add('opp-pick');
      }
    });
  }
});

// ── ROUND REVEAL ──
socket.on('round_reveal', ({ round, myPicks: mp, oppPicks: op }) => {
  myPicks = mp;
  oppPicks = op;
  stopTimer();
  document.getElementById('status-bar').textContent = '';
  revealStripRow(round, myPicks, oppPicks);
});

function countCorrect(picks) {
  if (!gameData) return 0;
  let c = 0;
  gameData.questions.forEach((q, i) => { if (picks[i + 1] === q.answerIndex) c++; });
  return c;
}

// ── UNIFIED STRIP ──
function renderStrip() {
  const strip = document.getElementById('answer-strip');
  strip.innerHTML = '';
  for (let i = 1; i <= 5; i++) {
    const row = document.createElement('div');
    row.className = 'strip-row';
    row.id = `strip-row-${i}`;
    row.innerHTML = `
      <div class="strip-cell strip-cell-left" id="strip-me-${i}">
        <div class="strip-thumb"></div>
      </div>
      <div class="strip-cell strip-cell-mid" id="strip-name-${i}">
        <span class="strip-qnum">Q${i}</span>
      </div>
      <div class="strip-cell strip-cell-right" id="strip-opp-${i}">
        <div class="strip-thumb"></div>
      </div>
    `;
    strip.appendChild(row);
  }
}

function revealStripRow(round, myPicks, oppPicks) {
  // Middle: reveal the question name
  const q = gameData.questions[round - 1];
  const answerFace = gameData.faces[q.answerIndex];
  const midEl = document.getElementById(`strip-name-${round}`);
  if (midEl) {
    midEl.innerHTML = `<span class="strip-answer-name">${answerFace.name}</span>`;
    midEl.classList.add('slot-drop');
  }

  // Left: my pick for this round
  const myFaceIdx = myPicks[round];
  const myEl = document.getElementById(`strip-me-${round}`);
  if (myEl && myFaceIdx !== undefined) {
    const face = gameData.faces[myFaceIdx];
    myEl.querySelector('.strip-thumb').innerHTML = `<img src="/data/Game%201%20Cards/${encodeURIComponent(face.back)}" alt="${face.name}">`;
    myEl.querySelector('.strip-thumb').title = face.name;
  }

  // Right: opponent's pick for this round
  const oppFaceIdx = oppPicks[round];
  const oppEl = document.getElementById(`strip-opp-${round}`);
  if (oppEl && oppFaceIdx !== undefined) {
    const face = gameData.faces[oppFaceIdx];
    oppEl.querySelector('.strip-thumb').innerHTML = `<img src="/data/Game%201%20Cards/${encodeURIComponent(face.back)}" alt="${face.name}">`;
    oppEl.querySelector('.strip-thumb').title = face.name;
  }
}

function highlightActiveSlot(round) {
  document.querySelectorAll('.strip-row').forEach(r => r.classList.remove('active-round'));
  const row = document.getElementById(`strip-row-${round}`);
  if (row) row.classList.add('active-round');
}

// ── FINAL PHASE ──
socket.on('final_phase', ({ myPicks: mp, oppPicks: op, questions }) => {
  myPicks = mp;
  oppPicks = op;
  finalPicks = { ...mp };
  finalSelectedQ = null;
  show('screen-final');
  renderCards('final-faces-row', 'back');
  document.querySelectorAll('#final-faces-row .face-card').forEach(c => c.classList.add('locked'));
  renderFinalQuestions(questions);
  startTimer('final-timer-fill', 15, submitFinal);
});

function renderFinalQuestions(questions) {
  const list = document.getElementById('final-questions-list');
  list.innerHTML = '';
  questions.forEach((q, i) => {
    const round = i + 1;
    const pick = finalPicks[round];
    const face = pick !== undefined ? gameData.faces[pick] : null;
    const row = document.createElement('div');
    row.className = 'final-q-row';
    row.id = `fq-${round}`;
    row.innerHTML = `
      <span class="fq-num">Q${round}</span>
      <div class="fq-thumb">${face ? `<img src="/data/Game%201%20Cards/${encodeURIComponent(face.back)}" alt="${face.name}">` : ''}</div>
      <span class="fq-text">${q}</span>
      <span class="fq-change">CHANGE</span>
    `;
    row.addEventListener('click', () => selectFinalQuestion(round));
    list.appendChild(row);
  });
}

function selectFinalQuestion(round) {
  finalSelectedQ = round;
  document.querySelectorAll('.final-q-row').forEach(r => r.classList.remove('selected'));
  document.getElementById(`fq-${round}`).classList.add('selected');
  document.querySelectorAll('#final-faces-row .face-card').forEach((c, i) => {
    c.classList.remove('locked','my-pick','final-select-target');
    if (finalPicks[round] === i) c.classList.add('my-pick');
    else c.classList.add('final-select-target');
  });
}

function handleFinalFacePick(index) {
  if (finalSelectedQ === null) return;
  finalPicks[finalSelectedQ] = index;
  const face = gameData.faces[index];
  const row = document.getElementById(`fq-${finalSelectedQ}`);
  if (row) row.querySelector('.fq-thumb').innerHTML = `<img src="/data/Game%201%20Cards/${encodeURIComponent(face.back)}" alt="${face.name}">`;
  finalSelectedQ = null;
  document.querySelectorAll('.final-q-row').forEach(r => r.classList.remove('selected'));
  document.querySelectorAll('#final-faces-row .face-card').forEach(c => {
    c.classList.remove('my-pick','final-select-target');
    c.classList.add('locked');
  });
}

function submitFinal() {
  stopTimer();
  socket.emit('submit_final', { picks: finalPicks });
}

// ── GAME OVER ──
socket.on('game_over', ({ won, draw, myScore, oppScore, myName: mn, oppName: on, myResults, faces, questions }) => {
  show('screen-result');
  const verdict = document.getElementById('result-verdict');
  if (draw)     { verdict.textContent = 'DRAW';     verdict.className = 'draw'; }
  else if (won) { verdict.textContent = 'YOU WIN';  verdict.className = 'win'; launchFireworks(); }
  else          { verdict.textContent = 'YOU LOSE'; verdict.className = 'lose'; }

  document.getElementById('result-scores').innerHTML = `
    <div class="rs-player"><span class="rs-name">${mn.toUpperCase()}</span><span class="rs-num">${myScore}</span></div>
    <span class="rs-vs">VS</span>
    <div class="rs-player"><span class="rs-name">${on.toUpperCase()}</span><span class="rs-num">${oppScore}</span></div>
  `;

  document.getElementById('result-breakdown').innerHTML = questions.map((q, i) => {
    const round = i + 1;
    const r = myResults[round];
    const face = faces[r.picked];
    return `
      <div class="bd-row ${r.right ? 'correct' : 'wrong'}">
        <span class="bd-q">Q${round}</span>
        <div class="bd-thumb"><img src="/data/Game%201%20Cards/${encodeURIComponent(face.back)}" alt="${face.name}"></div>
        <span class="bd-name">${face.name}</span>
        <span class="bd-icon">${r.right ? '✓' : '✗'}</span>
      </div>
    `;
  }).join('');
});

function shareResult() {
  const msg = `Come play TELL with me 👀 ${location.origin}`;
  if (navigator.share) navigator.share({ title: 'TELL', text: msg, url: location.origin });
  else { navigator.clipboard.writeText(msg); alert('Link copied!'); }
}

socket.on('opponent_left', () => {
  alert('Opponent disconnected. You win!');
  location.href = location.origin;
});

// ── TIMER ──
function startTimer(fillId, seconds, onExpire) {
  stopTimer();
  const fill = document.getElementById(fillId);
  let ticks = seconds * 10;
  const total = ticks;
  fill.style.width = '100%';
  fill.style.background = 'var(--gold)';
  timerInterval = setInterval(() => {
    ticks--;
    const pct = (ticks / total) * 100;
    fill.style.width = pct + '%';
    if (pct < 40) {
      fill.style.background = 'var(--red)';
      // Beep every second in the last 6 seconds
      if (ticks % 10 === 0 && ticks > 0) beep();
    } else {
      fill.style.background = 'var(--gold)';
    }
    if (ticks <= 0) { stopTimer(); onExpire(); }
  }, 100);
}

// ── BEEP via Web Audio API ──
let _audioCtx = null;
function getAudioCtx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
}

function beep() {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.08);
  } catch(e) {}
}

// ── BOXING BELL ──
function boxingBell() {
  try {
    const ctx = getAudioCtx();
    const t = ctx.currentTime;

    // Strike 1
    ringBell(ctx, t);
    // Strike 2
    ringBell(ctx, t + 0.6);
    // Strike 3
    ringBell(ctx, t + 1.2);
  } catch(e) {}
}

function ringBell(ctx, startTime) {
  // Bell body — high metallic tone with long decay
  [440, 880, 1320, 2200].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = freq;
    const vol = [0.4, 0.3, 0.15, 0.08][i];
    gain.gain.setValueAtTime(vol, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 1.8);
    osc.start(startTime);
    osc.stop(startTime + 1.8);
  });
}

// ── ROUND POPUP ──
function showRoundPopup(round, callback) {
  boxingBell();
  const popup = document.getElementById('popup-letsplay');
  const text = popup.querySelector('.popup-text');
  const img = popup.querySelector('img');
  img.style.display = 'none';
  text.textContent = `TELL ${round}`;
  text.style.fontSize = '52px';
  text.style.letterSpacing = '0.06em';
  popup.classList.remove('hidden');
  requestAnimationFrame(() => popup.classList.add('show'));

  setTimeout(() => {
    popup.classList.remove('show');
    setTimeout(() => {
      popup.classList.add('hidden');
      img.style.display = '';
      text.style.fontSize = '';
      text.style.letterSpacing = '';
      if (callback) callback();
    }, 300);
  }, 1800);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

// ── SCREEN SWITCHER ──
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
}

// ── FIREWORKS ──
function launchFireworks() {
  const canvas = document.getElementById('fireworks-canvas');
  canvas.style.display = 'block';
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');
  const particles = [];
  const colours = ['#2D7A7A','#D4A843','#e75480','#27ae60','#3498db'];
  function burst(x, y) {
    for (let i = 0; i < 80; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 6 + 2;
      particles.push({ x, y, vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed, alpha: 1, colour: colours[Math.floor(Math.random()*colours.length)], size: Math.random()*4+2 });
    }
  }
  let bursts = 0;
  const bi = setInterval(() => { burst(Math.random()*canvas.width, Math.random()*canvas.height*0.6); if (++bursts >= 6) clearInterval(bi); }, 400);
  function frame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = particles.length-1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.15; p.alpha -= 0.018;
      if (p.alpha <= 0) { particles.splice(i,1); continue; }
      ctx.globalAlpha = p.alpha; ctx.fillStyle = p.colour;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (particles.length > 0 || bursts < 6) requestAnimationFrame(frame);
    else canvas.style.display = 'none';
  }
  frame();
}