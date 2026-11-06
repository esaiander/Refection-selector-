# SELN tools

Two single-file web apps live in this repository:

- **`index.html` — SELN Prompt Studio** (below)
- **`definitions.html` — SELN State Waiver Definitions** (see the end of this file)

# SELN Prompt Studio

A single-file, mobile-responsive web app for browsing, sorting, and selecting
reflection prompts from the **SELN Strategic Reflection Guide v.17**
(261 prompts across 12 editions), then exporting a customized set as a polished
Word document, PowerPoint deck, printable PDF, or timed meeting agenda.

## Use it

Open **`index.html`** in any modern browser — no server, build step, or network
connection required. Everything (data, styles, logic, export engines) is inlined
into that one file, so you can also email it, drop it on a shared drive, or host
it anywhere (e.g. GitHub Pages).

### Features

- **Library** — search all 261 prompts; filter by edition, category, and type
  (Opener / Core Question / Follow-up / Closing); sort by guide order, A–Z,
  category, type, or edition. One-tap add, or "Add all shown" for a filtered view.
- **My Set** — reorder by drag (or arrow buttons on mobile), reword any prompt,
  attach facilitator notes, write custom prompts, and clear or continue to export.
  Your set and settings persist in the browser between visits.
- **Export** — set title, subtitle, facilitator, organization, and date, then:
  - **Word document** (`.doc`) — discussion guide with optional prompt IDs,
    edition/category metadata, notes, category grouping, page breaks, and
    ruled writing space under each prompt.
  - **PowerPoint deck** (`.pptx`) — a real OOXML file generated in the browser:
    title slide, optional section dividers, and one slide per prompt with
    auto-sized type and slide counters.
  - **Meeting agenda** (`.doc` or print) — timed rows computed from your start
    time and minutes-per-prompt, with optional welcome and wrap-up blocks.
  - **PDF / Print** — opens the browser print dialog with a clean print layout;
    save as PDF or print handouts.

## Develop

Source lives in `src/` and is assembled into `index.html`:

```
data/seln_prompts.json   prompt data (SELN Strategic Reflection Guide v.17)
src/app.css              design tokens, layout, light/dark themes, print styles
src/markup.html          page structure
src/app.js               UI state, filtering, selection, event wiring
src/exporters.js         pure export builders: ZIP writer, PPTX, Word/agenda HTML
build.js                 inlines everything into index.html
```

After editing any source file:

```sh
node build.js
```

`src/exporters.js` has no DOM dependencies, so the document builders can be
exercised directly in Node for testing (e.g. generating a `.pptx` and opening it
with `python-pptx`).

# SELN State Waiver Definitions

A lookup and comparison tool for state waiver / manual definitions of employment
services, prevocational services, and career planning. Open **`definitions.html`**
in any browser; like the Prompt Studio it is one self-contained file.

- **Lookup** — pick a state (arrow keys step through states), filter by service
  category and topic, open any definition in a large-type **Focus** view, or
  **Copy** it with a citation.
- **Compare** — up to four states side by side for one category/topic, or pin
  individual definitions from anywhere and compare just those.
- **Search** — full-text search across every state, exact phrases ranked first,
  matching passages highlighted.
- **Data** — coverage by state, rows the last build could not use, and a
  classification review table.
- **Present** — large type, controls hidden, for screen sharing (Esc exits).
- Every view has a shareable link, e.g. `definitions.html#lookup/MD`,
  `#compare/FL+MS+TN/prevoc`, `#search/customized%20employment`.

## Updating the definitions

The spreadsheet is the source of truth. The page never edits definition text;
it only displays what the workbook contains.

1. Edit `data/waiver_definitions.xlsx`. One sheet per state, named with the
   two-letter code. Column A is the title, with the source document in
   parentheses (`Supported Employment – Limits (Waiver)`); column B is the
   verbatim text. Add, change, or delete rows as states revise their waivers.
2. Optionally add a header row to a sheet with any of `Title`, `Definition`,
   `Category`, `Topic`, `Source`, `URL`, `Verified`, `Notes`. Category and
   Topic override the automatic classification; URL and Verified show on the
   card (a Verified date older than a year is flagged in amber).
3. Run:

   ```sh
   node build-definitions.js            # rebuilds data/waiver_definitions.json and definitions.html
   node build-definitions.js --report   # also prints how every title was classified
   ```

   The build warns about rows it could not use (a title with no text, duplicate
   titles, text with no title) and lists them on the page's Data tab.

Categories are inferred from titles: *Prevocational* (prevoc, employment
readiness, pathway to employment), *Career Planning & Discovery* (career,
discovery, exploration, assessment), *Employment Services* (everything else that
names an employment service), and *General & Policy* (Employment First
statements, CIE definitions, VR). A title that is only a qualifier such as
"Limits" inherits the category of the row above it.

```
data/waiver_definitions.xlsx   the inventory (edit this)
data/waiver_definitions.json   generated
tools/xlsx-reader.js           dependency-free .xlsx parser
tools/import-definitions.js    workbook -> JSON, validation, classification
src/definitions.{css,html,js}  page source
build-definitions.js           importer + bundler
definitions.html               generated, share this
```
