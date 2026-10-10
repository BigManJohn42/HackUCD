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
      <h2 style={{ marginTop: 0 }}>Ask ÉirGo</h2>
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
