# reMarkable `.rm` test fixtures

These are real reMarkable v6 `.lines` (`.rm`) files used to regression-test the
typed-text parser in `src/main/remarkable/rm-scene-parser.ts`
(see `e2e/electron.remarkable-parser.spec.ts`).

They are vendored from the **rmscene** project by Rick Lupton
(https://github.com/ricklupton/rmscene), `tests/data/`, which is **MIT-licensed**
(© 2023 Rick Lupton). Our parser is a TypeScript port of rmscene, so testing
against rmscene's own fixtures keeps the two in agreement.

| File | Content |
|------|---------|
| `Normal_AB.rm` | A single plain paragraph "AB". |
| `Bold_Heading_Bullet_Normal.rm` | Bold, heading, bullet, and plain paragraphs. |
| `test-crdt-ordering.rm` | Concurrent-author edits — exercises the CRDT toposort ("A12_Z"). |
| `Normal_A_stroke_2_layers_v3.3.2.rm` | Typed text **and** handwriting strokes (mixed page). |
| `Lines_v2.rm` | Pure handwriting, no typed text. |
