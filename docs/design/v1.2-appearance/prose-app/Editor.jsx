/* Editor — TipTap-styled mock. Plain HTML rendered as the active document. */

const DOCS = {
  pse: {
    title: 'personal-software-era',
    body: (annotations) => (
      <>
        <div className="frontmatter">
          <span className="k">title:</span> The Personal-Software Era<br />
          <span className="k">draft:</span> true<br />
          <span className="k">tags:</span> [manifesto, software, ai]
        </div>
        <h1>The Personal-Software Era</h1>
        <h2>A New Kind of Tool</h2>
        <p>
          We are building for a world where{' '}
          <span className="diff-suggestion">
            <span data-diff-suggestion-old>software is scarce</span>
            <span data-diff-suggestion-new>anyone can ship enterprise apps with a prompt</span>
            <span className="actions">
              <button className="accept">✓</button>
              <button className="reject">✕</button>
            </span>
          </span>
          . What survives aren't subscriptions — <em>it is the file.</em>
        </p>
        <p>
          {annotations
            ? <span className="ai-pending">The markdown you write today, you'll still own tomorrow.</span>
            : 'The markdown you write today, you\'ll still own tomorrow.'}
          {' '}AI can generate <strong>enterprise-grade software with a fraction of the work</strong> it used to take. The
          assumptions behind SaaS are quietly collapsing. Good software isn't gated by subscriptions anymore — it's
          gated by good ideas.
        </p>
        <h2>What changes</h2>
        <ul>
          <li>Files outlast applications. The <code>.md</code> is the artifact.</li>
          <li>API keys are yours; conversations stay on your machine.</li>
          <li>Tools become agent-accessible — MCP is the new protocol.</li>
          <li>Open source isn't a value-add. It's the floor.</li>
        </ul>
        <blockquote>
          Software has stopped being scarce. What remains scarce is the idea, the taste, the through-line.
        </blockquote>
      </>
    ),
  },
  mvp: {
    title: 'mvp-launch-notes',
    body: () => (
      <>
        <h1>MVP launch — what shipped</h1>
        <p>
          v1.0 is on the App Store. The core loop — open a file, write, chat with Claude, accept suggestions — works
          end to end. <strong>BYOK, MCP server, reMarkable sync.</strong>
        </p>
        <h2>Open issues</h2>
        <ol>
          <li>Frontmatter editor crashes on YAML with anchors.</li>
          <li>Source-mode CodeMirror leaks on tab close (intermittent).</li>
          <li>Sentry hash collisions for the same error across builds.</li>
        </ol>
      </>
    ),
  },
  jrnl: {
    title: 'journal-may-08',
    body: () => (
      <>
        <h1>May 8, 2026</h1>
        <p>
          Slept on the reMarkable OCR flow. The thing that's missing is a <em>review</em> step between OCR output and
          insertion — give the user a chance to fix obvious misreads before they end up in the file.
        </p>
        <p>Probably 3 days of work. Worth it.</p>
      </>
    ),
  },
  mcp: {
    title: 'mcp-spec-draft',
    body: () => (
      <>
        <h1>Prose MCP tools — draft spec</h1>
        <p>Five tools, all read-or-mutate the <em>active</em> document only. No cross-document operations in v1.</p>
        <ul>
          <li><code>read_document</code> — return full markdown body.</li>
          <li><code>get_outline</code> — return heading tree with line numbers.</li>
          <li><code>open_file</code> — open or focus a file path.</li>
          <li><code>suggest_edit</code> — propose a diff in pending state.</li>
          <li><code>create_and_open_file</code> — write a new <code>.md</code> and open it.</li>
        </ul>
      </>
    ),
  },
  rm: {
    title: 'remarkable-sync-ocr',
    body: () => (
      <>
        <h1>reMarkable sync · OCR pipeline</h1>
        <p>Three concurrent downloads, batch size 5 for OCR. Retries with exponential backoff. Skip silently when
        <code>REMARKABLE_OCR_URL</code> isn't set — sync still works, notebooks just have no markdown text.</p>
      </>
    ),
  },
};

function Editor({ fileId, annotations }) {
  const doc = DOCS[fileId] || DOCS.pse;
  return (
    <div className="editor-area" data-screen-label="Editor">
      <div className="editor-scroll">
        <div className="editor-doc prose-editor">
          {doc.body(annotations)}
        </div>
      </div>
    </div>
  );
}

window.Editor = Editor;
window.PROSE_DOCS = DOCS;
