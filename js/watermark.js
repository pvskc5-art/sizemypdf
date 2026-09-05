/* SizeMyPDF - stamp a text watermark across every page. */
(function () {
  'use strict';
  var ui;

  ui = PageOps.init({
    suffix: 'watermarked',
    working: 'Applying watermark…',

    run: function (doc, state) {
      var text = (document.getElementById('text').value || '').trim();
      if (!text) {
        ui.say('Type the watermark text first, for example CONFIDENTIAL.');
        return null;
      }
      if (text.length > 60) {
        ui.say('That watermark is very long. Keep it under 60 characters so it ' +
               'stays legible across the page.');
        return null;
      }

      var opacity = parseInt(document.getElementById('opacity').value, 10) / 100;
      var diagonal = document.getElementById('angle').value === 'diagonal';

      return doc.embedFont(PDFLib.StandardFonts.HelveticaBold).then(function (font) {
        var pages = doc.getPages();

        pages.forEach(function (page) {
          var w = page.getWidth(), h = page.getHeight();

          // Size the text to span most of the page, whichever way it is drawn.
          var target = diagonal ? Math.sqrt(w * w + h * h) * 0.72 : w * 0.72;
          var size = 12;
          var width = font.widthOfTextAtSize(text, size);
          if (width > 0) size = Math.max(8, Math.min(240, size * target / width));
          width = font.widthOfTextAtSize(text, size);
          var height = font.heightAtSize(size);

          var opts = {
            size: size, font: font,
            color: PDFLib.rgb(0.45, 0.45, 0.45),
            opacity: opacity
          };

          if (diagonal) {
            // Rotating about the origin means the anchor must be offset by hand
            // so the text ends up centred on the page rather than off-canvas.
            var rad = Math.PI / 4;
            opts.rotate = PDFLib.degrees(45);
            opts.x = w / 2 - (width / 2) * Math.cos(rad) + (height / 2) * Math.sin(rad);
            opts.y = h / 2 - (width / 2) * Math.sin(rad) - (height / 2) * Math.cos(rad);
          } else {
            opts.x = (w - width) / 2;
            opts.y = (h - height) / 2;
          }

          page.drawText(text, opts);
        });

        return doc.save({ useObjectStreams: true }).then(function (bytes) {
          return {
            bytes: bytes,
            headline: pages.length + (pages.length === 1 ? ' page watermarked' : ' pages watermarked'),
            meta: 'Drawn at ' + Math.round(opacity * 100) + '% opacity, ' +
                  (diagonal ? 'diagonally' : 'horizontally') +
                  '. The watermark sits on top of the page content and can be ' +
                  'removed by anyone with the right tools — treat it as a label, not security.'
          };
        });
      });
    }
  });
})();
