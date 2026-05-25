// ── TELL server.js v6 — Two rounds of 3 ──

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
const socketRoom = {};

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

// Split 6 faces into 2 random groups of 3, shuffle questions within each group
// Ensure question order never matches face display order
function prepareGame(game) {
  const g = JSON.parse(JSON.stringify(game));

  // Shuffle all 6 faces randomly
  const shuffledFaces = shuffle(g.faces);

  // Split into two rounds of 3
  const round1Faces = shuffledFaces.slice(0, 3);
  const round2Faces = shuffledFaces.slice(3, 6);

  // Get questions for each round based on which faces are in it
  // Each face has a corresponding question
  const getQuestionsForFaces = (facesSubset) => {
    // Find the original questions for these faces
    let questions = facesSubset.map(face => {
      const origIdx = g.faces.findIndex(f => f.name === face.name);
      return { ...g.questions[origIdx], faceName: face.name };
    });
    // Shuffle questions so order doesn't match face order
    questions = shuffle(questions);
    // Remap answerIndex to position within this subset
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
io.on('connection', (socket) => {

  socket.on('create_room', async ({ name }) => {
    const code = generateCode();
    const baseGame = GAMES[Math.floor(Math.random() * GAMES.length)];
    console.log(`CREATE: name=${name} code=${code} game=${baseGame.gameId}`);
    const room = {
      code, game: baseGame,
      players: [{ id: socket.id, name, score: 0, picks: {}, roundScores: [0, 0], changes: [0, 0] }],
      round: 0, phase: 'waiting', roundPicks: {}, currentRound: 0
    };
    await db.ref(`rooms/${code}`).set(room);
    setTimeout(() => db.ref(`rooms/${code}`).remove(), 30 * 60 * 1000);
    socketRoom[socket.id] = code;
    socket.join(code);
    socket.emit('room_created', { code });
  });

  socket.on('join_room', async ({ name, code }) => {
    console.log(`JOIN: name=${name} code=${code}`);
    const room = await getRoom(code);
    if (!room) return socket.emit('join_error', { message: 'Room not found.' });
    if (room.players && room.players.length >= 2) return socket.emit('join_error', { message: 'Room is full.' });
    if (room.phase !== 'waiting') return socket.emit('join_error', { message: 'Game already started.' });

    const players = room.players || [];
    players.push({ id: socket.id, name, score: 0, picks: {}, roundScores: [0, 0], changes: [0, 0] });

    const preparedGame = prepareGame(room.game);
    await db.ref(`rooms/${code}`).update({ players, game: preparedGame, phase: 'playing' });

    socketRoom[socket.id] = code;
    socket.join(code);

    io.to(code).emit('game_start', {
      game: preparedGame,
      players: [
        { name: players[0].name, playerIndex: 0 },
        { name: players[1].name, playerIndex: 1 }
      ]
    });

    setTimeout(() => startQuestion(code, 0, 0), 8000);
  });

  socket.on('rejoin_room', async ({ code, name }) => {
    const room = await getRoom(code);
    if (!room) return;
    const player = (room.players || []).find(p => p.name === name);
    if (player) {
      console.log(`REJOIN: ${name} back in room ${code}`);
      player.id = socket.id;
      socketRoom[socket.id] = code;
      socket.join(code);
      await db.ref(`rooms/${code}/players`).set(room.players);
    }
  });

  socket.on('submit_pick', async ({ faceIndex }) => {
    const code = socketRoom[socket.id];
    if (!code) return;
    const room = await getRoom(code);
    if (!room || room.phase !== 'picking') return;

    const roundPicks = room.roundPicks || {};
    roundPicks[socket.id] = faceIndex;

    const players = room.players;
    const player = players.find(p => p.id === socket.id);
    if (player) {
      if (!player.picks) player.picks = {};
      // Key: "round_question" e.g. "0_1"
      player.picks[`${room.currentRound}_${room.round}`] = faceIndex;
    }

    await db.ref(`rooms/${code}`).update({ roundPicks, players });

    const submitterName = player ? player.name : '';
    io.to(code).emit('pick_made', { round: room.round, submitterName, faceIndex });

    if (Object.keys(roundPicks).length === 2) revealQuestion(code);
  });

  socket.on('submit_final', async ({ picks, changes }) => {
    const code = socketRoom[socket.id];
    if (!code) return;
    const room = await getRoom(code);
    if (!room || room.phase !== 'final') return;

    const players = room.players;
    const player = players.find(p => p.id === socket.id);
    if (player) {
      if (!player.picks) player.picks = {};
      Object.assign(player.picks, picks);
      player.finalSubmitted = true;
      if (!player.changes) player.changes = [0, 0];
      player.changes[room.currentRound] = changes || 0;
    }

    await db.ref(`rooms/${code}`).update({ players });

    if (players.every(p => p.finalSubmitted)) resolveRound(code);
  });

  socket.on('disconnect', async () => {
    const code = socketRoom[socket.id];
    delete socketRoom[socket.id];
    if (!code) return;
    const room = await getRoom(code);
    if (!room) return;
    const remaining = (room.players || []).find(p => p.id !== socket.id);
    if (remaining) io.to(remaining.id).emit('opponent_left');
    await deleteRoom(code);
  });
});

// ── QUESTION FLOW ──
// currentRound = 0 or 1 (game round)
// round = question index within that round (0, 1, 2)

async function startQuestion(code, gameRound, questionIdx) {
  const room = await getRoom(code);
  if (!room) return;

  await db.ref(`rooms/${code}`).update({
    round: questionIdx,
    currentRound: gameRound,
    roundPicks: {},
    phase: 'picking'
  });

  const q = room.game.rounds[gameRound].questions[questionIdx];
  io.to(code).emit('question_start', {
    gameRound,
    questionIdx,
    totalQuestions: 3,
    question: q.text,
    faces: room.game.rounds[gameRound].faces
  });
}

async function revealQuestion(code) {
  const room = await getRoom(code);
  if (!room) return;

  await db.ref(`rooms/${code}`).update({ phase: 'revealing' });

  const [p1, p2] = room.players;
  // Extract just this round's picks, keyed by questionIdx only
  const roundPrefix = `${room.currentRound}_`;
  const extractRoundPicks = (picks) => {
    const result = {};
    Object.keys(picks || {}).forEach(k => {
      if (k.startsWith(roundPrefix)) result[parseInt(k.replace(roundPrefix,''))] = picks[k];
    });
    return result;
  };

  io.to(code).emit('question_reveal', {
    gameRound: room.currentRound,
    questionIdx: room.round,
    picks: {
      [p1.name]: extractRoundPicks(p1.picks),
      [p2.name]: extractRoundPicks(p2.picks)
    }
  });

  setTimeout(() => {
    if (room.round < 2) {
      // Next question in same round
      setTimeout(() => startQuestion(code, room.currentRound, room.round + 1), 2000);
    } else {
      // All 3 questions done — go to final phase for this round
      setTimeout(() => startFinalPhase(code), 2000);
    }
  }, 2500);
}

async function startFinalPhase(code) {
  const room = await getRoom(code);
  if (!room) return;

  await db.ref(`rooms/${code}`).update({ phase: 'final' });

  // Reset finalSubmitted
  const players = room.players;
  players.forEach(p => { p.finalSubmitted = false; });
  await db.ref(`rooms/${code}/players`).set(players);

  const [p1, p2] = room.players;
  const roundFaces = room.game.rounds[room.currentRound].faces;
  const roundQuestions = room.game.rounds[room.currentRound].questions;

  // Build picks for just this round
  const prefix = `${room.currentRound}_`;
  const p1RoundPicks = {};
  const p2RoundPicks = {};
  Object.keys(p1.picks || {}).forEach(k => {
    if (k.startsWith(prefix)) p1RoundPicks[k.replace(prefix, '')] = p1.picks[k];
  });
  Object.keys(p2.picks || {}).forEach(k => {
    if (k.startsWith(prefix)) p2RoundPicks[k.replace(prefix, '')] = p2.picks[k];
  });

  io.to(code).emit('final_phase', {
    gameRound: room.currentRound,
    picks: { [p1.name]: p1RoundPicks, [p2.name]: p2RoundPicks },
    questions: roundQuestions.map(q => q.text),
    faces: roundFaces
  });

  // Force resolve after 35s
  setTimeout(async () => {
    const r = await getRoom(code);
    if (r && r.phase === 'final') {
      console.log(`Force resolving round ${r.currentRound} for ${code}`);
      const pl = r.players;
      pl.forEach(p => { if (!p.finalSubmitted) p.finalSubmitted = true; });
      await db.ref(`rooms/${code}/players`).set(pl);
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
  const prefix = `${gameRound}_`;

  let p1Score = 0, p2Score = 0;
  const p1Results = {}, p2Results = {};

  roundData.questions.forEach((q, i) => {
    const key = String(i);
    const p1Pick = ((p1.picks || {})[key]) ?? 0;
    const p2Pick = ((p2.picks || {})[key]) ?? 0;
    const p1Right = p1Pick === q.answerIndex;
    const p2Right = p2Pick === q.answerIndex;
    if (p1Right) p1Score++;
    if (p2Right) p2Score++;
    p1Results[key] = { picked: p1Pick, correct: q.answerIndex, right: p1Right };
    p2Results[key] = { picked: p2Pick, correct: q.answerIndex, right: p2Right };
  });

  // Update cumulative scores
  if (!p1.roundScores) p1.roundScores = [0, 0];
  if (!p2.roundScores) p2.roundScores = [0, 0];
  p1.roundScores[gameRound] = p1Score;
  p2.roundScores[gameRound] = p2Score;
  p1.score = p1.roundScores.reduce((a, b) => a + b, 0);
  p2.score = p2.roundScores.reduce((a, b) => a + b, 0);

  await db.ref(`rooms/${code}/players`).set([p1, p2]);
  await db.ref(`rooms/${code}`).update({ phase: 'round_result' });

  io.to(code).emit('round_result', {
    gameRound,
    roundScores: { [p1.name]: p1Score, [p2.name]: p2Score },
    totalScores: { [p1.name]: p1.score, [p2.name]: p2.score },
    changes: { [p1.name]: (p1.changes || [])[gameRound] || 0, [p2.name]: (p2.changes || [])[gameRound] || 0 },
    results: { [p1.name]: p1Results, [p2.name]: p2Results },
    faces: roundData.faces
  });

  if (gameRound < 1) {
    // Start round 2 after delay
    setTimeout(() => startQuestion(code, 1, 0), 8000);
  } else {
    // Game over
    setTimeout(() => endGame(code), 1000);
  }
}

async function endGame(code) {
  const room = await getRoom(code);
  if (!room) return;

  const [p1, p2] = room.players;
  const allResults = {};
  const allFaces = [];

  room.game.rounds.forEach((roundData, ri) => {
    roundData.faces.forEach(f => allFaces.push(f));
    roundData.questions.forEach((q, qi) => {
      const key = `${ri}_${qi}`;
      const globalIdx = ri * 3 + qi;
      allResults[p1.name] = allResults[p1.name] || {};
      allResults[p2.name] = allResults[p2.name] || {};
      const p1Pick = (p1.picks || {})[qi] ?? 0;
      const p2Pick = (p2.picks || {})[qi] ?? 0;
      // Offset face index by round
      const offset = ri * 3;
      allResults[p1.name][globalIdx + 1] = {
        picked: p1Pick + offset,
        correct: q.answerIndex + offset,
        right: p1Pick === q.answerIndex
      };
      allResults[p2.name][globalIdx + 1] = {
        picked: p2Pick + offset,
        correct: q.answerIndex + offset,
        right: p2Pick === q.answerIndex
      };
    });
  });

  io.to(code).emit('game_over', {
    scores: { [p1.name]: p1.score, [p2.name]: p2.score },
    results: allResults,
    faces: allFaces,
    changes: {
      [p1.name]: (p1.changes || []).reduce((a, b) => a + b, 0),
      [p2.name]: (p2.changes || []).reduce((a, b) => a + b, 0)
    }
  });

  setTimeout(() => deleteRoom(code), 30000);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`TELL running on port ${PORT}`));