/* SizeMyPDF - page thumbnails for the pdf-lib tools.

   Split, Delete and Merge do their real work with pdf-lib alone. Thumbnails
   need pdf.js, which with its worker is about 1.4 MB - far too much to put in
   front of every visitor for a preview most of them will not wait around for.
   So pdf.js is fetched the first time a document is actually opened, not on
   page load, and the pages themselves are rendered only as their tiles scroll
   into view. A 400-page document therefore costs a few visible canvases rather
   than four hundred.

   window.PDFThumbs
     .grid(container, arrayBuffer, opts) -> Promise<{ setSelection, pageCount }>
     .cover(arrayBuffer, width)          -> Promise<canvas>
     .toRanges([1,2,3,7])                -> "1-3, 7" */
window.PDFThumbs = (function () {
  'use strict';

  var loading = null;

  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { res(); };
      s.onerror = function () { rej(new Error('could not load ' + src)); };
      document.head.appendChild(s);
    });
  }

  /* These two are deliberately unversioned. Everything else on the site is
     cache-busted with a content hash, but these are fetched at runtime rather
     than written into the page, so there is no build step to stamp them; both
     are stable files that change only when the library version does. */
  function ensure() {
    if (window.pdfjsLib) return Promise.resolve();
    if (loading) return loading;
    loading = loadScript('js/pdfjs-raf.js')
      .then(function () { return loadScript('vendor/pdf.min.js'); })
      .then(function () {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
      })
      .catch(function (e) { loading = null; throw e; });
    return loading;
  }

  function renderPage(doc, pageNo, canvas, targetW) {
    return doc.getPage(pageNo).then(function (page) {
      var vp = page.getViewport({ scale: 1 });
      var scale = targetW / vp.width;
      vp = page.getViewport({ scale: scale });
      canvas.width = Math.max(1, Math.floor(vp.width));
      canvas.height = Math.max(1, Math.floor(vp.height));
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return page.render({ canvasContext: ctx, viewport: vp }).promise;
    });
  }

  /* "1-3, 7, 9-10" from [1,2,3,7,9,10] - the format the range boxes already
     accept, so clicking pages and typing them stay interchangeable. */
  function toRanges(nums) {
    var a = nums.slice().sort(function (x, y) { return x - y; });
    var out = [], i = 0;
    while (i < a.length) {
      var start = a[i], end = start;
      while (i + 1 < a.length && a[i + 1] === a[i] + 1) { i++; end = a[i]; }
      out.push(end > start + 1 ? (start + '-' + end)
             : end === start + 1 ? (start + ', ' + end)
             : String(start));
      i++;
    }
    return out.join(', ');
  }

  function grid(container, arrayBuffer, opts) {
    opts = opts || {};
    var width = opts.width || 104;
    var selectable = opts.selectable !== false;
    var selected = {};
    var tiles = [];
    var doc = null;

    container.textContent = '';
    container.classList.add('thumbs');
    container.setAttribute('aria-busy', 'true');

    return ensure()
      .then(function () {
        return pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;
      })
      .then(function (d) {
        doc = d;
        var frag = document.createDocumentFragment();

        for (var n = 1; n <= doc.numPages; n++) {
          (function (pageNo) {
            var tile = document.createElement(selectable ? 'button' : 'div');
            tile.className = 'thumb';
            if (selectable) {
              tile.type = 'button';
              tile.setAttribute('aria-pressed', 'false');
              tile.setAttribute('aria-label', 'Page ' + pageNo);
              tile.addEventListener('click', function () { toggle(pageNo); });
            }

            var shell = document.createElement('span');
            shell.className = 'sh';
            var canvas = document.createElement('canvas');
            shell.appendChild(canvas);

            var label = document.createElement('span');
            label.className = 'n';
            label.textContent = pageNo;

            tile.appendChild(shell);
            tile.appendChild(label);
            frag.appendChild(tile);
            var rec = { el: tile, canvas: canvas, page: pageNo,
                        done: false, queued: false };
            tiles.push(rec);
          })(n);
        }

        container.appendChild(frag);
        container.setAttribute('aria-busy', 'false');
        container.classList.add('on');
        startLazyRender();
        return { setSelection: setSelection, pageCount: doc.numPages };
      });

    /* Render only what is on screen, one page at a time. Rendering a whole
       document up front is what makes other previewers hang on long files.

       Visibility is measured with getBoundingClientRect rather than an
       IntersectionObserver on purpose: the observer, like requestAnimationFrame,
       only reports when the browser is compositing, so in a background or
       occluded tab it never fires and every tile stays an empty grey box with
       nothing to indicate why. Geometry is always available. */
    function startLazyRender() {
      var queue = [], busy = false;

      function pump() {
        if (busy || !queue.length) return;
        busy = true;
        var t = queue.shift();
        renderPage(doc, t.page, t.canvas, width)
          .then(function () { t.done = true; })
          .catch(function () { t.el.classList.add('failed'); })
          .then(function () { busy = false; pump(); });
      }

      function near(el) {
        var r = el.getBoundingClientRect();
        var box = container.getBoundingClientRect();
        // A viewport height of zero means the browser has not laid the page
        // out for display at all; clamping to it would hide every tile, so
        // fall back to the container's own box instead of rendering nothing.
        var vh = window.innerHeight || document.documentElement.clientHeight || 0;
        var top = vh ? Math.max(box.top, 0) : box.top;
        var bottom = vh ? Math.min(box.bottom, vh) : box.bottom;
        return r.bottom > top - 300 && r.top < bottom + 300;
      }

      function refresh() {
        var added = false;
        for (var i = 0; i < tiles.length; i++) {
          var t = tiles[i];
          if (t.queued || t.done) continue;
          if (near(t.el)) { t.queued = true; queue.push(t); added = true; }
        }
        if (added) pump();
      }

      container.addEventListener('scroll', refresh);
      window.addEventListener('scroll', refresh, true);
      window.addEventListener('resize', refresh);
      refresh();
    }

    function toggle(pageNo) {
      if (selected[pageNo]) delete selected[pageNo]; else selected[pageNo] = true;
      paint();
      if (opts.onChange) opts.onChange(list());
    }

    function list() {
      return Object.keys(selected).map(Number)
        .sort(function (a, b) { return a - b; });
    }

    function paint() {
      tiles.forEach(function (t) {
        var on = !!selected[t.page];
        t.el.classList.toggle('sel', on);
        if (t.el.setAttribute) t.el.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }

    // called by the page when the text box is edited, so the two stay in step
    function setSelection(nums) {
      selected = {};
      (nums || []).forEach(function (n) { selected[n] = true; });
      paint();
    }
  }

  function cover(arrayBuffer, width) {
    return ensure()
      .then(function () {
        return pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;
      })
      .then(function (doc) {
        var canvas = document.createElement('canvas');
        return renderPage(doc, 1, canvas, width || 46).then(function () {
          if (doc.destroy) { try { doc.destroy(); } catch (e) {} }
          return canvas;
        });
      });
  }

  return { grid: grid, cover: cover, toRanges: toRanges, ensure: ensure };
})();
