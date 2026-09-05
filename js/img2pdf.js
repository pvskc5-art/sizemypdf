/* SizeMyPDF - images to PDF, entirely in the browser. */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var drop = $('#drop'), file = $('#file'), controls = $('#controls'),
      list = $('#list'), statusEl = $('#status'), bar = $('#bar'),
      barFill = $('#barFill'), result = $('#result'), go = $('#go');

  var items = [];        // { file, name, size, w, h, url }
  var outBlob = null;

  var A4 = { w: 595.28, h: 841.89 };   // points

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
    e.preventDefault(); drop.classList.remove('over'); add(e.dataTransfer.files);
  });
  file.addEventListener('change', function () { add(file.files); file.value = ''; });

  function add(fileList) {
    var incoming = [].slice.call(fileList).filter(function (f) {
      return /^image\//.test(f.type) || /\.(jpe?g|png|gif|bmp|webp)$/i.test(f.name);
    });
    if (!incoming.length) { say('Those do not look like image files.'); return; }

    say('Reading…');
    var chain = Promise.resolve();
    incoming.forEach(function (f) {
      chain = chain.then(function () {
        return new Promise(function (res) {
          var url = URL.createObjectURL(f);
          var img = new Image();
          img.onload = function () {
            items.push({ file: f, name: f.name, size: f.size, w: img.width, h: img.height, url: url });
            res();
          };
          img.onerror = function () {
            items.push({ file: f, name: f.name, size: f.size, w: null, h: null, url: url });
            res();
          };
          img.src = url;
        });
      });
    });
    chain.then(function () { say(''); render(); });
  }

  function mkBtn(label, title, disabled, fn, cls) {
    var b = document.createElement('button');
    b.className = cls || 'iconbtn'; b.type = 'button';
    b.textContent = label; b.title = title; b.disabled = disabled;
    b.addEventListener('click', fn);
    return b;
  }

  function render() {
    list.innerHTML = '';
    items.forEach(function (it, i) {
      var li = document.createElement('li');

      var nm = document.createElement('span');
      nm.className = 'nm'; nm.textContent = it.name;

      var pg = document.createElement('span');
      pg.className = 'pg';
      pg.textContent = it.w ? it.w + '×' + it.h : 'unreadable';

      var sz = document.createElement('span');
      sz.className = 'sz'; sz.textContent = fmt(it.size);

      li.appendChild(nm); li.appendChild(pg); li.appendChild(sz);
      li.appendChild(mkBtn('↑', 'Move up', i === 0, function () { swap(i, i - 1); }));
      li.appendChild(mkBtn('↓', 'Move down', i === items.length - 1, function () { swap(i, i + 1); }));
      li.appendChild(mkBtn('×', 'Remove', false, function () {
        URL.revokeObjectURL(it.url); items.splice(i, 1); render();
      }, 'iconbtn del'));
      list.appendChild(li);
    });

    if (items.length) {
      controls.classList.add('on');
      drop.querySelector('strong').textContent =
        items.length + (items.length === 1 ? ' image' : ' images') + ' selected';
      drop.querySelector('small').textContent = 'Click to add more';
      go.disabled = false;
      go.textContent = 'Create PDF from ' + items.length +
        (items.length === 1 ? ' image' : ' images');
    } else {
      controls.classList.remove('on');
      drop.querySelector('strong').textContent = 'Choose images or drop them here';
      drop.querySelector('small').textContent = 'JPG, PNG, GIF, BMP or WebP — nothing is uploaded';
    }
    result.classList.remove('on');
  }

  function swap(a, b) { var t = items[a]; items[a] = items[b]; items[b] = t; render(); }

  /* Re-encode through a canvas. pdf-lib embeds only JPEG and PNG, so anything
     else (GIF, BMP, WebP) has to be converted first - and routing every image
     through the same path also strips EXIF orientation quirks. */
  function toEmbeddable(it) {
    return new Promise(function (res, rej) {
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        var x = c.getContext('2d');
        x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
        x.drawImage(img, 0, 0);
        c.toBlob(function (b) {
          b.arrayBuffer().then(function (ab) {
            res({ bytes: ab, w: img.width, h: img.height });
          });
        }, 'image/jpeg', 0.92);
      };
      img.onerror = function () { rej(new Error('Could not decode ' + it.name)); };
      img.src = it.url;
    });
  }

  go.addEventListener('click', function () {
    if (!items.length) return;
    var mode = $('#pagesize').value;
    go.disabled = true;
    result.classList.remove('on');
    prog(5);
    say('Building the PDF…');

    PDFLib.PDFDocument.create().then(function (out) {
      var chain = Promise.resolve(), done = 0;
      items.forEach(function (it) {
        chain = chain.then(function () {
          return toEmbeddable(it).then(function (im) {
            return out.embedJpg(im.bytes).then(function (emb) {
              var page;
              if (mode === 'a4') {
                // fit inside A4 with a small margin, preserving aspect ratio
                var m = 28;                                  // ~10mm
                var maxW = A4.w - m * 2, maxH = A4.h - m * 2;
                var k = Math.min(maxW / im.w, maxH / im.h);
                var w = im.w * k, h = im.h * k;
                page = out.addPage([A4.w, A4.h]);
                page.drawImage(emb, { x: (A4.w - w) / 2, y: (A4.h - h) / 2, width: w, height: h });
              } else {
                page = out.addPage([im.w, im.h]);
                page.drawImage(emb, { x: 0, y: 0, width: im.w, height: im.h });
              }
              done++;
              prog(5 + (done / items.length) * 85);
            });
          });
        });
      });
      return chain.then(function () { return out.save({ useObjectStreams: true }); });
    }).then(function (bytes) {
      prog(100);
      outBlob = new Blob([bytes], { type: 'application/pdf' });
      $('#rBig').textContent = items.length +
        (items.length === 1 ? ' page' : ' pages') + ' — ' + fmt(outBlob.size);
      $('#rMeta').textContent = mode === 'a4'
        ? 'Each image centred on an A4 page, aspect ratio preserved.'
        : 'Each page matches its image exactly, with no margins.';
      result.classList.add('on');
      say(''); bar.classList.remove('on'); go.disabled = false;
    }).catch(function (err) {
      console.error(err);
      say('Could not build the PDF: ' + (err && err.message ? err.message : 'unknown error'));
      bar.classList.remove('on'); go.disabled = false;
    });
  });

  $('#dl').addEventListener('click', function () {
    if (!outBlob) return;
    var a = document.createElement('a');
    a.href = URL.createObjectURL(outBlob);
    a.download = 'images.pdf';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  });
})();
