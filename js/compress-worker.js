/* SizeMyPDF - the compression engine, running off the main thread.

   Same algorithm as the main-thread implementation in compress-core.js, with
   OffscreenCanvas in place of DOM canvases. Running here means the page stays
   responsive while a job runs, and none of it is subject to the animation-frame
   throttling that made a backgrounded tab crawl - workers are not throttled, so
   the rAF shim is irrelevant in here.

   compress-core.js falls back to its own main-thread copy if this worker cannot
   start, so the two implementations have to stay in step. The shared constants
   below are the contract between them.

   Protocol
     in : { id, bytes, targetBytes }
     out: { id, type:'stage'|'progress'|'done'|'error', ... } */
'use strict';

importScripts('../vendor/pdf.min.js', '../vendor/pdf-lib.min.js');

/* pdf.js left alone tries to spawn its own nested worker, and when that fails
   it falls back to a "fake worker" path that needs `document` - which does not
   exist in here, so it throws. Handing it a port we made ourselves skips all
   of that. */
pdfjsLib.GlobalWorkerOptions.workerPort = new Worker('../vendor/pdf.worker.min.js');

var BASE_SCALE = 1.4;
var SCALES = [BASE_SCALE, 1.0, 0.75, 0.55, 0.4];
var MAX_EDGE = 2600;
var PROBES = 6;

function OffscreenCanvasFactory() {}
OffscreenCanvasFactory.prototype.create = function (w, h) {
  var canvas = new OffscreenCanvas(Math.max(1, w | 0), Math.max(1, h | 0));
  return { canvas: canvas, context: canvas.getContext('2d') };
};
OffscreenCanvasFactory.prototype.reset = function (cc, w, h) {
  cc.canvas.width = Math.max(1, w | 0);
  cc.canvas.height = Math.max(1, h | 0);
};
OffscreenCanvasFactory.prototype.destroy = function (cc) {
  cc.canvas.width = 0; cc.canvas.height = 0;
  cc.canvas = null; cc.context = null;
};

function post(id, type, extra) {
  var msg = { id: id, type: type };
  if (extra) for (var k in extra) msg[k] = extra[k];
  self.postMessage(msg);
}

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
    return pdfjsLib.getDocument({
      data: bytes.slice(0),
      canvasFactory: new OffscreenCanvasFactory()
    }).promise.then(function (d) { pdfDoc = d; return d; });
  }

  // Rasterising dominates the runtime, so it happens once at the highest scale
  // needed; lower scales are cheap canvas downscales.
  function renderBase() {
    if (baseCanvases) return Promise.resolve(baseCanvases);
    return loadDoc().then(function (doc) {
      var out = [], n = doc.numPages, chain = Promise.resolve();
      for (var i = 1; i <= n; i++) {
        (function (pageNo) {
          chain = chain.then(function () {
            return doc.getPage(pageNo).then(function (page) {
              var vp = page.getViewport({ scale: BASE_SCALE });
              var k = Math.min(1, MAX_EDGE / Math.max(vp.width, vp.height));
              if (k < 1) vp = page.getViewport({ scale: BASE_SCALE * k });
              var c = new OffscreenCanvas(
                Math.max(1, Math.floor(vp.width)),
                Math.max(1, Math.floor(vp.height)));
              var ctx = c.getContext('2d');
              ctx.fillStyle = '#fff';
              ctx.fillRect(0, 0, c.width, c.height);
              return page.render({ canvasContext: ctx, viewport: vp }).promise
                .then(function () {
                  out.push(c);
                  // the page's own internal buffers are no longer needed
                  if (page.cleanup) { try { page.cleanup(); } catch (e) {} }
                  onProgress(60 / n);
                });
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
        var c = new OffscreenCanvas(
          Math.max(1, Math.round(src.width * k)),
          Math.max(1, Math.round(src.height * k)));
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

  function zero(c) { try { c.width = 0; c.height = 0; } catch (e) {} }

  /* A 30-page scan holds hundreds of megabytes of canvas. Dropping each scale
     as soon as its probes are done, rather than at the end of the job, is what
     keeps the peak down - and in batch that memory has to come back before the
     next file starts. */
  function dropScale(s) {
    if (derived[s]) { derived[s].forEach(zero); delete derived[s]; }
  }

  function dropBase() {
    if (baseCanvases) { baseCanvases.forEach(zero); baseCanvases = null; }
    if (pdfDoc && pdfDoc.destroy) { try { pdfDoc.destroy(); } catch (e) {} }
    pdfDoc = null;
  }

  function release() {
    Object.keys(derived).forEach(dropScale);
    dropBase();
  }

  return { canvasesAt: canvasesAt, dropScale: dropScale,
           dropBase: dropBase, release: release };
}

function toJpeg(canvas, q) {
  return canvas.convertToBlob({ type: 'image/jpeg', quality: q });
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

/* Takes plain {width,height} rather than live canvases so the pixels can be
   freed before the document is assembled - assembly only needs the sizes. */
function assembleFrom(dims, blobs) {
  return PDFLib.PDFDocument.create().then(function (out) {
    var chain = Promise.resolve();
    blobs.forEach(function (blob, i) {
      chain = chain.then(function () {
        return blob.arrayBuffer()
          .then(function (ab) { return out.embedJpg(ab); })
          .then(function (img) {
            var d = dims[i];
            var p = out.addPage([d.width, d.height]);
            p.drawImage(img, { x: 0, y: 0, width: d.width, height: d.height });
          });
      });
    });
    return chain.then(function () { return out.save({ useObjectStreams: true }); });
  });
}

function dimsOf(canvases) {
  return canvases.map(function (c) { return { width: c.width, height: c.height }; });
}

function rasterToTarget(bytes, targetBytes, onProgress, onStage) {
  var r = makeRenderer(bytes, onProgress);
  var idx = 0, fallback = null;

  function tryScale() {
    if (idx >= SCALES.length) {
      if (!fallback) return Promise.resolve(null);
      var f = fallback;
      r.release();
      return assembleFrom(f.dims, f.blobs);
    }
    var s = SCALES[idx++];
    onStage('Testing quality at ' + Math.round(s * 100) + '% scale…');
    return r.canvasesAt(s).then(function (canvases) {
      var budget = targetBytes - overhead(canvases.length);
      var lo = 0.15, hi = 0.94, best = null, steps = 0;

      function step() {
        if (steps++ >= PROBES) return Promise.resolve(best);
        var q = (lo + hi) / 2;
        return encodeAll(canvases, q).then(function (enc) {
          onProgress(4);
          if (!fallback || enc.total < fallback.total) {
            fallback = { dims: dimsOf(canvases), blobs: enc.blobs, total: enc.total };
          }
          if (enc.total <= budget) { best = enc; lo = q; } else { hi = q; }
          return step();
        });
      }

      return step().then(function (winner) {
        if (!winner) {
          if (s !== BASE_SCALE) r.dropScale(s);
          return tryScale();
        }
        onStage('Building the PDF…');
        var dims = dimsOf(canvases);
        var needsRetry = lo > 0.2;
        var retryQ = Math.max(0.15, lo - 0.12);

        /* Peak memory is here - canvases, encoded blobs and the assembled PDF
           are all alive at once. When no retry pass is possible the canvases
           are already dead weight, so drop them before assembling rather than
           after. assembleFrom only needs the page sizes. */
        if (!needsRetry) {
          r.release();
          return assembleFrom(dims, winner.blobs);
        }
        return assembleFrom(dims, winner.blobs).then(function (out) {
          if (out.length <= targetBytes) { r.release(); return out; }
          // one more, slightly harder pass before giving up on the target
          return encodeAll(canvases, retryQ).then(function (e2) {
            r.release();
            return assembleFrom(dims, e2.blobs);
          });
        });
      });
    });
  }

  return tryScale().then(
    function (out) { r.release(); return out; },
    function (e) { r.release(); throw e; });
}

/* Rasterising is not guaranteed to shrink anything: a text document is a few
   kilobytes of glyph instructions and the same pages as JPEGs are hundreds. */
function pickSmaller(original, repacked, rastered) {
  var lossless = (repacked && repacked.length < original.length) ? repacked : original;
  if (!rastered || rastered.length >= lossless.length) {
    return { bytes: lossless, keptText: true };
  }
  return { bytes: rastered, keptText: false };
}

function toTarget(bytes, targetBytes, onProgress, onStage) {
  onStage('Trying lossless first…');
  return repack(bytes).then(function (b) {
    if (b && b.length <= targetBytes) return { bytes: b, keptText: true };
    return rasterToTarget(bytes, targetBytes, onProgress, onStage)
      .then(function (r) { return pickSmaller(bytes, b, r); });
  }, function () {
    return rasterToTarget(bytes, targetBytes, onProgress, onStage)
      .then(function (r) { return pickSmaller(bytes, null, r); });
  });
}

self.onmessage = function (e) {
  var d = e.data || {};
  var id = d.id;
  if (d.cmd === 'ping') { post(id, 'pong'); return; }

  toTarget(
    d.bytes,
    d.targetBytes,
    function (n) { post(id, 'progress', { n: n }); },
    function (msg) { post(id, 'stage', { msg: msg }); }
  ).then(function (res) {
    if (!res || !res.bytes) { post(id, 'error', { message: 'no output' }); return; }
    var out = res.bytes instanceof Uint8Array ? res.bytes : new Uint8Array(res.bytes);
    // hand the buffer over rather than copying it back
    self.postMessage({ id: id, type: 'done', bytes: out, keptText: !!res.keptText },
                     [out.buffer]);
  }).catch(function (err) {
    post(id, 'error', { message: String(err && err.message || err) });
  });
};
