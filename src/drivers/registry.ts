import type { DeviceFingerprint } from "../core/device";
import type { DiscoveryHints } from "../transport/types";
import type { DriverMatch, MatrixDriver } from "./types";
import { coolLedXDriver } from "./coolledx";
import { coolLedUxDriver } from "./coolledux";

export const builtInDrivers: readonly MatrixDriver[] = Object.freeze([coolLedXDriver, coolLedUxDriver]);

export interface DriverSelection {
  readonly matches: readonly DriverMatch[];
  readonly selected: MatrixDriver | null;
  readonly ambiguous: boolean;
}

export class DriverRegistry {
  readonly #drivers: readonly MatrixDriver[];
  constructor(drivers: readonly MatrixDriver[]) { this.#drivers = [...drivers]; }
  get drivers(): readonly MatrixDriver[] { return this.#drivers; }

  match(fingerprint: DeviceFingerprint): DriverSelection {
    const matches = this.#drivers.map((driver) => driver.match(fingerprint)).sort((a, b) => b.score - a.score);
    const best = matches[0];
    const runnerUp = matches[1];
    const ambiguous = Boolean(best && runnerUp && best.score > 0 && best.score === runnerUp.score);
    const selected = !ambiguous && best && (best.confidence === "strong" || best.confidence === "exact")
      ? this.#drivers.find(({ id }) => id === best.driverId) ?? null
      : null;
    return { matches, selected, ambiguous };
  }

  discoveryHints(): DiscoveryHints {
    const filters = this.#drivers.flatMap((driver) => driver.discoveryHints().filters);
    const optionalServices = [...new Set(this.#drivers.flatMap((driver) => driver.discoveryHints().optionalServices).map(String))];
    const optionalManufacturerData = [...new Set(this.#drivers.flatMap((driver) => driver.discoveryHints().optionalManufacturerData ?? []))];
    return { filters, optionalServices, ...(optionalManufacturerData.length > 0 ? { optionalManufacturerData } : {}) };
  }

  resolve(driverId: string, fingerprint: DeviceFingerprint, reason: string): DriverSelection {
    const selected = this.#drivers.find((driver) => driver.id === driverId) ?? null;
    if (!selected) throw new Error(`Unknown driver ${driverId}.`);
    const matches = this.#drivers.map((driver) => {
      const match = driver.match(fingerprint);
      return driver.id === driverId ? { ...match, score: 100, confidence: "exact" as const, reasons: [...match.reasons, reason] } : match;
    }).sort((a, b) => b.score - a.score);
    return { matches, selected, ambiguous: false };
  }
}
