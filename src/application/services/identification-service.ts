import type { DeviceFingerprint } from "../../core/device";
import type { GattEndpoint } from "../../core/device";
import { ApplicationState } from "../state";

import {
  assessDevice,
  type DeviceAssessment,
} from "../../domain/device/assessment";
import type { DeviceTarget } from "../../domain/device/target";
import { candidateEndpoints } from "./runtime-support";

import { builtInDrivers, DriverRegistry } from "../../drivers/registry";
import type { MatrixDriver } from "../../drivers/types";

import type { ConnectionService } from "./connection-service";
import type { InvestigationService } from "./investigation-service";
import type { ProtocolEvidenceService } from "./protocol-evidence-service";
interface Ports {
  connection(): Pick<
    ConnectionService,
    "getSession" | "getTransport" | "patchSession"
  >;
  investigation(): Pick<
    InvestigationService,
    "allClaimEvidence" | "_reconcileDeviceBoundary"
  >;
  protocolEvidence(): Pick<ProtocolEvidenceService, "getTrace">;
}
export class IdentificationService {
  private readonly registry: DriverRegistry;
  constructor(
    private readonly ports: Ports,
    registry = new DriverRegistry(builtInDrivers),
  ) {
    this.registry = registry;
  }
  getRegistry() {
    return this.registry;
  }
  deviceTarget(): DeviceTarget | null {
    const session = this.ports.connection().getSession();
    const fingerprint = session.fingerprint;
    if (!fingerprint) return null;
    const driver = session.selection?.selected;
    if (driver && session.profile?.id.startsWith("provisional:")) {
      const probe = driver
        .familyProbes?.({
          fingerprint,
          endpoints: candidateEndpoints(fingerprint),
          source: session.source,
        })
        .find(({ id }) => id === session.protocolResolution?.probeId);
      const scope =
        session.source === "live"
          ? ("current-session" as const)
          : ("imported-external" as const);
      return {
        kind: "provisional",
        fingerprint,
        driverId: driver.id,
        geometry: {
          width: session.profile.width,
          height: session.profile.height,
        },
        geometrySource: "user-confirmed",
        identificationEvidence: (
          probe?.establishesClaims ?? [
            driver.identificationClaimId ?? "transport.bluetooth",
          ]
        ).map((claimId) => ({
          claimId,
          status: "verified" as const,
          scope,
          provenance: "observed" as const,
          summary:
            session.protocolResolution?.summary ??
            "The family probe returned a strongly identified response.",
        })),
      };
    }
    if (driver && session.profile)
      return {
        kind: "profile-resolved",
        fingerprint,
        driverId: driver.id,
        profile: session.profile,
      };
    if (driver && session.protocolResolution)
      return {
        kind: "protocol-identified",
        fingerprint,
        driverId: driver.id,
        geometry: fingerprint.manuallyConfirmedGeometry ?? null,
        identificationEvidence: {
          claimId: driver.identificationClaimId ?? "transport.bluetooth",
          status: "verified",
          scope:
            session.source === "live" ? "current-session" : "imported-external",
          provenance: "observed",
          summary: session.protocolResolution.summary,
        },
      };
    return {
      kind: "unresolved",
      fingerprint,
      candidates: (session.selection?.matches ?? []).map(
        ({ driverId, score, confidence, reasons, contradictions }) => ({
          driverId,
          score,
          confidence,
          reasons,
          contradictions,
        }),
      ),
    };
  }
  assessment(
    live = this.ports.connection().getSession().source === "live" &&
      this.ports.connection().getTransport().state === "connected",
  ): DeviceAssessment {
    const session = this.ports.connection().getSession();
    const driver = session.selection?.selected;
    const profile = session.profile;
    return assessDevice({
      target: this.deviceTarget(),
      evidence: this.ports.investigation().allClaimEvidence(),
      capabilities: driver && profile ? driver.capabilities(profile) : [],
      operations: driver?.operations,
      live,
      inspecting:
        this.ports.connection().getTransport().state === "connecting" ||
        this.ports.connection().getTransport().state === "selecting",
    });
  }
  availableEndpoints(): readonly GattEndpoint[] {
    const session = this.ports.connection().getSession();
    const fingerprint = session.fingerprint;
    if (!fingerprint) return [];
    const drivers = session.selection?.selected
      ? [session.selection.selected]
      : this.registry.drivers.filter(
          (driver) => driver.match(fingerprint).score > 0,
        );
    const endpoints = new Map<string, GattEndpoint>();
    for (const driver of drivers) {
      const profile = driver.resolveProfile(fingerprint);
      const available = profile
        ? driver.endpoints(profile)
        : candidateEndpoints(fingerprint);
      for (const endpoint of available)
        endpoints.set(
          `${endpoint.serviceUuid}/${endpoint.characteristicUuid}`,
          endpoint,
        );
    }
    return [...endpoints.values()];
  }
  applyFingerprint(
    fingerprint: DeviceFingerprint,
    source: ApplicationState["source"],
  ): void {
    const session = this.ports.connection().getSession();
    this.ports.connection().patchSession({ fingerprint: fingerprint });
    this.ports.connection().patchSession({ source: source });
    const selection = this.registry.match(fingerprint);
    this.ports.connection().patchSession({ selection });
    const driver = selection.selected;
    this.ports
      .connection()
      .patchSession({ profile: driver?.resolveProfile(fingerprint) ?? null });
    this.ports.investigation()._reconcileDeviceBoundary();
    for (const match of selection.matches)
      this.ports.protocolEvidence().getTrace().record("driver.match", {
        driverId: match.driverId,
        score: match.score,
        confidence: match.confidence,
      });
    if (driver)
      this.ports
        .protocolEvidence()
        .getTrace()
        .record("driver.selected", {
          driverId: driver.id,
          profileId: session.profile?.id ?? null,
        });
  }
  _resolveProtocol(
    driver: MatrixDriver,
    profile: import("../../core/device").DeviceProfile | null,
    probeId: string,
    summary: string,
    source: "live-probe" | "replay",
  ): void {
    const session = this.ports.connection().getSession();
    const fingerprint = session.fingerprint;
    if (!fingerprint) return;
    this.ports.connection().patchSession({
      selection: this.registry.resolve(
        driver.id,
        fingerprint,
        `protocol probe evidence: ${summary}`,
      ),
    });
    this.ports.connection().patchSession({ profile: profile });
    this.ports.connection().patchSession({
      protocolResolution: {
        driverId: driver.id,
        probeId,
        summary,
        source,
      },
    });
    this.ports
      .protocolEvidence()
      .getTrace()
      .record("protocol.probe.resolved", {
        driverId: driver.id,
        probeId,
        source,
        profileId: profile?.id ?? null,
      });
  }
}
