/* StatusBar — slim bar at the bottom. */

function StatusBar({ dirty, autosave, wordCount, path }) {
  const I = window.Icon;
  return (
    <div className="statusbar" data-screen-label="Status bar">
      <div className="group">
        <span className="path">{path}</span>
        <span className={dirty ? 'dirty-dot' : 'saved-dot'} title={dirty ? 'Unsaved' : 'Saved'}></span>
        <span>{dirty ? 'Unsaved' : 'Saved'}</span>
        {autosave && !dirty && (
          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            <I name="timer" size={11} /> autosave
          </span>
        )}
      </div>
      <div className="group">
        <span>{wordCount} words</span>
        <span>·</span>
        <span>~{Math.max(1, Math.round(wordCount / 200))} min read</span>
        <span>·</span>
        <span>UTF-8</span>
        <span>·</span>
        <span>Markdown</span>
      </div>
    </div>
  );
}

window.StatusBar = StatusBar;
