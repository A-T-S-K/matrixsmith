import type { ApplicationRuntime } from "./runtime";
import { definitionDigest } from "../core/transmission";
import { parseDiagnosticBundle } from "../diagnostics/bundle";
import { evaluateStaticViability } from "../investigation/static-viability";
import { validateObservations } from "../investigation/observations";
const STILL_TEST_IDS = [
  "coolledux-still-bootstrap",
  "coolledux-still-channels",
  "coolledux-still-encoder",
] as const;
import {
  parseProfileDocument,
  type ProfileDocumentV2,
} from "../profiles/document";

/** Private review binding. Never serialized into a reusable document. */
function candidateContextInputs(runtime: ApplicationRuntime) {
  const { session, transport } = runtime;
  return {
    connection: transport.connectionId,
    state: transport.state,
    fingerprint: session.fingerprint,
    profile: session.profile,
    geometryRevision: session.geometryRevision,
    source: session.source,
    definition: runtime.registry.definitionIdentity(
      "coolledux",
      session.profile,
    ),
    resolution: session.protocolResolution,
    evidence: runtime.investigation?.claimEvidence,
    attempts: runtime.experiments,
    transfers: runtime.transfers,
  };
}
export function candidateContext(runtime: ApplicationRuntime): string {
  return definitionDigest(candidateContextInputs(runtime));
}
/** Private display comparison; still inspects nested content on every publication.
 * Export and revision retain the authoritative fresh digest check. */
export function candidateReviewBinding(runtime: ApplicationRuntime): string {
  return JSON.stringify(candidateContextInputs(runtime));
}

export interface CandidateArtifact {
  readonly document: ProfileDocumentV2;
  readonly evidence: string;
  readonly context: string;
  /** Private review text; never serialized with the reusable document. */
  readonly observedMatchingName: string;
}

/** Application-owned configuration proposal; no claims or permission are installed. */
export function buildCandidateProfile(
  runtime: ApplicationRuntime,
): CandidateArtifact {
  const context = candidateContext(runtime);
  const { session } = runtime;
  const profile = session.profile;
  const driver = session.selection?.selected;
  if (
    session.source !== "live" ||
    runtime.transport.state !== "connected" ||
    driver?.id !== "coolledux" ||
    driver.contentCodecId !== "coolledux-reviewed-v1" ||
    session.protocolResolution?.source !== "live-probe" ||
    session.protocolResolution.driverId !== driver.id ||
    !profile ||
    profile.height !== 16 ||
    profile.width < 16 ||
    profile.width > 64 ||
    profile.width % 8
  )
    throw new Error(
      "Candidate generation requires current CoolLEDUX identification, registered codec and explicit 16-row geometry (width 16–64 in eight-column tiles).",
    );
  const name = session.fingerprint?.name?.trim().toLowerCase();
  if (!name)
    throw new Error(
      "No Bluetooth matching name is accessible. Establish a matching condition before creating a reusable candidate.",
    );
  const definitionIdentity = runtime.registry.definitionIdentity(
    driver.id,
    profile,
  );
  const pool = runtime.allClaimEvidence().filter((entry) => {
    const details = entry.details;
    const attempt = runtime.experiments
      .flatMap((run) => run.attempts)
      .find((item) => item.attemptId === details?.attemptId);
    const transfer = runtime.transfers.find(
      (item) => item.attemptId === attempt?.attemptId,
    );
    if (!attempt || !STILL_TEST_IDS.some((id) => id === entry.testId))
      return false;
    const test = runtime.guidedTest(entry.testId!);
    // Retained claims alone cannot describe a completed local verification if
    // their underlying observations or measured timeline have since changed.
    if (
      validateObservations(test.observation, attempt.observations).length ||
      test.validate?.(attempt.observations).length ||
      (test.timer &&
        attempt.observations
          .filter((value) => value.kind === "duration")
          .some(
            (value) =>
              !attempt.timing?.values.some(
                (recorded) =>
                  JSON.stringify(recorded) === JSON.stringify(value),
              ),
          ))
    )
      return false;
    const update = test
      .interpret(attempt.observations)
      .claimUpdates.find((item) => item.claimId === entry.claimId);
    return (
      update?.status === entry.status &&
      JSON.stringify(update.metrics ?? null) ===
        JSON.stringify(entry.metrics ?? null) &&
      entry.scope === "current-session" &&
      STILL_TEST_IDS.some((id) => id === entry.testId) &&
      details?.profileId === profile.id &&
      details.width === profile.width &&
      details.height === profile.height &&
      details.definitionIdentity === definitionIdentity &&
      attempt?.validity === "valid" &&
      (entry.testId !== "coolledux-still-bootstrap" ||
        (attempt.timing?.validity === "valid" &&
          attempt.timing.t0 === transfer?.finalWriteAcceptedAt)) &&
      transfer &&
      !transfer.failureReason &&
      transfer.finalWriteAcceptedAt !== null &&
      transfer.fingerprint.testId === entry.testId &&
      transfer.fingerprint.profileId === profile.id &&
      transfer.finalWriteAcceptedAt === details.finalWriteAcceptedAt &&
      transfer.fingerprint.physicalDeviceKey ===
        (session.fingerprint?.browserDeviceId ?? null) &&
      entry.transactionIds?.length &&
      transfer.transactionIds.every((id) => entry.transactionIds!.includes(id))
    );
  });
  const verified =
    evaluateStaticViability(pool).selected === "animation-single-frame" &&
    runtime.staticViability().selected === "animation-single-frame";
  const evidence = runtime.exportBundle("shareable");
  const companyHex = session.fingerprint?.manufacturerDataHex;
  const companyId =
    companyHex && /^[0-9a-f]{4}/i.test(companyHex)
      ? parseInt(companyHex.slice(0, 2), 16) +
        256 * parseInt(companyHex.slice(2, 4), 16)
      : null;
  const document = parseProfileDocument(
    JSON.stringify({
      documentVersion: 2,
      namespace: "local-candidate",
      id: "still-display",
      revision: "1",
      implementation: "coolledux-reviewed-v1",
      label: "Candidate still display",
      matching: {
        name,
        serviceUuid: "0000fff0-0000-1000-8000-00805f9b34fb",
        characteristicUuid: "0000fff1-0000-1000-8000-00805f9b34fb",
        requiredProperties: ["read", "notify", "writeWithoutResponse"],
      },
      contradictions: { companyId, geometry: true },
      dimensions: { width: profile.width, height: profile.height },
      parameters: { brightness: { min: 0, max: 255 } },
      templates: ["coolledux-source-v1"],
      limitations: [
        "Candidate configuration only; no built-in support or execution approval.",
        "Observation scope: one current target and this geometry; no model or physical-unit equivalence established.",
        "Reload is session-only. Identify family live and repeat bootstrap, raw channels, then encoder verification. Experimental permission and exact persistent-send confirmation remain required.",
        "Manufacturer, firmware, model and chip identity remain unknown. An observed company field is only a contradiction condition.",
        "Matching name may be personalized or identifying; review it before sharing.",
      ],
      sources: [
        "coolledux-reviewed-v1 registered implementation",
        "Separate privacy-projected Diagnostic Bundle V3 attachment, identified by content digest.",
      ],
      candidate: {
        kind: "revalidation-required",
        assumptions: {
          pixelFormat: "RGB444",
          rowStride: 16,
          tileWidth: 8,
          channelMap: ["r", "g", "b"],
        },
        identity: {
          manufacturer: null,
          firmware: null,
          model: null,
          chip: null,
        },
        ...(verified ? { recommendation: "animation-single-frame" } : {}),
        history: {
          status: verified ? "locally-verified" : "incomplete",
          createdAt: new Date().toISOString(),
          definitionIdentity,
          evidenceDigest: definitionDigest(parseDiagnosticBundle(evidence)),
          testIds: STILL_TEST_IDS.filter((id) =>
            pool.some((entry) => entry.testId === id),
          ),
        },
      },
    }),
  ) as ProfileDocumentV2;
  if (context !== candidateContext(runtime))
    throw new Error(
      "Display context changed during candidate generation. Create it again.",
    );
  return { document, evidence, context, observedMatchingName: name };
}

/** Inspect an optional attachment without installing its historical claims. */
export function inspectCandidateEvidence(
  document: ProfileDocumentV2,
  text: string,
): string {
  const bundle = parseDiagnosticBundle(text);
  if (definitionDigest(bundle) !== document.candidate.history.evidenceDigest)
    throw new Error(
      "Evidence attachment conflicts with the candidate reference. It has not been adopted.",
    );
  const geometry =
    bundle.provisionalProfile ?? bundle.fingerprint.manuallyConfirmedGeometry;
  if (
    geometry &&
    (geometry.width !== document.dimensions.width ||
      geometry.height !== document.dimensions.height)
  )
    throw new Error(
      "Evidence attachment geometry conflicts with the candidate.",
    );
  if (
    bundle.investigation?.claimEvidence.some(
      (entry) =>
        entry.testId?.startsWith("coolledux-still-") &&
        (entry.details?.definitionIdentity !==
          document.candidate.history.definitionIdentity ||
          entry.details.width !== document.dimensions.width ||
          entry.details.height !== document.dimensions.height),
    )
  )
    throw new Error(
      "Evidence attachment contains conflicting definition or geometry references. It has not been adopted.",
    );
  return "Referenced V3 evidence attachment inspected. Historical observations grant no current permission; revalidation is required.";
}
