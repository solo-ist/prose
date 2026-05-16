/* App — composes all panels into the Prose desktop app. */

const { useState, useEffect, useCallback } = React;

const INITIAL_TABS = [
  { id: 'pse',  title: 'personal-software-era', fileId: 'pse',  dirty: true,  preview: false },
  { id: 'mvp',  title: 'mvp-launch-notes',      fileId: 'mvp',  dirty: false, preview: false },
  { id: 'jrnl', title: 'journal-may-08',        fileId: 'jrnl', dirty: false, preview: true  },
];

const INITIAL_MESSAGES = [
  {
    id: 1,
    role: 'user',
    context: 'L4–L5  ·  37 words',
    body: 'tighten the opening. it feels a bit long',
  },
  {
    id: 2,
    role: 'assistant',
    body: 'Suggested: <em>"In an era where AI ships custom enterprise-grade software on demand, what endures isn\'t the subscription, it\'s the idea."</em><br><br>I\'ve marked the edit inline — accept it in the editor to apply.',
  },
];

const FILE_META = {
  pse:  '~/Documents/Prose/personal-software-era.md',
  mvp:  '~/Documents/Prose/mvp-launch-notes.md',
  jrnl: '~/Documents/Prose/Journal/journal-may-08.md',
  mcp:  '~/Documents/Prose/mcp-spec-draft.md',
  rm:   '~/Documents/Prose/remarkable-sync-ocr.md',
};

function App() {
  // Allow the wrapper page to force a starting theme via URL hash.
  const initialTheme =
    typeof window !== 'undefined' && window.location.hash.includes('light')
      ? 'light'
      : 'dark';
  const [theme, setTheme] = useState(initialTheme);
  const [fileOpen, setFileOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(true);
  const [autosave, setAutosave] = useState(true);
  const [annotations, setAnnotations] = useState(true);
  const [copied, setCopied] = useState(false);

  const [tabs, setTabs] = useState(INITIAL_TABS);
  const [activeId, setActiveId] = useState('pse');
  const [messages, setMessages] = useState(INITIAL_MESSAGES);

  // Apply theme to <html>
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const activeTab = tabs.find(t => t.id === activeId) || tabs[0];
  const fileId = activeTab?.fileId || 'pse';

  const handlePickFile = (f) => {
    // open in tab if not present, else focus
    const existing = tabs.find(t => t.fileId === f.id);
    if (existing) {
      setActiveId(existing.id);
    } else {
      const newTab = { id: f.id, title: f.name.replace(/\.md$/, ''), fileId: f.id, dirty: false, preview: false };
      setTabs(prev => [...prev, newTab]);
      setActiveId(newTab.id);
    }
  };

  const handleCloseTab = (id) => {
    setTabs(prev => {
      const next = prev.filter(t => t.id !== id);
      if (id === activeId && next.length) setActiveId(next[Math.max(0, prev.findIndex(t => t.id === id) - 1)].id);
      return next.length ? next : prev;
    });
  };

  const handleNewTab = () => {
    const id = 'new-' + Date.now();
    setTabs(prev => [...prev, { id, title: 'Untitled', fileId: 'pse', dirty: false, preview: false }]);
    setActiveId(id);
  };

  const handleCopy = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const Toolbar = window.Toolbar;
  const FilePanel = window.FilePanel;
  const Editor = window.Editor;
  const ChatPanel = window.ChatPanel;
  const StatusBar = window.StatusBar;

  return (
    <div className="app">
      <Toolbar
        fileOpen={fileOpen}
        chatOpen={chatOpen}
        theme={theme}
        autosave={autosave}
        annotations={annotations}
        copied={copied}
        tabs={tabs}
        activeId={activeId}
        onToggleFile={() => setFileOpen(v => !v)}
        onToggleChat={() => setChatOpen(v => !v)}
        onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
        onToggleAutosave={() => setAutosave(v => !v)}
        onToggleAnnotations={() => setAnnotations(v => !v)}
        onSwitch={setActiveId}
        onCloseTab={handleCloseTab}
        onNewTab={handleNewTab}
        onCopy={handleCopy}
      />

      <div className="body">
        {fileOpen && <FilePanel activeFileId={fileId} onPickFile={handlePickFile} />}
        <Editor fileId={fileId} annotations={annotations} />
        {chatOpen && (
          <ChatPanel
            messages={messages}
            setMessages={setMessages}
            suggestionCount={fileId === 'pse' ? 1 : 0}
            onClearChat={() => setMessages([])}
          />
        )}
      </div>

      <StatusBar
        dirty={activeTab?.dirty}
        autosave={autosave}
        wordCount={fileId === 'pse' ? 287 : fileId === 'mvp' ? 142 : 96}
        path={FILE_META[fileId] || FILE_META.pse}
      />
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
