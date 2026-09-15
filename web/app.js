/* ZERO renderer: plain local JavaScript; works from file://, localhost and Electron. */
(() => {
  'use strict';
  const C = window.ZeroCore;
  let activeDocument = document;
  const $ = id => document.getElementById(id) || activeDocument.getElementById(id);
  const widget = $('widget');
  const native = window.zeroDesktop || null;
  const KEYS = { settings: 'zero.settings.v1', timer: 'zero.timer.v1', feed: 'zero.feed.v1' };
  const FEED_URL = 'https://www.census.gov/popclock/data/population.php/world';
  const read = key => { try { return JSON.parse(localStorage.getItem(key)); } catch (_) { return null; } };
  let storageWorks = true;
  function write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { storageWorks = false; } }
  const storedSettings = read(KEYS.settings);
  let settings = C.settingsFrom(storedSettings || {});
  if (!storedSettings && window.matchMedia('(prefers-reduced-motion: reduce)').matches) settings.motion = false;
  let rawFeed = window.ZERO_SEED;
  let model = C.parseFeed(rawFeed, 1789379889000);
  let sourceKind = 'bundled', lastFetch = null, networkMessage = 'Bundled snapshot; no successful network refresh yet.';
  const cache = read(KEYS.feed);
  if (cache && cache.raw) {
    try {
      const parsed = C.parseFeed(cache.raw, cache.fetchedAt);
      if (parsed.epoch >= model.epoch && parsed.epoch <= Date.now() + C.DAY) {
        rawFeed = cache.raw; model = parsed;
        lastFetch = typeof cache.fetchedAt === 'number' && Number.isFinite(cache.fetchedAt) ? cache.fetchedAt : parsed.epoch;
        sourceKind = cache.kind === 'imported' ? 'imported' : 'cached';
        networkMessage = sourceKind === 'imported' ? 'Saved user-imported source; not independently authenticated by ZERO.' : 'Using the last saved source snapshot.';
      }
    } catch (_) { /* Ignore damaged local cache; bundled data remains available. */ }
  }
  let timer = new C.Pomodoro(settings, read(KEYS.timer));
  let trace = new C.FourierTrace(C.populationAt(model, Date.now()).rate, settings.gain);
  let frozenTime = performance.now() / 1000;
  let syncing = false, toastTimeout = null, audio = null, pipWindow = null, pinned = true, launchAtLogin = false;
  let lastSave = 0, lastSourceRender = 0, lastRate = trace.rate, lastTitle = '';
  let lastNativeTimerSend = -Infinity, lastNativeTimerSnapshot = '';
  let animationId = null, animationWindow = window, lastDraw = -Infinity, lastFrameRender = -Infinity;
  let resetFocusTo = null;
  const countFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  const dayFormat = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
  const timeFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
  const names = { focus: 'focus', short: 'short break', long: 'long break' };
  const energyBetween = (a, b) => C.integratePopulation(model, a, b) * settings.wattsPerPerson;
  const nativeCall = (name, ...args) => {
    if (!native || typeof native[name] !== 'function') return Promise.resolve(null);
    return Promise.resolve().then(() => native[name](...args)).catch(() => null);
  };
  function desktopState(state) {
    if (state && typeof state.pinned === 'boolean') pinned = state.pinned;
    if (state && typeof state.launchAtLogin === 'boolean') launchAtLogin = state.launchAtLogin;
    $('floatButton').setAttribute('aria-pressed', String(pinned));
    $('floatButton').title = pinned ? 'Always on top: on' : 'Always on top: off';
    $('pinnedInput').checked = pinned;
    $('launchAtLoginInput').checked = launchAtLogin;
  }
  async function setPinned(value) {
    $('floatButton').disabled = true; $('pinnedInput').disabled = true;
    const actual = await nativeCall('setPinned', value);
    if (typeof actual === 'boolean') desktopState({ pinned: actual });
    else { desktopState(); toast('Could not change always-on-top mode. Try again.'); }
    $('floatButton').disabled = false; $('pinnedInput').disabled = false;
  }
  function persist() { write(KEYS.settings, settings); write(KEYS.timer, timer.snapshot()); }
  function announce(message) { $('announcer').textContent = message; }
  function toast(message) {
    $('toast').textContent = message; $('toast').hidden = false;
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => { $('toast').hidden = true; }, 4200);
  }
  function enableAudio() {
    if (!settings.sound) return;
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume().catch(() => {});
    } catch (_) { /* Audio is an optional enhancement. */ }
  }
  function chime() {
    if (!settings.sound || !audio || audio.state !== 'running') return;
    try {
      [523.25, 659.25, 783.99].forEach((frequency, i) => {
        const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + i * 0.18;
        o.type = 'sine'; o.frequency.value = frequency;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.09, t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
        o.connect(g); g.connect(audio.destination); o.start(t); o.stop(t + 0.62);
      });
    } catch (_) { /* System audio can become unavailable after sleep. */ }
  }
  function settle(now = Date.now()) {
    if (timer.tick(now, energyBetween)) {
      const message = timer.mode === 'focus' ? 'Focus complete. Take a breath, then begin your break.' : 'Break complete. Ready for another focus?';
      announce(message); toast(message); chime();
      nativeCall('notify', timer.mode === 'focus' ? 'Focus complete' : 'Break complete');
      persist();
    }
  }
  function sourceRender(pop, now) {
    const reference = dayFormat.format(model.epoch);
    const stale = now - model.epoch > 45 * C.DAY;
    const future = model.epoch > now + C.DAY;
    let text;
    if (pop.extrapolated) text = `Census · extrapolated / ${reference}`;
    else if (future) text = 'Census · check device date';
    else if (stale) text = `Census · old source / ${reference}`;
    else if (sourceKind === 'network') text = `Census · synced ${timeFormat.format(lastFetch)} UTC`;
    else text = `Census · ${sourceKind === 'bundled' ? 'bundled' : sourceKind} ${reference}`;
    $('sourceStatus').textContent = text;
    $('sourceDot').style.background = sourceKind === 'network' && !stale && !future && !pop.extrapolated ? 'var(--accent)' : 'var(--amber)';
    $('sourceButton').title = `${text}. Open source details. This is an estimate, not a live census.`;
    const anchors = model.anchors;
    $('sourceDetail').textContent = [
      `Origin: ${sourceKind === 'network' ? 'official feed' : sourceKind + ' snapshot'}`,
      `Reference: ${new Date(model.epoch).toISOString().replace('.000', '')}`,
      `Retrieved: ${lastFetch ? new Date(lastFetch).toISOString().replace('.000', '') : 'bundled 14 Sep 2026'}`,
      `Anchors: ${anchors.length ? new Date(anchors[0].t).toISOString().slice(0, 10) + ' → ' + new Date(anchors[anchors.length - 1].t).toISOString().slice(0, 10) : 'no monthly anchors'}`,
      `Clock: ${pop.extrapolated ? 'LINEAR EXTRAPOLATION — refresh source' : 'monthly-anchor interpolation'}`,
      stale ? 'CAUTION: source is over 45 days old.' : '',
      future ? 'CAUTION: source timestamp is ahead of this device.' : ''
    ].filter(Boolean).join('\n');
    $('networkMessage').textContent = networkMessage;
  }
  const instruments = window.ZeroInstrumentView.create({
    widget, $, changed: () => { lastDraw = -Infinity; requestNativeSize(); },
    onFreeze: () => { setMotion(!settings.motion); persist(); },
    onTare: () => { toast('Population reference zeroed. The live estimate keeps moving.'); announce('Population reference zeroed.'); }
  });
  function render(now = Date.now()) {
    settle(now);
    const pop = C.populationAt(model, now);
    instruments.render(model, now);
    const number = countFormat.format(Math.floor(pop.value));
    if ($('population').textContent !== number) $('population').textContent = number;
    $('growth').textContent = `${pop.rate >= 0 ? '+' : '−'}${Math.abs(pop.rate).toFixed(2)} people / sec`;
    const power = C.electrical(pop.value, settings.wattsPerPerson, settings.voltage);
    $('power').textContent = C.formatSI(power.watts, 'W');
    $('current').textContent = C.formatSI(power.amperes, 'A');
    $('energy').textContent = C.formatSI(timer.energyJoules, 'J');
    $('power').title = `${power.watts.toLocaleString('en-US', { maximumFractionDigits: 1 })} watts; hypothetical`;
    $('current').title = `${power.amperes.toLocaleString('en-US', { maximumFractionDigits: 1 })} amperes at ${settings.voltage} V; equivalent, not a real circuit`;
    $('energy').title = `${timer.energyJoules.toLocaleString('en-US', { maximumFractionDigits: 1 })} joules during active time in this interval`;
    $('assumptions').textContent = `${settings.wattsPerPerson} W/person · ${settings.voltage} V equivalent · adjustable`;
    const secs = Math.ceil(timer.remaining / 1000);
    const clock = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
    $('timer').textContent = clock;
    $('timer').setAttribute('aria-label', `${Math.floor(secs / 60)} minutes ${secs % 60} seconds remaining in ${names[timer.mode]}`);
    const status = timer.finished ? 'Complete' : timer.running ? 'Running' : timer.startedAt !== null ? 'Paused' : 'Ready';
    $('phaseLabel').textContent = names[timer.mode].toUpperCase();
    $('timerStatus').textContent = status;
    widget.dataset.phase = timer.mode;
    widget.dataset.status = status.toLowerCase();
    const progress = C.clamp(100 * (1 - timer.remaining / timer.duration), 0, 100);
    $('timerProgress').style.setProperty('--progress', `${progress}%`);
    $('timerProgress').setAttribute('aria-valuenow', String(Math.round(progress)));
    $('timerProgress').setAttribute('aria-valuetext', `${Math.round(progress)}% of ${names[timer.mode]} complete`);
    for (const el of widget.querySelectorAll('[data-mode]')) {
      const on = el.dataset.mode === timer.mode;
      el.classList.toggle('active', on); el.setAttribute('aria-pressed', String(on));
    }
    const nextName = timer.mode === 'focus' ? (timer.finished && timer.completed > 0 && timer.completed % settings.longEvery === 0 ? 'long break' : 'short break') : 'focus';
    $('startText').textContent = timer.finished ? `Start ${nextName}` : timer.running ? 'Pause' : timer.startedAt !== null ? 'Resume' : `Start ${names[timer.mode]}`;
    $('startButton').querySelector('use').setAttribute('href', timer.running ? '#i-pause' : '#i-play');
    $('startButton').setAttribute('aria-label', $('startText').textContent);
    const session = timer.completed + (timer.mode === 'focus' && !timer.finished ? 1 : 0);
    $('sessionCount').textContent = String(Math.max(1, session)).padStart(2, '0');
    $('sessionLabel').textContent = `${timer.completed} COMPLETE`;
    $('orbit').style.setProperty('--progress', `${progress}%`);
    $('timerCaption').textContent = timer.finished ? 'Complete. Your next interval is ready.' : timer.running ?
      (timer.mode === 'focus' ? 'Stay with this one thing.' : 'Let your attention wander.') : timer.startedAt !== null ?
        'Paused. The world keeps moving.' : timer.mode === 'focus' ? 'One small moment of focus.' : 'A little room to recharge.';
    const title = `ZERO · ${number} people${timer.running ? ' · ' + clock : ''}`;
    if (title !== lastTitle) { document.title = title; if (pipWindow && !pipWindow.closed) pipWindow.document.title = title; lastTitle = title; }
    if (native && typeof native.updateTimer === 'function') {
      const state = { clock, mode: timer.mode, running: timer.running, finished: timer.finished };
      const snapshot = JSON.stringify(state), tick = performance.now();
      if (snapshot !== lastNativeTimerSnapshot && tick - lastNativeTimerSend >= 1000) {
        lastNativeTimerSnapshot = snapshot; lastNativeTimerSend = tick;
        nativeCall('updateTimer', state);
      }
    }
    if (Math.abs(pop.rate - lastRate) > 0.0001) {
      trace.setModel(pop.rate, settings.gain); lastRate = pop.rate; lastDraw = -Infinity;
    }
    if (now - lastSourceRender >= 1000 || lastSourceRender === 0) { sourceRender(pop, now); lastSourceRender = now; }
    if (now - lastSave > 5000) { persist(); lastSave = now; }
  }
  function draw(time) { instruments.draw(trace, time); }
  function frame() {
    const now = performance.now();
    const owner = widget.ownerDocument.defaultView;
    if (!owner.document.hidden && now - lastFrameRender >= 250) { render(); lastFrameRender = now; }
    if (!owner.document.hidden && now - lastDraw > (settings.motion ? 33 : 1000)) {
      draw(settings.motion ? now / 1000 : frozenTime); lastDraw = now;
    }
    animationWindow = owner; animationId = owner.requestAnimationFrame(frame);
  }
  function startAnimation() {
    if (animationId !== null) animationWindow.cancelAnimationFrame(animationId);
    lastDraw = -Infinity; animationWindow = widget.ownerDocument.defaultView;
    animationId = animationWindow.requestAnimationFrame(frame);
  }
  function setMotion(value) {
    if (!value) frozenTime = performance.now() / 1000;
    settings.motion = value;
    $('freezeButton').textContent = value ? 'Freeze signal' : 'Resume signal';
    $('freezeButton').title = 'Pause synthetic waveform sampling. The population, signed distance, and public data feeds keep updating.';
    instruments.motion(value);
    $('freezeButton').setAttribute('aria-pressed', String(!value));
    lastDraw = -Infinity;
  }
  function applyCompact() {
    widget.classList.toggle('compact', settings.compact);
    $('compactButton').setAttribute('aria-pressed', String(settings.compact));
    $('compactButton').querySelector('use').setAttribute('href', settings.compact ? '#i-expand' : '#i-minus');
    $('compactButton').title = settings.compact ? 'Expand view (M)' : 'Compact view (M)';
    $('compactButton').setAttribute('aria-label', settings.compact ? 'Expand view' : 'Compact view');
    lastDraw = -Infinity;
    instruments.layout();
    requestNativeSize();
  }
  function requestNativeSize() {
    if (!native) return;
    requestAnimationFrame(() => {
      const rect = widget.getBoundingClientRect();
      const naturalHeight = $('mainPanel').scrollHeight + $('dragHandle').offsetHeight + widget.querySelector('.widget-footer').offsetHeight + 2;
      const requestedHeight = widget.classList.contains('drawer-open') ? Math.max(640, naturalHeight) : naturalHeight;
      nativeCall('resize', { width: Math.ceil(rect.width) + 24, height: Math.ceil(Math.min(733, requestedHeight)) + 24 });
    });
  }
  function closeDrawers() {
    $('settingsPanel').hidden = true; $('aboutPanel').hidden = true;
    $('mainPanel').inert = false;
    widget.classList.remove('drawer-open'); $('settingsButton').setAttribute('aria-expanded', 'false');
    if (resetFocusTo) { resetFocusTo.focus({ preventScroll: true }); resetFocusTo = null; }
    requestNativeSize();
  }
  function openDrawer(which) {
    const id = which === 'settings' ? 'settingsPanel' : 'aboutPanel';
    if (!$(id).hidden) { closeDrawers(); return; }
    closeDrawers(); resetFocusTo = widget.ownerDocument.activeElement;
    $('mainPanel').inert = true; $(id).hidden = false; $(id).scrollTop = 0;
    widget.classList.add('drawer-open'); $('settingsButton').setAttribute('aria-expanded', String(which === 'settings'));
    if (which === 'settings') {
      for (const input of $('settingsForm').elements) {
        if (!input.name || !(input.name in settings)) continue;
        if (input.type === 'checkbox') input.checked = settings[input.name]; else input.value = settings[input.name];
      }
      $('gainOutput').textContent = settings.gain;
    } else sourceRender(C.populationAt(model, Date.now()), Date.now());
    $(id).querySelector('.drawer-close').focus({ preventScroll: true });
    requestNativeSize();
  }
  async function refreshFeed(manual = false) {
    if (syncing) return;
    if (!manual && !settings.autoRefresh) return;
    syncing = true; $('refreshButton').disabled = true; $('refreshButton').textContent = 'Refreshing…';
    try {
      let raw;
      if (native) raw = await native.fetchPopulation();
      else {
        const local = ['http:', 'https:'].includes(location.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
        const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 9000);
        try {
          const response = await fetch(local ? '/api/population' : FEED_URL, {
            signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store'
          });
          if (!response.ok) throw new Error(`Source returned HTTP ${response.status}.`);
          const text = await response.text();
          if (text.length > 1000000) throw new Error('Source response exceeded the safety limit.');
          raw = JSON.parse(text);
        } finally { clearTimeout(timeout); }
      }
      const now = Date.now(), next = C.parseFeed(raw, now);
      if (next.epoch > now + C.DAY) throw new Error('Source timestamp is ahead of this device. Check your system clock.');
      if (next.epoch < model.epoch - C.DAY) throw new Error('Feed is older than the saved snapshot; retained the newer source.');
      settle(now); rawFeed = raw; model = next; sourceKind = 'network'; lastFetch = now;
      write(KEYS.feed, { raw, fetchedAt: now, kind: sourceKind });
      networkMessage = 'Official source retrieved successfully. The ticking count is still an interpolated estimate.';
      if (manual) toast('Census source refreshed. Clock remains an estimate.');
    } catch (error) {
      networkMessage = `Refresh unavailable. The ${sourceKind} estimate is still running. ${location.protocol === 'file:' && !native ? 'Use a START launcher for a local network proxy, or import official JSON.' : 'Try again later or import official JSON.'}`;
      if (error && /older|timestamp/.test(error.message)) networkMessage = error.message;
      if (manual) toast(networkMessage);
    } finally {
      syncing = false; $('refreshButton').disabled = false; $('refreshButton').textContent = 'Refresh feed';
      lastSourceRender = 0; render(); persist();
    }
  }
  function beginOrPause() {
    enableAudio(); settle();
    if (timer.finished) timer.next();
    if (timer.running) { timer.pause(Date.now(), energyBetween); announce('Timer paused.'); }
    else { timer.start(Date.now()); announce(`${names[timer.mode]} timer started.`); }
    render(); persist();
  }
  $('startButton').addEventListener('click', beginOrPause);
  $('resetButton').addEventListener('click', () => { timer.reset(); render(); persist(); toast('Current interval reset.'); });
  $('skipButton').addEventListener('click', () => { settle(); timer.next(); render(); persist(); announce(`Ready for ${names[timer.mode]}.`); });
  for (const button of document.querySelectorAll('[data-mode]')) button.addEventListener('click', () => {
    if (timer.mode !== button.dataset.mode) { settle(); timer.reset(button.dataset.mode); render(); persist(); }
  });
  $('compactButton').addEventListener('click', () => { closeDrawers(); settings.compact = !settings.compact; applyCompact(); persist(); });
  $('settingsButton').addEventListener('click', () => openDrawer('settings'));
  $('energySettingsButton').addEventListener('click', () => openDrawer('settings'));
  $('sourceButton').addEventListener('click', () => openDrawer('about'));
  $('aboutButton').addEventListener('click', () => openDrawer('about'));
  for (const el of document.querySelectorAll('.drawer-close')) el.addEventListener('click', closeDrawers);
  $('freezeButton').addEventListener('click', () => { setMotion(!settings.motion); persist(); });
  $('settingsForm').elements.gain.addEventListener('input', event => { $('gainOutput').textContent = event.target.value; });
  $('settingsForm').addEventListener('submit', event => {
    event.preventDefault();
    if (!$('settingsForm').reportValidity()) return;
    const values = { ...settings };
    for (const input of $('settingsForm').elements) if (input.name && input.name in settings)
      values[input.name] = input.type === 'checkbox' ? input.checked : Number(input.value);
    settle(); const wasAuto = settings.autoRefresh;
    settings = C.settingsFrom(values); timer.setSettings(settings);
    trace.setModel(C.populationAt(model, Date.now()).rate, settings.gain); setMotion(settings.motion);
    persist(); closeDrawers(); render(); toast(storageWorks ? 'Settings saved on this device.' : 'Settings applied, but this browser blocked persistent storage.');
    if (!wasAuto && settings.autoRefresh) refreshFeed();
  });
  $('refreshButton').addEventListener('click', () => refreshFeed(true));
  $('importButton').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    try {
      if (file.size > 1000000) throw new Error('Choose a Census JSON file smaller than 1 MB.');
      const raw = JSON.parse(await file.text()), now = Date.now(), next = C.parseFeed(raw, now);
      if (next.epoch > now + C.DAY) throw new Error('Source is in the future; check the file and your device date.');
      settle(now); rawFeed = raw; model = next; sourceKind = 'imported'; lastFetch = now;
      write(KEYS.feed, { raw, fetchedAt: now, kind: sourceKind });
      networkMessage = 'User-imported Census-format source. Not independently authenticated by ZERO.';
      lastSourceRender = 0; render(); toast('Population source imported.');
    } catch (error) { toast(error.message || 'Unable to read this source.'); }
    event.target.value = '';
  });
  $('exportButton').addEventListener('click', () => {
    settle();
    const now = Date.now(), pop = C.populationAt(model, now), power = C.electrical(pop.value, settings.wattsPerPerson, settings.voltage);
    const snapshot = { app: 'ZERO', version: '1.2.0', exportedAt: new Date(now).toISOString(),
      notes: 'Estimated population; a one-dimensional signed-distance gauge; synthetic illustrative-people signal; virtual FMCW radar; hypothetical electrical equivalent. No RF, EEG or demographic sensor measurements.',
      source: { provider: model.provider, url: FEED_URL, kind: sourceKind, referenceTime: new Date(model.epoch).toISOString(), rawFeed },
      model: { population: pop.value, peoplePerSecond: pop.rate, extrapolated: pop.extrapolated,
        watts: power.watts, equivalentAmperes: power.amperes, currentIntervalJoules: timer.energyJoules,
        sdf: 'phi(n,t) = n - P(t)', waveform: 'seeded conjugate spectrum -> IFFT; mean zero; 128 samples/s; 16-second loop', fft: '512 samples, Hann window, one-sided coherent-gain-corrected amplitude' },
      instruments: instruments.snapshot(), settings, timer: timer.snapshot() };
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), a = widget.ownerDocument.createElement('a');
    a.href = url; a.download = `zero-snapshot-${new Date(now).toISOString().slice(0, 10)}.json`;
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast('Snapshot exported. Use raw Census JSON for source imports.');
  });
  function dockBrowser() { widget.style.left = ''; widget.style.top = ''; widget.style.right = ''; widget.style.bottom = ''; }
  $('floatButton').addEventListener('click', async () => {
    if (native) {
      await setPinned(!pinned); return;
    }
    if (pipWindow && !pipWindow.closed) { pipWindow.close(); return; }
    if (!window.documentPictureInPicture) { toast('For always-on-top mode, run the desktop version. Browser float requires a supported Chromium browser on localhost.'); return; }
    try {
      closeDrawers();
      pipWindow = await window.documentPictureInPicture.requestWindow({ width: settings.compact ? 360 : 560, height: Math.ceil(widget.getBoundingClientRect().height) });
      pipWindow.document.title = document.title; pipWindow.document.documentElement.lang = 'en';
      const link = pipWindow.document.createElement('link'); link.rel = 'stylesheet'; link.href = new URL('web/style.css', location.href).href;
      pipWindow.document.head.appendChild(link); pipWindow.document.body.className = 'pip'; dockBrowser();
      activeDocument = pipWindow.document;
      pipWindow.document.body.appendChild(widget); pipWindow.addEventListener('keydown', keyboard);
      pipWindow.addEventListener('resize', () => { lastDraw = -Infinity; });
      pipWindow.addEventListener('pagehide', () => {
        $('widgetHome').appendChild(widget); activeDocument = document; pipWindow = null; dockBrowser(); startAnimation();
      }, { once: true });
      startAnimation();
    } catch (_) { pipWindow = null; toast('This browser could not open a floating window. Use the desktop version in the ZIP.'); }
  });
  $('closeButton').addEventListener('click', () => { settle(); persist(); nativeCall('close'); });
  $('quitButton').addEventListener('click', () => { settle(); persist(); nativeCall('quit'); });
  $('pinnedInput').addEventListener('change', event => setPinned(event.target.checked));
  $('launchAtLoginInput').addEventListener('change', async event => {
    const input = event.target;
    input.disabled = true;
    const requested = input.checked, actual = await nativeCall('setLaunchAtLogin', requested);
    if (typeof actual === 'boolean') {
      desktopState({ launchAtLogin: actual });
      toast(actual === requested ? (actual ? 'ZERO will start when you sign in to Windows.' : 'Windows startup disabled.') : 'Windows could not apply that startup setting.');
    } else { desktopState(); toast('Could not change Windows startup. Try again.'); }
    input.disabled = false;
  });
  $('dragHandle').addEventListener('dblclick', event => {
    if (event.target.closest('button')) return;
    if (native) nativeCall('dock'); else dockBrowser();
  });
  let drag = null;
  $('dragHandle').addEventListener('pointerdown', event => {
    if (native || pipWindow || event.button !== 0 || event.target.closest('button')) return;
    const rect = widget.getBoundingClientRect();
    drag = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    $('dragHandle').setPointerCapture(event.pointerId);
  });
  $('dragHandle').addEventListener('pointermove', event => {
    if (!drag) return;
    widget.style.left = `${C.clamp(event.clientX - drag.x, 8, Math.max(8, innerWidth - widget.offsetWidth - 8))}px`;
    widget.style.top = `${C.clamp(event.clientY - drag.y, 8, Math.max(8, innerHeight - widget.offsetHeight - 8))}px`;
    widget.style.right = 'auto'; widget.style.bottom = 'auto';
  });
  const endDrag = () => { drag = null; };
  $('dragHandle').addEventListener('pointerup', endDrag); $('dragHandle').addEventListener('lostpointercapture', endDrag);
  function keyboard(event) {
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    const editing = /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.target.isContentEditable;
    if (event.key === 'Escape') { closeDrawers(); return; }
    if (editing) return;
    const drawer = !$('settingsPanel').hidden || !$('aboutPanel').hidden;
    if (drawer && event.key.toLowerCase() !== 's') return;
    if (event.key === ' ' && event.target.closest('button,a')) return;
    const actions = { ' ': beginOrPause, r: () => $('resetButton').click(), n: () => $('skipButton').click(),
      m: () => $('compactButton').click(), s: () => openDrawer('settings') };
    const action = actions[event.key.toLowerCase()];
    if (action) { event.preventDefault(); action(); }
  }
  window.addEventListener('keydown', keyboard);
  window.addEventListener('resize', () => { if (!native && !pipWindow) dockBrowser(); lastDraw = -Infinity; });
  window.addEventListener('pagehide', () => { settle(); persist(); });
  document.addEventListener('visibilitychange', () => { settle(); persist(); lastDraw = -Infinity; });
  // One active owner per storage scope. A second browser window displays a notice
  // rather than silently merging conflicting timers; it retains its own session.
  window.addEventListener('storage', event => {
    if (event.key === KEYS.timer) toast('Another ZERO tab saved a timer. Use one tab to avoid competing saved sessions.');
  });
  if (native) {
    document.body.classList.add('native');
    $('floatButton').querySelector('use').setAttribute('href', '#i-pin');
    $('floatButton').setAttribute('aria-label', 'Toggle always on top');
    $('desktopSettings').hidden = false;
    $('launchAtLoginOption').hidden = typeof native.setLaunchAtLogin !== 'function';
    $('quitButton').hidden = typeof native.quit !== 'function';
    desktopState();
    nativeCall('getDesktopState').then(desktopState);
    if (typeof native.onState === 'function') native.onState(desktopState);
    if (typeof native.onAction === 'function') native.onAction(action => {
      if (action === 'toggle-timer') beginOrPause();
      if (action === 'next-timer') $('skipButton').click();
    });
    // The minimum viewport starts large enough; renderer reports natural panel size.
    new ResizeObserver(requestNativeSize).observe(widget);
    new ResizeObserver(requestNativeSize).observe($('mainPanel'));
  } else if (location.protocol === 'file:') {
    $('launchHint').textContent = 'Offline preview works here. Use a START launcher for network refresh, or npm start for the desktop widget.';
  } else if ('documentPictureInPicture' in window) {
    $('launchHint').textContent = 'The small window icon opens a floating, always-on-top view in supported Chromium browsers.';
  }
  applyCompact(); setMotion(settings.motion); render(); startAnimation();
  setInterval(render, 250);
  setInterval(() => refreshFeed(), 6 * 60 * 60 * 1000);
  setTimeout(() => refreshFeed(), 300);
})();
