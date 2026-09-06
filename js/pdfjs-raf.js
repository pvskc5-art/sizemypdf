/* SizeMyPDF - keep pdf.js rendering when the browser stops painting.

   pdf.js drives its render loop with requestAnimationFrame. A browser that is
   not compositing never fires one, and a render promise then hangs forever
   with no error - the worst failure we can hand a user, because the progress
   bar simply stops and nothing says why.

   The obvious guard, `if (document.hidden)`, is not enough: a minimised or
   fully-occluded window still reports visibilityState "visible" while the
   compositor is stopped, and rAF stays silent. So do not try to detect the
   condition at all - race every frame against a timer and take whichever
   arrives first.

   The timer is driven from a Web Worker rather than setTimeout on purpose.
   Background tabs clamp main-thread timers to roughly one second, which made
   any backgrounded render crawl. Worker timers are not clamped. The ticker
   only runs while frames are actually pending, so an idle page costs nothing.

   Compression itself no longer needs this - it runs in compress-worker.js,
   where there is no animation frame to wait for. This still matters for
   everything that renders on the main thread: PDF-to-images, the page
   thumbnails on Split, Delete and Merge, the result preview, and the
   main-thread fallback in compress-core.js when a browser has no
   OffscreenCanvas.convertToBlob.

   Loaded before pdf.js on every page that renders a PDF. */
(function () {
  'use strict';
  if (window.__pdfRafPatched) return;

  var nativeRaf = window.requestAnimationFrame.bind(window);
  var nativeCancel = window.cancelAnimationFrame.bind(window);
  var pending = Object.create(null);
  var pendingCount = 0;
  var seq = 0;

  /* A worker that does nothing but post a message on an interval. Its timers
     are exempt from background throttling, so it can wake the main thread even
     when setTimeout there has been clamped to a second. */
  var ticker = (function () {
    try {
      var src = 'var id=null;onmessage=function(e){' +
                'if(e.data==="start"){if(!id)id=setInterval(function(){postMessage(0)},16);}' +
                'else{clearInterval(id);id=null;}};';
      var url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
      var w = new Worker(url);
      URL.revokeObjectURL(url);
      w.onmessage = flushAll;
      return w;
    } catch (e) {
      return null;   // blocked or unsupported - the setTimeout path still works
    }
  })();

  function flushAll() {
    for (var k in pending) fire(k, performance.now());
  }

  function fire(key, t) {
    var rec = pending[key];
    if (!rec) return;             // another racer already won
    delete pending[key];
    pendingCount--;
    nativeCancel(rec.raf);
    if (rec.timer) clearTimeout(rec.timer);
    if (!pendingCount && ticker) ticker.postMessage('stop');
    rec.cb(t);
  }

  window.requestAnimationFrame = function (cb) {
    var key = ++seq;
    var rec = { cb: cb, raf: 0, timer: 0 };
    pending[key] = rec;
    pendingCount++;

    rec.raf = nativeRaf(function (t) { fire(key, t); });

    if (ticker) {
      if (pendingCount === 1) ticker.postMessage('start');
    } else {
      // no worker available: fall back to a main-thread timer, which is
      // clamped in background tabs but still beats never firing at all
      rec.timer = setTimeout(function () { fire(key, performance.now()); }, 32);
    }
    return key;
  };

  // Return our own key, so cancelling has to cancel every racer or a cancelled
  // frame would still fire from the timer.
  window.cancelAnimationFrame = function (key) {
    var rec = pending[key];
    if (!rec) { try { nativeCancel(key); } catch (e) {} return; }
    delete pending[key];
    pendingCount--;
    nativeCancel(rec.raf);
    if (rec.timer) clearTimeout(rec.timer);
    if (!pendingCount && ticker) ticker.postMessage('stop');
  };

  window.__pdfRafPatched = true;
})();
