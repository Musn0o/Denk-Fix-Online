const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"]
  }
});

// In-memory store for game rooms
const rooms = new Map();

// Helper: Generate a random room code (e.g., DE-123)
function generateRoomCode() {
  const num = Math.floor(100 + Math.random() * 900);
  return `DE-${num}`;
}

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Create Room
  socket.on('create_room', (data, callback) => {
    let roomCode = generateRoomCode();
    // Ensure uniqueness
    while (rooms.has(roomCode)) {
      roomCode = generateRoomCode();
    }

    const playerName = data?.playerName || 'Host';

    rooms.set(roomCode, {
      code: roomCode,
      hostId: socket.id,
      players: [{ id: socket.id, name: playerName, isHost: true, score: 0 }],
      state: 'LOBBY', // LOBBY, PLAYING, CORRECTION, RESULTS
      categories: ['Möbel (Furniture)', 'Essen & Trinken (Food)', 'Kleidung (Clothes)', 'Berufe (Jobs)', 'Tiere (Animals)', 'Körperteile (Body parts)'], 
      currentLetter: '',
      timerSetting: 60,
      history: []
    });

    socket.join(roomCode);
    console.log(`Room created: ${roomCode} by ${socket.id}`);
    
    // Return success to the client
    if (callback) callback({ success: true, roomCode, room: rooms.get(roomCode) });
  });

  // Join Room
  socket.on('join_room', (data, callback) => {
    const { roomCode, playerName } = data || {};
    
    if (!roomCode || !rooms.has(roomCode)) {
      if (callback) callback({ success: false, message: 'Raum nicht gefunden' });
      return;
    }

    const room = rooms.get(roomCode);
    
    // Cap at 8 players
    if (room.players.length >= 8) {
      if (callback) callback({ success: false, message: 'Raum ist voll (Max 8 Spieler)' });
      return;
    }

    if (room.state !== 'LOBBY') {
      if (callback) callback({ success: false, message: 'Spiel läuft bereits' });
      return;
    }

    // Add player
    room.players.push({ id: socket.id, name: playerName || `Spieler ${room.players.length + 1}`, isHost: false, score: 0 });
    socket.join(roomCode);
    
    // Notify others
    io.to(roomCode).emit('player_joined', room.players);
    
    if (callback) callback({ success: true, room });
  });

  // Host Controls: Start Game
  socket.on('start_game', (data, callback) => {
    const { roomCode } = data || {};
    if (!roomCode || !rooms.has(roomCode)) return;
    
    const room = rooms.get(roomCode);
    if (room.hostId !== socket.id) {
      if (callback) callback({ success: false, message: 'Nur der Host kann das Spiel starten' });
      return;
    }

    if (room.players.length < 2) {
      if (callback) callback({ success: false, message: 'Mindestens 2 Spieler erforderlich' });
      return;
    }

    // Generate random German letter (excluding Q, X, Y unless specified)
    const letters = 'A,B,C,D,E,F,G,H,I,J,K,L,M,N,O,P,R,S,T,U,V,W,Z,Ä,Ö,Ü'.split(',');
    const randomLetter = letters[Math.floor(Math.random() * letters.length)];
    
    room.state = 'PLAYING';
    room.currentLetter = randomLetter;
    
    // Server authoritative timer using host setting
    const TOTAL_TIME = room.timerSetting || 60;
    room.timer = TOTAL_TIME;

    io.to(roomCode).emit('game_started', {
      letter: randomLetter,
      timer: room.timer,
      categories: room.categories
    });

    // Start Server-side Timer Countdown
    const interval = setInterval(() => {
      room.timer--;
      // Optionally broadcast time or rely on client, but broadcast is safer for sync
      io.to(roomCode).emit('timer_sync', { timeLeft: room.timer });

      if (room.timer <= 0) {
        clearInterval(interval);
        room.state = 'CORRECTION';
        io.to(roomCode).emit('hard_stop', { message: 'Zeit abgelaufen!' });
      }
    }, 1000);
    
    // Store interval ID inside the room to clear it later if needed
    room.intervalId = interval;
    if (callback) callback({ success: true });
  });

  // Adjustable Timer Setting
  socket.on('set_game_time', (data) => {
    const { roomCode, timerSetting } = data || {};
    if (!roomCode || !rooms.has(roomCode)) return;

    const room = rooms.get(roomCode);
    if (room.hostId !== socket.id) return;

    room.timerSetting = parseInt(timerSetting) || 60;
    io.to(roomCode).emit('timer_setting_updated', { timerSetting: room.timerSetting });
  });

  // Return to Lobby from Results
  socket.on('return_to_lobby', (data, callback) => {
    const { roomCode } = data || {};
    if (!roomCode || !rooms.has(roomCode)) return;

    const room = rooms.get(roomCode);
    if (room.hostId !== socket.id) {
      if (callback) callback({ success: false, message: 'Nur der Host kann zur Lobby zurückkehren' });
      return;
    }

    room.state = 'LOBBY';
    room.currentCategoryIndex = 0;
    
    // Clear per-round player data but keep total scores
    room.players.forEach(p => {
      p.answers = {};
      p.hasSubmitted = false;
      p.vetoes = {};
    });

    if (room.intervalId) clearInterval(room.intervalId);

    io.to(roomCode).emit('returned_to_lobby', { room });
    if (callback) callback({ success: true });
  });

  // Collect Answers
  socket.on('submit_answers', (data) => {
    const { roomCode, answers } = data || {};
    if (!roomCode || !rooms.has(roomCode)) return;
    
    const room = rooms.get(roomCode);
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    player.answers = answers || {};
    player.hasSubmitted = true;

    // Check if everyone submitted
    const allSubmitted = room.players.every(p => p.hasSubmitted);
    if (allSubmitted) {
      if (room.intervalId) clearInterval(room.intervalId);
      room.state = 'CORRECTION';
      room.currentCategoryIndex = 0; // Veto one category at a time
      
      broadcastCorrectionState(roomCode);
    }
  });

  socket.on('veto_answer', (data) => {
    const { roomCode, category, playerId } = data || {};
    if (!roomCode || !rooms.has(roomCode)) return;

    const room = rooms.get(roomCode);
    const targetPlayer = room.players.find(p => p.id === playerId);
    if (!targetPlayer || !targetPlayer.answers) return;

    // Initialize vetoes for that answer if not present
    if (!targetPlayer.vetoes) targetPlayer.vetoes = {};
    if (!targetPlayer.vetoes[category]) targetPlayer.vetoes[category] = new Set();

    // Toggle veto
    if (targetPlayer.vetoes[category].has(socket.id)) {
      targetPlayer.vetoes[category].delete(socket.id);
    } else {
      targetPlayer.vetoes[category].add(socket.id);
    }

    broadcastCorrectionState(roomCode);
  });

  socket.on('next_category', (data) => {
    const { roomCode } = data || {};
    const room = rooms.get(roomCode);
    if (!room || room.hostId !== socket.id) return;

    if (room.currentCategoryIndex < room.categories.length - 1) {
      room.currentCategoryIndex++;
      broadcastCorrectionState(roomCode);
    } else {
      // Calculate final scores for the round
      calculateScores(room);
      room.state = 'RESULTS';
      io.to(roomCode).emit('show_results', { players: room.players });
    }
  });

  function broadcastCorrectionState(roomCode) {
    const room = rooms.get(roomCode);
    const category = room.categories[room.currentCategoryIndex];
    
    // Prepare answers for this category
    const categoryAnswers = room.players.map(p => ({
      playerId: p.id,
      playerName: p.name,
      answer: p.answers[category] || '',
      vetoes: Array.from(p.vetoes?.[category] || []),
      isDuplicate: false // Will be set below
    }));

    // Auto-Duplicate Check
    const counts = {};
    categoryAnswers.forEach(a => {
      const val = a.answer.trim().toLowerCase();
      if (val) counts[val] = (counts[val] || 0) + 1;
    });
    categoryAnswers.forEach(a => {
      const val = a.answer.trim().toLowerCase();
      if (val && counts[val] > 1) a.isDuplicate = true;
    });

    io.to(roomCode).emit('correction_update', {
      category,
      categoryIndex: room.currentCategoryIndex,
      totalCategories: room.categories.length,
      answers: categoryAnswers
    });
  }

  function calculateScores(room) {
    room.categories.forEach(cat => {
      // Get all answers for this category
      const answers = room.players.map(p => ({
        player: p,
        val: (p.answers?.[cat] || '').trim().toLowerCase(),
        vetoed: (p.vetoes?.[cat]?.size || 0) >= 1 // For now, 1 veto is enough
      }));

      const counts = {};
      answers.forEach(a => {
        if (a.val && !a.vetoed) counts[a.val] = (counts[a.val] || 0) + 1;
      });

      room.players.forEach(p => {
        const val = (p.answers?.[cat] || '').trim().toLowerCase();
        const vetoed = (p.vetoes?.[cat]?.size || 0) >= 1;

        if (!val || vetoed) {
          // 0 points
        } else if (counts[val] > 1) {
          p.score += 5;
        } else {
          p.score += 10;
        }
      });
    });
  }

  // Handle Disconnect
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    // Cleanup player from rooms
    rooms.forEach((room, roomCode) => {
      const playerIndex = room.players.findIndex(p => p.id === socket.id);
      if (playerIndex !== -1) {
        room.players.splice(playerIndex, 1);
        
        if (room.players.length === 0) {
          rooms.delete(roomCode); // Clean up empty room
        } else {
          // If host left, assign new host
          if (room.hostId === socket.id) {
            room.hostId = room.players[0].id;
            room.players[0].isHost = true;
          }
          io.to(roomCode).emit('player_left', room.players);
        }
      }
    });
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Socket.IO game server running on port ${PORT}`);
});
