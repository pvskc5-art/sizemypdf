/* SizeMyPDF - make a scanned PDF searchable, without uploading it.

   This is the tool most sites put behind a login, because OCR normally means
   sending the document to a server. Tesseract compiled to WebAssembly runs it
   here instead: about 9 MB of engine and language data, fetched the first time
   you actually open this page and never before.

   The output is deliberately not a rasterised copy. Most OCR services return
   your pages as images with text behind them, which throws away whatever
   vector content the file had. Here the original pages are kept exactly as
   they were and an invisible text layer is drawn on top, so the document is
   unchanged to look at and searchable underneath.

   Invisible means opacity zero rather than white: white text is still white
   text if somebody changes the background. */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var drop = $('#drop'), file = $('#file'), controls = $('#controls'),
      statusEl = $('#status'), bar = $('#bar'), barFill = $('#barFill'),
      result = $('#result'), go = $('#go'), info = $('#info');

  var srcBuf = null, srcName = '', pageCount = 0;
  var outBlob = null, plainText = '';

  // printable ASCII only: the standard fonts are WinAnsi and pdf-lib throws on
  // anything it cannot encode, which would fail the whole document for one
  // stray character OCR invented
  function safeText(s) {
    return (s || '').replace(/[^\x20-\x7E]/g, '').trim();
  }

  function fmt(b) {
    if (b < 1000) return b + ' B';
    if (b < 1000000) return (b / 1000).toFixed(0) + ' KB';
    return (b / 1000000).toFixed(2) + ' MB';
  }
  function say(t) { statusEl.textContent = t; }
  function prog(p) {
    bar.classList.add('on');
    var v = Math.max(0, Math.min(100, p));
    barFill.style.width = v + '%';
    bar.setAttribute('aria-valuenow', Math.round(v));
  }

  /* ---------- lazy engine ---------- */
  var engine = null;
  function loadEngine() {
    if (engine) return engine;
    say('Fetching the OCR engine — about 9 MB, once…');
    engine = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = 'vendor/tesseract/tesseract.min.js';
      s.onload = function () { res(window.Tesseract); };
      s.onerror = function () {
        engine = null;
        rej(new Error('the OCR engine could not be downloaded'));
      };
      document.head.appendChild(s);
    });
    return engine;
  }

  /* ---------- intake ---------- */
  drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('over'); });
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
    say('Reading…');
    result.classList.remove('on');

    f.arrayBuffer().then(function (ab) {
      srcBuf = ab;
      return PDFLib.PDFDocument.load(ab, { ignoreEncryption: true });
    }).then(function (doc) {
      pageCount = doc.getPageCount();
      drop.querySelector('strong').textContent = f.name;
      drop.querySelector('small').textContent =
        pageCount + ' pages, ' + fmt(f.size) + ' — click to choose a different file';
      controls.classList.add('on');
      if (info) {
        info.textContent = pageCount + ' pages. OCR takes a second or two per page on a ' +
          'laptop and longer on a phone, and it all happens on your device.';
      }
      say('');
    }).catch(function (err) {
      console.error(err);
      say('Could not open this PDF: ' + (err && err.message ? err.message : 'unknown error') +
          '. If it is password-protected, remove the password first.');
    });
  }

  /* ---------- run ---------- */
  go.addEventListener('click', function () {
    if (!srcBuf) return;
    go.disabled = true;
    result.classList.remove('on');
    prog(2);

    var lang = $('#lang') ? $('#lang').value : 'eng';
    var worker = null, pdfDoc = null, outDoc = null, font = null;
    var texts = [], totalWords = 0;

    loadEngine()
      .then(function (T) {
        prog(8);
        say('Starting the OCR engine…');
        return T.createWorker(lang, 1, {
          workerPath: 'vendor/tesseract/worker.min.js',
          corePath: 'vendor/tesseract/',
          langPath: 'vendor/tesseract/',
          logger: function (m) {
            if (m.status === 'recognizing text') say('Reading the page…');
          }
        });
      })
      .then(function (w) {
        worker = w;
        return PDFThumbs.ensure();
      })
      .then(function () {
        return pdfjsLib.getDocument({ data: srcBuf.slice(0) }).promise;
      })
      .then(function (d) {
        pdfDoc = d;
        return PDFLib.PDFDocument.load(srcBuf.slice(0), { ignoreEncryption: true });
      })
      .then(function (od) {
        outDoc = od;
        return outDoc.embedFont(PDFLib.StandardFonts.Helvetica);
      })
      .then(function (f) {
        font = f;
        var chain = Promise.resolve();
        for (var n = 1; n <= pageCount; n++) {
          (function (pageNo) {
            chain = chain.then(function () {
              say('Page ' + pageNo + ' of ' + pageCount + '…');
              return doPage(pageNo);
            });
          })(n);
        }
        return chain;
      })
      .then(function () {
        say('Writing the searchable PDF…');
        return outDoc.save({ useObjectStreams: true });
      })
      .then(function (bytes) {
        prog(100);
        outBlob = new Blob([bytes], { type: 'application/pdf' });
        plainText = texts.join('\n\n');
        $('#rBig').textContent = totalWords.toLocaleString() +
          (totalWords === 1 ? ' word found' : ' words found') + ' — ' + fmt(outBlob.size);
        $('#rMeta').textContent = 'The pages are unchanged; a text layer was added on top ' +
          'of them, so the document looks identical and is now searchable. OCR is never ' +
          'perfect — check anything that matters, such as figures and names.';
        result.classList.add('on');
        $('#dlText').disabled = !plainText;
        say(''); bar.classList.remove('on'); go.disabled = false;
        if (worker) worker.terminate();
      })
      .catch(function (err) {
        console.error(err);
        say('Something went wrong: ' + (err && err.message ? err.message : 'unknown error'));
        bar.classList.remove('on'); go.disabled = false;
        if (worker) { try { worker.terminate(); } catch (e) {} }
      });

    function doPage(pageNo) {
      return pdfDoc.getPage(pageNo).then(function (page) {
        // 2x gives Tesseract enough pixels without making a phone crawl
        var vp = page.getViewport({ scale: 2 });
        var canvas = document.createElement('canvas');
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);

        return page.render({ canvasContext: ctx, viewport: vp }).promise
          .then(function () { return worker.recognize(canvas, {}, { blocks: true, text: true }); })
          .then(function (r) {
            texts.push((r.data.text || '').trim());

            var words = [];
            if (r.data.words && r.data.words.length) words = r.data.words;
            else {
              (r.data.blocks || []).forEach(function (b) {
                (b.paragraphs || []).forEach(function (p) {
                  (p.lines || []).forEach(function (l) {
                    (l.words || []).forEach(function (w) { words.push(w); });
                  });
                });
              });
            }

            var outPage = outDoc.getPage(pageNo - 1);
            var rot = 0;
            try { rot = outPage.getRotation().angle || 0; } catch (e) {}
            rot = ((rot % 360) + 360) % 360;

            words.forEach(function (w) {
              var t = safeText(w.text);
              if (!t || (w.confidence !== undefined && w.confidence < 30)) return;
              var b = w.bbox;
              if (!b) return;

              // let the viewport map canvas pixels back to page points: it
              // already knows the scale and the page rotation
              var bl = vp.convertToPdfPoint(b.x0, b.y1);
              var tl = vp.convertToPdfPoint(b.x0, b.y0);
              var size = Math.abs(tl[1] - bl[1]) || Math.abs(tl[0] - bl[0]);
              if (!(size > 0.5)) return;

              var opts = { x: bl[0], y: bl[1], size: size, font: font, opacity: 0 };
              if (rot) opts.rotate = PDFLib.degrees(rot);
              try { outPage.drawText(t, opts); totalWords++; } catch (e) {}
            });

            canvas.width = 0; canvas.height = 0;    // free the page render
            if (page.cleanup) { try { page.cleanup(); } catch (e) {} }
            prog(8 + (pageNo / pageCount) * 88);
          });
      });
    }
  });

  $('#dl').addEventListener('click', function () {
    if (!outBlob) return;
    var a = document.createElement('a');
    a.href = URL.createObjectURL(outBlob);
    a.download = srcName + '-searchable.pdf';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  });

  $('#dlText').addEventListener('click', function () {
    if (!plainText) return;
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([plainText], { type: 'text/plain;charset=utf-8' }));
    a.download = srcName + '.txt';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  });
})();
