# Nexo

Nexo is a clean-room, static nested-clue game. It uses vanilla JavaScript, native ES modules, one locale pack, and static puzzle JSON files. Players solve available leaf clues. Each canonical answer becomes text inside its parent clue. The synthetic root resolves to the final sentence.

The earlier React travel-globe experiment remains unchanged in `components/`.

## Run locally

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Fetching puzzle and locale JSON requires HTTP; opening `index.html` through `file://` is not supported.

Use **Crear** in the game header, or open `/?mode=author`, to create a puzzle in the browser. The editor stores its draft under `nested-clue:author:v1` in `localStorage`.
The creator can also load any listed puzzle and preserve its supported optional data when it is saved or exported again.

Play mode loads `puzzles/manifest.json` as a small date-to-file table. **Guardar para jugar** stores a valid creator puzzle under `nested-clue:published:v1` in the same browser. These local dates join the native date selector and replace a bundled date only after confirmation. With no `date` query, Play mode loads the manifest's `defaultDate`. A URL such as `/?date=2026-08-28` loads that exact puzzle. Unknown dates fail safely and never become file paths.

## Author a puzzle

1. Enter and apply the exact final sentence.
2. Select an answer in **Vista previa** and choose **Convertir selección**.
3. Enter the clue prompt and choose **Guardar texto**. Then select text in **Vista previa** to create another nested level.
4. Optionally place the hint before or after its answer, or add a separate right-side hint.
5. Set a release date, resolve all validation errors, and choose **Guardar para jugar**. The **Jugar** link then opens that date.

Copy and Download remain available for moving compiled JSON outside this browser. A browser-local publication stays on this device and origin. Clearing site data removes it.

The preview is the only bracket-creation surface. The editor hides alternative answers until you open that field. It preserves imported first-letter overrides in JSON, but it does not show a separate override control.

A one-sided direction is stored on a reference segment:

```json
{ "ref": "c02", "direction": "right" }
```

The arrow and blank render inside the unresolved bracket: `[pista → ___]` or `[___ ← pista]`. Directed hints can contain nested clues.

A clue can also have two independent hints:

```json
{
  "answer": "light",
  "prompt": ["sun"],
  "rightPrompt": ["house"]
}
```

This renders as `[sun → ___ ← house]`. Only `sun + light` and `light + house` need to be meaningful. The two hint texts do not need to form one sentence. Both sides can contain nested clue references, and all children on both sides must resolve before the shared answer becomes available.

## Validate

```sh
npm test
npm run test:e2e
npm run build
```

The deterministic suite covers the schema validator, tree compilation, author-state operations, availability, matching, hints, scoring, saved progress, and recursive DOM output. The Playwright suite runs the game and author workflow in Chromium and mobile WebKit, checks the 320-pixel layouts, and runs automated accessibility scans.

## Source map

```text
index.html
app.css
src/
  app.js          mode routing, loading, orchestration, and persistence
  author.js       pure author-draft and export operations
  author-preview.js recursive answer-free author preview and selection mapping
  author-view.js  compact prompt editor, tree outline, preview, and export
  catalog.js      static date-table validation and lookup
  published.js    validated browser-local puzzle table and catalog overlay
  engine.js       validation, compilation, matching, and transitions
  view.js         recursive DOM output, composer, and virtual keyboard
locales/
  es-ES.json
puzzles/
  manifest.json
  2026-08-30-es.json
  schema-v1.json
  demo-es.json
tests/
  author.test.js
  author-preview.test.js
  author-view.test.js
  catalog.test.js
  published.test.js
  daily-puzzle.test.js
  engine.test.js
  view.test.js
  e2e/author.spec.js
  e2e/game.spec.js
```

`puzzles/schema-v1.json` describes the portable data shape. `validatePuzzle()` also enforces graph invariants that JSON Schema cannot express: complete references, one parent per clue, no cycles, root reachability, normalized-answer uniqueness, and exact final expansion.

## Deliberate MVP rules

- A non-empty guess matches only currently available clues.
- A locked, duplicate, or unknown guess costs one wrong-answer penalty.
- An empty guess has no effect.
- The first clue-button activation shows only the configured first-letter peek. Later taps add no information or penalty.
- A canonical answer is rendered only after a matching answer is submitted through the answer field.
- The Enviar button flashes green for a correct submission and red for an incorrect submission; the live status still supplies non-color feedback.
- Production clue IDs are opaque, so unsolved answers are not exposed through rendered DOM attributes.
- Saved progress is accepted only when solved parents include all solved descendants and peeked clues are valid for the derived tree state.
- Spanish acute-vowel marks can be optional for matching. `ñ` and `ü` remain distinct.
- The canonical answer is always displayed, even when an alias or unaccented guess matched.
- The score cannot fall below zero.

Puzzle answers are delivered to the browser. This static MVP is suitable for casual play, but it is not cheat-resistant.
