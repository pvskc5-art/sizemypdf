# SizeMyPDF

A free PDF compressor that hits an **exact target file size**, running entirely
in the browser. No upload, no server, no signup, no watermark.

The differentiator is the thing every other compressor gets wrong: when a form
says *"maximum 200 KB"*, you do not want a quality slider — you want a file
under 200 KB. This tool binary-searches resolution and JPEG quality until the
output actually fits, then hands you the highest-quality version that does.

## Why client-side

Every mainstream competitor uploads your document to a server. That is a poor
trade when the document is a passport scan or a bank statement.

Here there is no upload endpoint and no storage bucket, because there is no
server in the path at all. You can verify it: load the page, disconnect from
the internet, and compress a file. It still works.

This also means hosting costs nothing and scales infinitely — it is static
files on a CDN.

## Stack

No framework, no build step for the app itself. Plain HTML, CSS and ES5-era
JavaScript, which keeps Core Web Vitals fast — and page speed is a ranking
factor for a site whose entire acquisition strategy is search.

| Dependency | Purpose |
|---|---|
| [pdf.js](https://mozilla.github.io/pdf.js/) 3.11.174 | Rasterises PDF pages to canvas |
| [pdf-lib](https://pdf-lib.js.org/) 1.17.1 | Rebuilds the compressed PDF |

Both load from cdnjs. For production you may want to vendor them locally so the
site does not depend on a third-party CDN staying up.

## How compression works

**Target size mode.** Pages are rendered to canvas, re-encoded as JPEG, and
reassembled into a new PDF. To find the right settings the tool walks a ladder
of resolution scales from high to low and binary-searches JPEG quality at each,
stopping at the highest-fidelity combination that fits the budget.

Two optimisations matter, and both were the difference between usable and not:

1. **Render once, downscale after.** Rasterising through pdf.js dominates the
   runtime. It happens exactly once at the highest scale; every lower scale is
   a cheap canvas downscale of that result. (~2x faster.)
2. **Search on JPEG totals, assemble once.** Building a real PDF for every
   probe is wasteful — the finished file is just the JPEG bytes plus a small,
   predictable container. The search works on encoded totals and a real PDF is
   built only for the winning setting. (~2x faster again.)

Measured on a deliberate worst case (7.5 MB of photographic noise, 3 pages,
target 200 KB): **145s → 68s**, output 192 KB, all pages intact.

**Lossless mode.** Re-saves through pdf-lib with object streams and strips
metadata. Preserves selectable text but cannot promise a specific size, and
does nothing for a scan, which is almost entirely image data.

### The tab-visibility bug worth knowing about

pdf.js schedules its render chunks with `requestAnimationFrame`, which browsers
**pause in background tabs**. Without a workaround, a compression stalls
forever the moment the user switches tabs — which, on a slow multi-page file,
is exactly what people do. `js/app.js` shims `requestAnimationFrame` to fall
back to a timer while `document.hidden` is true.

Note that pdf.js's documented `onContinue` hook does *not* solve this: it hands
you `_scheduleNext`, which calls `requestAnimationFrame` itself.

## Reading the usage numbers

The collector is a Worker on `sizemypdf.com/api/n` (source in `worker/`),
writing bucketed counters to an Analytics Engine dataset called
`smp_metrics`. Nothing identifying is stored - no cookie, no device id, no IP,
no fine-grained timestamp - so rows cannot be rejoined into a session.

Blob positions are a wire format and are fixed for the life of the dataset:

    blob1 event      compress | batch
    blob2 mode       target | lossless
    blob3 target     the size asked for, bucketed
    blob4 outcome    hit | miss | already-under
    blob5 kept       text | raster
    blob6 took       how long it ran, bucketed
    blob7 engine     worker | main
    blob8 files      batch only, how many
    blob9 over       batch only, any that missed the target
    blob10 failed    batch only, any that would not open
    double1          how many times that exact combination happened

Query it with the SQL API. The question the site was built to answer - which
target sizes people actually ask for:

    SELECT blob3 AS target, SUM(double1) AS n
    FROM smp_metrics
    WHERE blob1 = 'compress'
    GROUP BY target
    ORDER BY n DESC

And the one that says whether the promise is being kept:

    SELECT blob3 AS target, blob4 AS outcome, SUM(double1) AS n
    FROM smp_metrics
    WHERE blob1 = 'compress'
    GROUP BY target, outcome
    ORDER BY target

A rising share of `miss` against a given target means that target is out of
reach for the documents people bring, which is a content problem rather than a
bug: the page for that size should say so.

Data is kept for three months. Ingestion lags by up to a minute or two, so an
empty result straight after a test is not a failure.

## Local development

```bash
node serve.js          # preview on http://localhost:4321
node build.js          # regenerate content pages + sitemap
```

`build.js` generates the content pages from definitions at the top of the file
so the header, footer, canonical tags and JSON-LD stay consistent. Edit the
page data there, not the generated HTML — your changes to generated `.html`
files will be overwritten.

`index.html` is hand-written and not generated.

## Before going live

- [ ] Replace `sizemypdf.com` throughout with the domain you actually bought
      (`build.js`, `index.html`, `robots.txt`) and re-run `node build.js`
- [ ] Fill in the real contact address in `contact.html`
- [ ] Set the real dates in `privacy.html` and `terms.html`
- [ ] Add the AdSense publisher ID to `ads.txt` (only after approval)
- [ ] Add a GDPR consent banner before serving ads to EU/UK visitors
- [ ] Verify in Google Search Console and submit `sitemap.xml`

## Security headers

The headers are **not in this repo** - they are a Cloudflare Response Header
Transform Rule named "Security headers" on the zone. Nothing here will restore
them if that rule is deleted, so the live value is recorded below.

    default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://static.cloudflareinsights.com https://pagead2.googlesyndication.com https://*.googlesyndication.com https://*.googletagservices.com https://*.google.com https://*.gstatic.com https://*.doubleclick.net https://*.adtrafficquality.google; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' blob: data: https:; frame-src https://*.googlesyndication.com https://*.doubleclick.net https://*.google.com https://*.adtrafficquality.google; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'none'; object-src 'none'

Plus `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and
`Referrer-Policy: strict-origin-when-cross-origin`.

Two tokens in there are load-bearing and easy to remove by accident:

- `'wasm-unsafe-eval'` in `script-src` - **OCR does not run without it.**
  Tesseract is WebAssembly, and compiling WASM counts as eval to CSP. It is
  the narrow token: it permits WASM compilation only, not `eval()`. Never
  "simplify" it to the broad `'unsafe-eval'`, which would also re-open
  `eval()` to every script on the page.
- `blob:` in `worker-src` - the rAF ticker in `js/pdfjs-raf.js` and the
  compression engine are Blob-URL workers, so page rendering stops without it.

### Still to add: Permissions-Policy

The zone sends no `Permissions-Policy`, which means the AdSense iframes are
free to ask for the camera, the microphone or the location. On a site whose
entire claim is that nothing leaves the device, that is the wrong default, and
the camera matters concretely because Scan to PDF genuinely uses it.

Add this as a sixth header on the same rule:

    Permissions-Policy: camera=(self), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), midi=(), magnetometer=(), gyroscope=(), accelerometer=()

`camera=(self)` keeps Scan to PDF working on our own pages while denying it to
every embedded frame. Deliberately absent: anything touching `browsing-topics`
or `interest-cohort`, which would change what the ads are allowed to do and is
a revenue decision rather than a security one.

Still not done, and not for want of trying. The rule editor's "Set new header"
button adds no row when clicked under automation, by reference or through the
DOM, while other buttons on the same dashboard respond to exactly the same
treatment. The API route is closed too: Wrangler's OAuth token carries
zone (read) and no rulesets scope, so PATCHing the ruleset returns 10404.

It is a thirty second job by hand in the dashboard, and that is the honest
recommendation. The alternative - an API token scoped to Zone > Config > Edit
- means handling a credential in plain text, which is worse than the problem.

Verify after any change to the rule:

```bash
curl -sI https://sizemypdf.com/ | grep -i content-security-policy
```

## Deployment

Static files. Point Cloudflare Pages or Netlify at this repo with no build
command and the root as output directory. GitHub Pages works too.

## Known limitations

- Target size mode rasterises pages, so text stops being selectable. This is
  inherent to guaranteeing a byte ceiling, not a bug.
- OCR is English-only and runs on the device, so a long scan is slow on a
  phone. The 9 MB engine is fetched the first time that page is used.
- Encrypted PDFs are not handled by design.
- Very large files are bounded by device memory, not by any server limit.

## Licence

MIT — see [LICENSE](LICENSE).
