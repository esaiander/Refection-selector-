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

/* Tag near-duplicate prompts (the guide repeats many questions with light
   rewording). Token-overlap matching against existing cluster members —
   no transitive chaining, so thematic neighbors don't snowball into one blob.
   Each clustered prompt gets simKey (cluster id) + sim (the other member ids). */
function tagSimilarPrompts(prompts) {
  const STOP = new Set(('a an the and or but of to in on for with about your you our we us their they is are ' +
    'do does did what when where how why who tell describe us that this it if would could can be been feel more some').split(' '));
  const stem = (w) => w.replace(/(ing|ed|es|s)$/, '');
  const tokens = (t) => new Set(t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter((w) => w && !STOP.has(w)).map(stem).filter((w) => w.length > 2));
  const toks = prompts.map((p) => tokens(p.prompt));
  const similar = (a, b) => {
    let s = 0;
    for (const x of a) if (b.has(x)) s++;
    const jaccard = s / (a.size + b.size - s);
    const minSize = Math.min(a.size, b.size);
    return jaccard >= 0.6 ||                       // strong overall overlap
      (s >= 4 && minSize >= 4 && s / minSize >= 0.85) || // one contained in the other
      (s >= 5 && jaccard >= 0.5);                  // long shared template
  };
  const clusters = [];
  prompts.forEach((p, i) => {
    const c = clusters.find((c) => c.some((j) => similar(toks[j], toks[i])));
    if (c) c.push(i); else clusters.push([i]);
  });
  let key = 0;
  clusters.filter((c) => c.length > 1).forEach((c) => {
    c.forEach((i) => {
      prompts[i].simKey = key;
      prompts[i].sim = c.filter((j) => j !== i).map((j) => prompts[j].id);
    });
    key++;
  });
  return key;
}
const simClusters = tagSimilarPrompts(data.prompts);
console.log('similar-prompt clusters:', simClusters);

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
