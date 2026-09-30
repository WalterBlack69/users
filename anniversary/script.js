// אלמנטים צפים (לבבות, פרפרים וניצוצות) לרקע הכותרת
function floaters(host, n){
  const icons = ['♥','🦋','✦','💗','✨','🦋'];
  for(let i=0;i<n;i++){
    const h=document.createElement('span'); h.className='float'; h.textContent=icons[i%icons.length];
    h.style.left=Math.random()*100+'%'; h.style.fontSize=(14+Math.random()*30)+'px';
    h.style.animationDuration=(8+Math.random()*10)+'s'; h.style.animationDelay=(-Math.random()*14)+'s';
    host.append(h);
  }
}
// הופעה בגלילה
const io = new IntersectionObserver(es=>es.forEach(e=>e.isIntersecting&&e.target.classList.add('in')),{threshold:.15});
document.querySelectorAll('.reveal').forEach(el=>io.observe(el));

// קונפטי
function confetti(x,y){
  let c=document.getElementById('confetti');
  if(!c){c=document.createElement('canvas');c.id='confetti';document.body.append(c);}
  c.width=innerWidth;c.height=innerHeight;
  const ctx=c.getContext('2d'), cols=['#ff2d95','#ff6fb5','#ffd3ea','#c8a2ff','#fff','#ffd54f'];
  const ps=Array.from({length:110},()=>({x,y,vx:(Math.random()-.5)*14,vy:-Math.random()*14-4,r:4+Math.random()*6,c:cols[Math.random()*cols.length|0],a:Math.random()*6,va:(Math.random()-.5)*.4,life:0}));
  (function frame(){
    ctx.clearRect(0,0,c.width,c.height); let alive=false;
    ps.forEach(p=>{p.life++;p.vy+=.35;p.x+=p.vx;p.y+=p.vy;p.a+=p.va;
      if(p.y<c.height+20&&p.life<200){alive=true;ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.a);ctx.fillStyle=p.c;ctx.fillRect(-p.r,-p.r/2,p.r*2,p.r);ctx.restore();}});
    if(alive)requestAnimationFrame(frame);else ctx.clearRect(0,0,c.width,c.height);
  })();
}
