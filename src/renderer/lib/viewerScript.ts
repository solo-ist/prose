/**
 * The inline comment viewer embedded in exported/shared Prose HTML artifacts
 * (#768). Authored as template-literal strings — no build step, diffable, and
 * inlined verbatim into the artifact by htmlExport.ts.
 *
 * Contract with the artifact:
 * - Comment threads live in `<script type="application/x-prose-comments"
 *   data-encoding="base64">` (base64 JSON, see EmbeddedCommentsBlock).
 * - Share config (published artifacts only) lives in
 *   `<script type="application/x-prose-share">` (plain JSON, no token — the
 *   viewer reads the token from `window.location.pathname`).
 * - Comment anchors are the `span[data-comment-id].comment-mark` elements
 *   already present in the exported editor HTML.
 *
 * Commenting works in BOTH modes (#768 tier 3):
 * - Served from /s/<token> → new comments POST to the gateway.
 * - Opened from file:// (or any non-share origin) → new comments are held in
 *   the page and "Download annotated copy" serializes the ORIGINAL artifact +
 *   additions into a new self-contained file. Prose re-imports that file's
 *   comments as real threads (lib/artifactImport.ts) — the sneakernet loop.
 *   A copy downloaded from the served page also carries its share URL: drafts
 *   publish back in one exchange, and the copy joins the live loop (pull on
 *   open + poll), so a reload re-shows what it published and author replies
 *   reach the local reader. Copies without the URL stay fully offline.
 *
 * Security invariants (do not regress):
 * - Comment/author content is rendered ONLY via `textContent` /
 *   `createTextNode` — never `innerHTML`.
 * - The viewer never evals or injects markup from the embedded JSON.
 *
 * Anchor algorithm: new comments computed here MUST mirror the editor's
 * `restoreComments` normalization (strip ASCII spaces only, count
 * non-overlapping occurrences) — see extensions/comments/extension.ts. The artifact's
 * `<article>` wraps exactly `editor.getHTML()`, so `article.textContent`
 * matches the editor doc's `textContent` modulo block-separator spaces, which
 * the normalization removes.
 */

/**
 * Base sheet for viewer-carrying artifacts — the "two materials" design:
 * the article is a blog (serif, 660px column, ivory/ink inversion pair via
 * the blog vars --bg/--fg/--article-muted/--rule), everything Prose adds is
 * IBM Plex Mono on the app's shadcn token set (hsl(var(--…)) pairs, values
 * mirroring src/renderer/index.css Mono light/dark — keep them in step).
 * Theme = `.dark` on <html>, set by THEME_INIT_SCRIPT before first paint and
 * toggled at runtime; there are deliberately NO prefers-color-scheme blocks.
 */
export const ARTIFACT_BASE_STYLES = `
  :root {
    --bg: #f2efe6;
    --fg: #0a0a0a;
    --article-muted: rgba(10, 10, 10, 0.55);
    --rule: rgba(10, 10, 10, 0.14);
    --wordmark: #0F0F0F;
    --code-bg: rgba(10, 10, 10, 0.05);
    --font-mono: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    --font-serif: 'Newsreader', Georgia, 'Times New Roman', serif;
    --font-display: 'Fraunces', Georgia, serif;
    --background: 0 0% 100%;
    --foreground: 240 10% 3.9%;
    --card: 0 0% 100%;
    --popover: 0 0% 100%;
    --primary: 240 5.9% 10%;
    --primary-foreground: 0 0% 98%;
    --muted: 240 4.8% 95.9%;
    --muted-foreground: 240 3.8% 46.1%;
    --border: 240 5.9% 90%;
    --input: 240 5.9% 90%;
    --pending: 330 81% 60%;
    --comment-mark-bg: 45 100% 70%;
    --comment: 45 100% 50%;
  }
  html.dark {
    --bg: #0a0a0a;
    --fg: #f2efe6;
    --article-muted: rgba(242, 239, 230, 0.5);
    --rule: rgba(242, 239, 230, 0.14);
    --wordmark: #E2D9CB;
    --code-bg: rgba(242, 239, 230, 0.08);
    --background: 240 10% 3.9%;
    --foreground: 0 0% 98%;
    --card: 240 10% 3.9%;
    --popover: 240 10% 3.9%;
    --primary: 0 0% 98%;
    --primary-foreground: 240 5.9% 10%;
    --muted: 240 3.7% 15.9%;
    --muted-foreground: 240 5% 64.9%;
    --border: 240 3.7% 15.9%;
    --input: 240 3.7% 15.9%;
    --pending: 330 70% 55%;
    --comment-mark-bg: 45 100% 40%;
    --comment: 45 100% 60%;
  }
  html { background: var(--bg); }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--fg);
    font-family: var(--font-serif);
    font-weight: 400;
    -webkit-font-smoothing: antialiased;
    transition: background 0.3s ease, color 0.3s ease;
  }
  ::selection { background: var(--fg); color: var(--bg); }
  article {
    max-width: 660px;
    margin: 0 auto;
    padding: 0 24px;
    font-size: 19px;
    line-height: 1.62;
  }
  article h1 {
    font-size: clamp(40px, 5.4vw, 60px);
    font-weight: 300;
    line-height: 1.04;
    letter-spacing: -0.022em;
    margin: 1.4em 0 0.5em;
  }
  article > h1:first-child { margin-top: 0; margin-bottom: 18px; }
  article h2 {
    font-size: clamp(26px, 3vw, 32px);
    font-weight: 300;
    line-height: 1.15;
    letter-spacing: -0.015em;
    margin: 1.6em 0 0.8em;
  }
  article h3 { font-size: 23px; font-weight: 400; line-height: 1.3; margin: 1.6em 0 0.6em; }
  article h4 { font-size: 19px; font-weight: 600; line-height: 1.4; margin: 1.6em 0 0.5em; }
  article p { margin: 0 0 1.4em; }
  article a { color: var(--fg); text-decoration: none; border-bottom: 1px solid var(--rule); padding-bottom: 1px; }
  article ul, article ol { margin: 0 0 1.4em; padding-left: 1.4em; }
  article li { margin: 0.25em 0; }
  article li p { margin: 0; }
  article hr { border: none; border-top: 1px solid var(--rule); margin: 2.5em 0; }
  article blockquote { border-left: 2px solid var(--rule); margin: 0 0 1.4em; padding-left: 1.25rem; color: var(--article-muted); }
  article pre {
    background: var(--code-bg);
    padding: 1rem;
    border-radius: 6px;
    overflow-x: auto;
    font-family: var(--font-mono);
    font-size: 14px;
    line-height: 1.55;
    margin: 0 0 1.4em;
  }
  article code { font-family: var(--font-mono); font-size: 0.8em; background: var(--code-bg); padding: 0.15em 0.35em; border-radius: 4px; }
  article pre code { background: transparent; padding: 0; font-size: inherit; }
  article img { max-width: 100%; }
  article table { border-collapse: collapse; width: 100%; font-size: 16px; margin: 0 0 1.4em; }
  article th, article td { border: 1px solid var(--rule); padding: 0.5rem; text-align: left; }
  article ul[data-type="taskList"] { list-style: none; padding-left: 0; }
  article ul[data-type="taskList"] li { display: flex; align-items: flex-start; gap: 0.5rem; }
  article ul[data-type="taskList"] li label { flex-shrink: 0; margin-top: 0.2rem; }
  article ul[data-type="taskList"] li div, article ul[data-type="taskList"] li p { margin: 0; }
  .prose-page { position: relative; }
  .prose-topbar {
    position: sticky;
    top: 0;
    z-index: 5;
    height: 52px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    /* Right padding matches the panel's right inset so the tools cluster
       sits flush with the panel edge below it. */
    padding: 0 20px 0 24px;
    background: var(--bg);
    transition: background 0.3s ease;
  }
  .prose-wordmark {
    display: inline-flex;
    align-items: baseline;
    gap: 0.16em;
    font-family: var(--font-display);
    font-style: italic;
    font-weight: 700;
    font-size: 22px;
    letter-spacing: -0.012em;
    color: var(--wordmark);
    line-height: 1;
  }
  .prose-wordmark .prose-pilcrow { font-size: 0.92em; }
  .prose-topbar-tools {
    display: flex;
    align-items: center;
    gap: 14px;
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.04em;
    color: hsl(var(--muted-foreground));
  }
  #prose-rail-toggle, #prose-theme-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: none;
    background: none;
    padding: 0;
    margin: 0;
    font: inherit;
    letter-spacing: inherit;
    color: inherit;
    cursor: pointer;
    min-height: 44px;
  }
  .prose-comment-dot { width: 6px; height: 6px; border-radius: 50%; background: hsl(var(--comment)); }
  .prose-topbar-divider { width: 1px; height: 14px; background: hsl(var(--border)); }
  #prose-theme-toggle svg { display: block; }
  .prose-icon-sun { display: none; }
  html.dark .prose-icon-sun { display: block; }
  html.dark .prose-icon-moon { display: none; }
  .prose-doc-header, .prose-end-mark, .prose-artifact-footer {
    width: calc(100% - 48px);
    max-width: 660px;
    margin-left: auto;
    margin-right: auto;
  }
  .prose-doc-header { padding-top: 78px; }
  .prose-doc-eyebrow {
    font-size: 11px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--article-muted);
    margin-bottom: 28px;
  }
  .prose-doc-title {
    font-size: clamp(40px, 5.4vw, 60px);
    font-weight: 300;
    line-height: 1.04;
    letter-spacing: -0.022em;
    margin: 0 0 18px;
  }
  .prose-end-mark {
    margin-top: 80px;
    padding-top: 32px;
    border-top: 1px solid var(--rule);
    font-size: 12px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--article-muted);
  }
  .prose-artifact-footer {
    margin-top: 72px;
    padding-bottom: 64px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px 24px;
    justify-content: space-between;
    align-items: baseline;
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.5;
    color: hsl(var(--muted-foreground));
  }
  #prose-download-copy {
    color: hsl(var(--foreground));
    text-decoration: none;
    border-bottom: 1px solid hsl(var(--border));
    cursor: pointer;
  }
  #prose-download-copy.prose-has-additions {
    color: hsl(var(--comment));
    border-bottom-color: hsl(var(--comment));
  }
  @media (max-width: 640px) {
    article { font-size: 17px; line-height: 1.6; }
    .prose-doc-header { padding-top: 56px; }
    .prose-artifact-footer { padding-bottom: 48px; }
  }
`

/**
 * Emitted inline in <head> BEFORE the stylesheet so the theme class lands
 * pre-paint (no flash). Stored preference wins; falls back to the OS scheme.
 * Uses toggle() so a stray baked class can never lock a viewer into dark.
 */
export const THEME_INIT_SCRIPT = `(function () {
  var dark = false
  try {
    var stored = window.localStorage.getItem('prose-viewer-theme')
    dark = stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch (e) {
    try { dark = window.matchMedia('(prefers-color-scheme: dark)').matches } catch (e2) { /* no matchMedia */ }
  }
  document.documentElement.classList.toggle('dark', dark)
})()`

export const VIEWER_STYLES = `
  .comment-mark {
    background: hsl(var(--comment-mark-bg) / 0.32);
    border-bottom: 1.5px solid hsl(var(--comment) / 0.75);
    border-radius: 2px;
    cursor: pointer;
  }
  .comment-mark.prose-viewer-active {
    background: hsl(var(--comment-mark-bg) / 0.55);
    border-bottom-color: hsl(var(--comment));
  }
  #prose-comment-rail {
    position: fixed;
    top: 64px;
    right: 20px;
    bottom: 20px;
    width: 340px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    font-family: var(--font-mono);
    font-size: 12.5px;
    line-height: 1.5;
    color: hsl(var(--foreground));
    background: hsl(var(--background));
    border: 1px solid hsl(var(--border));
    border-radius: 12px;
    /* Always shadow in black — a foreground-based shadow glows white on
       dark mode ("looks a little cheesy" — Angel). The border carries the
       separation in dark; the shadow reads in light. */
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.12);
    z-index: 5;
  }
  /* One compact chrome bar in every mode — local-copy state lives IN the
     top bar, so the panel always starts 12px below it. */
  /* The article yields to the panel only where its own right whitespace
     can't hold it; at >=1460px the 660px column's margin fits the panel and
     the page stays perfectly centered — the panel truly floats. */
  @media (max-width: 1459px) {
    body.prose-rail-open .prose-page { padding-right: 372px; }
  }
  @media (max-width: 999px) {
    #prose-comment-rail { display: none; }
    body.prose-rail-open .prose-page { padding-right: 0; }
  }
  .prose-rail-head {
    flex-shrink: 0;
    padding: 12px 16px 0;
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    letter-spacing: 0.04em;
    color: hsl(var(--muted-foreground));
  }
  .prose-rail-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: thin;
    padding: 12px 16px 16px;
  }
  .prose-rail-head-left { display: inline-flex; align-items: center; gap: 10px; }
  .prose-rail-right { display: inline-flex; align-items: center; gap: 10px; }
  .prose-rail-mode { display: inline-flex; gap: 8px; }
  .prose-rail-mode button {
    border: none;
    background: none;
    padding: 0;
    margin: 0;
    font: inherit;
    letter-spacing: inherit;
    color: inherit;
    cursor: pointer;
  }
  .prose-rail-mode button.prose-mode-on { color: hsl(var(--foreground)); }
  .prose-focus-nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 9px;
    font-size: 11px;
    letter-spacing: 0.04em;
    color: hsl(var(--muted-foreground));
  }
  .prose-focus-nav button {
    width: 26px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid hsl(var(--border));
    border-radius: 6px;
    background: none;
    font: 14px var(--font-mono);
    color: hsl(var(--foreground));
    cursor: pointer;
  }
  .prose-focus-empty { color: hsl(var(--muted-foreground)); font-size: 11.5px; }
  .prose-offline-chip { display: inline-flex; align-items: center; gap: 5px; }
  .prose-offline-dot {
    width: 6px;
    height: 6px;
    box-sizing: border-box;
    border-radius: 50%;
    border: 1.5px solid hsl(var(--pending));
  }
  .prose-thread {
    box-sizing: border-box;
    border: 1px solid hsl(var(--border));
    border-radius: 10px;
    padding: 12px;
    margin-bottom: 9px;
    background: hsl(var(--muted) / 0.5);
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
  }
  .prose-thread:hover { background: hsl(var(--muted) / 0.85); border-color: hsl(var(--muted-foreground) / 0.3); }
  .prose-thread.prose-viewer-active { border-left: 2px solid hsl(var(--comment)); padding-left: 11px; }
  .prose-card-head { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; color: hsl(var(--muted-foreground)); }
  .prose-card-name {
    color: hsl(var(--foreground));
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .prose-card-date { flex-shrink: 0; }
  .prose-author-tag { font-weight: 400; color: hsl(var(--muted-foreground)); }
  .prose-thread-body { white-space: pre-wrap; word-break: break-word; margin-top: 6px; }
  .prose-thread-quote {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    font-family: var(--font-serif);
    font-style: italic;
    font-size: 13.5px;
    line-height: 1.4;
    color: hsl(var(--foreground) / 0.8);
    margin-bottom: 8px;
  }
  .prose-thread-meta { color: hsl(var(--muted-foreground)); font-size: 11px; margin-top: 0.25rem; }
  .prose-thread-reply { margin-top: 10px; padding-top: 10px; border-top: 1px solid hsl(var(--border) / 0.5); }
  .prose-thread-reply .prose-thread-body { margin-top: 4px; }
  .prose-resolved-section .prose-thread { opacity: 0.6; }
  .prose-resolved-section .prose-thread:hover { opacity: 1; }
  .prose-resolved-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 0;
    margin-bottom: 10px;
    border-top: 1px solid hsl(var(--border));
    font-size: 11px;
    letter-spacing: 0.04em;
    color: hsl(var(--muted-foreground));
  }
  .prose-resolved-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: none;
    background: none;
    padding: 0;
    margin: 0;
    font: inherit;
    letter-spacing: inherit;
    color: inherit;
    cursor: pointer;
  }
  .prose-resolved-chev { display: inline-block; font-size: 13px; line-height: 1; transition: transform 0.15s ease; }
  .prose-resolved-section.prose-open .prose-resolved-chev { transform: rotate(90deg); }
  .prose-resolved-section .prose-thread,
  .prose-lost-section .prose-thread {
    cursor: default;
  }
  .prose-resolved-section .prose-thread {
    background: transparent;
    color: hsl(var(--muted-foreground));
  }
  .prose-resolved-section .prose-thread-quote { text-decoration: line-through; text-decoration-color: hsl(var(--border)); }
  .prose-lost-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 0;
    margin-bottom: 10px;
    border-top: 1px solid hsl(var(--border));
    font-size: 11px;
    letter-spacing: 0.04em;
    color: hsl(var(--muted-foreground));
  }
  .prose-thread-lost { border-style: dashed; }
  .prose-thread-lost .prose-thread-quote { margin-bottom: 4px; }
  .prose-lost-note { font-size: 11px; color: hsl(var(--muted-foreground)); margin-bottom: 10px; }
  .prose-not-sent {
    color: hsl(var(--pending));
    text-decoration: underline dashed hsl(var(--pending));
    text-underline-offset: 3px;
  }
  .prose-offline-section { margin-top: 8px; }
  .prose-offline-card {
    box-sizing: border-box;
    border: 1px solid hsl(var(--border));
    border-left: 2px solid hsl(var(--pending));
    border-radius: 8px;
    padding: 12px 14px 12px 13px;
    background: hsl(var(--card));
    font-size: 11.5px;
    line-height: 1.6;
  }
  .prose-offline-card button {
    border: none;
    height: 30px;
    margin-top: 10px;
    padding: 0 12px;
    border-radius: 6px;
    display: inline-flex;
    align-items: center;
    font: 500 12px var(--font-mono);
    background: hsl(var(--primary));
    color: hsl(var(--primary-foreground));
    cursor: pointer;
  }
  .prose-offline-note { margin-top: 8px; font-size: 11px; color: hsl(var(--muted-foreground)); }
  /* The local-copy readout is a FLEX CHILD of the top bar between wordmark
     and tools — one compact bar, and long state text ellipsizes instead of
     ever overlapping the Publish button or the count (QA screenshot). */
  #prose-file-banner {
    flex: 1;
    min-width: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    overflow: hidden;
    white-space: nowrap;
    padding: 0 16px;
    font-family: var(--font-mono);
    font-size: 11.5px;
    letter-spacing: 0.02em;
    color: hsl(var(--muted-foreground));
  }
  .prose-local-label { flex-shrink: 0; }
  .prose-local-state { overflow: hidden; text-overflow: ellipsis; }
  .prose-local-state:not(:empty)::before { content: '·'; margin-right: 8px; }
  .prose-local-state.prose-local-err { color: hsl(var(--pending)); }
  #prose-publish-comments {
    border: none;
    height: 26px;
    padding: 0 12px;
    border-radius: 6px;
    display: inline-flex;
    align-items: center;
    font: 500 11.5px var(--font-mono);
    background: hsl(var(--comment));
    color: #0a0a0a;
    cursor: pointer;
  }
  #prose-publish-comments[disabled] { opacity: 0.6; cursor: default; }
  .prose-rail-note {
    flex-shrink: 0;
    padding: 4px 16px 10px;
    border-bottom: 1px solid hsl(var(--border) / 0.6);
    color: hsl(var(--muted-foreground));
    font-size: 11px;
    line-height: 1.45;
  }
  #prose-add-comment-btn {
    position: absolute;
    z-index: 12;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 30px;
    padding: 0 12px;
    border: 1px solid hsl(var(--border));
    border-radius: 6px;
    font: 12px var(--font-mono);
    background: hsl(var(--popover));
    color: hsl(var(--foreground));
    cursor: pointer;
    box-shadow: 0 4px 12px rgb(0 0 0 / 0.2);
  }
  #prose-float-form {
    position: absolute;
    z-index: 12;
    width: 384px;
    max-width: calc(100vw - 32px);
    box-sizing: border-box;
    border: 1px solid hsl(var(--border));
    border-radius: 12px;
    background: hsl(var(--popover));
    box-shadow: 0 12px 32px rgb(0 0 0 / 0.24);
    font-family: var(--font-mono);
    font-size: 12.5px;
    line-height: 1.5;
    color: hsl(var(--foreground));
  }
  #prose-comment-form {
    border: 1px solid hsl(var(--border));
    border-radius: 8px;
    padding: 12px 14px;
    background: hsl(var(--card));
  }
  #prose-float-form #prose-comment-form {
    border: none;
    border-radius: 12px;
    background: transparent;
  }
  .prose-form-eyebrow {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: hsl(var(--muted-foreground));
    margin-bottom: 6px;
  }
  .prose-form-anchor .prose-thread-quote {
    border-left: 2px solid hsl(var(--comment));
    padding-left: 10px;
    margin-bottom: 0;
  }
  #prose-comment-form textarea {
    display: block;
    width: 100%;
    box-sizing: border-box;
    margin-top: 10px;
    min-height: 72px;
    padding: 8px 10px;
    border: 1px solid hsl(var(--input));
    border-radius: 6px;
    font: inherit;
    background: transparent;
    color: inherit;
    resize: none;
    outline: none;
  }
  .prose-form-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }
  .prose-form-fields > :only-child { grid-column: 1 / -1; }
  #prose-comment-form input {
    height: 32px;
    box-sizing: border-box;
    min-width: 0;
    padding: 0 10px;
    border: 1px solid hsl(var(--input));
    border-radius: 6px;
    font: inherit;
    background: transparent;
    color: inherit;
    outline: none;
  }
  .prose-form-helper { margin-top: 6px; font-size: 11px; line-height: 1.5; color: hsl(var(--muted-foreground)); }
  .prose-form-error {
    margin-top: 8px;
    padding: 8px 10px;
    border-radius: 6px;
    background: hsl(var(--muted) / 0.5);
    font-size: 11.5px;
    line-height: 1.5;
    color: hsl(var(--foreground));
  }
  .prose-form-actions { margin-top: 12px; display: flex; gap: 8px; align-items: center; }
  /* The commenting accent is amber — Post matches Publish, and reads as
     THE action in the floating card ("could be more pronounced" — Angel). */
  #prose-comment-form button {
    border: none;
    height: 30px;
    padding: 0 14px;
    border-radius: 6px;
    display: inline-flex;
    align-items: center;
    font: 600 12px var(--font-mono);
    background: hsl(var(--comment));
    color: #0a0a0a;
    cursor: pointer;
  }
  #prose-comment-form button.prose-secondary { background: transparent; color: hsl(var(--muted-foreground)); padding: 0 10px; }
  .prose-form-kbd { margin-left: auto; font-size: 11px; color: hsl(var(--muted-foreground)); }
  .prose-reply-link {
    display: block;
    border: none;
    background: none;
    padding: 0;
    margin-top: 10px;
    font: inherit;
    font-size: 11px;
    color: hsl(var(--muted-foreground));
    cursor: pointer;
  }
  .prose-reply-link:hover { color: hsl(var(--foreground)); }
  .prose-reply-composer {
    margin-top: 10px;
    padding-left: 10px;
    border-left: 1px solid hsl(var(--comment) / 0.6);
  }
  .prose-reply-composer textarea {
    display: block;
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    border: 1px solid hsl(var(--input));
    border-radius: 6px;
    font: inherit;
    background: transparent;
    color: inherit;
    resize: none;
    outline: none;
  }
  .prose-reply-composer input {
    display: block;
    width: 100%;
    box-sizing: border-box;
    margin-top: 8px;
    height: 28px;
    padding: 0 10px;
    border: 1px solid hsl(var(--input));
    border-radius: 6px;
    font: inherit;
    background: transparent;
    color: inherit;
    outline: none;
  }
  .prose-reply-actions { margin-top: 8px; display: flex; gap: 8px; align-items: center; }
  .prose-reply-actions button {
    border: none;
    height: 28px;
    padding: 0 12px;
    border-radius: 6px;
    display: inline-flex;
    align-items: center;
    font: 600 12px var(--font-mono);
    background: hsl(var(--comment));
    color: #0a0a0a;
    cursor: pointer;
  }
  .prose-reply-actions button.prose-reply-cancel { background: none; color: hsl(var(--muted-foreground)); padding: 0 8px; }
  .prose-reply-as { margin-left: auto; font-size: 11px; color: hsl(var(--muted-foreground)); }
  .prose-nudge {
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid hsl(var(--border));
    font-size: 11px;
    line-height: 1.6;
    color: hsl(var(--muted-foreground));
  }
  .prose-nudge-dismiss {
    border: none;
    background: none;
    padding: 0;
    margin-left: 6px;
    font: inherit;
    color: hsl(var(--muted-foreground));
    text-decoration: underline;
    cursor: pointer;
  }
  #prose-bottom-bar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 15;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 18px 16px 14px;
    background: linear-gradient(to top, var(--bg) 62%, transparent);
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.04em;
    color: hsl(var(--muted-foreground));
    pointer-events: none;
  }
  #prose-bottom-bar > * { pointer-events: auto; }
  #prose-bottom-bar button {
    border: 1px solid hsl(var(--border));
    border-radius: 6px;
    background: hsl(var(--popover));
    color: hsl(var(--foreground));
    font: 500 12px var(--font-mono);
    height: 34px;
    padding: 0 14px;
    display: inline-flex;
    align-items: center;
    cursor: pointer;
  }
  body.prose-narrow .prose-artifact-footer { padding-bottom: 132px; }
  sup.prose-mark-index {
    font-family: var(--font-mono);
    font-size: 10px;
    line-height: 1;
    color: hsl(var(--comment));
    cursor: pointer;
  }
  sup.prose-mark-index::after { content: attr(data-n); }
  #prose-sheet {
    position: fixed;
    inset: 0;
    z-index: 30;
    display: flex;
    flex-direction: column;
    background: hsl(var(--background));
    color: hsl(var(--foreground));
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 1.55;
  }
  .prose-sheet-head {
    flex-shrink: 0;
    height: 54px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    border-bottom: 1px solid hsl(var(--border));
    font-size: 12px;
    color: hsl(var(--muted-foreground));
  }
  .prose-sheet-back {
    border: none;
    background: none;
    padding: 0;
    font: inherit;
    color: hsl(var(--foreground));
    cursor: pointer;
    min-height: 44px;
    display: inline-flex;
    align-items: center;
  }
  .prose-sheet-nav { display: inline-flex; align-items: center; gap: 2px; }
  .prose-sheet-step {
    border: none;
    background: none;
    padding: 0 12px;
    font: inherit;
    font-size: 17px;
    line-height: 1;
    color: hsl(var(--foreground));
    cursor: pointer;
    min-height: 44px;
    display: inline-flex;
    align-items: center;
  }
  .prose-sheet-scroll { flex: 1; overflow-y: auto; padding: 16px; }
  .prose-sheet-quote {
    display: block;
    font-family: var(--font-serif);
    font-size: 17px;
    line-height: 1.5;
    border-left: 2px solid hsl(var(--comment));
    padding-left: 12px;
    margin-bottom: 16px;
    color: hsl(var(--muted-foreground));
  }
  .prose-sheet-thread .prose-thread-body { margin-top: 6px; }
  .prose-sheet-composer {
    flex-shrink: 0;
    border-top: 1px solid hsl(var(--border));
    padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
  }
  .prose-sheet-as { font-size: 11px; color: hsl(var(--muted-foreground)); margin-bottom: 8px; }
  .prose-sheet-composer textarea, .prose-sheet-composer input {
    display: block;
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    border: 1px solid hsl(var(--input));
    border-radius: 6px;
    font: inherit;
    background: transparent;
    color: inherit;
    resize: none;
    outline: none;
  }
  .prose-sheet-composer input { height: 34px; margin-top: 8px; }
  .prose-sheet-send {
    margin-top: 10px;
    width: 100%;
    height: 44px;
    border: none;
    border-radius: 6px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font: 500 13px var(--font-mono);
    background: hsl(var(--primary));
    color: hsl(var(--primary-foreground));
    cursor: pointer;
  }
  #prose-narrow-form-wrap {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 20;
    padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
    background: var(--bg);
    border-top: 1px solid hsl(var(--border));
    font-family: var(--font-mono);
    font-size: 12.5px;
    line-height: 1.5;
    color: hsl(var(--foreground));
  }
`

export const VIEWER_SCRIPT = `(function () {
  'use strict'

  // --- Parse the embedded blocks -------------------------------------------
  var commentsEl = document.querySelector('script[type="application/x-prose-comments"]')
  var shareEl = document.querySelector('script[type="application/x-prose-share"]')
  var article = document.querySelector('article')
  // Baked chrome (top bar, footer) ships in the same artifact as this script;
  // missing nodes mean a malformed artifact — stand down instead of crashing.
  var toggle = document.getElementById('prose-rail-toggle')
  var railCount = document.getElementById('prose-rail-count')
  var downloadBtn = document.getElementById('prose-download-copy')
  var themeToggle = document.getElementById('prose-theme-toggle')
  if (!article || !toggle || !downloadBtn) return
  var pageRoot = document.querySelector('.prose-page') || document.body

  var blockMeta = { version: 1, publishRev: '', publishedAt: '' }
  var comments = []
  try {
    if (commentsEl) {
      var decoded = decodeURIComponent(escape(atob(commentsEl.textContent.trim())))
      var block = JSON.parse(decoded)
      if (block && Array.isArray(block.comments)) {
        comments = block.comments
        blockMeta.publishRev = typeof block.publishRev === 'string' ? block.publishRev : ''
        blockMeta.publishedAt = typeof block.publishedAt === 'string' ? block.publishedAt : ''
      }
    }
  } catch (e) { /* malformed block: degrade to plain document */ }

  var shareConfig = null
  try {
    if (shareEl) shareConfig = JSON.parse(shareEl.textContent)
  } catch (e) { /* malformed block */ }

  var isFile = window.location.protocol === 'file:'
  var token = null
  if (!isFile) {
    var m = window.location.pathname.match(/\\/s\\/([^/?#]+)/)
    token = m ? m[1] : null
  }
  var online = !!(shareConfig && shareConfig.shareEndpoint && token && !isFile)

  // The comment API base for THIS page:
  // - served (/s/<token>): endpoint from the share block + token from the URL
  //   (the PUBLISHED artifact never embeds the token);
  // - a downloaded annotated copy (file://): the full capability URL the
  //   viewer baked into the copy at download time — the downloader already
  //   held it. This is what lets a local copy publish its comments back.
  var shareApiBase = null
  if (online) {
    shareApiBase = shareConfig.shareEndpoint.replace(/\\/$/, '') + '/s/' + token
  } else if (isFile && shareConfig && typeof shareConfig.shareUrl === 'string' && /^https?:\\/\\//.test(shareConfig.shareUrl)) {
    shareApiBase = shareConfig.shareUrl.replace(/\\/$/, '')
  }
  // Local draft/publish mode: annotate in the file, push in one exchange.
  var canPublish = isFile && !!shareApiBase

  // Comments a reader added in THIS page (offline mode) but hasn't downloaded.
  var localAdditions = 0
  var unsavedAdditions = 0

  function makeId() {
    try {
      if (window.crypto && window.crypto.randomUUID) return 'local-' + window.crypto.randomUUID()
    } catch (e) { /* insecure context */ }
    return 'local-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
  }

  // --- Anchor computation (mirrors restoreComments' normalization) ---------
  // ASCII space (U+0020) ONLY — verified against restoreComments in
  // extensions/comments/extension.ts, which normalizes with replace(/ /g, '')
  // on both the stored markedText and doc.textContent. Do NOT "fix" this to
  // \\s+ or add tabs/NBSP: any divergence from the editor's normalization
  // shifts occurrence indexes and desyncs anchors. If the editor's
  // normalization ever changes, change BOTH sites together.
  function norm(s) { return s.replace(/ /g, '') }

  function computeAnchor(selection) {
    // Selection.toString() renders block boundaries as newlines, but the
    // editor stores cross-block markedText with a single-space separator
    // (textBetween(from, to, ' ')) and its textContent has no newlines at
    // all. Map newline runs to one space at CAPTURE so cross-block anchors
    // round-trip; norm() below still strips spaces only, unchanged.
    var markedText = selection.toString().replace(/\\s*\\n\\s*/g, ' ').replace(/^ +| +$/g, '')
    if (!markedText) return null
    var range = selection.getRangeAt(0)
    if (!article.contains(range.startContainer)) return null
    if (!article.contains(range.commonAncestorContainer)) {
      // A triple-click on the LAST block extends the selection past
      // </article> into the baked chrome. When everything selected outside
      // the article is whitespace, clamp to the article end instead of
      // rejecting; real chrome text in the selection still rejects.
      var overflow = range.cloneRange()
      overflow.setStart(article, article.childNodes.length)
      if (overflow.toString().replace(/\\s+/g, '') !== '') return null
      range = range.cloneRange()
      range.setEnd(article, article.childNodes.length)
    }

    var preRange = document.createRange()
    preRange.selectNodeContents(article)
    preRange.setEnd(range.startContainer, range.startOffset)
    var charsBefore = norm(preRange.toString()).length

    var docNorm = norm(article.textContent)
    var searchNorm = norm(markedText)
    if (!searchNorm) return null

    // Count non-overlapping occurrences strictly before the selection start.
    var occurrenceIndex = 0
    var offset = 0
    while (true) {
      var idx = docNorm.indexOf(searchNorm, offset)
      if (idx === -1 || idx >= charsBefore) break
      occurrenceIndex++
      offset = idx + searchNorm.length
    }
    // No live Range in the result: marks are applied data-driven via
    // anchorThread, exactly as a reloading or live-merging viewer would.
    return { markedText: markedText, occurrenceIndex: occurrenceIndex }
  }

  // --- Mark anchoring (data-driven, mirrors computeAnchor's space) ---------
  // Threads without a baked span (live-merged, or posted before a reload) are
  // re-anchored from markedText + occurrenceIndex. The index is built by
  // walking <article>'s text nodes and skipping ONLY U+0020 — so its text
  // equals norm(article.textContent) by construction (structural parity with
  // computeAnchor; norm() itself stays untouched). Threads that fail to match
  // render in the "Lost their place" section (lostIds — never baked into the
  // artifact data).
  var lostIds = {}

  function buildAnchorIndex() {
    var walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, null)
    var chars = []
    var nodes = []
    var offs = []
    var n
    while ((n = walker.nextNode())) {
      var s = n.nodeValue
      for (var i = 0; i < s.length; i++) {
        if (s.charAt(i) === ' ') continue
        chars.push(s.charAt(i))
        nodes.push(n)
        offs.push(i)
      }
    }
    return { text: chars.join(''), nodes: nodes, offs: offs }
  }

  function anchorThread(c) {
    if (!c || !c.markedText) return false
    var target = norm(String(c.markedText))
    if (!target) return false
    // Rebuilt per thread: wrapping splits text nodes, so a shared snapshot
    // would go stale after the first successful anchor.
    var idx = buildAnchorIndex()
    // Non-overlapping occurrence walk — the same counting rule computeAnchor
    // used when the anchor was created.
    var want = c.occurrenceIndex > 0 ? Math.floor(c.occurrenceIndex) : 0
    var at = -1
    var from = 0
    for (var k = 0; k <= want; k++) {
      at = idx.text.indexOf(target, from)
      if (at === -1) return false
      from = at + target.length
    }
    // Group covered chars into per-text-node runs (interior spaces fall
    // inside a run's offsets, so they get wrapped too), then wrap each run
    // back-to-front — splitting a node's tail never moves earlier offsets.
    var end = at + target.length
    var segs = []
    var p = at
    while (p < end) {
      var node = idx.nodes[p]
      var q = p
      while (q + 1 < end && idx.nodes[q + 1] === node) q++
      segs.push({ node: node, start: idx.offs[p], end: idx.offs[q] + 1 })
      p = q + 1
    }
    for (var si = segs.length - 1; si >= 0; si--) {
      var range = document.createRange()
      range.setStart(segs[si].node, segs[si].start)
      range.setEnd(segs[si].node, segs[si].end)
      var span = document.createElement('span')
      span.setAttribute('data-comment-id', c.id)
      span.className = 'comment-mark'
      try { range.surroundContents(span) } catch (e) { return false }
    }
    return true
  }

  // Unwrap a thread's highlight spans (resolved threads carry no highlight).
  function removeMarks(id) {
    var spans = article.querySelectorAll('span[data-comment-id="' + CSS.escape(id) + '"]')
    for (var i = 0; i < spans.length; i++) {
      var s = spans[i]
      var parent = s.parentNode
      while (s.firstChild) parent.insertBefore(s.firstChild, s)
      parent.removeChild(s)
      parent.normalize()
    }
  }

  function anchorAllThreads() {
    for (var i = 0; i < comments.length; i++) {
      var c = comments[i]
      if (c.resolved) {
        removeMarks(c.id)
        continue
      }
      // Desktop-flagged lost anchors stay lost; everything else re-anchors.
      if (c.anchorLost === true) { lostIds[c.id] = true; continue }
      var hasSpan = article.querySelector('span[data-comment-id="' + CSS.escape(c.id) + '"]')
      if (hasSpan) { delete lostIds[c.id]; continue }
      if (anchorThread(c)) delete lostIds[c.id]
      else lostIds[c.id] = true
    }
  }

  // --- Rail construction (textContent only — never innerHTML) --------------
  function el(tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }

  function formatDate(ts) {
    try {
      if (ts && Date.now() - ts < 60000) return 'just now'
      return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    } catch (e) { return '' }
  }

  function authorLabel(c) {
    if (c.authorName) return c.authorName
    return c.author === 'ai' ? 'AI' : 'Author'
  }

  function storedName() {
    try { return window.localStorage.getItem('prose-commenter-name') || '' } catch (e) { return '' }
  }

  // The reader's email lives in localStorage ONLY — never on a thread object,
  // where it would bake into annotated copies and travel with the file. It is
  // attached at POST time (and at local publish, for this reader's drafts).
  function storedEmail() {
    try { return window.localStorage.getItem('prose-commenter-email') || '' } catch (e) { return '' }
  }

  // Threads/replies this reader created in THIS page session — tagged " · you".
  var mineIds = {}

  // Threads/replies whose POST never reached the server (network down, 5xx).
  // They live in this page only, tagged "not sent"; the annotated copy is the
  // recovery vehicle. Runtime-only, like lostIds — never baked.
  var notSentIds = {}

  // One-time post confirmation, shown inside the newly created thread card.
  // The empty link-slot span reserves room for the future account-layer
  // sign-in link without DOM surgery.
  var NUDGE_COPY = 'Posted. Replies go to your email if you gave one.'
  var nudgeShown = false
  var nudgeThreadId = null

  // Thread id whose inline reply composer is open (one at a time).
  var replyFor = null

  // Shared by the offline path and the failed-POST fallback: the comment
  // stays in the page and arms the annotated-copy download.
  function addLocalThread(anchor, name, text, notSent) {
    var localComment = {
      id: makeId(),
      markedText: anchor.markedText,
      occurrenceIndex: anchor.occurrenceIndex,
      comment: text,
      authorName: name,
      createdAt: Date.now(),
      resolved: false,
      replies: []
    }
    comments.push(localComment)
    localAdditions++
    unsavedAdditions++
    mineIds[localComment.id] = true
    if (notSent) notSentIds[localComment.id] = true
    if (!anchorThread(localComment)) lostIds[localComment.id] = true
    clearForm()
    renderRail()
    setActive(localComment.id, false)
  }

  function addLocalReply(c, name, text, notSent) {
    var localReply = { id: makeId(), author: 'user', authorName: name, text: text, createdAt: Date.now() }
    c.replies = c.replies || []
    c.replies.push(localReply)
    mineIds[localReply.id] = true
    if (notSent) notSentIds[localReply.id] = true
    localAdditions++
    unsavedAdditions++
    replyFor = null
    renderRail()
  }

  // One reply pipeline for the rail composer and the narrow sheet: offline
  // appends locally; online posts to the public route, appends optimistically
  // under the SERVER id (mergeLive dedupes by id, so the next poll can't
  // double it), with the same not-sent fallback semantics as comments.
  function sendReply(c, name, text, onDone, onShownError) {
    try { window.localStorage.setItem('prose-commenter-name', name) } catch (e) { /* blocked storage */ }
    if (!online) {
      addLocalReply(c, name, text, false)
      onDone()
      return
    }
    postReplyRequest(c.id, name, text).then(function (created) {
      c.replies = c.replies || []
      c.replies.push({
        id: created.id,
        text: text,
        authorName: name,
        createdAt: created.createdAt ? new Date(created.createdAt).getTime() : Date.now(),
        fromAuthor: false
      })
      mineIds[created.id] = true
      renderRail()
      window.setTimeout(fetchLiveComments, 2000)
      onDone()
    }).catch(function (err) {
      // A 404 means the thread's server row is gone (pre-revoke history on
      // a re-published link) — the reply can never land there. Keep it in
      // the page tagged "not sent" instead of surfacing a dead-end error;
      // the annotated copy carries it back to the author.
      if (err && err.proseShow && err.proseStatus !== 404) {
        onShownError(err.message)
        return
      }
      // Network down or server failure — keep the reply in the page,
      // tagged "not sent". No auto-retry: the annotated copy recovers it.
      addLocalReply(c, name, text, true)
      onDone()
    })
  }

  function renderReplyComposer(c) {
    var wrap = el('div', 'prose-reply-composer')
    // Typing in the composer must not re-trigger the card's activate-and-
    // scroll click behavior.
    wrap.addEventListener('click', function (ev) { ev.stopPropagation() })
    var textArea = el('textarea', null)
    textArea.placeholder = 'Reply'
    textArea.rows = 2
    textArea.maxLength = 5000
    wrap.appendChild(textArea)
    // First-time repliers haven't given a name yet — the route requires one.
    var nameInput = null
    if (!storedName()) {
      nameInput = el('input', null)
      nameInput.placeholder = 'Your name'
      nameInput.maxLength = 100
      wrap.appendChild(nameInput)
    }
    var errorEl = el('div', 'prose-form-error', '')
    errorEl.style.display = 'none'
    wrap.appendChild(errorEl)
    var actions = el('div', 'prose-reply-actions')
    var sendBtn = el('button', null, 'Reply')
    sendBtn.type = 'button'
    var cancelBtn = el('button', 'prose-reply-cancel', 'Cancel')
    cancelBtn.type = 'button'
    cancelBtn.addEventListener('click', function () {
      replyFor = null
      renderRail()
    })
    var showError = function (message) {
      errorEl.textContent = message
      errorEl.style.display = 'block'
    }
    var submitReply = function () {
      var text = textArea.value.trim()
      var name = (nameInput ? nameInput.value.trim() : storedName())
      if (!text || !name) {
        showError('Name and comment are required.')
        return
      }
      sendBtn.disabled = true
      sendReply(c, name, text, function () {
        replyFor = null
        renderRail()
      }, function (message) {
        sendBtn.disabled = false
        showError(message)
      })
    }
    sendBtn.addEventListener('click', submitReply)
    textArea.addEventListener('keydown', function (ev) {
      if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') {
        ev.preventDefault()
        submitReply()
      }
    })
    actions.appendChild(sendBtn)
    actions.appendChild(cancelBtn)
    actions.appendChild(el('span', 'prose-reply-as', 'as ' + (storedName() || 'you')))
    wrap.appendChild(actions)
    return wrap
  }
  function mineTag(id, authorName) {
    if (mineIds[id]) return ' · you'
    var name = storedName()
    return name && authorName === name ? ' · you' : ''
  }

  // Card header row: name (+ muted tag) left, date right — or a "not sent"
  // tag replacing the date when the row never reached the server.
  // textContent only.
  function headerRow(name, tagText, ts, notSent) {
    var row = el('div', 'prose-card-head')
    var nameEl = el('span', 'prose-card-name', name)
    if (tagText) nameEl.appendChild(el('span', 'prose-author-tag', tagText))
    row.appendChild(nameEl)
    row.appendChild(notSent
      ? el('span', 'prose-card-date prose-not-sent', 'not sent')
      : el('span', 'prose-card-date', formatDate(ts)))
    return row
  }

  // One reply row, shared by the rail cards and the narrow sheet.
  function renderReplyRow(r) {
    // Author replies: live-pushed rows carry fromAuthor; baked desktop
    // replies have no authorName. Tagged " · author" per the design.
    var isAuthor = r.fromAuthor === true || (!r.authorName && r.author !== 'ai')
    var replyEl = el('div', isAuthor ? 'prose-thread-reply prose-reply-author' : 'prose-thread-reply')
    var label = r.authorName || (r.author === 'ai' ? 'AI' : 'Author')
    var tag = isAuthor ? ' · author' : mineTag(r.id, r.authorName)
    replyEl.appendChild(headerRow(label, tag, r.createdAt, notSentIds[r.id] === true))
    replyEl.appendChild(el('div', 'prose-thread-body', r.text))
    return replyEl
  }

  var activeId = null

  function setActive(id, scrollArticle) {
    activeId = id
    // Focus mode follows activation: clicking a mark retargets the focused
    // thread (re-render first, so the class toggles hit the fresh DOM).
    if (railMode === 'focus' && !isNarrow) {
      var fio = focusOrder.indexOf(id)
      if (fio !== -1 && fio !== focusIdx) {
        focusIdx = fio
        renderRail()
      }
    }
    var spans = article.querySelectorAll('span[data-comment-id]')
    for (var i = 0; i < spans.length; i++) {
      spans[i].classList.toggle('prose-viewer-active', spans[i].getAttribute('data-comment-id') === id)
    }
    var threads = rail.querySelectorAll('.prose-thread')
    for (var j = 0; j < threads.length; j++) {
      var isMatch = threads[j].getAttribute('data-thread-id') === id
      threads[j].classList.toggle('prose-viewer-active', isMatch)
      if (isMatch) threads[j].scrollIntoView({ block: 'nearest' })
    }
    if (scrollArticle) {
      // CSS.escape unconditionally: the viewer already requires other modern
      // APIs, and an unescaped fallback would let a hostile id break the
      // selector.
      var span = article.querySelector('span[data-comment-id="' + CSS.escape(id) + '"]')
      if (span) span.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }

  function renderThread(c, lost) {
    var card = el('div', lost ? 'prose-thread prose-thread-lost' : 'prose-thread')
    card.setAttribute('data-thread-id', c.id)
    // Every card carries its serif quote (2-line clamp): the panel sits apart
    // from the marks, so the quote is what anchors a card to its passage.
    if (c.markedText) card.appendChild(el('span', 'prose-thread-quote', '“' + c.markedText + '”'))
    if (lost) card.appendChild(el('div', 'prose-lost-note', 'This passage is no longer in the document.'))
    card.appendChild(headerRow(authorLabel(c), mineTag(c.id, c.authorName), c.createdAt, notSentIds[c.id] === true))
    card.appendChild(el('div', 'prose-thread-body', c.comment))
    var replies = c.replies || []
    for (var i = 0; i < replies.length; i++) {
      card.appendChild(renderReplyRow(replies[i]))
    }
    if (!lost && !c.resolved && !revoked) {
      if (replyFor === c.id) {
        card.appendChild(renderReplyComposer(c))
      } else {
        var replyLink = el('button', 'prose-reply-link', 'Reply')
        replyLink.type = 'button'
        replyLink.addEventListener('click', function (ev) {
          ev.stopPropagation()
          replyFor = c.id
          renderRail()
          setActive(c.id, false)
          var ta = openList.querySelector('[data-thread-id="' + CSS.escape(c.id) + '"] textarea')
          if (ta) ta.focus()
        })
        card.appendChild(replyLink)
      }
    }
    if (c.id === nudgeThreadId) {
      var nudge = el('div', 'prose-nudge')
      nudge.appendChild(el('span', null, NUDGE_COPY))
      nudge.appendChild(el('span', 'prose-nudge-link-slot'))
      var dismiss = el('button', 'prose-nudge-dismiss', 'Dismiss')
      dismiss.type = 'button'
      dismiss.addEventListener('click', function (ev) {
        ev.stopPropagation()
        nudgeThreadId = null
        renderRail()
      })
      nudge.appendChild(dismiss)
      card.appendChild(nudge)
    }
    card.addEventListener('click', function () { setActive(c.id, true) })
    return card
  }

  var rail = el('aside', null)
  rail.id = 'prose-comment-rail'
  var railHead = el('div', 'prose-rail-head')
  var railHeadLeft = el('span', 'prose-rail-head-left')
  var railHeadCount = el('span', null, 'Comments · 0')
  // Cause-neutral: a row lands "not sent" when the network is down OR when
  // its thread's server row is gone (stale history) — "offline" would lie in
  // the second case.
  var offlineChip = el('span', 'prose-offline-chip')
  offlineChip.appendChild(el('span', 'prose-offline-dot'))
  offlineChip.appendChild(document.createTextNode('not sent'))
  // Empty at rest (the note below the head already invites selection);
  // flips to 'writing' while the composer is open.
  var railHint = el('span', null, '')

  // Panel mode prototype (Angel's QA ask): 'list' = every card stacked in
  // document order; 'focus' = one thread at a time with prev/next, the
  // desktop Comment Review analog. Toggle lives in the head; the preference
  // sticks per reader.
  // Focus is the default (Angel's call after comparing); an explicit 'list'
  // choice is remembered per reader.
  var railMode = 'focus'
  try { if (window.localStorage.getItem('prose-viewer-panel-mode') === 'list') railMode = 'list' } catch (e) { /* blocked storage */ }
  var focusIdx = 0
  var focusOrder = []

  function setRailMode(mode) {
    railMode = mode
    try { window.localStorage.setItem('prose-viewer-panel-mode', mode) } catch (e) { /* blocked storage */ }
    if (mode === 'focus' && activeId) {
      var ai = focusOrder.indexOf(activeId)
      if (ai !== -1) focusIdx = ai
    }
    modeListBtn.classList.toggle('prose-mode-on', mode === 'list')
    modeFocusBtn.classList.toggle('prose-mode-on', mode === 'focus')
    renderRail()
  }

  var modeWrap = el('span', 'prose-rail-mode')
  var modeListBtn = el('button', railMode === 'list' ? 'prose-mode-on' : null, 'list')
  modeListBtn.type = 'button'
  modeListBtn.addEventListener('click', function () { setRailMode('list') })
  var modeFocusBtn = el('button', railMode === 'focus' ? 'prose-mode-on' : null, 'focus')
  modeFocusBtn.type = 'button'
  modeFocusBtn.addEventListener('click', function () { setRailMode('focus') })
  modeWrap.appendChild(modeListBtn)
  modeWrap.appendChild(modeFocusBtn)

  var railRight = el('span', 'prose-rail-right')
  railRight.appendChild(railHint)
  railRight.appendChild(modeWrap)
  railHeadLeft.appendChild(railHeadCount)
  railHead.appendChild(railHeadLeft)
  railHead.appendChild(railRight)
  // Floating home for #prose-comment-form (wide mode): a popover-style card
  // absolutely positioned at the selection, scrolling with the text — the
  // desktop CommentPopover analog. Runtime DOM, stripped from copies.
  var floatWrap = el('div', null)
  floatWrap.id = 'prose-float-form'
  var openList = el('div', 'prose-open-section')
  var resolvedSection = el('div', 'prose-resolved-section')
  var lostSection = el('div', 'prose-lost-section')
  var offlineSection = el('div', 'prose-offline-section')
  var resolvedOpen = false

  function renderRail() {
    renderMarkIndices()
    openList.textContent = ''
    resolvedSection.textContent = ''
    lostSection.textContent = ''
    var open = []
    var lost = []
    var resolved = []
    for (var ci = 0; ci < comments.length; ci++) {
      var entry = comments[ci]
      if (entry.resolved) resolved.push(entry)
      else if (lostIds[entry.id]) lost.push(entry)
      else open.push(entry)
    }
    // Document order: cards list in the order their highlights appear in the
    // text (the panel is detached from the marks, so this is what keeps it
    // readable against the article). Unanchored threads sort last by age.
    var markTops = {}
    for (var oi = 0; oi < open.length; oi++) {
      var span = article.querySelector('span[data-comment-id="' + CSS.escape(open[oi].id) + '"]')
      markTops[open[oi].id] = span ? span.getBoundingClientRect().top : Infinity
    }
    open.sort(function (a, b) {
      var ta = markTops[a.id]
      var tb = markTops[b.id]
      if (ta !== tb) return ta < tb ? -1 : 1
      return (a.createdAt || 0) - (b.createdAt || 0)
    })

    railHeadCount.textContent = 'Comments · ' + open.length
    focusOrder = []
    for (var fi = 0; fi < open.length; fi++) focusOrder.push(open[fi].id)

    if (railMode === 'focus' && !isNarrow) {
      // One thread at a time: nav row + the focused card. Resolved and lost
      // sections stay a list-mode surface — the focus lane is open threads
      // only, like the desktop Comment Review.
      if (open.length === 0) {
        openList.appendChild(el('div', 'prose-focus-empty', 'No open comments.'))
      } else {
        if (focusIdx >= open.length) focusIdx = open.length - 1
        if (focusIdx < 0) focusIdx = 0
        var nav = el('div', 'prose-focus-nav')
        var prevBtn = el('button', null, '‹')
        prevBtn.type = 'button'
        prevBtn.addEventListener('click', function () {
          focusIdx = (focusIdx - 1 + focusOrder.length) % focusOrder.length
          renderRail()
          setActive(focusOrder[focusIdx], true)
        })
        var nextBtn = el('button', null, '›')
        nextBtn.type = 'button'
        nextBtn.addEventListener('click', function () {
          focusIdx = (focusIdx + 1) % focusOrder.length
          renderRail()
          setActive(focusOrder[focusIdx], true)
        })
        nav.appendChild(prevBtn)
        nav.appendChild(el('span', null, (focusIdx + 1) + ' of ' + open.length))
        nav.appendChild(nextBtn)
        openList.appendChild(nav)
        openList.appendChild(renderThread(open[focusIdx]))
      }
    } else {
      for (var i = 0; i < open.length; i++) openList.appendChild(renderThread(open[i]))
    }

    if (railMode !== 'focus' && lost.length > 0) {
      var lostHead = el('div', 'prose-lost-head')
      lostHead.appendChild(el('span', null, 'Lost their place · ' + lost.length))
      lostHead.appendChild(el('span', null, 'text changed since'))
      lostSection.appendChild(lostHead)
      for (var li = 0; li < lost.length; li++) lostSection.appendChild(renderThread(lost[li], true))
    }

    if (railMode !== 'focus' && resolved.length > 0) {
      var head = el('div', 'prose-resolved-head')
      var resolvedToggle = el('button', 'prose-resolved-toggle')
      resolvedToggle.type = 'button'
      resolvedToggle.appendChild(el('span', 'prose-resolved-chev', '›'))
      resolvedToggle.appendChild(document.createTextNode('Resolved · ' + resolved.length))
      resolvedToggle.addEventListener('click', function () {
        resolvedOpen = !resolvedOpen
        renderRail()
      })
      head.appendChild(resolvedToggle)
      head.appendChild(el('span', null, 'by the author'))
      resolvedSection.appendChild(head)
      resolvedSection.classList.toggle('prose-open', resolvedOpen)
      if (resolvedOpen) {
        for (var j = 0; j < resolved.length; j++) resolvedSection.appendChild(renderThread(resolved[j]))
      }
    }
    // Failed-POST recovery UI: "offline" chip in the head + an explainer card
    // pointing at the annotated-copy download. Keyed on the not-sent set —
    // there is no auto-retry, so this stays until the page is closed.
    var notSentCount = 0
    for (var key in notSentIds) { if (notSentIds[key]) notSentCount++ }
    if (notSentCount > 0 && !offlineChip.parentNode) railHeadLeft.appendChild(offlineChip)
    if (notSentCount === 0 && offlineChip.parentNode) offlineChip.parentNode.removeChild(offlineChip)
    offlineSection.textContent = ''
    if (notSentCount > 0) {
      var offlineCard = el('div', 'prose-offline-card')
      offlineCard.appendChild(el('div', null,
        notSentCount + ' comment' + (notSentCount === 1 ? '' : 's') + " couldn't reach the server — saved in this page instead."))
      var offlineDl = el('button', null, 'Download annotated copy')
      offlineDl.type = 'button'
      offlineDl.addEventListener('click', function () { downloadBtn.click() })
      offlineCard.appendChild(offlineDl)
      offlineCard.appendChild(el('div', 'prose-offline-note', 'Send the file back. Prose imports the comments when the author opens it.'))
      offlineSection.appendChild(offlineCard)
    }

    if (railCount) railCount.textContent = isNarrow ? String(open.length) : open.length + ' comments'
    bottomBtn.textContent = 'Comments ' + open.length
    if (isFile) {
      // The reader already HAS this file — offer a save only when the page
      // holds additions the on-disk copy lacks.
      downloadBtn.style.display = unsavedAdditions > 0 ? '' : 'none'
      downloadBtn.textContent = unsavedAdditions > 0
        ? 'Save updated copy (' + unsavedAdditions + ' new)'
        : 'Download annotated copy'
    } else {
      downloadBtn.style.display = ''
      downloadBtn.textContent = unsavedAdditions > 0
        ? 'Download annotated copy (' + unsavedAdditions + ' new)'
        : 'Download annotated copy'
    }
    downloadBtn.classList.toggle('prose-has-additions', unsavedAdditions > 0)
    renderLocalSync()
    if (sheetOpenId) renderSheetContent()
  }

  var note = el('div', 'prose-rail-note')
  note.textContent = online
    ? 'Select text to leave a comment.'
    : canPublish
      ? 'Select text to leave a comment. Publish to send your comments to the shared page.'
      : 'Select text to leave a comment. Comments live in this file — download the annotated copy to keep or return them.'

  // Panel structure: head + note stay fixed at the top; everything below
  // scrolls inside .prose-rail-body. Cards are normal flow — no stacking
  // engine, no absolute tops. The panel itself is position: fixed, so page
  // scroll can never drive its content into the chrome.
  var railBody = el('div', 'prose-rail-body')
  rail.appendChild(railHead)
  rail.appendChild(note)
  rail.appendChild(railBody)
  railBody.appendChild(openList)
  railBody.appendChild(resolvedSection)
  railBody.appendChild(lostSection)
  railBody.appendChild(offlineSection)

  // --- Narrow mode (< 1000px): bottom bar, sup indices, thread sheet --------
  // The rail never renders narrow. Marks get superscript numbers and open a
  // full-screen sheet; the bottom bar mirrors the count and opens the first
  // thread. All of it is runtime DOM, stripped from annotated copies.
  var isNarrow = null
  var railPreferredOpen = true

  var bottomBar = el('div', null)
  bottomBar.id = 'prose-bottom-bar'
  bottomBar.appendChild(el('span', null, 'Select text to comment'))
  var bottomBtn = el('button', null, 'Comments 0')
  bottomBtn.type = 'button'
  bottomBtn.addEventListener('click', function () { openFirstThreadSheet() })
  bottomBar.appendChild(bottomBtn)

  // Fixed-bottom home for #prose-comment-form when there is no rail.
  var narrowFormWrap = el('div', null)
  narrowFormWrap.id = 'prose-narrow-form-wrap'

  // Thread ids in document order of their first mark — the sup numbering and
  // the sheet's "K of N".
  var narrowOrder = []

  function renderMarkIndices() {
    var olds = article.querySelectorAll('sup.prose-mark-index')
    for (var i = 0; i < olds.length; i++) olds[i].parentNode.removeChild(olds[i])
    narrowOrder = []
    if (!isNarrow) return
    // The sup carries NO text child — the number renders via CSS
    // attr(data-n) — so article.textContent (the anchor input on both the
    // viewer and desktop sides) is byte-identical with indices present.
    var spans = article.querySelectorAll('span.comment-mark[data-comment-id]')
    var lastSpan = {}
    for (var j = 0; j < spans.length; j++) {
      var id = spans[j].getAttribute('data-comment-id')
      if (!lastSpan[id]) narrowOrder.push(id)
      lastSpan[id] = spans[j]
    }
    for (var k = 0; k < narrowOrder.length; k++) {
      var sup = document.createElement('sup')
      sup.className = 'prose-mark-index'
      sup.setAttribute('data-n', String(k + 1))
      sup.setAttribute('data-comment-id', narrowOrder[k])
      var anchorSpan = lastSpan[narrowOrder[k]]
      anchorSpan.parentNode.insertBefore(sup, anchorSpan.nextSibling)
    }
  }

  // --- Full-screen thread sheet ---------------------------------------------
  var sheetOpenId = null
  var sheet = el('div', null)
  sheet.id = 'prose-sheet'
  var sheetHead = el('div', 'prose-sheet-head')
  var sheetBack = el('button', 'prose-sheet-back', '‹ Back to text')
  sheetBack.type = 'button'
  sheetBack.addEventListener('click', function () { closeSheet() })
  // Prev / K of N / next — cycling wraps, matching the app's review panels.
  var sheetNav = el('span', 'prose-sheet-nav')
  var sheetPrev = el('button', 'prose-sheet-step', '‹')
  sheetPrev.type = 'button'
  sheetPrev.setAttribute('aria-label', 'Previous comment')
  sheetPrev.addEventListener('click', function () { stepSheet(-1) })
  var sheetCount = el('span', 'prose-sheet-count', '')
  var sheetNext = el('button', 'prose-sheet-step', '›')
  sheetNext.type = 'button'
  sheetNext.setAttribute('aria-label', 'Next comment')
  sheetNext.addEventListener('click', function () { stepSheet(1) })
  sheetNav.appendChild(sheetPrev)
  sheetNav.appendChild(sheetCount)
  sheetNav.appendChild(sheetNext)
  sheetHead.appendChild(sheetBack)
  sheetHead.appendChild(sheetNav)

  function stepSheet(delta) {
    if (narrowOrder.length < 1) return
    var idx = -1
    for (var i = 0; i < narrowOrder.length; i++) {
      if (narrowOrder[i] === sheetOpenId) idx = i
    }
    var next = idx === -1 ? 0 : (idx + delta + narrowOrder.length) % narrowOrder.length
    openSheet(narrowOrder[next])
  }
  var sheetScroll = el('div', 'prose-sheet-scroll')
  var sheetComposer = el('div', 'prose-sheet-composer')
  sheet.appendChild(sheetHead)
  sheet.appendChild(sheetScroll)
  sheet.appendChild(sheetComposer)

  function threadById(id) {
    for (var i = 0; i < comments.length; i++) {
      if (comments[i].id === id) return comments[i]
    }
    return null
  }

  function renderSheetContent() {
    var c = sheetOpenId ? threadById(sheetOpenId) : null
    if (!c) { closeSheet(); return }
    var pos = -1
    for (var i = 0; i < narrowOrder.length; i++) {
      if (narrowOrder[i] === c.id) pos = i
    }
    sheetCount.textContent = pos >= 0 ? (pos + 1) + ' of ' + narrowOrder.length : ''
    var canCycle = narrowOrder.length > 1
    sheetPrev.style.display = canCycle ? '' : 'none'
    sheetNext.style.display = canCycle ? '' : 'none'
    sheetScroll.scrollTop = 0
    sheetScroll.textContent = ''
    if (c.markedText) sheetScroll.appendChild(el('span', 'prose-sheet-quote', '"' + c.markedText + '"'))
    var thread = el('div', 'prose-sheet-thread')
    thread.appendChild(headerRow(authorLabel(c), mineTag(c.id, c.authorName), c.createdAt, notSentIds[c.id] === true))
    thread.appendChild(el('div', 'prose-thread-body', c.comment))
    var replies = c.replies || []
    for (var ri = 0; ri < replies.length; ri++) thread.appendChild(renderReplyRow(replies[ri]))
    sheetScroll.appendChild(thread)
    renderSheetComposer(c)
  }

  function renderSheetComposer(c) {
    sheetComposer.textContent = ''
    if (c.resolved || revoked) return
    var name = storedName()
    if (name) sheetComposer.appendChild(el('div', 'prose-sheet-as', 'Replying as ' + name))
    var textArea = el('textarea', null)
    textArea.placeholder = 'Reply'
    textArea.rows = 2
    textArea.maxLength = 5000
    sheetComposer.appendChild(textArea)
    var nameInput = null
    if (!name) {
      nameInput = el('input', null)
      nameInput.placeholder = 'Your name'
      nameInput.maxLength = 100
      sheetComposer.appendChild(nameInput)
    }
    var errorEl = el('div', 'prose-form-error', '')
    errorEl.style.display = 'none'
    sheetComposer.appendChild(errorEl)
    var sendBtn = el('button', 'prose-sheet-send', 'Reply')
    sendBtn.type = 'button'
    var submitSheetReply = function () {
      var text = textArea.value.trim()
      var who = (nameInput ? nameInput.value.trim() : storedName())
      if (!text || !who) {
        errorEl.textContent = 'Name and comment are required.'
        errorEl.style.display = 'block'
        return
      }
      sendBtn.disabled = true
      sendReply(c, who, text, function () {
        renderSheetContent()
      }, function (message) {
        sendBtn.disabled = false
        errorEl.textContent = message
        errorEl.style.display = 'block'
      })
    }
    sendBtn.addEventListener('click', submitSheetReply)
    textArea.addEventListener('keydown', function (ev) {
      if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') {
        ev.preventDefault()
        submitSheetReply()
      }
    })
    sheetComposer.appendChild(sendBtn)
  }

  function openSheet(id) {
    sheetOpenId = id
    renderSheetContent()
    if (sheetOpenId && !document.body.contains(sheet)) document.body.appendChild(sheet)
  }

  function closeSheet() {
    sheetOpenId = null
    if (sheet.parentNode) sheet.parentNode.removeChild(sheet)
  }

  function openFirstThreadSheet() {
    if (narrowOrder.length > 0) { openSheet(narrowOrder[0]); return }
    for (var i = 0; i < comments.length; i++) {
      var c = comments[i]
      if (!c.resolved && !lostIds[c.id]) { openSheet(c.id); return }
    }
  }

  // Applies the UI for the current width; keeps an open compose form alive
  // across the boundary by rehoming it.
  function syncNarrowMode() {
    var narrow = window.innerWidth < 1000
    if (narrow === isNarrow) return
    isNarrow = narrow
    var form = document.getElementById('prose-comment-form')
    if (narrow) {
      rail.remove()
      floatWrap.remove()
      document.body.classList.remove('prose-rail-open')
      document.body.classList.add('prose-narrow')
      document.body.appendChild(bottomBar)
      if (form) {
        narrowFormWrap.appendChild(form)
        document.body.appendChild(narrowFormWrap)
      }
    } else {
      closeSheet()
      bottomBar.remove()
      narrowFormWrap.remove()
      document.body.classList.remove('prose-narrow')
      if (form) {
        // The float wrapper keeps its last placement — good enough across a
        // width change; the draft is what matters. A form born narrow has no
        // placement yet and gets a sane default under the chrome.
        floatWrap.appendChild(form)
        if (floatWrap.style.top) document.body.appendChild(floatWrap)
        else placeFloatForm({ top: 120, bottom: 120, left: 24 })
      }
      if (railPreferredOpen) {
        document.body.appendChild(rail)
        document.body.classList.add('prose-rail-open')
      }
    }
    renderRail()
  }

  // --- Download a (possibly annotated) self-contained copy ------------------
  // The entry point is the baked footer link (#prose-download-copy).

  function encodeBase64Utf8(s) { return btoa(unescape(encodeURIComponent(s))) }

  function suggestedFilename() {
    if (isFile) {
      try {
        var base = decodeURIComponent(window.location.pathname.split('/').pop() || '')
        if (base) return base.replace(/\\.html?$/i, '') + '-annotated.html'
      } catch (e) { /* fall through */ }
    }
    var title = (document.title || 'document').replace(/[^a-z0-9 _-]/gi, '').trim() || 'document'
    return title + (unsavedAdditions > 0 ? '-annotated' : '-copy') + '.html'
  }

  function buildAnnotatedCopy() {
    var clone = document.documentElement.cloneNode(true)
    // The theme class is this viewer's preference, not the document's — the
    // reopened copy re-derives it from its reader's storage/OS scheme.
    clone.classList.remove('dark')
    // Strip the viewer's runtime DOM — the reopened copy rebuilds it fresh.
    // Baked chrome (top bar, footer) intentionally survives the copy.
    var strip = [
      '#prose-comment-rail',
      '#prose-add-comment-btn',
      '#prose-float-form',
      '#prose-file-banner',
      '#prose-publish-comments',
      '#prose-bottom-bar',
      '#prose-sheet',
      '#prose-narrow-form-wrap',
      '.prose-mark-index'
    ]
    for (var i = 0; i < strip.length; i++) {
      var nodes = clone.querySelectorAll(strip[i])
      for (var ni = 0; ni < nodes.length; ni++) nodes[ni].remove()
    }
    var actives = clone.querySelectorAll('.prose-viewer-active')
    for (var j = 0; j < actives.length; j++) actives[j].classList.remove('prose-viewer-active')
    var body = clone.querySelector('body')
    if (body) {
      body.classList.remove('prose-rail-open')
      body.classList.remove('prose-narrow')
    }
    // Reset chrome state that belongs to THIS session, not the copy.
    var dl = clone.querySelector('#prose-download-copy')
    if (dl) {
      dl.textContent = 'Download annotated copy'
      dl.classList.remove('prose-has-additions')
    }
    // A copy downloaded from the SERVED page carries the full capability URL
    // so it can publish comments back from file:// — the person downloading
    // already holds that URL. The served artifact itself never embeds the
    // token; offline re-downloads keep whatever the file already carried.
    if (online) {
      var shareBlock = clone.querySelector('script[type="application/x-prose-share"]')
      if (shareBlock) {
        shareBlock.textContent = JSON.stringify({
          shareEndpoint: shareConfig.shareEndpoint,
          publishRev: shareConfig.publishRev,
          publishedAt: shareConfig.publishedAt,
          shareUrl: shareApiBase
        }).replace(/</g, '\\\\u003c')
      }
    }
    // Re-embed the full comment set (original + local additions).
    var script = clone.querySelector('script[type="application/x-prose-comments"]')
    if (script) {
      script.textContent = encodeBase64Utf8(JSON.stringify({
        version: 1,
        publishRev: blockMeta.publishRev,
        publishedAt: blockMeta.publishedAt,
        comments: comments
      }))
    }
    return '<!DOCTYPE html>\\n' + clone.outerHTML
  }

  downloadBtn.addEventListener('click', function (ev) {
    ev.preventDefault()
    var blob = new Blob([buildAnnotatedCopy()], { type: 'text/html' })
    var url = URL.createObjectURL(blob)
    var a = document.createElement('a')
    a.href = url
    a.download = suggestedFilename()
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(function () { URL.revokeObjectURL(url) }, 5000)
    unsavedAdditions = 0
    renderRail()
  })

  // Losing the tab loses un-downloaded offline comments — warn.
  window.addEventListener('beforeunload', function (ev) {
    if (unsavedAdditions > 0) {
      ev.preventDefault()
      ev.returnValue = ''
    }
  })

  toggle.addEventListener('click', function () {
    // Narrow has no rail to toggle — the count button opens the sheet.
    if (isNarrow) {
      openFirstThreadSheet()
      return
    }
    var isOpen = document.body.contains(rail)
    railPreferredOpen = !isOpen
    if (isOpen) {
      rail.remove()
      document.body.classList.remove('prose-rail-open')
    } else {
      document.body.appendChild(rail)
      document.body.classList.add('prose-rail-open')
    }
  })

  if (themeToggle) {
    themeToggle.addEventListener('click', function () {
      var dark = !document.documentElement.classList.contains('dark')
      document.documentElement.classList.toggle('dark', dark)
      try { window.localStorage.setItem('prose-viewer-theme', dark ? 'dark' : 'light') } catch (e) { /* blocked storage */ }
    })
  }

  // file:// posture: the local-copy readout lives INSIDE the top bar — one
  // compact chrome bar. "Local copy · Draft · N unpublished" centered; the
  // Publish action joins the right tools cluster, left of the comment count.
  // Runtime-inserted (never baked), so annotated copies re-derive it from
  // their own protocol on open.
  var localStateEl = null
  var localPublishBtn = null
  if (isFile) {
    var fileBanner = el('span', null)
    fileBanner.id = 'prose-file-banner'
    fileBanner.appendChild(el('span', 'prose-local-label', 'Local copy'))
    localStateEl = el('span', 'prose-local-state', '')
    fileBanner.appendChild(localStateEl)
    var topbarEl = document.querySelector('.prose-topbar')
    var toolsEl = document.querySelector('.prose-topbar-tools')
    if (topbarEl && toolsEl) topbarEl.insertBefore(fileBanner, toolsEl)
    else if (topbarEl) topbarEl.appendChild(fileBanner)
    else document.body.insertBefore(fileBanner, document.body.firstChild)
    if (canPublish) {
      localPublishBtn = el('button', null, 'Publish comments')
      localPublishBtn.id = 'prose-publish-comments'
      localPublishBtn.type = 'button'
      localPublishBtn.addEventListener('click', publishLocalAdditions)
      if (toolsEl) toolsEl.insertBefore(localPublishBtn, toolsEl.firstChild)
      else fileBanner.appendChild(localPublishBtn)
    }
  }

  // Draft / published state in the local bar. Rendered from renderRail so
  // counts track every mutation.
  function renderLocalSync() {
    if (!localStateEl) return
    var n = unpublishedCount()
    var err = publishStateKind === 'err'
    var text = ''
    if (publishing) text = 'Publishing…'
    else if (err) text = publishState
    else if (n > 0) text = 'Draft · ' + n + ' unpublished'
    else if (publishStateKind === 'ok') text = 'All comments published'
    localStateEl.textContent = text
    localStateEl.classList.toggle('prose-local-err', err && !publishing)
    if (localPublishBtn) {
      localPublishBtn.style.display = canPublish && n > 0 ? '' : 'none'
      localPublishBtn.disabled = publishing
    }
  }

  anchorAllThreads()
  // Applies the width-appropriate UI (rail vs bottom bar) and renders.
  syncNarrowMode()

  // A resize can cross the narrow boundary; card layout needs no restack —
  // the panel is normal flow inside a fixed container.
  window.addEventListener('resize', syncNarrowMode)

  // --- Live conversation loop (#769) ---------------------------------------
  // The page polls the publication's comment list so the conversation is
  // live in both sync modes: refresh-safe reviewer comments, author replies
  // and resolves without a re-publish. Same-origin GET (CSP connect-src
  // 'self'); merge is ADDITIVE — never deletes local entries, so offline and
  // just-posted additions survive; the poll is authoritative only for the
  // resolution state of rows it returns. Dedupe is by id: posted comments
  // land with server ids, and baked author replies are embedded under their
  // server row id at publish time.
  //
  // Publish-capable local copies (file:// with a baked share URL) join the
  // loop too: reading the conversation is strictly less privileged than the
  // publish POST the copy can already make, and without it a reload showed
  // only the baked snapshot — comments published from this file in an earlier
  // session "disappeared" and author replies never arrived. Pull failures are
  // swallowed: the copy must keep opening anywhere, network or not.
  var pollTimer = null
  var pollStopped = false
  // Flipped when the gateway answers 410: the author took the link down.
  // The page stays readable but every commenting entry point closes.
  var revoked = false

  function rowToReply(row) {
    return {
      id: row.id,
      text: row.commentText,
      authorName: row.authorName,
      createdAt: Date.parse(row.createdAt) || Date.now(),
      fromAuthor: row.fromAuthor === true
    }
  }

  function mergeLive(rows) {
    var changed = false
    var byId = {}
    for (var mi = 0; mi < comments.length; mi++) byId[comments[mi].id] = comments[mi]
    for (var ti = 0; ti < rows.length; ti++) {
      var row = rows[ti]
      if (row.parentId) continue
      var existing = byId[row.id]
      var resolved = !!row.resolvedAt
      if (!existing) {
        var thread = {
          id: row.id,
          markedText: row.markedText,
          occurrenceIndex: row.occurrenceIndex,
          comment: row.commentText,
          authorName: row.authorName,
          createdAt: Date.parse(row.createdAt) || Date.now(),
          resolved: resolved,
          replies: []
        }
        comments.push(thread)
        byId[row.id] = thread
        changed = true
      } else if (!!existing.resolved !== resolved) {
        // Boolean-normalized: baked open threads omit the field, and
        // undefined !== false must not count as a change every poll.
        existing.resolved = resolved
        changed = true
      }
    }
    for (var ri = 0; ri < rows.length; ri++) {
      var reply = rows[ri]
      if (!reply.parentId) continue
      var parent = byId[reply.parentId]
      if (!parent) continue
      parent.replies = parent.replies || []
      var seen = false
      for (var si = 0; si < parent.replies.length; si++) {
        if (parent.replies[si].id === reply.id) { seen = true; break }
      }
      if (!seen) {
        parent.replies.push(rowToReply(reply))
        changed = true
      }
    }
    if (changed) {
      anchorAllThreads()
      renderRail()
      if (activeId) setActive(activeId, false)
    }
  }

  // One GET+merge exchange, shared by the online poll and the local publish
  // flow's pull half.
  function pullComments() {
    if (!shareApiBase) return Promise.resolve()
    return window.fetch(shareApiBase + '/comments').then(function (resp) {
      if (resp.status === 410) {
        pollStopped = true
        if (pollTimer) window.clearInterval(pollTimer)
        if (online) {
          revoked = true
          note.textContent = 'This link was taken down by its author.'
          // Close NEW entry points only — an open compose form keeps its
          // draft (its submit surfaces the revoked error without clearing).
          addBtn.remove()
        } else {
          // A local copy stays annotatable — only the publish path closes.
          canPublish = false
          publishStateKind = 'err'
          publishState = 'This link was taken down by its author. Comments stay in this file.'
        }
        renderRail()
        return null
      }
      if (!resp.ok) return null
      return resp.json()
    }).then(function (body) {
      if (body && body.comments) mergeLive(body.comments)
    })
  }

  function fetchLiveComments() {
    // canPublish re-checks at call time — a 410 mid-session flips it off.
    if ((!online && !canPublish) || pollStopped) return
    pullComments().catch(function () { /* transient network failure — the next poll retries */ })
  }

  if (online || canPublish) {
    fetchLiveComments()
    pollTimer = window.setInterval(fetchLiveComments, 45000)
    window.addEventListener('focus', fetchLiveComments)
  }

  // --- Local publish (file:// copies with a baked share URL) ----------------
  // Local additions are a DRAFT: they never auto-post. "Publish comments"
  // pushes every local-id thread/reply up in one sequential exchange (order
  // keeps reply parents resolving to server ids; the write limiter allows
  // ~10/min), then pulls the latest conversation. Anything with a 'local-'
  // id — including additions baked into the file by an earlier session — is
  // unpublished by definition.
  var publishing = false
  var publishState = ''
  var publishStateKind = ''

  function isLocalId(id) { return typeof id === 'string' && id.indexOf('local-') === 0 }

  function unpublishedCount() {
    // Not-sent rows are excluded: they are UNPUBLISHABLE (their thread's
    // server row is gone) — the annotated copy is their recovery vehicle,
    // and counting them would pin "Draft · N" forever.
    var n = 0
    for (var i = 0; i < comments.length; i++) {
      if (isLocalId(comments[i].id) && !notSentIds[comments[i].id]) n++
      var reps = comments[i].replies || []
      for (var j = 0; j < reps.length; j++) {
        if (isLocalId(reps[j].id) && !notSentIds[reps[j].id]) n++
      }
    }
    return n
  }

  // A published row keeps its viewer-side identity under the new server id.
  function remapId(oldId, newId) {
    var spans = article.querySelectorAll('span[data-comment-id="' + CSS.escape(oldId) + '"]')
    for (var i = 0; i < spans.length; i++) spans[i].setAttribute('data-comment-id', newId)
    if (mineIds[oldId]) { delete mineIds[oldId]; mineIds[newId] = true }
    if (lostIds[oldId]) { delete lostIds[oldId]; lostIds[newId] = true }
    delete notSentIds[oldId]
    if (activeId === oldId) activeId = newId
    if (sheetOpenId === oldId) sheetOpenId = newId
  }

  function publishLocalAdditions() {
    if (publishing || !canPublish) return
    publishing = true
    publishStateKind = ''
    renderLocalSync()
    var chain = Promise.resolve()
    for (var ci = 0; ci < comments.length; ci++) {
      (function (c) {
        if (isLocalId(c.id)) {
          chain = chain.then(function () {
            // Attach the remembered email ONLY to drafts this reader wrote in
            // THIS page (mineIds) — a draft baked by an earlier session may be
            // someone else's, and must not get this reader's notifications.
            return postComment(
              { markedText: c.markedText || '', occurrenceIndex: c.occurrenceIndex || 0 },
              c.authorName || 'Reader',
              mineIds[c.id] ? storedEmail() : '',
              c.comment
            ).then(function (created) {
              var old = c.id
              c.id = created.id
              remapId(old, created.id)
            })
          })
        }
        var reps = c.replies || []
        for (var ri = 0; ri < reps.length; ri++) {
          (function (r) {
            if (!isLocalId(r.id) || notSentIds[r.id]) return
            chain = chain.then(function () {
              // c.id reads at execution time — a just-published parent
              // thread has its server id by now.
              return postReplyRequest(c.id, r.authorName || 'Reader', r.text).then(function (created) {
                var old = r.id
                r.id = created.id
                remapId(old, created.id)
              }).catch(function (err) {
                // The parent's row is gone (stale pre-revoke history): this
                // reply can never publish. Tag it not-sent and keep going —
                // the rest of the drafts still deserve their push.
                if (err && err.proseStatus === 404) {
                  notSentIds[r.id] = true
                  return
                }
                throw err
              })
            })
          })(reps[ri])
        }
      })(comments[ci])
    }
    chain.then(function () {
      // The pull half of the exchange: catch up on the live conversation.
      return pullComments()
    }).then(function () {
      publishing = false
      if (unpublishedCount() === 0) {
        publishStateKind = 'ok'
        // Everything this page held is on the shared page now — nothing left
        // to lose with the tab, nothing left worth saving into a copy.
        unsavedAdditions = 0
      }
      renderRail()
    }).catch(function (err) {
      // Partial progress stands: already-published rows keep their server
      // ids; the remainder stays draft.
      publishing = false
      publishStateKind = 'err'
      publishState = err && err.proseShow && err.message
        ? err.message
        : 'Could not reach the shared page. Comments are safe in this file.'
      renderRail()
    })
  }

  // --- Highlight interactions ----------------------------------------------
  article.addEventListener('click', function (ev) {
    var target = ev.target
    while (target && target !== article) {
      if (target.getAttribute && target.getAttribute('data-comment-id')) {
        var id = target.getAttribute('data-comment-id')
        // Narrow: a mark (or its sup index) opens the thread sheet.
        if (isNarrow) {
          openSheet(id)
          return
        }
        if (!document.body.contains(rail)) toggle.click()
        setActive(id, false)
        return
      }
      target = target.parentNode
    }
  })

  // --- Add-comment flow (both modes) ---------------------------------------
  // Static UI glyph (not user content) — built via createElementNS, never
  // innerHTML, keeping the textContent-only rendering rule intact.
  function svgIcon(pathD) {
    var NS = 'http://www.w3.org/2000/svg'
    var svg = document.createElementNS(NS, 'svg')
    svg.setAttribute('width', '13')
    svg.setAttribute('height', '13')
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('fill', 'none')
    svg.setAttribute('stroke', 'currentColor')
    svg.setAttribute('stroke-width', '1.75')
    svg.setAttribute('stroke-linecap', 'round')
    svg.setAttribute('stroke-linejoin', 'round')
    svg.setAttribute('aria-hidden', 'true')
    var path = document.createElementNS(NS, 'path')
    path.setAttribute('d', pathD)
    svg.appendChild(path)
    return svg
  }

  var addBtn = el('button', null)
  addBtn.id = 'prose-add-comment-btn'
  addBtn.type = 'button'
  addBtn.appendChild(svgIcon('M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'))
  addBtn.appendChild(document.createTextNode('Comment'))
  var pendingAnchor = null
  var pendingRect = null

  document.addEventListener('mouseup', function () {
    window.setTimeout(function () {
      if (revoked) { addBtn.remove(); return }
      var sel = window.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) { addBtn.remove(); return }
      var anchor = computeAnchor(sel)
      if (!anchor) { addBtn.remove(); return }
      pendingAnchor = anchor
      var rect = sel.getRangeAt(0).getBoundingClientRect()
      pendingRect = { top: rect.top, bottom: rect.bottom, left: rect.left }
      addBtn.style.top = (window.scrollY + rect.bottom + 6) + 'px'
      addBtn.style.left = (window.scrollX + Math.max(8, rect.left)) + 'px'
      document.body.appendChild(addBtn)
    }, 0)
  })

  addBtn.addEventListener('mousedown', function (ev) { ev.preventDefault() })
  addBtn.addEventListener('click', function () {
    addBtn.remove()
    if (pendingAnchor) showForm(pendingAnchor)
  })

  function clearForm() {
    floatWrap.textContent = ''
    floatWrap.remove()
    narrowFormWrap.textContent = ''
    narrowFormWrap.remove()
    railHint.textContent = ''
  }

  // Place the float wrapper at the selection: below it, left-aligned and
  // clamped to the viewport; flipped above when the viewport bottom would
  // clip it. Absolute (document coords), so it scrolls with the text.
  function placeFloatForm(rect) {
    var width = Math.min(384, window.innerWidth - 32)
    var left = Math.max(16, Math.min(rect.left, window.innerWidth - width - 16))
    floatWrap.style.left = (window.scrollX + left) + 'px'
    floatWrap.style.top = (window.scrollY + rect.bottom + 8) + 'px'
    document.body.appendChild(floatWrap)
    var h = floatWrap.offsetHeight
    if (rect.bottom + 8 + h > window.innerHeight - 16 && rect.top - 8 - h > 0) {
      floatWrap.style.top = (window.scrollY + rect.top - 8 - h) + 'px'
    }
  }

  function showForm(anchor) {
    floatWrap.textContent = ''
    railHint.textContent = 'writing'
    var form = el('div', null)
    form.id = 'prose-comment-form'
    var anchorBlock = el('div', 'prose-form-anchor')
    anchorBlock.appendChild(el('div', 'prose-form-eyebrow', 'Commenting on'))
    anchorBlock.appendChild(el('span', 'prose-thread-quote', '“' + anchor.markedText + '”'))
    form.appendChild(anchorBlock)
    var errorEl = el('div', 'prose-form-error', '')
    errorEl.style.display = 'none'
    var textArea = el('textarea', null)
    textArea.placeholder = 'Your comment'
    textArea.rows = 3
    textArea.maxLength = 5000
    var fields = el('div', 'prose-form-fields')
    var nameInput = el('input', null)
    nameInput.placeholder = 'Your name'
    nameInput.maxLength = 100
    nameInput.value = storedName()
    fields.appendChild(nameInput)
    // Email is offered wherever the comment can reach the server — served
    // pages and publish-capable local copies alike. A pure-offline copy has
    // no field: nothing ever posts, so there is nothing to notify about.
    var emailInput = null
    if (online || canPublish) {
      emailInput = el('input', null)
      emailInput.placeholder = 'email, optional'
      emailInput.type = 'email'
      emailInput.maxLength = 254
      emailInput.value = storedEmail()
      fields.appendChild(emailInput)
    }
    var postBtn = el('button', null, online ? 'Post' : 'Add')
    postBtn.type = 'button'
    var cancelBtn = el('button', 'prose-secondary', 'Cancel')
    cancelBtn.type = 'button'
    cancelBtn.addEventListener('click', function () { clearForm() })
    var submit = function () {
      var name = nameInput.value.trim()
      var text = textArea.value.trim()
      if (!name || !text) {
        errorEl.textContent = 'Name and comment are required.'
        errorEl.style.display = 'block'
        return
      }
      try { window.localStorage.setItem('prose-commenter-name', name) } catch (e) { /* blocked storage */ }
      // Remember the email (or its clearing) before any branch — a local
      // draft posts later, at Publish, from the stored value.
      if (emailInput) {
        try { window.localStorage.setItem('prose-commenter-email', emailInput.value.trim()) } catch (e) { /* blocked storage */ }
      }
      if (!online) {
        addLocalThread(anchor, name, text, false)
        return
      }
      postBtn.disabled = true
      postComment(anchor, name, emailInput ? emailInput.value.trim() : '', text).then(function (created) {
        var newThread = {
          id: created.id,
          markedText: anchor.markedText,
          occurrenceIndex: anchor.occurrenceIndex,
          comment: text,
          authorName: name,
          createdAt: created.createdAt ? new Date(created.createdAt).getTime() : Date.now(),
          resolved: false,
          replies: []
        }
        comments.push(newThread)
        mineIds[created.id] = true
        if (!anchorThread(newThread)) lostIds[created.id] = true
        if (!nudgeShown) {
          nudgeShown = true
          nudgeThreadId = created.id
        }
        clearForm()
        renderRail()
        // Pick up anything else that landed while the form was open (the
        // just-posted comment merges by its server id — no duplicate).
        window.setTimeout(fetchLiveComments, 2000)
      }).catch(function (err) {
        if (err && err.proseShow) {
          postBtn.disabled = false
          errorEl.textContent = err.message
          errorEl.style.display = 'block'
          return
        }
        // Network down or server failure — the comment stays in this page,
        // tagged "not sent". No auto-retry: the annotated copy carries it back.
        addLocalThread(anchor, name, text, true)
      })
    }
    postBtn.addEventListener('click', submit)
    textArea.addEventListener('keydown', function (ev) {
      if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') {
        ev.preventDefault()
        submit()
      }
    })
    form.appendChild(textArea)
    form.appendChild(fields)
    if (emailInput) form.appendChild(el('div', 'prose-form-helper', 'Email is only used to tell you about replies. It is never shown.'))
    form.appendChild(errorEl)
    var actions = el('div', 'prose-form-actions')
    actions.appendChild(postBtn)
    actions.appendChild(cancelBtn)
    actions.appendChild(el('span', 'prose-form-kbd', '⌘↵'))
    form.appendChild(actions)
    if (isNarrow) {
      // No floating card narrow — the form docks as a fixed bottom card.
      narrowFormWrap.textContent = ''
      narrowFormWrap.appendChild(form)
      document.body.appendChild(narrowFormWrap)
    } else {
      floatWrap.appendChild(form)
      placeFloatForm(pendingRect || { top: 120, bottom: 120, left: 24 })
      // Open the panel so the posted card has somewhere visible to land.
      if (!document.body.contains(rail)) toggle.click()
    }
    textArea.focus()
  }

  function postComment(anchor, name, email, text) {
    var payload = {
      markedText: anchor.markedText,
      occurrenceIndex: anchor.occurrenceIndex,
      commentText: text,
      authorName: name,
      publishRev: shareConfig.publishRev
    }
    if (email) payload.authorEmail = email
    return window.fetch(shareApiBase + '/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(handleShareResponse)
  }

  // Errors the composer should DISPLAY (draft kept in place). Anything
  // unmarked — a fetch rejection, a 5xx below — routes to the local
  // "not sent" fallback instead.
  function shownError(message) {
    var err = new Error(message)
    err.proseShow = true
    return err
  }

  function handleShareResponse(resp) {
    if (resp.status === 429) {
      // The gateway sends the honest wait — render "try again at H:MM"
      // instead of a vague minute.
      return resp.json().catch(function () { return {} }).then(function (body) {
        var secs = body && typeof body.retryAfter === 'number' && body.retryAfter > 0 ? body.retryAfter : 60
        var when = ''
        try {
          when = new Date(Date.now() + secs * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
        } catch (e) { /* no locale time */ }
        throw shownError('Too many comments in a minute. Your text is kept here. Try again' + (when ? ' at ' + when : ' shortly') + '.')
      })
    }
    if (resp.status === 410) {
      // Served pages close commenting entirely; a local copy stays
      // annotatable and only loses its publish path.
      if (online) revoked = true
      else canPublish = false
      throw shownError('This link was taken down by its author.')
    }
    if (!resp.ok) {
      // 4xx = the request was wrong — surface it. 5xx = the server failed —
      // the caller falls back to a local not-sent comment. The status rides
      // on the error so reply paths can special-case 404 (a reply to a
      // thread whose row is gone — stale pre-revoke history).
      var err = new Error('Failed to post comment (' + resp.status + ').')
      if (resp.status < 500) err.proseShow = true
      err.proseStatus = resp.status
      throw err
    }
    return resp.json()
  }

  function postReplyRequest(threadId, name, text) {
    var payload = { commentText: text, authorName: name, publishRev: shareConfig.publishRev }
    return window.fetch(
      shareApiBase + '/comments/' + encodeURIComponent(threadId) + '/replies',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }
    ).then(handleShareResponse)
  }
})()
`
