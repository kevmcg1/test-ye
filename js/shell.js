// the tools: each one's page is a text/html block in index.html (id "tool-<page>");
// the vernier caliper is the caliper page opened as the vernier
const APPS = [
  { id: 'caliper', name: 'Dial caliper', page: 'caliper' },
  { id: 'vernier', name: 'Vernier caliper', page: 'caliper', inst: 'vern' },
  { id: 'micrometer', name: 'Outside micrometer', page: 'micrometer' },
  { id: 'depth', name: 'Depth micrometer', page: 'depth' },
  { id: 'height', name: 'Height gage', page: 'height' }
];
// links inside a tool that open another tool switch tabs instead
const LINKS = { 'depth-micrometer.html': 'depth', 'depth-micrometer-trainer.html': 'depth', 'height-gage.html': 'height', 'micrometer.html': 'micrometer', 'dial-caliper-trainer.html': 'caliper' };
// a tool's page as text, ready for its frame (relative css/ and js/ paths resolve against this page)
function pageFor(a){
  let html = document.getElementById('tool-' + a.page).textContent.replace(/<\\\/script>/g, '</script>');
  if (a.inst) html = html.replace('<head>', '<head><script>window.__INST=' + JSON.stringify(a.inst) + '</' + 'script>');
  return html;
}
// no right-click menu, and no view-source or developer-tools shortcuts (Ctrl+U, Ctrl+Shift+I/J/C, F12,
// and the Mac Cmd+Option versions), on this page and inside every tool's frame
function lockDown(w){
  if (!w || w.__lockedDown) return;
  w.__lockedDown = true;
  w.addEventListener('contextmenu', e => e.preventDefault(), true);
  w.addEventListener('keydown', e => {
    const k = (e.key || '').toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (k === 'f12' || (mod && k === 'u') || (mod && (e.shiftKey || e.altKey) && ['i', 'j', 'c', 'u'].includes(k))){
      e.preventDefault(); e.stopPropagation();
    }
  }, true);
}
lockDown(window);
(function(){
  const tabs = document.getElementById('tabs'), stage = document.getElementById('stage');
  const frames = {};
  // the glowing line under the open tab, which slides to whichever tab opens
  const ink = document.createElement('span'); ink.className = 'tab-ink'; ink.setAttribute('aria-hidden', 'true');
  // it slides when you switch tabs, and simply appears in place on load and on resize
  const placeInk = (instant) => {
    const t = tabs.querySelector('.tab[aria-selected="true"]'); if (!t) return;
    if (instant === true || !ink.dataset.placed) ink.style.transition = 'none';
    ink.style.width = t.offsetWidth - 24 + 'px';
    ink.style.transform = 'translate(' + (t.offsetLeft + 12) + 'px,' + (t.offsetTop + t.offsetHeight + 7) + 'px)';
    ink.style.opacity = '1';
    if (ink.style.transition){ void ink.offsetWidth; ink.style.transition = ''; }
    ink.dataset.placed = '1';
  };
  window.addEventListener('resize', () => placeInk(true));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => placeInk(true));
  let current = null;
  APPS.forEach(a => {
    const b = document.createElement('a');
    b.className = 'tab'; b.href = '#' + a.id; b.setAttribute('role', 'tab'); b.id = 'tab-' + a.id;
    b.textContent = a.name; b.setAttribute('aria-selected', 'false'); b.setAttribute('aria-controls', 'app-' + a.id);
    b.addEventListener('click', e => { if (e.ctrlKey || e.metaKey || e.shiftKey || e.button) return; e.preventDefault(); show(a.id); });
    tabs.appendChild(b);
  });
  tabs.appendChild(ink);
  // each app gets its own frame the first time it is opened, and keeps its state after that
  function frameFor(a){
    if (frames[a.id]) return frames[a.id];
    const f = document.createElement('iframe');
    f.id = 'app-' + a.id; f.title = a.name; f.setAttribute('role', 'tabpanel');
    f.setAttribute('allow', 'fullscreen; autoplay');
    f.addEventListener('load', () => {
      if (current !== a.id) pause(f, true);
      try { lockDown(f.contentWindow); } catch (err) {}
      try {
        f.contentDocument.addEventListener('click', e => {
          const link = e.target.closest && e.target.closest('a[href]');
          if (!link) return;
          const file = decodeURIComponent(link.getAttribute('href').split('#')[0].split('?')[0].split('/').pop());
          if (LINKS[file]){ e.preventDefault(); show(LINKS[file]); }
        }, true);
      } catch (err) {}
    });
    f.srcdoc = pageFor(a);
    stage.appendChild(f);
    return frames[a.id] = f;
  }
  // Every frame request goes through a gate: a callback that comes due while the tool is hidden is
  // held instead of run, and held ones run once when it shows again. Holding at run time (not at
  // request time) keeps exactly one callback in flight per loop, so a quick hide-and-show can never
  // start a second copy of a tool's animation loop.
  function pause(f, off){
    let w; try { w = f.contentWindow; } catch (e) { return; }
    if (!w) return;
    if (!w.__rafGate){
      const real = w.requestAnimationFrame.bind(w);
      w.__rafGate = true; w.__rafHeld = []; w.__rafPaused = false;
      w.requestAnimationFrame = cb => real(t => { if (w.__rafPaused) w.__rafHeld.push(cb); else cb(t); });
    }
    w.__rafPaused = off;
    if (!off) w.__rafHeld.splice(0).forEach(cb => w.requestAnimationFrame(cb));
  }
  function show(id){
    const a = APPS.find(x => x.id === id) || APPS[0];
    if (current === a.id) return;
    current = a.id;
    const f = frameFor(a);
    Object.values(frames).forEach(x => { x.classList.toggle('on', x === f); pause(x, x !== f); });
    // a hidden frame has no size, so its layout is stale: have it lay itself out again now it shows
    const relayout = () => { try { f.contentWindow.dispatchEvent(new Event('resize')); } catch (err) {} };
    requestAnimationFrame(relayout); setTimeout(relayout, 250);
    tabs.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', String(t.id === 'tab-' + a.id)));
    placeInk();
    document.title = 'Shop Tool Sim';
    if (location.hash !== '#' + a.id) history.replaceState(null, '', '#' + a.id);
    try { localStorage.setItem('precision-tools-last', a.id); } catch (e) {}
    setTimeout(() => { try { f.focus(); } catch (e) {} }, 50);
  }
  tabs.addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = APPS.findIndex(a => a.id === current), n = APPS.length;
    const next = APPS[(i + (e.key === 'ArrowRight' ? 1 : n - 1)) % n];
    show(next.id); document.getElementById('tab-' + next.id).focus(); e.preventDefault();
  });
  window.addEventListener('hashchange', () => show(location.hash.slice(1)));
  let start = location.hash.slice(1);
  if (!APPS.some(a => a.id === start)){ try { start = localStorage.getItem('precision-tools-last'); } catch (e) {} }
  show(APPS.some(a => a.id === start) ? start : APPS[0].id);
})();
