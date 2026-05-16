/* ChatPanel — right rail. Sample conversation + composer. */

function ChatPanel({ messages, setMessages, suggestionCount, onClearChat }) {
  const [input, setInput] = React.useState('');
  const [thinking, setThinking] = React.useState(false);
  const scrollRef = React.useRef(null);
  const I = window.Icon;

  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, thinking]);

  const send = () => {
    if (!input.trim()) return;
    const text = input.trim();
    setInput('');
    setMessages(prev => [...prev, { id: Date.now(), role: 'user', body: text }]);
    setThinking(true);
    setTimeout(() => {
      setThinking(false);
      setMessages(prev => [
        ...prev,
        {
          id: Date.now() + 1,
          role: 'assistant',
          body: 'Drafted a tighter version above. Accept the inline suggestion to apply it, or keep iterating here.',
        },
      ]);
    }, 1100);
  };

  return (
    <aside className="chat-panel" data-screen-label="Chat panel">
      <div className="cp-actions">
        <button className="icon-btn" title="Document info"><I name="info" size={14} /></button>
        <button className="icon-btn" title="Chat history"><I name="history" size={14} /></button>
        <button className="icon-btn" title="New chat"><I name="plus" size={14} /></button>
        {messages.length > 0 && (
          <button className="icon-btn" title="Clear messages" onClick={onClearChat}><I name="trash-2" size={14} /></button>
        )}
      </div>

      <div className="cp-scroll" ref={scrollRef}>
        {messages.length === 0 && !thinking ? (
          <div className="cp-empty">
            <div className="icon"><I name="message-square" size={48} /></div>
            <div className="t1">No messages yet</div>
            <div className="t2">
              Select text and press <kbd>⌘⇧K</kbd><br />to add it as context
            </div>
          </div>
        ) : (
          <>
            {messages.map(m => (
              <div key={m.id} className={`cp-msg ${m.role}`}>
                <div className="role">{m.role}</div>
                {m.context && <div className="context-chip">{m.context}</div>}
                <div className="body" dangerouslySetInnerHTML={{ __html: m.body }} />
              </div>
            ))}
            {thinking && (
              <div className="cp-msg thinking">
                <div className="dot"></div>
                <div className="label">Thinking…</div>
              </div>
            )}
          </>
        )}
      </div>

      {suggestionCount > 0 && (
        <div className="cp-suggestion-chip">
          <I name="sparkles" size={13} />
          Review {suggestionCount} suggestion{suggestionCount !== 1 ? 's' : ''}
        </div>
      )}

      <div className="cp-input">
        <div className="top-meta">
          <span className="model-pill">
            <I name="sparkles" size={11} />
            Sonnet 4.5
            <I name="chevron-down" size={11} />
          </span>
          <span style={{ marginLeft: 'auto', opacity: 0.6 }}>Full document context</span>
        </div>
        <div className="row">
          <textarea
            placeholder="Ask Claude to edit, brainstorm, or summarize…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            style={{ height: Math.min(120, 20 + (input.split('\n').length - 1) * 20) }}
          />
          <button className="send-btn" disabled={!input.trim()} onClick={send}>
            <I name="arrow-up" size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
}

window.ChatPanel = ChatPanel;
