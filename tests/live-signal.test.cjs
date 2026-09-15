'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Live = require('../web/live-signal.js');
const start = Date.UTC(2026, 8, 15, 10);
const rows = (count, value = i => 400 + 20 * Math.sin(2 * Math.PI * 4 * i / 64)) =>
  Array.from({ length: count }, (_, i) => ({ time: start + i * 60000, speed: value(i), density: 5, temperature: 100000, source: 'NOAA' }));
const close = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);

test('one-minute coherent wind-speed sine keeps DC, AC, Fourier amplitude and frequency units', () => {
  const input = rows(64), result = Live.analyze(input);
  assert.equal(result.ready, true); assert.equal(result.sampleCount, 64);
  close(result.dc, 400); close(result.acRms, 20 / Math.sqrt(2)); close(result.peakToPeak, 40);
  close(result.residual, input.at(-1).speed - 400);
  close(result.dominantHz, 4 / (64 * 60)); close(result.dominantMilliHz, 1000 * 4 / (64 * 60));
  close(result.spectrum[4].amplitude, 20, 0.01);
  assert.equal(result.units.amplitude, 'km/s'); assert.equal(result.windowStart, start);
  assert.equal(result.windowEnd, start + 63 * 60000); assert.equal(result.windowDurationSeconds, 3840);
  close(result.resolutionHz, 1 / 3840);
});

test('largest power-of-two window ends at newest sample and never zero pads', () => {
  for (const [available, expected] of [[16, 16], [31, 16], [32, 32], [63, 32], [64, 64], [120, 64], [128, 64]]) {
    const input = rows(available), result = Live.analyze(input);
    assert.equal(result.sampleCount, expected); assert.equal(result.spectrum.length, expected / 2 + 1);
    assert.deepEqual(result.samples, input.slice(-expected).map(({ time, speed }) => ({ time, speed })));
  }
});

test('latest missing minute prevents substitution of an older complete transform window', () => {
  const input = rows(65).filter((_, i) => i !== 60), result = Live.analyze(input);
  assert.equal(result.ready, false); assert.equal(result.reasonCode, 'interrupted-history');
  assert.equal(result.contiguousCount, 4); assert.equal(result.sampleCount, 4);
  assert.deepEqual(result.spectrum, []); assert.equal(result.dc, null); assert.match(result.reason, /4\/16/);
});

test('a gap before a sufficiently long latest suffix allows only that suffix', () => {
  const input = rows(81).filter((_, i) => i !== 48), result = Live.analyze(input);
  assert.equal(result.ready, true); assert.equal(result.contiguousCount, 32); assert.equal(result.sampleCount, 32);
  assert.equal(result.windowStart, start + 49 * 60000);
});

test('irregular sample times are neither rounded nor interpolated', () => {
  const input = rows(64); input.at(-1).time += 1;
  const result = Live.analyze(input);
  assert.equal(result.ready, false); assert.equal(result.sampleCount, 1);
  assert.equal(result.windowEnd, start + 63 * 60000 + 1);
});

test('zero-valued observations are real samples and a constant trace has no dominant oscillation', () => {
  for (const value of [0, 400, 400.1, 0.001]) {
    const result = Live.analyze(rows(32, () => value));
    assert.equal(result.ready, true); assert.equal(result.dc, value); assert.equal(result.acRms, 0);
    assert.equal(result.residual, 0); assert.equal(result.dominantHz, 0);
    assert.ok(result.spectrum.every(bin => bin.amplitude === 0));
  }
});

test('Nyquist amplitude is not doubled and uses actual minute sampling', () => {
  const result = Live.analyze(rows(32, i => 400 + (i % 2 ? -12 : 12)));
  close(result.spectrum.at(-1).amplitude, 12); close(result.spectrum.at(-1).hz, 1 / 120);
});

test('empty and short histories return explicit waiting without fabricated metrics', () => {
  for (const count of [0, 1, 15]) {
    const result = Live.analyze(rows(count));
    assert.equal(result.ready, false); assert.equal(result.sampleCount, count); assert.ok(result.reason);
    assert.equal(result.acRms, null); assert.equal(result.residual, null); assert.equal(result.dominantHz, null);
    assert.deepEqual(result.spectrum, []);
  }
});

test('sorting and duplicate handling preserve the last input occurrence without averaging or mutation', () => {
  const input = rows(64).reverse(), duplicate = { ...input[0], speed: 425 };
  const snapshot = JSON.stringify(input), result = Live.analyze([...input, duplicate]);
  assert.equal(result.sampleCount, 64); assert.equal(result.latestWind.speed, 425);
  assert.equal(result.samples.at(-1).speed, 425); assert.equal(JSON.stringify(input), snapshot);
  assert.ok(result.samples.every((row, i) => !i || row.time > result.samples[i - 1].time));
});

test('invalid latest speed and invalid duplicate are barriers instead of silently using older observations', () => {
  for (const speed of [null, '400', NaN, Infinity, -9999, 5001]) {
    const input = rows(64), result = Live.analyze([...input, { ...input.at(-1), speed }]);
    assert.equal(result.ready, false); assert.equal(result.reasonCode, 'invalid-latest');
    assert.equal(result.latestWind, null); assert.deepEqual(result.spectrum, []);
  }
  const input = rows(64); input[60].speed = null;
  assert.equal(Live.analyze(input).contiguousCount, 3);
});

test('bad arrays and invalid timestamp rows never turn into zero measurements', () => {
  for (const value of [null, {}, 'bad', new Array(30001)]) {
    assert.equal(Live.analyze(value).reasonCode, 'invalid-input');
  }
  const result = Live.analyze([null, {}, { time: 'today', speed: 400 }, { time: NaN, speed: 400 }, ...rows(16)]);
  assert.equal(result.ready, true); assert.equal(result.discardedWindRows, 4); assert.equal(result.sampleCount, 16);
});

test('magnetic observations remain independent and cannot change the wind transform', () => {
  const wind = rows(64), mag = [{ time: start, bz: -4, bt: 5 }, { time: start + 60000, bz: 2, bt: 3 }];
  const baseline = Live.analyze(wind), result = Live.analyze(wind, mag.reverse());
  assert.deepEqual(result.spectrum, baseline.spectrum); assert.equal(result.latestMag.bz, 2);
  assert.equal(Live.analyze([], mag).latestMag.bz, 2);
  assert.equal(Live.analyze(wind, [{ time: start, bz: -9999, bt: 5 }]).latestMag, null);
});
