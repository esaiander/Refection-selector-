/* Converts data/waiver_definitions.xlsx into data/waiver_definitions.json.

   Workbook layout (one sheet per state, sheet name = two-letter code):
     Positional mode (default): column A = title, column B = verbatim text.
       Additional title/text pairs may sit in columns C/D, E/F, ... on the same row.
     Header mode: if row 1 contains recognized headers, columns are read by name:
       Title | Definition | Category | Topic | Source | URL | Verified | Notes
       (case-insensitive; "Text" or "Language" also work for Definition,
        "Link" for URL, "Date verified" for Verified.)

   Definition text is never altered beyond whitespace normalization. Category and
   topic are inferred from the title unless the sheet supplies them explicitly. */
'use strict';

const { readWorkbook } = require('./xlsx-reader');

const STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky',
  LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', PR: 'Puerto Rico'
};

const CATEGORIES = [
  { key: 'employment', label: 'Employment Services', short: 'Employment' },
  { key: 'prevoc', label: 'Prevocational Services', short: 'Prevocational' },
  { key: 'career', label: 'Career Planning & Discovery', short: 'Career Planning' },
  { key: 'general', label: 'General & Policy', short: 'General' }
];

const TOPICS = [
  { key: 'limits', label: 'Limits', re: /\b(limits?|limitations?|duration|exclusions?|ctnd|cntd|not covered|non-?covered|not allowed|restrictions?)\b/i },
  { key: 'documentation', label: 'Documentation', re: /\bdocumentation\b/i },
  { key: 'billing', label: 'Billing & Rates', re: /\b(billing|rates?|reimburs\w*|units?|included in rate)\b/i },
  { key: 'eligibility', label: 'Eligibility', re: /\b(eligib\w*|authorization|who should|referral)\b/i },
  { key: 'provider', label: 'Provider Specifications', re: /\b(providers?|qualifications?|specifications?|certification|standards?|requirements?|staff|contractor)\b/i },
  { key: 'activities', label: 'Activities & Scope', re: /\b(activities|scope|components|covered services|service array|phases?|steps|delivery|categories|settings?|outcomes?)\b/i },
  { key: 'definition', label: 'Definition', re: /.*/ }
];

/* Words that show a title names a service on its own. A title without any of
   them (e.g. "Limits", "Eligibility") inherits the category of the row above. */
const SERVICE_WORDS = /emplo|prevoc|career|discover|explor|\bjob|work|vocation|coach|placement|retention|follow|ongoing|assess|\bcie\b|\bse\b|\bsei\b|\bsec\b|\bies\b|\bdcp\b|\bpca\b|pathway|extended|group|customiz|benefits counseling/i;

function normalizeText(s) {
  return String(s || '')
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
const normalizeTitle = (s) => normalizeText(s).replace(/\s+/g, ' ');

function slug(s) {
  return s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

/* "Supported Employment – Limits (Waiver)" -> name "Supported Employment – Limits", source "Waiver" */
function splitSource(title) {
  const m = /^(.*?)\s*\(([^()]{2,80})\)\s*$/.exec(title);
  if (!m) return { name: title, source: '' };
  return { name: m[1].trim(), source: m[2].trim() };
}

function inferCategory(name, text) {
  const t = name.toLowerCase();
  if (/pre-?voc|employment readiness|pathway to employment|community participation support/.test(t)) return 'prevoc';
  if (/career|discovery|exploration|assessment|assesment|person[- ]centered (job|assess)|\bpca\b|\bdcp\b/.test(t)) return 'career';
  if (/^definitions?\b|employment first|^competitive integrated employment$|integrated community work setting|^work incentive consultation$|commensurate|vocational rehabilitation/.test(t)) return 'general';
  if (/emplo|\bjob|\bse\b|\bsei\b|\bsec\b|\bcie\b|\bies\b|work|ongoing support|extended services|coaching|placement|retention|follow|group|customiz|vocational support/.test(t)) return 'employment';
  const x = (text || '').slice(0, 300).toLowerCase();
  if (/prevocational/.test(x)) return 'prevoc';
  if (/supported employment|employment services?/.test(x)) return 'employment';
  return 'general';
}

function inferTopic(name) {
  // Judge the qualifier after a dash/colon first ("Supported Employment – Limits"),
  // then the whole name ("Prevoc Provider Specifications – Work Activity Programs").
  const parts = name.split(/\s[–—-]\s?|\s?[–—]\s|:\s/);
  const probes = parts.length > 1 ? [parts.slice(1).join(' '), name] : [name];
  for (const probe of probes) {
    const hit = TOPICS.find((t) => t.key !== 'definition' && t.re.test(probe));
    if (hit) return hit.key;
  }
  return 'definition';
}

const HEADERS = {
  title: ['title', 'name', 'service', 'service name', 'heading'],
  text: ['definition', 'text', 'language', 'verbatim', 'content'],
  category: ['category'],
  topic: ['topic', 'type'],
  source: ['source', 'document', 'source document'],
  url: ['url', 'link', 'source url'],
  verified: ['verified', 'date verified', 'last verified', 'checked'],
  notes: ['notes', 'note', 'comment']
};

function detectHeader(row) {
  const map = {};
  let hits = 0;
  row.forEach((cell, i) => {
    const v = normalizeTitle(cell).toLowerCase();
    for (const key of Object.keys(HEADERS)) {
      if (HEADERS[key].includes(v) && map[key] === undefined) { map[key] = i; hits++; }
    }
  });
  return map.title !== undefined && map.text !== undefined && hits >= 2 ? map : null;
}

function categoryFromLabel(v) {
  const s = normalizeTitle(v).toLowerCase();
  if (!s) return '';
  const hit = CATEGORIES.find((c) => c.key === s || c.label.toLowerCase() === s || c.short.toLowerCase() === s);
  if (hit) return hit.key;
  if (/prevoc/.test(s)) return 'prevoc';
  if (/career|discover/.test(s)) return 'career';
  if (/employ/.test(s)) return 'employment';
  if (/general|policy|other/.test(s)) return 'general';
  return null;
}
function topicFromLabel(v) {
  const s = normalizeTitle(v).toLowerCase();
  if (!s) return '';
  const hit = TOPICS.find((t) => t.key === s || t.label.toLowerCase() === s);
  return hit ? hit.key : null;
}

function importWorkbook(buf, opts) {
  const sheets = readWorkbook(buf);
  const problems = [];   // block the build (unreadable workbook, no state sheets)
  const warnings = [];   // reported, build continues
  const issues = [];     // rows left out, shown on the page's Data tab
  const states = [];

  for (const sheet of sheets) {
    const code = sheet.name.trim().toUpperCase();
    if (!STATES[code]) {
      warnings.push(`Sheet "${sheet.name}" is not a state code; skipped.`);
      continue;
    }
    const state = { code, name: STATES[code], notes: [], entries: [] };
    const seen = new Map();
    const rows = sheet.rows;
    const header = rows.length ? detectHeader(rows[0]) : null;
    const start = header ? 1 : 0;

    const addEntry = (rowNum, fields) => {
      const title = normalizeTitle(fields.title);
      const text = normalizeText(fields.text);
      const where = `${code} row ${rowNum}`;
      if (!title && !text) return;
      if (!title) {
        state.notes.push(text);
        warnings.push(`${where}: text with no title; kept as a state note ("${text.slice(0, 60)}").`);
        return;
      }
      if (!text) {
        warnings.push(`${where}: "${title}" has no definition text; left out of the tool until text is added.`);
        issues.push({ state: code, row: rowNum, title, problem: 'No definition text' });
        return;
      }
      const { name, source } = splitSource(title);
      let category = categoryFromLabel(fields.category);
      if (category === null) { warnings.push(`${where}: unknown category "${fields.category}"; inferred instead.`); category = ''; }
      if (!category) {
        const prev = state.entries[state.entries.length - 1];
        category = prev && !SERVICE_WORDS.test(name) ? prev.category : inferCategory(name, text);
      }
      let topic = topicFromLabel(fields.topic);
      if (topic === null) { warnings.push(`${where}: unknown topic "${fields.topic}"; inferred instead.`); topic = ''; }
      if (!topic) topic = inferTopic(name);
      let id = `${code.toLowerCase()}-${slug(name + (source ? '-' + source : ''))}`;
      if (seen.has(id)) {
        const n = seen.get(id) + 1; seen.set(id, n);
        warnings.push(`${where}: duplicate title "${title}"; both kept, check whether one should be deleted.`);
        id += '-' + n;
      } else seen.set(id, 1);
      const url = normalizeTitle(fields.url);
      if (url && !/^https?:\/\//i.test(url)) warnings.push(`${where}: URL "${url}" does not start with http(s)://.`);
      state.entries.push({
        id, state: code, title, name, source, category, topic, text,
        url, verified: normalizeTitle(fields.verified), notes: normalizeText(fields.notes), row: rowNum
      });
    };

    for (let r = start; r < rows.length; r++) {
      const row = rows[r];
      if (!row.some((c) => normalizeText(c))) continue;
      if (header) {
        const pick = (k) => (header[k] === undefined ? '' : row[header[k]] || '');
        addEntry(r + 1, {
          title: pick('title'), text: pick('text'), category: pick('category'), topic: pick('topic'),
          source: pick('source'), url: pick('url'), verified: pick('verified'), notes: pick('notes')
        });
        // header mode may also carry an explicit source column
        const last = state.entries[state.entries.length - 1];
        if (last && last.row === r + 1 && normalizeTitle(pick('source'))) last.source = normalizeTitle(pick('source'));
      } else {
        for (let c = 0; c < Math.max(row.length, 2); c += 2) {
          addEntry(r + 1, { title: row[c] || '', text: row[c + 1] || '' });
        }
      }
    }
    states.push(state);
  }

  if (!states.length) problems.push('No sheets named with a state code were found.');
  states.sort((a, b) => a.name.localeCompare(b.name));
  const total = states.reduce((n, s) => n + s.entries.length, 0);
  const data = {
    meta: {
      built: new Date().toISOString().slice(0, 10),
      source: (opts && opts.sourceName) || 'waiver_definitions.xlsx',
      states: states.length,
      statesWithEntries: states.filter((s) => s.entries.length).length,
      entries: total,
      issues,
      warnings
    },
    categories: CATEGORIES,
    topics: TOPICS.map((t) => ({ key: t.key, label: t.label })),
    states
  };
  return { data, problems, warnings };
}

module.exports = { importWorkbook, STATES, CATEGORIES, TOPICS };
