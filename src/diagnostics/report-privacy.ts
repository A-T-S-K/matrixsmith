export interface ReportPrivacyContext {
  readonly deviceName: string | null;
  readonly deviceBinding: { readonly fingerprintKey: string } | null;
}
/** Report-only projection: never changes live evidence or JSON privacy modes. */
export const REPORT_REVIEW_WARNING =
  "Raw protocol packets, user messages, and free-form notes still need manual review; not all sensitive content can be recognized automatically.";
export function reportPrivacyLabel(includeIdentifiers: boolean): string {
  return includeIdentifiers
    ? "Identifiers included by explicit choice"
    : "Known identifiers omitted by default";
}

const identifyingKeys = new Set([
  "browserDeviceId",
  "geometryBrowserDeviceId",
  "geometryFingerprintKey",
  "geometryConnectionId",
  "deviceName",
  "physicalDeviceKey",
  "fingerprintKey",
  "rawAdvertisementHex",
  "manufacturerDataHex",
  "fingerprintShapeKey",
]);
const textKeys = new Set([
  "name",
  "notes",
  "summary",
  "reason",
  "reasons",
  "detail",
  "label",
  "description",
  "warnings",
  "question",
  "why",
  "findings",
  "error",
  "goal",
  "text",
  "message",
  "base",
  "whatMatrixSmithDoes",
  "whyRelevant",
  "geometryRationale",
]);

/** Collect known identities before projecting, including their explanatory repeats. */
export function projectReportPrivacy<T>(
  input: T,
  includeIdentifiers = false,
): T {
  if (includeIdentifiers) return input;
  const identities = new Set<string>();
  const collect = (value: unknown, context = ""): void => {
    if (!value || typeof value !== "object" || ArrayBuffer.isView(value))
      return;
    if (value instanceof Map) {
      for (const entry of value.values()) collect(entry, context);
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) collect(entry, context);
      return;
    }
    for (const [key, entry] of Object.entries(value)) {
      const advertisement =
        context.includes("advertisement") ||
        context.includes("manufacturerData") ||
        context.includes("serviceData");
      if (
        typeof entry === "string" &&
        (identifyingKeys.has(key) ||
          (key === "key" && "physicalDeviceKey" in value) ||
          (key === "name" &&
            (context.endsWith("fingerprint") || advertisement)) ||
          (advertisement && (key === "dataHex" || key === "rawHex")))
      ) {
        if (entry) identities.add(entry);
      }
      collect(entry, `${context}.${key}`);
    }
  };
  collect(input);
  const sensitive = [...identities].sort((a, b) => b.length - a.length);
  const redact = (text: string): string =>
    sensitive.reduce((result, id) => result.replaceAll(id, "[redacted]"), text);
  // Preserve equality classes used by transfer analysis without exposing keys.
  const bindingAliases = new Map<string, string>();
  const bindingAlias = (value: unknown): string => {
    const key = String(value);
    if (!bindingAliases.has(key))
      bindingAliases.set(
        key,
        `[redacted binding key ${bindingAliases.size + 1}]`,
      );
    return bindingAliases.get(key)!;
  };
  const visit = (value: unknown, key = "", context = ""): unknown => {
    if (typeof value === "string")
      return textKeys.has(key) ? redact(value) : value;
    if (!value || typeof value !== "object") return value;
    if (ArrayBuffer.isView(value)) return value;
    if (value instanceof Map)
      return new Map([...value].map(([k, v]) => [k, visit(v, key, context)]));
    if (Array.isArray(value))
      return value.map((entry) => visit(entry, key, context));
    const result: Record<string, unknown> = {};
    for (const [name, entry] of Object.entries(value)) {
      if (identifyingKeys.has(name) || name === "advertisementEvidence") {
        if (name === "physicalDeviceKey") result[name] = null;
        else if (
          name === "fingerprintKey" ||
          name === "fingerprintShapeKey" ||
          name === "geometryFingerprintKey" ||
          name === "geometryConnectionId"
        )
          result[name] = bindingAlias(entry);
        else if (
          name === "rawAdvertisementHex" ||
          name === "manufacturerDataHex"
        )
          result[name] = "[omitted by privacy choice]";
        continue;
      }
      if (name === "name" && context.endsWith("fingerprint")) {
        result[name] = "[omitted by privacy choice]";
        continue;
      }
      if (name === "key" && "physicalDeviceKey" in value) {
        result[name] = bindingAlias(entry);
        continue;
      }
      if (name === "advertisementObservation") {
        const observation = entry as Record<string, unknown>;
        result[name] = visit(
          {
            ...observation,
            name:
              observation.name === undefined
                ? undefined
                : "[omitted by privacy choice]",
            manufacturerData: (
              observation.manufacturerData as readonly Record<string, unknown>[]
            ).map((entry) => ({
              ...entry,
              dataHex: "[omitted by privacy choice]",
            })),
            serviceData: (
              observation.serviceData as readonly Record<string, unknown>[]
            ).map((entry) => ({
              ...entry,
              dataHex: "[omitted by privacy choice]",
            })),
          },
          name,
          `${context}.${name}`,
        );
        continue;
      }
      result[name] = visit(entry, name, `${context}.${name}`);
    }
    return result;
  };
  return visit(input) as T;
}
