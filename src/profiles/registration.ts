import type { DeviceFingerprint, DeviceProfile } from "../core/device";
import { COOLLEDUX_DEFAULT_QUIRKS } from "../core/quirks";
import { definitionDigest } from "../core/transmission";
import type { MatrixDriver } from "../drivers/types";
import {
  evaluateKnownProfile,
  type KnownProfileSignature,
} from "./known-profiles";
import { freezeDefinition } from "./freeze";
import {
  parseProfileDocument,
  profileCompatibility,
  type ProfileDocument,
} from "./document";

export interface AcceptedProfile {
  readonly document: ProfileDocument;
  readonly profile: DeviceProfile;
  readonly signature: KnownProfileSignature;
  readonly definitionIdentity: string;
}

/** Copies and pins the accepted definition. It contributes source support only. */
export function acceptLocalProfile(input: ProfileDocument): AcceptedProfile {
  const document = parseProfileDocument(JSON.stringify(input));
  const problems = profileCompatibility(document);
  if (problems.length) throw new Error(problems.join(" "));
  const profile: DeviceProfile = freezeDefinition({
    id: `${document.namespace}:${document.id}`,
    name: document.label,
    driverId: "coolledux",
    ...document.dimensions,
    validation: "experimental",
    evidence: document.sources.map((source, index) => ({
      id: `local-source:${index}`,
      summary:
        "Local author citation; physical applicability remains unverified.",
      confidence: "inferred" as const,
      source,
    })),
    metadata: { localProfile: true },
    quirks: structuredClone(COOLLEDUX_DEFAULT_QUIRKS),
  });
  return freezeDefinition({
    document,
    profile,
    signature: {
      profileId: profile.id,
      ...document.matching,
      ...document.dimensions,
      companyId: document.contradictions.companyId,
      driverId: "coolledux",
      rejectedDrivers: {},
    },
    definitionIdentity: definitionDigest(document),
  });
}

/** One reviewed implementation, multiple data definitions; no new family branch. */
export function withLocalProfiles(
  driver: MatrixDriver,
  accepted: readonly AcceptedProfile[],
): MatrixDriver {
  if (!accepted.length) return driver;
  if (driver.id !== "coolledux")
    throw new Error("Incompatible profile implementation.");
  const entries = Object.freeze([...accepted]);
  const resolve = (fingerprint: DeviceFingerprint) =>
    entries.filter(
      ({ signature }) => evaluateKnownProfile(signature, fingerprint).matched,
    );
  return Object.freeze({
    ...driver,
    profiles: () =>
      Object.freeze([
        ...driver.profiles(),
        ...entries.map(({ profile }) => profile),
      ]),
    match: (fingerprint: DeviceFingerprint) => {
      const matches = resolve(fingerprint);
      const original = driver.match(fingerprint);
      const contradictions = entries.flatMap(
        ({ signature }) =>
          evaluateKnownProfile(signature, fingerprint).contradictions,
      );
      if (matches.length === 1)
        return {
          driverId: driver.id,
          score: 100,
          confidence: "exact" as const,
          reasons: evaluateKnownProfile(matches[0]!.signature, fingerprint)
            .reasons,
          contradictions,
        };
      return {
        ...original,
        contradictions: [...original.contradictions, ...contradictions],
      };
    },
    resolveProfile: (fingerprint: DeviceFingerprint) => {
      const builtin = driver.resolveProfile(fingerprint);
      const matches = resolve(fingerprint);
      return builtin && matches.length
        ? null
        : (builtin ?? (matches.length === 1 ? matches[0]!.profile : null));
    },
  });
}
