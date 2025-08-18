import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import korobeinikiAudio from "./assets/Korobeiniki.mp3";

// === Tetris constants ===
const COLS = 10;
const ROWS = 20;

// Tetromino definitions (matrices) and Tailwind color classes
const TETROMINOES = {
  I: { m: [ [1,1,1,1] ], color: "bg-cyan-500" },
  J: { m: [ [1,0,0],[1,1,1] ], color: "bg-blue-500" },
  L: { m: [ [0,0,1],[1,1,1] ], color: "bg-amber-500" },
  O: { m: [ [1,1],[1,1] ], color: "bg-yellow-400" },
  S: { m: [ [0,1,1],[1,1,0] ], color: "bg-green-500" },
  T: { m: [ [0,1,0],[1,1,1] ], color: "bg-fuchsia-500" },
  Z: { m: [ [1,1,0],[0,1,1] ], color: "bg-rose-500" },
};

const BAG_ORDER = Object.keys(TETROMINOES);

function rotateMatrix(mat) {
  const rows = mat.length, cols = mat[0].length;
  const res = Array.from({ length: cols }, () => Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) res[c][rows - 1 - r] = mat[r][c];
  return res;
}

function createEmptyBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

function* bagGenerator() {
  while (true) {
    const bag = [...BAG_ORDER];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    for (const k of bag) yield k;
  }
}

const scoreForClears = (n, level) => {
  const base = [0, 100, 300, 500, 800][n] || 0;
  return base * (level + 1);
};

function TetrisCell({ color }) {
  return (
    <div className={`w-5 h-5 md:w-6 md:h-6 border border-zinc-900/40 rounded-sm ${color ?? "bg-zinc-800"}`} />
  );
}

function NextPreview({ piece }) {
  const grid = useMemo(() => {
    if (!piece) return [];
    const rows = piece.matrix.length;
    const cols = piece.matrix[0].length;
    const g = Array.from({ length: rows }, () => Array(cols).fill(null));
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) if (piece.matrix[r][c]) g[r][c] = piece.color;
    return g;
  }, [piece]);

  return (
    <div className="inline-grid" style={{ gridTemplateColumns: `repeat(${grid[0]?.length || 0}, 1.25rem)` }}>
      {grid.flatMap((row, ri) =>
        (row ?? []).map((cell, ci) => <TetrisCell key={`${ri}-${ci}`} color={cell} />)
      )}
    </div>
  );
}

export default function TetrisGame() {
  const [board, setBoard] = useState(createEmptyBoard);
  const [active, setActive] = useState(null); // {matrix, color, x, y, type}
  const [queue, setQueue] = useState([]);
  const [held, setHeld] = useState(null);
  const [canHold, setCanHold] = useState(true);
  const [running, setRunning] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [lines, setLines] = useState(0);
  const [level, setLevel] = useState(0);
  const [score, setScore] = useState(0);
  const [musicEnabled, setMusicEnabled] = useState(true);
  const bagRef = useRef(bagGenerator());
  const loopRef = useRef(null);
  const containerRef = useRef(null);
  const audioRef = useRef(null);

  const speedMs = Math.max(100, 800 - level * 80);

  const spawnPiece = useCallback((seed = null) => {
    const q = [...queue];
    while (q.length < 5) {
      const nextType = bagRef.current.next().value;
      q.push(nextType);
    }
    const type = seed ?? q.shift();
    const def = TETROMINOES[type];
    const matrix = def.m.map(row => [...row]);
    const color = def.color;
    const x = Math.floor((COLS - matrix[0].length) / 2);
    const y = -matrix.length; // spawn above board
    setQueue(q);
    setActive({ matrix, color, x, y, type });
    setCanHold(true);
  }, [queue]);

  const collision = useCallback((mat, offX, offY) => {
    for (let r = 0; r < mat.length; r++) {
      for (let c = 0; c < mat[0].length; c++) {
        if (!mat[r][c]) continue;
        const nx = offX + c;
        const ny = offY + r;
        if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
        if (ny >= 0 && board[ny][nx]) return true;
      }
    }
    return false;
  }, [board]);

  const merge = useCallback((b, piece) => {
    const newB = b.map(row => [...row]);
    const { matrix, color, x, y } = piece;
    for (let r = 0; r < matrix.length; r++)
      for (let c = 0; c < matrix[0].length; c++)
        if (matrix[r][c]) {
          const ny = y + r; const nx = x + c;
          if (ny >= 0 && ny < ROWS && nx >= 0 && nx < COLS) newB[ny][nx] = color;
        }
    return newB;
  }, []);

  const clearCompleted = useCallback((b) => {
    let cleared = 0;
    const filtered = b.filter(row => {
      const full = row.every(cell => cell);
      if (full) cleared++;
      return !full;
    });
    while (filtered.length < ROWS) filtered.unshift(Array(COLS).fill(null));
    return { board: filtered, cleared };
  }, []);

  // UPDATED: lock a specific piece (not implicit state)
  const lockPiece = useCallback((piece) => {
    if (!piece) return;

    const locksAboveTop = piece.matrix.some((row, r) =>
      row.some((v) => v && (piece.y + r) < 0)
    );

    setBoard(prev => {
      const merged = merge(prev, piece);
      const { board: clearedBoard, cleared } = clearCompleted(merged);

      if (cleared) {
        setLines(l => {
          const newL = l + cleared;
          setLevel(Math.floor(newL / 10));
          return newL;
        });
        setScore(s => s + scoreForClears(cleared, level));
      }
      return clearedBoard;
    });

    if (locksAboveTop) {
      setRunning(false);
      setGameOver(true);
      return;
    }

    spawnPiece();
  }, [clearCompleted, merge, spawnPiece, level]);

  // UPDATED: hard drop computes final y and locks that piece
  const hardDrop = useCallback(() => {
    if (!active) return;
    let y = active.y;
    while (!collision(active.matrix, active.x, y + 1)) y++;
    const dropped = { ...active, y };
    lockPiece(dropped);
  }, [active, collision, lockPiece]);

  const tick = useCallback(() => {
    setActive(p => {
      if (!p) return p;
      const ny = p.y + 1;
      if (!collision(p.matrix, p.x, ny)) return { ...p, y: ny };
      // UPDATED: lock the current piece when it lands
      lockPiece(p);
      return p;
    });
  }, [collision, lockPiece]);

  // Game loop
  useEffect(() => {
    if (!running || gameOver) return;
    clearInterval(loopRef.current);
    loopRef.current = setInterval(tick, speedMs);
    return () => clearInterval(loopRef.current);
  }, [running, gameOver, tick, speedMs]);

  // Start game on first run
  useEffect(() => {
    if (!active && running && !gameOver) spawnPiece();
  }, [active, running, gameOver, spawnPiece]);

  // // Detect game over when spawning intersects
  // useEffect(() => {
  //   if (!active) return;
  //   if (collision(active.matrix, active.x, active.y)) {
  //     setRunning(false);
  //     setGameOver(true);
  //   }
  // }, [active, collision]);

  const reset = () => {
    setBoard(createEmptyBoard());
    setActive(null);
    setQueue([]);
    setHeld(null);
    setCanHold(true);
    setRunning(true);
    setGameOver(false);
    setLines(0);
    setLevel(0);
    setScore(0);
    
    // Restart music when game resets
    if (audioRef.current && musicEnabled) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(e => console.log("Audio play failed:", e));
    }
  };

  const move = (dx) => {
    setActive(p => {
      if (!p) return p;
      const nx = p.x + dx;
      if (!collision(p.matrix, nx, p.y)) return { ...p, x: nx };
      return p;
    });
  };

  const softDrop = () => {
    setActive(p => {
      if (!p) return p;
      const ny = p.y + 1;
      if (!collision(p.matrix, p.x, ny)) return { ...p, y: ny };
      return p;
    });
  };

  const rotate = () => {
    setActive(p => {
      if (!p) return p;
      const rotated = rotateMatrix(p.matrix);
      // basic wall kicks: try offsets
      const kicks = [0, -1, 1, -2, 2];
      for (const k of kicks) {
        if (!collision(rotated, p.x + k, p.y)) return { ...p, matrix: rotated, x: p.x + k };
      }
      return p;
    });
  };

  const hold = () => {
    if (!active || !canHold) return;
    setCanHold(false);
    setHeld(h => {
      if (!h) {
        setActive(null);
        spawnPiece(active.type);
        return { type: active.type, matrix: active.matrix, color: active.color };
      } else {
        const cur = { type: active.type, matrix: active.matrix, color: active.color };
        const def = TETROMINOES[h.type];
        const matrix = def.m.map(row => [...row]);
        const x = Math.floor((COLS - matrix[0].length) / 2);
        const y = -matrix.length;
        setActive({ matrix, color: def.color, x, y, type: h.type });
        return cur;
      }
    });
  };

  const toggleMusic = () => {
    setMusicEnabled(prev => {
      const newState = !prev;
      if (audioRef.current) {
        if (newState) {
          audioRef.current.play().catch(e => console.log("Audio play failed:", e));
        } else {
          audioRef.current.pause();
        }
      }
      return newState;
    });
  };

  // Music control effect
  useEffect(() => {
    if (audioRef.current) {
      if (musicEnabled && running && !gameOver) {
        audioRef.current.play().catch(e => console.log("Audio play failed:", e));
      } else {
        audioRef.current.pause();
      }
    }
  }, [musicEnabled, running, gameOver]);

  // Initialize audio on component mount
  useEffect(() => {
    if (audioRef.current && musicEnabled) {
      audioRef.current.play().catch(e => console.log("Audio play failed:", e));
    }
  }, []);

  // Keyboard handling
  useEffect(() => {
    const onKey = (e) => {
      if (gameOver) return;
      if (["ArrowLeft","ArrowRight","ArrowDown","Space","ArrowUp","KeyZ","KeyX","KeyP","KeyR","KeyC","KeyM"].includes(e.code)) e.preventDefault();
      switch (e.code) {
        case "ArrowLeft": move(-1); break;
        case "ArrowRight": move(1); break;
        case "ArrowDown": softDrop(); break;
        case "ArrowUp":
        case "KeyZ":
        case "KeyX": rotate(); break;
        case "Space": hardDrop(); break;
        case "KeyP": setRunning(r => !r); break;
        case "KeyR": reset(); break;
        case "KeyC": hold(); break;
        case "KeyM": toggleMusic(); break;
        default: break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [gameOver, hardDrop, toggleMusic]);

  // Draw a merged view for render (board + active)
  const renderGrid = useMemo(() => {
    const g = board.map(row => [...row]);
    if (active) {
      const { matrix, color, x, y } = active;
      for (let r = 0; r < matrix.length; r++)
        for (let c = 0; c < matrix[0].length; c++)
          if (matrix[r][c]) {
            const ny = y + r, nx = x + c;
            if (ny >= 0 && ny < ROWS && nx >= 0 && nx < COLS) g[ny][nx] = color;
          }
    }
    return g;
  }, [board, active]);

  // Ghost piece for UX
  const ghostY = useMemo(() => {
    if (!active) return null;
    let y = active.y;
    while (!collision(active.matrix, active.x, y + 1)) y++;
    return y;
  }, [active, collision]);

  const gridTemplate = { gridTemplateColumns: `repeat(${COLS}, 1.5rem)` };

  return (
    <div ref={containerRef} className="w-full h-full min-h-[24rem] flex items-center justify-center p-4">
      {/* Hidden audio element */}
      <audio 
        ref={audioRef}
        src={korobeinikiAudio}
        loop
        volume={0.6}
        preload="auto"
      />
      
      <div className="grid md:grid-cols-[minmax(0,1fr)_auto] gap-4 w-full max-w-5xl">
        {/* Left: Game board */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-semibold">Tetris</h1>
            <div className="flex gap-2">
              <button onClick={() => setRunning(true)} className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white shadow">Start</button>
              <button onClick={() => setRunning(r => !r)} className="px-3 py-1.5 rounded-xl bg-indigo-600 text-white shadow">{running ? "Pause" : "Resume"}</button>
              <button onClick={reset} className="px-3 py-1.5 rounded-xl bg-zinc-700 text-white shadow">Reset</button>
              <button 
                onClick={toggleMusic} 
                className="px-3 py-1.5 rounded-xl bg-purple-600 text-white shadow flex items-center gap-1"
                title={`Music ${musicEnabled ? 'On' : 'Off'} (Press M)`}
              >
                {musicEnabled ? '🔊' : '🔇'}
              </button>
            </div>
          </div>

          <div className="relative inline-grid bg-zinc-900/60 p-2 rounded-2xl shadow-inner" style={gridTemplate}>
            {renderGrid.map((row, ri) =>
              row.map((cell, ci) => {
                // ghost overlay
                let ghost = false;
                if (active && ghostY !== null) {
                  const r = ri - ghostY;
                  const c = ci - active.x;
                  if (r >= 0 && c >= 0 && active.matrix[r] && active.matrix[r][c] === 1) ghost = true;
                }
                return (
                  <div key={`${ri}-${ci}`} className="relative">
                    {ghost && <div className="absolute inset-0 opacity-20 bg-white rounded-sm" />}
                    <TetrisCell color={cell} />
                  </div>
                );
              })
            )}
            {gameOver && (
              <div className="absolute inset-0 bg-black/70 backdrop-blur-sm rounded-2xl flex flex-col items-center justify-center gap-2 text-white">
                <div className="text-3xl font-bold">Game Over</div>
                <div className="opacity-80">Press R to Restart</div>
              </div>
            )}
          </div>

          <div className="text-sm text-zinc-300">
            <div className="font-medium mb-1">Controls</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-y-1 gap-x-4">
              <div><span className="font-semibold">←/→</span> move</div>
              <div><span className="font-semibold">↓</span> soft drop</div>
              <div><span className="font-semibold">Space</span> hard drop</div>
              <div><span className="font-semibold">↑ / Z / X</span> rotate</div>
              <div><span className="font-semibold">C</span> hold</div>
              <div><span className="font-semibold">P</span> pause</div>
              <div><span className="font-semibold">M</span> music toggle</div>
            </div>
          </div>
        </div>

        {/* Right: HUD */}
        <div className="min-w-[14rem] flex flex-col gap-4">
          <div className="p-4 rounded-2xl bg-zinc-900/60 text-zinc-100 shadow">
            <div className="text-sm opacity-80">Score</div>
            <div className="text-3xl font-semibold tabular-nums">{score}</div>
          </div>
          <div className="p-4 rounded-2xl bg-zinc-900/60 text-zinc-100 shadow grid grid-cols-2 gap-4">
            <div>
              <div className="text-sm opacity-80">Level</div>
              <div className="text-2xl font-semibold tabular-nums">{level}</div>
            </div>
            <div>
              <div className="text-sm opacity-80">Lines</div>
              <div className="text-2xl font-semibold tabular-nums">{lines}</div>
            </div>
          </div>
          <div className="p-4 rounded-2xl bg-zinc-900/60 text-zinc-100 shadow">
            <div className="mb-2 text-sm opacity-80">Next</div>
            <div className="flex gap-2 items-end">
              {queue.slice(0, 3).map((t, idx) => {
                const def = TETROMINOES[t];
                const piece = { matrix: def.m, color: def.color };
                return (
                  <div key={idx} className="p-2 rounded-xl bg-zinc-800/70">
                    <NextPreview piece={piece} />
                  </div>
                );
              })}
            </div>
          </div>
          <div className="p-4 rounded-2xl bg-zinc-900/60 text-zinc-100 shadow">
            <div className="mb-2 text-sm opacity-80">Hold</div>
            <div className="p-2 rounded-xl bg-zinc-800/70 min-h-[4.5rem] inline-flex">
              {held ? <NextPreview piece={held} /> : <div className="text-zinc-400 text-sm self-center">(empty)</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
