async function getAnalyticsWindow(numDays){
  const days=[]; const d=new Date();
  for(let i=numDays-1;i>=0;i--){ const x=new Date(d); x.setDate(d.getDate()-i); days.push(dateStrFromObj(x)); }
  const logs = await Promise.all(days.map(ds=>docGet('dailyLogs/'+ds)));
  return days.map((ds,i)=>({date:ds, log:logs[i]}));
}
function rowMetrics(r){
  const log = r.log||{};
  const tasksTotal = Array.isArray(log.tasks) ? log.tasks.length : 0;
  const tasksDone = Array.isArray(log.tasks) ? log.tasks.filter(t=>t.done).length : 0;
  const readsDone = state.reads.filter(x=>x.completedAt===r.date).length;
  const milestonesDone = state.goals.reduce((sum,g)=> sum+(g.milestones||[]).filter(m=>m.completedAt===r.date).length, 0);
  const sleepHrs = log.actualBedtime ? hoursBetweenTimes(log.actualBedtime, state.settings.wakeTime) : null;
  const freeHours = (log.freeHoursEstimate!=null && log.freeHoursEstimate!=='') ? Number(log.freeHoursEstimate) : null;
  const wellnessDone = !!log.wellnessDone;
  const wellnessMoved = !!log.wellnessOverride;
  return { tasksTotal, tasksDone, readsDone, milestonesDone, sleepHrs, freeHours, wellnessDone, wellnessMoved };
}

function focusEffectiveStatus(log){
  if(!log) return '';
  if(log.focusDoneToday) return 'done';
  return log.priorityStatus || '';
}

async function renderBehavior(){
  const rows = await getAnalyticsWindow(14);
  rows.forEach(r=>{ r.metrics = rowMetrics(r); });

  const withLog = rows.filter(r=>r.log);
  const avgEnergy14 = withLog.length ? withLog.reduce((a,r)=>a+(r.log.energy||0),0)/withLog.length : 0;
  const decided = rows.filter(r=>r.log && (focusEffectiveStatus(r.log)==='done'||focusEffectiveStatus(r.log)==='skipped'));
  const doneCt = rows.filter(r=>r.log && focusEffectiveStatus(r.log)==='done').length;
  const doneRate = decided.length ? Math.round(doneCt/decided.length*100) : 0;
  let streak=0;
  for(let i=rows.length-1;i>=0;i--){ if(rows[i].log && focusEffectiveStatus(rows[i].log)==='done') streak++; else break; }
  const wellnessDoneCt = rows.filter(r=>r.metrics.wellnessDone).length;
  const wellnessMovedCt = rows.filter(r=>r.metrics.wellnessMoved).length;

  document.getElementById('statStreak').textContent = streak;
  document.getElementById('statDoneRate').textContent = doneRate+'%';
  document.getElementById('statAvgEnergy').textContent = avgEnergy14 ? avgEnergy14.toFixed(1) : '–';
  document.getElementById('statOverrides').textContent = wellnessDoneCt;

  const totalTasksDone = rows.reduce((a,r)=>a+r.metrics.tasksDone,0);
  const totalReadsDone = rows.reduce((a,r)=>a+r.metrics.readsDone,0);
  const totalMilestonesDone = rows.reduce((a,r)=>a+r.metrics.milestonesDone,0);
  const itemsEl = document.getElementById('statItemsDone');
  if(itemsEl) itemsEl.textContent = totalTasksDone+totalReadsDone+totalMilestonesDone;

  const chartWrap = document.getElementById('completionsChart');
  if(chartWrap){
    chartWrap.innerHTML='';
    const dayTotals = rows.map(r=>r.metrics.tasksDone+r.metrics.readsDone+r.metrics.milestonesDone);
    const maxTotal = Math.max(3, ...dayTotals);
    rows.forEach((r,i)=>{
      const wrap=document.createElement('div'); wrap.className='stack-col-wrap';
      const bar=document.createElement('div'); bar.className='stack-bar';
      bar.title = dayLabel(r.date)+': '+r.metrics.tasksDone+' tasks, '+r.metrics.readsDone+' reads, '+r.metrics.milestonesDone+' roadmap';
      [['tasks', r.metrics.tasksDone], ['reads', r.metrics.readsDone], ['milestones', r.metrics.milestonesDone]].forEach(([cls,count])=>{
        if(!count) return;
        const seg=document.createElement('div'); seg.className='stack-seg '+cls;
        seg.style.height = Math.max(3, count/maxTotal*100)+'%';
        bar.appendChild(seg);
      });
      const lbl=document.createElement('div'); lbl.className='stack-col-lbl'; lbl.textContent=dayLabel(r.date).split(' ')[0];
      wrap.appendChild(bar); wrap.appendChild(lbl);
      chartWrap.appendChild(wrap);
    });
  }

  const min = hoursBetweenTimes(state.settings.bedtimeLatest, state.settings.wakeTime);
  const max = hoursBetweenTimes(state.settings.bedtimeEarliest, state.settings.wakeTime);
  const sleepWrap = document.getElementById('sleepPattern'); sleepWrap.innerHTML='';
  let logged=0, inWindow=0, sleepHrsSum=0;
  const freeSeries = rows.map(r=>r.metrics.freeHours);
  rows.forEach((r,i)=>{
    const bt = r.log && r.log.actualBedtime;
    let hrsTxt='–', btTxt='–', flagClass='';
    if(bt){
      logged++;
      const hrs = hoursBetweenTimes(bt, state.settings.wakeTime);
      sleepHrsSum += hrs;
      hrsTxt = fmtHrs(hrs); btTxt = bt;
      if(hrs>=max){ flagClass='zone-good'; inWindow++; }
      else if(hrs>=min){ flagClass='zone-mid'; inWindow++; }
      else flagClass='zone-bad';
    }
    let trendHtml = '<span class="trend-chip trend-empty">–</span>';
    const cur = freeSeries[i], prev = i>0 ? freeSeries[i-1] : null;
    if(cur!=null && prev!=null){
      const delta = cur - prev;
      let cls='zone-safe', arrow='≈';
      if(delta < -2){ cls='zone-danger'; arrow='▼'; }
      else if(delta > 2){ cls='zone-caution'; arrow='▲'; }
      const title = Math.abs(delta)<0.05 ? 'about the same free time as the night before' : Math.abs(delta).toFixed(1)+'h '+(delta<0?'less':'more')+' free time than the night before';
      trendHtml = '<span class="trend-chip zone-pill '+cls+'" title="'+title+'">'+arrow+' '+Math.abs(delta).toFixed(1)+'h</span>';
    }
    const item = document.createElement('div'); item.className='sleep-row';
    item.innerHTML = '<span class="small">'+dayLabel(r.date)+'</span><span class="mono small">'+btTxt+'</span><span class="mono small">'+hrsTxt+'</span><span class="dot-flag '+flagClass+'"></span>'+trendHtml;
    sleepWrap.appendChild(item);
  });
  document.getElementById('sleepSummary').textContent = logged ? (inWindow+' of '+logged+' logged nights met your window') : 'log a bedtime on the Today tab to start tracking';
  const avgSleepHrs = logged ? sleepHrsSum/logged : 0;
  const avgBedtimeEl = document.getElementById('sleepAvgBedtime');
  if(avgBedtimeEl) avgBedtimeEl.textContent = logged ? addMinutes(state.settings.wakeTime, -Math.round(avgSleepHrs*60)) : '–';
  const avgHoursEl = document.getElementById('sleepAvgHours');
  if(avgHoursEl) avgHoursEl.textContent = logged ? fmtHrs(avgSleepHrs) : '–';
  const loggedCountEl = document.getElementById('sleepLoggedCount');
  if(loggedCountEl) loggedCountEl.textContent = logged+'/'+rows.length;

  // Energy through the day: bucket every timestamped energy check-in (not just the day's
  // final value) by weekday AND 4-hour window, so the grid can point at *when and on which
  // days* energy tends to dip, using space much better than a single row of bars did.
  const HOUR_BUCKETS = [
    {label:'12–4am', start:0, end:4}, {label:'4–8am', start:4, end:8},
    {label:'8–12pm', start:8, end:12}, {label:'12–4pm', start:12, end:16},
    {label:'4–8pm', start:16, end:20}, {label:'8pm–12am', start:20, end:24}
  ];
  const DOW_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  function parseClockToHour(t){
    const mm = /^(\d+):(\d+)\s*(AM|PM)$/i.exec(String(t||'').trim());
    if(!mm) return null;
    let h = Number(mm[1])%12; if(/pm/i.test(mm[3])) h += 12;
    return h;
  }
  const heatCells = DOW_LABELS.map(()=> HOUR_BUCKETS.map(()=>[]));
  rows.forEach(r=>{
    if(!r.log || !Array.isArray(r.log.energyLog)) return;
    const dow = new Date(r.date+'T00:00:00').getDay();
    r.log.energyLog.forEach(e=>{
      const h = parseClockToHour(e.t);
      if(h==null) return;
      const bi = HOUR_BUCKETS.findIndex(b=>h>=b.start && h<b.end);
      if(bi>=0) heatCells[dow][bi].push(e.v);
    });
  });
  const heatWrap = document.getElementById('energyHeatmap');
  if(heatWrap){
    heatWrap.innerHTML='';
    heatWrap.appendChild(document.createElement('div'));
    HOUR_BUCKETS.forEach(b=>{
      const h=document.createElement('div'); h.className='hh-colhead'; h.textContent=b.label;
      heatWrap.appendChild(h);
    });
    DOW_LABELS.forEach((dowLbl,di)=>{
      const rowLbl=document.createElement('div'); rowLbl.className='hh-rowhead'; rowLbl.textContent=dowLbl;
      heatWrap.appendChild(rowLbl);
      HOUR_BUCKETS.forEach((b,bi)=>{
        const vals = heatCells[di][bi];
        const cell = document.createElement('div'); cell.className='hh-cell';
        if(vals.length){
          const avg = vals.reduce((x,y)=>x+y,0)/vals.length;
          cell.classList.add(avg>=3.6 ? 'zone-safe' : avg>=2.4 ? 'zone-caution' : 'zone-danger');
          cell.textContent = avg.toFixed(1);
          cell.title = dowLbl+' '+b.label+': avg '+avg.toFixed(1)+'/5 across '+vals.length+' log'+(vals.length===1?'':'s');
        } else {
          cell.classList.add('zone-empty');
          cell.textContent = '–';
          cell.title = dowLbl+' '+b.label+': no check-ins yet';
        }
        heatWrap.appendChild(cell);
      });
    });
  }
  const hourDesc = document.getElementById('energyByHourDesc');
  if(hourDesc){
    const flat = [];
    DOW_LABELS.forEach((dowLbl,di)=> HOUR_BUCKETS.forEach((b,bi)=>{
      const vals = heatCells[di][bi];
      if(vals.length) flat.push({dow:dowLbl, label:b.label, avg:vals.reduce((x,y)=>x+y,0)/vals.length, n:vals.length});
    }));
    const reliable = flat.filter(x=>x.n>=2);
    const pool = reliable.length>=2 ? reliable : flat;
    if(pool.length>=2){
      const worst = pool.reduce((a,b)=>a.avg<=b.avg?a:b);
      const best = pool.reduce((a,b)=>a.avg>=b.avg?a:b);
      hourDesc.textContent = (worst.dow===best.dow && worst.label===best.label)
        ? 'Energy has stayed fairly even so far.'
        : 'Lowest around '+worst.dow+', '+worst.label+' (avg '+worst.avg.toFixed(1)+'/5) · highest around '+best.dow+', '+best.label+' (avg '+best.avg.toFixed(1)+'/5).';
    } else {
      hourDesc.textContent = 'Tap the energy dots on Today a few times a day — once there’s enough logged, this grid will show when, and on which days, you tend to run low.';
    }
  }

  const heat = document.getElementById('priorityHeat'); heat.innerHTML='';
  rows.forEach(r=>{
    const st = r.log ? focusEffectiveStatus(r.log) : null;
    const cls = st==='done' ? 'heat-done' : st==='skipped' ? 'heat-skip' : 'heat-none';
    const item = document.createElement('div'); item.className='heat-item'; item.tabIndex = 0;
    const cell = document.createElement('div'); cell.className='heat-cell '+cls;
    const tip = document.createElement('div'); tip.className='tip';
    tip.textContent = dayLabel(r.date)+': '+(st==='done'?'done':st==='skipped'?'skipped':'no log');
    item.appendChild(cell); item.appendChild(tip);
    heat.appendChild(item);
  });

  const avg = arr => arr.length ? (arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(1) : '–';
  document.getElementById('energyDoneAvg').textContent = avg(rows.filter(r=>r.log&&focusEffectiveStatus(r.log)==='done').map(r=>r.log.energy));
  document.getElementById('energySkipAvg').textContent = avg(rows.filter(r=>r.log&&focusEffectiveStatus(r.log)==='skipped').map(r=>r.log.energy));

  const summaryEl = document.getElementById('overrideSummary');
  if(summaryEl){
    summaryEl.textContent = wellnessDoneCt+' of 14 days confirmed done · '+wellnessMovedCt+' moved · '+(14-wellnessDoneCt-wellnessMovedCt)+' not logged';
  }
  const reasonsWrap = document.getElementById('overrideReasons'); reasonsWrap.innerHTML='';
  const withReason = rows.filter(r=>r.log && r.log.wellnessOverride).reverse();
  if(!withReason.length) reasonsWrap.innerHTML = '<div class="small muted">none logged in the last 14 days</div>';
  withReason.forEach(r=>{
    const div = document.createElement('div'); div.className='review-row';
    div.innerHTML = '<span class="small">'+dayLabel(r.date)+'</span><span class="small">'+esc(r.log.wellnessOverrideReason||'—')+'</span>';
    reasonsWrap.appendChild(div);
  });

  const loggedSleep=rows.filter(r=>r.log&&r.log.actualBedtime).map(r=>hoursBetweenTimes(r.log.actualBedtime,state.settings.wakeTime));
  const finishedEnergy=rows.filter(r=>r.log&&focusEffectiveStatus(r.log)==='done').map(r=>r.log.energy||0);
  const skippedEnergy=rows.filter(r=>r.log&&focusEffectiveStatus(r.log)==='skipped').map(r=>r.log.energy||0);
  const signal=document.getElementById('behaviorSignal'), signalText=document.getElementById('behaviorSignalText');
  const action=document.getElementById('behaviorAction'), actionText=document.getElementById('behaviorActionText');
  if(doneRate>=70 && decided.length>=4){ signal.textContent='Your focus is sticking'; signalText.textContent=doneRate+'% of decided focus days were finished in this window.'; action.textContent='Protect the first focus block'; actionText.textContent='Keep the one-thing rule intact and use smaller tasks only as support.'; }
  else if(finishedEnergy.length>=2 && skippedEnergy.length>=2){ const fe=Number(avg(finishedEnergy)), se=Number(avg(skippedEnergy)); if(se>fe){ signal.textContent='Lower-energy days need a lighter plan'; signalText.textContent='Skipped days averaged '+se+'/5 energy versus '+fe+'/5 on finished days.'; action.textContent='Scale the focus'; actionText.textContent='On low-energy days, choose a smaller, concrete milestone rather than abandoning the focus.'; } else { signal.textContent='Energy is not the obvious blocker'; signalText.textContent='Finished days averaged '+fe+'/5 energy versus '+se+'/5 on skipped days.'; action.textContent='Look at the plan, not motivation'; actionText.textContent='Keep the focus concrete and reduce competing tasks before changing the goal.'; } }
  else if(loggedSleep.length>=4){ const avgSleep=loggedSleep.reduce((a,b)=>a+b,0)/loggedSleep.length; signal.textContent='Sleep is the clearest available signal'; signalText.textContent='You averaged '+fmtHrs(avgSleep)+' across '+loggedSleep.length+' logged nights.'; action.textContent='Protect the sleep window'; actionText.textContent='Use the bedtime data as a constraint when planning tomorrow’s one thing.'; }
  else { signal.textContent='Build the signal first'; signalText.textContent='You have '+decided.length+' decided focus days and '+loggedSleep.length+' logged nights in this window.'; action.textContent='Log consistently'; actionText.textContent='A few more days will make the patterns here much more useful.'; }
}

function toCsvValue(v){
  if(v===null||v===undefined) return '';
  const s=String(v);
  return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
}
function downloadTextFile(filename, text, mime){
  const blob = new Blob([text], {type:mime||'text/plain'});
  const url = URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click();
  a.remove(); setTimeout(()=>URL.revokeObjectURL(url), 2000);
}
function getPriorityLabelFor(log){
  if(log.priorityText) return log.priorityText;
  if(log.priorityGoalId && log.priorityMilestoneId){
    const g = state.goals.find(g=>g.id===log.priorityGoalId);
    const m = g && (g.milestones||[]).find(m=>m.id===log.priorityMilestoneId);
    if(g&&m) return g.title+' — '+m.title;
  }
  return '';
}
document.getElementById('btnExportCsv').addEventListener('click', async ()=>{
  const rows = await getAnalyticsWindow(14);
  const header = ['date','weekday','focus_status','focus_text','energy','bedtime','sleep_hours','tasks_done','tasks_total','reads_done','milestones_done','protected_time_done','protected_time_moved','moved_reason','skip_reason'];
  const lines = [header.join(',')];
  rows.forEach(r=>{
    const log = r.log||{};
    const m = rowMetrics(r);
    lines.push([
      r.date, dayLabel(r.date).split(' ')[0], focusEffectiveStatus(log)||'', getPriorityLabelFor(log),
      log.energy??'', log.actualBedtime||'', m.sleepHrs!=null?m.sleepHrs.toFixed(2):'',
      m.tasksDone, m.tasksTotal, m.readsDone, m.milestonesDone,
      log.wellnessDone?'yes':'no', log.wellnessOverride?'yes':'no', log.wellnessOverrideReason||'', log.skipReason||''
    ].map(toCsvValue).join(','));
  });
  downloadTextFile('ballast_analytics_'+todayStr()+'.csv', lines.join('\n'), 'text/csv');
});
function exportJsonBackup(){
  downloadTextFile('ballast_backup_'+todayStr()+'.json', JSON.stringify(memory, null, 2), 'application/json');
}
document.getElementById('btnExportJson').addEventListener('click', exportJsonBackup);
