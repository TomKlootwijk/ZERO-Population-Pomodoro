/* ZERO · Population instrumentation and explicitly simulated signals. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.ZeroInstruments = factory(root.ZeroCore);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core) {
  'use strict';
  if (!Core) throw new Error('Load ZeroCore before ZeroInstruments.');
  const SPEED_OF_LIGHT = 299792458;
  const TAU = 2 * Math.PI;
  const RADAR_DEFAULTS = Object.freeze({ rangeM: 42, velocityMps: 1.5, carrierHz: 77e9,
    bandwidthHz: 150e6, chirpSeconds: 0.001, count: 512, sampleRate: 512000, startTime: 0 });
  // Recursive Bayer rank construction: B(2n) = [4B, 4B+2; 4B+3, 4B+1].
  const BAYER8 = (function () {
    let matrix = [[0]];
    const offset = [[0, 2], [3, 1]];
    for (let size = 1; size < 8; size *= 2) {
      const previous = matrix;
      matrix = Array.from({ length: size * 2 }, (_, y) =>
        Array.from({ length: size * 2 }, (_, x) => 4 * previous[y % size][x % size]
          + offset[Math.floor(y / size)][Math.floor(x / size)]));
    }
    return Object.freeze(matrix.map(row => Object.freeze(row)));
  })();

  function finite(value, name, min = -Number.MAX_VALUE, max = Number.MAX_VALUE) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
      throw new RangeError(`${name} must be a finite number between ${min} and ${max}.`);
    return value;
  }

  // A distance along a count axis, in people. It is not a distance in metres.
  function signedDistance(coordinate, population) {
    return finite(coordinate, 'Coordinate') - finite(population, 'Population', 0);
  }

  // Operator I v1.1, page 9, Eq. 7.2: active R4 arm, Vo = VL - VR.
  // Here strain is relative population change, not a material measurement.
  function quarterBridge(strain, { gaugeFactor = 2, excitationV = 5 } = {}) {
    finite(strain, 'Dimensionless strain');
    finite(gaugeFactor, 'Gauge factor', Number.MIN_VALUE, 1e6);
    finite(excitationV, 'Excitation voltage', Number.MIN_VALUE, 1e6);
    const x = finite(gaugeFactor * strain, 'Relative resistance change');
    if (x <= -1) throw new RangeError('The quarter-bridge active resistance requires x > -1.');
    // Algebraically identical form avoids overflowing 2*x for extreme inputs.
    const ratio = x === 0 ? 0 : -0.5 * (x / (2 + x));
    const outputV = excitationV * ratio;
    return { strain, gaugeFactor, excitationV, x, ratio, outputV,
      outputMv: outputV * 1000, outputUv: outputV * 1e6 };
  }

  function bayerThreshold(x, y) {
    const column = ((Math.floor(finite(x, 'Bayer x coordinate')) % 8) + 8) % 8;
    const row = ((Math.floor(finite(y, 'Bayer y coordinate')) % 8) + 8) % 8;
    return (BAYER8[row][column] + 0.5) / 64;
  }

  // aTOMos v3.6.1.5 UGTS, page 16, Eq. 31. Units must match all three inputs.
  function phaseClock(time, referenceTime, period) {
    finite(time, 'Absolute time'); finite(referenceTime, 'Phase reference time');
    finite(period, 'Phase period', Number.MIN_VALUE);
    const elapsed = finite(time - referenceTime, 'Elapsed time');
    const cycles = finite(elapsed / period, 'Phase cycle count',
      -Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER - 1);
    const winding = Math.floor(cycles);
    const phase = cycles - winding;
    return { time, referenceTime, period, elapsed, cycles, winding, phase };
  }

  function populationMetrics(model, now, referencePopulation, referenceTime = now) {
    finite(referenceTime, 'Reference time', 0, Date.UTC(2300, 0, 1));
    const current = Core.populationAt(model, now);
    if (referencePopulation === undefined) referencePopulation = Core.populationAt(model, referenceTime).value;
    finite(referencePopulation, 'Reference population', 1);
    const delta = signedDistance(current.value, referencePopulation);
    const utcDayStart = Math.floor(now / Core.DAY) * Core.DAY;
    const nextMillion = (Math.floor(current.value / 1e6) + 1) * 1e6;
    return {
      population: current.value, rate: current.rate, delta,
      strainPPM: delta / referencePopulation * 1e6,
      netToday: current.value - Core.populationAt(model, utcDayStart).value,
      utcDayStart, netTodayTimezone: 'UTC', nextMillion,
      // A local-rate projection, not a promise or a demographic forecast.
      targetEtaSeconds: current.rate > 0 ? (nextMillion - current.value) / current.rate : null,
      referencePopulation, referenceTime, elapsedSeconds: (now - referenceTime) / 1000,
      ratePerMinute: current.rate * 60, ratePerDay: current.rate * 86400,
      extrapolated: current.extrapolated
    };
  }

  function signalStats(samples, sampleRate = Core.SAMPLE_RATE) {
    finite(sampleRate, 'Sample rate', Number.MIN_VALUE, 1e12);
    const n = samples && samples.length;
    if (!Number.isInteger(n) || n < 4 || n > 1048576 || (n & (n - 1)))
      throw new RangeError('Signal length must be a power of two from 4 to 1048576.');
    let sum = 0, minimum = Infinity, maximum = -Infinity;
    for (const x of samples) {
      finite(x, 'Sample', -1e100, 1e100);
      sum += x; minimum = Math.min(minimum, x); maximum = Math.max(maximum, x);
    }
    // Preserve exact constants such as 0.1 despite repeated-addition rounding.
    const flat = minimum === maximum;
    const dc = flat ? minimum : sum / n;
    let acSquare = 0, totalSquare = 0, acPeak = 0;
    for (const x of samples) {
      const ac = x - dc;
      acSquare += ac * ac; totalSquare += x * x;
      acPeak = Math.max(acPeak, Math.abs(ac));
    }
    const acRms = Math.sqrt(acSquare / n), totalRms = Math.sqrt(totalSquare / n);
    const spectrum = flat ? Array.from({ length: n / 2 + 1 }, (_, k) =>
      ({ hz: k * sampleRate / n, amplitude: 0 })) : Core.spectrum(samples, sampleRate);
    let dominant = { hz: 0, amplitude: 0 };
    // DC was removed before the Hann-windowed FFT. Exclude bin zero as well.
    if (acRms > 0) for (let k = 1; k < spectrum.length; k++)
      if (spectrum[k].amplitude > dominant.amplitude) dominant = spectrum[k];
    return { dc, acRms, totalRms, peakPeak: maximum - minimum,
      crestFactor: acRms > 0 ? acPeak / acRms : 0,
      dominantHz: dominant.hz, dominantAmplitude: dominant.amplitude,
      spectrum, sampleRate, resolutionHz: sampleRate / n, sampleCount: n };
  }

  // One ideal target, an up-chirp and the narrowband/constant-delay Doppler
  // approximation. Positive velocity approaches the virtual radar. No sensors.
  function virtualRadar(options = {}) {
    const p = { ...RADAR_DEFAULTS, ...options };
    finite(p.rangeM, 'Range', 0, 1e6);
    finite(p.velocityMps, 'Radial velocity', -1e5, 1e5);
    finite(p.carrierHz, 'Carrier frequency', 1, 1e12);
    finite(p.bandwidthHz, 'Sweep bandwidth', 1, 1e12);
    finite(p.chirpSeconds, 'Chirp duration', 1e-9, 100);
    finite(p.sampleRate, 'Sample rate', 1, 1e12);
    finite(p.startTime, 'Animation phase time', -1e12, 1e12);
    if (!Number.isInteger(p.count) || p.count < 4 || p.count > 65536)
      throw new RangeError('Radar sample count must be an integer from 4 to 65536.');
    const slopeHzPerSecond = p.bandwidthHz / p.chirpSeconds;
    const delaySeconds = 2 * p.rangeM / SPEED_OF_LIGHT;
    const wavelengthM = SPEED_OF_LIGHT / p.carrierHz;
    const dopplerHz = 2 * p.velocityMps / wavelengthM;
    const rangeBeatHz = slopeHzPerSecond * delaySeconds;
    // Tx * conjugate(Rx), with Rx Doppler increased for an approaching target.
    const beatHz = rangeBeatHz - dopplerHz;
    const rangeResolutionM = SPEED_OF_LIGHT / (2 * p.bandwidthHz);
    const observationSeconds = p.count / p.sampleRate;
    const validChirp = delaySeconds + (p.count - 1) / p.sampleRate < p.chirpSeconds;
    const time = new Float64Array(p.count), tx = new Float64Array(p.count), rx = new Float64Array(p.count);
    const txFrequencyHz = new Float64Array(p.count), rxFrequencyHz = new Float64Array(p.count);
    const ifSignal = new Float64Array(p.count), ifQuadrature = new Float64Array(p.count);
    // Removing whole phase cycles preserves numerical precision during animation.
    const initialCycles = (p.carrierHz * delaySeconds - slopeHzPerSecond * delaySeconds ** 2 / 2
      + beatHz * p.startTime) % 1;
    for (let i = 0; i < p.count; i++) {
      const t = delaySeconds + i / p.sampleRate;
      time[i] = t;
      const txOffset = slopeHzPerSecond * t;
      const rxOffset = slopeHzPerSecond * (t - delaySeconds) + dopplerHz;
      // These are normalized frequency ramps, NOT aliased 77 GHz waveforms.
      tx[i] = txOffset / p.bandwidthHz; rx[i] = rxOffset / p.bandwidthHz;
      txFrequencyHz[i] = p.carrierHz + txOffset;
      rxFrequencyHz[i] = p.carrierHz + rxOffset;
      const phase = TAU * ((initialCycles + beatHz * t) % 1);
      ifSignal[i] = Math.cos(phase); ifQuadrature[i] = Math.sin(phase);
    }
    return { ...p, slopeHzPerSecond, delaySeconds, wavelengthM, dopplerHz, rangeBeatHz,
      beatHz, rangeResolutionM, observationSeconds, nyquistHz: p.sampleRate / 2,
      aliasRisk: Math.abs(beatHz) >= p.sampleRate / 2, validChirp,
      sampleKind: 'frequency-ramps-and-complex-baseband',
      time, chirpTime: time, tx, rx, txFrequencyHz, rxFrequencyHz, ifSignal, ifQuadrature };
  }

  return { SPEED_OF_LIGHT, RADAR_DEFAULTS, BAYER8, signedDistance, quarterBridge,
    bayerThreshold, phaseClock, populationMetrics, signalStats, virtualRadar };
});
