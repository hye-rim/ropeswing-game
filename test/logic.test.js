'use strict';
// 로프 스윙 규칙 시험. 실행: node --test
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

const fresh = (opts = {}) => L.newGame(L.rng(5), Object.assign({ level: 'normal' }, opts));
const run = (st, sec) => { for (let i = 0; i < sec * 60; i++) L.step(st, 1 / 60); };
const clear = (st) => { const e = st.events.slice(); st.events.length = 0; return e; };

test('new game: first anchor within reach of the start, anchors sorted and spread out', () => {
  const st = fresh();
  const a0 = st.anchors[0];
  assert.ok(Math.hypot(a0.x - st.x, a0.y - st.y) < L.P.reach);
  for (let i = 1; i < st.anchors.length; i++) {
    const gap = st.anchors[i].x - st.anchors[i - 1].x;
    assert.ok(gap >= st.params.gapMin * 0.99 && gap < 420, `gap ${gap}`);
    assert.ok(st.anchors[i].y >= L.P.ceil && st.anchors[i].y <= 340);
  }
});

test('same seed gives the same course', () => {
  const a = L.newGame(L.rng(9)), b = L.newGame(L.rng(9));
  assert.deepStrictEqual(a.anchors.map((q) => [q.x, q.y]), b.anchors.map((q) => [q.x, q.y]));
  assert.deepStrictEqual(a.coins.map((q) => [q.x, q.y]), b.coins.map((q) => [q.x, q.y]));
});

test('free fall follows gravity and the lava ends the game', () => {
  const st = fresh();
  const y0 = st.y; run(st, 0.2);
  assert.ok(st.y > y0 + 10 && st.vy > 150);
  run(st, 3);
  assert.strictEqual(st.over, true);
  assert.ok(clear(st).some((e) => e.type === 'die' && e.why === 'lava'));
});

test('pressing attaches to a reachable anchor above and ahead, with a taut rope', () => {
  const st = fresh();
  assert.strictEqual(L.press(st), true);
  assert.ok(st.rope && st.rope.len >= L.P.minLen);
  assert.ok(clear(st).some((e) => e.type === 'attach'));
  run(st, 2);
  const d = Math.hypot(st.x - st.rope.ax, st.y - st.rope.ay);
  assert.ok(d <= st.rope.len + 0.5, 'never stretches the rope: ' + d);
});

test('pressing with nothing in reach does nothing', () => {
  const st = fresh(); st.y = 580; st.x = 40; st.anchors.length = 0;
  assert.strictEqual(L.press(st), false);
  assert.strictEqual(st.rope, null);
  assert.ok(clear(st).some((e) => e.type === 'miss'));
});

test('anchors below you or behind you are not picked', () => {
  const st = fresh(); st.anchors.length = 0;
  st.anchors.push({ id: 1, x: st.x + 100, y: st.y + 50 });          // 아래
  st.anchors.push({ id: 2, x: st.x - 150, y: st.y - 80 });          // 뒤
  assert.strictEqual(L.pickAnchor(st), null);
  st.anchors.push({ id: 3, x: st.x + 120, y: st.y - 90 });
  assert.strictEqual(L.pickAnchor(st).id, 3);
});

test('swinging: the rope converts height into speed, and releasing keeps the speed', () => {
  const st = fresh(); st.chase = -1e9;
  L.press(st);
  let vmax = 0;
  for (let i = 0; i < 120; i++) { L.step(st, 1 / 60); vmax = Math.max(vmax, Math.hypot(st.vx, st.vy)); }
  assert.ok(vmax > 250, 'swing speed ' + vmax);
  const vx = st.vx, vy = st.vy;
  L.release(st);
  assert.strictEqual(st.rope, null);
  assert.ok(Math.abs(st.vx - vx) < 1e-9 && Math.abs(st.vy - vy) < 1e-9);
  assert.ok(clear(st).some((e) => e.type === 'release' && e.held > 1));
});

test('reeling in shortens the rope but never below the minimum', () => {
  const st = fresh(); st.chase = -1e9; L.press(st);
  const l0 = st.rope.len;
  run(st, 1); assert.ok(st.rope.len < l0);
  run(st, 8); assert.strictEqual(st.rope.len, L.P.minLen);
});

test('shorter rope speeds up the swing (angular momentum)', () => {
  const st = fresh(); st.chase = -1e9; st.anchors.length = 0;
  st.anchors.push({ id: 1, x: 400, y: 100 });
  st.x = 400 - 160; st.y = 100 + 160; st.vx = 0; st.vy = 0;
  L.press(st);
  const speedAtBottom = (st2) => { let best = 0; for (let i = 0; i < 90; i++) { L.step(st2, 1 / 60); best = Math.max(best, Math.hypot(st2.vx, st2.vy)); } return best; };
  const withReel = speedAtBottom(st);
  const st3 = fresh(); st3.chase = -1e9; st3.anchors.length = 0; st3.anchors.push({ id: 1, x: 400, y: 100 });
  st3.x = 240; st3.y = 260; st3.vx = 0; st3.vy = 0; assert.ok(L.press(st3)); assert.ok(st.rope);
  const saved = L.P.reel; L.P.reel = 0;
  const noReel = speedAtBottom(st3); L.P.reel = saved;
  assert.ok(withReel > noReel, `${withReel} vs ${noReel}`);
});

test('coins are collected once and add to the score', () => {
  const st = fresh(); st.chase = -1e9;
  const c = { id: 99, x: st.x + 5, y: st.y + 5, got: false }; st.coins.push(c);
  L.step(st, 1 / 60);
  assert.strictEqual(c.got, true);
  assert.strictEqual(st.coinsGot, 1);
  assert.ok(clear(st).some((e) => e.type === 'coin'));
  const before = st.coinsGot; c.x = st.x; c.y = st.y; L.step(st, 1 / 60);
  assert.strictEqual(st.coinsGot, before);
  assert.strictEqual(L.scoreOf(st), L.meters(st) + st.coinsGot * 5);
});

test('rock pillars kill on touch; flying above them is safe', () => {
  const st = fresh(); st.chase = -1e9; st.anchors.length = 0;
  st.pillars.push({ id: 5, x: 100, w: 60, top: 500 });
  st.x = 130; st.y = 300; st.vx = 0; st.vy = 0;
  run(st, 0.2); assert.strictEqual(st.over, false);
  run(st, 1); assert.strictEqual(st.over, true);
  assert.ok(clear(st).some((e) => e.type === 'die' && e.why === 'rock'));
});

test('the fire behind catches up if you stay put, and speeds up with distance', () => {
  const st = fresh(); st.anchors.length = 0;
  st.anchors.push({ id: 1, x: 100, y: 60 }); st.x = 100; st.y = 200; st.vx = st.vy = 0; L.press(st);
  run(st, 20);
  assert.strictEqual(st.over, true);
  assert.ok(clear(st).some((e) => e.type === 'die' && e.why === 'fire'));
  const a = fresh(); a.maxX = 0; const b = fresh(); b.maxX = 20000;
  a.chase = b.chase = 0; a.x = b.x = 100; a.y = b.y = 100; a.vx = b.vx = a.vy = b.vy = 0;
  a.rope = b.rope = null;
  L.P.g = 0; L.step(a, 0.1); L.step(b, 0.1); L.P.g = 1000;
  assert.ok(b.chase > a.chase);
});

test('course keeps generating ahead and drops old items', () => {
  const st = fresh(); st.chase = -1e9;
  st.x = 6000; st.y = 200; st.vx = 0; st.vy = -1; L.step(st, 1 / 60);
  assert.ok(st.anchors[st.anchors.length - 1].x > 6000 + 1000);
  assert.ok(st.anchors.length < 80);
});

test('forgiving mode rescues instead of dying', () => {
  const st = fresh({ forgiving: true });
  run(st, 4);
  assert.strictEqual(st.over, false);
  assert.ok(st.y < st.params.lava);
  assert.ok(clear(st).some((e) => e.type === 'rescue'));
});

test('pillars start only after the level pillar distance and are never inside the first stretch', () => {
  const st = L.newGame(L.rng(3), { level: 'easy' });
  st.genX = 1; L.generate(st, 9000);
  const early = st.pillars.filter((q) => q.x / 10 < st.params.pillarFrom / 10 - 5);
  assert.strictEqual(early.length, 0);
});

test('meters and score', () => {
  const st = fresh(); st.maxX = 1234; st.coinsGot = 3;
  assert.strictEqual(L.meters(st), 123);
  assert.strictEqual(L.scoreOf(st), 123 + 15);
});

test('easy has 3 lives: lava and rocks rescue you, the last one ends the game, normal has 1', () => {
  const st = L.newGame(L.rng(5), { level: 'easy' });
  assert.strictEqual(st.lives, 3);
  st.y = st.params.lava; L.step(st, 1 / 60);
  assert.strictEqual(st.over, false);
  assert.strictEqual(st.lives, 2);
  assert.ok(st.events.some((e) => e.type === 'rescue' && e.lives === 2));
  st.y = st.params.lava; L.step(st, 1 / 60);
  assert.strictEqual(st.lives, 1);
  st.y = st.params.lava; L.step(st, 1 / 60);
  assert.strictEqual(st.over, true);
  assert.strictEqual(L.newGame(L.rng(5), { level: 'normal' }).lives, 1);
});

test('the fire behind ignores lives', () => {
  const st = L.newGame(L.rng(5), { level: 'easy' });
  st.chase = st.x + 100; L.step(st, 1 / 60);
  assert.strictEqual(st.over, true);
  assert.strictEqual(st.events.filter((e) => e.type === 'die')[0].why, 'fire');
});

test('easy is gentler than normal: closer rings, longer reach, lower lava, slower fire', () => {
  const e = L.LEVELS.easy, n = L.LEVELS.normal;
  assert.ok(e.gapMax < n.gapMin + 1 || e.gapMax < n.gapMax);
  assert.ok(e.reach > n.reach && e.lava > n.lava && e.chaseMax < n.chaseMax && e.chase0 < n.chase0 && e.growthMax < n.growthMax);
  const st = L.newGame(L.rng(5), { level: 'easy' });
  st.x = 3000; st.anchors.push({ id: 999, x: 3000 + 270, y: st.y - 100 });         // 보통(240)이면 안 닿고 쉬움(290)이면 닿는 거리
  assert.ok(L.pickAnchor(st));
});
