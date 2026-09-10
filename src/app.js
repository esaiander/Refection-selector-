/* SELN Prompt Studio — UI logic. Expects globals: SELN (data), SelnExport (builders). */
(function () {
  'use strict';

  var X = SelnExport;
  var PROMPTS = SELN.prompts.map(function (p, i) { return Object.assign({ _i: i }, p); });
  var META = SELN.meta;
  var TYPE_ORDER = { 'Opener': 0, 'Core Question': 1, 'Follow-up': 2, 'Closing': 3 };
  var ED_ORDER = {};
  META.editions.forEach(function (e, i) { ED_ORDER[e.name] = i; });

  var ED_COLORS = {
    'State Team': '#0E6E5C', 'Self-Guided': '#3D5A9E', 'Provider': '#B0641C',
    'Family & Individual': '#A84465', 'Case Manager': '#7A4E9E', 'Waiver Manager': '#2C6E8F',
    'School Transition': '#66701F', 'VR Partnership': '#A6432C', 'Quality & Compliance': '#5E7069',
    'Self-Advocate': '#6C4AB0', 'Executive Leadership': '#31536B', 'Facilitator Tools': '#8A6A1F',
    'Custom': '#5E6E69'
  };

  var DEPTH_LABELS = { 1: 'Warm-up', 2: 'Explore', 3: 'Probe', 4: 'Reimagine' };
  var DEPTH_DESC = {
    1: 'ease in with stories and strengths',
    2: 'map the current state',
    3: 'examine tensions and evidence',
    4: 'imagine changes and commit'
  };
  function depthMeter(d) {
    if (!d) return '';
    var bars = '';
    for (var i = 1; i <= 4; i++) bars += '<i' + (i <= d ? ' class="on"' : '') + '></i>';
    return '<span class="depth" title="Depth ' + d + ' of 4 — ' + DEPTH_LABELS[d] + ': ' + DEPTH_DESC[d] + '">' +
      bars + '</span>';
  }

  // SELN Framework categories (meta.framework_categories), colored by position
  var FW_CATS = META.framework_categories || [];
  var FW_PALETTE = ['#0E6E5C', '#B0641C', '#3D5A9E', '#A84465', '#6C4AB0', '#2C6E8F', '#8A6A1F', '#A6432C'];
  var FW_COLORS = {};
  FW_CATS.forEach(function (c, i) { FW_COLORS[c] = FW_PALETTE[i % FW_PALETTE.length]; });

  function esc(s) { return X.hesc(s == null ? '' : s); }
  function $(sel) { return document.querySelector(sel); }

  /* ---------- state ---------- */

  var uidCounter = 1;
  var state = {
    q: '', eds: new Set(), fws: new Set(), types: new Set(), depths: new Set(), sort: 'guide',
    view: 'library', condense: 'sim', // 'all' | 'sim' (fold rewordings) | 'theme'
    sel: [],
    doc: { title: '', subtitle: '', facilitator: '', org: '', date: new Date().toISOString().slice(0, 10) },
    exp: {
      format: 'word', numbers: true, ids: true, showEd: true, showFw: true, showCat: false, showType: false,
      guidance: true, myNotes: true, groupBy: '', breaks: false, lines: 0,
      agStart: '09:00', agMins: 10, agWelcome: true, agWelcomeMins: 10, agClosing: true, agClosingMins: 10
    }
  };

  var STORE_KEY = 'seln-prompt-studio-v1';
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ sel: state.sel, doc: state.doc, exp: state.exp, condense: state.condense }));
    } catch (e) { /* storage unavailable — session-only */ }
  }
  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (Array.isArray(d.sel)) state.sel = d.sel;
      if (typeof d.condense === 'boolean') state.condense = d.condense ? 'sim' : 'all';
      else if (d.condense === 'all' || d.condense === 'sim' || d.condense === 'theme') state.condense = d.condense;
      if (d.doc) Object.assign(state.doc, d.doc);
      if (d.exp) {
        Object.assign(state.exp, d.exp);
        // migrate options saved by earlier versions
        if (typeof d.exp.meta === 'boolean') {
          state.exp.showEd = state.exp.showCat = state.exp.showType = d.exp.meta;
        }
        if (typeof d.exp.notes === 'boolean') state.exp.guidance = state.exp.myNotes = d.exp.notes;
        if (d.exp.group === true && !d.exp.groupBy) state.exp.groupBy = 'category';
      }
      state.sel.forEach(function (s) {
        uidCounter = Math.max(uidCounter, (s.uid || 0) + 1);
        // backfill fields on sets saved before they existed
        if (s.fw == null || s.depth === undefined) {
          var p = s.srcId && PROMPTS.find(function (x) { return x.id === s.srcId; });
          if (s.fw == null) s.fw = p ? p.framework_category : '';
          if (s.depth === undefined) s.depth = p ? p.depth : null;
        }
      });
    } catch (e) { /* corrupted store — start fresh */ }
  }

  /* ---------- selection helpers ---------- */

  function selIds() {
    var set = new Set();
    state.sel.forEach(function (s) { if (s.srcId) set.add(s.srcId); });
    return set;
  }

  function addPrompt(p) {
    state.sel.push({
      uid: uidCounter++, srcId: p.id, text: p.prompt, edition: p.edition,
      fw: p.framework_category || '', category: p.category, type: p.type,
      depth: p.depth || null, srcNote: p.notes || '', userNote: ''
    });
  }

  function removeBySrcId(id) {
    state.sel = state.sel.filter(function (s) { return s.srcId !== id; });
  }

  /* ---------- filtering + sorting ---------- */

  function filtered() {
    var q = state.q.trim().toLowerCase();
    var list = PROMPTS.filter(function (p) {
      if (state.eds.size && !state.eds.has(p.edition)) return false;
      if (state.types.size && !state.types.has(p.type)) return false;
      if (state.fws.size && !state.fws.has(p.framework_category)) return false;
      if (state.depths.size && !state.depths.has(String(p.depth))) return false;
      if (q) {
        var hay = (p.prompt + ' ' + p.framework_category + ' ' + p.category + ' ' + p.id + ' ' +
          p.edition + ' ' + (p.notes || '')).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    var s = state.sort;
    if (s === 'az') list.sort(function (a, b) { return a.prompt.localeCompare(b.prompt); });
    else if (s === 'category') {
      list.sort(function (a, b) {
        return a.framework_category.localeCompare(b.framework_category) ||
          a.category.localeCompare(b.category) || a._i - b._i;
      });
    }
    else if (s === 'type') list.sort(function (a, b) { return (TYPE_ORDER[a.type] - TYPE_ORDER[b.type]) || a._i - b._i; });
    else if (s === 'edition') list.sort(function (a, b) { return (ED_ORDER[a.edition] - ED_ORDER[b.edition]) || a._i - b._i; });
    else if (s === 'depth') list.sort(function (a, b) { return (a.depth - b.depth) || a._i - b._i; });
    return list;
  }

  function filterCount() { return state.eds.size + state.fws.size + state.types.size + state.depths.size; }

  /* ---------- rendering ---------- */

  function badge(edition) {
    var c = ED_COLORS[edition] || ED_COLORS.Custom;
    return '<span class="badge" style="--ed:' + c + '">' + esc(edition) + '</span>';
  }

  function renderChrome() {
    var n = state.sel.length;
    var pill = $('#countPill');
    pill.textContent = n + ' selected';
    pill.classList.toggle('has-items', n > 0);
    var nav = $('#navCount');
    nav.hidden = n === 0;
    nav.textContent = n;
    document.querySelectorAll('#tabs .tab').forEach(function (t) {
      t.classList.toggle('is-active', t.dataset.view === state.view);
    });
    document.querySelectorAll('.view').forEach(function (v) {
      v.hidden = v.id !== 'view-' + state.view;
    });
    var fc = $('#filterCount');
    fc.hidden = filterCount() === 0;
    fc.textContent = filterCount();
  }

  var FW_COUNTS = {};
  PROMPTS.forEach(function (p) {
    FW_COUNTS[p.framework_category] = (FW_COUNTS[p.framework_category] || 0) + 1;
  });

  function renderChips() {
    $('#edChips').innerHTML = META.editions.map(function (e) {
      var on = state.eds.has(e.name);
      return '<button type="button" class="chip' + (on ? ' is-on' : '') + '" style="--ed:' +
        (ED_COLORS[e.name] || '#5E6E69') + '" data-ed="' + esc(e.name) + '" aria-pressed="' + on + '">' +
        esc(e.name) + ' <span style="opacity:.65">' + e.count + '</span></button>';
    }).join('');
    $('#fwChips').innerHTML = FW_CATS.map(function (c) {
      var on = state.fws.has(c);
      return '<button type="button" class="chip' + (on ? ' is-on' : '') + '" style="--ed:' +
        (FW_COLORS[c] || '#5E6E69') + '" data-fw="' + esc(c) + '" aria-pressed="' + on + '">' +
        esc(c) + ' <span style="opacity:.65">' + (FW_COUNTS[c] || 0) + '</span></button>';
    }).join('');
  }

  var openSims = new Set(); // fold clusters expanded in place

  /* The fold key for the active mode: exact rewordings (simKey) or broader
     themes (themeKey, which subsumes the rewording clusters). */
  function foldKeyOf(p) {
    if (state.condense === 'sim') return p.simKey;
    if (state.condense === 'theme') return p.themeKey != null ? p.themeKey : p.simKey;
    return null;
  }

  /* Collapse overlapping prompts: keep the first cluster member in view,
     count the rest behind an expandable chip. */
  function computeVisible(list) {
    if (state.condense === 'all') return { visible: list, extraByKey: {}, condensed: 0 };
    var visible = [], extraByKey = {}, condensed = 0, seen = {};
    list.forEach(function (p) {
      var k = foldKeyOf(p);
      if (k == null || openSims.has(k)) { visible.push(p); return; }
      if (seen[k] === undefined) { seen[k] = true; visible.push(p); }
      else { extraByKey[k] = (extraByKey[k] || 0) + 1; condensed++; }
    });
    return { visible: visible, extraByKey: extraByKey, condensed: condensed };
  }

  /* How the current sort sections the list (null = no section headers). */
  function sectionValueFn() {
    if (state.sort === 'category') return function (p) { return p.framework_category || 'Other'; };
    if (state.sort === 'edition' || state.sort === 'guide') return function (p) { return p.edition; };
    if (state.sort === 'type') return function (p) { return p.type; };
    if (state.sort === 'depth') return function (p) { return DEPTH_LABELS[p.depth] || 'Other'; };
    return null;
  }
  function sectionColor(value) {
    if (state.sort === 'category') return FW_COLORS[value] || '#5E6E69';
    if (state.sort === 'edition' || state.sort === 'guide') return ED_COLORS[value] || '#5E6E69';
    return 'var(--accent)';
  }

  function cardHtml(p, ids, extraByKey) {
    var added = ids.has(p.id);
    var k = foldKeyOf(p);
    var open = k != null && openSims.has(k);
    var themed = state.condense === 'theme';
    var simBtn = '';
    if (k != null) {
      if (open) {
        simBtn = '<button type="button" class="btn sim-btn" data-sim="' + k + '">' +
          (themed ? 'Hide theme' : 'Hide similar') + '</button>';
      } else if (extraByKey[k]) {
        simBtn = '<button type="button" class="btn sim-btn" data-sim="' + k + '">+' + extraByKey[k] +
          (themed ? ' on this theme' : ' similar') + '</button>';
      }
    }
    return '<article class="pcard' + (added ? ' is-selected' : '') + (open ? ' is-variant' : '') + '">' +
      '<div class="pcard-head">' + badge(p.edition) +
      '<span class="ttag">' + esc(p.type) + '</span>' + depthMeter(p.depth) +
      '<span class="pid">' + esc(p.id) + '</span></div>' +
      '<div class="pcard-cat"><b class="fw-name" style="--ed:' + (FW_COLORS[p.framework_category] || '#5E6E69') + '">' +
      esc(p.framework_category) + '</b> · ' + esc(p.category) + '</div>' +
      '<p class="pcard-text">' + esc(p.prompt) + '</p>' +
      (p.notes ? '<p class="pcard-note">' + esc(p.notes) + '</p>' : '') +
      '<div class="pcard-foot">' + simBtn + '<button type="button" class="btn add-btn' + (added ? ' is-added' : '') +
      '" data-toggle="' + esc(p.id) + '">' + (added ? 'Added ✓' : 'Add') + '</button></div>' +
      '</article>';
  }

  function renderCards() {
    var cv = computeVisible(filtered());
    var visible = cv.visible;
    var ids = selIds();
    $('#resultCount').textContent = visible.length + ' of ' + PROMPTS.length + ' prompts' +
      (cv.condensed ? ' · ' + cv.condensed + (state.condense === 'theme' ? ' folded into themes' : ' similar collapsed') : '');
    $('#addAllBtn').hidden = visible.length === 0 || visible.every(function (p) { return ids.has(p.id); });
    if (!visible.length) {
      $('#cards').innerHTML = '<div class="lib-empty">No prompts match — try clearing a filter or changing your search.</div>';
      return;
    }
    var valueFn = sectionValueFn();
    var html = '';
    if (valueFn) {
      // sorted lists are contiguous by the section value, so count each run
      var runs = [];
      visible.forEach(function (p) {
        var v = valueFn(p);
        if (!runs.length || runs[runs.length - 1].value !== v) runs.push({ value: v, items: [] });
        runs[runs.length - 1].items.push(p);
      });
      runs.forEach(function (r) {
        var unadded = r.items.some(function (p) { return !ids.has(p.id); });
        html += '<div class="sec-head" style="--ed:' + sectionColor(r.value) + '"><b>' + esc(r.value) +
          '</b><span class="sec-n">' + r.items.length + '</span>' +
          (unadded ? '<button type="button" class="btn btn-ghost" data-addsec="' + esc(r.value) + '">Add shown</button>' : '') +
          '</div>';
        html += r.items.map(function (p) { return cardHtml(p, ids, cv.extraByKey); }).join('');
      });
    } else {
      html = visible.map(function (p) { return cardHtml(p, ids, cv.extraByKey); }).join('');
    }
    $('#cards').innerHTML = html;
  }

  var SIM_KEY = {};
  PROMPTS.forEach(function (p) { if (p.simKey != null) SIM_KEY[p.id] = p.simKey; });

  function renderSet() {
    var n = state.sel.length;
    $('#setEmpty').hidden = n > 0;
    $('#setActions').hidden = n === 0;
    $('#setSummary').textContent = n
      ? n + (n === 1 ? ' prompt' : ' prompts') + ' — drag (or use arrows) to reorder; tap Edit to reword.'
      : 'Arrange, edit, and annotate your selected prompts.';
    // flag items that are near-duplicates of an earlier item in the set
    var firstBySim = {}, warns = {};
    state.sel.forEach(function (s, i) {
      var k = SIM_KEY[s.srcId];
      if (k == null) return;
      if (firstBySim[k] === undefined) firstBySim[k] = i;
      else warns[s.uid] = firstBySim[k] + 1;
    });
    $('#setList').innerHTML = state.sel.map(function (s, i) {
      return '<li class="set-item" draggable="true" data-uid="' + s.uid + '">' +
        '<div class="item-head">' +
        '<span class="drag-handle" aria-hidden="true">⠿</span>' +
        '<span class="item-num">' + (i + 1) + '</span>' +
        badge(s.edition) + depthMeter(s.depth) +
        '<span class="pcard-cat">' + esc(s.fw ? s.fw + ' · ' + s.category : s.category) + '</span>' +
        (s.srcId ? '<span class="pid">' + esc(s.srcId) + '</span>' : '<span class="pid">custom</span>') +
        '</div>' +
        '<p class="item-text">' + esc(s.text) + '</p>' +
        (warns[s.uid] ? '<p class="item-warn">Similar wording to #' + warns[s.uid] + ' in your set</p>' : '') +
        (s.srcNote ? '<p class="item-srcnote">Guidance: ' + esc(s.srcNote) + '</p>' : '') +
        '<textarea class="item-note" data-note="' + s.uid + '" rows="1" placeholder="Facilitator note (optional) — appears in exports">' + esc(s.userNote) + '</textarea>' +
        '<div class="item-actions">' +
        '<button type="button" class="btn" data-move="up" data-uid="' + s.uid + '" aria-label="Move up"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button type="button" class="btn" data-move="down" data-uid="' + s.uid + '" aria-label="Move down"' + (i === n - 1 ? ' disabled' : '') + '>↓</button>' +
        '<button type="button" class="btn" data-edit="' + s.uid + '">Edit</button>' +
        '<button type="button" class="btn btn-danger-ghost" data-remove="' + s.uid + '">Remove</button>' +
        '</div>' +
        '<div class="item-edit" hidden data-editbox="' + s.uid + '">' +
        '<textarea>' + esc(s.text) + '</textarea>' +
        '<div class="form-row">' +
        '<button type="button" class="btn btn-primary" data-save-edit="' + s.uid + '">Save</button>' +
        '<button type="button" class="btn" data-cancel-edit="' + s.uid + '">Cancel</button>' +
        '</div></div>' +
        '</li>';
    }).join('');
  }

  function agendaSpan() {
    var e = state.exp;
    var start = X.parseHM(e.agStart);
    var total = (e.agWelcome ? Math.max(1, +e.agWelcomeMins || 10) : 0) +
      (e.agClosing ? Math.max(1, +e.agClosingMins || 10) : 0) +
      state.sel.length * Math.max(1, +e.agMins || 10);
    return X.fmt12(start) + ' – ' + X.fmt12(start + total) + ' (' + total + ' min)';
  }

  function renderExport() {
    var n = state.sel.length;
    var e = state.exp;
    var fmtNames = { word: 'Word document', pptx: 'PowerPoint deck', agenda: 'meeting agenda', pdf: 'PDF / print view' };
    $('#exportSummary').textContent = n
      ? 'Exporting ' + n + (n === 1 ? ' prompt' : ' prompts') + ' as a ' + fmtNames[e.format] + '.'
      : 'Your set is empty — add prompts from the library first.';
    $('#agendaOpts').hidden = e.format !== 'agenda';
    document.querySelectorAll('.doc-only').forEach(function (el) {
      el.style.display = (e.format === 'word' || e.format === 'pdf') ? '' : 'none';
    });
    var exportBtn = $('#exportBtn');
    var labels = { word: 'Download .docx', pptx: 'Download .pptx', agenda: 'Download agenda .docx', pdf: 'Download .pdf' };
    exportBtn.textContent = labels[e.format];
    exportBtn.disabled = n === 0;
    var altBtn = $('#altBtn');
    altBtn.hidden = e.format !== 'agenda';
    altBtn.disabled = n === 0;
    $('#previewBtn').disabled = n === 0;
    $('#exportHint').textContent = (e.format === 'agenda' && n) ? 'Runs ' + agendaSpan() : '';
  }

  function render() {
    renderChrome();
    if (state.view === 'library') { renderChips(); renderCards(); }
    else if (state.view === 'set') renderSet();
    else renderExport();
    save();
  }

  function go(view) { state.view = view; window.scrollTo(0, 0); render(); }

  /* ---------- toast ---------- */

  var toastTimer = null;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  /* ---------- filter sheet ---------- */

  function checkRow(group, value, label, checked) {
    return '<label class="check"><input type="checkbox" data-fgroup="' + group + '" value="' + esc(value) + '"' +
      (checked ? ' checked' : '') + '>' + label + '</label>';
  }

  var DEPTH_COUNTS = {};
  PROMPTS.forEach(function (p) { DEPTH_COUNTS[p.depth] = (DEPTH_COUNTS[p.depth] || 0) + 1; });

  function renderSheet() {
    $('#fDepths').innerHTML = [1, 2, 3, 4].map(function (dNum) {
      return checkRow('depths', String(dNum),
        depthMeter(dNum) + ' ' + esc(DEPTH_LABELS[dNum]) +
        ' <span style="color:var(--mute)">— ' + DEPTH_DESC[dNum] + ' (' + (DEPTH_COUNTS[dNum] || 0) + ')</span>',
        state.depths.has(String(dNum)));
    }).join('');
    $('#fTypes').innerHTML = META.types.map(function (t) {
      return checkRow('types', t, esc(t), state.types.has(t));
    }).join('');
    $('#fEds').innerHTML = META.editions.map(function (e) {
      return checkRow('eds', e.name, esc(e.name) + ' <span style="color:var(--mute)">(' + e.count + ')</span>', state.eds.has(e.name));
    }).join('');
    $('#fCats').innerHTML = FW_CATS.map(function (c) {
      return checkRow('fws', c, esc(c) + ' <span style="color:var(--mute)">(' + (FW_COUNTS[c] || 0) + ')</span>', state.fws.has(c));
    }).join('');
    $('#applyFilters').textContent = 'Show ' + filtered().length + ' prompts';
  }

  function openSheet() { renderSheet(); $('#filterBackdrop').hidden = false; }
  function closeSheet() { $('#filterBackdrop').hidden = true; render(); }

  /* ---------- export ---------- */

  function exportItems() {
    var e = state.exp;
    var items = state.sel.map(function (s) {
      return {
        text: s.text, id: s.srcId || '', edition: s.edition, fw: s.fw || '',
        category: s.category, type: s.type === 'Custom' ? '' : s.type,
        depth: s.depth || null, arc: s.depth ? DEPTH_LABELS[s.depth] : 'Other',
        srcNote: s.srcNote, userNote: s.userNote
      };
    });
    if (e.groupBy === 'arc') {
      // an arc always runs shallow -> deep regardless of the set's order
      items = items.map(function (it, i) { return { it: it, i: i }; })
        .sort(function (a, b) { return ((a.it.depth || 9) - (b.it.depth || 9)) || (a.i - b.i); })
        .map(function (x) { return x.it; });
    }
    if (e.groupBy) {
      var order = [], map = {};
      items.forEach(function (it) {
        var c = it[e.groupBy] || 'Other';
        if (!map[c]) { map[c] = []; order.push(c); }
        map[c].push(it);
      });
      items = [];
      order.forEach(function (c) { items = items.concat(map[c]); });
    }
    items.forEach(function (it, i) { it.n = i + 1; });
    return items;
  }

  function exportOpts() {
    var d = state.doc, e = state.exp;
    return {
      title: d.title.trim() || 'SELN Reflection Session',
      subtitle: d.subtitle.trim(),
      facilitator: d.facilitator.trim(),
      org: d.org.trim(),
      dateStr: X.longDate(d.date),
      numbers: e.numbers, ids: e.ids, showEd: e.showEd, showFw: e.showFw,
      showCat: e.showCat, showType: e.showType, guidance: e.guidance, myNotes: e.myNotes,
      groupBy: e.groupBy, breaks: e.breaks, lines: +e.lines || 0,
      agenda: {
        start: e.agStart, mins: e.agMins,
        welcome: e.agWelcome, welcomeMins: e.agWelcomeMins,
        closing: e.agClosing, closingMins: e.agClosingMins
      }
    };
  }

  /* When published as a claude.ai artifact, script-driven downloads are inert;
     files must be offered through the viewer's `downloads` capability. The
     standalone index.html (no `claude` global) keeps the plain anchor click. */
  var downloadsReady = (typeof claude !== 'undefined' && claude && claude.use)
    ? claude.use('downloads').catch(function () { return null; })
    : Promise.resolve(null);

  function download(name, blob) {
    downloadsReady.then(function (dl) {
      if (dl) {
        dl.save({ filename: name, data: blob }).then(function () {
          toast('Saved ' + name);
        }).catch(function (e) {
          var code = e && e.code;
          if (code === 'declined') toast('Save canceled');
          else if (code === 'rate_limited') toast('One save at a time — try again in a moment');
          else toast('Could not save ' + name + (e && e.message ? ' — ' + e.message : ''));
        });
        return;
      }
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      toast('Downloaded ' + name);
    });
  }

  /* Text measurement for PDF line wrapping: canvas metrics with metric-compatible
     system faces (Times New Roman ≈ Times, Arial ≈ Helvetica). */
  var measureCtx = document.createElement('canvas').getContext('2d');
  var MEASURE_CSS = {
    T: '"Times New Roman", Times, serif', TB: '"Times New Roman", Times, serif',
    TI: '"Times New Roman", Times, serif', H: 'Arial, Helvetica, sans-serif',
    HB: 'Arial, Helvetica, sans-serif'
  };
  function pdfMeasure(text, font, size) {
    measureCtx.font = (font === 'TI' ? 'italic ' : '') +
      (font === 'TB' || font === 'HB' ? 'bold ' : '') + size + 'px ' + MEASURE_CSS[font];
    return measureCtx.measureText(text).width;
  }

  var MIME = {
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    pdf: 'application/pdf'
  };

  function runExport(alt) {
    if (!state.sel.length) return;
    var items = exportItems();
    var o = exportOpts();
    var fmt = state.exp.format;
    var base = X.slug(o.title);
    var name, bytes, mime;
    if (fmt === 'pptx') {
      name = base + '.pptx'; mime = MIME.pptx;
      bytes = X.buildPptx(items, o);
    } else if (fmt === 'word') {
      name = base + '.docx'; mime = MIME.docx;
      bytes = X.buildDocx(items, o);
    } else if (fmt === 'pdf') {
      name = base + '.pdf'; mime = MIME.pdf;
      bytes = X.buildPdf(items, o, pdfMeasure, false);
    } else if (alt) { // agenda as PDF
      name = base + '-agenda.pdf'; mime = MIME.pdf;
      bytes = X.buildPdf(items, o, pdfMeasure, true);
    } else {
      name = base + '-agenda.docx'; mime = MIME.docx;
      bytes = X.buildAgendaDocx(items, o);
    }
    download(name, new Blob([bytes], { type: mime }));
  }

  /* ---------- export preview ---------- */

  function metaBits(it, o) {
    var bits = [];
    if (o.ids && it.id) bits.push(it.id);
    if (o.showEd && it.edition) bits.push(it.edition);
    if (o.showFw && it.fw) bits.push(it.fw);
    if (o.showCat && it.category) bits.push(it.category);
    if (o.showType && it.type) bits.push(it.type);
    return bits.join(' · ');
  }
  function pvGroups(items, o) {
    if (!o.groupBy) return [{ name: null, items: items }];
    var order = [], map = {};
    items.forEach(function (it) {
      var c = it[o.groupBy] || 'Other';
      if (!map[c]) { map[c] = []; order.push(c); }
      map[c].push(it);
    });
    return order.map(function (c) { return { name: c, items: map[c] }; });
  }
  function pvCover(o, kicker) {
    var bits = [o.dateStr, o.facilitator ? 'Facilitator: ' + o.facilitator : '', o.org]
      .filter(Boolean).join('  ·  ');
    return '<div class="pv-cover"><p class="pv-kicker">' + esc(kicker) + '</p>' +
      '<h1>' + esc(o.title) + '</h1>' +
      (o.subtitle ? '<p class="pv-sub">' + esc(o.subtitle) + '</p>' : '') +
      (bits ? '<p class="pv-cm">' + esc(bits) + '</p>' : '') + '</div>';
  }
  function pvDocHtml(items, o) {
    function one(it) {
      var h = '<div class="pv-item"><p class="pv-q">' +
        (o.numbers ? '<span class="pv-num">' + it.n + '.</span>&nbsp; ' : '') + esc(it.text) + '</p>';
      var m = metaBits(it, o);
      if (m) h += '<p class="pv-meta">' + esc(m) + '</p>';
      if (o.guidance && it.srcNote) h += '<p class="pv-note">Guidance: ' + esc(it.srcNote) + '</p>';
      if (o.myNotes && it.userNote) h += '<p class="pv-note">Facilitator note: ' + esc(it.userNote) + '</p>';
      for (var k = 0; k < o.lines; k++) h += '<div class="pv-line"></div>';
      return h + '</div>';
    }
    var brk = '<div class="pv-brk">page break</div>';
    var html = pvCover(o, 'SELN Strategic Reflection Guide · ' + items.length +
      (items.length === 1 ? ' prompt' : ' prompts'));
    var first = true;
    pvGroups(items, o).forEach(function (g) {
      if (g.name) {
        if (o.breaks && !first) html += brk;
        html += '<h2 class="pv-cat">' + esc(g.name) + '</h2>';
      }
      g.items.forEach(function (it, i) {
        if (o.breaks && !first && !(g.name && i === 0)) html += brk;
        html += one(it);
        first = false;
      });
    });
    return '<div class="pv-page">' + html + '</div>';
  }
  function pvAgendaHtml(items, o) {
    var d = X.agendaData(items, o);
    var o2 = Object.assign({}, o, { dateStr: [o.dateStr, d.span].filter(Boolean).join('  ·  ') });
    var html = pvCover(o2, 'Meeting Agenda') +
      '<table class="pv-agenda"><thead><tr><th>Time</th><th>Min</th><th>Item</th></tr></thead><tbody>';
    d.rows.forEach(function (r) {
      html += '<tr><td class="pv-time">' + X.fmt12(r.t) + '</td><td class="pv-min">' + r.min + '</td><td><b>' +
        esc(r.title) + '</b>' +
        (r.meta ? '<br><span class="pv-meta">' + esc(r.meta) + '</span>' : '') +
        r.notes.map(function (nt) { return '<br><span class="pv-note">' + esc(nt) + '</span>'; }).join('') +
        '</td></tr>';
    });
    return '<div class="pv-page">' + html + '</tbody></table></div>';
  }
  function pvSlidesHtml(items, o) {
    function slide(inner, cls) {
      return '<div class="pv-slide' + (cls ? ' ' + cls : '') + '">' + inner + '</div>';
    }
    var bits = [o.facilitator ? 'Facilitated by ' + o.facilitator : '', o.org, o.dateStr]
      .filter(Boolean).join('  ·  ');
    var html = slide(
      '<div class="pv-sl-rule"></div><div class="pv-sl-kicker">' +
      esc(items.length + ' reflection prompts — SELN Strategic Reflection Guide') + '</div>' +
      '<div class="pv-sl-title">' + esc(o.title) + '</div>' +
      (o.subtitle ? '<div class="pv-sl-sub">' + esc(o.subtitle) + '</div>' : '') +
      (bits ? '<div class="pv-sl-foot"><span>' + esc(bits) + '</span></div>' : ''));
    pvGroups(items, o).forEach(function (g) {
      if (g.name) {
        html += slide('<div class="pv-sl-rule"></div><div class="pv-sl-kicker">Section</div>' +
          '<div class="pv-sl-title">' + esc(g.name) + '</div>' +
          '<div class="pv-sl-foot"><span>' + g.items.length +
          (g.items.length === 1 ? ' prompt' : ' prompts') + '</span></div>');
      }
      g.items.forEach(function (it) {
        var kick = [];
        if (o.showFw && it.fw) kick.push(it.fw);
        if (o.showCat && it.category) kick.push(it.category);
        if (o.showEd && it.edition) kick.push(it.edition);
        var foot = [];
        if (o.ids && it.id) foot.push(it.id);
        if (o.showType && it.type) foot.push(it.type);
        if (o.guidance && it.srcNote) foot.push(it.srcNote);
        if (o.myNotes && it.userNote) foot.push(it.userNote);
        var sz = it.text.length < 90 ? 'sz1' : it.text.length < 160 ? 'sz2' : it.text.length < 240 ? 'sz3' : 'sz4';
        html += slide(
          (kick.length ? '<div class="pv-sl-kicker">' + esc(kick.join('  ·  ')) + '</div>' : '') +
          '<div class="pv-sl-rule"></div>' +
          '<div class="pv-sl-text ' + sz + '"><span>' + esc(it.text) + '</span></div>' +
          '<div class="pv-sl-foot"><span>' + esc(foot.join('  ·  ')) + '</span><span>' +
          it.n + ' / ' + items.length + '</span></div>');
      });
    });
    return html;
  }

  function openPreview() {
    if (!state.sel.length) return;
    var items = exportItems();
    var o = exportOpts();
    var fmt = state.exp.format;
    var names = { word: 'Word document (.docx)', pptx: 'PowerPoint deck (.pptx)', agenda: 'Meeting agenda', pdf: 'PDF handout' };
    $('#pvTitle').textContent = names[fmt];
    $('#pvHint').textContent = fmt === 'agenda'
      ? 'Runs ' + X.agendaData(items, o).span
      : items.length + (items.length === 1 ? ' prompt' : ' prompts');
    $('#pvDownload').textContent = { word: 'Download .docx', pptx: 'Download .pptx', agenda: 'Download .docx', pdf: 'Download .pdf' }[fmt];
    $('#pvBody').innerHTML = fmt === 'pptx' ? pvSlidesHtml(items, o)
      : fmt === 'agenda' ? pvAgendaHtml(items, o)
      : pvDocHtml(items, o);
    $('#pvBody').scrollTop = 0;
    $('#previewBackdrop').hidden = false;
  }
  function closePreview() { $('#previewBackdrop').hidden = true; }

  /* ---------- events ---------- */

  $('#tabs').addEventListener('click', function (ev) {
    var t = ev.target.closest('.tab');
    if (t) go(t.dataset.view);
  });
  $('#countPill').addEventListener('click', function () { go('set'); });
  document.addEventListener('click', function (ev) {
    var g = ev.target.closest('[data-goto]');
    if (g) go(g.dataset.goto);
  });

  // Library
  var qTimer = null;
  $('#q').addEventListener('input', function (ev) {
    clearTimeout(qTimer);
    qTimer = setTimeout(function () { state.q = ev.target.value; renderCards(); }, 120);
  });
  $('#sort').addEventListener('change', function (ev) { state.sort = ev.target.value; renderCards(); });
  $('#edChips').addEventListener('click', function (ev) {
    var chip = ev.target.closest('.chip');
    if (!chip) return;
    var ed = chip.dataset.ed;
    if (state.eds.has(ed)) state.eds.delete(ed); else state.eds.add(ed);
    render();
  });
  $('#fwChips').addEventListener('click', function (ev) {
    var chip = ev.target.closest('.chip');
    if (!chip) return;
    var fw = chip.dataset.fw;
    if (state.fws.has(fw)) state.fws.delete(fw); else state.fws.add(fw);
    render();
  });
  $('#condenseSel').addEventListener('change', function (ev) {
    state.condense = ev.target.value;
    openSims.clear();
    render();
  });
  $('#cards').addEventListener('click', function (ev) {
    var simBtn = ev.target.closest('[data-sim]');
    if (simBtn) {
      var k = +simBtn.dataset.sim;
      if (openSims.has(k)) openSims.delete(k); else openSims.add(k);
      renderCards();
      return;
    }
    var secBtn = ev.target.closest('[data-addsec]');
    if (secBtn) {
      var valueFn = sectionValueFn();
      var ids2 = selIds();
      var added = 0;
      computeVisible(filtered()).visible.forEach(function (p) {
        if (valueFn && valueFn(p) === secBtn.dataset.addsec && !ids2.has(p.id)) { addPrompt(p); added++; }
      });
      toast('Added ' + added + (added === 1 ? ' prompt' : ' prompts') + ' — ' + state.sel.length + ' in set');
      render();
      return;
    }
    var btn = ev.target.closest('[data-toggle]');
    if (!btn) return;
    var id = btn.dataset.toggle;
    if (selIds().has(id)) {
      removeBySrcId(id);
      toast('Removed from set');
    } else {
      var p = PROMPTS.find(function (x) { return x.id === id; });
      if (p) { addPrompt(p); toast('Added — ' + state.sel.length + ' in set'); }
    }
    render();
  });
  $('#addAllBtn').addEventListener('click', function () {
    var ids = selIds();
    var added = 0;
    computeVisible(filtered()).visible.forEach(function (p) {
      if (!ids.has(p.id)) { addPrompt(p); added++; }
    });
    toast('Added ' + added + (added === 1 ? ' prompt' : ' prompts') + ' — ' + state.sel.length + ' in set');
    render();
  });

  // Filter sheet
  $('#filtersBtn').addEventListener('click', openSheet);
  $('#closeSheet').addEventListener('click', closeSheet);
  $('#applyFilters').addEventListener('click', closeSheet);
  $('#filterBackdrop').addEventListener('click', function (ev) {
    if (ev.target === ev.currentTarget) closeSheet();
  });
  $('#clearFilters').addEventListener('click', function () {
    state.eds.clear(); state.fws.clear(); state.types.clear(); state.depths.clear();
    renderSheet();
  });
  document.querySelector('.sheet-body').addEventListener('change', function (ev) {
    var box = ev.target;
    if (!box.dataset.fgroup) return;
    var set = state[box.dataset.fgroup];
    if (box.checked) set.add(box.value); else set.delete(box.value);
    renderSheet();
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape') return;
    if (!$('#previewBackdrop').hidden) closePreview();
    else if (!$('#seriesBackdrop').hidden) closeSeries();
    else if (!$('#filterBackdrop').hidden) closeSheet();
  });

  // My Set
  function findIdx(uid) {
    return state.sel.findIndex(function (s) { return s.uid === +uid; });
  }
  $('#setList').addEventListener('click', function (ev) {
    var mv = ev.target.closest('[data-move]');
    if (mv) {
      var i = findIdx(mv.dataset.uid);
      var j = mv.dataset.move === 'up' ? i - 1 : i + 1;
      if (i > -1 && j > -1 && j < state.sel.length) {
        var tmp = state.sel[i]; state.sel[i] = state.sel[j]; state.sel[j] = tmp;
        render();
      }
      return;
    }
    var rm = ev.target.closest('[data-remove]');
    if (rm) {
      state.sel.splice(findIdx(rm.dataset.uid), 1);
      render();
      return;
    }
    var ed = ev.target.closest('[data-edit]');
    if (ed) {
      var box = document.querySelector('[data-editbox="' + ed.dataset.edit + '"]');
      box.hidden = !box.hidden;
      if (!box.hidden) box.querySelector('textarea').focus();
      return;
    }
    var sv = ev.target.closest('[data-save-edit]');
    if (sv) {
      var idx = findIdx(sv.dataset.saveEdit);
      var txt = document.querySelector('[data-editbox="' + sv.dataset.saveEdit + '"] textarea').value.trim();
      if (idx > -1 && txt) { state.sel[idx].text = txt; render(); toast('Prompt updated'); }
      return;
    }
    var cn = ev.target.closest('[data-cancel-edit]');
    if (cn) document.querySelector('[data-editbox="' + cn.dataset.cancelEdit + '"]').hidden = true;
  });
  $('#setList').addEventListener('change', function (ev) {
    var ta = ev.target.closest('[data-note]');
    if (!ta) return;
    var i = findIdx(ta.dataset.note);
    if (i > -1) { state.sel[i].userNote = ta.value.trim(); save(); }
  });

  // Drag reordering (desktop)
  var dragUid = null;
  $('#setList').addEventListener('dragstart', function (ev) {
    var li = ev.target.closest('.set-item');
    if (!li) return;
    dragUid = li.dataset.uid;
    li.classList.add('dragging');
    ev.dataTransfer.effectAllowed = 'move';
    try { ev.dataTransfer.setData('text/plain', dragUid); } catch (e) { /* IE quirk */ }
  });
  $('#setList').addEventListener('dragover', function (ev) {
    if (dragUid == null) return;
    ev.preventDefault();
    var over = ev.target.closest('.set-item');
    var dragging = document.querySelector('.set-item.dragging');
    if (!over || !dragging || over === dragging) return;
    var rect = over.getBoundingClientRect();
    var before = ev.clientY < rect.top + rect.height / 2;
    over.parentNode.insertBefore(dragging, before ? over : over.nextSibling);
  });
  $('#setList').addEventListener('drop', function (ev) { ev.preventDefault(); });
  $('#setList').addEventListener('dragend', function () {
    if (dragUid == null) return;
    var order = Array.prototype.map.call(document.querySelectorAll('#setList .set-item'), function (li) {
      return +li.dataset.uid;
    });
    state.sel.sort(function (a, b) { return order.indexOf(a.uid) - order.indexOf(b.uid); });
    dragUid = null;
    render();
  });

  $('#arcBtn').addEventListener('click', function () {
    state.sel = state.sel
      .map(function (s, i) { return { s: s, i: i }; })
      .sort(function (a, b) { return ((a.s.depth || 9) - (b.s.depth || 9)) || (a.i - b.i); })
      .map(function (x) { return x.s; });
    toast('Arranged shallow → deep');
    render();
  });

  $('#clearBtn').addEventListener('click', function () {
    if (state.sel.length && window.confirm('Remove all ' + state.sel.length + ' prompts from your set?')) {
      state.sel = [];
      render();
    }
  });
  $('#addCustomBtn').addEventListener('click', function () {
    $('#customForm').hidden = false;
    $('#customText').focus();
  });
  $('#customCancel').addEventListener('click', function () { $('#customForm').hidden = true; });
  $('#customForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var txt = $('#customText').value.trim();
    if (!txt) { $('#customText').focus(); return; }
    state.sel.push({
      uid: uidCounter++, srcId: '', text: txt, edition: 'Custom', fw: '',
      category: $('#customCat').value.trim() || 'Custom', type: 'Custom', srcNote: '', userNote: ''
    });
    $('#customText').value = '';
    $('#customCat').value = '';
    $('#customForm').hidden = true;
    toast('Custom prompt added');
    render();
  });

  /* ---------- series builder ---------- */

  var srPicks = [];
  function srPool() {
    var ed = $('#srEd').value, cat = $('#srCat').value;
    return PROMPTS.filter(function (p) {
      return (!ed || p.edition === ed) && (!cat || p.framework_category === cat);
    });
  }
  function rollSeries() {
    var pool = srPool();
    var inSet = selIds();
    srPicks = [];
    [1, 2, 3, 4].forEach(function (dNum) {
      var cands = pool.filter(function (p) {
        return p.depth === dNum && p.type !== 'Closing' && !inSet.has(p.id);
      });
      srPicks.push(cands.length ? cands[Math.floor(Math.random() * cands.length)] : null);
    });
    if ($('#srClosing').checked) {
      var closers = pool.filter(function (p) { return p.type === 'Closing' && !inSet.has(p.id); });
      if (!closers.length) closers = PROMPTS.filter(function (p) { return p.type === 'Closing' && !inSet.has(p.id); });
      srPicks.push(closers.length ? closers[Math.floor(Math.random() * closers.length)] : null);
    }
    renderSrList();
  }
  function renderSrList() {
    $('#srList').innerHTML = srPicks.map(function (p, i) {
      var slot = i < 4 ? DEPTH_LABELS[i + 1] : 'Closing';
      var head = '<span class="sr-tag">' + (i < 4 ? depthMeter(i + 1) + ' ' : '') + slot + '</span>';
      if (!p) return '<li class="sr-item"><div>' + head + '</div><p class="sr-none">No unused ' + slot.toLowerCase() + ' prompt matches this focus.</p></li>';
      return '<li class="sr-item"><div>' + head + '</div>' +
        '<p class="sr-text">' + esc(p.prompt) + '</p>' +
        '<p class="sr-meta">' + esc(p.id + ' · ' + p.edition + ' · ' + p.framework_category) + '</p></li>';
    }).join('');
    $('#srAdd').disabled = !srPicks.some(Boolean);
  }
  function openSeries() {
    if (!$('#srEd').options.length) {
      $('#srEd').innerHTML = '<option value="">Any edition</option>' + META.editions.map(function (e) {
        return '<option value="' + esc(e.name) + '">' + esc(e.name) + '</option>';
      }).join('');
      $('#srCat').innerHTML = '<option value="">Any category</option>' + FW_CATS.map(function (c) {
        return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
      }).join('');
    }
    rollSeries();
    $('#seriesBackdrop').hidden = false;
  }
  function closeSeries() { $('#seriesBackdrop').hidden = true; }

  $('#seriesBtn').addEventListener('click', openSeries);
  $('#closeSeries').addEventListener('click', closeSeries);
  $('#seriesBackdrop').addEventListener('click', function (ev) {
    if (ev.target === ev.currentTarget) closeSeries();
  });
  $('#srShuffle').addEventListener('click', rollSeries);
  $('#srEd').addEventListener('change', rollSeries);
  $('#srCat').addEventListener('change', rollSeries);
  $('#srClosing').addEventListener('change', rollSeries);
  $('#srAdd').addEventListener('click', function () {
    var added = 0;
    srPicks.forEach(function (p) { if (p) { addPrompt(p); added++; } });
    closeSeries();
    toast('Added a ' + added + '-prompt series — ' + state.sel.length + ' in set');
    go('set');
  });

  // Export bindings
  function bindDoc(id, key) {
    $(id).addEventListener('input', function (ev) { state.doc[key] = ev.target.value; save(); });
  }
  bindDoc('#docTitle', 'title');
  bindDoc('#docSubtitle', 'subtitle');
  bindDoc('#docFacilitator', 'facilitator');
  bindDoc('#docOrg', 'org');
  bindDoc('#docDate', 'date');

  $('#formats').addEventListener('change', function (ev) {
    if (ev.target.name === 'fmt') { state.exp.format = ev.target.value; renderExport(); save(); }
  });
  function bindOpt(id, key, prop) {
    $(id).addEventListener('change', function (ev) {
      state.exp[key] = prop === 'checked' ? ev.target.checked : ev.target.value;
      renderExport(); save();
    });
  }
  bindOpt('#optNumbers', 'numbers', 'checked');
  bindOpt('#optIds', 'ids', 'checked');
  bindOpt('#optEd', 'showEd', 'checked');
  bindOpt('#optFw', 'showFw', 'checked');
  bindOpt('#optCat', 'showCat', 'checked');
  bindOpt('#optType', 'showType', 'checked');
  bindOpt('#optGuidance', 'guidance', 'checked');
  bindOpt('#optMyNotes', 'myNotes', 'checked');
  bindOpt('#optGroupBy', 'groupBy', 'value');
  bindOpt('#optBreaks', 'breaks', 'checked');
  bindOpt('#optLines', 'lines', 'value');
  bindOpt('#agStart', 'agStart', 'value');
  bindOpt('#agMins', 'agMins', 'value');
  bindOpt('#agWelcome', 'agWelcome', 'checked');
  bindOpt('#agWelcomeMins', 'agWelcomeMins', 'value');
  bindOpt('#agClosing', 'agClosing', 'checked');
  bindOpt('#agClosingMins', 'agClosingMins', 'value');

  $('#exportBtn').addEventListener('click', function () { runExport(false); });
  $('#altBtn').addEventListener('click', function () { runExport(true); });
  $('#previewBtn').addEventListener('click', openPreview);
  $('#closePreview').addEventListener('click', closePreview);
  $('#pvDownload').addEventListener('click', function () { runExport(false); closePreview(); });
  $('#previewBackdrop').addEventListener('click', function (ev) {
    if (ev.target === ev.currentTarget) closePreview();
  });

  /* ---------- init ---------- */

  load();
  // hydrate form fields from state
  $('#docTitle').value = state.doc.title;
  $('#docSubtitle').value = state.doc.subtitle;
  $('#docFacilitator').value = state.doc.facilitator;
  $('#docOrg').value = state.doc.org;
  $('#docDate').value = state.doc.date;
  $('#sort').value = state.sort;
  $('#condenseSel').value = state.condense;
  document.querySelector('#formats input[value="' + state.exp.format + '"]').checked = true;
  $('#optNumbers').checked = state.exp.numbers;
  $('#optIds').checked = state.exp.ids;
  $('#optEd').checked = state.exp.showEd;
  $('#optFw').checked = state.exp.showFw;
  $('#optCat').checked = state.exp.showCat;
  $('#optType').checked = state.exp.showType;
  $('#optGuidance').checked = state.exp.guidance;
  $('#optMyNotes').checked = state.exp.myNotes;
  $('#optGroupBy').value = state.exp.groupBy;
  $('#optBreaks').checked = state.exp.breaks;
  $('#optLines').value = String(state.exp.lines);
  $('#agStart').value = state.exp.agStart;
  $('#agMins').value = state.exp.agMins;
  $('#agWelcome').checked = state.exp.agWelcome;
  $('#agWelcomeMins').value = state.exp.agWelcomeMins;
  $('#agClosing').checked = state.exp.agClosing;
  $('#agClosingMins').value = state.exp.agClosingMins;
  render();
  renderExport();
})();
