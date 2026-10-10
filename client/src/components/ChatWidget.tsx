import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatWidgetProps {
  visible: boolean;
  /** Return the assistant reply; history contains only completed exchanges. */
  onSend?: (message: string, history: readonly ChatMessage[]) => Promise<string>;
}

export function ChatWidget({ visible, onSend }: ChatWidgetProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewport, setViewport] = useState({ height: window.innerHeight, keyboardOffset: 0 });
  const launcherRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const requestInFlight = useRef(false);

  useEffect(() => {
    if (!visible) setOpen(false);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const visualViewport = window.visualViewport;
    const updateViewport = () => {
      const height = visualViewport?.height ?? window.innerHeight;
      const offsetTop = visualViewport?.offsetTop ?? 0;
      setViewport({
        height,
        keyboardOffset: Math.max(0, window.innerHeight - height - offsetTop),
      });
    };
    updateViewport();
    window.addEventListener("resize", updateViewport);
    visualViewport?.addEventListener("resize", updateViewport);
    visualViewport?.addEventListener("scroll", updateViewport);
    return () => {
      window.removeEventListener("resize", updateViewport);
      visualViewport?.removeEventListener("resize", updateViewport);
      visualViewport?.removeEventListener("scroll", updateViewport);
    };
  }, [visible]);

  useEffect(() => {
    if (!visible || !open) return;
    inputRef.current?.focus({ preventScroll: true });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      launcherRef.current?.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [visible, open]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages, pendingMessage, error, open]);

  function closeChat() {
    setOpen(false);
    launcherRef.current?.focus({ preventScroll: true });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft.trim();
    if (!onSend || !message || requestInFlight.current) return;
    requestInFlight.current = true;
    setError(null);
    setPendingMessage(message);
    try {
      const reply = await onSend(message, messages.map((item) => ({ ...item })));
      if (!reply.trim()) throw new Error("Empty reply");
      setMessages((previous) => [
        ...previous,
        { role: "user", content: message },
        { role: "assistant", content: reply },
      ]);
      setDraft("");
    } catch {
      setError("Couldn't send your message. Please try again.");
    } finally {
      requestInFlight.current = false;
      setPendingMessage(null);
    }
  }

  if (!visible) return null;

  const viewportStyle = {
    "--chat-viewport-height": `${viewport.height}px`,
    "--chat-keyboard-offset": `${viewport.keyboardOffset}px`,
  } as CSSProperties;

  return (
    <div className="chat-widget" style={viewportStyle}>
      {open && (
        <section
          id="eirgo-chat"
          className="chat-widget-panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby="eirgo-chat-title"
        >
          <header className="chat-widget-header">
            <h2 id="eirgo-chat-title">ÉirGo chat</h2>
            <button type="button" className="chat-widget-close" aria-label="Close chat" onClick={closeChat}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </header>
          <div ref={logRef} className="chat-widget-log" role="log" aria-label="Chat conversation" aria-live="polite">
            {messages.length === 0 && !pendingMessage && (
              <p className="chat-widget-empty">
                {onSend ? "Ask a question about your journey." : "Chat is not connected yet"}
              </p>
            )}
            {messages.map((message, index) => (
              <div key={index} className={`chat-widget-message ${message.role}`}>
                <span className="chat-widget-speaker">{message.role === "user" ? "You" : "ÉirGo"}</span>
                <p>{message.content}</p>
              </div>
            ))}
            {pendingMessage !== null && (
              <>
                <div className="chat-widget-message user">
                  <span className="chat-widget-speaker">You</span>
                  <p>{pendingMessage}</p>
                </div>
                <p className="chat-widget-pending" role="status">Waiting for a reply…</p>
              </>
            )}
            {error && <p className="chat-widget-error" role="alert">{error}</p>}
          </div>
          <form className="chat-widget-form" onSubmit={handleSubmit}>
            <label htmlFor="eirgo-chat-message">Message</label>
            <div className="chat-widget-input-row">
              <input
                ref={inputRef}
                id="eirgo-chat-message"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Ask about your journey…"
                autoComplete="off"
                disabled={pendingMessage !== null}
                aria-describedby={!onSend ? "eirgo-chat-connection" : undefined}
              />
              <button type="submit" className="btn-primary" disabled={!onSend || !draft.trim() || pendingMessage !== null}>
                Send
              </button>
            </div>
            {!onSend && <p id="eirgo-chat-connection" className="chat-widget-connection">Sending will be available when chat is connected.</p>}
          </form>
        </section>
      )}
      <button
        ref={launcherRef}
        type="button"
        className="chat-widget-launcher"
        aria-label={open ? "Close chat" : "Open chat"}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? "eirgo-chat" : undefined}
        onClick={() => open ? closeChat() : setOpen(true)}
      >
        <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
          <path d="M20 11.5a8 8 0 0 1-8 8 9 9 0 0 1-3.5-.7L4 20l1.2-4.5a9 9 0 0 1-.7-3.5 8 8 0 0 1 8-8H13a7 7 0 0 1 7 7z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M8 10h8M8 14h5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
