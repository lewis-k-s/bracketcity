# Nexo

Nexo is a clean-room, static nested-clue game. It uses vanilla JavaScript, native ES modules, one locale pack, and one puzzle JSON file. Players solve available leaf clues. Each canonical answer becomes text inside its parent clue. The synthetic root resolves to the final sentence.

The earlier React travel-globe experiment remains unchanged in `components/`.

## Run locally

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Fetching puzzle and locale JSON requires HTTP; opening `index.html` through `file://` is not supported.

## Validate

```sh
npm test
npm run test:e2e
npm run build
```

The deterministic suite covers the schema validator, tree compilation, availability, matching, hints, scoring, saved progress, and recursive DOM output. The Playwright suite runs the full game in Chromium and mobile WebKit, checks the 320-pixel layout, and runs an automated accessibility scan.

## Source map

```text
index.html
app.css
src/
  app.js       loading, orchestration, focus, and persistence
  engine.js    validation, compilation, matching, and transitions
  view.js      recursive DOM output, composer, and virtual keyboard
locales/
  es-ES.json
puzzles/
  schema-v1.json
  demo-es.json
tests/
  engine.test.js
  view.test.js
  e2e/game.spec.js
```

`puzzles/schema-v1.json` describes the portable data shape. `validatePuzzle()` also enforces graph invariants that JSON Schema cannot express: complete references, one parent per clue, no cycles, root reachability, normalized-answer uniqueness, and exact final expansion.

## Deliberate MVP rules

- A non-empty guess matches only currently available clues.
- A locked, duplicate, or unknown guess costs one wrong-answer penalty.
- An empty guess has no effect.
- The first clue-button activation shows only the configured first-letter peek. Later taps add no information or penalty.
- A canonical answer is rendered only after a matching answer is submitted through the answer field.
- Production clue IDs are opaque, so unsolved answers are not exposed through rendered DOM attributes.
- Saved progress is accepted only when solved parents include all solved descendants and peeked clues are valid for the derived tree state.
- Spanish acute-vowel marks can be optional for matching. `ñ` and `ü` remain distinct.
- The canonical answer is always displayed, even when an alias or unaccented guess matched.
- The score cannot fall below zero.

Puzzle answers are delivered to the browser. This static MVP is suitable for casual play, but it is not cheat-resistant.
