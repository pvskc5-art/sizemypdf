/* SizeMyPDF - the metrics collector.

   The site answers what traffic arrives (Cloudflare Web Analytics already does
   that) but not what people ask of it: which target sizes get typed, how often
   the target is missed, how long jobs take, whether the worker path is being
   used. That is the question this answers, and nothing more.

   Two properties are worth stating plainly, because they are what make this
   safe to run on a site whose selling point is that files never leave the
   device:

   1. There is no identifier of any kind. No cookie, no device id, no IP
      recorded, no timestamp finer than the data point's own. Rows cannot be
      joined back into a session, which means they cannot be joined back into
      a person - by us or by anybody who obtains the dataset.

   2. The endpoint is public, so everything arriving is treated as hostile.
      Only the exact vocabulary the client is capable of emitting is accepted -
      known events, known field names, known bucket values - and anything else
      is dropped on the floor. Without this, a single script could fill the
      dataset with arbitrary strings and the numbers would be worthless. */

const KB = new Set(['na', '0-20', '21-50', '51-100', '101-200', '201-500', '501-1024', '1024+']);
const MS = new Set(['na', '<1s', '1-2s', '2-5s', '5-15s', '15-60s', '60s+']);
const FILES = new Set(['na', '1', '2-5', '6-20', '20+']);
const YESNO = new Set(['yes', 'no']);
const ENGINE = new Set(['worker', 'main']);

/* Mirrors js/metrics.js and its two callers exactly. Adding a field here
   without adding it to COLUMNS below silently drops it, so do both. */
const SCHEMA = {
  compress: {
    mode: new Set(['target', 'lossless']),
    target: KB,
    outcome: new Set(['already-under', 'hit', 'miss']),
    kept: new Set(['text', 'raster']),
    took: MS,
    engine: ENGINE
  },
  batch: {
    files: FILES,
    target: KB,
    over: YESNO,
    failed: YESNO,
    took: MS,
    engine: ENGINE
  }
};

/* Blob positions are a wire format: queries refer to blob2, blob3 and so on by
   number, so this order is fixed for the life of the dataset. Append only. */
const COLUMNS = ['mode', 'target', 'outcome', 'kept', 'took', 'engine', 'files', 'over', 'failed'];

const MAX_BODY = 16 * 1024;   // a legitimate delta is a few hundred bytes
const MAX_POINTS = 250;       // Analytics Engine: 250 data points per invocation
const MAX_COUNT = 100000;     // one device cannot plausibly exceed this

const ALLOWED_ORIGINS = new Set([
  'https://sizemypdf.com',
  'https://www.sizemypdf.com'
]);

/* "compress|engine=worker|kept=text|mode=target|outcome=hit|target=101-200|took=2-5s"
   -> { event, fields } or null if anything at all is off. */
function parseKey(key) {
  if (typeof key !== 'string' || key.length > 200) return null;
  const parts = key.split('|');
  const event = parts.shift();
  const spec = SCHEMA[event];
  if (!spec) return null;

  const fields = {};
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq < 1) return null;
    const name = part.slice(0, eq);
    const value = part.slice(eq + 1);
    const vocab = spec[name];
    if (!vocab || !vocab.has(value)) return null;   // unknown field or value
    if (name in fields) return null;                // repeated field
    fields[name] = value;
  }
  return { event, fields };
}

/* Exported so the validation can be tested directly: a dropped key and an
   accepted one produce the same 204, so the handler alone cannot prove it. */
export { parseKey, SCHEMA, COLUMNS };

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { Allow: 'POST' } });
    }
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
    }

    // A beacon from our own pages carries our own Origin. A missing Origin is
    // allowed because not every client sends one; a foreign one is not.
    const origin = request.headers.get('Origin');
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return new Response(null, { status: 403 });
    }

    const declared = Number(request.headers.get('Content-Length'));
    if (declared > MAX_BODY) return new Response(null, { status: 413 });

    let body;
    try {
      const text = await request.text();
      if (text.length > MAX_BODY) return new Response(null, { status: 413 });
      body = JSON.parse(text);
    } catch {
      return new Response(null, { status: 400 });
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return new Response(null, { status: 400 });
    }
    if (body.v !== 1) return new Response(null, { status: 400 });

    const counts = body.counts;
    if (!counts || typeof counts !== 'object' || Array.isArray(counts)) {
      return new Response(null, { status: 400 });
    }

    let written = 0;
    for (const key of Object.keys(counts)) {
      if (written >= MAX_POINTS) break;

      const n = counts[key];
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_COUNT) continue;

      const parsed = parseKey(key);
      if (!parsed) continue;

      const blobs = [parsed.event];
      for (const col of COLUMNS) blobs.push(parsed.fields[col] || '');

      try {
        env.SMP.writeDataPoint({
          indexes: [parsed.event],        // only one index is permitted
          blobs,
          doubles: [n]
        });
        written++;
      } catch {
        // a failed write must not fail the request: the client cannot retry
        // usefully and a 500 would only add noise
      }
    }

    // Nothing to say back, and nothing the page does with a reply.
    return new Response(null, { status: 204 });
  }
};
