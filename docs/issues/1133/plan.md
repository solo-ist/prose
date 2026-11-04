# #1133 — A pasted image whose file name contains spaces turns into literal markdown text on the next round trip

Issue: https://github.com/solo-ist/prose/issues/1133 (epic #1094, Wave 4). Branch `issue-1133-image-paths` from
`release/v1.9.0`; renderer-only; one PR, merge commit, green CI and claude review. Fourth item of tranche 2
(2026-11-04); independent of the open table and code-block PRs (no shared file).

## Mechanism, confirmed

- `file:saveImage` keeps the pasted file's base name, so a macOS screenshot saves as
  `Screenshot 2026-10-30 at 1.45.22 AM.png`, spaces and a U+202F narrow no-break space included, and the image
  node's `src` is that relative name.
- The image node serializes through prosemirror-markdown's default image serializer (tiptap-markdown's `image.js`),
  which writes `src` raw apart from backslash-escaping parentheses: `![alt](Screenshot 2026-10-30 at 1.45.22 AM.png)`.
- markdown-it does not accept a link destination with whitespace unless it is wrapped in `<…>` or percent-encoded,
  so the next parse (tab switch, reopen) yields a paragraph of text, and the serialize after that escapes the
  brackets, which makes it permanent.
- Display is unaffected by encoding: `resolveImageSrc` builds `local-file://<dir>/<src>` and the protocol handler
  `decodeURIComponent`s the path, so a percent-encoded `src` resolves to the same file (and a raw one is encoded by
  `new URL`).

## Change

`extensions/image/index.ts`: a `markdown.serialize` on `ImageWithUpload` that writes the default form with the
`src` percent-encoded where markdown-it needs it: every whitespace character (space, tab, newline, no-break and
narrow no-break spaces) and `<` / `>`. Everything else is left as it is, so a `src` that already holds `%20` (every
reload yields one: markdown-it normalizes the destination) is not encoded twice and the output is idempotent, and
URLs keep their `?`, `&`, `#` and `:`. Parentheses stay backslash-escaped as before; `alt` and `title` as before.
Not changed: the saved file's name (`file:saveImage` is `src/main/**`, gated, and the serializer alone closes the
loss).

## Tests

- `extensions/image/index.test.ts` (vitest): an image node whose `src` holds spaces and U+202F serializes
  percent-encoded, parses back as an image (not text) and serializes the same again; a `src` already encoded is
  unchanged; an `https` URL with a query string is unchanged; a parenthesis is backslash-escaped; the raw spaced
  form in a file still parses as text (the loss this prevents) while the `<…>` form parses as an image. Falsified
  against the unmodified extension first.
- `e2e/electron.image-paths.spec.ts` (new): a document in a folder beside a real PNG with the screenshot name; an
  image node with that name is inserted, the markdown has one percent-encoded image line and no escaped bracket,
  reloading that markdown gives an `<img>` that loads (`naturalWidth > 0`) through `local-file://`, and the
  markdown is identical after the reload. Falsified on a build of the release head's renderer.

## Execution log

- 2026-11-04: inventory (above).
