import type { CandidateContext, DiscoveryMetadata } from "../../drivers/types";
import type { DriverRegistry } from "../../drivers/registry";

export interface DiscoveryStep {
  readonly id: string;
  readonly driverId: string;
  readonly probeId: string;
  readonly definitionIdentity: string;
  readonly metadata: DiscoveryMetadata;
  readonly relevance: number;
  readonly blocked: "review" | "permission" | null;
}

/** Knowledge, imports and caller supplied recipes never enter this catalog. */
export function discoveryCatalog(
  registry: DriverRegistry,
  context: CandidateContext,
): readonly DiscoveryStep[] {
  return registry.drivers
    .flatMap((driver) => {
      const match = driver.match(context.fingerprint);
      if (match.score <= 0) return [];
      return (driver.familyProbes?.(context) ?? []).flatMap((probe) => {
        const metadata = probe.discovery;
        if (!metadata || metadata.parameters !== "fixed") return [];
        if (
          ![
            metadata.cost.packets,
            metadata.cost.bytes,
            metadata.cost.elapsedMs,
          ].every((value) => Number.isSafeInteger(value) && value > 0)
        )
          return [];
        const tools =
          driver
            .diagnosticTools?.()
            .filter(
              (tool) =>
                tool.workflow === "family-identification" &&
                tool.probeId === probe.id,
            ) ?? [];
        return [
          {
            id: `${driver.id}/${probe.id}`,
            driverId: driver.id,
            probeId: probe.id,
            definitionIdentity: registry.definitionIdentity(
              driver.id,
              driver.resolveProfile(context.fingerprint),
            ),
            metadata,
            relevance: match.score,
            blocked:
              !metadata.available || tools.some((tool) => !tool.available)
                ? ("permission" as const)
                : probe.safety.hazard !== "routine" ||
                    probe.safety.assurance !== "verified" ||
                    probe.safety.persistence !== "none"
                  ? ("review" as const)
                  : null,
          },
        ];
      });
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Ordinal utility, never a probability. Ties use stable registered identities. */
export function nextDiscoveryStep(
  steps: readonly DiscoveryStep[],
  exhausted: ReadonlySet<string>,
  candidates: ReadonlySet<string>,
  completed: ReadonlySet<string> = exhausted,
): DiscoveryStep | null {
  const eligible = steps.filter(
    (step) =>
      !step.blocked &&
      !exhausted.has(step.id) &&
      step.metadata.prerequisites.every((id) => completed.has(id)) &&
      step.metadata.distinguishes.some((id) => candidates.has(id)),
  );
  const discrimination = (step: DiscoveryStep) =>
    step.metadata.distinguishes.filter((id) => candidates.has(id)).length;
  const prerequisiteValue = (step: DiscoveryStep) =>
    steps.filter(
      (other) =>
        !exhausted.has(other.id) &&
        other.metadata.prerequisites.includes(step.id),
    ).length;
  return (
    eligible.sort(
      (a, b) =>
        discrimination(b) - discrimination(a) ||
        b.relevance - a.relevance ||
        prerequisiteValue(b) - prerequisiteValue(a) ||
        a.metadata.cost.packets - b.metadata.cost.packets ||
        a.metadata.cost.bytes - b.metadata.cost.bytes ||
        a.metadata.cost.elapsedMs - b.metadata.cost.elapsedMs ||
        a.id.localeCompare(b.id),
    )[0] ?? null
  );
}
