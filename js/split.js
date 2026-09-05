/* SizeMyPDF - split a PDF, entirely in the browser.
   pdf-lib only: splitting copies page objects and never rasterises, so text,
   links and quality survive untouched. */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var drop = $('#drop'), file = $('#file'), controls = $('#controls'),
      statusEl = $('#status'), bar = $('#bar'), barFill = $('#barFill'),
      outputs = $('#outputs'), go = $('#go'), info = $('#info');

  var srcBuf = null, srcName = '', pageCount = 0;
  var thumbApi = null;

  function fmt(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
    return (b / 1048576).toFixed(2) + ' MB';
  }
  function say(t) { statusEl.textContent = t; }
  function prog(p) {
    bar.classList.add('on');
    barFill.style.width = Math.max(0, Math.min(100, p)) + '%';
    bar.setAttribute('aria-valuenow', Math.round(Math.max(0, Math.min(100, p))));
  }

  /* ---------- intake ---------- */
    // the drop zone is a <label for="file">, so the browser opens the
    // picker on click and on Enter/Space from the keyboard - no handler needed
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
    say('Reading…');
    outputs.innerHTML = '';
    f.arrayBuffer().then(function (ab) {
      srcBuf = ab;
      return PDFLib.PDFDocument.load(ab, { ignoreEncryption: true });
    }).then(function (doc) {
      pageCount = doc.getPageCount();
      drop.querySelector('strong').textContent = f.name;
      drop.querySelector('small').textContent =
        pageCount + ' pages, ' + fmt(f.size) + ' — click to choose a different file';
      info.textContent = 'This document has ' + pageCount +
        (pageCount === 1 ? ' page.' : ' pages.');
      $('#range').placeholder = '1-' + Math.min(3, pageCount) +
        (pageCount > 4 ? ', ' + pageCount : '');
      controls.classList.add('on');
      say('');
      buildThumbs(srcBuf);
    }).catch(function (err) {
      console.error(err);
      say('Could not open this PDF: ' +
          (err && err.message ? err.message : 'unknown error') +
          '. If it is password-protected, remove the password first.');
    });
  }

  /* ---------- thumbnails ----------
     Clicking pages and typing page numbers are the same action expressed two
     ways, so they write to each other rather than being separate features. */
  function buildThumbs(ab) {
    var box = $('#thumbs');
    if (!box || typeof PDFThumbs === 'undefined') return;
    thumbApi = null;
    var hint = $('#thumbHint');
    if (hint) { hint.style.display = ''; hint.textContent = 'Loading page previews…'; }

    PDFThumbs.grid(box, ab, {
      onChange: function (pages) {
        // a click only makes sense as a range, so switch the mode to match
        $('#mode').value = 'range';
        $('#rangeField').style.display = '';
        $('#chunkField').style.display = 'none';
        $('#range').value = PDFThumbs.toRanges(pages);
      }
    }).then(function (api) {
      thumbApi = api;
      if (hint) hint.textContent = 'Click pages to choose them, or type the numbers below.';
    }).catch(function (err) {
      console.error(err);
      // previews are a convenience - splitting must still work without them
      if (hint) hint.textContent = 'Page previews could not be loaded, but splitting still works.';
    });
  }

  $('#range').addEventListener('input', function () {
    if (!thumbApi) return;
    var p = parseRange(this.value, pageCount);
    thumbApi.setSelection(p.indices.map(function (i) { return i + 1; }));
  });

  /* ---------- range parsing ---------- */
  // "1-3, 5, 8-10" -> zero-based indices, de-duplicated, in the order given.
  function parseRange(text, max) {
    var out = [], seen = {}, bad = [];
    text.split(',').forEach(function (part) {
      part = part.trim();
      if (!part) return;
      var m = part.match(/^(\d+)\s*[-–]\s*(\d+)$/);
      if (m) {
        var a = parseInt(m[1], 10), b = parseInt(m[2], 10);
        if (a < 1 || b < 1 || a > max || b > max) { bad.push(part); return; }
        var step = a <= b ? 1 : -1;
        for (var i = a; step > 0 ? i <= b : i >= b; i += step) {
          if (!seen[i]) { seen[i] = 1; out.push(i - 1); }
        }
        return;
      }
      if (/^\d+$/.test(part)) {
        var n = parseInt(part, 10);
        if (n < 1 || n > max) { bad.push(part); return; }
        if (!seen[n]) { seen[n] = 1; out.push(n - 1); }
        return;
      }
      bad.push(part);
    });
    return { indices: out, bad: bad };
  }

  /* ---------- outputs ---------- */
  function addOutput(label, bytes, filename) {
    var blob = new Blob([bytes], { type: 'application/pdf' });
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = label + '  ·  ' + fmt(blob.size);
    b.addEventListener('click', function () {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    });
    outputs.appendChild(b);
  }

  function buildFrom(indices) {
    return PDFLib.PDFDocument.load(srcBuf.slice(0), { ignoreEncryption: true })
      .then(function (src) {
        return PDFLib.PDFDocument.create().then(function (out) {
          return out.copyPages(src, indices).then(function (pages) {
            pages.forEach(function (p) { out.addPage(p); });
            return out.save({ useObjectStreams: true });
          });
        });
      });
  }

  /* ---------- run ---------- */
  go.addEventListener('click', function () {
    if (!srcBuf) return;
    var mode = $('#mode').value;
    outputs.innerHTML = '';
    go.disabled = true;
    prog(5);

    var job;
    if (mode === 'range') {
      var parsed = parseRange($('#range').value, pageCount);
      if (parsed.bad.length) {
        say('Could not understand: ' + parsed.bad.join(', ') +
            '. Use page numbers between 1 and ' + pageCount +
            ', like 1-3, 5, 8-10.');
        bar.classList.remove('on'); go.disabled = false; return;
      }
      if (!parsed.indices.length) {
        say('Enter which pages you want, for example 1-3, 5.');
        bar.classList.remove('on'); go.disabled = false; return;
      }
      say('Extracting ' + parsed.indices.length + ' pages…');
      job = buildFrom(parsed.indices).then(function (bytes) {
        addOutput(parsed.indices.length + ' pages', bytes, srcName + '-pages.pdf');
        return { count: 1, pages: parsed.indices.length };
      });

    } else {
      var per = Math.max(1, parseInt($('#chunk').value, 10) || 1);
      var groups = [];
      for (var i = 0; i < pageCount; i += per) {
        var g = [];
        for (var j = i; j < Math.min(i + per, pageCount); j++) g.push(j);
        groups.push(g);
      }
      if (groups.length > 60) {
        say('That would produce ' + groups.length +
            ' files. Use a larger pages-per-file value, or extract a range instead.');
        bar.classList.remove('on'); go.disabled = false; return;
      }
      say('Splitting into ' + groups.length + ' files…');
      var chain = Promise.resolve(), n = 0;
      groups.forEach(function (g, idx) {
        chain = chain.then(function () {
          return buildFrom(g).then(function (bytes) {
            var label = g.length === 1
              ? 'Page ' + (g[0] + 1)
              : 'Pages ' + (g[0] + 1) + '-' + (g[g.length - 1] + 1);
            addOutput(label, bytes, srcName + '-' + (idx + 1) + '.pdf');
            n++;
            prog(5 + (n / groups.length) * 90);
          });
        });
      });
      job = chain.then(function () { return { count: groups.length, pages: pageCount }; });
    }

    job.then(function (r) {
      prog(100);
      say(r.count === 1
        ? 'Done — click below to download.'
        : 'Done — ' + r.count + ' files ready. Click each to download.');
      bar.classList.remove('on'); go.disabled = false;
    }).catch(function (err) {
      console.error(err);
      say('Something went wrong: ' + (err && err.message ? err.message : 'unknown error'));
      bar.classList.remove('on'); go.disabled = false;
    });
  });

  $('#mode').addEventListener('change', function () {
    var range = this.value === 'range';
    $('#rangeField').style.display = range ? '' : 'none';
    $('#chunkField').style.display = range ? 'none' : '';
  });
})();
