/** Recognize the legacy physical binding only on still-test claim provenance.
 * This projection is export-only: unrelated semantic `target` fields survive.
 */
export function normalizeVisualObservationProvenance(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const details = record.details;
  if (
    typeof record.claimId !== "string" ||
    typeof record.testId !== "string" ||
    !record.testId.startsWith("coolledux-still-") ||
    !details ||
    typeof details !== "object" ||
    Array.isArray(details) ||
    !("target" in details) ||
    typeof details.target !== "string"
  )
    return record;
  const { target, ...rest } = details;
  return {
    ...record,
    details: { ...rest, physicalDeviceKey: target },
  };
}
