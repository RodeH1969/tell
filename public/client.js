// ── TELL client.js v10 ──

const socket = io({ reconnection:true, reconnectionDelay:500, reconnectionAttempts:20 });

// ── STATE ──
let myName='', oppName='', myColour='red', isCreator=false;
let gameData=null, currentGameRound=0, currentQuestionIdx=0;
let usedFaces=new Set();
let timerInterval=null, pickedThisRound=false;
let finalPicks={}, finalOppPicks={}, finalSelectedCard=null;
let _finalChanges=0, _finalSubmitted=false;
let _swapsRemaining=2;
let _firebaseListener=null, _lastPhase='';
let roomCode='', _rematchCode='';

const _urlParams = new URLSearchParams(window.location.search);
const _codeFromUrl = _urlParams.get('room') || '';

// ── AUDIO ──
let _music=null, _audioUnlocked=false;
const _audioElements={};
let _pendingAudio=null;

function startMusic() {
  if(_music) return; unlockAudio();
  _music=new Audio('/telltheme.mp3');
  _music.loop=true; _music.volume=0.07;
  _music.play().catch(()=>{});
}
function stopMusic() { if(_music){_music.pause();_music.currentTime=0;_music=null;} }
function showAudioButton() { const b=document.getElementById('audio-play-btn'); if(b){b.style.display='flex'; b.onclick=()=>{unlockAudio();playPendingAudio();};} }
function hideAudioButton() { const b=document.getElementById('audio-play-btn'); if(b){b.style.display='none'; b.onclick=null;} }

function preloadAudio(questions) {
  if(!questions) return;
  questions.forEach(q => {
    if(!q.audio||_audioElements[q.audio]) return;
    const a=new Audio(`/audio/${q.audio}`);
    a.preload='auto'; a.volume=0.9;
    a.setAttribute('playsinline',''); a.setAttribute('webkit-playsinline','');
    _audioElements[q.audio]=a; a.load();
  });
}

function playQuestion(filename) { _pendingAudio=filename; showAudioButton(); }

function playPendingAudio() {
  if(!_pendingAudio) return;
  const filename=_pendingAudio;
  _pendingAudio=null;
  hideAudioButton();
  // Create fresh Audio element inside gesture handler for iOS
  const a = new Audio(`/audio/${filename}`);
  a.volume=0.9;
  a.setAttribute('playsinline','');
  a.setAttribute('webkit-playsinline','');
  a.play().catch(()=>{ showAudioButton(); _pendingAudio=filename; });
}

function unlockAudio() {
  const first=!_audioUnlocked; _audioUnlocked=true;
  try{ const ctx=getAudioCtx(); if(ctx&&ctx.state==='suspended') ctx.resume().catch(()=>{}); } catch(e){}
  if(first&&_pendingAudio) playPendingAudio();
}
document.addEventListener('touchstart', unlockAudio, {passive:true});
document.addEventListener('click', unlockAudio);

// ── AUDIO ENGINE ──
let _audioCtx=null;
function getAudioCtx(){ if(!_audioCtx) _audioCtx=new (window.AudioContext||window.webkitAudioContext)(); return _audioCtx; }

function beep(freq=880, vol=0.3, dur=0.08){
  try{
    const ctx=getAudioCtx(),osc=ctx.createOscillator(),gain=ctx.createGain();
    osc.connect(gain);gain.connect(ctx.destination);osc.frequency.value=freq;
    gain.gain.setValueAtTime(vol,ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+dur);
    osc.start(ctx.currentTime);osc.stop(ctx.currentTime+dur);
  }catch(e){}
}

function boxingBell(){
  try{const ctx=getAudioCtx(),t=ctx.currentTime;ringBell(ctx,t);ringBell(ctx,t+0.6);ringBell(ctx,t+1.2);}catch(e){}
}
function ringBell(ctx,st){
  [440,880,1320,2200].forEach((freq,i)=>{
    const osc=ctx.createOscillator(),gain=ctx.createGain();
    osc.connect(gain);gain.connect(ctx.destination);osc.type='sine';osc.frequency.value=freq;
    const vol=[0.4,0.3,0.15,0.08][i];
    gain.gain.setValueAtTime(vol,st);gain.gain.exponentialRampToValueAtTime(0.001,st+1.8);
    osc.start(st);osc.stop(st+1.8);
  });
}

function playSuccessChord(){
  try{
    const ctx=getAudioCtx(),t=ctx.currentTime;
    [[523,0.4],[659,0.3],[784,0.25],[1047,0.2]].forEach(([freq,vol],i)=>{
      const osc=ctx.createOscillator(),gain=ctx.createGain();
      osc.connect(gain);gain.connect(ctx.destination);
      osc.frequency.value=freq; osc.type='sine';
      gain.gain.setValueAtTime(0,t+i*0.04);
      gain.gain.linearRampToValueAtTime(vol,t+i*0.04+0.05);
      gain.gain.exponentialRampToValueAtTime(0.001,t+i*0.04+0.6);
      osc.start(t+i*0.04); osc.stop(t+i*0.04+0.6);
    });
  }catch(e){}
}

function playErrorSound(){
  try{
    const ctx=getAudioCtx(),t=ctx.currentTime;
    const osc=ctx.createOscillator(),gain=ctx.createGain();
    osc.connect(gain);gain.connect(ctx.destination);
    osc.type='sawtooth'; osc.frequency.setValueAtTime(200,t);
    osc.frequency.exponentialRampToValueAtTime(80,t+0.4);
    gain.gain.setValueAtTime(0.3,t);
    gain.gain.exponentialRampToValueAtTime(0.001,t+0.4);
    osc.start(t); osc.stop(t+0.4);
  }catch(e){}
}

function playLockInSound(){
  try{
    const ctx=getAudioCtx(),t=ctx.currentTime;
    [440,550,660].forEach((freq,i)=>{
      const osc=ctx.createOscillator(),gain=ctx.createGain();
      osc.connect(gain);gain.connect(ctx.destination);
      osc.frequency.value=freq; osc.type='sine';
      gain.gain.setValueAtTime(0.35,t+i*0.08);
      gain.gain.exponentialRampToValueAtTime(0.001,t+i*0.08+0.3);
      osc.start(t+i*0.08); osc.stop(t+i*0.08+0.3);
    });
  }catch(e){}
}

function playSwapSound(){
  beep(660, 0.2, 0.1);
  setTimeout(()=>beep(880, 0.15, 0.08), 80);
}

function playScoreTickSound(){
  beep(1047, 0.2, 0.06);
}

// ── SPLASH ──
window.addEventListener('load', () => {
  setTimeout(() => {
    if(_codeFromUrl){ show('screen-joiner'); }
    else            { show('screen-creator'); }
  }, 3500);
});

// ── NO INPUTS — names are fixed ──

// ── CREATE ──
function createGame() {
  unlockAudio();
  startMusic();
  myName='APOLLO CREED';
  isCreator=true; myColour='red';
  socket.emit('create_room',{name:myName});
}
socket.on('room_created',({code})=>{
  roomCode=code; window._inviteLink=`${location.origin}?room=${code}`;
  show('screen-waiting'); listenToRoom(code);
});

// ── JOIN ──
function joinGame() {
  unlockAudio();
  startMusic();
  myName='ROCKY BALBOA';
  if(!_codeFromUrl) return;
  roomCode=_codeFromUrl; isCreator=false; myColour='blue';
  const btn=document.getElementById('btn-join');
  if(btn){ btn.disabled=true; btn.textContent='ENTERING THE RING…'; }
  socket.emit('join_room',{name:myName,code:roomCode});
  socket.emit('join_socket_room',{code:roomCode});
  listenToRoom(roomCode);
}
socket.on('join_error',({message})=>{
  const e=document.getElementById('join-error-msg');
  if(e){e.textContent=message==='Room not found.'?'Room not found. Ask your opponent to create a new game.':message; e.classList.remove('hidden');}
  document.getElementById('btn-join').disabled=false;
  document.getElementById('btn-join').textContent='TRY AGAIN';
});

// ── SHARE ──
function shareInvite() {
  const link=window._inviteLink;
  const showWaiting=()=>{ document.querySelector('.share-invite-btn').classList.add('hidden'); document.getElementById('waiting-status').classList.remove('hidden'); };
  if(navigator.share){ navigator.share({title:'TELL',text:'I challenge you to a game of TELL 👀',url:link}).then(showWaiting).catch(()=>showWaiting()); }
  else{ navigator.clipboard.writeText(link).then(()=>{ showToast('Link copied!'); showWaiting(); }); }
}

// ── REMATCH ──
function requestRematch() {
  // Create a new room and send invite to same opponent
  myColour='red'; isCreator=true;
  socket.emit('create_room',{name:myName});
  socket.once('room_created',({code})=>{
    roomCode=code; _rematchCode=code;
    window._inviteLink=`${location.origin}?room=${code}`;
    // Reset game state
    gameData=null; _lastPhase=''; usedFaces=new Set(); myPicks={}; oppPicks={};
    show('screen-waiting');
    listenToRoom(code);
  });
}

// ── CARD IMAGE ──
function cardImg(face, side='back') {
  const file=side==='front'?face.front:face.back;
  return `/data/Game%201%20Cards/${encodeURIComponent(file)}`;
}

// ── FIREBASE LISTENER ──
function listenToRoom(code) {
  if(_firebaseListener) firebase.database().ref(`rooms/${roomCode}`).off('value',_firebaseListener);
  const ref=firebase.database().ref(`rooms/${code}`);
  _firebaseListener=ref.on('value',snap=>{
    const room=snap.val(); if(!room) return;
    handleRoomState(room);
  });
}

function handleRoomState(room) {
  const phase=room.phase;
  if(phase===_lastPhase && phase!=='picking' && phase!=='revealing' && phase!=='final') return;
  switch(phase){
    case 'starting':  if(!gameData) onGameStart(room); break;
    case 'picking':   if(phase!==_lastPhase) onQuestionStart(room); break;
    case 'revealing_done': break; // transient phase, ignore
    case 'revealing': if(phase!==_lastPhase) onQuestionReveal(room); break;
    case 'final':
      if(phase!==_lastPhase) onFinalPhase(room);
      else if(room.lockedIn) updateLockedIn(room.lockedIn);
      break;
    case 'resolving': break; // transient phase, ignore
    case 'round_result': if(phase!==_lastPhase) onRoundResult(room); break;
    case 'game_over':    if(phase!==_lastPhase) onGameOver(room); break;
  }
  _lastPhase=phase;
}

// ── GAME START ──
let myPicks={}, oppPicks={};
function onGameStart(room) {
  gameData=room.game;
  const players=room.players||[];
  const me=players.find(p=>p.name===myName)||players[0];
  const opp=players.find(p=>p.name!==myName)||players[1];
  if(!me||!opp) return;
  oppName=opp.name;
  myColour=players.indexOf(me)===0?'red':'blue';
  isCreator=players.indexOf(me)===0;
  socket.emit('join_socket_room',{code:room.code});
  gameData.rounds.forEach(r=>preloadAudio(r.questions));
  setupHeader();
  setupTimerNames();
  // Show Let's Play popup FIRST, then reveal game screen — no flash
  showPopupText("Let's Play Tell!",'clamp(42px,12vw,68px)',2000,()=>{
    show('screen-game');
    showPopupText('Each player has 15 seconds to pick which image matches the historical figure announced.','clamp(20px,5vw,28px)',3500,()=>{
      if(gameData){ renderCards(gameData.rounds[0].faces); setTimeout(()=>flipCardsToFace(gameData.rounds[0].faces),100); }
      renderScoreboard(4);
    });
  });
}

function setupHeader() {
  const myHex=myColour==='red'?'#e53e3e':'#3182ce';
  const oppHex=myColour==='red'?'#3182ce':'#e53e3e';
  document.getElementById('hdr-my-name').textContent=myName.toUpperCase();
  document.getElementById('hdr-my-name').style.color=myHex;
  document.getElementById('hdr-opp-name').textContent=oppName.toUpperCase();
  document.getElementById('hdr-opp-name').style.color=oppHex;
  document.getElementById('hdr-my-score').textContent='0';
  document.getElementById('hdr-opp-score').textContent='0';
  const redName=myColour==='red'?myName:oppName;
  const blueName=myColour==='red'?oppName:myName;
  document.getElementById('sb-left-name').textContent=redName.toUpperCase();
  document.getElementById('sb-right-name').textContent=blueName.toUpperCase();
}

function setupTimerNames() {
  document.getElementById('timer-top-name').textContent=(isCreator?myName:oppName).toUpperCase();
  document.getElementById('timer-bottom-name').textContent=(isCreator?oppName:myName).toUpperCase();
  buildTicks('timer-top-ticks',   isCreator?'red':'blue');
  buildTicks('timer-bottom-ticks',isCreator?'blue':'red');
}

function buildTicks(containerId,colour) {
  const el=document.getElementById(containerId); if(!el) return;
  el.innerHTML='';
  for(let i=0;i<15;i++){
    const t=document.createElement('div');
    t.className='tick'; t.style.height=`${8+i}px`;
    el.appendChild(t);
  }
}

// ── LET'S PLAY — now called inline from onGameStart ──

function flipCardsToFace(faces) {
  document.querySelectorAll('#faces-row .face-card').forEach((card,i)=>{
    setTimeout(()=>{
      const img=card.querySelector('img');
      card.classList.add('flipping');
      setTimeout(()=>{ img.src=cardImg(faces[i],'back'); card.classList.remove('flipping'); card.classList.add('face-up'); },350);
    },i*450);
  });
}

function renderCards(faces,containerId='faces-row') {
  const row=document.getElementById(containerId); if(!row) return;
  row.innerHTML='';
  faces.forEach((face,i)=>{
    const card=document.createElement('div');
    card.className='face-card locked'; card.dataset.index=i;
    card.innerHTML=`<img src="${cardImg(face,'front')}" alt="${face.name}"><div class="face-num">${i+1}</div>`;
    card.addEventListener('click',()=>handleCardClick(i));
    row.appendChild(card);
  });
}

function handleCardClick(index) {
  if(pickedThisRound) return;
  const card=document.querySelector(`#faces-row .face-card[data-index="${index}"]`);
  if(!card||card.classList.contains('locked')) return;
  submitPick(index);
}

// ── QUESTION START ──
function onQuestionStart(room) {
  stopDualTimers();
  const gameRound=room.currentRound, questionIdx=room.currentQuestion;
  currentGameRound=gameRound; currentQuestionIdx=questionIdx;
  pickedThisRound=false;
  document.getElementById('hdr-round').textContent=`R${gameRound+1} · Q${questionIdx+1}/4`;
  document.getElementById('status-bar').textContent='';
  // Reset timer name labels
  document.getElementById('timer-top-name').textContent=(isCreator?myName:oppName).toUpperCase();
  document.getElementById('timer-bottom-name').textContent=(isCreator?oppName:myName).toUpperCase();
  const faces=gameData.rounds[gameRound].faces;
  if(questionIdx===0){
    usedFaces=new Set();
    renderCards(faces);
    setTimeout(()=>flipCardsToFace(faces),100);
    renderScoreboard(4);
    preloadAudio(gameData.rounds[gameRound].questions);
  }
  document.querySelectorAll('#faces-row .face-card').forEach((c,i)=>{
    c.classList.remove('my-pick-red','my-pick-blue','opp-pick-red','opp-pick-blue','both-picks','locked','used-face');
    const lbl=c.querySelector('.card-pick-label'); if(lbl) lbl.remove();
    if(usedFaces.has(`${gameRound}_${i}`)) c.classList.add('used-face','locked');
  });
  highlightActiveSlot(questionIdx);
  const q=gameData.rounds[gameRound].questions[questionIdx];
  if(q&&q.audio) playQuestion(q.audio);
  showRoundPopup(`TELL R${gameRound+1} · Q${questionIdx+1}`,()=>{
    document.querySelectorAll('#faces-row .face-card').forEach((c,i)=>{
      if(!usedFaces.has(`${gameRound}_${i}`)) c.classList.remove('locked');
    });
    startDualTimers(15);
  });
}

// ── QUESTION REVEAL ──
function onQuestionReveal(room) {
  stopDualTimers();
  document.getElementById('status-bar').textContent='';
  const gameRound=room.currentRound, questionIdx=room.currentQuestion;
  const players=room.players||[];
  const p1=players[0],p2=players[1]; if(!p1||!p2) return;
  const picks={
    [p1.name]: extractRoundPicks(p1.picks||{},gameRound),
    [p2.name]: extractRoundPicks(p2.picks||{},gameRound)
  };
  revealScoreboardSlot(questionIdx,picks,gameRound);
}

function extractRoundPicks(allPicks,gameRound) {
  const result={};
  Object.keys(allPicks).forEach(k=>{
    const parts=k.split('_');
    if(parts.length===2&&parseInt(parts[0])===gameRound) result[parseInt(parts[1])]=allPicks[k];
  });
  return result;
}

// ── SUBMIT PICK ──
function submitPick(faceIndex) {
  pickedThisRound=true; stopMyTimer();
  usedFaces.add(`${currentGameRound}_${faceIndex}`);
  document.querySelectorAll('#faces-row .face-card').forEach((c,i)=>{
    c.classList.add('locked');
    if(i===faceIndex){ c.classList.add(myColour==='red'?'my-pick-red':'my-pick-blue'); showPickLabel(c,myName,myColour); }
  });
  document.getElementById('status-bar').textContent='WAITING FOR OPPONENT…';
  socket.emit('submit_pick',{code:roomCode,name:myName,faceIndex});
}

function showPickLabel(card,name,colour) {
  let lbl=card.querySelector('.card-pick-label');
  if(!lbl){ lbl=document.createElement('div'); lbl.className='card-pick-label'; card.appendChild(lbl); }
  const span=document.createElement('span');
  span.className=`card-pick-name ${colour}-name`;
  span.textContent=name.toUpperCase();
  lbl.appendChild(span);
}

socket.on('pick_made',({submitterName,faceIndex})=>{
  if(submitterName!==myName){
    const oppColour=myColour==='red'?'blue':'red';
    document.querySelectorAll('#faces-row .face-card').forEach((c,i)=>{
      if(i===faceIndex){
        if(c.classList.contains('my-pick-red')||c.classList.contains('my-pick-blue')) c.classList.add('both-picks');
        else c.classList.add(oppColour==='red'?'opp-pick-red':'opp-pick-blue');
        showPickLabel(c,submitterName,oppColour);
      }
    });
    // Show opponent locked in on their timer
    const oppTimerId = isCreator ? 'timer-bottom-name' : 'timer-top-name';
    const oppTimerEl = document.getElementById(oppTimerId);
    if(oppTimerEl) {
      oppTimerEl.innerHTML = oppName.toUpperCase() + ' <span class="locked-badge">LOCKED 🔒</span>';
    }
  } else {
    // Show my own locked status
    const myTimerId = isCreator ? 'timer-top-name' : 'timer-bottom-name';
    const myTimerEl = document.getElementById(myTimerId);
    if(myTimerEl) {
      myTimerEl.innerHTML = myName.toUpperCase() + ' <span class="locked-badge">LOCKED 🔒</span>';
    }
  }
});

// ── DUAL TIMERS ──
let _myTimerInterval=null, _myTimerStopped=false;

function startDualTimers(seconds) {
  stopDualTimers(); _myTimerStopped=false;
  const myFillId=isCreator?'timer-top-fill':'timer-bottom-fill';
  const myTicksId=isCreator?'timer-top-ticks':'timer-bottom-ticks';
  const oppFillId=isCreator?'timer-bottom-fill':'timer-top-fill';
  const oppTicksId=isCreator?'timer-bottom-ticks':'timer-top-ticks';
  const myCol=myColour==='red'?'red':'blue';
  const oppCol=myColour==='red'?'blue':'red';
  setTimerFill(myFillId,100,myCol,false); setTimerFill(oppFillId,100,oppCol,false);
  setTicks(myTicksId,15,myCol); setTicks(oppTicksId,15,oppCol);
  let myTicks=seconds*10,oppTicks=seconds*10; const total=seconds*10;
  _myTimerInterval=setInterval(()=>{
    if(!_myTimerStopped) myTicks--;
    oppTicks--;
    const myPct=(myTicks/total)*100, oppPct=(oppTicks/total)*100;
    if(!_myTimerStopped){ setTimerFill(myFillId,myPct,myCol,myPct<40); setTicks(myTicksId,Math.round(myTicks/10),myCol); if(myPct<40&&Math.round(myTicks)%10===0&&myTicks>0) beep(); }
    setTimerFill(oppFillId,oppPct,oppCol,oppPct<40); setTicks(oppTicksId,Math.round(oppTicks/10),oppCol);
    if(oppTicks<=0&&!pickedThisRound){ stopDualTimers(); const avail=[0,1,2,3].find(i=>!usedFaces.has(`${currentGameRound}_${i}`)); submitPick(avail!==undefined?avail:0); }
  },100);
}

function stopMyTimer(){ _myTimerStopped=true; }
function stopDualTimers(){ if(_myTimerInterval){clearInterval(_myTimerInterval);_myTimerInterval=null;} _myTimerStopped=false; }

function setTimerFill(fillId,pct,colour,hot){
  const fill=document.getElementById(fillId); if(!fill) return;
  fill.style.width=pct+'%';
  if(hot){ fill.style.background='#e53e3e'; fill.style.boxShadow='0 0 12px rgba(229,62,62,0.8)'; }
  else{ fill.style.background=colour==='red'?'var(--red)':'var(--blue)'; fill.style.boxShadow=colour==='red'?'0 0 8px var(--red-glow)':'0 0 8px var(--blue-glow)'; }
}

function setTicks(containerId,remaining,colour){
  const container=document.getElementById(containerId); if(!container) return;
  const activeClass=colour==='red'?'active-red':'active-blue';
  container.querySelectorAll('.tick').forEach((t,i)=>{
    t.classList.remove('active-red','active-blue','hot');
    if(i<remaining){ t.classList.add(activeClass); if(remaining<=4) t.classList.add('hot'); }
  });
}

// ── SCOREBOARD ──
function renderScoreboard(count=4){
  ['sb-slots-left','sb-slots-right'].forEach(id=>{
    const el=document.getElementById(id); if(!el) return; el.innerHTML='';
    for(let i=0;i<count;i++){
      const slot=document.createElement('div');
      slot.className='sb-slot'; slot.id=`${id}-q${i}`;
      slot.innerHTML=`<span class="sb-slot-num">Q${i+1}</span><div class="sb-slot-thumb"></div>`;
      el.appendChild(slot);
    }
  });
  const centre=document.getElementById('sb-centre');
  if(centre){
    centre.innerHTML='';
    for(let i=0;i<count;i++){
      const slot=document.createElement('div');
      slot.className='sb-centre-slot'; slot.id=`sb-centre-q${i}`;
      slot.innerHTML=`<span class="sb-centre-qnum">Q${i+1}</span>`;
      centre.appendChild(slot);
    }
  }
}

function revealScoreboardSlot(questionIdx,picks,gameRound){
  const faces=gameData.rounds[gameRound].faces;
  const q=gameData.rounds[gameRound].questions[questionIdx];
  const centre=document.getElementById(`sb-centre-q${questionIdx}`);
  if(centre){ centre.innerHTML=`<span class="sb-centre-name">${faces[q.answerIndex].name}</span>`; centre.classList.add('slot-drop'); }
  const redPicks=myColour==='red'?picks[myName]:picks[oppName];
  const bluePicks=myColour==='red'?picks[oppName]:picks[myName];
  updateScoreSlot('sb-slots-left',questionIdx,redPicks,q.answerIndex,faces,0);
  updateScoreSlot('sb-slots-right',questionIdx,bluePicks,q.answerIndex,faces,60);
}

function updateScoreSlot(containerId,questionIdx,playerPicks,correctIdx,faces,delay=0){
  const slot=document.getElementById(`${containerId}-q${questionIdx}`);
  if(!slot||!playerPicks||playerPicks[questionIdx]===undefined) return;
  const face=faces[playerPicks[questionIdx]];
  const correct=playerPicks[questionIdx]===correctIdx;
  setTimeout(()=>{
    const thumb=slot.querySelector('.sb-slot-thumb');
    thumb.innerHTML=`<img src="${cardImg(face)}" alt="${face.name}">`;
    thumb.classList.add(correct?'correct':'wrong');
    slot.classList.add('slot-drop');
  },delay);
}

function highlightActiveSlot(idx){
  document.querySelectorAll('.sb-slot').forEach(s=>s.classList.remove('active'));
  [`sb-slots-left-q${idx}`,'sb-slots-right-q${idx}'].forEach(id=>{ const el=document.getElementById(id); if(el) el.classList.add('active'); });
}

// ── FINAL PHASE ──
function onFinalPhase(room) {
  _finalSubmitted=false; _finalChanges=0; _swapsRemaining=2; finalSelectedCard=null;
  if(window._oppActivityInterval){ clearInterval(window._oppActivityInterval); window._oppActivityInterval=null; }
  const players=room.players||[];
  const me=players.find(p=>p.name===myName)||players[0];
  const opp=players.find(p=>p.name!==myName)||players[1];
  const gameRound=room.currentRound;
  const faces=gameData.rounds[gameRound].faces;
  const questions=gameData.rounds[gameRound].questions.map(q=>q.text);
  finalPicks={...(extractRoundPicks(me.picks||{},gameRound))};
  finalOppPicks={...(extractRoundPicks(opp.picks||{},gameRound))};

  showGenericPopup('Do you want to\nchange your picks?',()=>{
    show('screen-final');
    renderFinalPhase(questions,faces);
    updateSwapCounter();
    startFinalTimer(25);
    // Show opponent activity indicator
    startOppActivityPoll();
  });
}

function startOppActivityPoll(){
  // Show "opponent is thinking" message
  const bar=document.getElementById('status-bar');
  const messages=['Opponent is thinking...','Opponent is shifting answers... ⏳','Opponent reconsidering... 🤔','Opponent making moves...'];
  let idx=0;
  window._oppActivityInterval=setInterval(()=>{
    if(_finalSubmitted) return;
    if(bar&&!bar.querySelector('.waiting-opponent')) bar.textContent=messages[idx%messages.length];
    idx++;
  },2200);
}

function updateSwapCounter(){
  const el=document.getElementById('swap-counter');
  if(!el) return;
  el.textContent=`${_swapsRemaining} SWAP${_swapsRemaining!==1?'S':''} REMAINING`;
  el.style.color=_swapsRemaining===0?'var(--red)':_swapsRemaining===1?'var(--gold)':'var(--green)';
}

function updateLockedIn(lockedIn){
  if(!lockedIn||!Array.isArray(lockedIn)||!lockedIn.length) return;
  // Only act if we're actually on the final screen
  const finalScreen = document.getElementById('screen-final');
  if(!finalScreen||!finalScreen.classList.contains('active')) return;
  const oppLocked=lockedIn.includes(oppName)&&!lockedIn.includes(myName);
  if(oppLocked&&!_finalSubmitted){
    if(window._oppActivityInterval){ clearInterval(window._oppActivityInterval); window._oppActivityInterval=null; }
    const bar=document.getElementById('status-bar');
    if(bar) bar.innerHTML='<span style="color:var(--gold);font-weight:800;letter-spacing:0.1em;animation:namePulse 0.5s ease-in-out infinite">⚡ OPPONENT LOCKED IN — YOUR MOVE!</span>';
  }
}

function renderFinalPhase(questions,faces){
  const myColourHex=myColour==='red'?'#e53e3e':'#3182ce';
  const oppColourHex=myColour==='red'?'#3182ce':'#e53e3e';
  const myRow=document.getElementById('final-my-cards'); myRow.innerHTML='';
  faces.forEach((face,i)=>{
    const rk=parseInt(Object.keys(finalPicks).find(r=>finalPicks[r]===i));
    const name=!isNaN(rk)?answerName(questions[rk]):'—';
    const col=document.createElement('div'); col.className='final-card-col';
    col.innerHTML=`<div class="final-card-img my-card-img" style="border-color:${myColourHex}"><img src="${cardImg(face)}" alt="${face.name}"></div><button class="final-name-btn" id="fcb-${i}" onclick="tapFinalCard(${i})" style="border-color:${myColourHex};color:${myColourHex}">${name}</button>`;
    myRow.appendChild(col);
  });
  document.getElementById('final-opp-label').textContent=oppName.toUpperCase()+"'S CHOICES";
  const oppRow=document.getElementById('final-opp-cards'); oppRow.innerHTML='';
  faces.forEach((face,i)=>{
    const rk=parseInt(Object.keys(finalOppPicks).find(r=>finalOppPicks[r]===i));
    const name=!isNaN(rk)?answerName(questions[rk]):'—';
    const col=document.createElement('div'); col.className='final-card-col';
    col.innerHTML=`<div class="final-card-img opp-card-img" style="border-color:${oppColourHex}"><img src="${cardImg(face)}" alt="${face.name}"></div><div class="final-name-btn opp-name-btn" style="border-color:${oppColourHex};color:${oppColourHex}">${name}</div>`;
    oppRow.appendChild(col);
  });
}

function answerName(q){ return (q||'').split(',')[0].trim(); }

function tapFinalCard(faceIndex){
  if(_swapsRemaining<=0&&finalSelectedCard===null) return; // no swaps left, can't start new selection
  if(finalSelectedCard===null){
    finalSelectedCard=faceIndex;
    document.querySelectorAll('.final-name-btn:not(.opp-name-btn)').forEach(b=>b.classList.remove('selected'));
    const btn=document.getElementById(`fcb-${faceIndex}`); if(btn) btn.classList.add('selected');
  } else {
    if(finalSelectedCard===faceIndex){ finalSelectedCard=null; document.querySelectorAll('.final-name-btn').forEach(b=>b.classList.remove('selected')); return; }
    swapFinalCards(finalSelectedCard,faceIndex);
    finalSelectedCard=null; document.querySelectorAll('.final-name-btn').forEach(b=>b.classList.remove('selected'));
  }
}

function swapFinalCards(faceA,faceB){
  if(_swapsRemaining<=0) return;
  const rA=parseInt(Object.keys(finalPicks).find(r=>finalPicks[r]===faceA));
  const rB=parseInt(Object.keys(finalPicks).find(r=>finalPicks[r]===faceB));
  if(!isNaN(rA)) finalPicks[rA]=faceB;
  if(!isNaN(rB)) finalPicks[rB]=faceA;
  _finalChanges++; _swapsRemaining--;
  playSwapSound();
  const btnA=document.getElementById(`fcb-${faceA}`),btnB=document.getElementById(`fcb-${faceB}`);
  if(btnA&&btnB){
    const t=btnA.textContent; btnA.textContent=btnB.textContent; btnB.textContent=t;
    [btnA,btnB].forEach(b=>{b.classList.add('swapped');setTimeout(()=>b.classList.remove('swapped'),400);});
  }
  updateSwapCounter();
  if(_swapsRemaining===0){
    // Dim swap buttons when out of swaps
    document.querySelectorAll('.final-name-btn:not(.opp-name-btn)').forEach(b=>{ b.style.opacity='0.7'; b.style.cursor='default'; });
  }
}

function submitFinal(){
  if(_finalSubmitted) return;
  _finalSubmitted=true;
  if(window._oppActivityInterval){ clearInterval(window._oppActivityInterval); window._oppActivityInterval=null; }
  stopDualTimers();
  playLockInSound();

  // Freeze and dim the board
  document.querySelectorAll('.final-name-btn:not(.opp-name-btn)').forEach(b=>{ b.style.opacity='0.5'; b.style.pointerEvents='none'; });
  document.getElementById('final-my-section').style.opacity='0.7';

  // Show glowing LOCKED badge
  const btn=document.querySelector('#screen-final .btn-primary');
  if(btn){
    btn.textContent='✓ LOCKED IN';
    btn.style.background='var(--green)';
    btn.style.boxShadow='0 0 20px rgba(22,163,74,0.6)';
    btn.style.animation='namePulse 1s ease-in-out infinite';
    btn.disabled=true;
  }

  const bar=document.getElementById('status-bar');
  if(bar) bar.innerHTML='<span class="waiting-opponent">LOCKED IN — WAITING FOR OPPONENT</span>';

  socket.emit('submit_final',{code:roomCode,name:myName,picks:finalPicks,changes:_finalChanges});
  _finalChanges=0;
}

// ── FINAL TIMER ──
function startFinalTimer(seconds){
  stopDualTimers();
  const fill=document.getElementById('final-timer-fill');
  const ticksEl=document.getElementById('final-timer-ticks');
  if(fill){ fill.style.width='100%'; fill.style.background='var(--gold)'; }
  if(ticksEl){
    ticksEl.innerHTML='';
    for(let i=0;i<seconds;i++){
      const t=document.createElement('div');
      t.className='tick active-red'; t.style.height=`${8+i*0.4}px`; t.style.background='var(--gold)';
      ticksEl.appendChild(t);
    }
  }
  let ticks=seconds*10; const total=ticks;
  _myTimerInterval=setInterval(()=>{
    ticks--;
    const pct=(ticks/total)*100;
    if(fill){ fill.style.width=pct+'%'; if(pct<30){ fill.style.background='var(--red)'; fill.style.boxShadow='0 0 12px rgba(229,62,62,0.8)'; } else fill.style.background='var(--gold)'; }
    if(ticksEl){ const rem=Math.round(ticks/10); ticksEl.querySelectorAll('.tick').forEach((t,i)=>{ t.classList.remove('hot'); if(i>=rem){ t.style.background='rgba(255,255,255,0.1)'; } else{ t.style.background=rem<=5?'var(--red)':'var(--gold)'; if(rem<=5) t.classList.add('hot'); } }); }
    if(ticks%10===0&&ticks>0&&ticks/10<=5) beep();
    if(ticks<=0){ stopDualTimers(); submitFinal(); }
  },100);
}

// ── ROUND RESULT ──
function onRoundResult(room) {
  stopDualTimers();
  if(window._oppActivityInterval){ clearInterval(window._oppActivityInterval); window._oppActivityInterval=null; }
  const data=room.lastRoundResults; if(!data) return;
  const {gameRound,roundScores,totalScores,changes,results,faces}=data;
  const myRound=roundScores[myName]||0,oppRound=roundScores[oppName]||0;
  const myTotal=totalScores[myName]||0,oppTotal=totalScores[oppName]||0;
  const myC=changes[myName]||0,oppC=changes[oppName]||0;
  const myResults=results[myName]||{},oppResults=results[oppName]||{};
  const isLast=gameRound===1;
  const myHex=myColour==='red'?'#e53e3e':'#3182ce';
  const oppHex=myColour==='red'?'#3182ce':'#e53e3e';

  document.getElementById('hdr-my-score').textContent=myTotal;
  document.getElementById('hdr-opp-score').textContent=oppTotal;

  // Show bluff popup first
  const bluffText=myName.toUpperCase()+' made '+myC+' change'+(myC!==1?'s':'')+'.\n'+oppName.toUpperCase()+' made '+oppC+' change'+(oppC!==1?'s':'')+'.\n\nWho blinked?';
  showGenericPopup(bluffText,()=>{
    // Then show result screen
    show('screen-result');
    document.getElementById('result-verdict').innerHTML='';
    document.getElementById('result-scores').innerHTML='';
    document.getElementById('result-breakdown').innerHTML=
      `<h2 class="result-screen-heading round-result">ROUND ${gameRound+1} RESULTS</h2>`+
      buildResultRow(myName,myResults,myHex,4,faces)+
      buildResultRow(oppName,oppResults,oppHex,4,faces);

    // Hide share button during round results
    const shareBtn=document.querySelector('.share-btn');
    if(shareBtn) shareBtn.style.display='none';

    // Slow card-by-card reveal with sounds
    revealResultCardsAnimated('.result-player-section',4);

    // After 10s move on
    setTimeout(()=>{
      if(!isLast){
        // Show Round 2 popup WHILE still on result screen — no flash
        document.getElementById('faces-row').innerHTML='';
        document.getElementById('status-bar').textContent='';
        showGenericPopup('⚡ NOW FOR ROUND 2 ⚡\nAre you ready?',()=>{
          // Only switch to game screen after popup closes
          document.getElementById('result-breakdown').innerHTML='';
          document.getElementById('result-verdict').innerHTML='';
          show('screen-game');
          renderScoreboard(4);
        });
      } else {
        // Clear stale cards before game over screen loads
        document.getElementById('faces-row').innerHTML='';
        document.getElementById('status-bar').textContent='';
        document.getElementById('result-breakdown').innerHTML='';
        document.getElementById('result-verdict').innerHTML='';
        show('screen-game');
      }
    },10000);
  });
}

// ── GAME OVER ──
function onGameOver(room) {
  stopMusic();
  if(window._oppActivityInterval){ clearInterval(window._oppActivityInterval); window._oppActivityInterval=null; }
  const data=room.finalResults; if(!data) return;
  const {scores,results,faces}=data;
  const myScore=scores[myName]||0,oppScore=scores[oppName]||0;
  const myResults=results[myName]||{},oppResults=results[oppName]||{};
  const won=myScore>oppScore,draw=myScore===oppScore;
  const myHex=myColour==='red'?'#e53e3e':'#3182ce';
  const oppHex=myColour==='red'?'#3182ce':'#e53e3e';

  show('screen-result');
  const shareBtn2 = document.querySelector('.share-btn');
  if(shareBtn2) shareBtn2.style.display = '';
  document.getElementById('result-verdict').innerHTML='';
  document.getElementById('result-scores').innerHTML='';
  document.getElementById('result-breakdown').innerHTML=
    '<h2 class="result-screen-heading final-result">FINAL RESULTS</h2>'+
    buildResultRow(myName,myResults,myHex,8,faces)+
    buildResultRow(oppName,oppResults,oppHex,8,faces);

  // Slow reveal
  revealResultCardsAnimated('.result-player-section',8);

  // Live score ticker
  animateScoreTicker('hdr-my-score',0,myScore,8);
  animateScoreTicker('hdr-opp-score',0,oppScore,8);

  // Winner popup after 12s
  setTimeout(()=>{
    const winText=won?'🏆 '+myName.toUpperCase()+' WINS!':draw?"IT'S A DRAW!":'🏆 '+oppName.toUpperCase()+' WINS!';
    showGenericPopup(winText,()=>{
      if(won) launchFireworks();
      // Show victory or defeat screen
      showEndScreen(won,draw,myScore,oppScore,myHex,oppHex);
    });
  },4000);
}

function showEndScreen(won,draw,myScore,oppScore,myHex,oppHex){
  const v=document.getElementById('result-verdict');
  v.textContent=won?'YOU WIN':draw?'DRAW':'YOU LOSE';
  v.className=won?'win':draw?'draw':'lose';
  // Show rematch button
  const existing=document.getElementById('rematch-btn');
  if(!existing){
    const btn=document.createElement('button');
    btn.id='rematch-btn';
    btn.className='btn-primary';
    btn.style.cssText='max-width:300px;margin-top:12px;background:var(--gold);color:#1a1a1a;font-size:15px;letter-spacing:0.1em;';
    btn.textContent='⚡ REMATCH';
    btn.onclick=requestRematch;
    document.getElementById('screen-result').appendChild(btn);
  }
}

// ── ANIMATED CARD REVEAL ──
function revealResultCardsAnimated(sectionSelector, totalCards){
  const sections=document.querySelectorAll(sectionSelector);
  sections.forEach(section=>{
    const cols=section.querySelectorAll('.result-card-col');
    cols.forEach((col,i)=>{
      col.style.opacity='0';
      col.style.transform='translateY(12px) scale(0.95)';
      col.style.transition='opacity 300ms ease, transform 300ms cubic-bezier(0.16,1,0.3,1)';
      setTimeout(()=>{
        col.style.opacity='1';
        col.style.transform='translateY(0) scale(1)';
        const img=col.querySelector('.result-card-img');
        if(img){
          if(img.classList.contains('correct')) { setTimeout(()=>playSuccessChord(),150); }
          else { setTimeout(()=>playErrorSound(),150); }
        }
      }, i*180 + (section===sections[1]?totalCards*180+200:0));
    });
  });
}

// ── SCORE TICKER ──
function animateScoreTicker(elId, from, to, total){
  const el=document.getElementById(elId); if(!el) return;
  const perCard=180; // ms per card
  let current=from;
  const interval=setInterval(()=>{
    if(current>=to){ el.textContent=to; clearInterval(interval); return; }
    current++;
    el.textContent=current;
    playScoreTickSound();
    el.style.transform='scale(1.3)';
    setTimeout(()=>{ el.style.transform='scale(1)'; },100);
  }, perCard*total/to||500);
}

// ── RESULT ROW BUILDER ──
function buildResultRow(name,playerResults,colour,totalCards,faces){
  const score=Object.values(playerResults).filter(r=>r&&r.right).length;
  const bgColour=colour==='#e53e3e'?'rgba(229,62,62,0.06)':'rgba(49,130,206,0.06)';
  const borderColour=colour==='#e53e3e'?'rgba(229,62,62,0.2)':'rgba(49,130,206,0.2)';
  const cards=Array.from({length:totalCards},(_,qi)=>{
    const r=playerResults[qi];
    if(!r) return '<div class="result-card-col"></div>';
    const face=(faces||[])[r.picked],correctFace=(faces||[])[r.correct];
    if(!face) return '';
    return `<div class="result-card-col">
      <div class="result-card-img ${r.right?'correct':'wrong'}">
        <img src="${cardImg(face)}" alt="${face.name}">
        <div class="result-card-icon">${r.right?'✓':'✗'}</div>
      </div>
      <div class="result-card-name ${r.right?'name-correct':'name-wrong'}">${face.name}</div>
      ${!r.right&&correctFace?`<div class="result-card-answer">✓ ${correctFace.name}</div>`:''}
    </div>`;
  }).join('');
  return `<div class="result-player-section" style="background:${bgColour};border-color:${borderColour}">
    <div class="result-player-name" style="color:${colour}">
      <span>${name.toUpperCase()}</span>
      <span class="result-score-badge" style="background:${colour}">${score}/${totalCards}</span>
    </div>
    <div class="result-cards-row">${cards}</div>
  </div>`;
}

function shareResult(){
  const msg='Come play TELL with me 👀 '+location.origin;
  if(navigator.share) navigator.share({title:'TELL',text:msg,url:location.origin});
  else{ navigator.clipboard.writeText(msg); showToast('Link copied! 👋'); }
}

socket.on('opponent_left',()=>{ showToast('Opponent disconnected. You win! 🏆', 4000, ()=>{ location.href=location.origin; }); });

// ── POPUPS ──
function showRoundPopup(label,callback){ boxingBell(); showPopupText(label,'clamp(48px,14vw,72px)',1800,callback); }
function showGenericPopup(text,callback){
  const len=text.length;
  const size=len<20?'clamp(44px,12vw,68px)':len<50?'clamp(32px,9vw,52px)':len<100?'clamp(24px,6vw,38px)':'clamp(18px,5vw,28px)';
  showPopupText(text,size,3500,callback);
}

function showPopupText(text,fontSize,duration,callback){
  const popup=document.getElementById('popup-letsplay');
  const inner=popup.querySelector('.popup-inner');
  const textEl=popup.querySelector('.popup-text');
  const img=popup.querySelector('img');
  img.style.display='none'; textEl.textContent=text; textEl.style.fontSize=fontSize;
  textEl.style.whiteSpace='pre-line'; textEl.style.textAlign='center';
  popup.classList.add('show');
  requestAnimationFrame(()=>{ requestAnimationFrame(()=>{ inner.style.transitionDelay='40ms'; }); });
  let dismissed=false;
  const dismiss=()=>{
    if(dismissed) return; dismissed=true; popup.onclick=null;
    inner.style.transitionDelay='0ms';
    popup.classList.remove('show');
    img.style.display=''; textEl.style.fontSize=''; textEl.style.whiteSpace='';
    playPendingAudio(); // synchronous inside gesture for iOS
    setTimeout(()=>{ if(callback) callback(); },220);
  };
  popup.onclick=dismiss;
  setTimeout(dismiss,duration);
}

// ── TOAST NOTIFICATIONS ──
function showToast(msg, duration=2500, callback=null) {
  let toast = document.getElementById('game-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'game-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => {
    toast.classList.remove('show');
    if (callback) setTimeout(callback, 300);
  }, duration);
}

// ── SCREEN ──
function show(id){ document.querySelectorAll('.screen').forEach(s=>s.classList.toggle('active',s.id===id)); }

// ── FIREWORKS ──
function launchFireworks(){
  const canvas=document.getElementById('fireworks-canvas');
  canvas.style.display='block'; canvas.width=window.innerWidth; canvas.height=window.innerHeight;
  const ctx=canvas.getContext('2d'),particles=[],colours=['#e53e3e','#D4A843','#3182ce','#27ae60','#9b59b6'];
  function burst(x,y){for(let i=0;i<80;i++){const a=Math.random()*Math.PI*2,s=Math.random()*6+2;particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,alpha:1,colour:colours[Math.floor(Math.random()*colours.length)],size:Math.random()*4+2});}}
  let bursts=0; const bi=setInterval(()=>{burst(Math.random()*canvas.width,Math.random()*canvas.height*0.6);if(++bursts>=8)clearInterval(bi);},300);
  function frame(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.x+=p.vx;p.y+=p.vy;p.vy+=0.15;p.alpha-=0.016;if(p.alpha<=0){particles.splice(i,1);continue;}ctx.globalAlpha=p.alpha;ctx.fillStyle=p.colour;ctx.beginPath();ctx.arc(p.x,p.y,p.size,0,Math.PI*2);ctx.fill();}
    ctx.globalAlpha=1;
    if(particles.length>0||bursts<8)requestAnimationFrame(frame);else canvas.style.display='none';
  }
  frame();
}
