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

  var comments = []
  try {
    if (commentsEl) {
      var decoded = decodeURIComponent(escape(atob(commentsEl.textContent.trim())))
      var block = JSON.parse(decoded)
      if (block && Array.isArray(block.comments)) comments = block.comments
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

  if (comments.length === 0 && !online) return

  // --- Anchor computation (mirrors restoreComments' normalization) ---------
  // ASCII space (U+0020) ONLY — verified against restoreComments in
  // extensions/comments/extension.ts, which normalizes with replace(/ /g, '')
  // on both the stored markedText and doc.textContent. Do NOT "fix" this to
  // \s+ or add tabs/NBSP: any divergence from the editor's normalization
  // shifts occurrence indexes and desyncs anchors. If the editor's
  // normalization ever changes, change BOTH sites together.
  function norm(s) { return s.replace(/ /g, '') }

  function computeAnchor(selection) {
    var markedText = selection.toString()
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
    return { markedText: markedText, occurrenceIndex: occurrenceIndex }
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
      var replyEl = el('div', 'prose-thread-reply')
      replyEl.appendChild(el('div', 'prose-thread-body', r.text))
      replyEl.appendChild(el('div', 'prose-thread-meta', authorLabel(r) + ' · ' + formatDate(r.createdAt)))
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
  }

  rail.appendChild(formSlot)
  rail.appendChild(openList)
  rail.appendChild(resolvedSection)

  var note = el('div', 'prose-rail-note')
  if (online) {
    note.textContent = 'Select text to leave a comment.'
  } else {
    note.textContent = isFile && shareConfig
      ? "You're viewing a local copy. Open the shared link to add comments."
      : 'Read-only copy — comments can\\u2019t be added here.'
  }
  rail.appendChild(note)

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

  // --- Add-comment flow (online mode only) ---------------------------------
  if (!online) return

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
    var emailInput = el('input', null)
    emailInput.placeholder = 'Email (optional, for replies)'
    emailInput.type = 'email'
    emailInput.maxLength = 254
    var textArea = el('textarea', null)
    textArea.placeholder = 'Your comment'
    textArea.rows = 4
    textArea.maxLength = 5000
    var postBtn = el('button', null, 'Post')
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
      postBtn.disabled = true
      postComment(anchor, name, emailInput.value.trim(), text).then(function (created) {
        try { window.localStorage.setItem('prose-commenter-name', name) } catch (e) { /* blocked storage */ }
        comments.push({
          id: created.id,
          markedText: anchor.markedText,
          occurrenceIndex: anchor.occurrenceIndex,
          comment: text,
          authorName: name,
          createdAt: created.createdAt ? new Date(created.createdAt).getTime() : Date.now(),
          replies: []
        })
        formSlot.textContent = ''
        renderRail()
      }).catch(function (err) {
        postBtn.disabled = false
        errorEl.textContent = err && err.message ? err.message : 'Failed to post comment.'
        errorEl.style.display = 'block'
      })
    })
    form.appendChild(errorEl)
    form.appendChild(nameInput)
    form.appendChild(emailInput)
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
