import {
  REGISTERED_READS,
  readAccess,
  type ReviewedRead,
} from "../reviewed-reads";
import { ProbeStageError } from "../discovery-outcome";
import type { ConnectionService } from "./connection-service";
import type { DriverRegistry } from "../../drivers/registry";

/** Transport-facing authorization boundary. It accepts a registered object, never an endpoint. */
export function executeReviewedRead(
  connection: Pick<ConnectionService, "getSession" | "getTransport" | "read">,
  registry: DriverRegistry,
  read: ReviewedRead,
  definitionIdentity: string,
  intent: { current(): boolean; reserve(): void },
  transactionId: string,
): Promise<Uint8Array> {
  const session = connection.getSession();
  if (!REGISTERED_READS.includes(read))
    throw new ProbeStageError(
      "blocked",
      "This read is not application-registered.",
    );
  if (
    !intent.current() ||
    session.source !== "live" ||
    connection.getTransport().state !== "connected" ||
    !session.fingerprint
  )
    throw new ProbeStageError(
      "retired",
      "The live interview intent or target is no longer current.",
    );
  if (
    `${read.definitionIdentity}/${registry.definitionIdentity(read.driverId, null)}` !==
    definitionIdentity
  )
    throw new ProbeStageError(
      "retired",
      "The pinned reviewed read definition changed.",
    );
  const access = readAccess(read, session.fingerprint);
  if (access) throw new ProbeStageError("access", access);
  intent.reserve();
  return connection.read(read.endpoint, {
    transactionId,
    driverId: read.driverId,
    findings: [
      `Read definition: ${definitionIdentity}. Decoder: ${read.interpretation}.`,
      `Applicability: ${read.applicability}`,
      `Sources: ${read.sources.join(", ")}.`,
    ],
  });
}
