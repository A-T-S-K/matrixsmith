import { LED_MATRIX_ENDPOINT } from "./microbit/gatt";
import type { DeviceFingerprint } from "../core/device";
import type { DiscoveryHints } from "../application/ports/transport";
import type { DriverMatch, MatrixDriver } from "./types";
import type { AcceptedProfile } from "../profiles/registration";
export interface DriverSelection {
  readonly matches: readonly DriverMatch[];
  readonly selected: MatrixDriver | null;
  readonly ambiguous: boolean;
}

export class DriverRegistry {
  readonly #drivers: readonly MatrixDriver[];
  constructor(
    drivers: readonly MatrixDriver[],
    readonly acceptedProfiles: readonly AcceptedProfile[] = [],
  ) {
    if (new Set(drivers.map(({ id }) => id)).size !== drivers.length)
      throw new Error("Duplicate driver registration.");
    const profiles = drivers.flatMap((driver) => driver.profiles());
    if (new Set(profiles.map(({ id }) => id)).size !== profiles.length)
      throw new Error("Duplicate profile registration.");
    if (
      new Set(
        acceptedProfiles.map(({ definitionIdentity }) => definitionIdentity),
      ).size !== acceptedProfiles.length
    )
      throw new Error("Duplicate definition registration.");
    this.acceptedProfiles = Object.freeze([...acceptedProfiles]);
    this.#drivers = Object.freeze(
      drivers.map((driver) => Object.freeze({ ...driver })),
    );
  }
  get drivers(): readonly MatrixDriver[] {
    return this.#drivers;
  }

  definitionIdentity(
    driverId: string,
    profile: import("../core/device").DeviceProfile | null,
  ): string {
    const accepted = this.acceptedProfiles.find(
      (entry) => entry.profile === profile,
    );
    if (accepted)
      return `${accepted.document.implementation}/${accepted.definitionIdentity}`;
    const codec = this.#drivers.find(
      (driver) => driver.id === driverId,
    )?.contentCodecId;
    if (codec && profile?.id.startsWith("provisional:"))
      return `${codec}/${profile.id}`;
    // No engine hash is fabricated for injected machinery.
    return `${driverId}/unversioned:${profile?.id ?? "family-candidate"}`;
  }

  match(fingerprint: DeviceFingerprint): DriverSelection {
    const matches = this.#drivers
      .map((driver) => driver.match(fingerprint))
      .sort((a, b) => b.score - a.score);
    const best = matches[0];
    const runnerUp = matches[1];
    const ambiguous = Boolean(
      best && runnerUp && best.score > 0 && best.score === runnerUp.score,
    );
    const selected =
      !ambiguous &&
      best &&
      (best.confidence === "strong" || best.confidence === "exact")
        ? (this.#drivers.find(({ id }) => id === best.driverId) ?? null)
        : null;
    return { matches, selected, ambiguous };
  }

  discoveryHints(): DiscoveryHints {
    const filters = this.#drivers.flatMap(
      (driver) => driver.discoveryHints().filters,
    );
    const optionalServices = [
      ...new Set([
        LED_MATRIX_ENDPOINT.serviceUuid,
        ...this.#drivers
          .flatMap((driver) => driver.discoveryHints().optionalServices)
          .map(String),
      ]),
    ];
    const optionalManufacturerData = [
      ...new Set(
        this.#drivers.flatMap(
          (driver) => driver.discoveryHints().optionalManufacturerData ?? [],
        ),
      ),
    ];
    return {
      filters,
      optionalServices,
      ...(optionalManufacturerData.length > 0
        ? { optionalManufacturerData }
        : {}),
    };
  }

  resolve(
    driverId: string,
    fingerprint: DeviceFingerprint,
    reason: string,
  ): DriverSelection {
    const selected =
      this.#drivers.find((driver) => driver.id === driverId) ?? null;
    if (!selected) throw new Error(`Unknown driver ${driverId}.`);
    const matches = this.#drivers
      .map((driver) => {
        const match = driver.match(fingerprint);
        return driver.id === driverId
          ? {
              ...match,
              score: 100,
              confidence: "exact" as const,
              reasons: [...match.reasons, reason],
            }
          : match;
      })
      .sort((a, b) => b.score - a.score);
    return { matches, selected, ambiguous: false };
  }
}
