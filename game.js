'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 로프 스윙: 화면·입력·소리. 규칙은 logic.js (LOGIC_ROPE).
const L = LOGIC_ROPE;
const $ = (id) => document.getElementById(id);
const W = 360, H = 640, S = 0.85;                 // 논리 크기, 세계 → 화면 배율
const canvas = $('game'), ctx = canvas.getContext('2d');

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};

// ---------- 소리 ----------
let audio = null;
let muted = store.get('ropeswingMuted') === '1';
function tone(freq, dur, type = 'triangle', vol = 0.05, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime, o = audio.createOscillator(), g = audio.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination); o.start(t); o.stop(t + dur);
  } catch (_) {}
}
const sfx = {
  attach: () => tone(420, 0.1, 'triangle', 0.06, 700),
  release: (v) => tone(300 + Math.min(300, v * 0.3), 0.18, 'sine', 0.04, -150),
  coin: () => { tone(988, 0.07, 'square', 0.04); setTimeout(() => tone(1319, 0.12, 'square', 0.04), 60); },
  miss: () => tone(160, 0.08, 'square', 0.03, -40),
  die: () => { tone(300, 0.5, 'sawtooth', 0.06, -250); },
  rescue: () => tone(500, 0.2, 'triangle', 0.05, 300),
  best: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.15, 'triangle', 0.06), i * 90)),
  milestone: () => { tone(660, 0.1, 'triangle', 0.05); setTimeout(() => tone(880, 0.12, 'triangle', 0.05), 80); },
};

// ---------- 상태 ----------
let G = L.newGame(L.rng(1), { level: 'normal' });
let state = 'title';                    // title · play · paused · over
let level = 'normal', tut = false;
let best = Number(store.get('ropeswingBest')) || 0;
let cam = { x: 0, top: -20 }, parts = [], floats = [], trail = [], clock = 0, shake = 0, newBest = false, firstAttach = false, lastMile = 0, flash = 0, deathT = 0;
let pointerHeld = null, keyHeld = false;

/* @test-hooks:start */
window.__rs = { get G() { return G; }, get state() { return state; }, L, step: (dt) => update(dt), press: () => doPress(), release: () => doRelease() };
/* @test-hooks:end */

// ---------- 흐름 ----------
function showOverlay(html) { const o = $('overlay'); o.innerHTML = html; o.classList.remove('hidden'); o.querySelectorAll('button:not([data-share])').forEach((b) => { b.onclick = () => onOverlayButton(b.dataset.level); }); }
function hideOverlay() { $('overlay').classList.add('hidden'); }
let daily = false;                                                   // 이번 판이 오늘의 판인가 (로비의 daily.js)
const lvButtons = () => `<div class="lv"><button data-level="easy">쉬움<small>목숨 3개 · 고리 가깝고 불길 느림</small></button><button data-level="normal">보통<small>기록 저장</small></button>${window.arcadeDaily ? arcadeDaily.buttonHtml() : ''}</div>`;
function onOverlayButton(lv) { if (state === 'paused') { resume(); return; } start(lv); }
function showTitle() {
  state = 'title';
  showOverlay(`<h1>로프 스윙</h1><p>화면을 <b>꾹 누르면</b> 줄이 걸려 흔들리고,<br><b>손을 떼면</b> 날아가요!<br>고리에서 고리로 최대한 멀리 가세요.</p>
    <p class="help">아래는 <b>용암</b>, 뒤에서는 <b>불길</b>이 쫓아와요.<br>🪙 코인을 먹으면 점수 +5!</p>
    ${best ? `<div class="big">최고 ${best}점</div>` : ''}${lvButtons()}<p class="note"><span class="pc">마우스 · Space · ↑ 꾹 누르기</span><span class="touch">화면을 꾹 누르기</span></p>`);
}
function start(lv) {
  tut = /[?&]tutorial=1/.test(location.search);
  if (tut) lv = 'easy';
  level = lv === 'normal' ? 'normal' : 'easy';
  daily = !tut && lv === 'normal' && !!(window.arcadeDaily && arcadeDaily.take());
  G = L.newGame(daily ? arcadeDaily.rng() : Math.random, tut ? { level, forgiving: true, coinP: 1 } : { level });
  cam = { x: G.x - 150, top: -20 };
  parts = []; floats = []; trail = []; shake = 0; newBest = false; firstAttach = false; lastMile = 0; flash = 0; deathT = 0;
  pointerHeld = null; keyHeld = false;
  state = 'play'; hideOverlay();
}
function gameOver(why) {
  state = 'over'; sfx.die(); shake = 0.4; deathT = 0;
  const sc = L.scoreOf(G);
  if (!tut && window.arcadeRun) arcadeRun({ level, bad: L.meters(G) < 80 });     // 연패 구제(로비): 80m 도 못 가면 나쁜 판
  newBest = level === 'normal' && !tut && sc > best;
  if (newBest) { best = sc; store.set('ropeswingBest', String(best)); setTimeout(sfx.best, 450); }
  for (let i = 0; i < 18; i++) { const a = -Math.random() * Math.PI, v = 80 + Math.random() * 220; parts.push({ x: G.x, y: Math.min(G.y, G.params.lava - 4), vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: 0.8, color: why === 'rock' ? '#bbb' : '#ff8a2e', r: 3 }); }
  setTimeout(() => {
    if (state !== 'over') return;
    const why2 = why === 'lava' ? '용암에 빠졌어요!' : why === 'fire' ? '불길에 잡혔어요!' : '바위에 부딪혔어요!';
    showOverlay(`<h2>${why2}</h2><div class="big">${L.meters(G)}m · ${G.coinsGot}코인</div><p>점수 <b>${sc}</b>${newBest ? ' · 🎉 새 최고 기록!' : level === 'normal' ? ` · 최고 ${best}점` : ' · 쉬움에서는 기록이 저장되지 않아요'}</p>${daily ? arcadeDaily.result('로프 스윙', sc, '점') : ''}${lvButtons()}`);
  }, 900);
}
function pause() { if (state !== 'play') return; doRelease(); state = 'paused'; showOverlay(`<h2>일시정지</h2><button>계속하기</button>`); }
function resume() { if (state !== 'paused') return; state = 'play'; hideOverlay(); }
function toggleMute() { muted = !muted; store.set('ropeswingMuted', muted ? '1' : '0'); $('muteBtn').textContent = muted ? '🔇' : '🔊'; }

// ---------- 입력 ----------
function doPress() { if (state === 'play') L.press(G); }
function doRelease() { if (G && state !== 'title') L.release(G); else if (G) G.holding = false; }
canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); if (state !== 'play' || pointerHeld !== null) return; pointerHeld = e.pointerId; try { canvas.setPointerCapture(e.pointerId); } catch (_) {} doPress(); });
const up = (e) => { if (pointerHeld === e.pointerId) { pointerHeld = null; doRelease(); } };
canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up); canvas.addEventListener('lostpointercapture', up);
const isKey = (c) => c === 'Space' || c === 'ArrowUp' || c === 'KeyW' || c === 'Enter';
addEventListener('keydown', (e) => {
  if (e.code === 'KeyP') { if (!e.repeat) state === 'paused' ? resume() : pause(); return; }
  if (e.code === 'KeyM') { if (!e.repeat) toggleMute(); return; }
  if (isKey(e.code)) { if (state === 'play') e.preventDefault(); if (!e.repeat && !keyHeld) { keyHeld = true; doPress(); } }
});
addEventListener('keyup', (e) => { if (isKey(e.code) && keyHeld) { keyHeld = false; doRelease(); } });
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('pauseBtn').onclick = (e) => { e.currentTarget.blur(); state === 'paused' ? resume() : pause(); };
addEventListener('blur', () => { keyHeld = false; pointerHeld = null; pause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
function fit() { const s = Math.min(innerWidth / W, innerHeight / H); canvas.style.width = `${Math.floor(W * s)}px`; canvas.style.height = `${Math.floor(H * s)}px`; $('wrap').style.width = canvas.style.width; $('wrap').style.height = canvas.style.height; }
addEventListener('resize', fit); fit();
$('muteBtn').textContent = muted ? '🔇' : '🔊';

// ---------- 갱신 ----------
function update(dt) {
  clock += dt;
  if (state === 'play') {
    if (!(tut && !firstAttach && !G.rope)) L.step(G, dt);          // 연습: 처음 줄을 걸기 전에는 떨어지지 않고 기다려 줌
    for (const ev of G.events) onEvent(ev);
    G.events.length = 0;
    if (G.over) gameOver(lastWhy);
    const m = L.meters(G);
    if (!tut && m - lastMile >= 100) { lastMile = Math.floor(m / 100) * 100; sfx.milestone(); floats.push({ x: G.x, y: G.y - 40, t: 0, text: `${lastMile}m!`, color: '#fff6a8' }); }
    if (Math.hypot(G.vx, G.vy) > 360 && Math.random() < dt * 40) trail.push({ x: G.x, y: G.y, t: 0, life: 0.35 });
  }
  // 카메라: 앞쪽을 더 보여 주고, 높이 올라가면 따라감
  const tx = G.x + Math.max(0, G.vx) * 0.12 - 150, k = Math.min(1, dt * 6);
  cam.x += (tx - cam.x) * k;
  const tt = Math.min(-20, G.y - 160);
  cam.top += (tt - cam.top) * Math.min(1, dt * 3);
  for (const p of parts) { p.t += dt; p.vy += 600 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
  parts = parts.filter((p) => p.t < p.life);
  for (const q of trail) q.t += dt; trail = trail.filter((q) => q.t < q.life);
  for (const f of floats) f.t += dt; floats = floats.filter((f) => f.t < 1);
  shake = Math.max(0, shake - dt); flash = Math.max(0, flash - dt);
}
let lastWhy = 'lava';
function onEvent(ev) {
  if (ev.type === 'attach') {
    sfx.attach(); firstAttach = true; tutorialSignal('attach'); if (ev.n >= 2) tutorialSignal('chain');
  } else if (ev.type === 'release') { if (ev.held > 0.25) { sfx.release(ev.speed); tutorialSignal('release'); } }
  else if (ev.type === 'miss') { sfx.miss(); floats.push({ x: G.x, y: G.y - 30, t: 0, text: '닿는 고리가 없어요', color: '#ffb3b3' }); }
  else if (ev.type === 'coin') { sfx.coin(); tutorialSignal('coin'); floats.push({ x: ev.x, y: ev.y - 10, t: 0, text: '+5', color: '#ffe36a' }); for (let i = 0; i < 6; i++) { const a = Math.random() * 6.28; parts.push({ x: ev.x, y: ev.y, vx: Math.cos(a) * 80, vy: Math.sin(a) * 80 - 40, t: 0, life: 0.4, color: '#ffe36a', r: 2.5 }); } }
  else if (ev.type === 'rescue') { sfx.rescue(); flash = 0.3; floats.push({ x: G.x, y: G.y - 40, t: 0, text: ev.lives ? `목숨 −1 · 남은 ❤ ${ev.lives}` : '연습이라 다시 떨어져요!', color: '#fff' }); }
  else if (ev.type === 'die') lastWhy = ev.why;
}

// ---------- 그리기 ----------
const hill = (x, base, a1, f1, a2, f2) => base + Math.sin(x * f1) * a1 + Math.sin(x * f2 + 1.3) * a2;
function draw() {
  // 하늘
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#2a1a5c'); g.addColorStop(0.45, '#8a3a7a'); g.addColorStop(0.75, '#ff8a5a'); g.addColorStop(1, '#ffc27a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255,240,200,.9)'; ctx.beginPath(); ctx.arc(250 - cam.x * 0.02 % 400, 190, 34, 0, 7); ctx.fill();
  // 먼 산 · 가까운 산 (천천히 따라오는 배경)
  for (const [par, base, a1, f1, a2, f2, col] of [[0.12, 440, 40, 0.006, 18, 0.017, '#4a2a6a'], [0.28, 490, 36, 0.009, 14, 0.023, '#3a1f55']]) {
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, H);
    for (let sx = 0; sx <= W + 8; sx += 8) { const wx = sx / S + cam.x * par; ctx.lineTo(sx, (hill(wx, base, a1, f1, a2, f2) - cam.top * par) * S - 20); }
    ctx.lineTo(W, H); ctx.fill();
  }
  ctx.save();
  if (shake > 0) ctx.translate((Math.random() - 0.5) * 8 * shake, (Math.random() - 0.5) * 8 * shake);
  ctx.scale(S, S); ctx.translate(-cam.x, -cam.top);
  const vx0 = cam.x - 40, vx1 = cam.x + W / S + 40, vy1 = cam.top + H / S;
  // 고리와 매달린 사슬
  const target = !G.rope && state === 'play' ? L.pickAnchor(G) : null;
  for (const a of G.anchors) {
    if (a.x < vx0 || a.x > vx1) continue;
    ctx.strokeStyle = '#6a5a7a'; ctx.lineWidth = 3; ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(a.x, cam.top - 40); ctx.lineTo(a.x, a.y - 12); ctx.stroke(); ctx.setLineDash([]);
    const on = G.rope && G.rope.id === a.id, tg = target && target.id === a.id;
    ctx.fillStyle = on ? '#fff6a8' : '#ffd23a'; ctx.beginPath(); ctx.arc(a.x, a.y, 12, 0, 7); ctx.fill();
    ctx.fillStyle = '#7a4a00'; ctx.beginPath(); ctx.arc(a.x, a.y, 6.5, 0, 7); ctx.fill();
    if (tg) { ctx.strokeStyle = `rgba(255,255,255,${0.55 + 0.35 * Math.sin(clock * 9)})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(a.x, a.y, 20 + 3 * Math.sin(clock * 9), 0, 7); ctx.stroke(); }
  }
  // 코인
  for (const c of G.coins) {
    if (c.got || c.x < vx0 || c.x > vx1) continue;
    const w = Math.abs(Math.cos(clock * 4 + c.x * 0.05));
    ctx.fillStyle = '#c98a00'; ctx.beginPath(); ctx.ellipse(c.x, c.y, 9 * (0.25 + 0.75 * w), 10, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#ffe36a'; ctx.beginPath(); ctx.ellipse(c.x, c.y, 6.5 * (0.25 + 0.75 * w), 7.5, 0, 0, 7); ctx.fill();
  }
  // 바위
  for (const q of G.pillars) {
    if (q.x + q.w < vx0 || q.x > vx1) continue;
    const lava = G.params.lava;
    ctx.fillStyle = '#4a4458'; ctx.beginPath(); ctx.moveTo(q.x - 6, lava + 30); ctx.lineTo(q.x + 4, q.top + 28); ctx.lineTo(q.x + q.w / 2, q.top); ctx.lineTo(q.x + q.w - 4, q.top + 28); ctx.lineTo(q.x + q.w + 6, lava + 30); ctx.fill();
    ctx.fillStyle = '#6a647a'; ctx.beginPath(); ctx.moveTo(q.x + 4, q.top + 28); ctx.lineTo(q.x + q.w / 2, q.top); ctx.lineTo(q.x + q.w / 2 - 2, q.top + 40); ctx.fill();
  }
  // 용암
  const lava = G.params.lava;
  const lg = ctx.createLinearGradient(0, lava - 10, 0, vy1); lg.addColorStop(0, '#ffb43a'); lg.addColorStop(0.3, '#ff5a1a'); lg.addColorStop(1, '#a01a0a');
  ctx.fillStyle = lg; ctx.beginPath(); ctx.moveTo(vx0, vy1 + 10);
  for (let x = vx0; x <= vx1; x += 12) ctx.lineTo(x, lava + Math.sin((x + clock * 90) * 0.03) * 5);
  ctx.lineTo(vx1, vy1 + 10); ctx.fill();
  ctx.fillStyle = 'rgba(255,230,120,.5)';
  for (let i = 0; i < 12; i++) { const bx = vx0 + ((i * 97 + clock * 20 * (1 + i % 3)) % (vx1 - vx0)), by = lava + 12 + ((i * 37 + clock * 25) % 90); ctx.beginPath(); ctx.arc(bx, by, 2 + (i % 3), 0, 7); ctx.fill(); }
  // 쫓아오는 불길
  if (!G.forgiving && G.chase > vx0 - 200) {
    const fg = ctx.createLinearGradient(G.chase - 220, 0, G.chase + 20, 0); fg.addColorStop(0, 'rgba(60,0,0,.95)'); fg.addColorStop(0.7, 'rgba(255,70,20,.9)'); fg.addColorStop(1, 'rgba(255,200,60,.95)');
    ctx.fillStyle = fg; ctx.beginPath(); ctx.moveTo(vx0 - 300, cam.top - 20);
    for (let y = cam.top - 20; y <= vy1 + 20; y += 16) ctx.lineTo(G.chase + Math.sin(y * 0.06 + clock * 7) * 16 + Math.sin(y * 0.15 - clock * 11) * 7, y);
    ctx.lineTo(vx0 - 300, vy1 + 20); ctx.fill();
  }
  // 꼬리 · 파티클
  for (const q of trail) { ctx.globalAlpha = 0.35 * (1 - q.t / q.life); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(q.x, q.y, 8 * (1 - q.t / q.life), 0, 7); ctx.fill(); }
  ctx.globalAlpha = 1;
  // 줄
  if (G.rope) { ctx.strokeStyle = '#2a1a0a'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(G.rope.ax, G.rope.ay); ctx.lineTo(G.x, G.y); ctx.stroke(); ctx.strokeStyle = '#e8c48a'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(G.rope.ax, G.rope.ay); ctx.lineTo(G.x, G.y); ctx.stroke(); }
  else if (target && state === 'play') { ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 2; ctx.setLineDash([4, 6]); ctx.beginPath(); ctx.moveTo(G.x, G.y); ctx.lineTo(target.x, target.y); ctx.stroke(); ctx.setLineDash([]); }
  // 나
  if (!(state === 'over' && G.y + L.P.r > lava)) {
    ctx.save(); ctx.translate(G.x, G.y); ctx.rotate(Math.atan2(G.vy, G.vx) * 0.35);
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.arc(2, 3, L.P.r, 0, 7); ctx.fill();
    ctx.fillStyle = '#ff5a6e'; ctx.beginPath(); ctx.arc(0, 0, L.P.r, 0, 7); ctx.fill();
    ctx.fillStyle = '#ff9aa8'; ctx.beginPath(); ctx.arc(-3, -4, 4, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(4, -2, 3.6, 0, 7); ctx.arc(-2, -2, 3.2, 0, 7); ctx.fill();
    ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(5, -2, 1.7, 0, 7); ctx.arc(-1, -2, 1.5, 0, 7); ctx.fill();
    ctx.restore();
  }
  for (const p of parts) { ctx.globalAlpha = Math.max(0, 1 - p.t / p.life); ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill(); }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.6)';
  for (const f of floats) { const k = f.t; ctx.globalAlpha = 1 - k; ctx.fillStyle = f.color; ctx.font = '900 15px sans-serif'; ctx.strokeText(f.text, f.x, f.y - k * 30); ctx.fillText(f.text, f.x, f.y - k * 30); }
  ctx.globalAlpha = 1;
  ctx.restore();
  // 위로 너무 올라가면 화살표
  if ((G.y - cam.top) * S < 18) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(sxOf(G.x), 44); ctx.lineTo(sxOf(G.x) - 9, 58); ctx.lineTo(sxOf(G.x) + 9, 58); ctx.fill(); }
  if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${flash})`; ctx.fillRect(0, 0, W, H); }
  // 불길이 가까우면 왼쪽이 붉어짐
  if (!G.forgiving && state === 'play') { const gap = G.x - G.chase; if (gap < 260) { const a = Math.min(0.55, (260 - gap) / 260 * 0.55); const rg = ctx.createLinearGradient(0, 0, 90, 0); rg.addColorStop(0, `rgba(255,40,10,${a})`); rg.addColorStop(1, 'rgba(255,40,10,0)'); ctx.fillStyle = rg; ctx.fillRect(0, 0, 90, H); ctx.textAlign = 'left'; ctx.font = '900 13px sans-serif'; ctx.fillStyle = `rgba(255,255,255,${0.5 + 0.5 * Math.sin(clock * 12)})`; ctx.fillText('🔥 불길!', 8, H / 2); } }
  drawHud();
}
const sxOf = (x) => Math.max(14, Math.min(W - 14, (x - cam.x) * S));
function drawHud() {
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(0, 0, W, 42);
  ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = '900 24px sans-serif'; ctx.fillText(`${L.meters(G)}m`, W / 2, 28);
  ctx.textAlign = 'left'; ctx.font = '800 14px sans-serif'; ctx.fillText(`🪙 ${G.coinsGot}`, 10, 27);
  ctx.font = '700 11px sans-serif'; ctx.fillStyle = '#ddd'; if (!tut) ctx.fillText(`점수 ${L.scoreOf(G)}`, 10, 39);
  if (!tut && G.params.lives > 1) { ctx.fillStyle = '#ff7a8a'; ctx.fillText('❤'.repeat(G.lives), 10, 53); }
  if (state === 'play' && !firstAttach && !G.over) { ctx.textAlign = 'center'; ctx.fillStyle = `rgba(255,255,255,${0.65 + 0.35 * Math.sin(clock * 6)})`; ctx.font = '900 18px sans-serif'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.strokeText('꾹 누르세요!', W / 2, 230); ctx.fillText('꾹 누르세요!', W / 2, 230); }
}

let last = performance.now();
function frame(now) { const dt = Math.min(0.05, (now - last) / 1000); last = now; update(dt); draw(); requestAnimationFrame(frame); }
showTitle();
requestAnimationFrame(frame);
