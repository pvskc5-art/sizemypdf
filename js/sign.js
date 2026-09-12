/* SizeMyPDF - put a signature on a PDF.

   Draw it with a finger or a mouse, or type a name. Then click the page where
   it should go: the signature appears there and can be moved by clicking
   again, so placement is done by looking rather than by entering coordinates.

   Two things this deliberately is not. It is not a cryptographic signature -
   nothing here certifies who signed or detects later tampering, and the page
   says so, because a drawn squiggle presented as a "digital signature" is a
   misleading thing to sell. And nothing is uploaded, which for a signature
   matters more than for any other file on this site.

   Placement uses the pdf.js viewport's own convertToPdfPoint, so rotation and
   scale are handled by the library that already knows about them rather than
   by arithmetic here. */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var drop = $('#drop'), file = $('#file'), controls = $('#controls'),
      statusEl = $('#status'), result = $('#result'), go = $('#go'),
      pageCanvas = $('#pageCanvas'), ghost = $('#ghost'),
      pad = $('#pad'), info = $('#info');

  var srcBuf = null, srcName = '', pageCount = 0;
  var pdfDoc = null, viewport = null, pageNo = 1;
  var sigCanvas = null;          // the signature itself, transparent background
  var place = null;              // { x, y } in canvas pixels
  var outBlob = null;

  function fmt(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
    return (b / 1048576).toFixed(2) + ' MB';
  }
  function say(t) { statusEl.textContent = t; }

  /* ---------- the signature pad ---------- */
  var drawing = false, hasInk = false, ctxPad = null;

  function setupPad() {
    // a fixed backing size keeps the exported signature crisp whatever the
    // on-screen size happens to be
    pad.width = 600; pad.height = 200;
    ctxPad = pad.getContext('2d');
    clearPad();

    function pos(e) {
      var r = pad.getBoundingClientRect();
      var t = e.touches ? e.touches[0] : e;
      return { x: (t.clientX - r.left) * (pad.width / r.width),
               y: (t.clientY - r.top) * (pad.height / r.height) };
    }
    function start(e) {
      e.preventDefault(); drawing = true;
      var p = pos(e);
      ctxPad.beginPath(); ctxPad.moveTo(p.x, p.y);
    }
    function move(e) {
      if (!drawing) return;
      e.preventDefault();
      var p = pos(e);
      ctxPad.lineTo(p.x, p.y); ctxPad.stroke();
      hasInk = true;
    }
    function end() { drawing = false; if (hasInk) useDrawn(); }

    pad.addEventListener('mousedown', start);
    pad.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    pad.addEventListener('touchstart', start, { passive: false });
    pad.addEventListener('touchmove', move, { passive: false });
    pad.addEventListener('touchend', end);
  }

  function clearPad() {
    ctxPad.clearRect(0, 0, pad.width, pad.height);
    ctxPad.strokeStyle = '#111'; ctxPad.lineWidth = 3.2;
    ctxPad.lineCap = 'round'; ctxPad.lineJoin = 'round';
    hasInk = false;
  }

  /* Trim the transparent surround so the signature sits where it is put
     rather than inside a large invisible box. */
  function trimmed(src) {
    var w = src.width, h = src.height;
    var d = src.getContext('2d').getImageData(0, 0, w, h).data;
    var minX = w, minY = h, maxX = -1, maxY = -1;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] > 12) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    var m = 6;
    minX = Math.max(0, minX - m); minY = Math.max(0, minY - m);
    maxX = Math.min(w - 1, maxX + m); maxY = Math.min(h - 1, maxY + m);
    var out = document.createElement('canvas');
    out.width = maxX - minX + 1; out.height = maxY - minY + 1;
    out.getContext('2d').drawImage(src, minX, minY, out.width, out.height,
                                   0, 0, out.width, out.height);
    return out;
  }

  function useDrawn() {
    sigCanvas = trimmed(pad);
    reflect();
  }

  function useTyped() {
    var name = ($('#typed').value || '').trim();
    if (!name) { sigCanvas = null; reflect(); return; }
    var c = document.createElement('canvas');
    c.width = 1200; c.height = 300;
    var ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#111';
    ctx.textBaseline = 'middle';
    // a cursive face if the device has one, falling back to italic serif
    ctx.font = 'italic 120px "Segoe Script","Brush Script MT","Snell Roundhand",cursive,Georgia,serif';
    var tw = ctx.measureText(name).width;
    if (tw > c.width - 40) {
      ctx.font = 'italic ' + Math.floor(120 * (c.width - 40) / tw) +
                 'px "Segoe Script","Brush Script MT","Snell Roundhand",cursive,Georgia,serif';
    }
    ctx.fillText(name, 20, c.height / 2);
    sigCanvas = trimmed(c);
    reflect();
  }

  $('#typed').addEventListener('input', useTyped);
  $('#clearpad').addEventListener('click', function () {
    clearPad(); sigCanvas = null; $('#typed').value = ''; reflect();
  });

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
    place = null;

    f.arrayBuffer().then(function (ab) {
      srcBuf = ab;
      return PDFThumbs.ensure();
    }).then(function () {
      return pdfjsLib.getDocument({ data: srcBuf.slice(0) }).promise;
    }).then(function (doc) {
      pdfDoc = doc;
      pageCount = doc.numPages;
      pageNo = pageCount;                 // signatures usually go on the last page
      var sel = $('#pageNo');
      sel.innerHTML = '';
      for (var i = 1; i <= pageCount; i++) {
        var o = document.createElement('option');
        o.value = i; o.textContent = 'Page ' + i + (i === pageCount ? ' (last)' : '');
        sel.appendChild(o);
      }
      sel.value = pageNo;
      drop.querySelector('strong').textContent = f.name;
      drop.querySelector('small').textContent =
        pageCount + ' pages — click to choose a different file';
      controls.classList.add('on');
      setupPad();
      return showPage();
    }).catch(function (err) {
      console.error(err);
      say('Could not open this PDF: ' + (err && err.message ? err.message : 'unknown error') +
          '. If it is password-protected, remove the password first.');
    });
  }

  $('#pageNo').addEventListener('change', function () {
    pageNo = parseInt(this.value, 10) || 1;
    place = null;
    showPage();
  });

  function showPage() {
    return pdfDoc.getPage(pageNo).then(function (page) {
      var vp = page.getViewport({ scale: 1 });
      viewport = page.getViewport({ scale: Math.min(1.6, 560 / vp.width) });
      pageCanvas.width = Math.floor(viewport.width);
      pageCanvas.height = Math.floor(viewport.height);
      var ctx = pageCanvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      return page.render({ canvasContext: ctx, viewport: viewport }).promise
        .then(function () { say(''); reflect(); });
    });
  }

  /* ---------- placing ---------- */
  pageCanvas.addEventListener('click', function (e) {
    if (!sigCanvas) { say('Draw or type a signature first, then click where it goes.'); return; }
    var r = pageCanvas.getBoundingClientRect();
    place = { x: (e.clientX - r.left) * (pageCanvas.width / r.width),
              y: (e.clientY - r.top) * (pageCanvas.height / r.height) };
    reflect();
  });

  function sigWidthPx() {
    var pct = parseInt($('#size').value, 10) || 30;
    return pageCanvas.width * (pct / 100);
  }

  function reflect() {
    if (!sigCanvas || !place || !pageCanvas.width) {
      ghost.style.display = 'none';
      go.disabled = true;
      if (info) {
        info.textContent = !sigCanvas
          ? 'Draw a signature above, or type your name, then click the page.'
          : 'Now click the page where the signature should go.';
      }
      return;
    }
    var w = sigWidthPx();
    var h = w * (sigCanvas.height / sigCanvas.width);
    ghost.style.display = 'block';
    ghost.style.width = w + 'px';
    ghost.style.height = h + 'px';
    // place() is the centre of the signature, which is how people aim
    ghost.style.left = (place.x - w / 2) + 'px';
    ghost.style.top = (place.y - h / 2) + 'px';
    ghost.style.backgroundImage = 'url(' + sigCanvas.toDataURL('image/png') + ')';
    go.disabled = false;
    if (info) info.textContent = 'Click again to move it. Adjust the size if it needs it.';
  }

  $('#size').addEventListener('input', reflect);

  /* ---------- sign ---------- */
  go.addEventListener('click', function () {
    if (!srcBuf || !sigCanvas || !place || !viewport) return;
    go.disabled = true;
    say('Adding the signature…');
    result.classList.remove('on');

    var wPx = sigWidthPx();
    var hPx = wPx * (sigCanvas.height / sigCanvas.width);
    // the viewport knows about scale and /Rotate, so let it do the conversion
    var tl = viewport.convertToPdfPoint(place.x - wPx / 2, place.y - hPx / 2);
    var br = viewport.convertToPdfPoint(place.x + wPx / 2, place.y + hPx / 2);
    var px = Math.min(tl[0], br[0]), py = Math.min(tl[1], br[1]);
    var pw = Math.abs(br[0] - tl[0]), ph = Math.abs(br[1] - tl[1]);

    var dataUrl = sigCanvas.toDataURL('image/png');

    PDFLib.PDFDocument.load(srcBuf.slice(0), { ignoreEncryption: true })
      .then(function (doc) {
        return doc.embedPng(dataUrl).then(function (img) {
          var page = doc.getPage(pageNo - 1);
          var rot = 0;
          try { rot = page.getRotation().angle || 0; } catch (e) {}
          // a rotated page needs the stamp turned the other way to look upright
          var opts = { x: px, y: py, width: pw, height: ph };
          if (rot % 360 !== 0) {
            var r = ((rot % 360) + 360) % 360;
            if (r === 90)  { opts = { x: px + pw, y: py, width: ph, height: pw,
                                      rotate: PDFLib.degrees(90) }; }
            if (r === 180) { opts = { x: px + pw, y: py + ph, width: pw, height: ph,
                                      rotate: PDFLib.degrees(180) }; }
            if (r === 270) { opts = { x: px, y: py + ph, width: ph, height: pw,
                                      rotate: PDFLib.degrees(270) }; }
          }
          page.drawImage(img, opts);
          return doc.save({ useObjectStreams: true });
        });
      })
      .then(function (bytes) {
        outBlob = new Blob([bytes], { type: 'application/pdf' });
        $('#rBig').textContent = 'Signed page ' + pageNo + ' — ' + fmt(outBlob.size);
        $('#rMeta').textContent = 'The signature is drawn onto the page as an image. ' +
          'This is a visible signature, not a cryptographic one — it does not certify ' +
          'who signed or detect later changes.';
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
    a.download = srcName + '-signed.pdf';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  });
})();
