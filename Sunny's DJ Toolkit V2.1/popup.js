// Sunny's Dreamjourney Toolkit V2 - popup
// Made by SunflowerS at Dreamjourney AI

function nexusClass(n) { return n <= 20 ? 'green' : n <= 40 ? 'orange' : 'red'; }
function setStatus(msg) {
  var el = document.getElementById('status');
  if (el) { el.textContent = msg; setTimeout(function () { el.textContent = ''; }, 2200); }
}
function getActiveSessionTab() {
  return new Promise(function (resolve) {
    chrome.tabs.query(
      { url: ['https://www.dreamjourneyai.com/app/session/*', 'https://dreamjourneyai.com/app/session/*'] },
      function (tabs) { resolve(tabs && tabs.length ? tabs[0] : null); }
    );
  });
}
async function load() {
  var tab = await getActiveSessionTab();
  if (!tab) {
    document.getElementById('stats').style.display = 'none';
    document.getElementById('none').style.display = 'block';
    return;
  }
  var sessionId = new URL(tab.url).pathname.split('/').filter(Boolean).pop();
  var STORE_KEY = 'djt:' + sessionId;
  chrome.storage.local.get([STORE_KEY], function (data) {
    var s = (data && data[STORE_KEY]) || null;
    var counts   = (s && s.countsSnapshot) || { user: 0, bot: 0, total: 0 };
    var rerolls  = (s && s.rerolls)        || 0;
    var nexus    = (s && s.sinceNexus)     || 0;
    document.getElementById('p-user').textContent    = counts.user;
    document.getElementById('p-bot').textContent     = counts.bot;
    document.getElementById('p-total').textContent   = counts.total;
    document.getElementById('p-rerolls').textContent = rerolls;
    var nv = document.getElementById('p-nexus');
    nv.textContent = nexus; nv.className = nexusClass(nexus);
    document.getElementById('p-warn').style.display = nexus >= 50 ? 'block' : 'none';
    document.getElementById('btn-export').addEventListener('click', function () {
      var lines = [
        "Sunny's Dreamjourney Toolkit V2 Session Stats",
        'Made by SunflowerS at Dreamjourney AI',
        'Session: ' + sessionId,
        'Exported: ' + new Date().toLocaleString(),
        ''.padEnd(42, '-'),
        'Your messages : ' + counts.user,
        'Bot messages  : ' + counts.bot,
        'Total         : ' + counts.total,
        'Rerolls       : ' + rerolls,
        'Since Nexus   : ' + nexus
      ];
      var blob = new Blob([lines.join('\n')], { type: 'text/plain' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = 'djt-stats-' + sessionId.slice(0, 8) + '.txt';
      a.click(); URL.revokeObjectURL(url);
      setStatus('Exported.');
    });
  });
}
document.addEventListener('DOMContentLoaded', load);
