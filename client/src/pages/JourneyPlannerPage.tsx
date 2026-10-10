import { PlannerPanel } from "../components/PlannerPanel";
import type { PlannerPanelProps } from "../components/PlannerPanel";

export function JourneyPlannerPage(props: PlannerPanelProps) {
  return (
    <section>
      <div className="page-heading">
        <span className="eyebrow">Make a plan</span>
        <h1>Where are you heading?</h1>
        <p>Type a start and end point. Every step of the result is yours to edit.</p>
      </div>
      <PlannerPanel {...props} />
    </section>
  );
}
