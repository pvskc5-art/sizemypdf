/* SizeMyPDF - compress many PDFs to one target, entirely in the browser.
   Uses the same engine as the single-file page (compress-core.js), so the two
   cannot drift apart. Files are processed one at a time on purpose: each one
   holds every page as a canvas while it works, and running several in parallel
   is the fastest way to exhaust memory on a phone. */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var drop = $('#drop'), file = $('#file'), controls = $('#controls'),
      list = $('#list'), statusEl = $('#status'), bar = $('#bar'),
      barFill = $('#barFill'), go = $('#go'), summary = $('#summary'),
      zipBtn = $('#zip');

  var items = [];      // { file, name, size, state, outBlob, keptText, note }
  var running = false;

  function fmt(b) {
    if (b < 1000) return b + ' B';
    if (b < 1000000) return (b / 1000).toFixed(0) + ' KB';
    return (b / 1000000).toFixed(2) + ' MB';
  }
  function say(t) { statusEl.textContent = t; }
  function prog(p) {
    bar.classList.add('on');
    var v = Math.max(0, Math.min(100, p));
    barFill.style.width = v + '%';
    bar.setAttribute('aria-valuenow', Math.round(v));
  }

  /* ---------- intake ---------- */
  // the drop zone is a <label for="file"> - click and Enter/Space are native
  drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', function () { drop.classList.remove('over'); });
  drop.addEventListener('drop', function (e) {
    e.preventDefault(); drop.classList.remove('over'); add(e.dataTransfer.files);
  });
  file.addEventListener('change', function () { add(file.files); file.value = ''; });

  function add(fileList) {
    if (running) return;
    var incoming = [].slice.call(fileList).filter(function (f) {
      return f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
    });
    if (!incoming.length) { say('Those do not look like PDF files.'); return; }
    incoming.forEach(function (f) {
      items.push({ file: f, name: f.name, size: f.size, state: 'waiting',
                   outBlob: null, keptText: false, note: '' });
    });
    say(''); render();
  }

  function render() {
    list.innerHTML = '';
    items.forEach(function (it, i) {
      var li = document.createElement('li');

      var nm = document.createElement('span');
      nm.className = 'nm'; nm.textContent = it.name;

      var st = document.createElement('span');
      st.className = 'pg';
      if (it.state === 'done') {
        st.textContent = (it.keptText ? 'text kept' : 'rasterised');
        st.style.color = it.keptText ? 'var(--ok)' : 'var(--muted)';
      } else if (it.state === 'failed') {
        st.textContent = it.note || 'failed';
        st.style.color = '#c9424a';
      } else if (it.state === 'working') {
        st.textContent = 'working…';
      } else if (it.state === 'over') {
        st.textContent = 'over target';
        st.style.color = 'var(--warn, #b4690e)';
      } else {
        st.textContent = 'waiting';
      }

      var sz = document.createElement('span');
      sz.className = 'sz';
      sz.textContent = it.outBlob
        ? fmt(it.size) + ' → ' + fmt(it.outBlob.size)
        : fmt(it.size);

      li.appendChild(nm); li.appendChild(st); li.appendChild(sz);

      if (it.outBlob) {
        var dl = document.createElement('button');
        dl.className = 'iconbtn'; dl.type = 'button';
        dl.textContent = '↓'; dl.title = 'Download ' + it.name;
        dl.addEventListener('click', function () { save(it.outBlob, outName(it.name)); });
        li.appendChild(dl);
      }
      if (!running) {
        var rm = document.createElement('button');
        rm.className = 'iconbtn del'; rm.type = 'button';
        rm.textContent = '×'; rm.title = 'Remove ' + it.name;
        rm.addEventListener('click', function () { items.splice(i, 1); render(); });
        li.appendChild(rm);
      }
      list.appendChild(li);
    });

    if (items.length) {
      controls.classList.add('on');
      drop.querySelector('strong').textContent =
        items.length + (items.length === 1 ? ' file' : ' files') + ' selected';
      drop.querySelector('small').textContent =
        items.reduce(function (n, i2) { return n + i2.size; }, 0) > 0
          ? fmt(items.reduce(function (n, i2) { return n + i2.size; }, 0)) + ' total — click to add more'
          : 'click to add more';
      go.disabled = running;
      go.textContent = running ? 'Compressing…' : 'Compress ' + items.length +
        (items.length === 1 ? ' file' : ' files');
    } else {
      controls.classList.remove('on');
      drop.querySelector('strong').textContent = 'Choose PDFs or drop them here';
      drop.querySelector('small').textContent =
        'Nothing is uploaded — every file is compressed in your browser';
    }
  }

  function outName(n) { return n.replace(/\.pdf$/i, '') + '-compressed.pdf'; }

  function save(blob, filename) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  /* ---------- run ---------- */
  go.addEventListener('click', function () {
    if (running || !items.length) return;
    var targetKB = parseInt($('#target').value, 10) || 200;
    // A form that says 250 KB may count 250,000 bytes or 256,000; nothing on
    // the page tells us which. Taking the smaller reading is the only one
    // that passes both, and costs 2.4% of quality to be certain.
    var targetBytes = Math.max(10, targetKB) * 1000;

    running = true;
    summary.classList.remove('on');
    zipBtn.disabled = true;
    items.forEach(function (it) {
      it.state = 'waiting'; it.outBlob = null; it.keptText = false; it.note = '';
    });
    render();

    var done = 0;
    var batchStarted = Date.now();
    function step(i) {
      if (i >= items.length) return Promise.resolve();
      var it = items[i];
      it.state = 'working'; render();
      say('File ' + (i + 1) + ' of ' + items.length + ' — ' + it.name);

      return it.file.arrayBuffer()
        .then(function (ab) {
          var bytes = new Uint8Array(ab);

          /* Check it is a PDF before the shortcut below, not after. A file
             that is not one is always smaller than the target, so it used to
             take the shortcut and be counted among the successes: an empty
             file and a text file renamed .pdf both came back reported as
             "compressed", which is worse than saying nothing at all. */
          var head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
          if (bytes.length === 0) throw new Error('the file is empty');
          if (head.indexOf('%PDF-') === -1) throw new Error('not a PDF inside');

          // already small enough: hand it back untouched rather than
          // rasterising it into something larger. Opened first so a corrupt
          // file cannot slip through on size alone.
          if (bytes.length <= targetBytes) {
            return PDFLib.PDFDocument.load(bytes.slice(0), { ignoreEncryption: true })
              .then(function () { return { bytes: bytes, keptText: true }; });
          }
          return PDFCompress.toTarget(bytes, targetBytes, function () {}, function () {});
        })
        .then(function (res) {
          if (!res || !res.bytes) throw new Error('no output');
          it.outBlob = new Blob([res.bytes], { type: 'application/pdf' });
          it.keptText = !!res.keptText;
          it.state = it.outBlob.size <= targetBytes ? 'done' : 'over';
        })
        .catch(function (err) {
          console.error(it.name, err);
          it.state = 'failed';
          var m = err && err.message || '';
          it.note = /password|encrypt/i.test(m) ? 'password-protected'
                  : /empty/i.test(m) ? 'empty file'
                  : /not a PDF/i.test(m) ? 'not a PDF'
                  : 'could not read';
        })
        .then(function () {
          done++;
          prog((done / items.length) * 100);
          render();
          // yield so the UI can repaint between files
          return new Promise(function (r) { setTimeout(r, 30); });
        })
        .then(function () { return step(i + 1); });
    }

    step(0).then(function () {
      running = false;
      prog(100);
      var ok = items.filter(function (i2) { return i2.outBlob; });
      var kept = ok.filter(function (i2) { return i2.keptText; }).length;
      var over = items.filter(function (i2) { return i2.state === 'over'; }).length;
      var failed = items.filter(function (i2) { return i2.state === 'failed'; }).length;
      var before = items.reduce(function (n, i2) { return n + i2.size; }, 0);
      var after = ok.reduce(function (n, i2) { return n + i2.outBlob.size; }, 0);

      $('#sBig').textContent = ok.length + ' of ' + items.length + ' compressed — ' +
        fmt(before) + ' → ' + fmt(after);
      // "0 kept their text layer" reads like a placeholder rather than a
      // result, and the zero case is the one that needs explaining.
      var keptPhrase = kept === 0
        ? 'None kept their text layer, because reaching the target meant ' +
          'rasterising the pages'
        : kept === ok.length
          ? (ok.length === 1 ? 'It kept its text layer' : 'All kept their text layer')
          : kept + ' of ' + ok.length + ' kept their text layer';
      $('#sMeta').textContent =
        keptPhrase +
        (over ? ', ' + over + ' could not reach the target' : '') +
        (failed ? ', ' + failed + ' could not be read' : '') + '.';
      try {
        if (typeof Metrics !== 'undefined') {
          Metrics.record('batch', {
            files: Metrics.count(items.length),
            target: Metrics.kb(targetKB),
            over: over ? 'yes' : 'no',
            failed: failed ? 'yes' : 'no',
            took: Metrics.ms(Date.now() - batchStarted),
            engine: (PDFCompress.usingWorker && PDFCompress.usingWorker())
              ? 'worker' : 'main'
          });
        }
      } catch (e) {}
      summary.classList.add('on');
      zipBtn.disabled = ok.length === 0;
      say(ok.length ? 'Done. Download them individually or as a ZIP.' : 'Nothing could be compressed.');
      bar.classList.remove('on');
      render();
    });
  });

  /* ---------- zip ---------- */
  zipBtn.addEventListener('click', function () {
    var ok = items.filter(function (i2) { return i2.outBlob; });
    if (!ok.length) return;
    if (typeof JSZip === 'undefined') {
      say('The ZIP library did not load. Use the individual download buttons instead.');
      return;
    }
    zipBtn.disabled = true;
    say('Building the ZIP…');
    var zip = new JSZip();
    var chain = Promise.resolve();
    var used = {};
    ok.forEach(function (it) {
      chain = chain.then(function () {
        return it.outBlob.arrayBuffer().then(function (ab) {
          // two files of the same name in one ZIP would silently overwrite
          var n = outName(it.name), base = n, k = 2;
          while (used[n]) { n = base.replace(/\.pdf$/i, '') + '-' + (k++) + '.pdf'; }
          used[n] = true;
          zip.file(n, ab);
        });
      });
    });
    chain.then(function () {
      return zip.generateAsync({ type: 'blob', compression: 'STORE' });
    }).then(function (blob) {
      save(blob, 'compressed-pdfs.zip');
      say('ZIP downloaded.');
      zipBtn.disabled = false;
    }).catch(function (err) {
      console.error(err);
      say('Could not build the ZIP: ' + (err && err.message ? err.message : 'unknown error') +
          '. The individual download buttons still work.');
      zipBtn.disabled = false;
    });
  });
})();
