/* SizeMyPDF - compress an image to an exact size: page controller.
   The algorithm lives in imgcompress-core.js; this file only handles the page.
   Policy that depends on the original file - already small enough, wrong
   format, a result that came out larger - stays here, the same way app.js
   keeps it out of the PDF engine. */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var drop = $('#drop'), file = $('#file'), controls = $('#controls'),
      statusEl = $('#status'), bar = $('#bar'), barFill = $('#barFill'),
      result = $('#result'), go = $('#go');

  var srcBlob = null, srcName = '', srcW = 0, srcH = 0, srcBitmap = null;
  var outBlob = null, outW = 0, outH = 0;

  function fmt(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
    return (b / 1048576).toFixed(2) + ' MB';
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
    e.preventDefault(); drop.classList.remove('over');
    if (e.dataTransfer.files.length) accept(e.dataTransfer.files[0]);
  });
  file.addEventListener('change', function () {
    if (file.files.length) accept(file.files[0]);
  });

  function accept(f) {
    if (!/^image\//.test(f.type)) { say('That does not look like an image file.'); return; }
    srcBlob = f;
    srcName = f.name.replace(/\.[a-z0-9]+$/i, '');
    say('Reading…');
    result.classList.remove('on', 'miss');
    ImgCompress.decode(f).then(function (bm) {
      srcBitmap = bm;
      srcW = bm.width; srcH = bm.height;
      drop.querySelector('strong').textContent = f.name;
      drop.querySelector('small').textContent =
        srcW + '×' + srcH + ', ' + fmt(f.size) +
        ' — click to choose a different image';
      controls.classList.add('on');
      var t = $('#target');
      if (!t.value) t.value = Math.max(20, Math.round(f.size / 1024 * 0.3));
      say('');
      showBefore();
    }).catch(function (err) {
      console.error(err);
      say('Could not read this image: ' +
          (err && err.message ? err.message : 'unknown error'));
    });
  }

  function drawInto(canvas, bitmap, maxW) {
    var k = Math.min(1, maxW / bitmap.width);
    canvas.width = Math.max(1, Math.round(bitmap.width * k));
    canvas.height = Math.max(1, Math.round(bitmap.height * k));
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  }

  function showBefore() {
    var wrap = $('#compare'), c = $('#beforeCanvas');
    if (!wrap || !c || !srcBitmap) return;
    drawInto(c, srcBitmap, 300);
    $('#beforeMeta').textContent = srcW + '×' + srcH + ' · ' + fmt(srcBlob.size);
    $('#afterMeta').textContent = 'not compressed yet';
    var ac = $('#afterCanvas');
    ac.getContext('2d').clearRect(0, 0, ac.width, ac.height);
    wrap.classList.add('on');
  }

  function showAfter() {
    if (!outBlob) return;
    ImgCompress.decode(outBlob).then(function (bm) {
      drawInto($('#afterCanvas'), bm, 300);
      $('#afterMeta').textContent = outW + '×' + outH + ' · ' + fmt(outBlob.size);
    }).catch(function () {});   // a preview failure must never block the download
  }

  /* ---------- run ---------- */
  go.addEventListener('click', function () {
    if (!srcBitmap) return;
    var targetKB = parseInt($('#target').value, 10) || 100;
    var targetBytes = Math.max(5, targetKB) * 1024;
    var allowResize = $('#resize').value === 'yes';
    var wantPng = $('#format').value === 'png';
    var type = wantPng ? 'image/png' : 'image/jpeg';

    go.disabled = true;
    result.classList.remove('on', 'miss');
    prog(5);

    /* Already small enough: hand it back untouched rather than re-encoding it
       into something both larger and worse. Only when it is already the format
       that was asked for, though - someone who picks JPEG because the portal
       demands JPEG is not helped by getting their PNG back. */
    var sameFormat = wantPng ? /png/i.test(srcBlob.type) : /jpe?g/i.test(srcBlob.type);
    if (sameFormat && srcBlob.size <= targetBytes) {
      outBlob = srcBlob; outW = srcW; outH = srcH;
      finish(true, 'This image is already under your ' + targetKB +
        ' KB target' + (wantPng ? ' and already a PNG' : '') +
        ', so it is unchanged. Re-compressing it would only lose quality.');
      return;
    }

    var ticks = 0;
    ImgCompress.toTarget(srcBitmap, {
      width: srcW, height: srcH, targetBytes: targetBytes,
      type: type, allowResize: allowResize,
      onStage: function (msg) { say(msg); prog(10 + (++ticks) * 11); }
    }).then(function (r) {
      if (!r) { say('Could not compress this image.'); bar.classList.remove('on'); go.disabled = false; return; }

      /* Re-encoding does not always shrink things - an already-optimised file
         can come back larger. Never hand back more bytes than we were given. */
      if (r.blob.size >= srcBlob.size) {
        outBlob = srcBlob; outW = srcW; outH = srcH;
        finish(false, 'Re-compressing this image made it larger, so the original is ' +
          'returned unchanged. It is already close to as small as this format allows.');
        return;
      }

      outBlob = r.blob; outW = r.w; outH = r.h;
      if (wantPng) {
        finish(r.hit, r.hit
          ? 'PNG is lossless, so the size came down by reducing dimensions to ' +
            r.w + '×' + r.h + '.'
          : 'PNG has no quality setting, so dimensions are the only lever — and this ' +
            'image will not reach ' + targetKB + ' KB as a PNG. Choose JPEG instead.');
      } else {
        finish(r.hit, r.hit
          ? (r.w === srcW
              ? 'Full dimensions kept — only the JPEG quality was reduced.'
              : 'Quality alone was not enough, so it was resized to ' +
                r.w + '×' + r.h + '.')
          : 'Could not reach ' + targetKB + ' KB even at ' + r.w + '×' + r.h +
            '. This is the smallest sensible result.');
      }
    }).catch(function (err) {
      console.error(err);
      say('Something went wrong: ' + (err && err.message ? err.message : 'unknown error'));
      bar.classList.remove('on'); go.disabled = false;
    });
  });

  function finish(hit, note) {
    prog(100);
    var pct = srcBlob.size
      ? Math.round(((srcBlob.size - outBlob.size) / srcBlob.size) * 100) : 0;
    $('#rBig').textContent = fmt(outBlob.size) +
      (pct > 0 ? '  —  ' + pct + '% smaller' : '  —  unchanged');
    $('#rMeta').textContent = 'Was ' + fmt(srcBlob.size) + ' at ' + srcW + '×' + srcH +
      ', now ' + fmt(outBlob.size) + ' at ' + outW + '×' + outH + '. ' + note;
    result.classList.add('on');
    if (!hit) result.classList.add('miss');
    say(''); bar.classList.remove('on'); go.disabled = false;
    showAfter();
  }

  $('#dl').addEventListener('click', function () {
    if (!outBlob) return;
    var ext = outBlob.type === 'image/png' ? '.png' : '.jpg';
    var a = document.createElement('a');
    a.href = URL.createObjectURL(outBlob);
    a.download = srcName + '-' + Math.round(outBlob.size / 1024) + 'kb' + ext;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  });

  $('#format').addEventListener('change', function () {
    var note = $('#pngNote');
    if (note) note.style.display = this.value === 'png' ? '' : 'none';
  });
})();
