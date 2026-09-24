(function (root) {
  'use strict';
  const IDS = [37, 158, 327, 582, 741, 916];
  const angleDiff = (a, b) => ((a - b + 540) % 360) - 180;
  class Tracker {
    constructor() { this.reset(); }
    reset() {
      this.history = []; this.lastFace = null; this.candidate = null;
      this.since = 0; this.lastTime = null; this.stableMs = 0;
      this.step = 0; this.baseAngle = null; this.turnSince = null; this.success = false;
    }
    update(face, angle, now) {
      if (this.lastTime !== null && now - this.lastTime > 250) {
        this.candidate = null; this.turnSince = null;
      }
      this.lastTime = now;
      if (!face) { this.candidate = null; this.stableMs = 0; this.turnSince = null; return; }
      if (face !== this.candidate) { this.candidate = face; this.since = now; this.turnSince = null; }
      this.stableMs = now - this.since;
      if (this.stableMs < 400 && face !== this.lastFace) return;
      if (face !== this.lastFace) {
        this.lastFace = face;
        this.history.push({ face, angle: Math.round(angle), time: Math.round(now) });
        if (this.history.length > 200) this.history.shift();
        if (!this.success) {
          if (face === 'FACE_A') { this.step = 1; this.baseAngle = null; }
          else if (this.step === 1 && face === 'FACE_C') this.step = 2;
          else if (this.step === 2 && face === 'FACE_F') { this.step = 3; this.baseAngle = angle; }
          else { this.step = 0; this.baseAngle = null; }
        }
      }
      if (!this.success && this.step === 3 && face === 'FACE_F' &&
          Math.abs(angleDiff(angle, this.baseAngle + 90)) <= 15) {
        if (this.turnSince === null) this.turnSince = now;
        if (now - this.turnSince >= 400) { this.success = true; this.step = 4; }
      } else this.turnSince = null;
    }
  }
  const api = { IDS, Tracker, angleDiff };
  if (typeof module !== 'undefined') module.exports = api;
  else root.MockAR = api;
})(globalThis);
