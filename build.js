#!/usr/bin/env node
/* Generates the static content pages so header, footer and SEO tags stay in
   sync across the site. Output is plain HTML - the deployed site needs no
   build step and no runtime dependencies.

   Usage:  node build.js       */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* Cache busting. Cloudflare serves our CSS and JS with max-age=14400, and that
   applies to the visitor's own browser too - so after an update a returning
   visitor kept the old stylesheet for up to four hours, with new markup and
   old rules. Purging Cloudflare does not fix that; only a different URL does.
   Every local asset reference therefore carries a hash of its own contents,
   which changes exactly when the file does. */
function ver(rel) {
  try {
    const h = crypto.createHash('sha1')
      .update(fs.readFileSync(path.join(__dirname, rel)))
      .digest('hex').slice(0, 8);
    return `${rel}?v=${h}`;
  } catch (e) {
    return rel;   // asset missing at build time - emit the plain path
  }
}

const SITE = 'https://sizemypdf.com';
const NAME = 'SizeMyPDF';

/* Shown on the privacy policy and terms. Bump this whenever either changes
   materially - a policy dated years ago reads as abandoned, and AdSense
   review treats a stale or placeholder date as a red flag. */
const POLICY_UPDATED = '5 September 2026';

/* Public contact address. AdSense requires a working one, and it must be
   reachable - review does send mail to it. */
const CONTACT_EMAIL = 'hello@sizemypdf.com';

/* Google AdSense. Auto ads inject their own placements, so no manual ad slots
   are needed in the markup - the loader in <head> is the whole integration.
   This same tag is what AdSense checks for during site review. */
const ADSENSE_CLIENT = 'ca-pub-5619759216593458';
const ADSENSE = `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}" crossorigin="anonymous"></script>`;

/* Libraries are self-hosted in vendor/ rather than pulled from a CDN.
   cdnjs is blocked on some corporate and national networks, where the site
   loaded fine and then failed the moment you pressed the button. Same-origin
   files need no SRI, and it removes an external dependency from a product
   whose whole pitch is that nothing leaves your device. */
const SRI = {};

/* ------------------------------------------------------------------ shell */

const head = (p) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${p.title}</title>
<meta name="description" content="${p.desc}">
${p.noindex
  ? '<meta name="robots" content="noindex,follow">'
  : `<link rel="canonical" href="${SITE}/${p.slug}">`}
<meta property="og:title" content="${p.title}">
<meta property="og:description" content="${p.desc}">
<meta property="og:url" content="${SITE}/${p.slug}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="${NAME}">
<meta property="og:image" content="${SITE}/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="favicon.ico" sizes="48x48">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="icon" type="image/png" sizes="96x96" href="icon-96.png">
<link rel="icon" type="image/png" sizes="192x192" href="icon-192.png">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<link rel="manifest" href="site.webmanifest">
<meta name="theme-color" content="#2f6df6">
<link rel="stylesheet" href="${ver('css/style.css')}">
${ADSENSE}
${p.faq ? faqSchema(p.faq) : ''}${p.breadcrumb === false ? '' : crumbSchema(p)}
</head>
<body>

<a class="skip" href="#main">Skip to content</a>

<header class="site">
  <div class="wrap">
    <a class="logo" href="index.html">Size<span>My</span>PDF</a>
    <nav class="main">
      <a href="tools.html">All&nbsp;tools</a>
      <a href="merge-pdf.html">Merge</a>
      <a href="split-pdf.html">Split</a>
      <a href="batch-compress-pdf.html">Batch</a>
      <a href="compress-image-to-size.html">Image</a>
      <a href="about.html">About</a>
    </nav>
  </div>
</header>

<main class="wrap" id="main">
${(p.scripts || []).length ? `<noscript>
  <p class="noscript"><strong>These tools need JavaScript turned on.</strong>
  Not as a tracking tax: the point of this site is that your file is never
  uploaded, which means the work has to happen in your browser, and that is what
  JavaScript is here. There is no server to do it instead. Nothing is sent
  anywhere either way.</p>
</noscript>` : ''}
`;

const foot = (p) => `
</main>

<footer class="site">
  <div class="wrap">
    <nav>
      <a href="about.html">About</a>
      <a href="contact.html">Contact</a>
      <a href="privacy.html">Privacy Policy</a>
      <a href="terms.html">Terms</a>
    </nav>
    <div class="copy">&copy; <span id="yr">2026</span> ${NAME} &middot; Files are processed in your browser and never uploaded.</div>
  </div>
</footer>
${(p.scripts || []).map(s => {
  const sri = SRI[s];
  if (sri) {
    return `<script src="${s}" integrity="${sri}" crossorigin="anonymous" referrerpolicy="no-referrer"></script>`;
  }
  // local script: version it so an update is picked up immediately
  return `<script src="${(s.indexOf('http') === 0 || s.indexOf('vendor/') === 0) ? s : ver(s)}"></script>`;
}).join('\n')}
<script>document.getElementById('yr').textContent=new Date().getFullYear();
if('serviceWorker' in navigator){addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){});});}</script>
</body>
</html>
`;

function faqSchema(items) {
  return `<script type="application/ld+json">
${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map(([q, a]) => ({
      '@type': 'Question', name: q,
      acceptedAnswer: { '@type': 'Answer', text: a }
    }))
  }, null, 2)}
</script>
`;
}

function crumbSchema(p) {
  return `<script type="application/ld+json">
${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' },
      { '@type': 'ListItem', position: 2, name: p.h1, item: `${SITE}/${p.slug}` }
    ]
  }, null, 2)}
</script>
`;
}

/* ------------------------------------------------------- reusable blocks */

/* The compressor itself.

   A page that answers "compress pdf to 250 kb" with prose and a link to the
   compressor is asking somebody who has already told us what they want to go
   somewhere else and say it again. Every competitor that outranks us puts the
   tool on the page, and so should we.

   The markup is lifted out of index.html at build time rather than copied.
   index.html is hand written and is the one that gets edited, so a copy would
   drift the first time the tool changed and the size pages would quietly stop
   matching the front page. Lifting it means that cannot happen; if the block
   ever moves or loses a control, the build stops rather than shipping a page
   with a broken tool on it. */
const TOOL_HTML = (() => {
  // built without escape sequences so the markers stay literal and obvious
  const NL = String.fromCharCode(10), CR = String.fromCharCode(13);
  const home = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
                 .split(CR).join('');
  const lines = home.split(NL);
  const open = lines.findIndex(l => l === '  <div class="tool">');
  if (open < 0) throw new Error('build: no tool block in index.html');
  let close = -1;
  for (let i = open + 1; i < lines.length; i++) {
    if (lines[i] === '  </div>') { close = i; break; }
  }
  if (close < 0) throw new Error('build: the tool block in index.html is unterminated');
  const html = lines.slice(open, close + 1).join(NL);
  const required = ['id="target"', 'id="file"', 'id="go"', 'id="mode"',
                    'id="result"', 'id="status"', 'class="preset"'];
  for (const need of required) {
    if (!html.includes(need)) {
      throw new Error('build: the tool block from index.html has no ' + need);
    }
  }
  return html;
})();

/* Everything index.html loads for the compressor, in the same order. */
const TOOL_SCRIPTS = ['js/pdfjs-raf.js', 'vendor/pdf.min.js', 'vendor/pdf-lib.min.js',
                      'js/metrics.js', 'js/compress-core.js', 'js/app.js'];

/* Pre-fills the size the page is about. paintPresets() runs at load, so the
   matching button lights up without any extra wiring. */
const toolBlock = (kb) => !kb ? TOOL_HTML :
  TOOL_HTML.replace('placeholder="250"', 'placeholder="250" value="' + kb + '"');

/* Pages that are about one size pass it through, so the number somebody
   searched for survives the click instead of having to be typed again. */
const toolCta = (kb) => `
<div class="card" style="text-align:center;margin:26px 0">
  <p style="margin-bottom:14px"><strong>The compressor is on the front page.</strong> Set your target and go &mdash; nothing is uploaded.</p>
  <a class="btn" href="index.html${kb ? '?to=' + kb : ''}">Open the compressor</a>
</div>`;
const TOOL_CTA = toolCta();

/* Ad placeholders are deliberately empty until AdSense approval. Showing
   empty "ad slot" boxes makes a content site look like a shell built around
   advertising, which is exactly the profile AdSense review penalises.
   After approval, put the real <ins class="adsbygoogle"> unit here. */
const AD = '';

const faqBlock = (items) =>
  items.map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join('\n');

/* ---------------------------------------------------------------- pages */

const pages = [];

/* ---- target-size landing pages ---- */

const targets = [
  {
    kb: 100,
    who: 'exam boards, scholarship portals and older government forms',
    realistic: 'a one to three page text document, or a single scanned page',
    extra: `<p>100 KB is an unforgiving limit. It dates from an era of much slower connections, and plenty of portals have never revisited it. For a document that is genuinely text &mdash; a typed letter, a filled form, a certificate &mdash; it is comfortably achievable. For a multi-page colour scan it is often physically impossible, and no tool on the internet will manage it while leaving the document readable.</p>
<p>If you cannot reach 100 KB, the honest fix is usually to reduce what you are compressing rather than compress harder. Scan in greyscale instead of colour, crop away the blank margins, or split a multi-page document and upload the pages separately if the form allows it.</p>`
  },
  {
    kb: 200,
    who: 'the majority of government and university upload forms worldwide',
    realistic: 'up to about five text pages, or two to three scanned pages',
    extra: `<p>200 KB is the single most common hard limit on the web, and it is the reason most people go looking for a PDF compressor in the first place. It is generous enough to be achievable for most real documents and tight enough that an unedited phone scan will always blow past it.</p>
<p>The usual culprit is resolution. A phone camera photographs a sheet of A4 at something like 3000&times;4000 pixels &mdash; far more detail than anyone reading the document needs. Bringing that down to roughly 150 DPI keeps every word legible while removing most of the bytes.</p>`
  },
  {
    kb: 250,
    who: 'recruitment portals, banking KYC uploads and forms whose limit was written in bytes',
    realistic: 'four to six text pages, or two to three scanned pages',
    extra: `<p>250 KB is an odd number, and the oddness is the interesting part. Round limits like 100 KB or 1 MB are usually chosen by a person. A limit of 250 KB is usually a number written into code &mdash; and that is where it gets slippery, because two perfectly reasonable programmers will write it two different ways.</p>
<p>One writes <code>250 * 1024</code>, which is 256,000 bytes. The other writes <code>250000</code>. The form says &ldquo;250 KB&rdquo; either way and gives you no clue which it meant. A file of 254,000 bytes sails through the first and is rejected by the second, with the same unhelpful error either way.</p>
<p>This tool takes the smaller reading. Ask for 250 KB and you get a file under 250,000 bytes, which is also under 256,000, so it is accepted whichever way the form counts. It costs about two per cent of image quality to remove the doubt, which is a trade worth making when the alternative is an upload that fails for a reason nobody explains.</p>
<p>If a form has already rejected a file you were told was small enough, this is very often why.</p>`
  },
  {
    kb: 300,
    who: 'university portals, tender submissions and municipal e-services',
    realistic: 'five to eight text pages, or three to four scanned pages',
    extra: `<p>300 KB sits in a comfortable middle. It is loose enough that a scanned document has room to breathe, and tight enough that an unprocessed phone photograph will still miss it. In practice a colour scan at 150 DPI lands close to this figure for a handful of pages.</p>
<p>If you are close but not under, the quickest win is almost always greyscale rather than harder compression &mdash; it removes two of the three colour channels at a stroke, and for black text on white paper you lose nothing that matters.</p>`
  },
  {
    kb: 500,
    who: 'job applications, visa portals and document management systems',
    realistic: 'ten to twenty pages, including moderate scanning',
    extra: `<p>500 KB is a comfortable limit. If you are hitting it with a text-based PDF, something unusual is inside the file &mdash; most often embedded fonts you do not need, a high-resolution logo repeated on every page, or a scanned signature saved as a lossless PNG.</p>
<p>Try Lossless mode first at this target. It often gets you under 500 KB without touching image quality at all, which means your text stays selectable and searchable.</p>`
  }
];

for (const t of targets) {
  const slug = `compress-pdf-to-${t.kb}kb.html`;
  const faq = [
    [`Can any PDF be compressed to ${t.kb} KB?`,
     `No. Every document has a floor below which it cannot go while remaining readable. ${t.kb} KB is realistic for ${t.realistic}. Beyond that, the honest answer is to reduce the page count or scan in greyscale rather than to compress harder.`],
    ['Will the text still be selectable?',
     'Not in Target Size mode. Guaranteeing a hard byte ceiling requires rasterising the pages into images, which flattens the text layer. Lossless mode preserves selectable text but cannot promise a specific output size.'],
    ['Is my document uploaded to a server?',
     'No. Compression runs entirely in your browser. The file never leaves your device, and the tool keeps working if you disconnect from the internet after the page has loaded.'],
    [`Why does the form still reject my ${t.kb} KB file?`,
     'Check whether the limit is stated in KB or KiB, and whether the form also restricts page dimensions or requires a specific PDF version. Some portals also reject files whose name contains spaces or non-English characters.']
  ];

  pages.push({
    slug,
    title: `Compress PDF to ${t.kb} KB Online — Free, No Upload | ${NAME}`,
    desc: `Compress a PDF to under ${t.kb} KB for form uploads. Runs in your browser, so the file is never uploaded. Free, no signup, no watermark.`,
    h1: `Compress a PDF to ${t.kb} KB`,
    faq,
    scripts: TOOL_SCRIPTS,
    body: `
<h1>Compress a PDF to ${t.kb} KB</h1>
<p class="lede">For ${t.who}. The compressor searches quality settings until your file fits under ${t.kb} KB &mdash; and it runs on your own device, so nothing is uploaded.</p>

<div class="privacy-badge">&#128274; Your file never leaves this device</div>
${toolBlock(t.kb)}

<h2>What ${t.kb} KB actually means in practice</h2>
${t.extra}

<h2>How to do it</h2>
<ol>
  <li>Open the <a href="index.html?to=${t.kb}">compressor on the front page</a> and choose your PDF.</li>
  <li>Leave the method on <strong>Target size</strong>.</li>
  <li>Type <strong>${t.kb}</strong> into the target box.</li>
  <li>Press Compress. The tool tries progressively lower resolutions and quality levels, measuring the real output each time.</li>
  <li>Download the result. It is the best-looking version that still fits under ${t.kb} KB.</li>
</ol>

<div class="note"><strong>Check the result before you submit it.</strong> Open the compressed file and confirm every digit and signature is still legible. A file that passes the upload check but cannot be read is worse than one that was rejected &mdash; you may not get a second chance.</div>

${AD}

<h2>If you cannot get there</h2>
<p>When the tool reports a smallest achievable size above your target, it has genuinely exhausted its options. Things that actually help, in rough order of effectiveness:</p>
<ul>
  <li><strong>Scan in greyscale or black and white.</strong> Colour scans carry three channels of data for documents that are almost entirely black text on white paper. This alone often halves the size.</li>
  <li><strong>Crop the margins.</strong> Phone photographs of documents usually include a desk, a hand, and a lot of empty space, all of which cost bytes.</li>
  <li><strong>Reduce the page count.</strong> Many forms ask for specific pages, not the entire document.</li>
  <li><strong>Rescan at a sensible resolution.</strong> 600 DPI is for archival reproduction. 150 DPI is fine for a form upload and a quarter of the size.</li>
</ul>

<h2>Common questions</h2>
${faqBlock(faq)}

<h2>Other size targets</h2>
<div class="grid">
${targets.filter(o => o.kb !== t.kb).map(o =>
  `  <a href="compress-pdf-to-${o.kb}kb.html"><strong>Compress to ${o.kb} KB</strong><small>For ${o.who}.</small></a>`).join('\n')}
  <a href="compress-pdf-for-email.html"><strong>Compress for email</strong><small>Get under the 25 MB Gmail and Outlook ceiling.</small></a>
</div>
`
  });
}

/* ---- email page ---- */

const emailFaq = [
  ['What is the Gmail attachment limit?',
   'Gmail allows attachments up to 25 MB. Above that it offers to send a Google Drive link instead. The 25 MB ceiling counts the encoded size, so a file slightly under 25 MB on disk can still be refused.'],
  ['What is the Outlook attachment limit?',
   'Outlook.com allows 20 MB per message. Microsoft 365 and Exchange accounts default to 25 MB, but many company administrators lower it to 10 MB, which is why a file that sends fine from your personal account can bounce from your work one.'],
  ['Why was my 24 MB attachment rejected?',
   'Email encodes attachments in base64, which inflates them by roughly 33%. A 24 MB file becomes about 32 MB on the wire. Aim for around 18 MB of actual file to stay safely inside a 25 MB limit.'],
  ['Should I just use a Drive or Dropbox link instead?',
   'For anything above about 10 MB, usually yes. It avoids attachment limits entirely, lets you revoke access later, and does not clog the recipient\'s mailbox. Compression is the better answer when the recipient needs the file itself, such as a form submission or a legal filing.']
];

pages.push({
  slug: 'compress-pdf-for-email.html',
  title: `Compress a PDF for Email — Get Under the 25 MB Limit | ${NAME}`,
  desc: 'Shrink a PDF so it fits an email attachment limit. Covers the real Gmail and Outlook ceilings and the base64 overhead that catches people out. Runs in your browser.',
  h1: 'Compress a PDF for email',
  faq: emailFaq,
  scripts: TOOL_SCRIPTS,
  body: `
<h1>Compress a PDF for email</h1>
<p class="lede">Attachment limits are lower than they look, because email inflates every file it carries. Here is what the real ceilings are and how to get under them.</p>

<div class="privacy-badge">&#128274; Your file never leaves this device</div>
${toolBlock()}

<h2>The limits that actually apply</h2>
<table>
  <thead><tr><th>Service</th><th>Stated limit</th><th>Safe file size</th></tr></thead>
  <tbody>
    <tr><td>Gmail</td><td>25 MB</td><td>~18 MB</td></tr>
    <tr><td>Outlook.com</td><td>20 MB</td><td>~14 MB</td></tr>
    <tr><td>Microsoft 365 / Exchange</td><td>25 MB (often lowered to 10 MB)</td><td>~7 MB</td></tr>
    <tr><td>Yahoo Mail</td><td>25 MB</td><td>~18 MB</td></tr>
    <tr><td>Corporate mail servers</td><td>Frequently 10 MB</td><td>~7 MB</td></tr>
  </tbody>
</table>

<h2>Why the safe size is lower than the stated limit</h2>
<p>Email cannot carry raw binary data, so attachments are encoded in base64 before sending. That encoding uses four characters for every three bytes, inflating the attachment by roughly a third. A 24 MB PDF arrives at the mail server as about 32 MB, which is why it bounces against a 25 MB limit that it appears to satisfy.</p>
<p>There is a second trap: the limit usually applies to the <em>entire message</em>, not each attachment. Three 8 MB files plus a signature image will exceed a 25 MB ceiling even though no single file comes close.</p>
<p>The practical rule is to target about 70% of the stated limit. For Gmail that means aiming for 18 MB, which is what the safe column above reflects.</p>

${AD}

<h2>How to compress for email</h2>
<ol>
  <li>Work out your recipient's limit, not just your own. Your message has to pass through their server too, and corporate servers are usually the strictest link in the chain.</li>
  <li>Open the <a href="index.html">compressor</a> and load your PDF.</li>
  <li>Set the target in KB &mdash; 18 MB is <strong>18000</strong> KB.</li>
  <li>Compress, download, and attach the result.</li>
</ol>

<div class="note"><strong>When compression is the wrong tool:</strong> if the document is a high-resolution scan that the recipient needs to read carefully, squeezing it to fit an attachment limit degrades the thing they actually need. Send a Drive or OneDrive link instead. Compression is for when the file itself must travel.</div>

<h2>Common questions</h2>
${faqBlock(emailFaq)}

<h2>Need a specific size instead?</h2>
<div class="grid">
${targets.map(o =>
  `  <a href="compress-pdf-to-${o.kb}kb.html"><strong>Compress to ${o.kb} KB</strong><small>For ${o.who}.</small></a>`).join('\n')}
</div>
`
});

/* ---- scanned page ---- */

const scanFaq = [
  ['Why is my scanned PDF so large?',
   'A scan is not text. It is a photograph of text, stored as a full-colour image for every page. A single colour page scanned at 600 DPI can occupy several megabytes on its own, while the same page as real text would be a few kilobytes.'],
  ['Will compressing a scan make it unreadable?',
   'Not if you stop at a sensible point. Documents stay comfortably legible down to about 150 DPI. Problems appear with small print, fine handwriting and detailed stamps or seals, so check those areas in the output before you submit it.'],
  ['Can I make the text in a scan searchable?',
   'That requires OCR, which is a different operation from compression. This tool does not perform OCR. If you need searchable text, run OCR first, then compress the result in Lossless mode to keep the text layer intact.'],
  ['Greyscale or colour?',
   'Unless colour carries meaning in your document - a coloured stamp, a signature in blue ink that must be provably not a photocopy - greyscale is almost always the right choice. It removes two of the three colour channels and typically halves the file size.']
];

pages.push({
  slug: 'compress-scanned-pdf.html',
  title: `Compress a Scanned PDF Without Losing Legibility | ${NAME}`,
  desc: 'Scanned PDFs are photographs of paper, which is why they are enormous. Here is how to shrink one without making it unreadable. Runs in your browser, no upload.',
  h1: 'Compress a scanned PDF',
  faq: scanFaq,
  scripts: TOOL_SCRIPTS,
  body: `
<h1>Compress a scanned PDF</h1>
<p class="lede">Scans are where the real savings live &mdash; a 40 MB scanned document can often reach 300 KB and stay perfectly readable. Here is how far you can push it before quality genuinely suffers.</p>

<div class="privacy-badge">&#128274; Your file never leaves this device</div>
${toolBlock()}

<h2>Why scans are so much bigger than documents</h2>
<p>When you type a document, the PDF stores your words as text plus a reference to a font. A page of writing costs a few kilobytes. When you scan a document, the PDF stores a photograph of the paper &mdash; millions of individual pixels, most of them describing blank white space in painstaking detail.</p>
<p>This is why a ten-page typed report might be 80 KB while a ten-page scan of the same report is 40 MB. It is also why scans compress so dramatically: nearly all of those bytes are describing detail that no human reader will ever use.</p>

<h2>The resolution that matters</h2>
<table>
  <thead><tr><th>DPI</th><th>Relative size</th><th>Suitable for</th></tr></thead>
  <tbody>
    <tr><td>600</td><td>16&times;</td><td>Archival reproduction, fine art</td></tr>
    <tr><td>300</td><td>4&times;</td><td>Printing, documents with small print</td></tr>
    <tr><td>150</td><td>1&times;</td><td>Screen reading, form uploads &mdash; the sweet spot</td></tr>
    <tr><td>72</td><td>0.25&times;</td><td>Thumbnails only; body text starts to break down</td></tr>
  </tbody>
</table>
<p>Most scanners default to 300 or 600 DPI. For a document that will be read on a screen or checked by a clerk, 150 DPI is sufficient and roughly a quarter the size of 300 DPI, because the saving scales with the square of the resolution.</p>

${AD}

<h2>Getting the best result</h2>
<ol>
  <li><strong>Start from the best original you have.</strong> Compressing an already-compressed scan stacks artefacts on top of artefacts. If you still have the source, rescan it in greyscale at 150 DPI and you may not need this tool at all.</li>
  <li><strong>Use Target size mode.</strong> Lossless mode cannot help with a scan, because a scan is almost entirely image data and Lossless mode deliberately never touches image data.</li>
  <li><strong>Set a target and check the output.</strong> Zoom into the smallest text, any handwritten signature, and any official stamp. Those three things fail first.</li>
  <li><strong>Back off if it looks wrong.</strong> If 100 KB turns a signature to mush, try 250 KB. A slightly larger file that a human can actually read is the better outcome.</li>
</ol>

<div class="note"><strong>A warning about identity documents:</strong> passports, licences and certificates are often rejected for being illegible after over-compression, and some verification systems reject them automatically. For these, compress conservatively and inspect the result at 100% zoom before submitting.</div>

<h2>Common questions</h2>
${faqBlock(scanFaq)}

<h2>Compress to a specific limit</h2>
<div class="grid">
${targets.map(o =>
  `  <a href="compress-pdf-to-${o.kb}kb.html"><strong>Compress to ${o.kb} KB</strong><small>For ${o.who}.</small></a>`).join('\n')}
</div>
`
});

/* ---- merge tool ---- */

const mergeFaq = [
  ['Is there a limit on how many PDFs I can merge?',
   'There is no server limit because there is no server. The practical limit is your device memory. Dozens of ordinary documents are fine; merging many large scans at once may be slow on a phone.'],
  ['Does merging reduce quality?',
   'No. Merging copies the page objects across untouched, so text stays selectable, images keep their original resolution and links survive. It is a lossless operation, unlike compression.'],
  ['Can I change the order of the files?',
   'Yes. Use the arrows next to each file to move it up or down. Pages are merged strictly in the order shown on screen.'],
  ['Are my documents uploaded anywhere?',
   'No. The merge happens in your browser using JavaScript. Your files never leave your device, which is why the tool still works if you disconnect from the internet after the page loads.'],
  ['Why does my file say unreadable?',
   'The PDF is either password-protected or damaged. Remove the password in whatever application opens it, then try again.']
];

pages.push({
  slug: 'merge-pdf.html',
  title: `Merge PDF Files — Free, No Upload, No Signup | ${NAME}`,
  desc: 'Combine several PDFs into one file, in the order you choose. Runs entirely in your browser, so nothing is uploaded. Free, no signup, no watermark, no page limit.',
  h1: 'Merge PDF files',
  faq: mergeFaq,
  scripts: ['vendor/pdf-lib.min.js', 'js/thumbs.js', 'js/merge.js'],
  body: `
<h1>Merge PDF files</h1>
<p class="lede">Combine any number of PDFs into a single document, in whatever order you want. Nothing is uploaded and nothing is added to the output.</p>

<div class="privacy-badge">&#128274; Your files never leave this device</div>

<div class="tool">
  <label class="drop" id="drop" for="file">
      <strong>Choose PDFs or drop them here</strong>
    <small>Nothing is uploaded &mdash; merging happens in your browser</small>
      <input type="file" id="file" accept="application/pdf,.pdf" multiple class="vh">
    </label>

  <div class="controls" id="controls">
    <ul class="filelist" id="list"></ul>
    <button class="btn" id="go">Merge PDFs</button>

    <div class="bar" id="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i id="barFill"></i></div>
    <div class="status" id="status" role="status" aria-live="polite"></div>

    <div class="result" id="result">
      <div class="big" id="rBig"></div>
      <div class="meta" id="rMeta"></div>
      <button class="btn" id="dl">Download merged PDF</button>
    </div>
  </div>
</div>

${AD}

<h2>Merging is lossless &mdash; compression is not</h2>
<p>This is worth understanding, because it is the difference between the two tools on this site. Merging does not re-encode anything. It copies the page objects from each source document into a new one, so your text stays selectable, images keep every pixel of their original resolution, and internal links keep working.</p>
<p>That means the merged file is roughly the sum of its parts. If the result is too large for wherever you are sending it, merge first and then <a href="index.html">compress the merged file</a> &mdash; in that order. Compressing each piece first, then merging, stacks compression artefacts for no benefit.</p>

<h2>How to merge</h2>
<ol>
  <li>Choose your PDFs, or drag them onto the box above. You can add more at any time.</li>
  <li>Check the order in the list. Use the arrows to move a file up or down, or the &times; to remove it.</li>
  <li>Press Merge. The output follows the order shown on screen, top to bottom.</li>
  <li>Download the result.</li>
</ol>

<div class="note"><strong>File order is not alphabetical.</strong> Files appear in the order your browser hands them over, which for a multi-select is usually alphabetical but is not guaranteed &mdash; and alphabetical rarely matches document order anyway, since <em>page10</em> sorts before <em>page2</em>. Always check the list before merging.</div>

<h2>Common questions</h2>
${faqBlock(mergeFaq)}

<h2>Other tools</h2>
<div class="grid">
  <a href="split-pdf.html"><strong>Split a PDF</strong><small>Pull out specific pages, or break one file into several.</small></a>
  <a href="index.html"><strong>Compress a PDF</strong><small>Hit an exact size limit for a form upload.</small></a>
  <a href="compress-pdf-for-email.html"><strong>Compress for email</strong><small>Get a merged file under an attachment limit.</small></a>
</div>
`
});

/* ---- split tool ---- */

const splitFaq = [
  ['How do I extract just a few pages?',
   'Choose Extract pages and type the ones you want, such as 1-3, 7, 10-12. The result is a single PDF containing exactly those pages, in that order.'],
  ['Can I split a PDF into single pages?',
   'Yes. Choose Split into files and set pages per file to 1. You get one file per page, each with its own download button.'],
  ['Does splitting reduce quality?',
   'No. Splitting copies page objects rather than re-encoding them, so text stays selectable and images keep their original resolution. Nothing is degraded.'],
  ['Why do I get download buttons instead of a ZIP?',
   'Building a ZIP would mean loading another library for something most people do not need. Individual buttons also let you take only the pieces you actually want.'],
  ['Is the document uploaded to a server?',
   'No. Everything happens in your browser. The file never leaves your device.']
];

pages.push({
  slug: 'split-pdf.html',
  title: `Split PDF — Extract Pages Free, No Upload | ${NAME}`,
  desc: 'Extract specific pages from a PDF, or split one document into several files. Runs entirely in your browser, so nothing is uploaded. Free, no signup, no watermark.',
  h1: 'Split a PDF',
  faq: splitFaq,
  scripts: ['vendor/pdf-lib.min.js', 'js/thumbs.js', 'js/split.js'],
  body: `
<h1>Split a PDF</h1>
<p class="lede">Pull out the pages you need, or break one document into several files. Quality is untouched, and nothing is uploaded.</p>

<div class="privacy-badge">&#128274; Your file never leaves this device</div>

<div class="tool">
  <label class="drop" id="drop" for="file">
      <strong>Choose a PDF or drop it here</strong>
    <small>Nothing is uploaded &mdash; splitting happens in your browser</small>
      <input type="file" id="file" accept="application/pdf,.pdf" class="vh">
    </label>

  <div class="controls" id="controls">
    <p class="note" id="info" style="margin-top:0"></p>
    <p class="hint" id="thumbHint" style="display:none"></p>
    <div class="thumbs" id="thumbs"></div>
    <div class="row">
      <div class="field">
        <label for="mode">Method</label>
        <select id="mode">
          <option value="range">Extract pages &mdash; one file</option>
          <option value="chunks">Split into files &mdash; several</option>
        </select>
      </div>
      <div class="field" id="rangeField">
        <label for="range">Pages</label>
        <input type="text" id="range" placeholder="1-3, 5, 8-10">
      </div>
      <div class="field" id="chunkField" style="display:none">
        <label for="chunk">Pages per file</label>
        <input type="number" id="chunk" min="1" value="1">
      </div>
      <div><button class="btn" id="go">Split</button></div>
    </div>

    <div class="bar" id="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i id="barFill"></i></div>
    <div class="status" id="status" role="status" aria-live="polite"></div>
    <div class="outputs" id="outputs"></div>
  </div>
</div>

${AD}

<h2>Which method you want</h2>
<table>
  <thead><tr><th>You want</th><th>Method</th><th>Type</th></tr></thead>
  <tbody>
    <tr><td>Only pages 1 to 3 of a contract</td><td>Extract pages</td><td><code>1-3</code></td></tr>
    <tr><td>The cover and the last page</td><td>Extract pages</td><td><code>1, 24</code></td></tr>
    <tr><td>Everything except the appendix</td><td>Extract pages</td><td><code>1-18</code></td></tr>
    <tr><td>Every page as its own file</td><td>Split into files</td><td>1 per file</td></tr>
    <tr><td>A 40-page book in 10-page parts</td><td>Split into files</td><td>10 per file</td></tr>
  </tbody>
</table>
<p>Ranges can be listed in any combination &mdash; <code>1-3, 7, 10-12</code> is valid &mdash; and pages come out in the order you type them, so <code>5, 1</code> genuinely puts page 5 first.</p>

<h2>Splitting keeps quality intact</h2>
<p>Unlike compression, splitting is lossless. The pages you extract are the original page objects copied into a new document, so text remains selectable and searchable, images keep their full resolution, and nothing is re-encoded.</p>
<p>One consequence worth knowing: an extracted page is not necessarily small. If page 3 of your document contains a full-page scan, extracting it alone still carries that scan's weight. To make it smaller, <a href="index.html">compress the extracted file</a> afterwards.</p>

<div class="note"><strong>Why split at all?</strong> The most common reason is an upload limit that no amount of compression can beat. A 40-page scanned document cannot reach 200 KB while staying readable &mdash; but the three pages the form actually asks for can, comfortably.</div>

<h2>Common questions</h2>
${faqBlock(splitFaq)}

<h2>Other tools</h2>
<div class="grid">
  <a href="merge-pdf.html"><strong>Merge PDFs</strong><small>Combine several files into one, in your chosen order.</small></a>
  <a href="index.html"><strong>Compress a PDF</strong><small>Hit an exact size limit for a form upload.</small></a>
  <a href="compress-scanned-pdf.html"><strong>Compress a scan</strong><small>Where the biggest savings are.</small></a>
</div>
`
});

/* ---- images to PDF ---- */

const img2pdfFaq = [
  ['Which image formats can I use?',
   'JPG, PNG, GIF, BMP and WebP. Everything is re-encoded to JPEG on the way in, because PDF itself only carries a handful of image formats.'],
  ['Can I control the page order?',
   'Yes. Use the arrows beside each image to reorder them. Pages come out in the order shown on screen, not the order your browser happened to list the files in.'],
  ['Should I pick A4 or match the image?',
   'Match the image if the result is only going to be viewed on screen - there are no margins and nothing is cropped. Pick A4 if it will be printed, or if a form expects a standard page size.'],
  ['Are my photos uploaded?',
   'No. The PDF is assembled in your browser and the images never leave your device. That matters more than usual here, because photographed documents are often IDs and certificates.'],
  ['Why is my PDF larger than the images?',
   'It should be close to the sum of them. If it is much larger, the images were probably PNGs, which are lossless and big. Run the result through the compressor to bring it down.']
];

pages.push({
  slug: 'jpg-to-pdf.html',
  title: `JPG to PDF — Convert Images to PDF Free, No Upload | ${NAME}`,
  desc: 'Turn JPG, PNG or other images into a single PDF, in the order you choose. Runs entirely in your browser, so your photos are never uploaded. Free, no signup.',
  h1: 'Images to PDF',
  faq: img2pdfFaq,
  scripts: ['vendor/pdf-lib.min.js', 'js/img2pdf.js'],
  body: `
<h1>Images to PDF</h1>
<p class="lede">Turn photos or scans into one PDF, in the order you choose. Nothing is uploaded &mdash; which matters, because the images people convert are usually documents.</p>

<div class="privacy-badge">&#128274; Your images never leave this device</div>

<div class="tool">
  <label class="drop" id="drop" for="file">
      <strong>Choose images or drop them here</strong>
    <small>JPG, PNG, GIF, BMP or WebP &mdash; nothing is uploaded</small>
      <input type="file" id="file" accept="image/*" multiple class="vh">
    </label>

  <div class="controls" id="controls">
    <ul class="filelist" id="list"></ul>
    <div class="row">
      <div class="field">
        <label for="pagesize">Page size</label>
        <select id="pagesize">
          <option value="match">Match each image &mdash; no margins</option>
          <option value="a4">A4 &mdash; centred, for printing</option>
        </select>
      </div>
      <div><button class="btn" id="go">Create PDF</button></div>
    </div>

    <div class="bar" id="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i id="barFill"></i></div>
    <div class="status" id="status" role="status" aria-live="polite"></div>

    <div class="result" id="result">
      <div class="big" id="rBig"></div>
      <div class="meta" id="rMeta"></div>
      <button class="btn" id="dl">Download PDF</button>
    </div>
  </div>
</div>

${AD}

<h2>Why people convert images to PDF</h2>
<p>Almost always because something will only accept one file. A landlord wants proof of address, a university wants your certificates, a visa portal wants both sides of an ID &mdash; and each will take a single PDF but not four photos. Putting them in one document, in a sensible order, is the whole job.</p>
<p>The second reason is that PDF fixes the order and the layout. A folder of photos arrives in whatever order the recipient's computer decides; a PDF arrives exactly as you built it.</p>

<h2>Match the image, or A4?</h2>
<table>
  <thead><tr><th>Option</th><th>Page size</th><th>Best for</th></tr></thead>
  <tbody>
    <tr><td>Match each image</td><td>Exactly the image's dimensions</td><td>Screen viewing, uploads, no wasted space</td></tr>
    <tr><td>A4</td><td>595&times;842 points, image centred</td><td>Printing, forms that expect standard pages</td></tr>
  </tbody>
</table>
<p>Neither option crops anything. A4 fits the image inside the page and preserves its aspect ratio, so a landscape photo simply leaves white space above and below.</p>

<div class="note"><strong>Photographing a document?</strong> Fill the frame with the page, keep the camera parallel to it, and use even light rather than flash. Getting this right beats any amount of processing afterwards &mdash; and if the result is too large, <a href="index.html">compress it</a> once it is a PDF.</div>

<h2>Common questions</h2>
${faqBlock(img2pdfFaq)}

<h2>Other tools</h2>
<div class="grid">
  <a href="pdf-to-jpg.html"><strong>PDF to images</strong><small>The reverse &mdash; turn each page into a JPG or PNG.</small></a>
  <a href="index.html"><strong>Compress a PDF</strong><small>Photo-heavy PDFs are exactly what this shrinks best.</small></a>
  <a href="tools.html"><strong>All tools</strong><small>Everything on this site, in one list.</small></a>
</div>
`
});

/* ---- PDF to images ---- */

const pdf2imgFaq = [
  ['What resolution should I choose?',
   'Screen (1x) is fine for viewing and sharing. Print (2x) roughly doubles the dimensions and suits printing or reading small text. High (3x) is for detail work and produces large files.'],
  ['JPG or PNG?',
   'JPG for anything photographic or scanned - far smaller files. PNG for diagrams, screenshots and line art, where its lossless compression keeps edges crisp.'],
  ['Why one download button per page?',
   'Building a ZIP would mean loading another library for something many people do not need, and separate buttons let you take only the pages you actually want.'],
  ['Is there a page limit?',
   'The tool refuses documents over 100 pages, because rendering that many images at full resolution will usually exhaust browser memory. Split the document first.'],
  ['Is my PDF uploaded?',
   'No. Pages are rendered in your browser and the file never leaves your device.']
];

pages.push({
  slug: 'pdf-to-jpg.html',
  title: `PDF to JPG — Convert PDF Pages to Images Free | ${NAME}`,
  desc: 'Turn every page of a PDF into a JPG or PNG image. Choose the resolution. Runs entirely in your browser, so nothing is uploaded. Free, no signup, no watermark.',
  h1: 'PDF to images',
  faq: pdf2imgFaq,
  scripts: ['js/pdfjs-raf.js', 'vendor/pdf.min.js', 'js/pdf2img.js'],
  body: `
<h1>PDF to images</h1>
<p class="lede">Turn each page into a JPG or PNG at the resolution you pick. Rendered in your browser &mdash; the document is never uploaded.</p>

<div class="privacy-badge">&#128274; Your file never leaves this device</div>

<div class="tool">
  <label class="drop" id="drop" for="file">
      <strong>Choose a PDF or drop it here</strong>
    <small>Nothing is uploaded &mdash; pages are rendered in your browser</small>
      <input type="file" id="file" accept="application/pdf,.pdf" class="vh">
    </label>

  <div class="controls" id="controls">
    <p class="note" id="info" style="margin-top:0"></p>
    <div class="row">
      <div class="field">
        <label for="format">Format</label>
        <select id="format">
          <option value="image/jpeg">JPG &mdash; smaller, best for scans</option>
          <option value="image/png">PNG &mdash; lossless, best for diagrams</option>
        </select>
      </div>
      <div class="field">
        <label for="quality">Resolution</label>
        <select id="quality">
          <option value="1">Screen &mdash; 1&times;</option>
          <option value="2" selected>Print &mdash; 2&times;</option>
          <option value="3">High &mdash; 3&times;</option>
        </select>
      </div>
      <div><button class="btn" id="go">Convert</button></div>
    </div>

    <div class="bar" id="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i id="barFill"></i></div>
    <div class="status" id="status" role="status" aria-live="polite"></div>
    <div class="outputs" id="outputs"></div>
  </div>
</div>

${AD}

<h2>Choosing format and resolution</h2>
<table>
  <thead><tr><th>Your page is</th><th>Format</th><th>Resolution</th></tr></thead>
  <tbody>
    <tr><td>A scan or photograph</td><td>JPG</td><td>Print (2&times;)</td></tr>
    <tr><td>A diagram or screenshot</td><td>PNG</td><td>Print (2&times;)</td></tr>
    <tr><td>Going into a slide deck</td><td>PNG</td><td>High (3&times;)</td></tr>
    <tr><td>Just for viewing or sharing</td><td>JPG</td><td>Screen (1&times;)</td></tr>
  </tbody>
</table>
<p>The multiplier is relative to the PDF's own page size, not a fixed DPI. A standard A4 page at 2&times; comes out around 1190&times;1684 pixels, which is roughly 150 DPI.</p>

<h2>This is a one-way conversion</h2>
<p>Rendering a page to an image throws away the text layer permanently. The words become pixels: not selectable, not searchable, and not recoverable by converting back. Keep the original PDF.</p>

<div class="note"><strong>Only need one page as an image?</strong> <a href="split-pdf.html">Extract that page</a> first, then convert &mdash; much faster than rendering a whole document to get a single picture.</div>

<h2>Common questions</h2>
${faqBlock(pdf2imgFaq)}

<h2>Other tools</h2>
<div class="grid">
  <a href="jpg-to-pdf.html"><strong>Images to PDF</strong><small>The reverse &mdash; combine photos into one PDF.</small></a>
  <a href="split-pdf.html"><strong>Split a PDF</strong><small>Pull out the one page you actually need.</small></a>
  <a href="tools.html"><strong>All tools</strong><small>Everything on this site, in one list.</small></a>
</div>
`
});

/* ---- rotate ---- */

const rotateFaq = [
  ['Does rotating reduce quality?',
   'Not at all. Rotation is stored as a number in the page metadata rather than by redrawing anything, so the file comes out byte-for-byte as good as it went in.'],
  ['Can I rotate only some pages?',
   'Yes. Type the pages in the box - "all", or something like 1-3, 7. This is the common case for scanned documents where one sheet went through the feeder sideways.'],
  ['Which direction is 90 degrees?',
   'Clockwise. If a page is lying on its left side, 90 will stand it up. If it is upside down, use 180.'],
  ['The rotation looks wrong in my viewer',
   'Some viewers cache the previous rendering. Close and reopen the file. If a page already carried a rotation, this tool adds to it rather than replacing it, which is what you want when correcting a scan.'],
  ['Is my file uploaded?',
   'No. Everything happens in your browser.']
];

pages.push({
  slug: 'rotate-pdf.html',
  title: `Rotate PDF Pages — Free, No Upload, No Quality Loss | ${NAME}`,
  desc: 'Rotate every page of a PDF, or only the ones you name. Lossless - rotation is metadata, nothing is re-encoded. Runs in your browser, nothing is uploaded.',
  h1: 'Rotate a PDF',
  faq: rotateFaq,
  scripts: ['vendor/pdf-lib.min.js', 'js/rotate.js'],
  body: `
<h1>Rotate a PDF</h1>
<p class="lede">Turn every page, or just the sideways ones. Completely lossless &mdash; and nothing is uploaded.</p>

<div class="privacy-badge">&#128274; Your file never leaves this device</div>

<div class="tool">
  <label class="drop" id="drop" for="file">
      <strong>Choose a PDF or drop it here</strong>
    <small>Nothing is uploaded &mdash; rotation happens in your browser</small>
      <input type="file" id="file" accept="application/pdf,.pdf" class="vh">
    </label>

  <div class="controls" id="controls">
    <p class="note" id="info" style="margin-top:0"></p>
    <div class="row">
      <div class="field">
        <label for="angle">Rotate by</label>
        <select id="angle">
          <option value="90">90&deg; clockwise</option>
          <option value="180">180&deg; &mdash; upside down</option>
          <option value="270">270&deg; &mdash; 90&deg; anticlockwise</option>
        </select>
      </div>
      <div class="field">
        <label for="pages">Pages</label>
        <input type="text" id="pages" value="all" placeholder="all, or 1-3">
      </div>
      <div><button class="btn" id="go">Rotate</button></div>
    </div>

    <div class="status" id="status" role="status" aria-live="polite"></div>

    <div class="result" id="result">
      <div class="big" id="rBig"></div>
      <div class="meta" id="rMeta"></div>
      <button class="btn" id="dl">Download PDF</button>
    </div>
  </div>
</div>

${AD}

<h2>Rotation costs nothing</h2>
<p>Every PDF page carries a rotation value in its metadata &mdash; 0, 90, 180 or 270 &mdash; and viewers apply it when drawing the page. Changing that number is the entire operation. No pixels move, no image is re-encoded, no text is touched, and the file size barely changes.</p>
<p>That makes this the safest tool on the site. Unlike compression, there is no trade-off to weigh: a rotated page is exactly as good as it was.</p>

<h2>Fixing a scan</h2>
<p>The usual situation is a document where most pages are upright but a few went through the scanner sideways. Rather than rotating everything and breaking the good pages, name just the offenders: type <code>4, 9-11</code> and only those move.</p>
<p>If a page already had a rotation, this adds to it rather than overwriting it &mdash; so applying 90&deg; to a page already at 90&deg; gives you 180&deg;, which is what you would expect when nudging a page round step by step.</p>

<h2>Common questions</h2>
${faqBlock(rotateFaq)}

<h2>Other tools</h2>
<div class="grid">
  <a href="split-pdf.html"><strong>Split a PDF</strong><small>Extract pages or break a document into parts.</small></a>
  <a href="merge-pdf.html"><strong>Merge PDFs</strong><small>Combine several files into one.</small></a>
  <a href="tools.html"><strong>All tools</strong><small>Everything on this site, in one list.</small></a>
</div>
`
});

/* ---- compress an image to an exact size ---- */

const imgSizeFaq = [
  ['Does it really hit the exact size I ask for?',
   'It gets as close underneath your target as it can without going over, which is what an upload limit actually requires. A 100 KB target typically lands in the high 90s. It will not pad a file out to hit the number precisely - a smaller file is never a problem for a form that says "maximum 100 KB".'],
  ['Will it shrink the photo’s dimensions?',
   'Only if it has to. Quality is reduced first, because most forms want the picture to still be legible at full size. Dimensions are only reduced when no JPEG quality setting reaches your target, and the result tells you if that happened.'],
  ['Why is my PNG barely getting smaller?',
   'PNG is lossless - it has no quality dial to turn down, so the only way to make it smaller is to reduce its dimensions. For photographs, switch the output to JPEG, which is what portals expect anyway. PNG is the right choice only for screenshots, logos and line art.'],
  ['My photo came out sideways on other tools. Will it here?',
   'It should not. Phone cameras record rotation as EXIF metadata rather than rotating the pixels, and tools that ignore it produce sideways images. This one applies the orientation before compressing.'],
  ['Is my photo uploaded anywhere?',
   'No. The compression runs in your browser using the same canvas your device already uses to display the image. Nothing is sent to a server, which matters here because the images people resize are usually passport photos, signatures and ID documents.'],
  ['The result came back larger than the original',
   'That means the file was already well optimised, so re-encoding it could only add bytes. When that happens your original is returned unchanged rather than a worse, bigger version of it.']
];

pages.push({
  slug: 'compress-image-to-size.html',
  title: `Compress an Image to an Exact Size in KB — Free, No Upload | ${NAME}`,
  desc: 'Compress a JPG or PNG to an exact size in KB - 20, 50, 100, 200 or any limit a form demands. Keeps full dimensions where it can. Runs in your browser, no upload, free.',
  h1: 'Compress an image to an exact size',
  faq: imgSizeFaq,
  scripts: ['js/imgcompress-core.js', 'js/imgsize.js'],
  body: `
<h1>Compress an image to an exact size</h1>
<p class="lede">Give it a photo and a number in KB. It finds the highest quality that fits underneath your limit &mdash; and keeps the full dimensions unless it genuinely cannot. Nothing is uploaded.</p>

<div class="privacy-badge">&#128274; Your image never leaves this device</div>

<div class="tool">
  <label class="drop" id="drop" for="file">
    <strong>Choose an image or drop it here</strong>
    <small>JPG, PNG, WebP, GIF or BMP &mdash; nothing is uploaded</small>
    <input type="file" id="file" accept="image/*" class="vh">
  </label>

  <div class="controls" id="controls">
    <div class="row">
      <div class="field">
        <label for="target">Target size (KB)</label>
        <input type="number" id="target" min="5" step="1" placeholder="100">
      </div>
      <div class="field">
        <label for="format">Output format</label>
        <select id="format">
          <option value="jpeg">JPEG &mdash; best for photos</option>
          <option value="png">PNG &mdash; lossless, for screenshots</option>
        </select>
      </div>
      <div class="field">
        <label for="resize">If quality is not enough</label>
        <select id="resize">
          <option value="yes">Reduce the dimensions too</option>
          <option value="no">Keep full dimensions</option>
        </select>
      </div>
      <div><button class="btn" id="go">Compress</button></div>
    </div>

    <p class="hint" id="pngNote" style="display:none">PNG is lossless, so there is no quality setting to reduce. The only way to make a PNG smaller is to shrink its dimensions &mdash; for a photograph, choose JPEG instead.</p>

    <div class="bar" id="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i id="barFill"></i></div>
    <div class="status" id="status" role="status" aria-live="polite"></div>

    <div class="compare" id="compare">
      <figure>
        <canvas id="beforeCanvas" width="300" height="200"></canvas>
        <figcaption>Original &mdash; <span id="beforeMeta"></span></figcaption>
      </figure>
      <figure>
        <canvas id="afterCanvas" width="300" height="200"></canvas>
        <figcaption>Compressed &mdash; <span id="afterMeta"></span></figcaption>
      </figure>
    </div>

    <div class="result" id="result">
      <div class="big" id="rBig"></div>
      <div class="meta" id="rMeta"></div>
      <button class="btn" id="dl">Download image</button>
    </div>
  </div>
</div>

${AD}

<h2>Why forms ask for a size in kilobytes</h2>
<p>Almost every request to compress an image to an exact size comes from a form that will not accept it otherwise. Government portals, university applications, job sites and visa systems set hard byte limits &mdash; 20 KB for a signature, 50 KB for a passport photograph, 100 or 200 KB for a scanned certificate &mdash; and reject anything above them without explaining what to do about it.</p>
<p>Those limits exist because the systems behind them were built when storage was expensive and are rarely revisited. A modern phone photograph is between three and eight megabytes. A form asking for 50 KB is asking for roughly one percent of that, which is why simply "saving a smaller copy" never works.</p>

<h2>How this reaches a number you choose</h2>
<p>A JPEG's size is governed by a quality setting between 0 and 1, but the relationship is not linear and depends entirely on the picture: quality 0.6 might produce 40 KB for a plain document scan and 400 KB for a detailed landscape. There is no formula, so the only reliable method is to encode, measure, and adjust.</p>
<ol>
  <li>The image is encoded at a middling quality and measured.</li>
  <li>If it fits, quality goes up; if it overshoots, quality comes down. This repeats seven times, halving the remaining range each time.</li>
  <li>That converges on the highest quality that still fits underneath your target, to within about half a percent.</li>
  <li>Only if no quality setting reaches the target do the dimensions come down a step, and the search runs again.</li>
</ol>
<p>The order matters. Reducing dimensions first is the easy way to hit any target, but it hands back a small blurry picture when a slightly softer full-size one would have been accepted. Quality is spent first for the same reason a photographer stops down before reaching for a smaller sensor.</p>

<div class="note"><strong>The result is always under your target, never exactly on it.</strong> A limit of "maximum 100 KB" is satisfied by 96 KB, and padding a file out to hit 100 KB precisely would only waste the difference. If a form demands a size <em>range</em> &mdash; some ask for 20&ndash;50 KB &mdash; set the target to the top of the range.</div>

<h2>Which format to choose</h2>
<table>
  <thead><tr><th>Format</th><th>Compression</th><th>Use it for</th></tr></thead>
  <tbody>
    <tr><td>JPEG</td><td>Lossy, adjustable</td><td>Photographs, scans, anything from a camera. The only format that can hit an arbitrary size target.</td></tr>
    <tr><td>PNG</td><td>Lossless, fixed</td><td>Screenshots, logos, diagrams, line art. Sharp edges and flat colour survive; photographs stay large.</td></tr>
  </tbody>
</table>
<p>If a form does not say which it wants, send JPEG. It is the format these systems were built around, and it is the only one where a size limit is reliably reachable.</p>

<h2>Typical limits, and what survives them</h2>
<table>
  <thead><tr><th>Limit</th><th>Commonly asked for</th><th>What you can expect</th></tr></thead>
  <tbody>
    <tr><td>10&ndash;20 KB</td><td>Signatures</td><td>Fine. A signature is black ink on white and compresses extremely well.</td></tr>
    <tr><td>50 KB</td><td>Passport photographs</td><td>Comfortable at passport dimensions. Full-frame phone photos will be resized.</td></tr>
    <tr><td>100&ndash;200 KB</td><td>Certificates, ID scans</td><td>Usually keeps full dimensions with a modest quality reduction.</td></tr>
    <tr><td>Under 10 KB</td><td>Thumbnails, some older portals</td><td>Expect visible artefacts, and expect the dimensions to come down.</td></tr>
  </tbody>
</table>

<h2>Getting a better result</h2>
<ul>
  <li><strong>Crop before you compress.</strong> Every pixel of desk, floor or fingertip in the frame costs bytes that could have gone to the document. Cropping tightly is the single largest improvement available.</li>
  <li><strong>Photograph in even light, not flash.</strong> Flash creates a bright hotspot and hard shadows, both of which are fine detail that JPEG spends bytes describing.</li>
  <li><strong>Keep the camera parallel to the page.</strong> A skewed photo wastes frame area and is harder to read once quality drops.</li>
  <li><strong>Start from the original, not a forward.</strong> An image that has been through WhatsApp or email has already been compressed once; compressing it again stacks artefacts.</li>
  <li><strong>Keep your original file.</strong> Compression is not reversible. If the form rejects the result for another reason, you want the full-quality version to go back to.</li>
</ul>

<div class="note"><strong>Working with a document rather than a photo?</strong> If what you actually have is a multi-page PDF, compressing it as a PDF gives a far better result than turning it into images first &mdash; <a href="index.html">compress a PDF to an exact size</a> instead.</div>

<h2>Common questions</h2>
${faqBlock(imgSizeFaq)}

<h2>Other tools</h2>
<div class="grid">
  <a href="index.html"><strong>Compress a PDF</strong><small>The same exact-size approach, applied to documents.</small></a>
  <a href="jpg-to-pdf.html"><strong>Images to PDF</strong><small>Turn your compressed photos into one PDF file.</small></a>
  <a href="tools.html"><strong>All tools</strong><small>Everything on this site, in one list.</small></a>
</div>
`
});

/* ---- organise pages ---- */

const organiseFaq = [
  ['Is reordering lossless?',
   'Yes. Pages are copied as objects into a new document and rotation is a number in the page record, so nothing is re-encoded. Text stays selectable, images keep their resolution, and the file will not grow.'],
  ['Can I do all three things at once?',
   'That is the point of this view. Move pages, turn the ones that are sideways, drop the ones you do not want, then save once. Doing it as three separate passes through three separate tools is how pages end up in the wrong order.'],
  ['Why arrows instead of dragging?',
   'Arrows work with a keyboard and on a phone, where dragging a thumbnail into position between two others is fiddly and easy to get wrong. Each page also shows where it came from, so you can see what moved.'],
  ['What is the page limit?',
   'Two hundred pages. Beyond that the grid itself becomes the problem rather than the document. Split the file first, organise the parts, then merge them back.'],
  ['Does this make the file smaller?',
   'Only by however much the removed pages weighed. If you need to hit a size limit, organise first and then run the result through the compressor, which is the tool that targets an exact number of kilobytes.'],
  ['Are my pages uploaded?',
   'No. The document is read, rendered and rebuilt in your browser. Nothing is sent anywhere, which is the whole basis of this site.']
];

pages.push({
  slug: 'organise-pdf.html',
  title: `Organise PDF Pages — Reorder, Rotate, Delete | ${NAME}`,
  desc: 'Reorder, rotate and delete PDF pages in one view, with every page on screen. Lossless and completely in your browser — no upload, no signup, free.',
  h1: 'Organise PDF pages',
  faq: organiseFaq,
  scripts: ['vendor/pdf-lib.min.js', 'js/thumbs.js', 'js/organise.js'],
  body: `
<h1>Organise PDF pages</h1>
<p class="lede">See every page at once, then move it, turn it or drop it. One pass, one save, and nothing is re-encoded. Nothing is uploaded.</p>

<div class="privacy-badge">&#128274; Your file never leaves this device</div>

<div class="tool">
  <label class="drop" id="drop" for="file">
    <strong>Choose a PDF or drop it here</strong>
    <small>Nothing is uploaded &mdash; processing happens in your browser</small>
    <input type="file" id="file" accept="application/pdf,.pdf" class="vh">
  </label>

  <div class="controls" id="controls">
    <p class="note" id="info" style="margin-top:0"></p>
    <div class="pagegrid" id="pagegrid"></div>
    <div class="row">
      <div><button class="btn" id="go">Save</button></div>
    </div>

    <div class="status" id="status" role="status" aria-live="polite"></div>

    <div class="result" id="result">
      <div class="big" id="rBig"></div>
      <div class="meta" id="rMeta"></div>
      <button class="btn" id="dl">Download PDF</button>
    </div>
  </div>
</div>

${AD}

<h2>Why one view instead of three tools</h2>
<p>Most sites split this work up: one page to delete, another to rotate, a third to reorder. Each one means uploading the file again, waiting again, and downloading again &mdash; and because you cannot see the document while you work, the mistakes only show up at the end. Rotating page 7 is easy. Knowing that the sideways page is page 7 and not page 8 is the hard part, and a list of page numbers does not tell you.</p>
<p>Here the pages are in front of you. Each one shows its new position and, when it has moved, where it came from, so a document you have rearranged can still be checked against the original.</p>

<h2>What this does to the file</h2>
<table>
  <thead><tr><th>Action</th><th>Lossless?</th><th>What actually changes</th></tr></thead>
  <tbody>
    <tr><td>Reorder</td><td>Yes</td><td>Page objects are copied into a new document in your order</td></tr>
    <tr><td>Rotate</td><td>Yes</td><td>A rotation value in the page record; the content is untouched</td></tr>
    <tr><td>Remove</td><td>Yes</td><td>The page is simply not copied across</td></tr>
  </tbody>
</table>
<p>Because none of it re-encodes anything, the result is the same quality as the original and the file will not grow. Removing pages is the only thing that changes the size, and only by whatever those pages weighed.</p>

<div class="note"><strong>Need to hit a size limit as well?</strong> Organise first, then <a href="index.html">compress the result to an exact number of kilobytes</a>. Doing it the other way round means compressing pages you were about to throw away.</div>

<h2>A sensible order of operations</h2>
<ol>
  <li><strong>Organise</strong> &mdash; get the right pages, the right way up, in the right order.</li>
  <li><strong>Merge</strong> if the document needs to join others.</li>
  <li><strong>Compress</strong> last, once the page count is final, so the size target is calculated on what you are actually submitting.</li>
</ol>

<h2>Common questions</h2>
${faqBlock(organiseFaq)}

<h2>Other tools</h2>
<div class="grid">
  <a href="index.html"><strong>Compress to an exact size</strong><small>The last step &mdash; hit the KB limit a form demands.</small></a>
  <a href="extract-images-from-pdf.html"><strong>Extract images</strong><small>Pull out the embedded pictures at the resolution they are stored.</small></a>
  <a href="compare-pdf.html"><strong>Compare two PDFs</strong><small>See which words changed between two versions, page by page.</small></a>
  <a href="scan-to-pdf.html"><strong>Scan to PDF</strong><small>Photograph pages with your phone camera, no app and no pairing.</small></a>
  <a href="fill-pdf-form.html"><strong>Fill a PDF form</strong><small>Type into a fillable form and save the answers into the file.</small></a>
  <a href="ocr-pdf.html"><strong>OCR a scan</strong><small>Make a scanned PDF searchable, with the engine running on your device.</small></a>
  <a href="sign-pdf.html"><strong>Sign PDF</strong><small>Draw or type a signature and click the page to place it.</small></a>
  <a href="crop-pdf.html"><strong>Crop PDF</strong><small>Trim margins with a live preview, or detect where the content stops.</small></a>
  <a href="organise-pdf.html"><strong>Organise pages</strong><small>Reorder, rotate and remove pages with every page on screen.</small></a>
  <a href="split-pdf.html"><strong>Split PDF</strong><small>For documents too long to organise in one view.</small></a>
  <a href="merge-pdf.html"><strong>Merge PDFs</strong><small>Join the organised file to others.</small></a>
</div>
`
});

/* ---- crop ---- */

const cropFaq = [
  ['Does cropping make the file smaller?',
   'Usually only slightly. Cropping sets the page boundary rather than deleting anything, so the content outside it is hidden but still in the file. If you need a specific size, crop first and then run the result through the compressor.'],
  ['Is it reversible?',
   'In principle yes, because nothing is removed - the crop is a box in the page record. A later tool can widen it again. That also means a crop is not a way to hide sensitive material: the content is still there.'],
  ['What does "Detect content" do?',
   'It renders the first page and finds the box where the ink actually stops, then pads it slightly. On a scan with a grey border, or a photo of a document on a desk, that is usually the crop you wanted.'],
  ['Will text still be selectable?',
   'Yes. Cropping does not re-encode the page, so text, links and image quality are exactly as they were.'],
  ['Can I crop only some pages?',
   'Yes. Leave the page box as "all", or give a range such as 1-3, 7. Margins are percentages, so they apply sensibly to mixed page sizes.'],
  ['What about sideways pages?',
   'Margins follow the page as you see it, not the file’s internal orientation. A page stored rotated is handled so that "top" means the top of what you are looking at.']
];

pages.push({
  slug: 'crop-pdf.html',
  title: `Crop PDF Margins Online — Free, No Upload | ${NAME}`,
  desc: 'Crop the margins off a PDF with a live preview, or detect where the content stops automatically. Runs in your browser, nothing uploaded. Free, no signup.',
  h1: 'Crop a PDF',
  faq: cropFaq,
  scripts: ['vendor/pdf-lib.min.js', 'js/thumbs.js', 'js/pageops.js', 'js/crop.js'],
  body: `
<h1>Crop a PDF</h1>
<p class="lede">Trim the margins and see exactly what you are keeping before you commit. Or let it find where the content stops on its own &mdash; the usual answer for a scan. Nothing is uploaded.</p>

<div class="privacy-badge">&#128274; Your file never leaves this device</div>

<div class="tool">
  <label class="drop" id="drop" for="file">
    <strong>Choose a PDF or drop it here</strong>
    <small>Nothing is uploaded &mdash; processing happens in your browser</small>
    <input type="file" id="file" accept="application/pdf,.pdf" class="vh">
  </label>

  <div class="controls" id="controls">
    <div class="cropwrap">
      <div class="cropstage">
        <canvas id="cropCanvas" aria-label="First page with the crop area shown"></canvas>
        <div class="cropbox" id="cropBox" aria-hidden="true"></div>
      </div>
      <div class="cropfields">
        <div class="field"><label for="m-top">Top %</label>
          <input type="number" id="m-top" value="0" min="0" max="45" step="0.5"></div>
        <div class="field"><label for="m-right">Right %</label>
          <input type="number" id="m-right" value="0" min="0" max="45" step="0.5"></div>
        <div class="field"><label for="m-bottom">Bottom %</label>
          <input type="number" id="m-bottom" value="0" min="0" max="45" step="0.5"></div>
        <div class="field"><label for="m-left">Left %</label>
          <input type="number" id="m-left" value="0" min="0" max="45" step="0.5"></div>
        <div class="field"><label for="range">Pages</label>
          <input type="text" id="range" placeholder="all"></div>
        <div class="cropbtns">
          <button class="btn ghost" type="button" id="detect">Detect content</button>
          <button class="btn ghost" type="button" id="reset">Reset</button>
        </div>
      </div>
    </div>

    <p class="note" id="info" style="margin-top:0"></p>
    <div class="row"><div><button class="btn" id="go">Crop PDF</button></div></div>

    <div class="status" id="status" role="status" aria-live="polite"></div>

    <div class="result" id="result">
      <div class="big" id="rBig"></div>
      <div class="meta" id="rMeta"></div>
      <button class="btn" id="dl">Download PDF</button>
    </div>
  </div>
</div>

${AD}

<h2>Why crop at all</h2>
<p>Three reasons come up again and again. A scan carries a border the scanner added rather than anything on the document. A photographed page has a desk round the edges. And a document built for A4 is being read on a phone, where the margins waste a third of a screen that is already small.</p>
<p>Cropping fixes all three without touching the content, which is why it is worth doing before anything else: the page looks the way it should, and every later step works on what you actually want to keep.</p>

<h2>Detect content, and when not to trust it</h2>
<p>The detector renders the first page and finds the rectangle where non-white pixels stop, then leaves a small margin around it. On a typical scan that lands within a millimetre or two of the right answer.</p>
<p>It measures <strong>the first page only</strong>, because measuring every page and taking the union would give you the widest margin in the document rather than a tight crop. If page one is unrepresentative &mdash; a cover sheet, or a page with a footer the others do not have &mdash; check the number it produces before applying it to the whole file.</p>

<div class="note"><strong>Cropping is not redaction.</strong> The content outside the crop is hidden, not deleted, and a determined reader can recover it. To remove something permanently, delete the page, or convert the page to an image with <a href="pdf-to-jpg.html">PDF to images</a> and rebuild it.</div>

<h2>What it does to the file</h2>
<table>
  <thead><tr><th>Property</th><th>Effect</th></tr></thead>
  <tbody>
    <tr><td>Text and links</td><td>Untouched &mdash; still selectable and clickable</td></tr>
    <tr><td>Image quality</td><td>Unchanged; nothing is re-encoded</td></tr>
    <tr><td>File size</td><td>Roughly the same. Cropping hides margins, it does not delete them</td></tr>
    <tr><td>Page dimensions</td><td>Reduced to the crop, so readers and printers use the new size</td></tr>
  </tbody>
</table>

<div class="note"><strong>Need a size limit too?</strong> Crop first, then <a href="index.html">compress to an exact number of kilobytes</a>. A cropped page rasterises to fewer pixels, so the compressor has an easier job and keeps more quality for the same target.</div>

<h2>Common questions</h2>
${faqBlock(cropFaq)}

<h2>Other tools</h2>
<div class="grid">
  <a href="index.html"><strong>Compress to an exact size</strong><small>The step after cropping, when a form names a KB limit.</small></a>
  <a href="extract-images-from-pdf.html"><strong>Extract images</strong><small>Pull out the embedded pictures at the resolution they are stored.</small></a>
  <a href="compare-pdf.html"><strong>Compare two PDFs</strong><small>See which words changed between two versions, page by page.</small></a>
  <a href="scan-to-pdf.html"><strong>Scan to PDF</strong><small>Photograph pages with your phone camera, no app and no pairing.</small></a>
  <a href="fill-pdf-form.html"><strong>Fill a PDF form</strong><small>Type into a fillable form and save the answers into the file.</small></a>
  <a href="ocr-pdf.html"><strong>OCR a scan</strong><small>Make a scanned PDF searchable, with the engine running on your device.</small></a>
  <a href="sign-pdf.html"><strong>Sign PDF</strong><small>Draw or type a signature and click the page to place it.</small></a>
  <a href="crop-pdf.html"><strong>Crop PDF</strong><small>Trim margins with a live preview, or detect where the content stops.</small></a>
  <a href="organise-pdf.html"><strong>Organise pages</strong><small>Reorder, turn and remove pages with all of them on screen.</small></a>
  <a href="rotate-pdf.html"><strong>Rotate PDF</strong><small>Straighten sideways pages before you crop them.</small></a>
</div>
`
});

/* ---- sign ---- */

const signFaq = [
  ['Is this a legally binding signature?',
   'It is a visible signature: an image of your mark drawn onto the page, which is what most forms, letters and internal approvals actually ask for. It is not a cryptographic signature, so it does not certify who signed or prove the document has not changed since. If you have been asked for a digital certificate or a qualified electronic signature, this is not that.'],
  ['Is my signature uploaded anywhere?',
   'No, and that matters more here than anywhere else on this site. The drawing never leaves your browser, the PDF is assembled on your device, and nothing is stored between visits. A signature is the last thing that should be sitting on somebody else’s server.'],
  ['Can I draw with my finger?',
   'Yes. The pad takes touch as well as a mouse or stylus, so a phone or tablet generally gives a better-looking signature than a trackpad does.'],
  ['What does typing my name give me?',
   'A cursive rendering of it, using a handwriting face if your device has one and an italic serif if not. It is quicker than drawing and looks tidier, though it is obviously not your handwriting.'],
  ['How do I place it accurately?',
   'Click the page where you want the middle of the signature to sit. It appears there, and clicking again moves it. The size slider scales it against the page width, so a signature that looks right on screen is the size it will print.'],
  ['Can I sign more than one page?',
   'One page per pass at the moment. Sign, download, and run the result through again for the next page. Pages are not re-encoded, so doing it twice costs nothing in quality.']
];

pages.push({
  slug: 'sign-pdf.html',
  title: `Sign a PDF Online — Draw or Type, No Upload | ${NAME}`,
  desc: 'Sign a PDF by drawing with your finger or typing your name, then click the page to place it. Runs entirely in your browser — your signature is never uploaded. Free.',
  h1: 'Sign a PDF',
  faq: signFaq,
  scripts: ['vendor/pdf-lib.min.js', 'js/thumbs.js', 'js/sign.js'],
  body: `
<h1>Sign a PDF</h1>
<p class="lede">Draw your signature with a finger or a mouse, or type your name, then click the page where it should go. Your signature never leaves this device.</p>

<div class="privacy-badge">&#128274; Your file and your signature never leave this device</div>

<div class="tool">
  <label class="drop" id="drop" for="file">
    <strong>Choose a PDF or drop it here</strong>
    <small>Nothing is uploaded &mdash; processing happens in your browser</small>
    <input type="file" id="file" accept="application/pdf,.pdf" class="vh">
  </label>

  <div class="controls" id="controls">
    <div class="signwrap">
      <div class="signleft">
        <span class="sizelabel">1. Your signature</span>
        <canvas id="pad" class="sigpad" aria-label="Draw your signature here"></canvas>
        <div class="row">
          <div class="field">
            <label for="typed">or type your name</label>
            <input type="text" id="typed" placeholder="A. Patel" autocomplete="off">
          </div>
          <div><button class="btn ghost" type="button" id="clearpad">Clear</button></div>
        </div>
        <div class="field">
          <label for="size">Size (% of page width)</label>
          <input type="range" id="size" min="10" max="60" value="30">
        </div>
        <div class="field">
          <label for="pageNo">Page</label>
          <select id="pageNo"></select>
        </div>
      </div>
      <div class="signright">
        <span class="sizelabel">2. Click where it goes</span>
        <div class="signstage">
          <canvas id="pageCanvas" aria-label="Page preview: click to place the signature"></canvas>
          <div class="ghost" id="ghost" aria-hidden="true"></div>
        </div>
      </div>
    </div>

    <p class="note" id="info" style="margin-top:0"></p>
    <div class="row"><div><button class="btn" id="go">Sign PDF</button></div></div>

    <div class="status" id="status" role="status" aria-live="polite"></div>

    <div class="result" id="result">
      <div class="big" id="rBig"></div>
      <div class="meta" id="rMeta"></div>
      <button class="btn" id="dl">Download PDF</button>
    </div>
  </div>
</div>

${AD}

<h2>What kind of signature this is</h2>
<p>There are two quite different things called an electronic signature, and it is worth knowing which one you have been asked for.</p>
<table>
  <thead><tr><th></th><th>Visible signature</th><th>Cryptographic signature</th></tr></thead>
  <tbody>
    <tr><td>What it is</td><td>A picture of your mark on the page</td><td>A certificate bound to the file</td></tr>
    <tr><td>Proves who signed</td><td>No</td><td>Yes, via a certificate authority</td></tr>
    <tr><td>Detects later edits</td><td>No</td><td>Yes &mdash; the signature breaks</td></tr>
    <tr><td>Usually enough for</td><td>Forms, letters, approvals, most day-to-day paperwork</td><td>Contracts and filings that specifically demand it</td></tr>
    <tr><td>This tool</td><td><strong>Yes</strong></td><td>No</td></tr>
  </tbody>
</table>
<p>This tool does the first one. Plenty of sites sell the first while implying the second, and that is worth being blunt about: if a form has asked you for a qualified electronic signature or a digital certificate, you need a certificate authority, not a drawing tool.</p>

<h2>Why doing it in the browser matters here</h2>
<p>Every other file on this site is private because it is your document. A signature is different in kind: it is a reusable credential. Once an image of your signature is sitting in somebody’s upload folder, it can be lifted and placed on a document you never saw.</p>
<p>Nothing here is uploaded. The pad, the page rendering and the assembled PDF all happen on your device, and nothing is remembered between visits &mdash; which also means you will need to draw it again next time, deliberately.</p>

<div class="note"><strong>Signing a scan that is too large?</strong> Sign first, then <a href="index.html">compress to an exact size</a>. Compressing before signing wastes effort on a file you are about to change, and a heavy rasterising pass can make a thin signature line look ragged.</div>

<h2>Getting a signature that looks right</h2>
<ul>
  <li><strong>Use a phone or tablet if you can.</strong> A finger or stylus on glass produces a far better line than a trackpad, which tends to give an angular scrawl.</li>
  <li><strong>Draw it large.</strong> The pad is scaled down when it is placed, so a big signature comes out smoother than a cramped one.</li>
  <li><strong>Keep it around 25&ndash;35% of the page width.</strong> Much larger reads as a novelty; much smaller disappears when printed.</li>
  <li><strong>Check the placement before you download.</strong> The preview is the actual page, so what you see is where it lands.</li>
</ul>

<h2>Common questions</h2>
${faqBlock(signFaq)}

<h2>Other tools</h2>
<div class="grid">
  <a href="index.html"><strong>Compress to an exact size</strong><small>For when the signed file still has to meet a KB limit.</small></a>
  <a href="jpg-to-pdf.html"><strong>Images to PDF</strong><small>Turn a photographed form into a PDF, then sign it.</small></a>
  <a href="merge-pdf.html"><strong>Merge PDFs</strong><small>Attach the signed page to the rest of a bundle.</small></a>
</div>
`
});

/* ---- OCR ---- */

const ocrFaq = [
  ['Is my document really not uploaded?',
   'Really. The recognition engine is Tesseract compiled to WebAssembly and it runs inside this page, the same way the compressor does. You can watch it: open your browser’s network tab, and after the engine itself downloads you will see no further requests while it reads your pages.'],
  ['Why is it a 9 MB download?',
   'That is the recognition engine and the English language model. Doing OCR without a server means the engine has to come to you. It is fetched the first time you open this page, cached afterwards, and no other page on this site loads it.'],
  ['Does it change how my document looks?',
   'No, and that is deliberate. Most OCR services hand back your pages as flat images with text hidden behind them, which discards any real text or vector graphics the file still had. Here your pages are left exactly as they are and an invisible text layer is added on top.'],
  ['How accurate is it?',
   'On a clean 300 DPI scan of printed text, very good. On a phone photo taken at an angle in poor light, noticeably worse. It does not read handwriting. Always check figures, names and anything you are relying on — OCR misreads are usually plausible rather than obvious.'],
  ['How long does it take?',
   'Roughly a second or two per page on a laptop, several on a phone. It is real work on your own processor rather than a queue on somebody’s server, so a long document takes a while and the page will tell you which page it is on.'],
  ['Can I just get the text?',
   'Yes. Alongside the searchable PDF there is a plain-text download of everything it read, which is often what you actually wanted.'],
  ['Which languages?',
   'English at the moment. Each additional language is another model to host, so they will be added based on what people ask for rather than all at once.']
];

pages.push({
  slug: 'ocr-pdf.html',
  title: `OCR a Scanned PDF — Searchable Text, No Upload | ${NAME}`,
  desc: 'Make a scanned PDF searchable with OCR that runs in your browser — your document is never uploaded. Keeps your pages unchanged and adds an invisible text layer. Free.',
  h1: 'Make a scanned PDF searchable',
  faq: ocrFaq,
  scripts: ['vendor/pdf-lib.min.js', 'js/thumbs.js', 'js/ocr.js'],
  body: `
<h1>Make a scanned PDF searchable</h1>
<p class="lede">A scan is a photograph of text: you cannot search it, select it or copy from it. OCR reads the words and puts them back into the file. This runs on your device &mdash; the document is not uploaded, which for OCR is unusual.</p>

<div class="privacy-badge">&#128274; Your file never leaves this device</div>

<div class="tool">
  <label class="drop" id="drop" for="file">
    <strong>Choose a scanned PDF or drop it here</strong>
    <small>Nothing is uploaded &mdash; the OCR engine runs in your browser</small>
    <input type="file" id="file" accept="application/pdf,.pdf" class="vh">
  </label>

  <div class="controls" id="controls">
    <p class="note" id="info" style="margin-top:0"></p>
    <div class="row">
      <div class="field">
        <label for="lang">Language</label>
        <select id="lang"><option value="eng">English</option></select>
      </div>
      <div><button class="btn" id="go">Read the text</button></div>
    </div>

    <div class="bar" id="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i id="barFill"></i></div>
    <div class="status" id="status" role="status" aria-live="polite"></div>

    <div class="result" id="result">
      <div class="big" id="rBig"></div>
      <div class="meta" id="rMeta"></div>
      <button class="btn" id="dl">Download searchable PDF</button>
      <button class="btn ghost" id="dlText">Download the text</button>
    </div>
  </div>
</div>

${AD}

<h2>Why this one is different</h2>
<p>Every other tool on this site is in your browser because it can be. OCR is in your browser because it should be, and almost never is.</p>
<p>Recognition is expensive, so the usual arrangement is that you upload the document, a server reads it, and you download the result &mdash; which means the scan sat on somebody else’s disk for a while. The documents people run OCR on are exactly the ones that argument matters for: contracts, medical letters, bank statements, passports, deeds. The engine here is about 9 MB, which arrives once and then reads your pages locally.</p>

<h2>Your pages are not rasterised</h2>
<p>This is worth understanding, because it is the part most OCR tools get wrong. A common implementation renders every page to an image, lays invisible text over it, and returns that. The result is searchable but flattened: any genuine text, vector drawing or crisp line art in the original has been turned into pixels.</p>
<p>Here the original pages are kept byte-for-byte and only the text layer is added. A file that was part scan and part real text keeps the real text exactly as it was.</p>

<div class="note"><strong>Check the output.</strong> OCR errors are rarely obvious &mdash; a misread digit looks like a digit. Search the result for a few figures and names you know before relying on it, particularly on anything financial or legal.</div>

<h2>What makes recognition better or worse</h2>
<table>
  <thead><tr><th>Condition</th><th>Effect</th></tr></thead>
  <tbody>
    <tr><td>Flatbed scan, 300 DPI, printed text</td><td>Best case &mdash; usually near-perfect</td></tr>
    <tr><td>Phone photo, flat and evenly lit</td><td>Good</td></tr>
    <tr><td>Photo at an angle, or with a shadow across it</td><td>Noticeably worse; straighten and re-take if you can</td></tr>
    <tr><td>Very low resolution, or heavy JPEG artefacts</td><td>Poor &mdash; there is no detail left to read</td></tr>
    <tr><td>Handwriting</td><td>Not supported</td></tr>
  </tbody>
</table>

<div class="note"><strong>Do OCR before compressing, not after.</strong> Compressing to a small target rasterises and softens the page, which is exactly the detail recognition needs. Read the text first, then <a href="index.html">compress to an exact size</a> &mdash; the text layer survives compression because it is text, not pixels.</div>

<h2>Common questions</h2>
${faqBlock(ocrFaq)}

<h2>Other tools</h2>
<div class="grid">
  <a href="compress-scanned-pdf.html"><strong>Compress a scan</strong><small>Where the biggest size savings are, once the text is readable.</small></a>
  <a href="crop-pdf.html"><strong>Crop PDF</strong><small>Trim the scanner border before reading the text.</small></a>
  <a href="index.html"><strong>Compress to an exact size</strong><small>The last step, when a form names a KB limit.</small></a>
</div>
`
});

/* ---- fill forms ---- */

const formsFaq = [
  ['My browser can already open the form. Why use this?',
   'Opening it is not the problem; saving it is. Several built-in viewers let you type into a form and then save a file with the boxes empty again, and plenty of phone viewers will not show the fields at all. This writes the answers into the file itself, so what you send is what you typed.'],
  ['What does flattening do?',
   'It turns your answers into part of the page, so no later viewer can change them or fail to display them. That is usually what you want when submitting something. It cannot be undone, so it is off unless you ask for it — keep the form editable if somebody else still has to fill part of it in.'],
  ['It says my PDF has no fillable fields.',
   'Then it is not a form in the technical sense — most likely a scan, or a document that only looks like a form. Nothing can fill those in automatically because there are no fields to fill. Use the signing tool to write on it instead.'],
  ['Why are the labels odd?',
   'They come from the field names inside the file, and those are written for software rather than people — names like f1_04[0] are common on official forms. The tidied name is shown first and the real one underneath, so you can match it against the page if there is any doubt.'],
  ['Are radio buttons and dropdowns supported?',
   'Yes: text boxes, checkboxes, radio groups, dropdowns and multi-select lists. Buttons and signature fields are skipped, because there is nothing sensible to type into them.'],
  ['Is the form uploaded?',
   'No. It is read, filled and rebuilt in your browser. That matters here because these forms usually carry a name, an address and a date of birth on the first page.']
];

pages.push({
  slug: 'fill-pdf-form.html',
  title: `Fill a PDF Form Online — Free, No Upload | ${NAME}`,
  desc: 'Fill in a fillable PDF form and save the answers into the file, with optional flattening. Runs in your browser — nothing is uploaded. Free, no signup.',
  h1: 'Fill in a PDF form',
  faq: formsFaq,
  scripts: ['vendor/pdf-lib.min.js', 'js/forms.js'],
  body: `
<h1>Fill in a PDF form</h1>
<p class="lede">Type your answers, then get a PDF that actually contains them. Optionally flatten so nothing can alter them afterwards. Nothing is uploaded.</p>

<div class="privacy-badge">&#128274; Your form never leaves this device</div>

<div class="tool">
  <label class="drop" id="drop" for="file">
    <strong>Choose a fillable PDF or drop it here</strong>
    <small>Nothing is uploaded &mdash; processing happens in your browser</small>
    <input type="file" id="file" accept="application/pdf,.pdf" class="vh">
  </label>

  <div class="controls" id="controls">
    <p class="note" id="info" style="margin-top:0"></p>
    <div class="fieldlist" id="fields"></div>
    <div class="row">
      <div class="field checkrow">
        <input type="checkbox" id="flatten">
        <label for="flatten">Flatten &mdash; make the answers permanent (cannot be undone)</label>
      </div>
      <div><button class="btn" id="go">Save filled PDF</button></div>
    </div>

    <div class="status" id="status" role="status" aria-live="polite"></div>

    <div class="result" id="result">
      <div class="big" id="rBig"></div>
      <div class="meta" id="rMeta"></div>
      <button class="btn" id="dl">Download PDF</button>
    </div>
  </div>
</div>

${AD}

<h2>The problem this actually solves</h2>
<p>A fillable PDF is a document with real form fields in it, and the awkwardness is almost never in typing &mdash; it is in saving. Some built-in browser viewers will happily let you fill a form, then save a copy with every box empty, because they were only ever showing you the fields rather than editing the file. Phone viewers often do worse and do not show the fields at all.</p>
<p>Here the answers are written into the document and the field appearances are regenerated, so the file carries its contents with it whatever opens it next.</p>

<h2>Flatten, or keep it editable?</h2>
<table>
  <thead><tr><th></th><th>Keep editable</th><th>Flatten</th></tr></thead>
  <tbody>
    <tr><td>Answers can be changed later</td><td>Yes</td><td>No</td></tr>
    <tr><td>Shows correctly in every viewer</td><td>Usually</td><td>Always</td></tr>
    <tr><td>Good for</td><td>A form somebody else still has to complete</td><td>Anything you are submitting</td></tr>
    <tr><td>Reversible</td><td>&mdash;</td><td><strong>No</strong></td></tr>
  </tbody>
</table>
<p>If you are sending the form somewhere final, flatten it. If it is going round an office first, leave it editable and flatten the last version.</p>

<div class="note"><strong>Form too large to upload once filled?</strong> Fill it first, then <a href="index.html">compress to an exact size</a>. If you flatten as well, compress afterwards &mdash; a flattened form is ordinary page content and compresses predictably.</div>

<h2>What is not a form</h2>
<p>A scanned page that looks like a form is not one. If somebody printed a form, filled nothing in, scanned it and sent you the PDF, there are no fields inside it &mdash; only a picture of boxes. No tool can fill that in for you, here or anywhere. Two things do work:</p>
<ul>
  <li><a href="sign-pdf.html">Sign PDF</a> lets you place text or a signature anywhere on the page, which covers most of what people need.</li>
  <li><a href="ocr-pdf.html">OCR</a> will at least make the printed words searchable, which helps if you are looking for a particular clause.</li>
</ul>

<h2>Common questions</h2>
${faqBlock(formsFaq)}

<h2>Other tools</h2>
<div class="grid">
  <a href="sign-pdf.html"><strong>Sign PDF</strong><small>Add a signature once the form is filled in.</small></a>
  <a href="index.html"><strong>Compress to an exact size</strong><small>For when the completed form has an upload limit.</small></a>
  <a href="merge-pdf.html"><strong>Merge PDFs</strong><small>Attach supporting documents to the form.</small></a>
</div>
`
});

/* ---- scan to PDF ---- */

const camScanFaq = [
  ['Do I need to pair my phone with my computer?',
   'No, and that is the point. Other scan-to-PDF tools pair a phone to a desktop session and pass the photographs through their servers to get them across. Open this page on the phone itself and the photographs never go anywhere — the phone is where the document already is.'],
  ['Is the camera stream recorded?',
   'No. The live view is shown so you can line the page up, and only the frames you actually capture are kept — in memory, until you close the tab. Nothing is written to disk or sent anywhere, and the camera is released when you press Stop or leave the page.'],
  ['The camera will not open.',
   'A page can only use the camera over HTTPS and with your permission. If you refused it, or the browser blocks it, use "Choose photos" instead — on a phone that opens the camera anyway and works just as well.'],
  ['Why is the PDF so large?',
   'Because photographs are large: a few phone shots easily come to several megabytes. Lower the quality setting, or send the result through the compressor, which is what the rest of this site is for.'],
  ['Match the photo or use A4?',
   'Match the photo if it is going to be read on a screen — nothing is cropped and no space is wasted. Choose A4 if it will be printed or a form expects standard pages; the photo is centred and its proportions are kept.'],
  ['Can I get searchable text out of it?',
   'Yes, afterwards. Build the PDF here, then run it through OCR, which adds a text layer without changing how the pages look.']
];

pages.push({
  slug: 'scan-to-pdf.html',
  title: `Scan to PDF with Your Phone — No App, No Upload | ${NAME}`,
  desc: 'Photograph documents with your phone camera and get a single PDF. No app, no pairing, nothing uploaded — it all happens in the browser. Free.',
  h1: 'Scan to PDF',
  faq: camScanFaq,
  scripts: ['vendor/pdf-lib.min.js', 'js/scan.js'],
  body: `
<h1>Scan to PDF</h1>
<p class="lede">Photograph the pages, check them, put them in order, get one PDF. No app to install, no pairing with a computer, and nothing leaves your phone.</p>

<div class="privacy-badge">&#128274; The photographs never leave this device</div>

<div class="tool">
  <div class="row">
    <div><button class="btn" type="button" id="start">Use the camera</button></div>
    <div>
      <label class="btn ghost" for="file">Choose photos</label>
      <input type="file" id="file" accept="image/*" capture="environment" multiple class="vh">
    </div>
  </div>

  <div class="camwrap" id="camwrap">
    <video id="cam" playsinline muted aria-label="Camera view"></video>
    <div class="camtools">
      <button class="btn" type="button" id="shoot" disabled>Capture page</button>
      <button class="btn ghost" type="button" id="stop" disabled>Stop camera</button>
    </div>
  </div>

  <div class="status" id="status" role="status" aria-live="polite"></div>

  <div class="controls" id="controls">
    <p class="note" id="info" style="margin-top:0"></p>
    <div class="pagegrid" id="shots"></div>
    <div class="row">
      <div class="field">
        <label for="pagesize">Page size</label>
        <select id="pagesize">
          <option value="match">Match each photo &mdash; no margins</option>
          <option value="a4">A4 &mdash; centred, for printing</option>
        </select>
      </div>
      <div class="field">
        <label for="quality">Quality</label>
        <select id="quality">
          <option value="0.92">High &mdash; largest file</option>
          <option value="0.8" selected>Normal</option>
          <option value="0.6">Small &mdash; lowest quality</option>
        </select>
      </div>
      <div><button class="btn" id="go" disabled>Make a PDF</button></div>
    </div>

    <div class="result" id="result">
      <div class="big" id="rBig"></div>
      <div class="meta" id="rMeta"></div>
      <button class="btn" id="dl">Download PDF</button>
    </div>
  </div>
</div>

${AD}

<h2>Why this does not need an app</h2>
<p>The usual arrangement for scanning on a phone is either an app that wants an account, or a desktop tool that shows you a QR code, pairs your phone to a session, and relays the photographs through a server so they can appear on your computer.</p>
<p>That relay is the only reason the pairing exists. If you open this page on the phone, the phone already has the camera, the photographs and the processor needed to assemble a PDF &mdash; so nothing has to travel. The result is a file you can share however you normally would.</p>

<h2>Getting a readable scan</h2>
<ul>
  <li><strong>Fill the frame with the page.</strong> Everything else in shot is wasted detail and wasted bytes.</li>
  <li><strong>Keep the phone parallel to the page.</strong> A skewed photograph is harder to read and much harder to OCR.</li>
  <li><strong>Use even light, not flash.</strong> Flash gives a bright hotspot and hard shadows; daylight or a room light is better.</li>
  <li><strong>Put the page on a dark surface.</strong> It makes the edges obvious, which helps if you crop afterwards.</li>
  <li><strong>Check each shot before you move on.</strong> Discarding a blurred page here costs a second; discovering it after submission costs rather more.</li>
</ul>

<div class="note"><strong>Photographs make large PDFs.</strong> Three or four phone shots can come to several megabytes, which is over almost every upload limit. Build the PDF here, then <a href="index.html">compress it to an exact size</a> &mdash; that is the tool this site exists for.</div>

<h2>A sensible sequence</h2>
<ol>
  <li><strong>Scan</strong> the pages here.</li>
  <li><strong><a href="crop-pdf.html">Crop</a></strong> away the desk and the shadows.</li>
  <li><strong><a href="ocr-pdf.html">OCR</a></strong> if you need to search the text later.</li>
  <li><strong><a href="index.html">Compress</a></strong> last, to whatever limit you have been given.</li>
</ol>

<h2>Common questions</h2>
${faqBlock(camScanFaq)}

<h2>Other tools</h2>
<div class="grid">
  <a href="index.html"><strong>Compress to an exact size</strong><small>Photographs are large; this is how they get under a limit.</small></a>
  <a href="crop-pdf.html"><strong>Crop PDF</strong><small>Trim the desk and shadows off the edges.</small></a>
  <a href="ocr-pdf.html"><strong>OCR a scan</strong><small>Make the photographed text searchable.</small></a>
</div>
`
});

/* ---- compare ---- */

const compareFaq = [
  ['Does this compare the appearance or the words?',
   'The words. That is the more useful of the two: a document reflowed by a single line will light up a pixel comparison from that point onwards while telling you nothing about whether any wording changed. Here an inserted clause is reported as an inserted clause.'],
  ['Will it spot a changed image or a changed font?',
   'No. Only text is compared. A replaced logo, a colour change or different formatting will not appear, and the result says so rather than implying it checked everything.'],
  ['It says there is no text to compare.',
   'Then at least one of the files is a scan — a photograph of a page contains no text, only pixels. Run both through OCR first and compare the results; the text layer is what makes comparison possible.'],
  ['What about very long pages?',
   'Word-by-word alignment is quadratic, so a page beyond a few thousand words is reported as changed without the word detail rather than freezing the tab. Most documents never reach that.'],
  ['Are the files uploaded?',
   'No. Both are read in your browser and compared there. For two versions of a contract or an agreement, that is usually the whole reason to avoid an online comparison tool.'],
  ['Why are long unchanged stretches collapsed?',
   'Because the point is to find what moved. Runs of identical text are summarised so the additions and deletions are actually visible, with a few words of context either side.']
];

pages.push({
  slug: 'compare-pdf.html',
  title: `Compare Two PDFs — See What Changed, No Upload | ${NAME}`,
  desc: 'Compare two PDF files and see exactly which words were added or removed, page by page. Runs in your browser — neither file is uploaded. Free, no signup.',
  h1: 'Compare two PDFs',
  faq: compareFaq,
  scripts: ['vendor/pdf-lib.min.js', 'js/thumbs.js', 'js/compare.js'],
  body: `
<h1>Compare two PDFs</h1>
<p class="lede">Put two versions side by side and find out what actually changed &mdash; which words were added, which were removed, and on which page. Neither file is uploaded.</p>

<div class="privacy-badge">&#128274; Neither file leaves this device</div>

<div class="tool">
  <div class="twoup">
    <label class="drop" id="drop-a" for="file-a">
      <strong>Original &mdash; choose or drop a PDF</strong>
      <small>the earlier version</small>
      <input type="file" id="file-a" accept="application/pdf,.pdf" class="vh">
    </label>
    <label class="drop" id="drop-b" for="file-b">
      <strong>Changed &mdash; choose or drop a PDF</strong>
      <small>the version to check</small>
      <input type="file" id="file-b" accept="application/pdf,.pdf" class="vh">
    </label>
  </div>

  <p class="note" id="info" style="margin-top:12px"></p>
  <div class="row"><div><button class="btn" id="go" disabled>Compare</button></div></div>
  <div class="status" id="status" role="status" aria-live="polite"></div>

  <div class="result" id="result">
    <div class="big" id="rBig"></div>
    <div class="meta" id="rMeta"></div>
    <div class="diffbox" id="diff"></div>
  </div>
</div>

${AD}

<h2>Words, not pixels</h2>
<p>There are two ways to compare documents and they answer different questions. A visual comparison overlays the pages and highlights anything that looks different, which is useful for checking a layout but nearly useless for checking wording: add one sentence on page 2 and everything after it shifts down, so a visual tool reports the rest of the document as changed.</p>
<p>A text comparison extracts the words and aligns them, so inserting a sentence is reported as inserting a sentence and the following pages come back clean. That is what this does, using a longest-common-subsequence alignment over words &mdash; the same approach code review tools use on source files.</p>

<h2>What it will and will not tell you</h2>
<table>
  <thead><tr><th>Change</th><th>Detected?</th></tr></thead>
  <tbody>
    <tr><td>Words added, removed or reworded</td><td>Yes</td></tr>
    <tr><td>Pages added or removed</td><td>Yes</td></tr>
    <tr><td>Numbers or dates altered</td><td>Yes &mdash; they are words too</td></tr>
    <tr><td>A replaced image or logo</td><td>No</td></tr>
    <tr><td>Font, colour or spacing changes</td><td>No</td></tr>
    <tr><td>Two scans of the same page</td><td>No &mdash; there is no text to read</td></tr>
  </tbody>
</table>

<div class="note"><strong>Comparing scans?</strong> Run both through <a href="ocr-pdf.html">OCR</a> first. That gives each one a text layer, and the comparison then works normally &mdash; though bear in mind you are comparing what the recognition read, so a misread word can look like an edit.</div>

<h2>Why do it in the browser</h2>
<p>The documents people compare are contracts, tenancy agreements, settlement drafts and policies &mdash; two versions of something where the question is precisely what the other side changed. Uploading both copies to a comparison service to answer that question is an odd trade. Here both files are read and aligned on your own machine.</p>

<h2>Common questions</h2>
${faqBlock(compareFaq)}

<h2>Other tools</h2>
<div class="grid">
  <a href="ocr-pdf.html"><strong>OCR a scan</strong><small>Give a scanned version a text layer so it can be compared.</small></a>
  <a href="organise-pdf.html"><strong>Organise pages</strong><small>Line two documents up before comparing them.</small></a>
  <a href="index.html"><strong>Compress to an exact size</strong><small>The tool this site is built around.</small></a>
</div>
`
});

/* ---- extract images ---- */

const extractFaq = [
  ['How is this different from PDF to images?',
   'PDF to images renders each page and gives you a picture of the page. This finds the image objects stored inside the file and returns them at their own resolution. A photograph placed into a report at postcard size is often embedded at several times that, and this is how you get the original rather than the shrunken version on the page.'],
  ['It found no images.',
   'Then the file probably has none. A PDF exported from a word processor is mostly text and vector drawing — real text rather than pictures of text. If you want an image of each page, use PDF to images instead.'],
  ['Why are there more images than I expected?',
   'Documents often contain images you never think of as images: a logo in the header, a signature block, a scanned stamp, a chart exported as a picture. Very small objects under eight pixels are skipped, because they are usually spacers and rules rather than pictures, and an image reused on many pages is listed once rather than forty times.'],
  ['PNG or JPEG?',
   'PNG is lossless, so it is the honest default — what comes out is what was stored. Choose JPEG if the images are photographs and you want smaller files, accepting a re-encode.'],
  ['Does this recover the exact original file?',
   'It recovers the pixels at full resolution, re-encoded into the format you pick. It is not a byte-for-byte extraction of the original JPEG, because the image is rebuilt from the decoded data. For every practical purpose — reusing a photograph, recovering a logo — that is the same thing.'],
  ['Is the PDF uploaded?',
   'No. It is parsed in your browser and the images are rebuilt from its own objects, so a document full of private photographs stays where it is.']
];

pages.push({
  slug: 'extract-images-from-pdf.html',
  title: `Extract Images from a PDF — Full Resolution, No Upload | ${NAME}`,
  desc: 'Pull the embedded images out of a PDF at the resolution they are stored, not the size they appear. Runs in your browser, nothing uploaded. Free, no signup.',
  h1: 'Extract images from a PDF',
  faq: extractFaq,
  scripts: ['js/pdfjs-raf.js', 'vendor/pdf.min.js', 'vendor/jszip.min.js', 'js/thumbs.js', 'js/extract.js'],
  body: `
<h1>Extract images from a PDF</h1>
<p class="lede">Get the pictures that are actually inside the file, at the resolution they were stored &mdash; which is usually larger than the size they appear on the page. Nothing is uploaded.</p>

<div class="privacy-badge">&#128274; Your file never leaves this device</div>

<div class="tool">
  <label class="drop" id="drop" for="file">
    <strong>Choose a PDF or drop it here</strong>
    <small>Nothing is uploaded &mdash; processing happens in your browser</small>
    <input type="file" id="file" accept="application/pdf,.pdf" class="vh">
  </label>

  <div class="row">
    <div class="field">
      <label for="format">Save as</label>
      <select id="format">
        <option value="png">PNG &mdash; lossless</option>
        <option value="jpeg">JPEG &mdash; smaller files</option>
      </select>
    </div>
  </div>

  <div class="status" id="status" role="status" aria-live="polite"></div>

  <div class="controls" id="controls">
    <p class="note" id="info" style="margin-top:0"></p>
    <div class="pagegrid" id="imgs"></div>
    <div class="row">
      <div><button class="btn" id="zip" disabled>Download all as ZIP</button></div>
    </div>
  </div>
</div>

${AD}

<h2>Stored size, not displayed size</h2>
<p>This is the distinction that makes the tool worth having. When somebody drops a photograph into a document, the image is embedded at whatever resolution the camera produced and then simply displayed smaller. A picture occupying a quarter of an A4 page might be three thousand pixels across in the file.</p>
<p>Rendering the page gives you the quarter-page version. Reading the image object gives you the three thousand pixels. If you are trying to recover a photograph, a logo or a scanned signature that only exists inside a PDF now, that difference is the whole job &mdash; and it is also why these files are so often much larger than they look.</p>

<h2>Which tool do you actually want?</h2>
<table>
  <thead><tr><th>You want</th><th>Use</th></tr></thead>
  <tbody>
    <tr><td>The photographs that were put into the document</td><td>This tool</td></tr>
    <tr><td>A picture of each page as it looks</td><td><a href="pdf-to-jpg.html">PDF to images</a></td></tr>
    <tr><td>The words, from a scan</td><td><a href="ocr-pdf.html">OCR</a></td></tr>
    <tr><td>A smaller file, keeping the pages</td><td><a href="index.html">Compress to an exact size</a></td></tr>
  </tbody>
</table>

<div class="note"><strong>Why your PDF is enormous.</strong> If this tool reports a handful of images totalling far more than you expected, that is your answer: the file is large because full-resolution photographs are sitting inside it being displayed small. <a href="index.html">Compressing to a target size</a> re-encodes exactly those.</div>

<h2>What gets skipped</h2>
<p>Objects smaller than eight pixels on a side are ignored. Documents are full of these &mdash; single-pixel images stretched into rules and borders, spacer graphics, tiny gradient strips &mdash; and listing them as extracted images would bury the pictures you were looking for.</p>
<p>An image reused across pages &mdash; a logo, a letterhead, a watermark &mdash; is listed once. Each page references it separately inside the file, but it is one picture and there is nothing useful about handing you forty copies of it.</p>

<h2>Common questions</h2>
${faqBlock(extractFaq)}

<h2>Other tools</h2>
<div class="grid">
  <a href="pdf-to-jpg.html"><strong>PDF to images</strong><small>A picture of each page, rather than the images inside it.</small></a>
  <a href="compress-image-to-size.html"><strong>Compress an image</strong><small>Get an extracted photograph under a size limit.</small></a>
  <a href="index.html"><strong>Compress to an exact size</strong><small>Shrink the PDF those images are making large.</small></a>
</div>
`
});

/* ---- tools hub ---- */

pages.push({
  slug: 'tools.html',
  title: `All PDF Tools — Free, In Your Browser, No Upload | ${NAME}`,
  desc: 'Every tool on SizeMyPDF: compress to an exact size, merge, split, images to PDF, PDF to images and rotate. All free, all running in your browser with no upload.',
  h1: 'All tools',
  body: `
<h1>All tools</h1>
<p class="lede">Twenty-four tools, all free, all running entirely in your browser. No account, no upload, no watermark, no file size limit imposed by us.</p>

<div class="privacy-badge">&#128274; Every tool here runs on your device</div>

<div class="cats">
  <input type="radio" name="cat" id="cat-all" class="vh" checked>
  <label for="cat-all">All</label>
  <input type="radio" name="cat" id="cat-size" class="vh">
  <label for="cat-size">Size</label>
  <input type="radio" name="cat" id="cat-org" class="vh">
  <label for="cat-org">Pages</label>
  <input type="radio" name="cat" id="cat-conv" class="vh">
  <label for="cat-conv">Convert</label>
  <input type="radio" name="cat" id="cat-edit" class="vh">
  <label for="cat-edit">Edit</label>
  <input type="radio" name="cat" id="cat-sec" class="vh">
  <label for="cat-sec">Privacy</label>

<div class="grid toolgrid">
  <a class="ic ic-compress c-size" href="index.html"><strong>Compress PDF</strong><small>Hit an exact size in KB &mdash; 100, 200, 500 or any number a form demands.</small></a>
  <a class="ic ic-batch c-size" href="batch-compress-pdf.html"><strong>Compress many at once</strong><small>One target, a whole folder of PDFs, downloaded individually or as a ZIP.</small></a>
  <a class="ic ic-imgsize c-size" href="compress-image-to-size.html"><strong>Compress an image</strong><small>Hit an exact size in KB for a photo, signature or scan.</small></a>
  <a class="ic ic-merge c-org" href="merge-pdf.html"><strong>Merge PDFs</strong><small>Combine any number of files into one, in the order you choose.</small></a>
  <a class="ic ic-split c-org" href="split-pdf.html"><strong>Split PDF</strong><small>Break one document into several files, or pull out a range.</small></a>
  <a class="ic ic-pages c-org" href="extract-pages-from-pdf.html"><strong>Extract pages</strong><small>Keep only the pages you name, as one new file.</small></a>
  <a class="ic ic-del c-org" href="delete-pages-from-pdf.html"><strong>Delete pages</strong><small>Remove the pages you do not want and keep the rest.</small></a>
  <a class="ic ic-organise c-org" href="organise-pdf.html"><strong>Organise pages</strong><small>Reorder, rotate and remove pages with every page on screen.</small></a>
  <a class="ic ic-rotate c-org" href="rotate-pdf.html"><strong>Rotate PDF</strong><small>Fix sideways pages. Lossless &mdash; rotation is only metadata.</small></a>
  <a class="ic ic-crop c-org c-edit" href="crop-pdf.html"><strong>Crop PDF</strong><small>Trim margins with a live preview, or detect where the content stops.</small></a>
  <a class="ic ic-img2pdf c-conv" href="jpg-to-pdf.html"><strong>Images to PDF</strong><small>Turn JPGs, PNGs or photos of documents into a single PDF.</small></a>
  <a class="ic ic-pdf2img c-conv" href="pdf-to-jpg.html"><strong>PDF to images</strong><small>Render every page as a JPG or PNG at your chosen resolution.</small></a>
  <a class="ic ic-text c-conv" href="pdf-to-text.html"><strong>PDF to text</strong><small>Extract the words as plain text or Markdown, and take them away.</small></a>
  <a class="ic ic-scan c-conv" href="scan-to-pdf.html"><strong>Scan to PDF</strong><small>Photograph pages with your phone camera, no app and no pairing.</small></a>
  <a class="ic ic-images c-conv" href="extract-images-from-pdf.html"><strong>Extract images</strong><small>Pull out the embedded pictures at the resolution they are stored.</small></a>
  <a class="ic ic-ocr c-conv c-edit" href="ocr-pdf.html"><strong>OCR a scan</strong><small>Make a scanned PDF searchable, with the engine running on your device.</small></a>
  <a class="ic ic-sign c-edit" href="sign-pdf.html"><strong>Sign PDF</strong><small>Draw or type a signature and click the page to place it.</small></a>
  <a class="ic ic-forms c-edit" href="fill-pdf-form.html"><strong>Fill a PDF form</strong><small>Type into a fillable form and save the answers into the file.</small></a>
  <a class="ic ic-flatten c-edit" href="flatten-pdf.html"><strong>Flatten PDF</strong><small>Make form answers part of the page so nothing can edit or lose them.</small></a>
  <a class="ic ic-pagenum c-edit" href="add-page-numbers-to-pdf.html"><strong>Add page numbers</strong><small>Stamp numbers in the position and format you choose.</small></a>
  <a class="ic ic-mark c-edit" href="watermark-pdf.html"><strong>Add a watermark</strong><small>Label pages DRAFT or CONFIDENTIAL across the page.</small></a>
  <a class="ic ic-compare c-edit" href="compare-pdf.html"><strong>Compare two PDFs</strong><small>See which words changed between two versions, page by page.</small></a>
  <a class="ic ic-redact c-sec" href="redact-pdf.html"><strong>Redact PDF</strong><small>Black out text so it is destroyed, not covered over.</small></a>
  <a class="ic ic-unlock c-sec" href="unlock-pdf.html"><strong>Remove a password</strong><small>For a file you can already open. Clears printing locks too.</small></a>
</div>
</div>

<h2>Which tools change your file, and which do not</h2>
<p>Worth knowing before you pick one, because it is the difference between a reversible edit and a permanent one.</p>
<table>
  <thead><tr><th>Tool</th><th>Lossless?</th><th>What happens</th></tr></thead>
  <tbody>
    <tr><td>Merge</td><td>Yes</td><td>Page objects are copied between documents</td></tr>
    <tr><td>Split</td><td>Yes</td><td>Page objects are copied into a new document</td></tr>
    <tr><td>Extract pages</td><td>Yes</td><td>The pages you keep are copied unchanged</td></tr>
    <tr><td>Flatten</td><td>Yes</td><td>Field values are drawn in; nothing is re-encoded</td></tr>
    <tr><td>Rotate</td><td>Yes</td><td>A number in the page metadata changes</td></tr>
    <tr><td>Compress &mdash; Lossless mode</td><td>Yes</td><td>Metadata stripped, file structure repacked</td></tr>
    <tr><td>Delete pages</td><td>Yes</td><td>Remaining page objects are copied unchanged</td></tr>
    <tr><td>Organise pages</td><td>Yes</td><td>Pages copied in your order; rotation is metadata</td></tr>
    <tr><td>Crop</td><td>Yes</td><td>The page boundary changes; content is hidden, not deleted</td></tr>
    <tr><td>Sign</td><td>Mostly</td><td>An image is drawn on; the page beneath is untouched</td></tr>
    <tr><td>OCR</td><td>Yes</td><td>An invisible text layer is added; pages are not rasterised</td></tr>
    <tr><td>Fill a form</td><td>Yes</td><td>Field values are written in; flattening is optional and permanent</td></tr>
    <tr><td>Add page numbers</td><td>Mostly</td><td>Text is drawn on; the page beneath is untouched</td></tr>
    <tr><td>Add watermark</td><td>Mostly</td><td>Text is drawn on; the page beneath is untouched</td></tr>
    <tr><td>Compress &mdash; Target size</td><td><strong>No</strong></td><td>Pages become images; the text layer is lost</td></tr>
    <tr><td>Redact</td><td><strong>No</strong></td><td>Pages become images &mdash; which is the entire point</td></tr>
    <tr><td>Remove a password</td><td><strong>No</strong></td><td>Pages become images; it is the only way to write an unlocked file</td></tr>
    <tr><td>PDF to images</td><td><strong>No</strong></td><td>Pages become pixels; not reversible</td></tr>
    <tr><td>Images to PDF</td><td><strong>No</strong></td><td>Images are re-encoded as JPEG</td></tr>
    <tr><td>Scan to PDF</td><td><strong>No</strong></td><td>Camera photographs are encoded as JPEG</td></tr>
    <tr><td>Compress an image</td><td><strong>No</strong></td><td>Re-encoded as JPEG at a lower quality</td></tr>
  </tbody>
</table>
<p><strong>Always keep your original.</strong> The lossy operations cannot be undone by running them backwards &mdash; converting an image back to a PDF does not restore the text that rendering destroyed.</p>

<h2>What is not here, and why</h2>
<p>Everything on this site runs in your browser. That rules out a category of tools other sites offer, and it is worth being straight about which:</p>
<ul>
  <li><strong>PDF to Word, Excel or PowerPoint.</strong> Reconstructing an editable document needs layout analysis that is not practical in a browser tab. Any site offering it is uploading your file to a server. <a href="pdf-to-text.html">PDF to text</a> will give you the words, but not the layout.</li>
  <li><strong>Adding a password.</strong> The library used here can read PDF encryption but cannot write it, so there is no way to produce a protected file in the browser.</li>
  <li><strong>Cracking a password.</strong> Not supported, and never will be. <a href="unlock-pdf.html">Removing a password</a> is possible only when you already know it and type it in yourself.</li>
  <li><strong>Editing text.</strong> PDF was designed as a final format; genuine text editing means rebuilding the document.</li>
</ul>
<p>The trade is deliberate: fewer tools, but your documents never leave your device. For a passport scan or a bank statement that is the better bargain.</p>

${AD}

<h2>Common size limits</h2>
<div class="grid">
  <a href="compress-pdf-to-100kb.html"><strong>Compress to 100 KB</strong><small>The tightest limit forms use.</small></a>
  <a href="compress-pdf-to-200kb.html"><strong>Compress to 200 KB</strong><small>The most common limit worldwide.</small></a>
  <a href="compress-pdf-to-500kb.html"><strong>Compress to 500 KB</strong><small>Job and visa applications.</small></a>
  <a href="compress-pdf-for-email.html"><strong>Compress for email</strong><small>Under the 25 MB attachment ceiling.</small></a>
  <a href="compress-scanned-pdf.html"><strong>Compress a scan</strong><small>Where the biggest savings hide.</small></a>
</div>
`
});

/* ---- batch compression ---- */

const batchFaq = [
  ['How many files can I do at once?',
   'There is no fixed limit, because there is no server enforcing one. Twenty ordinary documents are comfortable on a laptop. The constraint is your device memory, and it is driven by page count rather than file size - fifty single-page files are far easier than five fifty-page scans.'],
  ['Why are files processed one at a time?',
   'Each file holds every one of its pages as an image in memory while it is being compressed. Running several at once is the quickest way to exhaust a phone, so they are queued deliberately rather than parallelised.'],
  ['Does every file get the same target?',
   'Yes - one target applies to the whole batch, which is the case that matters when a portal enforces the same cap on every attachment. Files already under the target are handed back untouched rather than compressed for no reason.'],
  ['What if one file fails?',
   'The rest continue. A file that cannot be read - usually because it is password-protected - is marked in the list and skipped, and you still get everything else.'],
  ['Are my files uploaded?',
   'No. Every file in the batch is compressed in your browser and none of them leave your device. For a folder of CVs, invoices or ID documents that is the whole point.']
];

pages.push({
  slug: 'batch-compress-pdf.html',
  title: `Compress Multiple PDFs at Once — Free, No Upload | ${NAME}`,
  desc: 'Compress many PDFs to the same size limit in one go, and download them individually or as a ZIP. Runs entirely in your browser — no upload, no signup.',
  h1: 'Compress multiple PDFs at once',
  faq: batchFaq,
  scripts: [
    'js/pdfjs-raf.js',
    'vendor/pdf.min.js',
    'vendor/pdf-lib.min.js',
    'vendor/jszip.min.js',
    'js/metrics.js', 'js/compress-core.js', 'js/batch.js'
  ],
  body: `
<h1>Compress multiple PDFs at once</h1>
<p class="lede">Drop a folder full of documents, set one size limit, get them all back. Nothing is uploaded &mdash; which is the entire reason this is usable for CVs, invoices and ID documents.</p>

<div class="privacy-badge">&#128274; None of your files leave this device</div>

<div class="tool">
  <label class="drop" id="drop" for="file">
    <strong>Choose PDFs or drop them here</strong>
    <small>Nothing is uploaded &mdash; every file is compressed in your browser</small>
    <input type="file" id="file" accept="application/pdf,.pdf" multiple class="vh">
  </label>

  <div class="controls" id="controls">
    <ul class="filelist" id="list"></ul>
    <div class="row">
      <div class="field">
        <label for="target">Target size for every file (KB)</label>
        <input type="number" id="target" min="10" step="10" value="200">
      </div>
      <div><button class="btn" id="go">Compress</button></div>
    </div>

    <div class="bar" id="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i id="barFill"></i></div>
    <div class="status" id="status" role="status" aria-live="polite"></div>

    <div class="result" id="summary">
      <div class="big" id="sBig"></div>
      <div class="meta" id="sMeta"></div>
      <button class="btn" id="zip" disabled>Download all as ZIP</button>
    </div>
  </div>
</div>

<h2>What this is for</h2>
<p>One file at a time is fine when you are filing your own visa application. It is not a workflow when you are an HR coordinator with fifty CVs to get under an applicant tracking system's per-file cap, or a bookkeeper with a month of invoices to fit a portal limit.</p>
<p>That case is also exactly where uploading is least acceptable. CVs carry addresses and phone numbers; invoices carry bank details; ID scans carry everything. Compressing them in the browser means a folder of other people's personal data never leaves your machine &mdash; which is a materially easier thing to justify to whoever is responsible for it.</p>

<h2>How the queue behaves</h2>
<table>
  <thead><tr><th>Situation</th><th>What happens</th></tr></thead>
  <tbody>
    <tr><td>File already under the target</td><td>Handed back untouched &mdash; no quality lost for nothing</td></tr>
    <tr><td>Lossless repack reaches the target</td><td>Marked <strong>text kept</strong>; nothing is rasterised</td></tr>
    <tr><td>Lossless is not enough</td><td>Falls back to rasterising, marked <strong>rasterised</strong></td></tr>
    <tr><td>Target is impossible</td><td>Marked <strong>over target</strong>, smallest sensible version kept</td></tr>
    <tr><td>File is password-protected</td><td>Marked and skipped; the rest of the batch continues</td></tr>
  </tbody>
</table>
<p>Files run one after another rather than together. Each one holds all of its pages as images while it works, so processing several at once is the fastest route to running a phone out of memory.</p>

<div class="note"><strong>Large batches take real time.</strong> The work happens on your processor, not a server, so a folder of scanned documents takes a while &mdash; how long depends on your device more than on us. Compression runs on a background thread, so the page stays responsive and you can switch tabs without slowing it down. The tab does need to stay open.</div>

<h2>Common questions</h2>
${faqBlock(batchFaq)}

<h2>Other tools</h2>
<div class="grid">
  <a href="index.html"><strong>Compress one PDF</strong><small>Single file, with a preview of the result.</small></a>
  <a href="merge-pdf.html"><strong>Merge PDFs</strong><small>Combine a batch into one document instead.</small></a>
  <a href="tools.html"><strong>All tools</strong><small>Everything on this site.</small></a>
</div>
`
});

/* ---- intent landing pages ---- */

const oneMbFaq = [
  ['Is 1 MB the same as 1024 KB?',
   'For file sizes, yes - 1 MB is 1024 KB. Some upload forms mean 1000 KB instead, and a few compute it differently again. If a form rejects a file just under 1 MB, aim for 950 KB and the ambiguity stops mattering.'],
  ['Is 1 MB achievable for a scanned document?',
   'Comfortably. A 1 MB budget is generous - twenty or thirty scanned pages at readable quality, or a hundred pages of ordinary text. If you cannot reach it, something unusual is in the file, such as embedded high-resolution images repeated on every page.'],
  ['Should I use Lossless mode at this size?',
   'Try it first. At 1 MB there is a real chance the lossless repack alone gets you under, which keeps your text selectable and searchable. Fall back to Target size only if it does not.'],
  ['Is my file uploaded?',
   'No. Compression runs in your browser and the document never leaves your device.']
];

pages.push({
  slug: 'compress-pdf-to-1mb.html',
  title: `Compress PDF to 1 MB Online — Free, No Upload | ${NAME}`,
  desc: 'Compress a PDF to under 1 MB. A generous limit that usually keeps text selectable. Runs in your browser, nothing is uploaded. Free, no signup, no watermark.',
  h1: 'Compress a PDF to 1 MB',
  faq: oneMbFaq,
  scripts: TOOL_SCRIPTS,
  body: `
<h1>Compress a PDF to 1 MB</h1>
<p class="lede">A comfortable limit &mdash; and often reachable without touching image quality at all.</p>

<div class="privacy-badge">&#128274; Your file never leaves this device</div>
${toolBlock(1000)}

<h2>Try Lossless first at this size</h2>
<p>1 MB is one of the few common limits where the lossless route stands a real chance. Stripping metadata and repacking the file structure typically saves between 5 and 25 per cent, which is often the whole gap &mdash; and it costs nothing: your text stays selectable, searchable and copyable.</p>
<p>Only if that falls short is it worth rasterising. In the compressor, choose <strong>Lossless</strong>, look at the result, and switch to <strong>Target size</strong> with 1000 typed in the box if you still need more.</p>

<h2>1 MB or 1000 KB?</h2>
<p>Strictly, 1 MB is 1024 KB. In practice some upload forms treat it as 1000 KB, and a handful measure the encoded rather than the raw size. If a form rejects a file that appears to be under the limit, <strong>aim for 950 KB</strong> &mdash; the margin costs you almost nothing in quality and sidesteps the whole ambiguity.</p>

<div class="note"><strong>Already under 1 MB?</strong> The compressor will tell you so and hand the file straight back rather than processing it. Compressing a file that already fits only loses quality for nothing.</div>

<h2>Common questions</h2>
${faqBlock(oneMbFaq)}

<h2>Other size targets</h2>
<div class="grid">
${targets.map(o =>
  `  <a href="compress-pdf-to-${o.kb}kb.html"><strong>Compress to ${o.kb} KB</strong><small>For ${o.who}.</small></a>`).join('\n')}
</div>
`
});

const visaFaq = [
  ['What size do visa portals usually require?',
   'Most sit between 100 KB and 500 KB per document, though a few allow 1 MB or more. The limit is nearly always stated next to the upload button rather than in the guidance notes, so check there first.'],
  ['Will compression make my passport scan unacceptable?',
   'It can, and this is the real risk. Verification staff and automated checks both need to read the machine-readable zone and any security features. Compress conservatively, then open the result and read every character yourself before submitting.'],
  ['Colour or greyscale for identity documents?',
   'Check the instructions. Many authorities specifically require colour for passports and photo IDs because colour is part of the verification. Where colour is required, do not convert to greyscale just to save space - reduce resolution instead.'],
  ['Why was my document rejected even though the size was correct?',
   'Size is only one of several checks. Portals also commonly enforce file type, page dimensions, a maximum number of pages, and filenames without spaces or non-English characters. Legibility is judged separately and by a human.'],
  ['Is my passport scan uploaded to your server?',
   'No. It never leaves your device. That is the entire reason this tool runs in the browser - a passport scan is exactly the kind of document you should not be uploading to a stranger to shrink.']
];

pages.push({
  slug: 'compress-pdf-for-visa-application.html',
  title: `Compress a PDF for a Visa Application — Free, No Upload | ${NAME}`,
  desc: 'Get passport scans and supporting documents under a visa portal upload limit without making them unreadable. Runs in your browser, nothing is uploaded.',
  h1: 'Compress a PDF for a visa application',
  faq: visaFaq,
  scripts: TOOL_SCRIPTS,
  body: `
<h1>Compress a PDF for a visa application</h1>
<p class="lede">Get under the portal's limit without making your documents unreadable &mdash; and without handing your passport scan to a stranger's server.</p>

<div class="privacy-badge">&#128274; Your documents never leave this device</div>
${toolBlock()}

<h2>Why this one deserves care</h2>
<p>Most compression tasks are low stakes: if the output is a bit soft, you try again. A visa application is not that. A document that passes the upload check but cannot be read may be rejected weeks later, and by then you may have lost an appointment slot, a filing window, or the fee.</p>
<p>So the goal here is not the smallest possible file. It is <strong>the largest file that still fits</strong>, which is exactly what the compressor returns &mdash; it searches for the highest quality that lands under your target rather than stopping at the first result that fits.</p>

<h2>A safe order of operations</h2>
<ol>
  <li><strong>Find the actual limit.</strong> It is usually printed beside the upload control, not in the guidance PDF.</li>
  <li><strong>Check whether colour is required.</strong> Many authorities require colour scans of photo identity documents. If so, do not convert to greyscale &mdash; reduce resolution instead.</li>
  <li><strong>Remove pages you were not asked for</strong> with the <a href="delete-pages-from-pdf.html">page remover</a>. Fewer pages means far less compression pressure on the ones that matter.</li>
  <li><strong>Compress to the stated limit</strong>, not below it. Extra headroom buys you nothing and costs legibility.</li>
  <li><strong>Read the output at 100% zoom</strong> before submitting &mdash; every digit of the passport number, the dates, the signature, any stamp.</li>
</ol>

<div class="note"><strong>Keep the originals.</strong> Compression is not reversible. If a document is queried later you will need the full-quality version, and re-scanning from a passport you have already posted is not always possible.</div>

<h2>What tends to fail</h2>
<table>
  <thead><tr><th>Element</th><th>Degrades at</th><th>Why it matters</th></tr></thead>
  <tbody>
    <tr><td>Machine-readable zone</td><td>First</td><td>Often read automatically; errors reject the file</td></tr>
    <tr><td>Handwritten signature</td><td>Early</td><td>Compared against other documents</td></tr>
    <tr><td>Official stamps and seals</td><td>Early</td><td>Fine detail is the point of them</td></tr>
    <tr><td>Printed body text</td><td>Late</td><td>Survives well down to about 150 DPI</td></tr>
  </tbody>
</table>

<h2>Common questions</h2>
${faqBlock(visaFaq)}

<h2>Common limits</h2>
<div class="grid">
  <a href="compress-pdf-to-100kb.html"><strong>100 KB</strong><small>The tightest limit portals impose.</small></a>
  <a href="compress-pdf-to-200kb.html"><strong>200 KB</strong><small>The most common worldwide.</small></a>
  <a href="compress-pdf-to-500kb.html"><strong>500 KB</strong><small>Typical for visa and job portals.</small></a>
  <a href="compress-scanned-pdf.html"><strong>Compress a scan</strong><small>How far you can push a scan safely.</small></a>
</div>
`
});

const phoneFaq = [
  ['Does this work on a phone?',
   'Yes. The tools are ordinary web pages and run in mobile Safari, Chrome and Firefox. There is nothing to install and no app.'],
  ['Why is it slower than on a laptop?',
   'Because the work happens on your device rather than a server. A phone processor doing image compression is simply slower than a laptop one. A few pages take seconds; a fifty-page colour scan may take a minute or two.'],
  ['My phone browser ran out of memory',
   'It is page count that costs memory rather than file size, because every page is held as an image while it is compressed. Split a long document into parts first, compress each, then merge them back if you need one file. Closing other browser tabs helps more than you would expect.'],
  ['Where does the compressed file go?',
   'To wherever your browser saves downloads - Files on iOS, the Downloads folder on Android. Tap the download notification to open it.'],
  ['Can I use it offline?',
   'Once the page has loaded, yes. That is a side effect of processing locally: nothing needs a connection after load. It is also the easiest way to prove that your file is not being uploaded.']
];

pages.push({
  slug: 'compress-pdf-on-phone.html',
  title: `Compress a PDF on Your Phone — No App, No Upload | ${NAME}`,
  desc: 'Compress a PDF on Android or iPhone with no app to install and no upload. Runs in your mobile browser. Free, no signup, no watermark.',
  h1: 'Compress a PDF on your phone',
  faq: phoneFaq,
  scripts: TOOL_SCRIPTS,
  body: `
<h1>Compress a PDF on your phone</h1>
<p class="lede">No app to install, no account, no upload. It runs in the browser you already have open.</p>

<div class="privacy-badge">&#128274; Your file never leaves your phone</div>
${toolBlock()}

<h2>Why no app</h2>
<p>Compressing a PDF is a few seconds of work. Installing an app for it means granting storage permissions, accepting a privacy policy, and in most cases uploading your document to that company's servers anyway &mdash; app stores are full of PDF utilities that are thin wrappers around a web API.</p>
<p>A web page that does the work locally avoids all of that. Nothing is installed, nothing is granted, and nothing is transmitted.</p>

<h2>How to do it</h2>
<ol>
  <li>Open the <a href="index.html">compressor</a> in your phone browser.</li>
  <li>Tap the box and choose your PDF. On iPhone this opens Files; on Android, your file picker or Drive.</li>
  <li>Type the size limit you need in KB.</li>
  <li>Tap Compress and wait &mdash; keep the tab in the foreground on older phones.</li>
  <li>Tap Download. The file lands in Files or Downloads.</li>
</ol>

<div class="note"><strong>Scanning with the camera?</strong> Both phones have a document scanner built in &mdash; Notes on iPhone, Google Drive on Android. Both produce far better results than photographing a page, because they straighten the perspective and correct the lighting. Scan there, then <a href="jpg-to-pdf.html">combine the images into a PDF</a> if you end up with photos rather than a document.</div>

<h2>What to expect on a phone</h2>
<table>
  <thead><tr><th>Document</th><th>Typical time</th></tr></thead>
  <tbody>
    <tr><td>1&ndash;3 page text PDF</td><td>A few seconds</td></tr>
    <tr><td>10-page scan</td><td>10&ndash;30 seconds</td></tr>
    <tr><td>50-page colour scan</td><td>1&ndash;2 minutes, and may strain an older phone</td></tr>
  </tbody>
</table>
<p>If a large file struggles, <a href="split-pdf.html">split it</a> first, compress the parts, and <a href="merge-pdf.html">merge them back</a>.</p>

<h2>Common questions</h2>
${faqBlock(phoneFaq)}

<h2>Other tools</h2>
<div class="grid">
  <a href="jpg-to-pdf.html"><strong>Images to PDF</strong><small>Turn phone photos of documents into one PDF.</small></a>
  <a href="compress-pdf-to-200kb.html"><strong>Compress to 200 KB</strong><small>The most common upload limit.</small></a>
  <a href="tools.html"><strong>All tools</strong><small>Everything on this site.</small></a>
</div>
`
});

/* ---- page-operation tools (delete / number / watermark) ---- */

const PDFLIB_CDN = 'vendor/pdf-lib.min.js';

const deleteFaq = [
  ['Does removing pages reduce quality?',
   'No. The pages you keep are copied across untouched, so text stays selectable and images keep their full resolution. Only the removed pages are gone.'],
  ['Will the file get smaller?',
   'Usually yes, roughly in proportion to what you removed - but not always. If the pages you deleted were light on content and the ones you kept carry the scans, the saving is small. Run the result through the compressor if you need a specific size.'],
  ['Can I remove every page?',
   'No, and the tool refuses to. A PDF with no pages is not a valid file and most readers will not open it. Keep at least one.'],
  ['Is this the same as splitting?',
   'They are two sides of the same operation. Splitting asks which pages you want to keep; this asks which you want gone. Use whichever is less typing for your document.'],
  ['Is my file uploaded?',
   'No. Everything happens in your browser.']
];

pages.push({
  slug: 'delete-pages-from-pdf.html',
  title: `Delete Pages from a PDF — Free, No Upload | ${NAME}`,
  desc: 'Remove specific pages from a PDF and keep the rest. Lossless, runs entirely in your browser, nothing is uploaded. Free, no signup, no watermark.',
  h1: 'Delete pages from a PDF',
  faq: deleteFaq,
  scripts: [PDFLIB_CDN, 'js/thumbs.js', 'js/pageops.js', 'js/delete.js'],
  body: `
<h1>Delete pages from a PDF</h1>
<p class="lede">Name the pages you want gone. Everything else comes back untouched &mdash; and nothing is uploaded.</p>

<div class="privacy-badge">&#128274; Your file never leaves this device</div>

<div class="tool del-tool">
  <label class="drop" id="drop" for="file">
      <strong>Choose a PDF or drop it here</strong>
    <small>Nothing is uploaded &mdash; pages are removed in your browser</small>
      <input type="file" id="file" accept="application/pdf,.pdf" class="vh">
    </label>

  <div class="controls" id="controls">
    <p class="note" id="info" style="margin-top:0"></p>
    <p class="hint" id="thumbHint" style="display:none"></p>
    <div class="thumbs" id="thumbs"></div>
    <div class="row">
      <div class="field">
        <label for="pages">Pages to remove</label>
        <input type="text" id="pages" placeholder="2, 5-7">
      </div>
      <div><button class="btn" id="go">Remove pages</button></div>
    </div>
    <div class="status" id="status" role="status" aria-live="polite"></div>
    <div class="result" id="result">
      <div class="big" id="rBig"></div>
      <div class="meta" id="rMeta"></div>
      <button class="btn" id="dl">Download PDF</button>
    </div>
  </div>
</div>

<h2>Why people remove pages</h2>
<p>Nearly always because a document contains more than the recipient should see, or more than a form will accept. A bank statement where only one month is relevant. A scanned booklet with blank versos between every sheet. A contract where the appendix runs to forty pages nobody asked for.</p>
<p>The blank-page case is the most common of all: duplex scanners faithfully capture the empty back of every sheet, doubling the page count for no information at all.</p>

<div class="note"><strong>Removing a page is not redaction.</strong> Deleting page 4 removes page 4 entirely &mdash; but if sensitive text also appears on page 3, it is still there. Drawing a black box over text does not remove it either; the words remain underneath in the file. Genuine redaction means deleting the content, not covering it.</div>

<h2>How to write the range</h2>
<table>
  <thead><tr><th>You want to remove</th><th>Type</th></tr></thead>
  <tbody>
    <tr><td>Just page 3</td><td><code>3</code></td></tr>
    <tr><td>Pages 5 to 9</td><td><code>5-9</code></td></tr>
    <tr><td>Page 2 and pages 8 to 10</td><td><code>2, 8-10</code></td></tr>
    <tr><td>Every blank verso in a 10-page scan</td><td><code>2, 4, 6, 8, 10</code></td></tr>
  </tbody>
</table>

<h2>Common questions</h2>
${faqBlock(deleteFaq)}

<h2>Other tools</h2>
<div class="grid">
  <a href="split-pdf.html"><strong>Split a PDF</strong><small>Say which pages to keep instead of which to remove.</small></a>
  <a href="index.html"><strong>Compress a PDF</strong><small>Hit an exact size after trimming.</small></a>
  <a href="tools.html"><strong>All tools</strong><small>Everything on this site.</small></a>
</div>
`
});

const numberFaq = [
  ['Where do the numbers go?',
   'Wherever you choose - bottom left, bottom centre, bottom right or top right - about 10mm in from the edge, which clears the printable margin on virtually all printers.'],
  ['Can I skip the cover page?',
   'Yes. Tick "skip the first page" and numbering begins on page two, which is the usual convention for a document with a title page.'],
  ['Can numbering start at something other than 1?',
   'Yes. Set the starting number - useful when the document is one section of a larger bundle and needs to continue from where the previous part ended.'],
  ['Will the numbers cover my content?',
   'They are drawn in the bottom margin, so on a normal document they sit in white space. On a page whose content runs edge to edge, they will overlap. Check the result.'],
  ['Can I remove them afterwards?',
   'Not with this tool - the numbers become part of the page once drawn. Keep your original.']
];

pages.push({
  slug: 'add-page-numbers-to-pdf.html',
  title: `Add Page Numbers to a PDF — Free, No Upload | ${NAME}`,
  desc: 'Stamp page numbers onto a PDF. Choose position, starting number and whether to skip the cover. Runs in your browser, nothing is uploaded. Free, no signup.',
  h1: 'Add page numbers to a PDF',
  faq: numberFaq,
  scripts: [PDFLIB_CDN, 'js/pageops.js', 'js/pagenum.js'],
  body: `
<h1>Add page numbers to a PDF</h1>
<p class="lede">Stamp numbers where you want them, starting where you want. Nothing is uploaded.</p>

<div class="privacy-badge">&#128274; Your file never leaves this device</div>

<div class="tool">
  <label class="drop" id="drop" for="file">
      <strong>Choose a PDF or drop it here</strong>
    <small>Nothing is uploaded &mdash; numbering happens in your browser</small>
      <input type="file" id="file" accept="application/pdf,.pdf" class="vh">
    </label>

  <div class="controls" id="controls">
    <p class="note" id="info" style="margin-top:0"></p>
    <div class="row">
      <div class="field">
        <label for="position">Position</label>
        <select id="position">
          <option value="bc">Bottom centre</option>
          <option value="br">Bottom right</option>
          <option value="bl">Bottom left</option>
          <option value="tr">Top right</option>
        </select>
      </div>
      <div class="field">
        <label for="format">Format</label>
        <select id="format">
          <option value="plain">1, 2, 3</option>
          <option value="of">1 of 12</option>
        </select>
      </div>
      <div class="field">
        <label for="startat">Start at</label>
        <input type="number" id="startat" value="1" min="0">
      </div>
      <div class="field">
        <label for="size">Size</label>
        <select id="size">
          <option value="9">Small</option>
          <option value="11" selected>Normal</option>
          <option value="14">Large</option>
        </select>
      </div>
      <div><button class="btn" id="go">Add numbers</button></div>
    </div>
    <p style="font-size:14px;color:var(--muted);margin:-4px 0 14px">
      <label style="display:inline;font-weight:400">
        <input type="checkbox" id="skipfirst" style="width:auto;margin-right:6px">
        Skip the first page (title page)
      </label>
    </p>
    <div class="status" id="status" role="status" aria-live="polite"></div>
    <div class="result" id="result">
      <div class="big" id="rBig"></div>
      <div class="meta" id="rMeta"></div>
      <button class="btn" id="dl">Download PDF</button>
    </div>
  </div>
</div>

<h2>Conventions worth following</h2>
<p>For anything that will be printed and bound, <strong>bottom centre</strong> is the safest choice: it reads correctly whichever side of the spread the page falls on. Bottom right suits single-sided documents and is what most word processors default to.</p>
<p>Skip the first page when the document has a title page &mdash; convention is that a cover is counted but not numbered. If your bundle continues from an earlier section, set the starting number rather than renumbering from one; a reader following a table of contents will thank you.</p>

<div class="note"><strong>Court and tribunal bundles</strong> often specify exactly where numbers must appear and that they must run continuously across the whole bundle. Check the direction before stamping &mdash; renumbering after the fact means redoing it from the originals.</div>

<h2>Common questions</h2>
${faqBlock(numberFaq)}

<h2>Other tools</h2>
<div class="grid">
  <a href="merge-pdf.html"><strong>Merge PDFs</strong><small>Combine the bundle first, then number it continuously.</small></a>
  <a href="watermark-pdf.html"><strong>Add a watermark</strong><small>Label a document DRAFT or CONFIDENTIAL.</small></a>
  <a href="tools.html"><strong>All tools</strong><small>Everything on this site.</small></a>
</div>
`
});

const markFaq = [
  ['Does a watermark protect my document?',
   'No, and it is important not to believe otherwise. The text sits on top of the page and anyone with the right tools can strip it out. A watermark is a label that discourages casual misuse, not a security control.'],
  ['What opacity should I use?',
   'Around 15 to 25 per cent is the usual range: clearly visible, but not so heavy that the text underneath becomes hard to read. Go higher only if the label matters more than the content.'],
  ['Diagonal or horizontal?',
   'Diagonal is the convention for DRAFT and CONFIDENTIAL because it crosses the whole page and is awkward to crop out. Horizontal is less intrusive and suits a subtle label such as a company name.'],
  ['Can I use an image instead of text?',
   'Not in this tool. Text-only keeps it simple and keeps the output small - an embedded logo on every page adds real weight to the file.'],
  ['Is my document uploaded?',
   'No. The watermark is drawn in your browser.']
];

pages.push({
  slug: 'watermark-pdf.html',
  title: `Add a Watermark to a PDF — Free, No Upload | ${NAME}`,
  desc: 'Stamp text such as DRAFT or CONFIDENTIAL across every page of a PDF. Choose opacity and angle. Runs in your browser, nothing is uploaded. Free, no signup.',
  h1: 'Add a watermark to a PDF',
  faq: markFaq,
  scripts: [PDFLIB_CDN, 'js/pageops.js', 'js/watermark.js'],
  body: `
<h1>Add a watermark to a PDF</h1>
<p class="lede">Stamp DRAFT, CONFIDENTIAL or anything else across every page. Nothing is uploaded.</p>

<div class="privacy-badge">&#128274; Your file never leaves this device</div>

<div class="tool">
  <label class="drop" id="drop" for="file">
      <strong>Choose a PDF or drop it here</strong>
    <small>Nothing is uploaded &mdash; the watermark is drawn in your browser</small>
      <input type="file" id="file" accept="application/pdf,.pdf" class="vh">
    </label>

  <div class="controls" id="controls">
    <p class="note" id="info" style="margin-top:0"></p>
    <div class="row">
      <div class="field">
        <label for="text">Watermark text</label>
        <input type="text" id="text" value="DRAFT" maxlength="60">
      </div>
      <div class="field">
        <label for="opacity">Opacity</label>
        <select id="opacity">
          <option value="10">10% &mdash; very faint</option>
          <option value="20" selected>20% &mdash; typical</option>
          <option value="35">35% &mdash; bold</option>
          <option value="50">50% &mdash; heavy</option>
        </select>
      </div>
      <div class="field">
        <label for="angle">Angle</label>
        <select id="angle">
          <option value="diagonal">Diagonal</option>
          <option value="horizontal">Horizontal</option>
        </select>
      </div>
      <div><button class="btn" id="go">Add watermark</button></div>
    </div>
    <div class="status" id="status" role="status" aria-live="polite"></div>
    <div class="result" id="result">
      <div class="big" id="rBig"></div>
      <div class="meta" id="rMeta"></div>
      <button class="btn" id="dl">Download PDF</button>
    </div>
  </div>
</div>

<h2>Be clear about what a watermark does</h2>
<p>It signals intent. A page stamped DRAFT will not be mistaken for a final version; one stamped CONFIDENTIAL reminds the reader of their obligations. That is genuinely useful.</p>
<p>What it does not do is protect anything. The text is a drawing on top of the page, and removing it is straightforward for anyone who wants to. If a document must not be redistributed, the control has to be who you send it to &mdash; not a label on the page.</p>

<h2>Choosing the text</h2>
<table>
  <thead><tr><th>Purpose</th><th>Text</th><th>Suggested opacity</th></tr></thead>
  <tbody>
    <tr><td>Unfinished version</td><td><code>DRAFT</code></td><td>20%</td></tr>
    <tr><td>Restricted circulation</td><td><code>CONFIDENTIAL</code></td><td>20&ndash;35%</td></tr>
    <tr><td>Reference copy only</td><td><code>NOT FOR SIGNATURE</code></td><td>20%</td></tr>
    <tr><td>Attribution</td><td>Your company name</td><td>10&ndash;15%, horizontal</td></tr>
  </tbody>
</table>
<p>Shorter is better. A long phrase has to be set small to fit across the page, which makes it both harder to read and easier to ignore.</p>

<h2>Common questions</h2>
${faqBlock(markFaq)}

<h2>Other tools</h2>
<div class="grid">
  <a href="add-page-numbers-to-pdf.html"><strong>Add page numbers</strong><small>Number a bundle after watermarking it.</small></a>
  <a href="delete-pages-from-pdf.html"><strong>Delete pages</strong><small>Remove what the recipient should not see.</small></a>
  <a href="tools.html"><strong>All tools</strong><small>Everything on this site.</small></a>
</div>
`
});

/* ---- redact ---- */

const redactFaq = [
  ['Is the text really gone, or just covered?',
   'Gone. The tool renders each page to an image, paints the boxes onto those pixels and builds a new PDF from them. There is no text layer left in the output, so there is nothing to select, copy or recover. This is the difference that matters: most free redaction tools add a black rectangle as an annotation and leave the words in the file underneath it.'],
  ['How do I check it worked?',
   'Open the downloaded file and try to select the text. You will not be able to, anywhere on the page - the whole document is now images. If you can still select text, you are looking at the original file rather than the redacted one.'],
  ['What is the catch?',
   'The output is images, so no text in the document is selectable or searchable any more, and the file is usually larger than the original. That is the price of genuine redaction. If you need a specific file size afterwards, run the result through the compressor.'],
  ['Does it remove metadata too?',
   'Yes. Author, title, producer and keywords are all cleared, because those fields routinely survive edits people assume have cleaned a document.'],
  ['Can I redact a scanned PDF?',
   'Yes, and it is the ideal case. A scan is already images, so rebuilding it loses nothing at all - you get genuine redaction at no cost in quality.'],
  ['Is my file uploaded?',
   'No. The pages are rendered and rebuilt in your browser.']
];

pages.push({
  slug: 'redact-pdf.html',
  title: `Redact a PDF — Permanently Remove Text, No Upload | ${NAME}`,
  desc: 'Black out text in a PDF so it is actually deleted, not just covered. Pages are rebuilt from pixels, so nothing can be copied from underneath. Runs in your browser, nothing is uploaded.',
  h1: 'Redact a PDF',
  faq: redactFaq,
  scripts: [PDFLIB_CDN, 'js/thumbs.js', 'js/raster.js', 'js/pageops.js', 'js/redact.js'],
  body: `
<h1>Redact a PDF</h1>
<p class="lede">Drag a box over anything that must not survive. The text underneath is destroyed, not hidden &mdash; and nothing is uploaded.</p>

<div class="privacy-badge">&#128274; Your file never leaves this device</div>

<div class="tool">
  <label class="drop" id="drop" for="file">
      <strong>Choose a PDF or drop it here</strong>
    <small>Nothing is uploaded &mdash; redaction happens in your browser</small>
      <input type="file" id="file" accept="application/pdf,.pdf" class="vh">
    </label>

  <div class="controls" id="controls">
    <p class="note" id="info" style="margin-top:0"></p>

    <div id="redWrap" style="display:none">
      <div class="pagebar">
        <button class="btn ghost" id="prev" type="button">&larr; Previous</button>
        <span class="pagelabel" id="pageLabel"></span>
        <button class="btn ghost" id="next" type="button">Next &rarr;</button>
      </div>
      <div class="redstage" id="stage">
        <canvas id="stageCanvas"></canvas>
        <div class="redlayer" id="stageLayer"></div>
      </div>
      <p class="hint" id="redInfo">Drag across anything that must not survive.</p>
      <div class="cropbtns">
        <button class="btn ghost" id="clearPage" type="button">Clear this page</button>
        <button class="btn ghost" id="clearAll" type="button">Clear all</button>
      </div>
    </div>

    <div class="row" style="margin-top:16px">
      <div><button class="btn" id="go" disabled>Redact and rebuild</button></div>
    </div>
    <div class="status" id="status" role="status" aria-live="polite"></div>
    <div class="result" id="result">
      <div class="big" id="rBig"></div>
      <div class="meta" id="rMeta"></div>
      <button class="btn" id="dl">Download PDF</button>
    </div>
  </div>
</div>

<h2>Why a black box is not redaction</h2>
<p>This is the single most consequential misunderstanding about PDFs, and it has embarrassed governments, law firms and newspapers repeatedly.</p>
<p>A PDF page is a list of drawing instructions. When you draw a filled rectangle over a paragraph in most editors, you add one more instruction to the end of that list: <em>put a black box here</em>. The instruction that draws the paragraph is still there, earlier in the list. The words are rendered, then covered. Select the area and copy it and the text arrives on your clipboard exactly as it was written. Delete the rectangle and the paragraph reappears.</p>
<p>The same is true of white boxes, of highlighter annotations set to opaque, and of anything else that works by drawing on top. If the original instruction is still in the file, the content is still in the file.</p>

<div class="note"><strong>What this tool does instead.</strong> Every page is rendered to an image, the boxes are painted onto those pixels, and a new PDF is built from the images. The drawing instructions &mdash; all of them, including the ones that drew your sensitive text &mdash; are discarded. There is nothing underneath, because there is no underneath.</div>

<h2>What it costs</h2>
<p>Honesty about the trade-off, because the site applies the same rule to its compressor: rebuilding from pixels means the output contains no text layer at all. Nothing in the document is selectable or searchable afterwards, not just the redacted parts. The file is often larger than the original too, since photographs of text compress worse than text.</p>
<p>For a scan, this costs nothing whatsoever &mdash; the pages were already images. For a text document it is a real loss, and it is the only way to be certain.</p>

<table>
  <thead><tr><th>Approach</th><th>Text recoverable?</th><th>Keeps text layer?</th></tr></thead>
  <tbody>
    <tr><td>Black rectangle drawn on top</td><td><strong>Yes &mdash; trivially</strong></td><td>Yes</td></tr>
    <tr><td>Highlight annotation, opaque</td><td><strong>Yes &mdash; trivially</strong></td><td>Yes</td></tr>
    <tr><td>Delete the page entirely</td><td>No, for that page</td><td>Yes</td></tr>
    <tr><td>Rebuild from pixels (this tool)</td><td>No</td><td>No</td></tr>
  </tbody>
</table>

<h2>How to use it</h2>
<ol>
  <li>Open the PDF. The first page appears on screen.</li>
  <li>Drag across anything sensitive. Boxes can overlap; draw as many as you need.</li>
  <li>Click a box to remove it if you misjudged the edge.</li>
  <li>Move through the document with Previous and Next. Boxes on other pages are remembered.</li>
  <li>Click <strong>Redact and rebuild</strong>, then check the result before sending it.</li>
</ol>
<p>Draw generously. A box that clips the top of a line of text can leave the ascenders readable, and a partial word is often enough to guess the whole one.</p>

<h2>Common questions</h2>
${faqBlock(redactFaq)}

<h2>Other tools</h2>
<div class="grid">
  <a href="delete-pages-from-pdf.html"><strong>Delete pages</strong><small>When the whole page should go, not part of it.</small></a>
  <a href="index.html"><strong>Compress a PDF</strong><small>Hit an exact size after redacting.</small></a>
  <a href="tools.html"><strong>All tools</strong><small>Everything on this site.</small></a>
</div>
`
});

/* ---- unlock ---- */

const unlockFaq = [
  ['Can this open a PDF if I do not know the password?',
   'No, and it never will. You supply the password; the tool uses it to open the file exactly as any reader would. There is no cracking, no guessing and no recovery here. A document you cannot already open stays shut.'],
  ['Then what is it for?',
   'Two things. Removing an open-password from a file you legitimately have the password for, so you stop typing it every time. And clearing the other kind of lock - the restriction that lets a file open but refuses printing or copying - which does not need a password at all.'],
  ['Why does the text stop being selectable?',
   'Because of how the file is rebuilt. The library this site uses can read an encrypted PDF but cannot write a decrypted one, so the tool renders the pages and assembles a new document from the images. That produces a genuinely unlocked file, at the cost of the text layer. If your document is a scan, it was already images and nothing is lost.'],
  ['My PDF opens fine but will not let me print. Will this help?',
   'Yes, and this is the easier case. That is an owner restriction rather than a password, so no password is needed - just open the file here and rebuild it. The restriction is a flag that readers agree to honour, and it does not survive.'],
  ['Is my file uploaded?',
   'No. The password is used in your browser and never sent anywhere, because there is nowhere for it to be sent.']
];

pages.push({
  slug: 'unlock-pdf.html',
  title: `Remove a PDF Password You Already Know — No Upload | ${NAME}`,
  desc: 'Remove the password or printing restriction from a PDF you can already open. Runs in your browser, nothing is uploaded. No password cracking.',
  h1: 'Remove a PDF password',
  faq: unlockFaq,
  scripts: [PDFLIB_CDN, 'js/thumbs.js', 'js/raster.js', 'js/unlock.js'],
  body: `
<h1>Remove a PDF password</h1>
<p class="lede">For a file you can already open. Type the password once here and get a copy that does not ask again &mdash; without uploading anything.</p>

<div class="privacy-badge">&#128274; Your file and your password never leave this device</div>

<div class="note"><strong>This tool does not crack passwords.</strong> You have to know the password already. If you do not, nothing here will help, and that is deliberate.</div>

<div class="tool">
  <label class="drop" id="drop" for="file">
      <strong>Choose a PDF or drop it here</strong>
    <small>Nothing is uploaded &mdash; the password is used in your browser</small>
      <input type="file" id="file" accept="application/pdf,.pdf" class="vh">
    </label>

  <div class="controls" id="controls">
    <p class="note" id="openNote" style="display:none;margin-top:0"></p>

    <div id="pwWrap" style="display:none">
      <div class="row">
        <div class="field">
          <label for="pw">Password</label>
          <input type="password" id="pw" autocomplete="off" placeholder="The password you already have">
        </div>
        <div><button class="btn ghost" id="pwGo" type="button">Unlock</button></div>
      </div>
      <p class="hint" id="pwNote"></p>
    </div>

    <div class="row">
      <div><button class="btn" id="go" disabled>Remove the password</button></div>
    </div>
    <div class="status" id="status" role="status" aria-live="polite"></div>
    <div class="result" id="result">
      <div class="big" id="rBig"></div>
      <div class="meta" id="rMeta"></div>
      <button class="btn" id="dl">Download PDF</button>
    </div>
  </div>
</div>

<h2>The two kinds of lock</h2>
<p>PDF has two separate mechanisms and they behave completely differently, which is why the same question gets contradictory answers online.</p>
<table>
  <thead><tr><th></th><th>User password</th><th>Owner password</th></tr></thead>
  <tbody>
    <tr><td>Also called</td><td>Open password</td><td>Permissions, restrictions</td></tr>
    <tr><td>Can you open the file?</td><td>Not without the password</td><td>Yes, normally</td></tr>
    <tr><td>What it blocks</td><td>Everything</td><td>Printing, copying, editing</td></tr>
    <tr><td>How strong is it?</td><td>Real encryption</td><td>A flag readers agree to respect</td></tr>
    <tr><td>Needed here?</td><td>Yes, type it in</td><td>No &mdash; just open the file</td></tr>
  </tbody>
</table>
<p>The second row explains a great deal of frustration. An owner password is not security in any meaningful sense: the file is not encrypted against you, it simply carries a note asking software to refuse. Most readers comply. Rebuilding the document leaves the note behind.</p>

<div class="note"><strong>The trade-off, stated plainly.</strong> The output is rebuilt from rendered pages, so text in the new file is part of the image and is no longer selectable. This is the same trade the compressor makes in Target Size mode. For a scanned document it costs nothing; for a text document it is a real loss.</div>

<h2>When you should not use this</h2>
<p>If the document is not yours and the password was not given to you, do not. The restriction is there for a reason, and this page requires the password precisely so that it cannot be used to get around one.</p>

<h2>Common questions</h2>
${faqBlock(unlockFaq)}

<h2>Other tools</h2>
<div class="grid">
  <a href="index.html"><strong>Compress a PDF</strong><small>Hit an exact size after unlocking.</small></a>
  <a href="ocr-pdf.html"><strong>OCR a scan</strong><small>Put a searchable text layer back on an image-only PDF.</small></a>
  <a href="tools.html"><strong>All tools</strong><small>Everything on this site.</small></a>
</div>
`
});

/* ---- flatten ---- */

const flattenFaq = [
  ['What does flattening actually change?',
   'A filled form stores its answers as separate interactive objects sitting on top of the page. Flattening draws those answers into the page itself and deletes the objects. The document looks identical and reads identically - but the answers are now part of the page rather than something a later viewer can edit or accidentally clear.'],
  ['Is it lossless?',
   'Yes. Nothing is rendered or re-encoded. Text stays selectable, images keep their resolution, and the file usually gets slightly smaller because the form machinery is gone.'],
  ['Can it be undone?',
   'No. That is the point. Keep your original if you may need to change the answers later.'],
  ['Why does my form print blank, or lose its answers when emailed?',
   'This is the problem flattening solves. Some readers - particularly built-in browser and mobile viewers - do not reliably render or preserve form field values. Flattened answers are ordinary page content and print everywhere.'],
  ['What about comments and highlights?',
   'Those are annotations rather than form fields, and the checkbox above removes them outright rather than drawing them in. Use it when you want a clean copy for sending; leave it off if the markup should stay.'],
  ['Is my file uploaded?',
   'No. Everything happens in your browser.']
];

pages.push({
  slug: 'flatten-pdf.html',
  title: `Flatten a PDF — Make Form Answers Permanent | ${NAME}`,
  desc: 'Flatten a PDF so filled form fields become part of the page and cannot be edited or lost. Lossless, runs entirely in your browser, nothing is uploaded. Free, no signup.',
  h1: 'Flatten a PDF',
  faq: flattenFaq,
  scripts: [PDFLIB_CDN, 'js/pageops.js', 'js/flatten.js'],
  body: `
<h1>Flatten a PDF</h1>
<p class="lede">Turn filled-in form answers into part of the page, so nothing can edit them, clear them or fail to print them. Lossless, and nothing is uploaded.</p>

<div class="privacy-badge">&#128274; Your file never leaves this device</div>

<div class="tool">
  <label class="drop" id="drop" for="file">
      <strong>Choose a PDF or drop it here</strong>
    <small>Nothing is uploaded &mdash; flattening happens in your browser</small>
      <input type="file" id="file" accept="application/pdf,.pdf" class="vh">
    </label>

  <div class="controls" id="controls">
    <p class="note" id="info" style="margin-top:0"></p>
    <p class="hint" id="flatInfo"></p>
    <div class="checkrow">
      <input type="checkbox" id="dropAnnots">
      <label for="dropAnnots">Also remove comments, highlights and other markup</label>
    </div>
    <div class="row" style="margin-top:14px">
      <div><button class="btn" id="go">Flatten</button></div>
    </div>
    <div class="status" id="status" role="status" aria-live="polite"></div>
    <div class="result" id="result">
      <div class="big" id="rBig"></div>
      <div class="meta" id="rMeta"></div>
      <button class="btn" id="dl">Download PDF</button>
    </div>
  </div>
</div>

<h2>Why a filled form is not a finished document</h2>
<p>When you type into a fillable PDF, the text you typed is not on the page. It lives in a form field object that floats above the page and is drawn by the reader at display time. The page underneath is still blank where your answer appears.</p>
<p>Most of the time nobody notices. The problems arrive at the edges:</p>
<ul>
  <li><strong>It prints blank.</strong> Some readers print the page and not the fields, particularly older or embedded viewers.</li>
  <li><strong>The answers vanish.</strong> Open the file in a viewer that does not save field values, save it, and the answers are gone.</li>
  <li><strong>Anyone can change them.</strong> A recipient can edit your figures and the document will look untouched.</li>
  <li><strong>It uploads differently than it looks.</strong> A portal that extracts page content rather than field values reads an empty form.</li>
</ul>
<p>Flattening removes the whole category of problem: after it, what the page shows is what the page contains.</p>

<div class="note"><strong>This is permanent, and it is meant to be.</strong> Once flattened the answers cannot be edited back into fields. Keep the original if the document may need changing.</div>

<h2>Flattened or not</h2>
<table>
  <thead><tr><th></th><th>Left as a form</th><th>Flattened</th></tr></thead>
  <tbody>
    <tr><td>Answers editable later</td><td>Yes</td><td>No</td></tr>
    <tr><td>Prints reliably everywhere</td><td>Not always</td><td>Yes</td></tr>
    <tr><td>Survives being re-saved</td><td>Not always</td><td>Yes</td></tr>
    <tr><td>Text still selectable</td><td>Yes</td><td>Yes</td></tr>
    <tr><td>File size</td><td>Slightly larger</td><td>Slightly smaller</td></tr>
  </tbody>
</table>

<h2>Common questions</h2>
${faqBlock(flattenFaq)}

<h2>Other tools</h2>
<div class="grid">
  <a href="fill-pdf-form.html"><strong>Fill in a form</strong><small>Type the answers first, then flatten them here.</small></a>
  <a href="sign-pdf.html"><strong>Sign a PDF</strong><small>Place a signature before flattening.</small></a>
  <a href="tools.html"><strong>All tools</strong><small>Everything on this site.</small></a>
</div>
`
});

/* ---- pdf to text ---- */

const toTextFaq = [
  ['Will the formatting survive?',
   'No, and nothing that extracts text from a PDF can promise otherwise. A PDF stores glyphs at coordinates, not paragraphs, so line and paragraph structure has to be inferred from position. Ordinary prose comes out well. Multi-column layouts, tables and sidebars come out in the order the file stores them, which is not always the order you read them.'],
  ['What does the Markdown option add?',
   'One inference: a line set in noticeably larger type than the body text, and short enough to be a title rather than a sentence, is written as a heading. It is right often enough to be useful on reports and specifications, and wrong often enough that you should read the result before trusting it.'],
  ['It returned nothing. Why?',
   'The PDF almost certainly has no text in it. A scan or a photographed document is a picture of words, not words - there is nothing to extract. Run it through the OCR tool first, which adds a real text layer, then come back here.'],
  ['Is this the same as PDF to Word?',
   'No. This gives you the words. PDF to Word tries to reconstruct an editable document with its layout intact, which needs analysis that is not practical in a browser tab - any site offering it is uploading your file to a server.'],
  ['Is my file uploaded?',
   'No. The text is extracted in your browser and the result never leaves it.']
];

pages.push({
  slug: 'pdf-to-text.html',
  title: `PDF to Text or Markdown — Free, No Upload | ${NAME}`,
  desc: 'Extract the text from a PDF as plain text or Markdown. Copy it or download it. Runs entirely in your browser, nothing is uploaded. Free, no signup.',
  h1: 'PDF to text',
  faq: toTextFaq,
  scripts: ['js/thumbs.js', 'js/pdf2text.js'],
  body: `
<h1>PDF to text or Markdown</h1>
<p class="lede">Pull the words out of a PDF and take them away as plain text or Markdown. Nothing is uploaded.</p>

<div class="privacy-badge">&#128274; Your file never leaves this device</div>

<div class="tool">
  <label class="drop" id="drop" for="file">
      <strong>Choose a PDF or drop it here</strong>
    <small>Nothing is uploaded &mdash; the text is read in your browser</small>
      <input type="file" id="file" accept="application/pdf,.pdf" class="vh">
    </label>

  <div class="controls" id="controls">
    <div class="row">
      <div class="field">
        <label for="fmt">Format</label>
        <select id="fmt">
          <option value="txt">Plain text &mdash; .txt</option>
          <option value="md">Markdown &mdash; .md, headings guessed</option>
        </select>
      </div>
    </div>
    <div class="status" id="status" role="status" aria-live="polite"></div>
    <div class="result" id="result">
      <div class="big" id="rBig"></div>
      <div class="meta" id="rMeta"></div>
      <button class="btn" id="dl">Download</button>
      <button class="btn ghostbtn" id="copy" type="button">Copy to clipboard</button>
    </div>
    <div class="preview" id="preview">
      <h4>The first part of what you will get</h4>
      <pre class="textpreview" id="previewText"></pre>
    </div>
  </div>
</div>

<div class="note" id="empty" style="display:none"><strong>There is no text in this PDF.</strong> It is almost certainly a scan &mdash; a picture of words rather than words. Run it through <a href="ocr-pdf.html">the OCR tool</a> first to add a real text layer, then come back here.</div>

<h2>What a PDF actually stores</h2>
<p>This explains every oddity in the output, so it is worth thirty seconds. A PDF page does not contain paragraphs, sentences or even lines. It contains instructions of the form <em>draw these glyphs at this position in this font</em>. That is all.</p>
<p>Everything else is reconstruction. Lines are recovered by grouping glyphs that share a vertical position. Paragraphs are guessed from the gaps. Reading order is assumed to follow the order the instructions appear in the file, which is usually but not always the order a human reads.</p>
<p>So: a novel or a report extracts cleanly. A two-column academic paper may interleave the columns. A table becomes a run of cell contents with the grid gone, because the grid was lines drawn separately from the numbers.</p>

<h2>When this is the right tool</h2>
<ul>
  <li>Quoting from a document without retyping it.</li>
  <li>Getting a transcript into a notes app, an editor or a chat window.</li>
  <li>Counting words, or searching text a viewer will not search.</li>
  <li>Feeding a document into something that wants plain text.</li>
</ul>
<p>It is not the right tool if you need the layout back. Nothing that runs in a browser tab will give you that.</p>

<h2>Common questions</h2>
${faqBlock(toTextFaq)}

<h2>Other tools</h2>
<div class="grid">
  <a href="ocr-pdf.html"><strong>OCR a scan</strong><small>Add a text layer to an image-only PDF, then extract it here.</small></a>
  <a href="compare-pdf.html"><strong>Compare two PDFs</strong><small>See which words changed between versions.</small></a>
  <a href="tools.html"><strong>All tools</strong><small>Everything on this site.</small></a>
</div>
`
});

/* ---- extract pages ----
   The same engine as split-pdf.html, which opens in range mode by default.
   A separate page because "extract pages" and "split" are different searches
   made by people wanting the same operation, and the split page cannot rank
   for both from one title. */

const extractPagesFaq = [
  ['How is this different from splitting?',
   'It is the same operation asked from the other end. Extracting keeps the pages you name and discards the rest, in one file. Splitting can also break a document into several files at a fixed interval. Both are on this page; the method box switches between them.'],
  ['Does it reduce quality?',
   'No. The pages you keep are copied across as complete objects. Nothing is re-encoded, text stays selectable and images keep their resolution.'],
  ['Can I keep pages in a different order?',
   'Yes. The pages come out in the order you write them, so 5, 1-2 gives you page five followed by pages one and two. Use the page organiser if you want to rearrange visually.'],
  ['Will the file get smaller?',
   'Usually, roughly in proportion to what you dropped - though not always, because a PDF shares resources such as fonts and images between pages. Run the result through the compressor if you need a specific size.'],
  ['Is my file uploaded?',
   'No. Everything happens in your browser.']
];

pages.push({
  slug: 'extract-pages-from-pdf.html',
  title: `Extract Pages from a PDF — Free, No Upload | ${NAME}`,
  desc: 'Pull specific pages out of a PDF into a new file. Lossless, keeps quality, runs entirely in your browser with nothing uploaded. Free, no signup, no watermark.',
  h1: 'Extract pages from a PDF',
  faq: extractPagesFaq,
  scripts: [PDFLIB_CDN, 'js/thumbs.js', 'js/split.js'],
  body: `
<h1>Extract pages from a PDF</h1>
<p class="lede">Name the pages you want and get them as one new file. Quality is untouched, and nothing is uploaded.</p>

<div class="privacy-badge">&#128274; Your file never leaves this device</div>

<div class="tool">
  <label class="drop" id="drop" for="file">
      <strong>Choose a PDF or drop it here</strong>
    <small>Nothing is uploaded &mdash; pages are extracted in your browser</small>
      <input type="file" id="file" accept="application/pdf,.pdf" class="vh">
    </label>

  <div class="controls" id="controls">
    <p class="note" id="info" style="margin-top:0"></p>
    <p class="hint" id="thumbHint" style="display:none"></p>
    <div class="thumbs" id="thumbs"></div>
    <div class="row">
      <div class="field">
        <label for="mode">Method</label>
        <select id="mode">
          <option value="range">Extract pages &mdash; one file</option>
          <option value="chunks">Split into files &mdash; several</option>
        </select>
      </div>
      <div class="field" id="rangeField">
        <label for="range">Pages to keep</label>
        <input type="text" id="range" placeholder="1-3, 5, 8-10">
      </div>
      <div class="field" id="chunkField" style="display:none">
        <label for="chunk">Pages per file</label>
        <input type="number" id="chunk" min="1" value="1">
      </div>
      <div><button class="btn" id="go">Extract</button></div>
    </div>

    <div class="bar" id="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i id="barFill"></i></div>
    <div class="status" id="status" role="status" aria-live="polite"></div>
    <div class="outputs" id="outputs"></div>
  </div>
</div>

<h2>How to write the range</h2>
<table>
  <thead><tr><th>You want</th><th>Type</th></tr></thead>
  <tbody>
    <tr><td>Just page 3</td><td><code>3</code></td></tr>
    <tr><td>Pages 5 to 9</td><td><code>5-9</code></td></tr>
    <tr><td>Page 1 and pages 8 to 10</td><td><code>1, 8-10</code></td></tr>
    <tr><td>Page 5 first, then pages 1 and 2</td><td><code>5, 1-2</code></td></tr>
  </tbody>
</table>
<p>Click the page previews instead if you would rather not count: the range box fills itself in as you click, and the two stay in step.</p>

<h2>Why extract rather than delete</h2>
<p>The two tools reach the same file by opposite routes, and the right one is whichever needs less typing. Pulling three pages out of a ninety-page report is an extraction. Removing the blank versos from a ten-page duplex scan is a deletion. Doing either the wrong way round means listing far more numbers than you need to, and every extra number is a chance to get one wrong.</p>

<h2>Common questions</h2>
${faqBlock(extractPagesFaq)}

<h2>Other tools</h2>
<div class="grid">
  <a href="split-pdf.html"><strong>Split a PDF</strong><small>Break one document into several files at a fixed interval.</small></a>
  <a href="delete-pages-from-pdf.html"><strong>Delete pages</strong><small>Say which pages to remove instead of which to keep.</small></a>
  <a href="organise-pdf.html"><strong>Organise pages</strong><small>Reorder and rotate with every page on screen.</small></a>
</div>
`
});

/* ---- legal / trust pages ---- */

pages.push({
  slug: 'about.html',
  title: `About ${NAME}`,
  desc: `Who runs ${NAME}, why it processes files in the browser, and how the site is funded.`,
  h1: `About ${NAME}`,
  body: `
<h1>About ${NAME}</h1>

<h2>What this site is</h2>
<p>${NAME} is a free tool for compressing PDF files to a specific size. It exists because the common case &mdash; "this form will not accept anything over 200 KB" &mdash; is handled badly by most compressors, which offer vague quality sliders instead of the one number you actually care about.</p>

<h2>Why it runs in your browser</h2>
<p>Every other compressor uploads your document to a server, processes it there, and asks you to trust a privacy policy about what happens next. That is a genuinely bad deal when the document is a passport scan, a bank statement or a signed contract.</p>
<p>${NAME} does the work on your own device in plain JavaScript. There is no upload endpoint. There is no storage bucket. There is no server that could be breached, subpoenaed or sold, because there is no server in the path at all.</p>
<p>You do not have to take that on faith. Load the page, disconnect from the internet, and compress a file. It will still work &mdash; from your second visit onwards, when the service worker has cached the two libraries the tools need. On a very first visit those still have to be fetched, so try it once online first.</p>

<h2>How the site is funded</h2>
<p>Hosting is paid for by advertising. The ads are clearly marked, kept away from the tool itself, and never disguised as download buttons &mdash; a pattern common on free file-tool sites that this one deliberately avoids.</p>
<p><strong>The ads do track you, and the tool does not.</strong> Those are two different claims and it would be dishonest to let the first hide behind the second. Your documents are never transmitted &mdash; that is enforced by there being no upload endpoint at all. But the advertising is served by Google, which sets cookies and profiles visitors the way it does everywhere else. If that matters to you, an ad blocker will not stop any tool on this site from working, because nothing here depends on the ads loading.</p>
<p>There is no premium tier, no account, no file size cap and no watermark, because none of those would make the tool better; they would just make it worse in a way that pressures you to pay.</p>

<h2>Limitations, stated plainly</h2>
<ul>
  <li><strong>Target Size mode flattens text.</strong> Guaranteeing a hard byte limit requires converting pages to images. Text stops being selectable. Lossless mode avoids this but cannot promise a specific size.</li>
  <li><strong>No OCR.</strong> The tool does not add a searchable text layer to scans.</li>
  <li><strong>Encrypted PDFs are not handled.</strong> Remove the password yourself first; bypassing document encryption is deliberately out of scope.</li>
  <li><strong>Long documents depend on your device.</strong> There is no server limit. What costs memory is page count, not megabytes &mdash; every page is held as an image while it is worked on &mdash; so a 300-page scan can exhaust a phone while a 100 MB single-page poster is trivial.</li>
</ul>

<h2>Contact</h2>
<p>Corrections, bug reports and feature requests are welcome via the <a href="contact.html">contact page</a>.</p>
`
});

pages.push({
  slug: 'contact.html',
  title: `Contact ${NAME}`,
  desc: `How to reach ${NAME} with a bug report, correction or question.`,
  h1: 'Contact',
  body: `
<h1>Contact</h1>
<p class="lede">Bug reports and corrections are genuinely useful. Vague complaints less so &mdash; the more specific you are, the more likely it gets fixed.</p>

<div class="card">
  <h3 style="margin-top:0">Email</h3>
  <p style="margin-bottom:0"><strong><a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></strong></p>
</div>

<h2>If you are reporting a problem</h2>
<p>Please include:</p>
<ul>
  <li>Your browser and version, and whether you are on a phone or a computer.</li>
  <li>The approximate size and page count of the PDF.</li>
  <li>Which mode you used, and what target size you set.</li>
  <li>What happened, and what you expected instead.</li>
</ul>
<p><strong>Please do not attach the PDF itself.</strong> It is very likely to contain personal information, and there is no reason for anyone else to hold a copy of it. A description of the problem is almost always enough.</p>

<h2>What this site cannot help with</h2>
<ul>
  <li><strong>Recovering a lost PDF password.</strong> Not supported, and not something that will be added. <a href="unlock-pdf.html">Removing</a> a password you already know is a different question, and that one the site does answer.</li>
  <li><strong>Recovering an original from a compressed file.</strong> Compression discards data permanently. Keep your originals.</li>
  <li><strong>Why a specific portal rejected your upload.</strong> Only that portal's operators can answer this; their stated limits are often incomplete.</li>
</ul>
`
});

pages.push({
  slug: 'privacy.html',
  title: `Privacy Policy — ${NAME}`,
  desc: `How ${NAME} handles your files and data. Files are processed in your browser and never uploaded.`,
  h1: 'Privacy Policy',
  body: `
<h1>Privacy Policy</h1>
<p class="lede">Last updated: <strong>${POLICY_UPDATED}</strong></p>

<div class="note"><strong>The short version:</strong> your PDF files are never uploaded to us, because there is no server that receives them. Advertising and analytics do involve third parties, and that is described in full below.</div>

<h2>1. Your files</h2>
<p>PDF files you open in this tool are processed entirely within your web browser, on your own device. They are not transmitted to us or to anyone else. We do not receive them, store them, examine them or retain any copy, because no mechanism exists by which they could reach us.</p>
<p>Files you load are held in your browser's memory for the duration of your visit and discarded when you close or reload the page.</p>

<h2>2. Information collected automatically</h2>
<p>Like nearly all websites, this site is served by a hosting provider that records standard technical information for each request, including IP address, browser type, referring page and time of access. This is used for security and to keep the site running.</p>

<h2>3. Cookies and advertising</h2>
<p>This site displays advertising supplied by third parties, including Google. Third-party vendors, including Google, use cookies to serve ads based on your prior visits to this and other websites.</p>
<p>Google's use of advertising cookies enables it and its partners to serve ads to you based on your visit to this site and other sites on the internet. You can opt out of personalised advertising by visiting <a href="https://www.google.com/settings/ads" rel="nofollow noopener" target="_blank">Google Ads Settings</a>, or opt out of third-party vendor cookies at <a href="https://www.aboutads.info/choices/" rel="nofollow noopener" target="_blank">aboutads.info</a>.</p>
<p>Third-party vendors and ad networks may also serve ads on this site and may themselves set cookies. We do not control these cookies and cannot access the data they collect.</p>

<h2>4. Analytics</h2>
<p>This site uses Cloudflare Web Analytics to count visits and see which pages are useful. It is cookieless, does not fingerprint you, and does not follow you to other websites. It records the page address, the referring site, and general details such as browser, device type and country.</p>
<p>Separately, the compression tools keep a few anonymous counters about how they are used &mdash; which target sizes are asked for, whether the target was reached, and roughly how long a job took. These are rounded into ranges before they are stored, so a counter reads like &ldquo;a 101&ndash;200&nbsp;KB target, reached, 2&ndash;5 seconds&rdquo;. Nothing derived from your file is included: not its name, not its contents, not its exact size.</p>
<p><strong>These counters do not leave your device.</strong> They are kept in your browser's local storage and are not transmitted anywhere. If that ever changes, this page will say so before it does. You can switch them off entirely by enabling &ldquo;Do Not Track&rdquo; in your browser, and clearing your browsing data for this site erases them.</p>

<h2>5. Visitors in the European Economic Area and United Kingdom</h2>
<p>If you are located in the European Economic Area, the United Kingdom or Switzerland, a consent message is shown before any non-essential cookies are set, and your choice is honoured. That message is provided by Google&rsquo;s certified consent management platform, and offers three options: consent, do not consent, or manage individual purposes. You can reopen it and change or withdraw your choice at any time through the consent tool itself; clearing this site&rsquo;s data in your browser also resets it.</p>
<p>You have the right to request access to, correction of, or deletion of personal data held about you, and to lodge a complaint with your local data protection authority. Requests may be sent to the address on the <a href="contact.html">contact page</a>. Note that because your files never reach us, we hold no copies of your documents to disclose or delete.</p>

<h2>6. Visitors in California</h2>
<p>We do not sell personal information as defined by the California Consumer Privacy Act. You may request disclosure of the categories of personal information collected about you via the contact page.</p>

<h2>7. Children</h2>
<p>This site is not directed at children under 13 and we do not knowingly collect personal information from them.</p>

<h2>8. Changes</h2>
<p>This policy may be updated. Material changes will be reflected in the date at the top of this page.</p>

<h2>9. Contact</h2>
<p>Questions about this policy can be sent via the <a href="contact.html">contact page</a>.</p>
`
});

pages.push({
  slug: 'terms.html',
  title: `Terms of Use — ${NAME}`,
  desc: `The terms under which ${NAME} is provided.`,
  h1: 'Terms of Use',
  body: `
<h1>Terms of Use</h1>
<p class="lede">Last updated: <strong>${POLICY_UPDATED}</strong></p>

<h2>1. Acceptance</h2>
<p>By using this site you agree to these terms. If you do not agree, please do not use it.</p>

<h2>2. The service</h2>
<p>This site provides a free tool that compresses PDF files within your web browser. It is provided as-is, without any guarantee of availability, accuracy or fitness for a particular purpose.</p>

<h2>3. Your responsibility for your files</h2>
<p>You are responsible for the documents you process and for holding the rights to do so. Because compression permanently discards data, <strong>you should always retain your original file</strong>. A compressed file cannot be restored to its original quality.</p>
<p>You are responsible for verifying that a compressed document remains legible and acceptable for its intended purpose before you rely on it or submit it anywhere.</p>

<h2>4. Acceptable use</h2>
<p>Do not use this site to process material you have no right to process, to attempt to circumvent document security or encryption, or to interfere with the operation of the site or its infrastructure.</p>

<h2>5. No warranty</h2>
<p>The service is provided without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose and non-infringement. We do not warrant that the service will be uninterrupted, error-free, or that output will meet any particular size or quality requirement.</p>

<h2>6. Limitation of liability</h2>
<p>To the fullest extent permitted by law, we are not liable for any indirect, incidental, special or consequential damages, or for loss of data, arising from your use of this site. This includes any consequence of a document being rejected, or of a compressed document proving illegible.</p>
<p>Nothing in these terms excludes liability that cannot lawfully be excluded.</p>

<h2>7. Third-party content</h2>
<p>This site displays third-party advertising and links to external sites. We are not responsible for the content, products or practices of third parties.</p>

<h2>8. Changes</h2>
<p>These terms may be updated at any time. Continued use after a change constitutes acceptance of the revised terms.</p>

<h2>9. Contact</h2>
<p>Questions may be sent via the <a href="contact.html">contact page</a>.</p>
`
});

pages.push({
  slug: '404.html',
  title: `Page not found — ${NAME}`,
  desc: 'That page does not exist.',
  h1: 'Page not found',
  noindex: true,
  breadcrumb: false,
  body: `
<h1>Page not found</h1>
<p class="lede">That address does not exist on this site. It may have been renamed, or the link that brought you here may be wrong.</p>
<p><a class="btn" href="index.html">Go to the compressor</a></p>

<h2>Popular pages</h2>
<div class="grid">
  <a href="index.html"><strong>PDF compressor</strong><small>Compress to an exact size, in your browser.</small></a>
  <a href="compress-pdf-to-200kb.html"><strong>Compress to 200 KB</strong><small>The most common upload limit.</small></a>
  <a href="compress-pdf-for-email.html"><strong>Compress for email</strong><small>Get under the 25 MB ceiling.</small></a>
  <a href="compress-scanned-pdf.html"><strong>Compress a scan</strong><small>Where the biggest savings are.</small></a>
</div>
`
});

pages.push({
  slug: 'offline.html',
  title: `Offline — ${NAME}`,
  desc: 'This page is not available offline.',
  h1: 'Not available offline',
  noindex: true,
  breadcrumb: false,
  body: `
<h1>Not available offline</h1>
<p class="lede">You are offline and this page was not stored on your device. Nothing is wrong with the site &mdash; it simply has not been opened here before.</p>
<p>Tools you have already used keep working without a connection, because the file never leaves your device in the first place. Try one of these:</p>

<h2>Try a tool you have used before</h2>
<div class="grid">
  <a href="index.html"><strong>PDF compressor</strong><small>The front page, and the most likely one to be stored.</small></a>
  <a href="tools.html"><strong>All tools</strong><small>The full list, if it has been opened here.</small></a>
</div>

<p class="hint">Reconnect and reload to get the page you asked for.</p>
`
});

/* ---------------------------------------------------------------- write */


const root = __dirname;

/* The compression worker is fetched by `new Worker(...)` rather than a script
   tag, so nothing was cache-busting it: Cloudflare serves js/ with a four-hour
   max-age, and returning visitors kept running the previous engine for hours
   after a deploy. Stamp the version into compress-core.js, which also changes
   that file's own hash so the two never drift apart. Idempotent, so repeated
   builds are stable. */
{
  const corePath = path.join(root, 'js', 'compress-core.js');
  const stamped = ver('js/compress-worker.js');
  const core = fs.readFileSync(corePath, 'utf8');
  const next = core.replace(/js\/compress-worker\.js(\?v=[a-f0-9]+)?/g, stamped);
  if (next !== core) fs.writeFileSync(corePath, next, 'utf8');
  console.log('  stamped worker url: ' + stamped);
}

let written = 0;

/* Wrap every table in a scroll container. A comparison table that grows a
   long cell would otherwise widen the whole page and make it scroll sideways
   on a phone - the failure the header nav just caused. Doing it at build time
   means new tables get it automatically instead of relying on whoever adds
   the next one remembering. Idempotent, so index.html can be rewritten in
   place on every build. */
function wrapTables(html) {
  return html
    .replace(/<div class="tablewrap">\s*(<table>[\s\S]*?<\/table>)\s*<\/div>/g, '$1')
    .replace(/<table>([\s\S]*?)<\/table>/g,
             '<div class="tablewrap"><table>$1</table></div>');
}

for (const p of pages) {
  fs.writeFileSync(path.join(root, p.slug), head(p) + wrapTables(p.body) + foot(p), 'utf8');
  written++;
  console.log('  wrote ' + p.slug);
}

/* index.html is hand-written rather than generated, but its local asset
   references still need the cache-busting version stamp, so rewrite them in
   place. Matches an existing ?v= stamp too, so rebuilds stay idempotent. */
{
  const p = path.join(root, 'index.html');
  let html = fs.readFileSync(p, 'utf8');
  let changed = 0;
  for (const asset of ['css/style.css', 'js/pdfjs-raf.js', 'js/metrics.js', 'js/compress-core.js', 'js/app.js']) {
    const re = new RegExp(asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\?v=[a-f0-9]+)?', 'g');
    const next = html.replace(re, () => { changed++; return ver(asset); });
    html = next;
  }
  html = wrapTables(html);

  // AdSense loader: insert once, after the stylesheet, if not already there
  let ads = 'present';
  if (html.indexOf('adsbygoogle.js?client=') === -1) {
    html = html.replace(/(<link rel="stylesheet"[^>]*>)/, '$1\n' + ADSENSE);
    ads = 'inserted';
  }
  fs.writeFileSync(p, html, 'utf8');
  console.log('  stamped index.html (' + changed + ' asset refs, adsense ' + ads + ')');
}

/* Service worker. Two jobs: make "disconnect and it still works" actually true
   by precaching the CDN libraries, and make repeat visits instant. The cache
   name embeds a hash of the assets, so a deploy invalidates it automatically
   rather than needing a version bumped by hand. */
{
  const assets = ['css/style.css', 'js/compress-core.js', 'js/compress-worker.js', 'js/app.js', 'js/pageops.js'];
  const stamp = crypto.createHash('sha1')
    .update(assets.map(a => {
      try { return fs.readFileSync(path.join(root, a)); } catch (e) { return ''; }
    }).join('|'))
    .digest('hex').slice(0, 10);

  /* Shell only. Precaching the four vendor libraries meant every first visit
     paid for 2 MB - about 550 KB over the wire - before the visitor had
     pressed anything, including someone who landed on a landing page from
     search and left. On a phone-first audience often on metered data that is
     a real cost. The runtime cache-first rule below still stores them on
     first actual tool use, so offline works for anyone who has used a tool,
     which is the case the About page actually claims. */
  const precache = [
    './', './tools.html', './offline.html',
    './' + ver('css/style.css'),
    './' + ver('js/pdfjs-raf.js'),
    './' + ver('js/metrics.js'),
    './' + ver('js/compress-core.js'),
    './' + ver('js/app.js'),
    './' + ver('js/compress-worker.js')
  ];

  const sw = `/* SizeMyPDF service worker - generated by build.js, do not edit. */
const CACHE = 'sizemypdf-${stamp}';
const PRECACHE = ${JSON.stringify(precache, null, 2)};

self.addEventListener('install', e => {
  // Individually, so one failed fetch cannot abort the whole install.
  e.waitUntil(caches.open(CACHE).then(c =>
    Promise.all(PRECACHE.map(u => c.add(u).catch(() => null)))
  ).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never touch advertising, analytics or consent traffic - caching it would
  // both break it and misrepresent what the visitor actually loaded.
  if (/googlesyndication|doubleclick|adtrafficquality|googletagservices|cloudflareinsights/
      .test(url.hostname)) return;

  if (url.origin !== self.location.origin) return;
  const isLib = url.pathname.indexOf('/vendor/') !== -1;

  // vendor/ holds version-pinned library builds that only change when the file
  // itself is replaced, so cache-first is safe and is what makes offline work.
  // Pages go network-first so content stays fresh.
  // Only ever store a response that actually succeeded. Without this a 404 or
  // a 500 served during a deploy is cached and then handed back offline
  // indefinitely, so the visitor sees a broken page for a file that is fine.
  function keep(res) {
    if (res && res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
    }
    return res;
  }

  if (isLib) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(keep)));
    return;
  }

  e.respondWith(fetch(req).then(keep).catch(() => caches.match(req).then(hit => {
    if (hit) return hit;
    // Falling back to the homepage would silently hand someone the compressor
    // when they asked for Merge, and they would assume they misclicked. Say
    // what happened instead.
    if (req.mode === 'navigate') return caches.match('./offline.html');
    return undefined;
  })));
});
`;
  fs.writeFileSync(path.join(root, 'sw.js'), sw, 'utf8');
  console.log('  wrote sw.js (cache sizemypdf-' + stamp + ')');
}

/* sitemap - index first, then generated pages, excluding noindex */
const urls = ['']
  .concat(pages.filter(p => !p.noindex).map(p => p.slug));
const today = new Date().toISOString().slice(0, 10);

fs.writeFileSync(path.join(root, 'sitemap.xml'),
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  urls.map(u =>
    '  <url>\n' +
    `    <loc>${SITE}/${u}</loc>\n` +
    `    <lastmod>${today}</lastmod>\n` +
    `    <priority>${u === '' ? '1.0' : '0.8'}</priority>\n` +
    '  </url>').join('\n') +
  '\n</urlset>\n', 'utf8');
console.log('  wrote sitemap.xml (' + urls.length + ' urls)');

/* Orphan check.

   index.html is hand written while every other page is generated here, so the
   two drift: a tool gets added, the generated page and the sitemap pick it up,
   and the homepage grid quietly does not. That is not cosmetic. The homepage
   is the strongest internal link on the site, and the pages that never got a
   tile were measurably the ones Google had not indexed - three of them had no
   inbound link from anywhere at all and existed only in the sitemap.

   Cheap to check, so check it on every build. */
const home = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const linked = new Set(
  [...home.matchAll(/href="([a-z0-9-]+\.html)"/g)].map(m => m[1]));

const orphans = pages
  .filter(pg => !pg.noindex)
  .map(pg => pg.slug)
  .filter(slug => slug && !linked.has(slug));

if (orphans.length) {
  console.error('\nERROR: ' + orphans.length +
    ' page(s) are in the sitemap but not linked from index.html:');
  orphans.forEach(o => console.error('  ' + o));
  console.error('\nAdd a tile for each on the homepage, or mark it noindex.');
  process.exitCode = 1;
} else {
  console.log('  orphan check: every page is linked from the homepage');
}

console.log('\nDone - ' + written + ' pages generated.');
