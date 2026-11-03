'use strict';
// 로프 스윙: 규칙만 (DOM 없음). 화면·입력·소리는 game.js.
// 누르고 있으면 가장 알맞은 고리에 줄이 걸려 그네처럼 흔들리고, 손을 떼면 속도를 그대로 가진 채 날아간다. 용암에 떨어지거나 바위에 부딪히면 끝.
(function (root) {
  const P = {
    g: 1000,            // 중력
    reach: 240,         // 줄이 닿는 거리
    minLen: 80,         // 줄이 가장 짧아질 수 있는 길이
    reel: 36,           // 매달려 있으면 줄이 줄어드는 속도(초당)
    r: 13,              // 내 몸 반지름
    maxV: 1000,
    drag: 0.04,         // 공기 저항(초당 비율)
    ceil: 100,          // 고리 높이 가장 위
    startX: 0, startY: 230,
    chase0: 55, chaseMax: 190, chaseRamp: 0.05,      // 쫓아오는 불길 속도(초당): 처음 55 → 멀어질수록 빨라져 최대 190
  };
  const LEVELS = {
    easy: { gapMin: 125, gapMax: 185, lava: 650, pillarFrom: 700, pillarP: 0.25, coinP: 0.8, label: '쉬움' },
    normal: { gapMin: 150, gapMax: 235, lava: 620, pillarFrom: 250, pillarP: 0.4, coinP: 0.6, label: '보통' },
  };
  const rng = (seed) => { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function newGame(rand, opts = {}) {
    rand = rand || Math.random;
    const lv = LEVELS[opts.level] ? opts.level : 'normal';
    const params = Object.assign({}, LEVELS[lv]);
    if (opts.coinP !== undefined) params.coinP = opts.coinP;
    const st = { rand, level: lv, params, x: P.startX, y: P.startY, vx: 150, vy: 0, rope: null, holding: false, anchors: [], coins: [], pillars: [],
      genX: 160, lastAy: 120, t: 0, over: false, score: 0, coinsGot: 0, maxX: P.startX, events: [], forgiving: !!opts.forgiving, attaches: 0, nextId: 1, lastAnchor: -1, chase: -420 };
    st.anchors.push({ id: st.nextId++, x: 160, y: 120 });                       // 처음 고리는 바로 앞에
    generate(st, 1400);
    return st;
  }

  // 오른쪽으로 계속 이어지는 길 만들기: 고리 · 코인 · 바위
  function generate(st, upToX) {
    const p = st.params;
    while (st.genX < upToX) {
      const meters = st.genX / 10;
      const growth = Math.min(150, meters / 14);                                 // 멀어질수록 간격이 조금씩 벌어짐
      const gap = p.gapMin + st.rand() * (p.gapMax - p.gapMin) + growth;
      const prevX = st.genX;
      st.genX += gap;
      const ay = clamp(st.lastAy + (st.rand() - 0.5) * 170, P.ceil, 340);
      const a = { id: st.nextId++, x: st.genX, y: ay };
      // 코인: 두 고리 사이 아래쪽 호
      if (st.rand() < p.coinP) {
        const n = 3 + Math.floor(st.rand() * 3), base = clamp(ay + 150 + st.rand() * 40, 330, 470);
        for (let i = 0; i < n; i++) { const f = (i + 1) / (n + 1); st.coins.push({ id: st.nextId++, x: prevX + gap * f, y: base - Math.sin(f * Math.PI) * 55, got: false }); }
      }
      // 바위: 바닥에서 솟은 뾰족 바위
      if (meters > p.pillarFrom / 10 * 1 && st.rand() < p.pillarP) {
        const top = 470 + st.rand() * 70, w = 46 + st.rand() * 30;
        st.pillars.push({ id: st.nextId++, x: prevX + gap * (0.3 + st.rand() * 0.4), w, top });
      }
      st.anchors.push(a); st.lastAy = ay;
    }
  }

  // 지금 누르면 걸릴 고리 (앞쪽 · 위쪽 · 닿는 거리 안에서 가장 알맞은 것)
  function pickAnchor(st) {
    let best = null, bk = 1e9;
    for (const a of st.anchors) {
      const dx = a.x - st.x, dy = a.y - st.y, d = Math.hypot(dx, dy);
      if (d > P.reach || dy > -40 || dx < -30) continue;
      const key = d - dx * 0.55 + (dx < 0 ? 120 : 0);
      if (key < bk) { bk = key; best = a; }
    }
    return best;
  }

  function press(st) {
    st.holding = true;
    if (st.over || st.rope) return false;
    const a = pickAnchor(st);
    if (!a) { st.events.push({ type: 'miss' }); return false; }
    const d = Math.hypot(a.x - st.x, a.y - st.y);
    st.rope = { id: a.id, ax: a.x, ay: a.y, len: Math.max(P.minLen, d), t: 0 };
    st.attaches++; st.lastAnchor = a.id;
    st.events.push({ type: 'attach', id: a.id, n: st.attaches });
    return true;
  }
  function release(st) {
    st.holding = false;
    if (!st.rope) return false;
    const held = st.rope.t;
    st.rope = null;
    st.events.push({ type: 'release', held, speed: Math.hypot(st.vx, st.vy) });
    return true;
  }

  function die(st, why) {
    if (st.forgiving) { rescue(st, why); return; }
    st.over = true; st.rope = null; st.events.push({ type: 'die', why });
  }
  // 연습용: 죽는 대신 가장 가까운 앞쪽 고리 아래에서 다시 떨어짐
  function rescue(st, why) {
    let a = st.anchors.find((q) => q.x > st.x - 60) || st.anchors[0];
    st.x = a.x - 90; st.y = a.y + 130; st.vx = 140; st.vy = 0; st.rope = null; st.holding = false;
    st.events.push({ type: 'rescue', why });
  }

  function step(st, dt) {
    if (st.over) return;
    const sub = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / sub;
    for (let s = 0; s < sub && !st.over; s++) sub1(st, h);
    st.t += dt;
    if (!st.forgiving) st.chase += (P.chase0 + Math.min(P.chaseMax - P.chase0, meters(st) * P.chaseRamp)) * dt;      // 뒤에서 쫓아오는 불길
    generate(st, st.x + 1300);
    // 지나간 것 치우기
    if (st.anchors.length > 40) st.anchors = st.anchors.filter((a) => a.x > st.x - 700 || (st.rope && a.id === st.rope.id));
    if (st.coins.length > 60) st.coins = st.coins.filter((c) => c.x > st.x - 700);
    if (st.pillars.length > 30) st.pillars = st.pillars.filter((q) => q.x + q.w > st.x - 700);
  }

  function sub1(st, h) {
    const rope = st.rope;
    st.vy += P.g * h;
    const dr = Math.exp(-P.drag * h); st.vx *= dr; st.vy *= dr;
    const sp = Math.hypot(st.vx, st.vy);
    if (sp > P.maxV) { st.vx *= P.maxV / sp; st.vy *= P.maxV / sp; }
    st.x += st.vx * h; st.y += st.vy * h;
    if (rope) {
      rope.t += h;
      // 줄이 짧아지면 접선 속도가 늘어남(각운동량 보존)
      const old = rope.len, nl = Math.max(P.minLen, old - P.reel * h);
      if (nl < old) {
        const dx = st.x - rope.ax, dy = st.y - rope.ay, d = Math.hypot(dx, dy) || 1, nx = dx / d, ny = dy / d;
        const vr = st.vx * nx + st.vy * ny, tx = st.vx - nx * vr, ty = st.vy - ny * vr, k = old / nl;
        st.vx = nx * vr + tx * k; st.vy = ny * vr + ty * k;
        rope.len = nl;
      }
      const dx = st.x - rope.ax, dy = st.y - rope.ay, d = Math.hypot(dx, dy) || 1;
      if (d > rope.len) {
        const nx = dx / d, ny = dy / d;
        st.x = rope.ax + nx * rope.len; st.y = rope.ay + ny * rope.len;
        const vr = st.vx * nx + st.vy * ny;
        if (vr > 0) { st.vx -= nx * vr; st.vy -= ny * vr; }
      }
    }
    if (st.x > st.maxX) st.maxX = st.x;
    // 코인
    for (const c of st.coins) {
      if (c.got) continue;
      if (Math.hypot(c.x - st.x, c.y - st.y) < P.r + 10) { c.got = true; st.coinsGot++; st.events.push({ type: 'coin', x: c.x, y: c.y }); }
    }
    // 바위 · 용암 · 뒤로 너무 떨어짐
    for (const q of st.pillars) {
      if (st.x + P.r > q.x && st.x - P.r < q.x + q.w && st.y + P.r > q.top + (Math.abs(st.x - (q.x + q.w / 2)) / (q.w / 2)) * 28) { die(st, 'rock'); return; }
    }
    if (st.y + P.r > st.params.lava) { die(st, 'lava'); return; }
    if (!st.forgiving && st.x - P.r < st.chase) { die(st, 'fire'); return; }
    if (st.y < -600) { st.y = -600; st.vy = Math.max(0, st.vy); }
  }

  const meters = (st) => Math.floor(st.maxX / 10);
  const scoreOf = (st) => meters(st) + st.coinsGot * 5;

  const api = { P, LEVELS, rng, clamp, newGame, generate, pickAnchor, press, release, step, meters, scoreOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LOGIC_ROPE = api;
})(typeof window !== 'undefined' ? window : globalThis);
