// ── TELL server.js v9 — Firebase state, sockets for picks only ──

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const admin = require('firebase-admin');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling']
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/data', express.static(path.join(__dirname, 'data')));
app.get('/ping', (req, res) => res.send('ok'));

// ── FIREBASE ──
let serviceAccount;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    console.log('Loading Firebase from environment variable...');
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    console.log('Firebase env var parsed OK, project:', serviceAccount.project_id);
  } else {
    serviceAccount = require('./firebase-key.json');
  }
} catch(e) {
  console.error('FIREBASE INIT ERROR:', e.message);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://tell-game-default-rtdb.firebaseio.com'
});

const db = admin.database();
db.ref('.info/connected').on('value', snap => console.log('Firebase connected:', snap.val()));
console.log('Firebase admin initialized');

const GAMES = require('./data/questions.json');

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function prepareGame(game) {
  const g = JSON.parse(JSON.stringify(game));
  const shuffledFaces = shuffle(g.faces);
  const round1Faces = shuffledFaces.slice(0, 4);
  const round2Faces = shuffledFaces.slice(4, 8);

  const getQuestionsForFaces = (facesSubset) => {
    let questions = facesSubset.map(face => {
      const origIdx = g.faces.findIndex(f => f.name === face.name);
      return { ...g.questions[origIdx], faceName: face.name };
    });
    questions = shuffle(questions);
    questions.forEach(q => {
      q.answerIndex = facesSubset.findIndex(f => f.name === q.faceName);
      delete q.faceName;
    });
    return questions;
  };

  return {
    ...g,
    rounds: [
      { faces: round1Faces, questions: getQuestionsForFaces(round1Faces) },
      { faces: round2Faces, questions: getQuestionsForFaces(round2Faces) }
    ]
  };
}

async function getRoom(code) {
  const snap = await db.ref(`rooms/${code}`).once('value');
  return snap.val();
}

async function deleteRoom(code) {
  await db.ref(`rooms/${code}`).remove();
}

// ── SOCKET HANDLING ──
// Sockets are only used for:
// 1. create_room / join_room (setup)
// 2. submit_pick (real-time pick sharing)
// 3. submit_final (final picks)
// Everything else is driven by Firebase listeners on the client

io.on('connection', (socket) => {

  // CREATE ROOM
  socket.on('create_room', async ({ name }) => {
    const code = generateCode();
    const baseGame = GAMES[Math.floor(Math.random() * GAMES.length)];
    console.log(`CREATE: name=${name} code=${code} game=${baseGame.gameId}`);

    const room = {
      code,
      game: baseGame,
      players: [{ name, score: 0, picks: {}, changes: [0,0] }],
      phase: 'waiting',
      currentRound: 0,
      currentQuestion: 0,
      roundPicks: {}
    };

    await db.ref(`rooms/${code}`).set(room);
    setTimeout(() => db.ref(`rooms/${code}`).remove(), 30 * 60 * 1000);
    socket.emit('room_created', { code });
  });

  // JOIN ROOM
  socket.on('join_room', async ({ name, code }) => {
    console.log(`JOIN: name=${name} code=${code}`);
    const room = await getRoom(code);

    if (!room) return socket.emit('join_error', { message: 'Room not found.' });
    if (room.players && room.players.length >= 2) return socket.emit('join_error', { message: 'Room is full.' });
    if (room.phase !== 'waiting') return socket.emit('join_error', { message: 'Game already started.' });

    const players = room.players || [];
    players.push({ name, score: 0, picks: {}, changes: [0,0] });

    const preparedGame = prepareGame(room.game);

    // Write to Firebase — clients are listening and will react automatically
    await db.ref(`rooms/${code}`).update({
      players,
      game: preparedGame,
      phase: 'starting'
    });

    // After 8s (flip animation time) start round 1
    setTimeout(() => startQuestion(code, 0, 0), 8000);
  });

  // SUBMIT PICK — broadcast to room via socket for real-time display
  socket.on('submit_pick', async ({ code, name, faceIndex }) => {
    const room = await getRoom(code);
    if (!room || room.phase !== 'picking') return;

    const roundPicks = room.roundPicks || {};
    roundPicks[name] = faceIndex;

    const players = room.players;
    const player = players.find(p => p.name === name);
    if (player) {
      if (!player.picks) player.picks = {};
      player.picks[`${room.currentRound}_${room.currentQuestion}`] = faceIndex;
    }

    await db.ref(`rooms/${code}`).update({ roundPicks, players });

    // Broadcast pick to all clients in real-time
    io.to(code).emit('pick_made', { submitterName: name, faceIndex });

    if (Object.keys(roundPicks).length >= 2 && room.phase === 'picking') {
      // Guard: set phase to 'revealing' first to prevent double-trigger
      await db.ref(`rooms/${code}`).update({ phase: 'revealing' });
      const fresh = await getRoom(code);
      if (fresh) revealQuestion(code, fresh);
    }
  });

  // JOIN SOCKET ROOM (for pick broadcasts)
  socket.on('join_socket_room', ({ code }) => {
    socket.join(code);
  });

  // SUBMIT FINAL
  socket.on('submit_final', async ({ code, name, picks, changes }) => {
    const room = await getRoom(code);
    if (!room || room.phase !== 'final') return;

    const players = room.players;
    const player = players.find(p => p.name === name);
    if (player) {
      if (!player.picks) player.picks = {};
      const round = room.currentRound;
      Object.keys(picks).forEach(qi => {
        player.picks[`final_${round}_${qi}`] = picks[qi];
      });
      player.finalSubmitted = true;
      if (!player.changes) player.changes = [0,0];
      player.changes[room.currentRound] = changes || 0;
    }

    // Write who has locked in so both clients can show waiting state
    const lockedIn = players.filter(p => p.finalSubmitted).map(p => p.name);
    await db.ref(`rooms/${code}`).update({ players, lockedIn });

    if (players.every(p => p.finalSubmitted)) {
      // Both locked — resolve
      await db.ref(`rooms/${code}`).update({ lockedIn: [] });
      resolveRound(code);
    }
  });
});

// ── GAME FLOW — all state written to Firebase ──

async function startQuestion(code, gameRound, questionIdx) {
  const room = await getRoom(code);
  if (!room) return;

  await db.ref(`rooms/${code}`).update({
    phase: 'picking',
    currentRound: gameRound,
    currentQuestion: questionIdx,
    roundPicks: {}
  });
  // Client Firebase listener picks this up automatically
}

async function revealQuestion(code, room) {
  if (!room) room = await getRoom(code);
  if (!room) return;
  // phase already set to 'revealing' by submit_pick handler
  setTimeout(async () => {
    if (room.currentQuestion < 3) {
      setTimeout(() => startQuestion(code, room.currentRound, room.currentQuestion + 1), 2000);
    } else {
      setTimeout(() => startFinalPhase(code), 2000);
    }
  }, 2500);
}

async function startFinalPhase(code) {
  const room = await getRoom(code);
  if (!room) return;

  const players = room.players;
  players.forEach(p => { p.finalSubmitted = false; });

  await db.ref(`rooms/${code}`).update({ phase: 'final', players, lockedIn: [] });

  // Force resolve after 35s
  setTimeout(async () => {
    const r = await getRoom(code);
    if (r && r.phase === 'final') {
      r.players.forEach(p => { if (!p.finalSubmitted) p.finalSubmitted = true; });
      await db.ref(`rooms/${code}/players`).set(r.players);
      resolveRound(code);
    }
  }, 35000);
}

async function resolveRound(code) {
  const room = await getRoom(code);
  if (!room) return;

  const [p1, p2] = room.players;
  const gameRound = room.currentRound;
  const roundData = room.game.rounds[gameRound];

  let p1Score = 0, p2Score = 0;
  const p1Results = {}, p2Results = {};

  roundData.questions.forEach((q, i) => {
    // Use final picks if available, fall back to initial picks
    const p1FinalKey = `final_${gameRound}_${i}`;
    const p2FinalKey = `final_${gameRound}_${i}`;
    const p1Pick = (p1.picks || {})[p1FinalKey] ?? ((p1.picks || {})[`${gameRound}_${i}`]) ?? 0;
    const p2Pick = (p2.picks || {})[p2FinalKey] ?? ((p2.picks || {})[`${gameRound}_${i}`]) ?? 0;
    const p1Right = p1Pick === q.answerIndex;
    const p2Right = p2Pick === q.answerIndex;
    if (p1Right) p1Score++;
    if (p2Right) p2Score++;
    p1Results[i] = { picked: p1Pick, correct: q.answerIndex, right: p1Right };
    p2Results[i] = { picked: p2Pick, correct: q.answerIndex, right: p2Right };
  });

  if (!p1.roundScores) p1.roundScores = [0,0];
  if (!p2.roundScores) p2.roundScores = [0,0];
  p1.roundScores[gameRound] = p1Score;
  p2.roundScores[gameRound] = p2Score;
  p1.score = p1.roundScores.reduce((a,b) => a+b, 0);
  p2.score = p2.roundScores.reduce((a,b) => a+b, 0);

  await db.ref(`rooms/${code}`).update({
    phase: 'round_result',
    players: [p1, p2],
    lastRoundResults: {
      gameRound,
      roundScores: { [p1.name]: p1Score, [p2.name]: p2Score },
      totalScores:  { [p1.name]: p1.score, [p2.name]: p2.score },
      changes: { [p1.name]: (p1.changes||[])[gameRound]||0, [p2.name]: (p2.changes||[])[gameRound]||0 },
      results: { [p1.name]: p1Results, [p2.name]: p2Results },
      faces: roundData.faces
    }
  });

  if (gameRound < 1) {
    setTimeout(() => startQuestion(code, 1, 0), 20000); // 10s results + popups
  } else {
    setTimeout(() => endGame(code), 20000);
  }
}

async function endGame(code) {
  const room = await getRoom(code);
  if (!room) return;

  const [p1, p2] = room.players;
  const allFaces = [];
  const allResults = { [p1.name]: {}, [p2.name]: {} };

  room.game.rounds.forEach((roundData, ri) => {
    roundData.faces.forEach(f => allFaces.push(f));
    roundData.questions.forEach((q, qi) => {
      const globalIdx = ri * 4 + qi;
      const offset = ri * 4;
      // Always use final picks (prefixed) — they are the authoritative answer after Final Chance
      const p1FinalKey = `final_${ri}_${qi}`;
      const p2FinalKey = `final_${ri}_${qi}`;
      // Fall back to round-prefixed initial picks, then bare index
      const p1Pick = (p1.picks || {})[p1FinalKey]
                  ?? (p1.picks || {})[`${ri}_${qi}`]
                  ?? 0;
      const p2Pick = (p2.picks || {})[p2FinalKey]
                  ?? (p2.picks || {})[`${ri}_${qi}`]
                  ?? 0;
      allResults[p1.name][globalIdx] = { picked: p1Pick + offset, correct: q.answerIndex + offset, right: p1Pick === q.answerIndex };
      allResults[p2.name][globalIdx] = { picked: p2Pick + offset, correct: q.answerIndex + offset, right: p2Pick === q.answerIndex };
    });
  });

  await db.ref(`rooms/${code}`).update({
    phase: 'game_over',
    finalResults: {
      scores: { [p1.name]: p1.score, [p2.name]: p2.score },
      results: allResults,
      changes: {
        [p1.name]: (p1.changes||[]).reduce((a,b)=>a+b,0),
        [p2.name]: (p2.changes||[]).reduce((a,b)=>a+b,0)
      },
      faces: allFaces
    }
  });

  setTimeout(() => deleteRoom(code), 60000);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`TELL running on port ${PORT}`));