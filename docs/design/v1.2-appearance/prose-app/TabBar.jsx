/* TabBar — strip of editable tabs across the top center. */

function TabBar({ tabs, activeId, onSwitch, onClose, onNew }) {
  const I = window.Icon;
  return (
    <div className="tabbar" data-screen-label="Tabs">
      {tabs.map(t => (
        <div
          key={t.id}
          className={`tab ${t.id === activeId ? 'active' : ''} ${t.preview ? 'preview' : ''}`}
          onClick={() => onSwitch(t.id)}
        >
          {t.dirty && <span className="dirty" title="Unsaved changes"></span>}
          <span className="title">{t.title}</span>
          <button className="close" onClick={(e) => { e.stopPropagation(); onClose(t.id); }}>
            <I name="x" size={11} />
          </button>
        </div>
      ))}
      <button className="tab-new" onClick={onNew} title="New tab">
        <I name="plus" size={14} />
      </button>
    </div>
  );
}

window.TabBar = TabBar;
