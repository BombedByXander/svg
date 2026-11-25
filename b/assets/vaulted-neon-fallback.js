(()=>{
  const running=new WeakMap();
  const chars="0123456789ABCDEF";
  const colors=["#a6f3fa","#ea6fe0","#6fd6f7","#d351b6","#5aaef0"];
  const rand=(min,max)=>min+Math.random()*(max-min);
  function mount(hero,anchor){
    if(!hero)return;
    let canvas=hero.querySelector(":scope > .vaulted-neon-overlay-canvas");
    if(canvas&&running.has(canvas))return;
    if(!canvas){canvas=document.createElement("canvas");canvas.className="vaulted-neon-overlay-canvas";canvas.setAttribute("aria-hidden","true");(hero.querySelector(".heaven-atmosphere")||anchor||hero.firstElementChild)?.after(canvas)}
    const ctx=canvas.getContext("2d",{alpha:true});if(!ctx)return;
    let raf=0,last=0,width=0,height=0,ratio=1;
    const particles=Array.from({length:440},()=>({x:0,y:0,z:rand(.8,10),speed:rand(.18,.8),glyph:chars[Math.floor(Math.random()*chars.length)],color:Math.floor(Math.random()*colors.length),phase:rand(0,Math.PI*2)}));
    const place=p=>{p.z=rand(7,10);const focal=Math.max(1,height*.64);p.x=rand(-width/(2*focal),width/(2*focal))*p.z;p.y=rand(-height/(2*focal),height/(2*focal))*p.z;p.glyph=chars[Math.floor(Math.random()*chars.length)];p.color=Math.floor(Math.random()*colors.length);p.phase=rand(0,Math.PI*2)};
    const draw=now=>{
      if(!canvas.isConnected){cancelAnimationFrame(raf);running.delete(canvas);return}
      raf=requestAnimationFrame(draw);if(document.hidden||now-last<32)return;
      const dt=Math.min(.05,(now-last||16)/1000);last=now;
      const rect=hero.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,1.5),w=Math.max(1,Math.round(rect.width*dpr)),h=Math.max(1,Math.round(rect.height*dpr));
      if(w!==width||h!==height||dpr!==ratio){width=canvas.width=w;height=canvas.height=h;ratio=dpr;for(const p of particles)place(p)}
      ctx.setTransform(ratio,0,0,ratio,0,0);
      ctx.globalCompositeOperation="destination-out";ctx.globalAlpha=.18;ctx.fillRect(0,0,rect.width,rect.height);ctx.globalAlpha=1;
      ctx.globalCompositeOperation="lighter";ctx.textAlign="center";ctx.textBaseline="middle";
      const focal=Math.max(1,rect.height*.64),depth=10;
      for(const p of particles){
        p.z-=p.speed*dt;if(p.z<.72)place(p);
        const drift=Math.sin(now*.00032+p.phase)*.045;
        const x=rect.width/2+(p.x+drift)*focal/p.z,y=rect.height/2+p.y*focal/p.z;
        if(x<-24||x>rect.width+24||y<-24||y>rect.height+24)continue;
        const nx=Math.abs(x/rect.width*2-1),ny=Math.abs(y/rect.height*2-1),edge=Math.max(nx,ny),fade=Math.max(0,Math.min(1,(1-edge)/.20));
        if(fade<=0)continue;
        const scale=Math.max(.52,Math.min(2.35,8.5+(depth-p.z)*1.65)),alpha=(.13+(depth-p.z)*.052)*fade;
        ctx.font=`500 ${scale*1.4}px ui-monospace, SFMono-Regular, Consolas, monospace`;ctx.shadowBlur=4+(depth-p.z)*1.2;ctx.shadowColor=colors[p.color];
        ctx.globalAlpha=alpha*.36;ctx.fillStyle="#ea6fe0";ctx.fillText(p.glyph,x+scale*.16,y);
        ctx.fillStyle="#6fd6f7";ctx.fillText(p.glyph,x-scale*.16,y);
        ctx.globalAlpha=alpha;ctx.fillStyle=colors[p.color];ctx.fillText(p.glyph,x,y);
      }
      ctx.globalAlpha=1;ctx.globalCompositeOperation="source-over";
    };
    running.set(canvas,()=>cancelAnimationFrame(raf));raf=requestAnimationFrame(draw);
  }
  window.VaultedNeonFallback={mount};
})();
