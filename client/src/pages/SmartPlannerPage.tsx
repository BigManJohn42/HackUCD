import { ChatPanel } from "../components/ChatPanel";
import { PlannerPanel } from "../components/PlannerPanel";
import type { PlannerPanelProps } from "../components/PlannerPanel";
import type { ChatMessage } from "../types";

export function SmartPlannerPage({
  messages,
  onSend,
  ...plannerProps
}: PlannerPanelProps & { messages: ChatMessage[]; onSend: (message: string) => Promise<void> }) {
  return (
    <section>
      <div className="page-heading">
        <span className="eyebrow">A helping hand</span>
        <h1>Let's find your way.</h1>
        <p>
          Tell the concierge about your journey, or search below - both use the same live
          Dublin transport data.
        </p>
      </div>
      <ChatPanel messages={messages} onSend={onSend} />
      <PlannerPanel {...plannerProps} />
    </section>
  );
}
