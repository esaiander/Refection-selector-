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
