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

  function esc(s) { return X.hesc(s == null ? '' : s); }
  function $(sel) { return document.querySelector(sel); }

  /* ---------- state ---------- */

  var uidCounter = 1;
  var state = {
    q: '', eds: new Set(), cats: new Set(), types: new Set(), sort: 'guide',
    view: 'library',
    sel: [],
    doc: { title: '', subtitle: '', facilitator: '', org: '', date: new Date().toISOString().slice(0, 10) },
    exp: {
      format: 'word', meta: true, ids: true, notes: true, group: false, breaks: false, lines: 0,
      agStart: '09:00', agMins: 10, agWelcome: true, agClosing: true
    }
  };

  var STORE_KEY = 'seln-prompt-studio-v1';
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ sel: state.sel, doc: state.doc, exp: state.exp }));
    } catch (e) { /* storage unavailable — session-only */ }
  }
  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (Array.isArray(d.sel)) state.sel = d.sel;
      if (d.doc) Object.assign(state.doc, d.doc);
      if (d.exp) Object.assign(state.exp, d.exp);
      state.sel.forEach(function (s) { uidCounter = Math.max(uidCounter, (s.uid || 0) + 1); });
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
      category: p.category, type: p.type, srcNote: p.notes || '', userNote: ''
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
      if (state.cats.size && !state.cats.has(p.category)) return false;
      if (q) {
        var hay = (p.prompt + ' ' + p.category + ' ' + p.id + ' ' + p.edition + ' ' + (p.notes || '')).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    var s = state.sort;
    if (s === 'az') list.sort(function (a, b) { return a.prompt.localeCompare(b.prompt); });
    else if (s === 'category') list.sort(function (a, b) { return a.category.localeCompare(b.category) || a._i - b._i; });
    else if (s === 'type') list.sort(function (a, b) { return (TYPE_ORDER[a.type] - TYPE_ORDER[b.type]) || a._i - b._i; });
    else if (s === 'edition') list.sort(function (a, b) { return (ED_ORDER[a.edition] - ED_ORDER[b.edition]) || a._i - b._i; });
    return list;
  }

  function filterCount() { return state.eds.size + state.cats.size + state.types.size; }

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

  function renderChips() {
    $('#edChips').innerHTML = META.editions.map(function (e) {
      var on = state.eds.has(e.name);
      return '<button type="button" class="chip' + (on ? ' is-on' : '') + '" style="--ed:' +
        (ED_COLORS[e.name] || '#5E6E69') + '" data-ed="' + esc(e.name) + '" aria-pressed="' + on + '">' +
        esc(e.name) + ' <span style="opacity:.65">' + e.count + '</span></button>';
    }).join('');
  }

  function renderCards() {
    var list = filtered();
    var ids = selIds();
    $('#resultCount').textContent = list.length + ' of ' + PROMPTS.length + ' prompts';
    $('#addAllBtn').hidden = list.length === 0 || list.every(function (p) { return ids.has(p.id); });
    if (!list.length) {
      $('#cards').innerHTML = '<div class="lib-empty">No prompts match — try clearing a filter or changing your search.</div>';
      return;
    }
    $('#cards').innerHTML = list.map(function (p) {
      var added = ids.has(p.id);
      return '<article class="pcard' + (added ? ' is-selected' : '') + '">' +
        '<div class="pcard-head">' + badge(p.edition) +
        '<span class="ttag">' + esc(p.type) + '</span>' +
        '<span class="pid">' + esc(p.id) + '</span></div>' +
        '<div class="pcard-cat">' + esc(p.category) + '</div>' +
        '<p class="pcard-text">' + esc(p.prompt) + '</p>' +
        (p.notes ? '<p class="pcard-note">' + esc(p.notes) + '</p>' : '') +
        '<div class="pcard-foot"><button type="button" class="btn add-btn' + (added ? ' is-added' : '') +
        '" data-toggle="' + esc(p.id) + '">' + (added ? 'Added ✓' : 'Add') + '</button></div>' +
        '</article>';
    }).join('');
  }

  function renderSet() {
    var n = state.sel.length;
    $('#setEmpty').hidden = n > 0;
    $('#setActions').hidden = n === 0;
    $('#setSummary').textContent = n
      ? n + (n === 1 ? ' prompt' : ' prompts') + ' — drag (or use arrows) to reorder; tap Edit to reword.'
      : 'Arrange, edit, and annotate your selected prompts.';
    $('#setList').innerHTML = state.sel.map(function (s, i) {
      return '<li class="set-item" draggable="true" data-uid="' + s.uid + '">' +
        '<div class="item-head">' +
        '<span class="drag-handle" aria-hidden="true">⠿</span>' +
        '<span class="item-num">' + (i + 1) + '</span>' +
        badge(s.edition) +
        '<span class="pcard-cat">' + esc(s.category) + '</span>' +
        (s.srcId ? '<span class="pid">' + esc(s.srcId) + '</span>' : '<span class="pid">custom</span>') +
        '</div>' +
        '<p class="item-text">' + esc(s.text) + '</p>' +
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
    var total = (e.agWelcome ? 10 : 0) + (e.agClosing ? 10 : 0) + state.sel.length * Math.max(1, +e.agMins || 10);
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

  function renderSheet() {
    $('#fTypes').innerHTML = META.types.map(function (t) {
      return checkRow('types', t, esc(t), state.types.has(t));
    }).join('');
    $('#fEds').innerHTML = META.editions.map(function (e) {
      return checkRow('eds', e.name, esc(e.name) + ' <span style="color:var(--mute)">(' + e.count + ')</span>', state.eds.has(e.name));
    }).join('');
    var cats = [];
    var seen = new Set();
    PROMPTS.forEach(function (p) {
      if (state.eds.size && !state.eds.has(p.edition)) return;
      if (!seen.has(p.category)) { seen.add(p.category); cats.push(p.category); }
    });
    cats.sort(function (a, b) { return a.localeCompare(b); });
    $('#fCats').innerHTML = cats.map(function (c) {
      return checkRow('cats', c, esc(c), state.cats.has(c));
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
        text: s.text, id: s.srcId || '', edition: s.edition, category: s.category,
        type: s.type === 'Custom' ? '' : s.type, srcNote: s.srcNote, userNote: s.userNote
      };
    });
    if (e.group) {
      var order = [], map = {};
      items.forEach(function (it) {
        var c = it.category || 'Custom';
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
      meta: e.meta, ids: e.ids, notes: e.notes, group: e.group,
      breaks: e.breaks, lines: +e.lines || 0,
      agenda: { start: e.agStart, mins: e.agMins, welcome: e.agWelcome, closing: e.agClosing }
    };
  }

  function download(name, blob) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
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
    toast('Downloaded ' + name);
  }

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
  $('#cards').addEventListener('click', function (ev) {
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
    filtered().forEach(function (p) {
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
    state.eds.clear(); state.cats.clear(); state.types.clear();
    renderSheet();
  });
  document.querySelector('.sheet-body').addEventListener('change', function (ev) {
    var box = ev.target;
    if (!box.dataset.fgroup) return;
    var set = state[box.dataset.fgroup];
    if (box.checked) set.add(box.value); else set.delete(box.value);
    if (box.dataset.fgroup === 'eds') {
      // drop category picks that no longer belong to a visible edition
      if (state.eds.size) {
        var valid = new Set();
        PROMPTS.forEach(function (p) { if (state.eds.has(p.edition)) valid.add(p.category); });
        state.cats.forEach(function (c) { if (!valid.has(c)) state.cats.delete(c); });
      }
    }
    renderSheet();
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && !$('#filterBackdrop').hidden) closeSheet();
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
      uid: uidCounter++, srcId: '', text: txt, edition: 'Custom',
      category: $('#customCat').value.trim() || 'Custom', type: 'Custom', srcNote: '', userNote: ''
    });
    $('#customText').value = '';
    $('#customCat').value = '';
    $('#customForm').hidden = true;
    toast('Custom prompt added');
    render();
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
  bindOpt('#optMeta', 'meta', 'checked');
  bindOpt('#optIds', 'ids', 'checked');
  bindOpt('#optNotes', 'notes', 'checked');
  bindOpt('#optGroup', 'group', 'checked');
  bindOpt('#optBreaks', 'breaks', 'checked');
  bindOpt('#optLines', 'lines', 'value');
  bindOpt('#agStart', 'agStart', 'value');
  bindOpt('#agMins', 'agMins', 'value');
  bindOpt('#agWelcome', 'agWelcome', 'checked');
  bindOpt('#agClosing', 'agClosing', 'checked');

  $('#exportBtn').addEventListener('click', function () { runExport(false); });
  $('#altBtn').addEventListener('click', function () { runExport(true); });

  /* ---------- init ---------- */

  load();
  // hydrate form fields from state
  $('#docTitle').value = state.doc.title;
  $('#docSubtitle').value = state.doc.subtitle;
  $('#docFacilitator').value = state.doc.facilitator;
  $('#docOrg').value = state.doc.org;
  $('#docDate').value = state.doc.date;
  $('#sort').value = state.sort;
  document.querySelector('#formats input[value="' + state.exp.format + '"]').checked = true;
  $('#optMeta').checked = state.exp.meta;
  $('#optIds').checked = state.exp.ids;
  $('#optNotes').checked = state.exp.notes;
  $('#optGroup').checked = state.exp.group;
  $('#optBreaks').checked = state.exp.breaks;
  $('#optLines').value = String(state.exp.lines);
  $('#agStart').value = state.exp.agStart;
  $('#agMins').value = state.exp.agMins;
  $('#agWelcome').checked = state.exp.agWelcome;
  $('#agClosing').checked = state.exp.agClosing;
  render();
  renderExport();
})();
