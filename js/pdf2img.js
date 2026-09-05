/* SizeMyPDF - PDF to images, entirely in the browser. */
(function () {
  'use strict';

  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'vendor/pdf.worker.min.js';

  /* The requestAnimationFrame shim lives in pdfjs-raf.js, loaded before pdf.js. */

  var $ = function (s) { return document.querySelector(s); };
  var drop = $('#drop'), file = $('#file'), controls = $('#controls'),
      statusEl = $('#status'), bar = $('#bar'), barFill = $('#barFill'),
      outputs = $('#outputs'), go = $('#go'), info = $('#info');

  var srcBytes = null, srcName = '', pageCount = 0;

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
    srcName = f.name.replace(/\.pdf$/i, '');
    outputs.innerHTML = '';
    say('Reading…');
    f.arrayBuffer().then(function (ab) {
      srcBytes = new Uint8Array(ab);
      return pdfjsLib.getDocument({ data: srcBytes.slice(0) }).promise;
    }).then(function (doc) {
      pageCount = doc.numPages;
      drop.querySelector('strong').textContent = f.name;
      drop.querySelector('small').textContent =
        pageCount + ' pages, ' + fmt(f.size) + ' — click to choose a different file';
      info.textContent = 'This document has ' + pageCount +
        (pageCount === 1 ? ' page.' : ' pages.') +
        (pageCount > 40 ? ' Converting them all will take a while.' : '');
      controls.classList.add('on');
      say('');
    }).catch(function (err) {
      console.error(err);
      say('Could not open this PDF: ' +
          (err && err.message ? err.message : 'unknown error') +
          '. If it is password-protected, remove the password first.');
    });
  }

  function addOutput(label, blob, filename) {
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

  go.addEventListener('click', function () {
    if (!srcBytes) return;
    var scale = parseFloat($('#quality').value);
    var format = $('#format').value;      // 'image/jpeg' | 'image/png'
    var ext = format === 'image/png' ? 'png' : 'jpg';

    if (pageCount > 100) {
      say('This document has ' + pageCount + ' pages. Converting more than 100 ' +
          'images at once will likely exhaust memory - split it first.');
      return;
    }

    outputs.innerHTML = '';
    go.disabled = true;
    prog(3);
    say('Converting…');

    pdfjsLib.getDocument({ data: srcBytes.slice(0) }).promise.then(function (doc) {
      var chain = Promise.resolve();
      for (var i = 1; i <= doc.numPages; i++) {
        (function (n) {
          chain = chain.then(function () {
            return doc.getPage(n).then(function (page) {
              var vp = page.getViewport({ scale: scale });
              var cap = 4000, k = Math.min(1, cap / Math.max(vp.width, vp.height));
              if (k < 1) vp = page.getViewport({ scale: scale * k });
              var c = document.createElement('canvas');
              c.width = Math.max(1, Math.floor(vp.width));
              c.height = Math.max(1, Math.floor(vp.height));
              var ctx = c.getContext('2d');
              ctx.fillStyle = '#fff';        // PNG would otherwise be transparent
              ctx.fillRect(0, 0, c.width, c.height);
              var task = page.render({ canvasContext: ctx, viewport: vp });
              return task.promise.then(function () {
                return new Promise(function (res) {
                  c.toBlob(function (blob) {
                    addOutput('Page ' + n + '  (' + c.width + '×' + c.height + ')',
                              blob, srcName + '-' + n + '.' + ext);
                    prog(3 + (n / doc.numPages) * 95);
                    res();
                  }, format, format === 'image/jpeg' ? 0.9 : undefined);
                });
              });
            });
          });
        })(i);
      }
      return chain.then(function () { return doc.numPages; });
    }).then(function (n) {
      prog(100);
      say('Done — ' + n + (n === 1 ? ' image' : ' images') + ' ready. Click each to download.');
      bar.classList.remove('on'); go.disabled = false;
    }).catch(function (err) {
      console.error(err);
      say('Something went wrong: ' + (err && err.message ? err.message : 'unknown error'));
      bar.classList.remove('on'); go.disabled = false;
    });
  });
})();
