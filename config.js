// Every number worth tuning, in one place. The tuning panel builds itself from this list, so a new
// entry here becomes a new slider with no extra code. Changes are kept per device in localStorage.
(function (root) {
  'use strict';
  const SCHEMA = [
    { key: 'frameMs', label: '処理の間隔', value: 65, min: 33, max: 200, step: 1, unit: 'ms', group: '全体' },
    { key: 'poseSmoothing', label: '1面のときの向きのならし', value: .8, min: 0, max: .95, step: .05, group: '全体' },

    { key: 'longPressMs', label: '長押しと判定する時間', value: 500, min: 200, max: 1200, step: 50, unit: 'ms', group: '操作' },
    { key: 'movePx', label: 'スワイプと判定する距離', value: 8, min: 2, max: 40, step: 1, unit: 'px', group: '操作' },
    { key: 'swipeSpan', label: 'スワイプで開ききる距離（面の何倍）', value: .45, min: .15, max: 1.2, step: .05, group: '操作' },
    { key: 'swipeOpen', label: '離したときに開く位置', value: .4, min: .1, max: .9, step: .05, group: '操作' },

    { key: 'lidHoldMs', label: 'E面を見失っても保持する時間', value: 300, min: 0, max: 2000, step: 50, unit: 'ms', group: 'ふた' },
    { key: 'lidOpenMs', label: 'ふたが開ききるまで', value: 600, min: 100, max: 2000, step: 50, unit: 'ms', group: 'ふた' },
    { key: 'lidOpenDeg', label: 'ふたが開く角度', value: 99, min: 30, max: 170, step: 1, unit: '°', group: 'ふた' },

    { key: 'hologramHeight', label: '浮かぶ文字の高さ（箱の何個ぶん）', value: 1, min: 0, max: 3, step: .1, group: '浮かぶ文字' },

    { key: 'stageSpan', label: '盤面の大きさ（面の何割）', value: .86, min: .4, max: 1, step: .02, group: 'F面のゲーム' },
    { key: 'runWalk', label: '歩く速さ', value: 3.2, min: .5, max: 10, step: .1, unit: 'マス/秒', group: 'F面のゲーム' },
    { key: 'runFall', label: '落ちる速さ', value: 7, min: 1, max: 20, step: .5, unit: 'マス/秒', group: 'F面のゲーム' },

    { key: 'halfTurnDeg', label: '半周と判定する角度', value: 150, min: 45, max: 180, step: 5, unit: '°', group: 'CLEAR' },
    { key: 'clearHoldMs', label: '中央で保持する時間', value: 500, min: 100, max: 2000, step: 50, unit: 'ms', group: 'CLEAR' },
    { key: 'clearCentred', label: '中央と認める範囲（画面幅の何割）', value: .16, min: .05, max: .5, step: .01, group: 'CLEAR' },
    { key: 'clearFacing', label: 'E面が正面と認める度合い', value: .8, min: .3, max: .99, step: .01, group: 'CLEAR' },

    { key: 'qrEvery', label: 'QRを読む間隔（フレームに1回）', value: 2, min: 1, max: 10, step: 1, group: 'QR' },
    { key: 'qrHoldMs', label: 'QRを見失っても保持する時間', value: 700, min: 100, max: 3000, step: 100, unit: 'ms', group: 'QR' },

    // The white box sequence (sequence.js). Its lid shares lidOpenMs and lidOpenDeg above.
    { key: 'seamTouch', label: '境目のタッチ幅（面の幅の何割、左右それぞれ）', value: .1, min: .02, max: .3, step: .01, group: '白い箱の謎' },
    { key: 'faceVisibleDeg', label: '面が見えていると認める角度（法線とカメラ方向）', value: 75, min: 30, max: 89, step: 1, unit: '°', group: '白い箱の謎' },
    { key: 'diamondDeg', label: 'ひし形と認める箱の傾き', value: 45, min: 10, max: 80, step: 1, unit: '°', group: '白い箱の謎' },
    { key: 'diamondToleranceDeg', label: 'ひし形の許容（±）', value: 7.5, min: 1, max: 20, step: .5, unit: '°', group: '白い箱の謎' },
    { key: 'sunMoveMs', label: '太陽が次の時刻へ動く時間', value: 300, min: 50, max: 2000, step: 50, unit: 'ms', group: '白い箱の謎' },
    { key: 'hourMin', label: '時計の最小', value: 0, min: 0, max: 23, step: 1, unit: '時', group: '白い箱の謎' },
    { key: 'hourMax', label: '時計の最大', value: 23, min: 0, max: 23, step: 1, unit: '時', group: '白い箱の謎' },
    { key: 'eastIsLeft', label: '東を左にする（1=左、0=右）', value: 1, min: 0, max: 1, step: 1, group: '白い箱の謎' },
    { key: 'boxHologramHeight', label: '中の文字の高さ（箱の中心から）', value: 0, min: -.5, max: 1, step: .05, group: '白い箱の謎' },
    { key: 'hologramDesignDistance', label: '中の文字がそろう距離（モデルの設計値）', value: 3.5, min: 1, max: 10, step: .1, group: '白い箱の謎' },
    { key: 'hologramSize', label: '中の文字の大きさ', value: .5, min: .1, max: 1.5, step: .05, group: '白い箱の謎' }
  ];
  const STORE = 'mockar.config';
  const defaults = () => Object.fromEntries(SCHEMA.map(item => [item.key, item.value]));
  const values = defaults();
  const clamp = (item, value) => Math.min(item.max, Math.max(item.min, value));

  function set(key, value) {
    const item = SCHEMA.find(entry => entry.key === key);
    if (!item || !Number.isFinite(Number(value))) return false;
    values[key] = clamp(item, Number(value));
    save();
    return true;
  }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(changed())); } catch (error) { /* private mode */ }
  }
  function load() {
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (error) { stored = null; }
    // ?tune values win over stored ones, so a link can carry a setting.
    const query = new URLSearchParams(root.location ? root.location.search : '');
    for (const source of [stored, Object.fromEntries(query)]) {
      if (!source) continue;
      for (const [key, value] of Object.entries(source)) {
        const item = SCHEMA.find(entry => entry.key === key);
        if (item && Number.isFinite(Number(value))) values[key] = clamp(item, Number(value));
      }
    }
  }
  // Only what differs from the defaults, which is what is worth pasting back into this file.
  const changed = () => Object.fromEntries(SCHEMA
    .filter(item => values[item.key] !== item.value)
    .map(item => [item.key, values[item.key]]));
  function reset() {
    Object.assign(values, defaults());
    try { localStorage.removeItem(STORE); } catch (error) { /* ignore */ }
  }
  if (root.location) load();
  const api = { SCHEMA, values, set, reset, changed, defaults };
  if (typeof module !== 'undefined') module.exports = api; else root.MockARConfig = api;
})(globalThis);
