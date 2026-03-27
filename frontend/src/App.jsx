import { useState, useEffect } from 'react';
import './App.css';
import { Gamepad2, Users, Timer, Star, CheckCircle, XCircle, AlertCircle, Share2, Copy } from 'lucide-react';
import { socket } from './socket';
import { QRCodeSVG } from 'qrcode.react';

function App() {
  const [playerName, setPlayerName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [room, setRoom] = useState(null);
  const [gameState, setGameState] = useState('JOIN'); // JOIN, LOBBY, PLAYING, CORRECTION, RESULTS
  const [error, setError] = useState('');
  const [timeLeft, setTimeLeft] = useState(0);
  const [currentLetter, setCurrentLetter] = useState('');
  const [answers, setAnswers] = useState({});
  const [isLocked, setIsLocked] = useState(false);
  const [correctionData, setCorrectionData] = useState(null);
  const [finalResults, setFinalResults] = useState(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [timerSetting, setTimerSetting] = useState(60);

  useEffect(() => {
    // Check for room code in URL
    const params = new URLSearchParams(window.location.search);
    const urlRoom = params.get('room');
    if (urlRoom) {
      setRoomCode(urlRoom.toUpperCase());
    }

    socket.connect();

    socket.on('player_joined', (players) => {
      setRoom(prev => ({ ...prev, players }));
    });

    socket.on('player_left', (players) => {
      setRoom(prev => ({ ...prev, players }));
    });

    socket.on('game_started', (data) => {
      setGameState('PLAYING');
      setCurrentLetter(data.letter);
      setTimeLeft(data.timer);
      setAnswers({});
      setIsLocked(false);
    });

    socket.on('timer_sync', (data) => {
      setTimeLeft(data.timeLeft);
    });

    socket.on('hard_stop', () => {
      setIsLocked(true);
      // We'll trust the server to move us to CORRECTION once everyone is in
    });

    socket.on('correction_update', (data) => {
      setGameState('CORRECTION');
      setCorrectionData(data);
    });

    socket.on('show_results', (data) => {
      setGameState('RESULTS');
      setFinalResults(data.players);
    });

    socket.on('returned_to_lobby', (data) => {
      setGameState('LOBBY');
      setRoom(data.room);
      setTimerSetting(data.room.timerSetting || 60);
      setAnswers({});
      setCorrectionData(null);
      setFinalResults(null);
    });

    socket.on('timer_setting_updated', (data) => {
      setTimerSetting(data.timerSetting);
    });

    return () => {
      socket.off('player_joined');
      socket.off('player_left');
      socket.off('game_started');
      socket.off('timer_sync');
      socket.off('hard_stop');
      socket.disconnect();
    };
  }, []);

  const handleCreate = () => {
    if (!playerName.trim()) {
      setError('Bitte Namen eingeben');
      return;
    }
    socket.emit('create_room', { playerName }, (res) => {
      if (res.success) {
        setRoom(res.room);
        setRoomCode(res.roomCode);
        setGameState('LOBBY');
        setError('');
      }
    });
  };

  const handleJoin = (e) => {
    if (e) e.preventDefault();
    if (!playerName.trim() || !roomCode.trim()) {
      setError('Name und Raumcode erforderlich');
      return;
    }
    socket.emit('join_room', { roomCode, playerName }, (res) => {
      if (res.success) {
        setRoom(res.room);
        setGameState('LOBBY');
        setError('');
      } else {
        setError(res.message);
      }
    });
  };

  const startGame = () => {
    socket.emit('start_game', { roomCode }, (res) => {
      if (!res.success) setError(res.message);
    });
  };

  const submitAnswers = () => {
    socket.emit('submit_answers', { roomCode, answers });
  };

  useEffect(() => {
    if (isLocked) {
      submitAnswers();
    }
  }, [isLocked]);

  const handleVeto = (playerId) => {
    socket.emit('veto_answer', { 
      roomCode, 
      category: correctionData.category, 
      playerId 
    });
  };

  const nextCategory = () => {
    socket.emit('next_category', { roomCode });
  };

  const handleTimerChange = (val) => {
    setTimerSetting(val);
    socket.emit('set_game_time', { roomCode, timerSetting: val });
  };

  const returnToLobby = () => {
    socket.emit('return_to_lobby', { roomCode }, (res) => {
      if (res.success) {
        // Clear URL parameters when returning to lobby if they exist
        window.history.replaceState({}, document.title, window.location.pathname);
      }
      if (!res.success) setError(res.message);
    });
  };

  const copyInviteLink = () => {
    const link = `${window.location.origin}?room=${roomCode}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    });
  };

  const handleAnswerChange = (category, value) => {
    if (isLocked) return;
    setAnswers(prev => ({ ...prev, [category]: value }));
  };

  // Render Views
  if (gameState === 'JOIN') {
    return (
      <div className="app-container">
        <header className="hero-section">
          <h1 className="title">
            <Gamepad2 className="title-icon" size={48} />
            Denk Fix
          </h1>
          <p className="subtitle">Das ultimative Scattergories Erlebnis</p>
        </header>

        <main className="main-content">
          <div className="glass-panel login-panel">
            <h2>Spiel Beitreten</h2>
            {error && <div className="error-msg"><AlertCircle size={16}/> {error}</div>}
            <div className="join-form">
              <input 
                type="text" 
                className="input-base" 
                placeholder="Dein Name" 
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
              />
              <input 
                type="text" 
                className="input-base" 
                placeholder="Raumcode (z.B. DE-429)" 
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                maxLength={6}
              />
              <button onClick={handleJoin} className="btn-primary join-btn">
                Beitreten
              </button>
            </div>

            <div className="divider">
              <span>ODER</span>
            </div>

            <button onClick={handleCreate} className="btn-secondary create-btn">
              Neues Spiel Erstellen
            </button>
          </div>
        </main>
      </div>
    );
  }

  if (gameState === 'LOBBY') {
    const isHost = room.players.find(p => p.id === socket.id)?.isHost;
    const inviteLink = `${window.location.origin}?room=${room.code}`;

    return (
      <div className="app-container lobby-container">
        <div className="glass-panel lobby-panel">
          <div className="lobby-header">
            <div className="room-info">
              <span className="room-label">Raumcode</span>
              <h2 className="room-code-display">{room.code}</h2>
            </div>
            
            <div className="qr-section glass-panel">
              <QRCodeSVG 
                value={inviteLink} 
                size={160}
                bgColor={"transparent"}
                fgColor={"#00f0ff"}
                level={"H"}
                includeMargin={false}
              />
              <button onClick={copyInviteLink} className={`copy-link-btn ${copySuccess ? 'success' : ''}`}>
                {copySuccess ? <CheckCircle size={16} /> : <Copy size={16} />}
                {copySuccess ? 'Kopiert!' : 'Link kopieren'}
              </button>
            </div>
          </div>

          <div className="game-settings-section glass-panel">
            <div className="setting-item">
              <label><Timer size={18} /> Rundenzeit: <strong>{timerSetting}s</strong></label>
              {isHost ? (
                <div className="timer-options">
                  {[30, 60, 90, 120].map(val => (
                    <button 
                      key={val} 
                      onClick={() => handleTimerChange(val)}
                      className={`timer-opt-btn ${timerSetting === val ? 'active' : ''}`}
                    >
                      {val}s
                    </button>
                  ))}
                </div>
              ) : (
                <span className="setting-value">{timerSetting} Sekunden</span>
              )}
            </div>
          </div>

          <div className="player-list-section">
            <h3><Users size={20} /> Spieler ({room.players.length}/8)</h3>
            <div className="player-grid">
              {room.players.map(p => (
                <div key={p.id} className="player-card">
                  <div className="player-avatar">
                   {p.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="player-name">
                    {p.name} {p.id === socket.id && '(Du)'}
                    {p.isHost && <Star size={14} className="host-icon" />}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="lobby-actions">
            {isHost ? (
              <button 
                onClick={startGame} 
                className="btn-primary start-btn"
                disabled={room.players.length < 2}
              >
                Spiel Starten
              </button>
            ) : (
              <div className="waiting-msg">Warte auf Host zum Starten...</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (gameState === 'PLAYING') {
    return (
      <div className="app-container game-container">
        <div className="game-header">
          <div className="letter-display glass-panel">
            <span className="letter-label">Buchstabe</span>
            <h1 className="current-letter">{currentLetter}</h1>
          </div>
          <div className="timer-display glass-panel">
            <Timer size={24} className={timeLeft <= 10 ? 'timer-danger' : ''} />
            <span className={`time-left ${timeLeft <= 10 ? 'timer-danger' : ''}`}>
              {timeLeft}s
            </span>
          </div>
        </div>

        <div className="categories-grid">
          {room.categories.map(cat => (
            <div key={cat} className="category-item glass-panel">
              <label>{cat}</label>
              <input 
                type="text" 
                className="input-base"
                placeholder={`${cat} mit ${currentLetter}...`}
                value={answers[cat] || ''}
                onChange={(e) => handleAnswerChange(cat, e.target.value)}
                disabled={isLocked}
              />
            </div>
          ))}
        </div>
        
        {isLocked && <div className="hard-stop-overlay">ZEIT ABGELAUFEN!</div>}
      </div>
    );
  }

  if (gameState === 'CORRECTION' && correctionData) {
    const isHost = room.players.find(p => p.id === socket.id)?.isHost;
    return (
      <div className="app-container correction-container">
        <div className="glass-panel correction-panel">
          <div className="correction-header">
            <span className="step-counter">Kategorie {correctionData.categoryIndex + 1} von {correctionData.totalCategories}</span>
            <h2 className="category-title">{correctionData.category}</h2>
            <p className="category-instruction">Stimmen alle Antworten für "{correctionData.category}" mit dem Buchstaben <strong>{currentLetter}</strong>?</p>
          </div>

          <div className="answers-review-list">
            {correctionData.answers.map(ans => (
              <div key={ans.playerId} className={`answer-card ${ans.vetoes.length > 0 ? 'vetoed' : ''}`}>
                <div className="answer-info">
                  <span className="player-label">{ans.playerName}</span>
                  <div className="answer-text-wrap">
                    <span className="answer-value">{ans.answer || '—'}</span>
                    {ans.isDuplicate && <span className="duplicate-tag">Doppelt (5 Pkt)</span>}
                  </div>
                </div>
                
                <button 
                  onClick={() => handleVeto(ans.playerId)}
                  className={`veto-btn ${ans.vetoes.includes(socket.id) ? 'active' : ''}`}
                  title="Veto einlegen"
                >
                  <XCircle size={20} />
                  <span>{ans.vetoes.length > 0 ? `${ans.vetoes.length} Veto` : 'Veto'}</span>
                </button>
              </div>
            ))}
          </div>

          <div className="correction-footer">
            {isHost ? (
              <button onClick={nextCategory} className="btn-primary next-btn">
                {correctionData.categoryIndex === correctionData.totalCategories - 1 ? 'Ergebnisse ansehen' : 'Nächste Kategorie'}
              </button>
            ) : (
              <div className="waiting-msg">Warte auf Host für nächste Kategorie...</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (gameState === 'RESULTS' && finalResults) {
    const sorted = [...finalResults].sort((a, b) => b.score - a.score);
    return (
      <div className="app-container results-container">
        <div className="glass-panel results-panel">
          <header className="results-header">
            <Star className="winner-icon" size={64} />
            <h1>Ergebnisse</h1>
          </header>

          <div className="leaderboard">
            {sorted.map((p, i) => (
              <div key={p.id} className={`leaderboard-item ${i === 0 ? 'first-place' : ''}`}>
                <span className="rank-num">#{i+1}</span>
                <div className="player-avatar">
                   {p.name.charAt(0).toUpperCase()}
                </div>
                <span className="player-name">{p.name} {p.id === socket.id && '(Du)'}</span>
                <span className="player-score">{p.score} <small>Pkt</small></span>
              </div>
            ))}
          </div>

          <div className="results-actions">
            {room.players.find(p => p.id === socket.id)?.isHost && (
              <button onClick={returnToLobby} className="btn-primary restart-btn">
                Zurück zur Lobby
              </button>
            )}
            <button onClick={() => window.location.reload()} className="btn-secondary back-btn">
              Beenden / Neues Spiel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <div className="glass-panel">
        <h2>Phase: {gameState}</h2>
        <p>In Arbeit...</p>
      </div>
    </div>
  );
}

export default App;
