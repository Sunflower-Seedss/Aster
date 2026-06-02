// ============================================================
//  Sunny's Dreamjourney Toolkit V1 - content script v2.4
//  Made by SunflowerS at Dreamjourney AI
// ============================================================
(function () {
  'use strict';
  if (window.__djtLoaded) return;
  window.__djtLoaded = true;

  const SETTINGS_KEY = 'djt:settings';
  let currentSessionId = null, active = false;
  let containerObserver = null, scratchpadInterval = null;
  const storeKey = () => 'djt:' + currentSessionId;

  const DEFAULT_SETTINGS = {
    theme: 'dark', saveRegens: true, stats: true, nexus: true,
    scratchpad: true, autoRefresh: true, deleteThinking: false,
    panelPos: null
  };
  const DEFAULT_STORE = {
    rerolls: 0, sinceNexus: 0,
    regenHistory: { versions: [], current: 0 },
    scratch: '',
    scratchHistory: [],      // up to 5 most-recent SENT messages
    countsSnapshot: { user: 0, bot: 0, total: 0 }
  };

  let settings = Object.assign({}, DEFAULT_SETTINGS);
  let store    = Object.assign({}, DEFAULT_STORE);

  // ---- storage ------------------------------------------------
  function loadAll() {
    return new Promise(res => {
      try {
        chrome.storage.local.get([storeKey(), SETTINGS_KEY], data => {
          store    = Object.assign({}, DEFAULT_STORE, (data && data[storeKey()]) || {});
          settings = Object.assign({}, DEFAULT_SETTINGS, (data && data[SETTINGS_KEY]) || {});
          if (!store.regenHistory || !Array.isArray(store.regenHistory.versions))
            store.regenHistory = { versions: [], current: 0 };
          if (!Array.isArray(store.scratchHistory)) store.scratchHistory = [];
          res();
        });
      } catch (e) { res(); }
    });
  }
  let storeTimer = null;
  const saveStore = () => {
    clearTimeout(storeTimer);
    storeTimer = setTimeout(() => {
      try { if (currentSessionId) chrome.storage.local.set({ [storeKey()]: store }); } catch (e) {}
    }, 150);
  };
  const saveSettings = () => { try { chrome.storage.local.set({ [SETTINGS_KEY]: settings }); } catch (e) {} };

  // ---- url helpers --------------------------------------------
  const isSessionUrl = () => /\/app\/session\/[^/]+/.test(location.pathname);
  const sessionIdFromUrl = () => { const m = location.pathname.match(/\/app\/session\/([^/?#]+)/); return m ? m[1] : null; };

  // ---- DOM helpers --------------------------------------------
  const getContainer = () => document.querySelector('.scrollchatmessages');
  function getMessages() {
    const c = getContainer(); if (!c) return [];
    const seen = new Set();
    return [...c.querySelectorAll('[id^="message-"]')].filter(el => { if (seen.has(el.id)) return false; seen.add(el.id); return true; });
  }
  const isBot   = el => !!el.querySelector('img[alt="@shadcn"]');
  const msgText = el => ((el.querySelector('.markdown') || el).innerText || '').trim();
  const lastBot = () => { const ms = getMessages(); for (let i = ms.length-1; i >= 0; i--) if (isBot(ms[i])) return ms[i]; return null; };
  function fireHover(el) { ['pointerover','mouseover','mouseenter','pointerenter','mousemove'].forEach(t => { try { el.dispatchEvent(new MouseEvent(t,{bubbles:true})); } catch(e){} }); }
  function setReactValue(el, value) {
    const proto = el.tagName==='TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto,'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}));
  }
  const waitFor = (fn, timeout=5000, interval=120) => new Promise(res => {
    const t0 = Date.now();
    (function poll() { let r=null; try{r=fn()}catch(e){} if(r) return res(r); if(Date.now()-t0>timeout) return res(null); setTimeout(poll,interval); })();
  });

  // ---- STATS --------------------------------------------------
  function liveCounts() { let u=0,b=0; getMessages().forEach(el=>isBot(el)?b++:u++); return {user:u,bot:b,total:u+b}; }
  // Green < 20, Orange < 35, Red >= 35
  const nexusClass = n => n <= 20 ? 'green' : n <= 40 ? 'orange' : 'red';

  function countRemovedMessages(mutations) {
    const ids = new Set();
    mutations.forEach(m => [...m.removedNodes].forEach(n => {
      if (n.nodeType!==1) return;
      const add = id => { if (id&&id.startsWith('message-')) ids.add(id); };
      add(n.id); if (n.querySelectorAll) [...n.querySelectorAll('[id^="message-"]')].forEach(e=>add(e.id));
    }));
    return ids.size;
  }

  function refreshStatsUI() {
    if (!active) return;
    const c = liveCounts(); store.countsSnapshot = c;
    const set = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
    set('djt-s-user',c.user); set('djt-s-bot',c.bot); set('djt-s-total',c.total); set('djt-s-rerolls',store.rerolls);
    const nexusSection = document.getElementById('djt-nexus-section');
    if (nexusSection) nexusSection.style.display = (settings.stats && settings.nexus) ? '' : 'none';
    const nv = document.getElementById('djt-nexus-val');
    if (nv) { nv.textContent=store.sinceNexus; nv.className='djt-nexus-num '+nexusClass(store.sinceNexus); }
    const warn = document.getElementById('djt-nexus-warn');
    if (warn) warn.style.display = (settings.stats && settings.nexus && store.sinceNexus >= 50) ? 'block' : 'none';
    refreshScratchUI();
    saveStore();
  }

  // ---- REGEN TRACKING -----------------------------------------
  let expectingReply=false, regenPending=false;
  let regenTargetIdx=-1, regenAnchorUserId=null, regenStartTime=0;
  let settleTimer=null, previewIndex=null;
  let djtMutating=false, statsDebounce=null, thinkingDebounce=null;

  function findRegenTarget() {
    const ms = getMessages();
    // Primary: first bot message after the stable anchor user message
    if (regenAnchorUserId) {
      const ai = ms.findIndex(m => m.id === regenAnchorUserId);
      if (ai >= 0) { for (let i=ai+1;i<ms.length;i++) if(isBot(ms[i])) return ms[i]; }
    }
    // Fallback: index-based
    if (regenTargetIdx>=0 && ms[regenTargetIdx]) return ms[regenTargetIdx];
    return lastBot();
  }

  function onUserSent() {
    // Save the unsent draft as the most-recent sent item (handles Stop-button message deletion)
    if (settings.scratchpad && store.scratch && store.scratch.trim()) {
      if (!Array.isArray(store.scratchHistory)) store.scratchHistory = [];
      store.scratchHistory.unshift(store.scratch.trim());
      if (store.scratchHistory.length > 5) store.scratchHistory.pop();
    }
    if (settings.stats) store.sinceNexus += 1;
    expectingReply = true;
    store.regenHistory = { versions: [], current: 0 };
    previewIndex = null; store.scratch = '';
    saveStore(); refreshStatsUI(); refreshRegenPanel(); hideRestoreBar();
    refreshScratchHistUI();
  }

  function captureRegenStart(botEl) {
    const ms = getMessages();
    regenTargetIdx = ms.indexOf(botEl);
    // Stable anchor: the preceding user message id doesn't change during regen
    regenAnchorUserId = null;
    for (let i=regenTargetIdx-1; i>=0; i--) { if (!isBot(ms[i])) { regenAnchorUserId=ms[i].id; break; } }
    regenStartTime = Date.now();
    const currentText = msgText(botEl);
    let h = store.regenHistory;
    if (!h||!Array.isArray(h.versions)) h={versions:[],current:0};
    if (h.versions.indexOf(currentText)===-1) { h.versions.push(currentText); h.current=h.versions.length-1; }
    store.regenHistory=h; regenPending=true; saveStore();
  }

  function settleRegen() {
    if (!regenPending) return;
    if (Date.now()-regenStartTime>45000) { regenPending=false; regenTargetIdx=-1; regenAnchorUserId=null; previewIndex=null; refreshStatsUI(); refreshRegenPanel(); return; }
    const lb = findRegenTarget();
    if (!lb) { settleTimer=setTimeout(settleRegen,1500); return; }
    const newText = msgText(lb);
    const h = store.regenHistory;
    if (!newText||newText.length<20||h.versions.indexOf(newText)!==-1) { settleTimer=setTimeout(settleRegen,1500); return; }
    h.versions.push(newText); h.current=h.versions.length-1;
    store.regenHistory=h; store.rerolls+=1;
    regenPending=false; regenTargetIdx=-1; regenAnchorUserId=null; previewIndex=null;
    saveStore(); refreshStatsUI(); refreshRegenPanel();
  }

  function startContainerObserver() {
    const c = getContainer(); if (!c) return;
    if (containerObserver) containerObserver.disconnect();
    containerObserver = new MutationObserver(mutations => {
      if (!active||djtMutating) return;
      let added=false, removed=false;
      mutations.forEach(m => { if(m.addedNodes.length) added=true; if(m.removedNodes.length) removed=true; });
      if (removed&&!regenPending&&settings.stats) { const n=countRemovedMessages(mutations); if(n>0) store.sinceNexus=Math.max(0,store.sinceNexus-n); }
      if (added&&expectingReply&&!regenPending) {
        clearTimeout(settleTimer); settleTimer=setTimeout(()=>{ if(settings.stats) store.sinceNexus+=1; expectingReply=false; saveStore(); clearTimeout(statsDebounce); refreshStatsUI(); clearTimeout(thinkingDebounce); thinkingDebounce=setTimeout(refreshThinkingButtons,600); },900);
      }
      if (added&&regenPending) { clearTimeout(settleTimer); settleTimer=setTimeout(settleRegen,900); }
      if (added||removed) { clearTimeout(statsDebounce); statsDebounce=setTimeout(refreshStatsUI,250); clearTimeout(thinkingDebounce); thinkingDebounce=setTimeout(refreshThinkingButtons,600); }
    });
    containerObserver.observe(c,{childList:true,subtree:true});
  }

  // ---- DELEGATION --------------------------------------------
  function setupDelegation() {
    document.addEventListener('click', e => {
      if (!active||!e.target.closest) return;
      const regen = e.target.closest('[aria-label="Regenerate response"]');
      if (regen&&settings.saveRegens) { const idEl=regen.closest('[id^="message-"]'); if(idEl){const botEl=getMessages().find(m=>m.id===idEl.id); if(botEl)captureRegenStart(botEl);} return; }
      const stop = e.target.closest('[aria-label="Stop generating response"]');
      if (stop&&settings.autoRefresh) { showRefreshToast(); return; }
      const nexus = e.target.closest('[aria-label="Open Memory Nexus"]');
      if (nexus) { store.sinceNexus=0; saveStore(); refreshStatsUI(); return; }
      const send = e.target.closest('[aria-label="Send message"]');
      if (send) { onUserSent(); return; }
    },true);
    document.addEventListener('keydown', e => {
      if (!active||e.key!=='Enter'||e.shiftKey) return;
      const ta=e.target;
      if (ta&&ta.tagName==='TEXTAREA'&&ta.placeholder==='Send your message...') if((ta.value||'').trim()) onUserSent();
    },true);
  }

  // ---- REGEN PANEL -------------------------------------------
  function refreshRegenPanel() {
    const wrap=document.getElementById('djt-regen'); if(!wrap) return;
    const h=store.regenHistory;
    if (!settings.saveRegens||!h||!Array.isArray(h.versions)||h.versions.length<2){wrap.style.display='none';return;}
    wrap.style.display='block';
    if(previewIndex===null) previewIndex=h.current;
    previewIndex=Math.max(0,Math.min(h.versions.length-1,previewIndex));
    const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
    set('djt-regen-pos',(previewIndex+1)+' / '+h.versions.length);
    const prev=document.getElementById('djt-regen-prev');const next=document.getElementById('djt-regen-next');
    if(prev) prev.disabled=previewIndex===0; if(next) next.disabled=previewIndex===h.versions.length-1;
    const body=document.getElementById('djt-regen-preview'); if(body) body.textContent=h.versions[previewIndex];
    const useBtn=document.getElementById('djt-regen-use');
    if(useBtn){useBtn.textContent=previewIndex===h.current?'Currently shown':'Use this reply';useBtn.disabled=previewIndex===h.current;}
  }

  async function applyVersion(text) {
    const lb=lastBot(); if(!lb){toast('No bot message found.');return;}
    const useBtn=document.getElementById('djt-regen-use'); if(useBtn){useBtn.disabled=true;useBtn.textContent='Applying...';}
    fireHover(lb);
    const editBtn=await waitFor(()=>lb.querySelector('[aria-label="Edit assistant message"]'),4000); if(!editBtn){toast('Could not open edit.');refreshRegenPanel();return;}
    editBtn.click();
    const ta=await waitFor(()=>[...document.querySelectorAll('textarea')].find(t=>t.placeholder==='Edit your message...'),4000); if(!ta){toast('Edit box did not appear.');refreshRegenPanel();return;}
    setReactValue(ta,text);
    let scope=ta.parentElement; for(let i=0;i<6&&scope;i++){if(scope.querySelectorAll('button').length>=2)break;scope=scope.parentElement;}
    const saveBtn=await waitFor(()=>[...(scope||document).querySelectorAll('button')].find(b=>(b.textContent||'').trim()==='Save'),3000); if(!saveBtn){toast('Save button not found.');refreshRegenPanel();return;}
    saveBtn.click(); store.regenHistory.current=previewIndex; saveStore(); toast('Reply applied!'); setTimeout(refreshRegenPanel,600);
  }

  // ---- DELETE THINKING ----------------------------------------
  function hasThinkingBlock(botEl) {
    const mk=botEl.querySelector('.markdown'); if(!mk) return false;
    if(mk.querySelector('details')) return true;
    return [...mk.querySelectorAll('button')].some(b=>{ const t=(b.textContent||'').toLowerCase(); const a=(b.getAttribute('aria-label')||'').toLowerCase(); return /thinking|show thinking|hide thinking/.test(t)||/thinking/.test(a); });
  }
  function refreshThinkingButtons() {
    if (!active) return;
    if (!settings.deleteThinking) {
      const ex=[...document.querySelectorAll('.djt-del-thinking')];
      if(ex.length){djtMutating=true;ex.forEach(b=>b.remove());djtMutating=false;}
      return;
    }
    // Pass 1: remove buttons whose message no longer has a thinking block
    djtMutating=true;
    [...document.querySelectorAll('.djt-del-thinking')].forEach(btn=>{
      const mk=btn.closest('.markdown');
      if(!mk){btn.remove();return;}
      // find the botEl that owns this .markdown
      const botEl=getMessages().find(m=>m.querySelector('.markdown')===mk);
      if(!botEl||!hasThinkingBlock(botEl)) btn.remove();
    });
    djtMutating=false;
    // Pass 2: add buttons to messages that have a thinking block but no button yet
    getMessages().forEach(botEl=>{
      if(!isBot(botEl)) return;
      if(!hasThinkingBlock(botEl)) return;
      const mk=botEl.querySelector('.markdown'); if(!mk) return;
      if(mk.querySelector('.djt-del-thinking')) return; // already present
      const btn=document.createElement('button');
      btn.className='djt-del-thinking';
      btn.title='Remove the thinking block from this reply (permanently edits the message)';
      btn.innerHTML='<span class="djt-del-icon">✕</span> Remove thinking';
      btn.addEventListener('click',e=>{e.stopPropagation();deleteThinking(botEl);});
      const details=mk.querySelector('details');
      const thinkBtn=[...mk.querySelectorAll('button')].find(b=>/thinking|show|hide/i.test(b.textContent||''));
      const refEl=details||(thinkBtn&&thinkBtn.closest('div'))||null;
      djtMutating=true;
      if(refEl&&refEl.parentElement===mk) mk.insertBefore(btn,refEl);
      else mk.insertAdjacentElement('afterbegin',btn);
      djtMutating=false;
    });
  }
  async function deleteThinking(botEl) {
    // Hide the button immediately for snappy feedback
    const mk=botEl.querySelector('.markdown');
    const existingBtn=mk&&mk.querySelector('.djt-del-thinking');
    if(existingBtn){djtMutating=true;existingBtn.style.display='none';djtMutating=false;}
    const restore=()=>{if(existingBtn){djtMutating=true;existingBtn.style.display='';djtMutating=false;}};
    fireHover(botEl);
    const editBtn=await waitFor(()=>botEl.querySelector('[aria-label="Edit assistant message"]'),4000);
    if(!editBtn){toast('Could not open edit.');restore();return;}
    editBtn.click();
    const ta=await waitFor(()=>[...document.querySelectorAll('textarea')].find(t=>t.placeholder==='Edit your message...'),4000);
    if(!ta){toast('Edit box did not appear.');restore();return;}
    const original=ta.value; const stripped=original.replace(/```\s*<thinking>[\s\S]*?<\/thinking>\s*```\s*/g,'').trim();
    if(stripped===original.trim()){
      let sc=ta.parentElement;for(let i=0;i<6&&sc;i++){if(sc.querySelectorAll('button').length>=2)break;sc=sc.parentElement;}
      const cb=[...(sc||document).querySelectorAll('button')].find(b=>(b.textContent||'').trim()==='Cancel');
      if(cb)cb.click();toast('No thinking block found.');restore();return;
    }
    setReactValue(ta,stripped);
    let scope=ta.parentElement; for(let j=0;j<6&&scope;j++){if(scope.querySelectorAll('button').length>=2)break;scope=scope.parentElement;}
    const saveBtn=await waitFor(()=>[...(scope||document).querySelectorAll('button')].find(b=>(b.textContent||'').trim()==='Save'),3000);
    if(!saveBtn){toast('Save button not found.');restore();return;}
    // Remove button entirely (it'll reappear if thinking is detected again)
    if(existingBtn){djtMutating=true;existingBtn.remove();djtMutating=false;}
    saveBtn.click(); toast('Thinking block removed.'); setTimeout(refreshThinkingButtons,800);
  }

  // ---- BEE MOVIE easter egg ----------------------------------
  function triggerBeeMovie() {
    const popup = document.createElement('div'); popup.id = 'djt-bee-popup';
    popup.innerHTML =
      '<div class="djt-bee-title">\uD83D\uDC1D Replacing chat history with the entire script of the Bee Movie, please wait!</div>' +
      '<div class="djt-bee-bar-wrap"><div id="djt-bee-bar"></div></div>';
    document.body.appendChild(popup);
    setTimeout(() => { const b = document.getElementById('djt-bee-bar'); if (b) b.style.width = '100%'; }, 60);
    const beeEls = [];
    for (let i = 0; i < 22; i++) {
      setTimeout(() => {
        const b = document.createElement('div'); b.className = 'djt-bee-fly'; b.textContent = '\uD83D\uDC1D';
        b.style.cssText = `position:fixed;font-size:${18+Math.random()*18}px;z-index:999998;pointer-events:none;` +
          `left:${Math.random()*100}vw;top:${Math.random()*100}vh;` +
          `animation:djt-bee-buzz ${1.2+Math.random()*1.2}s ease-in-out infinite alternate;` +
          `--bx:${(Math.random()-.5)*220}px;--by:${(Math.random()-.5)*180}px;`;
        document.body.appendChild(b); beeEls.push(b);
      }, i * 70);
    }
    setTimeout(() => {
      popup.classList.add('djt-bee-shaking');
      setTimeout(() => {
        const t = popup.querySelector('.djt-bee-title'); if (t) t.innerHTML = 'Just kidding! \uD83D\uDE04';
        const bw = popup.querySelector('.djt-bee-bar-wrap'); if (bw) bw.style.display = 'none';
        popup.classList.remove('djt-bee-shaking');
      }, 450);
    }, 2000);
    setTimeout(() => { popup.remove(); beeEls.forEach(b => b.remove()); }, 4200);
  }

  // ---- BLOSSOMS -----------------------------------------------
  function bloomBlossoms() {
    if (Math.random() < 0.01) { triggerBeeMovie(); return; } // 1 in 100
    const useSuns = Math.random() < 0.15;
    const petals = useSuns
      ? ['\u2600\uFE0F','\uD83C\uDF1F','\u2728','\uD83D\uDCAB','\u2B50','\uD83C\uDF1E']
      : ['\uD83C\uDF38','\uD83C\uDF3A','\uD83C\uDF37','\u273F','\u2740','\uD83C\uDF3C'];
    let i = 0;
    function spawnBatch() {
      for (let b = 0; b < 5 && i < 25; b++, i++) {
        const el = document.createElement('div');
        el.className = 'djt-blossom';
        el.textContent = petals[Math.floor(Math.random() * petals.length)];
        const size = useSuns ? (18 + Math.random() * 16) : (14 + Math.random() * 18);
        const dur  = 3 + Math.random() * 3;
        const left = Math.random() * 100;
        const sway = (Math.random() - 0.5) * 140;
        const rot  = useSuns ? (Math.random() * 360) : (Math.random() * 600 - 300);
        el.style.cssText =
          `position:fixed;top:-50px;left:${left}vw;font-size:${size}px;` +
          `z-index:999999;pointer-events:none;user-select:none;` +
          `animation:djt-fall ${dur}s ease-in forwards;` +
          `--djt-sway:${sway}px;--djt-rot:${rot}deg;`;
        document.body.appendChild(el);
        el.addEventListener('animationend', () => el.remove(), { once: true });
      }
      if (i < 25) setTimeout(() => requestAnimationFrame(spawnBatch), 200);
    }
    requestAnimationFrame(spawnBatch);
  }

  // ---- SCRATCHPAD --------------------------------------------
  let scratchTimer=null, scratchHistIdx=0;
  function hookScratchpad() {
    if(!active) return;
    const ta=document.querySelector('textarea[placeholder="Send your message..."]'); if(!ta||ta.dataset.djtScratch) return;
    ta.dataset.djtScratch='1';
    ta.addEventListener('input',()=>{ if(!settings.scratchpad) return; clearTimeout(scratchTimer); scratchTimer=setTimeout(()=>{store.scratch=ta.value||'';saveStore();refreshScratchUI();},400); });
  }
  function refreshScratchUI() {
    const card=document.getElementById('djt-scratch-card'); if(!card) return;
    card.style.display=settings.scratchpad?'':'none';
    const txt=document.getElementById('djt-scratch-txt'); const clearBtn=document.getElementById('djt-scratch-clear'); if(!txt) return;
    if(store.scratch&&store.scratch.trim()){txt.textContent=store.scratch.length>65?store.scratch.slice(0,62)+'...':store.scratch;txt.className='djt-scratch-preview';if(clearBtn)clearBtn.style.display='';}
    else{txt.textContent='Nothing saved yet';txt.className='djt-scratch-preview djt-muted-text';if(clearBtn)clearBtn.style.display='none';}
    refreshScratchHistUI();
  }
  function refreshScratchHistUI() {
    const histSec=document.getElementById('djt-hist-section'); if(!histSec) return;
    const hist=store.scratchHistory||[];
    histSec.style.display=hist.length?'':'none';
    if(!hist.length) return;
    scratchHistIdx=Math.max(0,Math.min(hist.length-1,scratchHistIdx));
    const pos=document.getElementById('djt-hist-pos'); if(pos) pos.textContent=(scratchHistIdx+1)+'/'+hist.length+' Saved';
    const prev=document.getElementById('djt-hist-prev'); const next=document.getElementById('djt-hist-next');
    if(prev) prev.disabled=scratchHistIdx===0; if(next) next.disabled=scratchHistIdx===hist.length-1;
    const pv=document.getElementById('djt-hist-preview'); if(pv) pv.textContent=hist[scratchHistIdx]||'';
  }
  function maybeOfferRestore() {
    if(!settings.scratchpad) return;
    const ta=document.querySelector('textarea[placeholder="Send your message..."]'); if(!ta||(ta.value||'').trim()) return;
    if(!store.scratch||!store.scratch.trim()) return;
    showRestoreBar(store.scratch);
  }
  function showRestoreBar(text) {
    if(document.getElementById('djt-restore')) return;
    const bar=document.createElement('div'); bar.id='djt-restore';
    bar.innerHTML=`<span class="djt-restore-txt">Unsent draft recovered (${text.length} chars)</span><button id="djt-restore-yes" class="djt-mini-btn">Restore</button><button id="djt-restore-no" class="djt-mini-btn ghost">Dismiss</button>`;
    document.body.appendChild(bar);
    document.getElementById('djt-restore-yes').addEventListener('click',()=>{ const ta=document.querySelector('textarea[placeholder="Send your message..."]'); if(ta){setReactValue(ta,text);ta.focus();} hideRestoreBar(); });
    document.getElementById('djt-restore-no').addEventListener('click',hideRestoreBar);
  }
  const hideRestoreBar=()=>{ const b=document.getElementById('djt-restore'); if(b)b.remove(); };

  // ---- AUTO-REFRESH ------------------------------------------
  function showRefreshToast() {
    if(document.getElementById('djt-refresh-toast')) return;
    let left=3,cancelled=false;
    const t=document.createElement('div'); t.id='djt-refresh-toast';
    t.innerHTML=`<div class="djt-rt-row"><span>Refresh in</span><span class="djt-rt-count">${left}</span><button class="djt-rt-cancel">Cancel</button></div><div class="djt-rt-note">Refreshing after stopping a generation reduces the chance of double or vanishing messages.</div>`;
    document.body.appendChild(t); t.querySelector('.djt-rt-cancel').addEventListener('click',()=>{cancelled=true;t.remove();});
    const iv=setInterval(()=>{ if(cancelled){clearInterval(iv);return;} left--; const c=t.querySelector('.djt-rt-count');if(c)c.textContent=left; if(left<=0){clearInterval(iv);t.remove();saveStore();location.reload();} },1000);
  }

  // ---- DOWNLOAD ----------------------------------------------
  async function scrollToTop(scrollEl) {
    // Pulse approach: set scrollTop=0 every 900ms and let DJ scroll back naturally.
    // DJ uses an IntersectionObserver on a sentinel at the top of the chat to trigger
    // batch loads. Each pulse brings the sentinel into view, fires a load, then DJ
    // snaps back down. The next pulse repeats this.
    scrollEl.style.overflowAnchor = 'none';
    let lastH = -1, stable = 0;
    for (let g = 0; g < 120; g++) {
      scrollEl.scrollTop = 0;
      await new Promise(r => setTimeout(r, 900));
      const h = scrollEl.scrollHeight;
      if (h === lastH) {
        stable++;
        // Don't stop if the first visible message is a user message —
        // that means we haven't reached the actual top yet. Keep going.
        const firstMsg = getMessages()[0];
        const firstIsBot = firstMsg && isBot(firstMsg);
        if (stable >= 6 && firstIsBot) break;    // 5.4s stable + bot opener = done
        if (stable >= 12) break;                  // 10.8s absolute ceiling
      } else {
        stable = 0;
      }
      lastH = h;
    }
    scrollEl.style.overflowAnchor = '';
    scrollEl.scrollTop = 0;
  }

  async function downloadChat() {
    const scrollEl = getContainer(); if (!scrollEl) { toast('Chat not found.'); return; }
    const btn = document.getElementById('djt-download');
    if (btn) { btn.disabled = true; btn.textContent = 'Scrolling to top...'; }

    // Show friendly waiting popup while scrolling
    const scrollPopup = document.createElement('div');
    scrollPopup.id = 'djt-scroll-popup';
    scrollPopup.innerHTML = '\uD83C\uDF1E Scrolling, please wait a moment! \uD83C\uDF1E';
    document.body.appendChild(scrollPopup);

    await scrollToTop(scrollEl);

    scrollPopup.remove();
    if (btn) { btn.disabled = false; btn.textContent = 'Download chat (.txt)'; }

    const msgs = getMessages();
    const firstText = msgs.length ? msgText(msgs[0]).slice(0, 180) : '(no messages)';
    const choice = await confirmDownloadModal(firstText);
    if (choice !== 'yes') return;

    const charName = (() => {
      const backBtn = document.querySelector('[aria-label="Go back to main app"]');
      const name = backBtn?.parentElement?.querySelector('p[class*="font-bold"]')?.innerText?.trim();
      return (name || '').slice(0, 50) || 'Bot';
    })();
    const lines = ["Sunny's Dreamjourney Toolkit V1 — Chat Export",
      'Made by SunflowerS at Dreamjourney AI', 'Character: ' + charName,
      'Session: ' + currentSessionId, 'Exported: ' + new Date().toLocaleString(),
      ''.padEnd(60, '-'), ''];
    msgs.forEach(m => { lines.push(isBot(m) ? '[' + charName + ']' : '[YOU]'); lines.push(msgText(m)); lines.push(''); });
    const c = liveCounts();
    lines.push(''.padEnd(60, '-'));
    lines.push(`Counts: ${c.user} you / ${c.bot} bot / ${c.total} total / ${store.rerolls} rerolls`);
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'dreamjourney-' + String(currentSessionId).slice(0, 8) + '.txt';
    a.click(); URL.revokeObjectURL(url);
  }

  // ---- UI PRIMITIVES -----------------------------------------
  function toast(msg) { const el=document.createElement('div');el.className='djt-toast';el.textContent=msg;document.body.appendChild(el);setTimeout(()=>el.classList.add('show'),10);setTimeout(()=>el.remove(),2800); }
  function confirmDownloadModal(firstText) {
    return new Promise(resolve => {
      const ov = document.createElement('div'); ov.className = 'djt-modal-overlay';
      const safe = firstText.replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
      ov.innerHTML =
        `<div class="djt-modal">` +
        `<h2>Is this the first message?</h2>` +
        `<p>First message loaded:<br><em>&ldquo;${safe}&rdquo;</em></p>` +
        `<p class="djt-modal-hint">If not, please check the help section.</p>` +
        `<div class="djt-modal-btns">` +
        `<button class="djt-btn ghost" data-v="cancel">Cancel</button>` +
        `<button class="djt-btn primary" data-v="yes">Yes — Download chat</button>` +
        `</div></div>`;
      document.body.appendChild(ov);
      ov.addEventListener('click', e => {
        const b = e.target.closest('[data-v]'); if (!b) return;
        ov.remove(); resolve(b.dataset.v);
      });
    });
  }

  // ---- DRAGGABLE PANEL ---------------------------------------
  function initDrag(panel) {
    const head = document.getElementById('djt-head');
    let dragging = false, dragMoved = false, ox = 0, oy = 0;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    const toAbsolute = () => {
      if (panel.style.left && panel.style.left !== 'auto') return;
      const r = panel.getBoundingClientRect();
      panel.style.right = 'auto';
      panel.style.left = r.left + 'px';
      panel.style.top  = r.top  + 'px';
    };
    const getClient = e => e.touches ? [e.touches[0].clientX, e.touches[0].clientY] : [e.clientX, e.clientY];

    const onDown = e => {
      const collapsed = panel.classList.contains('djt-collapsed');
      if (!collapsed && e.target.closest('button')) return;
      toAbsolute();
      dragging = true; dragMoved = false;
      const [cx, cy] = getClient(e);
      ox = cx - parseInt(panel.style.left);
      oy = cy - parseInt(panel.style.top);
      if (!collapsed) head.style.cursor = 'grabbing';
      // Only preventDefault when expanded — in collapsed state this suppresses
      // the synthetic click event on mobile which breaks tap-to-expand
      if (!collapsed) e.preventDefault();
    };
    const onMove = e => {
      if (!dragging) return;
      dragMoved = true;
      const [cx, cy] = getClient(e);
      panel.style.left = clamp(cx - ox, 0, window.innerWidth  - panel.offsetWidth)  + 'px';
      panel.style.top  = clamp(cy - oy, 0, window.innerHeight - 44) + 'px';
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      const collapsed = panel.classList.contains('djt-collapsed');
      if (!dragMoved && collapsed) {
        // Tap on the sun icon — expand the panel
        panel.classList.remove('djt-collapsed');
        head.style.cursor = 'grab';
        return;
      }
      if (!collapsed) head.style.cursor = 'grab';
      settings.panelPos = { left: panel.style.left, top: panel.style.top };
      saveSettings();
    };

    head.style.cursor = 'grab';
    head.addEventListener('mousedown', onDown);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    head.addEventListener('touchstart', onDown, { passive: false });
    document.addEventListener('touchmove', e => { if (dragging) { e.preventDefault(); onMove(e); } }, { passive: false });
    document.addEventListener('touchend', onUp);
  }

  // ---- PANEL -------------------------------------------------
  const setTheme = theme => { const p=document.getElementById('djt-panel');if(!p)return;p.setAttribute('data-djt-theme',theme||'dark');const tb=document.getElementById('djt-theme-btn');if(tb)tb.textContent=theme==='light'?'\u{1F319}':'\u2600\uFE0F'; };

  function buildPanel() {
    if(document.getElementById('djt-panel')) return;
    const p=document.createElement('div'); p.id='djt-panel';
    const sunIconUrl = (() => { try { return chrome.runtime.getURL('icons/icon48.png'); } catch(e) { return ''; } })();
    p.innerHTML=
      `<div id="djt-head"><img id="djt-sun-icon" src="${sunIconUrl}" alt="\u2600\uFE0F" onerror="this.outerHTML='<span id=\\'djt-sun-icon\\' style=\\'font-size:20px;flex-shrink:0\\'>\u2600\uFE0F</span>'"><span class="djt-title">Sunny\u2019s Toolkit</span><div class="djt-head-btns"><button id="djt-theme-btn" class="djt-icon-btn" title="Toggle light/dark">\u2600\uFE0F</button><button id="djt-collapse" title="Collapse">\u2013</button></div></div>
      <div id="djt-body">
        <div class="djt-card" id="djt-stats-card">
          <div class="djt-card-h">Session stats</div>
          <div class="djt-row"><span>Your messages</span><b id="djt-s-user">0</b></div>
          <div class="djt-row"><span>Bot messages</span><b id="djt-s-bot">0</b></div>
          <div class="djt-row"><span>Total</span><b id="djt-s-total">0</b></div>
          <div class="djt-row"><span>Rerolls</span><b id="djt-s-rerolls">0</b></div>
          <div class="djt-nexus-row" id="djt-nexus-section">
            <div class="djt-nexus-inner"><span title="Messages sent since you last opened the Nexus memory panel">Since last Nexus</span><b id="djt-nexus-val" class="djt-nexus-num green">0</b></div>
            <div id="djt-nexus-warn" class="djt-nexus-warn">Recommended to check Nexus for accuracy!</div>
          </div>
        </div>
        <div class="djt-card" id="djt-regen" style="display:none">
          <div class="djt-card-h">Saved replies</div>
          <div class="djt-regen-ctrl"><button id="djt-regen-prev" class="djt-mini-btn">\u2039</button><span id="djt-regen-pos">1 / 1</span><button id="djt-regen-next" class="djt-mini-btn">\u203a</button></div>
          <div id="djt-regen-preview" class="djt-regen-preview"></div>
          <div style="display:flex;gap:6px"><button id="djt-regen-use" class="djt-mini-btn full">Use this reply</button><button id="djt-regen-discard" class="djt-mini-btn ghost" title="Discard all saved replies">&#10005;</button></div>
        </div>
        <div class="djt-card" id="djt-scratch-card">
          <div class="djt-card-h">User Input Recovery</div>
          <div class="djt-scratch-sub">Unsent draft</div>
          <div id="djt-scratch-txt" class="djt-scratch-preview djt-muted-text">Nothing saved yet</div>
          <div class="djt-scratch-btns"><button id="djt-scratch-restore" class="djt-mini-btn">Restore</button><button id="djt-scratch-clear" class="djt-mini-btn ghost" style="display:none">Clear</button></div>
          <div id="djt-hist-section" style="display:none">
            <div class="djt-hist-divider"></div>
            <div class="djt-hist-header">
              <span class="djt-scratch-sub">Sent history</span>
              <div class="djt-hist-ctrl"><button id="djt-hist-prev" class="djt-mini-btn">\u2039</button><span id="djt-hist-pos" class="djt-hist-pos">1/1 Saved</span><button id="djt-hist-next" class="djt-mini-btn">\u203a</button></div>
            </div>
            <div id="djt-hist-preview" class="djt-scratch-preview djt-muted-text"></div>
            <div class="djt-scratch-btns"><button id="djt-hist-restore" class="djt-mini-btn">Restore</button><button id="djt-hist-clear" class="djt-mini-btn ghost">Clear all</button></div>
          </div>
        </div>
        <div class="djt-card"><div class="djt-card-h">Features</div>
          ${toggleRow('saveRegens','Save regenerations')}${toggleRow('stats','Session stats')}${toggleRow('nexus','Nexus reminder')}${toggleRow('scratchpad','User Input Recovery')}${toggleRow('autoRefresh','Auto-refresh on Stop')}${toggleRow('deleteThinking','Delete thinking <span class="djt-toggle-note">Nyx / Athena only</span>')}
        </div>
        <button id="djt-download" class="djt-mini-btn full primary">Download chat (.txt)</button>
        <button id="djt-help-btn" class="djt-help-tab">? How to use this toolkit</button>
        <div id="djt-advanced-wrap">
          <button id="djt-advanced-toggle" class="djt-advanced-toggle">\u25b8 Advanced</button>
          <div id="djt-advanced-body" style="display:none">
            <div class="djt-adv-note"><span class="djt-adv-icon">&#128296;</span><span>Under development</span></div>
            <button id="djt-surprise-btn" class="djt-mini-btn full djt-surprise">&#127800; Surprise me!</button>
          </div>
        </div>
        <div class="djt-credit">Made by SunflowerS at Dreamjourney AI</div>
      </div>`;
    document.body.appendChild(p);

    document.getElementById('djt-collapse').addEventListener('click', (e) => {
      e.stopPropagation();
      const panel = document.getElementById('djt-panel');
      panel.classList.add('djt-collapsed');
      settings.panelPos = { left: panel.style.left || '', top: panel.style.top || '' };
      saveSettings();
    });
    // Belt-and-suspenders expand for mobile: click always works even if drag tap detection misses
    p.addEventListener('click', () => {
      if (p.classList.contains('djt-collapsed')) {
        p.classList.remove('djt-collapsed');
        const h = document.getElementById('djt-head'); if (h) h.style.cursor = 'grab';
      }
    });
    document.getElementById('djt-theme-btn').addEventListener('click',()=>{settings.theme=settings.theme==='light'?'dark':'light';saveSettings();setTheme(settings.theme);});
    document.getElementById('djt-download').addEventListener('click',downloadChat);
    document.getElementById('djt-help-btn').addEventListener('click',()=>{try{window.open(chrome.runtime.getURL('help.html'),'_blank');}catch(e){toast('Could not open help page.');}});
    document.getElementById('djt-regen-prev').addEventListener('click',()=>{previewIndex--;refreshRegenPanel();});
    document.getElementById('djt-regen-next').addEventListener('click',()=>{previewIndex++;refreshRegenPanel();});
    document.getElementById('djt-regen-use').addEventListener('click',()=>{const h=store.regenHistory;if(h&&h.versions&&previewIndex!==null)applyVersion(h.versions[previewIndex]);});
    document.getElementById('djt-regen-discard').addEventListener('click',()=>{store.regenHistory={versions:[],current:0};previewIndex=null;saveStore();refreshRegenPanel();});
    document.getElementById('djt-scratch-restore').addEventListener('click',()=>{const ta=document.querySelector('textarea[placeholder="Send your message..."]');if(ta&&store.scratch){setReactValue(ta,store.scratch);ta.focus();}});
    document.getElementById('djt-scratch-clear').addEventListener('click',()=>{store.scratch='';saveStore();refreshScratchUI();});
    document.getElementById('djt-hist-prev').addEventListener('click',()=>{scratchHistIdx=Math.max(0,scratchHistIdx-1);refreshScratchHistUI();});
    document.getElementById('djt-hist-next').addEventListener('click',()=>{scratchHistIdx=Math.min((store.scratchHistory||[]).length-1,scratchHistIdx+1);refreshScratchHistUI();});
    document.getElementById('djt-hist-restore').addEventListener('click',()=>{const ta=document.querySelector('textarea[placeholder="Send your message..."]');const h=store.scratchHistory||[];if(ta&&h[scratchHistIdx]){setReactValue(ta,h[scratchHistIdx]);ta.focus();}});
    document.getElementById('djt-hist-clear').addEventListener('click',()=>{store.scratchHistory=[];scratchHistIdx=0;saveStore();refreshScratchHistUI();});
    ['saveRegens','stats','nexus','scratchpad','autoRefresh','deleteThinking'].forEach(key=>{
      const cb=document.getElementById('djt-t-'+key); if(!cb) return;
      cb.addEventListener('change',()=>{settings[key]=cb.checked;saveSettings();applyVisibility();refreshStatsUI();refreshRegenPanel();refreshThinkingButtons();});
    });
    document.getElementById('djt-advanced-toggle').addEventListener('click',function(){const b=document.getElementById('djt-advanced-body');const o=b.style.display==='none';b.style.display=o?'':'none';this.textContent=(o?'\u25be':'\u25b8')+' Advanced';});
    document.getElementById('djt-surprise-btn').addEventListener('click',bloomBlossoms);
    // Draggable + restore saved position
    initDrag(p);
    if (settings.panelPos && settings.panelPos.left) {
      p.style.right = 'auto';
      p.style.left = settings.panelPos.left;
      p.style.top  = settings.panelPos.top;
    }
  }

  const toggleRow=(key,label)=>`<div class="djt-toggle-row"><span>${label}</span><label class="djt-switch"><input type="checkbox" id="djt-t-${key}" checked><span class="djt-slider"></span></label></div>`;
  function syncToggleStates(){['saveRegens','stats','nexus','scratchpad','autoRefresh','deleteThinking'].forEach(key=>{const cb=document.getElementById('djt-t-'+key);if(cb)cb.checked=settings[key]!==false;});}
  function applyVisibility(){
    const statsCard=document.getElementById('djt-stats-card'); if(statsCard)statsCard.style.display=settings.stats?'':'none';
    const nexusSec=document.getElementById('djt-nexus-section'); if(nexusSec)nexusSec.style.display=(settings.stats&&settings.nexus)?'':'none';
    const scratchCard=document.getElementById('djt-scratch-card'); if(scratchCard)scratchCard.style.display=settings.scratchpad?'':'none';
    if(!settings.saveRegens){const regen=document.getElementById('djt-regen');if(regen)regen.style.display='none';}
  }

  // ---- LIFECYCLE --------------------------------------------
  async function activate(sid) {
    currentSessionId=sid; active=true;
    await loadAll();
    const c=await waitFor(()=>document.querySelector('.scrollchatmessages'),20000,250);
    if(!active||currentSessionId!==sid) return; if(!c) return;
    buildPanel(); setTheme(settings.theme); syncToggleStates(); applyVisibility();
    startContainerObserver(); hookScratchpad();
    refreshStatsUI(); refreshRegenPanel(); refreshThinkingButtons(); maybeOfferRestore();
    // Lightweight periodic check: hooks scratchpad if textarea swapped, also rescans for thinking blocks
    if(!scratchpadInterval) scratchpadInterval=setInterval(()=>{ if(active){hookScratchpad();refreshThinkingButtons();} },3000);
  }
  function deactivate() {
    active=false;
    if(containerObserver){containerObserver.disconnect();containerObserver=null;}
    if(scratchpadInterval){clearInterval(scratchpadInterval);scratchpadInterval=null;}
    clearTimeout(statsDebounce); clearTimeout(thinkingDebounce);
    const p=document.getElementById('djt-panel');if(p)p.remove(); hideRestoreBar();
    const rt=document.getElementById('djt-refresh-toast');if(rt)rt.remove();
    const ex=[...document.querySelectorAll('.djt-del-thinking')];if(ex.length){djtMutating=true;ex.forEach(b=>b.remove());djtMutating=false;}
    expectingReply=false;regenPending=false;regenTargetIdx=-1;regenAnchorUserId=null;previewIndex=null;currentSessionId=null;
  }
  function onRouteChange(){const sid=isSessionUrl()?sessionIdFromUrl():null;if(sid&&sid===currentSessionId&&active)return;if(!sid){if(active)deactivate();return;}if(active)deactivate();activate(sid);}
  function setupRouteWatcher(){
    const fire=()=>{try{onRouteChange();}catch(e){}};
    const wrap=orig=>function(){const r=orig.apply(this,arguments);fire();return r;};
    try{history.pushState=wrap(history.pushState);}catch(e){}
    try{history.replaceState=wrap(history.replaceState);}catch(e){}
    window.addEventListener('popstate',fire);
    let last=location.href; setInterval(()=>{if(location.href!==last){last=location.href;fire();}},500);
  }

  setupDelegation(); setupRouteWatcher(); onRouteChange();
})();
