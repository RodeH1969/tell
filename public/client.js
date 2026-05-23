// ── TELL client.js v6 ──

const socket = io({
  reconnection: true,
  reconnectionDelay: 500,
  reconnectionAttempts: 10
});

socket.on('reconnect', () => {
  console.log('Reconnected, roomCode=', roomCode, 'myName=', myName);
  if (roomCode && !gameData && myName) {
    // Could be creator waiting or joiner — try rejoin first
    socket.emit('rejoin_room', { code: roomCode, name: myName });
    // If that fails (not creator), try join
    setTimeout(() => {
      if (!gameData) socket.emit('join_room', { name: myName, code: roomCode });
    }, 500);
  }
});

// ── THEME MUSIC ──
let _music = null;
function startMusic() {
  if (_music) return;
  _music = new Audio('/telltheme.mp3');
  _music.loop = true;
  _music.volume = 0.4;
  _music.play().catch(() => {});
}
function stopMusic() {
  if (_music) { _music.pause(); _music.currentTime = 0; _music = null; }
}

// ── STATE ──
let myName = '', oppName = '', myColour = 'pink';
let gameData = null;
let myPicks = {};
let oppPicks = {};
let usedFaces = new Set();
let currentRound = 0;
let timerInterval = null;
let pickedThisRound = false;
let finalPicks = {};
let finalOppPicks = {};
let finalSelectedCard = null;

const _urlParams = new URLSearchParams(window.location.search);
let roomCode = _urlParams.get('room') || '';

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
  // Register socket in room immediately so reconnects work
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
  if (errEl) {
    errEl.textContent = message === 'Room not found.'
      ? 'Room not found. Ask your opponent to create a new game.'
      : message;
    errEl.classList.remove('hidden');
  }
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
socket.on('game_start', ({ myName: mn, oppName: on, game, playerIndex }) => {
  myName = mn; oppName = on; gameData = game;
  myPicks = {}; oppPicks = {}; usedFaces = new Set();
  myColour = playerIndex === 0 ? 'pink' : 'blue';

  const pinkName = myColour === 'pink' ? myName : oppName;
  const blueName  = myColour === 'pink' ? oppName : myName;

  show('screen-game');

  // Header
  const myHdr = document.getElementById('hdr-my-name');
  const oppHdr = document.getElementById('hdr-opp-name');
  myHdr.textContent = myName.toUpperCase();
  myHdr.style.color = myColour === 'pink' ? '#e75480' : '#3498db';
  oppHdr.textContent = oppName.toUpperCase();
  oppHdr.style.color = myColour === 'pink' ? '#3498db' : '#e75480';

  // Strip labels — pink always left, blue always right
  const leftLbl = document.getElementById('strip-left-label');
  const rightLbl = document.getElementById('strip-right-label');
  leftLbl.textContent = pinkName.toUpperCase();
  leftLbl.style.color = '#e75480';
  rightLbl.textContent = blueName.toUpperCase();
  rightLbl.style.color = '#3498db';

  renderFaceCards();
  renderStrip();
  setTimeout(showLetsPlay, 1000);
});

// ── FACE CARDS (game screen) ──
function renderFaceCards() {
  const row = document.getElementById('faces-row');
  row.innerHTML = '';
  gameData.faces.forEach((face, i) => {
    const card = document.createElement('div');
    card.className = 'face-card locked';
    card.dataset.index = i;
    card.innerHTML = `<img src="${cardImg(face, 'front')}" alt="${face.name}"><div class="face-num">${i+1}</div>`;
    card.addEventListener('click', () => pickCard(i));
    row.appendChild(card);
  });
}

// ── LET'S PLAY ──
function showLetsPlay() {
  showPopupText("Let's Play Tell!", '34px', 2500, () => flipCardsToFace());
}

function flipCardsToFace() {
  document.querySelectorAll('#faces-row .face-card').forEach((card, i) => {
    setTimeout(() => {
      const img = card.querySelector('img');
      card.classList.add('flipping');
      setTimeout(() => {
        img.src = cardImg(gameData.faces[i], 'back');
        card.classList.remove('flipping');
        card.classList.add('face-up');
      }, 350);
    }, i * 450);
  });
}

// ── ROUND START ──
socket.on('round_start', ({ round, totalRounds, question }) => {
  currentRound = round;
  pickedThisRound = false;
  document.getElementById('hdr-round').textContent = `${round} / ${totalRounds}`;
  document.getElementById('status-bar').textContent = '';
  document.getElementById('question-text').textContent = '';

  document.querySelectorAll('#faces-row .face-card').forEach((c, i) => {
    c.classList.remove('my-pick','opp-pick','both-pick','locked');
    if (usedFaces.has(i)) { c.classList.add('used-face','locked'); }
  });

  highlightActiveSlot(round);

  showRoundPopup(round, () => {
    document.getElementById('question-text').textContent = question;
    document.querySelectorAll('#faces-row .face-card').forEach((c, i) => {
      if (!usedFaces.has(i)) c.classList.remove('locked');
    });
    startTimer('timer-fill', 15, () => {
      if (!pickedThisRound) {
        const avail = [...Array(5).keys()].find(i => !usedFaces.has(i));
        pickCard(avail !== undefined ? avail : 0);
      }
    });
  });
});

// ── PICK CARD ──
function pickCard(faceIndex) {
  if (pickedThisRound) return;
  const card = document.querySelector(`#faces-row .face-card[data-index="${faceIndex}"]`);
  if (!card || card.classList.contains('locked')) return;
  if (usedFaces.has(faceIndex)) return;

  pickedThisRound = true;
  stopTimer();
  myPicks[currentRound] = faceIndex;
  usedFaces.add(faceIndex);

  document.querySelectorAll('#faces-row .face-card').forEach((c, i) => {
    c.classList.add('locked');
    c.classList.toggle('my-pick', i === faceIndex);
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
  myPicks = mp; oppPicks = op;
  stopTimer();
  document.getElementById('status-bar').textContent = '';
  revealStripRow(round, mp, op);
});

// ── STRIP ──
// Layout: [PINK thumb] [Name] [BLUE thumb]
// Pink = creator (left), Blue = joiner (right) — ALWAYS
function renderStrip() {
  const strip = document.getElementById('answer-strip');
  strip.innerHTML = '';
  for (let i = 1; i <= 5; i++) {
    const row = document.createElement('div');
    row.className = 'strip-row';
    row.id = `strip-row-${i}`;
    row.innerHTML = `
      <div class="strip-thumb-cell" id="strip-pink-${i}"><div class="strip-thumb"></div></div>
      <div class="strip-name-cell" id="strip-name-${i}"><span class="strip-qnum">Q${i}</span></div>
      <div class="strip-thumb-cell" id="strip-blue-${i}"><div class="strip-thumb"></div></div>
    `;
    strip.appendChild(row);
  }
}

function revealStripRow(round, mp, op) {
  const q = gameData.questions[round - 1];
  const nameMid = document.getElementById(`strip-name-${round}`);
  if (nameMid) {
    nameMid.innerHTML = `<span class="strip-answer-name">${gameData.faces[q.answerIndex].name}</span>`;
    nameMid.classList.add('slot-drop');
  }

  const pinkPicks = myColour === 'pink' ? mp : op;
  const bluePicks = myColour === 'pink' ? op : mp;

  const pinkEl = document.getElementById(`strip-pink-${round}`);
  const blueEl = document.getElementById(`strip-blue-${round}`);

  if (pinkEl && pinkPicks[round] !== undefined) {
    const face = gameData.faces[pinkPicks[round]];
    pinkEl.querySelector('.strip-thumb').innerHTML = `<img src="${cardImg(face)}" alt="${face.name}" title="${face.name}">`;
  }
  if (blueEl && bluePicks[round] !== undefined) {
    const face = gameData.faces[bluePicks[round]];
    blueEl.querySelector('.strip-thumb').innerHTML = `<img src="${cardImg(face)}" alt="${face.name}" title="${face.name}">`;
  }
}

function highlightActiveSlot(round) {
  document.querySelectorAll('.strip-row').forEach(r => r.classList.remove('active-round'));
  const row = document.getElementById(`strip-row-${round}`);
  if (row) row.classList.add('active-round');
}

// ── FINAL PHASE ──
socket.on('final_phase', ({ myPicks: mp, oppPicks: op, questions, faces }) => {
  myPicks = mp; oppPicks = op;
  finalPicks = { ...mp };
  finalOppPicks = { ...op };
  finalSelectedCard = null;

  showGenericPopup('You can change your\nselections now!', () => {
    show('screen-final');
    renderFinalPhase(questions, faces || gameData.faces);
    startTimer('final-timer-fill', 15, submitFinal);
  });
});

function renderFinalPhase(questions, faces) {
  // ── MY PICKS: 5 cards + name button below each ──
  const myRow = document.getElementById('final-my-cards');
  myRow.innerHTML = '';
  faces.forEach((face, i) => {
    const round = parseInt(Object.keys(finalPicks).find(r => finalPicks[r] === i));
    const name = !isNaN(round) ? answerName(questions[round - 1]) : '—';
    const col = document.createElement('div');
    col.className = 'final-card-col';
    col.innerHTML = `
      <div class="final-card-img">
        <img src="${cardImg(face)}" alt="${face.name}">
      </div>
      <button class="final-name-btn" id="fcb-${i}" onclick="tapFinalCard(${i})">${name}</button>
    `;
    myRow.appendChild(col);
  });

  // ── OPP PICKS ──
  document.getElementById('final-opp-label').textContent = `${oppName.toUpperCase()}'S CHOICES`;
  const oppRow = document.getElementById('final-opp-cards');
  oppRow.innerHTML = '';
  faces.forEach((face, i) => {
    const round = parseInt(Object.keys(finalOppPicks).find(r => finalOppPicks[r] === i));
    const name = !isNaN(round) ? answerName(questions[round - 1]) : '—';
    const col = document.createElement('div');
    col.className = 'final-card-col';
    col.innerHTML = `
      <div class="final-card-img">
        <img src="${cardImg(face)}" alt="${face.name}">
      </div>
      <div class="final-name-btn opp-name-btn">${name}</div>
    `;
    oppRow.appendChild(col);
  });
}

function answerName(q) {
  return (q || '').split(',')[0].trim();
}

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
  const btnA = document.getElementById(`fcb-${faceA}`);
  const btnB = document.getElementById(`fcb-${faceB}`);
  if (btnA && btnB) {
    const t = btnA.textContent;
    btnA.textContent = btnB.textContent;
    btnB.textContent = t;
    [btnA, btnB].forEach(b => { b.classList.add('swapped'); setTimeout(() => b.classList.remove('swapped'), 400); });
  }
}

function submitFinal() {
  stopTimer();
  socket.emit('submit_final', { picks: finalPicks });
}

// ── GAME OVER ──
socket.on('game_over', ({ won, draw, myScore, oppScore, myName: mn, oppName: on, myResults, faces, questions }) => {
  stopMusic();
  show('screen-result');
  const verdict = document.getElementById('result-verdict');
  if (draw)     { verdict.textContent = 'DRAW';     verdict.className = 'draw'; }
  else if (won) { verdict.textContent = 'YOU WIN';  verdict.className = 'win'; launchFireworks(); }
  else          { verdict.textContent = 'YOU LOSE'; verdict.className = 'lose'; }

  document.getElementById('result-scores').innerHTML = `
    <div class="rs-player"><span class="rs-name" style="color:#e75480">${mn.toUpperCase()}</span><span class="rs-num">${myScore}</span></div>
    <span class="rs-vs">VS</span>
    <div class="rs-player"><span class="rs-name" style="color:#3498db">${on.toUpperCase()}</span><span class="rs-num">${oppScore}</span></div>
  `;

  const usedFaces = faces || gameData.faces;
  document.getElementById('result-breakdown').innerHTML = (questions || []).map((q, i) => {
    const round = i + 1;
    const r = myResults[round];
    if (!r) return '';
    const face = usedFaces[r.picked];
    if (!face) return '';
    return `
      <div class="bd-row ${r.right ? 'correct' : 'wrong'}">
        <span class="bd-q">Q${round}</span>
        <div class="bd-thumb"><img src="${cardImg(face)}" alt="${face.name}"></div>
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

socket.on('opponent_left', () => { alert('Opponent disconnected. You win!'); location.href = location.origin; });

// ── TIMER ──
function startTimer(fillId, seconds, onExpire) {
  stopTimer();
  const fill = document.getElementById(fillId);
  let ticks = seconds * 10; const total = ticks;
  fill.style.width = '100%'; fill.style.background = 'var(--gold)';
  timerInterval = setInterval(() => {
    ticks--;
    const pct = (ticks / total) * 100;
    fill.style.width = pct + '%';
    if (pct < 40) { fill.style.background = 'var(--red)'; if (ticks % 10 === 0 && ticks > 0) beep(); }
    else fill.style.background = 'var(--gold)';
    if (ticks <= 0) { stopTimer(); onExpire(); }
  }, 100);
}

function stopTimer() { if (timerInterval) { clearInterval(timerInterval); timerInterval = null; } }

// ── AUDIO ──
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
function showRoundPopup(round, callback) { boxingBell(); showPopupText(`TELL ${round}`, '58px', 1800, callback); }
function showGenericPopup(text, callback) { showPopupText(text, '28px', 2500, callback); }
function showPopupText(text, fontSize, duration, callback) {
  const popup = document.getElementById('popup-letsplay');
  const textEl = popup.querySelector('.popup-text');
  const img = popup.querySelector('img');
  img.style.display = 'none';
  textEl.textContent = text; textEl.style.fontSize = fontSize;
  textEl.style.whiteSpace = 'pre-line'; textEl.style.textAlign = 'center';
  popup.classList.remove('hidden');
  requestAnimationFrame(() => popup.classList.add('show'));
  setTimeout(() => {
    popup.classList.remove('show');
    setTimeout(() => {
      popup.classList.add('hidden');
      img.style.display = ''; textEl.style.fontSize = ''; textEl.style.whiteSpace = '';
      if (callback) callback();
    }, 300);
  }, duration);
}

// ── SCREEN ──
function show(id) { document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id)); }

// ── FIREWORKS ──
function launchFireworks() {
  const canvas = document.getElementById('fireworks-canvas');
  canvas.style.display = 'block'; canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d'), particles = [], colours = ['#2D7A7A','#D4A843','#e75480','#27ae60','#3498db'];
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