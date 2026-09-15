'use strict';
const https = require('node:https');
const { URLS, parseRows } = require('../web/telemetry.js');
let cached = null, cachedAt = 0, pending = null;
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { timeout: 15000, headers: { Accept: 'application/json', 'User-Agent': 'ZERO-Population-Observatory/1.2' } }, response => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`NOAA returned HTTP ${response.statusCode}.`)); return; }
      const chunks = []; let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 6000000) request.destroy(new Error('NOAA response exceeds size limit.'));
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        if (size > 6000000) return;
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (_) { reject(new Error('NOAA returned invalid JSON.')); }
      });
    });
    request.on('timeout', () => request.destroy(new Error('NOAA request timed out.')));
    request.on('error', reject);
  });
}
async function fetchSpaceWeather() {
  if (cached && Date.now() - cachedAt < 60000) return cached;
  if (pending) return pending;
  pending = (async () => {
    const result = await Promise.allSettled(Object.entries(URLS).map(async ([kind, url]) => [kind, parseRows(await fetchJSON(url), kind)]));
    const next = { wind: [], mag: [], fetchedAt: Date.now(), errors: [] };
    result.forEach((item, index) => {
      if (item.status === 'fulfilled') next[item.value[0]] = item.value[1];
      else next.errors.push(`${index === 0 ? 'Plasma' : 'Magnetic'}: ${item.reason.message}`);
    });
    if (!next.wind.length && !next.mag.length) throw new Error(next.errors.join(' '));
    cached = next; cachedAt = Date.now(); return next;
  })().finally(() => { pending = null; });
  return pending;
}
module.exports = { fetchSpaceWeather };
