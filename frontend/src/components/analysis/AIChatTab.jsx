import React, { useState, useRef, useEffect } from 'react';
import api from '../../services/api';

// Splits a message into plain-text and fenced-code-block segments and
// renders code blocks in a monospace panel with a copy button. Avoids
// pulling in a full markdown library just for this — the model only ever
// needs to produce plain prose plus ```lang ... ``` fences, which this
// covers completely.
function MessageContent({ text }) {
  const parts = String(text || '').split(/```(\w*)\n?([\s\S]*?)```/g);
  // split() with capturing groups interleaves: [plain, lang, code, plain, lang, code, ...]
  const nodes = [];
  for (let i = 0; i < parts.length; i += 3) {
    const plain = parts[i];
    if (plain) nodes.push({ type: 'text', content: plain });
    if (parts[i + 2] !== undefined) {
      nodes.push({ type: 'code', lang: parts[i + 1] || '', content: parts[i + 2] });
    }
  }

  const [copiedIdx, setCopiedIdx] = useState(null);

  return (
    <div>
      {nodes.map((n, idx) =>
        n.type === 'text' ? (
          <p key={idx} style={{ margin: '0 0 8px 0', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>
            {n.content.trim()}
          </p>
        ) : (
          <div key={idx} style={{
            position: 'relative', margin: '8px 0', borderRadius: 8, overflow: 'hidden',
            border: '1px solid var(--border)', background: 'var(--bg-code, #0d1117)',
          }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '6px 12px', background: 'var(--bg-code-header, rgba(255,255,255,0.04))',
              borderBottom: '1px solid var(--border)',
            }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                {n.lang || 'code'}
              </span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(n.content.trim());
                  setCopiedIdx(idx);
                  setTimeout(() => setCopiedIdx(null), 1500);
                }}
                style={{
                  fontSize: 11, color: 'var(--text-muted)', background: 'transparent',
                  border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px', cursor: 'pointer',
                }}
              >
                {copiedIdx === idx ? 'Copied' : 'Copy'}
              </button>
            </div>
            <pre style={{ margin: 0, padding: 12, overflowX: 'auto', fontSize: 12.5, lineHeight: 1.5 }}>
              <code>{n.content.trim()}</code>
            </pre>
          </div>
        )
      )}
    </div>
  );
}

export default function AIChatTab({ analysisId, projectName }) {
  const [messages, setMessages] = useState([]); // {role: 'user'|'model', content}
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending]);

  const send = async () => {
    const trimmed = input.trim();
    if (!trimmed || sending) return;

    const nextMessages = [...messages, { role: 'user', content: trimmed }];
    setMessages(nextMessages);
    setInput('');
    setSending(true);
    setError(null);

    try {
      const history = nextMessages.slice(0, -1).slice(-12); // everything except the message we're sending now
      const res = await api.post(`analysis/${analysisId}/chat/`, { message: trimmed, history });
      setMessages(prev => [...prev, { role: 'model', content: res.data.reply }]);
    } catch (err) {
      const msg = err?.response?.data?.error || 'Something went wrong reaching the AI.';
      setError(msg);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 520 }}>
      <div
        ref={scrollRef}
        style={{
          flex: 1, overflowY: 'auto', padding: 16, background: 'var(--bg-card)',
          border: '1px solid var(--border)', borderRadius: 10, marginBottom: 12,
        }}
      >
        {messages.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', marginTop: 40 }}>
            Ask anything about {projectName || 'this repository'} — architecture, specific files,
            the security/quality findings above, or ask it to write or modify code for you.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', marginBottom: 14, justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '85%', padding: '10px 14px', borderRadius: 10, fontSize: 13.5,
              background: m.role === 'user' ? 'var(--accent)' : 'var(--bg-hover, rgba(255,255,255,0.04))',
              color: m.role === 'user' ? '#fff' : 'var(--text)',
              border: m.role === 'user' ? 'none' : '1px solid var(--border)',
            }}>
              <MessageContent text={m.content} />
            </div>
          </div>
        ))}
        {sending && (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, fontStyle: 'italic' }}>Thinking…</div>
        )}
        {error && (
          <div style={{ color: '#ef4444', fontSize: 13, marginTop: 8 }}>{error}</div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about this repo, or ask for code…"
          rows={2}
          disabled={sending}
          style={{
            flex: 1, resize: 'none', padding: '10px 12px', borderRadius: 8,
            border: '1px solid var(--border)', background: 'var(--bg-input, var(--bg-card))',
            color: 'var(--text)', fontSize: 13.5, fontFamily: 'inherit',
          }}
        />
        <button
          onClick={send}
          disabled={sending || !input.trim()}
          style={{
            padding: '0 20px', borderRadius: 8, border: 'none',
            background: 'var(--accent)', color: '#fff', fontWeight: 600, fontSize: 13.5,
            cursor: sending || !input.trim() ? 'default' : 'pointer',
            opacity: sending || !input.trim() ? 0.6 : 1,
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}