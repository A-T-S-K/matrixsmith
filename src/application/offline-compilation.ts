import type { DeviceProfile } from "../core/device";
import type { MatrixOperation } from "../core/operations";
import { definitionDigest, type TransmissionPlan } from "../core/transmission";
import type { DriverRegistry } from "../drivers/registry-core";
import { Framebuffer } from "../render/framebuffer";
export interface OfflineReferenceDefinition {
  readonly implementation: string;
  readonly profile: DeviceProfile;
  readonly sourceBasis: readonly string[];
}
export interface OfflineCompilation {
  readonly kind: "offline-planned-bytes";
  readonly reference: OfflineReferenceDefinition;
  readonly definitionIdentity: string;
  readonly preview: Framebuffer;
  /** Unbound plan. No target, transaction, accepted write or physical evidence. */
  readonly plan: TransmissionPlan;
}
/** No runtime, transport or recorder is accepted or constructed at this boundary. */
export function compileOfflineFrame(
  registry: DriverRegistry,
  reference: OfflineReferenceDefinition,
  operation: Extract<MatrixOperation, { type: "ShowFrame" }>,
): OfflineCompilation {
  const driver = registry.drivers.find(
    (d) => d.id === reference.profile.driverId,
  );
  if (
    !driver ||
    driver.contentCodecId !== reference.implementation ||
    !driver.profiles().includes(reference.profile) ||
    reference.profile.metadata.offlineReference !== true
  )
    throw new Error(
      "An explicit registered reviewed offline reference is required.",
    );
  // Driver validates shape/count/binary values before the compiler copies input.
  const plan = driver.plan(operation, {
    profile: reference.profile,
    fingerprint: null,
    source: "offline",
  });
  if (plan.execution !== "dry-run-only")
    throw new Error(
      "Offline compilation requires independent dry-run-only driver intent.",
    );
  const preview = new Framebuffer(
    operation.frame.width,
    operation.frame.height,
  );
  preview.data.set(operation.frame.data);
  const definitionIdentity = `${reference.implementation}/${definitionDigest(reference)}`;
  return {
    kind: "offline-planned-bytes",
    reference,
    definitionIdentity,
    preview,
    plan: {
      ...plan,
      operation: { type: "ShowFrame", frame: preview },
      metadata: { ...plan.metadata, definitionIdentity },
    },
  };
}
