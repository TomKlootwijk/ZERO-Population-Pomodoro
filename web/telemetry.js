/* NOAA operational solar-wind data parsing. No synthetic fallback observations. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ZeroTelemetry = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const URLS = Object.freeze({
    wind: 'https://services.swpc.noaa.gov/json/rtsw/rtsw_wind_1m.json',
    mag: 'https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json'
  });
  const valid = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
  const MAX_AGE = 7 * 86400000, FUTURE_ALLOWANCE = 120000, MAX_ROWS = 30000;
  const currentTime = (time, now) => valid(time, Math.max(0, now - MAX_AGE), now + FUTURE_ALLOWANCE);
  const cleanText = (value, limit) => typeof value === 'string'
    ? value.replace(/[^a-zA-Z0-9 ._()/+:,;!?=-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) : '';
  function checkNow(now) {
    if (!valid(now, 0, 8640000000000000 - FUTURE_ALLOWANCE)) throw new Error('Invalid observation reference time.');
  }
  function normalizeRow(row, kind, now) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || !currentTime(row.time, now)) return null;
    const source = cleanText(row.source, 30) || 'active spacecraft';
    if (kind === 'wind') {
      if (!valid(row.speed, 0, 5000) || !valid(row.density, 0, 10000) || !valid(row.temperature, 0, 1e9)) return null;
      return { time: row.time, source, speed: row.speed, density: row.density, temperature: row.temperature };
    }
    // Generous solar-wind field envelope excludes NOAA negative fill sentinels.
    // |Bz| cannot exceed the total field magnitude; allow reported rounding.
    if (!valid(row.bz, -1000, 1000) || !valid(row.bt, 0, 1000) || Math.abs(row.bz) > row.bt + 0.02) return null;
    return { time: row.time, source, bz: row.bz, bt: row.bt };
  }
  function normalizedRows(rows, kind, now) {
    if (!Array.isArray(rows) || rows.length > MAX_ROWS) return [];
    const unique = new Map();
    for (const row of rows) {
      const item = normalizeRow(row, kind, now);
      if (item && !unique.has(item.time)) unique.set(item.time, item);
    }
    return [...unique.values()].sort((a, b) => a.time - b.time).slice(-120);
  }
  function stamp(value) {
    if (typeof value !== 'string') return NaN;
    return Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : value + 'Z');
  }
  function parseRows(raw, kind, now = Date.now()) {
    checkNow(now);
    if (!Array.isArray(raw) || raw.length > MAX_ROWS || !['wind', 'mag'].includes(kind)) throw new Error('Invalid NOAA data format.');
    const candidates = [];
    for (const row of raw) {
      if (!row || row.active !== true || row.overall_quality !== 0) continue;
      const time = stamp(row.time_tag);
      if (!currentTime(time, now)) continue;
      if (kind === 'wind') {
        candidates.push({ time, source: row.source, speed: row.proton_speed, density: row.proton_density, temperature: row.proton_temperature });
      } else {
        candidates.push({ time, source: row.source, bz: row.bz_gsm, bt: row.bt });
      }
    }
    const rows = normalizedRows(candidates, kind, now);
    if (!rows.length) throw new Error(`No current, active, quality-zero ${kind} readings.`);
    return rows;
  }
  // Schema validation of an untrusted saved value, not proof of NOAA provenance.
  // A damaged channel must not discard valid timestamped readings from the other.
  function validateSnapshot(value, now = Date.now()) {
    checkNow(now);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid saved NOAA snapshot.');
    const wind = normalizedRows(value.wind, 'wind', now), mag = normalizedRows(value.mag, 'mag', now);
    if (!wind.length && !mag.length) throw new Error('No valid saved NOAA readings.');
    const errors = Array.isArray(value.errors) ? value.errors.slice(0, 4)
      .map(message => cleanText(message, 160)).filter(Boolean) : [];
    const snapshot = { wind, mag, errors };
    if (currentTime(value.fetchedAt, now)) snapshot.fetchedAt = value.fetchedAt;
    return snapshot;
  }
  function channelState(rows, now = Date.now()) {
    const latest = Array.isArray(rows) ? rows.at(-1) : null;
    if (!latest || !currentTime(latest.time, now)) return { label: 'Unavailable', ageSeconds: null, fresh: false };
    const ageSeconds = Math.max(0, (now - latest.time) / 1000);
    return { label: ageSeconds <= 1200 ? 'Recent' : 'Stale', ageSeconds, fresh: ageSeconds <= 1200 };
  }
  function solarPressure(speedKmS, densityCm3) {
    // Proton-only ram pressure n*m_p*v². Alpha particles are deliberately excluded.
    if (!valid(speedKmS, 0, 5000) || !valid(densityCm3, 0, 10000)) return null;
    return 1.67262192595e-6 * densityCm3 * speedKmS ** 2; // nPa
  }
  function evidence(wind, mag, now = Date.now()) {
    const w = Array.isArray(wind) ? wind.at(-1) : null, m = Array.isArray(mag) ? mag.at(-1) : null;
    const freshWind = channelState(wind, now).fresh, freshMag = channelState(mag, now).fresh;
    const aligned = !!w && !!m && Math.abs(w.time - m.time) <= 120000;
    return { freshWind, freshMag, aligned, ready: freshWind && freshMag && aligned };
  }
  return { URLS, stamp, parseRows, validateSnapshot, channelState, solarPressure, evidence };
});
