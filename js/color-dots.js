// highlight color toggles over the 3D view: one dot per highlight card in the sidebar, kept in step
// with its checkbox both ways, and hidden whenever its card is (the other instrument or unit system)
(function(){
  const bar = document.querySelector('.quick .hlbar'); if (!bar) return;
  const cards = [...document.querySelectorAll('.hlcard')].filter(c => c.querySelector('input[type=checkbox]'));
  const sw = cards.map(card => {
    const input = card.querySelector('input[type=checkbox]'), b = document.createElement('button');
    b.type = 'button'; b.className = 'hlsw'; b.innerHTML = '<i aria-hidden="true"></i>';
    b.style.setProperty('--c', getComputedStyle(card).getPropertyValue('--c').trim() || '#c9ced4');
    b.addEventListener('click', () => { input.checked = !input.checked; input.dispatchEvent(new Event('change', { bubbles: true })); sync(); });
    bar.appendChild(b);
    return { b, card, input };
  });
  function sync(){
    for (const s of sw){
      const name = ((s.card.querySelector('b') || {}).textContent || 'highlight').trim();
      const inst = s.card.closest('[data-inst]');
      s.b.hidden = getComputedStyle(s.card).display === 'none' || (inst && getComputedStyle(inst).display === 'none');
      s.b.setAttribute('aria-pressed', String(s.input.checked));
      const t = (s.input.checked ? 'Hide ' : 'Show ') + name.charAt(0).toLowerCase() + name.slice(1);
      s.b.setAttribute('aria-label', t); s.b.dataset.tip = t;
    }
  }
  cards.forEach(c => c.querySelector('input[type=checkbox]').addEventListener('change', sync));
  // the instrument, the units and the card texts can all change: follow them
  new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  cards.forEach(c => new MutationObserver(sync).observe(c, { attributes: true, attributeFilter: ['style'], subtree: true, childList: true, characterData: true }));
  sync();
})();
