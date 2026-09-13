# Puzzle mechanism and examples

This document is the main guide for the clue and answer system. Use it when
you write or review a puzzle. The examples are short fragments. They are not
complete production puzzles.

## Core mechanism

A puzzle is a tree of clues. The final sentence is the root of the tree.
Each parenthesis group has a clue and one answer. When the player solves a
group, its answer replaces the complete group in the level above it.

For example:

```text
Un (animal doméstico=gato) duerme.
```

The clue is `animal doméstico`. The answer is `gato`. After the solve, the
text at that level is `Un gato duerme.`

A clue can contain more parenthesis groups:

```text
(número de (personas que montan a caballo=jinetes) del Apocalipsis=cuatro)
```

The player must solve `jinetes` first. Its answer completes the clue `número
de jinetes del Apocalipsis`. That clue then resolves to `cuatro`.

The following rules always apply:

- The answer is the exact text that replaces its group in the parent level.
- A child answer must make the parent clue correct after insertion.
- Each clue has one parent. Do not reuse one clue group in two places.
- The player starts with clues that contain no unsolved child clues.
- The root answers must reproduce the final sentence exactly.
- Answers must stay distinct after answer normalization.

## Parenthesis syntax

Modo paréntesis supports four forms.

| Type | Syntax | Correct use |
| --- | --- | --- |
| Plain clue | `(pista=respuesta)` | The clue defines the answer. It does not specify a position for it. |
| Answer on the right | `(texto izquierdo→respuesta)` | The answer completes the text on its left. |
| Answer on the left | `(respuesta←texto derecho)` | The answer completes the text on its right. |
| Answer between two clues | `(texto izquierdo→respuesta←texto derecho)` | The left text plus the answer and the answer plus the right text are two valid clue-answer pairs. |

Use a plain clue for a normal definition:

```text
(personas que montan a caballo=jinetes)
```

Use a right arrow only when the answer belongs after the clue text:

```text
(ponen algo encima y lo→cubren)
```

The completed text is `ponen algo encima y lo cubren`.

Use a left arrow only when the answer belongs before the clue text:

```text
(sal←ida de emergencia)
```

The completed text is `salida de emergencia`.

Use two arrows only when both sides work independently:

```text
(dar la→razón←de ser)
```

The two pairs are `dar la razón` and `razón de ser`. Do not split one normal
definition around an answer and call it directional.

Arrows are not decorative separators. This is not a directional clue:

```text
(personas que montan a caballo→jinetes)
```

The clue does not need `jinetes` in that position to complete its text. Write
it as a plain clue with `=`. If a normal clue needs a visible middle gap, put
underscores in the clue and keep the plain form:

```text
(Se llama ___ a quien monta a caballo=jinete)
```

Escape a literal syntax character with a backslash. The syntax characters are
`\`, `(`, `)`, `←`, `→`, `=`, and `|`.

## Nesting patterns

### Whole-word nesting

A child answer can become a complete word or phrase in its parent clue:

```text
(número de (personas que montan a caballo=jinetes) del Apocalipsis=cuatro)
```

This pattern gives a clear two-step chain. Use it for definitions, facts,
idioms, and wordplay.

### Subword nesting

A child answer can also become part of a longer word in its parent clue:

```text
in(seguidor muy entusiasta=fan)cia
adul(apariencia o superficie del rostro=tez)
```

The child answers form `infancia` and `adultez`. An outer clue can then use
both completed words:

```text
(habitantes temporales de la in(...=fan)cia y la adul(...=tez)=adolescentes)
```

Use subword parentheses often enough to give the puzzle word and visual
variation. They avoid a chain in which every child answer is a complete word.
They also support prefixes, suffixes, and fragments with a meaning of their
own.

Subword clues are easier because the text outside the group limits the
answer. For example, `in(___)cia` gives a strong hint for `fan`. Balance this
help in one or more of these ways:

- Use a less direct but fair child clue.
- Leave less text outside the group.
- Make the completed parent clue more indirect.
- Put the subword clue in a deeper branch.
- Combine easy subword steps with harder whole-word steps.

Direction and subword use are independent. This fragment is a plain subword
clue and does not need an arrow:

```text
in(seguidor muy entusiasta=fan)cia
```

Add an arrow only when the child answer completes the child clue in the shown
position.

### Nested directional clues

A directional clue can unlock a normal outer clue:

```text
(lo contrario de lo que hacen quienes
  (ponen algo encima y lo→cubren)
=descubren)
```

The inner answer completes `ponen algo encima y lo cubren`. The outer clue
then asks for its opposite.

A two-sided clue can also contain a nested clue:

```text
(un espeleólogo entra en la→cueva←abierta en la
  (material sólido=roca))
```

The two independent pairs are `un espeleólogo entra en la cueva` and `cueva
abierta en la roca`.

## Grow a puzzle from a short answer

Answer length does not limit branch size. A short answer can have a long clue,
and that clue can contain several child groups.

Place a long root-level clue near the start of the final sentence when this
fits the text. The first outer group then provides more clue text in which you
can place nested groups. For example:

```text
El (astro que ilumina el (opuesto de noche=día) y parece
  (color entre rojo y amarillo=naranja)=sol) aparece...
```

The root answer is only `sol`, but this branch contains three answers. This
method can make a full puzzle from a final sentence that offers only short
answer spans.

Do not make a clue long only to add groups. The completed clue must remain
natural, clear, and useful. The validator warns when one clue has more than
240 literal characters because long prompts can wrap poorly on a phone.

## Variation and difficulty

Use several mechanisms in one daily puzzle. A useful mix can include:

- a direct definition for an entry point;
- a fact, idiom, or piece of wordplay;
- a whole-word nested chain;
- a subword group;
- a true one-sided or two-sided directional clue;
- a branch with three levels.

Do not force every type into every puzzle. In particular, do not add an arrow
when a phrase does not require the answer in that exact position.

Use the complete tree to set difficulty. A difficult clue can still be fair if
its parent supplies strong context. A simple clue can support a harder parent.
Subword context usually lowers difficulty. Extra depth, indirect wording, and
knowledge from several subjects usually increase it. Prefer solvable wordplay
over obscure facts with no useful context.

Avoid these common problems:

- a clue that repeats or nearly repeats its answer;
- a directional marker on a normal definition;
- two arrow sides that do not work as independent pairs;
- a subword answer that becomes immediate from almost the complete word;
- several branches with the same clue style and rhythm;
- one very hard leaf that blocks most of the puzzle.

## Review checklist

Before you save a puzzle:

1. Resolve every leaf clue by hand.
2. Insert each answer into its parent and read the completed clue aloud.
3. Check each arrow in its exact direction.
4. For a two-sided clue, test the left-answer pair and the answer-right pair
   separately.
5. Check that subword insertions produce the intended spelling and accents.
6. Confirm that the root expansion matches the final sentence exactly.
7. Use the author preview and correct all validation errors and warnings.
8. Complete a test solve before publication.

The schema and engine also reject missing references, duplicate ownership,
cycles, unreachable clues, answer collisions, unsafe text, and an incorrect
final expansion.
