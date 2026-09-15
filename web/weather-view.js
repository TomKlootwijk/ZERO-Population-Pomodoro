/* A small IJburg temperature strip with timestamped, attributed model output. */
(() => {
  'use strict';
  const W=window.ZeroWeather, mount=document.getElementById('weatherMount');
  if (!W || !mount) return;
  const widget=mount.closest('#widget'), KEY='zero.weather.ijburg.v1';
  let data=null, cached=false, busy=false, failed=false;
  try { const saved=localStorage.getItem(KEY); if(saved){data=W.validateSnapshot(JSON.parse(saved));cached=true;} } catch(_){}
  mount.innerHTML=`<div class="weather-strip">
    <button class="weather-toggle" id="weatherToggle" type="button" aria-expanded="false" aria-controls="weatherDetails"><span id="weatherReading" aria-live="polite"><span id="weatherLocation">IJburg</span> <span id="localTemperature">— °C</span></span><small id="weatherState">Loading</small></button>
    <a class="weather-credit" href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer" aria-label="Weather data by Open-Meteo.com">Open-Meteo ↗</a>
    </div><section id="weatherDetails" class="weather-details" aria-label="IJburg weather details" hidden>
    <div class="weather-details-heading"><strong>IJburg · Amsterdam</strong><button id="weatherClose" type="button" aria-label="Close weather details">×</button></div>
    <p id="weatherConditions">Waiting for current weather.</p><p id="weatherTimestamp"></p>
    <p>Current model temperature at 2 m above ground.</p>
    <div class="weather-details-actions"><button id="weatherRefresh" type="button">Refresh</button><a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a></div>
    </section>`;
  const $=id=>mount.ownerDocument.getElementById(id);
  const timeLabel=time=>new Date(time).toISOString().replace('T',' ').slice(0,16)+' UTC';
  function getSnapshot(){try{return data?W.validateSnapshot(data):null;}catch(_){return null;}}
  window.ZeroWeatherLive=Object.freeze({getSnapshot,getState:()=>({...W.state(data),cached,failed,busy})});
  function render(){
    const status=W.state(data);
    const reading=status.available?`IJburg ${data.temperature.toFixed(1)}°C`:'IJburg — °C';
    const state=busy?'Loading':!status.available?'Unavailable':!status.fresh?'Stale':cached||failed?'Cached':'Current';
    $('localTemperature').textContent=status.available?`${data.temperature.toFixed(1)}°C`:'— °C';$('weatherState').textContent=state;
    mount.dataset.state=state.toLowerCase();
    const timestamp=status.available?`Valid ${timeLabel(data.time)}${cached||failed?' · saved reading':''}`:'No current temperature available.';
    const apparent=status.available&&data.apparentTemperature!==null?` · feels like ${data.apparentTemperature.toFixed(1)}°C`:'';
    $('weatherConditions').textContent=status.available?W.condition(data.weatherCode)+apparent:'Weather feed unavailable. No substitute temperature is generated.';
    $('weatherTimestamp').textContent=timestamp;
    $('weatherToggle').title=`${reading} · ${state}. ${timestamp}. Current model data by Open-Meteo.`;
    $('weatherToggle').setAttribute('aria-label',`${reading}, ${state}. Open weather details.`);
    $('weatherRefresh').disabled=busy;
    const EventType=mount.ownerDocument.defaultView.CustomEvent;
    widget?.dispatchEvent(new EventType('zero-weather',{bubbles:true,detail:getSnapshot()}));
  }
  function details(open){$('weatherDetails').hidden=!open;$('weatherToggle').setAttribute('aria-expanded',String(open));}
  async function refresh(){
    if(busy)return;busy=true;render();
    try{
      let result;
      if(window.zeroDesktop?.fetchWeather)result=await window.zeroDesktop.fetchWeather();
      else{
        const response=await fetch(W.ENDPOINT,{credentials:'omit',signal:AbortSignal.timeout(15000)});
        if(!response.ok)throw new Error('Weather request failed.');
        const body=await response.text();if(body.length>1000000)throw new Error('Weather response too large.');
        result=W.parseCurrent(JSON.parse(body));
      }
      data=W.validateSnapshot(result);cached=false;failed=false;
      try{localStorage.setItem(KEY,JSON.stringify(data));}catch(_){}
    }catch(_){cached=!!data;failed=true;}
    finally{busy=false;render();}
  }
  $('weatherToggle').addEventListener('click',()=>details($('weatherDetails').hidden));
  $('weatherClose').addEventListener('click',()=>{details(false);$('weatherToggle').focus();});
  $('weatherRefresh').addEventListener('click',refresh);
  mount.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('weatherDetails').hidden){details(false);$('weatherToggle').focus();event.stopPropagation();}});
  widget?.addEventListener('zero-instrument',()=>{details(false);render();});
  setInterval(refresh,900000);setInterval(render,60000);
  render();setTimeout(refresh,350);
})();
