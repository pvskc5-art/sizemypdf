#!/usr/bin/env node
/* Generates the static content pages so header, footer and SEO tags stay in
   sync across the site. Output is plain HTML - the deployed site needs no
   build step and no runtime dependencies.

   Usage:  node build.js       */

const fs = require('fs');
const path = require('path');

const SITE = 'https://sizemypdf.com';
const NAME = 'SizeMyPDF';

/* ------------------------------------------------------------------ shell */

const head = (p) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${p.title}</title>
<meta name="description" content="${p.desc}">
<link rel="canonical" href="${SITE}/${p.slug}">
${p.noindex ? '<meta name="robots" content="noindex,follow">\n' : ''}<meta property="og:title" content="${p.title}">
<meta property="og:description" content="${p.desc}">
<meta property="og:url" content="${SITE}/${p.slug}">
<meta property="og:type" content="article">
<link rel="stylesheet" href="css/style.css">
${p.faq ? faqSchema(p.faq) : ''}${p.breadcrumb === false ? '' : crumbSchema(p)}
</head>
<body>

<header class="site">
  <div class="wrap">
    <a class="logo" href="index.html">Size<span>My</span>PDF</a>
    <nav class="main">
      <a href="compress-pdf-to-100kb.html">100&nbsp;KB</a>
      <a href="compress-pdf-to-200kb.html">200&nbsp;KB</a>
      <a href="compress-pdf-for-email.html">For email</a>
      <a href="about.html">About</a>
    </nav>
  </div>
</header>

<main class="wrap">
`;

const foot = `
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

const AD = `<div class="adslot">ad slot &mdash; replace after AdSense approval</div>`;

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
  <p style="margin-bottom:0"><strong>REPLACE-WITH-YOUR-EMAIL@example.com</strong></p>
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
<p class="lede">Last updated: <strong>REPLACE-WITH-DATE</strong></p>

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
<p>If you are located in the EEA, the UK or Switzerland, a consent prompt is shown before any non-essential cookies are set, and your choice is honoured. You may change or withdraw your consent at any time through the cookie settings link in the footer.</p>
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
<p class="lede">Last updated: <strong>REPLACE-WITH-DATE</strong></p>

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
  fs.writeFileSync(path.join(root, p.slug), head(p) + p.body + foot, 'utf8');
  written++;
  console.log('  wrote ' + p.slug);
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
