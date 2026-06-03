// Sunny's Dreamjourney Toolkit V2 - Lorebook Studio
// Made by SunflowerS at Dreamjourney AI
// External file because extension-page CSP blocks inline <script>.
(function () {
  'use strict';

  // ---- Tabs ----
  var tabs = document.querySelectorAll('.tab');
  tabs.forEach(function (t) {
    t.addEventListener('click', function () {
      tabs.forEach(function (x) { x.classList.remove('active'); });
      document.querySelectorAll('.pane').forEach(function (p) { p.classList.remove('active'); });
      t.classList.add('active');
      document.getElementById('pane-' + t.dataset.pane).classList.add('active');
    });
  });

  // ---- helpers ----
  function setStatus(id, msg, isErr) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.className = 'status' + (isErr ? ' err' : '');
    if (msg) setTimeout(function () { if (el.textContent === msg) el.textContent = ''; }, 3000);
  }
  function parseJSON(text, statusId) {
    try { return JSON.parse(text); }
    catch (e) { setStatus(statusId, 'Invalid JSON: ' + e.message, true); return null; }
  }
  function copyFrom(srcId, statusId) {
    var v = document.getElementById(srcId).value;
    if (!v.trim()) { setStatus(statusId, 'Nothing to copy.', true); return; }
    navigator.clipboard.writeText(v).then(
      function () { setStatus(statusId, 'Copied!'); },
      function () { setStatus(statusId, 'Copy failed.', true); }
    );
  }
  function escapeRegex(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // ============ MERGE ============
  document.getElementById('merge-btn').addEventListener('click', function () {
    var a = parseJSON(document.getElementById('mergeA').value, 'merge-status');
    var b = parseJSON(document.getElementById('mergeB').value, 'merge-status');
    if (!a || !b) return;
    if (!Array.isArray(a.entries)) { setStatus('merge-status', 'Primary has no entries array.', true); return; }
    if (!Array.isArray(b.entries)) { setStatus('merge-status', 'Secondary has no entries array.', true); return; }
    var merged = JSON.parse(JSON.stringify(a));
    merged.entries = a.entries.concat(b.entries);
    document.getElementById('mergeOut').value = JSON.stringify(merged, null, 2);
    setStatus('merge-status', 'Merged ' + a.entries.length + ' + ' + b.entries.length + ' = ' + merged.entries.length + ' entries.');
  });
  document.getElementById('merge-copy').addEventListener('click', function () { copyFrom('mergeOut', 'merge-status'); });

  // ============ WRAP ALL ============
  document.getElementById('wrapall-btn').addEventListener('click', function () {
    var data = parseJSON(document.getElementById('wrapallIn').value, 'wrapall-status');
    if (!data) return;
    if (!Array.isArray(data.entries)) { setStatus('wrapall-status', 'No entries array found.', true); return; }

    var triggers = [];
    data.entries.forEach(function (e) {
      if (!Array.isArray(e.keys)) return;
      e.keys.forEach(function (k) { if (k.keyText && triggers.indexOf(k.keyText) === -1) triggers.push(k.keyText); });
    });
    triggers.sort(function (a, b) { return b.length - a.length; });

    var exempt = document.getElementById('wrapallExempt').value
      .split('\n').map(function (n) { return n.trim().toLowerCase(); }).filter(Boolean);

    var wrapped = 0;
    data.entries.forEach(function (entry) {
      if (typeof entry.description !== 'string') return;
      if (exempt.indexOf(String(entry.name || '').toLowerCase()) !== -1) return;
      var text = entry.description;
      triggers.forEach(function (trigger) {
        var rx = new RegExp('(?<!_)\\b(' + escapeRegex(trigger) + ')\\b(?!_)', 'gi');
        text = text.replace(rx, function (m) { wrapped++; return '_' + m + '_'; });
      });
      entry.description = text;
    });

    document.getElementById('wrapallOut').value = JSON.stringify(data, null, 2);
    setStatus('wrapall-status', 'Wrapped ' + wrapped + ' trigger occurrence(s).');
  });
  document.getElementById('wrapall-copy').addEventListener('click', function () { copyFrom('wrapallOut', 'wrapall-status'); });

  // ============ WRAP TEXT (Cascade Buster) ============
  var bustTriggers = [];
  document.getElementById('bust-extract').addEventListener('click', function () {
    var data = parseJSON(document.getElementById('bustIn').value, 'bust-extract-status');
    if (!data) return;
    if (!Array.isArray(data.entries)) { setStatus('bust-extract-status', 'No entries array found.', true); return; }
    bustTriggers = [];
    data.entries.forEach(function (e) {
      if (!Array.isArray(e.keys)) return;
      e.keys.forEach(function (k) { if (typeof k.keyText === 'string' && k.keyText.trim()) bustTriggers.push(k.keyText); });
    });
    bustTriggers.sort(function (a, b) { return b.length - a.length; });
    document.getElementById('bustTriggers').value = bustTriggers.join('\n');
    setStatus('bust-extract-status', 'Extracted ' + bustTriggers.length + ' triggers.');
  });
  document.getElementById('bust-wrap').addEventListener('click', function () {
    if (!bustTriggers.length) { setStatus('bust-wrap-status', 'Extract triggers first.', true); return; }
    var text = document.getElementById('bustText').value;
    if (!text.trim()) { setStatus('bust-wrap-status', 'Paste some text first.', true); return; }
    bustTriggers.forEach(function (trigger) {
      var rx = new RegExp('(?<![A-Za-z0-9])' + escapeRegex(trigger) + '(?![A-Za-z0-9])', 'gi');
      text = text.replace(rx, function (m) { return '_' + m.replace(/\s+/g, '_') + '_'; });
    });
    document.getElementById('bustOut').value = text;
    setStatus('bust-wrap-status', 'Done.');
  });
  document.getElementById('bust-copy').addEventListener('click', function () { copyFrom('bustOut', 'bust-wrap-status'); });

  // ============ UNWRAP (Recascadanator) ============
  document.getElementById('unwrap-btn').addEventListener('click', function () {
    var data = parseJSON(document.getElementById('unwrapIn').value, 'unwrap-status');
    if (!data) return;
    if (!Array.isArray(data.entries)) { setStatus('unwrap-status', 'No entries array found.', true); return; }
    var count = 0;
    data.entries.forEach(function (entry) {
      if (typeof entry.description !== 'string') return;
      var before = entry.description;
      var text = before.replace(/([A-Za-z0-9])_([A-Za-z0-9])/g, '$1 $2').replace(/_/g, '');
      if (text !== before) count++;
      entry.description = text;
    });
    document.getElementById('unwrapOut').value = JSON.stringify(data, null, 2);
    setStatus('unwrap-status', 'Cleaned ' + count + ' entr' + (count === 1 ? 'y' : 'ies') + '.');
  });
  document.getElementById('unwrap-copy').addEventListener('click', function () { copyFrom('unwrapOut', 'unwrap-status'); });

  // ============ FORMAT CHECKER ============
  document.getElementById('format-btn').addEventListener('click', function () {
    var resultEl = document.getElementById('formatResult');
    var raw = document.getElementById('formatIn').value;
    if (!raw.trim()) { setStatus('format-status', 'Paste a lorebook first.', true); resultEl.innerHTML = ''; return; }

    var data;
    try { data = JSON.parse(raw); }
    catch (e) {
      setStatus('format-status', 'Failed.', true);
      renderFormatResult(['Invalid JSON: ' + e.message + '. Check for a missing comma, bracket, or quotation mark.']);
      return;
    }

    var errors = [];
    var topLevel = ['name', 'thumbnail', 'ispublic', 'entries'];
    topLevel.forEach(function (k) {
      if (!(k in data)) errors.push('Missing top-level field: "' + k + '".');
    });
    if ('name' in data && typeof data.name !== 'string') errors.push('Top-level "name" must be text.');
    if ('ispublic' in data && typeof data.ispublic !== 'boolean') errors.push('Top-level "ispublic" must be true or false.');

    if (!('entries' in data)) {
      // already reported missing
    } else if (!Array.isArray(data.entries)) {
      errors.push('"entries" must be a list.');
    } else if (data.entries.length === 0) {
      errors.push('"entries" is empty. A lorebook needs at least one entry.');
    } else {
      data.entries.forEach(function (entry, i) {
        var label = 'Entry ' + (i + 1) + (entry && typeof entry.name === 'string' && entry.name.trim() ? ' ("' + entry.name + '")' : '');
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
          errors.push(label + ': not a valid entry object.');
          return;
        }
        var required = ['name', 'description', 'type', 'weight', 'pinned', 'hidden', 'keys'];
        required.forEach(function (k) {
          if (!(k in entry)) errors.push(label + ': missing field "' + k + '".');
        });
        if ('name' in entry && typeof entry.name !== 'string') errors.push(label + ': "name" must be text.');
        if ('description' in entry && typeof entry.description !== 'string') errors.push(label + ': "description" must be text.');
        if ('type' in entry && typeof entry.type !== 'string') errors.push(label + ': "type" must be text.');
        if ('weight' in entry && typeof entry.weight !== 'number') errors.push(label + ': "weight" must be a number.');
        if ('pinned' in entry && typeof entry.pinned !== 'boolean') errors.push(label + ': "pinned" must be true or false.');
        if ('hidden' in entry && typeof entry.hidden !== 'boolean') errors.push(label + ': "hidden" must be true or false.');

        if (!('keys' in entry)) {
          // already reported missing
        } else if (!Array.isArray(entry.keys)) {
          errors.push(label + ': "keys" must be a list.');
        } else {
          var validTriggers = 0;
          entry.keys.forEach(function (k, ki) {
            if (typeof k !== 'object' || k === null) { errors.push(label + ': key ' + (ki + 1) + ' is not a valid object.'); return; }
            if (!('keyText' in k)) { errors.push(label + ': key ' + (ki + 1) + ' is missing "keyText".'); return; }
            if (typeof k.keyText !== 'string') { errors.push(label + ': key ' + (ki + 1) + ' "keyText" must be text.'); return; }
            if (k.keyText.trim()) validTriggers++;
          });
          if (validTriggers === 0) errors.push(label + ': has no triggers. Every entry needs at least one keyText.');
        }
      });
    }

    if (errors.length === 0) {
      var n = data.entries.length;
      setStatus('format-status', 'Valid!');
      resultEl.innerHTML = '<div style="background:var(--green-dim);border:1px solid var(--green-bdr);color:var(--green);border-radius:9px;padding:12px 14px;font-size:13px;line-height:1.6">' +
        '✓ <b>Format looks correct.</b> ' + n + ' entr' + (n === 1 ? 'y' : 'ies') + ' checked, all with valid triggers. This should import into DreamJourney without trouble.' +
        '</div>';
    } else {
      setStatus('format-status', 'Found ' + errors.length + ' issue' + (errors.length === 1 ? '' : 's') + '.', true);
      renderFormatResult(errors);
    }
  });

  function renderFormatResult(errors) {
    var resultEl = document.getElementById('formatResult');
    var items = errors.map(function (e) {
      return '<li style="margin-bottom:5px;line-height:1.5">' + e.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</li>';
    }).join('');
    resultEl.innerHTML = '<div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.3);color:var(--red);border-radius:9px;padding:12px 14px;font-size:13px">' +
      '<div style="font-weight:700;margin-bottom:8px">⚠️ ' + errors.length + ' issue' + (errors.length === 1 ? '' : 's') + ' found:</div>' +
      '<ul style="margin:0;padding-left:18px">' + items + '</ul>' +
      '</div>';
  }

})();
