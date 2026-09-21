const state = {
  settings: { wakeTime:'07:30', bedtimeEarliest:'01:00', bedtimeLatest:'02:00', wellLabel:'Gym', wellStart:'18:00', wellEnd:'19:00', musicLink:'', musicPlaylists:[], theme:'light', palette:'color' },
  goals: [],
  todayLog: defaultTodayLog(),
  reads: []
};

function applyTheme(theme){
  const chosen = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = chosen;
  const toggle = document.getElementById('themeToggle');
  if(toggle){
    const next = chosen==='dark' ? 'light' : 'dark';
    toggle.setAttribute('aria-pressed', chosen==='dark' ? 'true' : 'false');
    toggle.setAttribute('aria-label', 'Switch to '+next+' theme');
    toggle.title = 'Switch to '+next+' theme';
  }
  syncSegmented('setThemeSeg', chosen);
}
// Marks the matching button in a Settings segmented control as active.
function syncSegmented(id, value){
  const el = document.getElementById(id);
  if(!el) return;
  el.querySelectorAll('[data-value]').forEach(b=>{
    const on = b.dataset.value === value;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}
// Palette is independent of light/dark: theme = data-theme, palette = data-palette,
function applyPalette(palette){
  const chosen = palette === 'bw' ? 'bw' : 'color';
  document.documentElement.dataset.palette = chosen;
  syncSegmented('setPaletteSeg', chosen);
}
// Apply the saved look immediately from localStorage instead of waiting for loadAll(),
const earlySettings = memory['settings/main'] || {};
applyTheme(earlySettings.theme || state.settings.theme);
applyPalette(earlySettings.palette || state.settings.palette);

function tabSwitch(name){
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active', t.dataset.tab===name));
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active', v.id==='view-'+name));
  if(name==='behavior') renderBehavior();
  if(name==='calendar') renderCalendar();
}
document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click', ()=>tabSwitch(t.dataset.tab)));

async function saveToday(){
  // If midnight has passed since this day was loaded, state.todayLog still holds the OLD day.
  // Never write it under the new date: close the old day out first, then load the new one.
  if(state.loadedDay && state.loadedDay !== todayStr()){ await rolloverDay(); return; }
  await docSet('dailyLogs/'+todayStr(), state.todayLog);
}

// A day that ends with the one thing neither finished nor skipped counts as skipped.
// `autoSkipped` marks it as the app's doing (not yours) so Today can say so, and so a skip
// you chose yourself — with your own reason — is never touched. Small tasks don't count:
// "the one thing" is what the streak is about. Idempotent: safe to run on every load.
function autoSkipIfUnfinished(log){
  if(!log) return false;
  if(log.focusDoneToday || log.priorityStatus==='done' || log.priorityStatus==='skipped') return false;
  log.priorityStatus = 'skipped';
  log.autoSkipped = true;
  if(!log.skipReason) log.skipReason = '(auto) day ended';
  return true;
}
// Called when the date changes while the app is open: save the day that just ended (including
// any edit not yet written), close it out, then load the fresh new day.
async function rolloverDay(){
  autoSkipIfUnfinished(state.todayLog);
  await docSet('dailyLogs/'+state.loadedDay, state.todayLog);
  await loadAll();
}

async function loadAll(){
  const s = await docGet('settings/main');
  if(s){
    state.settings = {...state.settings, ...s};
    if(!Array.isArray(state.settings.musicPlaylists)) state.settings.musicPlaylists = [];
    if(s.musicLink && !state.settings.musicPlaylists.length){
      state.settings.musicPlaylists = [{id:'legacy', name:'Music', url:s.musicLink}];
    }
    if(s.bedtime && !s.bedtimeEarliest){
      state.settings.bedtimeEarliest = s.bedtime;
      state.settings.bedtimeLatest = addMinutes(s.bedtime, 60);
    }
  }
  state.goals = await colGetAll('goals');
  state.loadedDay = todayStr();
  // Close out yesterday if it ended unfinished. This also covers a page that was closed at
  // midnight, not just one left open across it.
  const prevDay = addDays(state.loadedDay, -1);
  const prev = await docGet('dailyLogs/'+prevDay);
  if(prev && autoSkipIfUnfinished(prev)) await docSet('dailyLogs/'+prevDay, prev);
  state.rolloverNote = (prev && prev.autoSkipped) ? prevDay : '';
  // Always start from a blank day: merging into the previous state.todayLog would carry
  // yesterday's focus/tasks into a day that has no log yet.
  state.todayLog = defaultTodayLog();
  const t = await docGet('dailyLogs/'+state.loadedDay);
  if(t){
    state.todayLog = {...state.todayLog, ...t, completedToday:Array.isArray(t.completedToday)?t.completedToday:[], commitments:Array.isArray(t.commitments)?t.commitments:[]};
    if(!state.todayLog.commitments.length && Number(t.fixedHours)>0){
      state.todayLog.commitments = [{id:'legacy_fixed', text:'Other commitments', hours:Number(t.fixedHours)}];
    }
  }
  state.reads = await colGetAll('reads');
  applyTheme(state.settings.theme || 'light');
  applyPalette(state.settings.palette || 'color');
  renderAll();
}

function renderAll(){
  renderHero();
  renderPriority();
  renderCompletedToday();
  renderTodayRoadmapBars();
  renderTasks();
  renderWellness();
  renderMusic();
  renderNavMusic();
  renderReads();
  renderSettingsForm();
  renderGoals();
  renderLastNight();
}
