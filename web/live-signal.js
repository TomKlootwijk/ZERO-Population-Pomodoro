/* ZERO · Analysis of reported NOAA samples. No synthetic fill or resampling. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.ZeroLiveSignal = factory(root.ZeroCore);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core) {
  'use strict';
  if (!Core || typeof Core.spectrum !== 'function') throw new Error('Load ZeroCore before ZeroLiveSignal.');
  const INTERVAL_MS = 60000, SAMPLE_RATE_HZ = 1 / 60;
  const MIN_SAMPLES = 16, MAX_SAMPLES = 64, MAX_HISTORY = 120, MAX_INPUT = 30000;
  const valid = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
  const sourceName = value => typeof value === 'string' ? value.replace(/[^a-zA-Z0-9 ._()/+:-]/g, ' ').trim().slice(0, 30) : null;

  // Preserve an invalid reading with a valid timestamp as a barrier. Dropping it
  // would incorrectly let an older complete window stand in for the latest data.
  function ordered(rows, kind) {
    if (!Array.isArray(rows) || rows.length > MAX_INPUT) return { rows: [], invalidInput: true, discarded: 0 };
    const unique = new Map();
    let discarded = 0;
    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row) || !Number.isSafeInteger(row.time) || row.time < 0 || row.time > 8640000000000000) {
        discarded++; continue;
      }
      let reading = null;
      if (kind === 'wind' && valid(row.speed, 0, 5000)) {
        reading = { time: row.time, speed: row.speed,
          density: valid(row.density, 0, 10000) ? row.density : null,
          temperature: valid(row.temperature, 0, 1e9) ? row.temperature : null,
          source: sourceName(row.source) };
      } else if (kind === 'mag' && valid(row.bz, -1000, 1000) && valid(row.bt, 0, 1000) && Math.abs(row.bz) <= row.bt + 0.02) {
        reading = { time: row.time, bz: row.bz, bt: row.bt, source: sourceName(row.source) };
      }
      if (!reading) discarded++;
      unique.set(row.time, { time: row.time, reading }); // Last input occurrence wins; never average duplicates.
    }
    return { rows: [...unique.values()].sort((a, b) => a.time - b.time).slice(-MAX_HISTORY), invalidInput: false, discarded };
  }

  /**
   * Analyze the latest contiguous minute-sampled wind-speed window.
   * Input time is Unix milliseconds; speed/DC/AC/residual/amplitude are km/s.
   * `ready` describes sample coverage only. The caller labels source age and
   * fetch errors separately; a historical spectrum is not made current here.
   */
  function analyze(windRows, magRows = []) {
    const wind = ordered(windRows, 'wind'), mag = ordered(magRows, 'mag');
    const latest = wind.rows.at(-1);
    const result = {
      ready: false, reason: '', reasonCode: '',
      sampleCount: 0, contiguousCount: 0, sampleRateHz: SAMPLE_RATE_HZ,
      windowStart: null, windowEnd: null, windowDurationSeconds: null, resolutionHz: null,
      dc: null, acRms: null, peakToPeak: null, residual: null,
      dominantHz: null, dominantMilliHz: null, spectrum: [], samples: [],
      latestWind: latest?.reading || null,
      latestMag: mag.rows.at(-1)?.reading || null,
      discardedWindRows: wind.discarded, discardedMagRows: mag.discarded,
      units: { speed: 'km/s', amplitude: 'km/s', frequency: 'Hz', displayFrequency: 'mHz', time: 'Unix ms' }
    };
    const waiting = (code, reason) => Object.assign(result, { reasonCode: code, reason });
    if (wind.invalidInput) return waiting('invalid-input', 'Waiting for a valid NOAA wind-history array.');
    if (!latest) return waiting('no-data', 'Waiting for NOAA wind-speed observations.');
    if (!latest.reading) return waiting('invalid-latest', 'The latest wind-speed reading is invalid; no earlier window was substituted.');

    const contiguous = [latest.reading];
    let barrier = null;
    for (let i = wind.rows.length - 2; i >= 0; i--) {
      const row = wind.rows[i], next = wind.rows[i + 1];
      if (!row.reading) { barrier = 'invalid'; break; }
      if (next.time - row.time !== INTERVAL_MS) { barrier = 'gap'; break; }
      contiguous.unshift(row.reading);
    }
    result.contiguousCount = contiguous.length;
    let count = contiguous.length;
    if (count >= MIN_SAMPLES) count = Math.min(MAX_SAMPLES, 2 ** Math.floor(Math.log2(count)));
    const selected = contiguous.slice(-count);
    result.samples = selected.map(row => ({ time: row.time, speed: row.speed }));
    result.sampleCount = count;
    result.windowStart = selected[0].time;
    result.windowEnd = selected.at(-1).time;
    if (count < MIN_SAMPLES) {
      const prefix = barrier === 'gap' ? 'A timestamp gap interrupts the latest minute-sampled history.'
        : barrier === 'invalid' ? 'An invalid speed interrupts the latest minute-sampled history.'
          : 'The latest minute-sampled history is too short.';
      return waiting(barrier ? 'interrupted-history' : 'insufficient-history', `${prefix} ${count}/${MIN_SAMPLES} contiguous samples available; FFT waiting.`);
    }

    const speeds = selected.map(row => row.speed);
    // Subtract a real sample before summing. A repeated fractional value then
    // stays exactly constant instead of gaining roundoff AC from a large sum.
    const anchor = speeds[0];
    const dc = anchor + speeds.reduce((sum, value) => sum + (value - anchor), 0) / count;
    const acRms = Math.sqrt(speeds.reduce((sum, value) => sum + (value - dc) ** 2, 0) / count);
    // Passing the residuals also keeps Core's own mean removal numerically small.
    const spectrum = Core.spectrum(speeds.map(value => value - dc), SAMPLE_RATE_HZ)
      .map(bin => ({ ...bin, milliHz: bin.hz * 1000 }));
    let dominantHz = 0;
    if (acRms > 0) {
      let peakAmplitude = 0;
      for (const bin of spectrum.slice(1)) {
        if (bin.amplitude > peakAmplitude) { peakAmplitude = bin.amplitude; dominantHz = bin.hz; }
      }
    }
    return Object.assign(result, {
      ready: true, reasonCode: 'ready', reason: '', dc, acRms,
      peakToPeak: Math.max(...speeds) - Math.min(...speeds), residual: speeds.at(-1) - dc,
      dominantHz, dominantMilliHz: dominantHz * 1000, spectrum,
      windowDurationSeconds: count / SAMPLE_RATE_HZ, resolutionHz: SAMPLE_RATE_HZ / count
    });
  }

  return { analyze, INTERVAL_MS, SAMPLE_RATE_HZ, MIN_SAMPLES, MAX_SAMPLES };
});
