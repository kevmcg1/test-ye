      // runs as the page is read, before the 3D engine downloads: the bar creeps toward a cap as files arrive,
      // and __load.set() moves it (and the cap) on at each real step; __load.done() fills it and fades it out
      (function(){
        var fill = document.getElementById('ldFill'), bar = fill.parentNode, pct = document.getElementById('ldP'), txt = document.getElementById('ldT');
        var p = 0.03, cap = 0.5, done = false;
        function draw(){ fill.style.transform = 'scaleX(' + p + ')'; var n = Math.round(p*100); pct.textContent = n + '%'; bar.setAttribute('aria-valuenow', n); }
        function set(v, label){ if (done) return; p = Math.max(p, v); cap = Math.max(cap, Math.min(0.97, v + 0.3)); if (label) txt.textContent = label; draw(); }
        var timer = setInterval(function(){ if (!done){ p += (cap - p)*0.05; draw(); } }, 120);
        try { new PerformanceObserver(function(list){ list.getEntries().forEach(function(){ p += (cap - p)*0.25; }); if (!done) draw(); }).observe({ type: 'resource', buffered: true }); } catch (e) {}
        window.__load = { set: set, done: function(){
          if (done) return; set(1, 'Ready'); done = true; clearInterval(timer);
          var el = document.getElementById('loading'); el.classList.add('ld-out'); setTimeout(function(){ el.remove(); }, 350);
        } };
        draw();
      })();
