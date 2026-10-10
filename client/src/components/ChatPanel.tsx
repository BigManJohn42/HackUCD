import { useState } from "react";
import type { ChatMessage } from "../types";

export function ChatPanel({
  messages,
  onSend,
}: {
  messages: ChatMessage[];
  onSend: (message: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    setSending(true);
    try {
      await onSend(text);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="card chat-panel">
      <h2 style={{ marginTop: 0, marginBottom: 4 }}>Ask ÉirGo</h2>
      <p className="leg-meta" style={{ marginTop: 0 }}>
        AI-generated - can be wrong, and live disruption alerts are city-wide, not matched to
        your exact route yet. Always check a departures board before you rely on a time.
      </p>
      <div className="chat-log">
        {messages.length === 0 && (
          <p style={{ color: "var(--color-text-muted)" }}>
            Try: &quot;What if I miss my connection at Dundrum?&quot;
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-message ${m.role}`}>
            {m.content}
          </div>
        ))}
        {sending && <div className="chat-message assistant">Thinking...</div>}
      </div>
      <form className="chat-input-row" onSubmit={handleSubmit}>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask about your journey..."
          aria-label="Message the commute concierge"
        />
        <button type="submit" className="btn-primary" disabled={sending}>
          Send
        </button>
      </form>
    </div>
  );
}
