// Each gimmick is a small module with the same shape, so adding one means adding a module here
// rather than another branch in app.js. app.js only runs the camera, the pose and the gestures.
//
// A module may use any of these; all are optional:
//   reset()                      back to the start
//   update(frame)                advance its own state
//   boxOptions(frame, options)   add labels, colours, gold or the mesh inside the box
//   drawBox(frame, options)      draw the box itself; return true to take over from the default
//   drawOverlay(frame, options)  draw things attached to the box, after it
//   drawScreen(frame)            draw things fixed to the screen, even with no pose
//   hit(frame, x, y)             claim a press on an object of its own; return true if claimed
//   tap/longPress(frame, face)   claim a gesture on a face; return true if claimed
//   drag/release(frame, info)    claim a swipe on a face
//   status(frame)                one line about what the player should do
//   jumps                        [{ label, go(frame) }] for the tuning panel, to skip ahead
(function (root) {
  'use strict';
  const box = () => root.MockARBox, runner = () => root.MockARRunner;
  const values = () => root.MockARConfig.values;
  const FACE = { B: 1, FLOOR: 3, E: 4, F: 5 };
  const PALETTE = () => [...box().faceColors, '#e8b23a', '#e9eef7', '#2b3648'];
  const NAMES = ['赤', '黄', '青', '緑', '紫', 'オレンジ'];
  const clamp01 = x => Math.min(1, Math.max(0, x));
  const letter = k => 'ABCDEF'[k];

  // --- the faces themselves: a tap counts, a long press recolours -------------------------------
  const faces = {
    id: 'faces', title: '面のタップ',
    counts: [0, 0, 0, 0, 0, 0], colors: {}, touched: null,
    reset() { this.counts.fill(0); this.colors = {}; this.touched = null; },
    boxOptions(frame, options) {
      for (let k = 0; k < 6; k++) options.labels[k] = this.counts[k] ? String(this.counts[k]) : letter(k);
      Object.assign(options.colors, this.colors);
    },
    drawOverlay(frame) {
      if (this.touched && frame.now < this.touched.until) box().highlight(frame.ctx, frame.pose, this.touched.face);
    },
    tap(frame, face) {
      this.counts[face]++;
      this.touched = { face, until: frame.now + 600 };
      frame.vibrate(30);
      frame.say(`FACE_${letter(face)}（${NAMES[face]}）= ${this.counts[face]}`, box().faceColors[face]);
      return true;
    },
    longPress(frame, face) {
      const palette = PALETTE(), next = (palette.indexOf(this.colors[face]) + 1) % palette.length;
      this.colors[face] = palette[next];
      frame.vibrate([20, 40, 20]);
      frame.say(`長押し: FACE_${letter(face)} の色を変更`, palette[next]);
      return true;
    },
    jumps: [{ label: '数字と色を消す', go: () => faces.reset() }]
  };

  // --- FACE_E swings open, and a switch waits on the floor inside -------------------------------
  const lid = {
    id: 'lid', title: 'Eの面を開ける',
    progress: 0, target: 0, dragging: false, polygons: null, pressedUntil: 0, seen: -Infinity, mesh: null,
    reset() { this.progress = 0; this.target = 0; this.dragging = false; this.polygons = null; },
    meshes() {
      if (!this.mesh) this.mesh = {
        still: box().placeOnFace(root.MockARSwitch, FACE.FLOOR, .55, [1], 0, true),
        pressed: box().placeOnFace(root.MockARSwitch, FACE.FLOOR, .55, [1], .1, true)
      };
      return this.mesh;
    },
    // The switch is offered while FACE_E has been seen recently, and until the letters take over.
    armed(frame) { return !hologram.visible && frame.now - this.seen <= values().lidHoldMs; },
    update(frame) {
      if (frame.ids.includes(root.MockAR.IDS[FACE.E])) this.seen = frame.now;
      if (!this.armed(frame)) this.target = 0;
      if (!this.dragging) this.progress = clamp01(this.progress + (this.target ? 1 : -1) * frame.seconds * 1000 / values().lidOpenMs);
      if (this.progress <= .001) this.polygons = null;
    },
    angle() { return values().lidOpenDeg * Math.PI / 180; },
    drawBox(frame, options) {
      if (this.progress <= .001) return false;
      options.inside = this.target && !hologram.visible
        ? (frame.now < this.pressedUntil ? this.meshes().pressed : this.meshes().still) : null;
      this.polygons = box().drawOpen(frame.ctx, frame.pose, frame.style, frame.opacity,
        FACE.E, this.progress * this.angle(), options);
      return true;
    },
    drawOverlay(frame) {
      if (!this.armed(frame) || this.progress >= .99) return;
      box().drawArrow(frame.ctx, frame.pose, FACE.E, 0, -1, { opacity: (1 - this.progress) * .9,
        transform: box().openTransform(FACE.E, this.progress * this.angle()) });
    },
    hit(frame, x, y) {
      if (!box().hitPolygons(this.polygons, x, y)) return false;
      this.pressedUntil = frame.now + 250;
      this.target = 0;
      hologram.show(frame);
      frame.vibrate([40, 60, 40]);
      frame.say('中のスイッチON（上に何か現れました）', '#ffdb54');
      return true;
    },
    drag(frame, info) {
      if (info.face !== FACE.E || !info.axes || !this.armed(frame)) return false;
      const along = -(info.dx * info.axes.up.x + info.dy * info.axes.up.y) / (info.axes.size * values().swipeSpan);
      this.dragging = true;
      this.progress = clamp01(along);
      return true;
    },
    release(frame, info) {
      if (!this.dragging) return false;
      this.dragging = false;
      this.target = this.progress > values().swipeOpen ? 1 : 0;
      frame.vibrate(40);
      frame.say(this.target ? 'スワイプ: Eの面が開きます' : 'スワイプ: Eの面が閉じます', '#ff5268');
      return true;
    },
    status(frame) {
      if (!this.armed(frame)) return null;
      return this.progress > .5 ? '中のスイッチを押す' : 'Eの面を矢印の向きにスワイプ';
    },
    jumps: [
      { label: 'ふたを開ける', go: () => { lid.target = 1; lid.progress = 1; lid.seen = performance.now(); } },
      { label: 'ふたを閉じる', go: () => { lid.target = 0; lid.progress = 0; } }
    ]
  };

  // --- the anamorphic letters, floating above the box -------------------------------------------
  const hologram = {
    id: 'hologram', title: '浮かぶ文字',
    visible: false,
    reset() { this.visible = false; },
    show() { this.visible = true; },
    drawOverlay(frame) {
      if (!this.visible) return;
      const placed = box().placeAnamorphic(root.MockARAnamorphic, frame.pose, { height: values().hologramHeight });
      if (placed) box().drawMesh(frame.ctx, frame.pose, placed, 1);
    },
    status() { return this.visible ? '箱を横に回して、文字がそろう向きを探す' : null; },
    jumps: [
      { label: '文字を出す', go: () => hologram.show() },
      { label: '文字を消す', go: () => hologram.reset() }
    ]
  };

  // --- the side-scroller on FACE_F, solved by turning the box ------------------------------------
  const run = {
    id: 'run', title: 'F面のゲーム',
    state: null,
    reset() { this.state = null; },
    start() { this.state = runner().create(); },
    longPress(frame, face) {
      if (face !== FACE.F) return false;
      this.start();
      frame.vibrate([30, 50, 30]);
      frame.say('Fの面: 走り出しました', '#ff5268');
      return true;
    },
    drawOverlay(frame) {
      if (!this.state) return;
      const axes = box().faceScreenAxes(frame.pose, FACE.F);
      if (!axes) { this.state = null; return; }
      if (this.state.turn === undefined) this.state.turn = runner().uprightTurn(axes);
      const { ex, ey, down, walk } = runner().frame(axes, this.state.turn);
      runner().update(this.state, frame.seconds, down, walk);
      const span = values().stageSpan;
      const project = (x, y) => {
        const u = (x / runner().COLS - .5) * span, v = (y / runner().ROWS - .5) * span;
        return frame.pose.project(box().facePoint(FACE.F, u * ex[0] + v * ey[0], u * ex[1] + v * ey[1], .004));
      };
      runner().draw(frame.ctx, project, this.state);
      if (this.state.done) this.state = null;
    },
    status() { return this.state ? (this.state.blocked ? '壁にぶつかった。箱を回してみる' : 'Fの面を走っている') : null; },
    jumps: [
      { label: '走らせる', go: () => run.start() },
      { label: '止める', go: () => run.reset() }
    ]
  };

  // --- go round to the other side, then hold the E face between CL and AR ------------------------
  const word = {
    id: 'word', title: 'CL + E + AR',
    turn: null, centredSince: 0, cleared: false,
    reset() { this.turn = null; this.centredSince = 0; this.cleared = false; },
    // Where the player stood when B was tapped: the phone's heading if it has one, else the
    // direction from box to camera, which cannot tell a walk from the box being turned.
    arm(frame) {
      const view = box().cameraFrame(frame.pose), length = view && Math.hypot(...view.center);
      if (!(length > 1e-6)) return false;
      this.turn = { from: view.center.map(x => x / length), heading: frame.heading, turned: false, best: 0 };
      this.centredSince = 0; this.cleared = false;
      return true;
    },
    bySensor() { return this.turn && this.turn.heading !== null && this.turn.heading !== undefined && root.MockARScenes.heading !== null; },
    degrees(frame) {
      if (!this.turn) return 0;
      if (this.bySensor()) {
        const gap = Math.abs((root.MockARScenes.heading - this.turn.heading) % 360);
        return gap > 180 ? 360 - gap : gap;
      }
      const view = frame && frame.pose && box().cameraFrame(frame.pose);
      const length = view && Math.hypot(...view.center);
      if (!(length > 1e-6)) return this.turn.best;
      const cosine = view.center.reduce((sum, x, i) => sum + x * this.turn.from[i], 0) / length;
      return Math.acos(Math.min(1, Math.max(-1, cosine))) * 180 / Math.PI;
    },
    tap(frame, face) {
      if (face !== FACE.B || !this.arm(frame)) return false;
      frame.vibrate(40);
      frame.say('Bの面を押した', box().faceColors[FACE.B]);
      return true;
    },
    update(frame) {
      if (!this.turn) return;
      const v = values(), degrees = this.degrees(frame);
      this.turn.best = Math.max(this.turn.best, degrees);
      if (!this.turn.turned && degrees >= v.halfTurnDeg) {
        this.turn.turned = true;
        frame.vibrate([30, 40, 30, 40, 60]);
      }
      if (!this.turn.turned || !frame.pose) return;
      const front = box().frontFace(frame.pose.rotation), middle = frame.pose.project([0, 0, 0]);
      const offset = middle ? Math.hypot(middle.x - frame.canvas.width / 2, middle.y - frame.canvas.height / 2) : Infinity;
      const inPlace = front.face === FACE.E && front.score > v.clearFacing && offset < frame.canvas.width * v.clearCentred;
      if (!inPlace) this.centredSince = 0;
      else if (!this.centredSince) this.centredSince = frame.now;
      else if (frame.now - this.centredSince >= v.clearHoldMs && !this.cleared) {
        this.cleared = true;
        frame.vibrate([60, 50, 160]);
      }
    },
    boxOptions(frame, options) { if (this.cleared) options.gold = true; },
    drawScreen(frame) {
      if (!this.turn) return;
      if (this.turn.turned) this.drawWord(frame);
      else this.drawProgress(frame);
    },
    // CL and AR sit at fixed places on screen; the box is brought between them.
    drawWord(frame) {
      const { ctx, canvas } = frame, size = Math.round(canvas.width * .15), gap = canvas.width * .29;
      ctx.save();
      ctx.font = `bold ${size}px system-ui,sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(3, size * .08); ctx.strokeStyle = '#00000088';
      ctx.fillStyle = this.cleared ? '#e8b23a' : '#ffffff';
      for (const [text, x] of [['CL', canvas.width / 2 - gap], ['AR', canvas.width / 2 + gap]]) {
        ctx.strokeText(text, x, canvas.height / 2); ctx.fillText(text, x, canvas.height / 2);
      }
      if (this.cleared) {
        ctx.font = `bold ${Math.round(size * .7)}px system-ui,sans-serif`;
        ctx.strokeText('CLEAR', canvas.width / 2, canvas.height * .16);
        ctx.fillText('CLEAR', canvas.width / 2, canvas.height * .16);
      }
      ctx.restore();
    },
    // How far round the player has come, on the video itself so it can be read while moving.
    drawProgress(frame) {
      const { ctx, canvas } = frame, target = values().halfTurnDeg;
      const size = Math.max(14, Math.round(canvas.width * .045)), degrees = this.degrees(frame);
      ctx.save();
      ctx.font = `bold ${size}px system-ui,sans-serif`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.lineWidth = Math.max(3, size * .3); ctx.strokeStyle = '#000000aa';
      const text = `${Math.round(degrees)}° / ${target}°${this.bySensor() ? '' : '（箱基準）'}`;
      ctx.strokeText(text, size * .6, size * .6);
      ctx.fillStyle = '#ffdb54'; ctx.fillText(text, size * .6, size * .6);
      const full = canvas.width - size * 1.2, done = full * Math.min(1, degrees / target);
      ctx.fillStyle = '#00000077'; ctx.fillRect(size * .6, size * 2, full, size * .35);
      ctx.fillStyle = '#ffdb54'; ctx.fillRect(size * .6, size * 2, done, size * .35);
      ctx.restore();
    },
    status(frame) {
      if (!this.turn) return null;
      if (this.cleared) return 'CLEAR';
      return this.turn.turned ? 'E面を正面にして、箱を画面の中央へ'
        : `半周したか: ${this.degrees(frame).toFixed(0)}度（${this.bySensor() ? 'スマホの向き' : '箱との相対角'}）`;
    },
    jumps: [
      { label: '半周した状態にする', go: () => { word.turn = { from: [0, 0, -1], heading: null, turned: true, best: 180 }; word.cleared = false; } },
      { label: 'CLEARにする', go: () => { word.jumps[0].go(); word.cleared = true; } },
      { label: '最初から', go: () => word.reset() }
    ]
  };

  // --- the printed QR, read as a marker of its own -----------------------------------------------
  const qr = {
    id: 'qr', title: 'QRコード',
    boxOptions(frame, options) {
      if (!frame.qr || !frame.qr.name) return;
      for (let k = 0; k < 6; k++) options.colors[k] = '#ff2d2d';
    },
    drawScreen(frame) {
      const corners = frame.qr && frame.qr.corners;
      if (!corners) return;
      const points = [corners.topLeftCorner, corners.topRightCorner, corners.bottomRightCorner, corners.bottomLeftCorner];
      const ctx = frame.ctx;
      ctx.save();
      ctx.strokeStyle = frame.qr.name ? '#ff2d2d' : '#ffbd4a'; ctx.lineWidth = 3;
      ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.closePath(); ctx.stroke();
      ctx.restore();
    }
  };

  // Order matters: a gesture goes to the first module that claims it, and the faces take what is left.
  const list = [qr, lid, hologram, run, word, faces];
  const api = {
    list, FACE, heading: null,
    get: id => list.find(scene => scene.id === id),
    reset: () => list.forEach(scene => scene.reset && scene.reset()),
    // Ask each module in turn; the first one to claim the gesture wins.
    claim(method, frame, ...rest) {
      for (const scene of list) if (scene[method] && scene[method](frame, ...rest)) return scene;
      return null;
    },
    // One frame: let every module update, then draw the box, what sits on it, and the screen.
    // The page and the preview both go through here, so they cannot drift apart.
    render(frame) {
      for (const scene of list) if (scene.update) scene.update(frame);
      if (frame.pose) {
        const options = { labels: {}, colors: {} };
        for (const scene of list) if (scene.boxOptions) scene.boxOptions(frame, options);
        let drawn = false;
        for (const scene of list) if (!drawn && scene.drawBox) drawn = scene.drawBox(frame, options);
        if (!drawn) box().draw(frame.ctx, frame.pose, frame.style, frame.opacity, options);
        for (const scene of list) if (scene.drawOverlay) scene.drawOverlay(frame, options);
      }
      for (const scene of list) if (scene.drawScreen) scene.drawScreen(frame);
    },
    // Whatever the player is in the middle of speaks first.
    status(frame) {
      for (const scene of [word, run, hologram, lid, faces]) {
        const text = scene.status && scene.status(frame);
        if (text) return text;
      }
      return '面をタップ・長押し・スワイプしてみる';
    }
  };
  if (typeof module !== 'undefined') module.exports = api;
  root.MockARScenes = api;
})(globalThis);
