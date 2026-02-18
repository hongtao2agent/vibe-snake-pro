(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const overlay = document.getElementById('overlay');
  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const stageWrap = document.querySelector('.stage-wrap');

  const GRID = 21;
  const SIZE = canvas.width / GRID;
  const BASE_TICK = 120;

  let snake, dir, inputQueue, food, score, best, gameOver, paused, shield, speedBoostUntil, obstacles, acc, last;
  let particles = [];

  const rand = n => Math.floor(Math.random() * n);
  const key = () => `snake_best_v1`;
  const now = () => performance.now();

  /* ═══════════════════════════════════
     🔊 Sound Effects (Web Audio API)
     ═══════════════════════════════════ */
  let audioCtx;
  function getAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }

  function playTone(freq, dur, type = 'square', vol = 0.15) {
    try {
      const a = getAudio();
      const osc = a.createOscillator();
      const gain = a.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol, a.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
      osc.connect(gain);
      gain.connect(a.destination);
      osc.start(a.currentTime);
      osc.stop(a.currentTime + dur);
    } catch(e) {}
  }

  function sfxEat() {
    playTone(587, 0.08, 'square', 0.12);
    setTimeout(() => playTone(784, 0.1, 'square', 0.12), 60);
  }

  function sfxBoost() {
    playTone(523, 0.06, 'sawtooth', 0.1);
    setTimeout(() => playTone(659, 0.06, 'sawtooth', 0.1), 50);
    setTimeout(() => playTone(880, 0.12, 'sawtooth', 0.1), 100);
  }

  function sfxShield() {
    playTone(440, 0.1, 'sine', 0.15);
    setTimeout(() => playTone(660, 0.15, 'sine', 0.15), 80);
    setTimeout(() => playTone(880, 0.2, 'sine', 0.12), 160);
  }

  function sfxDie() {
    playTone(300, 0.15, 'sawtooth', 0.2);
    setTimeout(() => playTone(200, 0.2, 'sawtooth', 0.2), 100);
    setTimeout(() => playTone(100, 0.4, 'sawtooth', 0.15), 200);
  }

  function sfxShieldBreak() {
    playTone(800, 0.05, 'square', 0.12);
    setTimeout(() => playTone(400, 0.15, 'square', 0.1), 40);
  }

  function sfxMove() {
    playTone(120, 0.03, 'sine', 0.03);
  }

  function sfxStart() {
    [523, 659, 784, 1047].forEach((f, i) => {
      setTimeout(() => playTone(f, 0.12, 'square', 0.1), i * 80);
    });
  }

  /* ═══════════════════════════════════
     🎮 Game Logic
     ═══════════════════════════════════ */

  function reset() {
    snake = [{x: 10, y: 10}, {x: 9, y: 10}, {x: 8, y: 10}];
    particles = [];
    dir = {x: 1, y: 0};
    inputQueue = [];
    score = 0;
    gameOver = false;
    paused = false;
    shield = 0;
    speedBoostUntil = 0;
    obstacles = [];
    acc = 0;
    last = now();
    spawnFood();
    scoreEl.textContent = score;
    best = Number(localStorage.getItem(key()) || 0);
    bestEl.textContent = best;
    pauseBtn.textContent = '暂停';
    overlay.classList.remove('show');
  }

  function randomEmptyCell() {
    while (true) {
      const c = {x: rand(GRID), y: rand(GRID)};
      const hitSnake = snake.some(s => s.x === c.x && s.y === c.y);
      const hitObs = obstacles.some(o => o.x === c.x && o.y === c.y);
      const hitFood = food && food.x === c.x && food.y === c.y;
      if (!hitSnake && !hitObs && !hitFood) return c;
    }
  }

  function spawnFood() {
    const c = randomEmptyCell();
    const r = Math.random();
    const type = r < 0.12 ? 'boost' : r < 0.2 ? 'shield' : 'normal';
    food = {...c, type};
  }

  function addObstacle() {
    if (obstacles.length >= 12) return;
    obstacles.push(randomEmptyCell());
  }

  function burst(x, y, color = '#5eead4', n = 12, speed = 1.8) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 0.5 + Math.random() * speed;
      particles.push({
        x: (x + 0.5) * SIZE,
        y: (y + 0.5) * SIZE,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: 24 + Math.random() * 16,
        color,
        r: 1.5 + Math.random() * 2.5
      });
    }
  }

  function updateParticles() {
    particles = particles.filter(p => p.life > 0);
    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.97;
      p.vy *= 0.97;
      p.life -= 1;
    });
  }

  function shakeStage() {
    stageWrap.classList.remove('fx-shake');
    void stageWrap.offsetWidth;
    stageWrap.classList.add('fx-shake');
  }

  function setDir(x, y) {
    const lastPlanned = inputQueue.length ? inputQueue[inputQueue.length - 1] : dir;
    // 禁止180°反向
    if (x === -lastPlanned.x && y === -lastPlanned.y) return;
    // 缓冲最多3步，手感更跟手
    if (inputQueue.length >= 3) inputQueue.shift();
    inputQueue.push({ x, y });
  }

  let moveSound = 0;
  function loop(t) {
    if (gameOver) return;
    requestAnimationFrame(loop);
    if (paused) { draw(); return; }

    const dt = t - last;
    last = t;
    acc += dt;

    const tick = now() < speedBoostUntil ? 80 : BASE_TICK;
    while (acc >= tick) {
      acc -= tick;
      step();
      if (gameOver) break;
    }
    draw();
  }

  function step() {
    if (inputQueue.length) {
      dir = inputQueue.shift();
    }
    const head = {x: snake[0].x + dir.x, y: snake[0].y + dir.y};

    // 撞墙即死
    const hitWall = head.x < 0 || head.x >= GRID || head.y < 0 || head.y >= GRID;
    const hitSelf = !hitWall && snake.some(s => s.x === head.x && s.y === head.y);
    const hitObs = !hitWall && obstacles.some(o => o.x === head.x && o.y === head.y);
    if (hitWall || hitSelf || hitObs) {
      if (shield > 0) {
        shield--;
        sfxShieldBreak();
        burst(snake[0].x, snake[0].y, '#a78bfa', 16, 2.2);
        shakeStage();
      } else {
        sfxDie();
        burst(snake[0].x, snake[0].y, '#fb7185', 26, 3);
        shakeStage();
        endGame();
        return;
      }
    }

    snake.unshift(head);

    if (head.x === food.x && head.y === food.y) {
      if (food.type === 'normal') { score += 10; sfxEat(); burst(head.x, head.y, '#f59e0b', 14, 2.1); }
      if (food.type === 'boost') { score += 20; speedBoostUntil = now() + 7000; sfxBoost(); burst(head.x, head.y, '#22d3ee', 18, 2.4); }
      if (food.type === 'shield') { score += 15; shield = 1; sfxShield(); burst(head.x, head.y, '#a78bfa', 20, 2.6); }
      if (score % 50 === 0) addObstacle();
      spawnFood();
    } else {
      snake.pop();
      burst(head.x, head.y, now() < speedBoostUntil ? '#22d3ee' : '#5eead4', 2, 0.6);
      // 轻微移动音（每3步播一次，不吵）
      moveSound++;
      if (moveSound % 3 === 0) sfxMove();
    }

    scoreEl.textContent = score;
    if (score > best) {
      best = score;
      bestEl.textContent = best;
      localStorage.setItem(key(), String(best));
    }
  }

  function endGame() {
    gameOver = true;
    overlay.innerHTML = `
      <h1>游戏结束</h1>
      <p>本局得分：<b>${score}</b> ｜ 最高分：<b>${best}</b></p>
      <button id="restartBtn">再来一局</button>
    `;
    overlay.classList.add('show');
    document.getElementById('restartBtn').onclick = () => { overlay.innerHTML = `
      <h1>Snake Pro</h1>
      <p>滑动屏幕或使用方向键控制</p>
      <p>🍎普通食物 +10｜⚡加速 +20｜🛡️护盾防撞一次</p>
      <button id="startBtn">开始游戏</button>`;
      document.getElementById('startBtn').onclick = start;
      start();
    };
  }

  function drawCell(x, y, color, r = 0.2) {
    const px = x * SIZE;
    const py = y * SIZE;
    const rr = SIZE * r;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(px + rr, py);
    ctx.arcTo(px + SIZE, py, px + SIZE, py + SIZE, rr);
    ctx.arcTo(px + SIZE, py + SIZE, px, py + SIZE, rr);
    ctx.arcTo(px, py + SIZE, px, py, rr);
    ctx.arcTo(px, py, px + SIZE, py, rr);
    ctx.closePath();
    ctx.fill();
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    updateParticles();

    // grid
    ctx.strokeStyle = 'rgba(255,255,255,.05)';
    for (let i = 0; i <= GRID; i++) {
      ctx.beginPath(); ctx.moveTo(i * SIZE, 0); ctx.lineTo(i * SIZE, canvas.height); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * SIZE); ctx.lineTo(canvas.width, i * SIZE); ctx.stroke();
    }

    obstacles.forEach(o => drawCell(o.x, o.y, '#ef4444', 0.15));

    // food
    const foodColor = food.type === 'normal' ? '#f59e0b' : food.type === 'boost' ? '#22d3ee' : '#a78bfa';
    drawCell(food.x, food.y, foodColor, 0.35);

    // snake
    snake.forEach((s, i) => drawCell(s.x, s.y, i === 0 ? '#34d399' : '#10b981', 0.25));

    // head glow
    const hx = (snake[0].x + 0.5) * SIZE;
    const hy = (snake[0].y + 0.5) * SIZE;
    const g = ctx.createRadialGradient(hx, hy, 2, hx, hy, SIZE * 1.2);
    g.addColorStop(0, 'rgba(94,234,212,.45)');
    g.addColorStop(1, 'rgba(94,234,212,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(hx, hy, SIZE * 1.2, 0, Math.PI * 2);
    ctx.fill();

    // particles
    particles.forEach(p => {
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, p.life / 30);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    if (paused) {
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 28px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('已暂停', canvas.width / 2, canvas.height / 2);
      ctx.textAlign = 'start';
    }
  }

  function start() {
    reset();
    sfxStart();
    requestAnimationFrame(loop);
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'ArrowUp' || e.key.toLowerCase() === 'w') setDir(0, -1);
    if (e.key === 'ArrowDown' || e.key.toLowerCase() === 's') setDir(0, 1);
    if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') setDir(-1, 0);
    if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') setDir(1, 0);
    if (e.code === 'Space') togglePause();
  });

  document.querySelectorAll('.controls button').forEach(btn => {
    const triggerDir = (e) => {
      if (e && e.cancelable) e.preventDefault();
      const d = btn.dataset.dir;
      if (d === 'up') setDir(0, -1);
      if (d === 'down') setDir(0, 1);
      if (d === 'left') setDir(-1, 0);
      if (d === 'right') setDir(1, 0);
      btn.classList.add('pressed');
      setTimeout(() => btn.classList.remove('pressed'), 80);
      if (navigator.vibrate) navigator.vibrate(6);
    };

    // iOS/Safari 优先 touchstart，桌面走 mousedown，避免 click 延迟/重复触发
    btn.addEventListener('touchstart', triggerDir, { passive: false });
    btn.addEventListener('mousedown', triggerDir);
  });

  // swipe
  let sx = 0, sy = 0;
  canvas.addEventListener('touchstart', e => {
    const t = e.changedTouches[0];
    sx = t.clientX; sy = t.clientY;
  }, { passive: true });
  canvas.addEventListener('touchend', e => {
    const t = e.changedTouches[0];
    const dx = t.clientX - sx;
    const dy = t.clientY - sy;
    if (Math.abs(dx) > Math.abs(dy)) setDir(dx > 0 ? 1 : -1, 0);
    else setDir(0, dy > 0 ? 1 : -1);
  }, { passive: true });

  function togglePause() {
    if (gameOver) return;
    paused = !paused;
    pauseBtn.textContent = paused ? '继续' : '暂停';
  }

  pauseBtn.addEventListener('click', togglePause);
  startBtn.onclick = start;
})();
