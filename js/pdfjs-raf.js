/* SizeMyPDF - keep pdf.js rendering when the browser stops painting.

   pdf.js drives its render loop with requestAnimationFrame. A browser that is
   not compositing never fires one, and a render promise then hangs forever
   with no error - the worst failure we can hand a user, because the progress
   bar simply stops and nothing says why.

   The obvious guard, `if (document.hidden)`, is not enough: a minimised or
   fully-occluded window still reports visibilityState "visible" while the
   compositor is stopped, and rAF stays silent. So do not try to detect the
   condition at all - race every frame against a short timer and take whichever
   arrives first. In a painting window rAF wins at ~16ms and behaviour is
   unchanged; everywhere else the timer keeps the job moving.

   Loaded before pdf.js on every page that renders a PDF. */
(function () {
  'use strict';
  if (window.__pdfRafPatched) return;

  var nativeRaf = window.requestAnimationFrame.bind(window);
  var nativeCancel = window.cancelAnimationFrame.bind(window);
  var pending = Object.create(null);
  var seq = 0;

  window.requestAnimationFrame = function (cb) {
    var key = ++seq;

    function fire(t) {
      var rec = pending[key];
      if (!rec) return;             // the other racer already won
      delete pending[key];
      nativeCancel(rec.raf);
      clearTimeout(rec.timer);
      cb(t);
    }

    pending[key] = {
      raf: nativeRaf(fire),
      timer: setTimeout(function () { fire(performance.now()); }, 32)
    };
    return key;
  };

  // Return our own key, so cancelling has to cancel both racers or a cancelled
  // frame would still fire from the timer.
  window.cancelAnimationFrame = function (key) {
    var rec = pending[key];
    if (!rec) { try { nativeCancel(key); } catch (e) {} return; }
    delete pending[key];
    nativeCancel(rec.raf);
    clearTimeout(rec.timer);
  };

  window.__pdfRafPatched = true;
})();
