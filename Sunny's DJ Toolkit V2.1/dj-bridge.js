// Sunny's Dreamjourney Toolkit V2 - Bot bridge (MAIN world)
// Runs in the PAGE's JS context so it can reach React / react-hook-form state.
// The content script (isolated world) talks to it over window.postMessage.
//
// Why this exists: DreamJourney's bot create/edit form is a react-hook-form.
// Its `control._formValues` holds the entire bot model (text fields AND the
// custom dropdowns/toggles: contentWarnings, tags, lorebooks, categoryId,
// visibility, nsfw, ...). Reading that object = a perfect export. Writing via
// the form's own setValue() + trigger() repopulates every field and lets
// DreamJourney autosave it. No DOM scraping or fragile menu-clicking needed.
(function () {
  'use strict';
  if (window.__djtBotBridge) return;
  window.__djtBotBridge = true;

  // Fields that make up "the bot". Volatile / identity / server fields are
  // deliberately excluded so an import never clobbers the draft's identity.
  var BOT_FIELDS = [
    'type', 'name', 'introduction', 'description', 'instructions', 'context',
    'examples', 'initial', 'authorNote', 'authorComment', 'thinkingTemplate',
    'nsfw', 'pinned', 'visibility', 'categoryId', 'contentWarnings', 'tags',
    'lorebooks', 'lorebookIds', 'lorebookid', 'img_link', 'soundid', 'bglink',
    'termsAccepted'
  ];

  function getFiber(el) {
    if (!el) return null;
    var k = Object.keys(el).find(function (k) {
      return k.indexOf('__reactFiber$') === 0 || k.indexOf('__reactInternalInstance$') === 0;
    });
    return k ? el[k] : null;
  }

  // Walk up from the Name input's fiber to the react-hook-form props
  // (which carry control + setValue/getValues/reset/trigger).
  function findForm() {
    var anchor = document.querySelector('input[name="name"]');
    var f = getFiber(anchor), hops = 0;
    while (f && hops < 90) {
      var mp = f.memoizedProps;
      if (mp && mp.control && mp.control._formValues && typeof mp.setValue === 'function') {
        return {
          control: mp.control,
          setValue: mp.setValue,
          getValues: mp.getValues,
          reset: mp.reset,
          trigger: mp.trigger
        };
      }
      f = f.return; hops++;
    }
    return null;
  }

  // Legacy renders every field on one page; Modern only mounts the current
  // wizard step. We treat "all key fields mounted" as the usable state.
  function isLegacyReady() {
    return !!(document.querySelector('textarea[name="context"]') &&
              document.querySelector('textarea[name="authorNote"]') &&
              document.querySelector('input[name="name"]'));
  }

  function onBotPage() {
    return /\/app\/create\/bot\//.test(location.pathname);
  }
  function botIdFromUrl() {
    var m = location.pathname.match(/\/app\/create\/bot\/([^/?#]+)/);
    return m ? m[1] : null;
  }

  function detect() {
    var form = findForm();
    return {
      onBotPage: onBotPage(),
      botId: botIdFromUrl(),
      legacyReady: isLegacyReady(),
      hasForm: !!form
    };
  }

  function doExport() {
    var form = findForm();
    if (!form) return { error: 'form-not-found' };
    var vals = form.getValues ? form.getValues() : form.control._formValues;
    var bot = {};
    BOT_FIELDS.forEach(function (k) {
      if (vals[k] !== undefined) bot[k] = vals[k];
    });
    return { bot: bot };
  }

  function doImport(bot) {
    var form = findForm();
    if (!form) return { error: 'form-not-found' };
    if (!bot || typeof bot !== 'object') return { error: 'bad-payload' };
    var applied = [], skipped = [];
    BOT_FIELDS.forEach(function (k) {
      if (bot[k] === undefined) return;
      try {
        form.setValue(k, bot[k], { shouldDirty: true, shouldTouch: true, shouldValidate: false });
        applied.push(k);
      } catch (e) {
        skipped.push(k);
      }
    });
    try { if (form.trigger) form.trigger(); } catch (e) {}
    return { applied: applied, skipped: skipped };
  }

  function respond(reqId, result) {
    window.postMessage({ source: 'djt-bridge', reqId: reqId, result: result }, '*');
  }

  window.addEventListener('message', function (ev) {
    if (ev.source !== window) return;
    var d = ev.data;
    if (!d || d.source !== 'djt-cs') return;
    var reqId = d.reqId;
    try {
      if (d.action === 'detect') respond(reqId, detect());
      else if (d.action === 'export') respond(reqId, doExport());
      else if (d.action === 'import') respond(reqId, doImport(d.payload));
      else respond(reqId, { error: 'unknown-action' });
    } catch (e) {
      respond(reqId, { error: String(e && e.message || e) });
    }
  });

  // Announce readiness (content script may be waiting).
  window.postMessage({ source: 'djt-bridge', ready: true }, '*');
})();
