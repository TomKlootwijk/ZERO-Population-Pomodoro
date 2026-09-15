'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const T = require('../web/telemetry.js');
const now = Date.UTC(2026, 8, 15, 12);
const wind = (minute, patch = {}) => ({ time_tag: `2026-09-15T11:${minute}:00`, active: true, source: 'SOLAR1', overall_quality: 0, proton_speed: 400, proton_density: 5, proton_temperature: 100000, ...patch });
test('NOAA parser selects active quality-zero records and sorts newest-first input', () => {
  const series = T.parseRows([wind('59'), wind('58'), wind('57', {active:false}), wind('56', {overall_quality:1})], 'wind', now);
  assert.equal(series.length, 2); assert.equal(series[0].time, now - 120000); assert.equal(series[1].time, now - 60000);
});
test('NOAA null/sentinel and future values are not converted to zero measurements', () => {
  assert.throws(() => T.parseRows([wind('59', {proton_speed:null}),wind('59', {proton_density:-9999}),wind('59', {time_tag:'2026-10-15T12:00:00'})], 'wind', now));
});
test('magnetic Bz remains signed and records stay separate from plasma', () => {
  const rows = T.parseRows([{time_tag:'2026-09-15T11:59:00',active:true,source:'SOLAR1',overall_quality:0,bz_gsm:-5,bt:7}], 'mag', now);
  assert.equal(rows[0].bz,-5); assert.equal(rows[0].speed,undefined);
});
test('stale observations cannot pass the two-channel freshness/timing gate', () => {
  const w=[{time:now-60000}], m=[{time:now-1800000}];
  assert.equal(T.evidence(w,m,now).ready,false);
  assert.equal(T.evidence(w,[{time:now-90000}],now).ready,true);
  assert.equal(T.channelState([],now).label,'Unavailable');
});
test('proton dynamic pressure uses density and speed squared with nPa units', () => {
  assert.ok(Math.abs(T.solarPressure(400,5)-1.33809754)<1e-7);
  assert.equal(T.solarPressure(null,5),null);
});

const cachedWind = (patch = {}) => ({ time: now - 60000, source: 'SOLAR1', speed: 400, density: 5, temperature: 100000, ...patch });
const cachedMag = (patch = {}) => ({ time: now - 60000, source: 'SOLAR1', bz: -5, bt: 7, ...patch });

test('saved snapshot validation returns only copied, normalized fields and sanitized labels', () => {
  const row = cachedWind({ source: '<SOLAR1>\n<script>\u0000', unrelated: 'discard' });
  const saved = { wind: [row], mag: [cachedMag()], fetchedAt: now, errors: ['\nNo magnetic\u0000 update!'], unrelated: 'discard' };
  const validated = T.validateSnapshot(saved, now);
  assert.deepEqual(Object.keys(validated).sort(), ['errors', 'fetchedAt', 'mag', 'wind']);
  assert.deepEqual(Object.keys(validated.wind[0]).sort(), ['density', 'source', 'speed', 'temperature', 'time']);
  assert.equal(validated.wind[0].source, 'SOLAR1 script');
  assert.equal(validated.fetchedAt, now); assert.deepEqual(validated.errors, ['No magnetic update!']);
  assert.notEqual(validated.wind[0], row);
});

test('corrupt saved channels cannot crash consumers and preserve a valid other channel', () => {
  for (const wind of [null, 'corrupt', { at: 'bad' }, [null, 'bad', {}, []], new Array(30001)]) {
    const saved = T.validateSnapshot({ wind, mag: [cachedMag()], errors: {} }, now);
    assert.deepEqual(saved.wind, []); assert.equal(saved.mag.length, 1); assert.deepEqual(saved.errors, []);
  }
  const windOnly = T.validateSnapshot({ wind: [cachedWind()] }, now);
  assert.equal(windOnly.wind.length, 1); assert.deepEqual(windOnly.mag, []);
});

test('saved readings reject null, strings, sentinels and non-finite quantities without zero filling', () => {
  const invalidWind = [cachedWind({speed:null}), cachedWind({speed:'400'}), cachedWind({density:-9999}),
    cachedWind({temperature:Infinity}), cachedWind({speed:NaN}), cachedWind({speed:5001})];
  const invalidMag = [cachedMag({bz:-9999}), cachedMag({bz:-9999.99}), cachedMag({bt:-9999}),
    cachedMag({bz:'-5'}), cachedMag({bt:Infinity}), cachedMag({bz:-8,bt:7})];
  assert.throws(() => T.validateSnapshot({wind:invalidWind,mag:invalidMag},now));
  const partial = T.validateSnapshot({wind:[...invalidWind,cachedWind()],mag:invalidMag},now);
  assert.equal(partial.wind.length,1); assert.equal(partial.wind[0].speed,400); assert.deepEqual(partial.mag,[]);
});

test('saved observation timestamps retain only the seven-day and two-minute acceptance window', () => {
  const rows = [cachedWind({time:now-7*86400000}),cachedWind({time:now+120000}),
    cachedWind({time:now-7*86400000-1}),cachedWind({time:now+120001}),cachedWind({time:NaN}),
    cachedWind({time:'2026-09-15T11:59:00Z'})];
  const saved = T.validateSnapshot({wind:rows,mag:[],fetchedAt:'yesterday'},now);
  assert.deepEqual(saved.wind.map(row=>row.time),[now-7*86400000,now+120000]);
  assert.equal(saved.fetchedAt,undefined);
});

test('saved history is deduplicated, sorted and capped at the newest 120 observations', () => {
  const rows = Array.from({length:200},(_,i)=>cachedWind({time:now-i*60000})).reverse();
  const result = T.validateSnapshot({wind:[...rows,rows[100]],mag:[]},now);
  assert.equal(result.wind.length,120);
  assert.equal(result.wind[0].time,now-119*60000); assert.equal(result.wind.at(-1).time,now);
  assert.ok(result.wind.every((row,i)=>i===0||row.time>result.wind[i-1].time));
});

test('cache rejects invalid top-level values and snapshots with no usable observations', () => {
  for (const value of [null,false,'{}',[],{}, {wind:[],mag:[]}, {wind:[cachedWind({time:0})]}])
    assert.throws(()=>T.validateSnapshot(value,now));
  assert.throws(()=>T.validateSnapshot({wind:[cachedWind()]},NaN));
});

test('freshness gate refuses corrupt rows and excessive future observations', () => {
  for (const rows of [{},'bad',[{}],[{time:NaN}],[{time:now+120001}]]) {
    assert.equal(T.channelState(rows,now).fresh,false);
    assert.equal(T.evidence(rows,[{time:now}],now).ready,false);
  }
});

test('live magnetic feed receives the same sentinel and magnitude checks as saved snapshots', () => {
  const row = {time_tag:'2026-09-15T11:59:00',active:true,source:'SOLAR1',overall_quality:0,bz_gsm:-9999,bt:7};
  assert.throws(()=>T.parseRows([row],'mag',now));
  assert.throws(()=>T.parseRows([{...row,bz_gsm:-8}],'mag',now));
  assert.equal(T.parseRows([{...row,bz_gsm:-7.01}],'mag',now)[0].bz,-7.01);
});
