// ── TELL server.js v3 ──

const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling']
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/data', express.static(path.join(__dirname, 'data')));
app.get('/ping', (req, res) => res.send('ok'));

const GAMES = require('./data/questions.json');
const rooms = {};

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function shuffleGame(game) {
  // Deep copy
  const g = JSON.parse(JSON.stringify(game));
  // Shuffle faces
  const faces = g.faces;
  for (let i = faces.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [faces[i], faces[j]] = [faces[j], faces[i]];
  }
  // Remap answerIndex to new shuffled positions
  g.questions.forEach(q => {
    const answerName = game.faces[q.answerIndex].name;
    q.answerIndex = faces.findIndex(f => f.name === answerName);
  });
  return g;
}

io.on('connection', (socket) => {

  // CREATE ROOM
  socket.on('create_room', ({ name }) => {
    const code = generateCode();
    const baseGame = GAMES[Math.floor(Math.random() * GAMES.length)];
    console.log(`CREATE ROOM: name=${name} code=${code} game=${baseGame.gameId}`);
    rooms[code] = {
      code,
      game: baseGame,           // stored unshuffled
      players: [{ id: socket.id, name, score: 0, picks: {} }],
      round: 0,
      phase: 'waiting',
      roundPicks: {},
    };
    socket.join(code);
    socket.roomCode = code;
    socket.emit('room_created', { code });
  });

  // JOIN ROOM
  socket.on('join_room', ({ name, code }) => {
    console.log(`JOIN attempt: name=${name} code=${code} rooms=[${Object.keys(rooms).join(',')}]`);
    const room = rooms[code];
    if (!room) {
      console.log(`JOIN FAIL: room ${code} not found`);
      return socket.emit('join_error', { message: 'Room not found.' });
    }
    if (room.players.length >= 2) return socket.emit('join_error', { message: 'Room is full.' });
    if (room.phase !== 'waiting') return socket.emit('join_error', { message: 'Game already started.' });

    room.players.push({ id: socket.id, name, score: 0, picks: {} });
    socket.join(code);
    socket.roomCode = code;

    // Shuffle ONCE — same shuffle for both players
    const shuffledGame = shuffleGame(room.game);
    room.game = shuffledGame;

    const [p1, p2] = room.players;
    io.to(p1.id).emit('game_start', { myName: p1.name, oppName: p2.name, game: shuffledGame, playerIndex: 0 });
    io.to(p2.id).emit('game_start', { myName: p2.name, oppName: p1.name, game: shuffledGame, playerIndex: 1 });

    room.phase = 'playing';
    setTimeout(() => startRound(code), 2000);
  });

  // SUBMIT PICK
  socket.on('submit_pick', ({ faceIndex }) => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room || room.phase !== 'picking') return;

    room.roundPicks[socket.id] = faceIndex;
    const player = room.players.find(p => p.id === socket.id);
    if (player) player.picks[room.round] = faceIndex;

    const [p1, p2] = room.players;
    io.to(p1.id).emit('pick_made', { round: room.round, byMe: socket.id === p1.id, faceIndex });
    io.to(p2.id).emit('pick_made', { round: room.round, byMe: socket.id === p2.id, faceIndex });

    if (Object.keys(room.roundPicks).length === 2) revealRound(code);
  });

  // SUBMIT FINAL
  socket.on('submit_final', ({ picks }) => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room || room.phase !== 'final') return;
    const player = room.players.find(p => p.id === socket.id);
    if (player) { Object.assign(player.picks, picks); player.finalSubmitted = true; }
    if (room.players.every(p => p.finalSubmitted)) resolveGame(code);
  });

  // DISCONNECT
  socket.on('disconnect', () => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;
    const remaining = rooms[code].players.find(p => p.id !== socket.id);
    if (remaining) io.to(remaining.id).emit('opponent_left');
    delete rooms[code];
  });
});

// ── ROUND FLOW ──
function startRound(code) {
  const room = rooms[code];
  if (!room) return;
  room.round++;
  room.roundPicks = {};
  room.phase = 'picking';
  const q = room.game.questions[room.round - 1];
  io.to(code).emit('round_start', { round: room.round, totalRounds: 5, question: q.text });
}

function revealRound(code) {
  const room = rooms[code];
  if (!room) return;
  room.phase = 'revealing';
  const [p1, p2] = room.players;
  io.to(p1.id).emit('round_reveal', { round: room.round, myPicks: p1.picks, oppPicks: p2.picks });
  io.to(p2.id).emit('round_reveal', { round: room.round, myPicks: p2.picks, oppPicks: p1.picks });
  setTimeout(() => {
    if (room.round < 5) setTimeout(() => startRound(code), 2000);
    else setTimeout(() => startFinalPhase(code), 2000);
  }, 2500);
}

function startFinalPhase(code) {
  const room = rooms[code];
  if (!room) return;
  room.phase = 'final';
  const [p1, p2] = room.players;
  io.to(p1.id).emit('final_phase', {
    myPicks: p1.picks, oppPicks: p2.picks,
    questions: room.game.questions.map(q => q.text),
    faces: room.game.faces
  });
  io.to(p2.id).emit('final_phase', {
    myPicks: p2.picks, oppPicks: p1.picks,
    questions: room.game.questions.map(q => q.text),
    faces: room.game.faces
  });
}

function resolveGame(code) {
  const room = rooms[code];
  if (!room) return;
  room.phase = 'done';
  const [p1, p2] = room.players;
  const questions = room.game.questions;
  let p1Score = 0, p2Score = 0;
  const p1Results = {}, p2Results = {};
  questions.forEach((q, i) => {
    const round = i + 1;
    const p1Right = p1.picks[round] === q.answerIndex;
    const p2Right = p2.picks[round] === q.answerIndex;
    if (p1Right) p1Score++;
    if (p2Right) p2Score++;
    p1Results[round] = { picked: p1.picks[round] ?? 0, correct: q.answerIndex, right: p1Right };
    p2Results[round] = { picked: p2.picks[round] ?? 0, correct: q.answerIndex, right: p2Right };
  });
  io.to(p1.id).emit('game_over', { won: p1Score > p2Score, draw: p1Score === p2Score, myScore: p1Score, oppScore: p2Score, myName: p1.name, oppName: p2.name, myResults: p1Results, faces: room.game.faces, questions: questions.map(q => q.text) });
  io.to(p2.id).emit('game_over', { won: p2Score > p1Score, draw: p1Score === p2Score, myScore: p2Score, oppScore: p1Score, myName: p2.name, oppName: p1.name, myResults: p2Results, faces: room.game.faces, questions: questions.map(q => q.text) });
  setTimeout(() => delete rooms[code], 30000);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`TELL running on port ${PORT}`));

// Keep alive
setInterval(() => {
  const url = process.env.RENDER_EXTERNAL_URL;
  if (!url) return;
  const mod = url.startsWith('https') ? https : require('http');
  mod.get(url + '/ping', () => {}).on('error', () => {});
}, 10 * 60 * 1000);