// Preview: the same drawing as the live page, but with the camera put where you ask instead of a
// real one. No camera, no printed markers - for checking how a state looks on a PC.
'use strict';
const $ = id => document.getElementById(id);
const canvas = $('stage'), ctx = canvas.getContext('2d');
const scenes = MockARScenes;
const camera = { yaw: 20, pitch: 15, roll: 0, distance: 6, focal: .8 };
let spin = false, last = 0, frame = null;

for (const key of Object.keys(camera)) {
  const slider = $(key);
  if (!slider) continue;
  const readout = $(key + '-value');
  const show = () => { readout.textContent = slider.value + (slider.dataset.unit || ''); };
  slider.value = camera[key]; show();
  slider.oninput = () => { camera[key] = Number(slider.value); show(); };
}
$('spin').onchange = event => { spin = event.target.checked; };
$('face-a').onclick = () => setYaw(0);
$('face-e').onclick = () => setYaw(90);
$('face-f').onclick = () => setYaw(180);
function setYaw(degrees) { camera.yaw = degrees; $('yaw').value = degrees; $('yaw-value').textContent = degrees + '°'; }

function draw(now) {
  requestAnimationFrame(draw);
  const seconds = Math.min(.1, (last ? now - last : 0) / 1000); last = now;
  if (spin) { camera.yaw = (camera.yaw + seconds * 30) % 360; $('yaw').value = camera.yaw; $('yaw-value').textContent = camera.yaw.toFixed(0) + '°'; }
  ctx.fillStyle = '#101722'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const pose = MockARBox.poseFromCamera({
    yaw: camera.yaw * Math.PI / 180, pitch: camera.pitch * Math.PI / 180, roll: camera.roll * Math.PI / 180,
    distance: camera.distance, focal: camera.focal, width: canvas.width, height: canvas.height });
  // The preview pretends every marker is in view, so the modules behave as they would at the table.
  frame = { now, seconds, ctx, canvas, pose, markers: [], ids: MockAR.IDS.slice(), qr: null,
    say: (text, color) => { $('said').textContent = text; $('said').style.color = color || '#e8edf6'; },
    vibrate: () => {}, style: $('style').value, opacity: Number($('opacity').value), heading: null };
  if (!pose) { $('state').textContent = 'カメラが近すぎます'; return; }
  scenes.render(frame);
  const front = MockARBox.frontFace(pose.rotation), up = MockARBox.upFace(pose.rotation);
  $('state').textContent = `正面 FACE_${'ABCDEF'[front.face]} / 上 FACE_${'ABCDEF'[up.face]} / ${scenes.status(frame)}`;
}
// Clicks on the preview go through the same path as a tap on the phone.
canvas.addEventListener('pointerdown', event => {
  if (!frame || !frame.pose) return;
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) * canvas.width / rect.width;
  const y = (event.clientY - rect.top) * canvas.height / rect.height;
  if (scenes.claim('hit', frame, x, y)) return;
  const face = MockARBox.hitFace(frame.pose, x, y);
  if (face < 0) return;
  if (event.shiftKey) scenes.claim('longPress', frame, face); // shift-click stands in for a long press
  else scenes.claim('tap', frame, face);
});
MockARTune.build($('tune'), { frame: () => frame });
requestAnimationFrame(draw);
