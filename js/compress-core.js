/* SizeMyPDF - the size-targeting compression engine, with no DOM dependencies.
   Extracted so the single-file page and the batch page share one implementation
   rather than keeping two copies that drift apart.

   window.PDFCompress.toTarget(bytes, targetBytes, onProgress)
     -> Promise<{ bytes: Uint8Array, keptText: boolean }>

   Tries a lossless repack first and only rasterises if that misses the target,
   because rasterising destroys the text layer and is frequently unnecessary. */
window.PDFCompress = (function () {
  'use strict';

  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  /* pdf.js drives its render loop with requestAnimationFrame, which browsers
     pause in a hidden tab - so a job would stall forever the moment someone
     switched away. Fall back to a timer while hidden. Background timers are
     clamped, so this is a crawl rather than a stall; the real fix is moving
     this into a worker, which is a larger change. */
  if (!window.__pdfRafPatched) {
    var nativeRaf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = function (cb) {
      if (document.hidden) {
        return window.setTimeout(function () { cb(performance.now()); }, 16);
      }
      return nativeRaf(cb);
    };
    window.__pdfRafPatched = true;
  }

  var BASE_SCALE = 1.4;

  function noop() {}

  /* ---------- lossless ---------- */
  function repack(bytes) {
    return PDFLib.PDFDocument.load(bytes.slice(0), { ignoreEncryption: true })
      .then(function (doc) {
        doc.setTitle(''); doc.setAuthor(''); doc.setSubject('');
        doc.setKeywords([]); doc.setProducer(''); doc.setCreator('');
        return doc.save({ useObjectStreams: true });
      });
  }

  /* ---------- rasterising ---------- */
  function makeRenderer(bytes, onProgress) {
    var pdfDoc = null, baseCanvases = null, derived = {};

    function loadDoc() {
      if (pdfDoc) return Promise.resolve(pdfDoc);
      return pdfjsLib.getDocument({ data: bytes.slice(0) }).promise.then(function (d) {
        pdfDoc = d; return d;
      });
    }

    // Rasterising through pdf.js dominates the runtime, so it happens once at
    // the highest scale needed; lower scales are cheap canvas downscales.
    function renderBase() {
      if (baseCanvases) return Promise.resolve(baseCanvases);
      return loadDoc().then(function (doc) {
        var out = [], n = doc.numPages, chain = Promise.resolve();
        for (var i = 1; i <= n; i++) {
          (function (pageNo) {
            chain = chain.then(function () {
              return doc.getPage(pageNo).then(function (page) {
                var vp = page.getViewport({ scale: BASE_SCALE });
                var cap = 2600, k = Math.min(1, cap / Math.max(vp.width, vp.height));
                if (k < 1) vp = page.getViewport({ scale: BASE_SCALE * k });
                var c = document.createElement('canvas');
                c.width = Math.max(1, Math.floor(vp.width));
                c.height = Math.max(1, Math.floor(vp.height));
                var ctx = c.getContext('2d');
                ctx.fillStyle = '#fff';
                ctx.fillRect(0, 0, c.width, c.height);
                return page.render({ canvasContext: ctx, viewport: vp }).promise
                  .then(function () { out.push(c); onProgress(60 / n); });
              });
            });
          })(i);
        }
        return chain.then(function () { baseCanvases = out; return out; });
      });
    }

    function canvasesAt(scale) {
      if (scale === BASE_SCALE) return renderBase();
      if (derived[scale]) return Promise.resolve(derived[scale]);
      return renderBase().then(function (base) {
        var k = scale / BASE_SCALE;
        derived[scale] = base.map(function (src) {
          var c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(src.width * k));
          c.height = Math.max(1, Math.round(src.height * k));
          var ctx = c.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(src, 0, 0, c.width, c.height);
          return c;
        });
        return derived[scale];
      });
    }

    // Release the canvases; a 30-page scan holds hundreds of MB otherwise, and
    // in batch that memory has to come back before the next file starts.
    function release() {
      function zero(c) { c.width = 0; c.height = 0; }
      if (baseCanvases) baseCanvases.forEach(zero);
      Object.keys(derived).forEach(function (k) { derived[k].forEach(zero); });
      baseCanvases = null; derived = {};
      if (pdfDoc && pdfDoc.destroy) { try { pdfDoc.destroy(); } catch (e) {} }
      pdfDoc = null;
    }

    return { canvasesAt: canvasesAt, dropScale: function (s) { delete derived[s]; }, release: release };
  }

  function toJpeg(canvas, q) {
    return new Promise(function (res) {
      if (canvas.toBlob) canvas.toBlob(function (b) { res(b); }, 'image/jpeg', q);
      else {
        var d = canvas.toDataURL('image/jpeg', q),
            bin = atob(d.split(',')[1]), arr = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        res(new Blob([arr], { type: 'image/jpeg' }));
      }
    });
  }

  // Search on encoded JPEG totals; a real PDF is assembled only for the winner.
  function encodeAll(canvases, q) {
    var blobs = [], total = 0, chain = Promise.resolve();
    canvases.forEach(function (c) {
      chain = chain.then(function () {
        return toJpeg(c, q).then(function (b) { blobs.push(b); total += b.size; });
      });
    });
    return chain.then(function () { return { blobs: blobs, total: total }; });
  }

  function overhead(n) { return 1200 + 320 * n; }

  function assembleFrom(canvases, blobs) {
    return PDFLib.PDFDocument.create().then(function (out) {
      var chain = Promise.resolve();
      blobs.forEach(function (blob, i) {
        chain = chain.then(function () {
          return blob.arrayBuffer()
            .then(function (ab) { return out.embedJpg(ab); })
            .then(function (img) {
              var c = canvases[i];
              var p = out.addPage([c.width, c.height]);
              p.drawImage(img, { x: 0, y: 0, width: c.width, height: c.height });
            });
        });
      });
      return chain.then(function () { return out.save({ useObjectStreams: true }); });
    });
  }

  function rasterToTarget(bytes, targetBytes, onProgress, onStage) {
    var r = makeRenderer(bytes, onProgress);
    var scales = [BASE_SCALE, 1.0, 0.75, 0.55, 0.4];
    var idx = 0, fallback = null;

    function tryScale() {
      if (idx >= scales.length) {
        return fallback
          ? assembleFrom(fallback.canvases, fallback.blobs)
          : Promise.resolve(null);
      }
      var s = scales[idx++];
      onStage('Testing quality at ' + Math.round(s * 100) + '% scale…');
      return r.canvasesAt(s).then(function (canvases) {
        var budget = targetBytes - overhead(canvases.length);
        var lo = 0.15, hi = 0.94, best = null, steps = 0;
        function step() {
          if (steps++ >= 4) return Promise.resolve(best);
          var q = (lo + hi) / 2;
          return encodeAll(canvases, q).then(function (enc) {
            onProgress(4);
            if (!fallback || enc.total < fallback.total) {
              fallback = { canvases: canvases, blobs: enc.blobs, total: enc.total };
            }
            if (enc.total <= budget) { best = enc; lo = q; } else { hi = q; }
            return step();
          });
        }
        return step().then(function (winner) {
          if (!winner) { r.dropScale(s); return tryScale(); }
          onStage('Building the PDF…');
          return assembleFrom(canvases, winner.blobs).then(function (out) {
            if (out.length > targetBytes && lo > 0.2) {
              return encodeAll(canvases, Math.max(0.15, lo - 0.12))
                .then(function (e2) { return assembleFrom(canvases, e2.blobs); });
            }
            return out;
          });
        });
      });
    }

    return tryScale().then(function (out) { r.release(); return out; },
                           function (e) { r.release(); throw e; });
  }

  /* ---------- public ---------- */
  function toTarget(bytes, targetBytes, onProgress, onStage) {
    onProgress = onProgress || noop;
    onStage = onStage || noop;

    onStage('Trying lossless first…');
    return repack(bytes).then(function (b) {
      if (b && b.length <= targetBytes) return { bytes: b, keptText: true };
      return rasterToTarget(bytes, targetBytes, onProgress, onStage)
        .then(function (r) { return { bytes: r, keptText: false }; });
    }).catch(function () {
      return rasterToTarget(bytes, targetBytes, onProgress, onStage)
        .then(function (r) { return { bytes: r, keptText: false }; });
    });
  }

  return { toTarget: toTarget, repack: repack, BASE_SCALE: BASE_SCALE };
})();
