function computeMilestoneWeeks(goal){
  const start = new Date(goal.start+'T00:00:00'), end = new Date(goal.end+'T00:00:00');
  const totalWeeks = Math.max(1, Math.ceil((end-start)/(7*86400000)));
  const list = goal.milestones||[];
  if(goal.type==='class'){
    return list.map(m=>{
      let week=0;
      if(m.dueDate){ const dd=new Date(m.dueDate+'T00:00:00'); week=Math.floor((dd-start)/(7*86400000)); }
      week = Math.max(0, Math.min(totalWeeks-1, week));
      return {...m, week, totalWeeks, auto:false};
    });
  }
  const n = list.length;
  return list.map((m,i)=>{
    if(m.weekOverride !== '' && m.weekOverride != null && !isNaN(Number(m.weekOverride))){
      return {...m, week: Math.max(0, Math.min(totalWeeks-1, Number(m.weekOverride))), auto:false, totalWeeks};
    }
    if(n<=1) return {...m, week:0, auto:true, totalWeeks};
    const week = Math.round((i/(n-1)) * (totalWeeks-1));
    return {...m, week, auto:true, totalWeeks};
  });
}
function currentWeekIndex(goal){
  const start = new Date(goal.start+'T00:00:00');
  return Math.floor((new Date()-start)/(7*86400000));
}
function isMilestoneThisWeek(g, m){
  if(m.done) return false;
  const totalWeeks = m.totalWeeks || 1;
  const cwi = Math.max(0, Math.min(totalWeeks-1, currentWeekIndex(g)));
  return m.week === cwi;
}
function goalProgress(g){ const ms=g.milestones||[]; return ms.length ? Math.round(ms.filter(m=>m.done).length/ms.length*100) : 0; }

const goalExpandedState = {};
function renderGoals(){
  const wrap = document.getElementById('goalsList');
  wrap.innerHTML='';
  if(!state.goals.length){ wrap.innerHTML = '<p class="small muted">No goals yet. Add a class with its day-detailed homework/reading/exam, or a project like language learning, skills to acquire, job apps, and researches with weekly progresses.</p>'; }
  state.goals.forEach(g=>{
    const isClass = g.type==='class';
    const withWeeks = computeMilestoneWeeks(g);
    const cw = currentWeekIndex(g);
    const totalWeeks = withWeeks[0]?withWeeks[0].totalWeeks:Math.max(1, Math.ceil((new Date(g.end)-new Date(g.start))/(7*86400000)));
    const expanded = !!goalExpandedState[g.id];
    const msTotal = (g.milestones||[]).length;
    const msDone = (g.milestones||[]).filter(m=>m.done).length;
    const card = document.createElement('div');
    card.className='glass goal-card';
    // Collapsed by default: the title/dates/milestones/delete button only appear once you
    // deliberately expand a card, so you can't fat-finger a milestone or the delete button
    // while just scanning the roadmap.
    card.innerHTML =
      '<div class="goal-summary-row">'+
        '<button class="gToggle" type="button" aria-expanded="'+(expanded?'true':'false')+'" title="'+(expanded?'collapse':'expand')+'"><span class="gToggle-chevron">'+(expanded?'▾':'▸')+'</span></button>'+
        '<span class="goal-color-dot" style="background:'+displayGoalColor(resolveGoalColor(g))+';"></span>'+
        '<div class="goal-summary-text"><span class="goal-summary-title"></span><span class="type-pill">'+(isClass?'class':'project')+'</span></div>'+
        '<span class="small muted goal-summary-meta">'+msDone+'/'+msTotal+' done · week '+Math.max(1,cw+1)+' of '+totalWeeks+'</span>'+
      '</div>'+
      '<div class="goal-body"'+(expanded?'':' hidden')+'>'+
        '<div class="goal-top">'+
          '<input type="text" class="gTitle" value="'+esc(g.title)+'" placeholder="goal title">'+
          '<div class="color-popover-wrap">'+
            '<button type="button" class="color-trigger" title="change color" style="background:'+displayGoalColor(resolveGoalColor(g))+';"></button>'+
            '<div class="color-popover" hidden><div class="color-swatch-grid"></div></div>'+
          '</div>'+
          '<button class="btn btn-danger gDelete" style="margin-left:auto;">delete</button>'+
        '</div>'+
        '<div class="goal-dates">'+
          '<span>from</span><input type="date" class="gStart" value="'+esc(g.start)+'">'+
          '<span>to</span><input type="date" class="gEnd" value="'+esc(g.end)+'">'+
        '</div>'+
        '<div class="ruler">'+
          '<div class="ruler-track"></div>'+
          '<div class="ruler-now" style="left:'+Math.max(0,Math.min(100,(cw/Math.max(1,totalWeeks-1))*100))+'%"></div>'+
        '</div>'+
        '<div class="small muted" style="margin-top:-10px;margin-bottom:10px;">week '+Math.max(1,cw+1)+' of '+totalWeeks+
          (isClass ? (isBwPalette() ? ' · dot shade = homework kind' : ' · dot color = homework kind') : ' · dot = auto-placed, ring = you moved it')+'</div>'+
        '<div class="mstack"></div>'+
        '<div class="row">'+
          '<button class="btn-ghost gAddMilestone">'+(isClass?'+ add homework':'+ add milestone')+'</button>'+
          '<button class="btn-ghost gGenWeeks">generate one slot per week</button>'+
        '</div>'+
      '</div>';

    card.querySelector('.goal-summary-title').textContent = g.title || 'untitled';
    const toggleGoal = ()=>{ goalExpandedState[g.id] = !goalExpandedState[g.id]; renderGoals(); };
    card.querySelector('.gToggle').addEventListener('click', toggleGoal);
    card.querySelector('.goal-summary-row').addEventListener('click', (e)=>{
      if(e.target.closest('.gToggle')) return; // the button's own handler already fired — avoid toggling twice
      toggleGoal();
    });

    const currentColor = resolveGoalColor(g);
    const colorTrigger = card.querySelector('.color-trigger');
    const colorPopover = card.querySelector('.color-popover');
    colorTrigger.addEventListener('click', (e)=>{
      e.stopPropagation();
      document.querySelectorAll('.color-popover').forEach(p=>{ if(p!==colorPopover) p.hidden = true; });
      colorPopover.hidden = !colorPopover.hidden;
    });
    const swatchGrid = card.querySelector('.color-swatch-grid');
    GOAL_COLOR_PALETTE.forEach(hex=>{
      const sw = document.createElement('button');
      sw.type='button'; sw.className='color-swatch'+(hex===currentColor?' selected':'');
      sw.style.background = displayGoalColor(hex);
      sw.title = hex;
      sw.addEventListener('click', (e)=>{ e.stopPropagation(); g.color = hex; saveGoal(g); });
      swatchGrid.appendChild(sw);
    });

    const ruler = card.querySelector('.ruler');
    withWeeks.forEach(m=>{
      const pct = Math.max(0,Math.min(100,(m.week/Math.max(1,totalWeeks-1))*100));
      const el = document.createElement('div');
      el.className='milestone'; el.style.left = pct+'%'; el.tabIndex = 0;
      const dotColor = isClass ? kindColor(m.kind) : 'var(--pink-deep)';
      el.innerHTML = '<div class="dot'+(m.auto?'':' manual')+'" style="background:'+dotColor+';"></div><div class="tip"></div>';
      el.querySelector('.tip').textContent = m.title||'untitled';
      ruler.appendChild(el);
    });

    const mstack = card.querySelector('.mstack');
    (g.milestones||[]).forEach(m=>{
      const row = document.createElement('div'); row.className='mrow';
      if(isClass){
        row.innerHTML =
          '<label class="mDoneWrap"><input type="checkbox" class="mDone" '+(m.done?'checked':'')+'><span></span></label>'+
          '<input type="text" class="mTitle" value="'+esc(m.title)+'" placeholder="assignment">'+
          '<input type="date" class="mDue" value="'+esc(m.dueDate)+'">'+
          '<select class="mKind">'+
            '<option value="hw" '+(m.kind==='hw'||!m.kind?'selected':'')+'>homework</option>'+
            '<option value="exam" '+(m.kind==='exam'?'selected':'')+'>exam</option>'+
            '<option value="reading" '+(m.kind==='reading'?'selected':'')+'>reading</option>'+
          '</select>'+
          '<button class="mDel">×</button>';
        row.querySelector('.mDue').addEventListener('change', e=>{ m.dueDate=e.target.value; saveGoal(g); });
        row.querySelector('.mKind').addEventListener('change', e=>{ m.kind=e.target.value; saveGoal(g); });
      } else {
        row.innerHTML =
          '<label class="mDoneWrap"><input type="checkbox" class="mDone" '+(m.done?'checked':'')+'><span></span></label>'+
          '<input type="text" class="mTitle" value="'+esc(m.title)+'" placeholder="milestone">'+
          '<input type="number" class="mWeek" value="'+esc(m.weekOverride??'')+'" placeholder="wk">'+
          '<button class="mDel">×</button>';
        row.querySelector('.mWeek').addEventListener('change', e=>{ m.weekOverride = e.target.value===''?'':Number(e.target.value); saveGoal(g); });
      }
      row.querySelector('.mDone').addEventListener('change', e=>{ m.done=e.target.checked; m.completedAt = e.target.checked ? (m.completedAt||todayStr()) : ''; saveGoal(g); });
      row.querySelector('.mTitle').addEventListener('change', e=>{ m.title=e.target.value; saveGoal(g); });
      row.querySelector('.mDel').addEventListener('click', ()=>{
        if(!confirm('Delete "'+(m.title||'this item')+'"?')) return;
        g.milestones = g.milestones.filter(x=>x.id!==m.id); saveGoal(g);
      });
      mstack.appendChild(row);
    });

    card.querySelector('.gTitle').addEventListener('change', e=>{ g.title=e.target.value; saveGoal(g); });
    card.querySelector('.gStart').addEventListener('change', e=>{ g.start=e.target.value; saveGoal(g); });
    card.querySelector('.gEnd').addEventListener('change', e=>{ g.end=e.target.value; saveGoal(g); });
    card.querySelector('.gDelete').addEventListener('click', async ()=>{
      if(!confirm('Delete the goal "'+(g.title||'untitled')+'" and all '+msTotal+' of its milestones? This cannot be undone.')) return;
      await colDelete('goals', g.id); state.goals = state.goals.filter(x=>x.id!==g.id); delete goalExpandedState[g.id]; renderGoals(); renderPriority();
    });
    card.querySelector('.gAddMilestone').addEventListener('click', ()=>{
      g.milestones = g.milestones||[];
      g.milestones.push(isClass ? {id:'m'+Date.now(), title:'', dueDate:g.start, kind:'hw'} : {id:'m'+Date.now(), title:'', weekOverride:''});
      saveGoal(g);
    });
    const genBtn = card.querySelector('.gGenWeeks');
    if(genBtn) genBtn.addEventListener('click', ()=>{
      g.milestones = g.milestones||[];
      for(let i=0;i<totalWeeks;i++){
        if(isClass){
          g.milestones.push({id:'m'+Date.now()+'_'+i, title:'Week '+(i+1), dueDate: addDays(g.start, i*7+6), kind:'hw'});
        } else {
          g.milestones.push({id:'m'+Date.now()+'_'+i, title:'Week '+(i+1), weekOverride: i});
        }
      }
      saveGoal(g);
    });
    wrap.appendChild(card);
  });
}
async function saveGoal(g){ await colSet('goals', g.id, g); renderGoals(); renderPriority(); renderTodayRoadmapBars(); }

document.getElementById('btnNewProject').addEventListener('click', async ()=>{
  const data = { type:'project', title:'New project', start: todayStr(), end: addDays(todayStr(), 56), milestones:[] };
  const id = await colAdd('goals', data);
  state.goals.push({id, ...data});
  renderGoals();
});
document.getElementById('btnNewClass').addEventListener('click', async ()=>{
  const data = { type:'class', title:'New class', start: todayStr(), end: addDays(todayStr(), 112), milestones:[] };
  const id = await colAdd('goals', data);
  state.goals.push({id, ...data});
  renderGoals();
});

// One global listener (not re-added per card/render) closes any open color popover when
// you click anywhere outside it — clicking a swatch or the trigger itself is excluded.
document.addEventListener('click', (e)=>{
  if(e.target.closest('.color-popover-wrap')) return;
  document.querySelectorAll('.color-popover').forEach(p=>{ p.hidden = true; });
});
