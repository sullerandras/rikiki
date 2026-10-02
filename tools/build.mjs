#!/usr/bin/env node
// Bundle index.html + css + js + icon into one self-contained HTML file, and build the hosted site.
//   node tools/build.mjs                 -> dist/rikiki.html (open or share anywhere)
//                                           dist/site/ (installable web app with sw.js, for GitHub Pages)
//   node tools/build.mjs --fragment out  -> same single file without <html>/<head>/<body> wrappers
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const args = process.argv.slice(2);
const fragIdx = args.indexOf('--fragment');
const source = read('index.html');

let html = source
  .replace(/<link rel="stylesheet" href="(css\/[^"]+)">/g, (_, p) => `<style>\n${read(p)}</style>`)
  .replace(/<script src="(js\/[^"]+)"><\/script>/g, (_, p) => `<script>\n${read(p).replace(/<\/script/gi, '<\\/script')}</script>`)
  .replace('href="icon.svg"', `href="data:image/svg+xml,${encodeURIComponent(read('icon.svg'))}"`);

let out = join(root, 'dist/rikiki.html');
if (fragIdx >= 0) {
  out = args[fragIdx + 1];
  html = html
    .replace(/<!doctype html>\s*/i, '')
    .replace(/<\/?(html|head|body)[^>]*>\s*/gi, '')
    .replace(/<meta (charset|name="viewport")[^>]*>\s*/gi, '');
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
if (fragIdx >= 0) process.exit(0);

// The site keeps the files separate, adds the manifest and lists everything in sw.js for offline play.
const site = join(root, 'dist/site');
rmSync(site, { recursive: true, force: true });
const files = {
  'index.html': source.replace(
    '<link rel="icon" href="icon.svg" type="image/svg+xml">',
    '$&\n<link rel="manifest" href="manifest.webmanifest">\n<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">',
  ),
};
const assets = ['icon.svg', 'manifest.webmanifest'].concat(
  ['css', 'js', 'icons'].flatMap((d) => readdirSync(join(root, d)).map((f) => `${d}/${f}`)),
);
for (const p of assets) files[p] = readFileSync(join(root, p));

// The version is a hash of the content, so every change makes browsers install the new worker.
const hash = createHash('sha256');
for (const [p, body] of Object.entries(files)) hash.update(p).update(body);
const fontsCss = (source.match(/<link rel="stylesheet" href="(https:\/\/fonts\.googleapis\.com[^"]+)">/) || [])[1] || '';
files['sw.js'] = read('sw.js')
  .replace("const VERSION = 'dev';", `const VERSION = '${hash.digest('hex').slice(0, 12)}';`)
  .replace("const FILES = ['./'];", `const FILES = ${JSON.stringify(['./'].concat(Object.keys(files)))};`)
  .replace("const FONTS_CSS = '';", `const FONTS_CSS = ${JSON.stringify(fontsCss)};`);

for (const [p, body] of Object.entries(files)) {
  mkdirSync(dirname(join(site, p)), { recursive: true });
  writeFileSync(join(site, p), body);
}
console.log(`wrote ${site}/ (${Object.keys(files).length} files)`);
