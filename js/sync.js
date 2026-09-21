// ---------------------------------------------------------------------------
// Multi-device sync (Firebase Firestore). Two ways to connect — pick either, or neither:
//   • Google account : data lives at users/<your Google uid>; only you can read it.
//   • Passcode       : data lives at ballast_rooms/<hash of passcode>; anyone who knows the
//                      passcode can read it, so keep it private (use "generate").
// ---------------------------------------------------------------------------


const SYNC_LS_KEY = 'ballast_sync_passcode_v1';
let syncEnabled = false;
let roomId = null;          // Google mode: the user's uid. Passcode mode: hash of the passcode.
let roomCol = 'users';      // 'users' (Google) or 'ballast_rooms' (passcode)
let syncMode = null;        // 'google' | 'passcode'
let auth = null;
let db = null;
let currentUser = null;
let interactiveSignIn = false;   // true right after the person pressed a connect button (vs. a silent restore)
let unsubscribeSnapshot = null;
let pushTimer = null;
let lastPushedJSON = null;
let pendingRemoteRefresh = false;

function setStatus(text){
  const el = document.getElementById('statusLine');
  if(el) el.textContent = text;
}
function localStatus(){ return lsOk ? 'saved in this browser' : 'not saving — enable storage in your browser'; }
function firebaseConfigLooksReal(){
  return typeof FIREBASE_CONFIG !== 'undefined' &&
         FIREBASE_CONFIG.apiKey && !/^YOUR_/.test(FIREBASE_CONFIG.apiKey) &&
         FIREBASE_CONFIG.projectId && !/^YOUR_/.test(FIREBASE_CONFIG.projectId);
}
async function hashPasscode(pc){
  const norm = 'ballast-room::' + String(pc).trim().toLowerCase();
  if(window.crypto && window.crypto.subtle){
    try{
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(norm));
      return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,32);
    }catch(e){ /* fall through to the simple hash below */ }
  }
  // crypto.subtle needs a secure context (https/localhost). Over plain http, fall back to a
  // simple non-cryptographic hash so sync still works.
  let h = 2166136261;
  for(let i=0;i<norm.length;i++){ h ^= norm.charCodeAt(i); h = Math.imul(h, 16777619); }
  return 'room_' + (h>>>0).toString(16);
}
function isTypingActive(){
  const el = document.activeElement;
  if(!el) return false;
  if(el.tagName === 'TEXTAREA') return true;
  if(el.tagName === 'INPUT'){
    const type = (el.type||'text').toLowerCase();
    return ['text','number','url','time','search'].includes(type);
  }
  return false;
}
// Anything worth protecting on this device? A brand-new device only holds today's empty log.
function localHasRealData(){
  const goals = Object.keys(memory['goals']||{}).length;
  const reads = Object.keys(memory['reads']||{}).length;
  const logs = Object.keys(memory).filter(k=>k.indexOf('dailyLogs/')===0).length;
  return goals>0 || reads>0 || logs>1;
}
// Firebase Auth can't run from a page opened straight off disk (file://, i.e. double-clicking
// index.html). Sync is simply off there: no errors, no pop-ups, everything still saves locally.
function syncSupportedHere(){ return location.protocol === 'https:' || location.protocol === 'http:'; }
function notSupportedMsg(){ return 'Sync doesn\u2019t work when the page is opened as a file.'; }
function ensureFirebase(){
  if(db && auth) return true;
  if(!syncSupportedHere()) return false;
  if(typeof firebase === 'undefined') return false;
  if(!firebaseConfigLooksReal()) return false;
  try{
    if(!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    auth = firebase.auth();
    db = firebase.firestore();
    return true;
  }catch(e){ console.error('Firebase init failed', e); auth = null; db = null; return false; }
}
function roomRef(){ return db.collection(roomCol).doc(roomId); }
function savedPasscode(){ try{ return localStorage.getItem(SYNC_LS_KEY)||''; }catch(e){ return ''; } }

function describeAuthError(e){
  const code = (e && e.code) || 'error';
  if(code === 'auth/unauthorized-domain') return 'This site\u2019s domain isn\u2019t in Firebase > Authentication > Settings > Authorized domains.';
  if(code === 'auth/operation-not-allowed') return 'Google sign-in isn\u2019t enabled yet (Firebase > Authentication > Sign-in method).';
  if(code === 'auth/network-request-failed') return 'Network problem \u2014 check your connection and try again.';
  return 'Sign-in failed ('+code+').';
}
// Called straight from the button's click handler: no `await` before the popup, or some
// browsers (Safari especially) treat the popup as unrequested and block it.
function signInWithGoogle(){
  if(!auth){ alert(syncSupportedHere() ? 'Sync isn\u2019t set up yet \u2014 add your Firebase config in js/firebase-config.js.' : notSupportedMsg()); return Promise.resolve(false); }
  const provider = new firebase.auth.GoogleAuthProvider();
  interactiveSignIn = true;
  return auth.signInWithPopup(provider).then(()=>true).catch(e=>{
    const code = e && e.code;
    if(code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment'){
      // Popups unavailable (some installed-app / in-app browsers): full-page redirect instead.
      return auth.signInWithRedirect(provider).then(()=>true).catch(e2=>{ interactiveSignIn = false; alert(describeAuthError(e2)); return false; });
    }
    interactiveSignIn = false;
    if(code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request'){
      console.error('sign-in failed', e); setStatus('sign-in failed'); alert(describeAuthError(e));
    }
    return false;
  });
}
// Passcode option: sign in anonymously (so Firestore accepts the request) and use the hashed
// passcode as the room id. The passcode itself never leaves this device.
function connectWithPasscode(pc){
  if(!auth){ alert(syncSupportedHere() ? 'Sync isn\u2019t set up yet \u2014 add your Firebase config in js/firebase-config.js.' : notSupportedMsg()); return Promise.resolve(false); }
  try{ localStorage.setItem(SYNC_LS_KEY, pc); }catch(e){}
  interactiveSignIn = true;
  if(auth.currentUser && auth.currentUser.isAnonymous){ onAuthUser(auth.currentUser); return Promise.resolve(true); }
  return auth.signInAnonymously().then(()=>true).catch(e=>{
    interactiveSignIn = false;
    try{ localStorage.removeItem(SYNC_LS_KEY); }catch(_){}
    console.error('anonymous sign-in failed', e);
    alert(e && e.code==='auth/operation-not-allowed'
      ? 'Anonymous sign-in isn\u2019t enabled yet (Firebase > Authentication > Sign-in method > Anonymous).'
      : describeAuthError(e));
    return false;
  });
}
function disconnectSync(){
  try{ localStorage.removeItem(SYNC_LS_KEY); }catch(e){}
  // Signing out fires onAuthStateChanged(null), which stops the listener.
  if(auth) auth.signOut().catch(e=>console.error('sign-out failed', e));
  else stopSync();
}
function stopSync(){
  syncEnabled = false;
  roomId = null; currentUser = null; syncMode = null;
  clearTimeout(pushTimer);
  if(unsubscribeSnapshot){ unsubscribeSnapshot(); unsubscribeSnapshot = null; }
  setStatus(localStatus());
  refreshSyncSettingsUI();
}
async function onAuthUser(user){
  const pc = savedPasscode();
  if(user && !user.isAnonymous){
    syncMode = 'google'; roomCol = 'users'; roomId = user.uid;
  } else if(user && user.isAnonymous && pc){
    syncMode = 'passcode'; roomCol = 'ballast_rooms'; roomId = await hashPasscode(pc);
  } else if(!user && pc){
    // Saved passcode but no session yet (first load after connecting, or the session expired).
    if(auth) auth.signInAnonymously().catch(e=>{ console.error('anonymous sign-in failed', e); setStatus(localStatus()+' \u00b7 sync offline'); });
    return;
  } else { stopSync(); return; }
  currentUser = user;
  if(interactiveSignIn){
    interactiveSignIn = false;
    try{
      const existing = await roomRef().get();
      if(existing.exists && localHasRealData()){
        const what = syncMode==='google' ? 'Your Google account already has' : 'That passcode already has';
        const proceed = confirm(what+' synced Ballast data. Connecting here will replace what\'s on THIS device with that data. Continue?');
        if(!proceed){ disconnectSync(); return; }
      }
    }catch(e){ /* if the check fails, attachListener below still handles it safely */ }
  }
  syncEnabled = true;
  attachListener();
  refreshSyncSettingsUI();
}
function syncLabel(){
  if(syncMode === 'google') return currentUser && currentUser.email ? currentUser.email : 'Google account';
  return 'passcode room #'+(roomId ? roomId.slice(0,4) : '');
}
function attachListener(){
  if(unsubscribeSnapshot) unsubscribeSnapshot();
  unsubscribeSnapshot = roomRef().onSnapshot(snap=>{
    if(!snap.exists){
      // Nothing synced for this account yet — seed the cloud copy with what's on this device.
      pushMemory();
      setStatus('synced · '+syncLabel()+' (created here)');
      return;
    }
    const data = snap.data() || {};
    const json = JSON.stringify(data.memory||{});
    if(json === lastPushedJSON){ setStatus('synced · '+syncLabel()); return; }
    // Change came from another device
    Object.keys(memory).forEach(k=>delete memory[k]);
    Object.assign(memory, data.memory||{});
    try{ localStorage.setItem(LS_KEY, JSON.stringify(memory)); }catch(e){}
    if(isTypingActive()){ pendingRemoteRefresh = true; }
    else { loadAll(); }
    setStatus('synced · '+syncLabel()+' · updated just now');
  }, err=>{
    console.error('sync listener error', err);
    setStatus('sync error — check Firestore rules (see sync.js)');
  });
}
function schedulePush(){
  if(!syncEnabled) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushMemory, 700);
}
async function pushMemory(){
  if(!syncEnabled || !db || !roomId) return;
  let safe;
  try{ safe = JSON.parse(JSON.stringify(memory)); }catch(e){ safe = memory; }
  const json = JSON.stringify(safe);
  lastPushedJSON = json;
  // Firestore documents max out at 1 MiB and the whole store lives in one doc — warn well before that.
  if(json.length > 850000) setStatus('sync almost full ('+Math.round(json.length/1024)+' KB of 1024) — export a backup and trim old data');
  try{
    await roomRef().set({ memory: safe, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
  }catch(e){
    console.error('sync push failed', e);
    if(e && (e.code==='unavailable' || e.code==='deadline-exceeded')){
      setStatus('offline — saved locally, retrying sync…');
      clearTimeout(pushTimer); pushTimer = setTimeout(pushMemory, 15000);   // transient: try again
    } else {
      // permission-denied, invalid-argument (too large), etc. won't fix themselves by retrying
      setStatus('sync failed ('+((e&&e.code)||'error')+') — saved locally only');
    }
  }
}
function refreshSyncSettingsUI(){
  const chooser = document.getElementById('syncChooser');
  const disconnectBtn = document.getElementById('btnSyncDisconnect');
  const detail = document.getElementById('syncStatusDetail');
  if(chooser) chooser.style.display = syncEnabled ? 'none' : '';
  if(disconnectBtn) disconnectBtn.style.display = syncEnabled ? '' : 'none';
  if(detail){
    if(syncEnabled && syncMode==='google') detail.textContent = 'Signed in as '+syncLabel()+'. Your other devices signed in to this account stay in sync.';
    else if(syncEnabled) detail.textContent = 'Connected with passcode "'+savedPasscode()+'" ('+syncLabel()+'). Enter the same passcode on your other devices. Anyone with it can read this data.';
    else if(!syncSupportedHere()) detail.textContent = notSupportedMsg();
    else detail.textContent = firebaseConfigLooksReal() ? 'Not connected \u2014 data stays on this device only.' : 'Sync isn\u2019t configured yet \u2014 see js/firebase-config.js';
  }
}
document.addEventListener('focusout', ()=>{
  if(!pendingRemoteRefresh) return;
  setTimeout(()=>{ if(pendingRemoteRefresh && !isTypingActive()){ pendingRemoteRefresh=false; loadAll(); } }, 50);
});

const PASSCODE_WORDS = ['amber','birch','cedar','coral','dune','ember','falcon','fern','glacier','harbor','indigo','juniper','kestrel','lagoon','maple','nectar','onyx','pepper','quartz','raven','saffron','tundra','umber','violet','willow','zephyr','otter','heron','marsh','clover'];
// ~55 bits of entropy: 3 words + 8 random characters (no look-alikes: i, l, o, 0, 1), from the
// browser's cryptographic RNG. Lowercase only, because passcodes are lowercased before hashing.
function generatePasscode(){
  const rand = n => { const a = new Uint32Array(1); const lim = Math.floor(4294967296/n)*n;
    do { crypto.getRandomValues(a); } while(a[0] >= lim); return a[0] % n; };
  const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';
  const words = [0,1,2].map(()=>PASSCODE_WORDS[rand(PASSCODE_WORDS.length)]);
  let tail = ''; for(let i=0;i<8;i++) tail += ALPHA[rand(ALPHA.length)];
  return words.join('-') + '-' + tail;
}
document.getElementById('btnGeneratePasscode').addEventListener('click', ()=>{
  document.getElementById('setSyncPasscode').value = generatePasscode();
});

async function initDb(){
  setStatus(localStatus());
  if(!ensureFirebase()){ refreshSyncSettingsUI(); return; }
  // Returning from a redirect-style sign-in counts as the person having just signed in.
  try{
    const r = await auth.getRedirectResult();
    if(r && r.user) interactiveSignIn = true;
  }catch(e){ console.error('redirect sign-in check failed', e); }   // startup stays quiet; a real failure shows when you press Sign in
  // Fires once now (restoring a saved sign-in, or null) and again on every sign-in / sign-out.
  auth.onAuthStateChanged(user=>{ onAuthUser(user); });
  refreshSyncSettingsUI();
}
