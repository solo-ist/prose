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

export const VIEWER_STYLES = `
  .comment-mark {
    background: rgba(251, 191, 36, 0.28);
    border-bottom: 1.5px solid rgba(217, 119, 6, 0.65);
    border-radius: 2px;
    cursor: pointer;
  }
  .comment-mark.prose-viewer-active {
    background: rgba(251, 191, 36, 0.55);
  }
  @media (prefers-color-scheme: dark) {
    .comment-mark { background: rgba(251, 191, 36, 0.18); border-bottom-color: rgba(251, 191, 36, 0.5); }
    .comment-mark.prose-viewer-active { background: rgba(251, 191, 36, 0.38); }
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
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 0.8125rem;
    line-height: 1.45;
    background: #fafafa;
    border-left: 1px solid #e2e2e2;
    color: #1a1a1a;
    z-index: 10;
  }
  @media (prefers-color-scheme: dark) {
    #prose-comment-rail { background: #202020; border-left-color: #333; color: #e0e0e0; }
  }
  body.prose-rail-open { margin-right: 320px; }
  @media (max-width: 900px) {
    body.prose-rail-open { margin-right: auto; }
    #prose-comment-rail { width: min(320px, 90vw); box-shadow: -4px 0 24px rgba(0,0,0,0.18); }
  }
  #prose-comment-rail h2 {
    font-size: 0.8125rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin: 0 0 0.75rem;
    color: #666;
  }
  @media (prefers-color-scheme: dark) { #prose-comment-rail h2 { color: #999; } }
  .prose-thread {
    border: 1px solid #e2e2e2;
    border-radius: 6px;
    padding: 0.625rem;
    margin-bottom: 0.625rem;
    background: #fff;
    cursor: pointer;
  }
  .prose-thread.prose-viewer-active { border-color: rgba(217, 119, 6, 0.8); }
  @media (prefers-color-scheme: dark) {
    .prose-thread { background: #262626; border-color: #383838; }
    .prose-thread.prose-viewer-active { border-color: rgba(251, 191, 36, 0.6); }
  }
  .prose-thread-quote {
    display: block;
    font-style: italic;
    color: #92640c;
    border-left: 2px solid rgba(217, 119, 6, 0.5);
    padding-left: 0.5rem;
    margin-bottom: 0.375rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  @media (prefers-color-scheme: dark) { .prose-thread-quote { color: #d9a23f; } }
  .prose-thread-meta { color: #888; font-size: 0.6875rem; margin-top: 0.25rem; }
  .prose-thread-reply { margin-top: 0.5rem; padding-left: 0.625rem; border-left: 2px solid #e2e2e2; }
  @media (prefers-color-scheme: dark) { .prose-thread-reply { border-left-color: #383838; } }
  .prose-thread-reply.prose-reply-author { border-left-color: rgba(200, 164, 90, 0.8); }
  .prose-author-tag {
    display: inline-block;
    margin-right: 0.3rem;
    padding: 0 0.3rem;
    border-radius: 3px;
    font-size: 0.625rem;
    font-weight: 600;
    background: rgba(200, 164, 90, 0.18);
    color: #92640c;
  }
  @media (prefers-color-scheme: dark) { .prose-author-tag { color: #d9a23f; } }
  .prose-thread-body { white-space: pre-wrap; word-break: break-word; }
  .prose-resolved-section { margin-top: 1.25rem; }
  .prose-resolved-section .prose-thread { opacity: 0.65; }
  .prose-rail-note {
    margin-top: 1rem;
    padding-top: 0.75rem;
    border-top: 1px solid #e2e2e2;
    color: #888;
    font-size: 0.6875rem;
  }
  @media (prefers-color-scheme: dark) { .prose-rail-note { border-top-color: #333; } }
  #prose-rail-download {
    display: block;
    width: 100%;
    box-sizing: border-box;
    margin-top: 0.75rem;
    border: 1px solid #d0d0d0;
    border-radius: 6px;
    padding: 0.45rem 0.75rem;
    font: 600 0.75rem -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #fff;
    color: #1a1a1a;
    cursor: pointer;
  }
  #prose-rail-download.prose-has-additions { background: #d97706; border-color: #d97706; color: #fff; }
  @media (prefers-color-scheme: dark) {
    #prose-rail-download { background: #2c2c2c; border-color: #444; color: #e0e0e0; }
    #prose-rail-download.prose-has-additions { background: #d97706; border-color: #d97706; color: #fff; }
  }
  #prose-rail-toggle {
    position: fixed;
    right: 1rem;
    bottom: 1rem;
    z-index: 11;
    border: 1px solid #d0d0d0;
    border-radius: 999px;
    padding: 0.4rem 0.85rem;
    font: 600 0.8125rem -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #fff;
    color: #1a1a1a;
    cursor: pointer;
    box-shadow: 0 2px 10px rgba(0,0,0,0.12);
  }
  @media (prefers-color-scheme: dark) { #prose-rail-toggle { background: #2c2c2c; border-color: #444; color: #e0e0e0; } }
  #prose-add-comment-btn {
    position: absolute;
    z-index: 12;
    border: 1px solid #d0d0d0;
    border-radius: 6px;
    padding: 0.3rem 0.6rem;
    font: 600 0.75rem -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #fff;
    color: #1a1a1a;
    cursor: pointer;
    box-shadow: 0 2px 10px rgba(0,0,0,0.15);
  }
  @media (prefers-color-scheme: dark) { #prose-add-comment-btn { background: #2c2c2c; border-color: #444; color: #e0e0e0; } }
  #prose-comment-form { border: 1px solid rgba(217, 119, 6, 0.5); border-radius: 6px; padding: 0.625rem; margin-bottom: 0.75rem; background: #fff; }
  @media (prefers-color-scheme: dark) { #prose-comment-form { background: #262626; } }
  #prose-comment-form input, #prose-comment-form textarea {
    display: block;
    width: 100%;
    box-sizing: border-box;
    margin-bottom: 0.5rem;
    padding: 0.375rem 0.5rem;
    border: 1px solid #d0d0d0;
    border-radius: 4px;
    font: inherit;
    background: inherit;
    color: inherit;
  }
  @media (prefers-color-scheme: dark) { #prose-comment-form input, #prose-comment-form textarea { border-color: #444; } }
  #prose-comment-form button {
    border: none;
    border-radius: 4px;
    padding: 0.375rem 0.75rem;
    font: 600 0.75rem -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #d97706;
    color: #fff;
    cursor: pointer;
    margin-right: 0.375rem;
  }
  #prose-comment-form button.prose-secondary { background: transparent; color: inherit; border: 1px solid #d0d0d0; }
  @media (prefers-color-scheme: dark) { #prose-comment-form button.prose-secondary { border-color: #444; } }
  .prose-form-error { color: #dc2626; font-size: 0.6875rem; margin-bottom: 0.375rem; }
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
