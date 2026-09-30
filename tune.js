// The tuning panel: sliders for every number in config.js, and buttons to skip straight to a state.
// It builds itself from the config list and the modules in scenes.js, so nothing here needs editing
// when either of those grows. On the page it appears only with ?tune=1; the preview always shows it.
(function (root) {
  'use strict';
  const make = (tag, props = {}, parent = null) => {
    const node = Object.assign(document.createElement(tag), props);
    if (parent) parent.appendChild(node);
    return node;
  };
  function build(container, options = {}) {
    const config = root.MockARConfig, scenes = root.MockARScenes;
    container.classList.add('tune');
    make('h2', { textContent: '調整パネル' }, container);

    // Skip ahead: every module lists the states worth jumping to.
    const jumps = make('div', { className: 'tune-jumps' }, container);
    for (const scene of scenes.list) {
      if (!scene.jumps || !scene.jumps.length) continue;
      const row = make('div', { className: 'tune-row' }, jumps);
      make('span', { className: 'tune-name', textContent: scene.title }, row);
      for (const jump of scene.jumps) {
        make('button', { type: 'button', textContent: jump.label,
          onclick: () => { jump.go(options.frame ? options.frame() : null); } }, row);
      }
    }
    const row = make('div', { className: 'tune-row' }, jumps);
    make('span', { className: 'tune-name', textContent: 'すべて' }, row);
    make('button', { type: 'button', textContent: '最初から', onclick: () => scenes.reset() }, row);

    // One slider per number, grouped the way config.js groups them.
    const shown = new Map();
    let group = null;
    for (const item of config.SCHEMA) {
      if (item.group !== group) { group = item.group; make('h3', { textContent: group }, container); }
      const line = make('label', { className: 'tune-item' }, container);
      const caption = make('span', {}, line);
      const readout = () => `${item.label}: ${config.values[item.key]}${item.unit || ''}`;
      caption.textContent = readout();
      const slider = make('input', { type: 'range', min: item.min, max: item.max, step: item.step,
        value: config.values[item.key] }, line);
      slider.oninput = () => { config.set(item.key, slider.value); caption.textContent = readout(); };
      shown.set(item.key, { slider, caption, readout });
    }
    const refresh = () => shown.forEach(({ slider, caption, readout }, key) => {
      slider.value = config.values[key]; caption.textContent = readout();
    });

    const actions = make('div', { className: 'tune-row' }, container);
    const note = make('p', { className: 'tune-note' }, container);
    make('button', { type: 'button', textContent: '初期値に戻す',
      onclick: () => { config.reset(); refresh(); note.textContent = '初期値に戻しました。'; } }, actions);
    make('button', { type: 'button', textContent: '変更点をコピー', onclick: async () => {
      const text = JSON.stringify(config.changed(), null, 2);
      note.textContent = text === '{}' ? '初期値のままです。' : text;
      try { await navigator.clipboard.writeText(text); note.textContent += '\n（コピーしました）'; } catch (error) { /* shown above */ }
    } }, actions);
    make('button', { type: 'button', textContent: 'この設定のリンクをコピー', onclick: async () => {
      const query = new URLSearchParams({ tune: '1', ...config.changed() });
      const url = location.origin + location.pathname + '?' + query;
      note.textContent = url;
      try { await navigator.clipboard.writeText(url); note.textContent += '\n（コピーしました）'; } catch (error) { /* shown above */ }
    } }, actions);
    return { refresh };
  }
  function attach(options = {}) {
    if (!new URLSearchParams(root.location.search).has('tune')) return null;
    const host = document.querySelector('main') || document.body;
    return build(make('section', {}, host), options);
  }
  root.MockARTune = { attach, build };
})(globalThis);
