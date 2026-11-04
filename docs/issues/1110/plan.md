# #1110 — sup/sub write raw HTML into the markdown instead of markdown syntax

Issue: https://github.com/solo-ist/prose/issues/1110 (epic #1094, Wave 4d, the lowest severity in the wave).
Branch `issue-1110-sup-sub-markdown` from `release/v1.9.0`; renderer plus two parser dependencies; one PR, merge
commit, green CI and claude review. Third item of tranche 2 (2026-11-04).

## Mechanism, confirmed

tiptap-markdown maps every schema mark to its HTML fallback and overrides only marks that declare a
`storage.markdown` spec. `@tiptap/extension-superscript` and `-subscript` declare none, so the marks are written
as `<sup>…</sup>` / `<sub>…</sub>`; `Underline` is the same shape (`<u>`). With `html: true` this round-trips, so
it is cosmetic today; with `html: false` the marks would serialize to nothing, which is why that is not the fix.
Only `markdown-it-footnote` and `markdown-it-task-lists` are dependencies; nothing parses `^x^` or `~x~`.

## Change

- Dependencies: `markdown-it-sup` and `markdown-it-sub` (the pandoc syntax, `^x^` and `~x~`), typed by a small
  module declaration beside the other renderer types.
- `extensions/sup-sub-markdown/index.ts` (new): `SuperscriptMarkdown = Superscript.extend(...)` and
  `SubscriptMarkdown = Subscript.extend(...)`, each with a `markdown` storage spec: `serialize` `{ open, close }`
  with the caret or the tilde, and `parse.setup` that installs the matching markdown-it plugin. Parser and
  serializer land together, so the round trip is symmetric.
- `components/editor/extensions.ts`: the two in place of `Superscript` and `Subscript`.

Said out loud, as the issue asks: `Underline` keeps writing `<u>` because markdown has no syntax for it. Two
consequences of the new syntax to know about: prosemirror-markdown already escapes a literal `~` as `\~`, so plain
text with tildes is unaffected; it does not escape `^`, so a document that holds a literal `^word^` pair reads as a
superscript after this change, the same reading pandoc and any markdown-it-sup renderer give it.

## Tests

`extensions/sup-sub-markdown/index.test.ts` (vitest, the app's extension list): `x^2^` parses to a superscript mark
and serializes back as `x^2^`; `H~2~O` likewise with subscript; a file that holds `<sup>2</sup>` still parses and
now writes `^2^`; `~~gone~~` is still strikethrough and a lone `\~` stays literal; a table cell with a superscript
still serializes as a pipe table; underline still writes `<u>`. Falsified against the unmodified list first.

## Execution log

- 2026-11-04: inventory (above).
