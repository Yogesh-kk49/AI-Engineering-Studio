import React, { useState, useRef, useEffect, useCallback } from 'react';
import api from '../../services/api';

function MessageContent({ text }) {
  const parts = String(text || '').split(/```(\w*)\n?([\s\S]*?)```/g);
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

function Avatar({ role }) {
  const isUser = role === 'user';
  return (
    <div style={{
      width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 13, fontWeight: 700,
      background: isUser ? 'var(--accent)' : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
      color: '#fff',
    }}>
      {isUser ? 'U' : '✦'}
    </div>
  );
}

function TypingDots({ label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 2px' }}>
      <div style={{ display: 'flex', gap: 4 }}>
        {[0, 1, 2].map(i => (
          <span key={i} style={{
            width: 6, height: 6, borderRadius: '50%', background: 'var(--text-muted)',
            animation: `ai-chat-bounce 1.2s ease-in-out ${i * 0.15}s infinite`,
            display: 'inline-block',
          }} />
        ))}
      </div>
      {label && (
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{label}</span>
      )}
      <style>{`
        @keyframes ai-chat-bounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-4px); opacity: 1; }
        }
        @keyframes ai-chat-caret-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// How fast the reply "types" itself out once it arrives — tuned to feel
// like a live stream (ChatGPT-style) without dragging out long answers.
const REVEAL_MS_PER_TICK = 14;
const REVEAL_CHARS_PER_TICK = 3;

export default function AIChatTab({ analysisId, projectName }) {
  const [messages, setMessages] = useState([]); // {role, content, at, streaming?}
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);      // waiting on the network request
  const [streamingId, setStreamingId] = useState(null); // index of message currently being revealed
  const [waitLabel, setWaitLabel] = useState('Thinking…');
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);
  const textareaRef = useRef(null);
  const waitTimersRef = useRef([]);
  const revealIntervalRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending]);

  useEffect(() => () => {
    // Clean up any in-flight timers if the tab unmounts mid-response.
    waitTimersRef.current.forEach(clearTimeout);
    clearInterval(revealIntervalRef.current);
  }, []);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  }, []);

  useEffect(() => { autoResize(); }, [input, autoResize]);

  // Reveals `fullText` into the message at `msgIndex` a few characters at a
  // time, breaking only on whole words so it never looks like it's
  // stuttering mid-word — the same effect as ChatGPT's token-by-token print.
  const revealReply = (fullText, msgIndex) => {
    let shown = 0;
    revealIntervalRef.current = setInterval(() => {
      shown = Math.min(fullText.length, shown + REVEAL_CHARS_PER_TICK);
      // Don't cut off mid-word unless we're at the very end.
      let cut = shown;
      if (cut < fullText.length) {
        while (cut > 0 && !/\s/.test(fullText[cut]) && !/\s/.test(fullText[cut - 1])) cut--;
        if (cut === 0) cut = shown;
      }
      const partial = fullText.slice(0, cut);
      setMessages(prev => {
        const copy = [...prev];
        if (copy[msgIndex]) copy[msgIndex] = { ...copy[msgIndex], content: partial };
        return copy;
      });
      if (shown >= fullText.length) {
        clearInterval(revealIntervalRef.current);
        setMessages(prev => {
          const copy = [...prev];
          if (copy[msgIndex]) copy[msgIndex] = { ...copy[msgIndex], content: fullText, streaming: false };
          return copy;
        });
        setStreamingId(null);
      }
    }, REVEAL_MS_PER_TICK);
  };

  const send = async () => {
    const trimmed = input.trim();
    if (!trimmed || sending || streamingId != null) return;

    const nextMessages = [...messages, { role: 'user', content: trimmed, at: new Date() }];
    setMessages(nextMessages);
    setInput('');
    setSending(true);
    setError(null);
    setWaitLabel('Thinking…');

    // Longer waits get an honest, reassuring status update instead of a
    // dead spinner — this doesn't speed up the model call itself (that
    // latency lives on the backend/LLM side), but it fixes the "did it
    // hang?" feeling on slower repos or longer answers.
    waitTimersRef.current.push(
      setTimeout(() => setWaitLabel('Still working — larger repos take a bit longer…'), 7000),
      setTimeout(() => setWaitLabel('Almost there — putting the answer together…'), 20000),
    );

    try {
      const history = nextMessages.slice(0, -1).slice(-12).map(({ role, content }) => ({ role, content }));
      const res = await api.post(`analysis/${analysisId}/chat/`, { message: trimmed, history });
      waitTimersRef.current.forEach(clearTimeout);
      waitTimersRef.current = [];
      setSending(false);

      setMessages(prev => {
        const next = [...prev, { role: 'model', content: '', at: new Date(), streaming: true }];
        const newIndex = next.length - 1;
        setStreamingId(newIndex);
        revealReply(res.data.reply || '', newIndex);
        return next;
      });
    } catch (err) {
      waitTimersRef.current.forEach(clearTimeout);
      waitTimersRef.current = [];
      const msg = err?.response?.data?.error || 'Something went wrong reaching the AI.';
      setError(msg);
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const suggestions = [
    'Summarize the biggest risks in this repo',
    'Explain the top security finding and how to fix it',
    'Write a test for one of the hotspot files',
  ];

  const composerLocked = sending || streamingId != null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 560 }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
        border: '1px solid var(--border)', borderBottom: 'none',
        borderRadius: '10px 10px 0 0', background: 'var(--bg-card)',
      }}>
        <div style={{
          width: 30, height: 30, borderRadius: '50%',
          background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14,
        }}>✦</div>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>Repo Assistant</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            {projectName ? `Scoped to ${projectName}` : 'Ask me anything about this repository'}
          </div>
        </div>
        <div style={{
          marginLeft: 'auto', width: 8, height: 8, borderRadius: '50%',
          background: '#22c55e', boxShadow: '0 0 0 3px rgba(34,197,94,0.15)',
        }} title="Ready" />
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        style={{
          flex: 1, overflowY: 'auto', padding: 16,
          border: '1px solid var(--border)', borderTop: 'none',
          background: 'var(--bg-card)',
        }}
      >
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', marginTop: 30 }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
              Ask about architecture, specific files, the findings above — or ask it to write or fix code.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360, margin: '0 auto' }}>
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => setInput(s)}
                  style={{
                    textAlign: 'left', padding: '9px 12px', borderRadius: 8, fontSize: 12.5,
                    border: '1px solid var(--border)', background: 'var(--bg-card-hover)',
                    color: 'var(--text)', cursor: 'pointer',
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} style={{
            display: 'flex', gap: 10, marginBottom: 16,
            flexDirection: m.role === 'user' ? 'row-reverse' : 'row',
          }}>
            <Avatar role={m.role} />
            <div style={{ maxWidth: '78%', display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{
                padding: '10px 14px', borderRadius: 14, fontSize: 13.5,
                borderTopLeftRadius: m.role === 'user' ? 14 : 4,
                borderTopRightRadius: m.role === 'user' ? 4 : 14,
                background: m.role === 'user' ? 'var(--accent)' : 'var(--bg-card-hover)',
                color: m.role === 'user' ? '#fff' : 'var(--text)',
                border: m.role === 'user' ? 'none' : '1px solid var(--border)',
              }}>
                <MessageContent text={m.content} />
                {m.streaming && (
                  // Blinking caret at the end of the text currently being revealed —
                  // same visual cue ChatGPT uses while a reply is still printing.
                  <span style={{
                    display: 'inline-block', width: 2, height: 14, marginLeft: 1,
                    background: 'var(--text)', verticalAlign: 'text-bottom',
                    animation: 'ai-chat-caret-blink 0.9s step-start infinite',
                  }} />
                )}
              </div>
              <span style={{ fontSize: 10.5, color: 'var(--text-faint, #8b93a1)', marginTop: 4, padding: '0 4px' }}>
                {formatTime(m.at)}
              </span>
            </div>
          </div>
        ))}

        {sending && (
          <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
            <Avatar role="model" />
            <div style={{
              padding: '10px 14px', borderRadius: 14, borderTopLeftRadius: 4,
              background: 'var(--bg-card-hover)', border: '1px solid var(--border)',
            }}>
              <TypingDots label={waitLabel} />
            </div>
          </div>
        )}

        {error && (
          <div style={{
            color: '#ef4444', fontSize: 12.5, marginTop: 4, padding: '8px 12px',
            background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8,
          }}>
            {error}
          </div>
        )}
      </div>

      {/* Composer */}
      <div style={{
        display: 'flex', gap: 8, alignItems: 'flex-end', padding: 10,
        border: '1px solid var(--border)', borderTop: 'none',
        borderRadius: '0 0 10px 10px', background: 'var(--bg-card)',
      }}>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about this repo, or ask for code…"
          rows={1}
          disabled={composerLocked}
          style={{
            flex: 1, resize: 'none', padding: '10px 12px', borderRadius: 10,
            border: '1px solid var(--border)', background: 'var(--bg-input)',
            color: 'var(--text)', fontSize: 13.5, fontFamily: 'inherit', maxHeight: 140, overflowY: 'auto',
          }}
        />
        <button
          onClick={send}
          disabled={composerLocked || !input.trim()}
          style={{
            width: 40, height: 40, borderRadius: 10, border: 'none', flexShrink: 0,
            background: 'var(--accent)', color: '#fff', fontSize: 16,
            cursor: composerLocked || !input.trim() ? 'default' : 'pointer',
            opacity: composerLocked || !input.trim() ? 0.5 : 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          title="Send"
        >
          ➤
        </button>
      </div>
    </div>
  );
}