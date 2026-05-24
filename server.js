// ── TELL server.js v5 ──

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
    console.log('Firebase key file loaded OK');
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
const socketRoom = {}; // socketId -> roomCode

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function shuffleGame(game) {
  const g = JSON.parse(JSON.stringify(game));
  const faces = g.faces;
  for (let i = faces.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [faces[i], faces[j]] = [faces[j], faces[i]];
  }
  g.questions.forEach(q => {
    const answerName = game.faces[q.answerIndex].name;
    q.answerIndex = faces.findIndex(f => f.name === answerName);
  });
  return g;
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

  // CREATE ROOM
  socket.on('create_room', async ({ name }) => {
    const code = generateCode();
    const baseGame = GAMES[Math.floor(Math.random() * GAMES.length)];
    console.log(`CREATE: name=${name} code=${code} game=${baseGame.gameId}`);

    const room = {
      code,
      game: baseGame,
      players: [{ id: socket.id, name, score: 0, picks: {} }],
      round: 0,
      phase: 'waiting',
      roundPicks: {}
    };

    await db.ref(`rooms/${code}`).set(room);
    setTimeout(() => db.ref(`rooms/${code}`).remove(), 30 * 60 * 1000);
    socketRoom[socket.id] = code;
    socket.join(code);
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
    players.push({ id: socket.id, name, score: 0, picks: {} });

    const shuffledGame = shuffleGame(room.game);

    await db.ref(`rooms/${code}`).update({ players, game: shuffledGame, phase: 'playing' });

    socketRoom[socket.id] = code;
    socket.join(code);

    // ── EMIT game_start TO ROOM — both players get it ──
    io.to(code).emit('game_start', {
      game: shuffledGame,
      players: [
        { name: players[0].name, playerIndex: 0 },
        { name: players[1].name, playerIndex: 1 }
      ]
    });

    // Wait for flip animation to complete before starting round 1
    // Flip takes ~3.5s + Let's Play popup 2.5s + 1s delay = 7s total
    setTimeout(() => startRound(code), 8000);
  });

  // REJOIN ROOM
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

  // SUBMIT PICK
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
      player.picks[room.round] = faceIndex;
    }

    await db.ref(`rooms/${code}`).update({ roundPicks, players });

    // Emit pick_made to ROOM not individual IDs
    const submitterId = socket.id;
    io.to(code).emit('pick_made', {
      round: room.round,
      submitterName: player ? player.name : '',
      faceIndex
    });

    if (Object.keys(roundPicks).length === 2) revealRound(code);
  });

  // SUBMIT FINAL
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
      player.changes = changes || 0;
    }

    await db.ref(`rooms/${code}`).update({ players });
    if (players.every(p => p.finalSubmitted)) resolveGame(code);
  });

  // DISCONNECT
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

// ── ROUND FLOW ──
async function startRound(code) {
  const room = await getRoom(code);
  if (!room) return;
  const round = (room.round || 0) + 1;
  await db.ref(`rooms/${code}`).update({ round, roundPicks: {}, phase: 'picking' });
  const q = room.game.questions[round - 1];
  // Emit to room
  io.to(code).emit('round_start', { round, totalRounds: 5, question: q.text });
}

async function revealRound(code) {
  const room = await getRoom(code);
  if (!room) return;
  await db.ref(`rooms/${code}`).update({ phase: 'revealing' });
  const [p1, p2] = room.players;
  // Emit to room — client identifies their own picks by name
  io.to(code).emit('round_reveal', {
    round: room.round,
    picks: {
      [p1.name]: p1.picks || {},
      [p2.name]: p2.picks || {}
    }
  });
  setTimeout(() => {
    if (room.round < 5) setTimeout(() => startRound(code), 2000);
    else setTimeout(() => startFinalPhase(code), 2000);
  }, 2500);
}

async function startFinalPhase(code) {
  const room = await getRoom(code);
  if (!room) return;
  await db.ref(`rooms/${code}`).update({ phase: 'final' });
  const [p1, p2] = room.players;
  // Emit to room — client sorts out their own vs opponent picks
  io.to(code).emit('final_phase', {
    picks: {
      [p1.name]: p1.picks || {},
      [p2.name]: p2.picks || {}
    },
    questions: room.game.questions.map(q => q.text),
    faces: room.game.faces
  });
}

async function resolveGame(code) {
  const room = await getRoom(code);
  if (!room) return;
  await db.ref(`rooms/${code}`).update({ phase: 'done' });
  const [p1, p2] = room.players;
  const questions = room.game.questions;
  let p1Score = 0, p2Score = 0;
  const p1Results = {}, p2Results = {};

  questions.forEach((q, i) => {
    const round = i + 1;
    const p1Pick = (p1.picks || {})[round] ?? 0;
    const p2Pick = (p2.picks || {})[round] ?? 0;
    const p1Right = p1Pick === q.answerIndex;
    const p2Right = p2Pick === q.answerIndex;
    if (p1Right) p1Score++;
    if (p2Right) p2Score++;
    p1Results[round] = { picked: p1Pick, correct: q.answerIndex, right: p1Right };
    p2Results[round] = { picked: p2Pick, correct: q.answerIndex, right: p2Right };
  });

  // Emit to room — each client knows their own name
  io.to(code).emit('game_over', {
    scores: { [p1.name]: p1Score, [p2.name]: p2Score },
    results: { [p1.name]: p1Results, [p2.name]: p2Results },
    changes: { [p1.name]: p1.changes || 0, [p2.name]: p2.changes || 0 },
    faces: room.game.faces,
    questions: questions.map(q => q.text)
  });

  setTimeout(() => deleteRoom(code), 30000);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`TELL running on port ${PORT}`));