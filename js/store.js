// ---------------------------------------------------------------------------
// Local persistence: everything lives in one JSON blob in localStorage.
// Firebase sync (sync.js) mirrors this same `memory` object when enabled.
// ---------------------------------------------------------------------------
const LS_KEY = 'ballast_store_v1';
let lsOk = true;

function loadMemory(){
  try{ return JSON.parse(localStorage.getItem(LS_KEY)) || {}; }
  catch(e){ lsOk = false; return {}; }
}
function saveMemory(){
  try{ localStorage.setItem(LS_KEY, JSON.stringify(memory)); }
  catch(e){ lsOk = false; }
  if(syncEnabled) schedulePush();
}
const memory = loadMemory();

// Cross-tab sync: every open tab loads its own independent copy of `memory` at page load.

window.addEventListener('storage', (e)=>{
  if(e.key !== LS_KEY) return;
  let fresh;
  try{ fresh = e.newValue ? JSON.parse(e.newValue) : {}; }catch(err){ return; }
  Object.keys(memory).forEach(k=>delete memory[k]);
  Object.assign(memory, fresh);
  if(isTypingActive()) pendingRemoteRefresh = true;
  else loadAll();
});

// Firestore-flavored doc/collection helpers, backed by the flat `memory` object.
async function docGet(path){
  return memory[path] || null;
}
async function docSet(path, data){
  memory[path] = data; saveMemory();
}
async function colGetAll(path){
  return Object.entries(memory[path]||{}).map(([id,data])=>({id, ...data}));
}
async function colAdd(path, data){
  const id = 'local_'+Date.now()+Math.random().toString(36).slice(2,7);
  memory[path] = memory[path]||{}; memory[path][id]=data; saveMemory(); return id;
}
async function colSet(path, id, data){
  memory[path] = memory[path]||{}; memory[path][id]=data; saveMemory();
}
async function colDelete(path, id){
  if(memory[path]) { delete memory[path][id]; saveMemory(); }
}

// ---------------------------------------------------------------------------
// Date / time / formatting helpers shared by every view.
// ---------------------------------------------------------------------------
// Escape user-entered text before it goes into an innerHTML string or an HTML attribute
// (a title containing a double quote used to truncate <input value="..."> and get saved that way).
function esc(v){
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
// Only let http(s) links through — new URL('javascript:...') parses fine, so it isn't a check by itself.
function safeUrl(u){
  try{ const x = new URL(String(u||'').trim()); return (x.protocol==='https:'||x.protocol==='http:') ? x.href : ''; }
  catch(e){ return ''; }
}
function pad(n){ return String(n).padStart(2,'0'); }
function dateStrFromObj(d){ return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
function todayStr(){ return dateStrFromObj(new Date()); }
function addDays(dstr, days){ const d=new Date(dstr+'T00:00:00'); d.setDate(d.getDate()+days); return dateStrFromObj(d); }
function dayLabel(dstr){ const d=new Date(dstr+'T00:00:00'); return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]+' '+d.getDate(); }
function shortDate(dstr){ const d=new Date(dstr+'T00:00:00'); return (d.getMonth()+1)+'/'+d.getDate(); }
function hoursBetweenTimes(a,b){
  const [ah,am]=a.split(':').map(Number), [bh,bm]=b.split(':').map(Number);
  let diff = (bh*60+bm) - (ah*60+am); if(diff<=0) diff += 24*60;
  return diff/60;
}
function addMinutes(hhmm, mins){
  let [h,m]=hhmm.split(':').map(Number); let total=(h*60+m+mins)%(24*60); if(total<0) total+=24*60;
  return pad(Math.floor(total/60))+':'+pad(total%60);
}
function hoursUntilTimeToday(hhmm){
  const now = new Date(); const [h,m]=hhmm.split(':').map(Number);
  const t = new Date(now); t.setHours(h,m,0,0); if(t<=now) t.setDate(t.getDate()+1);
  return (t-now)/3600000;
}
function fmtHrs(h){ const hh=Math.floor(h), mm=Math.round((h-hh)*60); return hh+'h '+pad(mm)+'m'; }
function minutesNowInDay(){ const d=new Date(); return d.getHours()*60+d.getMinutes(); }
function toMinutes(hhmm){ const [h,m]=hhmm.split(':').map(Number); return h*60+m; }
function fmtClock(d){ let h=d.getHours(), m=d.getMinutes(); const ap=h>=12?'PM':'AM'; h=h%12; if(h===0)h=12; return h+':'+pad(m)+' '+ap; }
// B&W: the status tokens are all plain ink, so homework kinds get their own gray-coded
// dot tokens (defined per theme in others.css) — exam darkest, reading lightest.
function kindColor(kind){
  if(isBwPalette()) return kind==='exam' ? 'var(--dot-exam)' : kind==='reading' ? 'var(--dot-reading)' : 'var(--dot-hw)';
  return kind==='exam' ? 'var(--bad)' : kind==='reading' ? 'var(--good)' : 'var(--pink)';
}

// `wellnessDone`/`wellnessOverride` are mutually-exclusive facts about whether today's
// protected-time block actually happened or got moved — both feed Behavior analytics.
function defaultTodayLog(){
  return {
    energy:3, energyLog:[], commitments:[],
    priorityGoalId:'', priorityMilestoneId:'', priorityText:'', priorityStatus:'pending',
    skipReason:'', completedToday:[], tasks:[],
    // priorityStatus resets to 'pending' right after a completion (see today.js) 
    focusDoneToday:false,
    wellnessDone:false, wellnessDoneAt:'', wellnessOverride:false, wellnessOverrideReason:'',
    actualBedtime:''
  };
}

// ---------------------------------------------------------------------------
// Goal colors: a fixed 25-color palette (5x5 grid)
const GOAL_COLOR_PALETTE = [
  '#ba4545','#ba6145','#ba7d45','#ba9945','#bab545',
  '#a3ba45','#87ba45','#6aba45','#4eba45','#45ba58',
  '#45ba74','#45ba90','#45baac','#45acba','#4590ba',
  '#4574ba','#4558ba','#4e45ba','#6a45ba','#8745ba',
  '#a345ba','#ba45b5','#ba4599','#ba457d','#ba4561'
];
// A goal's color is remembered once picked (g.color, saved like any other goal field).

function resolveGoalColor(g){
  if(g && g.color && GOAL_COLOR_PALETTE.indexOf(g.color)!==-1) return g.color;
  let h = 0;
  for(const c of String((g&&g.id)||'')) h = (h*31 + c.charCodeAt(0)) >>> 0;
  return GOAL_COLOR_PALETTE[h % GOAL_COLOR_PALETTE.length];
}
// In B&W mode the 25 goal hues would all collapse to the same gray (they share one
// lightness on purpose), making goals indistinguishable on the calendar and roadmap.
// So for *display only* each palette slot maps to its own gray. Stored values (g.color)
// stay the real hex, so switching back to Color loses nothing. The stride of 7 is coprime
// with 25, so every slot gets a unique lightness and neighboring hues land far apart.
function isBwPalette(){ return document.documentElement.dataset.palette === 'bw'; }
function displayGoalColor(hex){
  if(!isBwPalette()) return hex;
  const i = GOAL_COLOR_PALETTE.indexOf(hex);
  if(i === -1) return hex;
  const lightness = 28 + ((i*7) % 25) * 2.2;   // 28% .. ~81%
  return 'hsl(38,6%,'+lightness.toFixed(1)+'%)';   // faint warm tint so dots sit naturally on the paper tone
}
