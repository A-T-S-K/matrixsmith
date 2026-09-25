import type { TransmissionAuthorization } from "../../app/transmission-authorization";
import type { DeviceFingerprint } from "../../core/device";
import type { GattEndpoint } from "../../core/device";
import type { TargetBinding } from "../../core/transmission";
import type { MatrixDriver } from "../../drivers/types";
import { packetHex } from "../../core/transmission";
import { transactionId } from "../../diagnostics/transactions";
import { fingerprintIdentityKey } from "../../investigation/device-identity";
import {
  recoverConnection,
  transitionConnection,
} from "../machines/connection-machine";
import {
  candidateEndpoints,
  duration,
  endpointNotifies,
  errorMessage,
} from "./runtime-support";

import type { MatrixTransport } from "../ports/transport";

import { ApplicationState } from "../state";

import {
  INITIAL_CONNECTION_STATE,
  type ConnectionState as ApplicationConnectionState,
} from "../machines/connection-machine";
import type { IdentificationService } from "./identification-service";
import type { InvestigationService } from "./investigation-service";
import type { ProtocolEvidenceService } from "./protocol-evidence-service";
interface Ports {
  identification(): Pick<
    IdentificationService,
    "getRegistry" | "applyFingerprint" | "deviceTarget"
  >;
  investigation(): Pick<
    InvestigationService,
    "_invalidatePanelProgram" | "setStagedPanelProgram"
  >;
  protocolEvidence(): Pick<
    ProtocolEvidenceService,
    | "getNotificationRouter"
    | "editTransactions"
    | "_trimTransactions"
    | "_recordIncoming"
    | "getTrace"
  >;
}
export class ConnectionService {
  private readonly session: ApplicationState;
  private readonly _notificationSubscriptions = new Map<
    string,
    () => Promise<void>
  >();
  private readonly _desiredNotificationEndpoints = new Map<
    string,
    GattEndpoint
  >();
  private _lastTransportState!: import("../ports/transport").ConnectionState;
  private _explicitDisconnect = false;
  private _connectionState: ApplicationConnectionState =
    INITIAL_CONNECTION_STATE;
  private _connectionEpoch = 0;
  private readonly transport: MatrixTransport;
  private disposed = false;
  private disposal: Promise<void> | null = null;
  private unsubscribeTransport: (() => void) | undefined;
  constructor(
    private readonly ports: Ports,
    transport: MatrixTransport,
    authority: TransmissionAuthorization,
  ) {
    this.session = new ApplicationState(authority);
    this.transport = transport;
    this._lastTransportState = transport.state;
  }
  initialize(): void {
    this.unsubscribeTransport = this.transport.subscribeState?.((state) => {
      if (!this.disposed) this._handleTransportState(state);
    });
  }
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.disposed = true;
    this.unsubscribeTransport?.();
    this.disposal = this.disconnect();
    return this.disposal;
  }

  patchSession(patch: Partial<ApplicationState>): void {
    Object.assign(this.session, patch);
  }
  getSession() {
    return this.session;
  }
  getConnectionState() {
    return this._connectionState;
  }
  setConnectionState(value: ConnectionService["_connectionState"]): void {
    this._connectionState = value;
  }
  getTransport() {
    return this.transport;
  }
  setConnectionEpoch(value: ConnectionService["_connectionEpoch"]): void {
    this._connectionEpoch = value;
  }
  getConnectionEpoch() {
    return this._connectionEpoch;
  }
  async connect(
    mode: "registered" | "inspection" = "registered",
    serviceHints: readonly BluetoothServiceUUID[] = [],
  ): Promise<DeviceFingerprint> {
    if (this.disposed) throw new Error("This workspace has been disposed.");
    this._connectionState = transitionConnection(this._connectionState, {
      type: "SELECT",
      mode,
    });
    this._connectionState = transitionConnection(this._connectionState, {
      type: "CONNECT",
      requestedDeviceId: null,
    });
    let fingerprint: DeviceFingerprint;
    try {
      fingerprint = await this.transport.selectAndConnect({
        mode,
        hints: this.ports.identification().getRegistry().discoveryHints(),
        serviceHints,
      });
    } catch (error) {
      this._connectionState = recoverConnection(
        transitionConnection(this._connectionState, {
          type: "FAILED",
          operation: "connect",
          error: {
            code: "connect-failed",
            message: errorMessage(error),
            recoverable: true,
          },
        }),
      );
      throw error;
    }
    if (this.disposed) {
      await this.transport.disconnect();
      throw new Error("This workspace was disposed while connecting.");
    }
    this.session.clearConnection();
    this.patchSession({ source: "live" });
    this.ports.identification().applyFingerprint(fingerprint, "live");
    const target = this.ports.identification().deviceTarget();
    if (target)
      this._connectionState = transitionConnection(this._connectionState, {
        type: "CONNECTED",
        connectionId: this.transport.connectionId ?? "unknown",
        target,
      });
    this._enrichAdvertisementEvidence();
    await this._restoreNotificationSubscriptions();
    return fingerprint;
  }
  async reconnectAuthorized(deviceId: string): Promise<DeviceFingerprint> {
    if (this.disposed) throw new Error("This workspace has been disposed.");
    if (!this.transport.reconnectAuthorized)
      throw new Error(
        "This transport cannot reconnect without the device chooser.",
      );
    this._connectionState = transitionConnection(this._connectionState, {
      type: "SELECT",
      mode: "registered",
    });
    this._connectionState = transitionConnection(this._connectionState, {
      type: "CONNECT",
      requestedDeviceId: deviceId,
    });
    const fingerprint = await this.transport.reconnectAuthorized(deviceId, {
      mode: "registered",
      hints: this.ports.identification().getRegistry().discoveryHints(),
    });
    if (this.disposed) {
      await this.transport.disconnect();
      throw new Error("This workspace was disposed while connecting.");
    }
    this.session.clearConnection();
    this.patchSession({ source: "live" });
    this.ports.identification().applyFingerprint(fingerprint, "live");
    const target = this.ports.identification().deviceTarget();
    if (target)
      this._connectionState = transitionConnection(this._connectionState, {
        type: "CONNECTED",
        connectionId: this.transport.connectionId ?? "unknown",
        target,
      });
    this._enrichAdvertisementEvidence();
    await this._restoreNotificationSubscriptions();
    return fingerprint;
  }
  _enrichAdvertisementEvidence(): void {
    const observe = this.transport.observeAdvertisements?.bind(this.transport);
    if (!observe) return;
    const connectionId = this.transport.connectionId;
    const browserDeviceId = this.transport.fingerprint?.browserDeviceId ?? null;
    void observe()
      .then((observation) => {
        if (this.disposed || !observation) return;
        if (
          !connectionId ||
          this.transport.connectionId !== connectionId ||
          (this.transport.fingerprint?.browserDeviceId ?? null) !==
            browserDeviceId
        )
          return;
        const updated = this.transport.fingerprint;
        if (updated && this.session.source === "live")
          this.patchSession({ fingerprint: updated });
      })
      .catch(() => undefined);
  }
  async disconnect(): Promise<void> {
    // The last program sent stays as history; the belief that it is on the
    // panel does not. Waiting for a reconnect to say so would leave a report
    // written while disconnected claiming a diagnostic was live.
    this.ports
      .investigation()
      ._invalidatePanelProgram(
        "The display disconnected; what it is showing now cannot be established.",
      );
    this._explicitDisconnect = true;
    this._connectionState = transitionConnection(this._connectionState, {
      type: "DISCONNECT",
    });
    try {
      await Promise.all(
        [...this._notificationSubscriptions.values()].map((unsubscribe) =>
          unsubscribe().catch(() => undefined),
        ),
      );
      this._notificationSubscriptions.clear();
      this._desiredNotificationEndpoints.clear();
      this.ports.protocolEvidence().getNotificationRouter().reset();
      await this.transport.disconnect();
      this.session.clearConnection();
      this._connectionState = transitionConnection(this._connectionState, {
        type: "DISCONNECTED",
        unexpected: false,
      });
    } finally {
      this._explicitDisconnect = false;
    }
  }
  async read(endpoint: GattEndpoint): Promise<Uint8Array> {
    if (this.disposed) throw new Error("This workspace has been disposed.");
    const startedAt = new Date().toISOString();
    try {
      const bytes = await this.transport.read(endpoint);
      const completedAt = new Date().toISOString();
      this.ports.protocolEvidence().editTransactions((value) =>
        value.push({
          id: transactionId("read"),
          startedAt,
          completedAt,
          durationMs: duration(startedAt, completedAt),
          sessionSource: this.session.source,
          source: "gatt-read",
          driverId: this.session.selection?.selected?.id ?? null,
          profileId: this.session.profile?.id ?? null,
          operation: "GATT Read",
          safety: {
            risk: "read-only",
            persistence: "none",
            validation: "verified",
          },
          endpoint,
          packets: [
            {
              timestamp: completedAt,
              direction: "RX",
              hex: packetHex(bytes),
              endpoint,
            },
          ],
          decodedResponse: null,
          hostAccepted: true,
          protocolAcknowledged: null,
          deviceStateVerified: false,
          responseTimedOut: false,
          error: null,
          findings: ["Characteristic read completed; raw bytes preserved."],
          observationIds: [],
          diagnosticRunId: null,
        }),
      );
      this.ports.protocolEvidence()._trimTransactions();
      return bytes;
    } catch (error) {
      const completedAt = new Date().toISOString();
      this.ports.protocolEvidence().editTransactions((value) =>
        value.push({
          id: transactionId("read"),
          startedAt,
          completedAt,
          durationMs: duration(startedAt, completedAt),
          sessionSource: this.session.source,
          source: "gatt-read",
          driverId: this.session.selection?.selected?.id ?? null,
          profileId: this.session.profile?.id ?? null,
          operation: "GATT Read",
          safety: {
            risk: "read-only",
            persistence: "none",
            validation: "verified",
          },
          endpoint,
          packets: [],
          decodedResponse: null,
          hostAccepted: false,
          protocolAcknowledged: null,
          deviceStateVerified: false,
          responseTimedOut: false,
          error: errorMessage(error),
          findings: [],
          observationIds: [],
          diagnosticRunId: null,
        }),
      );
      this.ports.protocolEvidence()._trimTransactions();
      throw error;
    }
  }
  async enableNotifications(endpoint: GattEndpoint): Promise<void> {
    const key = `${endpoint.serviceUuid.toLowerCase()}/${endpoint.characteristicUuid.toLowerCase()}`;
    this._desiredNotificationEndpoints.set(key, endpoint);
    if (this._notificationSubscriptions.has(key)) return;
    const connectionId = this.transport.connectionId;
    const unsubscribe = await this.transport.subscribe(endpoint, (packet) => {
      if (connectionId && this.transport.connectionId === connectionId)
        this.ports.protocolEvidence()._recordIncoming(packet, true, endpoint);
    });
    if (
      !connectionId ||
      this.transport.connectionId !== connectionId ||
      this.transport.state !== "connected"
    ) {
      await unsubscribe().catch(() => undefined);
      return;
    }
    this._notificationSubscriptions.set(key, unsubscribe);
  }
  async enableDriverNotifications(
    driver = this.session.selection?.selected ?? null,
  ): Promise<void> {
    const fingerprint = this.session.fingerprint;
    if (!fingerprint) throw new Error("No fingerprint is connected.");
    const drivers = driver
      ? [driver]
      : (this.session.selection?.matches
          .filter(({ score }) => score > 0)
          .map(({ driverId }) =>
            this.ports
              .identification()
              .getRegistry()
              .drivers.find(({ id }) => id === driverId),
          )
          .filter((value): value is MatrixDriver => Boolean(value)) ?? []);
    const endpoints = new Map<string, GattEndpoint>();
    for (const candidate of drivers) {
      const profile = candidate.resolveProfile(fingerprint);
      const available = profile
        ? candidate.endpoints(profile)
        : candidateEndpoints(fingerprint).filter((endpoint) =>
            endpointNotifies(fingerprint, endpoint),
          );
      for (const endpoint of available)
        endpoints.set(
          `${endpoint.serviceUuid}/${endpoint.characteristicUuid}`,
          endpoint,
        );
    }
    for (const endpoint of endpoints.values())
      await this.enableNotifications(endpoint);
  }
  async _restoreNotificationSubscriptions(): Promise<void> {
    if (this.transport.state !== "connected") return;
    for (const endpoint of this._desiredNotificationEndpoints.values())
      await this.enableNotifications(endpoint);
  }
  _handleTransportState(
    state: import("../ports/transport").ConnectionState,
  ): void {
    const previous = this._lastTransportState;
    this._lastTransportState = state;
    if (
      this._explicitDisconnect ||
      state !== "idle" ||
      (previous !== "connected" && previous !== "quarantined")
    )
      return;
    this._notificationSubscriptions.clear();
    this.ports
      .protocolEvidence()
      .getNotificationRouter()
      .reset("The display disconnected before the expected response arrived.");
    this.ports
      .investigation()
      ._invalidatePanelProgram(
        "The display disconnected unexpectedly; what it is showing now cannot be established.",
      );
    this.ports.investigation().setStagedPanelProgram(null);
    this.session.clearConnection();
    this._connectionState = transitionConnection(this._connectionState, {
      type: "DISCONNECTED",
      unexpected: true,
    });
    this._connectionEpoch += 1;
    this.ports
      .protocolEvidence()
      .getTrace()
      .record("connection.unexpected-disconnect.handled", {
        previousState: previous,
      });
  }
  _currentTargetBinding(): TargetBinding | null {
    const fingerprint = this.transport.fingerprint;
    const connectionId = this.transport.connectionId;
    if (!fingerprint || !connectionId) return null;
    return {
      connectionId,
      fingerprintKey: fingerprintIdentityKey(fingerprint),
      browserDeviceId: fingerprint.browserDeviceId ?? null,
    };
  }
  _requireTargetBinding(): TargetBinding {
    const binding = this._currentTargetBinding();
    if (!binding || this.transport.state !== "connected")
      throw new Error(
        "A live connected physical target is required to prepare a transmission.",
      );
    return binding;
  }
  get connectionState(): ApplicationConnectionState {
    return this._connectionState;
  }
}
