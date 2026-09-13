/* SizeMyPDF - photograph pages with the camera and get one PDF.

   iLovePDF's version of this pairs your phone to a desktop session and sends
   the photos through their servers. There is no need: a phone browser can
   reach its own camera, and the phone is where the document already is.

   Capture, review, reorder, drop the bad ones, then build. Everything stays
   on the device - the camera stream is never recorded or sent anywhere, and
   the shots live in memory until the tab closes.

   There is also a plain file picker, because on a phone that opens the camera
   anyway and it is the only route if permission is refused. */
(function () {
  'use strict';

  /* iPhones photograph in HEIC by default and Chrome cannot decode it, which
     is the single commonest reason an image will not open here. Checked by
     suffix rather than by MIME type, because the type is often missing or
     wrong once a file has been through a messaging app. */
  function isHeic(name) {
    var n = String(name || '').toLowerCase();
    return n.slice(-5) === '.heic' || n.slice(-5) === '.heif';
  }

  var $ = function (s) { return document.querySelector(s); };
  var startBtn = $('#start'), shotBtn = $('#shoot'), stopBtn = $('#stop'),
      video = $('#cam'), shotsBox = $('#shots'), statusEl = $('#status'),
      controls = $('#controls'), go = $('#go'), result = $('#result'),
      info = $('#info'), file = $('#file');

  var stream = null;
  var shots = [];           // { canvas, thumb }
  var outBlob = null;

  function fmt(b) {
    if (b < 1000) return b + ' B';
    if (b < 1000000) return (b / 1000).toFixed(0) + ' KB';
    return (b / 1000000).toFixed(2) + ' MB';
  }
  function say(t) { statusEl.textContent = t; }

  /* ---------- camera ---------- */
  startBtn.addEventListener('click', function () {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      say('This browser will not give a page access to the camera. Use the ' +
          '"Choose photos" button instead — on a phone that opens the camera too.');
      return;
    }
    say('Asking for camera permission…');
    // the rear camera is the one pointing at the document
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } },
      audio: false
    }).then(function (s) {
      stream = s;
      video.srcObject = s;
      video.play();
      $('#camwrap').classList.add('on');
      startBtn.disabled = true;
      shotBtn.disabled = false;
      stopBtn.disabled = false;
      say('');
    }).catch(function (err) {
      var why = err && err.name === 'NotAllowedError'
        ? 'Camera permission was refused.'
        : 'The camera could not be opened (' + (err && err.name || 'unknown') + ').';
      say(why + ' Use "Choose photos" instead — on a phone that opens the camera anyway.');
    });
  });

  function stopCam() {
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    video.srcObject = null;
    $('#camwrap').classList.remove('on');
    startBtn.disabled = false;
    shotBtn.disabled = true;
    stopBtn.disabled = true;
  }
  stopBtn.addEventListener('click', function () { stopCam(); say('Camera off.'); });
  window.addEventListener('pagehide', stopCam);

  shotBtn.addEventListener('click', function () {
    if (!stream) return;
    var w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) { say('The camera is still starting up.'); return; }
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(video, 0, 0, w, h);
    addShot(c);
  });

  /* ---------- file picker fallback ---------- */
  file.addEventListener('change', function () {
    var list = [].slice.call(file.files || []);
    if (!list.length) return;
    var imgs = list.filter(function (f) { return /^image\//.test(f.type); });
    if (!imgs.length) { say('Those do not look like photographs.'); return; }
    say('Reading ' + imgs.length + ' photo(s)…');
    var chain = Promise.resolve(), failed = [];
    imgs.forEach(function (f) {
      chain = chain.then(function () {
        return decode(f).then(function (bm) {
          var c = document.createElement('canvas');
          c.width = bm.width; c.height = bm.height;
          c.getContext('2d').drawImage(bm, 0, 0);
          addShot(c);
        }).catch(function () { failed.push(f.name); });
      });
    });
    chain.then(function () {
      file.value = '';
      // Dropping a photo silently is how five chosen photos quietly become
      // three pages, and HEIC from an iPhone is the usual reason.
      if (!failed.length) { say(''); return; }
      var heic = failed.some(function (n) { return isHeic(n); });
      say(failed.length + ' photo' + (failed.length === 1 ? '' : 's') +
          ' could not be read and ' + (failed.length === 1 ? 'was' : 'were') +
          ' left out' + (heic ? '. HEIC photos from an iPhone cannot be opened by this browser. ' +
          'Share them as JPG, or set Settings > Camera > Formats to ' +
          '"Most Compatible".' : '.'));
    });
  });

  // EXIF orientation, same reasoning as the image compressor
  function decode(blob) {
    function viaImage() {
      return new Promise(function (res, rej) {
        var img = new Image();
        img.onload = function () { res(img); };
        img.onerror = function () { rej(new Error('decode failed')); };
        img.src = URL.createObjectURL(blob);
      });
    }
    if (!window.createImageBitmap) return viaImage();
    try {
      return createImageBitmap(blob, { imageOrientation: 'from-image' })
        .catch(function () { return createImageBitmap(blob); })
        .catch(viaImage);
    } catch (e) { return viaImage(); }
  }

  /* ---------- shots ---------- */
  function addShot(canvas) {
    var thumb = document.createElement('canvas');
    var k = 120 / canvas.width;
    thumb.width = 120;
    thumb.height = Math.max(1, Math.round(canvas.height * k));
    thumb.getContext('2d').drawImage(canvas, 0, 0, thumb.width, thumb.height);
    shots.push({ canvas: canvas, thumb: thumb });
    paint();
  }

  function iconBtn(label, title, disabled, fn) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'iconbtn';
    b.textContent = label; b.title = title;
    b.setAttribute('aria-label', title);
    b.disabled = !!disabled;
    b.addEventListener('click', fn);
    return b;
  }

  function paint() {
    shotsBox.textContent = '';
    shots.forEach(function (s, i) {
      var tile = document.createElement('div');
      tile.className = 'ptile';
      var shell = document.createElement('div');
      shell.className = 'sh';
      shell.appendChild(s.thumb);
      var num = document.createElement('div');
      num.className = 'pnum';
      num.textContent = 'Page ' + (i + 1);
      var tools = document.createElement('div');
      tools.className = 'ptools';
      tools.appendChild(iconBtn('←', 'Move page ' + (i + 1) + ' earlier', i === 0, function () {
        var t = shots[i - 1]; shots[i - 1] = shots[i]; shots[i] = t; paint();
      }));
      tools.appendChild(iconBtn('→', 'Move page ' + (i + 1) + ' later',
        i === shots.length - 1, function () {
        var t = shots[i + 1]; shots[i + 1] = shots[i]; shots[i] = t; paint();
      }));
      var del = iconBtn('×', 'Discard page ' + (i + 1), false, function () {
        shots.splice(i, 1); paint();
      });
      del.className = 'iconbtn del';
      tools.appendChild(del);
      tile.appendChild(shell); tile.appendChild(num); tile.appendChild(tools);
      shotsBox.appendChild(tile);
    });

    if (shots.length) {
      controls.classList.add('on');
      go.disabled = false;
      go.textContent = 'Make a PDF of ' + shots.length +
        (shots.length === 1 ? ' page' : ' pages');
      if (info) info.textContent = shots.length +
        ' captured. Reorder or discard before building — the shots stay on this device.';
    } else {
      controls.classList.remove('on');
      go.disabled = true;
    }
    result.classList.remove('on');
  }

  /* ---------- build ---------- */
  go.addEventListener('click', function () {
    if (!shots.length) return;
    go.disabled = true;
    say('Building the PDF…');
    var quality = parseFloat($('#quality').value) || 0.8;
    var fit = $('#pagesize').value;

    PDFLib.PDFDocument.create().then(function (doc) {
      var chain = Promise.resolve();
      shots.forEach(function (s) {
        chain = chain.then(function () {
          return new Promise(function (res) { s.canvas.toBlob(res, 'image/jpeg', quality); })
            .then(function (blob) { return blob.arrayBuffer(); })
            .then(function (ab) { return doc.embedJpg(ab); })
            .then(function (img) {
              if (fit === 'a4') {
                var pw = 595, ph = 842;
                var page = doc.addPage([pw, ph]);
                var k = Math.min(pw / img.width, ph / img.height);
                var w = img.width * k, h = img.height * k;
                page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
              } else {
                var page2 = doc.addPage([img.width, img.height]);
                page2.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
              }
            });
        });
      });
      return chain.then(function () { return doc.save({ useObjectStreams: true }); });
    }).then(function (bytes) {
      outBlob = new Blob([bytes], { type: 'application/pdf' });
      $('#rBig').textContent = shots.length +
        (shots.length === 1 ? ' page' : ' pages') + ' — ' + fmt(outBlob.size);
      $('#rMeta').textContent = 'Photographs of a document are large. If something has ' +
        'given you a size limit, compress this next.';
      result.classList.add('on');
      say(''); go.disabled = false;
    }).catch(function (err) {
      console.error(err);
      say('Something went wrong: ' + (err && err.message ? err.message : 'unknown error'));
      go.disabled = false;
    });
  });

  $('#dl').addEventListener('click', function () {
    if (!outBlob) return;
    var a = document.createElement('a');
    a.href = URL.createObjectURL(outBlob);
    a.download = 'scan.pdf';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  });
})();
