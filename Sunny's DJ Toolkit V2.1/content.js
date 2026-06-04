// ============================================================
//  Sunny's Dreamjourney Toolkit V2 - content script v3.0
//  Made by SunflowerS at Dreamjourney AI
// ============================================================
(function () {
  'use strict';
  if (window.__djtLoaded) return;
  window.__djtLoaded = true;

  const SETTINGS_KEY = 'djt:settings';
  let currentSessionId = null, active = false;
  let containerObserver = null, scratchpadInterval = null, observedContainer = null;
  const storeKey = () => 'djt:' + currentSessionId;

  const DEFAULT_SETTINGS = {
    theme: 'dark', saveRegens: true, stats: true, nexus: true,
    scratchpad: true, autoRefresh: true, deleteThinking: false,
    panelPos: null, panelSize: null, activeTab: 'chat', cardCollapsed: {}, scanActive: false, lorebookLibrary: [], skin: 'dreamjourney',
    // Visibility: map of section-id -> true when the user has hidden it from the
    // pop-out panel via the Settings Window. Absent/false = visible. Honored in Stage 2.
    hidden: {},
    // Quill (local-LLM / optional API helper). Connection is configured in the
    // Settings Window; the tool UI lives in the pop-out under Advanced.
    // backend: 'ollama' | 'openai' | 'lmstudio' | 'kobold' | 'api'
    quill: {
      enabled: false,
      backend: 'ollama',
      ollamaUrl: 'http://localhost:11434',
      ollamaModel: '',
      lmstudioUrl: 'http://localhost:1234',
      lmstudioModel: '',
      koboldUrl: 'http://localhost:5001',
      openaiBaseUrl: 'https://api.openai.com/v1',
      openaiModel: 'gpt-4o-mini',
      apiKey: ''            // user-entered, stored locally only
    }
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
  let hasScrolledToTop = false;

  // ---- storage ------------------------------------------------
  function loadAll() {
    return new Promise(res => {
      try {
        chrome.storage.local.get([storeKey(), SETTINGS_KEY], data => {
          store    = Object.assign({}, DEFAULT_STORE, (data && data[storeKey()]) || {});
          settings = Object.assign({}, DEFAULT_SETTINGS, (data && data[SETTINGS_KEY]) || {});
          if (!settings.cardCollapsed || typeof settings.cardCollapsed !== 'object') settings.cardCollapsed = {};
          if (!settings.hidden || typeof settings.hidden !== 'object') settings.hidden = {};
          // Deep-merge quill so new default keys survive an older stored partial.
          settings.quill = Object.assign({}, DEFAULT_SETTINGS.quill, (settings.quill && typeof settings.quill === 'object') ? settings.quill : {});
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
  const isBotPage = () => /\/app\/create\/bot\//.test(location.pathname);
  const botIdFromUrl = () => { const m = location.pathname.match(/\/app\/create\/bot\/([^/?#]+)/); return m ? m[1] : 'new'; };

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
      if (added||removed) { clearTimeout(statsDebounce); statsDebounce=setTimeout(refreshStatsUI,250); clearTimeout(thinkingDebounce); thinkingDebounce=setTimeout(refreshThinkingButtons,600); if(scanActive){clearTimeout(scanDebounce);scanDebounce=setTimeout(runChatScan,400);} if(panelActive){clearTimeout(panelDebounce);panelDebounce=setTimeout(updateActiveChatPanel,500);} }
    });
    containerObserver.observe(c,{childList:true,subtree:true});
    observedContainer = c;
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
      const botEl=getMessages().find(m=>m.querySelector('.markdown')===mk);
      if(!botEl||!hasThinkingBlock(botEl)) btn.remove();
    });
    djtMutating=false;
    // Pass 2: add buttons to messages that have a thinking block but no button yet
    getMessages().forEach(botEl=>{
      if(!isBot(botEl)) return;
      if(!hasThinkingBlock(botEl)) return;
      const mk=botEl.querySelector('.markdown'); if(!mk) return;
      if(mk.querySelector('.djt-del-thinking')) return;
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
    if(existingBtn){djtMutating=true;existingBtn.remove();djtMutating=false;}
    saveBtn.click(); toast('Thinking block removed.'); setTimeout(refreshThinkingButtons,800);
  }

  // ---- BEE MOVIE easter egg ----------------------------------
  function triggerBeeMovie() {
    const popup = document.createElement('div'); popup.id = 'djt-bee-popup';
    popup.innerHTML =
      '<div class="djt-bee-title">🐝 Replacing chat history with the entire script of the Bee Movie, please wait!</div>' +
      '<div class="djt-bee-bar-wrap"><div id="djt-bee-bar"></div></div>';
    document.body.appendChild(popup);
    setTimeout(() => { const b = document.getElementById('djt-bee-bar'); if (b) b.style.width = '100%'; }, 60);
    const beeEls = [];
    for (let i = 0; i < 22; i++) {
      setTimeout(() => {
        const b = document.createElement('div'); b.className = 'djt-bee-fly'; b.textContent = '🐝';
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
        const t = popup.querySelector('.djt-bee-title'); if (t) t.innerHTML = 'Just kidding! 😄';
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
      ? ['☀️','🌟','✨','💫','⭐','🌞']
      : ['🌸','🌺','🌷','✿','❀','🌼'];
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
        // Don't stop if the first visible message is a user message -
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

  async function doScrollToTop() {
    const scrollEl = getContainer();
    if (!scrollEl) { toast('Chat not found.'); return false; }
    const btn = document.getElementById('djt-scroll-top-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Scrolling...'; }
    const scrollPopup = document.createElement('div');
    scrollPopup.id = 'djt-scroll-popup';
    scrollPopup.innerHTML = '🌞 Scrolling to first message, please wait! 🌞';
    document.body.appendChild(scrollPopup);
    await scrollToTop(scrollEl);
    scrollPopup.remove();
    if (btn) { btn.disabled = false; btn.textContent = '↑ Scroll to first message'; }

    // Show verification modal so user can confirm they're at the actual first message
    const msgs = getMessages();
    const firstText = msgs.length ? msgText(msgs[0]).slice(0, 180) : '(no messages)';
    const choice = await confirmVerifyFirstModal(firstText);

    if (choice === 'yes') {
      hasScrolledToTop = true;
      return true;
    }
    return false;
  }

  async function downloadChat() {
    if (!hasScrolledToTop) {
      const choice = await confirmScrollFirstModal();
      if (choice === 'cancel') return;
      if (choice === 'yes') {
        const ok = await doScrollToTop();
        if (!ok) return;
      }
    }

    const msgs = getMessages();
    const firstText = msgs.length ? msgText(msgs[0]).slice(0, 180) : '(no messages)';
    const confirm = await confirmDownloadModal(firstText);
    if (confirm !== 'yes') return;

    const charName = (() => {
      const backBtn = document.querySelector('[aria-label="Go back to main app"]');
      const name = backBtn?.parentElement?.querySelector('p[class*="font-bold"]')?.innerText?.trim();
      return (name || '').slice(0, 50) || 'Bot';
    })();
    const lines = ["Sunny's Dreamjourney Toolkit V2 Chat Export",
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

  function scrollToBottom() {
    const scrollEl = getContainer();
    if (!scrollEl) { toast('Chat not found.'); return; }
    scrollEl.scrollTop = scrollEl.scrollHeight;
  }

  // ---- LOREBOOK TESTER (overlay) -----------------------------
  const LOREBOOK_KEY = 'djt:lorebook';
  let lbParsed = null;

  function escHTML(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Case-insensitive, word-boundary matches of `trigger` in `text` -> [{start,end}]
  function lbFindMatches(text, trigger) {
    const tLow = trigger.toLowerCase(), txLow = text.toLowerCase();
    const out = []; let idx = 0;
    while (idx <= txLow.length - tLow.length) {
      const pos = txLow.indexOf(tLow, idx);
      if (pos === -1) break;
      const end = pos + tLow.length;
      const before = pos > 0 ? txLow[pos-1] : ' ';
      const after  = end < txLow.length ? txLow[end] : ' ';
      if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) out.push({ start: pos, end });
      idx = pos + 1;
    }
    return out;
  }
  // Matches that are NOT wrapped in protective punctuation (_w_ /w/ -w- <w>)
  function lbFindUnwrapped(text, trigger) {
    return lbFindMatches(text, trigger).filter(m => {
      const b = text[m.start-1] || '', a = text[m.end] || '';
      if (b==='_'&&a==='_') return false;
      if (b==='/'&&a==='/') return false;
      if (b==='-'&&a==='-') return false;
      if (b==='<'&&a==='>') return false;
      return true;
    });
  }
  function lbDirectHits(message, entry) {
    return (entry.keys||[]).filter(k=>lbFindMatches(message,k.keyText).length>0).map(k=>k.keyText);
  }
  function lbCascadeHits(body, target) {
    return (target.keys||[]).filter(k=>lbFindUnwrapped(body,k.keyText).length>0).map(k=>k.keyText);
  }

  function lbAnalyze(message, entries) {
    message = (message||'').replace(/\n{2,}/g,'\n');   // collapse blank lines so the highlight box stays compact
    const pinnedSet = {};
    entries.forEach(e => { if (e.pinned) pinnedSet[e.name] = true; });
    const directMap = {};
    entries.forEach(e => { const h = lbDirectHits(message, e); if (h.length) directMap[e.name] = h; });

    const cascadeMap = {}, activated = {}, visited = {};
    Object.keys(pinnedSet).forEach(n => { activated[n]=true; visited[n]=true; });
    Object.keys(directMap).forEach(n => { activated[n]=true; visited[n]=true; });
    const queue = Object.keys(activated).slice();
    while (queue.length) {
      const srcName = queue.shift();
      const src = entries.find(e=>e.name===srcName); if (!src) continue;
      const body = src.description || '';
      entries.forEach(tgt => {
        if (visited[tgt.name]) return;
        const hits = lbCascadeHits(body, tgt);
        if (hits.length) {
          visited[tgt.name]=true; activated[tgt.name]=true;
          (cascadeMap[tgt.name]=cascadeMap[tgt.name]||[]).push({source:srcName,keys:hits});
          queue.push(tgt.name);
        }
      });
    }

    const activatedList = entries.filter(e=>activated[e.name]).sort((a,b)=>{
      if (a.pinned&&!b.pinned) return -1;
      if (!a.pinned&&b.pinned) return 1;
      return (b.weight||5)-(a.weight||5);
    });

    let running=0; const included=[], cut=[], tokMap={};
    activatedList.forEach(e=>{
      const t = Math.round((e.description||'').length/4);
      tokMap[e.name]=t;
      if (running+t<=1500){ running+=t; included.push(e); } else cut.push(e);
    });

    const hlRanges=[];
    Object.keys(directMap).forEach(name=>directMap[name].forEach(key=>lbFindMatches(message,key).forEach(m=>hlRanges.push(m))));

    return { message, directMap, cascadeMap, pinnedSet, activatedList, included, cut, tokMap, totalToks:running, hlRanges };
  }

  function lbBuildHighlight(text, ranges) {
    if (!ranges||!ranges.length) return escHTML(text);
    const sorted = ranges.slice().sort((a,b)=>a.start-b.start||b.end-a.end);
    const merged = [];
    sorted.forEach(r=>{ if(!merged.length||r.start>=merged[merged.length-1].end) merged.push(r); });
    let html='', idx=0;
    merged.forEach(r=>{ html+=escHTML(text.slice(idx,r.start)); html+='<mark class="djt-lb-hl">'+escHTML(text.slice(r.start,r.end))+'</mark>'; idx=r.end; });
    html+=escHTML(text.slice(idx));
    return html;
  }

  function openLorebookTester() {
    if (document.getElementById('djt-lb-overlay')) return;
    const ov = document.createElement('div'); ov.id = 'djt-lb-overlay';
    ov.setAttribute('data-djt-theme', settings.theme || 'dark'); ov.setAttribute('data-djt-skin', settings.skin || 'dreamjourney');
    ov.innerHTML =
      `<div class="djt-lb-modal">` +
        `<div class="djt-lb-head">` +
          `<span class="djt-lb-title">🔍 Message Tester</span>` +
          `<button id="djt-lb-close" class="djt-lb-x" title="Close">✕</button>` +
        `</div>` +
        `<div class="djt-lb-body">` +
          `<div id="djt-lb-nolb" class="djt-lb-banner warn" style="display:none;margin-bottom:12px">No lorebook loaded yet. Click <b>Load Lorebook</b> first, then come back here.</div>` +
          `<div class="djt-lb-step">Analyze a message</div>` +
          `<textarea id="djt-lb-msg" class="djt-lb-ta" placeholder="Type a message, or pull the latest one from this chat..."></textarea>` +
          `<div class="djt-lb-row">` +
            `<button id="djt-lb-analyze" class="djt-mini-btn primary">Analyze triggers</button>` +
            `<button id="djt-lb-grab" class="djt-mini-btn">Use last chat message</button>` +
          `</div>` +
          `<div id="djt-lb-results" style="display:none">` +
            `<div class="djt-lb-sec">Highlighted message</div>` +
            `<div id="djt-lb-hl" class="djt-lb-hlbox"></div>` +
            `<div class="djt-lb-sec">Summary</div>` +
            `<div id="djt-lb-badges" class="djt-lb-badges"></div>` +
            `<div class="djt-lb-toklabels"><span>Estimated tokens loaded</span><span id="djt-lb-toklabel" class="djt-lb-tokval">~0 / 1500</span></div>` +
            `<div class="djt-lb-toktrack"><div id="djt-lb-tokbar" class="djt-lb-tokfill" style="width:0%"></div></div>` +
            `<div id="djt-lb-status"></div>` +
            `<div class="djt-lb-sec">Activated entries</div>` +
            `<div id="djt-lb-entries" class="djt-lb-entries"></div>` +
            `<div class="djt-lb-foot">Estimates are approximate (~1 token / 4 chars). Pinned entries load first, then by weight. This tool shows what's activated. Whether the model used it well is for you to judge.</div>` +
          `</div>` +
        `</div>` +
      `</div>`;
    document.body.appendChild(ov);

    const close = () => { const o=document.getElementById('djt-lb-overlay'); if(o)o.remove(); };
    document.getElementById('djt-lb-close').addEventListener('click', close);
    ov.addEventListener('click', e => { if (e.target === ov) close(); });

    // Load lorebook from storage
    try { chrome.storage.local.get([LOREBOOK_KEY], d => {
      if (d && d[LOREBOOK_KEY]) {
        try { lbParsed = JSON.parse(d[LOREBOOK_KEY]); } catch(e) { toast('Error loading lorebook'); }
      } else {
        const nb = document.getElementById('djt-lb-nolb'); if (nb) nb.style.display = '';
      }
    }); } catch(e){}

    document.getElementById('djt-lb-grab').addEventListener('click', () => {
      const lb = lastBot();
      if (lb) { document.getElementById('djt-lb-msg').value = msgText(lb); }
      else toast('No bot message found in this chat.');
    });

    document.getElementById('djt-lb-analyze').addEventListener('click', () => {
      if (!lbParsed) { toast('Load a lorebook first.'); return; }
      const msg = document.getElementById('djt-lb-msg').value;
      if (!msg.trim()) { toast('Type or paste a message to analyze.'); return; }
      lbRenderResults(lbAnalyze(msg, lbParsed.entries));
      document.getElementById('djt-lb-results').style.display='';
    });
  }

  function lbRenderResults(a) {
    document.getElementById('djt-lb-hl').innerHTML = lbBuildHighlight(a.message, a.hlRanges);

    const nDirect=Object.keys(a.directMap).length, nCascade=Object.keys(a.cascadeMap).length,
          nPinned=Object.keys(a.pinnedSet).length, nCut=a.cut.length, total=a.activatedList.length;
    let badges='';
    if (!total) badges='<span class="djt-lb-badge none">No triggers found</span>';
    else {
      if (nDirect)  badges+=`<span class="djt-lb-badge direct">${nDirect} direct</span>`;
      if (nCascade) badges+=`<span class="djt-lb-badge cascade">${nCascade} cascade</span>`;
      if (nPinned)  badges+=`<span class="djt-lb-badge pinned">${nPinned} pinned</span>`;
      if (nCut)     badges+=`<span class="djt-lb-badge cut">${nCut} cut</span>`;
    }
    document.getElementById('djt-lb-badges').innerHTML=badges;

    const bar=document.getElementById('djt-lb-tokbar');
    bar.style.width=Math.min(100,(a.totalToks/1500)*100)+'%';
    bar.className='djt-lb-tokfill'+(a.totalToks>1500?' over':'');
    document.getElementById('djt-lb-toklabel').textContent='~'+a.totalToks+' / 1500';

    const st=document.getElementById('djt-lb-status');
    if (!total) st.innerHTML='<div class="djt-lb-banner info">No entries triggered. Try words matching your trigger keys, or pull a bot message to check cascade.</div>';
    else if (nCut>0) st.innerHTML=`<div class="djt-lb-banner warn">⚠️ <b>1500 token limit reached.</b> The ${nCut} greyed-out entr${nCut!==1?'ies':'y'} below were estimated as cut, so the model likely didn't have them.</div>`;
    else st.innerHTML='<div class="djt-lb-banner ok">✓ Under the 1500 token budget. All activated entries should have loaded.</div>';

    const list=document.getElementById('djt-lb-entries'); list.innerHTML='';
    if (!total){ list.innerHTML='<div class="djt-lb-empty">No entries were triggered.</div>'; return; }
    a.included.forEach(e=>list.appendChild(lbBuildRow(e,a,false)));
    if (a.cut.length){
      const d=document.createElement('div'); d.className='djt-lb-sec'; d.textContent='Cut from context (over budget)';
      list.appendChild(d);
      a.cut.forEach(e=>list.appendChild(lbBuildRow(e,a,true)));
    }
  }

  function lbBuildRow(entry, a, isCut) {
    const row=document.createElement('div'); row.className='djt-lb-entry'+(isCut?' cut':'');
    let how='';
    if (entry.pinned) how='📌 Pinned, always loaded';
    else if (a.directMap[entry.name]) how='🎯 Direct, matched: <b>'+escHTML(a.directMap[entry.name].join(', '))+'</b>';
    else if (a.cascadeMap[entry.name]) how=a.cascadeMap[entry.name].map(s=>'🔗 Cascade from <b>'+escHTML(s.source)+'</b> via <b>'+escHTML(s.keys.join(', '))+'</b>').join('<br>');
    const toks=a.tokMap[entry.name]||0;
    const meta=[]; if(entry.type)meta.push(entry.type); meta.push('weight '+(entry.weight!=null?entry.weight:5));
    if(entry.hidden)meta.push('hidden'); if(entry.pinned)meta.push('pinned');
    row.innerHTML=
      `<div><div class="djt-lb-ename">${escHTML(entry.name)}</div>`+
      `<div class="djt-lb-emeta">${meta.map(escHTML).join(' · ')}</div>`+
      (how?`<div class="djt-lb-ehow">${how}</div>`:'')+`</div>`+
      `<div class="djt-lb-etok">~${toks}<small>tok</small></div>`;
    return row;
  }

  // ---- ACTIVE CHAT SCANNER (live trigger highlighting) -------
  // Uses the CSS Custom Highlight API so we never touch the chat DOM -
  // no React conflicts, and it does NOT retrigger containerObserver.
  let scanActive = false, scanRegex = null, scanTriggerCount = 0, scanDebounce = null, panelDebounce = null;
  const SCAN_HL = 'djt-scan';
  const scanSupported = () => (typeof Highlight !== 'undefined' && window.CSS && CSS.highlights);

  function buildScanRegex(entries) {
    const set = new Set();
    (entries || []).forEach(e => (e.keys || []).forEach(k => { if (k.keyText && k.keyText.trim()) set.add(k.keyText.trim()); }));
    const triggers = [...set].sort((a, b) => b.length - a.length);
    scanTriggerCount = triggers.length;
    if (!triggers.length) return null;
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try { return new RegExp('(?<![A-Za-z0-9])(' + triggers.map(esc).join('|') + ')(?![A-Za-z0-9])', 'gi'); }
    catch (e) { return null; }
  }

  function runChatScan() {
    if (!active || !scanActive || !scanRegex || !scanSupported()) return;
    // Only scan the 4 most recent messages (2 bot, 2 user) - keeps the live scan
    // focused on what's actually in play instead of painting the whole history.
    const ms = getMessages();
    const bots = [], users = [];
    for (let i = ms.length - 1; i >= 0 && (bots.length < 2 || users.length < 2); i--) {
      if (isBot(ms[i])) { if (bots.length < 2) bots.push(ms[i]); }
      else { if (users.length < 2) users.push(ms[i]); }
    }
    const roots = [...bots, ...users];
    if (!roots.length) { CSS.highlights.delete(SCAN_HL); return; }
    const hl = new Highlight(); let count = 0;
    roots.forEach(root => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
          if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          const p = n.parentElement;
          if (p && p.closest('.djt-del-thinking')) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      let node;
      while ((node = walker.nextNode())) {
        const text = node.nodeValue; scanRegex.lastIndex = 0; let m;
        while ((m = scanRegex.exec(text))) {
          if (m[0].length === 0) { scanRegex.lastIndex++; continue; }
          try { const r = document.createRange(); r.setStart(node, m.index); r.setEnd(node, m.index + m[0].length); hl.add(r); count++; } catch (e) {}
          if (count > 8000) break;
        }
        if (count > 8000) break;
      }
    });
    CSS.highlights.set(SCAN_HL, hl);
  }

  function clearChatScan() { if (scanSupported()) CSS.highlights.delete(SCAN_HL); }

  function loadScanLorebook(cb) {
    try { chrome.storage.local.get([LOREBOOK_KEY], d => {
      let lb = null; const raw = d && d[LOREBOOK_KEY];
      if (raw) { try { lb = JSON.parse(raw); } catch (e) {} }
      cb(lb);
    }); } catch (e) { cb(null); }
  }

  function setScanner(on) {
    if (on) {
      if (!scanSupported()) { toast('Your browser does not support live highlighting.'); return; }
      loadScanLorebook(lb => {
        if (!lb || !Array.isArray(lb.entries) || !lb.entries.length) {
          toast('Load a lorebook first.');
          openLoadLorebookModal();
          return;
        }
        scanRegex = buildScanRegex(lb.entries);
        if (!scanRegex) { toast('No triggers found in that lorebook.'); return; }
        scanActive = true; settings.scanActive = true; saveSettings();
        runChatScan(); updateScanBtn();
        toast('Live scan on: ' + scanTriggerCount + ' triggers.');
      });
    } else {
      scanActive = false; settings.scanActive = false; saveSettings();
      clearChatScan(); updateScanBtn();
    }
  }

  function updateScanBtn() {
    const b = document.getElementById('djt-scan-btn'); if (!b) return;
    b.textContent = scanActive ? '🔆 Active Chat Scanner: On' : '🔆 Active Chat Scanner: Off';
    b.classList.toggle('primary', scanActive);
  }

  function maybeStartScanner() {
    if (!settings.scanActive || !scanSupported()) return;
    loadScanLorebook(lb => {
      if (lb && Array.isArray(lb.entries) && lb.entries.length) {
        scanRegex = buildScanRegex(lb.entries);
        if (scanRegex) { scanActive = true; runChatScan(); updateScanBtn(); }
      }
    });
  }


  // ---- LOREBOOK LIBRARY & LOAD MODAL -----------------------
  function loadLorebookLibrary(cb) {
    try { chrome.storage.local.get(['djt:lb-library'], d => {
      cb((d && d['djt:lb-library']) || []);
    }); } catch (e) { cb([]); }
  }
  function saveLorebookLibrary(lib) {
    try { chrome.storage.local.set({'djt:lb-library': lib}); } catch (e) {}
  }
  function saveToLibrary(name, json) {
    loadLorebookLibrary(lib => {
      lib.push({name, json, dateAdded: Date.now()});
      saveLorebookLibrary(lib);
    });
  }
  function deleteFromLibrary(idx) {
    loadLorebookLibrary(lib => {
      lib.splice(idx, 1);
      saveLorebookLibrary(lib);
    });
  }

  function openLoadLorebookModal() {
    if (document.getElementById('djt-lb-overlay')) return;
    const ov = document.createElement('div'); ov.id = 'djt-lb-overlay';
    ov.setAttribute('data-djt-theme', settings.theme || 'dark'); ov.setAttribute('data-djt-skin', settings.skin || 'dreamjourney');
    ov.innerHTML =
      `<div class="djt-lb-modal">` +
        `<div class="djt-lb-head">` +
          `<span class="djt-lb-title">📥 Load Lorebook</span>` +
          `<button id="djt-load-close" class="djt-lb-x" title="Close">✕</button>` +
        `</div>` +
        `<div class="djt-lb-body">` +
          `<div class="djt-lb-step">Your saved lorebooks</div>` +
          `<div id="djt-lib-list" class="djt-lb-entries" style="margin-bottom:6px"></div>` +
          `<div class="djt-lb-step" id="djt-lb-step2">Paste a new lorebook</div>` +
          `<textarea id="djt-load-ta" class="djt-lb-ta mono" placeholder="Paste your lorebook JSON here..."></textarea>` +
          `<div class="djt-lb-row">` +
            `<button id="djt-load-paste-btn" class="djt-mini-btn primary">Load</button>` +
            `<button id="djt-load-save-btn" class="djt-mini-btn">Save &amp; Load</button>` +
            `<button id="djt-load-cancel-btn" class="djt-mini-btn">Cancel</button>` +
          `</div>` +
          `<div id="djt-load-status" class="djt-lb-msg"></div>` +
        `</div>` +
      `</div>`;
    document.body.appendChild(ov);

    const close = () => { const o=document.getElementById('djt-lb-overlay'); if(o)o.remove(); };
    document.getElementById('djt-load-close').addEventListener('click', close);
    document.getElementById('djt-load-cancel-btn').addEventListener('click', close);
    ov.addEventListener('click', e => { if (e.target === ov) close(); });

    loadLorebookLibrary(lib => {
      const list = document.getElementById('djt-lib-list');
      if (!list) return;
      if (lib.length === 0) {
        list.innerHTML = '<div class="djt-lb-empty">No saved lorebooks yet.</div>';
      } else {
        list.innerHTML = lib.map((lb, i) => `
          <div class="djt-lb-entry" style="grid-template-columns:1fr auto auto;align-items:center">
            <div>
              <div class="djt-lb-ename">${escHTML(lb.name)}</div>
              <div class="djt-lb-emeta">${new Date(lb.dateAdded).toLocaleDateString()}</div>
            </div>
            <button onclick="djt_loadFromLib(${i})" class="djt-mini-btn primary" style="padding:4px 12px;font-size:11px">Use</button>
            <button onclick="djt_deleteFromLib(${i})" class="djt-mini-btn" style="padding:4px 9px;font-size:11px" title="Delete">×</button>
          </div>
        `).join('');
      }
    });
    document.getElementById('djt-load-paste-btn').addEventListener('click', () => {
      const json = document.getElementById('djt-load-ta').value.trim();
      let lb; try { lb = JSON.parse(json); } catch (e) { toast('Invalid JSON'); return; }
      if (!Array.isArray(lb.entries)) { toast('Must have entries array'); return; }
      chrome.storage.local.set({'djt:lorebook': json}, () => {
        toast('Lorebook loaded!');
        scanRegex = null; scanActive = false; setScanner(false); updateScanBtn();
        close();
      });
    });
    document.getElementById('djt-load-save-btn').addEventListener('click', () => {
      const name = prompt('Lorebook name:'); if (!name) return;
      const json = document.getElementById('djt-load-ta').value.trim();
      let lb; try { lb = JSON.parse(json); } catch (e) { toast('Invalid JSON'); return; }
      if (!Array.isArray(lb.entries)) { toast('Must have entries array'); return; }
      saveToLibrary(name, json);
      chrome.storage.local.set({'djt:lorebook': json}, () => {
        toast('Saved & loaded!');
        scanRegex = null; scanActive = false; setScanner(false); updateScanBtn();
        close();
      });
    });
    window.djt_loadFromLib = (i) => {
      loadLorebookLibrary(lib => {
        if (!lib[i]) return;
        chrome.storage.local.set({'djt:lorebook': lib[i].json}, () => {
          toast('Lorebook loaded: ' + lib[i].name);
          scanRegex = null; scanActive = false; setScanner(false); updateScanBtn();
          close();
        });
      });
    };
    window.djt_deleteFromLib = (i) => {
      if (!confirm('Delete this lorebook?')) return;
      deleteFromLibrary(i);
      const list = document.getElementById('djt-lib-list');
      if (list) list.innerHTML = '<div class="djt-lb-empty">Deleted. Reopen to refresh.</div>';
    };
  }

  function openMessageTester() {
    openLorebookTester();
  }

  // Pop out the full Message Tester results for the current recent chat context.
  function openActiveChatDetails() {
    openLorebookTester();
    // openLorebookTester loads the lorebook async; wait a tick then prefill + analyze.
    setTimeout(() => {
      const ta = document.getElementById('djt-lb-msg');
      if (ta) ta.value = recentChatText();
      const btn = document.getElementById('djt-lb-analyze');
      if (btn) btn.click();
    }, 120);
  }

  // ---- ACTIVE CHAT PANEL (live token tracking) -----
  let panelActive = false;
  let panelUpdateTo = null;

  // Combine the last 2 bot + last 2 user messages into one block of context.
  function recentChatText() {
    const ms = getMessages();
    const bots = [], users = [];
    for (let i = ms.length - 1; i >= 0 && (bots.length < 2 || users.length < 2); i--) {
      if (isBot(ms[i])) { if (bots.length < 2) bots.push(ms[i]); }
      else { if (users.length < 2) users.push(ms[i]); }
    }
    const picked = [...bots, ...users];
    return picked.map(m => msgText(m)).filter(Boolean).join('\n');
  }

  function toggleActiveChatPanel() {
    const card = document.getElementById('djt-acp-card');
    if (card.style.display !== 'none') {
      panelActive = false;
      card.style.display = 'none';
      clearTimeout(panelUpdateTo);
      return;
    }
    try { chrome.storage.local.get([LOREBOOK_KEY], d => {
      const json = d && d[LOREBOOK_KEY];
      if (!json) { toast('Load a lorebook first.'); openLoadLorebookModal(); return; }
      panelActive = true;
      card.style.display = '';
      updateActiveChatPanel();
    }); } catch (e) { toast('Error loading panel'); }
  }

  function updateActiveChatPanel() {
    if (!panelActive) return;
    const card = document.getElementById('djt-acp-card'); if (!card) return;
    clearTimeout(panelUpdateTo);
    chrome.storage.local.get([LOREBOOK_KEY], d => {
      if (!panelActive) return;
      const json = d && d[LOREBOOK_KEY]; if (!json) return;
      let lb; try { lb = JSON.parse(json); } catch (e) { return; }
      if (!Array.isArray(lb.entries)) return;
      const text = recentChatText();
      const a = lbAnalyze(text, lb.entries);
      const pct = Math.round(Math.min(a.totalToks, 1500) / 15);
      document.getElementById('djt-acp-toks').textContent = a.totalToks.toLocaleString();
      document.getElementById('djt-acp-pct').textContent = pct;
      const bar = document.getElementById('djt-acp-bar');
      bar.style.width = pct + '%';
      bar.style.background = a.totalToks > 1500 ? 'var(--djt-danger,#ef4444)' : 'var(--djt-accent)';

      const nDirect = Object.keys(a.directMap).length, nCascade = Object.keys(a.cascadeMap).length,
            nPinned = Object.keys(a.pinnedSet).length, nCut = a.cut.length;
      const badge = (txt, bg, fg) => `<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;background:${bg};color:${fg}">${txt}</span>`;
      let badges = '';
      if (!a.activatedList.length) badges = badge('No triggers found', 'rgba(255,255,255,0.06)', 'var(--djt-muted)');
      else {
        if (nDirect)  badges += badge(nDirect + ' direct', 'rgba(167,139,250,0.15)', '#a78bfa');
        if (nCascade) badges += badge(nCascade + ' cascade', 'rgba(249,115,22,0.15)', '#f97316');
        if (nPinned)  badges += badge(nPinned + ' pinned', 'rgba(34,197,94,0.15)', '#22c55e');
        if (nCut)     badges += badge(nCut + ' cut', 'rgba(239,68,68,0.15)', '#ef4444');
      }
      const badgeEl = document.getElementById('djt-acp-badges');
      if (badgeEl) { badgeEl.innerHTML = badges; badgeEl.style.display='flex'; badgeEl.style.flexWrap='wrap'; badgeEl.style.gap='6px'; }

      const rows = a.included.map(e => {
        let how = '';
        if (e.pinned) how = '📌 Pinned, always loaded';
        else if (a.directMap[e.name]) how = '🎯 Direct, matched: <b>' + escHTML(a.directMap[e.name].join(', ')) + '</b>';
        else if (a.cascadeMap[e.name]) how = a.cascadeMap[e.name].map(s => '🔗 Cascade from <b>' + escHTML(s.source) + '</b> via <b>' + escHTML(s.keys.join(', ')) + '</b>').join('<br>');
        return `<div style="padding:5px 7px;background:rgba(167,139,250,0.10);border-left:2px solid var(--djt-accent);border-radius:4px;margin-bottom:4px">` +
               `<div style="font-size:12px;font-weight:600;color:var(--djt-text)">${escHTML(e.name||'(unnamed)')} <span style="color:var(--djt-muted);font-weight:400">~${a.tokMap[e.name]} tok</span></div>` +
               `<div style="font-size:10px;color:var(--djt-soft);line-height:1.5">${how}</div></div>`;
      }).join('');
      let cutNote = a.cut.length ? `<div style="font-size:10px;color:var(--djt-danger,#ef4444);margin-top:4px">⚠️ ${a.cut.length} entr${a.cut.length!==1?'ies':'y'} over budget (cut)</div>` : '';
      document.getElementById('djt-acp-entries').innerHTML =
        (a.included.length ? rows : '<div style="color:var(--djt-muted);font-size:12px">No entries active in recent messages.</div>') + cutNote;

      panelUpdateTo = setTimeout(updateActiveChatPanel, 30000);
    });
  }

  // ---- UI PRIMITIVES -----------------------------------------
  function toast(msg) { const el=document.createElement('div');el.className='djt-toast';el.textContent=msg;document.body.appendChild(el);setTimeout(()=>el.classList.add('show'),10);setTimeout(()=>el.remove(),2800); }

  function confirmScrollFirstModal() {
    return new Promise(resolve => {
      const ov = document.createElement('div'); ov.className = 'djt-modal-overlay';
      ov.setAttribute('data-djt-theme', settings.theme || 'dark'); ov.setAttribute('data-djt-skin', settings.skin || 'dreamjourney');
      ov.innerHTML =
        `<div class="djt-modal">` +
        `<h2>Scroll to first message first?</h2>` +
        `<p>You haven't scrolled to the start yet. Scrolling first loads all older messages so the download is complete.</p>` +
        `<div class="djt-modal-btns">` +
        `<button class="djt-btn ghost" data-v="cancel">Cancel</button>` +
        `<button class="djt-btn ghost" data-v="no">No, download now</button>` +
        `<button class="djt-btn primary" data-v="yes">Yes, scroll first</button>` +
        `</div></div>`;
      document.body.appendChild(ov);
      ov.addEventListener('click', e => {
        const b = e.target.closest('[data-v]'); if (!b) return;
        ov.remove(); resolve(b.dataset.v);
      });
    });
  }

  function confirmVerifyFirstModal(firstText) {
    return new Promise(resolve => {
      const ov = document.createElement('div'); ov.className = 'djt-modal-overlay';
      ov.setAttribute('data-djt-theme', settings.theme || 'dark'); ov.setAttribute('data-djt-skin', settings.skin || 'dreamjourney');
      const safe = firstText.replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
      ov.innerHTML =
        `<div class="djt-modal">` +
        `<h2>Is this the first message?</h2>` +
        `<p>First message loaded:<br><em>&ldquo;${safe}&rdquo;</em></p>` +
        `<p class="djt-modal-hint">If not, please check the help section.</p>` +
        `<div class="djt-modal-btns">` +
        `<button class="djt-btn ghost" data-v="no">No, try scrolling more</button>` +
        `<button class="djt-btn primary" data-v="yes">Yes, this is it</button>` +
        `</div></div>`;
      document.body.appendChild(ov);
      ov.addEventListener('click', e => {
        const b = e.target.closest('[data-v]'); if (!b) return;
        ov.remove(); resolve(b.dataset.v);
      });
    });
  }

  function confirmDownloadModal(firstText) {
    return new Promise(resolve => {
      const ov = document.createElement('div'); ov.className = 'djt-modal-overlay';
      ov.setAttribute('data-djt-theme', settings.theme || 'dark'); ov.setAttribute('data-djt-skin', settings.skin || 'dreamjourney');
      const safe = firstText.replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
      ov.innerHTML =
        `<div class="djt-modal">` +
        `<h2>Is this the first message?</h2>` +
        `<p>First message loaded:<br><em>&ldquo;${safe}&rdquo;</em></p>` +
        `<p class="djt-modal-hint">If not, please check the help section.</p>` +
        `<div class="djt-modal-btns">` +
        `<button class="djt-btn ghost" data-v="cancel">Cancel</button>` +
        `<button class="djt-btn primary" data-v="yes">Yes, download chat</button>` +
        `</div></div>`;
      document.body.appendChild(ov);
      ov.addEventListener('click', e => {
        const b = e.target.closest('[data-v]'); if (!b) return;
        ov.remove(); resolve(b.dataset.v);
      });
    });
  }

  // ---- DRAGGABLE PANEL ---------------------------------------
  const clampNum = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // Keep the whole panel inside the viewport (call after expand / size change).
  function clampPanelIntoView(panel) {
    if (!panel.style.left || panel.style.left === 'auto') return;
    const left = clampNum(parseInt(panel.style.left) || 0, 0, Math.max(0, window.innerWidth  - panel.offsetWidth));
    const top  = clampNum(parseInt(panel.style.top)  || 0, 0, Math.max(0, window.innerHeight - 44));
    panel.style.left = left + 'px';
    panel.style.top  = top + 'px';
  }

  function initDrag(panel) {
    const head = document.getElementById('djt-head');
    let dragging = false, dragMoved = false, ox = 0, oy = 0, startX = 0, startY = 0;
    const THRESH = 4;   // px of movement before it counts as a drag (vs a click)

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
      if (e.target.closest('#djt-resize')) return;   // resize handle has its own handler
      toAbsolute();
      dragging = true; dragMoved = false;
      const [cx, cy] = getClient(e);
      startX = cx; startY = cy;
      ox = cx - parseInt(panel.style.left);
      oy = cy - parseInt(panel.style.top);
      if (!collapsed) head.style.cursor = 'grabbing';
      // Always preventDefault: stops the browser's native image-drag on the sun icon
      // (which was causing the collapsed bubble to "stick" to the cursor). Expand on
      // tap is handled manually in onUp, so suppressing the synthetic click is fine.
      e.preventDefault();
    };
    const onMove = e => {
      if (!dragging) return;
      const [cx, cy] = getClient(e);
      if (!dragMoved && Math.abs(cx - startX) < THRESH && Math.abs(cy - startY) < THRESH) return;
      dragMoved = true;
      panel.classList.add('djt-no-anim');
      panel.style.left = clampNum(cx - ox, 0, window.innerWidth  - panel.offsetWidth)  + 'px';
      panel.style.top  = clampNum(cy - oy, 0, window.innerHeight - 44) + 'px';
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      panel.classList.remove('djt-no-anim');
      const collapsed = panel.classList.contains('djt-collapsed');
      if (!dragMoved && collapsed) {
        // Tap (no real movement) on the sun bubble - expand the panel, then make
        // sure the now-wider panel doesn't spill off the right/bottom edge.
        panel.classList.remove('djt-collapsed');
        head.style.cursor = 'grab';
        toAbsolute();
        requestAnimationFrame(() => clampPanelIntoView(panel));
        settings.panelPos = { left: panel.style.left, top: panel.style.top };
        saveSettings();
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

  // ---- RESIZABLE PANEL ---------------------------------------
  function initResize(panel) {
    const handle = document.getElementById('djt-resize');
    const body = document.getElementById('djt-body');
    if (!handle || !body) return;
    let resizing = false, startX = 0, startY = 0, startW = 0, startBodyH = 0;
    const getClient = e => e.touches ? [e.touches[0].clientX, e.touches[0].clientY] : [e.clientX, e.clientY];

    const onDown = e => {
      resizing = true;
      const [cx, cy] = getClient(e);
      startX = cx; startY = cy;
      startW = panel.offsetWidth;
      startBodyH = body.offsetHeight;
      panel.classList.add('djt-no-anim');
      e.preventDefault(); e.stopPropagation();
    };
    const onMove = e => {
      if (!resizing) return;
      const [cx, cy] = getClient(e);
      const w = clampNum(startW + (cx - startX), 200, Math.min(520, window.innerWidth - 24));
      const h = clampNum(startBodyH + (cy - startY), 120, window.innerHeight * 0.85);
      panel.style.width = w + 'px';
      body.style.maxHeight = h + 'px';
      body.style.height = h + 'px';
    };
    const onUp = () => {
      if (!resizing) return;
      resizing = false;
      panel.classList.remove('djt-no-anim');
      settings.panelSize = { width: panel.style.width, bodyHeight: body.style.height };
      saveSettings();
      clampPanelIntoView(panel);
    };

    handle.addEventListener('mousedown', onDown);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    handle.addEventListener('touchstart', onDown, { passive: false });
    document.addEventListener('touchmove', e => { if (resizing) { e.preventDefault(); onMove(e); } }, { passive: false });
    document.addEventListener('touchend', onUp);
  }

  // ---- PANEL -------------------------------------------------
  const setTheme = theme => { const p=document.getElementById('djt-panel');if(!p)return;p.setAttribute('data-djt-theme',theme||'dark');const tb=document.getElementById('djt-theme-btn');if(tb)tb.textContent=theme==='light'?'\u{1F319}':'☀️'; };
  const setSkin = skin => {
    const p=document.getElementById('djt-panel'); if(!p) return;
    p.setAttribute('data-djt-skin', skin || 'dreamjourney');
    [...document.querySelectorAll('.djt-theme-opt')].forEach(b => b.classList.toggle('active', b.dataset.skin === (skin||'dreamjourney')));
  };

  const cardH = (label, key) =>
    `<div class="djt-card-h djt-card-h-btn" data-djt-key="${key}"><span class="djt-card-arrow">▾</span>${label}</div>`;

  const toggleRow = (key, label) =>
    `<div class="djt-toggle-row"><span>${label}</span><label class="djt-switch"><input type="checkbox" id="djt-t-${key}" checked><span class="djt-slider"></span></label></div>`;

  function buildPanel() {
    if(document.getElementById('djt-panel')) return;
    const p = document.createElement('div'); p.id = 'djt-panel';
    const sunIconUrl = (() => { try { return chrome.runtime.getURL('icons/icon48.png'); } catch(e) { return ''; } })();
    const studioUrl  = (() => { try { return chrome.runtime.getURL('lorebook-studio.html'); } catch(e) { return '#'; } })();

    p.innerHTML =
      // HEAD
      `<div id="djt-head">` +
        `<img id="djt-sun-icon" src="${sunIconUrl}" alt="☀️" draggable="false" onerror="this.outerHTML='<span id=\\'djt-sun-icon\\' style=\\'font-size:20px;flex-shrink:0\\'>☀️</span>'">` +
        `<span class="djt-title">Sunny’s Toolkit</span>` +
        `<div class="djt-head-btns">` +
          `<button id="djt-theme-btn" class="djt-icon-btn" title="Toggle light/dark">☀️</button>` +
          `<button id="djt-collapse" title="Collapse">–</button>` +
        `</div>` +
      `</div>` +

      // TAB BAR
      `<div id="djt-tabs">` +
        `<button class="djt-tab" data-tab="chat">Chat Tools</button>` +
        `<button class="djt-tab" data-tab="creator">Creator Tools</button>` +
      `</div>` +

      // SCROLLABLE BODY
      `<div id="djt-body">` +

        // ==== CHAT TOOLS TAB ====
        `<div id="djt-tab-chat" class="djt-tab-pane">` +

          // Stats card
          `<div class="djt-card" id="djt-stats-card">` +
            cardH('Session stats', 'stats') +
            `<div class="djt-card-body">` +
              `<div class="djt-row"><span>Your messages</span><b id="djt-s-user">0</b></div>` +
              `<div class="djt-row"><span>Bot messages</span><b id="djt-s-bot">0</b></div>` +
              `<div class="djt-row"><span>Total</span><b id="djt-s-total">0</b></div>` +
              `<div class="djt-row"><span>Rerolls</span><b id="djt-s-rerolls">0</b></div>` +
              `<div class="djt-nexus-row" id="djt-nexus-section">` +
                `<div class="djt-nexus-inner"><span title="Messages sent since you last opened the Nexus memory panel">Since last Nexus</span><b id="djt-nexus-val" class="djt-nexus-num green">0</b></div>` +
                `<div id="djt-nexus-warn" class="djt-nexus-warn">Recommended to check Nexus for accuracy!</div>` +
              `</div>` +
            `</div>` +
          `</div>` +

          // Regen card
          `<div class="djt-card" id="djt-regen" style="display:none">` +
            cardH('Saved replies', 'regen') +
            `<div class="djt-card-body">` +
              `<div class="djt-regen-ctrl"><button id="djt-regen-prev" class="djt-mini-btn">‹</button><span id="djt-regen-pos">1 / 1</span><button id="djt-regen-next" class="djt-mini-btn">›</button></div>` +
              `<div id="djt-regen-preview" class="djt-regen-preview"></div>` +
              `<div style="display:flex;gap:6px"><button id="djt-regen-use" class="djt-mini-btn full">Use this reply</button><button id="djt-regen-discard" class="djt-mini-btn ghost" title="Discard all saved replies">&#10005;</button></div>` +
            `</div>` +
          `</div>` +

          // Scratch card
          `<div class="djt-card" id="djt-scratch-card">` +
            cardH('User Input Recovery', 'scratch') +
            `<div class="djt-card-body">` +
              `<div class="djt-scratch-sub">Unsent draft</div>` +
              `<div id="djt-scratch-txt" class="djt-scratch-preview djt-muted-text">Nothing saved yet</div>` +
              `<div class="djt-scratch-btns"><button id="djt-scratch-restore" class="djt-mini-btn">Restore</button><button id="djt-scratch-clear" class="djt-mini-btn ghost" style="display:none">Clear</button></div>` +
              `<div id="djt-hist-section" style="display:none">` +
                `<div class="djt-hist-divider"></div>` +
                `<div class="djt-hist-header">` +
                  `<span class="djt-scratch-sub">Sent history</span>` +
                  `<div class="djt-hist-ctrl"><button id="djt-hist-prev" class="djt-mini-btn">‹</button><span id="djt-hist-pos" class="djt-hist-pos">1/1 Saved</span><button id="djt-hist-next" class="djt-mini-btn">›</button></div>` +
                `</div>` +
                `<div id="djt-hist-preview" class="djt-scratch-preview djt-muted-text"></div>` +
                `<div class="djt-scratch-btns"><button id="djt-hist-restore" class="djt-mini-btn">Restore</button><button id="djt-hist-clear" class="djt-mini-btn ghost">Clear all</button></div>` +
              `</div>` +
            `</div>` +
          `</div>` +

          // Features card
          `<div class="djt-card" id="djt-features-card">` +
            cardH('Features', 'features') +
            `<div class="djt-card-body">` +
              toggleRow('saveRegens','Save regenerations') +
              toggleRow('stats','Session stats') +
              toggleRow('nexus','Nexus reminder') +
              toggleRow('scratchpad','User Input Recovery') +
              toggleRow('autoRefresh','Auto-refresh on Stop') +
              toggleRow('deleteThinking','Delete thinking <span class="djt-toggle-note">Nyx / Athena only</span>') +
            `</div>` +
          `</div>` +

          // 3-button download section
          `<div class="djt-dl-btns">` +
            `<button id="djt-scroll-top-btn" class="djt-mini-btn full djt-dl-btn">↑ Scroll to first message</button>` +
            `<button id="djt-download" class="djt-mini-btn full djt-dl-btn">⬇ Download chat (.txt)</button>` +
            `<button id="djt-scroll-bottom-btn" class="djt-mini-btn full djt-dl-btn">↓ Back to bottom</button>` +
          `</div>` +

          `<button id="djt-help-btn" class="djt-help-tab">? How to use this toolkit</button>` +

        `</div>` + // end djt-tab-chat

        // ==== CREATOR TOOLS TAB ====
        `<div id="djt-tab-creator" class="djt-tab-pane" style="display:none">` +

          // Bot Tools card
          `<div class="djt-card">` +
            cardH('Bot Tools', 'bottools') +
            `<div class="djt-card-body">` +
              `<button id="djt-bot-export-btn" class="djt-mini-btn full primary" style="margin-bottom:6px">📤 Export bot</button>` +
              `<button id="djt-bot-import-btn" class="djt-mini-btn full" style="margin-bottom:6px">📥 Import bot</button>` +
              `<div id="djt-bot-status-line" class="djt-tool-note" style="text-align:center">Open a bot page to auto-back-up.</div>` +
            `</div>` +
          `</div>` +

          // Lorebook Tools card
          `<div class="djt-card">` +
            cardH('Lorebook Tools', 'lorebook') +
            `<div class="djt-card-body">` +
              `<button id="djt-lb-load-btn" class="djt-mini-btn full primary" style="margin-bottom:6px">📥 Load Lorebook</button>` +
              `<button id="djt-lb-tester-btn" class="djt-mini-btn full" style="margin-bottom:6px">🔍 Message Tester</button>` +
              `<button id="djt-scan-btn" class="djt-mini-btn full" style="margin-bottom:6px">🔆 Active Chat Scanner: Off</button>` +
              `<div id="djt-acp-card" style="display:none;margin-top:12px;padding:10px;background:rgba(255,255,255,0.04);border-radius:8px;border:1px solid rgba(255,255,255,0.08)">` +
                `<div style="font-size:11px;color:var(--djt-muted);margin-bottom:8px;font-weight:700">LIVE ACTIVITY</div>` +
                `<div style="font-size:11px;color:var(--djt-soft);margin-bottom:8px">Based on the last 4 messages (2 bot, 2 you).</div>` +
                `<div id="djt-acp-badges" class="djt-lb-badges" style="margin-bottom:10px"></div>` +
                `<div style="font-size:11px;color:var(--djt-muted);margin-bottom:6px">Estimated tokens loaded</div>` +
                `<div style="font-size:16px;font-weight:700;color:var(--djt-accent);margin-bottom:8px"><span id="djt-acp-toks">0</span> / 1500</div>` +
                `<div style="width:100%;height:6px;background:rgba(0,0,0,0.3);border-radius:3px;overflow:hidden;margin-bottom:8px">` +
                  `<div id="djt-acp-bar" style="height:100%;width:0%;background:var(--djt-accent);transition:width 0.3s"></div>` +
                `</div>` +
                `<div style="font-size:10px;color:var(--djt-muted);margin-bottom:10px"><span id="djt-acp-pct">0</span>% of budget</div>` +
                `<div style="font-size:11px;color:var(--djt-muted);margin-bottom:4px">Activated entries</div>` +
                `<div id="djt-acp-entries" style="font-size:12px;color:var(--djt-soft);max-height:160px;overflow-y:auto"></div>` +
                `<button id="djt-acp-details" class="djt-mini-btn full" style="margin-top:8px">🔎 Full details</button>` +
              `</div>` +
              `<button id="djt-panel-toggle-btn" class="djt-mini-btn full" style="margin-top:6px">📊 Active Chat Panel</button>` +
            `</div>` +
          `</div>` +

          // Tool Pages card
          `<div class="djt-card">` +
            cardH('Tool Pages', 'toolpages') +
            `<div class="djt-card-body">` +
              `<a class="djt-tool-link" href="${studioUrl}" target="_blank">Lorebook Studio ↗</a>` +
              `<div class="djt-tool-note">Merge, wrap &amp; unwrap lorebooks, all in one page.</div>` +
            `</div>` +
          `</div>` +

          `<button id="djt-creator-help-btn" class="djt-help-tab">? How to use Creator Tools</button>` +

        `</div>` + // end djt-tab-creator

        // ==== SHARED FOOTER (both tabs) ====
        `<div id="djt-advanced-wrap">` +
          `<button id="djt-advanced-toggle" class="djt-advanced-toggle">▸ Advanced</button>` +
          `<div id="djt-advanced-body" style="display:none">` +
            `<div class="djt-theme-block">` +
              `<div class="djt-theme-label">🎨 Theme</div>` +
              `<div class="djt-theme-opts">` +
                `<button class="djt-theme-opt" data-skin="dreamjourney">DreamJourney</button>` +
                `<button class="djt-theme-opt" data-skin="sunflowers">Sunflowers</button>` +
              `</div>` +
            `</div>` +
            `<button id="djt-surprise-btn" class="djt-mini-btn full djt-surprise">&#127800; Surprise me!</button>` +
          `</div>` +
        `</div>` +
        `<div class="djt-credit">Made by SunflowerS at Dreamjourney AI</div>` +

      `</div>` + // end djt-body
      `<div id="djt-resize" title="Drag to resize"></div>`;

    document.body.appendChild(p);

    // ---- Event listeners ----

    document.getElementById('djt-collapse').addEventListener('click', e => {
      e.stopPropagation();
      const panel = document.getElementById('djt-panel');
      panel.classList.add('djt-collapsed');
      settings.panelPos = { left: panel.style.left || '', top: panel.style.top || '' };
      saveSettings();
    });
    // Belt-and-suspenders expand for mobile
    p.addEventListener('click', () => {
      if (p.classList.contains('djt-collapsed')) {
        p.classList.remove('djt-collapsed');
        const h = document.getElementById('djt-head'); if (h) h.style.cursor = 'grab';
        requestAnimationFrame(() => clampPanelIntoView(p));
      }
    });

    document.getElementById('djt-theme-btn').addEventListener('click', () => {
      settings.theme = settings.theme === 'light' ? 'dark' : 'light';
      saveSettings(); setTheme(settings.theme);
    });

    // Tabs
    [...document.querySelectorAll('#djt-tabs .djt-tab')].forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Collapsible card headers (delegated on body)
    document.getElementById('djt-body').addEventListener('click', e => {
      const h = e.target.closest('.djt-card-h-btn');
      if (!h || !h.dataset.djtKey) return;
      toggleCard(h.dataset.djtKey);
    });

    // Download / scroll buttons
    document.getElementById('djt-scroll-top-btn').addEventListener('click', doScrollToTop);
    document.getElementById('djt-download').addEventListener('click', downloadChat);
    document.getElementById('djt-scroll-bottom-btn').addEventListener('click', scrollToBottom);

    // Help buttons
    document.getElementById('djt-help-btn').addEventListener('click', () => {
      try { window.open(chrome.runtime.getURL('help.html'), '_blank'); } catch(e) { toast('Could not open help page.'); }
    });
    document.getElementById('djt-creator-help-btn').addEventListener('click', () => {
      try { window.open(chrome.runtime.getURL('creator-tools-help.html'), '_blank'); } catch(e) { toast('Could not open help page.'); }
    });
    document.getElementById('djt-bot-export-btn').addEventListener('click', openBotExport);
    document.getElementById('djt-bot-import-btn').addEventListener('click', openBotImport);
    document.getElementById('djt-lb-load-btn').addEventListener('click', openLoadLorebookModal);
    document.getElementById('djt-lb-tester-btn').addEventListener('click', openMessageTester);
    document.getElementById('djt-scan-btn').addEventListener('click', () => setScanner(!scanActive));
    document.getElementById('djt-panel-toggle-btn').addEventListener('click', toggleActiveChatPanel);
    document.getElementById('djt-acp-details').addEventListener('click', openActiveChatDetails);
    updateScanBtn();

    // Regen panel
    document.getElementById('djt-regen-prev').addEventListener('click', () => { previewIndex--; refreshRegenPanel(); });
    document.getElementById('djt-regen-next').addEventListener('click', () => { previewIndex++; refreshRegenPanel(); });
    document.getElementById('djt-regen-use').addEventListener('click', () => { const h=store.regenHistory; if(h&&h.versions&&previewIndex!==null) applyVersion(h.versions[previewIndex]); });
    document.getElementById('djt-regen-discard').addEventListener('click', () => { store.regenHistory={versions:[],current:0}; previewIndex=null; saveStore(); refreshRegenPanel(); });

    // Scratchpad
    document.getElementById('djt-scratch-restore').addEventListener('click', () => { const ta=document.querySelector('textarea[placeholder="Send your message..."]'); if(ta&&store.scratch){setReactValue(ta,store.scratch);ta.focus();} });
    document.getElementById('djt-scratch-clear').addEventListener('click', () => { store.scratch=''; saveStore(); refreshScratchUI(); });
    document.getElementById('djt-hist-prev').addEventListener('click', () => { scratchHistIdx=Math.max(0,scratchHistIdx-1); refreshScratchHistUI(); });
    document.getElementById('djt-hist-next').addEventListener('click', () => { scratchHistIdx=Math.min((store.scratchHistory||[]).length-1,scratchHistIdx+1); refreshScratchHistUI(); });
    document.getElementById('djt-hist-restore').addEventListener('click', () => { const ta=document.querySelector('textarea[placeholder="Send your message..."]'); const h=store.scratchHistory||[]; if(ta&&h[scratchHistIdx]){setReactValue(ta,h[scratchHistIdx]);ta.focus();} });
    document.getElementById('djt-hist-clear').addEventListener('click', () => { store.scratchHistory=[]; scratchHistIdx=0; saveStore(); refreshScratchHistUI(); });

    // Feature toggles
    ['saveRegens','stats','nexus','scratchpad','autoRefresh','deleteThinking'].forEach(key => {
      const cb=document.getElementById('djt-t-'+key); if(!cb) return;
      cb.addEventListener('change', () => { settings[key]=cb.checked; saveSettings(); applyVisibility(); refreshStatsUI(); refreshRegenPanel(); refreshThinkingButtons(); });
    });

    // Advanced section
    document.getElementById('djt-advanced-toggle').addEventListener('click', function() {
      const b=document.getElementById('djt-advanced-body'); const o=b.style.display==='none';
      b.style.display=o?'':'none'; this.textContent=(o?'▾':'▸')+' Advanced';
    });
    document.getElementById('djt-surprise-btn').addEventListener('click', bloomBlossoms);

    // Theme (skin) selector
    [...document.querySelectorAll('.djt-theme-opt')].forEach(btn => {
      btn.addEventListener('click', () => {
        settings.skin = btn.dataset.skin; saveSettings(); setSkin(settings.skin);
      });
    });

    // Draggable + resizable + restore saved position/size
    initDrag(p);
    initResize(p);
    if (settings.panelSize && settings.panelSize.width) {
      p.style.width = settings.panelSize.width;
      const body = document.getElementById('djt-body');
      if (body && settings.panelSize.bodyHeight) { body.style.height = settings.panelSize.bodyHeight; body.style.maxHeight = settings.panelSize.bodyHeight; }
    }
    if (settings.panelPos && settings.panelPos.left) {
      p.style.right = 'auto';
      p.style.left = settings.panelPos.left;
      p.style.top  = settings.panelPos.top;
      requestAnimationFrame(() => clampPanelIntoView(p));
    }
  }

  // ---- TABS --------------------------------------------------
  function switchTab(tab, noSave) {
    const t = tab || 'chat';
    if (!noSave) { settings.activeTab = t; saveSettings(); }
    const chatPane    = document.getElementById('djt-tab-chat');
    const creatorPane = document.getElementById('djt-tab-creator');
    if (chatPane)    chatPane.style.display    = t === 'chat'    ? '' : 'none';
    if (creatorPane) creatorPane.style.display = t === 'creator' ? '' : 'none';
    [...document.querySelectorAll('#djt-tabs .djt-tab')].forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === t);
    });
  }

  // ---- CARD COLLAPSE -----------------------------------------
  function toggleCard(key) {
    if (!settings.cardCollapsed || typeof settings.cardCollapsed !== 'object') settings.cardCollapsed = {};
    settings.cardCollapsed[key] = !settings.cardCollapsed[key];
    saveSettings();
    applyCardCollapse(key);
  }
  function applyCardCollapse(key) {
    const h = document.querySelector(`.djt-card-h-btn[data-djt-key="${key}"]`);
    if (!h) return;
    const card = h.closest('.djt-card');
    if (!card) return;
    const collapsed = !!(settings.cardCollapsed && settings.cardCollapsed[key]);
    card.classList.toggle('djt-card-collapsed', collapsed);
    const arrow = h.querySelector('.djt-card-arrow');
    if (arrow) arrow.textContent = collapsed ? '▸' : '▾';
  }
  function applyAllCardCollapses() {
    ['stats','regen','scratch','features','bottools','lorebook','toolpages'].forEach(applyCardCollapse);
  }

  function syncToggleStates() {
    ['saveRegens','stats','nexus','scratchpad','autoRefresh','deleteThinking'].forEach(key => {
      const cb=document.getElementById('djt-t-'+key); if(cb) cb.checked=settings[key]!==false;
    });
  }
  function applyVisibility() {
    const statsCard=document.getElementById('djt-stats-card'); if(statsCard)statsCard.style.display=settings.stats?'':'none';
    const nexusSec=document.getElementById('djt-nexus-section'); if(nexusSec)nexusSec.style.display=(settings.stats&&settings.nexus)?'':'none';
    const scratchCard=document.getElementById('djt-scratch-card'); if(scratchCard)scratchCard.style.display=settings.scratchpad?'':'none';
    if(!settings.saveRegens){const regen=document.getElementById('djt-regen');if(regen)regen.style.display='none';}
  }

  // ---- BOT EXPORT / IMPORT (bot create & edit pages) ---------
  // Bridge lives in the page's MAIN world (dj-bridge.js) so it can reach
  // react-hook-form. We talk to it over window.postMessage.
  let bridgeInjected = false;
  const bridgePending = {};
  let bridgeReqId = 0;
  let botAutosaveTimer = null;
  let botBackupMeta = null; // {ts, botId}
  let botMode = false;

  function injectBotBridge() {
    if (bridgeInjected) return;
    bridgeInjected = true;
    try {
      const s = document.createElement('script');
      s.src = chrome.runtime.getURL('dj-bridge.js');
      s.onload = () => s.remove();
      (document.head || document.documentElement).appendChild(s);
    } catch (e) { bridgeInjected = false; }
  }

  window.addEventListener('message', ev => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.source !== 'djt-bridge') return;
    if (d.ready) return;
    const cb = bridgePending[d.reqId];
    if (cb) { delete bridgePending[d.reqId]; cb(d.result); }
  });

  function bridgeRequest(action, payload) {
    return new Promise(resolve => {
      injectBotBridge();
      const reqId = ++bridgeReqId;
      bridgePending[reqId] = resolve;
      // Give the freshly-injected bridge a beat to register its listener.
      const send = () => window.postMessage({ source: 'djt-cs', action, payload, reqId }, '*');
      send(); setTimeout(send, 120);
      setTimeout(() => { if (bridgePending[reqId]) { delete bridgePending[reqId]; resolve({ error: 'timeout' }); } }, 2500);
    });
  }

  // Guard used by both buttons: ensures we're on a usable Legacy bot form.
  async function botGuard() {
    if (!isBotPage()) { toast('Open a bot creation or edit page first.'); return null; }
    const det = await bridgeRequest('detect');
    if (!det || det.error) { toast('Could not reach the bot form. Reload the page.'); return null; }
    if (!det.hasForm || !det.legacyReady) { openLegacyPrompt(); return null; }
    return det;
  }

  function openLegacyPrompt() {
    if (document.getElementById('djt-lb-overlay')) return;
    const ov = document.createElement('div'); ov.id = 'djt-lb-overlay';
    ov.setAttribute('data-djt-theme', settings.theme || 'dark'); ov.setAttribute('data-djt-skin', settings.skin || 'dreamjourney');
    ov.innerHTML =
      `<div class="djt-lb-modal">` +
        `<div class="djt-lb-head"><span class="djt-lb-title">⚠️ Switch to Legacy</span>` +
          `<button class="djt-lb-x" id="djt-bot-x" title="Close">✕</button></div>` +
        `<div class="djt-lb-body">` +
          `<div class="djt-lb-msg" style="display:block;font-size:13px;line-height:1.6">` +
            `Bot export &amp; import only work in <b>Legacy</b> mode, where every field is on one page.<br><br>` +
            `Flip the <b>Legacy / Modern</b> toggle at the top-right of the bot page to <b>Legacy</b>, then try again.` +
          `</div>` +
          `<div class="djt-lb-row"><button class="djt-mini-btn primary" id="djt-bot-ok">Got it</button></div>` +
        `</div>` +
      `</div>`;
    document.body.appendChild(ov);
    const close = () => ov.remove();
    document.getElementById('djt-bot-x').addEventListener('click', close);
    document.getElementById('djt-bot-ok').addEventListener('click', close);
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
  }

  function botEnvelope(bot) {
    return JSON.stringify({
      _type: 'dreamjourney-bot',
      _toolkit: "Sunny's DJ Toolkit V2.1",
      _exportedAt: new Date().toISOString(),
      bot
    }, null, 2);
  }

  async function openBotExport() {
    const det = await botGuard(); if (!det) return;
    const res = await bridgeRequest('export');
    if (!res || res.error || !res.bot) { toast('Export failed: ' + (res && res.error || 'no data')); return; }
    const json = botEnvelope(res.bot);
    const name = (res.bot.name || 'bot').replace(/[^\w\-]+/g, '_').slice(0, 40) || 'bot';
    if (document.getElementById('djt-lb-overlay')) document.getElementById('djt-lb-overlay').remove();
    const ov = document.createElement('div'); ov.id = 'djt-lb-overlay';
    ov.setAttribute('data-djt-theme', settings.theme || 'dark'); ov.setAttribute('data-djt-skin', settings.skin || 'dreamjourney');
    ov.innerHTML =
      `<div class="djt-lb-modal">` +
        `<div class="djt-lb-head"><span class="djt-lb-title">📤 Export bot</span>` +
          `<button class="djt-lb-x" id="djt-bot-x" title="Close">✕</button></div>` +
        `<div class="djt-lb-body">` +
          `<div class="djt-lb-step">A complete copy of this bot, including dropdowns &amp; toggles.</div>` +
          `<textarea id="djt-bot-ta" class="djt-lb-ta mono" readonly></textarea>` +
          `<div class="djt-lb-row">` +
            `<button class="djt-mini-btn primary" id="djt-bot-copy">Copy</button>` +
            `<button class="djt-mini-btn" id="djt-bot-dl">Download .json</button>` +
            `<button class="djt-mini-btn" id="djt-bot-close2">Close</button>` +
          `</div>` +
          `<div id="djt-bot-status" class="djt-lb-msg"></div>` +
        `</div>` +
      `</div>`;
    document.body.appendChild(ov);
    document.getElementById('djt-bot-ta').value = json;
    const close = () => ov.remove();
    document.getElementById('djt-bot-x').addEventListener('click', close);
    document.getElementById('djt-bot-close2').addEventListener('click', close);
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
    const stat = m => { const s = document.getElementById('djt-bot-status'); if (s) { s.style.display = 'block'; s.textContent = m; } };
    document.getElementById('djt-bot-copy').addEventListener('click', () => {
      navigator.clipboard.writeText(json).then(() => stat('Copied to clipboard.'), () => stat('Copy failed.'));
    });
    document.getElementById('djt-bot-dl').addEventListener('click', () => {
      try {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'djt-bot-' + name + '.json';
        a.click(); URL.revokeObjectURL(url); stat('Downloaded djt-bot-' + name + '.json');
      } catch (e) { stat('Download failed.'); }
    });
  }

  async function openBotImport() {
    const det = await botGuard(); if (!det) return;
    if (document.getElementById('djt-lb-overlay')) document.getElementById('djt-lb-overlay').remove();
    const ov = document.createElement('div'); ov.id = 'djt-lb-overlay';
    ov.setAttribute('data-djt-theme', settings.theme || 'dark'); ov.setAttribute('data-djt-skin', settings.skin || 'dreamjourney');
    ov.innerHTML =
      `<div class="djt-lb-modal">` +
        `<div class="djt-lb-head"><span class="djt-lb-title">📥 Import bot</span>` +
          `<button class="djt-lb-x" id="djt-bot-x" title="Close">✕</button></div>` +
        `<div class="djt-lb-body">` +
          `<div class="djt-lb-step">Paste a bot file (or pick one) to fill this page's fields.</div>` +
          `<input type="file" id="djt-bot-file" accept="application/json,.json" style="margin-bottom:8px;font-size:12px;color:var(--lb-soft)">` +
          `<textarea id="djt-bot-ta" class="djt-lb-ta mono" placeholder="Paste exported bot JSON here..."></textarea>` +
          `<div class="djt-lb-row">` +
            `<button class="djt-mini-btn primary" id="djt-bot-apply">Populate bot</button>` +
            `<button class="djt-mini-btn" id="djt-bot-close2">Cancel</button>` +
          `</div>` +
          `<div id="djt-bot-status" class="djt-lb-msg"></div>` +
        `</div>` +
      `</div>`;
    document.body.appendChild(ov);
    const close = () => ov.remove();
    document.getElementById('djt-bot-x').addEventListener('click', close);
    document.getElementById('djt-bot-close2').addEventListener('click', close);
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
    const stat = (m, err) => { const s = document.getElementById('djt-bot-status'); if (s) { s.style.display = 'block'; s.textContent = m; s.style.color = err ? 'var(--lb-red)' : ''; } };
    document.getElementById('djt-bot-file').addEventListener('change', e => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      const r = new FileReader(); r.onload = () => { document.getElementById('djt-bot-ta').value = r.result; stat('Loaded ' + f.name + '. Click Populate bot.'); }; r.readAsText(f);
    });
    document.getElementById('djt-bot-apply').addEventListener('click', async () => {
      const raw = document.getElementById('djt-bot-ta').value.trim();
      if (!raw) { stat('Paste a bot file first.', true); return; }
      let parsed; try { parsed = JSON.parse(raw); } catch (e) { stat('Invalid JSON: ' + e.message, true); return; }
      const bot = (parsed && parsed.bot && typeof parsed.bot === 'object') ? parsed.bot : parsed;
      if (!bot || typeof bot !== 'object' || (!bot.name && !bot.instructions && !bot.description)) {
        stat('That does not look like a bot export.', true); return;
      }
      stat('Populating...');
      const res = await bridgeRequest('import', bot);
      if (!res || res.error) { stat('Import failed: ' + (res && res.error || 'unknown'), true); return; }
      const n = (res.applied || []).length;
      const hasImg = bot.img_link ? ' The image link was set; if the page still asks for an image, re-pick it manually.' : '';
      stat('✓ Filled ' + n + ' field' + (n === 1 ? '' : 's') + '.' + hasImg);
      toast('Bot fields populated (' + n + ').');
    });
  }

  // Rolling local backup while editing, so work is never lost mid-create.
  function startBotAutosave() {
    stopBotAutosave();
    const tick = async () => {
      if (!isBotPage()) return;
      const det = await bridgeRequest('detect');
      if (!det || !det.hasForm || !det.legacyReady) { updateBotStatus('legacy'); return; }
      const res = await bridgeRequest('export');
      if (res && res.bot) {
        const botId = botIdFromUrl();
        botBackupMeta = { ts: Date.now(), botId };
        try { chrome.storage.local.set({ ['djt:botbackup:' + botId]: { ts: botBackupMeta.ts, bot: res.bot } }); } catch (e) {}
        updateBotStatus('ok');
      }
    };
    tick();
    botAutosaveTimer = setInterval(tick, 5000);
  }
  function stopBotAutosave() { if (botAutosaveTimer) { clearInterval(botAutosaveTimer); botAutosaveTimer = null; } }

  function updateBotStatus(state) {
    const el = document.getElementById('djt-bot-status-line'); if (!el) return;
    if (state === 'legacy') { el.textContent = 'Switch to Legacy mode to back up.'; el.style.color = 'var(--djt-orange)'; }
    else if (state === 'ok' && botBackupMeta) {
      const t = new Date(botBackupMeta.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      el.textContent = 'Backed up locally ✓ ' + t; el.style.color = 'var(--djt-green)';
    } else if (state === 'offpage') { el.textContent = 'Open a bot page to auto-back-up.'; el.style.color = 'var(--djt-muted)'; }
  }

  // ---- DATA MANAGER (view & clear saved data) ----------------
  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  }

  // ---- LIFECYCLE --------------------------------------------
  async function activate(sid) {
    currentSessionId=sid; active=true; hasScrolledToTop=false;
    await loadAll();
    const c=await waitFor(()=>document.querySelector('.scrollchatmessages'),20000,250);
    if(!active||currentSessionId!==sid) return; if(!c) return;
    buildPanel(); setTheme(settings.theme); setSkin(settings.skin); syncToggleStates(); applyVisibility();
    switchTab(settings.activeTab); applyAllCardCollapses();
    startContainerObserver(); hookScratchpad();
    refreshStatsUI(); refreshRegenPanel(); refreshThinkingButtons(); maybeOfferRestore(); maybeStartScanner();
    if(!scratchpadInterval) scratchpadInterval=setInterval(()=>{ if(active){
      // Re-attach the observer if DreamJourney replaced the chat container
      // (hard-refresh hydration recovery, React #418/#422, swaps the .scrollchatmessages
      // node out from under us, orphaning the observer and freezing the stats).
      const c=getContainer();
      if(c&&c!==observedContainer) startContainerObserver();
      // Self-heal the stats: the initial post-load count can run before bot avatars
      // render (counts everything as user → N/0/N). Recompute periodically so it corrects.
      refreshStatsUI();
      hookScratchpad();refreshThinkingButtons();if(scanActive)runChatScan();
    } },3000);
  }
  // Bot create/edit pages: build the panel (Creator tab) without chat wiring.
  async function activateBotMode() {
    active=true; botMode=true; currentSessionId=null;
    await loadAll();
    if(!isBotPage()) return;
    await waitFor(()=>document.querySelector('input[name="name"]')||document.querySelector('main'),15000,250);
    if(!isBotPage()) return;
    buildPanel(); setTheme(settings.theme); setSkin(settings.skin); syncToggleStates(); applyVisibility();
    switchTab('creator', true); applyAllCardCollapses();
    injectBotBridge(); startBotAutosave();
  }
  function deactivate() {
    active=false; botMode=false; stopBotAutosave();
    hasScrolledToTop=false;
    if(containerObserver){containerObserver.disconnect();containerObserver=null;}
    observedContainer=null;
    if(scratchpadInterval){clearInterval(scratchpadInterval);scratchpadInterval=null;}
    clearTimeout(statsDebounce); clearTimeout(thinkingDebounce); clearTimeout(panelUpdateTo); clearTimeout(panelDebounce);
    const p=document.getElementById('djt-panel');if(p)p.remove(); hideRestoreBar();
    const lbov=document.getElementById('djt-lb-overlay');if(lbov)lbov.remove();
    panelActive=false;
    scanActive=false; clearChatScan(); clearTimeout(scanDebounce);
    const rt=document.getElementById('djt-refresh-toast');if(rt)rt.remove();
    const ex=[...document.querySelectorAll('.djt-del-thinking')];if(ex.length){djtMutating=true;ex.forEach(b=>b.remove());djtMutating=false;}
    expectingReply=false;regenPending=false;regenTargetIdx=-1;regenAnchorUserId=null;previewIndex=null;currentSessionId=null;
  }
  function onRouteChange(){
    if(isSessionUrl()){const sid=sessionIdFromUrl();if(sid&&sid===currentSessionId&&active&&!botMode)return;if(active)deactivate();activate(sid);return;}
    if(isBotPage()){if(active&&botMode){updateBotStatus('ok');return;}if(active)deactivate();activateBotMode();return;}
    if(active)deactivate();
  }
  function setupRouteWatcher(){
    const fire=()=>{try{onRouteChange();}catch(e){}};
    const wrap=orig=>function(){const r=orig.apply(this,arguments);fire();return r;};
    try{history.pushState=wrap(history.pushState);}catch(e){}
    try{history.replaceState=wrap(history.replaceState);}catch(e){}
    window.addEventListener('popstate',fire);
    let last=location.href; setInterval(()=>{if(location.href!==last){last=location.href;fire();}},500);
  }

  // Esc closes any open toolkit modal. For the simple removable overlays we
  // just remove them; for the confirm dialog we click its Cancel so the
  // awaiting promise resolves cleanly.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const lb = document.getElementById('djt-lb-overlay');
    if (lb) { lb.remove(); return; }
    const cm = document.querySelector('.djt-modal-overlay');
    if (cm) { const cancel = cm.querySelector('[data-v="cancel"]'); if (cancel) cancel.click(); else cm.remove(); }
  });

  // Live-apply settings changed from the Settings Window popup (themes now;
  // visibility/quill consumed in later stages). Only pull the fields the popup
  // owns so we never clobber in-memory panelPos/size/collapse state.
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[SETTINGS_KEY]) return;
      const nv = changes[SETTINGS_KEY].newValue; if (!nv) return;
      if (typeof nv.skin === 'string') settings.skin = nv.skin;
      if (typeof nv.theme === 'string') settings.theme = nv.theme;
      if (nv.hidden && typeof nv.hidden === 'object') settings.hidden = nv.hidden;
      if (nv.quill && typeof nv.quill === 'object') settings.quill = Object.assign({}, DEFAULT_SETTINGS.quill, nv.quill);
      if (document.getElementById('djt-panel')) { setSkin(settings.skin); setTheme(settings.theme); }
    });
  } catch (e) {}

  setupDelegation(); setupRouteWatcher(); onRouteChange();
})();
