// ── TELL client.js v2 ──

const socket = io();

// ── STATE ──
let myName = '', oppName = '', roomCode = '';
let gameData = null;          // full game object from server
let myPicks = {};             // round -> faceIndex
let oppPicks = {};            // round -> faceIndex
let currentRound = 0;
let timerInterval = null;
let pickedThisRound = false;

// Final phase state
let finalSelectedQ = null;    // which Q row is selected for reassignment
let finalPicks = {};          // working copy during final phase

// ── SPLASH → LOBBY ──
window.addEventListener('load', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const codeFromUrl = urlParams.get('room');

  setTimeout(() => {
    show('screen-lobby');
    if (codeFromUrl) {
      roomCode = codeFromUrl;
      showPanel('panel-join');
    }
  }, 4000);
});

// ── PANEL SWITCHING ──
function showPanel(id) {
  document.getElementById('lobby-main').classList.toggle('hidden', !!id);
  ['panel-create','panel-join'].forEach(p => {
    document.getElementById(p).classList.toggle('hidden', p !== id);
  });
  if (id) {
    const inp = id === 'panel-create'
      ? document.getElementById('input-create-name')
      : document.getElementById('input-join-name');
    setTimeout(() => inp.focus(), 60);
  }
}

// Enable buttons on input
document.getElementById('input-create-name').addEventListener('input', function() {
  document.getElementById('btn-create').disabled = !this.value.trim();
});
document.getElementById('input-join-name').addEventListener('input', function() {
  document.getElementById('btn-join').disabled = !this.value.trim();
});

// Enter key
['input-create-name','input-join-name'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      if (id === 'input-create-name') createGame();
      else joinGame();
    }
  });
});

// ── CREATE / JOIN ──
function createGame() {
  myName = document.getElementById('input-create-name').value.trim();
  if (!myName) return;
  socket.emit('create_room', { name: myName });
}

function joinGame() {
  myName = document.getElementById('input-join-name').value.trim();
  if (!myName || !roomCode) return;
  socket.emit('join_room', { name: myName, code: roomCode });
}

socket.on('room_created', ({ code }) => {
  roomCode = code;
  show('screen-waiting');
  const link = `${location.origin}?room=${code}`;
  document.getElementById('invite-link').textContent = link;
});

socket.on('join_error', ({ message }) => alert(message));

function copyLink() {
  const link = document.getElementById('invite-link').textContent;
  navigator.clipboard.writeText(link).then(() => {
    const btn = document.getElementById('copy-btn');
    btn.textContent = 'COPIED ✓';
    setTimeout(() => btn.textContent = 'COPY', 2200);
  });
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

  renderFaces('faces-row');
  renderSlots('slots-me');
  renderSlots('slots-opp');
});

// ── ROUND START ──
socket.on('round_start', ({ round, totalRounds, question }) => {
  currentRound = round;
  pickedThisRound = false;

  document.getElementById('hdr-round').textContent = `${round} / ${totalRounds}`;
  document.getElementById('question-text').textContent = question;
  document.getElementById('status-bar').textContent = '';

  // Mark active slot
  highlightActiveSlot(round);

  // Unlock face cards
  document.querySelectorAll('#faces-row .face-card').forEach(c => {
    c.classList.remove('locked','my-pick','opp-pick','both-pick','correct');
  });

  startTimer('timer-fill', 10, () => {
    if (!pickedThisRound) submitPick(0); // default face 1
  });
});

// ── FACE SELECTION ──
function renderFaces(containerId) {
  const row = document.getElementById(containerId);
  row.innerHTML = '';
  gameData.faces.forEach((face, i) => {
    const card = document.createElement('div');
    card.className = 'face-card';
    card.dataset.index = i;
    card.innerHTML = `
      <img src="/data/Game1/${encodeURIComponent(face.file)}" alt="${face.name}">
      <div class="face-num">${i + 1}</div>
    `;
    card.addEventListener('click', () => handleFaceClick(i, containerId));
    row.appendChild(card);
  });
}

function handleFaceClick(index, containerId) {
  if (containerId === 'faces-row') {
    if (pickedThisRound) return;
    submitPick(index);
  } else if (containerId === 'final-faces-row') {
    handleFinalFacePick(index);
  }
}

function submitPick(faceIndex) {
  pickedThisRound = true;
  stopTimer();
  myPicks[currentRound] = faceIndex;

  // Highlight my pick
  document.querySelectorAll('#faces-row .face-card').forEach((c, i) => {
    c.classList.toggle('my-pick', i === faceIndex);
    c.classList.add('locked');
  });

  document.getElementById('status-bar').textContent = 'WAITING FOR OPPONENT…';
  socket.emit('submit_pick', { faceIndex });
}

// ── LIVE PICK NOTIFICATION ──
socket.on('pick_made', ({ round, byMe, faceIndex }) => {
  if (!byMe) {
    // Opponent picked — show their pick on faces
    document.querySelectorAll('#faces-row .face-card').forEach((c, i) => {
      if (i === faceIndex) {
        if (c.classList.contains('my-pick')) {
          c.classList.add('both-pick');
        } else {
          c.classList.add('opp-pick');
        }
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

  // Update answer strips
  updateStrip('slots-me', myPicks, round);
  updateStrip('slots-opp', oppPicks, round);

  // Update scores visually (count correct so far — server will confirm at end)
  // For now just show picks count
  document.getElementById('hdr-my-score').textContent = countCorrectSoFar(myPicks);
  document.getElementById('hdr-opp-score').textContent = countCorrectSoFar(oppPicks);
});

function countCorrectSoFar(picks) {
  if (!gameData) return 0;
  let c = 0;
  gameData.questions.forEach((q, i) => {
    if (picks[i+1] === q.answerIndex) c++;
  });
  return c;
}

// ── SLOTS ──
function renderSlots(containerId) {
  const slots = document.getElementById(containerId);
  slots.innerHTML = '';
  for (let i = 1; i <= 5; i++) {
    const slot = document.createElement('div');
    slot.className = 'slot';
    slot.id = `${containerId}-q${i}`;
    slot.innerHTML = `<span class="slot-q">Q${i}</span><div class="slot-thumb"></div><span class="slot-name">—</span>`;
    slots.appendChild(slot);
  }
}

function updateStrip(containerId, picks, highlightRound) {
  for (let i = 1; i <= 5; i++) {
    const slot = document.getElementById(`${containerId}-q${i}`);
    if (!slot) continue;
    slot.classList.remove('active-round');

    if (picks[i] !== undefined) {
      const face = gameData.faces[picks[i]];
      const isCorrect = picks[i] === gameData.questions[i-1].answerIndex;
      const thumb = slot.querySelector('.slot-thumb');
      const name  = slot.querySelector('.slot-name');
      const tick  = slot.querySelector('.slot-tick');

      thumb.innerHTML = `<img src="/data/Game1/${encodeURIComponent(face.file)}" alt="${face.name}">`;
      name.textContent = face.name;

      if (!tick) {
        const t = document.createElement('span');
        t.className = 'slot-tick';
        slot.appendChild(t);
      }
      slot.querySelector('.slot-tick').textContent = isCorrect ? '✓' : '';
      slot.classList.add('slot-drop');
    }
  }
  if (highlightRound && highlightRound <= 5) {
    const active = document.getElementById(`${containerId}-q${highlightRound}`);
    if (active) active.classList.add('active-round');
  }
}

function highlightActiveSlot(round) {
  document.querySelectorAll('.slot').forEach(s => s.classList.remove('active-round'));
  const me  = document.getElementById(`slots-me-q${round}`);
  const opp = document.getElementById(`slots-opp-q${round}`);
  if (me)  me.classList.add('active-round');
  if (opp) opp.classList.add('active-round');
}

// ── FINAL PHASE ──
socket.on('final_phase', ({ myPicks: mp, oppPicks: op, questions }) => {
  myPicks = mp;
  oppPicks = op;
  finalPicks = { ...mp };
  finalSelectedQ = null;

  show('screen-final');
  renderFaces('final-faces-row');

  // Lock final face row initially
  document.querySelectorAll('#final-faces-row .face-card').forEach(c => c.classList.add('locked'));

  renderFinalQuestions(questions);

  startTimer('final-timer-fill', 10, () => {
    submitFinal();
  });
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
      <div class="fq-thumb">${face ? `<img src="/data/Game1/${encodeURIComponent(face.file)}" alt="${face.name}">` : ''}</div>
      <span class="fq-text">${q}</span>
      <span class="fq-change">TAP TO CHANGE</span>
    `;
    row.addEventListener('click', () => selectFinalQuestion(round));
    list.appendChild(row);
  });
}

function selectFinalQuestion(round) {
  finalSelectedQ = round;

  // Highlight selected row
  document.querySelectorAll('.final-q-row').forEach(r => r.classList.remove('selected'));
  document.getElementById(`fq-${round}`).classList.add('selected');

  // Unlock face cards for picking
  document.querySelectorAll('#final-faces-row .face-card').forEach((c, i) => {
    c.classList.remove('locked','my-pick','final-select-target');
    if (finalPicks[round] === i) c.classList.add('my-pick');
    else c.classList.add('final-select-target');
  });
}

function handleFinalFacePick(index) {
  if (finalSelectedQ === null) return;

  finalPicks[finalSelectedQ] = index;

  // Update thumb in row
  const face = gameData.faces[index];
  const row = document.getElementById(`fq-${finalSelectedQ}`);
  if (row) {
    row.querySelector('.fq-thumb').innerHTML = `<img src="/data/Game1/${encodeURIComponent(face.file)}" alt="${face.name}">`;
  }

  // Update face highlights
  document.querySelectorAll('#final-faces-row .face-card').forEach((c, i) => {
    c.classList.remove('my-pick','final-select-target','locked');
    if (i === index) c.classList.add('my-pick');
    else c.classList.add('final-select-target');
  });

  finalSelectedQ = null;
  document.querySelectorAll('.final-q-row').forEach(r => r.classList.remove('selected'));
  document.querySelectorAll('#final-faces-row .face-card').forEach(c => {
    c.classList.remove('final-select-target');
    c.classList.add('locked');
  });
}

function submitFinal() {
  stopTimer();
  socket.emit('submit_final', { picks: finalPicks });
  document.getElementById('final-timer-fill').style.width = '0%';
}

// ── GAME OVER ──
socket.on('game_over', ({ won, draw, myScore, oppScore, myName: mn, oppName: on, myResults, oppResults, faces, questions }) => {
  show('screen-result');

  // Verdict
  const verdict = document.getElementById('result-verdict');
  if (draw)      { verdict.textContent = 'DRAW';   verdict.className = 'draw'; }
  else if (won)  { verdict.textContent = 'YOU WIN'; verdict.className = 'win'; launchFireworks(); playSound('snd-win'); }
  else           { verdict.textContent = 'YOU LOSE'; verdict.className = 'lose'; playSound('snd-lose'); }

  // Scores
  document.getElementById('result-scores').innerHTML = `
    <div class="rs-player">
      <span class="rs-name">${mn.toUpperCase()}</span>
      <span class="rs-num">${myScore}</span>
    </div>
    <span class="rs-vs">VS</span>
    <div class="rs-player">
      <span class="rs-name">${on.toUpperCase()}</span>
      <span class="rs-num">${oppScore}</span>
    </div>
  `;

  // Breakdown
  const bd = document.getElementById('result-breakdown');
  bd.innerHTML = questions.map((q, i) => {
    const round = i + 1;
    const r = myResults[round];
    const face = faces[r.picked];
    return `
      <div class="bd-row ${r.right ? 'correct' : 'wrong'}">
        <span class="bd-q">Q${round}</span>
        <div class="bd-thumb"><img src="/data/Game1/${encodeURIComponent(face.file)}" alt="${face.name}"></div>
        <span class="bd-name">${face.name}</span>
        <span class="bd-icon">${r.right ? '✓' : '✗'}</span>
      </div>
    `;
  }).join('');
});

function shareResult() {
  const msg = `Come play TELL with me 👀 ${location.origin}`;
  if (navigator.share) {
    navigator.share({ title: 'TELL', text: msg, url: location.origin });
  } else {
    navigator.clipboard.writeText(msg);
    alert('Link copied!');
  }
}

// ── OPPONENT LEFT ──
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

    // Gets red + plays sounds as it heats up
    if (pct < 30) {
      fill.style.background = 'var(--red)';
      if (ticks % 5 === 0) playSound('snd-tick');
    } else if (pct < 60) {
      fill.style.background = 'var(--gold)';
    }

    if (ticks <= 0) {
      stopTimer();
      onExpire();
    }
  }, 100);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

// ── SCREEN SWITCHER ──
function show(id) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.toggle('active', s.id === id);
  });
}

// ── AUDIO ──
function playSound(id) {
  try {
    const el = document.getElementById(id);
    if (el) { el.currentTime = 0; el.play().catch(() => {}); }
  } catch(e) {}
}

// ── FIREWORKS ──
function launchFireworks() {
  const canvas = document.getElementById('fireworks-canvas');
  canvas.style.display = 'block';
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');

  const particles = [];
  const colours = ['#2D7A7A','#D4A843','#e75480','#27ae60','#3498db','#f39c12'];

  function burst(x, y) {
    for (let i = 0; i < 80; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 6 + 2;
      particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        alpha: 1,
        colour: colours[Math.floor(Math.random() * colours.length)],
        size: Math.random() * 4 + 2
      });
    }
  }

  let bursts = 0;
  const burstInterval = setInterval(() => {
    burst(Math.random() * canvas.width, Math.random() * canvas.height * 0.6);
    bursts++;
    if (bursts >= 6) clearInterval(burstInterval);
  }, 400);

  function frame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x  += p.vx;
      p.y  += p.vy;
      p.vy += 0.15;
      p.alpha -= 0.018;
      if (p.alpha <= 0) { particles.splice(i, 1); continue; }
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.colour;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (particles.length > 0 || bursts < 6) requestAnimationFrame(frame);
    else canvas.style.display = 'none';
  }
  frame();
}