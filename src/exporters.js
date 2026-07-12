/* SELN Prompt Studio — export builders.
   Pure string/byte functions (no DOM) so they run in the browser and in Node tests.
   Produces real files, generated entirely on-device:
   - .pptx (PresentationML in a stored ZIP)
   - .docx (WordprocessingML in a stored ZIP) — discussion guide and timed agenda
   - .pdf  (hand-written PDF 1.4 with core Type1 fonts)                          */

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

  /* Group items by a field ('fw' | 'category' | 'edition'), preserving the
     order group values first appear. */
  function groupItems(items, key) {
    var order = [], map = {};
    items.forEach(function (it) {
      var c = it[key] || 'Other';
      if (!map[c]) { map[c] = []; order.push(c); }
      map[c].push(it);
    });
    return order.map(function (c) { return { category: c, items: map[c] }; });
  }

  /* Metadata line under a prompt, driven by the show-toggles:
     o.ids, o.showEd, o.showFw (framework category), o.showCat (original), o.showType */
  function metaLine(it, o) {
    var bits = [];
    if (o.ids && it.id) bits.push(it.id);
    if (o.showEd && it.edition) bits.push(it.edition);
    if (o.showFw && it.fw) bits.push(it.fw);
    if (o.showCat && it.category) bits.push(it.category);
    if (o.showType && it.type) bits.push(it.type);
    return bits.join(' · ');
  }

  function coverBits(o) {
    var bits = [];
    if (o.dateStr) bits.push(o.dateStr);
    if (o.facilitator) bits.push('Facilitator: ' + o.facilitator);
    if (o.org) bits.push(o.org);
    return bits.join('  ·  ');
  }

  /* Timed agenda rows shared by the .docx and .pdf agenda builders.
     Returns {rows:[{t,min,title,meta,notes[]}], span:"9:00 AM – 10:20 AM (80 min)"} */
  function agendaData(items, o) {
    var ag = o.agenda || {};
    var mins = Math.max(1, +ag.mins || 10);
    var wMins = Math.max(1, +ag.welcomeMins || 10);
    var cMins = Math.max(1, +ag.closingMins || 10);
    var rows = [];
    var t = parseHM(ag.start);
    var startM = t;
    if (ag.welcome) { rows.push({ t: t, min: wMins, title: 'Welcome & introductions', meta: '', notes: [] }); t += wMins; }
    items.forEach(function (it) {
      var notes = [];
      if (o.guidance && it.srcNote) notes.push('Guidance: ' + it.srcNote);
      if (o.myNotes && it.userNote) notes.push('Note: ' + it.userNote);
      rows.push({ t: t, min: mins, title: it.text, meta: metaLine(it, o), notes: notes });
      t += mins;
    });
    if (ag.closing) { rows.push({ t: t, min: cMins, title: 'Wrap-up & next steps', meta: '', notes: [] }); t += cMins; }
    return { rows: rows, span: fmt12(startM) + ' – ' + fmt12(t) + ' (' + (t - startM) + ' min)' };
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
    var cb = [];
    if (opts.facilitator) cb.push('Facilitated by ' + opts.facilitator);
    if (opts.org) cb.push(opts.org);
    if (opts.dateStr) cb.push(opts.dateStr);
    var titleShapes =
      rectShape(2, L, Math.round(1.42 * EMU), Math.round(0.75 * EMU), Math.round(0.05 * EMU), C_ACCENT) +
      textBox(3, L, Math.round(1.65 * EMU), W, Math.round(0.45 * EMU),
        para(run((total + ' reflection prompts — SELN Strategic Reflection Guide').toUpperCase(),
          { sz: 1300, b: 1, color: C_ACCENT, font: 'Calibri', spc: 120 }))) +
      textBox(4, L, Math.round(2.15 * EMU), W, Math.round(2.1 * EMU),
        para(run(opts.title, { sz: 4400, b: 1, color: C_INK }))) +
      (opts.subtitle ? textBox(5, L, Math.round(4.35 * EMU), W, Math.round(0.8 * EMU),
        para(run(opts.subtitle, { sz: 1800, color: C_MUTE, font: 'Calibri' }))) : '') +
      (cb.length ? textBox(6, L, Math.round(6.35 * EMU), W, Math.round(0.5 * EMU),
        para(run(cb.join('  ·  '), { sz: 1200, color: C_MUTE, font: 'Calibri' }))) : '');
    slides.push(slideXml(titleShapes));

    // Prompt slides (with optional section dividers)
    var sections = opts.groupBy ? groupItems(items, opts.groupBy) : [{ category: null, items: items }];
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
        if (opts.showFw && it.fw) kickerBits.push(it.fw);
        if (opts.showCat && it.category) kickerBits.push(it.category);
        if (opts.showEd && it.edition) kickerBits.push(it.edition);
        var footBits = [];
        if (opts.ids && it.id) footBits.push(it.id);
        if (opts.showType && it.type) footBits.push(it.type);
        if (opts.guidance && it.srcNote) footBits.push(it.srcNote);
        if (opts.myNotes && it.userNote) footBits.push(it.userNote);
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

  /* ---------- DOCX (WordprocessingML) ---------- */

  var DX_INK = '20302C', DX_MUTE = '5E6E69', DX_ACCENT = '0E6E5C', DX_LINE = 'C9C7BC';

  /* run — o: {font, sz(half-points), b, i, color, caps, spc(letter spacing, 1/20 pt)} */
  function dxRun(text, o) {
    o = o || {};
    var f = o.font || 'Georgia';
    return '<w:r><w:rPr><w:rFonts w:ascii="' + f + '" w:hAnsi="' + f + '"/>' +
      (o.b ? '<w:b/>' : '') + (o.i ? '<w:i/>' : '') + (o.caps ? '<w:caps/>' : '') +
      '<w:color w:val="' + (o.color || DX_INK) + '"/>' +
      (o.spc ? '<w:spacing w:val="' + o.spc + '"/>' : '') +
      '<w:sz w:val="' + (o.sz || 23) + '"/></w:rPr>' +
      '<w:t xml:space="preserve">' + xesc(text) + '</w:t></w:r>';
  }

  /* paragraph — o: {before, after (twentieths of a pt), brk, keepNext, bdr:{sz(1/8 pt), color, space}} */
  function dxP(runs, o) {
    o = o || {};
    var ppr = '<w:pPr>' +
      (o.keepNext ? '<w:keepNext/>' : '') +
      (o.brk ? '<w:pageBreakBefore/>' : '') +
      (o.bdr ? '<w:pBdr><w:bottom w:val="single" w:sz="' + o.bdr.sz + '" w:space="' + (o.bdr.space || 4) +
        '" w:color="' + o.bdr.color + '"/></w:pBdr>' : '') +
      '<w:spacing w:before="' + (o.before || 0) + '" w:after="' + (o.after == null ? 120 : o.after) + '"/>' +
      '</w:pPr>';
    return '<w:p>' + ppr + (Array.isArray(runs) ? runs.join('') : (runs || '')) + '</w:p>';
  }

  function dxCover(o, kicker) {
    var bits = coverBits(o);
    return dxP(dxRun(kicker, { font: 'Arial', sz: 18, b: 1, color: DX_ACCENT, caps: 1, spc: 30 }), { after: 200 }) +
      dxP(dxRun(o.title, { sz: 52, b: 1 }), { after: 120 }) +
      (o.subtitle ? dxP(dxRun(o.subtitle, { sz: 26, color: DX_MUTE }), { after: 80 }) : '') +
      dxP(bits ? dxRun(bits, { font: 'Arial', sz: 19, color: DX_MUTE }) : dxRun(' ', { sz: 8 }),
        { before: 120, after: 400, bdr: { sz: 18, color: DX_ACCENT, space: 14 } });
  }

  function dxItem(it, o, brk) {
    var runs = [];
    if (o.numbers) runs.push(dxRun(it.n + '.  ', { font: 'Arial', sz: 20, b: 1, color: DX_ACCENT }));
    runs.push(dxRun(it.text, { sz: 25 }));
    var xml = dxP(runs, { after: 80, brk: brk });
    var m = metaLine(it, o);
    if (m) xml += dxP(dxRun(m, { font: 'Arial', sz: 17, color: DX_MUTE }), { after: 60 });
    if (o.guidance && it.srcNote) xml += dxP(dxRun('Guidance: ' + it.srcNote, { sz: 21, i: 1, color: DX_MUTE }), { after: 60 });
    if (o.myNotes && it.userNote) xml += dxP(dxRun('Facilitator note: ' + it.userNote, { sz: 21, i: 1, color: DX_MUTE }), { after: 60 });
    for (var k = 0; k < (o.lines || 0); k++) {
      xml += dxP(dxRun(' ', { sz: 20 }), { after: 280, bdr: { sz: 6, color: DX_LINE, space: 1 } });
    }
    xml += dxP(dxRun(' ', { sz: 8 }), { after: 120 }); // gap between items
    return xml;
  }

  function docxPackage(bodyXml) {
    var W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    var doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<w:document ' + W_NS + '><w:body>' + bodyXml +
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
      '<w:pgMar w:top="1440" w:right="1296" w:bottom="1440" w:left="1296" w:header="720" w:footer="720" w:gutter="0"/>' +
      '</w:sectPr></w:body></w:document>';
    var styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<w:styles ' + W_NS + '><w:docDefaults><w:rPrDefault><w:rPr>' +
      '<w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:sz w:val="23"/><w:color w:val="' + DX_INK + '"/>' +
      '</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
      '</w:docDefaults></w:styles>';
    return zipStore([
      {
        name: '[Content_Types].xml',
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
          '</Types>'
      },
      {
        name: '_rels/.rels',
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="' + REL_NS + '">' +
          '<Relationship Id="rId1" Type="' + OD_REL + '/officeDocument" Target="word/document.xml"/></Relationships>'
      },
      {
        name: 'word/_rels/document.xml.rels',
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="' + REL_NS + '">' +
          '<Relationship Id="rId1" Type="' + OD_REL + '/styles" Target="styles.xml"/></Relationships>'
      },
      { name: 'word/document.xml', data: doc },
      { name: 'word/styles.xml', data: styles }
    ]);
  }

  /* Discussion guide .docx */
  function buildDocx(items, o) {
    var body = dxCover(o, 'SELN Strategic Reflection Guide · ' + items.length +
      (items.length === 1 ? ' prompt' : ' prompts'));
    var first = true;
    if (o.groupBy) {
      groupItems(items, o.groupBy).forEach(function (sec) {
        body += dxP(dxRun(sec.category, { sz: 30, b: 1, color: DX_ACCENT }),
          { before: 320, after: 160, keepNext: 1, bdr: { sz: 8, color: DX_LINE, space: 4 }, brk: o.breaks && !first });
        sec.items.forEach(function (it, i) {
          body += dxItem(it, o, o.breaks && i > 0);
          first = false;
        });
      });
    } else {
      items.forEach(function (it) {
        body += dxItem(it, o, o.breaks && !first);
        first = false;
      });
    }
    return docxPackage(body);
  }

  /* Timed agenda .docx */
  function buildAgendaDocx(items, o) {
    var d = agendaData(items, o);
    var header = Object.assign({}, o, {
      dateStr: [o.dateStr, d.span].filter(Boolean).join('  ·  ')
    });
    var body = dxCover(header, 'Meeting Agenda');

    function tc(w, paras, hdr) {
      return '<w:tc><w:tcPr><w:tcW w:w="' + w + '" w:type="dxa"/>' +
        (hdr ? '<w:tcBorders><w:bottom w:val="single" w:sz="12" w:color="' + DX_ACCENT + '"/></w:tcBorders>' : '') +
        '</w:tcPr>' + paras + '</w:tc>';
    }
    function hcell(w, label) {
      return tc(w, dxP(dxRun(label, { font: 'Arial', sz: 16, b: 1, color: DX_MUTE, caps: 1, spc: 20 }), { after: 40 }), true);
    }

    var tbl = '<w:tbl><w:tblPr><w:tblW w:w="9648" w:type="dxa"/>' +
      '<w:tblBorders><w:bottom w:val="single" w:sz="4" w:color="' + DX_LINE + '"/>' +
      '<w:insideH w:val="single" w:sz="4" w:color="' + DX_LINE + '"/></w:tblBorders>' +
      '<w:tblCellMar><w:top w:w="100" w:type="dxa"/><w:left w:w="0" w:type="dxa"/>' +
      '<w:bottom w:w="100" w:type="dxa"/><w:right w:w="140" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="1500"/><w:gridCol w:w="800"/><w:gridCol w:w="7348"/></w:tblGrid>' +
      '<w:tr>' + hcell(1500, 'Time') + hcell(800, 'Min') + hcell(7348, 'Item') + '</w:tr>';

    d.rows.forEach(function (r) {
      var itemParas = dxP(dxRun(r.title, { sz: 23, b: 1 }), { after: 40 });
      if (r.meta) itemParas += dxP(dxRun(r.meta, { font: 'Arial', sz: 16, color: DX_MUTE }), { after: 40 });
      r.notes.forEach(function (nt) {
        itemParas += dxP(dxRun(nt, { sz: 19, i: 1, color: DX_MUTE }), { after: 40 });
      });
      tbl += '<w:tr>' +
        tc(1500, dxP(dxRun(fmt12(r.t), { font: 'Arial', sz: 20, b: 1, color: DX_ACCENT }), { after: 40 })) +
        tc(800, dxP(dxRun(String(r.min), { font: 'Arial', sz: 20, color: DX_MUTE }), { after: 40 })) +
        tc(7348, itemParas) +
        '</w:tr>';
    });
    tbl += '</w:tbl>';

    return docxPackage(body + tbl + dxP(dxRun(' ', { sz: 8 }), { after: 0 }));
  }

  /* ---------- PDF ---------- */

  var PDF_FONTS = { T: 'Times-Roman', TB: 'Times-Bold', TI: 'Times-Italic', H: 'Helvetica', HB: 'Helvetica-Bold' };
  var PDF_REF = { T: 'F1', TB: 'F2', TI: 'F3', H: 'F4', HB: 'F5' };
  var P_INK = '0.125 0.188 0.172', P_ACCENT = '0.055 0.431 0.361',
    P_MUTE = '0.369 0.431 0.412', P_LINE = '0.788 0.780 0.737';

  /* Map common typographic Unicode to WinAnsi bytes; anything unmappable becomes '?'. */
  var WIN_MAP = {
    0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2013: 0x96, 0x2014: 0x97,
    0x2022: 0x95, 0x2026: 0x85, 0x2039: 0x8B, 0x203A: 0x9B, 0x0152: 0x8C, 0x0153: 0x9C,
    0x2020: 0x86, 0x2021: 0x87, 0x2030: 0x89, 0x0160: 0x8A, 0x0161: 0x9A, 0x0178: 0x9F,
    0x017D: 0x8E, 0x017E: 0x9E, 0x0192: 0x83, 0x02C6: 0x88, 0x02DC: 0x98, 0x2122: 0x99
  };

  function pdfEnc(t) {
    var out = '';
    for (var i = 0; i < t.length; i++) {
      var c = t.charCodeAt(i);
      if (WIN_MAP[c]) c = WIN_MAP[c];
      if (c > 255) c = 63; // '?'
      if (c === 92) out += '\\\\';
      else if (c === 40) out += '\\(';
      else if (c === 41) out += '\\)';
      else out += String.fromCharCode(c);
    }
    return out;
  }

  /* Fallback text measurer for non-browser use; the app passes a canvas-based one. */
  function approxMeasure(text, font, size) {
    var f = (font === 'H' || font === 'HB') ? 0.52 : 0.5;
    return text.length * size * f;
  }

  /* items + opts as elsewhere; measure(text, fontKey, size) -> width in points.
     agendaMode: false = discussion guide, true = timed agenda. */
  function buildPdf(items, o, measure, agendaMode) {
    measure = measure || approxMeasure;
    var PW = 612, PH = 792, M = 64, CW = PW - 2 * M;
    var pages = [], ops = null, y = 0;

    function newPage() { ops = []; pages.push(ops); y = PH - M; }
    function need(h) { if (y - h < M) newPage(); }
    function hline(x1, x2, wd, col) {
      ops.push(wd + ' w ' + col + ' RG ' + x1.toFixed(1) + ' ' + y.toFixed(1) + ' m ' +
        x2.toFixed(1) + ' ' + y.toFixed(1) + ' l S');
    }
    function put(x, t, f, size, col) {
      ops.push('BT /' + PDF_REF[f] + ' ' + size + ' Tf ' + col + ' rg 1 0 0 1 ' +
        x.toFixed(1) + ' ' + (y - size * 0.85).toFixed(1) + ' Tm (' + pdfEnc(t) + ') Tj ET');
    }
    function wrap(t, f, size, w) {
      var words = String(t).split(/\s+/).filter(Boolean);
      var lines = [], cur = '';
      words.forEach(function (word) {
        var trial = cur ? cur + ' ' + word : word;
        if (cur && measure(trial, f, size) > w * 0.985) { lines.push(cur); cur = word; }
        else cur = trial;
      });
      if (cur) lines.push(cur);
      return lines.length ? lines : [''];
    }
    function paraOut(t, f, size, col, x, w, lh, after) {
      wrap(t, f, size, w).forEach(function (ln) {
        need(lh);
        put(x, ln, f, size, col);
        y -= lh;
      });
      y -= (after || 0);
    }

    newPage();

    // Cover header
    var kicker = agendaMode ? 'MEETING AGENDA'
      : ('SELN STRATEGIC REFLECTION GUIDE · ' + items.length + (items.length === 1 ? ' PROMPT' : ' PROMPTS'));
    var agd = agendaMode ? agendaData(items, o) : null;
    var bits = coverBits(agendaMode
      ? Object.assign({}, o, { dateStr: [o.dateStr, agd.span].filter(Boolean).join('  ·  ') })
      : o);
    paraOut(kicker, 'HB', 9, P_ACCENT, M, CW, 13, 4);
    paraOut(o.title, 'TB', 24, P_INK, M, CW, 29, 2);
    if (o.subtitle) paraOut(o.subtitle, 'T', 12.5, P_MUTE, M, CW, 17, 2);
    if (bits) paraOut(bits, 'H', 9, P_MUTE, M, CW, 13, 0);
    y -= 8;
    hline(M, PW - M, 2, P_ACCENT);
    y -= 26;

    if (agendaMode) {
      var timeX = M, minX = M + 76, itemX = M + 122, itemW = CW - 122;
      function agHeader() {
        put(timeX, 'TIME', 'HB', 8, P_MUTE);
        put(minX, 'MIN', 'HB', 8, P_MUTE);
        put(itemX, 'ITEM', 'HB', 8, P_MUTE);
        y -= 13;
        hline(M, PW - M, 1.2, P_ACCENT);
        y -= 10;
      }
      agHeader();
      agd.rows.forEach(function (r) {
        var titleLines = wrap(r.title, 'TB', 11.5, itemW);
        var metaLines = r.meta ? wrap(r.meta, 'H', 8, itemW) : [];
        var noteLines = [];
        r.notes.forEach(function (nt) { noteLines = noteLines.concat(wrap(nt, 'TI', 9.5, itemW)); });
        var rowH = titleLines.length * 15 + metaLines.length * 11 + noteLines.length * 12.5 + 12;
        if (y - rowH < M) { newPage(); agHeader(); }
        put(timeX, fmt12(r.t), 'HB', 9.5, P_ACCENT);
        put(minX, String(r.min), 'H', 9.5, P_MUTE);
        titleLines.forEach(function (ln) { put(itemX, ln, 'TB', 11.5, P_INK); y -= 15; });
        metaLines.forEach(function (ln) { put(itemX, ln, 'H', 8, P_MUTE); y -= 11; });
        noteLines.forEach(function (ln) { put(itemX, ln, 'TI', 9.5, P_MUTE); y -= 12.5; });
        y -= 6;
        hline(M, PW - M, 0.7, P_LINE);
        y -= 10;
      });
    } else {
      var first = true;
      function itemPdf(it) {
        if (o.breaks && !first) newPage();
        var body = (o.numbers ? it.n + '.  ' : '') + it.text;
        var est = wrap(body, 'T', 12.5, CW).length * 18 + 26;
        need(Math.min(est, PH - 2 * M));
        paraOut(body, 'T', 12.5, P_INK, M, CW, 18, 2);
        var m = metaLine(it, o);
        if (m) paraOut(m, 'H', 8.5, P_MUTE, M, CW, 12, 2);
        if (o.guidance && it.srcNote) paraOut('Guidance: ' + it.srcNote, 'TI', 10.5, P_MUTE, M, CW, 14, 2);
        if (o.myNotes && it.userNote) paraOut('Facilitator note: ' + it.userNote, 'TI', 10.5, P_MUTE, M, CW, 14, 2);
        for (var k = 0; k < (o.lines || 0); k++) {
          need(24);
          y -= 20;
          hline(M, PW - M, 0.7, P_LINE);
          y -= 3;
        }
        y -= 12;
        first = false;
      }
      if (o.groupBy) {
        groupItems(items, o.groupBy).forEach(function (sec) {
          if (o.breaks && !first) newPage();
          need(60);
          paraOut(sec.category, 'TB', 13, P_ACCENT, M, CW, 17, 0);
          y -= 3;
          hline(M, PW - M, 0.7, P_LINE);
          y -= 14;
          sec.items.forEach(itemPdf);
        });
      } else {
        items.forEach(itemPdf);
      }
    }

    // Page-number footers (added after pagination so totals are known)
    var total = pages.length;
    pages.forEach(function (p, i) {
      var t = 'Page ' + (i + 1) + ' of ' + total;
      var w = measure(t, 'H', 8);
      p.push('BT /F4 8 Tf ' + P_MUTE + ' rg 1 0 0 1 ' + ((PW - w) / 2).toFixed(1) + ' 32 Tm (' + pdfEnc(t) + ') Tj ET');
    });

    // Assemble: obj 1 catalog, 2 pages, 3-7 fonts, then page/content pairs
    var objs = [];
    var kids = pages.map(function (_, i) { return (8 + 2 * i) + ' 0 R'; }).join(' ');
    objs.push('<< /Type /Catalog /Pages 2 0 R >>');
    objs.push('<< /Type /Pages /Kids [' + kids + '] /Count ' + total + ' >>');
    ['T', 'TB', 'TI', 'H', 'HB'].forEach(function (k) {
      objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /' + PDF_FONTS[k] + ' /Encoding /WinAnsiEncoding >>');
    });
    pages.forEach(function (p, i) {
      objs.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PW + ' ' + PH + '] ' +
        '/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R /F5 7 0 R >> >> ' +
        '/Contents ' + (9 + 2 * i) + ' 0 R >>');
      var s = p.join('\n');
      objs.push('<< /Length ' + s.length + ' >>\nstream\n' + s + '\nendstream');
    });

    var out = '%PDF-1.4\n%âãÏÓ\n';
    var offsets = [];
    objs.forEach(function (obj, i) {
      offsets.push(out.length);
      out += (i + 1) + ' 0 obj\n' + obj + '\nendobj\n';
    });
    var xref = out.length;
    out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
    offsets.forEach(function (off) {
      out += ('0000000000' + off).slice(-10) + ' 00000 n \n';
    });
    out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';

    var bytes = new Uint8Array(out.length);
    for (var i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xFF;
    return bytes;
  }

  return {
    xesc: xesc, hesc: hesc, slug: slug, fmt12: fmt12, parseHM: parseHM, longDate: longDate,
    agendaData: agendaData, crc32: crc32, zipStore: zipStore,
    buildPptx: buildPptx, buildDocx: buildDocx, buildAgendaDocx: buildAgendaDocx, buildPdf: buildPdf
  };
});
