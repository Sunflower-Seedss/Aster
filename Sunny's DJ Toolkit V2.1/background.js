// ============================================================
//  Sunny's Dreamjourney Toolkit V2 - background service worker
//  Made by SunflowerS at Dreamjourney AI
//
//  Sole purpose right now: be the network boundary for "Quill".
//  DreamJourney is HTTPS; a local LLM is usually http://localhost, so a
//  fetch from the content script (page context) is blocked as mixed
//  content. Running the fetch here, in the service worker, avoids the
//  page's mixed-content policy and CORS, provided we hold host
//  permission for the target (localhost is granted in the manifest;
//  arbitrary API hosts are requested as optional permissions from the
//  popup on a user gesture).
//
//  Message contract (content.js / popup.js -> here):
//    { type: 'quill.test',   cfg }                  -> { ok, model?, error? }
//    { type: 'quill.models', cfg }                  -> { ok, models:[...], error? }
//    { type: 'quill.chat',   cfg, messages, opts }  -> { ok, text, error? }
//  where cfg is settings.quill and messages is [{role, content}, ...].
// ============================================================
'use strict';

// ---- per-backend endpoint resolution -----------------------
function endpoints(cfg) {
  const b = (cfg && cfg.backend) || 'ollama';
  switch (b) {
    case 'ollama':
      return {
        kind: 'ollama',
        base: (cfg.ollamaUrl || 'http://localhost:11434').replace(/\/+$/, ''),
        model: cfg.ollamaModel || '',
        key: ''
      };
    case 'lmstudio':
      return {
        kind: 'openai',
        base: (cfg.lmstudioUrl || 'http://localhost:1234').replace(/\/+$/, '') + '/v1',
        model: cfg.lmstudioModel || 'local-model',
        key: ''
      };
    case 'kobold':
      return {
        kind: 'openai',
        base: (cfg.koboldUrl || 'http://localhost:5001').replace(/\/+$/, '') + '/v1',
        model: 'koboldcpp',
        key: ''
      };
    case 'openai':
    case 'api':
      return {
        kind: 'openai',
        base: (cfg.openaiBaseUrl || 'https://api.openai.com/v1').replace(/\/+$/, ''),
        model: cfg.openaiModel || 'gpt-4o-mini',
        key: cfg.apiKey || ''
      };
    default:
      return { kind: 'ollama', base: 'http://localhost:11434', model: '', key: '' };
  }
}

function authHeaders(ep) {
  const h = { 'Content-Type': 'application/json' };
  if (ep.key) h['Authorization'] = 'Bearer ' + ep.key;
  return h;
}

// ---- list models -------------------------------------------
async function listModels(cfg) {
  const ep = endpoints(cfg);
  try {
    if (ep.kind === 'ollama') {
      const r = await fetch(ep.base + '/api/tags');
      if (!r.ok) return { ok: false, error: 'HTTP ' + r.status };
      const j = await r.json();
      return { ok: true, models: (j.models || []).map(m => m.name) };
    } else {
      const r = await fetch(ep.base + '/models', { headers: authHeaders(ep) });
      if (!r.ok) return { ok: false, error: 'HTTP ' + r.status };
      const j = await r.json();
      return { ok: true, models: (j.data || []).map(m => m.id) };
    }
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

// ---- connection test ---------------------------------------
async function testConn(cfg) {
  const ep = endpoints(cfg);
  try {
    if (ep.kind === 'ollama') {
      const r = await fetch(ep.base + '/api/tags');
      if (!r.ok) return { ok: false, error: 'HTTP ' + r.status + ' from ' + ep.base };
      const j = await r.json();
      const names = (j.models || []).map(m => m.name);
      return { ok: true, model: ep.model || names[0] || '(no model selected)', models: names };
    } else {
      const r = await fetch(ep.base + '/models', { headers: authHeaders(ep) });
      if (!r.ok) return { ok: false, error: 'HTTP ' + r.status + ' from ' + ep.base };
      const j = await r.json();
      const names = (j.data || []).map(m => m.id);
      return { ok: true, model: ep.model || names[0] || '(no model selected)', models: names };
    }
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

// ---- chat completion ---------------------------------------
async function chat(cfg, messages, opts) {
  const ep = endpoints(cfg);
  opts = opts || {};
  if (!Array.isArray(messages) || !messages.length) return { ok: false, error: 'No messages.' };
  try {
    if (ep.kind === 'ollama') {
      if (!ep.model) return { ok: false, error: 'No Ollama model selected.' };
      const body = {
        model: ep.model,
        messages,
        stream: false,
        options: {}
      };
      if (typeof opts.temperature === 'number') body.options.temperature = opts.temperature;
      if (typeof opts.maxTokens === 'number') body.options.num_predict = opts.maxTokens;
      const r = await fetch(ep.base + '/api/chat', {
        method: 'POST', headers: authHeaders(ep), body: JSON.stringify(body)
      });
      if (!r.ok) return { ok: false, error: 'HTTP ' + r.status + ': ' + (await safeText(r)) };
      const j = await r.json();
      return { ok: true, text: (j.message && j.message.content) || '' };
    } else {
      const body = { model: ep.model, messages };
      if (typeof opts.temperature === 'number') body.temperature = opts.temperature;
      if (typeof opts.maxTokens === 'number') body.max_tokens = opts.maxTokens;
      const r = await fetch(ep.base + '/chat/completions', {
        method: 'POST', headers: authHeaders(ep), body: JSON.stringify(body)
      });
      if (!r.ok) return { ok: false, error: 'HTTP ' + r.status + ': ' + (await safeText(r)) };
      const j = await r.json();
      const text = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      return { ok: true, text: text || '' };
    }
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

async function safeText(r) {
  try { return (await r.text()).slice(0, 300); } catch (e) { return ''; }
}

// ---- router ------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;
  if (msg.type === 'quill.test')   { testConn(msg.cfg).then(sendResponse); return true; }
  if (msg.type === 'quill.models') { listModels(msg.cfg).then(sendResponse); return true; }
  if (msg.type === 'quill.chat')   { chat(msg.cfg, msg.messages, msg.opts).then(sendResponse); return true; }
  return false;
});
