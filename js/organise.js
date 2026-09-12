/* SizeMyPDF - reorder, rotate and remove pages in one view.

   Delete-pages and Rotate already exist as single-purpose tools, but neither
   lets you see the document while you work on it, and reordering was not
   possible at all. This is the page-management view: every page on screen,
   moved and turned and dropped in place, then saved once.

   Lossless. Pages are copied as objects and rotation is a number in the page
   dictionary, so nothing is re-encoded and text stays selectable. */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var drop = $('#drop'), file = $('#file'), controls = $('#controls'),
      statusEl = $('#status'), grid = $('#pagegrid'), go = $('#go'),
      result = $('#result'), info = $('#info');

  var srcBuf = null, srcName = '', pageCount = 0;
  var baseCanvases = [];      // one render per source page, reused by the tiles
  var order = [];             // [{ src: 0-based source index, rot: 0|90|180|270 }]
  var outBlob = null;

  function fmt(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
    return (b / 1048576).toFixed(2) + ' MB';
  }
  function say(t) { statusEl.textContent = t; }

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
    grid.textContent = '';
    baseCanvases = [];

    f.arrayBuffer().then(function (ab) {
      srcBuf = ab;
      return PDFLib.PDFDocument.load(ab, { ignoreEncryption: true });
    }).then(function (doc) {
      pageCount = doc.getPageCount();
      if (pageCount > 200) {
        say('This document has ' + pageCount + ' pages, which is more than this ' +
            'view can show at once. Split it first, then organise the parts.');
        return;
      }
      order = [];
      for (var i = 0; i < pageCount; i++) order.push({ src: i, rot: 0 });
      drop.querySelector('strong').textContent = f.name;
      drop.querySelector('small').textContent =
        pageCount + ' pages, ' + fmt(f.size) + ' — click to choose a different file';
      if (info) info.textContent = 'Drag is not needed: use the arrows to move a page, ' +
        'the circle to turn it, and the cross to drop it.';
      controls.classList.add('on');
      say('Loading page previews…');
      return renderBase().then(function () { say(''); paint(); });
    }).catch(function (err) {
      console.error(err);
      say('Could not open this PDF: ' + (err && err.message ? err.message : 'unknown error') +
          '. If it is password-protected, remove the password first.');
    });
  }

  /* Render each source page once at thumbnail size. Tiles then draw from these
     rather than re-rendering, so turning a page or moving it is instant. */
  function renderBase() {
    return PDFThumbs.ensure().then(function () {
      return pdfjsLib.getDocument({ data: srcBuf.slice(0) }).promise;
    }).then(function (doc) {
      var chain = Promise.resolve();
      for (var i = 1; i <= doc.numPages; i++) {
        (function (n) {
          chain = chain.then(function () {
            return doc.getPage(n).then(function (page) {
              var vp = page.getViewport({ scale: 1 });
              vp = page.getViewport({ scale: 96 / vp.width });
              var c = document.createElement('canvas');
              c.width = Math.max(1, Math.floor(vp.width));
              c.height = Math.max(1, Math.floor(vp.height));
              var ctx = c.getContext('2d');
              ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
              return page.render({ canvasContext: ctx, viewport: vp }).promise
                .then(function () {
                  baseCanvases[n - 1] = c;
                  if (page.cleanup) { try { page.cleanup(); } catch (e) {} }
                });
            });
          });
        })(i);
      }
      return chain;
    });
  }

  /* ---------- the grid ---------- */
  function drawTile(canvas, srcIdx, rot) {
    var base = baseCanvases[srcIdx];
    if (!base) return;
    var swap = (rot === 90 || rot === 270);
    canvas.width = swap ? base.height : base.width;
    canvas.height = swap ? base.width : base.height;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(rot * Math.PI / 180);
    ctx.drawImage(base, -base.width / 2, -base.height / 2);
    ctx.restore();
  }

  function iconBtn(label, title, disabled, fn) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'iconbtn';
    b.textContent = label; b.title = title;
    b.setAttribute('aria-label', title);
    b.disabled = !!disabled;
    b.addEventListener('click', fn);
    return b;
  }

  function paint() {
    grid.textContent = '';
    if (!order.length) {
      say('Every page has been removed. Reload the file to start again.');
      go.disabled = true;
      return;
    }
    go.disabled = false;

    order.forEach(function (item, pos) {
      var tile = document.createElement('div');
      tile.className = 'ptile';

      var shell = document.createElement('div');
      shell.className = 'sh';
      var canvas = document.createElement('canvas');
      shell.appendChild(canvas);
      drawTile(canvas, item.src, item.rot);

      var bar = document.createElement('div');
      bar.className = 'ptools';
      bar.appendChild(iconBtn('←', 'Move page ' + (pos + 1) + ' earlier', pos === 0, function () {
        var t = order[pos - 1]; order[pos - 1] = order[pos]; order[pos] = t; paint();
      }));
      bar.appendChild(iconBtn('↻', 'Turn page ' + (pos + 1), false, function () {
        item.rot = (item.rot + 90) % 360; paint();
      }));
      bar.appendChild(iconBtn('→', 'Move page ' + (pos + 1) + ' later',
        pos === order.length - 1, function () {
        var t = order[pos + 1]; order[pos + 1] = order[pos]; order[pos] = t; paint();
      }));
      var del = iconBtn('×', 'Remove page ' + (pos + 1), false, function () {
        order.splice(pos, 1); paint();
      });
      del.className = 'iconbtn del';
      bar.appendChild(del);

      var label = document.createElement('div');
      label.className = 'pnum';
      // the original page number, so it is clear what moved where
      label.textContent = (pos + 1) + (item.src !== pos ? ' (was ' + (item.src + 1) + ')' : '');

      tile.appendChild(shell);
      tile.appendChild(label);
      tile.appendChild(bar);
      grid.appendChild(tile);
    });

    var moved = order.some(function (it, i) { return it.src !== i; });
    var rotated = order.some(function (it) { return it.rot !== 0; });
    var removed = pageCount - order.length;
    go.textContent = 'Save ' + order.length + (order.length === 1 ? ' page' : ' pages');
    if (info) {
      info.textContent = order.length + ' of ' + pageCount + ' pages' +
        (removed ? ', ' + removed + ' removed' : '') +
        (moved ? ', order changed' : '') +
        (rotated ? ', some turned' : '') + '.';
    }
  }

  /* ---------- save ---------- */
  go.addEventListener('click', function () {
    if (!srcBuf || !order.length) return;
    go.disabled = true;
    say('Building the PDF…');
    result.classList.remove('on');

    PDFLib.PDFDocument.load(srcBuf.slice(0), { ignoreEncryption: true })
      .then(function (src) {
        return PDFLib.PDFDocument.create().then(function (out) {
          return out.copyPages(src, order.map(function (i) { return i.src; }))
            .then(function (pages) {
              pages.forEach(function (p, i) {
                var extra = order[i].rot;
                if (extra) {
                  // add to whatever rotation the page already carried
                  var existing = 0;
                  try { existing = p.getRotation().angle || 0; } catch (e) {}
                  p.setRotation(PDFLib.degrees((existing + extra) % 360));
                }
                out.addPage(p);
              });
              return out.save({ useObjectStreams: true });
            });
        });
      })
      .then(function (bytes) {
        outBlob = new Blob([bytes], { type: 'application/pdf' });
        $('#rBig').textContent = order.length +
          (order.length === 1 ? ' page' : ' pages') + ' — ' + fmt(outBlob.size);
        $('#rMeta').textContent = 'Pages were copied, not re-encoded, so text stays ' +
          'selectable and image quality is untouched.';
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
    a.download = srcName + '-organised.pdf';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  });
})();
