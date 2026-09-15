'use strict';
const https = require('node:https');
const { ENDPOINT, parseCurrent } = require('../web/weather.js');
let cached = null, cachedAt = 0, pending = null;
function requestWeather() {
  return new Promise((resolve,reject) => {
    const request = https.get(ENDPOINT, { timeout:15000,
      headers:{Accept:'application/json','User-Agent':'ZERO-Population-Observatory/1.2'} }, response => {
      if (response.statusCode !== 200) {
        response.resume(); reject(new Error(`Open-Meteo returned HTTP ${response.statusCode}.`)); return;
      }
      const chunks = []; let size = 0;
      response.on('data',chunk => {
        size += chunk.length;
        if (size > 1000000) request.destroy(new Error('Weather response exceeds size limit.'));
        else chunks.push(chunk);
      });
      response.on('error',reject);
      response.on('end',() => {
        if (size > 1000000) return;
        try { resolve(parseCurrent(JSON.parse(Buffer.concat(chunks).toString('utf8')))); }
        catch (_) { reject(new Error('Open-Meteo returned invalid current weather.')); }
      });
    });
    request.on('timeout',() => request.destroy(new Error('Weather request timed out.')));
    request.on('error',reject);
  });
}
async function fetchWeather() {
  if (cached && Date.now()-cachedAt < 600000) return cached;
  if (pending) return pending;
  pending = requestWeather().then(result => { cached=result; cachedAt=Date.now(); return result; })
    .finally(() => { pending=null; });
  return pending;
}
module.exports = { fetchWeather };
