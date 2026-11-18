/* Shows startup errors on screen instead of a spinner that never ends. Loaded before the app. */
(function () {
  function show(msg) {
    if (window.__IIP_STARTED__) return;
    var el = document.getElementById('app');
    if (!el) return;
    el.innerHTML = '';
    var box = document.createElement('div');
    box.className = 'boot';
    var p = document.createElement('p');
    p.style.maxWidth = '640px';
    p.style.whiteSpace = 'pre-wrap';
    p.style.fontSize = '12px';
    p.textContent = 'InternIQ could not start. Reload the page; if it keeps happening, send this to whoever shared InternIQ with you:\n\n' + String(msg).slice(0, 1500);
    box.appendChild(p);
    el.appendChild(box);
  }
  window.__IIP_SHOW_ERROR__ = show;
  window.addEventListener('error', function (e) {
    show((e.error && e.error.stack) || e.message || 'Unknown error');
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    show((r && (r.stack || r.message)) || String(r));
  });
})();
