/* FilePanel — left rail with recent files, a search box, and a folder tree. */

const FILES_RECENT = [
  { id: 'pse', emoji: '📝', name: 'personal-software-era.md', meta: 'now' },
  { id: 'mvp', emoji: '🚀', name: 'mvp-launch-notes.md', meta: '2h' },
  { id: 'jrnl', emoji: '🗒', name: 'journal-may-08.md', meta: 'yesterday' },
  { id: 'mcp', emoji: '⚡', name: 'mcp-spec-draft.md', meta: '2d' },
  { id: 'rm', emoji: '✍', name: 'remarkable-sync-ocr.md', meta: '3d' },
];

const TREE = [
  { id: 'docs', emoji: '📁', name: 'Documents', folder: true, depth: 0 },
  { id: 'prose', emoji: '📁', name: 'Prose', folder: true, depth: 1 },
  { id: 'pse', emoji: '📝', name: 'personal-software-era.md', depth: 2, meta: '12:14' },
  { id: 'mvp', emoji: '🚀', name: 'mvp-launch-notes.md', depth: 2, meta: '10:22' },
  { id: 'mcp', emoji: '⚡', name: 'mcp-spec-draft.md', depth: 2, meta: 'May 10' },
  { id: 'arch', emoji: '🏛', name: 'Archive', folder: true, depth: 1 },
  { id: 'jrnl', emoji: '🗒', name: 'Journal', folder: true, depth: 1 },
  { id: 'jrnl-08', emoji: '🗒', name: 'journal-may-08.md', depth: 2, meta: 'May 08' },
  { id: 'jrnl-09', emoji: '🗒', name: 'journal-may-09.md', depth: 2, meta: 'May 09' },
];

function FilePanel({ activeFileId, onPickFile }) {
  const [view, setView] = React.useState('recent'); // 'recent' | 'tree'
  const [query, setQuery] = React.useState('');
  const I = window.Icon;

  const recent = FILES_RECENT.filter(f => f.name.toLowerCase().includes(query.toLowerCase()));
  const tree = TREE.filter(f => !query || f.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <aside className="file-panel" data-screen-label="File panel">
      <div className="fp-head">
        <div className="fp-toggle">
          <button className={view === 'recent' ? 'active' : ''} onClick={() => setView('recent')}>Recent</button>
          <button className={view === 'tree' ? 'active' : ''} onClick={() => setView('tree')}>Files</button>
        </div>
        <div className="fp-actions">
          <button className="icon-btn" title="New file"><I name="file-plus" size={13} /></button>
          <button className="icon-btn" title="New folder"><I name="folder-plus" size={13} /></button>
        </div>
      </div>
      <div className="fp-search">
        <input
          placeholder={view === 'recent' ? 'Search recent' : 'Search files'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="fp-list">
        {view === 'recent' ? (
          <>
            <div className="fp-section-label">Recent</div>
            {recent.map(f => (
              <div
                key={f.id}
                className={`file-row ${f.id === activeFileId ? 'active' : ''}`}
                onClick={() => onPickFile(f)}
              >
                <span className="emoji">{f.emoji}</span>
                <span className="name">{f.name}</span>
                <span className="meta">{f.meta}</span>
              </div>
            ))}
          </>
        ) : (
          tree.map(f => (
            <div
              key={f.id}
              className={`file-row depth-${f.depth} ${f.folder ? 'folder' : ''} ${f.id === activeFileId ? 'active' : ''}`}
              onClick={() => !f.folder && onPickFile(f)}
            >
              <span className="emoji">{f.emoji}</span>
              <span className="name">{f.name}</span>
              {f.meta && <span className="meta">{f.meta}</span>}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

window.FilePanel = FilePanel;
