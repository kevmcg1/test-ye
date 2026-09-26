// the flat view's inches / metric toggle presses the matching sidebar units button, and follows it
(function(){
  const bar = document.querySelector('.flat-units'); if (!bar) return;
  const side = u => document.querySelector('aside [data-units="' + u + '"]');
  const sync = () => bar.querySelectorAll('[data-funits]').forEach(b => { const s = side(b.dataset.funits); b.setAttribute('aria-pressed', String(!!s && s.getAttribute('aria-pressed') === 'true')); });
  bar.addEventListener('click', e => { const b = e.target.closest('[data-funits]'); const s = b && side(b.dataset.funits); if (s) s.click(); sync(); });
  ['in', 'mm'].forEach(u => { const s = side(u); if (s) new MutationObserver(sync).observe(s, { attributes: true, attributeFilter: ['aria-pressed'] }); });
  sync();
})();
