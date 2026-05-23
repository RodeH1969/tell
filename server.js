// ── TELL server.js v4 — Firebase Realtime Database ──

const express = require('express');
const http = require('http');
const https = require('https');
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

// ── FIREBASE INIT ──
let serviceAccount;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    console.log('Loading Firebase from environment variable...');
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    console.log('Firebase env var parsed OK, project:', serviceAccount.project_id);
  } else {
    console.log('Loading Firebase from firebase-key.json...');
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
db.ref('.info/connected').on('value', snap => {
  console.log('Firebase connected:', snap.val());
});
console.log('Firebase admin initialized');

const GAMES = require('./data/questions.json');
const socketRoom = {}; // socketId -> roomCode (in-memory, lightweight)

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
  g.questions.forEach((q, qi) => {
    const answerName = game.faces[q.answerIndex].name;
    q.answerIndex = faces.findIndex(f => f.name === answerName);
  });
  return g;
}

async function saveRoom(code, room) {
  await db.ref(`rooms/${code}`).set(room);
  // Auto-delete after 30 minutes
  setTimeout(() => db.ref(`rooms/${code}`).remove(), 30 * 60 * 1000);
}

async function getRoom(code) {
  const snap = await db.ref(`rooms/${code}`).once('value');
  return snap.val();
}

async function updateRoom(code, updates) {
  await db.ref(`rooms/${code}`).update(updates);
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

    await saveRoom(code, room);
    socketRoom[socket.id] = code;
    socket.join(code);
    socket.emit('room_created', { code });
  });

  // JOIN ROOM
  socket.on('join_room', async ({ name, code }) => {
    console.log(`JOIN: name=${name} code=${code}`);
    const room = await getRoom(code);

    if (!room) {
      console.log(`FAIL: room ${code} not in Firebase`);
      return socket.emit('join_error', { message: 'Room not found.' });
    }
    if (room.players && room.players.length >= 2)
      return socket.emit('join_error', { message: 'Room is full.' });
    if (room.phase !== 'waiting')
      return socket.emit('join_error', { message: 'Game already started.' });

    const players = room.players || [];
    players.push({ id: socket.id, name, score: 0, picks: {} });

    const shuffledGame = shuffleGame(room.game);

    await db.ref(`rooms/${code}`).update({
      players,
      game: shuffledGame,
      phase: 'playing'
    });

    socketRoom[socket.id] = code;
    socket.join(code);

    const [p1, p2] = players;
    io.to(p1.id).emit('game_start', { myName: p1.name, oppName: p2.name, game: shuffledGame, playerIndex: 0 });
    io.to(p2.id).emit('game_start', { myName: p2.name, oppName: p1.name, game: shuffledGame, playerIndex: 1 });

    setTimeout(() => startRound(code), 2000);
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

    const [p1, p2] = players;
    io.to(p1.id).emit('pick_made', { round: room.round, byMe: socket.id === p1.id, faceIndex });
    io.to(p2.id).emit('pick_made', { round: room.round, byMe: socket.id === p2.id, faceIndex });

    if (Object.keys(roundPicks).length === 2) revealRound(code);
  });

  // SUBMIT FINAL
  socket.on('submit_final', async ({ picks }) => {
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
  io.to(code).emit('round_start', { round, totalRounds: 5, question: q.text });
}

async function revealRound(code) {
  const room = await getRoom(code);
  if (!room) return;
  await db.ref(`rooms/${code}`).update({ phase: 'revealing' });
  const [p1, p2] = room.players;
  io.to(p1.id).emit('round_reveal', { round: room.round, myPicks: p1.picks || {}, oppPicks: p2.picks || {} });
  io.to(p2.id).emit('round_reveal', { round: room.round, myPicks: p2.picks || {}, oppPicks: p1.picks || {} });
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
  const questions = room.game.questions.map(q => q.text);
  const faces = room.game.faces;
  io.to(p1.id).emit('final_phase', { myPicks: p1.picks || {}, oppPicks: p2.picks || {}, questions, faces });
  io.to(p2.id).emit('final_phase', { myPicks: p2.picks || {}, oppPicks: p1.picks || {}, questions, faces });
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
  io.to(p1.id).emit('game_over', { won: p1Score > p2Score, draw: p1Score === p2Score, myScore: p1Score, oppScore: p2Score, myName: p1.name, oppName: p2.name, myResults: p1Results, faces: room.game.faces, questions: questions.map(q => q.text) });
  io.to(p2.id).emit('game_over', { won: p2Score > p1Score, draw: p1Score === p2Score, myScore: p2Score, oppScore: p1Score, myName: p2.name, oppName: p1.name, myResults: p2Results, faces: room.game.faces, questions: questions.map(q => q.text) });
  setTimeout(() => deleteRoom(code), 30000);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`TELL running on port ${PORT}`));