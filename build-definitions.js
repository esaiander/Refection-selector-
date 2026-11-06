#!/usr/bin/env node
/* Builds the State Waiver Definitions tool.
     node build-definitions.js [path/to/workbook.xlsx]
   1. Imports the workbook (default data/waiver_definitions.xlsx) -> data/waiver_definitions.json
   2. Inlines data + src/definitions.{css,html,js} -> definitions.html
   The build stops (exit code 1) if any row is invalid, so a broken definition
   never reaches the page. Pass --report to print how every entry was classified. */
'use strict';

const fs = require('fs');
const path = require('path');
const { importWorkbook } = require('./tools/import-definitions');

const root = __dirname;
const args = process.argv.slice(2);
const report = args.includes('--report');
const xlsxArg = args.find((a) => !a.startsWith('--'));
const xlsxPath = xlsxArg ? path.resolve(xlsxArg) : path.join(root, 'data', 'waiver_definitions.xlsx');

const { data, problems, warnings } = importWorkbook(fs.readFileSync(xlsxPath), { sourceName: path.basename(xlsxPath) });

for (const w of warnings) console.log('  warning: ' + w);
if (problems.length) {
  console.error('\nBuild stopped. Fix these rows in ' + path.basename(xlsxPath) + ' and run again:');
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}

fs.writeFileSync(path.join(root, 'data', 'waiver_definitions.json'), JSON.stringify(data, null, 1) + '\n');

if (report) {
  for (const s of data.states) {
    console.log(`\n${s.code} ${s.name} (${s.entries.length})`);
    for (const e of s.entries) console.log(`  [${e.category.padEnd(10)} ${e.topic.padEnd(13)}] ${e.name}${e.source ? '  <' + e.source + '>' : ''}`);
  }
}

const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const dataJs = JSON.stringify(data).replace(/</g, '\\u003c');
const html = [
  '<!doctype html>', '<html lang="en">', '<head>', '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  '<title>SELN State Waiver Definitions</title>',
  '<style>', read('src/definitions.css'), '</style>', '</head>', '<body>',
  read('src/definitions.html'),
  '<script>', 'var DEFS = ' + dataJs + ';', read('src/definitions.js'), '</script>',
  '</body>', '</html>'
].join('\n');
fs.writeFileSync(path.join(root, 'definitions.html'), html);

const m = data.meta;
console.log(`\nImported ${m.entries} definitions from ${m.statesWithEntries} of ${m.states} state sheets.`);
console.log('wrote data/waiver_definitions.json and definitions.html (' + (html.length / 1024).toFixed(0) + ' KB)');
