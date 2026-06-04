// Sunny's Dreamjourney Toolkit V2 - Settings Window
// Made by SunflowerS at Dreamjourney AI
'use strict';

var SETTINGS_KEY = 'djt:settings';
var QUILL_DEFAULTS = {
  enabled: false, ack: false, backend: 'ollama',
  ollamaUrl: 'http://localhost:11434', ollamaModel: '',
  lmstudioUrl: 'http://localhost:1234', lmstudioModel: '',
  koboldUrl: 'http://localhost:5001',
  openaiBaseUrl: 'https://api.openai.com/v1', openaiModel: 'gpt-4o-mini', apiKey: ''
};

// Mirrors HIDEABLE in content.js (+ the two tab toggles). key -> settings.hidden[key].
var VIS_SECTIONS = [
  { key:'tab:chat',     label:'Chat Tools tab',         group:'Tabs' },
  { key:'tab:creator',  label:'Creator Tools tab',      group:'Tabs' },
  { key:'stats',        label:'Session stats',          group:'Chat Tools' },
  { key:'scratch',      label:'User Input Recovery',    group:'Chat Tools' },
  { key:'features',     label:'Feature toggles',        group:'Chat Tools' },
  { key:'download',     label:'Download & scroll buttons', group:'Chat Tools' },
  { key:'quillchat',    label:'Quill (Chat)',           group:'Chat Tools' },
  { key:'bottools',     label:'Bot Tools',              group:'Creator Tools' },
  { key:'lorebook',     label:'Lorebook Tools',         group:'Creator Tools' },
  { key:'toolpages',    label:'Tool Pages',             group:'Creator Tools' },
  { key:'quillcreator', label:'Quill (Character Lens)', group:'Creator Tools' }
];

var settings = null;
function $(id) { return document.getElementById(id); }
function setStatus(msg) {
  var el = $('status'); if (!el) return;
  el.textContent = msg; setTimeout(function () { if (el.textContent === msg) el.textContent = ''; }, 2400);
}

// ---- load ----
function load() {
  chrome.storage.local.get([SETTINGS_KEY], function (data) {
    settings = (data && data[SETTINGS_KEY]) || {};
    settings.quill = Object.assign({}, QUILL_DEFAULTS, settings.quill || {});
    if (!settings.hidden || typeof settings.hidden !== 'object') settings.hidden = {};
    if (!settings.skin) settings.skin = 'dreamjourney';
    if (!settings.theme) settings.theme = 'dark';
    render();
  });
}

function render() {
  // appearance
  segSelect('skin-seg', 'skin', settings.skin);
  segSelect('mode-seg', 'mode', settings.theme);
  renderVisibility();
  // quill guide + acknowledgement gate
  var gl = $('guide-link'); if (gl) { try { gl.href = chrome.runtime.getURL('quill-guide.html'); } catch (e) {} }
  $('q-ack').checked = !!settings.quill.ack;
  applyGate();
  if (settings.quill.ack) {
    $('adv-body').classList.remove('collapsed');
    $('adv-toggle').innerHTML = '▾ Advanced · <span class="quill-name">Quill</span> connection';
  }
  // quill
  $('q-enabled').checked = !!settings.quill.enabled;
  $('q-backend').value = settings.quill.backend || 'ollama';
  $('q-ollamaUrl').value = settings.quill.ollamaUrl || '';
  $('q-lmstudioUrl').value = settings.quill.lmstudioUrl || '';
  $('q-koboldUrl').value = settings.quill.koboldUrl || '';
  $('q-openaiBaseUrl').value = settings.quill.openaiBaseUrl || '';
  $('q-openaiModel').value = settings.quill.openaiModel || '';
  $('q-apiKey').value = settings.quill.apiKey || '';
  setModelOption('q-ollamaModel', settings.quill.ollamaModel);
  setModelOption('q-lmstudioModel', settings.quill.lmstudioModel);
  showBackendFields($('q-backend').value);
  toggleQuillConfig();
}

// "Panel sections" list: a switch per section, ON = visible. Saves live so
// the on-page panel updates immediately while the user tweaks.
function renderVisibility() {
  var list = $('vis-list'); if (!list) return;
  list.innerHTML = '';
  var lastGroup = null;
  VIS_SECTIONS.forEach(function (s) {
    if (s.group !== lastGroup) {
      var g = document.createElement('div'); g.className = 'vis-group'; g.textContent = s.group;
      list.appendChild(g); lastGroup = s.group;
    }
    var row = document.createElement('div'); row.className = 'vis-row';
    var span = document.createElement('span'); span.textContent = s.label;
    var lab = document.createElement('label'); lab.className = 'switch';
    var cb = document.createElement('input'); cb.type = 'checkbox';
    cb.checked = !settings.hidden[s.key];           // checked = shown
    cb.addEventListener('change', function () {
      if (cb.checked) delete settings.hidden[s.key];
      else settings.hidden[s.key] = true;
      guardLastTab();
      chrome.storage.local.set(makeWrite());        // persist + live-apply
      // reflect any guard correction back into the toggles
      renderVisibility();
    });
    var sl = document.createElement('span'); sl.className = 'slider';
    lab.appendChild(cb); lab.appendChild(sl);
    row.appendChild(span); row.appendChild(lab);
    list.appendChild(row);
  });
}
// Never let BOTH tabs be hidden — re-show whichever the user just hid second.
function guardLastTab() {
  if (settings.hidden['tab:chat'] && settings.hidden['tab:creator']) {
    delete settings.hidden['tab:creator'];
  }
}

function setModelOption(selId, val) {
  var sel = $(selId); if (!sel) return;
  if (val && !Array.prototype.some.call(sel.options, function (o) { return o.value === val; })) {
    var o = document.createElement('option'); o.value = val; o.textContent = val; sel.appendChild(o);
  }
  if (val) sel.value = val;
}

// ---- segmented controls ----
function segSelect(segId, kind, current) {
  var seg = $(segId); if (!seg) return;
  [].forEach.call(seg.querySelectorAll('button'), function (b) {
    var v = b.dataset.skin || b.dataset.mode;
    b.classList.toggle('on', v === current);
  });
}
function wireSeg(segId, attr, key) {
  var seg = $(segId); if (!seg) return;
  seg.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    settings[key] = b.dataset[attr];
    segSelect(segId, attr, settings[key]);
  });
}

// ---- backend field visibility ----
function showBackendFields(backend) {
  [].forEach.call(document.querySelectorAll('.q-fields'), function (el) {
    var fors = (el.dataset.for || '').split(/\s+/);
    el.classList.toggle('collapsed', fors.indexOf(backend) === -1);
  });
}
function toggleQuillConfig() {
  $('q-config').style.opacity = $('q-enabled').checked ? '1' : '0.45';
}
function applyGate() {
  var g = $('q-gate'); if (g) g.classList.toggle('on', $('q-ack').checked);
}

// ---- gather current form into a quill cfg ----
function gatherQuill() {
  return {
    enabled: $('q-enabled').checked,
    ack: $('q-ack').checked,
    backend: $('q-backend').value,
    ollamaUrl: $('q-ollamaUrl').value.trim(),
    ollamaModel: $('q-ollamaModel').value,
    lmstudioUrl: $('q-lmstudioUrl').value.trim(),
    lmstudioModel: $('q-lmstudioModel').value,
    koboldUrl: $('q-koboldUrl').value.trim(),
    openaiBaseUrl: $('q-openaiBaseUrl').value.trim(),
    openaiModel: $('q-openaiModel').value.trim(),
    apiKey: $('q-apiKey').value
  };
}

// Which origin a cfg will hit (for optional-permission requests on non-localhost API).
function originFor(cfg) {
  var url = '';
  if (cfg.backend === 'openai' || cfg.backend === 'api') url = cfg.openaiBaseUrl;
  else return null; // local backends covered by manifest host_permissions
  try { var u = new URL(url); return u.protocol + '//' + u.host + '/*'; } catch (e) { return null; }
}
function ensurePermission(cfg) {
  return new Promise(function (resolve) {
    var origin = originFor(cfg);
    if (!origin) return resolve(true);
    chrome.permissions.contains({ origins: [origin] }, function (has) {
      if (has) return resolve(true);
      chrome.permissions.request({ origins: [origin] }, function (granted) { resolve(!!granted); });
    });
  });
}

// ---- test connection ----
function testConn() {
  var cfg = gatherQuill();
  var line = $('q-testline');
  line.className = 'testline busy'; line.textContent = 'Testing ' + cfg.backend + '…';
  ensurePermission(cfg).then(function (ok) {
    if (!ok) { line.className = 'testline bad'; line.textContent = 'Permission to reach that host was denied.'; return; }
    chrome.runtime.sendMessage({ type: 'quill.test', cfg: cfg }, function (res) {
      if (chrome.runtime.lastError) { line.className = 'testline bad'; line.textContent = chrome.runtime.lastError.message; return; }
      if (!res || !res.ok) {
        line.className = 'testline bad';
        line.textContent = 'Failed: ' + ((res && res.error) || 'no response') + '  (is the server running / CORS allowed?)';
        return;
      }
      line.className = 'testline ok';
      line.textContent = 'Connected. ' + (res.models && res.models.length ? res.models.length + ' model(s) found.' : 'Model: ' + res.model);
      if (res.models && res.models.length) {
        if (cfg.backend === 'ollama') fillModels('q-ollamaModel', res.models, cfg.ollamaModel);
        if (cfg.backend === 'lmstudio') fillModels('q-lmstudioModel', res.models, cfg.lmstudioModel);
      }
    });
  });
}
function fillModels(selId, models, current) {
  var sel = $(selId); if (!sel) return;
  sel.innerHTML = '';
  models.forEach(function (m) {
    var o = document.createElement('option'); o.value = m; o.textContent = m; sel.appendChild(o);
  });
  if (current && models.indexOf(current) !== -1) sel.value = current;
}

// ---- save ----
function save() {
  settings.quill = gatherQuill();
  ensurePermission(settings.quill).then(function (ok) {
    if (!ok) { setStatus('Saved (host permission denied — Quill API calls will fail).'); }
    chrome.storage.local.set(makeWrite(), function () {
      if (chrome.runtime.lastError) { setStatus('Save error: ' + chrome.runtime.lastError.message); return; }
      if (ok) setStatus('Saved.');
    });
  });
}
function makeWrite() {
  var out = {}; out[SETTINGS_KEY] = settings; return out;
}

// ---- wire up ----
document.addEventListener('DOMContentLoaded', function () {
  load();
  wireSeg('skin-seg', 'skin', 'skin');
  wireSeg('mode-seg', 'mode', 'theme');
  $('adv-toggle').addEventListener('click', function () {
    var b = $('adv-body'); var wasCollapsed = b.classList.contains('collapsed');
    b.classList.toggle('collapsed', !wasCollapsed);
    this.innerHTML = (wasCollapsed ? '▾' : '▸') + ' Advanced · <span class="quill-name">Quill</span> connection';
  });
  $('q-ack').addEventListener('change', function () {
    applyGate();
    settings.quill = gatherQuill();
    chrome.storage.local.set(makeWrite());  // persist the acknowledgement immediately
  });
  $('q-enabled').addEventListener('change', toggleQuillConfig);
  $('q-backend').addEventListener('change', function () { showBackendFields(this.value); });
  $('q-test').addEventListener('click', testConn);
  $('save-btn').addEventListener('click', save);
});
