function renderNavMusic(){
  const wrap = document.getElementById('navMusicList');
  if(!wrap) return;
  const playlists = state.settings.musicPlaylists || [];
  wrap.innerHTML = '';
  if(!playlists.length){
    const empty = document.createElement('div');
    empty.className='nav-music-empty';
    empty.textContent='♪ add music in Settings';
    wrap.appendChild(empty);
    return;
  }
  playlists.forEach((pl)=>{
    const a = document.createElement('a');
    a.className='nav-music';
    a.href=safeUrl(pl.url) || '#';
    a.target='_blank';
    a.rel='noopener';
    a.textContent='♪ '+pl.name;
    a.title=pl.url;
    wrap.appendChild(a);
  });
}
function renderMusic(){
  const list = document.getElementById('playlistSettingsList');
  if(!list) return;
  list.innerHTML='';
  const playlists = state.settings.musicPlaylists || [];
  if(!playlists.length){
    list.innerHTML='<div class="small muted playlist-empty">No playlists saved yet.</div>';
    return;
  }
  playlists.forEach((pl, index)=>{
    const row=document.createElement('div'); row.className='playlist-setting-row';
    row.innerHTML='<div><div class="playlist-setting-name"></div><div class="small muted playlist-setting-url"></div></div><button class="btn btn-danger" type="button">remove</button>';
    row.querySelector('.playlist-setting-name').textContent='♪ '+pl.name;
    row.querySelector('.playlist-setting-url').textContent=pl.url;
    row.querySelector('button').addEventListener('click', async ()=>{
      state.settings.musicPlaylists.splice(index,1);
      await docSet('settings/main', state.settings);
      renderMusic(); renderNavMusic();
    });
    list.appendChild(row);
  });
}

function renderSettingsForm(){
  document.getElementById('setWake').value = state.settings.wakeTime;
  document.getElementById('setBedtimeEarliest').value = state.settings.bedtimeEarliest;
  document.getElementById('setBedtimeLatest').value = state.settings.bedtimeLatest;
  document.getElementById('setWellLabel').value = state.settings.wellLabel;
  document.getElementById('setWellStart').value = state.settings.wellStart;
  document.getElementById('setWellEnd').value = state.settings.wellEnd;
  const name=document.getElementById('setMusicName'), url=document.getElementById('setMusicUrl');
  if(name) name.value='';
  if(url) url.value='';
  applyTheme(state.settings.theme || 'light');
  applyPalette(state.settings.palette || 'color');
  updateSleepHint();
  refreshSyncSettingsUI();
}
function updateSleepHint(){
  const e = document.getElementById('setBedtimeEarliest').value || state.settings.bedtimeEarliest;
  const l = document.getElementById('setBedtimeLatest').value || state.settings.bedtimeLatest;
  const w = document.getElementById('setWake').value || state.settings.wakeTime;
  const min = hoursBetweenTimes(l, w), max = hoursBetweenTimes(e, w);
  document.getElementById('sleepRangeHint').textContent =
    'sleep between '+e+' and '+l+' gives you '+fmtHrs(min)+' to '+fmtHrs(max)+' of sleep.';
}
['setBedtimeEarliest','setBedtimeLatest','setWake'].forEach(id=>{
  document.getElementById(id).addEventListener('input', updateSleepHint);
});
document.getElementById('btnSaveSettings').addEventListener('click', async ()=>{
  state.settings = {
    ...state.settings,
    wakeTime: document.getElementById('setWake').value || state.settings.wakeTime,
    bedtimeEarliest: document.getElementById('setBedtimeEarliest').value || state.settings.bedtimeEarliest,
    bedtimeLatest: document.getElementById('setBedtimeLatest').value || state.settings.bedtimeLatest,
    wellLabel: document.getElementById('setWellLabel').value || 'Focus block',
    wellStart: document.getElementById('setWellStart').value || state.settings.wellStart,
    wellEnd: document.getElementById('setWellEnd').value || state.settings.wellEnd,
    theme: document.documentElement.dataset.theme || state.settings.theme || 'light',
    palette: document.documentElement.dataset.palette || state.settings.palette || 'color'
  };
  await docSet('settings/main', state.settings);
  renderHero(); renderWellness(); renderMusic(); renderNavMusic();
});

document.getElementById('btnAddMusic').addEventListener('click', async ()=>{
  const nameEl=document.getElementById('setMusicName'), urlEl=document.getElementById('setMusicUrl');
  const name=nameEl.value.trim(), url=urlEl.value.trim();
  if(!name || !url) return;
  if(!safeUrl(url)){ urlEl.focus(); alert('Enter a full http(s) link, e.g. https://open.spotify.com/…'); return; }
  state.settings.musicPlaylists = state.settings.musicPlaylists || [];
  state.settings.musicPlaylists.push({id:'music_'+Date.now(), name, url});
  state.settings.musicLink = state.settings.musicPlaylists[0]?.url || '';
  await docSet('settings/main', state.settings);
  nameEl.value=''; urlEl.value='';
  renderMusic(); renderNavMusic();
});

// Appearance
async function setTheme(next){
  state.settings.theme = next;
  applyTheme(next);
  await docSet('settings/main', state.settings);
}
async function setPalette(next){
  state.settings.palette = next;
  applyPalette(next);
  // Goal colors are set inline by JS (not CSS), so anything that draws them must re-render.
  renderGoals(); renderTodayRoadmapBars();
  const calView = document.getElementById('view-calendar');
  if(calView && calView.classList.contains('active')) renderCalendar();
  await docSet('settings/main', state.settings);
}
document.getElementById('themeToggle').addEventListener('click', ()=>{
  setTheme((document.documentElement.dataset.theme || 'light') === 'dark' ? 'light' : 'dark');
});
document.querySelectorAll('#setThemeSeg [data-value]').forEach(b=>b.addEventListener('click', ()=>setTheme(b.dataset.value)));
document.querySelectorAll('#setPaletteSeg [data-value]').forEach(b=>b.addEventListener('click', ()=>setPalette(b.dataset.value)));
document.getElementById('btnSyncConnect').addEventListener('click', ()=>{
  signInWithGoogle();   // must run straight from the click so browsers allow the popup
});
document.getElementById('btnPasscodeConnect').addEventListener('click', async ()=>{
  const pc = (document.getElementById('setSyncPasscode').value||'').trim();
  if(!pc){ alert('Enter a passcode first, or press "generate one for me".'); return; }
  if(pc.length < 14 && !confirm('That passcode is short, so someone could guess it and read your data. Press Cancel and use "generate" instead, or OK to keep it anyway.')) return;
  const btn = document.getElementById('btnPasscodeConnect');
  btn.disabled = true;
  await connectWithPasscode(pc);
  btn.disabled = false;
  refreshSyncSettingsUI();
});
document.getElementById('btnSyncDisconnect').addEventListener('click', ()=>{
  if(!confirm('Disconnect this device from sync? Your data stays on this device and in your cloud copy \u2014 you just stop syncing.')) return;
  disconnectSync();
});
const btnSettingsDownloadJson = document.getElementById('btnSettingsDownloadJson');
if(btnSettingsDownloadJson) btnSettingsDownloadJson.addEventListener('click', ()=>{ exportJsonBackup(); });
// Works on any memory-shaped object 
function summarizeMemory(mem){
  const daysLogged = Object.keys(mem).filter(k=>k.indexOf('dailyLogs/')===0).length;
  const goalsCount = Object.keys(mem['goals']||{}).length;
  let streak = 0;
  const d = new Date();
  for(let i=0;i<3650;i++){
    const ds = dateStrFromObj(d);
    const log = mem['dailyLogs/'+ds];
    if(log && focusEffectiveStatus(log)==='done'){ streak++; d.setDate(d.getDate()-1); }
    else break;
  }
  return { daysLogged, goalsCount, streak };
}
function renderSummaryStats(el, summary){
  if(!el) return;
  el.innerHTML =
    '<div class="modal-stat"><div class="n mono">'+summary.daysLogged+'</div><div class="l">days logged</div></div>'+
    '<div class="modal-stat"><div class="n mono">'+summary.goalsCount+'</div><div class="l">goals</div></div>'+
    '<div class="modal-stat"><div class="n mono">'+summary.streak+'</div><div class="l">day streak</div></div>';
}
const resetModal = document.getElementById('resetModal');
document.getElementById('btnResetAll').addEventListener('click', ()=>{
  const summary = summarizeMemory(memory);
  document.getElementById('resetModalBody').textContent = syncEnabled
    ? 'This removes goals, logs, reading queue, playlists, and settings — and because sync is on, it clears the synced copy too (your other synced devices will lose it as well).'
    : 'This removes goals, logs, reading queue, playlists, and settings.';
  renderSummaryStats(document.getElementById('resetModalStats'), summary);
  resetModal.hidden = false;
});
document.getElementById('btnResetCancel').addEventListener('click', ()=>{ resetModal.hidden = true; });
document.getElementById('btnResetDownloadJson').addEventListener('click', ()=>{ exportJsonBackup(); });
document.getElementById('btnResetConfirm').addEventListener('click', async ()=>{
  resetModal.hidden = true;
  try{
    localStorage.removeItem(LS_KEY);
    // Clear the in-memory store too. 
    Object.keys(memory).forEach(key=>delete memory[key]);
    lsOk = true;
  }catch(e){ lsOk=false; }
  state.settings = { wakeTime:'07:30', bedtimeEarliest:'01:00', bedtimeLatest:'02:00', wellLabel:'Gym', wellStart:'18:00', wellEnd:'19:00', musicLink:'', musicPlaylists:[], theme:'light', palette:'color' };
  state.goals=[]; state.reads=[]; state.todayLog=defaultTodayLog();
  applyTheme('light'); applyPalette('color'); renderAll();
  document.getElementById('statusLine').textContent = lsOk ? 'cleared — ready for a fresh start' : 'storage unavailable';
});

// ---------------------------------------------------------------------------
// Restore from a JSON backup (the counterpart to exportJsonBackup in behavior.js)
// ---------------------------------------------------------------------------
const restoreModal = document.getElementById('restoreModal');
const restoreFileInput = document.getElementById('restoreFileInput');
const btnRestoreBackup = document.getElementById('btnRestoreBackup');
let pendingRestoreData = null;

if(btnRestoreBackup) btnRestoreBackup.addEventListener('click', ()=>{
  restoreFileInput.value = ''; // so picking the same file twice still fires 'change'
  restoreFileInput.click();
});
if(restoreFileInput) restoreFileInput.addEventListener('change', ()=>{
  const file = restoreFileInput.files && restoreFileInput.files[0];
  const statusEl = document.getElementById('restoreStatus');
  if(!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    let parsed;
    try{ parsed = JSON.parse(reader.result); }
    catch(e){ if(statusEl) statusEl.textContent = "That file isn't valid JSON — nothing was changed."; return; }
    if(!parsed || typeof parsed !== 'object' || Array.isArray(parsed)){
      if(statusEl) statusEl.textContent = "That doesn't look like a Ballast backup file — nothing was changed.";
      return;
    }
    pendingRestoreData = parsed;
    if(statusEl) statusEl.textContent = '';
    document.getElementById('restoreModalBody').textContent = syncEnabled
      ? "This replaces everything currently in Ballast on this device — and since sync is on, it will overwrite the synced copy on all your synced devices too."
      : "This replaces everything currently in Ballast on this device.";
    renderSummaryStats(document.getElementById('restoreBackupStats'), summarizeMemory(parsed));
    renderSummaryStats(document.getElementById('restoreCurrentStats'), summarizeMemory(memory));
    restoreModal.hidden = false;
  };
  reader.onerror = ()=>{ if(statusEl) statusEl.textContent = 'Could not read that file.'; };
  reader.readAsText(file);
});
document.getElementById('btnRestoreCancel').addEventListener('click', ()=>{
  restoreModal.hidden = true; pendingRestoreData = null;
});
document.getElementById('btnRestoreDownloadCurrent').addEventListener('click', ()=>{ exportJsonBackup(); });
document.getElementById('btnRestoreConfirm').addEventListener('click', async ()=>{
  if(!pendingRestoreData) return;
  restoreModal.hidden = true;
  // Full replace
  Object.keys(memory).forEach(k=>delete memory[k]);
  Object.assign(memory, pendingRestoreData);
  saveMemory(); // also pushes to sync, if connected — matches how Reset already behaves
  pendingRestoreData = null;
  await loadAll();
  document.getElementById('statusLine').textContent = 'restored from backup';
});
