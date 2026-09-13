/* SizeMyPDF - fill in a PDF form.

   Fillable PDFs are common on government and university sites and awkward
   everywhere else: the browser's built-in viewer often will not save what you
   typed, and phone viewers frequently cannot show the fields at all. This
   reads the form's actual fields, gives each one a proper control, and writes
   your answers back into the file.

   Flattening is offered because it is usually what submission wants: it turns
   the answers into part of the page so no later viewer can alter or lose them.
   It cannot be undone, so it is off by default and labelled as permanent. */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var drop = $('#drop'), file = $('#file'), controls = $('#controls'),
      statusEl = $('#status'), result = $('#result'), go = $('#go'),
      fieldsBox = $('#fields'), info = $('#info');

  var srcBuf = null, srcName = '', outBlob = null;
  var model = [];             // { name, kind, options, el }

  function fmt(b) {
    if (b < 1000) return b + ' B';
    if (b < 1000000) return (b / 1000).toFixed(0) + ' KB';
    return (b / 1000000).toFixed(2) + ' MB';
  }
  function say(t) { statusEl.textContent = t; }

  /* Field names are machine names - "topmostSubform[0].Page1[0].f1_04[0]" is
     a real example. Show something readable and keep the raw name to hand. */
  function label(name) {
    var last = String(name).split('.').pop() || name;
    last = last.replace(/\[\d+\]/g, '').replace(/[_-]+/g, ' ').trim();
    last = last.replace(/([a-z])([A-Z])/g, '$1 $2');
    if (!last) last = name;
    return last.charAt(0).toUpperCase() + last.slice(1);
  }

  function kindOf(f) {
    if (PDFLib.PDFTextField && f instanceof PDFLib.PDFTextField) return 'text';
    if (PDFLib.PDFCheckBox && f instanceof PDFLib.PDFCheckBox) return 'checkbox';
    if (PDFLib.PDFRadioGroup && f instanceof PDFLib.PDFRadioGroup) return 'radio';
    if (PDFLib.PDFDropdown && f instanceof PDFLib.PDFDropdown) return 'dropdown';
    if (PDFLib.PDFOptionList && f instanceof PDFLib.PDFOptionList) return 'optionlist';
    if (PDFLib.PDFSignature && f instanceof PDFLib.PDFSignature) return 'signature';
    if (PDFLib.PDFButton && f instanceof PDFLib.PDFButton) return 'button';
    return 'unknown';
  }

  /* getFields() returns declaration order, which is not always reading order.
     Sort by page then down the page, falling back quietly if the widget
     geometry is not reachable. */
  function ordered(doc, form) {
    var pages = doc.getPages();
    return form.getFields().map(function (f, i) {
      var pageIdx = 0, y = 0, x = 0;
      try {
        var w = f.acroField.getWidgets()[0];
        var r = w.getRectangle();
        y = r.y; x = r.x;
        var p = form.findWidgetPage(w);
        var at = pages.indexOf(p);
        if (at >= 0) pageIdx = at;
      } catch (e) { pageIdx = 0; y = -i; x = 0; }
      return { field: f, pageIdx: pageIdx, y: y, x: x, i: i };
    }).sort(function (a, b) {
      if (a.pageIdx !== b.pageIdx) return a.pageIdx - b.pageIdx;
      if (Math.abs(b.y - a.y) > 4) return b.y - a.y;       // top of page first
      if (Math.abs(a.x - b.x) > 4) return a.x - b.x;
      return a.i - b.i;
    }).map(function (r) { return r.field; });
  }

  /* ---------- intake ---------- */
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
    srcName = f.name.replace(/\.pdf$/i, '');
    say('Looking for form fields…');
    result.classList.remove('on');
    fieldsBox.textContent = '';
    model = [];

    f.arrayBuffer().then(function (ab) {
      srcBuf = ab;
      return PDFLib.PDFDocument.load(ab, { ignoreEncryption: true });
    }).then(function (doc) {
      var form;
      try { form = doc.getForm(); }
      catch (e) { form = null; }

      var fields = form ? ordered(doc, form) : [];
      drop.querySelector('strong').textContent = f.name;
      drop.querySelector('small').textContent =
        doc.getPageCount() + ' pages, ' + fmt(f.size) + ' — click to choose a different file';

      if (!fields.length) {
        controls.classList.remove('on');
        statusEl.innerHTML = '';
        statusEl.appendChild(document.createTextNode(
          'This PDF has no fillable fields. That usually means it is a scan or a flat ' +
          'document rather than a form — in which case you want '));
        var a = document.createElement('a');
        a.href = 'sign-pdf.html'; a.textContent = 'Sign PDF';
        statusEl.appendChild(a);
        statusEl.appendChild(document.createTextNode(
          ' to write on it, or print it, fill it in and photograph it.'));
        return;
      }

      build(fields);
      controls.classList.add('on');
      say('');
    }).catch(function (err) {
      console.error(err);
      say('Could not open this PDF: ' + (err && err.message ? err.message : 'unknown error') +
          '. If it is password-protected, remove the password first.');
    });
  }

  function row(f, kind) {
    var wrap = document.createElement('div');
    wrap.className = 'ffield';
    var lab = document.createElement('label');
    lab.textContent = label(f.getName());
    var id = 'ff-' + Math.random().toString(36).slice(2, 9);
    lab.setAttribute('for', id);
    wrap.appendChild(lab);

    var raw = document.createElement('span');
    raw.className = 'fname';
    raw.textContent = f.getName();
    wrap.appendChild(raw);
    return { wrap: wrap, id: id };
  }

  function build(fields) {
    var skipped = 0, usable = 0;

    fields.forEach(function (f) {
      var kind = kindOf(f);
      if (kind === 'button' || kind === 'signature' || kind === 'unknown') { skipped++; return; }

      var ro = false;
      try { ro = f.isReadOnly(); } catch (e) {}

      var r = row(f, kind);
      var el;

      if (kind === 'text') {
        var multi = false;
        try { multi = f.isMultiline(); } catch (e) {}
        el = document.createElement(multi ? 'textarea' : 'input');
        if (!multi) el.type = 'text';
        if (multi) el.rows = 3;
        try { var v = f.getText(); if (v) el.value = v; } catch (e) {}
        try { var ml = f.getMaxLength(); if (ml) el.maxLength = ml; } catch (e) {}
      } else if (kind === 'checkbox') {
        el = document.createElement('input');
        el.type = 'checkbox';
        try { el.checked = f.isChecked(); } catch (e) {}
      } else if (kind === 'radio' || kind === 'dropdown' || kind === 'optionlist') {
        var opts = [];
        try { opts = f.getOptions() || []; } catch (e) {}
        el = document.createElement('select');
        if (kind === 'optionlist') el.multiple = true;
        if (kind !== 'optionlist') {
          var blank = document.createElement('option');
          blank.value = ''; blank.textContent = '— not set —';
          el.appendChild(blank);
        }
        opts.forEach(function (o) {
          var op = document.createElement('option');
          op.value = o; op.textContent = o;
          el.appendChild(op);
        });
        try {
          var cur = kind === 'radio' ? f.getSelected() : f.getSelected();
          if (Array.isArray(cur)) {
            [].forEach.call(el.options, function (op) {
              if (cur.indexOf(op.value) >= 0) op.selected = true;
            });
          } else if (cur) el.value = cur;
        } catch (e) {}
      }

      el.id = r.id;
      if (ro) { el.disabled = true; r.wrap.classList.add('ro'); }
      r.wrap.appendChild(el);
      fieldsBox.appendChild(r.wrap);
      model.push({ name: f.getName(), kind: kind, el: el, readOnly: ro });
      usable++;
    });

    if (info) {
      info.textContent = usable + (usable === 1 ? ' field' : ' fields') +
        ' found' + (skipped ? ', ' + skipped + ' skipped (buttons and signature fields)' : '') +
        '. Existing answers are shown; change what you need.';
    }
    go.disabled = usable === 0;
  }

  /* ---------- save ---------- */
  go.addEventListener('click', function () {
    if (!srcBuf || !model.length) return;
    go.disabled = true;
    say('Writing your answers in…');
    result.classList.remove('on');
    var flatten = $('#flatten').checked;

    PDFLib.PDFDocument.load(srcBuf.slice(0), { ignoreEncryption: true })
      .then(function (doc) {
        var form = doc.getForm();
        var written = 0, failed = 0;

        model.forEach(function (m) {
          if (m.readOnly) return;
          try {
            if (m.kind === 'text') {
              form.getTextField(m.name).setText(m.el.value || '');
            } else if (m.kind === 'checkbox') {
              var cb = form.getCheckBox(m.name);
              if (m.el.checked) cb.check(); else cb.uncheck();
            } else if (m.kind === 'radio') {
              if (m.el.value) form.getRadioGroup(m.name).select(m.el.value);
            } else if (m.kind === 'dropdown') {
              var dd = form.getDropdown(m.name);
              if (m.el.value) dd.select(m.el.value); else dd.clear();
            } else if (m.kind === 'optionlist') {
              var chosen = [].filter.call(m.el.options, function (o) { return o.selected; })
                             .map(function (o) { return o.value; });
              var ol = form.getOptionList(m.name);
              if (chosen.length) ol.select(chosen); else ol.clear();
            }
            written++;
          } catch (e) { failed++; }
        });

        // make the answers render even in viewers that do not generate
        // appearances themselves
        try { form.updateFieldAppearances(); } catch (e) {}
        if (flatten) { try { form.flatten(); } catch (e) {} }

        return doc.save({ useObjectStreams: true }).then(function (bytes) {
          return { bytes: bytes, written: written, failed: failed };
        });
      })
      .then(function (r) {
        outBlob = new Blob([r.bytes], { type: 'application/pdf' });
        $('#rBig').textContent = r.written +
          (r.written === 1 ? ' field filled' : ' fields filled') + ' — ' + fmt(outBlob.size);
        $('#rMeta').textContent = (flatten
          ? 'The answers were flattened into the page, so they cannot be edited or lost by a later viewer. '
          : 'The form is still editable, so you or somebody else can change the answers later. ') +
          (r.failed ? r.failed + ' field(s) could not be written and were left as they were. ' : '') +
          'Nothing was uploaded.';
        result.classList.add('on');
        say(''); go.disabled = false;
      })
      .catch(function (err) {
        console.error(err);
        say('Something went wrong: ' + (err && err.message ? err.message : 'unknown error'));
        go.disabled = false;
      });
  });

  $('#dl').addEventListener('click', function () {
    if (!outBlob) return;
    var a = document.createElement('a');
    a.href = URL.createObjectURL(outBlob);
    a.download = srcName + '-filled.pdf';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  });
})();
