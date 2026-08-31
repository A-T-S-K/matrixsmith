import type { DeviceFingerprint } from "../core/device";
import type { DiscoveryHints } from "../transport/types";
import type { DriverMatch, MatrixDriver } from "./types";

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
    return { filters, optionalServices };
  }
}
