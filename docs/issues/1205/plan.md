# #1205 — Code block copy button: a clipboard icon instead of the word Copy

Issue: https://github.com/solo-ist/prose/issues/1205 (QA §11 of the 1.9.0 section-B pass, on #1111). Branch
`issue-1205-copy-icon` from `release/v1.9.0` = `d3e4b0e`; renderer-only; one PR, merge commit, green CI and claude
review.

## Change

- `extensions/code-block-markdown/index.ts`: the node view's button shows lucide's `clipboard` glyph, and `check`
  for the 1.5 s copied state, both built with `createElementNS` (no `innerHTML`). `aria-label` and `title` carry the
  words ("Copy code" / "Copied"); `data-state` (`idle` / `copied`) is the hook for CSS and the spec.
- `index.css`: the button becomes a small square (`inline-flex`, even padding, `line-height: 0`); the copied state
  takes the foreground colour. Hover reveal and the read-only hide are unchanged.

## Tests

`e2e/electron.code-copy.spec.ts` asserts the label, `data-state`, one `svg` and no text, before and after the
click, and the return to `idle`. Falsified on a build of the merge-base's `src` (no `data-state` there).

## Execution log

- 2026-11-04: inventory (above).
