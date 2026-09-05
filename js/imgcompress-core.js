/* SizeMyPDF - the image size-targeting engine, with no DOM dependencies.

   The mirror of compress-core.js. Extracted so the algorithm can be reused by
   a second page, or tested, without dragging a page controller along with it -
   the PDF engine only became reusable once the same split was made, and that
   is what let the batch page share it instead of copying it.

   window.ImgCompress
     .decode(blob)                      -> Promise<ImageBitmap|HTMLImageElement>
     .toTarget(bitmap, opts)            -> Promise<{ blob, w, h, hit }>
     .SCALES

   opts: { targetBytes, type ('image/jpeg'|'image/png'), allowResize, onStage } */
window.ImgCompress = (function () {
  'use strict';

  function noop() {}

  /* Phone cameras record rotation as EXIF metadata rather than rotating the
     pixels. Decoders that ignore it produce sideways photographs. */
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

  /* Quality is spent before dimensions on purpose: reducing dimensions first
     hits any target easily but hands back a small blurry picture when a
     slightly softer full-size one would have been accepted. */
  function jpegToTarget(bitmap, w, h, targetBytes, allowResize, onStage) {
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
      onStage(s === 1
        ? 'Trying full size…'
        : 'Trying ' + Math.round(s * 100) + '% size (' + cw + '×' + ch + ')…');
      var canvas = canvasAt(bitmap, cw, ch);

      return bestAtSize(canvas, 'image/jpeg', targetBytes).then(function (r) {
        if (r.smallest && (!fallback || r.smallest.size < fallback.size)) {
          fallback = r.smallest; fallbackDims = [cw, ch];
        }
        if (r.best) return { blob: r.best, w: cw, h: ch, hit: true };
        return tryScale();
      });
    }
    return tryScale();
  }

  /* PNG is lossless and has no quality dial, so dimensions are the only lever. */
  function pngToTarget(bitmap, w, h, targetBytes, allowResize, onStage) {
    var scales = allowResize ? SCALES : [1];
    var i = 0, best = null, bestDims = null;
    function next() {
      if (i >= scales.length) return Promise.resolve();
      var s = scales[i++];
      var cw = Math.max(1, Math.round(w * s)), ch = Math.max(1, Math.round(h * s));
      onStage('Trying ' + cw + '×' + ch + '…');
      return encode(canvasAt(bitmap, cw, ch), 'image/png', 1).then(function (b) {
        if (!b) return next();
        if (!best || b.size < best.size) { best = b; bestDims = [cw, ch]; }
        if (b.size <= targetBytes) return;
        return next();
      });
    }
    return next().then(function () {
      if (!best) return null;
      return { blob: best, w: bestDims[0], h: bestDims[1],
               hit: best.size <= targetBytes };
    });
  }

  function toTarget(bitmap, opts) {
    opts = opts || {};
    var onStage = opts.onStage || noop;
    var w = opts.width || bitmap.width;
    var h = opts.height || bitmap.height;
    var allowResize = opts.allowResize !== false;
    var type = opts.type === 'image/png' ? 'image/png' : 'image/jpeg';
    var target = Math.max(1, opts.targetBytes | 0);

    return type === 'image/png'
      ? pngToTarget(bitmap, w, h, target, allowResize, onStage)
      : jpegToTarget(bitmap, w, h, target, allowResize, onStage);
  }

  return { decode: decode, toTarget: toTarget, SCALES: SCALES };
})();
