/* SizeMyPDF - render a PDF to pixels and rebuild it as a new PDF.

   Two tools need this and they need it for the same reason: some things cannot
   be done to a PDF by editing its structure. Redaction has to destroy the text
   rather than cover it, and removing a password means producing a file that
   never had one. Both end up at the same operation - draw every page, throw the
   original away, assemble a fresh document from the images.

   It is the same trade the compressor's Target Size mode makes, and the same
   one the pages are expected to state plainly: what comes back is images, so
   text stops being selectable.

   window.PDFRaster.rebuild(pdfjsDoc, opts) -> Promise<Uint8Array>
     opts.onPage(pageNo, ctx, canvas)  paint over a rendered page before it is
                                       encoded - this is the only chance
     opts.onProgress(pageNo, total)
     opts.scale                        default 1.8
     opts.quality                      default 0.85 */
window.PDFRaster = (function () {
  'use strict';

  /* Higher than the compressor's 1.4: these tools are not chasing a byte
     ceiling, so the only reason to hold the scale down is memory. The cap
     keeps a single oversized page from allocating a canvas the phone cannot
     hold. */
  var SCALE = 1.8, CAP = 2600, QUALITY = 0.85;

  function toJpeg(c, q) {
    return new Promise(function (res) {
      if (c.toBlob) c.toBlob(function (b) { res(b); }, 'image/jpeg', q);
      else {
        var d = c.toDataURL('image/jpeg', q),
            bin = atob(d.split(',')[1]), arr = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        res(new Blob([arr], { type: 'image/jpeg' }));
      }
    });
  }

  function rebuild(pdfDoc, opts) {
    opts = opts || {};
    var scale = opts.scale || SCALE;
    var quality = opts.quality || QUALITY;
    var total = pdfDoc.numPages;
    var out = null;

    return PDFLib.PDFDocument.create().then(function (o) {
      out = o;
      var chain = Promise.resolve();
      for (var n = 1; n <= total; n++) {
        (function (p) {
          chain = chain.then(function () {
            if (opts.onProgress) opts.onProgress(p, total);
            return pdfDoc.getPage(p).then(function (page) {
              var vp = page.getViewport({ scale: scale });
              var k = Math.min(1, CAP / Math.max(vp.width, vp.height));
              if (k < 1) vp = page.getViewport({ scale: scale * k });
              var c = document.createElement('canvas');
              c.width = Math.max(1, Math.floor(vp.width));
              c.height = Math.max(1, Math.floor(vp.height));
              var ctx = c.getContext('2d');
              // White first: a transparent canvas encodes to black in JPEG.
              ctx.fillStyle = '#fff';
              ctx.fillRect(0, 0, c.width, c.height);
              return page.render({ canvasContext: ctx, viewport: vp }).promise
                .then(function () {
                  if (opts.onPage) opts.onPage(p, ctx, c);
                  return toJpeg(c, quality);
                })
                .then(function (blob) { return blob.arrayBuffer(); })
                .then(function (ab) { return out.embedJpg(ab); })
                .then(function (img) {
                  var pg = out.addPage([img.width, img.height]);
                  pg.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
                });
            });
          });
        })(n);
      }
      return chain;
    }).then(function () {
      /* Nothing carries over from the original but the pixels, and the
         metadata should not either: author, producer and title survive
         operations people assume are cleaning a file. */
      out.setTitle(''); out.setAuthor(''); out.setSubject('');
      out.setKeywords([]); out.setProducer(''); out.setCreator('');
      return out.save({ useObjectStreams: true });
    });
  }

  return { rebuild: rebuild, toJpeg: toJpeg, SCALE: SCALE };
})();
