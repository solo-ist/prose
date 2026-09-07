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
    padding: 78px 24px 120px;
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
  @media (max-width: 640px) {
    article { font-size: 17px; line-height: 1.6; padding: 56px 20px 96px; }
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
    top: 0;
    right: 0;
    bottom: 0;
    width: 300px;
    box-sizing: border-box;
    overflow-y: auto;
    padding: 1rem;
    font-family: var(--font-mono);
    font-size: 12.5px;
    line-height: 1.5;
    background: var(--bg);
    border-left: 1px solid hsl(var(--border));
    color: hsl(var(--foreground));
    z-index: 10;
  }
  body.prose-rail-open { margin-right: 320px; }
  @media (max-width: 900px) {
    body.prose-rail-open { margin-right: auto; }
    #prose-comment-rail { width: min(320px, 90vw); box-shadow: -4px 0 24px rgba(0, 0, 0, 0.18); }
  }
  #prose-comment-rail h2 {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin: 0 0 0.75rem;
    color: hsl(var(--muted-foreground));
  }
  .prose-thread {
    border: 1px solid hsl(var(--border));
    border-radius: 8px;
    padding: 12px 14px;
    margin-bottom: 10px;
    background: hsl(var(--card));
    cursor: pointer;
  }
  .prose-thread.prose-viewer-active { border-color: hsl(var(--comment)); }
  .prose-thread-quote {
    display: block;
    font-family: var(--font-serif);
    font-style: italic;
    color: hsl(var(--muted-foreground));
    border-left: 2px solid hsl(var(--comment) / 0.5);
    padding-left: 0.5rem;
    margin-bottom: 0.375rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .prose-thread-meta { color: hsl(var(--muted-foreground)); font-size: 11px; margin-top: 0.25rem; }
  .prose-thread-reply { margin-top: 10px; padding-left: 10px; border-left: 1px solid hsl(var(--border)); }
  .prose-thread-reply.prose-reply-author { border-left-color: hsl(var(--comment) / 0.7); }
  .prose-author-tag {
    display: inline-block;
    margin-right: 0.3rem;
    padding: 0 0.3rem;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 600;
    background: hsl(var(--comment) / 0.18);
    color: inherit;
  }
  .prose-thread-body { white-space: pre-wrap; word-break: break-word; }
  .prose-resolved-section { margin-top: 1.25rem; }
  .prose-resolved-section .prose-thread { opacity: 0.65; }
  .prose-rail-note {
    margin-top: 1rem;
    padding-top: 0.75rem;
    border-top: 1px solid hsl(var(--border));
    color: hsl(var(--muted-foreground));
    font-size: 11px;
  }
  #prose-rail-download {
    display: block;
    width: 100%;
    box-sizing: border-box;
    margin-top: 0.75rem;
    border: 1px solid hsl(var(--input));
    border-radius: 6px;
    padding: 0.45rem 0.75rem;
    font: 600 12px var(--font-mono);
    background: hsl(var(--card));
    color: hsl(var(--foreground));
    cursor: pointer;
  }
  #prose-rail-download.prose-has-additions { background: hsl(var(--comment)); border-color: hsl(var(--comment)); color: rgba(0, 0, 0, 0.85); }
  #prose-rail-toggle {
    position: fixed;
    right: 1rem;
    bottom: 1rem;
    z-index: 11;
    border: 1px solid hsl(var(--input));
    border-radius: 999px;
    padding: 0.4rem 0.85rem;
    font: 600 12.5px var(--font-mono);
    background: hsl(var(--popover));
    color: hsl(var(--foreground));
    cursor: pointer;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
  }
  #prose-add-comment-btn {
    position: absolute;
    z-index: 12;
    border: 1px solid hsl(var(--border));
    border-radius: 6px;
    padding: 0.3rem 0.6rem;
    font: 12px var(--font-mono);
    background: hsl(var(--popover));
    color: hsl(var(--foreground));
    cursor: pointer;
    box-shadow: 0 4px 12px hsl(var(--foreground) / 0.15);
  }
  #prose-comment-form {
    border: 1px solid hsl(var(--comment) / 0.5);
    border-radius: 8px;
    padding: 12px 14px;
    margin-bottom: 0.75rem;
    background: hsl(var(--card));
  }
  #prose-comment-form input, #prose-comment-form textarea {
    display: block;
    width: 100%;
    box-sizing: border-box;
    margin-bottom: 0.5rem;
    padding: 0.375rem 0.5rem;
    border: 1px solid hsl(var(--input));
    border-radius: 6px;
    font: inherit;
    background: transparent;
    color: inherit;
  }
  #prose-comment-form button {
    border: none;
    border-radius: 6px;
    padding: 0.375rem 0.75rem;
    font: 500 12px var(--font-mono);
    background: hsl(var(--primary));
    color: hsl(var(--primary-foreground));
    cursor: pointer;
    margin-right: 0.375rem;
  }
  #prose-comment-form button.prose-secondary { background: transparent; color: hsl(var(--muted-foreground)); border: 1px solid hsl(var(--input)); }
  .prose-form-error { color: hsl(0 72% 55%); font-size: 11px; margin-bottom: 0.375rem; }
`

export const VIEWER_SCRIPT = `(function () {
  'use strict'

  // --- Parse the embedded blocks -------------------------------------------
  var commentsEl = document.querySelector('script[type="application/x-prose-comments"]')
  var shareEl = document.querySelector('script[type="application/x-prose-share"]')
  var article = document.querySelector('article')
  if (!article) return

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
    var markedText = selection.toString().replace(/\\s*\\n\\s*/g, ' ')
    if (!markedText) return null
    var range = selection.getRangeAt(0)
    if (!article.contains(range.commonAncestorContainer)) return null

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
    return { markedText: markedText, occurrenceIndex: occurrenceIndex, range: range }
  }

  // Best-effort inline highlight for a just-added comment. Works when the
  // selection stays inside one text node; multi-node selections throw and the
  // comment stays rail-only (Prose re-anchors from data on import anyway).
  function tryHighlight(range, id) {
    try {
      var span = document.createElement('span')
      span.setAttribute('data-comment-id', id)
      span.className = 'comment-mark'
      range.surroundContents(span)
      return true
    } catch (e) {
      return false
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
      return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    } catch (e) { return '' }
  }

  function authorLabel(c) {
    if (c.authorName) return c.authorName
    return c.author === 'ai' ? 'AI' : 'Author'
  }

  var activeId = null

  function setActive(id, scrollArticle) {
    activeId = id
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

  function renderThread(c) {
    var card = el('div', 'prose-thread')
    card.setAttribute('data-thread-id', c.id)
    if (c.markedText) card.appendChild(el('span', 'prose-thread-quote', c.markedText))
    card.appendChild(el('div', 'prose-thread-body', c.comment))
    card.appendChild(el('div', 'prose-thread-meta', authorLabel(c) + ' · ' + formatDate(c.createdAt)))
    var replies = c.replies || []
    for (var i = 0; i < replies.length; i++) {
      var r = replies[i]
      // Author replies (live-pushed rows carry fromAuthor; baked desktop
      // replies have no authorName) get the gold border + tag.
      var isAuthor = r.fromAuthor === true || (!r.authorName && r.author !== 'ai')
      var replyEl = el('div', isAuthor ? 'prose-thread-reply prose-reply-author' : 'prose-thread-reply')
      replyEl.appendChild(el('div', 'prose-thread-body', r.text))
      var meta = el('div', 'prose-thread-meta')
      if (isAuthor) meta.appendChild(el('span', 'prose-author-tag', 'Author'))
      var label = r.authorName || (r.author === 'ai' ? 'AI' : '')
      meta.appendChild(document.createTextNode((label ? label + ' · ' : '') + formatDate(r.createdAt)))
      replyEl.appendChild(meta)
      card.appendChild(replyEl)
    }
    card.addEventListener('click', function () { setActive(c.id, true) })
    return card
  }

  var rail = el('aside', null)
  rail.id = 'prose-comment-rail'
  var openList = el('div', 'prose-open-section')
  var resolvedSection = el('div', 'prose-resolved-section')
  var formSlot = el('div', null)

  function renderRail() {
    openList.textContent = ''
    resolvedSection.textContent = ''
    var open = comments.filter(function (c) { return !c.resolved })
    var resolved = comments.filter(function (c) { return c.resolved })
    open.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0) })

    openList.appendChild(el('h2', null, 'Comments (' + open.length + ')'))
    if (open.length === 0) openList.appendChild(el('div', 'prose-thread-meta', 'No open comments.'))
    for (var i = 0; i < open.length; i++) openList.appendChild(renderThread(open[i]))

    if (resolved.length > 0) {
      resolvedSection.appendChild(el('h2', null, 'Resolved (' + resolved.length + ')'))
      for (var j = 0; j < resolved.length; j++) resolvedSection.appendChild(renderThread(resolved[j]))
    }
    toggle.textContent = '💬 ' + open.length
    downloadBtn.textContent = unsavedAdditions > 0
      ? 'Download annotated copy (' + unsavedAdditions + ' new)'
      : 'Download a copy'
    downloadBtn.classList.toggle('prose-has-additions', unsavedAdditions > 0)
  }

  rail.appendChild(formSlot)
  rail.appendChild(openList)
  rail.appendChild(resolvedSection)

  var note = el('div', 'prose-rail-note')
  note.textContent = online
    ? 'Select text to leave a comment.'
    : 'Select text to leave a comment. Comments live in this file — download the annotated copy to keep or return them.'
  rail.appendChild(note)

  // --- Download a (possibly annotated) self-contained copy ------------------
  var downloadBtn = el('button', null, 'Download a copy')
  downloadBtn.id = 'prose-rail-download'
  rail.appendChild(downloadBtn)

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
    var strip = ['#prose-comment-rail', '#prose-rail-toggle', '#prose-add-comment-btn']
    for (var i = 0; i < strip.length; i++) {
      var node = clone.querySelector(strip[i])
      if (node) node.remove()
    }
    var actives = clone.querySelectorAll('.prose-viewer-active')
    for (var j = 0; j < actives.length; j++) actives[j].classList.remove('prose-viewer-active')
    var body = clone.querySelector('body')
    if (body) body.classList.remove('prose-rail-open')
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

  downloadBtn.addEventListener('click', function () {
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

  var toggle = el('button', null)
  toggle.id = 'prose-rail-toggle'
  toggle.setAttribute('aria-label', 'Toggle comments')
  toggle.addEventListener('click', function () {
    var isOpen = document.body.contains(rail)
    if (isOpen) {
      rail.remove()
      document.body.classList.remove('prose-rail-open')
    } else {
      document.body.appendChild(rail)
      document.body.classList.add('prose-rail-open')
    }
  })

  document.body.appendChild(toggle)
  renderRail()
  if (window.innerWidth >= 900) {
    document.body.appendChild(rail)
    document.body.classList.add('prose-rail-open')
  }

  // --- Live conversation loop (#769) ---------------------------------------
  // The page polls the publication's comment list so the conversation is
  // live in both sync modes: refresh-safe reviewer comments, author replies
  // and resolves without a re-publish. Same-origin GET (CSP connect-src
  // 'self'); merge is ADDITIVE — never deletes local entries, so offline and
  // just-posted additions survive; the poll is authoritative only for the
  // resolution state of rows it returns. Dedupe is by id: posted comments
  // land with server ids, and baked author replies are embedded under their
  // server row id at publish time.
  var pollTimer = null
  var pollStopped = false

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
      } else if (existing.resolved !== resolved) {
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
      renderRail()
      if (activeId) setActive(activeId, false)
    }
  }

  function fetchLiveComments() {
    if (!online || pollStopped) return
    window.fetch(shareConfig.shareEndpoint.replace(/\\/$/, '') + '/s/' + token + '/comments').then(function (resp) {
      if (resp.status === 410) {
        pollStopped = true
        if (pollTimer) window.clearInterval(pollTimer)
        note.textContent = 'This share link has been revoked.'
        return null
      }
      if (!resp.ok) return null
      return resp.json()
    }).then(function (body) {
      if (body && body.comments) mergeLive(body.comments)
    }).catch(function () { /* transient network failure — the next poll retries */ })
  }

  if (online) {
    fetchLiveComments()
    pollTimer = window.setInterval(fetchLiveComments, 45000)
    window.addEventListener('focus', fetchLiveComments)
  }

  // --- Highlight interactions ----------------------------------------------
  article.addEventListener('click', function (ev) {
    var target = ev.target
    while (target && target !== article) {
      if (target.getAttribute && target.getAttribute('data-comment-id')) {
        if (!document.body.contains(rail)) toggle.click()
        setActive(target.getAttribute('data-comment-id'), false)
        return
      }
      target = target.parentNode
    }
  })

  // --- Add-comment flow (both modes) ---------------------------------------
  var addBtn = el('button', null, 'Add comment')
  addBtn.id = 'prose-add-comment-btn'
  var pendingAnchor = null

  document.addEventListener('mouseup', function () {
    window.setTimeout(function () {
      var sel = window.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) { addBtn.remove(); return }
      var anchor = computeAnchor(sel)
      if (!anchor) { addBtn.remove(); return }
      pendingAnchor = anchor
      var rect = sel.getRangeAt(0).getBoundingClientRect()
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

  function showForm(anchor) {
    formSlot.textContent = ''
    var form = el('div', null)
    form.id = 'prose-comment-form'
    form.appendChild(el('span', 'prose-thread-quote', anchor.markedText))
    var errorEl = el('div', 'prose-form-error', '')
    errorEl.style.display = 'none'
    var nameInput = el('input', null)
    nameInput.placeholder = 'Your name'
    nameInput.maxLength = 100
    try { nameInput.value = window.localStorage.getItem('prose-commenter-name') || '' } catch (e) { /* blocked storage */ }
    var emailInput = null
    if (online) {
      emailInput = el('input', null)
      emailInput.placeholder = 'Email (optional, for replies)'
      emailInput.type = 'email'
      emailInput.maxLength = 254
    }
    var textArea = el('textarea', null)
    textArea.placeholder = 'Your comment'
    textArea.rows = 4
    textArea.maxLength = 5000
    var postBtn = el('button', null, online ? 'Post' : 'Add')
    var cancelBtn = el('button', 'prose-secondary', 'Cancel')
    cancelBtn.addEventListener('click', function () { formSlot.textContent = '' })
    postBtn.addEventListener('click', function () {
      var name = nameInput.value.trim()
      var text = textArea.value.trim()
      if (!name || !text) {
        errorEl.textContent = 'Name and comment are required.'
        errorEl.style.display = 'block'
        return
      }
      try { window.localStorage.setItem('prose-commenter-name', name) } catch (e) { /* blocked storage */ }
      if (!online) {
        var localComment = {
          id: makeId(),
          markedText: anchor.markedText,
          occurrenceIndex: anchor.occurrenceIndex,
          comment: text,
          authorName: name,
          createdAt: Date.now(),
          replies: []
        }
        comments.push(localComment)
        localAdditions++
        unsavedAdditions++
        if (anchor.range) tryHighlight(anchor.range, localComment.id)
        formSlot.textContent = ''
        renderRail()
        setActive(localComment.id, false)
        return
      }
      postBtn.disabled = true
      postComment(anchor, name, emailInput ? emailInput.value.trim() : '', text).then(function (created) {
        comments.push({
          id: created.id,
          markedText: anchor.markedText,
          occurrenceIndex: anchor.occurrenceIndex,
          comment: text,
          authorName: name,
          createdAt: created.createdAt ? new Date(created.createdAt).getTime() : Date.now(),
          replies: []
        })
        if (anchor.range) tryHighlight(anchor.range, created.id)
        formSlot.textContent = ''
        renderRail()
        // Pick up anything else that landed while the form was open (the
        // just-posted comment merges by its server id — no duplicate).
        window.setTimeout(fetchLiveComments, 2000)
      }).catch(function (err) {
        postBtn.disabled = false
        errorEl.textContent = err && err.message ? err.message : 'Failed to post comment.'
        errorEl.style.display = 'block'
      })
    })
    form.appendChild(errorEl)
    form.appendChild(nameInput)
    if (emailInput) form.appendChild(emailInput)
    form.appendChild(textArea)
    form.appendChild(postBtn)
    form.appendChild(cancelBtn)
    formSlot.appendChild(form)
    if (!document.body.contains(rail)) toggle.click()
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
    return window.fetch(shareConfig.shareEndpoint.replace(/\\/$/, '') + '/s/' + token + '/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (resp) {
      if (resp.status === 429) throw new Error('Slow down — too many comments. Try again in a minute.')
      if (resp.status === 410) throw new Error('This share link has been revoked.')
      if (!resp.ok) throw new Error('Failed to post comment (' + resp.status + ').')
      return resp.json()
    })
  }
})()
`
