/* ZERO · Pure model/math code. No network, DOM, or third-party dependencies. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ZeroCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DAY = 86400000;
  const SAMPLE_RATE = 128;
  const FFT_SIZE = 512;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  function finite(value, name, min, max) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
      throw new Error(`${name} must be between ${min} and ${max}.`);
    return value;
  }
  function parseFeed(raw, fetchedAt = Date.now()) {
    if (!raw || typeof raw !== 'object' || !raw.world) throw new Error('Not a Census world-population feed.');
    const w = raw.world;
    const population = finite(w.population, 'World population', 1e8, 2e10);
    const rate = finite(w.population_rate, 'Population rate', -100, 100);
    if (w.rate_interval !== 'second') throw new Error('Unsupported population-rate interval.');
    const epoch = Number(w.last_updated) * 1000;
    finite(epoch, 'Reference time', Date.UTC(2000, 0, 1), Date.UTC(2200, 0, 1));
    const anchors = [];
    if (w.monthly_estimates && typeof w.monthly_estimates === 'object') {
      for (const [key, value] of Object.entries(w.monthly_estimates)) {
        const t = Number(key) * 1000;
        if (Number.isFinite(t) && t >= Date.UTC(2000, 0, 1) && t <= Date.UTC(2200, 0, 1)
            && value && typeof value.population === 'number' && Number.isFinite(value.population)
            && value.population > 1e8 && value.population < 2e10) {
          anchors.push({ t, p: value.population });
        }
      }
    }
    anchors.sort((a, b) => a.t - b.t);
    return { population, rate, epoch, anchors, fetchedAt, provider: 'U.S. Census Bureau' };
  }
  // Interpolate official monthly model anchors. Outside their range, visibly flag
  // linear extrapolation; do not pretend the clock is a measured head count.
  function populationAt(model, time) {
    finite(time, 'Time', 0, Date.UTC(2300, 0, 1));
    const a = model.anchors;
    if (a.length >= 2 && time >= a[0].t && time <= a[a.length - 1].t) {
      let lo = 0, hi = a.length - 1;
      while (lo + 1 < hi) {
        const mid = (lo + hi) >> 1;
        if (a[mid].t <= time) lo = mid; else hi = mid;
      }
      const left = a[lo], right = a[hi];
      const rate = (right.p - left.p) / ((right.t - left.t) / 1000);
      return { value: left.p + rate * (time - left.t) / 1000, rate, extrapolated: false };
    }
    const base = a.length ? (time < a[0].t ? a[0] : a[a.length - 1]) : { t: model.epoch, p: model.population };
    return { value: Math.max(0, base.p + model.rate * (time - base.t) / 1000), rate: model.rate, extrapolated: true };
  }
  // Exact integral of the piecewise-linear population model, in person-seconds.
  function integratePopulation(model, from, to) {
    if (to <= from) return 0;
    const times = [from, ...model.anchors.filter(a => a.t > from && a.t < to).map(a => a.t), to];
    let sum = 0;
    for (let i = 1; i < times.length; i++) {
      sum += (populationAt(model, times[i - 1]).value + populationAt(model, times[i]).value)
        * 0.5 * (times[i] - times[i - 1]) / 1000;
    }
    return sum;
  }
  function electrical(population, wattsPerPerson, voltage) {
    finite(population, 'Population', 0, 2e10);
    finite(wattsPerPerson, 'Watts per person', 0, 100000);
    finite(voltage, 'Equivalent voltage', 0.1, 1e6);
    const watts = population * wattsPerPerson;
    return { watts, amperes: watts / voltage };
  }
  function sdf(n, population) { return n - population; }

  // In-place radix-2 Cooley–Tukey FFT; inverse includes 1/N normalization.
  function fft(real, imag, inverse = false) {
    const n = real.length;
    if (n < 2 || (n & (n - 1)) || imag.length !== n) throw new Error('FFT size must be a power of two.');
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        [real[i], real[j]] = [real[j], real[i]];
        [imag[i], imag[j]] = [imag[j], imag[i]];
      }
    }
    for (let length = 2; length <= n; length <<= 1) {
      const angle = (inverse ? 2 : -2) * Math.PI / length;
      const wr = Math.cos(angle), wi = Math.sin(angle);
      for (let i = 0; i < n; i += length) {
        let ur = 1, ui = 0;
        for (let j = 0; j < length / 2; j++) {
          const a = i + j, b = a + length / 2;
          const vr = real[b] * ur - imag[b] * ui;
          const vi = real[b] * ui + imag[b] * ur;
          real[b] = real[a] - vr; imag[b] = imag[a] - vi;
          real[a] += vr; imag[a] += vi;
          const next = ur * wr - ui * wi;
          ui = ur * wi + ui * wr; ur = next;
        }
      }
    }
    if (inverse) for (let i = 0; i < n; i++) { real[i] /= n; imag[i] /= n; }
    return { real, imag };
  }
  function rng(seed) {
    return () => {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  // Frequency-domain design -> inverse FFT -> EEG-like (not EEG) synthetic trace.
  // The DC coefficient is exactly zero. The count itself is NEVER perturbed.
  class FourierTrace {
    constructor(rate = 2, gain = 24) {
      this.size = 2048; this.sampleRate = SAMPLE_RATE;
      this.setModel(rate, gain);
    }
    setModel(rate, gain) {
      this.rate = rate; this.gain = gain;
      const n = this.size, real = new Float64Array(n), imag = new Float64Array(n);
      const random = rng(0x5DF00001);
      const growthScale = clamp(Math.abs(rate) / 2, 0.15, 2.5);
      const bands = [[1.7, 0.7, 0.30], [5.2, 1.2, 0.20], [10.0, 1.4, 0.68],
        [20, 3.6, 0.25], [35, 4.0, 0.13]];
      for (let k = 1; k < n / 2; k++) {
        const hz = k * SAMPLE_RATE / n;
        if (hz < 0.5 || hz > 45) continue;
        let a = 0;
        for (const [center, width, weight] of bands) a += weight * Math.exp(-0.5 * ((hz - center) / width) ** 2);
        a *= (0.6 + random() * 0.8);
        const phase = random() * 2 * Math.PI;
        real[k] = a * Math.cos(phase); imag[k] = a * Math.sin(phase);
        real[n - k] = real[k]; imag[n - k] = -imag[k];
      }
      fft(real, imag, true);
      let peak = 0;
      for (const v of real) peak = Math.max(peak, Math.abs(v));
      this.excursion = gain * growthScale;
      this.samples = Float64Array.from(real, x => x / (peak || 1) * this.excursion);
    }
    atIndex(index) { return this.samples[((index % this.size) + this.size) % this.size]; }
    window(timeSeconds, count = FFT_SIZE) {
      const end = Math.floor(timeSeconds * SAMPLE_RATE);
      return Float64Array.from({ length: count }, (_, i) => this.atIndex(end - count + 1 + i));
    }
  }
  function spectrum(samples, sampleRate = SAMPLE_RATE) {
    const n = samples.length;
    const real = new Float64Array(n), imag = new Float64Array(n);
    const mean = samples.reduce((a, b) => a + b, 0) / n;
    let windowSum = 0;
    for (let i = 0; i < n; i++) {
      const hann = 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1)));
      real[i] = (samples[i] - mean) * hann; windowSum += hann;
    }
    fft(real, imag);
    return Array.from({ length: n / 2 + 1 }, (_, k) => ({
      hz: k * sampleRate / n,
      amplitude: Math.hypot(real[k], imag[k]) * (k === 0 || k === n / 2 ? 1 : 2) / windowSum
    }));
  }

  const DEFAULTS = Object.freeze({ focusMinutes: 25, shortMinutes: 5, longMinutes: 15,
    longEvery: 4, wattsPerPerson: 100, voltage: 230, gain: 24, sound: true, motion: true,
    compact: true, autoRefresh: true });
  function settingsFrom(raw = {}) {
    const s = { ...DEFAULTS };
    const limits = { focusMinutes: [1, 180], shortMinutes: [1, 60], longMinutes: [1, 120],
      longEvery: [1, 12], wattsPerPerson: [0, 100000], voltage: [0.1, 1000000], gain: [1, 200] };
    for (const [key, [lo, hi]] of Object.entries(limits)) {
      const value = Number(raw[key]);
      if (raw[key] !== undefined && Number.isFinite(value)) s[key] = clamp(value, lo, hi);
    }
    for (const key of ['focusMinutes', 'shortMinutes', 'longMinutes', 'longEvery']) s[key] = Math.round(s[key]);
    for (const key of ['sound', 'motion', 'compact', 'autoRefresh']) if (typeof raw[key] === 'boolean') s[key] = raw[key];
    return s;
  }
  // Wall-clock deadlines avoid setInterval drift and survive tab suspension.
  // A finished interval stops for acknowledgement; never invent missed cycles.
  class Pomodoro {
    constructor(settings = DEFAULTS, saved = null) {
      this.settings = settingsFrom(settings);
      this.mode = 'focus'; this.completed = 0; this.running = false;
      this.duration = this.durationFor(this.mode); this.remaining = this.duration;
      this.deadline = null; this.startedAt = null; this.lastEnergyAt = null;
      this.energyJoules = 0; this.activeMs = 0; this.finished = false;
      if (saved && ['focus', 'short', 'long'].includes(saved.mode)) {
        this.mode = saved.mode;
        this.completed = clamp(Math.floor(Number(saved.completed) || 0), 0, 1e6);
        this.duration = clamp(Number(saved.duration) || this.durationFor(this.mode), 60000, 10800000);
        this.remaining = clamp(Number(saved.remaining) || 0, 0, this.duration);
        this.startedAt = Number.isFinite(saved.startedAt) && saved.startedAt > 0 ? saved.startedAt : null;
        this.energyJoules = clamp(Number(saved.energyJoules) || 0, 0, 1e30);
        this.activeMs = clamp(Number(saved.activeMs) || 0, 0, this.duration);
        this.finished = saved.finished === true;
        const validTime = x => typeof x === 'number' && Number.isFinite(x) && x > Date.UTC(2000, 0, 1) && x < Date.UTC(2200, 0, 1);
        if (saved.running === true && validTime(saved.deadline) && validTime(saved.lastEnergyAt) && !this.finished) {
          this.running = true; this.deadline = saved.deadline; this.lastEnergyAt = saved.lastEnergyAt;
        }
      }
    }
    durationFor(mode) { return this.settings[`${mode}Minutes`] * 60000; }
    setSettings(settings) {
      this.settings = settingsFrom(settings);
      if (!this.running && this.startedAt === null && !this.finished) {
        this.duration = this.durationFor(this.mode); this.remaining = this.duration;
      }
    }
    start(now) {
      if (this.running || this.finished) return;
      if (this.startedAt === null) this.startedAt = now;
      this.running = true; this.deadline = now + this.remaining; this.lastEnergyAt = now;
    }
    tick(now, energyBetween = () => 0) {
      if (!this.running) return false;
      const end = Math.min(now, this.deadline);
      if (end > this.lastEnergyAt) {
        this.energyJoules += energyBetween(this.lastEnergyAt, end);
        this.activeMs += end - this.lastEnergyAt;
        this.lastEnergyAt = end;
      }
      this.remaining = clamp(this.deadline - now, 0, this.duration);
      if (now >= this.deadline) {
        this.running = false; this.finished = true;
        this.deadline = null; this.lastEnergyAt = null;
        if (this.mode === 'focus') this.completed++;
        return true;
      }
      return false;
    }
    pause(now, energyBetween) { this.tick(now, energyBetween); this.running = false; this.deadline = null; this.lastEnergyAt = null; }
    reset(mode = this.mode) {
      if (!['focus', 'short', 'long'].includes(mode)) throw new Error('Unknown timer mode.');
      this.mode = mode; this.running = false; this.finished = false;
      this.duration = this.durationFor(mode); this.remaining = this.duration;
      this.deadline = null; this.startedAt = null; this.lastEnergyAt = null;
      this.energyJoules = 0; this.activeMs = 0;
    }
    next() {
      const next = this.mode === 'focus' ?
        (this.finished && this.completed > 0 && this.completed % this.settings.longEvery === 0 ? 'long' : 'short') : 'focus';
      this.reset(next);
    }
    snapshot() {
      return { mode: this.mode, completed: this.completed, running: this.running,
        duration: this.duration, remaining: this.remaining, deadline: this.deadline,
        startedAt: this.startedAt, lastEnergyAt: this.lastEnergyAt, energyJoules: this.energyJoules,
        activeMs: this.activeMs, finished: this.finished };
    }
  }
  function formatSI(value, unit, digits = 2) {
    const prefixes = [[1e18, 'E'], [1e15, 'P'], [1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'k']];
    for (const [factor, prefix] of prefixes) if (Math.abs(value) >= factor) return `${(value / factor).toFixed(digits)} ${prefix}${unit}`;
    return `${value.toFixed(digits)} ${unit}`;
  }
  return { DAY, SAMPLE_RATE, FFT_SIZE, DEFAULTS, clamp, parseFeed, populationAt, integratePopulation,
    electrical, sdf, fft, FourierTrace, spectrum, settingsFrom, Pomodoro, formatSI };
});
