/* SizeMyPDF - single-file compressor UI.
   The compression itself lives in compress-core.js, shared with the batch page. */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var drop = $('#drop'), file = $('#file'), controls = $('#controls'),
      statusEl = $('#status'), bar = $('#bar'), barFill = $('#barFill'),
      result = $('#result'), go = $('#go');

  var srcBytes = null, srcName = '', srcSize = 0, outBlob = null;
  var lastKeptText = true;

  function fmt(b) {
    if (b < 1000) return b + ' B';
    if (b < 1000000) return (b / 1000).toFixed(0) + ' KB';
    return (b / 1000000).toFixed(2) + ' MB';
  }
  function say(t) { statusEl.textContent = t; }

  /* The search explores an unknown number of scales, so true percentage
     progress is not knowable up front. Advance monotonically and ease off near
     the end - a bar that slides backwards reads as a failure. */
  var progress = 0;
  function prog(p) {
    progress = Math.max(0, Math.min(100, p));
    bar.classList.add('on');
    barFill.style.width = progress + '%';
    bar.setAttribute('aria-valuenow', Math.round(progress));
  }
  function bump(n) { prog(progress + (100 - progress) * (n / 100)); }

  /* Show page one of the result before the user commits to downloading it.
     Every user has one question after compressing - is it still readable -
     and a byte count does not answer it. */
  function showPreview() {
    var wrap = $('#preview'), canvas = $('#previewCanvas'), note = $('#previewNote');
    if (!wrap || !canvas || !outBlob) return;
    wrap.classList.remove('on');
    outBlob.arrayBuffer().then(function (ab) {
      return pdfjsLib.getDocument({ data: new Uint8Array(ab) }).promise;
    }).then(function (doc) { return doc.getPage(1); })
      .then(function (page) {
        var vp = page.getViewport({ scale: 1 });
        vp = page.getViewport({ scale: 360 / vp.width });
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return page.render({ canvasContext: ctx, viewport: vp }).promise;
      }).then(function () {
        note.textContent = lastKeptText
          ? 'Page 1 of the result. Text is still selectable in the file itself.'
          : 'Page 1 of the result. Check the smallest text and any signature before you submit it.';
        wrap.classList.add('on');
      }).catch(function (e) {
        console.error(e);   // a preview failure must never block the download
      });
  }

  /* ---------- size presets ----------
     The target size is the reason this site exists, so it is asked for before
     a file and the common limits are one tap. Everything a form actually
     demands is here; the box still takes any number. */
  var presets = [].slice.call(document.querySelectorAll('.preset'));
  var targetEl = $('#target');

  function paintPresets() {
    var v = parseInt(targetEl.value, 10);
    presets.forEach(function (b) {
      var on = parseInt(b.getAttribute('data-kb'), 10) === v;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  presets.forEach(function (b) {
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', function () {
      targetEl.value = b.getAttribute('data-kb');
      paintPresets();
      if (srcBytes) go.focus();     // file already chosen: next step is obvious
    });
  });
  targetEl.addEventListener('input', paintPresets);
  paintPresets();

  /* ---------- file intake ---------- */
  // the drop zone is a <label for="file">, so click and Enter/Space are handled
  // natively by the browser - a click listener here would double-fire
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

  /* Someone dropping a JPG here has not made an error, they have landed on
     the wrong tool - so point at the right one instead of refusing. This was
     the single most common way to hit a dead end on the site. */
  var ELSEWHERE = [
    [/^image\//, /\.(jpe?g|png|gif|bmp|webp|hei[cf])$/i,
     'That is an image, not a PDF.', 'jpg-to-pdf.html', 'Convert images to PDF'],
    [/zip|compressed/, /\.zip$/i,
     'That is a ZIP archive.', 'tools.html', 'See all tools'],
    [/word|officedocument|opendocument|msword/, /\.(docx?|odt|rtf|pptx?|xlsx?)$/i,
     'That is an Office document, not a PDF. Save or print it as a PDF first, then come back.',
     'tools.html', 'See all tools']
  ];

  function wrongTool(f) {
    for (var i = 0; i < ELSEWHERE.length; i++) {
      var r = ELSEWHERE[i];
      if (r[0].test(f.type || '') || r[1].test(f.name || '')) return r;
    }
    return null;
  }

  function accept(f) {
    if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) {
      var w = wrongTool(f);
      if (w) {
        statusEl.innerHTML = '';
        statusEl.appendChild(document.createTextNode(w[2] + ' '));
        var a = document.createElement('a');
        a.href = w[3]; a.textContent = w[4];
        statusEl.appendChild(a);
      } else {
        say('That does not look like a PDF file.');
      }
      return;
    }
    srcName = f.name.replace(/\.pdf$/i, '');
    srcSize = f.size;
    var fr = new FileReader();
    fr.onload = function () {
      srcBytes = new Uint8Array(fr.result);

      /* Until now this trusted the file name. A .pdf that is not a PDF - an
         export that failed, a download that stopped early, the wrong file
         entirely - was accepted without a murmur, and because it was tiny it
         then fell through the under-target shortcut and came back as
         "no compression needed". Somebody could be handed their own broken
         file back, told it was fine, and send it to a portal that rejects it.

         So read the header, then actually open it. Every other tool on the
         site opens the document at this point and says how many pages it has;
         this one showed only a size. */
      var head = new TextDecoder('latin1').decode(srcBytes.subarray(0, 1024));
      if (head.indexOf('%PDF-') === -1) {
        srcBytes = null;
        controls.classList.remove('on');
        say(srcSize === 0
          ? 'That file is empty. It may not have finished downloading.'
          : 'That file is named .pdf but is not a PDF inside. It may be a ' +
            'failed export or an incomplete download - try saving it again.');
        return;
      }

      PDFLib.PDFDocument.load(srcBytes.slice(0), { ignoreEncryption: true })
        .then(function (doc) { ready(doc.getPageCount()); })
        .catch(function (err) {
          srcBytes = null;
          controls.classList.remove('on');
          console.error(err);
          say('This PDF could not be opened: ' +
              (err && err.message ? err.message : 'unknown error') +
              '. If it is password-protected, remove the password first.');
        });
    };

    function ready(pageCount) {
      drop.querySelector('strong').textContent = f.name;
      drop.querySelector('small').textContent =
        pageCount + (pageCount === 1 ? ' page, ' : ' pages, ') + fmt(srcSize) +
        ' — click to choose a different file';
      controls.classList.add('on');
      result.classList.remove('on');
      var pv = $('#preview'); if (pv) pv.classList.remove('on');

      /* Say so before they commit to it, not after. The work is proportional
         to pixels, so a heavy scan and a long document are both slow, and the
         phone this site keeps talking about is several times slower again.
         Measured: a four page 7.5 MB scan is about half a minute on a laptop.
         This is a warning and not a limit - there is no server to protect, and
         a big file on a patient device still works. */
      var bulky = srcSize > 20 * 1000 * 1000;
      var long = pageCount > 50;
      // name the reason it will be slow, rather than calling a 12 KB file big
      var why = bulky && long ? 'a large file (' + fmt(srcSize) + ') and ' + pageCount + ' pages long'
              : bulky ? 'a large file (' + fmt(srcSize) + ')'
              : long ? pageCount + ' pages long'
              : '';
      say(why
        ? 'This is ' + why + ', so it will take a while: a minute or more on a ' +
          'laptop and several on a phone. It will still work, and Cancel stops ' +
          'it at any point.'
        : '');

      var t = $('#target');
      if (!t.value) t.value = Math.max(50, Math.round(srcSize / 1000 * 0.35));
    }
    fr.readAsArrayBuffer(f);
  }

  /* Somebody who searched for a size, landed on that page and pressed the
     button has already told us the number twice. Carrying it across the click
     means they do not have to type it a third time. Bounded rather than
     trusted, because it arrives in a URL anyone can edit. */
  (function () {
    var raw = new URLSearchParams(location.search).get('to');
    if (!raw) return;
    var kb = parseInt(raw, 10);
    if (!(kb >= 10 && kb <= 51200)) return;        // 10 KB to 50 MB
    var t = $('#target');
    if (!t) return;
    t.value = kb;
    paintPresets();
  })();

  /* ---------- run ---------- */
  go.addEventListener('click', function () {
    if (!srcBytes) return;
    var mode = $('#mode').value;
    var targetKB = parseInt($('#target').value, 10) || 200;
    // A form that says 250 KB may count 250,000 bytes or 256,000; nothing on
    // the page tells us which. Taking the smaller reading is the only one
    // that passes both, and costs 2.4% of quality to be certain.
    var targetBytes = Math.max(10, targetKB) * 1000;

    go.disabled = true;
    var cancelBtn = $('#cancel');
    if (cancelBtn) cancelBtn.hidden = false;
    result.classList.remove('on', 'miss');
    var pv = $('#preview'); if (pv) pv.classList.remove('on');

    /* A file already under the target needs no work. Rasterising it anyway can
       return something LARGER than the original - a 20 KB text PDF comes back
       as a 26 KB image - which is the opposite of what was asked for. */
    if (mode !== 'lossless' && srcSize <= targetBytes) {
      outBlob = new Blob([srcBytes.slice(0)], { type: 'application/pdf' });
      lastKeptText = true;
      $('#rBig').textContent = 'Already ' + fmt(srcSize) + ' — no compression needed';
      $('#rMeta').textContent = 'This file is under your ' + targetKB +
        ' KB target, so it is unchanged. Compressing it further would only lose quality.';
      result.classList.add('on');
      say(''); bar.classList.remove('on'); go.disabled = false;
      if (cancelBtn) cancelBtn.hidden = true;
      track({ mode: mode, target: Metrics.kb(targetKB), outcome: 'already-under',
              kept: 'text', took: '<1s' });
      showPreview();
      return;
    }

    progress = 0; prog(5);
    var startedAt = Date.now();

    var job = (mode === 'lossless')
      ? PDFCompress.repack(srcBytes).then(function (b) { return { bytes: b, keptText: true }; })
      : PDFCompress.toTarget(srcBytes, targetBytes, bump, say);

    job.then(function (res) {
      prog(100);
      var bytes = res && res.bytes;
      if (!bytes) {
        say('Could not process this PDF.');
        go.disabled = false;
        if (cancelBtn) cancelBtn.hidden = true;
        return;
      }
      outBlob = new Blob([bytes], { type: 'application/pdf' });
      lastKeptText = !!res.keptText;
      var pct = srcSize ? Math.round(((srcSize - outBlob.size) / srcSize) * 100) : 0;
      var hit = mode === 'lossless' || outBlob.size <= targetBytes;

      $('#rBig').textContent = hit
        ? fmt(outBlob.size) + '  —  ' + (pct > 0 ? pct + '% smaller' : 'no reduction possible')
        : 'Smallest achievable: ' + fmt(outBlob.size);
      $('#rMeta').textContent = hit
        ? ('Was ' + fmt(srcSize) + ', now ' + fmt(outBlob.size) + '. ' +
           (res.keptText
             ? 'Text is still selectable and searchable — nothing was rasterised.'
             : 'Pages were rasterised to reach the target, so the text layer is gone.'))
        : 'Could not reach ' + targetKB + ' KB without destroying legibility. ' +
          'This is the smallest sensible result.';
      result.classList.add('on');
      if (!hit) result.classList.add('miss');
      say(''); bar.classList.remove('on'); go.disabled = false;
      if (cancelBtn) cancelBtn.hidden = true;
      track({
        mode: mode,
        target: Metrics.kb(targetKB),
        outcome: hit ? 'hit' : 'miss',
        kept: res.keptText ? 'text' : 'raster',
        took: Metrics.ms(Date.now() - startedAt)
      });
      showPreview();
    }).catch(function (err) {
      bar.classList.remove('on'); go.disabled = false;
      if (cancelBtn) cancelBtn.hidden = true;
      // being asked to stop is not a fault and must not read like one
      if (err && err.message === 'cancelled') {
        say('Stopped. Your file is untouched.');
        return;
      }
      console.error(err);
      say('Something went wrong: ' + (err && err.message ? err.message : 'unknown error') +
          '. If the PDF is password-protected, remove the password first.');
    });
  });

  if ($('#cancel')) {
    $('#cancel').addEventListener('click', function () {
      say('Stopping…');
      this.disabled = true;
      PDFCompress.cancel();
      var self = this;
      // the promise rejects on the next tick; re-arm for the next run
      setTimeout(function () { self.disabled = false; }, 1500);
    });
  }

  $('#dl').addEventListener('click', function () {
    if (!outBlob) return;
    var a = document.createElement('a');
    a.href = URL.createObjectURL(outBlob);
    a.download = srcName + '-compressed.pdf';
    document.body.appendChild(a); a.click();
    // Sixty seconds, not one and a half. The browser takes its blob reference
    // when the download actually starts, and on a loaded phone that can be well
    // after the click - revoking first makes the download fail with nothing shown.
    // It costs no memory to wait: the blob is held in a variable here anyway, so
    // releasing the URL early frees nothing, and the page dropping takes both.
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 60000);
  });

  /* Never let counting break compressing: if metrics.js did not load, or
     storage is blocked, the job is unaffected. */
  function track(fields) {
    try {
      if (typeof Metrics === 'undefined') return;
      fields.engine = (PDFCompress.usingWorker && PDFCompress.usingWorker())
        ? 'worker' : 'main';
      Metrics.record('compress', fields);
    } catch (e) {}
  }

  $('#mode').addEventListener('change', function () {
    // lossless cannot promise a size, so the size picker has nothing to say
    $('#targetField').style.display = this.value === 'lossless' ? 'none' : '';
  });
})();
