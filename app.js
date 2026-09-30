// Camera, recognition, pose and gestures. Everything a gimmick does lives in scenes.js; this file
// only feeds them a frame and passes on what the finger did.
'use strict';
const $ = id => document.getElementById(id);
const tracker = new MockAR.Tracker();
const detector = new AR.Detector();
const scenes = MockARScenes;
const values = MockARConfig.values;
const video = $('video'), canvas = $('preview');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
let stream = null, raf = 0, lastTick = 0, starting = false;
// Focal lengths measured while 2+ faces are visible; single-face poses use their median and the
// previous rotation (kept for 1s) to choose between "tilted toward" and "tilted away".
const focalSamples = [];
let lastRotation = null, lastRotationTime = -Infinity;
const calibratedFocal = () => focalSamples.length ? focalSamples.slice().sort((a, b) => a - b)[focalSamples.length >> 1] : null;
let lastPose = null, lastFrame = null, gesture = null;
const QR_CODES = { 'https://taiga39.github.io/ARMock/': 'ARMockカード' };
let qrText = null, qrUntil = 0, qrCorners = null, qrTick = 0;
const objectColors = MockARBox.faceColors;
const colorNames = ['赤', '黄', '青', '緑', '紫', 'オレンジ'];

// The half turn is meant to be the player walking round, not the box being turned, so it is read
// from the phone's own heading where there is one.
const headingOf = event => typeof event.webkitCompassHeading === 'number' ? event.webkitCompassHeading
  : (event.absolute || event.type === 'deviceorientationabsolute') && typeof event.alpha === 'number' ? 360 - event.alpha : null;
for (const type of ['deviceorientationabsolute', 'deviceorientation'])
  window.addEventListener(type, event => { const value = headingOf(event); if (value !== null) scenes.heading = value; });
async function askForHeading() {
  // iOS only hands out the heading after an explicit request from a tap.
  const ask = window.DeviceOrientationEvent && DeviceOrientationEvent.requestPermission;
  if (typeof ask !== 'function') return;
  try { await DeviceOrientationEvent.requestPermission(); } catch (error) { /* keep the fallback */ }
}

function say(text, color) { $('touched').textContent = text; $('touched').style.color = color; }
const vibrate = pattern => { if (navigator.vibrate) navigator.vibrate(pattern); };
function area(m) {
  return Math.abs(m.corners.reduce((sum, p, i, arr) => { const q = arr[(i + 1) % 4]; return sum + p.x * q.y - q.x * p.y; }, 0));
}
function drawObject(marker, angle) {
  const index = MockAR.IDS.indexOf(marker.id);
  const corners = marker.corners;
  const center = corners.reduce((p, q) => ({ x: p.x + q.x / 4, y: p.y + q.y / 4 }), { x: 0, y: 0 });
  const edge = corners.reduce((sum, p, i) => {
    const q = corners[(i + 1) % 4]; return sum + Math.hypot(q.x - p.x, q.y - p.y) / 4;
  }, 0);
  const radius = edge * .28;
  ctx.save();
  ctx.translate(center.x, center.y);
  // A shaded 2D ball anchored to the detected center. Marker pixels are
  // sampled before drawing this overlay, so it cannot hide the detector's input.
  ctx.shadowColor = '#0008'; ctx.shadowBlur = radius * .3; ctx.shadowOffsetY = radius * .12;
  const gradient = ctx.createRadialGradient(-radius * .35, -radius * .4, radius * .05, 0, 0, radius);
  gradient.addColorStop(0, '#fff'); gradient.addColorStop(.3, objectColors[index]); gradient.addColorStop(1, '#172034');
  ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.shadowOffsetY = 0;
  ctx.strokeStyle = objectColors[index]; ctx.lineWidth = Math.max(2, radius * .04); ctx.stroke();
  ctx.rotate(angle * Math.PI / 180);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(2, radius * .055); ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, -radius * .15); ctx.lineTo(0, -radius * .75); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, -radius * .75, radius * .10, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
function render(marker, angle, elapsed) {
  const face = marker ? 'FACE_' + String.fromCharCode(65 + MockAR.IDS.indexOf(marker.id)) : null;
  $('state').textContent = face ? '認識中' : '未認識';
  $('face').textContent = face || '—';
  $('confirmed').textContent = tracker.lastFace || '—';
  $('angle').textContent = face ? angle.toFixed(1) + '°' : '—';
  $('stable').textContent = Math.round(tracker.stableMs) + ' ms';
  $('turn').textContent = face === 'FACE_F' && tracker.baseAngle !== null ? MockAR.angleDiff(angle, tracker.baseAngle).toFixed(1) + '°' : '—';
  $('result').textContent = tracker.success ? 'SUCCESS' : `未完成 ${tracker.step} / 4`;
  $('result').className = tracker.success ? 'success' : '';
  $('history').textContent = '入力履歴: ' + (tracker.history.map(x => x.face).join(' → ') || '—');
  const index = marker ? MockAR.IDS.indexOf(marker.id) : -1;
  const color = index >= 0 ? objectColors[index] : '#6586aa';
  canvas.style.outline = '3px solid ' + color;
  $('object-state').style.color = color;
  $('object-state').textContent = index < 0 ? '箱のマーカーを映してください。' :
    `${face} → ${$('show-object').checked ? ($('object-mode').value === 'ball' ? colorNames[index] + 'の球' : $('object-mode').selectedOptions[0].textContent) : '表示OFF'}`;
  if (elapsed) $('fps').textContent = (1000 / elapsed).toFixed(1) + ' fps';
  const known = qrText ? QR_CODES[qrText] : null;
  $('qr-state').textContent = !qrText ? '—' : known ? `${known}（登録済み）` : `未登録: ${qrText.slice(0, 40)}`;
  $('qr-state').style.color = known ? '#ff2d2d' : '#e8edf6';
  $('up-face').textContent = lastPose ? 'FACE_' + 'ABCDEF'[MockARBox.upFace(lastPose.rotation).face] : '—';
}
function readQr(frame, now) {
  if (++qrTick % Math.round(values.qrEvery) === 0) {
    const found = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'dontInvert' });
    if (found) { qrText = found.data; qrCorners = found.location; qrUntil = now + values.qrHoldMs; }
    else if (now > qrUntil) { qrText = null; qrCorners = null; }
  } else if (qrText && now > qrUntil) { qrText = null; qrCorners = null; }
  return { text: qrText, corners: qrCorners, name: qrText && now <= qrUntil ? QR_CODES[qrText] : null };
}
function tick(now) {
  raf = requestAnimationFrame(tick);
  if (now - lastTick < values.frameMs || video.readyState < 2) return;
  const elapsed = now - lastTick, seconds = Math.min(.25, (lastTick ? elapsed : 0) / 1000);
  lastTick = now;
  canvas.width = Math.min(640, video.videoWidth);
  canvas.height = Math.round(canvas.width * video.videoHeight / video.videoWidth);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const markers = detector.detect(image)
    .filter(m => MockAR.IDS.includes(m.id)).sort((a, b) => area(b) - area(a));
  const qr = readQr(image, now);
  const marker = markers[0];
  let angle = 0;
  if (marker) {
    const [a, b] = marker.corners;
    angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI + 360) % 360;
    ctx.strokeStyle = '#51ff9a'; ctx.lineWidth = 3; ctx.beginPath();
    marker.corners.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.closePath(); ctx.stroke();
    ctx.fillStyle = '#ffbd4a'; ctx.beginPath(); ctx.arc(a.x, a.y, 6, 0, Math.PI * 2); ctx.fill();
  }
  tracker.update(marker ? 'FACE_' + String.fromCharCode(65 + MockAR.IDS.indexOf(marker.id)) : null, angle, now);

  let pose = null;
  if (marker && $('show-object').checked && $('object-mode').value !== 'ball') {
    pose = MockARBox.estimate(markers, canvas.width, canvas.height, {
      fov: Number($('camera-fov').value), focal: calibratedFocal(), smoothing: values.poseSmoothing,
      rotation: now - lastRotationTime <= 1000 ? lastRotation : null });
    if (pose) {
      if (pose.mode === 'multi') { focalSamples.push(pose.focal); if (focalSamples.length > 30) focalSamples.shift(); }
      lastRotation = pose.rotation; lastRotationTime = now;
    }
  }
  lastPose = pose;
  const frame = lastFrame = {
    now, seconds, ctx, canvas, pose, markers, qr, say, vibrate,
    ids: markers.map(m => m.id), style: $('object-mode').value, opacity: Number($('box-opacity').value),
    get heading() { return scenes.heading; }
  };
  scenes.render(frame);
  if (marker && $('show-object').checked && $('object-mode').value === 'ball') drawObject(marker, angle);
  $('pose-state').textContent = !$('show-object').checked ? '重ねて表示: OFF'
    : $('object-mode').value === 'ball' ? '2D球の表示'
    : !marker ? '位置推定: 未認識'
    : !pose ? '位置推定: 箱の全体をもう少し大きく映してください'
    : pose.mode === 'multi' ? `位置推定: ${pose.count}面で箱全体を追跡（ずれ ${pose.error.toFixed(1)}px）`
    : `位置推定: 1面から推定（${calibratedFocal() ? '画角は自動測定済み' : '画角は手動値'}${pose.mode === 'single-tracked' ? '・直前の向きを使用' : ''}）`;
  $('puzzle-state').textContent = scenes.status(frame);
  render(marker, angle, elapsed);
}
function stop() {
  cancelAnimationFrame(raf);
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null; video.srcObject = null; tracker.update(null, 0, performance.now());
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  $('pose-state').textContent = '位置推定: 停止中';
  $('start').disabled = false; $('stop').disabled = true; render(null, 0);
  $('message').textContent = 'カメラ停止中。履歴は保持しています。';
}
$('start').onclick = async () => {
  if (starting || stream) return;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    $('message').textContent = 'カメラには安全な接続が必要です。Android Chromeで chrome://flags/#unsafely-treat-insecure-origin-as-secure を開き、' + location.origin + ' を登録して Enabled に変更し、Chromeを再起動してください。';
    return;
  }
  starting = true; $('start').disabled = true;
  await askForHeading();
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
    video.srcObject = stream; await video.play();
    $('stop').disabled = false; $('message').textContent = 'マーカー全体と白い余白を映してください。';
    lastTick = 0; raf = requestAnimationFrame(tick);
  } catch (error) { stop(); $('message').textContent = 'カメラを開始できません: ' + error.name + ' / ' + error.message; }
  finally { starting = false; }
};
$('stop').onclick = stop;

// --- gestures: find what was pressed, then offer it to the modules in turn ----------------------
const canvasPoint = event => {
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * canvas.width / rect.width,
    y: (event.clientY - rect.top) * canvas.height / rect.height };
};
// The browser's own gestures would take the finger away: scrolling on a swipe, and the selection
// callout on a long press. The canvas handles all of them itself.
canvas.addEventListener('contextmenu', event => event.preventDefault());
canvas.addEventListener('pointerdown', event => {
  event.preventDefault();
  if (!lastPose || !lastFrame) return;
  const { x, y } = canvasPoint(event);
  if (scenes.claim('hit', lastFrame, x, y)) return;
  const face = MockARBox.hitFace(lastPose, x, y);
  if (face < 0) return;
  canvas.setPointerCapture(event.pointerId);
  gesture = { face, x, y, moved: false, handled: false, dragging: false,
    axes: MockARBox.faceScreenAxes(lastPose, face), timer: 0 };
  gesture.timer = setTimeout(() => {
    if (!gesture || gesture.moved) return;
    gesture.handled = !!scenes.claim('longPress', lastFrame, face);
  }, values.longPressMs);
});
canvas.addEventListener('pointermove', event => {
  if (!gesture) return;
  event.preventDefault();
  const { x, y } = canvasPoint(event), dx = x - gesture.x, dy = y - gesture.y;
  if (!gesture.moved && Math.hypot(dx, dy) < values.movePx) return;
  gesture.moved = true; clearTimeout(gesture.timer);
  if (gesture.handled) return;
  if (scenes.claim('drag', lastFrame, { face: gesture.face, dx, dy, axes: gesture.axes })) gesture.dragging = true;
});
function endGesture(event) {
  if (!gesture) return;
  clearTimeout(gesture.timer);
  const { face, handled, moved, dragging } = gesture;
  gesture = null;
  if (event && canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  if (!lastFrame) return;
  if (dragging) scenes.claim('release', lastFrame, { face });
  else if (!handled && !moved) scenes.claim('tap', lastFrame, face);
}
canvas.addEventListener('pointerup', endGesture);
canvas.addEventListener('pointercancel', endGesture);
$('camera-fov').oninput = () => { $('fov-value').textContent = $('camera-fov').value + '°'; };
$('reset').onclick = () => { tracker.reset(); scenes.reset(); render(null, 0); };
$('export').onclick = () => {
  const data = { date: new Date().toISOString(), userAgent: navigator.userAgent, notes: $('notes').value,
    success: tracker.success, history: tracker.history, config: MockARConfig.changed() };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'mockar-test-' + Date.now() + '.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
document.addEventListener('visibilitychange', () => { if (document.hidden && stream) stop(); });
window.addEventListener('pagehide', stop);
if (window.MockARTune) MockARTune.attach({ frame: () => lastFrame });
