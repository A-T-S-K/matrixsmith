import type { JSX } from "preact";
import { useState } from "preact/hooks";
import type { AppSnapshot, PresentationStore } from "../../presentation/store";
import { StatusBadge } from "../components/StatusBadge";
import {
  CandidateSection,
  ToolSection,
} from "../features/develop/CandidateTools";
import { GattSection } from "../features/develop/GattSection";
import { TransactionSection } from "../features/develop/TransactionSection";
import {
  RawSection,
  EvidenceSection,
} from "../features/develop/EvidenceSections";
import { OrchestrationSection } from "../features/develop/OrchestrationSection";

export function DevelopView({
  snapshot,
  store,
}: {
  readonly snapshot: AppSnapshot;
  readonly store: PresentationStore;
}): JSX.Element {
  const [section, setSection] = useState("transactions");
  return (
    <section class="view develop-view">
      <div class="view-heading">
        <div>
          <p class="eyebrow">PROTOCOL WORKBENCH</p>
          <h1>Develop</h1>
          <p>
            Decoded activity first, exact bytes always available underneath.
          </p>
        </div>
        <div class="safety-copy">
          <StatusBadge tone="good">Safety policy active</StatusBadge>
          <span>
            Verified controls are available. Experimental, persistent,
            destructive, firmware, and arbitrary operations remain restricted.
          </span>
        </div>
      </div>
      <nav class="subnav" aria-label="Develop sections">
        {[
          ["candidates", "Protocol candidates"],
          ["tools", "Family probes & tests"],
          ["gatt", "GATT explorer"],
          ["transactions", "Transactions"],
          ["raw", "Raw events"],
          ["evidence", "Evidence / observations"],
          ["orchestration", "Guided orchestration"],
        ].map(([id, label]) => (
          <button
            key={id}
            class={section === id ? "active" : ""}
            onClick={() => setSection(id!)}
          >
            {label}
          </button>
        ))}
      </nav>
      {section === "candidates" && (
        <CandidateSection snapshot={snapshot} store={store} />
      )}{" "}
      {section === "tools" && <ToolSection snapshot={snapshot} store={store} />}{" "}
      {section === "gatt" && <GattSection snapshot={snapshot} store={store} />}{" "}
      {section === "transactions" && (
        <TransactionSection snapshot={snapshot} store={store} />
      )}{" "}
      {section === "raw" && <RawSection snapshot={snapshot} store={store} />}{" "}
      {section === "evidence" && (
        <EvidenceSection snapshot={snapshot} store={store} />
      )}{" "}
      {section === "orchestration" && (
        <OrchestrationSection snapshot={snapshot} />
      )}
    </section>
  );
}
