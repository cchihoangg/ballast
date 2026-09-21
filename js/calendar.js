// ---------------------------------------------------------------------------
// Calendar tab: one view combining three things that used to live separately —
//   - the roadmap's goal/milestone date spans
//   - ad-hoc commitments, but plannable
//   - the "one thing" streak, as a heatmap toggle 
// Month view shows day-level detail; Year view shows week-level detail.
// ---------------------------------------------------------------------------
let calZoom = 'month';   // 'month' | 'year'
let calMode = 'plan';    // 'plan' | 'streak'
let calCursor = new Date();
let calDayModalDate = null;

// Day-level view only concerns classes — they have real per-day due dates ("dl"). 
function goalsActiveOn(dateStr, onlyClass){
  // Plain YYYY-MM-DD strings compare lexicographically the same as chronologically.
  return state.goals.filter(g => g.start && g.end && dateStr>=g.start && dateStr<=g.end && (!onlyClass || g.type==='class'));
}
function milestoneMarkersByDate(onlyClass){
  // Class milestones have a real dueDate; project milestones only have a computed week
 
  const map = {};
  state.goals.forEach(g=>{
    if(onlyClass && g.type!=='class') return;
    if(!g.start) return;
    computeMilestoneWeeks(g).forEach(m=>{
      const ds = (g.type==='class' && m.dueDate) ? m.dueDate : addDays(g.start, m.week*7);
      if(!ds) return;
      map[ds] = map[ds] || [];
      map[ds].push({goal:g, milestone:m});
    });
  });
  return map;
}
async function fetchLogsRange(startStr, endStr){
  const dates = [];
  let d = new Date(startStr+'T00:00:00');
  const end = new Date(endStr+'T00:00:00');
  while(d<=end){ dates.push(dateStrFromObj(d)); d.setDate(d.getDate()+1); }
  const logs = await Promise.all(dates.map(ds=>docGet('dailyLogs/'+ds)));
  const out = {};
  dates.forEach((ds,i)=>{ out[ds]=logs[i]; });
  return out;
}

async function renderCalendar(){
  const wrap = document.getElementById('calendarGrid');
  if(!wrap) return;
  document.getElementById('calZoomMonth').classList.toggle('active', calZoom==='month');
  document.getElementById('calZoomYear').classList.toggle('active', calZoom==='year');
  document.getElementById('calModePlan').classList.toggle('active', calMode==='plan');
  document.getElementById('calModeStreak').classList.toggle('active', calMode==='streak');
  const hint = document.getElementById('calHint');
  if(hint){
    hint.textContent = calMode==='plan'
      ? 'Dots show classes due or ongoing that day — click any day to plan "something else" ahead of time, or switch to Year to see project spans by week.'
      : (isBwPalette()
          ? 'Shaded = you finished your one thing that day, striped = skipped. Same data as Behavior, laid out on a calendar instead of a 14-day window.'
          : 'Green = you finished your one thing that day, red = skipped. Same data as Behavior, laid out on a calendar instead of a 14-day window.');
  }
  if(calZoom==='month') await renderCalendarMonth(wrap);
  else await renderCalendarYear(wrap);
}


async function renderCalendarMonth(wrap){
  const year = calCursor.getFullYear(), month = calCursor.getMonth();
  document.getElementById('calLabel').textContent = calCursor.toLocaleDateString(undefined,{month:'long', year:'numeric'});
  const first = new Date(year, month, 1);
  const gridStart = new Date(year, month, 1 - first.getDay());
  const gridEnd = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate()+41);
  const gridStartStr = dateStrFromObj(gridStart), gridEndStr = dateStrFromObj(gridEnd);
  const logs = await fetchLogsRange(gridStartStr, gridEndStr);
  const milestoneMap = milestoneMarkersByDate(true); // classes only, for the reasons above
  const todayS = todayStr();

  wrap.innerHTML = '';
  const grid = document.createElement('div'); grid.className='cal-month-grid';
  ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(d=>{
    const h=document.createElement('div'); h.className='cal-dow'; h.textContent=d; grid.appendChild(h);
  });
  for(let i=0;i<42;i++){
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate()+i);
    const ds = dateStrFromObj(d);
    const cell = document.createElement('div');
    cell.className = 'cal-day cal-clickable'+(d.getMonth()!==month?' outside':'')+(ds===todayS?' today':'');
    const num = document.createElement('div'); num.className='cal-day-num'; num.textContent=d.getDate();
    cell.appendChild(num);

    if(calMode==='plan'){
      const active = goalsActiveOn(ds, true); // classes only — see note above renderCalendarMonth
      if(active.length){
        
        const dots = document.createElement('div'); dots.className='cal-day-dots';
        active.forEach(g=>{
          const dot=document.createElement('span'); dot.className='cal-day-dot'; dot.style.background=displayGoalColor(resolveGoalColor(g)); dot.title=g.title||'untitled';
          dots.appendChild(dot);
        });
        cell.appendChild(dots);
      }
      if(milestoneMap[ds] && milestoneMap[ds].length){
        const dot=document.createElement('div'); dot.className='cal-milestone-dot';
        dot.title = milestoneMap[ds].map(x=>(x.goal.title||'')+' — '+(x.milestone.title||'untitled')).join('\n');
        cell.appendChild(dot);
      }
      const log = logs[ds];
      const hrs = log && Array.isArray(log.commitments) ? log.commitments.reduce((s,c)=>s+(Number(c.hours)||0),0) : 0;
      if(hrs>0){
        const badge=document.createElement('div'); badge.className='cal-hours-badge'; badge.textContent=fmtHrs(hrs)+' planned';
        cell.appendChild(badge);
      }
    } else {
      const eff = ds<=todayS ? focusEffectiveStatus(logs[ds]) : '';
      if(eff==='done') cell.classList.add('cal-status-done');
      else if(eff==='skipped') cell.classList.add('cal-status-skipped');
    }
    cell.addEventListener('click', ()=>openCalendarDayPanel(ds));
    grid.appendChild(cell);
  }
  wrap.appendChild(grid);
}

async function renderCalendarYear(wrap){
  const year = calCursor.getFullYear();
  document.getElementById('calLabel').textContent = String(year);
  const logs = await fetchLogsRange(year+'-01-01', year+'-12-31');
  const milestoneMap = milestoneMarkersByDate(); // both classes and projects — week-level suits projects fine
  const todayS = todayStr();

  wrap.innerHTML = '';
  const yearGrid = document.createElement('div'); yearGrid.className='cal-year-grid';
  for(let m=0;m<12;m++){
    const block = document.createElement('div'); block.className='cal-year-month';
    const title = document.createElement('div'); title.className='cal-year-month-title';
    title.textContent = new Date(year,m,1).toLocaleDateString(undefined,{month:'short'});
    block.appendChild(title);
    const weeksWrap = document.createElement('div'); weeksWrap.className='cal-year-weeks';

    const firstOfMonth = new Date(year, m, 1), lastOfMonth = new Date(year, m+1, 0);
    let weekStart = new Date(firstOfMonth); weekStart.setDate(weekStart.getDate()-weekStart.getDay());
    while(weekStart<=lastOfMonth){
      const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate()+6);
      const wsStr = dateStrFromObj(weekStart), weStr = dateStrFromObj(weekEnd);
      const cell = document.createElement('div'); cell.className='cal-year-week';
      cell.title = wsStr+' – '+weStr;
      if(calMode==='plan'){
        const activeGoals = state.goals.filter(g=> g.start && g.end && !(g.end<wsStr || g.start>weStr));
        const dots = document.createElement('div'); dots.className='cal-year-dots';
        activeGoals.slice(0,4).forEach(g=>{
          const dot=document.createElement('span'); dot.className='cal-year-dot'; dot.style.background=displayGoalColor(resolveGoalColor(g)); dot.title=g.title||'';
          dots.appendChild(dot);
        });
        cell.appendChild(dots);
        if(Object.keys(milestoneMap).some(ds=>ds>=wsStr && ds<=weStr)) cell.classList.add('has-milestone');
      } else {
        let doneCt=0, total=0, d=new Date(weekStart);
        for(let i=0;i<7;i++){
          const ds=dateStrFromObj(d);
          if(ds<=todayS){ total++; if(focusEffectiveStatus(logs[ds])==='done') doneCt++; }
          d.setDate(d.getDate()+1);
        }
        if(total>0){
          const frac = doneCt/total;
          cell.classList.add(frac>=0.7?'cal-week-good':frac>0?'cal-week-mid':'cal-week-none');
        }
      }
      weeksWrap.appendChild(cell);
      weekStart.setDate(weekStart.getDate()+7);
    }
    block.appendChild(weeksWrap);
    yearGrid.appendChild(block);
  }
  wrap.appendChild(yearGrid);
}

// Day-detail modal: view what's active that day + plan commitments ahead of time.
async function openCalendarDayPanel(dateStr){
  calDayModalDate = dateStr;
  const d = new Date(dateStr+'T00:00:00');
  document.getElementById('calDayModalTitle').textContent = d.toLocaleDateString(undefined,{weekday:'long', month:'long', day:'numeric', year:'numeric'});
  const active = goalsActiveOn(dateStr, true); // classes only, matching the day-level grid
  document.getElementById('calDayModalGoals').textContent = active.length ? 'classes today: '+active.map(g=>g.title||'untitled').join(', ') : 'no classes today';
  const ms = milestoneMarkersByDate(true)[dateStr] || [];
  document.getElementById('calDayModalMilestones').innerHTML = ms.length
    ? ms.map(x=>'<div>• '+esc(x.goal.title||'')+' — '+esc(x.milestone.title||'untitled')+'</div>').join('')
    : '';
  await renderCalDayCommitments(dateStr);
  document.getElementById('calDayModal').hidden = false;
}
async function renderCalDayCommitments(dateStr){
  const log = await docGet('dailyLogs/'+dateStr) || {};
  const commitments = Array.isArray(log.commitments) ? log.commitments : [];
  const list = document.getElementById('calDayCommitmentsList');
  list.innerHTML = commitments.length ? '' : '<div class="small muted">nothing planned yet</div>';
  commitments.forEach(c=>{
    const row=document.createElement('div'); row.className='commitment-row';
    row.innerHTML='<span class="commitment-name"></span><span class="commitment-hrs mono"></span><button class="commitment-del" type="button" aria-label="remove">×</button>';
    row.querySelector('.commitment-name').textContent=c.text;
    row.querySelector('.commitment-hrs').textContent=fmtHrs(Number(c.hours)||0);
    row.querySelector('.commitment-del').addEventListener('click', async ()=>{
      const fresh = await docGet('dailyLogs/'+dateStr) || {};
      fresh.commitments = (fresh.commitments||[]).filter(x=>x.id!==c.id);
      await docSet('dailyLogs/'+dateStr, fresh);
      if(dateStr===todayStr()){ state.todayLog.commitments = fresh.commitments; renderHero(); }
      renderCalDayCommitments(dateStr); renderCalendar();
    });
    list.appendChild(row);
  });
}
document.getElementById('calDayAddCommitment').addEventListener('click', async ()=>{
  const textEl=document.getElementById('calDayNewText'), hrsEl=document.getElementById('calDayNewHours');
  const text=textEl.value.trim(), hours=Number(hrsEl.value);
  if(!text || !(hours>0) || !calDayModalDate) return;
  const fresh = await docGet('dailyLogs/'+calDayModalDate) || {};
  fresh.commitments = Array.isArray(fresh.commitments) ? fresh.commitments : [];
  fresh.commitments.push({id:'c'+Date.now(), text, hours});
  await docSet('dailyLogs/'+calDayModalDate, fresh);
  textEl.value=''; hrsEl.value='';
  if(calDayModalDate===todayStr()){ state.todayLog.commitments = fresh.commitments; renderHero(); }
  renderCalDayCommitments(calDayModalDate); renderCalendar();
});
document.getElementById('calDayModalClose').addEventListener('click', ()=>{ document.getElementById('calDayModal').hidden = true; });

document.getElementById('calPrev').addEventListener('click', ()=>{
  if(calZoom==='month') calCursor.setMonth(calCursor.getMonth()-1); else calCursor.setFullYear(calCursor.getFullYear()-1);
  renderCalendar();
});
document.getElementById('calNext').addEventListener('click', ()=>{
  if(calZoom==='month') calCursor.setMonth(calCursor.getMonth()+1); else calCursor.setFullYear(calCursor.getFullYear()+1);
  renderCalendar();
});
document.getElementById('calToday').addEventListener('click', ()=>{ calCursor = new Date(); renderCalendar(); });
document.getElementById('calZoomMonth').addEventListener('click', ()=>{ calZoom='month'; renderCalendar(); });
document.getElementById('calZoomYear').addEventListener('click', ()=>{ calZoom='year'; renderCalendar(); });
document.getElementById('calModePlan').addEventListener('click', ()=>{ calMode='plan'; renderCalendar(); });
document.getElementById('calModeStreak').addEventListener('click', ()=>{ calMode='streak'; renderCalendar(); });
