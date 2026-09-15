'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../web/instruments.js');
const near = (actual, expected, tolerance = 1e-8) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} (±${tolerance})`);
const t0 = Date.UTC(2026, 8, 15);
const model = { population: 8e9, rate: 2, epoch: t0, anchors: [] };

test('signed count distance retains side and exactly vanishes at population', () => {
  assert.equal(I.signedDistance(7999999990, 8e9), -10);
  assert.equal(I.signedDistance(8000000010, 8e9), 10);
  assert.equal(I.signedDistance(8e9, 8e9), 0);
});

test('a tare resets population strain without altering the population model', () => {
  const now = t0 + 10000;
  const before = I.populationMetrics(model, now, 8e9, t0);
  assert.equal(before.population, 8000000020);
  assert.equal(before.delta, 20);
  near(before.strainPPM, 0.0025);
  const tared = I.populationMetrics(model, now, before.population, now);
  assert.equal(tared.strainPPM, 0); assert.equal(tared.delta, 0);
  assert.equal(tared.population, before.population);
  assert.equal(model.population, 8e9);
});

test('daily net uses UTC midnight and the full piecewise population model', () => {
  const piecewise = { ...model, anchors: [
    { t: t0, p: 8e9 }, { t: t0 + 10000, p: 8000000010 }, { t: t0 + 20000, p: 8000000040 }
  ] };
  const result = I.populationMetrics(piecewise, t0 + 15000, 8e9, t0);
  assert.equal(result.utcDayStart, t0); assert.equal(result.netTodayTimezone, 'UTC');
  assert.equal(result.netToday, 25); assert.equal(result.rate, 3);
  assert.equal(result.extrapolated, false);
});

test('million ETA is a local-rate estimate and never predicts growth from flat or declining data', () => {
  const result = I.populationMetrics(model, t0 + 10000);
  assert.equal(result.nextMillion, 8001000000);
  assert.equal(result.targetEtaSeconds, 999980 / 2);
  for (const rate of [0, -2]) assert.equal(I.populationMetrics({ ...model, rate }, t0).targetEtaSeconds, null);
});

test('invalid reference populations cannot produce infinite strain', () => {
  for (const reference of [0, Number.MIN_VALUE, -1, NaN, Infinity])
    assert.throws(() => I.populationMetrics(model, t0, reference), RangeError);
});

test('multimeter separates DC and AC RMS and finds a coherent sine frequency', () => {
  const samples = Float64Array.from({ length: 512 }, (_, n) => 5 + 3 * Math.sin(2 * Math.PI * 8 * n / 128));
  const result = I.signalStats(samples, 128);
  near(result.dc, 5); near(result.acRms, 3 / Math.sqrt(2));
  near(result.totalRms, Math.sqrt(25 + 4.5)); near(result.peakPeak, 6);
  near(result.crestFactor, Math.sqrt(2)); assert.equal(result.dominantHz, 8);
  near(result.dominantAmplitude, 3, 0.0001); assert.equal(result.resolutionHz, 0.25);
});

test('a constant signal has DC only with no invented spectral peak', () => {
  for (const dc of [-12, 0, 0.1]) {
    const result = I.signalStats(new Float64Array(512).fill(dc), 128);
    assert.equal(result.dc, dc); near(result.totalRms, Math.abs(dc));
    assert.equal(result.acRms, 0); assert.equal(result.peakPeak, 0);
    assert.equal(result.crestFactor, 0); assert.equal(result.dominantHz, 0);
    assert.ok(result.spectrum.every(bin => bin.amplitude === 0));
  }
});

test('multimeter rejects incomplete, non-finite and uncalibrated signal inputs', () => {
  for (const samples of [[], [1, 2], [1, 2, 3], [0, 1, NaN, 2]])
    assert.throws(() => I.signalStats(samples), RangeError);
  assert.throws(() => I.signalStats([0, 1, 0, -1], 0), RangeError);
});

test('virtual range maps to round-trip delay, slope beat and bandwidth resolution', () => {
  const radar = I.virtualRadar({ rangeM: 100, velocityMps: 0 });
  near(radar.delaySeconds, 200 / I.SPEED_OF_LIGHT, 1e-18);
  near(radar.slopeHzPerSecond, 150e9);
  near(radar.beatHz, radar.slopeHzPerSecond * 200 / I.SPEED_OF_LIGHT);
  near(radar.rangeResolutionM, I.SPEED_OF_LIGHT / 300e6);
  assert.equal(radar.aliasRisk, false); assert.equal(radar.validChirp, true);
});

test('Doppler changes sign with velocity and approaching targets lower the upchirp beat', () => {
  const approaching = I.virtualRadar({ velocityMps: 2 });
  const receding = I.virtualRadar({ velocityMps: -2 });
  near(approaching.dopplerHz, 4 * 77e9 / I.SPEED_OF_LIGHT);
  near(receding.dopplerHz, -approaching.dopplerHz);
  near(approaching.beatHz, approaching.rangeBeatHz - approaching.dopplerHz);
  near(receding.beatHz, receding.rangeBeatHz + approaching.dopplerHz);
});

test('normalized frequency ramps match the displayed signed IF frequency', () => {
  const radar = I.virtualRadar();
  for (const n of [0, 255, 511]) {
    near((radar.tx[n] - radar.rx[n]) * radar.bandwidthHz, radar.beatHz, 1e-7);
    near(radar.txFrequencyHz[n] - radar.rxFrequencyHz[n], radar.beatHz, 0.0001);
    near(radar.ifSignal[n] ** 2 + radar.ifQuadrature[n] ** 2, 1);
  }
  assert.ok(radar.time[0] >= radar.delaySeconds);
  assert.ok(radar.time.at(-1) < radar.chirpSeconds);
});

test('complex baseband phase preserves negative frequency without claiming an RF sample', () => {
  const radar = I.virtualRadar({ rangeM: 0, velocityMps: 2, startTime: 3 });
  assert.ok(radar.beatHz < 0);
  const dot = radar.ifSignal[0] * radar.ifSignal[1] + radar.ifQuadrature[0] * radar.ifQuadrature[1];
  const cross = radar.ifSignal[0] * radar.ifQuadrature[1] - radar.ifQuadrature[0] * radar.ifSignal[1];
  near(Math.atan2(cross, dot) / (2 * Math.PI) * radar.sampleRate, radar.beatHz, 1e-6);
  assert.equal(radar.sampleKind, 'frequency-ramps-and-complex-baseband');
});

test('radar flags aliasing and an observation outside the chirp overlap', () => {
  const radar = I.virtualRadar({ rangeM: 100, sampleRate: 128000 });
  assert.equal(radar.aliasRisk, true); assert.equal(radar.validChirp, false);
  assert.ok(radar.ifSignal.every(Number.isFinite));
});

test('a stationary zero-range target gives a constant unit baseband signal', () => {
  const radar = I.virtualRadar({ rangeM: 0, velocityMps: 0 });
  assert.equal(radar.beatHz, 0);
  assert.ok(radar.ifSignal.every(value => value === 1));
  assert.ok(radar.ifQuadrature.every(value => value === 0));
});

test('invalid radar parameters fail before allocating traces', () => {
  for (const options of [{ rangeM: -1 }, { bandwidthHz: 0 }, { chirpSeconds: 0 },
    { velocityMps: NaN }, { count: 3 }, { count: 1e9 }, { sampleRate: 0 }])
    assert.throws(() => I.virtualRadar(options), RangeError);
});

test('quarter bridge reproduces both voltage dividers and exact inverse over its physical domain', () => {
  for (const x of [-0.999, -0.5, -0.01, 0, 0.01, 1, 10]) {
    const bridge = I.quarterBridge(x / 2);
    const dividerDifference = 1 / 2 - (1 + x) / (2 + x);
    near(bridge.ratio, dividerDifference);
    near(-4 * bridge.ratio / (1 + 2 * bridge.ratio), x);
    near(bridge.outputV, 5 * bridge.ratio);
    near(bridge.outputMv, 1000 * bridge.outputV);
    near(bridge.outputUv, 1e6 * bridge.outputV);
  }
});

test('bridge polarity follows active R4 and a tare gives zero output', () => {
  assert.equal(I.quarterBridge(0).outputV, 0);
  const growth = I.quarterBridge(1e-6, { gaugeFactor: 2, excitationV: 5 });
  assert.ok(growth.outputV < 0);
  near(growth.outputUv, -2.4999975000025, 1e-10);
  assert.ok(I.quarterBridge(-1e-6).outputV > 0);
});

test('quarter bridge refuses nonpositive resistance and invalid calibration', () => {
  for (const strain of [-0.5, -1, NaN, Infinity]) assert.throws(() => I.quarterBridge(strain), RangeError);
  assert.throws(() => I.quarterBridge(0.001, { gaugeFactor: 0 }), RangeError);
  assert.throws(() => I.quarterBridge(0.001, { excitationV: 0 }), RangeError);
});

test('Bayer matrix contains each rank once and has the standard recursive orientation', () => {
  assert.equal(I.BAYER8.length, 8);
  assert.ok(I.BAYER8.every(row => row.length === 8));
  assert.deepEqual(I.BAYER8.flat().toSorted((a, b) => a - b), Array.from({ length: 64 }, (_, i) => i));
  assert.deepEqual(I.BAYER8[0], [0, 32, 8, 40, 2, 34, 10, 42]);
  assert.deepEqual(I.BAYER8[1], [48, 16, 56, 24, 50, 18, 58, 26]);
});

test('ordered thresholds give exact monotonic fill without vanishing or stuck pixels', () => {
  let previous = new Set();
  for (let filled = 0; filled <= 64; filled++) {
    const current = new Set();
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++)
      if (I.bayerThreshold(x, y) < filled / 64) current.add(y * 8 + x);
    assert.equal(current.size, filled);
    assert.ok([...previous].every(pixel => current.has(pixel)));
    previous = current;
  }
});

test('Bayer tiling wraps negative and fractional coordinates consistently', () => {
  near(I.bayerThreshold(-1, -1), I.bayerThreshold(7, 7));
  near(I.bayerThreshold(8.9, 16.5), I.bayerThreshold(0, 0));
  near(I.bayerThreshold(-0.1, 0), I.bayerThreshold(7, 0));
  assert.throws(() => I.bayerThreshold(NaN, 1), RangeError);
});

test('UGTS phase clock reproduces the cited reference example while retaining absolute time', () => {
  const clock = I.phaseClock(1920, 1135, 256);
  assert.equal(clock.time, 1920); assert.equal(clock.referenceTime, 1135);
  assert.equal(clock.winding, 3); assert.equal(clock.phase, 0.06640625);
  assert.equal(clock.referenceTime + (clock.winding + clock.phase) * clock.period, clock.time);
});

test('negative phase time uses floor winding and repeated phases retain distinct history', () => {
  const before = I.phaseClock(900, 1000, 400);
  assert.equal(before.winding, -1); assert.equal(before.phase, 0.75);
  const after = I.phaseClock(1300, 1000, 400);
  assert.equal(after.winding, 0); assert.equal(after.phase, before.phase);
  assert.equal(I.phaseClock(600, 1000, 400).phase, 0);
  assert.equal(I.phaseClock(600, 1000, 400).winding, -1);
});

test('phase clock rejects invalid periods or cycle counts that cannot retain integer winding', () => {
  for (const period of [0, -1, NaN, Infinity, Number.MIN_VALUE])
    assert.throws(() => I.phaseClock(1000, 0, period), RangeError);
});
