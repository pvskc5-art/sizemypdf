/* SizeMyPDF - rotate PDF pages, entirely in the browser.
   Rotation is metadata: pdf-lib sets each page's /Rotate value, so nothing is
   re-encoded and the file is byte-for-byte as good as it started. */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var drop = $('#drop'), file = $('#file'), controls = $('#controls'),
      statusEl = $('#status'), result = $('#result'), go = $('#go'), info = $('#info');

  var srcBytes = null, srcName = '', pageCount = 0, outBlob = null;

  function fmt(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
    return (b / 1048576).toFixed(2) + ' MB';
  }
  function say(t) { statusEl.textContent = t; }

  drop.addEventListener('click', function () { file.click(); });
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
      srcBytes = ab;
      return PDFLib.PDFDocument.load(ab, { ignoreEncryption: true });
    }).then(function (doc) {
      pageCount = doc.getPageCount();
      drop.querySelector('strong').textContent = f.name;
      drop.querySelector('small').textContent =
        pageCount + ' pages, ' + fmt(f.size) + ' — click to choose a different file';
      info.textContent = 'This document has ' + pageCount +
        (pageCount === 1 ? ' page.' : ' pages.');
      $('#pages').placeholder = 'all, or 1-' + Math.min(3, pageCount);
      controls.classList.add('on');
      say('');
    }).catch(function (err) {
      console.error(err);
      say('Could not open this PDF: ' +
          (err && err.message ? err.message : 'unknown error') +
          '. If it is password-protected, remove the password first.');
    });
  }

  // "all" or "1-3, 5" -> zero-based indices
  function parsePages(text, max) {
    text = (text || '').trim();
    if (!text || text.toLowerCase() === 'all') {
      var all = [];
      for (var i = 0; i < max; i++) all.push(i);
      return { indices: all, bad: [] };
    }
    var out = [], seen = {}, bad = [];
    text.split(',').forEach(function (part) {
      part = part.trim();
      if (!part) return;
      var m = part.match(/^(\d+)\s*[-–]\s*(\d+)$/);
      if (m) {
        var a = +m[1], b = +m[2];
        if (a < 1 || b < 1 || a > max || b > max) { bad.push(part); return; }
        var step = a <= b ? 1 : -1;
        for (var i = a; step > 0 ? i <= b : i >= b; i += step) {
          if (!seen[i]) { seen[i] = 1; out.push(i - 1); }
        }
        return;
      }
      if (/^\d+$/.test(part)) {
        var n = +part;
        if (n < 1 || n > max) { bad.push(part); return; }
        if (!seen[n]) { seen[n] = 1; out.push(n - 1); }
        return;
      }
      bad.push(part);
    });
    return { indices: out, bad: bad };
  }

  go.addEventListener('click', function () {
    if (!srcBytes) return;
    var deg = parseInt($('#angle').value, 10);
    var parsed = parsePages($('#pages').value, pageCount);

    if (parsed.bad.length) {
      say('Could not understand: ' + parsed.bad.join(', ') +
          '. Use "all", or page numbers between 1 and ' + pageCount + ', like 1-3, 5.');
      return;
    }
    if (!parsed.indices.length) { say('No pages selected.'); return; }

    go.disabled = true;
    result.classList.remove('on');
    say('Rotating…');

    PDFLib.PDFDocument.load(srcBytes.slice(0), { ignoreEncryption: true })
      .then(function (doc) {
        var pages = doc.getPages();
        parsed.indices.forEach(function (i) {
          var p = pages[i];
          var current = p.getRotation().angle || 0;
          p.setRotation(PDFLib.degrees(((current + deg) % 360 + 360) % 360));
        });
        return doc.save({ useObjectStreams: true });
      })
      .then(function (bytes) {
        outBlob = new Blob([bytes], { type: 'application/pdf' });
        $('#rBig').textContent = parsed.indices.length +
          (parsed.indices.length === 1 ? ' page' : ' pages') +
          ' rotated ' + deg + '° — ' + fmt(outBlob.size);
        $('#rMeta').textContent =
          'Rotation is stored as page metadata, so nothing was re-encoded and no quality was lost.';
        result.classList.add('on');
        say(''); go.disabled = false;
      })
      .catch(function (err) {
        console.error(err);
        say('Something went wrong: ' + (err && err.message ? err.message : 'unknown error'));
        go.disabled = false;
      });
  });

  $('#dl').addEventListener('click', function () {
    if (!outBlob) return;
    var a = document.createElement('a');
    a.href = URL.createObjectURL(outBlob);
    a.download = srcName + '-rotated.pdf';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  });
})();
