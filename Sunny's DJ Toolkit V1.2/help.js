(function () {
  var btn  = document.getElementById('theme-toggle');
  var root = document.documentElement;
  var saved = localStorage.getItem('djt-help-theme');
  if (saved) {
    root.setAttribute('data-theme', saved);
    btn.textContent = saved === 'light' ? '\u{1F319}' : '\u2600\uFE0F';
  }
  btn.addEventListener('click', function () {
    var curr = root.getAttribute('data-theme') || 'dark';
    var next = curr === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    btn.textContent = next === 'light' ? '\u{1F319}' : '\u2600\uFE0F';
    localStorage.setItem('djt-help-theme', next);
  });
})();
