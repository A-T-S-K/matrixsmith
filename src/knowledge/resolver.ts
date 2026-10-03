import { normalizeUuid, type DeviceFingerprint } from "../core/device";
import { identifyKnownProfile } from "../profiles/known-profiles";
import type {
  KnowledgeCorpus,
  KnowledgeAssertion,
  KnowledgeSource,
} from "./types";

export interface AdvisoryFamily {
  readonly id: string;
  readonly label: string;
  readonly facts: readonly KnowledgeAssertion[];
  readonly contradictions: readonly string[];
  readonly unknowns: readonly string[];
  readonly sources: readonly KnowledgeSource[];
  readonly reviewedActions: readonly string[];
}
export interface AdvisoryResolution {
  readonly families: readonly AdvisoryFamily[];
  readonly summary: string;
  readonly unknowns: readonly string[];
}

/** Pure evidence projection: no transport, driver selection, claims or authority. */
export function resolveKnowledge(
  corpus: KnowledgeCorpus,
  fingerprint: DeviceFingerprint,
  registeredActions: readonly string[] = [],
): AdvisoryResolution {
  const services = new Set(
    [
      ...fingerprint.advertisedServices,
      ...fingerprint.services.map((s) => s.uuid),
    ].map(normalizeUuid),
  );
  const characteristics = new Set(
    fingerprint.services.flatMap((s) =>
      s.characteristics.map((c) => normalizeUuid(c.uuid)),
    ),
  );
  const profile = identifyKnownProfile(fingerprint);
  const families = corpus.families
    .filter((family) => {
      const match = family.match;
      return (
        match &&
        ((match.serviceUuid && services.has(match.serviceUuid)) ||
          match.characteristicUuids.some((uuid) => characteristics.has(uuid)))
      );
    })
    .slice(0, 8)
    .map((family) => {
      const match = family.match!;
      const gatt = corpus.assertions.find((a) => a.id === match.assertionId)!;
      const facts = [
        gatt,
        ...corpus.assertions.filter(
          (a) => a.familyId === family.id && a.id !== gatt.id,
        ),
      ].slice(0, 4);
      const unknowns = [
        "Chip, manufacturer and OEM/ODM identity remain unknown from these observations.",
        ...family.unknowns,
      ];
      if (!match.serviceUuid)
        unknowns.push("Source does not establish a service UUID.");
      else if (!services.has(match.serviceUuid))
        unknowns.push(
          "Expected service is not inspectable; missing access is not contradiction.",
        );
      if (match.characteristicUuids.some((uuid) => !characteristics.has(uuid)))
        unknowns.push(
          "Some documented characteristics are not inspectable; access or discovery may be incomplete.",
        );
      const contradictions =
        family.id === "coolledux-advanced"
          ? (profile?.contradictions ?? [])
          : [];
      if (contradictions.length)
        unknowns.unshift(
          "Exact iLedHat profile is contradicted; the CoolLEDUX family remains plausible.",
        );
      const reviewedActions =
        family.id === "coolledux-advanced" &&
        registeredActions.includes("coolledux:get-device-info")
          ? ["coolledux:get-device-info"]
          : [];
      const sourceIds = new Set(
        facts.flatMap((a) => a.evidence.map((e) => e.sourceId)),
      );
      return {
        id: family.id,
        label: family.label,
        facts,
        contradictions,
        unknowns: unknowns.slice(0, 8),
        sources: corpus.sources.filter((s) => sourceIds.has(s.id)).slice(0, 8),
        reviewedActions,
      };
    });
  return {
    families,
    summary:
      families.length > 1
        ? "Shared identifiers leave multiple plausible protocol families. Prior knowledge does not select a driver."
        : families.length
          ? "A documented line is plausible; firmware applicability remains unverified."
          : "No curated matching suggestion fits the inspectable evidence. Reference-only and unresolved lines remain searchable.",
    unknowns: [
      "Branding, app publisher and UUIDs do not identify chip or OEM.",
      "Historical or imported evidence does not authorize current-session writes.",
    ],
  };
}

export function searchKnowledge(corpus: KnowledgeCorpus, query: string) {
  const term = query.slice(0, 256).trim().toLowerCase();
  const alias = corpus.aliases.find((a) => a.from === term)?.to ?? term;
  return corpus.records
    .filter((r) =>
      [r.label, r.id, r.notes, ...r.aliases, ...r.families].some((value) =>
        value.toLowerCase().includes(alias),
      ),
    )
    .slice(0, 8);
}
