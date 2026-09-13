/* SizeMyPDF - compare two PDFs and show what changed.

   Text comparison, not pixel comparison, which is the difference that
   matters: a document reflowed by one line would light up a pixel diff from
   that point on while saying nothing about whether a word changed. Here the
   text is extracted from both files and aligned, so an inserted clause is
   reported as an inserted clause.

   The alignment is a standard longest-common-subsequence diff over words,
   computed per page pair. A page that was not touched costs almost nothing to
   check, so long documents stay usable.

   Scans are the honest limitation: two photographs of the same page contain
   no text to compare. The tool says so rather than reporting nonsense. */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var statusEl = $('#status'), result = $('#result'), go = $('#go'),
      diffBox = $('#diff'), info = $('#info');

  var docs = { a: null, b: null };      // { name, buf, pages: [text] }

  function say(t) { statusEl.textContent = t; }
  function fmt(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
    return (b / 1048576).toFixed(2) + ' MB';
  }

  /* ---------- intake ---------- */
  ['a', 'b'].forEach(function (side) {
    var drop = $('#drop-' + side), file = $('#file-' + side);
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('over'); });
    drop.addEventListener('drop', function (e) {
      e.preventDefault(); drop.classList.remove('over');
      if (e.dataTransfer.files.length) accept(side, e.dataTransfer.files[0]);
    });
    file.addEventListener('change', function () {
      if (file.files.length) accept(side, file.files[0]);
    });
  });

  function accept(side, f) {
    if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) {
      say('That does not look like a PDF file.'); return;
    }
    var drop = $('#drop-' + side);
    say('Reading ' + f.name + '…');
    result.classList.remove('on');

    f.arrayBuffer().then(function (ab) {
      return PDFThumbs.ensure().then(function () {
        return pdfjsLib.getDocument({ data: ab.slice(0) }).promise;
      }).then(function (pdf) {
        var pages = [], chain = Promise.resolve();
        for (var i = 1; i <= pdf.numPages; i++) {
          (function (n) {
            chain = chain.then(function () {
              return pdf.getPage(n).then(function (p) {
                return p.getTextContent().then(function (tc) {
                  pages[n - 1] = tc.items.map(function (i2) { return i2.str; })
                    .join(' ').replace(/\s+/g, ' ').trim();
                });
              });
            });
          })(i);
        }
        return chain.then(function () {
          docs[side] = { name: f.name, pages: pages, size: f.size };
          drop.querySelector('strong').textContent = f.name;
          drop.querySelector('small').textContent =
            pages.length + ' pages, ' + fmt(f.size);
          drop.classList.add('has');
          ready();
        });
      });
    }).catch(function (err) {
      console.error(err);
      say('Could not read ' + f.name + ': ' +
          (err && err.message ? err.message : 'unknown error'));
    });
  }

  function ready() {
    var both = docs.a && docs.b;
    go.disabled = !both;
    if (!both) { say(''); return; }
    var emptyA = docs.a.pages.every(function (t) { return !t; });
    var emptyB = docs.b.pages.every(function (t) { return !t; });
    if (emptyA || emptyB) {
      say('One of these has no text to compare — it is probably a scan. Run it ' +
          'through OCR first, then compare the results.');
    } else {
      say('');
    }
    if (info) {
      info.textContent = docs.a.pages.length + ' pages against ' +
        docs.b.pages.length + ' pages.';
    }
  }

  /* ---------- diff ----------
     Word-level longest common subsequence. Capped per page: beyond a few
     thousand words the table is quadratic and a browser tab is the wrong
     place for it, so very long pages fall back to reporting that they differ. */
  var MAX_WORDS = 2500;

  function words(s) { return s ? s.split(' ').filter(Boolean) : []; }

  function diffWords(a, b) {
    if (a.length > MAX_WORDS || b.length > MAX_WORDS) {
      return a.join(' ') === b.join(' ')
        ? [{ op: 'same', text: '(page unchanged)' }]
        : [{ op: 'note', text: '(this page is too long to show word by word, and it changed)' }];
    }
    var n = a.length, m = b.length;
    // LCS lengths table
    var prev = new Int32Array(m + 1), cur = new Int32Array(m + 1);
    var table = [];
    for (var i = 0; i < n; i++) {
      cur = new Int32Array(m + 1);
      for (var j = 0; j < m; j++) {
        cur[j + 1] = a[i] === b[j] ? prev[j] + 1 : Math.max(cur[j], prev[j + 1]);
      }
      table.push(cur);
      prev = cur;
    }
    // walk back
    var out = [], ii = n, jj = m;
    while (ii > 0 && jj > 0) {
      if (a[ii - 1] === b[jj - 1]) { out.push({ op: 'same', text: a[ii - 1] }); ii--; jj--; }
      else {
        var up = ii > 1 ? table[ii - 2][jj] : 0;
        var left = table[ii - 1][jj - 1];
        if (left >= up) { out.push({ op: 'add', text: b[jj - 1] }); jj--; }
        else { out.push({ op: 'del', text: a[ii - 1] }); ii--; }
      }
    }
    while (jj > 0) { out.push({ op: 'add', text: b[jj - 1] }); jj--; }
    while (ii > 0) { out.push({ op: 'del', text: a[ii - 1] }); ii--; }
    return out.reverse();
  }

  /* Collapse long stretches of unchanged words so the changes are findable. */
  function condense(parts, context) {
    var out = [], run = [];
    function flushRun() {
      if (!run.length) return;
      if (run.length <= context * 2 + 3) {
        out.push.apply(out, run);
      } else {
        out.push.apply(out, run.slice(0, context));
        out.push({ op: 'gap', text: '… ' + (run.length - context * 2) + ' unchanged words …' });
        out.push.apply(out, run.slice(run.length - context));
      }
      run = [];
    }
    parts.forEach(function (p) {
      if (p.op === 'same') run.push(p);
      else { flushRun(); out.push(p); }
    });
    flushRun();
    return out;
  }

  /* ---------- run ---------- */
  go.addEventListener('click', function () {
    if (!docs.a || !docs.b) return;
    go.disabled = true;
    say('Comparing…');
    diffBox.textContent = '';

    setTimeout(function () {
      try {
        var maxPages = Math.max(docs.a.pages.length, docs.b.pages.length);
        var changedPages = 0, added = 0, removed = 0;

        for (var p = 0; p < maxPages; p++) {
          var ta = docs.a.pages[p], tb = docs.b.pages[p];
          var section = document.createElement('div');
          section.className = 'dpage';
          var h = document.createElement('h4');

          if (ta === undefined) {
            h.textContent = 'Page ' + (p + 1) + ' — added in the second file';
            section.appendChild(h);
            changedPages++;
            section.appendChild(render([{ op: 'add', text: tb || '(no text on this page)' }]));
            diffBox.appendChild(section);
            continue;
          }
          if (tb === undefined) {
            h.textContent = 'Page ' + (p + 1) + ' — removed in the second file';
            section.appendChild(h);
            changedPages++;
            section.appendChild(render([{ op: 'del', text: ta || '(no text on this page)' }]));
            diffBox.appendChild(section);
            continue;
          }

          if (ta === tb) continue;                 // identical: say nothing

          var parts = diffWords(words(ta), words(tb));
          parts.forEach(function (x) {
            if (x.op === 'add') added++;
            if (x.op === 'del') removed++;
          });
          changedPages++;
          h.textContent = 'Page ' + (p + 1) + ' — changed';
          section.appendChild(h);
          section.appendChild(render(condense(parts, 6)));
          diffBox.appendChild(section);
        }

        if (!changedPages) {
          var same = document.createElement('p');
          same.className = 'note';
          same.textContent = 'No differences in the text of these two files.';
          diffBox.appendChild(same);
        }

        $('#rBig').textContent = changedPages === 0
          ? 'No text differences'
          : changedPages + (changedPages === 1 ? ' page differs' : ' pages differ');
        $('#rMeta').textContent = changedPages === 0
          ? 'The extracted text is identical. Formatting, images and layout are not compared.'
          : added + (added === 1 ? ' word added, ' : ' words added, ') +
            removed + ' removed. Only text is compared — ' +
            'a change to an image or to formatting alone will not appear here.';
        result.classList.add('on');
        say(''); go.disabled = false;
      } catch (err) {
        console.error(err);
        say('Something went wrong: ' + (err && err.message ? err.message : 'unknown error'));
        go.disabled = false;
      }
    }, 30);
  });

  function render(parts) {
    var box = document.createElement('p');
    box.className = 'dtext';
    parts.forEach(function (p) {
      var el = document.createElement(p.op === 'same' ? 'span' :
                                     p.op === 'add' ? 'ins' :
                                     p.op === 'del' ? 'del' : 'span');
      if (p.op === 'gap' || p.op === 'note') el.className = 'dgap';
      el.textContent = p.text + ' ';
      box.appendChild(el);
    });
    return box;
  }
})();
