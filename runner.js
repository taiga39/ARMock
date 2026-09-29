// A flat side-scroller drawn on one face of the box. The stage is fixed to the face, but gravity
// always points down the screen, so turning the box turns the stage: a wall becomes a floor.
// The only input is that rotation; the character walks by itself.
(function (root) {
  'use strict';
  const COLS = 10, ROWS = 10;
  // Row 0 is the top of the stage, '#' is solid. Walls all round except a gap at the top right:
  // turned clockwise, the middle wall becomes a floor that leads there. Turned the other way, the
  // character just slides into a corner and waits, so the direction of the turn is the puzzle.
  const LEVEL = [
    '########..',
    '#........#',
    '#........#',
    '#........#',
    '#....#...#',
    '#....#...#',
    '#....#...#',
    '#....#...#',
    '#....#...#',
    '##########'
  ];
  const WALK = 3.2, FALL = 7, HOP = 5.2, SIZE = .7; // cells per second, and the character's size
  const solid = (x, y) => {
    const col = Math.floor(x), row = Math.floor(y);
    if (col < 0 || row < 0 || col >= COLS || row >= ROWS) return false; // outside the stage is open air
    return LEVEL[row][col] === '#';
  };
  // The character is a square; these are the cells its leading edge would enter.
  function blocked(x, y, dx, dy) {
    const half = SIZE / 2, ahead = .02;
    const cx = x + dx * (half + ahead), cy = y + dy * (half + ahead);
    const sx = dx ? 0 : half * .9, sy = dy ? 0 : half * .9;
    return solid(cx - sx, cy - sy) || solid(cx + sx, cy + sy);
  }
  const create = () => ({ x: 1.5, y: 8.5, fall: 0, hop: 0, done: false, left: false, steps: 0 });
  // down and walk are unit vectors in stage coordinates (x right, y down the level array).
  function update(state, seconds, down, walk) {
    if (state.done) return state;
    state.steps++;
    const move = (dx, dy, distance) => {
      let travelled = 0;
      const step = .05;
      while (travelled < distance) {
        const take = Math.min(step, distance - travelled);
        if (blocked(state.x, state.y, dx, dy)) return travelled;
        state.x += dx * take; state.y += dy * take; travelled += take;
      }
      return travelled;
    };
    // Falling, or standing on something.
    const standing = blocked(state.x, state.y, down.x, down.y);
    if (state.hop > 0) {
      state.hop -= seconds;
      move(-down.x, -down.y, HOP * seconds);
    } else if (!standing) {
      state.fall += seconds;
      move(down.x, down.y, FALL * seconds);
    } else state.fall = 0;
    // Walking, with a hop over anything one cell high.
    const walked = move(walk.x, walk.y, WALK * seconds);
    if (walked < WALK * seconds * .5 && standing && state.hop <= 0) {
      const overhead = 1.1;
      const free = !blocked(state.x - down.x * overhead, state.y - down.y * overhead, walk.x, walk.y);
      if (free) state.hop = .22; // a low obstacle: jump it
      state.blocked = !free;
    } else state.blocked = false;
    // Walking off the stage ends the run.
    if (state.x < -1 || state.y < -1 || state.x > COLS + 1 || state.y > ROWS + 1) { state.done = true; state.left = true; }
    return state;
  }
  // The stage is pinned to a face, but which way up it starts is chosen when the run begins, so it
  // reads correctly whatever the marker's own orientation is. Each turn lists the stage's x and y
  // axes as (right, up) amounts of the face's own axes.
  const TURNS = [[[1, 0], [0, -1]], [[0, -1], [-1, 0]], [[-1, 0], [0, 1]], [[0, 1], [1, 0]]];
  const onScreen = (axes, v) => ({ x: v[0] * axes.right.x + v[1] * axes.up.x, y: v[0] * axes.right.y + v[1] * axes.up.y });
  const uprightTurn = axes => TURNS.reduce((best, _, turn) =>
    onScreen(axes, TURNS[turn][1]).y > onScreen(axes, TURNS[best][1]).y ? turn : best, 0);
  // Given how the face sits on screen, which way is down and which way is forward, in stage
  // coordinates, snapped to a stage axis. Turning the box swaps them, and that is the whole puzzle.
  function frame(axes, turn) {
    const [ex, ey] = TURNS[turn], sx = onScreen(axes, ex), sy = onScreen(axes, ey);
    const determinant = sx.x * sy.y - sy.x * sx.y;
    const snap = (tx, ty) => {
      if (!determinant) return { x: 0, y: 1 };
      const x = (tx * sy.y - ty * sy.x) / determinant, y = (sx.x * ty - sx.y * tx) / determinant;
      return Math.abs(x) > Math.abs(y) ? { x: Math.sign(x), y: 0 } : { x: 0, y: Math.sign(y) };
    };
    return { ex, ey, down: snap(0, 1), walk: snap(1, 0) };
  }
  // project(x, y) turns stage coordinates into screen points; the caller decides which face it lies on.
  function draw(ctx, project, state) {
    const quad = (points, fill, stroke) => {
      if (points.some(p => !p)) return;
      ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath();
      ctx.fillStyle = fill; ctx.fill();
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
    };
    const cell = (x, y, w, h) => [project(x, y), project(x + w, y), project(x + w, y + h), project(x, y + h)];
    ctx.save(); ctx.lineJoin = 'round';
    quad(cell(0, 0, COLS, ROWS), '#101a2c');                      // the screen the stage sits on
    for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
      if (LEVEL[row][col] !== '#') continue;
      quad(cell(col, row, 1, 1), '#4a6b3a', '#7fb055');
    }
    const half = SIZE / 2;
    quad(cell(state.x - half, state.y - half, SIZE, SIZE), state.blocked ? '#ff8f4a' : '#ff5268', '#ffd0d6');
    // A dot near the leading edge, so which way it faces is readable at a glance.
    const eye = .18;
    quad(cell(state.x - eye / 2, state.y - half * .55, eye, eye), '#fff');
    ctx.restore();
  }
  const api = { COLS, ROWS, LEVEL, SIZE, create, update, solid, draw, frame, uprightTurn };
  if (typeof module !== 'undefined') module.exports = api; else root.MockARRunner = api;
})(globalThis);
