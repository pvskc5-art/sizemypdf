/* SizeMyPDF - shared page-range parsing and PDF intake for the pdf-lib tools.
   Loaded before delete.js / pagenum.js / watermark.js, which each supply their
   own run() and label. Keeping the plumbing in one place stops three copies of
   the same range parser drifting apart. */
window.PageOps = (function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };

  function fmt(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
    return (b / 1048576).toFixed(2) + ' MB';
  }

  // "all" or "1-3, 5" -> zero-based indices, in the order written
  function parsePages(text, max, allowAll) {
    text = (text || '').trim();
    if (allowAll && (!text || text.toLowerCase() === 'all')) {
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

  /* Wire up the standard drop zone / controls / result panel that every one of
     these pages shares. `opts.run(doc, state)` returns saved bytes. */
  function init(opts) {
    var drop = $('#drop'), file = $('#file'), controls = $('#controls'),
        statusEl = $('#status'), result = $('#result'), go = $('#go'),
        info = $('#info');

    var state = { bytes: null, name: '', pageCount: 0 };
    var outBlob = null;

    function say(t) { statusEl.textContent = t; }
    // the drop zone is a <label for="file">, so the browser opens the
    // picker on click and on Enter/Space from the keyboard - no handler needed
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
      state.name = f.name.replace(/\.pdf$/i, '');
      say('Reading…');
      result.classList.remove('on');
      f.arrayBuffer().then(function (ab) {
        state.bytes = ab;
        return PDFLib.PDFDocument.load(ab, { ignoreEncryption: true });
      }).then(function (doc) {
        state.pageCount = doc.getPageCount();
        drop.querySelector('strong').textContent = f.name;
        drop.querySelector('small').textContent =
          state.pageCount + ' pages, ' + fmt(f.size) + ' — click to choose a different file';
        if (info) {
          info.textContent = 'This document has ' + state.pageCount +
            (state.pageCount === 1 ? ' page.' : ' pages.');
        }
        controls.classList.add('on');
        if (opts.onLoad) opts.onLoad(state);
        say('');
      }).catch(function (err) {
        console.error(err);
        say('Could not open this PDF: ' +
            (err && err.message ? err.message : 'unknown error') +
            '. If it is password-protected, remove the password first.');
      });
    }

    go.addEventListener('click', function () {
      if (!state.bytes) return;
      go.disabled = true;
      result.classList.remove('on');
      say(opts.working || 'Working…');

      Promise.resolve()
        .then(function () {
          return PDFLib.PDFDocument.load(state.bytes.slice(0), { ignoreEncryption: true });
        })
        .then(function (doc) { return opts.run(doc, state); })
        .then(function (r) {
          if (!r) { go.disabled = false; return; }   // run() reported its own error
          outBlob = new Blob([r.bytes], { type: 'application/pdf' });
          $('#rBig').textContent = r.headline + ' — ' + fmt(outBlob.size);
          $('#rMeta').textContent = r.meta || '';
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
      a.download = state.name + '-' + (opts.suffix || 'edited') + '.pdf';
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    });

    return { state: state, say: say };
  }

  return { init: init, parsePages: parsePages, fmt: fmt };
})();
