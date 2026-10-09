// The white box sequence: the rules only, no page and no drawing. A port of the Unity prototype
// (Sequence/Logic/*.cs) with the same names and numbers, so the two can be read side by side.
// Box-local axes follow Unity, like box.js: +X right, +Y up, Front at -Z. Tunable numbers come from
// config.js; the order and the face tables live here.
(function (root) {
  'use strict';
  const Face = { Front: 0, Right: 1, Back: 2, Left: 3, Top: 4, Bottom: 5 };
  const FACE_NAMES = ['Front', 'Right', 'Back', 'Left', 'Top', 'Bottom'];
  // Printed marker (box.js index, FACE_A..F) under each logical face. FACE_F is glued turned 180
  // degrees, so its marker axes are the logical ones negated; uv always uses the logical axes.
  const MARKER = [0, 2, 5, 4, 1, 3];
  const Outcome = { Ignored: 'Ignored', Handled: 'Handled', Done: 'Done' };
  const SwitchState = { Hidden: 'Hidden', Idle: 'Idle', Pressed: 'Pressed' };
  const White = 0xffffff;

  // --- vectors and quaternions, with System.Numerics' conventions ---------------------------------
  const v3 = (x, y, z) => [x, y, z];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const length = a => Math.sqrt(dot(a, a));
  const normalize = a => scale(a, 1 / length(a));
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const UnitX = v3(1, 0, 0), UnitY = v3(0, 1, 0), UnitZ = v3(0, 0, 1);

  const Quaternion = {
    Identity: { x: 0, y: 0, z: 0, w: 1 },
    fromAxisAngle(axis, radians) {
      const s = Math.sin(radians / 2);
      return { x: axis[0] * s, y: axis[1] * s, z: axis[2] * s, w: Math.cos(radians / 2) };
    },
    multiply(a, b) {
      return {
        x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
        y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
        z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
        w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z
      };
    },
    // first, then second, as Quaternion.Concatenate.
    concatenate(first, second) { return Quaternion.multiply(second, first); },
    transform(v, q) {
      const x2 = q.x + q.x, y2 = q.y + q.y, z2 = q.z + q.z;
      const wx = q.w * x2, wy = q.w * y2, wz = q.w * z2, xx = q.x * x2, xy = q.x * y2, xz = q.x * z2;
      const yy = q.y * y2, yz = q.y * z2, zz = q.z * z2;
      return [v[0] * (1 - yy - zz) + v[1] * (xy - wz) + v[2] * (xz + wy),
        v[0] * (xy + wz) + v[1] * (1 - xx - zz) + v[2] * (yz - wx),
        v[0] * (xz - wy) + v[1] * (yz + wx) + v[2] * (1 - xx - yy)];
    },
    // Rows of a proper rotation matrix (det +1).
    fromMatrix(m) {
      const t = m[0][0] + m[1][1] + m[2][2];
      let q;
      if (t > 0) {
        const s = Math.sqrt(t + 1) * 2;
        q = { w: s / 4, x: (m[2][1] - m[1][2]) / s, y: (m[0][2] - m[2][0]) / s, z: (m[1][0] - m[0][1]) / s };
      } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
        const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2;
        q = { w: (m[2][1] - m[1][2]) / s, x: s / 4, y: (m[0][1] + m[1][0]) / s, z: (m[0][2] + m[2][0]) / s };
      } else if (m[1][1] > m[2][2]) {
        const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2;
        q = { w: (m[0][2] - m[2][0]) / s, x: (m[0][1] + m[1][0]) / s, y: s / 4, z: (m[1][2] + m[2][1]) / s };
      } else {
        const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2;
        q = { w: (m[1][0] - m[0][1]) / s, x: (m[0][2] + m[2][0]) / s, y: (m[1][2] + m[2][1]) / s, z: s / 4 };
      }
      return q;
    },
    // The shortest turn that carries direction a onto direction b.
    fromTo(a, b) {
      a = normalize(a); b = normalize(b);
      const c = dot(a, b);
      if (c < -1 + 1e-9) {
        const side = Math.abs(a[0]) < .9 ? UnitX : UnitY;
        return Quaternion.fromAxisAngle(normalize(cross(a, side)), Math.PI);
      }
      const axis = cross(a, b), w = 1 + c, n = Math.sqrt(dot(axis, axis) + w * w);
      return { x: axis[0] / n, y: axis[1] / n, z: axis[2] / n, w: w / n };
    }
  };

  // One snapshot of the world. now is in seconds.
  const Frame = (box, boxPosition, camera, cameraPosition, now) => ({ box, boxPosition, camera, cameraPosition, now });
  const Hit = {
    onFace: (face, uv) => ({ face, uv, switch: false }),
    onSwitch: { face: Face.Front, uv: [0, 0], switch: true }
  };

  // --- geometry ------------------------------------------------------------------------------------
  const NORMALS = [scale(UnitZ, -1), UnitX, UnitZ, scale(UnitX, -1), UnitY, scale(UnitY, -1)];
  const Geometry = {
    normal: f => NORMALS[f],
    // Side faces stand upright; the top reads with its top edge at the back, the bottom with it at the front.
    up: f => f === Face.Top ? UnitZ : f === Face.Bottom ? scale(UnitZ, -1) : UnitY,
    right: f => cross(Geometry.normal(f), Geometry.up(f)),
    // uv (0,0) is the bottom-left of the face seen from outside.
    point: (f, uv) => add(add(scale(Geometry.normal(f), .5), scale(Geometry.right(f), uv[0] - .5)), scale(Geometry.up(f), uv[1] - .5)),
    uv: (f, local) => [dot(local, Geometry.right(f)) + .5, dot(local, Geometry.up(f)) + .5],
    // Direction inside face f toward the edge it shares with face toward.
    edgeDirection(f, toward) {
      const n = Geometry.normal(toward);
      return [dot(n, Geometry.right(f)), dot(n, Geometry.up(f))];
    },
    // Box-local ray against the unit box. null when it misses.
    raycast(origin, direction) {
      let near = -Infinity, far = Infinity, axis = -1;
      for (let i = 0; i < 3; i++) {
        const o = origin[i], d = direction[i];
        if (Math.abs(d) < 1e-9) { if (Math.abs(o) > .5) return null; continue; }
        let a = (-.5 - o) / d, b = (.5 - o) / d;
        if (a > b) [a, b] = [b, a];
        if (a > near) { near = a; axis = i; }
        far = Math.min(far, b);
      }
      if (near > far || far < 0 || near < 0 || axis < 0) return null;
      const point = add(origin, scale(direction, near));
      const face = faceOnAxis(axis, point[axis]);
      return Hit.onFace(face, Geometry.uv(face, point));
    },
    // Box-local ray against the (infinite) plane of face f; for swipes that leave the face.
    planeUv(f, origin, direction) {
      const n = Geometry.normal(f), d = dot(direction, n);
      if (Math.abs(d) < 1e-6) return null;
      const t = (.5 - dot(origin, n)) / d;
      if (t < 0) return null;
      return Geometry.uv(f, add(origin, scale(direction, t)));
    },
    visible(fr, f, maxDeg) {
      const normal = Quaternion.transform(Geometry.normal(f), fr.box);
      const center = add(fr.boxPosition, scale(normal, .5));
      const toCamera = normalize(sub(fr.cameraPosition, center));
      return Geometry.degrees(dot(normal, toCamera)) < maxDeg;
    },
    // How far the face is turned about its own normal against gravity. The camera is ignored on
    // purpose: subtracting the phone's tilt from the on-screen tilt leaves exactly this angle.
    rollDeg(fr, f) {
      const normal = Quaternion.transform(Geometry.normal(f), fr.box);
      const up = Quaternion.transform(Geometry.up(f), fr.box);
      let gravityUp = sub(UnitY, scale(normal, normal[1]));
      if (dot(gravityUp, gravityUp) < 1e-6) return 0;
      gravityUp = normalize(gravityUp);
      const sin = dot(cross(gravityUp, up), normal), cos = dot(gravityUp, up);
      return Math.atan2(sin, cos) * 180 / Math.PI;
    },
    degrees: cosine => Math.acos(clamp(cosine, -1, 1)) * 180 / Math.PI
  };
  const faceOnAxis = (axis, sign) => axis === 0 ? (sign > 0 ? Face.Right : Face.Left)
    : axis === 1 ? (sign > 0 ? Face.Top : Face.Bottom) : (sign > 0 ? Face.Back : Face.Front);

  // --- sun and glass -------------------------------------------------------------------------------
  // The lit part of the box: box-local points (x, y) with dot(normal, p - pivot) < Tolerance. z does not
  // matter, because the boundary is a plane perpendicular to the front face. The tolerance keeps the face
  // lying in the boundary plane (the west face at noon) glass instead of flickering.
  class Glass {
    constructor(pivot, normal) { this.pivot = pivot; this.normal = normal; }
    side(p) { return this.normal[0] * (p[0] - this.pivot[0]) + this.normal[1] * (p[1] - this.pivot[1]); }
    contains(p) { return this.side(p) < Glass.Tolerance; }
  }
  Glass.Tolerance = 1e-3;

  const Sky = {
    elevationDeg: hour => (hour - 6) * 15,
    // On a vertical circle parallel to the front face; unit radius.
    sunDirection(hour, eastIsLeft) {
      const e = Sky.elevationDeg(hour) * Math.PI / 180, east = eastIsLeft ? -1 : 1;
      return [east * Math.cos(e), Math.sin(e)];
    },
    // Turns about the bottom edge away from the sun, tilted as high as the sun stands.
    glassAt(hour, eastIsLeft) {
      if (hour <= 6 || hour >= 18) return null;
      const elevation = Sky.elevationDeg(hour), fromHorizon = elevation <= 90 ? elevation : 180 - elevation;
      const x = Sky.sunDirection(hour, eastIsLeft)[0], side = x < -1e-6 ? -1 : x > 1e-6 ? 1 : eastIsLeft ? -1 : 1;
      const a = fromHorizon * Math.PI / 180;
      return new Glass([-side * .5, -.5], [-side * Math.sin(a), Math.cos(a)]);
    },
    // box.js placeAnamorphic with a size: scaled so the design viewpoint sits on the camera, tilted to the
    // camera's height, heading along the box's +Z. Inputs are box-local.
    placeAnamorphic(camera, cameraUp, height, designDistance, size = 1) {
      const up = normalize(cameraUp), pivot = scale(up, height), view = sub(camera, pivot), distance = length(view);
      if (!(distance > 1e-3)) return null;
      const axis = UnitZ;
      let heading = sub(axis, scale(up, dot(axis, up)));
      if (length(heading) < .15) heading = sub(UnitY, scale(up, dot(UnitY, up)));
      heading = normalize(heading);
      const level = sub(view, scale(up, dot(view, up)));
      const elevation = Math.atan2(dot(view, up), length(level)), cos = Math.cos(elevation), sin = Math.sin(elevation);
      const x = normalize(cross(heading, up)), y = add(scale(heading, -sin), scale(up, cos));
      return { pivot, x, y, z: cross(x, y), scale: size * distance / designDistance };
    }
  };

  // --- the look: what the box shows. Steps write it, the page only reads it -----------------------
  class FaceArt {
    constructor() { this.clear(); }
    clear() { this.color = White; this.image = null; this.text = null; this.textColor = 0; this.arrow = null; this.lit = false; }
  }
  class BoxLook {
    constructor() { this.faces = FACE_NAMES.map(() => new FaceArt()); this.clear(); }
    face(f) { return this.faces[f]; }
    clear() {
      for (const art of this.faces) art.clear();
      this.lidOpen = 0; this.switch = SwitchState.Hidden; this.clock = null; this.sun = null; this.glass = null;
      this.hologram = false; this.status = null;
    }
  }

  // --- configuration -------------------------------------------------------------------------------
  const ORDER = ['start', 'puzzle', 'suits', 'clock'];
  const Suit = (face, symbol, symbolColor, faceColor = White, diamond = false) => ({ face, symbol, symbolColor, faceColor, diamond });
  const TABLES = {
    startFace: Face.Front,
    // Image n (face_0n.png) goes on puzzleFaces[n - 1]; the seam is between the first two.
    puzzleFaces: [Face.Front, Face.Right, Face.Left, Face.Back, Face.Top, Face.Bottom],
    suits: [
      Suit(Face.Front, '♥', 0xd81e2c),
      Suit(Face.Right, '♠', 0x111111),
      Suit(Face.Back, '♣', 0x111111),
      Suit(Face.Left, '◆', 0xffffff, 0xd81e2c, true)
    ],
    clockFace: Face.Front
  };
  // config.js keys, read live so the tuning panel takes effect at once. hologramHeight has its own key
  // because the demo's floating letters already use that name with another default.
  const NUMBERS = { seamTouch: 'seamTouch', faceVisibleDeg: 'faceVisibleDeg', lidOpenMs: 'lidOpenMs', lidOpenDeg: 'lidOpenDeg',
    diamondDeg: 'diamondDeg', diamondToleranceDeg: 'diamondToleranceDeg', sunMoveMs: 'sunMoveMs', hourMin: 'hourMin',
    hourMax: 'hourMax', hologramHeight: 'boxHologramHeight', hologramDesignDistance: 'hologramDesignDistance',
    hologramSize: 'hologramSize' };
  function createConfig(values = root.MockARConfig && root.MockARConfig.values) {
    if (!values) throw new Error('createConfig needs config.js values');
    const config = { order: ORDER.slice(), ...TABLES, puzzleFaces: TABLES.puzzleFaces.slice(), suits: TABLES.suits.slice() };
    for (const [name, key] of Object.entries(NUMBERS)) Object.defineProperty(config, name, { get: () => values[key], enumerable: true });
    Object.defineProperty(config, 'eastIsLeft', { get: () => values.eastIsLeft >= .5, enumerable: true });
    return config;
  }

  // --- steps. A step never names another step; only config.order decides what follows. enter receives
  // a cleared look, so a step paints everything it shows and cannot lean on what the previous step left.
  class StartStep {
    constructor(c) { this.c = c; this.id = 'start'; }
    enter(look) {
      look.face(this.c.startFace).text = 'スタート';
      look.face(this.c.startFace).textColor = 0x111111;
      look.status = '「スタート」をタップ';
    }
    update() { return Outcome.Ignored; }
    tap(fr, hit) { return !hit.switch && hit.face === this.c.startFace ? Outcome.Done : Outcome.Ignored; }
    swipe() { return Outcome.Ignored; }
  }

  const Phase = { Seam: 'Seam', Opening: 'Opening', Open: 'Open', Closing: 'Closing' };
  class PuzzleStep {
    constructor(c) { this.c = c; this.id = 'puzzle'; }
    enter(look) {
      this.phase = Phase.Seam; this.lid = 0; this.last = NaN;
      this.c.puzzleFaces.forEach((f, i) => { look.face(f).image = 'puzzle/' + (i + 1); });
      this.paint(look);
    }
    update(fr, look) {
      const step = Number.isNaN(this.last) ? 0 : (fr.now - this.last) * 1000 / this.c.lidOpenMs;
      this.last = fr.now;
      if (this.phase === Phase.Opening && (this.lid = Math.min(1, this.lid + step)) >= 1) this.phase = Phase.Open;
      if (this.phase === Phase.Closing && (this.lid = Math.max(0, this.lid - step)) <= 0) return Outcome.Done;
      this.paint(look);
      return Outcome.Ignored;
    }
    tap(fr, hit, look) {
      if (this.phase === Phase.Seam && this.onSeam(fr, hit)) this.phase = Phase.Opening;
      else if (this.phase === Phase.Open && hit.switch) this.phase = Phase.Closing;
      else return Outcome.Ignored;
      this.paint(look);
      return Outcome.Handled;
    }
    swipe() { return Outcome.Ignored; }
    // The first two puzzle faces meet at the left face's right edge.
    onSeam(fr, hit) {
      const [left, right] = this.c.puzzleFaces;
      if (hit.switch || !Geometry.visible(fr, left, this.c.faceVisibleDeg) || !Geometry.visible(fr, right, this.c.faceVisibleDeg)) return false;
      return hit.face === left && hit.uv[0] >= 1 - this.c.seamTouch || hit.face === right && hit.uv[0] <= this.c.seamTouch;
    }
    paint(look) {
      look.lidOpen = this.lid;
      look.switch = this.phase === Phase.Seam ? SwitchState.Hidden : this.phase === Phase.Closing ? SwitchState.Pressed : SwitchState.Idle;
      look.status = this.phase === Phase.Seam ? '絵がつながる境目をタップ' : this.phase === Phase.Closing ? 'スイッチON' : '中のスイッチをタップ';
    }
  }

  class SuitsStep {
    constructor(c) { this.c = c; this.id = 'suits'; }
    enter(look) { this.next = 0; this.paint(look, null); }
    update() { return Outcome.Ignored; }
    tap(fr, hit, look) {
      const suits = this.c.suits, index = hit.switch ? -1 : suits.findIndex(s => s.face === hit.face);
      if (index < 0) return Outcome.Ignored;
      // Tapping the diamond face before it is turned is not a mistake; it just does nothing.
      if (suits[index].diamond && !this.diamond(fr, suits[index].face)) return Outcome.Ignored;
      if (index !== this.next) {
        this.next = 0;
        this.paint(look, '順番が違う。' + suits[0].symbol + 'からやり直し');
        return Outcome.Handled;
      }
      if (++this.next === suits.length) return Outcome.Done;
      this.paint(look, null);
      return Outcome.Handled;
    }
    swipe() { return Outcome.Ignored; }
    diamond(fr, face) {
      const roll = Geometry.rollDeg(fr, face), folded = (roll % 90 + 90) % 90;
      return Math.abs(folded - this.c.diamondDeg) <= this.c.diamondToleranceDeg;
    }
    paint(look, message) {
      const suits = this.c.suits;
      suits.forEach((s, i) => {
        const art = look.face(s.face);
        // The red face itself is the diamond once it is turned, so it carries no mark of its own.
        art.color = s.faceColor; art.text = s.diamond ? null : s.symbol; art.textColor = s.symbolColor;
        art.arrow = i + 1 < suits.length ? suits[i + 1].face : null;
        art.lit = i < this.next;
      });
      const wanted = suits[this.next];
      look.status = message ?? (wanted.diamond ? wanted.symbol + 'がひし形に見えるように箱を回してタップ' : wanted.symbol + 'をタップ');
    }
  }

  class ClockStep {
    constructor(c) { this.c = c; this.id = 'clock'; }
    enter(look) {
      this.hour = clamp(0, this.c.hourMin, this.c.hourMax);
      this.from = this.shown = this.hour; this.movedAt = NaN;
      for (const art of look.faces) art.color = 0x000000;
      look.hologram = true;
      this.paint(look);
    }
    update(fr, look) {
      if (!Number.isNaN(this.movedAt)) {
        const t = clamp((fr.now - this.movedAt) * 1000 / this.c.sunMoveMs, 0, 1);
        this.shown = this.from + (this.hour - this.from) * t * t * (3 - 2 * t);
        if (t >= 1) this.movedAt = NaN;
      }
      this.paint(look);
      return Outcome.Ignored;
    }
    tap() { return Outcome.Ignored; }
    swipe(fr, face, direction, look) {
      if (face !== this.c.clockFace || Math.abs(direction[1]) <= Math.abs(direction[0])) return Outcome.Ignored;
      this.hour = clamp(this.hour + Math.sign(direction[1]), this.c.hourMin, this.c.hourMax);
      this.from = this.shown; this.movedAt = fr.now;
      this.paint(look);
      return Outcome.Handled;
    }
    paint(look) {
      look.clock = { face: this.c.clockFace, text: this.hour + ':00' };
      look.sun = { hourShown: this.shown };
      look.glass = Sky.glassAt(this.shown, this.c.eastIsLeft);
      look.status = '時計を上下にスワイプして時刻を変える';
    }
  }

  const registry = { start: c => new StartStep(c), puzzle: c => new PuzzleStep(c), suits: c => new SuitsStep(c), clock: c => new ClockStep(c) };
  const Steps = {
    ids: Object.keys(registry),
    create(id, c) {
      if (!Object.prototype.hasOwnProperty.call(registry, id)) throw new Error('Unknown step: ' + id);
      return registry[id](c);
    }
  };

  class Sequence {
    constructor(c) {
      if (!c.order || !c.order.length) throw new Error('config.order is empty');
      this.steps = c.order.map(id => Steps.create(id, c));
      this.look = new BoxLook();
      this.reset();
    }
    get current() { return this.steps[this.index]; }
    get count() { return this.steps.length; }
    reset(start = 0) {
      this.index = clamp(start, 0, this.steps.length - 1);
      this.look.clear();
      this.current.enter(this.look);
    }
    update(fr) { return this.advance(this.current.update(fr, this.look)); }
    tap(fr, hit) { return this.advance(this.current.tap(fr, hit, this.look)); }
    swipe(fr, face, direction) { return this.advance(this.current.swipe(fr, face, direction, this.look)); }
    // Past the last step the sequence stays where it is.
    advance(outcome) {
      if (outcome === Outcome.Done && this.index < this.steps.length - 1) this.reset(this.index + 1);
      return outcome;
    }
  }

  // --- the phone: what the Unity prototype got from its scene, built from a box.js pose -------------
  const Phone = {
    // Gravity's up in the back camera's axes (Unity style: x right, y up, z forward), from the
    // deviceorientation angles and the screen's own rotation. R = Rz(alpha) Rx(beta) Ry(gamma) maps
    // the device to the earth, so earth up in device axes is R^T (0,0,1); alpha drops out.
    upFromTilt(beta, gamma, screenDeg = 0) {
      const b = beta * Math.PI / 180, g = gamma * Math.PI / 180, s = screenDeg * Math.PI / 180;
      const x = -Math.sin(g) * Math.cos(b), y = Math.sin(b), z = Math.cos(g) * Math.cos(b);
      return normalize([x * Math.cos(s) - y * Math.sin(s), x * Math.sin(s) + y * Math.cos(s), -z]);
    },
    // rotation and translation as box.js keeps them: box axes into camera axes with y pointing down.
    // The world is the camera turned so that gravity's up is +Y; without a sensor the camera's own up
    // stands in, which makes a tilted phone look like a tilted box.
    frameFromPose(rotation, translation, gravityUp, now) {
      const m = [rotation[0], rotation[1].map(x => -x), rotation[2]];
      const t = [translation[0], -translation[1], translation[2]];
      const camera = gravityUp ? Quaternion.fromTo(gravityUp, UnitY) : Quaternion.Identity;
      const box = Quaternion.concatenate(Quaternion.fromMatrix(m), camera);
      return Frame(box, Quaternion.transform(t, camera), camera, [0, 0, 0], now);
    }
  };

  const api = { Face, FACE_NAMES, MARKER, Outcome, SwitchState, White, Quaternion, Frame, Hit, Geometry, Glass, Sky,
    FaceArt, BoxLook, ORDER, TABLES, NUMBERS, createConfig, Steps, Sequence, Phone, vec: { add, sub, scale, dot, cross, length, normalize } };
  if (typeof module !== 'undefined') module.exports = api;
  root.MockARSequence = api;
})(globalThis);
