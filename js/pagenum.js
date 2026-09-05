/* SizeMyPDF - stamp page numbers onto a PDF. */
(function () {
  'use strict';
  var ui;

  ui = PageOps.init({
    suffix: 'numbered',
    working: 'Adding page numbers…',

    run: function (doc, state) {
      var pos = document.getElementById('position').value;   // bl | bc | br | tr
      var startAt = parseInt(document.getElementById('startat').value, 10);
      var skipFirst = document.getElementById('skipfirst').checked;
      var showTotal = document.getElementById('format').value === 'of';
      var size = parseInt(document.getElementById('size').value, 10) || 11;

      if (isNaN(startAt)) startAt = 1;

      return doc.embedFont(PDFLib.StandardFonts.Helvetica).then(function (font) {
        var pages = doc.getPages();
        var total = pages.length - (skipFirst ? 1 : 0);
        var stamped = 0;

        pages.forEach(function (page, i) {
          if (skipFirst && i === 0) return;
          var n = startAt + stamped;
          var label = showTotal ? (n + ' of ' + (startAt + total - 1)) : String(n);

          var w = page.getWidth(), h = page.getHeight();
          var tw = font.widthOfTextAtSize(label, size);
          var m = 28;                                  // ~10mm margin
          var x, y;
          if (pos === 'bl')      { x = m;                 y = m; }
          else if (pos === 'br') { x = w - m - tw;        y = m; }
          else if (pos === 'tr') { x = w - m - tw;        y = h - m - size; }
          else                   { x = (w - tw) / 2;      y = m; }   // bc

          page.drawText(label, {
            x: x, y: y, size: size, font: font,
            color: PDFLib.rgb(0.25, 0.25, 0.25)
          });
          stamped++;
        });

        return doc.save({ useObjectStreams: true }).then(function (bytes) {
          return {
            bytes: bytes,
            headline: stamped + (stamped === 1 ? ' page numbered' : ' pages numbered'),
            meta: 'Numbering started at ' + startAt +
                  (skipFirst ? ', first page skipped' : '') +
                  '. Text was drawn onto the existing pages, so nothing else changed.'
          };
        });
      });
    }
  });
})();
