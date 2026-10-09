// The white box sequence on the page: a module of the same shape as those in scenes.js. It turns the
// pose into a sequence.js frame, passes on taps and swipes, and draws the look sequence.js describes.
// Every rule lives in sequence.js; this file only reads the look (like View/BoxView.cs in Unity).
(function (root) {
  'use strict';
  const S = () => root.MockARSequence, box = () => root.MockARBox, values = () => root.MockARConfig.values;
  const SIZE = 256, GRID = 6;
  const INTERIOR = [87, 87, 92], GLASS = 'rgba(153,204,255,.2)', GOLD = 'rgb(255,199,38)', CLOCK = 'rgb(140,255,184)';
  const FONT = 'system-ui,"Yu Gothic UI","Hiragino Sans",sans-serif';
  // A fixed light from the upper left (camera axes, y up) keeps a white box readable on a light table.
  const LIGHT = (l => l.map(x => x / Math.hypot(...l)))([-.4, .8, -.6]);
  const SUN_RADIUS = .9, SUN_SIZE = .16, HINGE = [0, .5, .5];
  // The suits as text glyphs: without the selector some phones draw ♥ as a red emoji.
  const glyph = text => /^[♥♠♣◆]$/.test(text) ? text + '\uFE0E' : text;
  const hex = n => '#' + n.toString(16).padStart(6, '0');
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  // --- the pose as sequence.js sees it --------------------------------------------------------------
  // Box-local ray through a canvas pixel: P maps box points to (u, v, 1) up to scale, so the ray's
  // direction is P's left 3x3 solved against the pixel.
  function rayAt(pose, x, y, width, height) {
    const view = box().cameraFrame(pose), P = pose.matrix;
    if (!view || !P) return null;
    const scale = Math.max(width, height), m = P.map(row => row.slice(0, 3));
    const b = [(x - width / 2) / scale, (y - height / 2) / scale, 1];
    const det = dot(m[0], S().vec.cross(m[1], m[2]));
    if (Math.abs(det) < 1e-12) return null;
    // Cramer's rule, column by column.
    const column = (k) => m.map((row, i) => row.map((v, j) => j === k ? b[i] : v));
    const direction = [0, 1, 2].map(k => { const c = column(k); return dot(c[0], S().vec.cross(c[1], c[2])) / det; });
    return { origin: view.center, direction };
  }
  function gravityOf(frame) {
    if (frame.gravity) return frame.gravity;
    const tilt = frame.tilt;
    if (tilt && Number.isFinite(tilt.beta) && Number.isFinite(tilt.gamma)) return S().Phone.upFromTilt(tilt.beta, tilt.gamma, frame.screenAngle || 0);
    return null;
  }
  function frameOf(frame) {
    const Q = S().Quaternion, now = frame.now / 1000, view = frame.pose && box().cameraFrame(frame.pose);
    if (!view) return S().Frame(Q.Identity, [0, 0, 0], Q.Identity, [0, 0, -5], now);
    const R = frame.pose.rotation, T = R.map(row => -dot(row, view.center));
    return S().Phone.frameFromPose(R, T, gravityOf(frame), now);
  }

  // --- drawing helpers ------------------------------------------------------------------------------
  const path = (ctx, points) => { ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); };
  // One textured triangle: an affine map from texture pixels to the screen, clipped to the triangle
  // pushed out a little so neighbours leave no hairline gap.
  function texturedTriangle(ctx, image, s, t) {
    const [x0, y0] = t[0], [x1, y1] = t[1], [x2, y2] = t[2];
    const den = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(den) < 1e-9) return;
    const X = s.map(p => p.x), Y = s.map(p => p.y);
    const a = ((X[1] - X[0]) * (y2 - y0) - (X[2] - X[0]) * (y1 - y0)) / den;
    const c = ((X[2] - X[0]) * (x1 - x0) - (X[1] - X[0]) * (x2 - x0)) / den;
    const b = ((Y[1] - Y[0]) * (y2 - y0) - (Y[2] - Y[0]) * (y1 - y0)) / den;
    const d = ((Y[2] - Y[0]) * (x1 - x0) - (Y[1] - Y[0]) * (x2 - x0)) / den;
    const cx = (X[0] + X[1] + X[2]) / 3, cy = (Y[0] + Y[1] + Y[2]) / 3;
    ctx.save();
    path(ctx, s.map(p => { const l = Math.hypot(p.x - cx, p.y - cy) || 1; return { x: p.x + (p.x - cx) / l * 1.2, y: p.y + (p.y - cy) / l * 1.2 }; }));
    ctx.clip();
    ctx.transform(a, b, c, d, X[0] - a * x0 - c * y0, Y[0] - b * x0 - d * y0);
    ctx.drawImage(image, 0, 0);
    ctx.restore();
  }
  // A face texture laid on the face with its perspective: the uv square is cut into a grid and each
  // cell drawn as two affine triangles, which is as close as a 2D canvas gets to a projective map.
  function texturedFace(ctx, image, at) {
    const grid = [];
    for (let j = 0; j <= GRID; j++) for (let i = 0; i <= GRID; i++) {
      const p = at([i / GRID, j / GRID]);
      if (!p) return false;
      grid.push(p);
    }
    const point = (i, j) => grid[j * (GRID + 1) + i], tex = (i, j) => [i / GRID * SIZE, (1 - j / GRID) * SIZE];
    for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
      texturedTriangle(ctx, image, [point(i, j), point(i + 1, j), point(i + 1, j + 1)], [tex(i, j), tex(i + 1, j), tex(i + 1, j + 1)]);
      texturedTriangle(ctx, image, [point(i, j), point(i + 1, j + 1), point(i, j + 1)], [tex(i, j), tex(i + 1, j + 1), tex(i, j + 1)]);
    }
    return true;
  }
  // Cuts a 3D polygon along the glass boundary: the part inside the glass and the part outside.
  function splitByGlass(points, glass) {
    const inside = [], outside = [];
    points.forEach((p, i) => {
      const q = points[(i + 1) % points.length], a = glass.side(p) - S().Glass.Tolerance, b = glass.side(q) - S().Glass.Tolerance;
      (a < 0 ? inside : outside).push(p);
      if ((a < 0) !== (b < 0)) {
        const t = a / (a - b), cut = [0, 1, 2].map(k => p[k] + (q[k] - p[k]) * t);
        inside.push(cut); outside.push(cut);
      }
    });
    return { inside: inside.length >= 3 ? inside : null, outside: outside.length >= 3 ? outside : null };
  }
  function canvasOf() {
    const canvas = root.document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    return canvas;
  }

  const scene = {
    id: 'sequence', title: '白い箱の謎',
    sequence: null, config: null, textures: [], clockTexture: null, images: {}, switches: null, switchPolygons: null, swipe: null,
    ensure() {
      if (!this.sequence) { this.config = S().createConfig(values()); this.sequence = new (S().Sequence)(this.config); }
      return this.sequence;
    },
    reset() { this.ensure().reset(0); this.swipe = null; },
    update(frame) {
      const before = this.ensure().index;
      this.sequence.update(frameOf(frame));
      if (this.sequence.index !== before) frame.vibrate([30, 40, 60]);
    },

    // --- input ------------------------------------------------------------------------------------
    hit(frame, x, y) {
      const seq = this.ensure();
      if (seq.look.switch === S().SwitchState.Hidden || !box().hitPolygons(this.switchPolygons, x, y)) return false;
      this.answer(frame, seq.tap(frameOf(frame), S().Hit.onSwitch), 'スイッチ');
      return true;
    },
    pick(frame, x, y) {
      const ray = frame.pose && rayAt(frame.pose, x, y, frame.canvas.width, frame.canvas.height);
      return ray && S().Geometry.raycast(ray.origin, ray.direction);
    },
    tap(frame, face, point) {
      const hit = point && this.pick(frame, point.x, point.y);
      if (!hit) return false;
      this.answer(frame, this.ensure().tap(frameOf(frame), hit), `${S().FACE_NAMES[hit.face]} (${hit.uv.map(x => x.toFixed(2)).join(', ')})`);
      return true;
    },
    drag(frame, info) {
      if (!this.swipe) {
        const hit = info.x !== undefined && this.pick(frame, info.x, info.y);
        if (!hit) return false;
        this.swipe = { face: hit.face, x: info.x, y: info.y };
      }
      return true;
    },
    // Read as on the Unity prototype: both ends of the finger on the plane of the face it started on.
    release(frame, info) {
      const swipe = this.swipe;
      this.swipe = null;
      if (!swipe || !frame.pose) return !!swipe;
      const { width, height } = frame.canvas;
      const from = rayAt(frame.pose, swipe.x, swipe.y, width, height), to = rayAt(frame.pose, swipe.x + (info.dx || 0), swipe.y + (info.dy || 0), width, height);
      const a = from && S().Geometry.planeUv(swipe.face, from.origin, from.direction), b = to && S().Geometry.planeUv(swipe.face, to.origin, to.direction);
      if (!a || !b) return true;
      this.answer(frame, this.ensure().swipe(frameOf(frame), swipe.face, [b[0] - a[0], b[1] - a[1]]), 'スワイプ');
      return true;
    },
    answer(frame, outcome, what) {
      if (outcome === S().Outcome.Ignored) return;
      frame.vibrate(outcome === S().Outcome.Done ? [30, 40, 60] : 30);
      frame.say(`${what}: ${this.sequence.look.status}`, '#ffdb54');
    },

    // --- drawing ----------------------------------------------------------------------------------
    image(id) {
      if (!this.images[id] && typeof root.Image === 'function') {
        const image = new root.Image();
        image.src = 'puzzle/face_0' + id.slice('puzzle/'.length) + '.png';
        this.images[id] = image;
      }
      const image = this.images[id];
      return image && image.complete && image.naturalWidth > 0 ? image : null;
    },
    texture(f, art) {
      const image = art.image && this.image(art.image);
      const key = [art.color, art.image, !!image, art.text, art.textColor, art.arrow, art.lit].join('|');
      const cached = this.textures[f];
      if (cached && cached.key === key) return cached.canvas;
      const canvas = cached ? cached.canvas : canvasOf(), ctx = canvas.getContext('2d');
      this.textures[f] = { key, canvas };
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.fillStyle = hex(art.color); ctx.fillRect(0, 0, SIZE, SIZE);
      if (image) ctx.drawImage(image, 0, 0, SIZE, SIZE);
      if (art.lit) {
        const band = SIZE * .07;
        ctx.globalAlpha = .18; ctx.fillStyle = GOLD; ctx.fillRect(0, 0, SIZE, SIZE);
        ctx.globalAlpha = .9;
        ctx.fillRect(0, 0, SIZE, band); ctx.fillRect(0, SIZE - band, SIZE, band);
        ctx.fillRect(0, band, band, SIZE - 2 * band); ctx.fillRect(SIZE - band, band, band, SIZE - 2 * band);
        ctx.globalAlpha = 1;
      }
      if (art.text) {
        ctx.font = `${Math.round(Math.min(.5, .85 / art.text.length) * SIZE)}px ${FONT}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = hex(art.textColor);
        ctx.fillText(glyph(art.text), SIZE / 2, SIZE / 2);
      }
      if (art.arrow !== null) {
        const d = S().Geometry.edgeDirection(f, art.arrow), h = SIZE * .16;
        ctx.save();
        ctx.translate((.5 + d[0] * .37) * SIZE, (.5 - d[1] * .37) * SIZE);
        ctx.rotate(-Math.atan2(d[1], d[0]));
        ctx.beginPath(); ctx.moveTo(h * .45, 0); ctx.lineTo(-h * .35, -h * .42); ctx.lineTo(-h * .35, h * .42); ctx.closePath();
        ctx.fillStyle = '#666'; ctx.fill();
        ctx.restore();
      }
      return canvas;
    },
    clock(text) {
      if (this.clockTexture && this.clockTexture.text === text) return this.clockTexture.canvas;
      const canvas = this.clockTexture ? this.clockTexture.canvas : canvasOf(), ctx = canvas.getContext('2d');
      this.clockTexture = { text, canvas };
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.font = `${Math.round(.26 * SIZE)}px ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = CLOCK;
      ctx.fillText(text, SIZE / 2, SIZE / 2);
      return canvas;
    },
    // Where every face is this frame: corners in box space (the top swung open on its back edge, as
    // the Unity lid hinge), its normal, and whether its outside looks at the camera.
    faces(pose, look) {
      const G = S().Geometry, camera = box().cameraFrame(pose).center;
      const angle = values().lidOpenDeg * look.lidOpen * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
      const swing = v => [v[0], v[1] * cos - v[2] * sin, v[1] * sin + v[2] * cos];
      return [0, 1, 2, 3, 4, 5].map(f => {
        const lid = f === S().Face.Top && look.lidOpen > 0;
        const place = lid ? p => swing(sub(p, HINGE)).map((x, i) => x + HINGE[i]) : p => p;
        const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(uv => place(G.point(f, uv)));
        const normal = lid ? swing(G.normal(f)) : G.normal(f);
        const center = corners.reduce((c, p) => c.map((x, i) => x + p[i] / 4), [0, 0, 0]);
        return { f, lid, place, corners, normal, center, facing: dot(normal, sub(camera, center)) > 0 };
      });
    },
    shade(pose, normal) {
      const n = pose.rotation.map(row => dot(row, normal));
      return .82 + .18 * (n[0] * LIGHT[0] - n[1] * LIGHT[1] + n[2] * LIGHT[2]);
    },
    drawInside(ctx, pose, face) {
      const points = face.corners.map(pose.project);
      if (points.some(p => !p)) return;
      const k = this.shade(pose, face.normal.map(x => -x));
      path(ctx, points);
      ctx.fillStyle = `rgb(${INTERIOR.map(x => Math.round(x * k))})`; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1; ctx.stroke();
    },
    drawOutside(ctx, pose, face, look) {
      const project = pose.project, all = face.corners.map(project);
      if (all.some(p => !p)) return;
      const parts = look.glass ? splitByGlass(face.corners, look.glass) : { inside: null, outside: face.corners };
      const texture = this.texture(face.f, look.faces[face.f]);
      const at = uv => project(face.place(S().Geometry.point(face.f, uv)));
      if (parts.outside) {
        const solid = parts.outside.map(project);
        ctx.save();
        path(ctx, solid);
        if (parts.inside) ctx.clip();
        // The face's own colour underneath, so what seeps between the triangles is not the video.
        ctx.fillStyle = hex(look.faces[face.f].color); ctx.fill();
        texturedFace(ctx, texture, at);
        path(ctx, solid);
        ctx.fillStyle = `rgba(0,0,0,${(1 - this.shade(pose, face.normal)).toFixed(3)})`; ctx.fill();
        ctx.restore();
      }
      path(ctx, all); ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.lineWidth = 1; ctx.stroke();
    },
    drawGlass(ctx, pose, face, look) {
      const part = look.glass && splitByGlass(face.corners, look.glass).inside, points = part && part.map(pose.project);
      if (!points || points.some(p => !p)) return;
      path(ctx, points); ctx.fillStyle = GLASS; ctx.fill();
    },
    drawFace(ctx, pose, face, look) {
      if (!face.facing) { this.drawInside(ctx, pose, face); return; }
      this.drawGlass(ctx, pose, face, look);
      this.drawOutside(ctx, pose, face, look);
    },
    drawSun(ctx, pose, look) {
      const d = S().Sky.sunDirection(look.sun.hourShown, this.config.eastIsLeft), at = [d[0] * SUN_RADIUS, d[1] * SUN_RADIUS, 0];
      // Row 0 of the rotation is the camera's right in box axes, so the disc keeps its size on screen.
      const center = pose.project(at), edge = pose.project(at.map((x, i) => x + pose.rotation[0][i] * SUN_SIZE));
      if (!center || !edge) return;
      const r = Math.hypot(edge.x - center.x, edge.y - center.y);
      const glow = ctx.createRadialGradient(center.x, center.y, r * .8, center.x, center.y, r * 1.9);
      glow.addColorStop(0, 'rgba(255,158,20,.55)'); glow.addColorStop(1, 'rgba(255,158,20,0)');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(center.x, center.y, r * 1.9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgb(255,190,110)'; ctx.beginPath(); ctx.arc(center.x, center.y, r, 0, Math.PI * 2); ctx.fill();
    },
    // The letters stand inside the box and show only through the glass of the faces turned this way.
    drawHologram(ctx, pose, faces, look, opacity) {
      const windows = [];
      for (const face of faces) if (face.facing) {
        const part = splitByGlass(face.corners, look.glass).inside;
        const points = part && part.map(pose.project);
        if (points && points.every(Boolean)) windows.push(points);
      }
      const view = box().cameraFrame(pose), mesh = root.MockARAnamorphic;
      if (!windows.length || !view || !mesh) return;
      const c = this.config, p = S().Sky.placeAnamorphic(view.center, view.up, c.hologramHeight, c.hologramDesignDistance, c.hologramSize);
      if (!p) return;
      const vertices = mesh.vertices.map(v => [0, 1, 2].map(i => p.pivot[i] + p.scale * (v[0] * p.x[i] + v[1] * p.y[i] + v[2] * p.z[i])));
      ctx.save();
      ctx.beginPath();
      for (const points of windows) { points.forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)); ctx.closePath(); }
      ctx.clip();
      box().drawMesh(ctx, pose, { ...mesh, vertices }, opacity, view.center);
      ctx.restore();
    },
    // The switch on the floor inside, as the demo's lid has it; pressed sinks the button.
    switchMesh(pressed) {
      if (!this.switches) this.switches = [0, .1].map(depth =>
        box().placeOnFace(root.MockARSwitch, S().MARKER[S().Face.Bottom], .55, [1], depth, true));
      return this.switches[pressed ? 1 : 0];
    },
    // Painter's order, far to near: what is behind the box, the inner walls, what stands inside,
    // the outer walls, then what is in front.
    drawBox(frame) {
      const look = this.ensure().look, { ctx, pose } = frame, faces = this.faces(pose, look);
      const middle = pose.project([0, 0, 0]), behind = p => { const q = pose.project(p); return !q || !middle || q.d > middle.d; };
      const sunAt = look.sun && (d => [d[0] * SUN_RADIUS, d[1] * SUN_RADIUS, 0])(S().Sky.sunDirection(look.sun.hourShown, this.config.eastIsLeft));
      const lid = faces.find(face => face.lid), lidBehind = lid && behind(lid.center);
      ctx.save();
      ctx.globalAlpha = frame.opacity ?? 1;
      if (sunAt && behind(sunAt)) this.drawSun(ctx, pose, look);
      if (lid && lidBehind) this.drawFace(ctx, pose, lid, look);
      for (const face of faces) if (!face.lid && !face.facing) this.drawInside(ctx, pose, face);
      this.switchPolygons = look.switch === S().SwitchState.Hidden || !root.MockARSwitch ? null
        : box().drawMesh(ctx, pose, this.switchMesh(look.switch === S().SwitchState.Pressed), ctx.globalAlpha, box().cameraFrame(pose).center) || null;
      // The tint goes first, as the Unity glass queue does, so the letters behind it stay bright.
      for (const face of faces) if (!face.lid && face.facing) this.drawGlass(ctx, pose, face, look);
      if (look.hologram && look.glass) this.drawHologram(ctx, pose, faces, look, ctx.globalAlpha);
      for (const face of faces) if (!face.lid && face.facing) this.drawOutside(ctx, pose, face, look);
      if (lid && !lidBehind) this.drawFace(ctx, pose, lid, look);
      const clockFace = look.clock && faces[look.clock.face];
      if (clockFace && clockFace.facing)
        texturedFace(ctx, this.clock(look.clock.text), uv => pose.project(clockFace.place(S().Geometry.point(clockFace.f, uv))));
      if (sunAt && !behind(sunAt)) this.drawSun(ctx, pose, look);
      ctx.restore();
      return true;
    },
    // How the diamond is being judged, on the video itself so it can be read while turning the box.
    drawScreen(frame) {
      const seq = this.ensure(), { ctx, canvas } = frame, size = Math.max(13, Math.round(canvas.width * .034));
      const lines = [`${seq.index + 1}/${seq.count} ${seq.current.id}: ${seq.look.status}`];
      const diamond = this.config.suits.find(s => s.diamond);
      if (seq.current.id === 'suits' && diamond && frame.pose) lines.push(this.rollText(frame, diamond));
      ctx.save();
      ctx.font = `bold ${size}px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.lineWidth = Math.max(3, size * .3); ctx.strokeStyle = '#000000aa'; ctx.fillStyle = '#ffdb54';
      lines.forEach((text, i) => { ctx.strokeText(text, size * .6, size * (.6 + i * 1.4)); ctx.fillText(text, size * .6, size * (.6 + i * 1.4)); });
      ctx.restore();
    },
    rollText(frame, diamond) {
      const roll = S().Geometry.rollDeg(frameOf(frame), diamond.face), c = this.config;
      return `${diamond.symbol}の面の傾き ${roll.toFixed(1)}°（目標 ${c.diamondDeg}±${c.diamondToleranceDeg}°・` +
        (gravityOf(frame) ? '重力基準: センサー' : '画面基準: センサーなし') + '）';
    },
    status(frame) {
      const seq = this.ensure(), diamond = this.config.suits.find(s => s.diamond);
      const detail = seq.current.id === 'suits' && diamond && frame && frame.pose ? ' / ' + this.rollText(frame, diamond) : '';
      return `${seq.index + 1}/${seq.count} ${seq.current.id}: ${seq.look.status}${detail}`;
    },

    // Puts the sequence in a given state through its own rules, with synthetic views like the Unity
    // tests use: step (index or id), open (the lid after a correct seam tap), lit (suits already
    // tapped, the diamond never) and hour (the clock swiped up that many times, the sun settled).
    stage({ step = 0, open = false, lit = 0, hour = 0 } = {}, now = root.performance ? root.performance.now() / 1000 : 0) {
      const seq = this.ensure(), M = S(), Q = M.Quaternion, c = this.config;
      const index = typeof step === 'number' ? step : Math.max(0, c.order.indexOf(step));
      const at = (rotation, t) => M.Frame(rotation, [0, 0, 0], Q.Identity, [0, 0, -5], t);
      seq.reset(index);
      if (open && seq.current.id === 'puzzle') {
        const corner = Q.fromAxisAngle([0, 1, 0], Math.PI / 4);
        seq.tap(at(corner, now), M.Hit.onFace(c.puzzleFaces[0], [1 - c.seamTouch / 2, .5]));
        seq.update(at(corner, now)); seq.update(at(corner, now + 10));
      }
      if (lit && seq.current.id === 'suits')
        c.suits.slice(0, lit).filter(s => !s.diamond).forEach(s => seq.tap(at(Q.Identity, now), M.Hit.onFace(s.face, [.5, .5])));
      if (hour && seq.current.id === 'clock') {
        for (let i = 0; i < hour; i++) seq.swipe(at(Q.Identity, now), c.clockFace, [0, 1]);
        seq.update(at(Q.Identity, now + 10));
      }
    },
    jumps: []
  };
  scene.jumps = (root.MockARSequence ? root.MockARSequence.ORDER : []).map((id, i) => ({ label: `${i + 1} ${id}`, go: () => scene.stage({ step: i }) }))
    .concat([
      { label: 'ふたを開ける', go: () => scene.stage({ step: 'puzzle', open: true }) },
      { label: '♥♠♣まで押した', go: () => scene.stage({ step: 'suits', lit: 3 }) },
      { label: '9:00', go: () => scene.stage({ step: 'clock', hour: 9 }) },
      { label: '12:00', go: () => scene.stage({ step: 'clock', hour: 12 }) },
      { label: '15:00', go: () => scene.stage({ step: 'clock', hour: 15 }) }
    ]);
  if (typeof module !== 'undefined') module.exports = scene;
  root.MockARSequenceScene = scene;
})(globalThis);
