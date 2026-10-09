// Preview: the same drawing as the live page, but with the camera put where you ask instead of a
// real one. No camera, no printed markers - for checking how a state looks on a PC.
// URL parameters set the view and, in the sequence mode, the state, so a screenshot needs no clicks:
// yaw, pitch, roll, distance, focal, boxroll (degrees about the line of sight), sensor=0 (no gravity),
// and step, open, lit, hour as in MockARSequenceScene.stage.
'use strict';
const $ = id => document.getElementById(id);
const canvas = $('stage'), ctx = canvas.getContext('2d');
const scenes = MockARScenes;
const query = new URLSearchParams(location.search);
const camera = { yaw: 20, pitch: 15, roll: 0, boxroll: 0, distance: 6, focal: .8 };
for (const key of Object.keys(camera)) if (query.has(key) && Number.isFinite(Number(query.get(key)))) camera[key] = Number(query.get(key));
let spin = false, last = 0, frame = null, press = null;

for (const key of Object.keys(camera)) {
  const slider = $(key);
  if (!slider) continue;
  const readout = $(key + '-value');
  const show = () => { readout.textContent = slider.value + (slider.dataset.unit || ''); };
  slider.value = camera[key]; show();
  slider.oninput = () => { camera[key] = Number(slider.value); show(); };
}
$('sensor').checked = query.get('sensor') !== '0';
$('spin').onchange = event => { spin = event.target.checked; };
$('face-a').onclick = () => setYaw(0);
$('face-e').onclick = () => setYaw(90);
$('face-f').onclick = () => setYaw(180);
function setYaw(degrees) { camera.yaw = degrees; $('yaw').value = degrees; $('yaw-value').textContent = degrees + '°'; }
document.body.dataset.mode = scenes.mode;
$('mode').value = scenes.mode;
$('mode').onchange = () => {
  if ($('mode').value === 'sequence') query.set('mode', 'sequence'); else query.delete('mode');
  location.search = query.toString();
};
if (scenes.mode === 'sequence') {
  const number = key => query.has(key) ? Number(query.get(key)) : undefined;
  const step = query.get('step');
  MockARSequenceScene.stage({ step: step === null ? 0 : Number.isFinite(Number(step)) ? Number(step) : step,
    open: query.get('open') === '1', lit: number('lit') || 0, hour: number('hour') || 0 });
}

// The box turned about the line from it to the camera, which is what turning it in your hand looks like.
function boxRoll(degrees) {
  if (!degrees) return null;
  const yaw = camera.yaw * Math.PI / 180, pitch = camera.pitch * Math.PI / 180, t = degrees * Math.PI / 180;
  const a = [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)], c = Math.cos(t), s = Math.sin(t);
  return [0, 1, 2].map(i => [0, 1, 2].map(j => (i === j ? c : 0) + (1 - c) * a[i] * a[j]
    + s * [[0, -a[2], a[1]], [a[2], 0, -a[0]], [-a[1], a[0], 0]][i][j]));
}

function draw(now) {
  requestAnimationFrame(draw);
  const seconds = Math.min(.1, (last ? now - last : 0) / 1000); last = now;
  if (spin) { camera.yaw = (camera.yaw + seconds * 30) % 360; $('yaw').value = camera.yaw; $('yaw-value').textContent = camera.yaw.toFixed(0) + '°'; }
  ctx.fillStyle = '#101722'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const view = { yaw: camera.yaw * Math.PI / 180, pitch: camera.pitch * Math.PI / 180, roll: camera.roll * Math.PI / 180,
    distance: camera.distance, focal: camera.focal, width: canvas.width, height: canvas.height };
  const pose = MockARBox.poseFromCamera({ ...view, box: boxRoll(camera.boxroll) });
  // The preview's phone has a perfect sensor: gravity's up is the world's +Y, seen by the camera.
  const upright = $('sensor').checked && MockARBox.poseFromCamera(view);
  // The preview pretends every marker is in view, so the modules behave as they would at the table.
  frame = { now, seconds, ctx, canvas, pose, markers: [], ids: MockAR.IDS.slice(), qr: null,
    say: (text, color) => { $('said').textContent = text; $('said').style.color = color || '#e8edf6'; },
    vibrate: () => {}, style: $('style').value, opacity: Number($('opacity').value), heading: null,
    gravity: upright ? [upright.rotation[0][1], -upright.rotation[1][1], upright.rotation[2][1]] : null };
  if (!pose) { $('state').textContent = 'カメラが近すぎます'; return; }
  scenes.render(frame);
  const front = MockARBox.frontFace(pose.rotation), up = MockARBox.upFace(pose.rotation);
  $('state').textContent = `正面 FACE_${'ABCDEF'[front.face]} / 上 FACE_${'ABCDEF'[up.face]} / ${scenes.status(frame)}`;
}
// Clicks on the preview go through the same path as a tap on the phone; a drag is a swipe.
const pointOf = event => {
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height };
};
canvas.addEventListener('pointerdown', event => {
  if (!frame || !frame.pose) return;
  const { x, y } = pointOf(event);
  if (scenes.claim('hit', frame, x, y)) return;
  const face = MockARBox.hitFace(frame.pose, x, y);
  if (face < 0) return;
  if (event.shiftKey) { scenes.claim('longPress', frame, face, { x, y }); return; } // shift-click stands in for a long press
  press = { face, x, y };
});
canvas.addEventListener('pointerup', event => {
  if (!press || !frame) return;
  const { face, x, y } = press, end = pointOf(event), dx = end.x - x, dy = end.y - y;
  press = null;
  if (Math.hypot(dx, dy) < MockARConfig.values.movePx) { scenes.claim('tap', frame, face, { x, y }); return; }
  const info = { face, x, y, dx, dy, axes: MockARBox.faceScreenAxes(frame.pose, face) };
  if (scenes.claim('drag', frame, info)) scenes.claim('release', frame, info);
});
MockARTune.build($('tune'), { frame: () => frame });
requestAnimationFrame(draw);
