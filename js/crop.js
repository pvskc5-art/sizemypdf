/* SizeMyPDF - crop the margins off a PDF.

   Cropping blind is guesswork, so page one is rendered with the crop drawn on
   top of it and the margins update the overlay as you change them. "Detect
   content" measures where the ink actually stops by scanning the rendered
   pixels, which is the case that matters: a phone photo or a flatbed scan
   with two centimetres of grey border round a document.

   Lossless. Cropping sets the page's crop and media boxes - the content is
   untouched, so text stays selectable. It is also reversible in principle,
   since nothing is deleted, only hidden outside the new box. */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var drop = $('#drop'), file = $('#file'), controls = $('#controls'),
      statusEl = $('#status'), result = $('#result'), go = $('#go'),
      info = $('#info'), canvas = $('#cropCanvas'), overlay = $('#cropBox');

  var srcBuf = null, srcName = '', pageCount = 0;
  var basePage = null;        // rendered page 1, for the preview
  var pageRot = 0;
  var outBlob = null;

  var SIDES = ['top', 'right', 'bottom', 'left'];

  function fmt(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
    return (b / 1048576).toFixed(2) + ' MB';
  }
  function say(t) { statusEl.textContent = t; }

  function margins() {
    var m = {};
    SIDES.forEach(function (s) {
      var v = parseFloat($('#m-' + s).value);
      m[s] = isNaN(v) ? 0 : Math.max(0, Math.min(45, v));
    });
    return m;
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
      $('#range').placeholder = 'all, or 1-' + pageCount;
      controls.classList.add('on');
      say('Rendering page 1…');
      return renderFirst().then(function () { say(''); paint(); });
    }).catch(function (err) {
      console.error(err);
      say('Could not open this PDF: ' + (err && err.message ? err.message : 'unknown error') +
          '. If it is password-protected, remove the password first.');
    });
  }

  function renderFirst() {
    return PDFThumbs.ensure().then(function () {
      return pdfjsLib.getDocument({ data: srcBuf.slice(0) }).promise;
    }).then(function (doc) {
      return doc.getPage(1).then(function (page) {
        pageRot = page.rotate || 0;
        // the viewport already accounts for /Rotate, so the preview shows the
        // page the way a reader would display it
        var vp = page.getViewport({ scale: 1 });
        vp = page.getViewport({ scale: Math.min(1.6, 520 / vp.width) });
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        return page.render({ canvasContext: ctx, viewport: vp }).promise
          .then(function () { basePage = canvas; });
      });
    });
  }

  /* ---------- preview ---------- */
  function paint() {
    if (!basePage) return;
    var m = margins();
    overlay.style.left = m.left + '%';
    overlay.style.right = m.right + '%';
    overlay.style.top = m.top + '%';
    overlay.style.bottom = m.bottom + '%';

    var keptW = (100 - m.left - m.right), keptH = (100 - m.top - m.bottom);
    var area = Math.round(keptW * keptH / 100);
    if (info) {
      info.textContent = keptW <= 0 || keptH <= 0
        ? 'Those margins remove the whole page.'
        : 'Keeping ' + Math.round(keptW) + '% of the width and ' +
          Math.round(keptH) + '% of the height — about ' + area + '% of the page.';
    }
    go.disabled = keptW <= 0 || keptH <= 0;
  }

  SIDES.forEach(function (s) {
    $('#m-' + s).addEventListener('input', paint);
  });

  /* ---------- detect content ----------
     Scan the rendered page for the bounding box of anything that is not
     near-white, then pad it slightly. This is what makes the tool useful on
     scans, where the margin is whatever the scanner lid happened to include. */
  $('#detect').addEventListener('click', function () {
    if (!basePage) return;
    var w = basePage.width, h = basePage.height;
    var d = basePage.getContext('2d').getImageData(0, 0, w, h).data;
    var minX = w, minY = h, maxX = -1, maxY = -1;
    var THRESH = 244;                       // anything darker than this is ink
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = (y * w + x) * 4;
        if (d[i] < THRESH || d[i + 1] < THRESH || d[i + 2] < THRESH) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) { say('This page looks blank, so there is nothing to crop to.'); return; }

    var pad = 0.01;                          // leave a hair of white around it
    var vals = {
      left:   Math.max(0, minX / w - pad) * 100,
      right:  Math.max(0, (w - 1 - maxX) / w - pad) * 100,
      top:    Math.max(0, minY / h - pad) * 100,
      bottom: Math.max(0, (h - 1 - maxY) / h - pad) * 100
    };
    SIDES.forEach(function (s) { $('#m-' + s).value = vals[s].toFixed(1); });
    paint();
    say('Margins set to where the content actually stops. Adjust them if the crop is tight.');
  });

  $('#reset').addEventListener('click', function () {
    SIDES.forEach(function (s) { $('#m-' + s).value = '0'; });
    paint(); say('');
  });

  /* ---------- which pages ---------- */
  function wanted() {
    var txt = ($('#range').value || '').trim();
    if (!txt || /^all$/i.test(txt)) {
      var all = [];
      for (var i = 0; i < pageCount; i++) all.push(i);
      return { indices: all, bad: [] };
    }
    return PageOps.parsePages(txt, pageCount, false);
  }

  /* A page with /Rotate is displayed turned, so the margin the reader calls
     "top" is not the top of the page's own coordinate space. Map it. */
  function mapMargins(rot, m) {
    rot = ((rot % 360) + 360) % 360;
    /* /Rotate 90 turns the content clockwise for display, so the page's own
       left edge is what the reader sees along the top: a visual top margin has
       to be taken off the PDF left. 270 is the same argument the other way.
       These two were the wrong way round at first, which cropped the opposite
       edge and was only obvious from the resulting media box. */
    if (rot === 90)  return { left: m.top, top: m.right, right: m.bottom, bottom: m.left };
    if (rot === 180) return { top: m.bottom, right: m.left, bottom: m.top, left: m.right };
    if (rot === 270) return { left: m.bottom, top: m.left, right: m.top, bottom: m.right };
    return m;
  }

  /* ---------- run ---------- */
  go.addEventListener('click', function () {
    if (!srcBuf) return;
    var m = margins();
    var sel = wanted();
    if (sel.bad && sel.bad.length) {
      say('Could not understand: ' + sel.bad.join(', ') +
          '. Use "all", or page numbers like 1-3, 5.');
      return;
    }
    if (!sel.indices.length) { say('No pages selected.'); return; }

    go.disabled = true;
    say('Cropping ' + sel.indices.length +
        (sel.indices.length === 1 ? ' page…' : ' pages…'));
    result.classList.remove('on');

    PDFLib.PDFDocument.load(srcBuf.slice(0), { ignoreEncryption: true })
      .then(function (doc) {
        var keep = {};
        sel.indices.forEach(function (i) { keep[i] = true; });
        var applied = 0;

        doc.getPages().forEach(function (page, i) {
          if (!keep[i]) return;
          var box;
          try { box = page.getMediaBox(); }
          catch (e) { var s = page.getSize(); box = { x: 0, y: 0, width: s.width, height: s.height }; }

          var rot = 0;
          try { rot = page.getRotation().angle || 0; } catch (e) {}
          var pm = mapMargins(rot, m);

          var x = box.x + box.width * (pm.left / 100);
          var y = box.y + box.height * (pm.bottom / 100);
          var w = box.width * (1 - pm.left / 100 - pm.right / 100);
          var h = box.height * (1 - pm.top / 100 - pm.bottom / 100);
          if (w <= 1 || h <= 1) return;      // refuse to make a page disappear

          page.setCropBox(x, y, w, h);
          page.setMediaBox(x, y, w, h);
          applied++;
        });

        return doc.save({ useObjectStreams: true }).then(function (bytes) {
          return { bytes: bytes, applied: applied };
        });
      })
      .then(function (r) {
        outBlob = new Blob([r.bytes], { type: 'application/pdf' });
        $('#rBig').textContent = r.applied +
          (r.applied === 1 ? ' page cropped' : ' pages cropped') + ' — ' + fmt(outBlob.size);
        $('#rMeta').textContent = 'The content was not re-encoded, so text stays selectable. ' +
          'Cropping hides the margin rather than deleting it, so the file may not get ' +
          'much smaller — run it through the compressor if you need a specific size.';
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
    a.download = srcName + '-cropped.pdf';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  });
})();
