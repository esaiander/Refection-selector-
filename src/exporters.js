/* SELN Prompt Studio — export builders.
   Pure string/byte functions (no DOM) so they run in the browser and in Node tests.
   Produces: a real .pptx (minimal OOXML in a stored ZIP), Word-compatible .doc HTML,
   and a timed meeting-agenda document. */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.SelnExport = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- shared helpers ---------- */

  function xesc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }
  function hesc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function slug(s) {
    return (String(s).trim() || 'seln-reflection-session')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'seln-export';
  }
  function fmt12(totalMinutes) {
    var m = ((totalMinutes % 1440) + 1440) % 1440;
    var h = Math.floor(m / 60), mm = m % 60;
    var h12 = ((h + 11) % 12) + 1;
    return h12 + ':' + (mm < 10 ? '0' : '') + mm + ' ' + (h < 12 ? 'AM' : 'PM');
  }
  function parseHM(hm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(hm || '');
    if (!m) return 9 * 60;
    return Math.min(23, +m[1]) * 60 + Math.min(59, +m[2]);
  }
  function longDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return '';
    return new Date(+m[1], +m[2] - 1, +m[3])
      .toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }

  /* Group items by category, preserving the order categories first appear. */
  function groupItems(items) {
    var order = [], map = {};
    items.forEach(function (it) {
      var c = it.category || 'Custom';
      if (!map[c]) { map[c] = []; order.push(c); }
      map[c].push(it);
    });
    return order.map(function (c) { return { category: c, items: map[c] }; });
  }

  function metaLine(it, o) {
    var bits = [];
    if (o.ids && it.id) bits.push(it.id);
    if (o.meta) {
      if (it.edition) bits.push(it.edition);
      if (it.category) bits.push(it.category);
      if (it.type) bits.push(it.type);
    }
    return bits.join(' · ');
  }

  /* ---------- ZIP writer (stored, no compression) ---------- */

  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(buf) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* files: [{name, data: string|Uint8Array}] -> Uint8Array of a valid ZIP */
  function zipStore(files) {
    var enc = new TextEncoder();
    var dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1; // fixed 2026-01-01 for determinism
    var dosTime = 12 << 11;
    var parts = [], central = [], offset = 0;

    files.forEach(function (f) {
      var nameB = enc.encode(f.name);
      var data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      var crc = crc32(data);

      var local = new Uint8Array(30 + nameB.length);
      var dv = new DataView(local.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(10, dosTime, true);
      dv.setUint16(12, dosDate, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, data.length, true);
      dv.setUint32(22, data.length, true);
      dv.setUint16(26, nameB.length, true);
      local.set(nameB, 30);
      parts.push(local, data);

      var cen = new Uint8Array(46 + nameB.length);
      var cv = new DataView(cen.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(12, dosTime, true);
      cv.setUint16(14, dosDate, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameB.length, true);
      cv.setUint32(42, offset, true);
      cen.set(nameB, 46);
      central.push(cen);

      offset += local.length + data.length;
    });

    var cenSize = central.reduce(function (a, c) { return a + c.length; }, 0);
    var end = new Uint8Array(22);
    var ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cenSize, true);
    ev.setUint32(16, offset, true);

    var out = new Uint8Array(offset + cenSize + 22), p = 0;
    parts.concat(central, [end]).forEach(function (part) { out.set(part, p); p += part.length; });
    return out;
  }

  /* ---------- PPTX ---------- */

  var EMU = 914400;                      // EMUs per inch
  var SLIDE_W = 12192000, SLIDE_H = 6858000; // 16:9
  var C_INK = '20302C', C_MUTE = '667571', C_ACCENT = '0E6E5C', C_PAPER = 'FBFAF7';
  var NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';

  function run(text, o) {
    return '<a:r><a:rPr lang="en-US" sz="' + o.sz + '"' + (o.b ? ' b="1"' : '') + (o.i ? ' i="1"' : '') +
      (o.spc ? ' spc="' + o.spc + '"' : '') + ' dirty="0"><a:solidFill><a:srgbClr val="' + (o.color || C_INK) +
      '"/></a:solidFill><a:latin typeface="' + (o.font || 'Georgia') + '"/></a:rPr><a:t>' + xesc(text) + '</a:t></a:r>';
  }
  function para(runs, algn) {
    return '<a:p><a:pPr algn="' + (algn || 'l') + '"/>' + runs + '</a:p>';
  }
  function textBox(id, x, y, w, h, paras, anchor) {
    return '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="Text ' + id + '"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>' +
      '<p:spPr><a:xfrm><a:off x="' + x + '" y="' + y + '"/><a:ext cx="' + w + '" cy="' + h + '"/></a:xfrm>' +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>' +
      '<p:txBody><a:bodyPr wrap="square" rtlCol="0" anchor="' + (anchor || 't') + '"><a:normAutofit/></a:bodyPr><a:lstStyle/>' +
      paras + '</p:txBody></p:sp>';
  }
  function rectShape(id, x, y, w, h, color) {
    return '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="Rect ' + id + '"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>' +
      '<p:spPr><a:xfrm><a:off x="' + x + '" y="' + y + '"/><a:ext cx="' + w + '" cy="' + h + '"/></a:xfrm>' +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="' + color + '"/></a:solidFill>' +
      '<a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>';
  }
  function slideXml(shapes) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<p:sld ' + NS + '><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="' + C_PAPER +
      '"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>' +
      '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
      '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
      shapes + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';
  }

  var THEME_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="SELN"><a:themeElements>' +
    '<a:clrScheme name="SELN"><a:dk1><a:srgbClr val="20302C"/></a:dk1><a:lt1><a:srgbClr val="FBFAF7"/></a:lt1>' +
    '<a:dk2><a:srgbClr val="44544F"/></a:dk2><a:lt2><a:srgbClr val="EDEBE4"/></a:lt2>' +
    '<a:accent1><a:srgbClr val="0E6E5C"/></a:accent1><a:accent2><a:srgbClr val="B0641C"/></a:accent2>' +
    '<a:accent3><a:srgbClr val="3D5A9E"/></a:accent3><a:accent4><a:srgbClr val="A84465"/></a:accent4>' +
    '<a:accent5><a:srgbClr val="6C4AB0"/></a:accent5><a:accent6><a:srgbClr val="A6432C"/></a:accent6>' +
    '<a:hlink><a:srgbClr val="0E6E5C"/></a:hlink><a:folHlink><a:srgbClr val="44544F"/></a:folHlink></a:clrScheme>' +
    '<a:fontScheme name="SELN"><a:majorFont><a:latin typeface="Georgia"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>' +
    '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>' +
    '<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
    '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>' +
    '<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>' +
    '<a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>' +
    '<a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>' +
    '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle>' +
    '<a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>' +
    '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
    '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>';

  var EMPTY_TREE = '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>';

  var MASTER_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<p:sldMaster ' + NS + '><p:cSld>' + EMPTY_TREE + '</p:cSld>' +
    '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" ' +
    'accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
    '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>';

  var LAYOUT_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<p:sldLayout ' + NS + ' type="blank" preserve="1"><p:cSld name="Blank">' + EMPTY_TREE + '</p:cSld>' +
    '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';

  var REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
  var OD_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

  function promptFontSize(len) {
    if (len < 90) return 4000;
    if (len < 160) return 3400;
    if (len < 240) return 2800;
    return 2400;
  }

  /* items: [{n, text, id, edition, category, type, srcNote, userNote}] (n = 1-based number)
     opts: {title, subtitle, facilitator, org, dateStr, ids, meta, notes, group} */
  function buildPptx(items, opts) {
    var L = Math.round(0.9 * EMU);                 // left margin
    var W = SLIDE_W - 2 * L;                       // usable width
    var slides = [];
    var total = items.length;

    // Title slide
    var coverBits = [];
    if (opts.facilitator) coverBits.push('Facilitated by ' + opts.facilitator);
    if (opts.org) coverBits.push(opts.org);
    if (opts.dateStr) coverBits.push(opts.dateStr);
    var titleShapes =
      rectShape(2, L, Math.round(1.42 * EMU), Math.round(0.75 * EMU), Math.round(0.05 * EMU), C_ACCENT) +
      textBox(3, L, Math.round(1.65 * EMU), W, Math.round(0.45 * EMU),
        para(run((total + ' reflection prompts — SELN Strategic Reflection Guide').toUpperCase(),
          { sz: 1300, b: 1, color: C_ACCENT, font: 'Calibri', spc: 120 }))) +
      textBox(4, L, Math.round(2.15 * EMU), W, Math.round(2.1 * EMU),
        para(run(opts.title, { sz: 4400, b: 1, color: C_INK }))) +
      (opts.subtitle ? textBox(5, L, Math.round(4.35 * EMU), W, Math.round(0.8 * EMU),
        para(run(opts.subtitle, { sz: 1800, color: C_MUTE, font: 'Calibri' }))) : '') +
      (coverBits.length ? textBox(6, L, Math.round(6.35 * EMU), W, Math.round(0.5 * EMU),
        para(run(coverBits.join('  ·  '), { sz: 1200, color: C_MUTE, font: 'Calibri' }))) : '');
    slides.push(slideXml(titleShapes));

    // Prompt slides (with optional section dividers)
    var sections = opts.group ? groupItems(items) : [{ category: null, items: items }];
    sections.forEach(function (sec) {
      if (sec.category) {
        slides.push(slideXml(
          rectShape(2, L, Math.round(2.55 * EMU), Math.round(0.75 * EMU), Math.round(0.05 * EMU), C_ACCENT) +
          textBox(3, L, Math.round(2.8 * EMU), W, Math.round(0.45 * EMU),
            para(run('SECTION', { sz: 1300, b: 1, color: C_ACCENT, font: 'Calibri', spc: 200 }))) +
          textBox(4, L, Math.round(3.25 * EMU), W, Math.round(1.4 * EMU),
            para(run(sec.category, { sz: 3200, b: 1, color: C_INK }))) +
          textBox(5, L, Math.round(6.35 * EMU), W, Math.round(0.5 * EMU),
            para(run(sec.items.length + (sec.items.length === 1 ? ' prompt' : ' prompts'),
              { sz: 1200, color: C_MUTE, font: 'Calibri' })))
        ));
      }
      sec.items.forEach(function (it) {
        var kickerBits = [];
        if (opts.meta && it.category) kickerBits.push(it.category);
        if (opts.meta && it.edition) kickerBits.push(it.edition);
        var footBits = [];
        if (opts.ids && it.id) footBits.push(it.id);
        if (opts.meta && it.type) footBits.push(it.type);
        if (opts.notes && it.srcNote) footBits.push(it.srcNote);
        if (opts.notes && it.userNote) footBits.push(it.userNote);
        var shapes =
          (kickerBits.length ? textBox(2, L, Math.round(0.55 * EMU), W, Math.round(0.4 * EMU),
            para(run(kickerBits.join('  ·  ').toUpperCase(), { sz: 1300, b: 1, color: C_ACCENT, font: 'Calibri', spc: 120 }))) : '') +
          rectShape(3, L, Math.round(1.08 * EMU), Math.round(0.75 * EMU), Math.round(0.045 * EMU), C_ACCENT) +
          textBox(4, L, Math.round(1.35 * EMU), W, Math.round(4.35 * EMU),
            para(run(it.text, { sz: promptFontSize(it.text.length), color: C_INK })), 'ctr') +
          (footBits.length ? textBox(5, L, Math.round(6.25 * EMU), W - Math.round(1.2 * EMU), Math.round(0.5 * EMU),
            para(run(footBits.join('  ·  '), { sz: 1100, color: C_MUTE, font: 'Calibri' }))) : '') +
          textBox(6, SLIDE_W - L - Math.round(1.2 * EMU), Math.round(6.25 * EMU), Math.round(1.2 * EMU), Math.round(0.5 * EMU),
            para(run(it.n + ' / ' + total, { sz: 1100, color: C_MUTE, font: 'Calibri' }), 'r'));
        slides.push(slideXml(shapes));
      });
    });

    // Package parts
    var files = [];
    var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
      '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
      '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
      '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
      slides.map(function (_, i) {
        return '<Override PartName="/ppt/slides/slide' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>';
      }).join('') + '</Types>';
    files.push({ name: '[Content_Types].xml', data: contentTypes });

    files.push({
      name: '_rels/.rels',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="' + REL_NS + '">' +
        '<Relationship Id="rId1" Type="' + OD_REL + '/officeDocument" Target="ppt/presentation.xml"/></Relationships>'
    });

    var sldIds = slides.map(function (_, i) {
      return '<p:sldId id="' + (256 + i) + '" r:id="rId' + (i + 2) + '"/>';
    }).join('');
    files.push({
      name: 'ppt/presentation.xml',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:presentation ' + NS + '>' +
        '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
        '<p:sldIdLst>' + sldIds + '</p:sldIdLst>' +
        '<p:sldSz cx="' + SLIDE_W + '" cy="' + SLIDE_H + '"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>'
    });

    var presRels = '<Relationship Id="rId1" Type="' + OD_REL + '/slideMaster" Target="slideMasters/slideMaster1.xml"/>' +
      slides.map(function (_, i) {
        return '<Relationship Id="rId' + (i + 2) + '" Type="' + OD_REL + '/slide" Target="slides/slide' + (i + 1) + '.xml"/>';
      }).join('');
    files.push({
      name: 'ppt/_rels/presentation.xml.rels',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="' + REL_NS + '">' + presRels + '</Relationships>'
    });

    files.push({ name: 'ppt/slideMasters/slideMaster1.xml', data: MASTER_XML });
    files.push({
      name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="' + REL_NS + '">' +
        '<Relationship Id="rId1" Type="' + OD_REL + '/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>' +
        '<Relationship Id="rId2" Type="' + OD_REL + '/theme" Target="../theme/theme1.xml"/></Relationships>'
    });
    files.push({ name: 'ppt/slideLayouts/slideLayout1.xml', data: LAYOUT_XML });
    files.push({
      name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="' + REL_NS + '">' +
        '<Relationship Id="rId1" Type="' + OD_REL + '/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>'
    });
    files.push({ name: 'ppt/theme/theme1.xml', data: THEME_XML });

    slides.forEach(function (xml, i) {
      files.push({ name: 'ppt/slides/slide' + (i + 1) + '.xml', data: xml });
      files.push({
        name: 'ppt/slides/_rels/slide' + (i + 1) + '.xml.rels',
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="' + REL_NS + '">' +
          '<Relationship Id="rId1" Type="' + OD_REL + '/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>'
      });
    });

    return zipStore(files);
  }

  /* ---------- Word (.doc via HTML) ---------- */

  var WORD_CSS = [
    'body{font-family:Georgia,"Times New Roman",serif;color:#20302C;font-size:11.5pt;line-height:1.45}',
    'p{margin:0 0 6pt 0}',
    '.xp-kicker{font-family:Arial,sans-serif;font-size:9pt;letter-spacing:1.5pt;color:#0E6E5C;font-weight:bold;text-transform:uppercase;margin:0 0 10pt 0}',
    '.xp-title{font-size:26pt;font-weight:bold;margin:0 0 8pt 0;line-height:1.15}',
    '.xp-subtitle{font-size:13pt;color:#5E6E69;margin:0 0 6pt 0}',
    '.xp-covermeta{font-family:Arial,sans-serif;font-size:9.5pt;color:#5E6E69;margin:14pt 0 0 0}',
    '.xp-cover{border-bottom:2.25pt solid #0E6E5C;padding-bottom:18pt;margin-bottom:24pt}',
    '.xp-cat{font-size:15pt;font-weight:bold;color:#0E6E5C;border-bottom:1pt solid #C9C7BC;padding-bottom:4pt;margin:22pt 0 12pt 0}',
    '.xp-item{margin:0 0 16pt 0}',
    '.xp-q{font-size:12.5pt;margin:0 0 4pt 0}',
    '.xp-qnum{font-family:Arial,sans-serif;font-size:10pt;font-weight:bold;color:#0E6E5C}',
    '.xp-meta{font-family:Arial,sans-serif;font-size:8.5pt;color:#5E6E69;letter-spacing:.4pt;margin:0 0 3pt 0}',
    '.xp-note{font-size:10.5pt;font-style:italic;color:#5E6E69;margin:0 0 3pt 0}',
    '.xp-line{border-bottom:1pt solid #C9C7BC;margin:0 0 14pt 0;font-size:10pt}',
    '.xp-break{page-break-before:always}',
    'table.xp-agenda{border-collapse:collapse;width:100%;font-size:11pt}',
    'table.xp-agenda th{font-family:Arial,sans-serif;font-size:9pt;letter-spacing:1pt;text-transform:uppercase;color:#5E6E69;text-align:left;border-bottom:2.25pt solid #0E6E5C;padding:6pt 10pt 6pt 0}',
    'table.xp-agenda td{border-bottom:1pt solid #C9C7BC;padding:9pt 10pt 9pt 0;vertical-align:top}',
    'td.xp-time{white-space:nowrap;font-family:Arial,sans-serif;font-size:10pt;color:#0E6E5C;font-weight:bold;width:70pt}',
    'td.xp-min{white-space:nowrap;font-family:Arial,sans-serif;font-size:10pt;color:#5E6E69;width:45pt}'
  ].join('\n');

  function wordWrap(title, bodyHtml) {
    return '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">' +
      '<head><meta charset="utf-8"><title>' + hesc(title) + '</title>' +
      '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->' +
      '<style>@page{size:8.5in 11.0in;margin:1.0in 0.9in;mso-header-margin:0.5in;mso-footer-margin:0.5in}\n' + WORD_CSS + '</style>' +
      '</head><body>' + bodyHtml + '</body></html>';
  }

  function coverHtml(o, kicker) {
    var bits = [];
    if (o.dateStr) bits.push(o.dateStr);
    if (o.facilitator) bits.push('Facilitator: ' + o.facilitator);
    if (o.org) bits.push(o.org);
    return '<div class="xp-cover">' +
      '<p class="xp-kicker">' + hesc(kicker) + '</p>' +
      '<h1 class="xp-title">' + hesc(o.title) + '</h1>' +
      (o.subtitle ? '<p class="xp-subtitle">' + hesc(o.subtitle) + '</p>' : '') +
      (bits.length ? '<p class="xp-covermeta">' + hesc(bits.join('  ·  ')) + '</p>' : '') +
      '</div>';
  }

  function itemHtml(it, o, withBreak) {
    var html = '<div class="xp-item' + (withBreak ? ' xp-break' : '') + '">';
    html += '<p class="xp-q"><span class="xp-qnum">' + it.n + '.&nbsp;&nbsp;</span>' + hesc(it.text) + '</p>';
    var m = metaLine(it, o);
    if (m) html += '<p class="xp-meta">' + hesc(m) + '</p>';
    if (o.notes && it.srcNote) html += '<p class="xp-note">Guidance: ' + hesc(it.srcNote) + '</p>';
    if (o.notes && it.userNote) html += '<p class="xp-note">Facilitator note: ' + hesc(it.userNote) + '</p>';
    for (var i = 0; i < (o.lines || 0); i++) html += '<p class="xp-line">&nbsp;</p>';
    return html + '</div>';
  }

  /* Discussion-guide body — shared by the .doc download and the print/PDF view. */
  function buildDocBody(items, o) {
    var html = coverHtml(o, 'SELN Strategic Reflection Guide · ' + items.length +
      (items.length === 1 ? ' prompt' : ' prompts'));
    var first = true;
    if (o.group) {
      groupItems(items).forEach(function (sec) {
        html += '<h2 class="xp-cat' + (o.breaks && !first ? ' xp-break' : '') + '">' + hesc(sec.category) + '</h2>';
        sec.items.forEach(function (it, i) {
          html += itemHtml(it, o, o.breaks && !(i === 0));
          first = false;
        });
      });
    } else {
      items.forEach(function (it) {
        html += itemHtml(it, o, o.breaks && !first);
        first = false;
      });
    }
    return html;
  }

  /* Timed agenda body — shared by the .doc download and the print/PDF view.
     o.agenda: {start:"HH:MM", mins, welcome, closing} */
  function buildAgendaBody(items, o) {
    var ag = o.agenda || {};
    var mins = Math.max(1, +ag.mins || 10);
    var rows = [];
    var t = parseHM(ag.start);
    if (ag.welcome) { rows.push({ t: t, min: 10, title: 'Welcome & introductions', meta: '', notes: [] }); t += 10; }
    items.forEach(function (it) {
      var notes = [];
      if (o.notes && it.srcNote) notes.push('Guidance: ' + it.srcNote);
      if (o.notes && it.userNote) notes.push('Note: ' + it.userNote);
      rows.push({ t: t, min: mins, title: it.text, meta: metaLine(it, o), notes: notes });
      t += mins;
    });
    if (ag.closing) { rows.push({ t: t, min: 10, title: 'Wrap-up & next steps', meta: '', notes: [] }); t += 10; }
    var startM = parseHM(ag.start);
    var header = Object.assign({}, o, {
      subtitle: o.subtitle,
      dateStr: [o.dateStr, fmt12(startM) + ' – ' + fmt12(t) + ' (' + (t - startM) + ' min)']
        .filter(Boolean).join('  ·  ')
    });
    var html = coverHtml(header, 'Meeting Agenda');
    html += '<table class="xp-agenda"><thead><tr><th>Time</th><th>Min</th><th>Item</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      html += '<tr><td class="xp-time">' + fmt12(r.t) + '</td><td class="xp-min">' + r.min + '</td><td><b>' +
        hesc(r.title) + '</b>' +
        (r.meta ? '<br><span class="xp-meta">' + hesc(r.meta) + '</span>' : '') +
        r.notes.map(function (nt) { return '<br><span class="xp-note">' + hesc(nt) + '</span>'; }).join('') +
        '</td></tr>';
    });
    html += '</tbody></table>';
    return html;
  }

  return {
    xesc: xesc, hesc: hesc, slug: slug, fmt12: fmt12, parseHM: parseHM, longDate: longDate,
    crc32: crc32, zipStore: zipStore, buildPptx: buildPptx,
    wordWrap: wordWrap, buildDocBody: buildDocBody, buildAgendaBody: buildAgendaBody, WORD_CSS: WORD_CSS
  };
});
