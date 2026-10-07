import { validateGeometry } from "../../domain/device/geometry";
import { fingerprintIdentityKey } from "../../investigation/device-identity";
import { definitionDigest } from "../../core/transmission";
import type {
  AdvertisementObservation,
  DeviceFingerprint,
} from "../../core/device";
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
export interface GeometryProposal {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly driverId: string;
  readonly transactionId: string;
  readonly recordedAt: string;
  readonly connectionId: string;
  readonly fingerprintKey: string;
  readonly browserDeviceId: string | null;
  readonly rationale: string;
}
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
        geometrySource:
          session.profile.metadata.geometrySource === "device-info"
            ? "device-info"
            : "user-confirmed",
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
  geometryProposal(): GeometryProposal | null {
    const session = this.ports.connection().getSession();
    const proposal = session.geometryProposal;
    const transport = this.ports.connection().getTransport();
    return proposal &&
      session.source === "live" &&
      transport.state === "connected" &&
      proposal.connectionId === transport.connectionId &&
      session.fingerprint &&
      proposal.fingerprintKey === fingerprintIdentityKey(session.fingerprint) &&
      proposal.browserDeviceId ===
        (session.fingerprint.browserDeviceId ?? null) &&
      proposal.driverId === session.selection?.selected?.id &&
      proposal.driverId === session.protocolResolution?.driverId
      ? proposal
      : null;
  }
  _proposeGeometry(
    driver: MatrixDriver,
    transaction: import("../../diagnostics/transactions").ProtocolTransaction,
    connectionId: string,
  ): void {
    const session = this.ports.connection().getSession();
    session.geometryProposal = null;
    if (
      session.source !== "live" ||
      transaction.sessionSource !== "live" ||
      transaction.source !== "probe" ||
      transaction.error ||
      transaction.responseTimedOut ||
      !transaction.protocolAcknowledged ||
      !transaction.decodedResponse ||
      !transaction.packets.some(
        (packet) => packet.relation === "matched-response",
      ) ||
      this.ports.connection().getTransport().connectionId !== connectionId ||
      !session.fingerprint ||
      session.selection?.selected?.id !== driver.id
    )
      return;
    const interpreted = driver.interpretGeometry?.(transaction.decodedResponse);
    if (!interpreted) return;
    try {
      const geometry = validateGeometry(interpreted.width, interpreted.height);
      if (
        session.profile?.metadata.candidateProfile &&
        (session.profile.width !== geometry.width ||
          session.profile.height !== geometry.height)
      ) {
        session.disableExperimentalTx();
        session.consumePersistentConfirmation();
        this.ports
          .connection()
          .patchSession({ profile: null, validatedRasterStrategy: null });
        this.ports.investigation()._reconcileDeviceBoundary();
        this.ports
          .protocolEvidence()
          .getTrace()
          .record("geometry.proposal.rejected", {
            width: geometry.width,
            height: geometry.height,
          });
      }
      session.geometryProposal = Object.freeze({
        ...geometry,
        id: transaction.id,
        transactionId: transaction.id,
        driverId: driver.id,
        recordedAt: transaction.completedAt,
        connectionId,
        fingerprintKey: fingerprintIdentityKey(session.fingerprint),
        browserDeviceId: session.fingerprint.browserDeviceId ?? null,
        rationale: `${driver.family} interpreted the correlated identification response as pixel dimensions.`,
      });
    } catch {
      this.ports
        .protocolEvidence()
        .getTrace()
        .record("geometry.proposal.rejected", {
          driverId: driver.id,
          transactionId: transaction.id,
          reason: "Reported dimensions failed application geometry limits.",
        });
    }
  }
  familyReadiness(): import("../../domain/device/assessment").FamilyReadiness {
    const session = this.ports.connection().getSession();
    const driver = session.selection?.selected;
    return {
      fingerprintKey: session.fingerprint
        ? fingerprintIdentityKey(session.fingerprint)
        : null,
      driverId: driver?.id ?? null,
      profileId: session.profile?.id ?? null,
      basis:
        session.source !== "live"
          ? "historical"
          : !driver
            ? "unknown"
            : session.protocolResolution?.driverId === driver.id &&
                session.protocolResolution.source === "live-probe"
              ? "current-live"
              : session.profile &&
                  !session.profile.id.startsWith("provisional:") &&
                  !session.profile.metadata.candidateProfile
                ? "built-in-profile"
                : "unknown",
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
      family: this.familyReadiness(),
      operationRequirements: driver?.operationRequirements,
      evidence: [
        ...this.ports.investigation().allClaimEvidence(),
        ...(session.protocolResolution?.driverId === driver?.id &&
        session.protocolResolution?.source === "live-probe"
          ? (
              driver
                ?.familyProbes?.({
                  fingerprint: session.fingerprint!,
                  endpoints: candidateEndpoints(session.fingerprint!),
                  source: session.source,
                })
                .find(({ id }) => id === session.protocolResolution?.probeId)
                ?.establishesClaims ?? []
            ).map((claimId) => ({
              claimId,
              status: "verified" as const,
              scope:
                session.source === "live"
                  ? ("current-session" as const)
                  : ("imported-external" as const),
              provenance: "observed" as const,
              summary: session.protocolResolution!.summary,
            }))
          : []),
      ],
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
    if (fingerprint.manuallyConfirmedGeometry)
      validateGeometry(
        fingerprint.manuallyConfirmedGeometry.width,
        fingerprint.manuallyConfirmedGeometry.height,
      );
    const session = this.ports.connection().getSession();
    this.ports.connection().patchSession({ fingerprint: fingerprint });
    this.ports.connection().patchSession({ source: source });
    const selection = this.registry.match(fingerprint);
    this.ports.connection().patchSession({ selection });
    const driver = selection.selected;
    this.ports
      .connection()
      .patchSession({ profile: driver?.resolveProfile(fingerprint) ?? null });
    if (
      selection.matches.some(
        ({ driverId, score, contradictions }) =>
          (driver ? driverId === driver.id : score > 0) &&
          contradictions.length > 0,
      ) ||
      session.identityTrustWithdrawn
    )
      session.withdrawIdentityTrust();
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
  /** Patch browser observations onto application-owned facts, then reconcile
   * executable trust synchronously before publishing the enriched fingerprint.
   */
  reconcileAdvertisement(observation: AdvertisementObservation): boolean {
    const session = this.ports.connection().getSession();
    if (!session.fingerprint || session.source !== "live") return false;
    const fingerprint = {
      ...session.fingerprint,
      advertisementObservation: structuredClone(observation),
    };
    const selection = this.registry.match(fingerprint);
    const driver = session.selection?.selected;
    const contradicted = selection.matches.some(
      ({ driverId, score, contradictions }) =>
        (driver ? driverId === driver.id : score > 0) &&
        contradictions.length > 0,
    );
    const resolvedProfile = driver?.resolveProfile(fingerprint) ?? null;
    const changedDefinition = Boolean(
      session.profile &&
      !session.profile.id.startsWith("provisional:") &&
      (!resolvedProfile ||
        this.registry.definitionIdentity(driver!.id, resolvedProfile) !==
          this.registry.definitionIdentity(driver!.id, session.profile) ||
        definitionDigest(resolvedProfile) !==
          definitionDigest(session.profile)),
    );
    session.fingerprint = fingerprint;
    // No automatic elevation: keep the prior application-owned selection and
    // geometry only while its evidence remains consistent.
    if (contradicted || changedDefinition) {
      session.selection = selection;
      session.withdrawIdentityTrust();
      this.ports.investigation()._reconcileDeviceBoundary();
      this.ports.protocolEvidence().getTrace().record("driver.match", {
        authority: "withdrawn-after-observed-contradiction",
        revision: session.identityAuthorityRevision,
      });
      return true;
    }
    if (session.selection)
      session.selection = { ...session.selection, matches: selection.matches };
    return false;
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
    if (session.identityTrustWithdrawn) profile = null;
    const changed =
      session.selection?.selected?.id !== driver.id ||
      session.profile?.id !== profile?.id;
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
    if (changed) this.ports.investigation()._reconcileDeviceBoundary();
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
