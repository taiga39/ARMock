'use strict';
const $ = id => document.getElementById(id);
const tracker = new MockAR.Tracker();
const detector = new AR.Detector();
const video = $('video'), canvas = $('preview');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
let stream = null, raf = 0, lastTick = 0, starting = false;
// Focal lengths measured while 2+ faces are visible; single-face poses use their median and the
// previous rotation (kept for 1s) to choose between "tilted toward" and "tilted away".
const focalSamples = [];
let lastRotation = null, lastRotationTime = -Infinity;
const calibratedFocal = () => focalSamples.length ? focalSamples.slice().sort((a, b) => a - b)[focalSamples.length >> 1] : null;
let lastPose = null, touched = null, lastSeenE = -Infinity, insidePolygons = null;
let insidePressedUntil = 0, openTarget = 0, openProgress = 0, openTime = 0;
// Gestures on the box: tap adds one to that face, long press recolours it, a swipe along the
// arrow opens FACE_E. gesture holds the finger that is down; dragging pauses the open/close easing.
const counts = [0, 0, 0, 0, 0, 0], faceColorOverride = {};
const PALETTE = [...MockARBox.faceColors, '#e8b23a', '#e9eef7', '#2b3648'];
const LONG_PRESS_MS = 500, MOVE_PX = 8, SWIPE_SPAN = .45, SWIPE_OPEN = .4;
let gesture = null, dragging = false;
// switch -> inside (lid open, second switch) -> numbers (1,2,3 must come up in order) -> solved
let stage = 'switch', step = 0, upFace = -1, upCandidate = -1, upSince = 0;
const FACE_E = 4, FACE_FLOOR = 3, FACE_E_ID = MockAR.IDS[FACE_E], HOLD_MS = 300, OPEN_MS = 600, OPEN_ANGLE = Math.PI * .55;
// Dice positions 1, 4 and 6: two opposite faces (B and D) plus one next to both (C).
const NUMBER_FACES = [1, 2, 3], NUMBER_LABELS = { 1: '1', 2: '2', 3: '3' }, UP_SCORE = .75, UP_HOLD_MS = 400;
// The second switch stands on the floor inside the box (the inner side of FACE_D), seen through the opening.
const insideMesh = MockARBox.placeOnFace(MockARSwitch, FACE_FLOOR, .55, [1], 0, true);
const insidePressedMesh = MockARBox.placeOnFace(MockARSwitch, FACE_FLOOR, .55, [1], .1, true);
function resetPuzzle() {
  stage = 'switch'; step = 0; upFace = -1; upCandidate = -1;
  openTarget = 0; openProgress = 0; insidePolygons = null;
  counts.fill(0); for (const k of Object.keys(faceColorOverride)) delete faceColorOverride[k];
}
// A face counts as up only after UP_HOLD_MS, so faces passed while turning are not taken as answers.
function trackUpFace(rotation, now) {
  const { face, score } = MockARBox.upFace(rotation);
  if (score < UP_SCORE) { upCandidate = -1; return; }
  if (face !== upCandidate) { upCandidate = face; upSince = now; return; }
  if (now - upSince < UP_HOLD_MS || face === upFace) return;
  upFace = face;
  if (stage !== 'numbers') return;
  if (face === NUMBER_FACES[step]) { step++; if (step === NUMBER_FACES.length) stage = 'solved'; }
  else if (NUMBER_FACES.includes(face)) step = face === NUMBER_FACES[0] ? 1 : 0;
}
const objectColors = MockARBox.faceColors;
const colorNames = ['赤', '黄', '青', '緑', '紫', 'オレンジ'];
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
    `${face} → ${$('show-object').checked ? ($('object-mode').value === 'ball' ? colorNames[index]+'の球' : $('object-mode').selectedOptions[0].textContent) : '表示OFF'}`;
  if (elapsed) $('fps').textContent = (1000 / elapsed).toFixed(1) + ' fps';
}
function area(m) {
  return Math.abs(m.corners.reduce((sum, p, i, arr) => { const q = arr[(i + 1) % 4]; return sum + p.x * q.y - q.x * p.y; }, 0));
}
function tick(now) {
  raf = requestAnimationFrame(tick);
  if (now - lastTick < 65 || video.readyState < 2) return;
  const elapsed = now - lastTick; lastTick = now;
  canvas.width = Math.min(640, video.videoWidth);
  canvas.height = Math.round(canvas.width * video.videoHeight / video.videoWidth);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const markers = detector.detect(ctx.getImageData(0, 0, canvas.width, canvas.height))
    .filter(m => MockAR.IDS.includes(m.id)).sort((a, b) => area(b) - area(a));
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
  $('pose-state').textContent = '位置推定: 未認識';
  lastPose = null; insidePolygons = null;
  if (marker && $('show-object').checked) {
    if ($('object-mode').value === 'ball') { drawObject(marker, angle); $('pose-state').textContent = '2D球の表示'; }
    else {
      const pose = MockARBox.estimate(markers, canvas.width, canvas.height, {
        fov: Number($('camera-fov').value), focal: calibratedFocal(), smoothing: .8,
        rotation: now - lastRotationTime <= 1000 ? lastRotation : null });
      if (pose) {
        if (pose.mode === 'multi') { focalSamples.push(pose.focal); if (focalSamples.length > 30) focalSamples.shift(); }
        lastRotation = pose.rotation; lastRotationTime = now;
      }
      if (pose) {
        // FACE_E seen within the last 300ms shows the switch, so one missed frame does not flicker.
        if (markers.some(m => m.id === FACE_E_ID)) lastSeenE = now;
        if (!$('puzzle-on').checked) resetPuzzle();
        const lidShown = $('puzzle-on').checked && (stage === 'switch' || stage === 'inside') && now - lastSeenE <= HOLD_MS;
        if (!lidShown && (stage === 'switch' || stage === 'inside')) { openTarget = 0; stage = 'switch'; }
        if (!dragging) openProgress = Math.min(1, Math.max(0, openProgress + (openTarget ? 1 : -1) * (now - (openTime || now)) / OPEN_MS));
        openTime = now;
        trackUpFace(pose.rotation, now);
        const style = $('object-mode').value, opacity = Number($('box-opacity').value);
        const numbers = stage === 'numbers' || stage === 'solved';
        const labels = {};
        for (let k = 0; k < 6; k++) labels[k] = counts[k] ? String(counts[k]) : 'ABCDEF'[k];
        if (numbers) Object.assign(labels, NUMBER_LABELS);
        const options = { labels, gold: stage === 'solved', colors: faceColorOverride };
        if (openProgress > .001) {
          options.inside = stage === 'inside' ? (now < insidePressedUntil ? insidePressedMesh : insideMesh) : null;
          insidePolygons = MockARBox.drawOpen(ctx, pose, style, opacity, FACE_E, openProgress * OPEN_ANGLE, options);
        } else { MockARBox.draw(ctx, pose, style, opacity, options); insidePolygons = null; }
        // The arrow shows which way to swipe; it fades out as the lid follows the finger.
        if (lidShown && openProgress < .99)
          MockARBox.drawArrow(ctx, pose, FACE_E, 0, -1, { opacity: (1 - openProgress) * .9,
            transform: MockARBox.openTransform(FACE_E, openProgress * OPEN_ANGLE) });
        lastPose = pose;
        if (touched && now < touched.until) MockARBox.highlight(ctx, pose, touched.face);
        $('pose-state').textContent = pose.mode === 'multi' ? `位置推定: ${pose.count}面で箱全体を追跡（ずれ ${pose.error.toFixed(1)}px）` :
          `位置推定: 1面から推定（${calibratedFocal() ? '画角は自動測定済み' : '画角は手動値'}${pose.mode === 'single-tracked' ? '・直前の向きを使用' : ''}）`;
        if (lidShown) $('pose-state').textContent += openProgress > .001 ? ' / Eの面が開いています' : ' / Eは矢印の向きにスワイプ';
        $('up-face').textContent = upFace < 0 ? '—' : 'FACE_' + 'ABCDEF'[upFace] +
          (NUMBER_FACES.includes(upFace) ? `（数字 ${NUMBER_LABELS[upFace]}）` : '');
        $('puzzle-state').textContent = { switch: 'Eの面を矢印の向きにスワイプ', inside: '中のスイッチを押す',
          numbers: `1→2→3 を順に上へ（${step} / 3）`, solved: 'クリア！全面が金色' }[stage];
        $('puzzle-state').className = stage === 'solved' ? 'success' : '';
      } else $('pose-state').textContent = '位置推定: 箱の全体をもう少し大きく映してください';
    }
  }
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
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
    video.srcObject = stream; await video.play();
    $('stop').disabled = false; $('message').textContent = 'マーカー全体と白い余白を映してください。スマホの向きは固定してください。';
    lastTick = 0; raf = requestAnimationFrame(tick);
  } catch (error) { stop(); $('message').textContent = 'カメラを開始できません: ' + error.name + ' / ' + error.message; }
  finally { starting = false; }
};
$('stop').onclick = stop;
const canvasPoint = event => {
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * canvas.width / rect.width,
    y: (event.clientY - rect.top) * canvas.height / rect.height };
};
function say(text, color) { $('touched').textContent = text; $('touched').style.color = color; }
// The browser's own gestures would take the finger away: scrolling on a swipe, and the selection
// callout on a long press. The canvas handles all of them itself.
canvas.addEventListener('contextmenu', event => event.preventDefault());
canvas.addEventListener('pointerdown', event => {
  event.preventDefault();
  if (!lastPose) return;
  const { x, y } = canvasPoint(event);
  // The switch inside the box is offered the tap before the faces around it.
  if (MockARBox.hitPolygons(insidePolygons, x, y)) {
    insidePressedUntil = performance.now() + 250;
    stage = 'numbers'; step = 0; upFace = -1; upCandidate = -1; openTarget = 0;
    if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
    say('中のスイッチON（1・2・3 が出ました）', '#ffdb54');
    return;
  }
  const face = MockARBox.hitFace(lastPose, x, y);
  if (face < 0) return;
  canvas.setPointerCapture(event.pointerId);
  gesture = { face, x, y, moved: false, handled: false,
    axes: MockARBox.faceScreenAxes(lastPose, face), timer: 0 };
  gesture.timer = setTimeout(() => {
    if (!gesture || gesture.moved) return;
    const next = (PALETTE.indexOf(faceColorOverride[face]) + 1) % PALETTE.length;
    faceColorOverride[face] = PALETTE[next];
    gesture.handled = true;
    if (navigator.vibrate) navigator.vibrate([20, 40, 20]);
    say('長押し: FACE_' + 'ABCDEF'[face] + ' の色を変更', PALETTE[next]);
  }, LONG_PRESS_MS);
});
canvas.addEventListener('pointermove', event => {
  if (!gesture) return;
  event.preventDefault();
  const { x, y } = canvasPoint(event), dx = x - gesture.x, dy = y - gesture.y;
  if (!gesture.moved && Math.hypot(dx, dy) < MOVE_PX) return;
  gesture.moved = true; clearTimeout(gesture.timer);
  // Movement along the face's own downward axis opens FACE_E, so the lid follows the finger.
  if (gesture.handled || gesture.face !== FACE_E || !gesture.axes) return;
  if (stage !== 'switch' && stage !== 'inside') return;
  const along = -(dx * gesture.axes.up.x + dy * gesture.axes.up.y) / (gesture.axes.size * SWIPE_SPAN);
  dragging = true;
  openProgress = Math.min(1, Math.max(0, along));
});
function endGesture(event) {
  if (!gesture) return;
  clearTimeout(gesture.timer);
  const face = gesture.face, wasDragging = dragging;
  if (!gesture.handled && !gesture.moved) {
    counts[face]++;
    touched = { face, until: performance.now() + 600 };
    if (navigator.vibrate) navigator.vibrate(30);
    say('FACE_' + 'ABCDEF'[face] + '（' + colorNames[face] + '）= ' + counts[face], objectColors[face]);
  } else if (wasDragging) {
    openTarget = openProgress > SWIPE_OPEN ? 1 : 0;
    stage = openTarget ? 'inside' : 'switch';
    if (navigator.vibrate) navigator.vibrate(40);
    say(openTarget ? 'スワイプ: Eの面が開きます' : 'スワイプ: Eの面が閉じます', '#ff5268');
  }
  dragging = false; gesture = null;
  if (event && canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
}
canvas.addEventListener('pointerup', endGesture);
canvas.addEventListener('pointercancel', endGesture);
$('camera-fov').oninput = () => { $('fov-value').textContent = $('camera-fov').value + '°'; };
$('reset').onclick = () => { tracker.reset(); resetPuzzle(); render(null, 0); };
$('export').onclick = () => {
  const data = { date: new Date().toISOString(), userAgent: navigator.userAgent, notes: $('notes').value, success: tracker.success, history: tracker.history };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'mockar-test-' + Date.now() + '.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
document.addEventListener('visibilitychange', () => { if (document.hidden && stream) stop(); });
window.addEventListener('pagehide', stop);
