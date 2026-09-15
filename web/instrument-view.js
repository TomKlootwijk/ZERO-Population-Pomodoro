/* ZERO instrument rendering. Plots are local canvas geometry, never sensor data. */
(() => {
  'use strict';
  const I = window.ZeroInstruments;
  const C = window.ZeroCore;
  const TAU = Math.PI * 2;
  const palette = { lime: '#c5ee92', teal: '#73d6ca', amber: '#e5b371', grid: '#283d2d', faint: '#748879' };
  const signed = (value, decimals = 1) => `${value < 0 ? '−' : '+'}${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
  const compactSigned = value => Math.abs(value) >= 1e6 ? `${signed(value / 1e6, 2)}M` : Math.abs(value) >= 1e4 ? `${signed(value / 1e3, 1)}k` : signed(value, 1);
  function canvasContext(canvas) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    const w = rect.width, h = rect.height;
    const dpr = Math.min(canvas.ownerDocument.defaultView.devicePixelRatio || 1, 2);
    const pixelW = Math.round(w * dpr), pixelH = Math.round(h * dpr);
    if (canvas.width !== pixelW || canvas.height !== pixelH) { canvas.width = pixelW; canvas.height = pixelH; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }
  function grid(p, divisions = 8) {
    const { ctx, w, h } = p;
    ctx.strokeStyle = palette.grid; ctx.lineWidth = .5; ctx.beginPath();
    for (let i = 0; i <= divisions; i++) { const x = i * w / divisions; ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let i = 0; i <= 4; i++) { const y = i * h / 4; ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
  }
  function line(p, samples, color, center = 0, scale = 1, dashed = false) {
    const { ctx, w, h } = p;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
    ctx.beginPath();
    for (let i = 0; i < samples.length; i++) {
      const x = i * w / (samples.length - 1), y = h / 2 - (samples[i] - center) * scale;
      if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color; ctx.lineWidth = 1.15;
    if (dashed) ctx.setLineDash([3, 3]);
    ctx.stroke(); ctx.restore();
  }
  function duration(seconds) {
    if (seconds === null || !Number.isFinite(seconds)) return '—';
    if (seconds >= 86400) return `${Math.floor(seconds / 86400)}d ${Math.floor(seconds % 86400 / 3600)}h`;
    if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
    return `${Math.max(0, Math.ceil(seconds / 60))}m`;
  }
  window.ZeroInstrumentView = {
    create({ widget, $, changed, onFreeze, onTare }) {
      const key = 'zero.instruments.v1';
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(key)); } catch (_) { /* Optional local persistence. */ }
      const validReference = saved && Number.isFinite(saved.referencePopulation) && saved.referencePopulation > 0
        && Number.isFinite(saved.referenceTime) && saved.referenceTime > 0 && saved.referenceTime <= Date.now();
      const state = {
        referencePopulation: validReference ? saved.referencePopulation : null,
        referenceTime: validReference ? saved.referenceTime : Date.now(),
        offset: C.clamp(Number(saved && saved.offset) || 0, -500, 500),
        rangeM: C.clamp(Number(saved && saved.rangeM) || 42, 1, 150),
        velocityMps: C.clamp(Number(saved && saved.velocityMps) || 0, -20, 20),
        coupling: saved && saved.coupling === 'dc' ? 'dc' : 'ac',
        instrument: ['signal', 'radar', 'energy', 'telemetry'].includes(saved && saved.instrument) ? saved.instrument : 'signal'
      };
      if (!saved) state.velocityMps = 1.5;
      let metrics = null, distance = 0, lastModel = null, latestTime = Date.now(), lastStats = null;
      const save = () => { try { localStorage.setItem(key, JSON.stringify(state)); } catch (_) { /* Browser may disable storage. */ } };
      const set = (id, text) => { const el = $(id); if (el && el.textContent !== text) el.textContent = text; };
      const selectInstrument = (value, focus = false) => {
        state.instrument = value;
        for (const button of widget.querySelectorAll('[data-instrument]')) {
          const active = button.dataset.instrument === value;
          button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
          const panel = $(button.getAttribute('aria-controls'));
          panel.hidden = !active;
          if (active && focus) button.focus();
        }
        // The pocket always has a miniature AC trace, independent of the lab tab.
        if (widget.classList.contains('compact')) $('signalPanel').hidden = false;
        widget.dispatchEvent(new CustomEvent('zero-instrument', { bubbles: true, detail: { instrument: value } }));
        changed(); save();
      };
      for (const button of widget.querySelectorAll('[data-instrument]')) {
        button.addEventListener('click', () => selectInstrument(button.dataset.instrument));
        button.addEventListener('keydown', event => {
          const buttons = [...widget.querySelectorAll('[data-instrument]')], index = buttons.indexOf(button);
          let next = null;
          if (event.key === 'ArrowRight') next = (index + 1) % buttons.length;
          if (event.key === 'ArrowLeft') next = (index + buttons.length - 1) % buttons.length;
          if (event.key === 'Home') next = 0;
          if (event.key === 'End') next = buttons.length - 1;
          if (next !== null) { event.preventDefault(); selectInstrument(buttons[next].dataset.instrument, true); }
        });
      }
      function coupling(value) {
        state.coupling = value;
        for (const button of widget.querySelectorAll('[data-coupling]')) {
          const active = button.dataset.coupling === value;
          button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
        }
        set('scopeMode', value === 'ac' ? 'AC · mean removed' : 'DC · includes signed-distance offset');
        changed(); save();
      }
      for (const button of widget.querySelectorAll('[data-coupling]')) button.addEventListener('click', () => coupling(button.dataset.coupling));
      $('probeInput').value = state.offset;
      $('radarRangeInput').value = state.rangeM;
      $('radarSpeedInput').value = state.velocityMps;
      $('probeInput').addEventListener('input', event => { state.offset = Number(event.target.value); save(); render(lastModel, Date.now()); changed(); });
      $('radarRangeInput').addEventListener('input', event => { state.rangeM = Number(event.target.value); save(); changed(); });
      $('radarSpeedInput').addEventListener('input', event => { state.velocityMps = Number(event.target.value); save(); changed(); });
      $('radarFreezeButton').addEventListener('click', onFreeze);
      $('tareButton').addEventListener('click', () => {
        if (!lastModel) return;
        state.referenceTime = Date.now();
        state.referencePopulation = C.populationAt(lastModel, state.referenceTime).value;
        state.offset = 0; $('probeInput').value = 0; save(); render(lastModel, state.referenceTime); changed();
        if (onTare) onTare();
      });
      function drawGauge() {
        const p = canvasContext($('strainGauge')); if (!p) return;
        const { ctx, w, h } = p;
        const maximum = Math.max(100, Math.ceil(Math.abs(distance) / 100) * 100);
        const cx = w / 2, cy = h / 2, usable = w - 12;
        const x = cx + C.clamp(distance / maximum, -1, 1) * usable / 2;
        // A ribbed aperture around a 1D zero surface. The horizontal coordinate is people.
        ctx.strokeStyle = '#3d5b41'; ctx.lineWidth = .6;
        for (let i = 0; i < 45; i++) {
          const q = i / 44, xx = 6 + q * usable, len = 4 + 7 * Math.abs(q * 2 - 1);
          ctx.beginPath(); ctx.moveTo(xx, cy - len / 2); ctx.lineTo(xx, cy + len / 2); ctx.stroke();
        }
        ctx.strokeStyle = '#4c704a'; ctx.beginPath(); ctx.ellipse(cx, cy, usable / 2, h * .34, 0, 0, TAU); ctx.stroke();
        const grad = ctx.createLinearGradient(6, 0, w - 6, 0);
        grad.addColorStop(0, '#73d6ca22'); grad.addColorStop(.5, '#c5ee9255'); grad.addColorStop(1, '#e5b37122');
        ctx.fillStyle = grad; ctx.fillRect(6, cy - 2, usable, 4);
        ctx.fillStyle = palette.lime; ctx.fillRect(cx - .5, cy - 8, 1, 16);
        ctx.strokeStyle = distance < 0 ? palette.teal : palette.amber; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, cy); ctx.stroke();
        ctx.fillStyle = palette.text || '#ecf8df'; ctx.beginPath(); ctx.moveTo(x, cy - 7); ctx.lineTo(x + 3.5, cy - 2); ctx.lineTo(x, cy + 3); ctx.lineTo(x - 3.5, cy - 2); ctx.closePath(); ctx.fill();
        set('gaugeMin', `−${maximum.toLocaleString('en-US')}`); set('gaugeMax', `+${maximum.toLocaleString('en-US')} people`);
      }
      function render(model, now) {
        if (!model) return;
        lastModel = model; latestTime = now;
        if (state.referencePopulation === null) { state.referencePopulation = C.populationAt(model, now).value; state.referenceTime = now; save(); }
        metrics = I.populationMetrics(model, now, state.referencePopulation, state.referenceTime);
        distance = I.signedDistance(state.referencePopulation + state.offset, metrics.population);
        set('netToday', `${signed(metrics.netToday, 0)} people`);
        set('populationDrift', `${signed(metrics.delta, 0)} people`);
        set('nextMillionEta', duration(metrics.targetEtaSeconds));
        $('nextMillionEta').title = `${metrics.nextMillion.toLocaleString('en-US')} people, projected at the current local growth rate. Not a forecast.`;
        $('distanceValue').firstChild.textContent = `${compactSigned(distance)} `;
        $('distanceValue').title = `${signed(distance, 2)} people from the live population estimate`;
        $('strainValue').firstChild.textContent = `${signed(metrics.strainPPM, 3)} `;
        set('probeOutput', `${signed(state.offset, 0)} people`);
        // A drastically different imported source can exceed a bridge's physical domain.
        const bridge = I.quarterBridge && metrics.strainPPM > -500000 ? I.quarterBridge(metrics.strainPPM / 1e6) : null;
        const bridgeNote = bridge ? ` · virtual bridge ${signed(bridge.outputUv, 3)} µV (GF 2 / 5 V)` : ' · outside virtual bridge range';
        const elapsed = Math.max(0, now - state.referenceTime) / 1000;
        const since = elapsed < 60 ? `${Math.floor(elapsed)}s` : duration(elapsed);
        set('referenceNote', `P₀ ${Math.floor(state.referencePopulation).toLocaleString('en-US')} · ${since} since tare${bridgeNote}`);
        drawGauge();
      }
      function drawSignal(trace, time) {
        const p = canvasContext($('waveform')); if (!p) return;
        const samples = trace.window(time), compact = widget.classList.contains('compact');
        const raw = Float64Array.from(samples, x => x + distance);
        const stats = I.signalStats(raw, trace.sampleRate); lastStats = stats;
        const ac = compact || state.coupling === 'ac';
        const shown = Float64Array.from(raw, x => ac ? x - stats.dc : x);
        const extent = Math.max(trace.excursion, ...shown.map(Math.abs), 1) * 1.1;
        grid(p, compact ? 8 : 10);
        const { ctx, w, h } = p;
        ctx.setLineDash([2, 4]); ctx.strokeStyle = '#4b6646'; ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke(); ctx.setLineDash([]);
        line(p, shown, ac ? palette.lime : palette.teal, 0, h * .43 / extent);
        set('traceScale', `±${extent.toFixed(1)} people`);
        set('meterDC', compactSigned(stats.dc)); set('meterAC', stats.acRms.toFixed(2));
        set('meterPP', stats.peakPeak.toFixed(2)); set('meterHz', stats.dominantHz.toFixed(2));
        set('fftPeak', `peak ${stats.dominantAmplitude.toFixed(2)} people`);
        $('waveform').setAttribute('aria-label', `${ac ? 'AC-coupled' : 'DC-coupled'} synthetic waveform, ${extent.toFixed(1)} illustrative people full-scale each direction`);
        if (compact) return;
        const sp = canvasContext($('spectrum')); if (!sp) return;
        grid(sp, 8);
        const maximum = Math.max(stats.dominantAmplitude, .001), bars = 128, bw = sp.w / bars;
        for (let i = 0; i < bars; i++) {
          const amplitude = Math.max(stats.spectrum[i * 2].amplitude, stats.spectrum[i * 2 + 1].amplitude);
          const height = Math.max(.5, amplitude / maximum * (sp.h - 3));
          sp.ctx.fillStyle = i < 32 ? palette.teal : '#6eaa95';
          sp.ctx.globalAlpha = .25 + .75 * amplitude / maximum;
          sp.ctx.fillRect(i * bw, sp.h - height, Math.max(.8, bw - 1), height);
        }
        sp.ctx.globalAlpha = 1;
      }
      function drawRadar(time) {
        if (state.instrument !== 'radar' || widget.classList.contains('compact')) return;
        const radar = I.virtualRadar({ rangeM: state.rangeM, velocityMps: state.velocityMps, startTime: time });
        set('rangeOutput', `${state.rangeM} m`); set('speedOutput', `${signed(state.velocityMps, 1)} m/s`);
        $('radarRange').firstChild.textContent = `${state.rangeM.toFixed(1)} `;
        $('radarDoppler').firstChild.textContent = `${signed(radar.dopplerHz, 1)} `;
        $('radarBeat').firstChild.textContent = `${signed(radar.beatHz / 1000, 2)} `;
        set('radarWindow', `${(radar.observationSeconds * 1000).toFixed(1)} ms / ${(radar.sampleRate / 1000).toFixed(0)} kS/s`);
        set('radarResolution', `150 MHz · 1 ms chirp · ${radar.rangeResolutionM.toFixed(2)} m resolution`);
        const chirp = canvasContext($('radarChirp'));
        if (chirp) { grid(chirp); line(chirp, radar.tx, palette.lime, .5, chirp.h * .82); line(chirp, radar.rx, palette.teal, .5, chirp.h * .82, true); }
        const ifp = canvasContext($('radarIF'));
        if (ifp) { grid(ifp); line(ifp, radar.ifSignal, palette.amber, 0, ifp.h * .40); }
        const p = canvasContext($('radarMap')); if (!p) return;
        const { ctx, w, h } = p, cx = w / 2, cy = h / 2, radius = Math.min(w, h) / 2 - 5;
        const phase = I.phaseClock ? I.phaseClock(time, 0, 8) : { phase: (time % 8) / 8, winding: Math.floor(time / 8) };
        const theta = phase.phase * TAU - Math.PI / 2;
        for (const range of [1, 5, 20, 60, 150]) {
          const r = Math.log1p(range) / Math.log1p(150) * radius;
          ctx.strokeStyle = '#33593d'; ctx.lineWidth = .6; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
        }
        ctx.strokeStyle = '#28422f'; ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.moveTo(cx - radius, cy); ctx.lineTo(cx + radius, cy); ctx.stroke();
        for (let i = 0; i < 24; i++) {
          const a = theta - .03 * i; ctx.strokeStyle = `rgba(197,238,146,${.32 * (1 - i / 24)})`;
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + radius * Math.cos(a), cy + radius * Math.sin(a)); ctx.stroke();
        }
        const tr = Math.log1p(state.rangeM) / Math.log1p(150) * radius, targetTheta = -.63;
        const x = cx + tr * Math.cos(targetTheta), y = cy + tr * Math.sin(targetTheta);
        ctx.strokeStyle = '#e5b37165'; ctx.beginPath(); ctx.arc(x, y, 6, 0, TAU); ctx.stroke();
        ctx.fillStyle = palette.amber; ctx.beginPath(); ctx.arc(x, y, 2, 0, TAU); ctx.fill();
        ctx.fillStyle = palette.faint; ctx.font = '6px Consolas, monospace';
        ctx.fillText(`θ ${(phase.phase * 360).toFixed(0)}° · k ${phase.winding}`, 2, h - 1);
        $('radarMap').title = 'Logarithmic radial scale, cosmetic 8-second scan phase θ and winding k. Target bearing is illustrative; target range is the slider setting.';
      }
      coupling(state.coupling);
      return {
        render,
        draw(trace, time) { drawGauge(); if (widget.classList.contains('compact') || state.instrument === 'signal') drawSignal(trace, time); drawRadar(time); },
        layout() { selectInstrument(state.instrument); },
        motion(value) {
          set('radarFreezeButton', value ? 'Freeze signal' : 'Resume signal');
          $('radarFreezeButton').setAttribute('aria-pressed', String(!value));
          widget.dispatchEvent(new CustomEvent('zero-motion', { bubbles: true, detail: { motion: value } }));
        },
        snapshot() { return { ...state, metrics, signedDistancePeople: distance, sampledAt: latestTime, multimeter: lastStats ? { dc: lastStats.dc, acRms: lastStats.acRms, peakPeak: lastStats.peakPeak, dominantHz: lastStats.dominantHz, units: 'illustrative people' } : null }; }
      };
    }
  };
})();
