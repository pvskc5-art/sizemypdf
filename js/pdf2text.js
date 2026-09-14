/* SizeMyPDF - pull the text out of a PDF, as plain text or Markdown.

   A PDF does not contain paragraphs. It contains instructions to put glyphs at
   coordinates, and any structure you read into it afterwards is inference. So
   this is honest about what it is doing: it groups runs of text into lines by
   their vertical position, joins lines into paragraphs when the gap between
   them is ordinary, and breaks when it is not.

   The Markdown option adds one more inference - a line set in noticeably larger
   type than the body, and short enough to be a title rather than a sentence,
   becomes a heading. That is a guess. It is right often enough to save work on
   reports and wrong often enough that the page says so.

   A scanned PDF has no text to extract at all. That case is detected and sent
   to the OCR tool rather than returning an empty file. */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };

  var srcBytes = null, name = '', pages = null, outBlob = null;

  function fmt(b) {
    if (b < 1000) return b + ' B';
    if (b < 1000000) return (b / 1000).toFixed(0) + ' KB';
    return (b / 1000000).toFixed(2) + ' MB';
  }
  function say(t) { $('#status').textContent = t; }

  var drop = $('#drop'), file = $('#file');
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
    if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) {
      say('That does not look like a PDF file.'); return;
    }
    name = f.name.replace(/\.pdf$/i, '');
    $('#result').classList.remove('on');
    $('#preview').classList.remove('on');
    say('Reading…');

    f.arrayBuffer().then(function (ab) {
      srcBytes = ab;
      drop.querySelector('strong').textContent = f.name;
      drop.querySelector('small').textContent =
        fmt(f.size) + ' — click to choose a different file';
      return extract();
    }).catch(function (err) {
      console.error(err);
      say('Could not read that file.');
    });
  }

  /* Group the glyph runs pdf.js hands back into lines. Items arrive in content
     order, which is not always reading order, so they are bucketed by their y
     coordinate and each bucket sorted by x. */
  function toLines(items) {
    var rows = [], tol = 2.2;
    items.forEach(function (it) {
      if (!it.str) return;
      var y = it.transform[5], x = it.transform[4];
      var size = Math.abs(it.transform[3]) || it.height || 0;
      var row = null;
      for (var i = 0; i < rows.length; i++) {
        if (Math.abs(rows[i].y - y) <= tol) { row = rows[i]; break; }
      }
      if (!row) { row = { y: y, parts: [] }; rows.push(row); }
      row.parts.push({ x: x, str: it.str, size: size });
    });

    rows.sort(function (a, b) { return b.y - a.y; });   // PDF y grows upward
    return rows.map(function (r) {
      r.parts.sort(function (a, b) { return a.x - b.x; });
      var size = 0;
      var text = r.parts.map(function (p) {
        if (p.size > size) size = p.size;
        return p.str;
      }).join('');
      return { y: r.y, text: text.replace(/\s+/g, ' ').trim(), size: size };
    }).filter(function (l) { return l.text; });
  }

  function extract() {
    return PDFThumbs.ensure()
      .then(function () {
        return pdfjsLib.getDocument({ data: srcBytes.slice(0) }).promise;
      })
      .then(function (doc) {
        var out = [], chain = Promise.resolve();
        for (var n = 1; n <= doc.numPages; n++) {
          (function (p) {
            chain = chain.then(function () {
              say('Reading page ' + p + ' of ' + doc.numPages + '…');
              return doc.getPage(p)
                .then(function (page) { return page.getTextContent(); })
                .then(function (tc) { out.push(toLines(tc.items)); });
            });
          })(n);
        }
        return chain.then(function () {
          pages = out;
          if (doc.destroy) { try { doc.destroy(); } catch (e) {} }
          finish();
        });
      })
      .catch(function (err) {
        console.error(err);
        say('Could not open this PDF: ' +
            (err && err.message ? err.message : 'unknown error') +
            '. If it is password-protected, remove the password first.');
      });
  }

  function bodySize(all) {
    /* The body text is whichever size carries the most *characters*, not the
       most lines. Counting lines ties on a short document - a title, a
       subtitle and a paragraph are one line each - and a tie resolves to
       whichever was seen first, which is usually the title. Weighting by
       length cannot tie that way: body text is where the words are. */
    var weight = {}, best = 0, bestN = 0;
    all.forEach(function (l) {
      var k = Math.round(l.size);
      weight[k] = (weight[k] || 0) + l.text.length;
      if (weight[k] > bestN) { bestN = weight[k]; best = k; }
    });
    return best;
  }

  function render(asMarkdown) {
    var all = [];
    pages.forEach(function (p) { all = all.concat(p); });
    var body = bodySize(all);
    var chunks = [];

    pages.forEach(function (lines, i) {
      if (asMarkdown && pages.length > 1) chunks.push('<!-- page ' + (i + 1) + ' -->');
      var para = [];
      function flush() {
        if (para.length) { chunks.push(para.join(' ')); para = []; }
      }
      lines.forEach(function (l) {
        var big = body && l.size >= body * 1.18;
        var shortEnough = l.text.length <= 80;
        if (asMarkdown && big && shortEnough) {
          flush();
          // Two sizes of heading is as much as this inference can honestly
          // support: anything finer would be reading structure that is not there.
          chunks.push((l.size >= body * 1.5 ? '# ' : '## ') + l.text);
          return;
        }
        para.push(l.text);
        // A line ending in sentence punctuation, or a short line, usually ends
        // a paragraph. A line that simply ran out of width does not.
        if (/[.!?:;]["')\]]?$/.test(l.text) || l.text.length < 45) flush();
      });
      flush();
    });

    return chunks.join(asMarkdown ? '\n\n' : '\n\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function finish() {
    var total = 0;
    pages.forEach(function (p) { p.forEach(function (l) { total += l.text.length; }); });

    if (total < 20) {
      say('');
      $('#result').classList.remove('on');
      $('#empty').style.display = '';
      return;
    }
    $('#empty').style.display = 'none';
    $('#controls').classList.add('on');
    say('');
    update();
  }

  function update() {
    var md = $('#fmt').value === 'md';
    var text = render(md);
    outBlob = new Blob([text], { type: md ? 'text/markdown' : 'text/plain' });

    $('#rBig').textContent =
      text.length.toLocaleString() + ' characters — ' + fmt(outBlob.size);
    $('#rMeta').textContent = pages.length +
      (pages.length === 1 ? ' page read.' : ' pages read.') +
      (md ? ' Headings are inferred from type size and may need a check.' : '');
    $('#result').classList.add('on');

    var sample = text.slice(0, 1200);
    $('#previewText').textContent = sample + (text.length > 1200 ? '\n…' : '');
    $('#preview').classList.add('on');
  }

  $('#fmt').addEventListener('change', function () { if (pages) update(); });

  $('#dl').addEventListener('click', function () {
    if (!outBlob) return;
    var a = document.createElement('a');
    a.href = URL.createObjectURL(outBlob);
    a.download = name + ($('#fmt').value === 'md' ? '.md' : '.txt');
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 60000);
  });

  $('#copy').addEventListener('click', function () {
    if (!outBlob) return;
    var md = $('#fmt').value === 'md';
    var text = render(md);
    if (!navigator.clipboard) { say('This browser will not allow copying from a script.'); return; }
    navigator.clipboard.writeText(text).then(function () {
      say('Copied to the clipboard.');
    }).catch(function () {
      say('The clipboard was refused. Use Download instead.');
    });
  });
})();
