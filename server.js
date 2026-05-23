// ── TELL server.js v2 ──

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Serve game images from data folder
app.use('/data', express.static(path.join(__dirname, 'data')));

// Load questions
const GAMES = require('./data/questions.json');

// ── ROOMS ──
const rooms = {};

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// ── SOCKET HANDLING ──
io.on('connection', (socket) => {

  // CREATE ROOM
  socket.on('create_room', ({ name }) => {
    const code = generateCode();
    const game = GAMES[0]; // Game1 for now

    rooms[code] = {
      code,
      game,
      players: [{ id: socket.id, name, score: 0, picks: {} }],
      round: 0,           // 0 = not started, 1-5 = rounds, 6 = final phase
      phase: 'waiting',   // waiting | picking | revealing | final | done
      roundPicks: {},     // socketId -> faceIndex for current round
    };

    socket.join(code);
    socket.roomCode = code;
    socket.emit('room_created', { code });
  });

  // JOIN ROOM
  socket.on('join_room', ({ name, code }) => {
    const room = rooms[code];
    if (!room)                    return socket.emit('join_error', { message: 'Room not found.' });
    if (room.players.length >= 2) return socket.emit('join_error', { message: 'Room is full.' });
    if (room.phase !== 'waiting') return socket.emit('join_error', { message: 'Game already started.' });

    room.players.push({ id: socket.id, name, score: 0, picks: {} });
    socket.join(code);
    socket.roomCode = code;

    // Tell both players game is starting
    const [p1, p2] = room.players;
    io.to(p1.id).emit('game_start', {
      myName: p1.name,
      oppName: p2.name,
      game: room.game
    });
    io.to(p2.id).emit('game_start', {
      myName: p2.name,
      oppName: p1.name,
      game: room.game
    });

    room.phase = 'playing';
    setTimeout(() => startRound(code), 2000);
  });

  // SUBMIT PICK (rounds 1-5)
  socket.on('submit_pick', ({ faceIndex }) => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room || room.phase !== 'picking') return;

    room.roundPicks[socket.id] = faceIndex;

    // Store on player
    const player = room.players.find(p => p.id === socket.id);
    if (player) player.picks[room.round] = faceIndex;

    // Notify both immediately of this pick
    const [p1, p2] = room.players;
    io.to(p1.id).emit('pick_made', {
      round: room.round,
      byMe: socket.id === p1.id,
      faceIndex
    });
    io.to(p2.id).emit('pick_made', {
      round: room.round,
      byMe: socket.id === p2.id,
      faceIndex
    });

    // Both picked?
    if (Object.keys(room.roundPicks).length === 2) {
      revealRound(code);
    }
  });

  // SUBMIT FINAL PICKS (final phase)
  socket.on('submit_final', ({ picks }) => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room || room.phase !== 'final') return;

    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      // Merge final picks over existing
      Object.assign(player.picks, picks);
      player.finalSubmitted = true;
    }

    if (room.players.every(p => p.finalSubmitted)) {
      resolveGame(code);
    }
  });

  // DISCONNECT
  socket.on('disconnect', () => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;
    const room = rooms[code];
    const remaining = room.players.find(p => p.id !== socket.id);
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

  io.to(code).emit('round_start', {
    round: room.round,
    totalRounds: 5,
    question: q.text
  });
}

function revealRound(code) {
  const room = rooms[code];
  if (!room) return;
  room.phase = 'revealing';

  const [p1, p2] = room.players;

  // Send each player the full picks state
  io.to(p1.id).emit('round_reveal', {
    round: room.round,
    myPicks: p1.picks,
    oppPicks: p2.picks,
    oppName: p2.name
  });
  io.to(p2.id).emit('round_reveal', {
    round: room.round,
    myPicks: p2.picks,
    oppPicks: p1.picks,
    oppName: p1.name
  });

  // After 2.5s show answer, then after another 2s move to next round
  setTimeout(() => {
    if (room.round < 5) {
      setTimeout(() => startRound(code), 2000);
    } else {
      setTimeout(() => startFinalPhase(code), 2000);
    }
  }, 2500);
}

function startFinalPhase(code) {
  const room = rooms[code];
  if (!room) return;
  room.phase = 'final';

  const [p1, p2] = room.players;

  io.to(p1.id).emit('final_phase', {
    myPicks: p1.picks,
    oppPicks: p2.picks,
    questions: room.game.questions.map(q => q.text)
  });
  io.to(p2.id).emit('final_phase', {
    myPicks: p2.picks,
    oppPicks: p1.picks,
    questions: room.game.questions.map(q => q.text)
  });
}

function resolveGame(code) {
  const room = rooms[code];
  if (!room) return;
  room.phase = 'done';

  const [p1, p2] = room.players;
  const questions = room.game.questions;

  // Score each player
  let p1Score = 0, p2Score = 0;
  const p1Results = {}, p2Results = {};

  questions.forEach((q, i) => {
    const round = i + 1;
    const p1Right = p1.picks[round] === q.answerIndex;
    const p2Right = p2.picks[round] === q.answerIndex;
    if (p1Right) p1Score++;
    if (p2Right) p2Score++;
    p1Results[round] = { picked: p1.picks[round], correct: q.answerIndex, right: p1Right };
    p2Results[round] = { picked: p2.picks[round], correct: q.answerIndex, right: p2Right };
  });

  const p1Won = p1Score > p2Score;
  const p2Won = p2Score > p1Score;
  const draw = p1Score === p2Score;

  io.to(p1.id).emit('game_over', {
    won: p1Won,
    draw,
    myScore: p1Score,
    oppScore: p2Score,
    myName: p1.name,
    oppName: p2.name,
    myResults: p1Results,
    oppResults: p2Results,
    faces: room.game.faces,
    questions: questions.map(q => q.text)
  });

  io.to(p2.id).emit('game_over', {
    won: p2Won,
    draw,
    myScore: p2Score,
    oppScore: p1Score,
    myName: p2.name,
    oppName: p1.name,
    myResults: p2Results,
    oppResults: p1Results,
    faces: room.game.faces,
    questions: questions.map(q => q.text)
  });

  setTimeout(() => delete rooms[code], 30000);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`TELL running on port ${PORT}`));