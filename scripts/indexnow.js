#!/usr/bin/env node
/* Tell IndexNow (Bing, Yandex and others) that pages have changed.

   Bing retired bulk URL submission from Webmaster Tools in favour of this, so
   it is the only way to push changes rather than wait to be crawled. Ownership
   is proved by a key file at the site root; the key is public by design, which
   is why it lives in the repo rather than in a secret.

   Usage:
     node scripts/indexnow.js https://sizemypdf.com/a.html [more urls...]
     node scripts/indexnow.js --all      # every url in sitemap.xml
     node scripts/indexnow.js --dry-run --all

   Exits non-zero only when the submission itself fails. A URL that 404s is
   still submitted on purpose: that is how IndexNow is told a page is gone. */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HOST = 'sizemypdf.com';
const ENDPOINT = 'https://api.indexnow.org/indexnow';

/* The key file is named <key>.txt and contains exactly <key>. Finding it by
   that rule rather than hard-coding means rotating the key is just swapping
   the file - nothing here needs editing. */
function findKey() {
  const candidates = fs.readdirSync(ROOT).filter(f => /^[0-9a-f]{8,128}\.txt$/i.test(f));
  for (const f of candidates) {
    const key = f.replace(/\.txt$/i, '');
    const body = fs.readFileSync(path.join(ROOT, f), 'utf8').trim();
    if (body === key) return key;
  }
  throw new Error(
    'No IndexNow key file found in the site root. Expected a file named ' +
    '<key>.txt whose only content is <key>.');
}

function urlsFromSitemap() {
  const xml = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim());
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const rest = args.filter(a => a !== '--dry-run');

  let urls = rest.includes('--all')
    ? urlsFromSitemap()
    : rest.filter(a => a.startsWith('http'));

  // Same page listed twice in one push is one notification.
  urls = [...new Set(urls)].filter(u => u.startsWith(`https://${HOST}/`));

  if (!urls.length) {
    console.log('No URLs to submit - nothing to do.');
    return;
  }
  // IndexNow caps a single submission at 10,000 URLs.
  if (urls.length > 10000) urls = urls.slice(0, 10000);

  const key = findKey();
  console.log(`Submitting ${urls.length} URL(s) with key ${key.slice(0, 8)}…`);
  urls.forEach(u => console.log('  ' + u));

  if (dryRun) { console.log('--dry-run: not sending.'); return; }

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      host: HOST,
      key,
      keyLocation: `https://${HOST}/${key}.txt`,
      urlList: urls
    })
  });

  const body = await res.text();
  console.log(`IndexNow responded ${res.status} ${res.statusText}` +
              (body ? ` - ${body.slice(0, 200)}` : ''));

  // 200 = accepted and the key is verified. 202 = accepted, key check pending,
  // which is normal on the first call after a key changes. Anything else is a
  // real failure worth failing the job over.
  if (res.status !== 200 && res.status !== 202) {
    throw new Error(`IndexNow rejected the submission (${res.status})`);
  }
}

main().catch(err => {
  console.error('IndexNow submission failed:', err.message);
  process.exit(1);
});
