/* Toolbar — top chrome of the Prose app. */

function Toolbar({
  fileOpen, chatOpen, theme, autosave, annotations,
  onToggleFile, onToggleChat, onToggleTheme, onToggleAutosave, onToggleAnnotations,
  tabs, activeId, onSwitch, onCloseTab, onNewTab, onCopy, copied,
}) {
  const [menu, setMenu] = React.useState(false);
  const I = window.Icon;
  const TabBar = window.TabBar;

  return (
    <div className="toolbar">
      <div className="traffic-lights">
        <span className="dot r"></span>
        <span className="dot y"></span>
        <span className="dot g"></span>
      </div>

      <div className="toolbar-group">
        <button className="icon-btn" onClick={onToggleFile} title={fileOpen ? 'Hide files' : 'Show files'}>
          <I name={fileOpen ? 'panel-left-close' : 'panel-left'} />
        </button>
      </div>

      <div className="toolbar-group center">
        <TabBar tabs={tabs} activeId={activeId} onSwitch={onSwitch} onClose={onCloseTab} onNew={onNewTab} />
      </div>

      <div className="toolbar-group" style={{ position: 'relative' }}>
        <button className="icon-btn" onClick={onCopy} title="Copy markdown">
          <I name={copied ? 'check' : 'copy'} />
        </button>
        <button className="icon-btn" onClick={onToggleAutosave} title={autosave ? 'Autosave on' : 'Autosave paused'}
                style={{ color: autosave ? '' : 'hsl(var(--muted-foreground))' }}>
          <I name="timer" />
        </button>
        <button className="icon-btn" title="Source mode"><I name="code" /></button>
        <button className="icon-btn" onClick={onToggleAnnotations} title="Toggle AI annotations"
                style={{ color: annotations ? '' : 'hsl(var(--muted-foreground))' }}>
          <I name={annotations ? 'eye' : 'eye-off'} />
        </button>
        <button className="icon-btn" onClick={onToggleTheme} title="Toggle theme">
          <I name={theme === 'dark' ? 'sun' : 'moon'} />
        </button>
        <button className="icon-btn" onClick={onToggleChat} title={chatOpen ? 'Hide chat' : 'Show chat'}>
          <I name={chatOpen ? 'panel-right-close' : 'panel-right'} />
        </button>
        <button className="icon-btn" onClick={() => setMenu(v => !v)} title="More">
          <I name="more-horizontal" />
        </button>

        {menu && (
          <>
            <div onClick={() => setMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }}></div>
            <div className="menu">
              <div className="menu-item"><I name="file-plus" />New Document</div>
              <div className="menu-item"><I name="folder-open" />Open…</div>
              <div className="menu-item"><I name="save" />Save</div>
              <div className="menu-item"><I name="file-down" />Save as…</div>
              <div className="menu-sep"></div>
              <div className="menu-item"><I name="settings" />Settings</div>
              <div className="menu-item"><I name="sparkles" />Download Claude Skill</div>
              <div className="menu-sep"></div>
              <div className="menu-item"><I name="bug" />Report a Bug</div>
              <div className="menu-item"><I name="message-square-plus" />Request a Feature</div>
              <div className="menu-sep"></div>
              <div className="menu-item"><I name="x" />Close</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

window.Toolbar = Toolbar;
