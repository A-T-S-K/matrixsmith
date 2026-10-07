import type { DeviceProfile } from "../../core/device";
import type { ClaimId } from "../../investigation/claims";
import {
  booleanAnswer,
  choiceAnswer,
  measuredDurationAnswer,
  type GuidedTestDefinition,
  type ClaimUpdate,
} from "../../investigation/tests";
import {
  MINIMUM_STATIC_HOLD_MS,
  VISIBLE_STATIC_HOLD_METRIC,
} from "../../investigation/static-viability";
import { stillGeometryReason } from "./diagnostics";

export const STILL_TEST_IDS = [
  "coolledux-still-bootstrap",
  "coolledux-still-channels",
  "coolledux-still-encoder",
] as const;
const bootstrapClaims: readonly ClaimId[] = [
  "stored-program.upload",
  "animation.frames",
  "animation.tile-sync",
  "raster.tiling",
  "raster.orientation",
  "animation.static-single-frame",
];
const channelClaims: readonly ClaimId[] = [
  "animation.black-semantics",
  "pixel.channel-map",
];
const consequence =
  "This replaces stored display content with a fixed experimental image. The physical result is unknown. Existing content cannot be read back; MatrixSmith cannot promise restoration.";
const common = {
  driverId: "coolledux",
  category: "core",
  requiresCompletedTests: [],
  risk: "persistent",
  persistence: "persistent",
  consequence,
  showRegionDiagram: true,
  about: {
    question: "Can this display show one usable still image?",
    whyRelevant:
      "Family identification and geometry do not demonstrate rendering.",
    whatMatrixSmithDoes:
      "Sends one fixed, tiled Animation frame using the registered 16-row codec.",
    whatChangesOnDevice: consequence,
    estimatedObservationTime: "About 20 seconds.",
    possibleOutcomes: [
      {
        outcome: "Matches the intended pattern",
        learns:
          "Only the properties physically observed on this target are established.",
      },
      {
        outcome: "Wrong, interrupted, or unsure",
        learns:
          "Keep partial evidence and explicitly retry or use Protocol workbench.",
      },
    ],
    observeInstructions:
      "Compare the physical display with the intended preview. Each eight-column tile has a white vertical marker increasing in height from left to right. Check every tile, seams, top dots and left axis; do not infer the result from the preview.",
    technicalDetails: [
      "One frame, Animation command 0x03 0x01, 1000 ms frame delay, eight-column tiles, full 16-row stride. No Graffiti verdict is needed.",
    ],
  },
} as const;
const positive = (claims: readonly ClaimId[], summary: string): ClaimUpdate[] =>
  claims.map((claimId) => ({ claimId, status: "verified", summary }));
function requirements(claims: readonly ClaimId[]) {
  return claims.map((claimId) => ({ claimId, anyOf: ["verified"] as const }));
}

export function stillTests(
  profile: DeviceProfile,
): readonly GuidedTestDefinition[] {
  if (profile.driverId !== "coolledux" || stillGeometryReason(profile))
    return [];
  const tiles = profile.width / 8;
  const spatial = [
    {
      kind: "boolean",
      id: "coverage",
      regionId: "tile-1",
      prompt: `Are all ${tiles} eight-column tiles present, with distinct increasing-height white markers and no repeated or missing sections?`,
    },
    {
      kind: "boolean",
      id: "layout",
      regionId: "corner-top-left",
      prompt:
        "Do the top dots, left axis and corner positions match the preview, with no mirrored/rotated image or steps/gaps at joins?",
    },
  ] as const;
  const bootstrap: GuidedTestDefinition = {
    ...common,
    id: STILL_TEST_IDS[0],
    title: "Verify a still image",
    targetClaims: bootstrapClaims,
    prerequisites: [],
    operation: { type: "ShowDiagnostic", diagnosticId: "still-bootstrap" },
    observation: [
      {
        kind: "boolean",
        id: "initial",
        prompt: "Did the complete intended image appear?",
      },
      ...spatial,
      {
        kind: "duration",
        id: "visible",
        prompt: "Image visible (measured)",
        required: false,
      },
      {
        kind: "boolean",
        id: "moved",
        prompt: "Did anything move?",
        required: false,
      },
      {
        kind: "duration",
        id: "end",
        prompt: "Observation ended (measured)",
        required: false,
      },
    ],
    timer: {
      phases: [
        {
          id: "visible",
          prompt: "Tap when the complete image is physically visible.",
          fieldId: "visible",
          eventLabel: "Full image is visible now",
          eventSets: [{ fieldId: "initial", value: "yes" }],
          failLabel: "Wrong or incomplete image",
          failSets: [{ fieldId: "initial", value: "no" }],
        },
        {
          id: "hold",
          prompt:
            "Watch for movement; interruption or a short observation cannot establish hold.",
          fieldId: "end",
          eventLabel: "Movement started",
          eventSets: [{ fieldId: "moved", value: "yes" }],
          stillLabel: "Still completely static — stop watching",
          stillDurationFieldId: "end",
          stillSets: [{ fieldId: "moved", value: "no" }],
          minStillSeconds: MINIMUM_STATIC_HOLD_MS / 1000,
        },
      ],
    },
    validate(values) {
      const start = measuredDurationAnswer(values, "visible"),
        end = measuredDurationAnswer(values, "end");
      return start !== null && end !== null && end < start
        ? ["Observation cannot end before the image was visible."]
        : [];
    },
    interpret(values) {
      const initial = booleanAnswer(values, "initial"),
        coverage = booleanAnswer(values, "coverage"),
        layout = booleanAnswer(values, "layout"),
        moved = booleanAnswer(values, "moved");
      const start = measuredDurationAnswer(values, "visible"),
        end = measuredDurationAnswer(values, "end");
      const held = start !== null && end !== null ? end - start : null;
      const rendering =
        initial === "yes" && coverage === "yes" && layout === "yes";
      const updates = rendering
        ? positive(
            bootstrapClaims.filter(
              (id) => id !== "animation.static-single-frame",
            ),
            "The complete asymmetric single-frame diagnostic was physically observed with all codec tiles and correct orientation.",
          )
        : [];
      const passed =
        rendering &&
        moved === "no" &&
        held !== null &&
        held >= MINIMUM_STATIC_HOLD_MS;
      if (passed)
        updates.push({
          claimId: "animation.static-single-frame",
          status: "verified",
          summary:
            "The complete image held still for the measured observation window.",
          metrics: { [VISIBLE_STATIC_HOLD_METRIC]: held! },
        });
      if (initial === "no")
        updates.push({
          claimId: "animation.frames",
          status: "unresolved",
          summary:
            "The intended single-frame diagnostic did not render completely; container rendering needs re-verification.",
        });
      if (coverage === "no")
        updates.push({
          claimId: "animation.tile-sync",
          status: "unresolved",
          summary:
            "Missing or repeated codec tiles contradict full-canvas placement.",
        });
      if (layout === "no")
        updates.push(
          {
            claimId: "pixel.encoder-correctness",
            status: "unresolved",
            summary:
              "The logical diagnostic had incorrect spatial placement or orientation; encoder/geometry agreement needs re-verification.",
          },
          {
            claimId: "raster.orientation",
            status: "unresolved",
            summary:
              "Diagnostic axes/corners or seams did not match intended placement.",
          },
        );
      if (moved === "yes")
        updates.push({
          claimId: "animation.static-single-frame",
          status: "rejected",
          summary: "The one-frame image moved during physical observation.",
        });
      return {
        status: passed ? "passed" : "inconclusive",
        resolution:
          passed ||
          moved === "yes" ||
          initial === "no" ||
          coverage === "no" ||
          layout === "no"
            ? "settled"
            : "retryable-incomplete",
        established: passed
          ? ["Rendering, coverage, orientation and measured hold observed."]
          : [],
        rejected: moved === "yes" ? ["The tested static route moved."] : [],
        unknowns: passed
          ? []
          : [
              "Stop here. A complete, correctly placed image and at least 15 seconds of measured visible hold are required.",
            ],
        summary: passed
          ? "Bootstrap rendering observed; colors and encoder still need verification."
          : "Partial or inconclusive still-image observation; no usable route yet.",
        claimUpdates: updates,
      };
    },
  };
  const channels: GuidedTestDefinition = {
    ...common,
    id: STILL_TEST_IDS[1],
    title: "Check raw channels and black",
    targetClaims: channelClaims,
    prerequisites: requirements(bootstrapClaims),
    operation: { type: "ShowDiagnostic", diagnosticId: "still-raw-channels" },
    observation: [
      ...["red", "green", "blue"].map((_, index) => ({
        kind: "choice" as const,
        id: `color-${index}`,
        regionId: `raw-${index}`,
        prompt: `What color is patch ${index + 1} (${["left", "middle", "right"][index]})?`,
        options: ["red", "green", "blue", "other", "unsure"].map((id) => ({
          id,
          label: id,
        })),
      })),
      {
        kind: "boolean",
        id: "black",
        prompt: "Is the surrounding background genuinely off / black?",
      },
    ],
    interpret(values) {
      const colors = ["red", "green", "blue"].map((_, index) =>
        choiceAnswer(values, `color-${index}`),
      );
      const map = colors.every(
        (color, index) => color === ["red", "green", "blue"][index],
      );
      const blackAnswer = booleanAnswer(values, "black");
      const black = blackAnswer === "yes";
      const mismatch =
        colors.every((color) => color !== null && color !== "unsure") && !map;
      const updates = [
        ...(map
          ? positive(
              ["pixel.channel-map"],
              "Raw patches 1/2/3 physically appeared red/green/blue. This does not test the logical encoder.",
            )
          : []),
        ...(black
          ? positive(
              ["animation.black-semantics"],
              "Literal Animation 0x0000 background physically appeared off / black.",
            )
          : []),
      ];
      if (mismatch)
        updates.push({
          claimId: "pixel.channel-map",
          status: "unresolved",
          summary:
            "Raw color patches contradicted the reviewed RGB444 channel mapping; no automatic correction is applied.",
        });
      if (blackAnswer === "no")
        updates.push({
          claimId: "animation.black-semantics",
          status: "unresolved",
          summary:
            "The literal zero background was not off / black on this path.",
        });
      return {
        status: map && black ? "passed" : "inconclusive",
        resolution:
          (map && black) || mismatch || blackAnswer === "no"
            ? "settled"
            : "retryable-incomplete",
        established: map ? ["Raw channel mapping observed."] : [],
        rejected: [],
        unknowns:
          map && black
            ? []
            : [
                "Stop here; raw colors or Animation black remain unverified. Explicitly retry or inspect the report.",
              ],
        summary:
          map && black
            ? "Raw channels and path black observed; logical encoding remains unverified."
            : "Partial raw-channel/black observation.",
        claimUpdates: updates,
      };
    },
  };
  const encoder: GuidedTestDefinition = {
    ...common,
    id: STILL_TEST_IDS[2],
    title: "Verify the logical image encoder",
    targetClaims: ["pixel.encoder-correctness"],
    prerequisites: requirements([...bootstrapClaims, ...channelClaims]),
    operation: { type: "ShowDiagnostic", diagnosticId: "still-encoder" },
    observation: [
      ...spatial,
      {
        kind: "boolean",
        id: "colors",
        prompt:
          "Do the logical colors match: red top-left, green top-right, blue bottom-left, yellow bottom-right, white increasing-height markers and black background? Choose unsure if any color is unclear.",
      },
    ],
    interpret(values) {
      const passed = ["coverage", "layout", "colors"].every(
        (id) => booleanAnswer(values, id) === "yes",
      );
      const contradicted = ["coverage", "layout", "colors"].some(
        (id) => booleanAnswer(values, id) === "no",
      );
      return {
        status: passed ? "passed" : "inconclusive",
        resolution: passed || contradicted ? "settled" : "retryable-incomplete",
        established: passed
          ? [
              "The fixed logical RGB image matched spatial and color expectations on the tested route.",
            ]
          : [],
        rejected: [],
        unknowns: passed
          ? []
          : [
              "Stop here; the logical encoder remains unverified. Explicitly retry or use Protocol workbench.",
            ],
        summary: passed
          ? "Static route verified for this session. Text and images are available experimentally."
          : "Partial logical-encoder observation; Create remains gated.",
        claimUpdates: passed
          ? positive(
              ["pixel.encoder-correctness"],
              "Fixed logical-frame compiler image physically matched coverage, orientation, seams and labeled RGB/color expectations.",
            )
          : contradicted
            ? [
                {
                  claimId: "pixel.encoder-correctness",
                  status: "unresolved",
                  summary:
                    "The logical verification image contradicted spatial or color expectations; ordinary content remains gated.",
                },
              ]
            : [],
      };
    },
  };
  return [bootstrap, channels, encoder];
}
