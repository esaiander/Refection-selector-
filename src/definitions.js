/* SELN State Waiver Definitions — UI logic. Data arrives as the global DEFS
   (built by build-definitions.js). Definition text is rendered exactly as
   imported; nothing here rewrites it. */
(function () {
  'use strict';

  var STORE = 'seln-defs-v1';
  var $ = function (id) { return document.getElementById(id); };
  var el = function (tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  /* ---------- data ---------- */
  var states = DEFS.states;
  var byCode = {}, byId = {}, all = [];
  states.forEach(function (s) {
    byCode[s.code] = s;
    s.entries.forEach(function (e) { e.stateName = s.name; byId[e.id] = e; all.push(e); });
  });
  var CATS = DEFS.categories, TOPICS = DEFS.topics;
  var catLabel = {}, catShort = {}, topicLabel = {};
  CATS.forEach(function (c) { catLabel[c.key] = c.label; catShort[c.key] = c.short; });
  TOPICS.forEach(function (t) { topicLabel[t.key] = t.label; });
  var withEntries = states.filter(function (s) { return s.entries.length; });

  /* ---------- persisted ui state ---------- */
  var ui = { state: withEntries[0] ? withEntries[0].code : '', cat: 'all', topic: 'all', pins: [], theme: 'auto',
             cmp: [withEntries[0] ? withEntries[0].code : '', withEntries[1] ? withEntries[1].code : '', '', ''],
             cmpCat: 'all', cmpTopic: 'all', cmpMode: 'states', view: 'lookup', q: '', sCat: 'all', sort: 'state', expanded: false };
  try {
    var saved = JSON.parse(localStorage.getItem(STORE) || '{}');
    Object.keys(saved).forEach(function (k) { if (k in ui) ui[k] = saved[k]; });
  } catch (e) { /* storage unavailable */ }
  ui.pins = ui.pins.filter(function (id) { return byId[id]; });
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(ui)); } catch (e) { /* ignore */ }
  }

  /* ---------- helpers ---------- */
  function applyTheme() {
    if (ui.theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', ui.theme);
    $('themeBtn').textContent = ui.theme === 'auto' ? 'Theme: auto' : ui.theme === 'dark' ? 'Theme: dark' : 'Theme: light';
  }

  var toastTimer;
  function toast(msg) {
    var t = document.querySelector('.toast');
    if (!t) { t = el('div', 'toast'); document.body.appendChild(t); }
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 1800);
  }

  function citation(e) {
    var parts = [e.stateName, e.title];
    var line = parts.join(' — ');
    if (e.url) line += '\n' + e.url;
    if (e.verified) line += '\nVerified ' + e.verified;
    return line;
  }
  function copyEntry(e) {
    var text = e.text + '\n\nSource: ' + citation(e);
    var done = function () { toast('Copied with citation'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    else { fallbackCopy(text); done(); }
  }
  function fallbackCopy(text) {
    var ta = el('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
  }

  function staleClass(v) {
    if (!v) return '';
    var d = new Date(v);
    if (isNaN(d)) return '';
    return (Date.now() - d.getTime()) > 365 * 86400000 ? ' stale' : '';
  }

  function termRe(terms) {
    return new RegExp('(' + terms.map(function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|') + ')', 'gi');
  }
  /* Paragraphs that contain a search term, with ellipses where paragraphs were skipped. */
  function snippetHtml(text, terms) {
    var paras = text.split(/\n{2,}/);
    var re = termRe(terms);
    var keep = paras.map(function (p) { re.lastIndex = 0; return re.test(p); });
    if (paras.length < 3 || keep.every(Boolean)) return null;
    var out = [], shown = 0, gap = false;
    for (var i = 0; i < paras.length && shown < 3; i++) {
      if (keep[i]) { if (gap) out.push('<p class="gap">[…]</p>'); out.push('<p>' + esc(paras[i]).replace(re, '<mark>$1</mark>') + '</p>'); shown++; gap = false; }
      else gap = true;
    }
    if (shown < keep.filter(Boolean).length || gap) out.push('<p class="gap">[…]</p>');
    return out.join('');
  }
  function highlightHtml(text, terms) {
    var html = esc(text);
    if (terms && terms.length) {
      html = html.replace(termRe(terms), '<mark>$1</mark>');
    }
    return html.split(/\n{2,}/).map(function (p) { return '<p>' + p + '</p>'; }).join('');
  }

  function isPinned(id) { return ui.pins.indexOf(id) >= 0; }
  function togglePin(id) {
    var i = ui.pins.indexOf(id);
    if (i >= 0) ui.pins.splice(i, 1); else ui.pins.push(id);
    save(); renderPins();
    document.querySelectorAll('[data-id="' + id + '"]').forEach(function (n) {
      n.classList.toggle('is-pinned', isPinned(id));
      var b = n.querySelector('.pin-btn'); if (b) b.textContent = isPinned(id) ? 'Unpin' : 'Pin';
    });
    if (ui.view === 'compare' && ui.cmpMode === 'pinned') renderCompare();
  }
  function renderPins() {
    var n = ui.pins.length;
    $('pinCount').textContent = n; $('pinCount').hidden = !n;
    $('pinCount2').textContent = n;
    $('tray').hidden = !n || ui.view === 'compare';
    $('trayText').textContent = n + ' pinned';
  }

  /* ---------- card ---------- */
  function card(e, opts) {
    opts = opts || {};
    var snippet = opts.terms && opts.terms.length ? snippetHtml(e.text, opts.terms) : null;
    if (snippet) opts.clamp = false;
    var a = el('article', 'def' + (isPinned(e.id) ? ' is-pinned' : '') + (opts.clamp ? ' is-clamped' : '') + (snippet ? ' is-snippet' : ''));
    a.dataset.id = e.id; a.dataset.cat = e.category;
    var meta = '<span class="badge" data-cat="' + e.category + '">' + esc(catShort[e.category]) + '</span>' +
      '<span class="badge">' + esc(topicLabel[e.topic] || e.topic) + '</span>' +
      (e.source ? '<span class="src">' + esc(e.source) + '</span>' : '') +
      (e.verified ? '<span class="verified' + staleClass(e.verified) + '">Verified ' + esc(e.verified) + '</span>' : '') +
      (e.url ? '<a href="' + esc(e.url) + '" target="_blank" rel="noopener">Source ↗</a>' : '');
    a.innerHTML =
      '<header class="def-head"><div class="def-top">' +
        (opts.showState ? '<span class="state-tag">' + esc(e.state) + ' · ' + esc(e.stateName) + '</span>' : '') +
        '<h3 class="def-title">' + esc(e.name) + '</h3></div>' +
        '<div class="def-meta">' + meta + '</div></header>' +
      '<div class="def-text">' + (snippet || highlightHtml(e.text, opts.terms)) + '</div>' +
      (e.notes ? '<div class="def-notes">' + esc(e.notes) + '</div>' : '') +
      '<footer class="def-actions">' +
        '<button type="button" class="btn btn-sm btn-ghost focus-btn">Focus</button>' +
        '<button type="button" class="btn btn-sm btn-ghost copy-btn">Copy</button>' +
        '<button type="button" class="btn btn-sm btn-ghost pin-btn">' + (isPinned(e.id) ? 'Unpin' : 'Pin') + '</button>' +
        '<span class="sp"></span>' +
        (opts.clamp || snippet ? '<button type="button" class="btn btn-sm btn-ghost more-btn">Show full text</button>' : '') +
      '</footer>';
    a.querySelector('.focus-btn').onclick = function () { openFocus(e.id, opts.list || [e.id]); };
    a.querySelector('.copy-btn').onclick = function () { copyEntry(e); };
    a.querySelector('.pin-btn').onclick = function () { togglePin(e.id); };
    var more = a.querySelector('.more-btn');
    if (more) more.onclick = function () {
      if (snippet) {
        var full = a.classList.toggle('is-snippet') === false;
        a.querySelector('.def-text').innerHTML = full ? highlightHtml(e.text, opts.terms) : snippet;
        more.textContent = full ? 'Show matching passage' : 'Show full text';
        return;
      }
      var clamped = a.classList.toggle('is-clamped');
      more.textContent = clamped ? 'Show full text' : 'Show less';
    };
    a.querySelector('.def-text').addEventListener('dblclick', function () { openFocus(e.id, opts.list || [e.id]); });
    return a;
  }

  function needsClamp(e) { return e.text.length > 900 || (e.text.match(/\n/g) || []).length > 9; }

  /* ---------- lookup ---------- */
  function fillStateSelect(sel, allowEmpty) {
    sel.innerHTML = (allowEmpty ? '<option value="">— none —</option>' : '') + states.map(function (s) {
      return '<option value="' + s.code + '">' + esc(s.name) + (s.entries.length ? ' (' + s.entries.length + ')' : ' (none yet)') + '</option>';
    }).join('');
  }

  function chipRow(container, label, items, current, onPick, countOf) {
    container.innerHTML = '';
    container.appendChild(el('span', 'chips-label', esc(label)));
    items.forEach(function (it) {
      var c = el('button', 'chip' + (current === it.key ? ' is-on' : ''));
      c.type = 'button'; c.dataset.cat = it.key;
      var n = countOf ? countOf(it.key) : null;
      c.innerHTML = esc(it.label) + (n != null ? '<span class="n">' + n + '</span>' : '');
      if (n === 0 && it.key !== 'all') c.disabled = true;
      c.onclick = function () { onPick(it.key); };
      container.appendChild(c);
    });
  }

  function filterEntries(list, cat, topic) {
    return list.filter(function (e) { return (cat === 'all' || e.category === cat) && (topic === 'all' || e.topic === topic); });
  }

  function renderLookup() {
    var s = byCode[ui.state] || withEntries[0];
    if (!s) return;
    ui.state = s.code;
    $('stateSel').value = s.code;
    var catItems = [{ key: 'all', label: 'All' }].concat(CATS.map(function (c) { return { key: c.key, label: c.short }; }));
    chipRow($('catChips'), 'Service', catItems, ui.cat, function (k) { ui.cat = k; save(); renderLookup(); writeHash(); },
      function (k) { return filterEntries(s.entries, k, 'all').length; });
    var topicItems = [{ key: 'all', label: 'All' }].concat(TOPICS.map(function (t) { return { key: t.key, label: t.label }; }));
    chipRow($('topicChips'), 'Topic', topicItems, ui.topic, function (k) { ui.topic = k; save(); renderLookup(); writeHash(); },
      function (k) { return filterEntries(s.entries, ui.cat, k).length; });
    if (!filterEntries(s.entries, ui.cat, ui.topic).length && ui.topic !== 'all') { ui.topic = 'all'; return renderLookup(); }

    var notes = $('stateNotes'); notes.innerHTML = '';
    s.notes.forEach(function (n) { notes.appendChild(el('div', 'note', '<strong>Note from the inventory:</strong> ' + esc(n))); });

    var list = filterEntries(s.entries, ui.cat, ui.topic);
    var ids = [];
    CATS.forEach(function (c) { list.forEach(function (e) { if (e.category === c.key) ids.push(e.id); }); });
    var out = $('lookupList'); out.innerHTML = '';
    $('stateMeta').textContent = s.entries.length ? list.length + ' of ' + s.entries.length + ' definitions' : 'no definitions collected yet';
    $('expandAll').textContent = ui.expanded ? 'Collapse long text' : 'Expand all';
    if (!s.entries.length) {
      out.appendChild(el('div', 'empty', '<strong>' + esc(s.name) + '</strong> has a sheet in the inventory but no definitions yet.<br>Add rows to the <code>' + esc(s.code) + '</code> sheet and rebuild.'));
      return;
    }
    if (!list.length) { out.appendChild(el('div', 'empty', 'Nothing matches these filters for ' + esc(s.name) + '.')); return; }
    var groups = {};
    list.forEach(function (e) { (groups[e.category] = groups[e.category] || []).push(e); });
    CATS.forEach(function (c) {
      if (!groups[c.key]) return;
      var h = el('h2', 'group-title', esc(c.label) + '<span class="n">' + groups[c.key].length + '</span>');
      h.dataset.cat = c.key;
      out.appendChild(h);
      var wrap = el('div', 'defs');
      groups[c.key].forEach(function (e) { wrap.appendChild(card(e, { clamp: !ui.expanded && needsClamp(e), list: ids })); });
      out.appendChild(wrap);
    });
  }

  function stepState(dir) {
    var i = states.findIndex(function (s) { return s.code === ui.state; });
    var n = states.length;
    for (var k = 1; k <= n; k++) {
      var s = states[((i + dir * k) % n + n) % n];
      if (s.entries.length) { ui.state = s.code; break; }
    }
    save(); renderLookup(); writeHash(); window.scrollTo(0, 0);
  }

  /* ---------- compare ---------- */
  function renderCompare() {
    $('modeStates').classList.toggle('is-on', ui.cmpMode === 'states');
    $('modePinned').classList.toggle('is-on', ui.cmpMode === 'pinned');
    $('compareControls').hidden = ui.cmpMode !== 'states';
    $('clearPins').hidden = ui.cmpMode !== 'pinned';
    var cols = $('compareCols'); cols.innerHTML = '';
    var columns = [];
    if (ui.cmpMode === 'pinned') {
      if (!ui.pins.length) {
        cols.dataset.n = 1;
        cols.appendChild(el('div', 'empty', 'Nothing pinned yet. Use <strong>Pin</strong> on any definition in Lookup or Search, then come back here to see them side by side.'));
        return;
      }
      var grouped = {};
      ui.pins.forEach(function (id) { var e = byId[id]; (grouped[e.state] = grouped[e.state] || []).push(e); });
      Object.keys(grouped).forEach(function (code) { columns.push({ title: byCode[code].name, entries: grouped[code] }); });
    } else {
      document.querySelectorAll('.cmp-state').forEach(function (sel, i) { sel.value = ui.cmp[i] || ''; });
      $('cmpCat').value = ui.cmpCat; $('cmpTopic').value = ui.cmpTopic;
      var codes = ui.cmp.filter(function (c, i, arr) { return c && byCode[c] && arr.indexOf(c) === i; });
      if (codes.length < 1) { cols.dataset.n = 1; cols.appendChild(el('div', 'empty', 'Choose at least two states to compare.')); return; }
      codes.forEach(function (code) {
        columns.push({ title: byCode[code].name, entries: filterEntries(byCode[code].entries, ui.cmpCat, ui.cmpTopic) });
      });
    }
    cols.dataset.n = Math.min(4, Math.max(1, columns.length));
    var ids = [];
    columns.forEach(function (c) { c.entries.forEach(function (e) { ids.push(e.id); }); });
    columns.forEach(function (c) {
      var col = el('div', 'column');
      col.appendChild(el('div', 'col-head', '<h3>' + esc(c.title) + '</h3><span class="n">' + c.entries.length + ' definition' + (c.entries.length === 1 ? '' : 's') +
        (ui.cmpMode === 'states' && ui.cmpCat !== 'all' ? ' · ' + esc(catLabel[ui.cmpCat]) : '') + '</span>'));
      var wrap = el('div', 'defs');
      if (!c.entries.length) wrap.appendChild(el('div', 'empty', 'No matching definitions collected.'));
      c.entries.forEach(function (e) { wrap.appendChild(card(e, { clamp: false, list: ids })); });
      col.appendChild(wrap);
      cols.appendChild(col);
    });
  }

  /* ---------- search ---------- */
  function terms() { return ui.q.trim().toLowerCase().split(/\s+/).filter(function (t) { return t.length > 1; }); }
  function renderSearch() {
    $('q').value = ui.q;
    var ts = terms();
    var hits = all.filter(function (e) {
      if (ui.sCat !== 'all' && e.category !== ui.sCat) return false;
      if (!ts.length) return true;
      var hay = (e.title + ' ' + e.text + ' ' + e.stateName + ' ' + e.source).toLowerCase();
      return ts.every(function (t) { return hay.indexOf(t) >= 0; });
    });
    var catItems = [{ key: 'all', label: 'All' }].concat(CATS.map(function (c) { return { key: c.key, label: c.short }; }));
    chipRow($('searchCatChips'), 'Service', catItems, ui.sCat, function (k) { ui.sCat = k; save(); renderSearch(); }, null);
    var phrase = ui.q.trim().toLowerCase();
    var hasPhrase = function (e) { return ts.length > 1 && (e.title + ' ' + e.text).toLowerCase().indexOf(phrase) >= 0 ? 0 : 1; };
    hits.sort(function (a, b) {
      if (ts.length > 1 && hasPhrase(a) !== hasPhrase(b)) return hasPhrase(a) - hasPhrase(b);
      if (ui.sort === 'category') return a.category.localeCompare(b.category) || a.stateName.localeCompare(b.stateName) || a.row - b.row;
      if (ui.sort === 'title') return a.name.localeCompare(b.name) || a.stateName.localeCompare(b.stateName);
      return a.stateName.localeCompare(b.stateName) || a.row - b.row;
    });
    var statesHit = {}; hits.forEach(function (e) { statesHit[e.state] = 1; });
    var exact = ts.length > 1 ? hits.filter(function (e) { return hasPhrase(e) === 0; }).length : 0;
    $('searchCount').textContent = ts.length ? hits.length + ' definition' + (hits.length === 1 ? '' : 's') + ' in ' + Object.keys(statesHit).length + ' states' +
      (ts.length > 1 ? ' · ' + exact + ' with the exact phrase (shown first)' : '')
      : all.length + ' definitions in ' + withEntries.length + ' states';
    var out = $('searchList'); out.innerHTML = '';
    if (!hits.length) { out.appendChild(el('div', 'empty', 'No definition contains all of those words.')); return; }
    var ids = hits.map(function (e) { return e.id; });
    var wrap = el('div', 'defs');
    hits.slice(0, 150).forEach(function (e) { wrap.appendChild(card(e, { showState: true, clamp: !ts.length || needsClamp(e), terms: ts, list: ids })); });
    out.appendChild(wrap);
    if (hits.length > 150) out.appendChild(el('div', 'empty', 'Showing the first 150. Add another word to narrow the search.'));
  }

  /* ---------- data view ---------- */
  var ALL_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];
  function renderData() {
    var v = $('view-data'); v.innerHTML = '';
    var m = DEFS.meta;
    var missing = ALL_STATES.filter(function (c) { return !byCode[c]; });
    var emptySheets = states.filter(function (s) { return !s.entries.length; }).map(function (s) { return s.code; });
    v.appendChild(el('div', 'stats',
      '<div class="stat"><div class="v">' + m.entries + '</div><div class="k">definitions</div></div>' +
      '<div class="stat"><div class="v">' + m.statesWithEntries + '</div><div class="k">states with definitions</div></div>' +
      '<div class="stat"><div class="v">' + (missing.length + emptySheets.length) + '</div><div class="k">states still to collect</div></div>' +
      '<div class="stat"><div class="v" style="font-size:20px;padding-top:6px">' + esc(m.built) + '</div><div class="k">built from ' + esc(m.source) + '</div></div>'));

    var rows = states.map(function (s) {
      var n = {}; CATS.forEach(function (c) { n[c.key] = 0; });
      s.entries.forEach(function (e) { n[e.category]++; });
      return '<tr class="' + (s.entries.length ? '' : 'is-empty') + '"><td><a class="state-link" href="#lookup/' + s.code + '">' + esc(s.name) + '</a></td>' +
        '<td class="num">' + s.entries.length + '</td>' + CATS.map(function (c) { return '<td class="num">' + (n[c.key] || '·') + '</td>'; }).join('') + '</tr>';
    }).join('');
    var sec = el('div', 'data-section', '<h3>Coverage by state</h3>');
    sec.appendChild(el('table', 'grid', '<thead><tr><th>State</th><th class="num">Total</th>' + CATS.map(function (c) { return '<th class="num">' + esc(c.short) + '</th>'; }).join('') + '</tr></thead><tbody>' + rows + '</tbody>'));
    if (missing.length) sec.appendChild(el('p', '', '<strong>No sheet yet:</strong> ' + missing.join(', ') + '. Add a sheet named with the two-letter code to start collecting.'));
    if (emptySheets.length) sec.appendChild(el('p', '', '<strong>Sheet present but empty:</strong> ' + emptySheets.join(', ') + '.'));
    v.appendChild(sec);

    if ((m.issues && m.issues.length) || (m.warnings && m.warnings.length)) {
      var iss = el('div', 'data-section', '<h3>Rows to check in the spreadsheet</h3><p>These were reported by the last build. Fix them in the workbook and rebuild.</p>');
      var ul = el('ul');
      (m.issues || []).forEach(function (i) { ul.appendChild(el('li', 'warn', '<strong>' + esc(i.state) + ' row ' + i.row + ':</strong> “' + esc(i.title) + '” — ' + esc(i.problem) + ' (left out of the tool).')); });
      (m.warnings || []).forEach(function (w) { if (!/left out of the tool/.test(w)) ul.appendChild(el('li', '', esc(w))); });
      iss.appendChild(ul); v.appendChild(iss);
    }

    var how = el('div', 'data-section',
      '<h3>How to update the tool</h3>' +
      '<ol>' +
      '<li>Open <code>data/waiver_definitions.xlsx</code>. Each state is a sheet named with its two-letter code. Column A is the title (put the source document in parentheses, e.g. <em>Supported Employment – Limits (Waiver)</em>); column B is the verbatim text.</li>' +
      '<li>Add a row for a new definition, edit the text of an existing one, or delete the row when a state retires a service. Blank rows are ignored.</li>' +
      '<li>Optional: add a header row (row 1) with <code>Title</code>, <code>Definition</code>, <code>Category</code>, <code>Topic</code>, <code>Source</code>, <code>URL</code>, <code>Verified</code>, <code>Notes</code> to set those fields yourself. Category and Topic override the automatic classification shown below.</li>' +
      '<li>Run <code>node build-definitions.js</code> in the project folder. It rebuilds <code>definitions.html</code> and reports any row it could not use.</li>' +
      '<li>Share or re-upload <code>definitions.html</code>. Nothing else needs to change.</li>' +
      '</ol>');
    v.appendChild(how);

    var rev = el('div', 'data-section', '<h3>Classification review</h3><p>Category and topic are inferred from each title so the tool can group and filter. Verbatim text is never changed. If a label is wrong, add <code>Category</code> / <code>Topic</code> columns to that state’s sheet and set it there.</p>');
    states.forEach(function (s) {
      if (!s.entries.length) return;
      var d = el('details', 'review', '<summary>' + esc(s.name) + ' <span class="n" style="color:var(--mute);font-weight:500">(' + s.entries.length + ')</span></summary>');
      d.appendChild(el('table', 'grid', '<tbody>' + s.entries.map(function (e) {
        return '<tr><td class="num" style="color:var(--mute)">' + e.row + '</td><td>' + esc(e.title) + '</td><td><span class="badge" data-cat="' + e.category + '">' + esc(catShort[e.category]) + '</span></td><td>' + esc(topicLabel[e.topic]) + '</td></tr>';
      }).join('') + '</tbody>'));
      rev.appendChild(d);
    });
    v.appendChild(rev);
  }

  /* ---------- focus overlay ---------- */
  var focusList = [], focusIdx = -1;
  function openFocus(id, list) {
    focusList = list && list.length ? list : [id];
    focusIdx = Math.max(0, focusList.indexOf(id));
    renderFocus();
    $('focus').hidden = false;
    document.body.style.overflow = 'hidden';
    $('focusClose').focus();
  }
  function renderFocus() {
    var e = byId[focusList[focusIdx]];
    if (!e) return;
    $('focusPrev').disabled = focusIdx <= 0; $('focusNext').disabled = focusIdx >= focusList.length - 1;
    $('focusPin').textContent = isPinned(e.id) ? 'Unpin' : 'Pin';
    $('focusBody').innerHTML =
      '<div class="focus-state">' + esc(e.stateName) + '</div>' +
      '<h2 class="focus-title">' + esc(e.name) + '</h2>' +
      '<div class="focus-meta"><span class="badge" data-cat="' + e.category + '">' + esc(catLabel[e.category]) + '</span><span class="badge">' + esc(topicLabel[e.topic]) + '</span>' +
        (e.source ? '<span class="src">' + esc(e.source) + '</span>' : '') +
        (e.verified ? '<span class="verified' + staleClass(e.verified) + '">Verified ' + esc(e.verified) + '</span>' : '') +
        (e.url ? '<a href="' + esc(e.url) + '" target="_blank" rel="noopener">Source ↗</a>' : '') +
        '<span style="flex:1"></span><span>' + (focusIdx + 1) + ' / ' + focusList.length + '</span></div>' +
      '<div class="focus-text">' + highlightHtml(e.text) + '</div>' +
      (e.notes ? '<div class="def-notes" style="margin-top:14px">' + esc(e.notes) + '</div>' : '');
    $('focus').scrollTop = 0;
  }
  function closeFocus() { $('focus').hidden = true; document.body.style.overflow = ''; }

  /* ---------- hash routing ---------- */
  var writingHash = false;
  function writeHash() {
    var h = '';
    if (ui.view === 'lookup') h = 'lookup/' + ui.state + (ui.cat !== 'all' ? '/' + ui.cat : '');
    else if (ui.view === 'compare') h = 'compare/' + (ui.cmpMode === 'pinned' ? 'pinned' : ui.cmp.filter(Boolean).join('+') + (ui.cmpCat !== 'all' ? '/' + ui.cmpCat : ''));
    else if (ui.view === 'search') h = 'search' + (ui.q ? '/' + encodeURIComponent(ui.q) : '');
    else h = 'data';
    writingHash = true;
    try { history.replaceState(null, '', '#' + h); } catch (e) { location.hash = h; }
    setTimeout(function () { writingHash = false; }, 0);
  }
  function readHash() {
    var h = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (!h) return;
    var p = h.split('/');
    if (p[0] === 'lookup') {
      if (p[1] && byCode[p[1].toUpperCase()]) ui.state = p[1].toUpperCase();
      ui.cat = p[2] && catLabel[p[2]] ? p[2] : 'all';
      ui.view = 'lookup';
    } else if (p[0] === 'compare') {
      ui.view = 'compare';
      if (p[1] === 'pinned') ui.cmpMode = 'pinned';
      else if (p[1]) {
        ui.cmpMode = 'states';
        var codes = p[1].toUpperCase().split('+').filter(function (c) { return byCode[c]; }).slice(0, 4);
        ui.cmp = [codes[0] || '', codes[1] || '', codes[2] || '', codes[3] || ''];
        ui.cmpCat = p[2] && catLabel[p[2]] ? p[2] : 'all';
      }
    } else if (p[0] === 'search') { ui.view = 'search'; ui.q = p.slice(1).join('/') || ''; }
    else if (p[0] === 'data') ui.view = 'data';
    else if (p[0] === 'def' && byId[p[1]]) { ui.view = 'lookup'; ui.state = byId[p[1]].state; ui.cat = 'all'; setTimeout(function () { openFocus(p[1], [p[1]]); }, 0); }
  }

  /* ---------- views ---------- */
  function showView(name) {
    ui.view = name; save();
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('is-active', t.dataset.view === name); });
    document.querySelectorAll('.view').forEach(function (v) { v.hidden = v.id !== 'view-' + name; });
    if (name === 'lookup') renderLookup();
    else if (name === 'compare') renderCompare();
    else if (name === 'search') { renderSearch(); if (!document.documentElement.classList.contains('present')) $('q').focus(); }
    else renderData();
    renderPins();
    writeHash();
  }

  /* ---------- wiring ---------- */
  function init() {
    $('brandSub').textContent = DEFS.meta.entries + ' definitions · ' + DEFS.meta.statesWithEntries + ' states · inventory as of ' + DEFS.meta.built;
    applyTheme();
    fillStateSelect($('stateSel'), false);
    document.querySelectorAll('.cmp-state').forEach(function (sel) {
      fillStateSelect(sel, true);
      sel.onchange = function () { ui.cmp[+sel.dataset.slot] = sel.value; save(); renderCompare(); writeHash(); };
    });
    $('cmpCat').innerHTML = '<option value="all">All services</option>' + CATS.map(function (c) { return '<option value="' + c.key + '">' + esc(c.label) + '</option>'; }).join('');
    $('cmpTopic').innerHTML = '<option value="all">All topics</option>' + TOPICS.map(function (t) { return '<option value="' + t.key + '">' + esc(t.label) + '</option>'; }).join('');
    $('cmpCat').onchange = function () { ui.cmpCat = this.value; save(); renderCompare(); writeHash(); };
    $('cmpTopic').onchange = function () { ui.cmpTopic = this.value; save(); renderCompare(); };
    $('modeStates').onclick = function () { ui.cmpMode = 'states'; save(); renderCompare(); writeHash(); };
    $('modePinned').onclick = function () { ui.cmpMode = 'pinned'; save(); renderCompare(); writeHash(); };
    var clearAll = function () { if (!ui.pins.length) return; ui.pins = []; save(); renderPins(); document.querySelectorAll('.def.is-pinned').forEach(function (n) { n.classList.remove('is-pinned'); var b = n.querySelector('.pin-btn'); if (b) b.textContent = 'Pin'; }); if (ui.view === 'compare') renderCompare(); };
    $('clearPins').onclick = clearAll; $('trayClear').onclick = clearAll;
    $('trayCompare').onclick = function () { ui.cmpMode = 'pinned'; showView('compare'); };

    $('stateSel').onchange = function () { ui.state = this.value; save(); renderLookup(); writeHash(); };
    $('prevState').onclick = function () { stepState(-1); };
    $('nextState').onclick = function () { stepState(1); };
    $('expandAll').onclick = function () { ui.expanded = !ui.expanded; save(); renderLookup(); };
    $('pinState').onclick = function () {
      var s = byCode[ui.state]; if (!s) return;
      filterEntries(s.entries, ui.cat, ui.topic).forEach(function (e) { if (!isPinned(e.id)) ui.pins.push(e.id); });
      save(); renderPins(); renderLookup(); toast(ui.pins.length + ' pinned');
    };

    var qTimer;
    $('q').oninput = function () { ui.q = this.value; clearTimeout(qTimer); qTimer = setTimeout(function () { save(); renderSearch(); writeHash(); }, 120); };
    $('searchSort').value = ui.sort;
    $('searchSort').onchange = function () { ui.sort = this.value; save(); renderSearch(); };

    $('tabs').onclick = function (ev) { var t = ev.target.closest('.tab'); if (t) showView(t.dataset.view); };
    $('themeBtn').onclick = function () { ui.theme = ui.theme === 'auto' ? 'light' : ui.theme === 'light' ? 'dark' : 'auto'; save(); applyTheme(); };
    $('presentBtn').onclick = function () { togglePresent(); };

    $('focusClose').onclick = closeFocus;
    $('focusPrev').onclick = function () { if (focusIdx > 0) { focusIdx--; renderFocus(); } };
    $('focusNext').onclick = function () { if (focusIdx < focusList.length - 1) { focusIdx++; renderFocus(); } };
    $('focusCopy').onclick = function () { copyEntry(byId[focusList[focusIdx]]); };
    $('focusPin').onclick = function () { togglePin(focusList[focusIdx]); renderFocus(); };
    $('focus').addEventListener('click', function (ev) { if (ev.target === $('focus')) closeFocus(); });

    document.addEventListener('keydown', function (ev) {
      var inField = /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
      if (!$('focus').hidden) {
        if (ev.key === 'Escape') closeFocus();
        else if (ev.key === 'ArrowLeft') $('focusPrev').click();
        else if (ev.key === 'ArrowRight') $('focusNext').click();
        return;
      }
      if (ev.key === 'Escape' && document.documentElement.classList.contains('present')) togglePresent();
      if (inField) return;
      if (ev.key === '/' ) { ev.preventDefault(); showView('search'); }
      if (ui.view === 'lookup' && ev.key === 'ArrowLeft') stepState(-1);
      if (ui.view === 'lookup' && ev.key === 'ArrowRight') stepState(1);
    });

    window.addEventListener('hashchange', function () {
      if (writingHash) return;
      readHash(); save(); showView(ui.view);
    });

    readHash();
    showView(ui.view);
  }

  function togglePresent() {
    var on = document.documentElement.classList.toggle('present');
    $('presentBtn').textContent = on ? 'Exit present' : 'Present';
    $('presentBtn').classList.toggle('is-on', on);
    if (ui.view === 'lookup') renderLookup();
  }

  init();
})();
