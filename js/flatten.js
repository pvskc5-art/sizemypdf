/* SizeMyPDF - flatten a PDF.

   Flattening means making the file say what it looks like it says. A filled
   form still stores its answers as editable field objects: the next person to
   open it can change them, a careless reader can clear them, and some printers
   drop them entirely. Flattening draws the answers into the page itself and
   throws the fields away.

   This is lossless. Unlike redaction or password removal, nothing here needs
   the page rendered to pixels - the text stays selectable and the images keep
   their resolution. It is a structural edit, which is why it is worth having
   as its own tool rather than a checkbox. */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var ui;

  function describe(state) {
    var el = $('#flatInfo');
    if (!el) return;
    PDFLib.PDFDocument.load(state.bytes.slice(0), { ignoreEncryption: true })
      .then(function (doc) {
        var fields = 0, annots = 0;
        try { fields = doc.getForm().getFields().length; } catch (e) {}
        doc.getPages().forEach(function (p) {
          var a = p.node.lookup(PDFLib.PDFName.of('Annots'));
          if (a && a.size) annots += a.size();
        });

        var bits = [];
        bits.push(fields
          ? fields + (fields === 1 ? ' form field' : ' form fields')
          : 'No form fields');
        // Widget annotations are the form fields themselves, so reporting both
        // raw numbers would double-count. Only mention the surplus.
        var extra = Math.max(0, annots - fields);
        if (extra) {
          bits.push(extra + (extra === 1 ? ' comment or markup annotation'
                                         : ' comments or markup annotations'));
        }
        el.textContent = bits.join(', ') + '.' + (fields || extra ? '' :
          ' There is nothing here that needs flattening — the file already ' +
          'renders as it reads.');
      })
      .catch(function () { el.textContent = ''; });
  }

  ui = PageOps.init({
    suffix: 'flattened',
    working: 'Flattening…',
    onLoad: describe,

    run: function (doc) {
      var dropAnnots = $('#dropAnnots').checked;
      var fields = 0, flattened = false, removed = 0;

      try {
        var form = doc.getForm();
        fields = form.getFields().length;
        if (fields) {
          /* Some producers write fields with no appearance stream - Acrobat
             generates one on open, so the file looks fine but pdf-lib has
             nothing to draw. Building the appearances first turns a hard
             failure into a normal flatten. */
          try { form.updateFieldAppearances(); } catch (e) {}
          form.flatten();
          flattened = true;
        }
      } catch (e) {
        console.error(e);
        ui.say('The form fields in this PDF could not be flattened: ' +
               (e && e.message ? e.message : 'unknown error') +
               '. The file may use a form type this tool does not handle.');
        return null;
      }

      if (dropAnnots) {
        var A = PDFLib.PDFName.of('Annots');
        doc.getPages().forEach(function (p) {
          var a = p.node.lookup(A);
          if (a && a.size && a.size()) { removed += a.size(); p.node.delete(A); }
        });
      }

      if (!flattened && !removed) {
        ui.say('There was nothing to flatten: this PDF has no form fields, and ' +
               'no annotations were selected for removal.');
        return null;
      }

      return doc.save({ useObjectStreams: true }).then(function (bytes) {
        var parts = [];
        if (flattened) {
          parts.push(fields + (fields === 1 ? ' field was' : ' fields were') +
                     ' drawn into the page and removed');
        }
        if (removed) {
          parts.push(removed + (removed === 1 ? ' annotation was' : ' annotations were') +
                     ' deleted');
        }
        return {
          bytes: bytes,
          headline: flattened
            ? fields + (fields === 1 ? ' field flattened' : ' fields flattened')
            : removed + (removed === 1 ? ' annotation removed' : ' annotations removed'),
          meta: parts.join(', ') + '. Nothing was re-encoded, so text is still ' +
                'selectable and images keep their original resolution — the ' +
                'answers simply cannot be edited any more.'
        };
      });
    }
  });
})();
