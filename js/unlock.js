/* SizeMyPDF - remove the password from a PDF you can already open.

   What this does and does not do, because the distinction is the whole tool:

   It does not break anything. You supply the password. If you do not have it,
   this page cannot help you and says so - there is no cracking here, and a
   document you are not entitled to open stays shut.

   Two kinds of lock turn up. A *user* password is required to open the file at
   all; you must type it. An *owner* password leaves the file readable but marks
   it as no-printing or no-copying, and readers honour that by convention. The
   second kind opens here with no password at all, and the restriction simply
   does not survive being rebuilt.

   The output is rebuilt from pixels - see js/raster.js. That matters most for
   the case this tool actually gets used for: a scanned statement or ticket that
   arrived locked. Those pages were already images, so nothing is lost. A
   text-based PDF will come back as images, and the page says so before you
   start rather than after. */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };

  var srcBytes = null, name = '', pdfDoc = null, outBlob = null, needsPassword = false;

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
    say('Reading…');

    f.arrayBuffer().then(function (ab) {
      srcBytes = ab;
      drop.querySelector('strong').textContent = f.name;
      drop.querySelector('small').textContent =
        fmt(f.size) + ' — click to choose a different file';
      return open('');
    }).catch(function (err) {
      console.error(err);
      say('Could not read that file.');
    });
  }

  /* One attempt at opening. An empty password is tried first on purpose: it
     tells us which of the two locks we are dealing with without asking the
     visitor a question they may not need to answer. */
  function open(password) {
    return PDFThumbs.ensure()
      .then(function () {
        return pdfjsLib.getDocument({
          data: srcBytes.slice(0),
          password: password || undefined
        }).promise;
      })
      .then(function (d) {
        pdfDoc = d;
        $('#controls').classList.add('on');
        $('#go').disabled = false;

        if (needsPassword) {
          $('#pwWrap').style.display = '';
          $('#pwNote').textContent =
            'Password accepted. ' + d.numPages +
            (d.numPages === 1 ? ' page' : ' pages') + ' ready to unlock.';
          say('');
        } else {
          // Opened with no password at all.
          $('#pwWrap').style.display = 'none';
          $('#pwNote').textContent = '';
          say('');
          $('#openNote').textContent = 'This PDF opens without a password, so it has no ' +
            'open-password to remove. If it refuses to print or copy, that is an owner ' +
            'restriction — rebuilding the file here clears it. ' + d.numPages +
            (d.numPages === 1 ? ' page.' : ' pages.');
          $('#openNote').style.display = '';
        }
      })
      .catch(function (err) {
        if (err && err.name === 'PasswordException') {
          needsPassword = true;
          $('#controls').classList.add('on');
          $('#pwWrap').style.display = '';
          $('#openNote').style.display = 'none';
          $('#go').disabled = true;
          // code 2 is INCORRECT_PASSWORD; 1 is simply NEED_PASSWORD
          $('#pwNote').textContent = (err.code === 2)
            ? 'That password was not accepted. Check it and try again.'
            : 'This PDF needs a password to open. Type the one you already have.';
          say('');
          $('#pw').focus();
          return;
        }
        console.error(err);
        say('Could not open this PDF: ' +
            (err && err.message ? err.message : 'unknown error'));
      });
  }

  $('#pwGo').addEventListener('click', function () {
    var p = $('#pw').value;
    if (!p) { $('#pwNote').textContent = 'Type the password first.'; return; }
    say('Checking the password…');
    open(p);
  });

  $('#pw').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); $('#pwGo').click(); }
  });

  $('#go').addEventListener('click', function () {
    if (!pdfDoc) return;
    $('#go').disabled = true;
    $('#result').classList.remove('on');
    say('Rebuilding…');

    PDFRaster.rebuild(pdfDoc, {
      onProgress: function (p, total) {
        say('Rebuilding page ' + p + ' of ' + total + '…');
      }
    }).then(function (bytes) {
      outBlob = new Blob([bytes], { type: 'application/pdf' });
      $('#rBig').textContent = 'Password removed — ' + fmt(outBlob.size);
      $('#rMeta').textContent =
        pdfDoc.numPages + (pdfDoc.numPages === 1 ? ' page' : ' pages') +
        ' rebuilt with no password and no restrictions. The pages were rendered ' +
        'and reassembled, so text in the new file is part of the image and can no ' +
        'longer be selected — if the original was a scan, nothing changed.';
      $('#result').classList.add('on');
      say(''); $('#go').disabled = false;
    }).catch(function (err) {
      console.error(err);
      say('Something went wrong: ' + (err && err.message ? err.message : 'unknown error'));
      $('#go').disabled = false;
    });
  });

  $('#dl').addEventListener('click', function () {
    if (!outBlob) return;
    var a = document.createElement('a');
    a.href = URL.createObjectURL(outBlob);
    a.download = name + '-unlocked.pdf';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 60000);
  });
})();
