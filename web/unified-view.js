/* One coordinate field for received samples and explicitly modeled population geometry. */
(() => {
  'use strict';
  const widget=document.getElementById('widget'), canvas=document.getElementById('unifiedCanvas');
  if(!widget||!canvas)return;
  const I=window.ZeroInstruments, L=window.ZeroLiveSignal;
  const $=id=>widget.ownerDocument.getElementById(id);
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const utc=t=>new Date(t).toISOString().slice(11,16);
  const signed=(v,d=1)=>(v<0?'−':'+')+Math.abs(v).toFixed(d);
  let population=null, data=null, signal=null, weather=null, motion=true, frozen=0;
  let base=null, baseKey='', dirty=true;
  const colors=['#c5ed92','#8ed6cb','#dfb77b','#bda7e8'];
  function acquire(){
    const next=window.ZeroTelemetryLive?.getSnapshot();
    if(next!==data){data=next;signal=L.analyze(data?.wind||[],data?.mag||[]);dirty=true;}
    const nextWeather=window.ZeroWeatherLive?.getSnapshot();
    if(nextWeather?.time!==weather?.time||nextWeather?.temperature!==weather?.temperature){weather=nextWeather;dirty=true;}
  }
  function readouts(){
    if(!$('unifiedDC'))return;
    $('unifiedDC').textContent=signal?.ready?signal.dc.toFixed(1):'—';
    $('unifiedAC').textContent=signal?.ready?signal.acRms.toFixed(2):'—';
    $('unifiedHz').textContent=signal?.ready?signal.dominantMilliHz.toFixed(3):'—';
    if($('unifiedDistance'))$('unifiedDistance').textContent=population?`Signed distance φ = ${signed(population.distance)} people`:'Population reference loading.';
    const w=data?.wind?.at(-1),m=data?.mag?.at(-1), state=window.ZeroTelemetryLive?.getState();
    const fresh=window.ZeroTelemetry.evidence(data?.wind,data?.mag);
    if($('unifiedChannels'))$('unifiedChannels').textContent=[w?`Wind ${w.speed.toFixed(1)} km/s · density ${w.density.toFixed(2)} cm⁻³ · plasma ${Math.round(w.temperature).toLocaleString('en-US')} K`:'Plasma unavailable',m?`Bz ${signed(m.bz,2)} nT`:'Magnetic unavailable'].join(' · ');
    const source=$('unifiedSource');
    source.textContent=w||m?`NOAA W ${w?utc(w.time):'—'} / B ${m?utc(m.time):'—'} UTC${state?.cached?' · saved':!fresh.freshWind||!fresh.freshMag?' · stale':''}`:'NOAA · awaiting samples';
    source.dataset.fresh=String(fresh.ready&&!state?.cached);
    source.title=[
      w?`Plasma ${w.source}: ${new Date(w.time).toISOString()}`:'Plasma unavailable',
      m?`Magnetic ${m.source}: ${new Date(m.time).toISOString()}`:'Magnetic unavailable',
      'One-minute observations; refresh every five minutes.',
      signal?.ready?`${signal.sampleCount} consecutive one-minute wind samples. DC and AC in km/s; Fourier peak in mHz.`:signal?.reason,
      'Sweep = display phase. Contours = modeled population distance. Open source notes.'
    ].filter(Boolean).join('\n');
    if($('unifiedWindow'))$('unifiedWindow').textContent=signal?.ready?`${signal.sampleCount} × 1 min · ${utc(signal.windowStart)}–${utc(signal.windowEnd)} UTC · Δf ${(1000/signal.sampleCount/60).toFixed(3)} mHz`:(signal?.reason||'Waiting for source samples.');
    if($('unifiedReference'))$('unifiedReference').textContent=population?`φ ${signed(population.distance)} people · ε ${signed(population.strainPPM,3)} ppm · bridge ${signed(population.bridgeUv,3)} µV`:'Population reference loading.';
    canvas.setAttribute('aria-label',`Unified data field. ${w?`Latest solar wind ${w.speed} kilometers per second.`:'Solar wind unavailable.'} ${m?`Bz ${m.bz} nanotesla.`:''} ${weather?`IJburg ${weather.temperature} degrees Celsius, weather model.`:''} ${signal?.ready?`Wind mean ${signal.dc.toFixed(2)}, AC RMS ${signal.acRms.toFixed(2)} kilometers per second.`:'No Fourier result until a contiguous sample window is available.'}`);
  }
  function createBase(width,height,ratio){
    base=widget.ownerDocument.createElement('canvas');base.width=Math.round(width*ratio);base.height=Math.round(height*ratio);
    const ctx=base.getContext('2d');ctx.scale(ratio,ratio);
    const plotHeight=height-(widget.classList.contains('compact')?28:60);
    const cx=width/2,cy=plotHeight*.53,rx=width*.42,ry=plotHeight*.39;
    ctx.fillStyle='#0c1512';ctx.fillRect(0,0,width,height);
    ctx.strokeStyle='#25392f';ctx.globalAlpha=.45;ctx.lineWidth=.5;
    for(let x=width%16;x<width;x+=16){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,height);ctx.stroke();}
    for(let y=height%16;y<height;y+=16){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(width,y);ctx.stroke();}
    ctx.globalAlpha=1;
    if(weather){
      const warm=clamp((weather.temperature+5)/40,0,1);
      const grad=ctx.createRadialGradient(cx,cy,0,cx,cy,rx*.8);
      grad.addColorStop(0,`rgba(${Math.round(90+90*warm)},${Math.round(155-45*warm)},${Math.round(170-110*warm)},0.15)`);
      grad.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=grad;ctx.fillRect(0,0,width,height);
    }
    const all=[...(data?.wind||[]),...(data?.mag||[])];
    const latest=all.length?Math.max(...all.map(r=>r.time)):0;
    const channels=[{rows:data?.wind,key:'speed',norm:v=>(v-250)/600},{rows:data?.wind,key:'density',norm:v=>v/20},{rows:data?.wind,key:'temperature',norm:v=>(Math.log10(Math.max(1,v))-4)/2},{rows:data?.mag,key:'bz',norm:v=>(v+20)/40}];
    const bins=channels.map(c=>new Map((c.rows||[]).map(p=>[Math.round(p.time/60000),p[c.key]])));
    const cell=widget.classList.contains('compact')?2.5:3;
    for(let y=0;y<height;y+=cell)for(let x=0;x<width;x+=cell){
      const dx=(x-cx)/rx,dy=(y-cy)/ry,rho=Math.hypot(dx,dy);
      if(rho<.25||rho>1.06)continue;
      const band=Math.min(3,Math.floor((rho-.25)/.81*4));
      const a=(Math.atan2(dy,dx)+Math.PI/2+Math.PI*2)%(Math.PI*2);
      const minute=Math.round(latest/60000)-119+Math.min(119,Math.floor(a/(Math.PI*2)*120));
      const val=bins[band].get(minute);if(val===undefined)continue;
      const level=clamp(channels[band].norm(val),0,1);
      ctx.globalAlpha=I.bayerThreshold(Math.round(x/cell),Math.round(y/cell))<level?.65:.045;
      ctx.fillStyle=colors[band];ctx.fillRect(x,y,cell-1,cell-1);
    }
    ctx.globalAlpha=1;
    // Fourier magnitudes share the outer arc with the minute-history field.
    if(signal?.ready){
      const maximum=Math.max(...signal.spectrum.map(b=>b.amplitude),1e-9);
      const bins=signal.spectrum.filter(b=>b.hz>0);
      bins.forEach((bin,k)=>{
        const a=-Math.PI+(k/Math.max(1,bins.length-1))*Math.PI;
        const level=bin.amplitude/maximum;
        ctx.strokeStyle='#ddb77d';ctx.globalAlpha=.25+.65*level;ctx.lineWidth=widget.classList.contains('compact')?1:2;
        ctx.beginPath();ctx.moveTo(cx+Math.cos(a)*rx*.88,cy+Math.sin(a)*ry*.88);
        ctx.lineTo(cx+Math.cos(a)*rx*(.91+.19*level),cy+Math.sin(a)*ry*(.91+.19*level));ctx.stroke();
      });
      // Connect only actual consecutive sampled values; never draw over missing minutes.
      const amp=Math.max(signal.acRms*3,1), start=signal.windowStart, span=signal.windowEnd-start;
      ctx.strokeStyle='#a5efe0';ctx.lineWidth=widget.classList.contains('compact')?1:1.4;ctx.globalAlpha=.95;ctx.beginPath();
      signal.samples.forEach((p,i)=>{
        const x=width*.06+(p.time-start)/span*width*.88,y=cy-clamp((p.speed-signal.dc)/amp,-1.1,1.1)*ry*.46;
        if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
      });ctx.stroke();
    }
    const mag=data?.mag?.at(-1);
    if(mag){
      const extent=clamp(mag.bz/20,-1,1)*ry*.68;
      ctx.globalAlpha=.75;ctx.strokeStyle='#c3afea';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx,cy-extent);ctx.stroke();
      ctx.fillStyle='#c3afea';ctx.beginPath();ctx.arc(cx,cy-extent,2,0,Math.PI*2);ctx.fill();
    }
    ctx.globalAlpha=1;
  }
  function draw(){
    if(widget.ownerDocument.hidden||canvas.getBoundingClientRect().width===0)return;
    const box=canvas.getBoundingClientRect(),width=box.width,height=box.height,ratio=Math.min(widget.ownerDocument.defaultView.devicePixelRatio||1,2);
    const key=`${width}/${height}/${ratio}/${widget.classList.contains('compact')}`;
    if(canvas.width!==Math.round(width*ratio)||canvas.height!==Math.round(height*ratio)){canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);}
    if(dirty||key!==baseKey){createBase(width,height,ratio);dirty=false;baseKey=key;}
    const ctx=canvas.getContext('2d');ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(base,0,0);ctx.setTransform(ratio,0,0,ratio,0,0);
    const plotHeight=height-(widget.classList.contains('compact')?28:60);
    const cx=width/2,cy=plotHeight*.53,rx=width*.42,ry=plotHeight*.39;
    // The model's count-axis signed distance shifts a display contour, not geography.
    const offset=population?clamp(Math.asinh(population.distance/100)*.045,-.15,.15):0;
    ctx.strokeStyle='#d7efb0';ctx.lineWidth=.65+clamp(Math.log1p(Math.abs(population?.bridgeUv||0))*.3,0,.7);
    for(const k of [.42,.66,.86,1]){
      ctx.globalAlpha=k===1?.6:.18;
      ctx.beginPath();ctx.ellipse(cx,cy,rx*(k+offset),ry*(k+offset),0,0,Math.PI*2);ctx.stroke();
    }
    const phase=motion?I.phaseClock(Date.now(),0,60000).phase:frozen;
    const angle=phase*Math.PI*2-Math.PI/2;
    ctx.globalAlpha=.4;ctx.strokeStyle='#def5cb';ctx.lineWidth=.8;ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+Math.cos(angle)*rx*1.1,cy+Math.sin(angle)*ry*1.1);ctx.stroke();
    const pulse=motion?1:0;
    ctx.globalAlpha=.85;ctx.fillStyle='#d9efb3';ctx.beginPath();ctx.arc(cx+Math.cos(angle)*rx*(1+offset),cy+Math.sin(angle)*ry*(1+offset),1.4+pulse*.25,0,Math.PI*2);ctx.fill();
    ctx.globalAlpha=1;
  }
  function update(){acquire();readouts();draw();}
  widget.addEventListener('zero-telemetry',update);
  widget.addEventListener('zero-weather',update);
  widget.addEventListener('zero-motion',e=>{frozen=I.phaseClock(Date.now(),0,60000).phase;motion=e.detail.motion;draw();});
  new ResizeObserver(()=>{dirty=true;draw();}).observe(canvas);
  window.ZeroUnifiedView=Object.freeze({updatePopulation:value=>{population=value;},getState:()=>({population,signal,weather})});
  setInterval(()=>{if(!widget.ownerDocument.hidden)update();},100);
  update();
})();
