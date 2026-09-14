/* SizeMyPDF - redact a PDF.

   The distinction that matters: every other free redaction tool draws a black
   rectangle as a PDF annotation and hands the file back. The words are still
   in the content stream underneath. Select-all, copy, paste - there they are.
   Newspapers and courts have published documents redacted that way and leaked
   the text.

   This tool does what the site already does for Target Size mode: it renders
   each page to a canvas, paints the boxes onto the pixels, and rebuilds the
   PDF from those images. The text is not covered, it is gone - there is no
   text layer left to recover. The cost is the same one the compressor is
   honest about: the output is images, so text stops being selectable. For
   redaction that is a feature, not a regression, and the page says so. */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };

  var pdfDoc = null, pageCount = 0, pageNo = 1;
  var boxes = {};              // pageNo -> [{x,y,w,h}] in 0..1 page units
  var stage, canvas, layer, ui;
  var drag = null;

  function boxesOn(n) { return boxes[n] || (boxes[n] = []); }

  function totalBoxes() {
    var t = 0;
    Object.keys(boxes).forEach(function (k) { t += boxes[k].length; });
    return t;
  }

  /* ---------- the editing stage ---------- */

  function showPage(n) {
    if (!pdfDoc) return;
    pageNo = Math.min(Math.max(1, n), pageCount);
    $('#pageLabel').textContent = 'Page ' + pageNo + ' of ' + pageCount;
    $('#prev').disabled = pageNo <= 1;
    $('#next').disabled = pageNo >= pageCount;

    return pdfDoc.getPage(pageNo).then(function (page) {
      /* Fit the working view to the column rather than the page's own size, so
         a poster and a receipt are both workable without scrolling sideways.

         Measured on the block parent, not on the stage: the stage is an
         inline-block wrapped around the canvas, and before the first render
         the canvas is still at its default 300x150, so asking the stage for
         its width returns 300 and every page comes out small. */
      var vp = page.getViewport({ scale: 1 });
      var box = stage.parentNode;
      var targetW = Math.min(700, (box && box.clientWidth) || 700);
      var scale = targetW / vp.width;
      vp = page.getViewport({ scale: scale });
      canvas.width = Math.max(1, Math.floor(vp.width));
      canvas.height = Math.max(1, Math.floor(vp.height));
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return page.render({ canvasContext: ctx, viewport: vp }).promise;
    }).then(paint);
  }

  /* Boxes are absolutely positioned elements over the canvas rather than pixels
     painted into it: they have to stay removable while editing, and only become
     permanent when the file is built. */
  function paint() {
    layer.textContent = '';
    var list = boxesOn(pageNo);
    list.forEach(function (b, i) {
      var el = document.createElement('button');
      el.type = 'button';
      el.className = 'redbox';
      el.style.left = (b.x * 100) + '%';
      el.style.top = (b.y * 100) + '%';
      el.style.width = (b.w * 100) + '%';
      el.style.height = (b.h * 100) + '%';
      el.title = 'Click to remove this box';
      el.setAttribute('aria-label',
        'Redaction box ' + (i + 1) + ' on page ' + pageNo + '. Activate to remove.');
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        list.splice(i, 1);
        paint(); summarise();
      });
      layer.appendChild(el);
    });
    if (drag) {
      var d = document.createElement('div');
      d.className = 'redbox drawing';
      d.style.left = (Math.min(drag.x0, drag.x1) * 100) + '%';
      d.style.top = (Math.min(drag.y0, drag.y1) * 100) + '%';
      d.style.width = (Math.abs(drag.x1 - drag.x0) * 100) + '%';
      d.style.height = (Math.abs(drag.y1 - drag.y0) * 100) + '%';
      layer.appendChild(d);
    }
    summarise();
  }

  function summarise() {
    var here = boxesOn(pageNo).length, all = totalBoxes();
    var s = here ? here + (here === 1 ? ' box on this page' : ' boxes on this page')
                 : 'Drag across anything that must not survive.';
    if (all > here) s += ' — ' + all + ' in the document.';
    $('#redInfo').textContent = s;
    $('#go').disabled = all === 0;
    $('#clearPage').disabled = here === 0;
  }

  function pointToPage(e) {
    var r = canvas.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    };
  }

  var drawingWired = false;
  function wireDrawing() {
    if (drawingWired) return;
    drawingWired = true;
    layer.addEventListener('pointerdown', function (e) {
      if (e.target !== layer) return;            // clicking a box removes it
      var p = pointToPage(e);
      drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      layer.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    layer.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var p = pointToPage(e);
      drag.x1 = p.x; drag.y1 = p.y;
      paint();
    });
    layer.addEventListener('pointerup', function (e) {
      if (!drag) return;
      var w = Math.abs(drag.x1 - drag.x0), h = Math.abs(drag.y1 - drag.y0);
      // A stray click is not a redaction. Anything under about four pixels on
      // a 700px stage is almost certainly a misfire, and a zero-area box would
      // silently do nothing at build time.
      if (w > 0.006 && h > 0.006) {
        boxesOn(pageNo).push({
          x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), w: w, h: h
        });
      }
      drag = null;
      try { layer.releasePointerCapture(e.pointerId); } catch (err) {}
      paint();
    });
    layer.addEventListener('pointercancel', function () { drag = null; paint(); });
  }

  /* ---------- building the redacted file ---------- */

  function build() {
    var redactedPages = 0;
    return PDFRaster.rebuild(pdfDoc, {
      onProgress: function (p, total) {
        ui.say('Rebuilding page ' + p + ' of ' + total + '…');
      },
      onPage: function (p, ctx, c) {
        var list = boxesOn(p);
        if (!list.length) return;
        redactedPages++;
        ctx.fillStyle = '#000';
        list.forEach(function (b) {
          /* Round outward. Half a pixel of the original showing at the edge of
             a box is exactly the kind of leak this tool exists to prevent. */
          var x = Math.floor(b.x * c.width),
              y = Math.floor(b.y * c.height),
              w = Math.ceil(b.w * c.width),
              h = Math.ceil(b.h * c.height);
          ctx.fillRect(x, y, w, h);
        });
      }
    }).then(function (bytes) {
      return { bytes: bytes, redactedPages: redactedPages };
    });
  }

  /* ---------- wiring ---------- */

  ui = PageOps.init({
    suffix: 'redacted',
    working: 'Redacting…',

    onLoad: function (state) {
      boxes = {}; pageNo = 1;
      stage = $('#stage'); canvas = $('#stageCanvas'); layer = $('#stageLayer');
      wireDrawing();
      $('#redWrap').style.display = '';
      $('#redInfo').textContent = 'Loading the first page…';

      return PDFThumbs.ensure()
        .then(function () {
          return pdfjsLib.getDocument({ data: state.bytes.slice(0) }).promise;
        })
        .then(function (d) {
          pdfDoc = d; pageCount = d.numPages;
          return showPage(1);
        })
        .catch(function (err) {
          console.error(err);
          ui.say('The page preview could not be loaded, so there is nothing to ' +
                 'draw on. If this PDF is password-protected, remove the ' +
                 'password first.');
          $('#redWrap').style.display = 'none';
        });
    },

    run: function () {
      if (!totalBoxes()) {
        ui.say('Draw at least one box over something before redacting.');
        return null;
      }
      return build().then(function (r) {
        return {
          bytes: r.bytes,
          headline: totalBoxes() + (totalBoxes() === 1 ? ' area removed' : ' areas removed'),
          meta: 'Redacted ' + r.redactedPages +
                (r.redactedPages === 1 ? ' page' : ' pages') + ' of ' + pageCount +
                '. Every page was rebuilt from pixels, so the covered text is not ' +
                'in the file any more — there is no text layer left to copy from. ' +
                'The trade-off is that text throughout the document is now part of ' +
                'the image and can no longer be selected or searched.'
        };
      });
    }
  });

  $('#prev').addEventListener('click', function () { showPage(pageNo - 1); });
  $('#next').addEventListener('click', function () { showPage(pageNo + 1); });
  $('#clearPage').addEventListener('click', function () {
    boxes[pageNo] = []; paint();
  });
  $('#clearAll').addEventListener('click', function () {
    boxes = {}; paint();
  });

  // Re-fit the stage when the column width changes; the boxes are stored in
  // page units so they survive the re-render untouched.
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (!pdfDoc) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { showPage(pageNo); }, 200);
  });
})();
