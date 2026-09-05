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
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
    return (b / 1048576).toFixed(2) + ' MB';
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

  function accept(f) {
    if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) {
      say('That does not look like a PDF file.'); return;
    }
    srcName = f.name.replace(/\.pdf$/i, '');
    srcSize = f.size;
    var fr = new FileReader();
    fr.onload = function () {
      srcBytes = new Uint8Array(fr.result);
      drop.querySelector('strong').textContent = f.name;
      drop.querySelector('small').textContent =
        fmt(srcSize) + ' — click to choose a different file';
      controls.classList.add('on');
      result.classList.remove('on');
      var pv = $('#preview'); if (pv) pv.classList.remove('on');
      say('');
      var t = $('#target');
      if (!t.value) t.value = Math.max(50, Math.round(srcSize / 1024 * 0.35));
    };
    fr.readAsArrayBuffer(f);
  }

  /* ---------- run ---------- */
  go.addEventListener('click', function () {
    if (!srcBytes) return;
    var mode = $('#mode').value;
    var targetKB = parseInt($('#target').value, 10) || 200;
    var targetBytes = Math.max(10, targetKB) * 1024;

    go.disabled = true;
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
      showPreview();
      return;
    }

    progress = 0; prog(5);

    var job = (mode === 'lossless')
      ? PDFCompress.repack(srcBytes).then(function (b) { return { bytes: b, keptText: true }; })
      : PDFCompress.toTarget(srcBytes, targetBytes, bump, say);

    job.then(function (res) {
      prog(100);
      var bytes = res && res.bytes;
      if (!bytes) { say('Could not process this PDF.'); go.disabled = false; return; }
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
      showPreview();
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
