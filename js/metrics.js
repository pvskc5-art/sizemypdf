/* SizeMyPDF - anonymous usage counters.

   The open question the site cannot answer today is what people actually ask
   for: which target sizes get typed, how often the target is missed, how long
   jobs take, and whether the worker path is being used. Cloudflare Web
   Analytics already covers traffic, device mix and referrers; this covers the
   product itself.

   What is recorded is deliberately narrow. Values are bucketed before they are
   stored, and nothing derived from the file is touched - no name, no bytes, no
   exact size. A bucket like "100-200 KB target, missed, 2-5 s" cannot identify
   a document or a person.

   ENDPOINT is empty, so today nothing leaves the device: counters accumulate
   in localStorage only. Setting it to a first-party collector turns on
   transmission - batched, after a job has finished, never during one, so the
   network tab during compression stays as empty as the privacy claim says.

   Respects Do Not Track, and localStorage 'smp.metrics.off' = '1' opts out. */
window.Metrics = (function () {
  'use strict';

  var ENDPOINT = '';                 // no collector configured: stays on-device
  var KEY = 'smp.metrics.v1';
  var MAX_EVENTS = 500;              // keep the stored blob small

  function allowed() {
    try {
      var dnt = navigator.doNotTrack || window.doNotTrack || navigator.msDoNotTrack;
      if (dnt === '1' || dnt === 'yes') return false;
      if (localStorage.getItem('smp.metrics.off') === '1') return false;
      return true;
    } catch (e) {
      return false;                  // storage blocked: record nothing
    }
  }

  /* Buckets, not values. The point is the shape of demand, and a bucket cannot
     be traced back to one document. */
  function kbBucket(kb) {
    if (!kb || kb < 0) return 'na';
    if (kb <= 20) return '0-20';
    if (kb <= 50) return '21-50';
    if (kb <= 100) return '51-100';
    if (kb <= 200) return '101-200';
    if (kb <= 500) return '201-500';
    if (kb <= 1024) return '501-1024';
    return '1024+';
  }

  function msBucket(ms) {
    if (ms == null) return 'na';
    if (ms < 1000) return '<1s';
    if (ms < 2000) return '1-2s';
    if (ms < 5000) return '2-5s';
    if (ms < 15000) return '5-15s';
    if (ms < 60000) return '15-60s';
    return '60s+';
  }

  function countBucket(n) {
    if (!n) return 'na';
    if (n === 1) return '1';
    if (n <= 5) return '2-5';
    if (n <= 20) return '6-20';
    return '20+';
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : { started: Date.now(), counts: {}, n: 0 };
    } catch (e) {
      return { started: Date.now(), counts: {}, n: 0 };
    }
  }

  function save(state) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  /* One flat counter key per distinct outcome, so the stored object stays a
     few hundred bytes however many jobs are run. */
  function record(event, fields) {
    if (!allowed()) return;
    fields = fields || {};
    var parts = [event];
    Object.keys(fields).sort().forEach(function (k) {
      parts.push(k + '=' + fields[k]);
    });
    var key = parts.join('|');

    var state = load();
    state.counts[key] = (state.counts[key] || 0) + 1;
    state.n = (state.n || 0) + 1;
    if (Object.keys(state.counts).length > MAX_EVENTS) return;   // stop growing
    save(state);
    maybeSend(state);
  }

  var sent = 0;
  function maybeSend(state) {
    if (!ENDPOINT) return;                       // nothing configured: no network
    if (state.n - sent < 10) return;             // batch, never per keystroke
    sent = state.n;
    try {
      var blob = new Blob([JSON.stringify({ v: 1, counts: state.counts })],
                          { type: 'application/json' });
      navigator.sendBeacon(ENDPOINT, blob);
    } catch (e) {}
  }

  return {
    record: record,
    kb: kbBucket,
    ms: msBucket,
    count: countBucket,
    // for looking at your own numbers on your own device
    summary: function () { return load(); },
    clear: function () { try { localStorage.removeItem(KEY); } catch (e) {} },
    enabled: allowed
  };
})();
