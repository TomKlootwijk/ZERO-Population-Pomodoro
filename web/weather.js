/* Neighborhood weather model data. No device location or synthetic temperatures. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ZeroWeather = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // Public neighborhood reference point, not a household location.
  const ENDPOINT = 'https://api.open-meteo.com/v1/forecast?latitude=52.36&longitude=4.99&current=temperature_2m,apparent_temperature,weather_code&timezone=UTC&timeformat=unixtime';
  const SOURCE_URL = 'https://open-meteo.com/';
  const LOCATION_KEY = 'ijburg-amsterdam';
  const MAX_AGE = 86400000, FUTURE_ALLOWANCE = 120000, FRESH_AGE = 45 * 60000;
  const CODES = Object.freeze({ 0:'Clear',1:'Mostly clear',2:'Partly cloudy',3:'Overcast',45:'Fog',48:'Freezing fog',
    51:'Light drizzle',53:'Drizzle',55:'Heavy drizzle',56:'Freezing drizzle',57:'Heavy freezing drizzle',
    61:'Light rain',63:'Rain',65:'Heavy rain',66:'Freezing rain',67:'Heavy freezing rain',
    71:'Light snow',73:'Snow',75:'Heavy snow',77:'Snow grains',80:'Light showers',81:'Showers',82:'Heavy showers',
    85:'Snow showers',86:'Heavy snow showers',95:'Thunderstorm',96:'Thunderstorm with hail',99:'Thunderstorm with heavy hail' });
  const finite = (x, lo, hi) => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;
  function checkNow(now) {
    if (!finite(now, Date.UTC(2000,0,1), Date.UTC(2300,0,1))) throw new Error('Invalid weather reference time.');
  }
  function validTime(time, now) { return finite(time, now - MAX_AGE, now + FUTURE_ALLOWANCE); }
  function code(value) { return Number.isInteger(value) && Object.hasOwn(CODES, value) ? value : null; }
  function validateSnapshot(value, now = Date.now()) {
    checkNow(now);
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1
        || value.locationKey !== LOCATION_KEY || value.unit !== '°C'
        || !validTime(value.time, now) || !finite(value.temperature, -100, 70))
      throw new Error('No valid saved IJburg temperature.');
    const result = { version:1, locationKey:LOCATION_KEY, location:'IJburg · Amsterdam', source:'Open-Meteo', unit:'°C',
      time:value.time, temperature:value.temperature,
      apparentTemperature:finite(value.apparentTemperature,-120,80) ? value.apparentTemperature : null,
      weatherCode:code(value.weatherCode) };
    if (validTime(value.fetchedAt,now)) result.fetchedAt = value.fetchedAt;
    return result;
  }
  function parseCurrent(raw, now = Date.now()) {
    checkNow(now);
    const current = raw?.current, units = raw?.current_units;
    if (!current || !units || raw.utc_offset_seconds !== 0 || units.time !== 'unixtime'
        || units.temperature_2m !== '°C' || !Number.isInteger(current.time))
      throw new Error('Open-Meteo returned unsupported weather units or time.');
    return validateSnapshot({ version:1, locationKey:LOCATION_KEY, unit:'°C',
      time:current.time * 1000, temperature:current.temperature_2m,
      apparentTemperature:units.apparent_temperature === '°C' ? current.apparent_temperature : null,
      weatherCode:units.weather_code === 'wmo code' ? current.weather_code : null, fetchedAt:now }, now);
  }
  function state(value, now = Date.now()) {
    try {
      const item = validateSnapshot(value,now);
      const ageSeconds = Math.max(0,(now-item.time)/1000);
      return { available:true, fresh:ageSeconds <= FRESH_AGE/1000, ageSeconds,
        label:ageSeconds <= FRESH_AGE/1000 ? 'Current' : 'Stale' };
    } catch (_) { return { available:false, fresh:false, ageSeconds:null, label:'Unavailable' }; }
  }
  function condition(weatherCode) { return CODES[code(weatherCode)] || 'Conditions unavailable'; }
  return { ENDPOINT, SOURCE_URL, LOCATION_KEY, parseCurrent, validateSnapshot, state, condition };
});
