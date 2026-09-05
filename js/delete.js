/* SizeMyPDF - remove pages from a PDF. Lossless: the pages you keep are copied
   across as-is, so nothing is re-encoded. */
(function () {
  'use strict';
  var ui, thumbApi = null, pageCount = 0;

  /* Thumbnails matter more here than anywhere else on the site: deleting the
     wrong page is silent and only noticed after the file has been sent. */
  function buildThumbs(state) {
    pageCount = state.pageCount;
    var box = document.getElementById('thumbs');
    if (!box || typeof PDFThumbs === 'undefined') return;
    thumbApi = null;
    var hint = document.getElementById('thumbHint');
    if (hint) { hint.style.display = ''; hint.textContent = 'Loading page previews…'; }

    PDFThumbs.grid(box, state.bytes, {
      onChange: function (pages) {
        document.getElementById('pages').value = PDFThumbs.toRanges(pages);
      }
    }).then(function (api) {
      thumbApi = api;
      if (hint) hint.textContent = 'Click the pages you want to remove — they turn red.';
    }).catch(function (err) {
      console.error(err);
      if (hint) hint.textContent =
        'Page previews could not be loaded, but removing pages still works.';
    });
  }

  document.getElementById('pages').addEventListener('input', function () {
    if (!thumbApi) return;
    var p = PageOps.parsePages(this.value, pageCount, false);
    thumbApi.setSelection(p.indices.map(function (i) { return i + 1; }));
  });

  ui = PageOps.init({
    suffix: 'pages-removed',
    working: 'Removing pages…',
    onLoad: buildThumbs,

    run: function (doc, state) {
      var parsed = PageOps.parsePages(
        document.getElementById('pages').value, state.pageCount, false);

      if (parsed.bad.length) {
        ui.say('Could not understand: ' + parsed.bad.join(', ') +
               '. Use page numbers between 1 and ' + state.pageCount +
               ', like 2, 5-7.');
        return null;
      }
      if (!parsed.indices.length) {
        ui.say('Enter which pages to remove, for example 2, 5-7.');
        return null;
      }
      if (parsed.indices.length >= state.pageCount) {
        ui.say('That would remove every page. Leave at least one behind — ' +
               'a PDF with no pages is not a valid file.');
        return null;
      }

      // Build the keep list, preserving original order.
      var drop = {};
      parsed.indices.forEach(function (i) { drop[i] = true; });
      var keep = [];
      for (var i = 0; i < state.pageCount; i++) if (!drop[i]) keep.push(i);

      return PDFLib.PDFDocument.create().then(function (out) {
        return out.copyPages(doc, keep).then(function (pages) {
          pages.forEach(function (p) { out.addPage(p); });
          return out.save({ useObjectStreams: true });
        }).then(function (bytes) {
          return {
            bytes: bytes,
            headline: keep.length + (keep.length === 1 ? ' page kept' : ' pages kept'),
            meta: 'Removed ' + parsed.indices.length +
                  (parsed.indices.length === 1 ? ' page' : ' pages') +
                  ' from ' + state.pageCount + '. Nothing was re-encoded, so the ' +
                  'remaining pages are byte-for-byte as they were.'
          };
        });
      });
    }
  });
})();
