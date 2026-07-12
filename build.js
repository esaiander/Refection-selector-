#!/usr/bin/env node
/* Assembles the single-file app: inlines the prompt data, CSS, export builders,
   and UI logic into index.html. Run: node build.js [extra-output.html]
   An optional second output path receives the body-only fragment (no <html> wrapper). */
'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const data = JSON.parse(read('data/seln_prompts.json'));
// <-escape so no "</script>" sequence can terminate the inline script early
const dataJs = JSON.stringify(data).replace(/</g, '\\u003c');

const css = read('src/app.css');
const markup = read('src/markup.html');
const exporters = read('src/exporters.js');
const app = read('src/app.js');

const headPart = [
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  '<title>SELN Prompt Studio</title>',
  '<style>', css, '</style>'
].join('\n');

const bodyPart = [
  markup,
  '<script>',
  'var SELN = ' + dataJs + ';',
  exporters,
  app,
  '</script>'
].join('\n');

const full = [
  '<!doctype html>',
  '<html lang="en">',
  '<head>',
  '<meta charset="utf-8">',
  headPart,
  '</head>',
  '<body>',
  bodyPart,
  '</body>',
  '</html>'
].join('\n');

fs.writeFileSync(path.join(root, 'index.html'), full);
console.log('wrote index.html (' + (full.length / 1024).toFixed(0) + ' KB)');

const fragmentOut = process.argv[2];
if (fragmentOut) {
  fs.writeFileSync(fragmentOut, headPart + '\n' + bodyPart);
  console.log('wrote ' + fragmentOut);
}
