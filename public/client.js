// ── TELL client.js v4 ──

const socket = io();

// ── STATE ──
let myName = '', oppName = '', roomCode = '';
let gameData = null;
let myPicks = {};
let oppPicks = {};
let currentRound = 0;
let timerInterval = null;
let pickedThisRound = false;
let finalSelectedQ = null;
let finalPicks = {};

// ── SPLASH → correct screen ──
window.addEventListener('load', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const codeFromUrl = urlParams.get('room');

  setTimeout(() => {
    if (codeFromUrl) {
      roomCode = codeFromUrl;
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
  alert(message);
  document.getElementById('btn-join').disabled = false;
  document.getElementById('btn-join').textContent = 'JOIN NOW';
});

// ── SHARE INVITE ──
function shareInvite() {
  const link = window._inviteLink;
  if (navigator.share) {
    navigator.share({ title: 'TELL', text: 'I challenge you to a game of TELL 👀', url: link });
  } else {
    navigator.clipboard.writeText(link).then(() => alert('Link copied! Send it to your opponent.'));
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
  renderSlots('slots-me');
  renderSlots('slots-opp');

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
      }, 200);
    }, i * 200);
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
  document.getElementById('question-text').textContent = question;
  document.getElementById('status-bar').textContent = '';

  highlightActiveSlot(round);

  // Unlock cards for clicking
  document.querySelectorAll('#faces-row .face-card').forEach(c => {
    c.classList.remove('my-pick','opp-pick','both-pick','locked');
  });

  startTimer('timer-fill', 10, () => {
    if (!pickedThisRound) submitPick(0);
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
  updateStrip('slots-me', myPicks, round);
  updateStrip('slots-opp', oppPicks, round);
  document.getElementById('hdr-my-score').textContent = countCorrect(myPicks);
  document.getElementById('hdr-opp-score').textContent = countCorrect(oppPicks);
});

function countCorrect(picks) {
  if (!gameData) return 0;
  let c = 0;
  gameData.questions.forEach((q, i) => { if (picks[i + 1] === q.answerIndex) c++; });
  return c;
}

// ── SLOTS ──
function renderSlots(containerId) {
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  for (let i = 1; i <= 5; i++) {
    const slot = document.createElement('div');
    slot.className = 'slot';
    slot.id = `${containerId}-q${i}`;
    slot.innerHTML = `<span class="slot-q">Q${i}</span><div class="slot-thumb"></div><span class="slot-name">—</span>`;
    el.appendChild(slot);
  }
}

function updateStrip(containerId, picks, highlightRound) {
  for (let i = 1; i <= 5; i++) {
    const slot = document.getElementById(`${containerId}-q${i}`);
    if (!slot || picks[i] === undefined) continue;
    slot.classList.remove('active-round');
    const face = gameData.faces[picks[i]];
    const isCorrect = picks[i] === gameData.questions[i - 1].answerIndex;
    slot.querySelector('.slot-thumb').innerHTML = `<img src="/data/Game%201%20Cards/${encodeURIComponent(face.back)}" alt="${face.name}">`;
    slot.querySelector('.slot-name').textContent = face.name;
    let tick = slot.querySelector('.slot-tick');
    if (!tick) { tick = document.createElement('span'); tick.className = 'slot-tick'; slot.appendChild(tick); }
    tick.textContent = isCorrect ? '✓' : '';
    slot.classList.add('slot-drop');
  }
  if (highlightRound && highlightRound <= 5) {
    const active = document.getElementById(`${containerId}-q${highlightRound}`);
    if (active) active.classList.add('active-round');
  }
}

function highlightActiveSlot(round) {
  document.querySelectorAll('.slot').forEach(s => s.classList.remove('active-round'));
  [`slots-me-q${round}`, `slots-opp-q${round}`].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('active-round');
  });
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
  startTimer('final-timer-fill', 10, submitFinal);
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
    if (pct < 30) fill.style.background = 'var(--red)';
    if (ticks <= 0) { stopTimer(); onExpire(); }
  }, 100);
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