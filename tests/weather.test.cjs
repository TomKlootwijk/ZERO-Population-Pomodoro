'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const W=require('../web/weather.js');
const now=Date.UTC(2026,8,15,12);
const response=(patch={},units={})=>({utc_offset_seconds:0,current_units:{time:'unixtime',temperature_2m:'°C',apparent_temperature:'°C',weather_code:'wmo code',...units},current:{time:(now-900000)/1000,temperature_2m:17.2,apparent_temperature:16.5,weather_code:3,...patch}});
test('weather converts UTC epoch seconds once and retains Celsius model values',()=>{
  const item=W.parseCurrent(response(),now);assert.equal(item.time,now-900000);assert.equal(item.temperature,17.2);
  assert.equal(item.apparentTemperature,16.5);assert.equal(item.weatherCode,3);assert.equal(item.source,'Open-Meteo');assert.equal(item.locationKey,'ijburg-amsterdam');
});
test('weather refuses null, non-finite, sentinel and text temperatures',()=>{
  for(const temperature_2m of [null,undefined,NaN,Infinity,-9999,'17.2',71])assert.throws(()=>W.parseCurrent(response({temperature_2m}),now));
});
test('Fahrenheit and mismatched timestamp units cannot appear as Celsius',()=>{
  assert.throws(()=>W.parseCurrent(response({},{temperature_2m:'°F'}),now));
  assert.throws(()=>W.parseCurrent(response({},{time:'iso8601'}),now));
  assert.throws(()=>W.parseCurrent(response({time:now}),now));
  assert.throws(()=>W.parseCurrent({...response(),utc_offset_seconds:7200},now));
});
test('missing optional feels-like and condition values preserve the actual temperature',()=>{
  const item=W.parseCurrent(response({apparent_temperature:null,weather_code:-9999}),now);
  assert.equal(item.temperature,17.2);assert.equal(item.apparentTemperature,null);assert.equal(item.weatherCode,null);
  assert.equal(W.condition(null),'Conditions unavailable');assert.equal(W.condition(3),'Overcast');
});
test('cache validation drops unknown properties and fixes labels without trusting stored markup',()=>{
  const item=W.parseCurrent(response(),now);
  const result=W.validateSnapshot({...item,source:'<script>',location:'Household',unknown:123},now);
  assert.equal(result.source,'Open-Meteo');assert.equal(result.location,'IJburg · Amsterdam');assert.equal(result.unknown,undefined);
  assert.notEqual(result,item);
});
test('corrupt or wrong-location saved weather is rejected and never zero-filled',()=>{
  const item=W.parseCurrent(response(),now);
  for(const value of [null,[],{},'bad',{...item,temperature:null},{...item,unit:'°F'},{...item,locationKey:'elsewhere'},{...item,time:'yesterday'}])
    assert.throws(()=>W.validateSnapshot(value,now));
});
test('weather age labels retain old timestamps and reject expired or future cached values',()=>{
  const item=W.parseCurrent(response(),now);
  assert.equal(W.state(item,now).label,'Current');
  assert.equal(W.state({...item,time:now-46*60000},now).label,'Stale');
  assert.equal(W.state({...item,time:now-86400001},now).label,'Unavailable');
  assert.equal(W.state({...item,time:now+120001},now).label,'Unavailable');
  assert.equal(W.state({...item,time:now+120000},now).available,true);
});
test('valid freezing and below-freezing temperatures remain signed',()=>{
  assert.equal(W.parseCurrent(response({temperature_2m:0}),now).temperature,0);
  assert.equal(W.parseCurrent(response({temperature_2m:-4.5}),now).temperature,-4.5);
});
