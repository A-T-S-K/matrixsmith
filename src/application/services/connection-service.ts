import { normalizeUuid } from "../../core/device";
import type { TransmissionAuthorization } from "../../app/transmission-authorization";
import type { DeviceFingerprint } from "../../core/device";
import type { GattEndpoint } from "../../core/device";
import type { TargetBinding } from "../../core/transmission";
import type { MatrixDriver } from "../../drivers/types";
import { definitionDigest, packetHex } from "../../core/transmission";
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
    | "getRegistry"
    | "applyFingerprint"
    | "deviceTarget"
    | "reconcileAdvertisement"
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
  private readonly _notificationStarts = new Map<string, Promise<void>>();
  private readonly _desiredNotificationEndpoints = new Map<
    string,
    GattEndpoint
  >();
  private _lastTransportState!: import("../ports/transport").ConnectionState;
  private _explicitDisconnect = false;
  private _connectionState: ApplicationConnectionState =
    INITIAL_CONNECTION_STATE;
  private _connectionEpoch = 0;
  private _lifetimeGeneration = 0;
  private readonly transport: MatrixTransport;
  private readonly pendingReads = new Map<object, number>();
  get pendingGattOperation(): boolean {
    return (
      this._notificationStarts.size > 0 ||
      [...this.pendingReads.values()].some(
        (generation) => generation === this._lifetimeGeneration,
      )
    );
  }
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
  getConnectionGeneration() {
    return this._lifetimeGeneration;
  }
  getIdentityAuthorityRevision(): number {
    return this.session.identityAuthorityRevision;
  }
  getConnectionEpoch() {
    return this._connectionEpoch;
  }
  async connect(
    mode: "registered" | "inspection" = "registered",
    serviceHints: readonly BluetoothServiceUUID[] = [],
  ): Promise<DeviceFingerprint> {
    if (this.disposed) throw new Error("This workspace has been disposed.");
    if (this.transport.state !== "idle" && this.transport.state !== "error")
      throw new Error(
        `Cannot connect while transport is ${this.transport.state}.`,
      );
    const epoch = ++this._lifetimeGeneration;
    this._notificationSubscriptions.clear();
    this._notificationStarts.clear();
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
      if (epoch !== this._lifetimeGeneration) throw error;
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
    if (epoch !== this._lifetimeGeneration)
      throw new Error("The connection attempt was retired.");
    if (this.disposed) {
      await this.transport.disconnect();
      throw new Error("This workspace was disposed while connecting.");
    }
    this.session.clearConnection();
    if (!this.transport.connectionId)
      throw new Error("Connected transport has no generation identity.");
    const source = this.transport.kind === "replay" ? "replay" : "live";
    const router = this.ports.protocolEvidence().getNotificationRouter();
    if (source === "live")
      router.beginConnection({
        connectionId: this.transport.connectionId,
        generation: epoch,
      });
    else router.reset();
    this.patchSession({ source });
    this.ports.identification().applyFingerprint(fingerprint, source);
    // Profile-free connections still establish a routable live workspace.
    this.ports
      .protocolEvidence()
      .getTrace()
      .record("gatt.connected", { generation: epoch, source });
    const target = this.ports.identification().deviceTarget();
    if (target)
      this._connectionState = transitionConnection(this._connectionState, {
        type: "CONNECTED",
        connectionId: this.transport.connectionId ?? "unknown",
        target,
      });
    this._enrichAdvertisementEvidence();
    await this._restoreNotificationSubscriptions();
    if (epoch !== this._lifetimeGeneration)
      throw new Error(
        "The connection attempt was retired during notification restoration.",
      );
    return fingerprint;
  }
  async reconnectAuthorized(deviceId: string): Promise<DeviceFingerprint> {
    if (this.disposed) throw new Error("This workspace has been disposed.");
    if (!this.transport.reconnectAuthorized)
      throw new Error(
        "This transport cannot reconnect without the device chooser.",
      );
    if (this.transport.state !== "idle" && this.transport.state !== "error")
      throw new Error(
        `Cannot connect while transport is ${this.transport.state}.`,
      );
    const epoch = ++this._lifetimeGeneration;
    this._notificationSubscriptions.clear();
    this._notificationStarts.clear();
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
    if (epoch !== this._lifetimeGeneration)
      throw new Error("The connection attempt was retired.");
    if (this.disposed) {
      await this.transport.disconnect();
      throw new Error("This workspace was disposed while connecting.");
    }
    this.session.clearConnection();
    if (!this.transport.connectionId)
      throw new Error("Connected transport has no generation identity.");
    const source = this.transport.kind === "replay" ? "replay" : "live";
    const router = this.ports.protocolEvidence().getNotificationRouter();
    if (source === "live")
      router.beginConnection({
        connectionId: this.transport.connectionId,
        generation: epoch,
      });
    else router.reset();
    this.patchSession({ source });
    this.ports.identification().applyFingerprint(fingerprint, source);
    // Profile-free connections still establish a routable live workspace.
    this.ports
      .protocolEvidence()
      .getTrace()
      .record("gatt.connected", { generation: epoch, source });
    const target = this.ports.identification().deviceTarget();
    if (target)
      this._connectionState = transitionConnection(this._connectionState, {
        type: "CONNECTED",
        connectionId: this.transport.connectionId ?? "unknown",
        target,
      });
    this._enrichAdvertisementEvidence();
    await this._restoreNotificationSubscriptions();
    if (epoch !== this._lifetimeGeneration)
      throw new Error(
        "The connection attempt was retired during notification restoration.",
      );
    return fingerprint;
  }
  _enrichAdvertisementEvidence(): void {
    const observe = this.transport.observeAdvertisements?.bind(this.transport);
    if (!observe) return;
    const connectionId = this.transport.connectionId;
    const browserDeviceId = this.transport.fingerprint?.browserDeviceId ?? null;
    const generation = this._lifetimeGeneration;
    void observe()
      .then((observation) => {
        if (this.disposed || !observation) return;
        if (
          !connectionId ||
          generation !== this._lifetimeGeneration ||
          this.transport.state !== "connected" ||
          this.transport.connectionId !== connectionId ||
          (this.transport.fingerprint?.browserDeviceId ?? null) !==
            browserDeviceId
        )
          return;
        if (
          this.session.source !== "live" ||
          !this.session.fingerprint ||
          (this.session.fingerprint.browserDeviceId ?? null) !== browserDeviceId
        )
          return;
        const withdrawn = this.ports
          .identification()
          .reconcileAdvertisement(observation);
        if (withdrawn) this.ports.investigation().setStagedPanelProgram(null);
        const target = this.ports.identification().deviceTarget();
        if (target && this._connectionState.value === "connected")
          this._connectionState = { ...this._connectionState, target };
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
      const epoch = ++this._lifetimeGeneration;
      const subscriptions = [...this._notificationSubscriptions.values()];
      this._notificationSubscriptions.clear();
      this._notificationStarts.clear();
      // Local invalidation is immediate; an obsolete browser stop may never settle.
      for (const unsubscribe of subscriptions)
        void unsubscribe().catch(() => undefined);
      this._desiredNotificationEndpoints.clear();
      this.ports.protocolEvidence().getNotificationRouter().reset();
      this.session.clearConnection();
      await this.transport.disconnect();
      if (epoch !== this._lifetimeGeneration) return;
      this._connectionState = transitionConnection(this._connectionState, {
        type: "DISCONNECTED",
        unexpected: false,
      });
    } finally {
      this._explicitDisconnect = false;
    }
  }
  async read(
    endpoint: GattEndpoint,
    reviewed?: {
      readonly transactionId: string;
      readonly driverId: string;
      readonly findings: readonly string[];
    },
  ): Promise<Uint8Array> {
    if (this.disposed) throw new Error("This workspace has been disposed.");
    // Capture before browser work: a late result belongs to the original session.
    endpoint = { ...endpoint };
    const sessionSource = this.session.source;
    const driverId =
      reviewed?.driverId ?? this.session.selection?.selected?.id ?? null;
    const profileId = this.session.profile?.id ?? null;
    const id = reviewed?.transactionId ?? transactionId("read");
    const context = [
      `Original connection: ${this.transport.connectionId}; generation: ${this._lifetimeGeneration}.`,
      `Original target: ${this.session.fingerprint ? definitionDigest({ connection: this.transport.connectionId, fingerprint: fingerprintIdentityKey(this.session.fingerprint) }) : "none"}.`,
      ...(reviewed?.findings ?? []),
    ];
    const startedAt = new Date().toISOString();
    const readOwner = {};
    this.pendingReads.set(readOwner, this._lifetimeGeneration);
    try {
      const bytes = await this.transport.read(endpoint);
      const completedAt = new Date().toISOString();
      this.ports.protocolEvidence().editTransactions((value) =>
        value.push({
          id,
          startedAt,
          completedAt,
          durationMs: duration(startedAt, completedAt),
          sessionSource,
          source: "gatt-read",
          driverId,
          profileId,
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
              hex: packetHex(bytes.subarray(0, 512)),
              endpoint,
            },
          ],
          decodedResponse: null,
          hostAccepted: true,
          protocolAcknowledged: null,
          deviceStateVerified: false,
          responseTimedOut: false,
          error: null,
          findings: [
            ...context,
            `Characteristic read completed; received ${bytes.length} bytes. Evidence capped at 512 bytes.`,
            "Read value received; physical appearance unconfirmed.",
          ],
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
          id,
          startedAt,
          completedAt,
          durationMs: duration(startedAt, completedAt),
          sessionSource,
          source: "gatt-read",
          driverId,
          profileId,
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
          findings: [
            ...context,
            "Failure stage: GATT read. Browser error does not identify pairing/security cause or protocol support.",
          ],
          observationIds: [],
          diagnosticRunId: null,
        }),
      );
      this.ports.protocolEvidence()._trimTransactions();
      throw error;
    } finally {
      this.pendingReads.delete(readOwner);
    }
  }
  isNotificationActive(endpoint: GattEndpoint): boolean {
    return (
      this.session.source === "live" &&
      this.transport.state === "connected" &&
      this._notificationSubscriptions.has(notificationKey(endpoint))
    );
  }
  async enableNotifications(endpoint: GattEndpoint): Promise<void> {
    if (this.disposed) throw new Error("This workspace has been disposed.");
    endpoint = {
      serviceUuid: normalizeUuid(endpoint.serviceUuid),
      characteristicUuid: normalizeUuid(endpoint.characteristicUuid),
    };
    const key = notificationKey(endpoint);
    this._desiredNotificationEndpoints.set(key, endpoint);
    if (this.isNotificationActive(endpoint)) return;
    const existing = this._notificationStarts.get(key);
    if (existing) return existing;
    const connectionId = this.transport.connectionId;
    const epoch = this._lifetimeGeneration;
    const current = () =>
      epoch === this._lifetimeGeneration &&
      !!connectionId &&
      connectionId === this.transport.connectionId &&
      this.transport.state === "connected" &&
      !this.disposed;
    const startup = (async () => {
      const unsubscribe = await this.transport.subscribe(endpoint, (packet) => {
        if (current())
          this.ports
            .protocolEvidence()
            ._recordIncoming(packet, true, endpoint, undefined, {
              connectionId: connectionId!,
              generation: epoch,
            });
      });
      if (!current()) {
        void unsubscribe().catch(() => undefined);
        throw new Error(
          "Notification startup belonged to a retired connection.",
        );
      }
      this._notificationSubscriptions.set(key, unsubscribe);
    })();
    this._notificationStarts.set(key, startup);
    try {
      await startup;
    } finally {
      if (this._notificationStarts.get(key) === startup)
        this._notificationStarts.delete(key);
    }
  }
  async enableDriverNotifications(
    driver = this.session.selection?.selected ?? null,
  ): Promise<void> {
    const epoch = this._lifetimeGeneration;
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
      for (const endpoint of available) {
        if (!endpointNotifies(fingerprint, endpoint)) continue;
        endpoints.set(
          `${endpoint.serviceUuid}/${endpoint.characteristicUuid}`,
          endpoint,
        );
      }
    }
    for (const endpoint of endpoints.values()) {
      if (epoch !== this._lifetimeGeneration)
        throw new Error("The notification connection was retired.");
      await this.enableNotifications(endpoint);
    }
  }
  async _restoreNotificationSubscriptions(): Promise<void> {
    if (this.transport.state !== "connected") return;
    const epoch = this._lifetimeGeneration;
    for (const endpoint of this._desiredNotificationEndpoints.values()) {
      if (epoch !== this._lifetimeGeneration)
        throw new Error("The notification connection was retired.");
      await this.enableNotifications(endpoint);
    }
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
    this._notificationStarts.clear();
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
    this._lifetimeGeneration += 1;
    this.ports
      .protocolEvidence()
      .getTrace()
      .record("connection.unexpected-disconnect.handled", {
        previousState: previous,
      });
  }
  _currentTargetBinding(): TargetBinding | null {
    const fingerprint = this.session.fingerprint;
    const connectionId = this.transport.connectionId;
    if (
      this.session.source !== "live" ||
      !this.session.fingerprint ||
      !fingerprint ||
      !connectionId
    )
      return null;
    return {
      connectionId,
      fingerprintKey: `${fingerprintIdentityKey(fingerprint)}|geometry-revision:${this.session.geometryRevision}|identity-authority-revision:${this.session.identityAuthorityRevision}`,
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

function notificationKey(endpoint: GattEndpoint): string {
  return `${normalizeUuid(endpoint.serviceUuid)}/${normalizeUuid(endpoint.characteristicUuid)}`;
}
