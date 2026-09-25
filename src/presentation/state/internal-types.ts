import { Framebuffer } from "./dependencies";
import type {
  TransmissionPlan,
  GuidedTestAbout,
  GuidedTestTimer,
  ObservationFieldSpec,
  ObservationValue,
  ObservationAttempt,
  PhysicalTimingMark,
  TransferReason,
} from "./dependencies";
import type {
  DiagnosticRegionView,
  GuidedFlowState,
  ObservationPresentation,
  PendingSend,
} from "./types";
import type { GuidedTestState } from "../../application/machines/guided-test-machine";
export type PendingSendCommand = {
  view: PendingSend;
  plan: TransmissionPlan;
  extras?: Record<string, string>;
};
export interface GuidedFlowInternal {
  testId: string;
  title: string;
  machine: GuidedTestState;
  about: GuidedTestAbout;
  consequence: string;
  category: string;
  risk: string;
  planSummary: GuidedFlowState["planSummary"];
  previews: readonly Framebuffer[];
  regions: readonly DiagnosticRegionView[];
  observationSpecs: readonly ObservationFieldSpec[];
  values: Record<string, ObservationValue>;
  timerSpec: GuidedTestTimer | null;
  startedAt: string;
  transactionIds: readonly string[];
  presentation: ObservationPresentation;
  stepIndex: number;
  parameters: Record<string, number>;
  attempts: readonly ObservationAttempt[];
  marks: readonly PhysicalTimingMark[];
  experimentRunId: string;
  pendingTransferReason: TransferReason;
}
