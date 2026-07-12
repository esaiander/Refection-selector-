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

- **Library** — search all 261 prompts; filter by edition, SELN Framework
  category (the 8 categories from the Framework for Employment), and type
  (Opener / Core Question / Follow-up / Closing) via quick chips or the filter
  sheet; sort by guide order, A–Z, category, type, or edition. One-tap add, or
  "Add all shown" for a filtered view. Each prompt also keeps its original
  fine-grained category for display and export.
- **My Set** — reorder by drag (or arrow buttons on mobile), reword any prompt,
  attach facilitator notes, write custom prompts, and clear or continue to export.
  Your set and settings persist in the browser between visits.
- **Export** — set title, subtitle, facilitator, organization, and date;
  group prompts by category, original category, or edition (or keep your own
  order); toggle numbers, prompt IDs, edition, category, original category,
  type, guidance notes, and your own notes independently; then:
  - **Word document** (`.docx`) — a real WordprocessingML file: discussion guide
    with optional prompt IDs, edition/category metadata, notes, category
    grouping, page breaks, and ruled writing space under each prompt.
  - **PowerPoint deck** (`.pptx`) — a real PresentationML file: title slide,
    optional section dividers, and one slide per prompt with auto-sized type
    and slide counters.
  - **Meeting agenda** (`.docx` or `.pdf`) — timed rows computed from your
    start time and minutes-per-prompt, with optional welcome and wrap-up blocks.
  - **PDF handout** (`.pdf`) — a print-ready PDF written directly on-device
    (no print dialog needed), with page numbers and the same layout options
    as the Word guide.

  All four formats are genuine files generated entirely in the browser —
  no server, no libraries, no print dialog.

## Develop

Source lives in `src/` and is assembled into `index.html`:

```
data/seln_prompts.json   prompt data (SELN Strategic Reflection Guide v.17)
src/app.css              design tokens, layout, light/dark themes
src/markup.html          page structure
src/app.js               UI state, filtering, selection, event wiring
src/exporters.js         pure export builders: ZIP writer, PPTX, DOCX, PDF
build.js                 inlines everything into index.html
```

After editing any source file:

```sh
node build.js
```

`src/exporters.js` has no DOM dependencies, so the document builders can be
exercised directly in Node for testing — e.g. generating files and opening
them with `python-pptx`, `python-docx`, and `pypdf`.
