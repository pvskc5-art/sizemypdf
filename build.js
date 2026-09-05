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

/* Subresource Integrity for the CDN libraries. Dependabot cannot help here -
   these come from a CDN, not from npm - so pinning the exact bytes is the only
   thing standing between a compromised CDN and arbitrary code running against
   documents in a visitor's browser. Recompute if a version is ever bumped:
     curl -s <url> | openssl dgst -sha384 -binary | openssl base64 -A          */
const SRI = {
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js':
    'sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js':
    'sha384-weMABwrltA6jWR8DDe9Jp5blk+tZQh7ugpCsF3JwSA53WZM9/14PjS5LAJNHNjAI'
};

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
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="favicon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<link rel="manifest" href="site.webmanifest">
<meta name="theme-color" content="#2f6df6">
${(p.scripts || []).some(s => s.indexOf('cdnjs') === 0 || s.indexOf('https://cdnjs') === 0)
  ? '<link rel="preconnect" href="https://cdnjs.cloudflare.com" crossorigin>\n' : ''}<link rel="stylesheet" href="${ver('css/style.css')}">
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
      <a href="jpg-to-pdf.html">Images</a>
      <a href="about.html">About</a>
    </nav>
  </div>
</header>

<main class="wrap" id="main">
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
  return `<script src="${s.indexOf('http') === 0 ? s : ver(s)}"></script>`;
}).join('\n')}
<script>document.getElementById('yr').textContent=new Date().getFullYear()</script>
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

const TOOL_CTA = `
<div class="card" style="text-align:center;margin:26px 0">
  <p style="margin-bottom:14px"><strong>The compressor is on the front page.</strong> Set your target and go &mdash; nothing is uploaded.</p>
  <a class="btn" href="index.html">Open the compressor</a>
</div>`;

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
    body: `
<h1>Compress a PDF to ${t.kb} KB</h1>
<p class="lede">For ${t.who}. The compressor searches quality settings until your file fits under ${t.kb} KB &mdash; and it runs on your own device, so nothing is uploaded.</p>

<div class="privacy-badge">&#128274; Your file never leaves this device</div>
${TOOL_CTA}

<h2>What ${t.kb} KB actually means in practice</h2>
${t.extra}

<h2>How to do it</h2>
<ol>
  <li>Open the <a href="index.html">compressor on the front page</a> and choose your PDF.</li>
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
  body: `
<h1>Compress a PDF for email</h1>
<p class="lede">Attachment limits are lower than they look, because email inflates every file it carries. Here is what the real ceilings are and how to get under them.</p>

<div class="privacy-badge">&#128274; Your file never leaves this device</div>
${TOOL_CTA}

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
  body: `
<h1>Compress a scanned PDF</h1>
<p class="lede">Scans are where the real savings live &mdash; a 40 MB scanned document can often reach 300 KB and stay perfectly readable. Here is how far you can push it before quality genuinely suffers.</p>

<div class="privacy-badge">&#128274; Your file never leaves this device</div>
${TOOL_CTA}

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
  scripts: ['https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js', 'js/merge.js'],
  body: `
<h1>Merge PDF files</h1>
<p class="lede">Combine any number of PDFs into a single document, in whatever order you want. Nothing is uploaded and nothing is added to the output.</p>

<div class="privacy-badge">&#128274; Your files never leave this device</div>

<div class="tool">
  <div class="drop" id="drop">
    <strong>Choose PDFs or drop them here</strong>
    <small>Nothing is uploaded &mdash; merging happens in your browser</small>
  </div>
  <input type="file" id="file" accept="application/pdf,.pdf" multiple>

  <div class="controls" id="controls">
    <ul class="filelist" id="list"></ul>
    <button class="btn" id="go">Merge PDFs</button>

    <div class="bar" id="bar"><i id="barFill"></i></div>
    <div class="status" id="status"></div>

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
  scripts: ['https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js', 'js/split.js'],
  body: `
<h1>Split a PDF</h1>
<p class="lede">Pull out the pages you need, or break one document into several files. Quality is untouched, and nothing is uploaded.</p>

<div class="privacy-badge">&#128274; Your file never leaves this device</div>

<div class="tool">
  <div class="drop" id="drop">
    <strong>Choose a PDF or drop it here</strong>
    <small>Nothing is uploaded &mdash; splitting happens in your browser</small>
  </div>
  <input type="file" id="file" accept="application/pdf,.pdf">

  <div class="controls" id="controls">
    <p class="note" id="info" style="margin-top:0"></p>
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

    <div class="bar" id="bar"><i id="barFill"></i></div>
    <div class="status" id="status"></div>
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
  scripts: ['https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js', 'js/img2pdf.js'],
  body: `
<h1>Images to PDF</h1>
<p class="lede">Turn photos or scans into one PDF, in the order you choose. Nothing is uploaded &mdash; which matters, because the images people convert are usually documents.</p>

<div class="privacy-badge">&#128274; Your images never leave this device</div>

<div class="tool">
  <div class="drop" id="drop">
    <strong>Choose images or drop them here</strong>
    <small>JPG, PNG, GIF, BMP or WebP &mdash; nothing is uploaded</small>
  </div>
  <input type="file" id="file" accept="image/*" multiple>

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

    <div class="bar" id="bar"><i id="barFill"></i></div>
    <div class="status" id="status"></div>

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
  scripts: ['https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', 'js/pdf2img.js'],
  body: `
<h1>PDF to images</h1>
<p class="lede">Turn each page into a JPG or PNG at the resolution you pick. Rendered in your browser &mdash; the document is never uploaded.</p>

<div class="privacy-badge">&#128274; Your file never leaves this device</div>

<div class="tool">
  <div class="drop" id="drop">
    <strong>Choose a PDF or drop it here</strong>
    <small>Nothing is uploaded &mdash; pages are rendered in your browser</small>
  </div>
  <input type="file" id="file" accept="application/pdf,.pdf">

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

    <div class="bar" id="bar"><i id="barFill"></i></div>
    <div class="status" id="status"></div>
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
  scripts: ['https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js', 'js/rotate.js'],
  body: `
<h1>Rotate a PDF</h1>
<p class="lede">Turn every page, or just the sideways ones. Completely lossless &mdash; and nothing is uploaded.</p>

<div class="privacy-badge">&#128274; Your file never leaves this device</div>

<div class="tool">
  <div class="drop" id="drop">
    <strong>Choose a PDF or drop it here</strong>
    <small>Nothing is uploaded &mdash; rotation happens in your browser</small>
  </div>
  <input type="file" id="file" accept="application/pdf,.pdf">

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

    <div class="status" id="status"></div>

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

/* ---- tools hub ---- */

pages.push({
  slug: 'tools.html',
  title: `All PDF Tools — Free, In Your Browser, No Upload | ${NAME}`,
  desc: 'Every tool on SizeMyPDF: compress to an exact size, merge, split, images to PDF, PDF to images and rotate. All free, all running in your browser with no upload.',
  h1: 'All tools',
  body: `
<h1>All tools</h1>
<p class="lede">Six tools, all free, all running entirely in your browser. No account, no upload, no watermark, no file size limit imposed by us.</p>

<div class="privacy-badge">&#128274; Every tool here runs on your device</div>

<div class="grid">
  <a href="index.html"><strong>Compress PDF</strong><small>Hit an exact size in KB &mdash; 100, 200, 500 or any number a form demands.</small></a>
  <a href="merge-pdf.html"><strong>Merge PDFs</strong><small>Combine any number of files into one, in the order you choose.</small></a>
  <a href="split-pdf.html"><strong>Split PDF</strong><small>Extract specific pages, or break one document into several files.</small></a>
  <a href="jpg-to-pdf.html"><strong>Images to PDF</strong><small>Turn JPGs, PNGs or photos of documents into a single PDF.</small></a>
  <a href="pdf-to-jpg.html"><strong>PDF to images</strong><small>Render every page as a JPG or PNG at your chosen resolution.</small></a>
  <a href="rotate-pdf.html"><strong>Rotate PDF</strong><small>Fix sideways pages. Lossless &mdash; rotation is only metadata.</small></a>
</div>

<h2>Which tools change your file, and which do not</h2>
<p>Worth knowing before you pick one, because it is the difference between a reversible edit and a permanent one.</p>
<table>
  <thead><tr><th>Tool</th><th>Lossless?</th><th>What happens</th></tr></thead>
  <tbody>
    <tr><td>Merge</td><td>Yes</td><td>Page objects are copied between documents</td></tr>
    <tr><td>Split</td><td>Yes</td><td>Page objects are copied into a new document</td></tr>
    <tr><td>Rotate</td><td>Yes</td><td>A number in the page metadata changes</td></tr>
    <tr><td>Compress &mdash; Lossless mode</td><td>Yes</td><td>Metadata stripped, file structure repacked</td></tr>
    <tr><td>Compress &mdash; Target size</td><td><strong>No</strong></td><td>Pages become images; the text layer is lost</td></tr>
    <tr><td>PDF to images</td><td><strong>No</strong></td><td>Pages become pixels; not reversible</td></tr>
    <tr><td>Images to PDF</td><td><strong>No</strong></td><td>Images are re-encoded as JPEG</td></tr>
  </tbody>
</table>
<p><strong>Always keep your original.</strong> The lossy operations cannot be undone by running them backwards &mdash; converting an image back to a PDF does not restore the text that rendering destroyed.</p>

<h2>What is not here, and why</h2>
<p>Everything on this site runs in your browser. That rules out a category of tools other sites offer, and it is worth being straight about which:</p>
<ul>
  <li><strong>PDF to Word, Excel or PowerPoint.</strong> Reconstructing an editable document needs layout analysis that is not practical in a browser tab. Any site offering it is uploading your file to a server.</li>
  <li><strong>OCR.</strong> Making a scan searchable needs a recognition engine measured in tens of megabytes. Possible in principle, punishing to download.</li>
  <li><strong>Password protection and unlocking.</strong> The library used here does not implement PDF encryption. Removing protection from documents is also not something this site wants to help with.</li>
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
<p>${NAME} does the work on your own device using JavaScript and WebAssembly. There is no upload endpoint. There is no storage bucket. There is no server that could be breached, subpoenaed or sold, because there is no server in the path at all.</p>
<p>You do not have to take that on faith. Load the page, disconnect from the internet, and compress a file. It will still work.</p>

<h2>How the site is funded</h2>
<p>Hosting is paid for by advertising. The ads are clearly marked, kept away from the tool itself, and never disguised as download buttons &mdash; a pattern common on free file-tool sites that this one deliberately avoids.</p>
<p>There is no premium tier, no account, no file size cap and no watermark, because none of those would make the tool better; they would just make it worse in a way that pressures you to pay.</p>

<h2>Limitations, stated plainly</h2>
<ul>
  <li><strong>Target Size mode flattens text.</strong> Guaranteeing a hard byte limit requires converting pages to images. Text stops being selectable. Lossless mode avoids this but cannot promise a specific size.</li>
  <li><strong>No OCR.</strong> The tool does not add a searchable text layer to scans.</li>
  <li><strong>Encrypted PDFs are not handled.</strong> Remove the password yourself first; bypassing document encryption is deliberately out of scope.</li>
  <li><strong>Very large files depend on your device.</strong> There is no server limit, but a 100 MB scan may exhaust memory on a phone.</li>
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
  <li><strong>Recovering a lost PDF password.</strong> Not supported, and not something that will be added.</li>
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
<p>This site may use a privacy-respecting analytics service to count visits and understand which pages are useful. Where analytics are used, they are configured not to track individuals across other websites.</p>

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

/* ---------------------------------------------------------------- write */

const root = __dirname;
let written = 0;

for (const p of pages) {
  fs.writeFileSync(path.join(root, p.slug), head(p) + p.body + foot(p), 'utf8');
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
  for (const asset of ['css/style.css', 'js/app.js']) {
    const re = new RegExp(asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\?v=[a-f0-9]+)?', 'g');
    const next = html.replace(re, () => { changed++; return ver(asset); });
    html = next;
  }
  // AdSense loader: insert once, after the stylesheet, if not already there
  let ads = 'present';
  if (html.indexOf('adsbygoogle.js?client=') === -1) {
    html = html.replace(/(<link rel="stylesheet"[^>]*>)/, '$1\n' + ADSENSE);
    ads = 'inserted';
  }
  fs.writeFileSync(p, html, 'utf8');
  console.log('  stamped index.html (' + changed + ' asset refs, adsense ' + ads + ')');
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

console.log('\nDone - ' + written + ' pages generated.');
