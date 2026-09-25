/**
 * Human-facing diagnostic regions.
 *
 * A guided test that asks about a specific place on the physical panel
 * declares its regions here. Every region carries a name a person can read
 * ("Zone 2 · Red test") and a short chip label ("2") for the annotated map;
 * the raw protocol value that produced it is deliberately pushed into
 * `technical`, where the UI shows it only on demand and reports keep it as
 * exact evidence.
 *
 * This model is driver-neutral on purpose: the spatial observation UI renders
 * whatever a driver declares, so a new driver never edits view code.
 */

export interface DiagnosticRegionTechnical {
  /** Raw pixel word, exactly as transmitted (no substitution, no transfer curve). */
  readonly rawWord?: number;
  /** What the current working hypothesis predicts, when there is one. */
  readonly expectedUnderHypothesis?: string;
  /** Why this region is being probed, in protocol terms. */
  readonly notes?: readonly string[];
}

export interface DiagnosticRegion {
  /** Stable identifier questions refer to (e.g. "channel-red"). */
  readonly id: string;
  /** Compact label drawn on the map (e.g. "2"). */
  readonly shortLabel: string;
  /** Full human label (e.g. "Zone 2 · Red test"). */
  readonly displayLabel: string;
  /** What this region is for, in user language. */
  readonly description: string;
  /**
   * Regions that carry the same probe. When one member is the active
   * question, the map also marks its peers, so a question about "the black
   * candidate zones" highlights every place the user should actually look.
   */
  readonly groupId?: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly technical: DiagnosticRegionTechnical;
}

export function rawWordHex(word: number): string {
  return `0x${word.toString(16).padStart(4, "0").toUpperCase()}`;
}

export function findRegion(
  regions: readonly DiagnosticRegion[],
  id: string,
): DiagnosticRegion | undefined {
  return regions.find((region) => region.id === id);
}

/** Peers of the active region: same group, excluding the region itself. */
export function regionPeers(
  regions: readonly DiagnosticRegion[],
  id: string,
): readonly DiagnosticRegion[] {
  const active = findRegion(regions, id);
  if (!active?.groupId) return [];
  return regions.filter(
    (region) => region.id !== id && region.groupId === active.groupId,
  );
}

/**
 * Structural validation for a declared region set. Duplicate ids would make
 * a question ambiguous about which place on the panel it means, and a region
 * without a human label would force the raw hex to become the user-facing
 * name — both are defects in the test definition, not user errors.
 */
export function validateRegions(
  regions: readonly DiagnosticRegion[],
  bounds?: { readonly width: number; readonly height: number },
): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const region of regions) {
    if (!region.id.trim()) {
      errors.push("A diagnostic region has an empty id.");
      continue;
    }
    if (seen.has(region.id))
      errors.push(`Duplicate diagnostic region id "${region.id}".`);
    seen.add(region.id);
    if (!region.displayLabel.trim())
      errors.push(`Region "${region.id}" has no human-readable displayLabel.`);
    if (!region.shortLabel.trim())
      errors.push(`Region "${region.id}" has no shortLabel for the map.`);
    if (region.width <= 0 || region.height <= 0)
      errors.push(`Region "${region.id}" has a non-positive size.`);
    if (region.x < 0 || region.y < 0)
      errors.push(`Region "${region.id}" starts outside the panel.`);
    if (
      bounds &&
      (region.x + region.width > bounds.width ||
        region.y + region.height > bounds.height)
    ) {
      errors.push(
        `Region "${region.id}" extends past the ${bounds.width}×${bounds.height} panel.`,
      );
    }
  }
  return errors;
}

/** Every regionId a question references must resolve to a declared region. */
export function validateRegionReferences(
  references: readonly (string | undefined)[],
  regions: readonly DiagnosticRegion[],
): string[] {
  const known = new Set(regions.map((region) => region.id));
  const errors: string[] = [];
  for (const reference of references) {
    if (reference === undefined) continue;
    if (!known.has(reference))
      errors.push(`Observation references unknown region "${reference}".`);
  }
  return errors;
}
