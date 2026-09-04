/* SizeMyPDF - client-side PDF compressor.
   Everything runs in the browser; no file is ever uploaded. */
(function () {
  'use strict';

  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  /* pdf.js schedules its render chunks with requestAnimationFrame, which
     browsers pause in a hidden tab. Without this, a compression stalls
     forever the moment the user switches away - and switching away during a
     slow multi-page job is exactly what people do. Fall back to a timer
     while the page is hidden so rendering keeps making progress. */
  (function () {
    var native = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = function (cb) {
      if (document.hidden) {
        return window.setTimeout(function () { cb(performance.now()); }, 16);
      }
      return native(cb);
    };
  })();

  var $ = function (s) { return document.querySelector(s); };
  var drop = $('#drop'), file = $('#file'), controls = $('#controls'),
      statusEl = $('#status'), bar = $('#bar'), barFill = $('#barFill'),
      result = $('#result'), go = $('#go');

  var srcBytes = null, srcName = '', srcSize = 0, outBlob = null;

  function fmt(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
    return (b / 1048576).toFixed(2) + ' MB';
  }
  function say(t) { statusEl.textContent = t; }

  /* The search explores an unknown number of scales, so true percentage
     progress is not knowable up front. Advance monotonically and ease off as
     it approaches 100 - a bar that slides backwards reads as a failure. */
  var progress = 0;
  function prog(p) {
    progress = Math.max(0, Math.min(100, p));
    bar.classList.add('on');
    barFill.style.width = progress + '%';
  }
  function bump(n) { prog(progress + (100 - progress) * (n / 100)); }

  /* ---------- file intake ---------- */
  drop.addEventListener('click', function () { file.click(); });
  drop.addEventListener('dragover', function (e) {
    e.preventDefault(); drop.classList.add('over');
  });
  drop.addEventListener('dragleave', function () { drop.classList.remove('over'); });
  drop.addEventListener('drop', function (e) {
    e.preventDefault(); drop.classList.remove('over');
    if (e.dataTransfer.files.length) accept(e.dataTransfer.files[0]);
  });
  file.addEventListener('change', function () {
    if (file.files.length) accept(file.files[0]);
  });

  function accept(f) {
    if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) {
      say('That does not look like a PDF file.'); return;
    }
    srcName = f.name.replace(/\.pdf$/i, '');
    srcSize = f.size;
    pdfDoc = null; baseCanvases = null; derived = {};
    var fr = new FileReader();
    fr.onload = function () {
      srcBytes = new Uint8Array(fr.result);
      drop.querySelector('strong').textContent = f.name;
      drop.querySelector('small').textContent =
        fmt(srcSize) + ' — click to choose a different file';
      controls.classList.add('on');
      result.classList.remove('on');
      say('');
      var kb = Math.round(srcSize / 1024);
      var t = $('#target');
      if (!t.value) t.value = Math.max(50, Math.round(kb * 0.35));
    };
    fr.readAsArrayBuffer(f);
  }

  /* ---------- rendering ---------- */
  var pdfDoc = null, baseCanvases = null, derived = {};
  var BASE_SCALE = 1.4;

  function loadDoc() {
    if (pdfDoc) return Promise.resolve(pdfDoc);
    return pdfjsLib.getDocument({ data: srcBytes.slice(0) }).promise.then(function (d) {
      pdfDoc = d; return d;
    });
  }

  // Rasterising through pdf.js is by far the most expensive step, so it runs
  // exactly once at the highest scale we will ever need. Every lower scale is
  // then a cheap canvas downscale of that result rather than a fresh render.
  function renderBase() {
    if (baseCanvases) return Promise.resolve(baseCanvases);
    var scale = BASE_SCALE;
    return loadDoc().then(function (doc) {
      var out = [], n = doc.numPages, chain = Promise.resolve();
      for (var i = 1; i <= n; i++) {
        (function (pageNo) {
          chain = chain.then(function () {
            return doc.getPage(pageNo).then(function (page) {
              var vp = page.getViewport({ scale: scale });
              // guard against absurd canvas sizes on very large pages
              var cap = 2600, k = Math.min(1, cap / Math.max(vp.width, vp.height));
              if (k < 1) vp = page.getViewport({ scale: scale * k });
              var c = document.createElement('canvas');
              c.width = Math.max(1, Math.floor(vp.width));
              c.height = Math.max(1, Math.floor(vp.height));
              var ctx = c.getContext('2d');
              ctx.fillStyle = '#fff';
              ctx.fillRect(0, 0, c.width, c.height);
              var task = page.render({ canvasContext: ctx, viewport: vp });
              return task.promise.then(function () {
                out.push(c);
                bump(60 / n);
              });
            });
          });
        })(i);
      }
      return chain.then(function () { baseCanvases = out; return out; });
    });
  }

  // Downscale the rendered pages to `scale`. Cheap compared to re-rendering.
  function canvasesAt(scale) {
    if (scale === BASE_SCALE) return renderBase();
    if (derived[scale]) return Promise.resolve(derived[scale]);
    return renderBase().then(function (base) {
      var k = scale / BASE_SCALE;
      var out = base.map(function (src) {
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
      derived[scale] = out;
      return out;
    });
  }

  function toJpeg(canvas, q) {
    return new Promise(function (res) {
      if (canvas.toBlob) canvas.toBlob(function (b) { res(b); }, 'image/jpeg', q);
      else {
        var d = canvas.toDataURL('image/jpeg', q),
            bin = atob(d.split(',')[1]),
            arr = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        res(new Blob([arr], { type: 'image/jpeg' }));
      }
    });
  }

  // Encode every page to JPEG and report the total. Used during the search:
  // building a real PDF for each probe is far too slow, and the finished file
  // is just the JPEG bytes plus a small, predictable container.
  function encodeAll(canvases, q) {
    var blobs = [], total = 0, chain = Promise.resolve();
    canvases.forEach(function (c) {
      chain = chain.then(function () {
        return toJpeg(c, q).then(function (b) { blobs.push(b); total += b.size; });
      });
    });
    return chain.then(function () { return { blobs: blobs, total: total }; });
  }

  // Container cost of the PDF wrapper around the images - object headers,
  // xref table, page tree. Small and roughly linear in page count.
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

  /* ---------- strategies ---------- */

  // Lossless-ish: re-save through pdf-lib, drop metadata, use object streams.
  function repack() {
    return PDFLib.PDFDocument.load(srcBytes.slice(0), { ignoreEncryption: true })
      .then(function (doc) {
        doc.setTitle(''); doc.setAuthor(''); doc.setSubject('');
        doc.setKeywords([]); doc.setProducer(''); doc.setCreator('');
        return doc.save({ useObjectStreams: true });
      });
  }

  // Target size: walk scales high to low, binary-search JPEG quality at each.
  // The search works on encoded JPEG totals; a real PDF is built only once,
  // for the setting that wins.
  function toTarget(targetBytes) {
    var scales = [BASE_SCALE, 1.0, 0.75, 0.55, 0.4];
    var idx = 0, fallback = null;   // smallest encoding seen, if nothing fits

    function tryScale() {
      if (idx >= scales.length) {
        return fallback
          ? assembleFrom(fallback.canvases, fallback.blobs)
          : Promise.resolve(null);
      }
      var s = scales[idx++];
      say('Testing quality at ' + Math.round(s * 100) + '% scale…');

      return canvasesAt(s).then(function (canvases) {
        var budget = targetBytes - overhead(canvases.length);
        var lo = 0.15, hi = 0.94, best = null, steps = 0;

        function step() {
          if (steps++ >= 4) return Promise.resolve(best);
          var q = (lo + hi) / 2;
          return encodeAll(canvases, q).then(function (enc) {
            bump(4);
            if (!fallback || enc.total < fallback.total) {
              fallback = { canvases: canvases, blobs: enc.blobs, total: enc.total };
            }
            if (enc.total <= budget) { best = enc; lo = q; } else { hi = q; }
            return step();
          });
        }

        return step().then(function (winner) {
          if (!winner) {
            delete derived[s];
            return tryScale();
          }
          say('Building the PDF…');
          return assembleFrom(canvases, winner.blobs).then(function (bytes) {
            // Container estimate was optimistic - shave quality and retry once.
            if (bytes.length > targetBytes && lo > 0.2) {
              return encodeAll(canvases, Math.max(0.15, lo - 0.12))
                .then(function (enc2) { return assembleFrom(canvases, enc2.blobs); });
            }
            return bytes;
          });
        });
      });
    }
    return tryScale();
  }

  /* ---------- run ---------- */
  go.addEventListener('click', function () {
    if (!srcBytes) return;
    var mode = $('#mode').value;
    var targetKB = parseInt($('#target').value, 10) || 200;

    go.disabled = true;
    result.classList.remove('on', 'miss');

    /* A file already under the target needs no work. Rasterising it anyway
       can return something LARGER than the original - a 20 KB text PDF comes
       back as a 26 KB image - which is the opposite of what was asked for. */
    if (mode !== 'lossless' && srcSize <= Math.max(10, targetKB) * 1024) {
      outBlob = new Blob([srcBytes.slice(0)], { type: 'application/pdf' });
      $('#rBig').textContent = 'Already ' + fmt(srcSize) + ' — no compression needed';
      $('#rMeta').textContent = 'This file is under your ' + targetKB +
        ' KB target, so it is unchanged. Compressing it further would only lose quality.';
      result.classList.add('on');
      say(''); bar.classList.remove('on'); go.disabled = false;
      return;
    }

    prog(5);
    say('Reading the PDF…');

    var job = (mode === 'lossless') ? repack() : toTarget(Math.max(10, targetKB) * 1024);

    job.then(function (bytes) {
      prog(100);
      if (!bytes) { say('Could not process this PDF.'); go.disabled = false; return; }
      outBlob = new Blob([bytes], { type: 'application/pdf' });
      var saved = srcSize - outBlob.size;
      var pct = srcSize ? Math.round((saved / srcSize) * 100) : 0;
      var hit = mode === 'lossless' || outBlob.size <= Math.max(10, targetKB) * 1024;

      $('#rBig').textContent = hit
        ? fmt(outBlob.size) + '  —  ' + (pct > 0 ? pct + '% smaller' : 'no reduction possible')
        : 'Smallest achievable: ' + fmt(outBlob.size);
      $('#rMeta').textContent = hit
        ? 'Was ' + fmt(srcSize) + ', now ' + fmt(outBlob.size) + '.'
        : 'Could not reach ' + targetKB + ' KB without destroying legibility. ' +
          'This is the smallest sensible result.';
      result.classList.add('on');
      if (!hit) result.classList.add('miss');
      say(''); bar.classList.remove('on'); go.disabled = false;
    }).catch(function (err) {
      console.error(err);
      say('Something went wrong: ' + (err && err.message ? err.message : 'unknown error') +
          '. If the PDF is password-protected, remove the password first.');
      bar.classList.remove('on'); go.disabled = false;
    });
  });

  $('#dl').addEventListener('click', function () {
    if (!outBlob) return;
    var a = document.createElement('a');
    a.href = URL.createObjectURL(outBlob);
    a.download = srcName + '-compressed.pdf';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  });

  $('#mode').addEventListener('change', function () {
    $('#targetField').style.display = this.value === 'lossless' ? 'none' : '';
  });
})();
