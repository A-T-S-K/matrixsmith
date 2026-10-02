/** Redact identifying free text without changing protocol enums or model IDs. */
export function redactIdentifyingText<T>(
  value: T,
  identities: readonly string[],
): T {
  const sensitive = [...new Set(identities.filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
  const textKeys = new Set([
    "notes",
    "summary",
    "reason",
    "reasons",
    "detail",
    "label",
    "description",
    "warnings",
    "name",
    "deviceName",
    "geometryRationale",
  ]);
  const redact = (text: string): string =>
    sensitive.reduce((result, id) => result.replaceAll(id, "[redacted]"), text);
  // Geometry binding provenance is useful only within this output. Never export
  // its original identifying fingerprint or originating connection key.
  const geometryAliases = new Map<string, string>();
  const geometryAlias = (value: unknown): string => {
    const key = String(value);
    if (!geometryAliases.has(key))
      geometryAliases.set(
        key,
        `[redacted geometry key ${geometryAliases.size + 1}]`,
      );
    return geometryAliases.get(key)!;
  };
  function visit(input: unknown, key = ""): unknown {
    if (typeof input === "string")
      return textKeys.has(key) ? redact(input) : input;
    if (Array.isArray(input)) return input.map((item) => visit(item, key));
    if (input && typeof input === "object") {
      const record = input as Record<string, unknown>;
      const result: Record<string, unknown> = {};
      for (const [name, entry] of Object.entries(record)) {
        if (name === "browserDeviceId" || name === "geometryBrowserDeviceId")
          continue;
        if (
          name === "geometryFingerprintKey" ||
          name === "geometryConnectionId"
        ) {
          result[name] = geometryAlias(entry);
          continue;
        }
        result[name] = name === "physicalDeviceKey" ? null : visit(entry, name);
      }
      if ("physicalDeviceKey" in record && "deviceIdentityBasis" in record) {
        result.deviceIdentityBasis = "unidentified";
        result.key = JSON.stringify([
          "redacted",
          record.profileId,
          record.testId,
          record.diagnosticId,
          record.parameterKey,
          record.programCrc32,
          record.rasterStrategy,
        ]);
      }
      return result;
    }
    return input;
  }
  return visit(value) as T;
}
