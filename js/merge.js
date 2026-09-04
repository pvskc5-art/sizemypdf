/* SizeMyPDF - merge PDFs, entirely in the browser.
   Only pdf-lib is needed here: merging copies page objects between documents
   and never rasterises, so pdf.js is not loaded on this page. */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var drop = $('#drop'), file = $('#file'), controls = $('#controls'),
      list = $('#list'), statusEl = $('#status'), bar = $('#bar'),
      barFill = $('#barFill'), result = $('#result'), go = $('#go');

  var items = [];      // { file, name, size, pages }
  var outBlob = null;

  function fmt(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
    return (b / 1048576).toFixed(2) + ' MB';
  }
  function say(t) { statusEl.textContent = t; }
  function prog(p) {
    bar.classList.add('on');
    barFill.style.width = Math.max(0, Math.min(100, p)) + '%';
  }

  /* ---------- intake ---------- */
  drop.addEventListener('click', function () { file.click(); });
  drop.addEventListener('dragover', function (e) {
    e.preventDefault(); drop.classList.add('over');
  });
  drop.addEventListener('dragleave', function () { drop.classList.remove('over'); });
  drop.addEventListener('drop', function (e) {
    e.preventDefault(); drop.classList.remove('over');
    add(e.dataTransfer.files);
  });
  file.addEventListener('change', function () { add(file.files); file.value = ''; });

  function add(fileList) {
    var incoming = [].slice.call(fileList).filter(function (f) {
      return f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
    });
    if (!incoming.length) { say('Those do not look like PDF files.'); return; }

    say('Reading…');
    var chain = Promise.resolve();
    incoming.forEach(function (f) {
      chain = chain.then(function () {
        return f.arrayBuffer()
          .then(function (ab) {
            return PDFLib.PDFDocument.load(ab, { ignoreEncryption: true });
          })
          .then(function (doc) {
            items.push({ file: f, name: f.name, size: f.size, pages: doc.getPageCount() });
          })
          .catch(function () {
            // A file we cannot open is reported rather than silently dropped.
            items.push({ file: f, name: f.name, size: f.size, pages: null });
          });
      });
    });
    chain.then(function () { say(''); render(); });
  }

  function render() {
    list.innerHTML = '';
    items.forEach(function (it, i) {
      var li = document.createElement('li');

      var nm = document.createElement('span');
      nm.className = 'nm'; nm.textContent = it.name;

      var pg = document.createElement('span');
      pg.className = 'pg';
      pg.textContent = it.pages === null ? 'unreadable' :
        it.pages + (it.pages === 1 ? ' page' : ' pages');

      var sz = document.createElement('span');
      sz.className = 'sz'; sz.textContent = fmt(it.size);

      var up = mkBtn('↑', 'Move up', i === 0, function () { swap(i, i - 1); });
      var dn = mkBtn('↓', 'Move down', i === items.length - 1, function () { swap(i, i + 1); });
      var rm = mkBtn('×', 'Remove', false, function () {
        items.splice(i, 1); render();
      });
      rm.className = 'iconbtn del';

      li.appendChild(nm); li.appendChild(pg); li.appendChild(sz);
      li.appendChild(up); li.appendChild(dn); li.appendChild(rm);
      list.appendChild(li);
    });

    if (items.length) {
      controls.classList.add('on');
      var total = items.reduce(function (n, it) { return n + (it.pages || 0); }, 0);
      drop.querySelector('strong').textContent =
        items.length + (items.length === 1 ? ' file' : ' files') + ' selected';
      drop.querySelector('small').textContent =
        total + ' pages total — click to add more';
      go.disabled = items.length < 2;
      go.textContent = items.length < 2 ? 'Add another PDF to merge' : 'Merge ' + items.length + ' PDFs';
    } else {
      controls.classList.remove('on');
      drop.querySelector('strong').textContent = 'Choose PDFs or drop them here';
      drop.querySelector('small').textContent = 'Nothing is uploaded — merging happens in your browser';
    }
    result.classList.remove('on');
  }

  function mkBtn(label, title, disabled, fn) {
    var b = document.createElement('button');
    b.className = 'iconbtn'; b.type = 'button';
    b.textContent = label; b.title = title; b.disabled = disabled;
    b.addEventListener('click', fn);
    return b;
  }

  function swap(a, b) {
    var t = items[a]; items[a] = items[b]; items[b] = t; render();
  }

  /* ---------- merge ---------- */
  go.addEventListener('click', function () {
    if (items.length < 2) return;
    go.disabled = true;
    result.classList.remove('on');
    prog(5);
    say('Merging…');

    PDFLib.PDFDocument.create().then(function (out) {
      var chain = Promise.resolve(), done = 0;
      items.forEach(function (it) {
        chain = chain.then(function () {
          return it.file.arrayBuffer()
            .then(function (ab) {
              return PDFLib.PDFDocument.load(ab, { ignoreEncryption: true });
            })
            .then(function (src) {
              return out.copyPages(src, src.getPageIndices());
            })
            .then(function (pages) {
              pages.forEach(function (p) { out.addPage(p); });
              done++;
              prog(5 + (done / items.length) * 85);
            });
        });
      });
      return chain.then(function () {
        say('Writing the file…');
        return out.save({ useObjectStreams: true });
      }).then(function (bytes) {
        return { bytes: bytes, pages: out.getPageCount() };
      });
    }).then(function (r) {
      prog(100);
      outBlob = new Blob([r.bytes], { type: 'application/pdf' });
      $('#rBig').textContent = r.pages + ' pages — ' + fmt(outBlob.size);
      $('#rMeta').textContent =
        'Merged ' + items.length + ' files in the order shown above.';
      result.classList.add('on');
      say(''); bar.classList.remove('on'); go.disabled = false;
    }).catch(function (err) {
      console.error(err);
      say('Could not merge these files: ' +
          (err && err.message ? err.message : 'unknown error') +
          '. A password-protected PDF must have its password removed first.');
      bar.classList.remove('on'); go.disabled = false;
    });
  });

  $('#dl').addEventListener('click', function () {
    if (!outBlob) return;
    var a = document.createElement('a');
    a.href = URL.createObjectURL(outBlob);
    a.download = 'merged.pdf';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  });
})();
