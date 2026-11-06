/* Minimal .xlsx reader (no dependencies). Returns every sheet as an array of
   rows; each row is an array of cell strings (empty string for blank cells).
   Only what the definitions importer needs: shared strings, inline strings,
   rich-text runs, numbers, booleans. Formulas return their cached value. */
'use strict';

const zlib = require('zlib');

function readZip(buf) {
  // End of central directory record
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a valid .xlsx (zip directory not found)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt zip directory');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const ln = buf.readUInt16LE(lho + 26);
    const le = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + ln + le;
    const raw = buf.subarray(start, start + csize);
    files[name] = () => (method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw)).toString('utf8');
    p += 46 + nlen + elen + clen;
  }
  return files;
}

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}

/* Concatenate every <t> inside an <si> or <is> (plain and rich-text runs). */
function textOf(xml) {
  let out = '';
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g;
  let m;
  while ((m = re.exec(xml))) out += m[1] ? decodeEntities(m[1]) : '';
  return out;
}

function colIndex(ref) {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function readWorkbook(buf) {
  const files = readZip(buf);
  const get = (n) => { if (!files[n]) throw new Error('Missing ' + n + ' in workbook'); return files[n](); };

  const shared = [];
  if (files['xl/sharedStrings.xml']) {
    const sst = get('xl/sharedStrings.xml');
    const re = /<si>([\s\S]*?)<\/si>/g;
    let m;
    while ((m = re.exec(sst))) shared.push(textOf(m[1]));
  }

  const rels = {};
  const relXml = get('xl/_rels/workbook.xml.rels');
  const relRe = /<Relationship\b([^>]*)\/?>/g;
  let m;
  while ((m = relRe.exec(relXml))) {
    const id = /Id="([^"]+)"/.exec(m[1]);
    const target = /Target="([^"]+)"/.exec(m[1]);
    if (id && target) rels[id[1]] = target[1].replace(/^\/?(xl\/)?/, 'xl/');
  }

  const sheets = [];
  const wb = get('xl/workbook.xml');
  const shRe = /<sheet\b([^>]*)\/?>/g;
  while ((m = shRe.exec(wb))) {
    const name = /name="([^"]*)"/.exec(m[1]);
    const rid = /r:id="([^"]+)"/.exec(m[1]);
    const state = /state="([^"]+)"/.exec(m[1]);
    if (!name || !rid) continue;
    sheets.push({ name: decodeEntities(name[1]), path: rels[rid[1]], hidden: !!state && state[1] !== 'visible' });
  }

  for (const sheet of sheets) {
    const xml = get(sheet.path);
    const rows = [];
    const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
    let r;
    while ((r = rowRe.exec(xml))) {
      const cells = [];
      const cRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      let c;
      while ((c = cRe.exec(r[1]))) {
        const ref = /r="([A-Z]+)\d+"/.exec(c[1]);
        if (!ref) continue;
        const type = (/\bt="([^"]+)"/.exec(c[1]) || [])[1];
        const inner = c[2] || '';
        let val = '';
        if (type === 's') {
          const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
          val = v ? shared[parseInt(v[1], 10)] || '' : '';
        } else if (type === 'inlineStr') {
          val = textOf(inner);
        } else {
          const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
          val = v ? decodeEntities(v[1]) : '';
          if (type === 'b') val = val === '1' ? 'TRUE' : 'FALSE';
        }
        cells[colIndex(ref[1])] = val;
      }
      const rowNum = parseInt((/r="(\d+)"/.exec(r[0]) || [])[1] || (rows.length + 1), 10);
      while (rows.length < rowNum - 1) rows.push([]);
      for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
      rows.push(cells);
    }
    sheet.rows = rows;
  }
  return sheets;
}

module.exports = { readWorkbook };
