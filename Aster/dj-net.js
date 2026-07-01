// Aster - DreamJourney network bridge (MAIN world)
// Runs in the PAGE's JS context so it can wrap the page's own window.fetch.
// The content script (isolated world) can't patch the page's fetch, so this
// helper does it and takes its config over window.postMessage.
//
// Purpose: when the user turns on "Thinking Template Override", replace the
// `thinkingTemplate` field in every outgoing POST /api/chat request with the
// user's own template. The nexus content and everything else are left alone.
//
// Verified on a thinking model: generation = POST /api/chat with a JSON STRING
// body; `thinkingTemplate` is a TOP-LEVEL field; wrapping window.fetch at
// runtime intercepts the real send, and the streamed response is unaffected by
// mutating the request body.
(function () {
  'use strict';
  if (window.__djtNetBridge) return;
  window.__djtNetBridge = true;

  // Config pushed from the content script (both keyed by session id):
  //  thinkingOverrides: { "<sid>": { enabled, template } } — replace thinkingTemplate
  //  exclusions:        { "<sid>": ["<normalized excerpt>", ...] } — drop matching messages
  var cfg = { thinkingOverrides: {}, exclusions: {} };

  window.addEventListener('message', function (ev) {
    if (ev.source !== window) return;
    if (ev.origin !== location.origin) return;   // only accept same-origin (the DJ page) config
    var d = ev.data;
    if (!d || d.source !== 'djt-cs-net') return;
    if (d.type === 'config' && d.config && typeof d.config === 'object') {
      cfg.thinkingOverrides = (d.config.thinkingOverrides && typeof d.config.thinkingOverrides === 'object') ? d.config.thinkingOverrides : {};
      cfg.exclusions = (d.config.exclusions && typeof d.config.exclusions === 'object') ? d.config.exclusions : {};
    }
  });

  // Normalize text for tolerant matching (lowercase; runs of non-alphanumerics
  // collapse to a single space). Lets a user-pasted excerpt match a stored
  // message's raw content despite markdown / smart-quote / whitespace differences.
  function normMatch(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // True only for a SAME-ORIGIN POST to /api/chat (relative "/api/chat" or an
  // absolute URL on this origin), but NOT a hypothetical "/api/chats". Never
  // touch cross-origin requests. The real send uses the relative form.
  function isOwnChatUrl(url) {
    if (typeof url !== 'string' || !url) return false;
    if (!/\/api\/chat(\?|#|$)/.test(url)) return false;
    try { return new URL(url, location.href).origin === location.origin; } catch (e) { return false; }
  }

  var origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      var hasThinking = cfg.thinkingOverrides && Object.keys(cfg.thinkingOverrides).length > 0;
      var hasExclusions = cfg.exclusions && Object.keys(cfg.exclusions).length > 0;
      if ((hasThinking || hasExclusions) && init && typeof init.body === 'string') {
        var url = (typeof input === 'string') ? input
                : (typeof Request !== 'undefined' && input instanceof Request) ? input.url
                : (typeof URL !== 'undefined' && input instanceof URL) ? input.href
                : (input && input.url) || '';
        // The verified send is fetch(stringUrl, {method:'POST', body:'<json>'}).
        if (isOwnChatUrl(url)) {
          var body = JSON.parse(init.body);
          if (body && typeof body === 'object') {
            var mutated = false;
            var sid = body.sessionId;
            // 1. Thinking-template override for THIS session (field must be present).
            var to = (hasThinking && sid && cfg.thinkingOverrides[sid]) ? cfg.thinkingOverrides[sid] : null;
            if (to && to.enabled && to.template && 'thinkingTemplate' in body) {
              body.thinkingTemplate = to.template;
              mutated = true;
            }
            // 2. Per-chat message exclusions: drop any message whose content
            //    contains one of THIS session's hidden excerpts. Leaves the
            //    stored chat untouched; only the outgoing request is trimmed.
            var needles = (hasExclusions && sid && cfg.exclusions[sid]) ? cfg.exclusions[sid] : null;
            if (needles && needles.length && Array.isArray(body.messages)) {
              var matched = {};
              var before = body.messages.length;
              body.messages = body.messages.filter(function (m) {
                var c = (m && typeof m.content === 'string') ? m.content : JSON.stringify(m && m.content);
                var nc = normMatch(c);
                var hit = false;
                for (var i = 0; i < needles.length; i++) {
                  if (needles[i] && nc.indexOf(needles[i]) !== -1) { matched[needles[i]] = true; hit = true; }
                }
                return !hit;
              });
              if (body.messages.length !== before) mutated = true;
              // Report which excerpts were still present (and removed) vs. already
              // gone (scrolled out of the sent window), so the panel can say "all clear".
              var present = [], absent = [];
              for (var j = 0; j < needles.length; j++) { (matched[needles[j]] ? present : absent).push(needles[j]); }
              try { window.postMessage({ source: 'djt-net', type: 'exclusionReport', sessionId: sid, present: present, absent: absent }, location.origin); } catch (e2) {}
            }
            if (mutated) {
              var newInit = {};
              for (var k in init) {
                if (Object.prototype.hasOwnProperty.call(init, k)) newInit[k] = init[k];
              }
              newInit.body = JSON.stringify(body);
              return origFetch.call(this, input, newInit);
            }
          }
        }
      }
    } catch (e) {
      // Any parsing/shape surprise: fall through and send the request untouched.
    }
    return origFetch.call(this, input, init);
  };

  // Tell the content script we're live so it can push the current config
  // (handles the race where config was sent before this script registered).
  window.postMessage({ source: 'djt-net', ready: true }, location.origin);
})();
