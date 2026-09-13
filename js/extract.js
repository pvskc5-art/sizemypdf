/* SizeMyPDF - pull the embedded images out of a PDF.

   Not the same job as PDF-to-images, and the difference is the point. That
   renders each page and gives you a picture of the page at whatever resolution
   you asked for. This finds the image objects actually stored in the file and
   hands them back at their own resolution - so a photograph placed into a
   report at postcard size comes out at the full size it was embedded, which is
   usually far larger than the page suggests.

   Everything happens here: the file is parsed in the browser and the images
   are rebuilt from its own objects. */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var drop = $('#drop'), file = $('#file'), controls = $('#controls'),
      statusEl = $('#status'), grid = $('#imgs'), info = $('#info'),
      zipBtn = $('#zip');

  var found = [];        // { canvas, thumb, w, h, page, blob, name }
  var srcName = '';

  function fmt(b) {
    if (b < 1000) return b + ' B';
    if (b < 1000000) return (b / 1000).toFixed(0) + ' KB';
    return (b / 1000000).toFixed(2) + ' MB';
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
    say('Looking for images…');
    grid.textContent = '';
    found = [];
    seenSig = {};
    controls.classList.remove('on');

    f.arrayBuffer().then(function (ab) {
      return PDFThumbs.ensure().then(function () {
        return pdfjsLib.getDocument({ data: ab.slice(0) }).promise;
      });
    }).then(function (pdf) {
      drop.querySelector('strong').textContent = f.name;
      drop.querySelector('small').textContent =
        pdf.numPages + ' pages, ' + fmt(f.size) + ' — click to choose a different file';

      var chain = Promise.resolve();
      for (var n = 1; n <= pdf.numPages; n++) {
        (function (pageNo) {
          chain = chain.then(function () {
            say('Page ' + pageNo + ' of ' + pdf.numPages + '…');
            return scanPage(pdf, pageNo);
          });
        })(n);
      }
      return chain.then(function () { done(pdf.numPages); });
    }).catch(function (err) {
      console.error(err);
      say('Could not read this PDF: ' + (err && err.message ? err.message : 'unknown error') +
          '. If it is password-protected, remove the password first.');
    });
  }

  function scanPage(pdf, pageNo) {
    return pdf.getPage(pageNo).then(function (page) {
      return page.getOperatorList().then(function (ops) {
        var names = [], seen = {};
        ops.fnArray.forEach(function (fn, i) {
          if (fn === pdfjsLib.OPS.paintImageXObject ||
              fn === pdfjsLib.OPS.paintJpegXObject ||
              fn === pdfjsLib.OPS.paintImageXObjectRepeat) {
            var nm = ops.argsArray[i][0];
            // the same object drawn twice on a page is still one image
            if (nm && !seen[nm]) { seen[nm] = 1; names.push(nm); }
          }
        });

        /* An image shared between pages is stored as a global object, named
           with a g_ prefix, and those are not resolved until the page is
           actually rendered - getOperatorList alone is not enough. Without
           this, a logo or letterhead reused across pages was silently
           skipped, which is the most common case of all. */
        var resolved = Promise.resolve();
        if (names.some(function (nm) { return /^g_/.test(nm); })) {
          resolved = (function () {
            var vp = page.getViewport({ scale: 0.2 });
            var c = document.createElement('canvas');
            c.width = Math.max(1, Math.floor(vp.width));
            c.height = Math.max(1, Math.floor(vp.height));
            return page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise
              .then(function () { c.width = 0; c.height = 0; })
              .catch(function () {});
          })();
        }

        var chain = resolved;
        names.forEach(function (nm) {
          chain = chain.then(function () {
            var obj = null;
            try { obj = page.objs.get(nm); } catch (e) {}
            if (!obj) { try { obj = pdf.commonObjs.get(nm); } catch (e) {} }
            if (!obj || !obj.width || !obj.height) return;
            return toCanvas(obj).then(function (c) {
              if (!c) return;
              if (c.width < 8 || c.height < 8) return;     // spacers, rules, noise
              return keep(c, pageNo, nm);
            }).catch(function () {});
          });
        });
        return chain.then(function () {
          if (page.cleanup) { try { page.cleanup(); } catch (e) {} }
        });
      });
    });
  }

  /* pdf.js hands back either an ImageBitmap or raw pixel data depending on the
     image and the build, so handle both rather than assuming one. */
  function toCanvas(obj) {
    var c = document.createElement('canvas');
    c.width = obj.width; c.height = obj.height;
    var ctx = c.getContext('2d');

    if (obj.bitmap) {
      ctx.drawImage(obj.bitmap, 0, 0);
      return Promise.resolve(c);
    }
    if (obj.data) {
      var src = obj.data, n = obj.width * obj.height;
      var out = ctx.createImageData(obj.width, obj.height);
      if (src.length === n * 4) {
        out.data.set(src);
      } else if (src.length === n * 3) {
        for (var i = 0, j = 0; i < n; i++) {
          out.data[j++] = src[i * 3];
          out.data[j++] = src[i * 3 + 1];
          out.data[j++] = src[i * 3 + 2];
          out.data[j++] = 255;
        }
      } else if (src.length === n) {                 // greyscale
        for (var k = 0, m = 0; k < n; k++) {
          var v = src[k];
          out.data[m++] = v; out.data[m++] = v; out.data[m++] = v; out.data[m++] = 255;
        }
      } else {
        return Promise.resolve(null);
      }
      ctx.putImageData(out, 0, 0);
      return Promise.resolve(c);
    }
    return Promise.resolve(null);
  }

  /* The same logo on forty pages is one picture, not forty. Dedupe on
     dimensions plus encoded length, which is cheap and good enough - two
     genuinely different images almost never agree on all three. */
  var seenSig = {};

  function keep(c, pageNo, name) {
    var fmtSel = $('#format').value;
    var type = fmtSel === 'jpeg' ? 'image/jpeg' : 'image/png';
    var q = fmtSel === 'jpeg' ? 0.92 : undefined;
    return new Promise(function (res) { c.toBlob(res, type, q); })
      .then(function (blob) {
        if (!blob) return;
        var thumb = document.createElement('canvas');
        var k = Math.min(1, 132 / c.width);
        thumb.width = Math.max(1, Math.round(c.width * k));
        thumb.height = Math.max(1, Math.round(c.height * k));
        thumb.getContext('2d').drawImage(c, 0, 0, thumb.width, thumb.height);
        var sig = c.width + 'x' + c.height + ':' + blob.size;
        if (seenSig[sig]) { c.width = 0; c.height = 0; return; }
        seenSig[sig] = 1;
        found.push({ thumb: thumb, w: c.width, h: c.height, page: pageNo,
                     blob: blob, name: name, ext: type === 'image/jpeg' ? 'jpg' : 'png' });
        c.width = 0; c.height = 0;
      });
  }

  function done(pageCount) {
    say('');
    if (!found.length) {
      statusEl.innerHTML = '';
      statusEl.appendChild(document.createTextNode(
        'No embedded images found. A PDF made from a word processor often has ' +
        'none — the text is text, not a picture. If you want a picture of each ' +
        'page instead, use '));
      var a = document.createElement('a');
      a.href = 'pdf-to-jpg.html'; a.textContent = 'PDF to images';
      statusEl.appendChild(a);
      statusEl.appendChild(document.createTextNode('.'));
      return;
    }
    controls.classList.add('on');
    paint();
    var total = found.reduce(function (n, f) { return n + f.blob.size; }, 0);
    if (info) {
      info.textContent = found.length + (found.length === 1 ? ' image' : ' images') +
        ' across ' + pageCount + (pageCount === 1 ? ' page' : ' pages') +
        ' — ' + fmt(total) + ' in total, at the resolution they are stored in the file.';
    }
    zipBtn.disabled = found.length < 2;
  }

  function paint() {
    grid.textContent = '';
    found.forEach(function (f, i) {
      var tile = document.createElement('div');
      tile.className = 'ptile';
      var shell = document.createElement('div');
      shell.className = 'sh';
      shell.appendChild(f.thumb);
      var meta = document.createElement('div');
      meta.className = 'pnum';
      meta.textContent = f.w + '×' + f.h + ' · ' + fmt(f.blob.size) + ' · p' + f.page;
      var tools = document.createElement('div');
      tools.className = 'ptools';
      var dl = document.createElement('button');
      dl.type = 'button'; dl.className = 'iconbtn';
      dl.textContent = '↓';
      dl.title = 'Download image ' + (i + 1);
      dl.setAttribute('aria-label', dl.title);
      dl.addEventListener('click', function () {
        save(f.blob, srcName + '-p' + f.page + '-' + (i + 1) + '.' + f.ext);
      });
      tools.appendChild(dl);
      tile.appendChild(shell); tile.appendChild(meta); tile.appendChild(tools);
      grid.appendChild(tile);
    });
  }

  function save(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click();
    // Sixty seconds, not one and a half. The browser takes its blob reference
    // when the download actually starts, and on a loaded phone that can be well
    // after the click - revoking first makes the download fail with nothing shown.
    // It costs no memory to wait: the blob is held in a variable here anyway, so
    // releasing the URL early frees nothing, and the page dropping takes both.
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 60000);
  }

  zipBtn.addEventListener('click', function () {
    if (found.length < 2) return;
    if (typeof JSZip === 'undefined') {
      say('The ZIP library did not load. Use the individual buttons instead.');
      return;
    }
    zipBtn.disabled = true;
    say('Building the ZIP…');
    var zip = new JSZip(), chain = Promise.resolve();
    found.forEach(function (f, i) {
      chain = chain.then(function () {
        return f.blob.arrayBuffer().then(function (ab) {
          zip.file(srcName + '-p' + f.page + '-' + (i + 1) + '.' + f.ext, ab);
        });
      });
    });
    chain.then(function () { return zip.generateAsync({ type: 'blob', compression: 'STORE' }); })
      .then(function (blob) {
        save(blob, srcName + '-images.zip');
        say('ZIP downloaded.');
        zipBtn.disabled = false;
      }).catch(function (err) {
        console.error(err);
        say('Could not build the ZIP. The individual buttons still work.');
        zipBtn.disabled = false;
      });
  });
})();
