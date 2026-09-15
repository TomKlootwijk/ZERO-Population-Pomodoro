'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../web/core.js');
const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/census-world.json'), 'utf8'));
const model = C.parseFeed(raw);
const near = (a, b, e = 1e-8) => assert.ok(Math.abs(a - b) <= e, `${a} ≉ ${b} (tolerance ${e})`);
const t0 = Date.UTC(2026, 8, 14, 12);
const linear = { population: 1e9, rate: 2, epoch: t0, anchors: [] };

test('bundled Census feed validates and retains all 12 monthly anchors', () => {
  assert.equal(model.anchors.length, 12); assert.equal(model.population, 8210953064);
  assert.equal(model.epoch, 1789379889000);
});
test('invalid feeds and units fail closed', () => {
  for (const data of [null, {}, {world:{}}, {...raw,world:{...raw.world,population:'8 billion'}},
    {...raw,world:{...raw.world,population_rate:Infinity}}, {...raw,world:{...raw.world,rate_interval:'minute'}}]) {
    assert.throws(() => C.parseFeed(data));
  }
});
test('all monthly-anchor population values are exact', () => {
  for (const a of model.anchors) near(C.populationAt(model, a.t).value, a.p, 1e-5);
});
test('monthly interpolation uses elapsed seconds, not a fixed month length', () => {
  const a = model.anchors[2], b = model.anchors[3];
  near(C.populationAt(model, (a.t + b.t) / 2).value, (a.p + b.p) / 2, 1e-5);
  near(C.populationAt(model, a.t).rate, (b.p - a.p) / ((b.t - a.t) / 1000));
});
test('snapshot count and interpolated count agree within rounding', () => near(C.populationAt(model, model.epoch).value, model.population, 2));
test('out-of-range extrapolation is marked and continuous at boundaries', () => {
  const last = model.anchors.at(-1);
  const p = C.populationAt(model, last.t + 1000);
  assert.equal(p.extrapolated, true); near(p.value, last.p + model.rate, 1e-5);
  assert.equal(C.populationAt(model, model.anchors[0].t - 1000).extrapolated, true);
});
test('population integral is exact for linear growth', () => {
  near(C.integratePopulation(linear, t0, t0 + 10000), 1e10 + 100, 1e-3);
  assert.equal(C.integratePopulation(linear, t0, t0), 0);
});
test('piecewise integration splits at monthly boundaries', () => {
  const m = { population: 1000, rate: 1, epoch: t0, anchors: [
    {t:t0,p:1000},{t:t0+10000,p:1010},{t:t0+20000,p:1040}] };
  near(C.integratePopulation(m,t0,t0+20000), 10050+10250);
});
test('SDF zero is precisely the population reference', () => {
  near(C.sdf(8210953064,8210953064),0); near(C.sdf(110,100),10); near(C.sdf(90,100),-10);
});
test('electrical model keeps watts and amperes dimensionally distinct', () => {
  const p = C.electrical(8e9,100,230);
  assert.equal(p.watts,8e11); near(p.amperes,8e11/230,1e-5);
  assert.throws(()=>C.electrical(8e9,100,0)); assert.throws(()=>C.electrical(8e9,-1,230));
});
test('zero per-person watts gives zero power and current', () => assert.deepEqual(C.electrical(8e9,0,230),{watts:0,amperes:0}));
test('FFT identifies the 10 Hz peak at 128 samples/s', () => {
  const samples=Float64Array.from({length:512},(_,i)=>Math.sin(2*Math.PI*10*i/128));
  const sp=C.spectrum(samples); const peak=sp.reduce((a,b)=>a.amplitude>b.amplitude?a:b);
  assert.equal(peak.hz,10); near(peak.amplitude,1,1e-4);
});
test('FFT/IFFT round trip preserves a mixed real and imaginary signal', () => {
  const r=Float64Array.from({length:128},(_,i)=>Math.cos(i*.13));
  const im=Float64Array.from({length:128},(_,i)=>Math.sin(i*.21));
  const r0=r.slice(),i0=im.slice(); C.fft(r,im); C.fft(r,im,true);
  for(let i=0;i<128;i++){ near(r[i],r0[i]);near(im[i],i0[i]); }
});
test('FFT rejects non-power-of-two buffers and mismatched sizes', () => {
  assert.throws(()=>C.fft(new Float64Array(3),new Float64Array(3)));
  assert.throws(()=>C.fft(new Float64Array(8),new Float64Array(4)));
});
test('a constant offset has no spectrum after mean removal', () => {
  for(const b of C.spectrum(new Float64Array(512).fill(1000))) near(b.amplitude,0);
});
test('synthetic Fourier cycle is deterministic and zero-centered', () => {
  const a=new C.FourierTrace(2,24), b=new C.FourierTrace(2,24);
  assert.deepEqual(a.samples,b.samples);
  near(a.samples.reduce((x,y)=>x+y,0)/a.samples.length,0);
  near(Math.max(...Array.from(a.samples,Math.abs)),24);
});
test('growth rate scales the synthetic excursion but does not alter the model', () => {
  const a=new C.FourierTrace(2,24), b=new C.FourierTrace(4,24);
  near(b.excursion,2*a.excursion); assert.equal(linear.population,1e9);
});
test('synthetic signal loops after 16 seconds with valid negative history', () => {
  const a=new C.FourierTrace();
  assert.deepEqual(a.window(17),a.window(1));
  assert.equal(a.window(0).length,512); assert.ok(a.window(0).every(Number.isFinite));
});
test('settings validation clamps bad inputs and preserves safe defaults', () => {
  const s=C.settingsFrom({focusMinutes:999,voltage:0,gain:NaN,longEvery:4.7,sound:'false'});
  assert.equal(s.focusMinutes,180); assert.equal(s.voltage,.1); assert.equal(s.gain,24);
  assert.equal(s.longEvery,5); assert.equal(s.sound,true);
});
test('default timer is paused at 25 minutes; compact view is default', () => {
  const t=new C.Pomodoro(); assert.equal(t.remaining,1500000); assert.equal(t.running,false);
  assert.equal(C.DEFAULTS.compact,true);
});
test('deadline timer advances and accumulates active-session energy', () => {
  const t=new C.Pomodoro();t.start(t0);t.tick(t0+12345,(a,b)=>(b-a)/1000*100);
  assert.equal(t.remaining,1500000-12345);near(t.energyJoules,1234.5);assert.equal(t.activeMs,12345);
});
test('paused time adds neither energy nor elapsed timer time', () => {
  const t=new C.Pomodoro();const e=(a,b)=>(b-a)/1000*100;
  t.start(t0);t.pause(t0+1000,e);t.tick(t0+100000,e);
  assert.equal(t.remaining,1499000);assert.equal(t.energyJoules,100);
  t.start(t0+100000);t.tick(t0+101000,e);assert.equal(t.remaining,1498000);assert.equal(t.energyJoules,200);
});
test('completion caps energy at deadline and counts focus exactly once', () => {
  const t=new C.Pomodoro({focusMinutes:1});t.start(t0);
  assert.equal(t.tick(t0+600000,(a,b)=>(b-a)/1000*100),true);
  assert.equal(t.remaining,0);assert.equal(t.energyJoules,6000);assert.equal(t.completed,1);
  assert.equal(t.tick(t0+700000,()=>1e9),false);assert.equal(t.completed,1);assert.equal(t.energyJoules,6000);
});
test('restored running timer accounts for suspended time, capped at deadline', () => {
  const a=new C.Pomodoro({focusMinutes:1});a.start(t0);a.tick(t0+1000,(x,y)=>(y-x)/1000);
  const b=new C.Pomodoro(a.settings,a.snapshot());
  b.tick(t0+120000,(x,y)=>(y-x)/1000);
  assert.equal(b.energyJoules,60);assert.equal(b.completed,1);assert.equal(b.finished,true);
});
test('fourth completed focus selects a long break', () => {
  const t=new C.Pomodoro({focusMinutes:1,longEvery:4});
  for(let i=0;i<4;i++) {t.reset('focus');t.start(t0);t.tick(t0+60000);}
  assert.equal(t.completed,4);t.next();assert.equal(t.mode,'long');assert.equal(t.remaining,900000);
});
test('skipping the focus after a long break selects a short break without awarding a completion', () => {
  const t=new C.Pomodoro({focusMinutes:1,shortMinutes:1,longMinutes:1,longEvery:4});
  let now=t0;
  for(let i=0;i<4;i++) {
    t.start(now);now+=60000;t.tick(now);t.next();
    assert.equal(t.mode,i===3?'long':'short');
    t.start(now);now+=60000;t.tick(now);t.next();
  }
  assert.equal(t.mode,'focus');assert.equal(t.completed,4);
  t.start(now);t.tick(now+1000);t.next();
  assert.equal(t.mode,'short');assert.equal(t.completed,4);
  assert.equal(t.remaining,60000);assert.equal(t.running,false);
});
test('skips and resets do not increment completed focuses', () => {
  const t=new C.Pomodoro();t.start(t0);t.next();assert.equal(t.mode,'short');assert.equal(t.completed,0);
  t.reset('focus');assert.equal(t.completed,0);assert.equal(t.energyJoules,0);
});
test('break completion does not increment focus count', () => {
  const t=new C.Pomodoro({shortMinutes:1});t.reset('short');t.start(t0);t.tick(t0+60000);
  assert.equal(t.completed,0);t.next();assert.equal(t.mode,'focus');
});
test('setting new duration does not mutate a running or partly completed interval', () => {
  const t=new C.Pomodoro();t.start(t0);t.tick(t0+1000);t.setSettings({focusMinutes:30});
  assert.equal(t.duration,1500000);t.pause(t0+1000);t.setSettings({focusMinutes:35});assert.equal(t.duration,1500000);
  t.reset();assert.equal(t.duration,2100000);
});
test('new duration applies immediately to an untouched paused timer', () => {
  const t=new C.Pomodoro();t.setSettings({focusMinutes:30});assert.equal(t.remaining,1800000);
});
test('saved-state corruption does not create a running invalid timer', () => {
  const t=new C.Pomodoro({}, {mode:'focus', running:true, deadline:'broken', lastEnergyAt:null, remaining:60000, duration:60000});
  assert.equal(t.running,false);assert.ok(Number.isFinite(t.remaining));
});
test('energy integral with population growth is used while timer runs', () => {
  const t=new C.Pomodoro();t.start(t0);t.tick(t0+10000,(a,b)=>C.integratePopulation(linear,a,b)*100);
  near(t.energyJoules,1e12+10000,.01);
});
test('SI labels distinguish GW, GA, and PJ', () => {
  assert.equal(C.formatSI(821e9,'W'),'821.00 GW');assert.equal(C.formatSI(3.57e9,'A'),'3.57 GA');
  assert.equal(C.formatSI(1.23e15,'J'),'1.23 PJ');
});
