"use strict";
//=================== geometry ===================
const FT=11, PAD=46, W_FT=75, H_FT=62.5;
const STAGE_W=PAD*2+W_FT*FT, STAGE_H=PAD*2+H_FT*FT;
const stage=document.getElementById('stage'), itemsLayer=document.getElementById('items'), svg=document.getElementById('floorSvg');
stage.style.width=STAGE_W+'px'; stage.style.height=STAGE_H+'px';
svg.setAttribute('width',STAGE_W); svg.setAttribute('height',STAGE_H);
itemsLayer.style.cssText=`left:${PAD}px;top:${PAD}px;width:${W_FT*FT}px;height:${H_FT*FT}px`;
const px=ft=>PAD+ft*FT;

function formatFt(ft){
  let f=Math.floor(ft+1e-9), inch=Math.round((ft-f)*12);
  if(inch===12){f++;inch=0;}
  return f+'′'+(inch>0?inch+'″':'');
}

//=================== storage backends (cloud via Supabase, or local) ===================
let DB=null;   // active backend: {mode,list,save,load,remove,saveAutosave,loadAutosave}
const strip=arr=>arr.map(({id,...r})=>r);
const payload=()=>({items:strip(items),customTypes,customSeq});

let autosaveTimer=null;
function scheduleAutosave(){
  if(!DB)return;
  clearTimeout(autosaveTimer);
  autosaveTimer=setTimeout(()=>{DB.saveAutosave(payload()).catch(()=>{});}, DB.mode==='cloud'?1500:200);
}

function makeLocalDB(){
  const SAVES='epp_layouts', CUR='epp_current';
  const g=k=>{try{return JSON.parse(localStorage.getItem(k));}catch(e){return null;}};
  const s=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}};
  return {
    mode:'local',
    async list(){const o=g(SAVES)||{};return Object.keys(o).map(n=>({name:n,at:o[n].at})).sort((a,b)=>(b.at||0)-(a.at||0));},
    async save(name,data){const o=g(SAVES)||{};o[name]={data,at:Date.now()};s(SAVES,o);},
    async load(name){const o=g(SAVES)||{};return o[name]?o[name].data:null;},
    async remove(name){const o=g(SAVES)||{};delete o[name];s(SAVES,o);},
    async saveAutosave(data){s(CUR,data);},
    async loadAutosave(){return g(CUR);}
  };
}
function makeCloudDB(sb,uid){
  const T='layouts';
  return {
    mode:'cloud',
    async list(){
      const {data,error}=await sb.from(T).select('name,updated_at').eq('user_id',uid).eq('is_autosave',false).order('updated_at',{ascending:false});
      if(error)throw error; return data.map(r=>({name:r.name,at:Date.parse(r.updated_at)}));
    },
    async save(name,data){
      const {error}=await sb.from(T).upsert({user_id:uid,name,data,is_autosave:false,updated_at:new Date().toISOString()},{onConflict:'user_id,name'});
      if(error)throw error;
    },
    async load(name){
      const {data,error}=await sb.from(T).select('data').eq('user_id',uid).eq('name',name).maybeSingle();
      if(error)throw error; return data?data.data:null;
    },
    async remove(name){
      const {error}=await sb.from(T).delete().eq('user_id',uid).eq('name',name);
      if(error)throw error;
    },
    async saveAutosave(data){
      const {error}=await sb.from(T).upsert({user_id:uid,name:'__autosave__',data,is_autosave:true,updated_at:new Date().toISOString()},{onConflict:'user_id,name'});
      if(error)throw error;
    },
    async loadAutosave(){
      const {data,error}=await sb.from(T).select('data').eq('user_id',uid).eq('is_autosave',true).maybeSingle();
      if(error)throw error; return data?data.data:null;
    }
  };
}

//=================== types ===================
const BUILTIN={
  dining:{label:'Dining\n(seats 10)',w:8,h:7,cls:'f-dining',inv:'dining',seats:10,chairs:10},
  table8:{label:'8′ table',w:8,h:2.5,cls:'f-table8',inv:'dining'},
  sofa:{label:'Sofa',w:7,h:3,cls:'f-sofa',inv:'sofa',seats:3},
  coffee:{label:'Coffee',w:3.5,h:2,cls:'f-coffee',inv:'coffee'},
  cocktail:{label:'Hi-top',w:3,h:3,cls:'f-cocktail',inv:'cocktail'},
  six:{label:'Buffet 6′',w:6,h:2.5,cls:'f-buffet',inv:'six'},
  four:{label:'Buffet 4′',w:4,h:2.5,cls:'f-buffet',inv:'four'},
  cooler:{label:'Cooler',w:3,h:1.8,cls:'f-cooler',inv:'cooler'},
  tub:{label:'Ice tub',w:1.9,h:1.5,cls:'f-tub',inv:'tub'},
  zone:{label:'Dance / Mingle',w:13,h:6.5,cls:'f-zone',inv:null}
};
const BUILTIN_INV={
  dining:{name:'8-foot tables',total:12,swatch:'var(--c-dining)'},
  sofa:{name:'Plush sofas',total:4,swatch:'var(--c-sofa)'},
  coffee:{name:'Coffee tables',total:4,swatch:'var(--c-coffee)'},
  cocktail:{name:'Cocktail hi-tops',total:6,swatch:'var(--c-cocktail)'},
  six:{name:'6-foot table',total:1,swatch:'var(--c-buffet)'},
  four:{name:'4-foot tables',total:2,swatch:'var(--c-buffet)'},
  cooler:{name:'120 qt cooler',total:1,swatch:'var(--c-cooler)'},
  tub:{name:'Ice tubs (25 qt)',total:2,swatch:'var(--c-tub)'}
};
// inventory lines (counts) + which placeable types add to them
const INV_DEFS=[
  {key:'dining',adds:[{type:'dining',glyph:'＋',title:'Add dining table (10 seats)'},{type:'table8',glyph:'▭',title:'Add plain 8-foot table'}]},
  {key:'sofa',adds:[{type:'sofa',glyph:'＋',title:'Add sofa'}]},
  {key:'coffee',adds:[{type:'coffee',glyph:'＋',title:'Add coffee table'}]},
  {key:'cocktail',adds:[{type:'cocktail',glyph:'＋',title:'Add cocktail hi-top'}]},
  {key:'six',adds:[{type:'six',glyph:'＋',title:'Add 6-foot table'}]},
  {key:'four',adds:[{type:'four',glyph:'＋',title:'Add 4-foot table'}]},
  {key:'cooler',adds:[{type:'cooler',glyph:'＋',title:'Add cooler'}]},
  {key:'tub',adds:[{type:'tub',glyph:'＋',title:'Add ice tub'}]}
];

let customTypes={};        // id -> {label,w,h,shape,color,seats,total}
let customSeq=0;
const getType=id=>BUILTIN[id]||customTypes[id];
const invKeyOf=id=>customTypes[id]?id:(BUILTIN[id]?BUILTIN[id].inv:null);
function newCustomId(){return 'c'+(++customSeq);}

//=================== recommended layout (90 seats) ===================
function recommended(){
  return [
    {type:'sofa',x:6,y:4.5},{type:'sofa',x:6,y:8},{type:'coffee',x:13.5,y:6.5},{type:'coffee',x:13.5,y:9},
    {type:'sofa',x:6,y:51},{type:'sofa',x:6,y:55},{type:'coffee',x:13.5,y:52.5},{type:'coffee',x:13.5,y:55},
    {type:'dining',x:8,y:13},{type:'dining',x:21,y:13},{type:'dining',x:8,y:23},{type:'dining',x:21,y:23},
    {type:'dining',x:8,y:33},{type:'dining',x:21,y:33},{type:'dining',x:43,y:15},{type:'dining',x:43,y:24},{type:'dining',x:43,y:33},
    {type:'table8',x:43,y:42,name:'Bar'},{type:'table8',x:39,y:7,name:'Gift / Welcome'},
    {type:'cocktail',x:15,y:42},{type:'cocktail',x:15,y:46},{type:'cocktail',x:49,y:5},{type:'cocktail',x:49,y:9},
    {type:'six',x:42,y:50,name:'Buffet'},{type:'four',x:42,y:53},{type:'four',x:42,y:56},
    {type:'cooler',x:47.5,y:53},{type:'tub',x:47.5,y:55.4},{type:'tub',x:49.4,y:55.4},
    {type:'zone',x:28,y:41.5}
  ];
}

//=================== state ===================
let items=[], selId=null, uid=1;

function setState(layout,custom){
  customTypes=custom?JSON.parse(JSON.stringify(custom)):{};
  customSeq=Object.keys(customTypes).reduce((m,k)=>Math.max(m,+k.slice(1)||0),0);
  items=layout.map(o=>({id:uid++,rot:0,...o})).filter(it=>getType(it.type));
  selId=null; renderAll();
}

//=================== render ===================
function describe(it){
  const t=getType(it.type);
  const nm=it.name||t.label.replace(/\n/g,' ');
  return `${nm} · ${formatFt(t.w)} × ${formatFt(t.h)}${t.seats?` · ${t.seats} seats`:''}`;
}
function buildItemEl(it){
  const t=getType(it.type), el=document.createElement('div');
  const isCustom=!!customTypes[it.type];
  el.className='item '+(isCustom?'f-custom':t.cls);
  el.dataset.id=it.id;
  el.style.width=(t.w*FT)+'px'; el.style.height=(t.h*FT)+'px';
  el.title=describe(it);
  const label=(it.name||t.label);
  let inner='';
  if(it.type==='dining'){
    const tblTop=(t.h-2.5)/2*FT;
    inner+=`<div class="tbl" style="top:${tblTop}px;width:${t.w*FT}px;height:${2.5*FT}px"></div>`;
    const per=5,cw=1.0*FT,ch=1.25*FT,gap=(t.w-per*1.0)/(per+1)*FT;
    for(let r=0;r<2;r++){const cy=r===0?0.2*FT:(t.h-1.45)*FT;
      for(let i=0;i<per;i++){inner+=`<div class="ch" style="left:${gap+i*(cw+gap)}px;top:${cy}px;width:${cw}px;height:${ch}px"></div>`;}}
    inner+=`<div class="lbl">${label.replace(/\n/g,'<br>')}</div>`;
  }else if(it.type==='sofa'){
    inner=`<div class="shape"></div><div class="back"></div><div class="lbl">${label}</div>`;
  }else if(isCustom){
    const rad=t.shape==='circle'?'50%':'4px';
    inner=`<div class="shape" style="background:${t.color};border:1px solid rgba(0,0,0,.22);border-radius:${rad}"></div><div class="lbl">${label}</div>`;
  }else{
    inner=`<div class="shape"></div><div class="lbl">${label.replace(/\n/g,'<br>')}</div>`;
  }
  el.innerHTML=inner; applyT(el,it);
  if(it.id===selId)el.classList.add('sel');
  return el;
}
function applyT(el,it){el.style.left=(it.x*FT)+'px';el.style.top=(it.y*FT)+'px';el.style.transform=`rotate(${it.rot}deg)`;}
function renderAll(){
  itemsLayer.innerHTML='';
  items.filter(i=>i.type==='zone').forEach(i=>itemsLayer.appendChild(buildItemEl(i)));
  items.filter(i=>i.type!=='zone').forEach(i=>itemsLayer.appendChild(buildItemEl(i)));
  updateSidebar(); updateActionbar(); scheduleAutosave();
}

//=================== counts + inventory UI ===================
function counts(){
  const c={}, res={seats:0,chairs:0};
  items.forEach(it=>{const t=getType(it.type),k=invKeyOf(it.type);
    if(k)c[k]=(c[k]||0)+1; if(t.seats)res.seats+=t.seats; if(t.chairs)res.chairs+=t.chairs;});
  res.c=c; return res;
}
function updateSidebar(){
  const {c,seats,chairs}=counts();
  document.getElementById('seatCount').textContent=seats;
  document.getElementById('chairCount').textContent=chairs+' / 100';
  const box=document.getElementById('inventory'); box.innerHTML='';
  const lines=[];
  INV_DEFS.forEach(d=>{const m=BUILTIN_INV[d.key];
    lines.push({key:d.key,name:m.name,total:m.total,swatch:m.swatch,adds:d.adds,removable:false});});
  Object.keys(customTypes).forEach(id=>{const t=customTypes[id];
    lines.push({key:id,name:t.label,total:t.total,swatch:t.color,adds:[{type:id,glyph:'＋',title:'Add '+t.label}],removable:true});});
  lines.forEach(L=>{
    const used=c[L.key]||0, over=used>L.total, disabled=used>=L.total;
    const row=document.createElement('div'); row.className='inv-row';
    let btns=L.adds.map(a=>`<button class="addbtn" data-type="${a.type}" title="${a.title}" ${disabled?'disabled':''}>${a.glyph}</button>`).join('');
    if(L.removable)btns+=`<button class="xbtn" data-del="${L.key}" title="Remove this item type">✕</button>`;
    row.innerHTML=`<span class="swatch" style="background:${L.swatch}"></span>
      <span class="inv-name" title="${L.name}">${L.name}</span>
      <span class="inv-count ${over?'over':''}">${used} / ${L.total}</span>${btns}`;
    box.appendChild(row);
  });
  box.querySelectorAll('.addbtn').forEach(b=>b.onclick=()=>addItem(b.dataset.type));
  box.querySelectorAll('.xbtn').forEach(b=>b.onclick=()=>removeCustomType(b.dataset.del));
}

//=================== selection / actions ===================
function select(id){selId=id;
  itemsLayer.querySelectorAll('.item').forEach(el=>el.classList.toggle('sel',+el.dataset.id===id));
  updateActionbar();}
function updateActionbar(){
  const it=items.find(i=>i.id===selId), on=!!it;
  document.getElementById('selName').textContent=it?describe(it):'nothing';
  ['rotBtn','rot15Btn','dupBtn','delBtn'].forEach(id=>document.getElementById(id).disabled=!on);
}
function addItem(type){const t=getType(type); if(!t)return;
  const n=items.filter(i=>i.type===type).length;
  const it={id:uid++,type,x:Math.min(W_FT-t.w-1,30+(n%5)*1.5),y:28+(n%5)*1.5,rot:0};
  items.push(it); renderAll(); select(it.id);}
function duplicate(){const it=items.find(i=>i.id===selId); if(!it)return;
  const copy={...it,id:uid++,x:it.x+2,y:it.y+2}; items.push(copy); renderAll(); select(copy.id);}
function del(){items=items.filter(i=>i.id!==selId); selId=null; renderAll();}
function rotate(d){const it=items.find(i=>i.id===selId); if(!it)return; it.rot=(it.rot+d)%360;
  const el=itemsLayer.querySelector(`[data-id="${it.id}"]`); if(el)applyT(el,it); scheduleAutosave();}
function removeCustomType(id){
  if(items.some(i=>i.type===id) && !confirm('Remove this item type and all '+customTypes[id].label+' placed on the floor?'))return;
  items=items.filter(i=>i.type!==id); delete customTypes[id]; renderAll(); toast('Item type removed');
}

document.getElementById('rotBtn').onclick=()=>rotate(90);
document.getElementById('rot15Btn').onclick=()=>rotate(15);
document.getElementById('dupBtn').onclick=duplicate;
document.getElementById('delBtn').onclick=del;
document.getElementById('resetBtn').onclick=()=>{setState(recommended(),{});toast('Recommended layout loaded');};
document.getElementById('clearBtn').onclick=()=>{if(confirm('Clear all furniture from the floor?')){setState([],customTypes);toast('Floor cleared');}};
document.getElementById('printBtn').onclick=()=>window.print();

//=================== custom item form ===================
document.getElementById('ciAdd').onclick=()=>{
  const name=document.getElementById('ciName').value.trim();
  const w=parseFloat(document.getElementById('ciW').value), h=parseFloat(document.getElementById('ciH').value);
  const shape=document.getElementById('ciShape').value, color=document.getElementById('ciColor').value;
  const seats=parseInt(document.getElementById('ciSeats').value)||0, qty=parseInt(document.getElementById('ciQty').value)||1;
  if(!name){toast('Give the item a name');return;}
  if(!(w>0)||!(h>0)){toast('Width and depth must be greater than 0');return;}
  const id=newCustomId();
  customTypes[id]={label:name,w,h,shape,color,seats,total:qty};
  document.getElementById('ciName').value='';
  updateSidebar(); scheduleAutosave(); toast('Added "'+name+'" to inventory');
};

//=================== dragging ===================
let drag=null;
itemsLayer.addEventListener('pointerdown',e=>{
  const el=e.target.closest('.item'); if(!el)return;
  const id=+el.dataset.id; select(id);
  const it=items.find(i=>i.id===id);
  drag={id,sx:e.clientX,sy:e.clientY,ox:it.x,oy:it.y,el};
  el.setPointerCapture(e.pointerId); hideTip(); e.preventDefault();
});
itemsLayer.addEventListener('pointermove',e=>{
  if(!drag)return; const it=items.find(i=>i.id===drag.id); if(!it)return;
  let nx=drag.ox+(e.clientX-drag.sx)/FT, ny=drag.oy+(e.clientY-drag.sy)/FT;
  if(snap){nx=Math.round(nx);ny=Math.round(ny);}
  const t=getType(it.type);
  nx=Math.max(-1,Math.min(W_FT-t.w+1,nx)); ny=Math.max(-1,Math.min(H_FT-t.h+1,ny));
  it.x=nx; it.y=ny; applyT(drag.el,it); updateActionbar();
});
function endDrag(){if(drag){drag=null; scheduleAutosave();}}
itemsLayer.addEventListener('pointerup',endDrag);
itemsLayer.addEventListener('pointercancel',endDrag);
stage.addEventListener('pointerdown',e=>{if(e.target===stage||e.target===svg)select(null);});

//=================== tooltip ===================
const tip=document.getElementById('tip');
function showTip(txt,x,y){tip.textContent=txt;tip.style.left=(x+14)+'px';tip.style.top=(y+14)+'px';tip.style.opacity='1';}
function hideTip(){tip.style.opacity='0';}
itemsLayer.addEventListener('pointermove',e=>{
  if(drag||e.pointerType==='touch')return;
  const el=e.target.closest('.item');
  if(el){const it=items.find(i=>i.id===+el.dataset.id); if(it)showTip(describe(it),e.clientX,e.clientY);}
  else hideTip();
});
itemsLayer.addEventListener('pointerleave',hideTip);

//=================== keyboard ===================
let snap=false;
document.addEventListener('keydown',e=>{
  if(/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName))return;
  if(!selId)return; const it=items.find(i=>i.id===selId); if(!it)return;
  const el=itemsLayer.querySelector(`[data-id="${it.id}"]`), step=e.shiftKey?5:1;
  if(e.key==='ArrowLeft'){it.x-=step;}
  else if(e.key==='ArrowRight'){it.x+=step;}
  else if(e.key==='ArrowUp'){it.y-=step;}
  else if(e.key==='ArrowDown'){it.y+=step;}
  else if(e.key==='r'||e.key==='R'){rotate(90);return;}
  else if(e.key==='Delete'||e.key==='Backspace'){del();return;}
  else return;
  e.preventDefault(); if(el)applyT(el,it); updateActionbar(); scheduleAutosave();
});

//=================== toggles ===================
document.getElementById('snapToggle').onchange=e=>snap=e.target.checked;
document.getElementById('dimToggle').onchange=drawFloor;
document.getElementById('gridToggle').onchange=drawFloor;

//=================== save / load (backed by DB) ===================
async function renderSaves(){
  const box=document.getElementById('savesList');
  if(!DB){box.innerHTML='<div class="empty">Sign in to see saved layouts.</div>';return;}
  let list;
  try{list=await DB.list();}catch(e){box.innerHTML='<div class="empty">Could not load saved layouts.</div>';return;}
  if(!list.length){box.innerHTML='<div class="empty">No saved layouts yet.</div>';return;}
  box.innerHTML='';
  list.forEach(({name:nm,at})=>{
    const ds=at?new Date(at).toLocaleDateString(undefined,{month:'short',day:'numeric'}):'';
    const row=document.createElement('div'); row.className='save-row';
    row.innerHTML=`<span class="save-name" title="Load ${nm}">${nm}</span>
      <span class="save-date">${ds}</span>
      <button class="mini load">Load</button>
      <button class="mini x rm">✕</button>`;
    row.querySelector('.save-name').onclick=()=>loadSave(nm);
    row.querySelector('.load').onclick=()=>loadSave(nm);
    row.querySelector('.rm').onclick=async()=>{try{await DB.remove(nm);await renderSaves();toast('Deleted "'+nm+'"');}catch(e){toast('Delete failed');}};
    box.appendChild(row);
  });
}
async function saveLayout(name){
  if(!DB){toast('Sign in first to save');return;}
  try{
    const exists=(await DB.list()).some(x=>x.name===name);
    if(exists&&!confirm('Overwrite "'+name+'"?'))return;
    await DB.save(name,payload());
    await renderSaves(); toast('Saved "'+name+'"');
  }catch(e){toast('Save failed: '+(e.message||e));}
}
async function loadSave(name){
  if(!DB)return;
  try{
    const data=await DB.load(name); if(!data)return;
    customSeq=data.customSeq||customSeq; setState(data.items,data.customTypes||{}); toast('Loaded "'+name+'"');
  }catch(e){toast('Load failed');}
}
document.getElementById('saveBtn').onclick=()=>{
  const i=document.getElementById('saveName'); const nm=i.value.trim();
  if(!nm){toast('Type a name first');i.focus();return;} saveLayout(nm); i.value='';};

document.getElementById('exportBtn').onclick=()=>{
  const data={app:'party-floor-planner',version:1,items:strip(items),customTypes};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='party-layout-'+new Date().toISOString().slice(0,10)+'.json';
  a.click(); URL.revokeObjectURL(a.href); toast('Layout exported');
};
document.getElementById('importBtn').onclick=()=>document.getElementById('importInput').click();
document.getElementById('importInput').onchange=e=>{
  const f=e.target.files[0]; if(!f)return;
  const r=new FileReader();
  r.onload=()=>{try{const d=JSON.parse(r.result);
    if(!Array.isArray(d.items))throw 0;
    setState(d.items,d.customTypes||{}); toast('Imported '+f.name);
  }catch(err){toast('That file could not be read as a layout');}};
  r.readAsText(f); e.target.value='';
};

//=================== toast ===================
let toastTimer=null;
function toast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),2200);}

//=================== floor plan SVG (fixed structure) ===================
function rect(x,y,w,h,o={}){o={fill:'var(--blue-fill)',stroke:'var(--blue)',sw:1.4,rx:2,...o};
  return `<rect x="${px(x)}" y="${px(y)}" width="${w*FT}" height="${h*FT}" rx="${o.rx}" fill="${o.fill}" stroke="${o.stroke}" stroke-width="${o.sw}"/>`;}
function txt(x,y,s,o={}){o={size:10,fill:'var(--blue)',weight:600,anchor:'middle',...o};
  return `<text x="${px(x)}" y="${px(y)}" font-size="${o.size}" fill="${o.fill}" font-weight="${o.weight}" text-anchor="${o.anchor}" font-family="Segoe UI,system-ui,sans-serif" dominant-baseline="middle">${s}</text>`;}
function line(x1,y1,x2,y2,o={}){o={stroke:'var(--blue)',sw:1,...o};
  return `<line x1="${px(x1)}" y1="${px(y1)}" x2="${px(x2)}" y2="${px(y2)}" stroke="${o.stroke}" stroke-width="${o.sw}"/>`;}

function drawFloor(){
  const showDim=document.getElementById('dimToggle').checked, showGrid=document.getElementById('gridToggle').checked;
  let s='';
  if(showGrid){for(let g=0;g<=W_FT;g+=5)s+=line(g,0,g,H_FT,{stroke:'var(--grid)',sw:.6});
    for(let g=0;g<=H_FT;g+=5)s+=line(0,g,W_FT,g,{stroke:'var(--grid)',sw:.6});}
  const wall=[[12,3],[71,3],[71,59.5],[12,59.5],[4,51],[4,11]];
  s+=`<polygon points="${wall.map(p=>px(p[0])+','+px(p[1])).join(' ')}" fill="#fff" stroke="var(--ink)" stroke-width="2.4"/>`;
  s+=`<polygon points="${[[12.6,3.7],[70.3,3.7],[70.3,58.8],[12.6,58.8],[4.8,51],[4.8,11.4]].map(p=>px(p[0])+','+px(p[1])).join(' ')}" fill="none" stroke="var(--ink)" stroke-width="0.8" opacity=".5"/>`;
  s+=`<polygon points="${px(4)},${px(3)} ${px(12)},${px(3)} ${px(4)},${px(11)}" fill="rgba(47,93,138,.07)" stroke="var(--blue)" stroke-width="1"/>`;
  s+=txt(7,6,'ROOF',{size:7})+txt(7,8,'BELOW',{size:7});
  s+=`<polygon points="${px(4)},${px(59.5)} ${px(12)},${px(59.5)} ${px(4)},${px(51)}" fill="rgba(47,93,138,.07)" stroke="var(--blue)" stroke-width="1"/>`;
  s+=txt(7,55,'ROOF',{size:7})+txt(7,57,'BELOW',{size:7});
  s+=rect(71,22,3.4,18,{fill:'rgba(47,93,138,.07)',sw:1})+txt(72.7,28,'ROOF',{size:6.5})+txt(72.7,30,'BELOW',{size:6.5});
  // top cores
  s+=rect(20,4,5,6)+rect(25.5,4,5,6);
  s+=line(20,4,25,10,{sw:.8})+line(20,10,25,4,{sw:.8})+line(25.5,4,30.5,10,{sw:.8})+line(25.5,10,30.5,4,{sw:.8});
  s+=txt(25.3,12,'ELEVATORS',{size:7});
  s+=rect(31.5,4,6,9)+txt(34.5,6,'STAIRS',{size:6.5})+txt(34.5,8,'UP / DN',{size:6});
  s+=rect(52,4,8,11,{fill:'#fff'})+txt(56,9.5,'BATHRM',{size:7});
  s+=rect(60,4,6,11,{fill:'#fff'})+txt(63,9.5,'BATHRM',{size:7});
  s+=rect(66,4,5,11,{fill:'#fff'})+txt(68.5,9.5,'PANTRY',{size:7});
  s+=txt(60,2,'fridge · freezer · microwave in pantry',{size:7,fill:'#9a9484',weight:400});
  // bottom cores
  s+=rect(20,52.5,5,6)+rect(25.5,52.5,5,6);
  s+=line(20,52.5,25,58.5,{sw:.8})+line(20,58.5,25,52.5,{sw:.8})+line(25.5,52.5,30.5,58.5,{sw:.8})+line(25.5,58.5,30.5,52.5,{sw:.8});
  s+=txt(25.3,51,'ELEVATORS',{size:7});
  s+=rect(31.5,50,6,9.5)+txt(34.5,53,'STAIRS',{size:6.5})+txt(34.5,55,'DN / UP',{size:6});
  s+=rect(52,49,9,10.5,{fill:'#fff'})+txt(56.5,53,'Employee',{size:7})+txt(56.5,55,'Only Zone',{size:7});
  s+=rect(61,49,10,10.5,{fill:'#fff'})+txt(66,53,'Dressing',{size:7})+txt(66,55,'Suite',{size:7});
  // columns
  [[19.5,20.5],[35.5,20.5],[52,20.5],[19.5,42],[35.5,42],[52,42]].forEach(c=>
    s+=`<rect x="${px(c[0])-5}" y="${px(c[1])-5}" width="10" height="10" fill="var(--ink)" opacity=".55"/>`);
  // dimensions
  if(showDim){
    const dy=-2.4;
    s+=line(0,dy-2,W_FT,dy-2,{sw:.8})+txt(W_FT/2,dy-3.4,"75'-0\"",{size:9});
    const xb=[0,19.5,35.67,52.17,75],labs=["19'-6\"","16'-2\"","16'-6\"","22'-10\""];
    xb.forEach(x=>s+=line(x,dy-2,x,dy,{sw:.8})); s+=line(0,dy,W_FT,dy,{sw:.8});
    for(let i=0;i<labs.length;i++)s+=txt((xb[i]+xb[i+1])/2,dy-1,labs[i],{size:8});
    const lx=-3.2;
    s+=line(lx,0,lx,H_FT,{sw:.8})+`<text x="${px(lx)-4}" y="${px(H_FT/2)}" font-size="9" fill="var(--blue)" font-weight="600" text-anchor="middle" font-family="Segoe UI,sans-serif" transform="rotate(-90 ${px(lx)-4} ${px(H_FT/2)})">62'-6"</text>`;
    const yb=[0,20.5,42.17,62.5],llabs=["20'-6\"","21'-8\"","20'-4\""],lx2=-1.4;
    yb.forEach(y=>s+=line(lx2-1.4,y,lx2,y,{sw:.8})); s+=line(lx2,0,lx2,H_FT,{sw:.8});
    for(let i=0;i<llabs.length;i++){const ym=(yb[i]+yb[i+1])/2;
      s+=`<text x="${px(lx2)-3}" y="${px(ym)}" font-size="8" fill="var(--blue)" font-weight="600" text-anchor="middle" font-family="Segoe UI,sans-serif" transform="rotate(-90 ${px(lx2)-3} ${px(ym)})">${llabs[i]}</text>`;}
  }
  s+=txt(W_FT/2,H_FT+3.2,'10TH FLOOR · SCALE 1/8" = 1\'-0"',{size:9,fill:'var(--ink)'});
  svg.innerHTML=s;
}

//=================== auth + boot ===================
let sb=null, configured=false, localChosen=false, curUid=null;
const $id=id=>document.getElementById(id);
function isConfigured(){const c=window.SUPABASE_CONFIG||{};return !!(c.url&&c.anonKey&&!/YOUR-/.test(c.url)&&!/YOUR-/.test(c.anonKey));}
function authMsg(m){$id('authMsg').textContent=m||'';}
function showGate(){$id('authOverlay').style.display='flex';}
function hideGate(){$id('authOverlay').style.display='none';}

function setBanner(kind){
  const b=$id('banner'), sm=$id('storeMode');
  if(!kind){b.style.display='none'; sm.textContent=(DB&&DB.mode==='cloud')?'(cloud)':''; return;}
  b.style.display='block';
  if(kind==='configure'){sm.textContent='(local)'; b.innerHTML='Login &amp; cloud sync aren\'t set up yet — add your Supabase keys in <b>config.js</b> (see README). Saving locally in this browser for now.';}
  else if(kind==='local'){sm.textContent='(local)'; b.innerHTML='Local-only mode — layouts save in this browser. '+(configured?'<a href="#" id="reSignIn">Sign in</a> for cloud sync across devices.':''); const r=$id('reSignIn'); if(r)r.onclick=e=>{e.preventDefault(); localChosen=false; showGate();};}
}

async function loadInitial(){
  let data=null;
  try{data=await DB.loadAutosave();}catch(e){}
  if(data&&Array.isArray(data.items)){customSeq=data.customSeq||0; setState(data.items,data.customTypes||{});}
  else setState(recommended(),{});
  await renderSaves();
}
async function enterCloud(session){
  curUid=session.user.id; hideGate(); DB=makeCloudDB(sb,curUid);
  $id('userBar').style.display='flex'; $id('userEmail').textContent=session.user.email||'signed in';
  setBanner(false); await loadInitial();
}
function enterLocal(reason){
  localChosen=(reason==='chosen'); hideGate(); DB=makeLocalDB(); curUid=null;
  $id('userBar').style.display='none';
  setBanner(reason==='chosen'?'local':'configure'); loadInitial();
}
function onAuth(session){
  if(localChosen)return;
  if(session){ if(DB&&DB.mode==='cloud'&&curUid===session.user.id)return; enterCloud(session); }
  else { DB=null; curUid=null; $id('userBar').style.display='none'; showGate(); }
}
function wireAuth(){
  $id('signInBtn').onclick=async()=>{const e=$id('authEmail').value.trim(),p=$id('authPass').value;
    if(!e||!p){authMsg('Enter your email and password');return;} authMsg('Signing in…');
    const {error}=await sb.auth.signInWithPassword({email:e,password:p}); if(error)authMsg(error.message);};
  $id('signUpBtn').onclick=async()=>{const e=$id('authEmail').value.trim(),p=$id('authPass').value;
    if(!e||!p){authMsg('Enter an email and a password (6+ characters)');return;} authMsg('Creating your account…');
    const {data,error}=await sb.auth.signUp({email:e,password:p});
    if(error){authMsg(error.message);return;}
    if(!data.session)authMsg('Account created. Check your email to confirm, then sign in.');};
  $id('localOnlyBtn').onclick=()=>enterLocal('chosen');
  $id('signOutBtn').onclick=async()=>{try{if(sb)await sb.auth.signOut();}catch(e){} localChosen=false; $id('userBar').style.display='none'; showGate();};
}

async function boot(){
  drawFloor(); wireAuth();
  configured=isConfigured()&&typeof supabase!=='undefined';
  if(!configured){enterLocal('not-configured');return;}
  sb=supabase.createClient(window.SUPABASE_CONFIG.url,window.SUPABASE_CONFIG.anonKey);
  sb.auth.onAuthStateChange((_ev,session)=>onAuth(session));
  try{const {data}=await sb.auth.getSession(); onAuth(data.session);}catch(e){enterLocal('not-configured');}
}
boot();