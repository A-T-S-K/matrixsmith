import { freezeDefinition } from "./freeze";
export { freezeDefinition } from "./freeze";
import validate from "./generated/profile-validator.js";

export interface ProfileDocument {
  readonly documentVersion: 1;
  readonly namespace: string;
  readonly id: string;
  readonly revision: string;
  readonly implementation: string;
  readonly label: string;
  readonly matching: {
    readonly name: string;
    readonly serviceUuid: string;
    readonly characteristicUuid: string;
    readonly requiredProperties: readonly [
      "read",
      "notify",
      "writeWithoutResponse",
    ];
  };
  readonly contradictions: {
    readonly companyId: number;
    readonly geometry: true;
  };
  readonly dimensions: { readonly width: number; readonly height: number };
  readonly parameters: {
    readonly brightness: { readonly min: 0; readonly max: 255 };
  };
  readonly templates: readonly ["coolledux-source-v1"];
  readonly limitations: readonly string[];
  readonly sources: readonly string[];
}

export const PROFILE_BYTE_LIMIT = 16_384;

/** Bound scanning before JSON.parse, schema validation, cloning or hashing. */
export function boundedJson(
  text: string,
  byteLimit = PROFILE_BYTE_LIMIT,
): unknown {
  if (
    text.length > byteLimit ||
    new TextEncoder().encode(text).length > byteLimit
  )
    throw new Error("Document exceeds its byte limit.");
  let depth = 0,
    count = 0,
    stringLength = 0,
    inString = false,
    escaped = false;
  for (const char of text) {
    if (inString) {
      if (++stringLength > 2048)
        throw new Error("Document string exceeds its limit.");
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
      stringLength = 0;
      if (++count > 512)
        throw new Error("Document exceeds its value count limit.");
    } else if (char === "{" || char === "[") {
      if (++depth > 8) throw new Error("Document exceeds its depth limit.");
    } else if (char === "}" || char === "]") depth--;
    else if (char === "," && ++count > 512)
      throw new Error("Document exceeds its value count limit.");
  }
  return JSON.parse(text);
}

export function parseProfileDocument(text: string): ProfileDocument {
  const value = boundedJson(text);
  if (!validate(value))
    throw new Error(
      `Unsupported profile document at ${validate.errors?.[0]?.instancePath || "/"}: ${validate.errors?.[0]?.message ?? "invalid structure"}.`,
    );
  const document = value as ProfileDocument;
  if (document.matching.name !== document.matching.name.trim().toLowerCase())
    throw new Error("Matching name must be trimmed and lowercase.");
  return freezeDefinition(document);
}

export function profileCompatibility(
  document: ProfileDocument,
): readonly string[] {
  const problems: string[] = [];
  if (document.implementation !== "coolledux-reviewed-v1")
    problems.push(
      `Implementation ${document.implementation} is not installed.`,
    );
  if (
    document.matching.serviceUuid !== "0000fff0-0000-1000-8000-00805f9b34fb" ||
    document.matching.characteristicUuid !==
      "0000fff1-0000-1000-8000-00805f9b34fb"
  )
    problems.push("The installed implementation requires FFF0/FFF1 endpoints.");
  if (document.dimensions.width % 8 !== 0)
    problems.push(
      "The reviewed codec requires widths divisible by eight; tiling is not configurable.",
    );
  if (
    document.namespace === "matrixsmith" ||
    document.id === "iledhat-31ae-32x16"
  )
    problems.push(
      "Built-in identities are reserved; local documents cannot replace them.",
    );
  return problems;
}
