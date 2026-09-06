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
/* A page source that keeps at most one full-size canvas alive at a time.

   The old shape held every page of the document as a canvas for the whole
   job, plus a second copy for each scale it tried. An A4 page at 1.4x is
   roughly 3.9 MB of pixels, so a 30-page scan was carrying well over 100 MB
   before the second scale was even considered - which is what ran phones out
   of memory, and it got worse once batch could queue twenty documents.

   Now pages are rendered once and, for documents big enough to matter, kept
   as compressed JPEG blobs instead of raw pixels: about 200 KB a page rather
   than 3.9 MB. Encoding walks the document a page at a time, decoding one
   blob, scaling it, encoding it and freeing it before moving on.

   Short documents keep the raw canvases, because storing an intermediate JPEG
   costs a second lossy encode. That is a real quality cost and there is no
   reason to pay it when the whole document fits in memory comfortably. The
   switch is made on estimated bytes, not page count, since page sizes vary. */
var MEMORY_BUDGET = 48 * 1024 * 1024;   // raw pixels we are willing to hold
var lastMode = null;                    // reported back so the path is checkable
var STORE_QUALITY = 0.94;               // intermediate quality in streaming mode

function makeSource(bytes, onProgress) {
  var pdfDoc = null, mode = null;
  var canvases = null, stored = null, dims = null;

  function loadDoc() {
    if (pdfDoc) return Promise.resolve(pdfDoc);
    return pdfjsLib.getDocument({
      data: bytes.slice(0),
      canvasFactory: new OffscreenCanvasFactory()
    }).promise.then(function (d) { pdfDoc = d; return d; });
  }

  function viewportFor(page) {
    var vp = page.getViewport({ scale: BASE_SCALE });
    var k = Math.min(1, MAX_EDGE / Math.max(vp.width, vp.height));
    return k < 1 ? page.getViewport({ scale: BASE_SCALE * k }) : vp;
  }

  function prepare() {
    if (mode) return Promise.resolve();
    return loadDoc().then(function (doc) {
      return doc.getPage(1).then(function (p1) {
        var vp = viewportFor(p1);
        var estimate = Math.floor(vp.width) * Math.floor(vp.height) * 4 * doc.numPages;
        mode = estimate > MEMORY_BUDGET ? 'stream' : 'cache';
        lastMode = mode;
        return renderAll(doc);
      });
    });
  }

  function renderAll(doc) {
    canvases = []; stored = []; dims = [];
    var n = doc.numPages, chain = Promise.resolve();
    for (var i = 1; i <= n; i++) {
      (function (pageNo) {
        chain = chain.then(function () {
          return doc.getPage(pageNo).then(function (page) {
            var vp = viewportFor(page);
            var c = new OffscreenCanvas(
              Math.max(1, Math.floor(vp.width)),
              Math.max(1, Math.floor(vp.height)));
            var ctx = c.getContext('2d');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, c.width, c.height);
            return page.render({ canvasContext: ctx, viewport: vp }).promise
              .then(function () {
                dims.push({ width: c.width, height: c.height });
                if (page.cleanup) { try { page.cleanup(); } catch (e) {} }
                if (mode === 'cache') { canvases.push(c); onProgress(60 / n); return; }
                return c.convertToBlob({ type: 'image/jpeg', quality: STORE_QUALITY })
                  .then(function (b) {
                    stored.push(b);
                    c.width = 0; c.height = 0;    // free the pixels immediately
                    onProgress(60 / n);
                  });
              });
          });
        });
      })(i);
    }
    return chain;
  }

  function pageCount() { return dims ? dims.length : 0; }

  function sourceFor(i) {
    if (mode === 'cache') return Promise.resolve({ img: canvases[i], close: false });
    return createImageBitmap(stored[i]).then(function (bm) {
      return { img: bm, close: true };
    });
  }

  /* Encode the whole document at one scale and quality, holding a single
     scaled canvas at a time. Returns the encoded blobs and their dimensions,
     so the pixels can be gone before a PDF is assembled from them. */
  function encodeAt(scale, q) {
    var k = scale / BASE_SCALE;
    var blobs = [], outDims = [], total = 0;
    var chain = Promise.resolve();

    dims.forEach(function (d, i) {
      chain = chain.then(function () {
        var w = Math.max(1, Math.round(d.width * k));
        var h = Math.max(1, Math.round(d.height * k));

        // at base scale in cache mode the page is already the right size
        if (mode === 'cache' && k === 1) {
          outDims.push({ width: w, height: h });
          return canvases[i].convertToBlob({ type: 'image/jpeg', quality: q })
            .then(function (b) { blobs.push(b); total += b.size; });
        }

        return sourceFor(i).then(function (src) {
          var c = new OffscreenCanvas(w, h);
          var ctx = c.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(src.img, 0, 0, w, h);
          if (src.close && src.img.close) src.img.close();
          outDims.push({ width: w, height: h });
          return c.convertToBlob({ type: 'image/jpeg', quality: q })
            .then(function (b) {
              blobs.push(b); total += b.size;
              c.width = 0; c.height = 0;          // and free it again
            });
        });
      });
    });

    return chain.then(function () {
      return { blobs: blobs, dims: outDims, total: total };
    });
  }

  function release() {
    if (canvases) {
      canvases.forEach(function (c) { try { c.width = 0; c.height = 0; } catch (e) {} });
    }
    canvases = null; stored = null;
    if (pdfDoc && pdfDoc.destroy) { try { pdfDoc.destroy(); } catch (e) {} }
    pdfDoc = null;
  }

  return { prepare: prepare, encodeAt: encodeAt, release: release,
           pageCount: pageCount, modeUsed: function () { return mode; } };
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

function rasterToTarget(bytes, targetBytes, onProgress, onStage) {
  var src = makeSource(bytes, onProgress);
  var idx = 0, fallback = null;

  function tryScale() {
    if (idx >= SCALES.length) {
      if (!fallback) return Promise.resolve(null);
      var f = fallback;
      src.release();
      return assembleFrom(f.dims, f.blobs);
    }
    var s = SCALES[idx++];
    onStage('Testing quality at ' + Math.round(s * 100) + '% scale…');

    var lo = 0.15, hi = 0.94, best = null, steps = 0;
    var budget = targetBytes - overhead(src.pageCount());

    function step() {
      if (steps++ >= PROBES) return Promise.resolve(best);
      var q = (lo + hi) / 2;
      return src.encodeAt(s, q).then(function (enc) {
        onProgress(4);
        if (!fallback || enc.total < fallback.total) fallback = enc;
        if (enc.total <= budget) { best = enc; lo = q; } else { hi = q; }
        return step();
      });
    }

    return step().then(function (winner) {
      if (!winner) return tryScale();
      onStage('Building the PDF…');
      var needsRetry = lo > 0.2;
      var retryQ = Math.max(0.15, lo - 0.12);

      // nothing holds pixels any more, so the source can go before assembly
      if (!needsRetry) {
        src.release();
        return assembleFrom(winner.dims, winner.blobs);
      }
      return assembleFrom(winner.dims, winner.blobs).then(function (out) {
        if (out.length <= targetBytes) { src.release(); return out; }
        // one more, slightly harder pass before giving up on the target
        return src.encodeAt(s, retryQ).then(function (e2) {
          src.release();
          return assembleFrom(e2.dims, e2.blobs);
        });
      });
    });
  }

  return src.prepare().then(tryScale).then(
    function (out) { src.release(); return out; },
    function (e) { src.release(); throw e; });
}

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
    self.postMessage({ id: id, type: 'done', bytes: out,
                       keptText: !!res.keptText, mode: lastMode },
                     [out.buffer]);
  }).catch(function (err) {
    post(id, 'error', { message: String(err && err.message || err) });
  });
};
