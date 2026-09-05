/* SizeMyPDF - compress an image to an exact size, entirely in the browser.

   Same shape as the PDF engine: bisect JPEG quality first, and only start
   reducing dimensions when quality alone cannot reach the target. Quality is
   the cheaper thing to spend - a portal that asks for 100 KB still expects the
   photo to be legible at full size. */
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

  /* Phone photos carry their rotation in EXIF rather than in the pixels. Drawn
     to a canvas naively they come out sideways, so decode with the orientation
     applied where the browser supports it. */
  function decode(blob) {
    function viaImage() {
      return new Promise(function (res, rej) {
        var img = new Image();
        var url = URL.createObjectURL(blob);
        img.onload = function () { res(img); };
        img.onerror = function () {
          URL.revokeObjectURL(url);
          rej(new Error('could not decode this image'));
        };
        img.src = url;
      });
    }
    if (!window.createImageBitmap) return viaImage();
    try {
      return createImageBitmap(blob, { imageOrientation: 'from-image' })
        .catch(function () { return createImageBitmap(blob); })
        .catch(viaImage);
    } catch (e) {
      return viaImage();
    }
  }

  function canvasAt(bitmap, w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    var ctx = c.getContext('2d');
    // JPEG has no alpha channel; without this, transparent areas turn black
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, c.width, c.height);
    return c;
  }

  function encode(canvas, type, q) {
    return new Promise(function (res) {
      canvas.toBlob(function (b) { res(b); }, type, q);
    });
  }

  /* Highest quality that still fits, by bisection. best is null when even the
     lowest quality at these dimensions overshoots. */
  function bestAtSize(canvas, type, targetBytes) {
    var lo = 0.2, hi = 0.95, best = null, smallest = null, steps = 0;
    function step() {
      if (steps++ >= 7) return Promise.resolve({ best: best, smallest: smallest });
      var q = (lo + hi) / 2;
      return encode(canvas, type, q).then(function (b) {
        if (!b) return { best: best, smallest: smallest };
        if (!smallest || b.size < smallest.size) smallest = b;
        if (b.size <= targetBytes) { best = b; lo = q; } else { hi = q; }
        return step();
      });
    }
    return step();
  }

  var SCALES = [1, 0.85, 0.7, 0.55, 0.45, 0.35, 0.25];

  function toTarget(bitmap, w, h, targetBytes, type, allowResize) {
    var scales = allowResize ? SCALES : [1];
    var idx = 0, fallback = null, fallbackDims = null;

    function tryScale() {
      if (idx >= scales.length) {
        return Promise.resolve(fallback
          ? { blob: fallback, w: fallbackDims[0], h: fallbackDims[1], hit: false }
          : null);
      }
      var s = scales[idx++];
      var cw = Math.max(1, Math.round(w * s)), ch = Math.max(1, Math.round(h * s));
      say(s === 1
        ? 'Trying full size…'
        : 'Trying ' + Math.round(s * 100) + '% size (' + cw + '×' + ch + ')…');
      var canvas = canvasAt(bitmap, cw, ch);
      prog(10 + (idx / scales.length) * 80);

      return bestAtSize(canvas, type, targetBytes).then(function (r) {
        if (r.smallest && (!fallback || r.smallest.size < fallback.size)) {
          fallback = r.smallest; fallbackDims = [cw, ch];
        }
        if (r.best) return { blob: r.best, w: cw, h: ch, hit: true };
        return tryScale();
      });
    }
    return tryScale();
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
    decode(f).then(function (bm) {
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
    decode(outBlob).then(function (bm) {
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
    var type = $('#format').value === 'png' ? 'image/png' : 'image/jpeg';

    go.disabled = true;
    result.classList.remove('on', 'miss');
    prog(5);

    if (type === 'image/png') { pngToTarget(targetBytes, allowResize, targetKB); return; }

    /* Already small enough: hand it back untouched rather than re-encoding it
       into something both larger and worse. Only when it is already the format
       that was asked for, though - someone who picks JPEG because the portal
       demands JPEG is not helped by getting their PNG back. */
    if (srcBlob.size <= targetBytes && /jpe?g/i.test(srcBlob.type)) {
      outBlob = srcBlob; outW = srcW; outH = srcH;
      finish(true, 'This image is already under your ' + targetKB +
        ' KB target, so it is unchanged. Re-compressing it would only lose quality.');
      return;
    }

    toTarget(srcBitmap, srcW, srcH, targetBytes, type, allowResize)
      .then(function (r) {
        if (!r) { say('Could not compress this image.'); bar.classList.remove('on'); go.disabled = false; return; }

        /* Re-encoding does not always shrink things - an already-optimised JPEG
           can come back larger. Never hand back more bytes than we were given. */
        if (r.blob.size >= srcBlob.size) {
          outBlob = srcBlob; outW = srcW; outH = srcH;
          finish(false, 'Re-compressing this image made it larger, so the original is ' +
            'returned unchanged. It is already close to as small as this format allows.');
          return;
        }

        outBlob = r.blob; outW = r.w; outH = r.h;
        finish(r.hit, r.hit
          ? (r.w === srcW
              ? 'Full dimensions kept — only the JPEG quality was reduced.'
              : 'Quality alone was not enough, so it was resized to ' +
                r.w + '×' + r.h + '.')
          : 'Could not reach ' + targetKB + ' KB even at ' + r.w + '×' + r.h +
            '. This is the smallest sensible result.');
      })
      .catch(function (err) {
        console.error(err);
        say('Something went wrong: ' + (err && err.message ? err.message : 'unknown error'));
        bar.classList.remove('on'); go.disabled = false;
      });
  });

  /* PNG is lossless and has no quality dial, so dimensions are the only lever. */
  function pngToTarget(targetBytes, allowResize, targetKB) {
    if (srcBlob.size <= targetBytes && /png/i.test(srcBlob.type)) {
      outBlob = srcBlob; outW = srcW; outH = srcH;
      finish(true, 'This image is already under your ' + targetKB +
        ' KB target and already a PNG, so it is unchanged.');
      return;
    }
    var scales = allowResize ? SCALES : [1];
    var i = 0, best = null, bestDims = null;
    function next() {
      if (i >= scales.length) return Promise.resolve();
      var s = scales[i++];
      var cw = Math.max(1, Math.round(srcW * s)), ch = Math.max(1, Math.round(srcH * s));
      say('Trying ' + cw + '×' + ch + '…');
      prog(10 + (i / scales.length) * 80);
      return encode(canvasAt(srcBitmap, cw, ch), 'image/png', 1).then(function (b) {
        if (!b) return next();
        if (!best || b.size < best.size) { best = b; bestDims = [cw, ch]; }
        if (b.size <= targetBytes) return;
        return next();
      });
    }
    next().then(function () {
      if (!best) { say('Could not compress this image.'); bar.classList.remove('on'); go.disabled = false; return; }
      if (best.size >= srcBlob.size) {
        outBlob = srcBlob; outW = srcW; outH = srcH;
        finish(false, 'Re-encoding made it larger, so the original is returned unchanged.');
        return;
      }
      outBlob = best; outW = bestDims[0]; outH = bestDims[1];
      var hit = best.size <= targetBytes;
      finish(hit, hit
        ? 'PNG is lossless, so the size came down by reducing dimensions to ' +
          outW + '×' + outH + '.'
        : 'PNG has no quality setting, so dimensions are the only lever — and this ' +
          'image will not reach ' + targetKB + ' KB as a PNG. Choose JPEG instead.');
    }).catch(function (err) {
      console.error(err);
      say('Something went wrong: ' + (err && err.message ? err.message : 'unknown error'));
      bar.classList.remove('on'); go.disabled = false;
    });
  }

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
    var png = this.value === 'png';
    var note = $('#pngNote');
    if (note) note.style.display = png ? '' : 'none';
  });
})();
