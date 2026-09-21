(async function start(){
  await initDb();
  await loadAll();
  setInterval(tick, 30000);
})();

function tick(){
  // The date changed while the page was open: close out yesterday, load the new day.
  // (Must come before renderHero(), which saves.)
  if(state.loadedDay && state.loadedDay !== todayStr()){
    if(!isTypingActive()) rolloverDay();
    return;
  }
  if(pendingRemoteRefresh && !isTypingActive()){ pendingRemoteRefresh=false; loadAll(); return; }
  renderHero(); renderWellness();
}
