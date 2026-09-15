/* Live Earth/space instruments: ordered dithering encodes received NOAA values. */
(() => {
  'use strict';
  const T = window.ZeroTelemetry, I = window.ZeroInstruments;
  const mount = document.getElementById('telemetryMount');
  if (!mount || !T || !I) return;
  const widget = mount.closest('#widget');
  const KEY = 'zero.noaa.v1', AUTO = 'zero.noaa.auto';
  let data = {wind:[],mag:[],errors:[]}, cached = false, busy = false, failure = '', motion = true;
  let auto = true;
  try { auto = localStorage.getItem(AUTO) !== 'false'; const saved = localStorage.getItem(KEY); if (saved) { data = T.validateSnapshot(JSON.parse(saved)); cached = true; } } catch (_) {}
  mount.innerHTML = `
    <div class="telemetry-heading"><div><span class="telemetry-kicker">LIVE EARTH / SPACE</span><h3>The wind before Earth.</h3></div><span class="telemetry-badge" id="noaaBadge">Connecting</span></div>
    <div class="telemetry-atlas"><canvas id="bayerAtlas" role="img" aria-label="Bayer-dithered solar wind history: four rings encode speed, density, temperature and magnetic Bz"></canvas><div class="atlas-center"><span>L1</span><small>UPSTREAM</small></div></div>
    <div class="atlas-legend"><span><i style="background:#c5ed92"></i>Speed</span><span><i style="background:#91cfc7"></i>Density</span><span><i style="background:#e6b77c"></i>Temp</span><span><i style="background:#ccabe7"></i>Bz</span></div>
    <p class="telemetry-caption">Inner → outer rings · up to 120 observations clockwise · 8 × 8 Bayer thresholds</p>
    <div class="telemetry-grid">
      <div><label>Solar-wind speed</label><strong id="noaaSpeed">—</strong><small>km/s · measured</small></div>
      <div><label>Proton density</label><strong id="noaaDensity">—</strong><small>protons/cm³ · measured</small></div>
      <div><label>Proton temperature</label><strong id="noaaTemp">—</strong><small>K · measured</small></div>
      <div><label>Magnetic Bz · GSM</label><strong id="noaaBz">—</strong><small>nT · signed measurement</small></div>
    </div>
    <div class="telemetry-pressure"><span>Proton ram pressure <b id="noaaPressure">— nPa</b></span><span>n mₚ v² · derived</span></div>
    <div class="telemetry-gates" id="noaaGates" aria-label="Data availability gates"></div>
    <p class="telemetry-caption" id="noaaTimestamp">Waiting for NOAA observation timestamps.</p>
    <div class="telemetry-actions"><button id="noaaRefresh" class="secondary-button">Refresh NOAA</button><label><input id="noaaAuto" type="checkbox"> Refresh every 5 min</label><a href="https://www.spaceweather.gov/products/solar-wind" target="_blank" rel="noopener noreferrer">NOAA source ↗</a></div>
    <p class="telemetry-caption" id="noaaMessage">Actual upstream spacecraft observations; no population-to-space-weather relationship is implied.</p>
    <details class="telemetry-notes"><summary>Read the instrument</summary><p>Ordered Bayer dithering turns each received value into dot density. Display ranges: speed 250–850 km/s; density 0–20 cm⁻³; temperature logarithmic 10⁴–10⁶ K; Bz −20 to +20 nT. Values beyond a range saturate the art, while the numeric readout remains exact to the displayed precision. Missing observations leave blank sectors.</p><p>Only NOAA's active spacecraft and overall_quality = 0 records enter each channel. The indicators require readings within 20 minutes and timestamps within 2 minutes. This is a data-readiness gate inspired by Operator I, not independent verification of a physical event.</p><p>The scanning line is a 60-second UI phase clock inspired by UGTS. It does not represent radar emissions. Ring data only changes on a feed update; Freeze signal also freezes the scanner.</p></details>`;
  const $ = id => mount.ownerDocument.getElementById(id);
  $('noaaAuto').checked = auto;
  const fmtTime = t => new Date(t).toISOString().replace('T',' ').slice(0,16) + ' UTC';
  const channels = [
    {key:'speed',kind:'wind',color:'#c5ed92',norm:v=>(v-250)/600},
    {key:'density',kind:'wind',color:'#91cfc7',norm:v=>v/20},
    {key:'temperature',kind:'wind',color:'#e6b77c',norm:v=>(Math.log10(Math.max(1,v))-4)/2},
    {key:'bz',kind:'mag',color:'#ccabe7',norm:v=>(v+20)/40}
  ];
  function render() {
    const w=data.wind?.at(-1), m=data.mag?.at(-1), gate=T.evidence(data.wind,data.mag);
    $('noaaSpeed').textContent = w ? w.speed.toFixed(1) : '—';
    $('noaaDensity').textContent = w ? w.density.toFixed(2) : '—';
    $('noaaTemp').textContent = w ? Math.round(w.temperature).toLocaleString('en-US') : '—';
    $('noaaBz').textContent = m ? (m.bz>=0?'+':'')+m.bz.toFixed(2) : '—';
    $('noaaPressure').textContent = w ? T.solarPressure(w.speed,w.density).toFixed(3)+' nPa' : '— nPa';
    $('noaaBadge').textContent = busy ? 'Fetching' : cached ? 'Cached' : gate.ready ? 'Recent observations' : gate.freshWind && gate.freshMag ? 'Time offset' : w && m ? 'Stale observations' : w || m ? 'Partial observations' : 'Unavailable';
    $('noaaBadge').classList.toggle('fresh',gate.ready && !cached);
    $('noaaGates').replaceChildren(...[['Plasma fresh',gate.freshWind],['Magnetic fresh',gate.freshMag],['Time aligned',gate.aligned]].map(([label,on])=>{
      const span=document.createElement('span'); span.textContent=(on?'● ':'○ ')+label; span.className=on?'ready':'';return span;
    }));
    $('noaaTimestamp').textContent = [w?`Plasma: ${w.source} · ${fmtTime(w.time)}`:'Plasma: unavailable',m?`Magnetic: ${m.source} · ${fmtTime(m.time)}`:'Magnetic: unavailable'].join(' | ');
    $('noaaMessage').textContent = failure || data.errors?.join(' ') || 'Actual upstream spacecraft observations; numerical values remain independent of the artistic display.';
  }
  async function refresh(manual=false) {
    if (busy || (!manual && !auto)) return;
    busy=true; $('noaaRefresh').disabled=true; render();
    try {
      let result;
      if (window.zeroDesktop?.fetchSpaceWeather) result=await window.zeroDesktop.fetchSpaceWeather();
      else {
        const entries=await Promise.allSettled(Object.entries(T.URLS).map(async([kind,url])=>{
          const response=await fetch(url,{credentials:'omit',signal:AbortSignal.timeout(15000)});
          if(!response.ok) throw new Error(`NOAA ${kind}: HTTP ${response.status}`);
          return [kind,T.parseRows(await response.json(),kind)];
        }));
        result={wind:[],mag:[],errors:[],fetchedAt:Date.now()};
        entries.forEach(entry=>{if(entry.status==='fulfilled')result[entry.value[0]]=entry.value[1];else result.errors.push(entry.reason.message);});
        if(!result.wind.length&&!result.mag.length)throw new Error(result.errors.join(' '));
      }
      // A failed channel keeps its previous timestamped sample; it is never zero-filled.
      if (!result.wind.length) result.wind=data.wind||[];
      if (!result.mag.length) result.mag=data.mag||[];
      data=T.validateSnapshot(result); cached=false; failure='';
      try{localStorage.setItem(KEY,JSON.stringify(data));}catch(_){}
    }catch(error){cached=!!(data.wind?.length||data.mag?.length);failure=`Feed unavailable. ${cached?'Showing saved readings with their original timestamps.':'No substitute observations are generated.'}`;}
    finally{busy=false;$('noaaRefresh').disabled=false;render();draw();widget.dispatchEvent(new CustomEvent('zero-telemetry',{bubbles:true,detail:data}));}
  }
  let frozenPhase=0;
  function draw() {
    if ($('telemetryPanel').hidden || widget.classList.contains('compact')) return;
    const canvas=$('bayerAtlas'), box=canvas.getBoundingClientRect();if(!box.width||!box.height)return;
    const ratio=Math.min(mount.ownerDocument.defaultView.devicePixelRatio||1,2), width=box.width,height=box.height;
    if(canvas.width!==Math.round(width*ratio)||canvas.height!==Math.round(height*ratio)){canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);}
    const ctx=canvas.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,width,height);
    const cx=width/2,cy=height/2,rmax=Math.min(width/2-8,height/2-8),rmin=rmax*.31,cell=3;
    const all=[...(data.wind||[]),...(data.mag||[])], newest=all.length?Math.max(...all.map(p=>p.time)):Date.now();
    const byTime=channels.map(c=>new Map((data[c.kind]||[]).map(p=>[Math.round(p.time/60000),p[c.key]])));
    for(let y=0;y<height;y+=cell)for(let x=0;x<width;x+=cell){
      const dx=x-cx,dy=y-cy,r=Math.hypot(dx,dy);if(r<rmin||r>rmax)continue;
      const index=Math.min(3,Math.floor((r-rmin)/(rmax-rmin)*4)),c=channels[index];
      const angle=(Math.atan2(dy,dx)+Math.PI/2+Math.PI*2)%(Math.PI*2);
      const sampleMinute=Math.round(newest/60000)-119+Math.min(119,Math.floor(angle/(Math.PI*2)*120));
      const value=byTime[index].get(sampleMinute);
      if(value===undefined)continue;
      const level=Math.max(0,Math.min(1,c.norm(value)));
      const threshold=I.bayerThreshold?I.bayerThreshold(x/cell,y/cell):.5;
      ctx.fillStyle=c.color;ctx.globalAlpha=threshold<level?.94:.065;ctx.fillRect(x,y,cell-1,cell-1);
    }
    ctx.globalAlpha=1;ctx.strokeStyle='#344538';ctx.lineWidth=.7;
    for(let i=0;i<=4;i++){ctx.beginPath();ctx.arc(cx,cy,rmin+(rmax-rmin)*i/4,0,Math.PI*2);ctx.stroke();}
    const phase=motion?((Date.now()/60000)%1):frozenPhase;
    const angle=phase*Math.PI*2-Math.PI/2;ctx.strokeStyle='#e9f5dc';ctx.globalAlpha=.65;ctx.beginPath();ctx.moveTo(cx+Math.cos(angle)*rmin,cy+Math.sin(angle)*rmin);ctx.lineTo(cx+Math.cos(angle)*rmax,cy+Math.sin(angle)*rmax);ctx.stroke();ctx.globalAlpha=1;
  }
  $('noaaRefresh').addEventListener('click',()=>refresh(true));
  $('noaaAuto').addEventListener('change',event=>{auto=event.target.checked;try{localStorage.setItem(AUTO,String(auto));}catch(_){}if(auto)refresh();});
  widget.addEventListener('zero-motion',event=>{frozenPhase=(Date.now()/60000)%1;motion=event.detail.motion;draw();});
  widget.addEventListener('zero-instrument',()=>{render();draw();});
  new ResizeObserver(draw).observe(mount);
  setInterval(()=>{if(!mount.ownerDocument.hidden){render();draw();}},200);
  setInterval(()=>refresh(),300000);
  window.ZeroTelemetryLive=Object.freeze({getSnapshot:()=>data,getState:()=>({cached,busy,failure}),refresh:()=>refresh(true)});
  render();setTimeout(()=>refresh(),600);
})();
