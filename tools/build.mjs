#!/usr/bin/env node
// Bundle index.html + css + js + icon into one self-contained HTML file.
//   node tools/build.mjs                 -> dist/rikiki.html (open or share anywhere)
//   node tools/build.mjs --fragment out  -> same content without <html>/<head>/<body> wrappers
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const args = process.argv.slice(2);
const fragIdx = args.indexOf('--fragment');

let html = read('index.html')
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
