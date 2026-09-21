function setBar(id, pct, color){
  const el = document.getElementById(id);
  if(!el) return;
  const value = Number.isFinite(Number(pct)) ? Number(pct) : 0;
  el.style.width = Math.max(0, Math.min(100, value))+'%';
  if(color) el.style.background = color;
}

function protectedRemainingHoursToday(){
  const s = state.settings;
  const now = minutesNowInDay();
  const start = toMinutes(s.wellStart), end = toMinutes(s.wellEnd);
  if(!(end>start)) return 0;
  if(now>=end) return 0;
  if(now<start) return (end-start)/60;
  return (end-now)/60;
}
function renderTodayRoadmapBars(){
  const wrap=document.getElementById('todayRoadmapBars'); if(!wrap) return;
  wrap.innerHTML='';
  const projects=state.goals.filter(g=>g.type==='project');
  if(!projects.length){ wrap.innerHTML='<div class="roadmap-mini-empty">Add a project in Roadmap to see progress here.</div>'; return; }
  projects.forEach(g=>{
    const pct=goalProgress(g); const row=document.createElement('div'); row.className='mini-roadmap';
    row.innerHTML='<div class="mini-roadmap-top"><span class="mini-roadmap-name"></span><span class="mini-roadmap-pct mono">'+pct+'%</span></div><div class="mini-roadmap-track"><div class="mini-roadmap-fill" style="width:'+pct+'%;background:'+displayGoalColor(resolveGoalColor(g))+';"></div></div><div class="mini-roadmap-meta">'+(g.milestones||[]).filter(m=>m.done).length+' / '+(g.milestones||[]).length+' milestones</div>';
    row.querySelector('.mini-roadmap-name').textContent=g.title||'Untitled project'; wrap.appendChild(row);
  });
}

function sleepZoneInfo(){
  const wake = state.settings.wakeTime;
  const min = hoursBetweenTimes(state.settings.bedtimeLatest, wake);
  const max = hoursBetweenTimes(state.settings.bedtimeEarliest, wake);
  const now = hoursUntilTimeToday(wake);
  let color='var(--safe)', label='Comfortable margin', zone='safe';
  if(now < min){ color='var(--danger)'; label='Sleep now'; zone='danger'; }
  else if(now < max){ color='var(--caution)'; label='Time to wind down'; zone='caution'; }
  return {min, max, now, color, label, zone};
}

function renderHero(){
  const now = new Date();
  document.getElementById('heroDate').textContent = now.toLocaleDateString(undefined, {weekday:'long', month:'long', day:'numeric'});
  document.getElementById('heroClock').textContent = fmtClock(now);

  renderCommitments();
  const commitments = Array.isArray(state.todayLog.commitments) ? state.todayLog.commitments : [];
  const manualHours = commitments.reduce((sum,c)=>sum+(Number(c.hours)||0), 0);
  const protectedHours = protectedRemainingHoursToday();
  // "Free before earliest bedtime" only means something *before* that bedtime arrives.
  
  const hrsUntilBed = hoursUntilTimeToday(state.settings.bedtimeEarliest);
  const hrsUntilWake = hoursUntilTimeToday(state.settings.wakeTime);
  const pastBedtime = hrsUntilWake < hrsUntilBed;
  let free, sleepDebtHrs = 0;
  if(pastBedtime){
    free = 0;
    const nowHHMM = pad(now.getHours())+':'+pad(now.getMinutes());
    sleepDebtHrs = hoursBetweenTimes(state.settings.bedtimeEarliest, nowHHMM);
  } else {
    free = Math.max(0, hrsUntilBed - protectedHours - manualHours);
  }
  document.getElementById('timeVal').textContent = pastBedtime ? '-'+sleepDebtHrs.toFixed(1)+'h' : free.toFixed(1)+'h';
  document.getElementById('timeVal').classList.toggle('debt', pastBedtime);
  if(pastBedtime) setBar('timeBarFill', Math.min(100, sleepDebtHrs/4*100), 'var(--bad)');
  else setBar('timeBarFill', free/16*100, 'var(--pink)');
  state.todayLog.freeHoursEstimate = Number(free.toFixed(2));
  saveToday();

  document.getElementById('energyVal').textContent = state.todayLog.energy+'/5';
  const picker = document.getElementById('energyPicker');
  picker.innerHTML='';
  for(let i=1;i<=5;i++){
    const seg = document.createElement('i');
    if(i<=state.todayLog.energy) seg.classList.add('on');
    seg.addEventListener('click', ()=>{
      if(state.todayLog.energy === i) return;
      state.todayLog.energyLog = state.todayLog.energyLog || [];
      state.todayLog.energyLog.push({t: fmtClock(new Date()), v: i});
      state.todayLog.energy = i;
      saveToday(); renderHero();
    });
    picker.appendChild(seg);
  }
  renderEnergyLog();

  const zi = sleepZoneInfo();
  document.getElementById('sleepVal').textContent = fmtHrs(zi.now);
  setBar('sleepBarFill', zi.now/9*100, zi.color);
  const zlbl = document.getElementById('sleepZoneLbl');
  zlbl.textContent = zi.label;
  zlbl.className = 'stat-card-sub small zone-pill zone-'+zi.zone;
  const sleepCard = document.getElementById('sleepCard');
  if(sleepCard) sleepCard.setAttribute('data-zone', zi.zone);
}

function renderEnergyLog(){
  const wrap = document.getElementById('energyLogList');
  if(!wrap) return;
  const log = state.todayLog.energyLog || [];
  wrap.innerHTML = log.map(e=>'<span class="elog-chip">'+esc(e.t)+' <b>'+esc(e.v)+'</b></span>').join('');
}

function renderLastNight(){
  document.getElementById('actualBedtime').value = state.todayLog.actualBedtime || '';
  const hrsEl = document.getElementById('actualBedtimeHrs');
  if(state.todayLog.actualBedtime){
    hrsEl.textContent = fmtHrs(hoursBetweenTimes(state.todayLog.actualBedtime, state.settings.wakeTime))+' slept';
  } else hrsEl.textContent = '';
}
document.getElementById('actualBedtime').addEventListener('change', e=>{
  state.todayLog.actualBedtime = e.target.value; saveToday(); renderLastNight();
});

// ---------------------------------------------------------------------------
// Today's one focus item
// ---------------------------------------------------------------------------
// Where an unfinished roadmap item stands today:
//   'now'     = scheduled for the current week
//   'carried' = scheduled for an EARLIER week and still not done, so it rolls forward on its own
//   ''        = done, or scheduled for a later week (not shown yet)
// Nothing here changes the item's own date/week — edit it in the Roadmap to move it, mark it
// done, or delete it. Weeks are counted from each goal's own start date (see roadmap.js).
function roadmapItemStatus(g, m){
  if(m.done) return '';
  const cwi = Math.max(0, Math.min((m.totalWeeks||1)-1, currentWeekIndex(g)));
  if(m.week === cwi) return 'now';
  if(m.week < cwi) return 'carried';
  return '';
}
function goalMilestoneOptions(){
  const carried = [], current = [];
  state.goals.forEach(g=>{
    computeMilestoneWeeks(g).forEach(m=>{
      const st = roadmapItemStatus(g, m);
      if(!st) return;
      let note = '';
      if(g.type==='class' && m.dueDate){
        note = ' (due '+shortDate(m.dueDate)+(m.dueDate < todayStr() ? ' · carried' : '')+')';
      } else if(st==='carried'){
        note = ' · carried from week '+(m.week+1);
      }
      const opt = '<option value="'+esc(g.id+'::'+m.id)+'">'+esc(g.title)+' — '+esc(m.title||'untitled')+esc(note)+'</option>';
      (st==='carried' ? carried : current).push(opt);
    });
  });
  const rows = carried.concat(current);   // older, still-unfinished items first
  const placeholder = rows.length ? '— this week’s roadmap —' : '— nothing scheduled this week —';
  return '<option value="">'+placeholder+'</option>'+rows.join('');
}

function renderPriority(){
  document.getElementById('priorityGoalSelect').innerHTML = goalMilestoneOptions();
  const sel = document.getElementById('priorityGoalSelect');
  const key = state.todayLog.priorityGoalId ? state.todayLog.priorityGoalId+'::'+state.todayLog.priorityMilestoneId : '';
  sel.value = key;
  document.getElementById('priorityCustom').value = state.todayLog.priorityText || '';
  const status = state.todayLog.priorityStatus || 'pending';
  const disp = document.getElementById('priorityDisplay');
  const text = getPriorityLabel();
  disp.textContent = text || (status==='done' ? 'Done for now — pick another if you want to keep going.' : 'Nothing chosen yet.');
  disp.classList.toggle('empty', !text);
  document.getElementById('priorityStatusLabel').textContent = status==='done' ? 'done today' : status==='skipped' ? 'skipped today' : 'pending';
  const stateEl=document.getElementById('focusState'); const stateText=document.getElementById('focusStateText');
  stateEl.className='focus-state '+status; stateText.textContent=status==='done'?'DONE':status==='skipped'?'SKIPPED':'PENDING';
  const doneBtn=document.getElementById('btnDone');
  if(doneBtn){ doneBtn.textContent=status==='done'?'Completed':'Mark done'; doneBtn.disabled=status==='done'; }
  const skipBtn=document.getElementById('btnSkip');
  // The goal picker and custom-text field stay enabled even once today's focus is done
  if(skipBtn) skipBtn.disabled=status==='done';
}

function renderCompletedToday(){
  const list = document.getElementById('completedTodayList');
  const count = document.getElementById('completedTodayCount');
  if(!list) return;
  const items = Array.isArray(state.todayLog.completedToday) ? state.todayLog.completedToday : [];
  list.innerHTML = '';
  if(count) count.textContent = items.length ? items.length+' '+(items.length===1?'item':'items') : '';
  items.forEach(item=>{
    const chip=document.createElement('div');
    chip.className='completed-chip';
    chip.innerHTML='<span class="completed-chip-mark">✓</span><span class="completed-chip-text"></span><span class="completed-chip-time"></span>';
    chip.querySelector('.completed-chip-text').textContent=item.text || 'Completed item';
    chip.querySelector('.completed-chip-time').textContent=item.time || '';
    list.appendChild(chip);
  });
  // If the app closed out yesterday as skipped, say so here.
  const note = document.getElementById('rolloverNote');
  if(note){
    if(state.rolloverNote){
      note.textContent = 'Yesterday ('+dayLabel(state.rolloverNote)+') · auto skipped as day ended';
      note.hidden = false;
    } else { note.textContent = ''; note.hidden = true; }
  }
}
function getPriorityLabel(){
  if(state.todayLog.priorityText) return state.todayLog.priorityText;
  if(state.todayLog.priorityGoalId && state.todayLog.priorityMilestoneId){
    const g = state.goals.find(g=>g.id===state.todayLog.priorityGoalId);
    const m = g && (g.milestones||[]).find(m=>m.id===state.todayLog.priorityMilestoneId);
    if(g&&m) return g.title+' — '+m.title;
  }
  return '';
}
document.getElementById('priorityGoalSelect').addEventListener('change', e=>{
  const [gid,mid] = e.target.value.split('::');
  state.todayLog.priorityGoalId = gid||''; state.todayLog.priorityMilestoneId = mid||'';
  if(gid){ state.todayLog.priorityText=''; document.getElementById('priorityCustom').value=''; }
  state.todayLog.priorityStatus='pending';
  saveToday(); renderPriority();
});
document.getElementById('priorityCustom').addEventListener('input', e=>{
  state.todayLog.priorityText = e.target.value;
  if(e.target.value){ state.todayLog.priorityGoalId=''; state.todayLog.priorityMilestoneId=''; }
  state.todayLog.priorityStatus='pending';
});
document.getElementById('priorityCustom').addEventListener('change', ()=>{ saveToday(); renderPriority(); });
document.getElementById('btnDone').addEventListener('click', async ()=>{
  if(state.todayLog.priorityStatus==='done') return;
  const label = getPriorityLabel().trim();
  if(!label) return;
  const linkedGoalId = state.todayLog.priorityGoalId, linkedMilestoneId = state.todayLog.priorityMilestoneId;
  state.todayLog.completedToday = Array.isArray(state.todayLog.completedToday) ? state.todayLog.completedToday : [];
  state.todayLog.completedToday.push({id:'done'+Date.now(), text:label, time:fmtClock(new Date()), goalId:linkedGoalId||'', milestoneId:linkedMilestoneId||''});
  state.todayLog.priorityStatus='done'; // stays 'done' — only picking a new goal/milestone or typing new custom text (below) moves it back to 'pending'
  state.todayLog.focusDoneToday = true; // the persistent record for the day, independent of priorityStatus — see focusEffectiveStatus() in behavior.js
  state.todayLog.priorityGoalId='';
  state.todayLog.priorityMilestoneId='';
  state.todayLog.priorityText='';
  state.todayLog.skipReason='';
  await saveToday();
  renderPriority();
  renderCompletedToday();
  // Sync back to the roadmap: finishing today's focus checks off the milestone it came from.
  if(linkedGoalId && linkedMilestoneId){
    const g = state.goals.find(x=>x.id===linkedGoalId);
    const m = g && (g.milestones||[]).find(x=>x.id===linkedMilestoneId);
    if(g && m && !m.done){
      m.done = true;
      m.completedAt = todayStr();
      await saveGoal(g);
    }
  }
});
document.getElementById('btnSkip').addEventListener('click', ()=>{ document.getElementById('skipReasonWrap').classList.add('show'); });
document.getElementById('btnSkipCancel').addEventListener('click', ()=>{ document.getElementById('skipReasonWrap').classList.remove('show'); });
document.getElementById('btnSkipConfirm').addEventListener('click', ()=>{
  state.todayLog.priorityStatus='skipped';
  state.todayLog.skipReason = document.getElementById('skipReason').value;
  document.getElementById('skipReasonWrap').classList.remove('show');
  saveToday(); renderPriority();
});

// ---------------------------------------------------------------------------
// Smaller tasks
// ---------------------------------------------------------------------------
function renderTasks(){
  const list = document.getElementById('taskList');
  list.innerHTML='';
  (state.todayLog.tasks||[]).forEach(t=>{
    const li = document.createElement('li');
    li.className='task-item'+(t.done?' done':'');
    li.innerHTML = '<input type="checkbox" '+(t.done?'checked':'')+'><span class="task-text"></span><button class="task-del">×</button>';
    li.querySelector('.task-text').textContent = t.text;
    li.querySelector('input').addEventListener('change', ()=>{ t.done=!t.done; saveToday(); renderTasks(); });
    li.querySelector('.task-del').addEventListener('click', ()=>{
      state.todayLog.tasks = state.todayLog.tasks.filter(x=>x.id!==t.id); saveToday(); renderTasks();
    });
    list.appendChild(li);
  });
}
document.getElementById('btnAddTask').addEventListener('click', addTask);
document.getElementById('newTask').addEventListener('keydown', e=>{ if(e.key==='Enter') addTask(); });
function addTask(){
  const inp = document.getElementById('newTask');
  if(!inp.value.trim()) return;
  state.todayLog.tasks = state.todayLog.tasks||[];
  state.todayLog.tasks.push({id:'t'+Date.now(), text:inp.value.trim(), done:false});
  inp.value=''; saveToday(); renderTasks();
}

// ---------------------------------------------------------------------------
// Protected time: shows where today stands against the scheduled block
// ---------------------------------------------------------------------------
function renderWellness(){
  const s = state.settings;
  const body = document.getElementById('wellnessBody');
  if(!body) return;
  const now = minutesNowInDay();
  const start = toMinutes(s.wellStart), end = toMinutes(s.wellEnd);
  const started = end>start ? now>=start : false;

  body.innerHTML = '<div style="font-weight:500;margin-bottom:4px;">'+esc(s.wellLabel)+'</div>'+
    '<div class="small" style="margin-bottom:8px;">'+esc(s.wellStart)+' – '+esc(s.wellEnd)+'</div>';

  const statusWrap = document.createElement('div');

  if(state.todayLog.wellnessDone){
    statusWrap.innerHTML = '<span class="wellness-status done">✓ done'+(state.todayLog.wellnessDoneAt?' · '+state.todayLog.wellnessDoneAt:'')+'</span>'+
      ' <button class="btn-ghost" id="btnWellnessUndo" type="button">undo</button>';
  } else if(state.todayLog.wellnessOverride){
    statusWrap.innerHTML = '<span class="wellness-status moved">moved</span>'+
      ' <span class="small muted">'+esc(state.todayLog.wellnessOverrideReason||'—')+'</span>'+
      ' <button class="btn-ghost" id="btnWellnessUndo" type="button">undo</button>';
  } else if(!started){
    statusWrap.innerHTML = '<span class="wellness-status wait">starts in '+fmtHrs((start-now)/60)+'</span>';
  } else if(now<end){
    statusWrap.innerHTML = '<span class="wellness-status now">in progress</span>'+
      '<div class="wellness-confirm-row" style="margin-top:8px;">'+
        '<button class="wellness-confirm-btn" id="btnWellnessDone" type="button">mark done</button>'+
        '<button class="btn-ghost" id="btnWellnessOpen" type="button">it got moved</button>'+
      '</div>';
  } else {
    // Block time has passed today and nothing has been logged yet — ask
    statusWrap.innerHTML =
      '<div class="small muted" style="margin-bottom:6px;">did this actually happen today?</div>'+
      '<div class="wellness-confirm-row">'+
        '<button class="wellness-confirm-btn" id="btnWellnessDone" type="button">✓ yes, done</button>'+
        '<button class="btn-ghost" id="btnWellnessOpen" type="button">it got moved</button>'+
      '</div>';
  }
  body.appendChild(statusWrap);

  const doneBtn = document.getElementById('btnWellnessDone');
  if(doneBtn) doneBtn.addEventListener('click', ()=>{
    state.todayLog.wellnessDone = true;
    state.todayLog.wellnessDoneAt = fmtClock(new Date());
    state.todayLog.wellnessOverride = false;
    state.todayLog.wellnessOverrideReason = '';
    saveToday(); renderWellness();
  });
  const openBtn = document.getElementById('btnWellnessOpen');
  if(openBtn) openBtn.addEventListener('click', ()=>{ document.getElementById('wellnessOverrideWrap').style.display='block'; });
  const undoBtn = document.getElementById('btnWellnessUndo');
  if(undoBtn) undoBtn.addEventListener('click', ()=>{
    state.todayLog.wellnessDone = false; state.todayLog.wellnessDoneAt = '';
    state.todayLog.wellnessOverride = false; state.todayLog.wellnessOverrideReason = '';
    saveToday(); renderWellness();
  });
}
document.getElementById('btnWellnessCancel').addEventListener('click', ()=>{ document.getElementById('wellnessOverrideWrap').style.display='none'; });
document.getElementById('btnWellnessConfirm').addEventListener('click', ()=>{
  state.todayLog.wellnessOverride = true;
  state.todayLog.wellnessOverrideReason = document.getElementById('wellnessReason').value;
  state.todayLog.wellnessDone = false;
  state.todayLog.wellnessDoneAt = '';
  document.getElementById('wellnessOverrideWrap').style.display='none';
  saveToday(); renderWellness();
});

// ---------------------------------------------------------------------------
// Extra commitments tonight (on top of the protected-time block)
// ---------------------------------------------------------------------------
function renderCommitments(){
  const wrap = document.getElementById('commitmentsList');
  if(!wrap) return;
  wrap.innerHTML = '';
  const protectedHours = protectedRemainingHoursToday();
  if(protectedHours>0.01){
    const row=document.createElement('div'); row.className='commitment-row auto';
    row.innerHTML='<span class="commitment-name"></span><span class="commitment-hrs mono"></span>';
    row.querySelector('.commitment-name').textContent=(state.settings.wellLabel||'Protected time')+' · auto';
    row.querySelector('.commitment-hrs').textContent=fmtHrs(protectedHours);
    wrap.appendChild(row);
  }
  const commitments = Array.isArray(state.todayLog.commitments) ? state.todayLog.commitments : [];
  commitments.forEach(c=>{
    const row=document.createElement('div'); row.className='commitment-row';
    row.innerHTML='<span class="commitment-name"></span><span class="commitment-hrs mono"></span><button class="commitment-del" type="button" aria-label="remove">×</button>';
    row.querySelector('.commitment-name').textContent=c.text;
    row.querySelector('.commitment-hrs').textContent=fmtHrs(Number(c.hours)||0);
    row.querySelector('.commitment-del').addEventListener('click', ()=>{
      state.todayLog.commitments = state.todayLog.commitments.filter(x=>x.id!==c.id);
      saveToday(); renderHero();
    });
    wrap.appendChild(row);
  });
  if(protectedHours<=0.01 && !commitments.length){
    const empty=document.createElement('div'); empty.className='commitment-empty small muted';
    empty.textContent='add anything still ahead of you today';
    wrap.appendChild(empty);
  }
}
function addCommitment(){
  const textEl=document.getElementById('newCommitmentText'), hrsEl=document.getElementById('newCommitmentHours');
  const text=textEl.value.trim(), hours=Number(hrsEl.value);
  if(!text || !(hours>0)) return;
  state.todayLog.commitments = Array.isArray(state.todayLog.commitments) ? state.todayLog.commitments : [];
  state.todayLog.commitments.push({id:'c'+Date.now(), text, hours});
  textEl.value=''; hrsEl.value='';
  saveToday(); renderHero();
}
document.getElementById('btnAddCommitment').addEventListener('click', addCommitment);
['newCommitmentText','newCommitmentHours'].forEach(id=>{
  document.getElementById(id).addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); addCommitment(); } });
});

// ---------------------------------------------------------------------------
// Reading queue
// ---------------------------------------------------------------------------
function renderReads(){
  const list = document.getElementById('readsList');
  const unread = state.reads.filter(r=>!r.done)
    .sort((a,b)=> (b.starred?1:0)-(a.starred?1:0))
    .slice(0,5);
  list.innerHTML = unread.length ? '' : '<div class="small muted">queue is empty</div>';
  unread.forEach(r=>{
    const div = document.createElement('div'); div.className='reads-item';
    div.innerHTML =
      '<button class="star-btn'+(r.starred?' on':'')+'" aria-label="must read">'+(r.starred?'★':'☆')+'</button>'+
      '<a href="'+esc(safeUrl(r.url)||'#')+'" target="_blank" rel="noopener noreferrer"></a>'+
      '<button class="task-del read-done" aria-label="mark read">✓</button>';
    div.querySelector('a').textContent = r.title||r.url;
    div.querySelector('.star-btn').addEventListener('click', async ()=>{ r.starred = !r.starred; await colSet('reads', r.id, r); renderReads(); });
    div.querySelector('.read-done').addEventListener('click', async ()=>{ r.done=true; r.completedAt=todayStr(); await colSet('reads', r.id, r); renderReads(); });
    list.appendChild(div);
  });
}
document.getElementById('btnAddRead').addEventListener('click', async ()=>{
  const t = document.getElementById('newReadTitle'), u = document.getElementById('newReadUrl');
  if(!u.value.trim()) return;
  const data = {title:t.value.trim()||u.value.trim(), url:u.value.trim(), done:false, starred:false, addedAt:Date.now()};
  const id = await colAdd('reads', data);
  state.reads.push({id, ...data});
  t.value=''; u.value=''; renderReads();
});
