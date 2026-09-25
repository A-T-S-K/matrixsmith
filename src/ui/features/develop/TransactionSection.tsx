import type { JSX } from "preact";
import type {
  AppSnapshot,
  PresentationStore,
  TransactionFilter,
} from "../../../presentation/store";
import type { ProtocolTransaction } from "../../../diagnostics/transactions";
import type { ContentCompilationRecord } from "../../../diagnostics/content-evidence";
import { Copy, UploadAnalysis } from "./EvidenceSections";
export function TransactionSection({
  snapshot,
  store,
}: {
  snapshot: AppSnapshot;
  store: PresentationStore;
}): JSX.Element {
  const filters: readonly [TransactionFilter, string][] = [
    ["all", "All"],
    ["txrx", "TX/RX"],
    ["queries", "Queries"],
    ["probes", "Probes"],
    ["diagnostics", "Diagnostics"],
    ["errors", "Errors"],
  ];
  return (
    <section>
      <div class="section-heading">
        <h2>Transactions</h2>
        <p>Semantic operations correlated with exact TX/RX evidence.</p>
      </div>
      <div class="transaction-toolbar">
        <div class="filter-pills">
          {filters.map(([value, label]) => (
            <button
              key={value}
              class={snapshot.transactionFilter === value ? "active" : ""}
              onClick={() => store.setTransactionFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          type="search"
          placeholder="Search opcode, operation, hex, driver…"
          value={snapshot.transactionSearch}
          onInput={(event) =>
            store.setTransactionSearch(
              (event.currentTarget as HTMLInputElement).value,
            )
          }
        />
      </div>
      <div class="transaction-list">
        <div class="transaction-head">
          <span>Timestamp</span>
          <span>Operation</span>
          <span>Direction / result</span>
          <span>Duration</span>
        </div>
        {snapshot.transactions.length ? (
          [...snapshot.transactions]
            .reverse()
            .map((t) => (
              <Transaction
                key={t.id}
                transaction={t}
                store={store}
                compilation={
                  snapshot.contentCompilations.find(
                    (record) => record.transactionId === t.id,
                  ) ?? null
                }
              />
            ))
        ) : (
          <p class="empty">
            No matching transactions. Run a safe query or diagnostic to begin
            the capture.
          </p>
        )}
      </div>
    </section>
  );
}
export function Transaction({
  transaction: t,
  store,
  compilation,
}: {
  transaction: ProtocolTransaction;
  store: PresentationStore;
  compilation: ContentCompilationRecord | null;
}): JSX.Element {
  const status =
    t.error || t.responseTimedOut
      ? "Error"
      : t.deviceStateVerified
        ? "Device verified"
        : t.protocolAcknowledged
          ? "Protocol acknowledged"
          : t.hostAccepted
            ? "Host accepted"
            : "Not accepted";
  return (
    <details class="transaction">
      <summary>
        <time>
          {new Date(t.startedAt).toLocaleTimeString([], { hour12: false })}
        </time>
        <strong>{t.operation}</strong>
        <span>
          {t.packets.map((p) => p.direction).join(" → ") || t.source} · {status}
        </span>
        <small>{t.durationMs} ms</small>
      </summary>
      <div class="transaction-body">
        {compilation && (
          <div class="decoded program-summary">
            <div>
              <strong>Compiled program ({compilation.contentType})</strong>
            </div>
            <dl>
              <div>
                <dt>Logical size</dt>
                <dd>
                  {compilation.width}×{compilation.height}
                </dd>
              </div>
              <div>
                <dt>Tiles</dt>
                <dd>
                  {compilation.tileCount} × {compilation.tileWidth}-col
                </dd>
              </div>
              <div>
                <dt>Program</dt>
                <dd>{compilation.programBytes} B uncompressed</dd>
              </div>
              <div>
                <dt>CRC32</dt>
                <dd>
                  0x
                  {compilation.crc32
                    .toString(16)
                    .padStart(8, "0")
                    .toUpperCase()}
                </dd>
              </div>
              <div>
                <dt>Compressed</dt>
                <dd>
                  {compilation.compressedBytes} B ({compilation.compression};
                  ratio{" "}
                  {(
                    compilation.compressedBytes /
                    Math.max(1, compilation.programBytes)
                  ).toFixed(2)}
                  )
                </dd>
              </div>
              <div>
                <dt>Chunks</dt>
                <dd>1 announce + {compilation.chunkCount} data</dd>
              </div>
              <div>
                <dt>Pacing</dt>
                <dd>
                  {compilation.pacingMs} ms/packet · ~
                  {Math.round(
                    ((compilation.chunkCount + 1) * compilation.pacingMs) / 100,
                  ) / 10}
                  s
                </dd>
              </div>
              {compilation.frameCount !== undefined && (
                <div>
                  <dt>Frames</dt>
                  <dd>{compilation.frameCount}</dd>
                </div>
              )}
            </dl>
            <UploadAnalysis
              transaction={t}
              chunkCount={compilation.chunkCount}
              store={store}
            />
          </div>
        )}
        <dl>
          <div>
            <dt>Driver / profile</dt>
            <dd>
              {t.driverId ?? "none"} / {t.profileId ?? "none"}
            </dd>
          </div>
          <div>
            <dt>Safety</dt>
            <dd>
              {t.safety.risk} · {t.safety.validation}
            </dd>
          </div>
          <div>
            <dt>Host result</dt>
            <dd>{String(t.hostAccepted)}</dd>
          </div>
          <div>
            <dt>Protocol result</dt>
            <dd>{String(t.protocolAcknowledged)}</dd>
          </div>
          <div>
            <dt>Verification result</dt>
            <dd>{String(t.deviceStateVerified)}</dd>
          </div>
        </dl>
        {t.packets.length > 6 ? (
          <details class="packet-collection">
            <summary>
              {t.packets.length} packets (
              {t.packets.filter((p) => p.direction === "TX").length} TX /{" "}
              {t.packets.filter((p) => p.direction === "RX").length} RX) —
              expand for per-packet hex
            </summary>
            {t.packets.map((packet, packetIndex) => (
              <div
                key={`${packet.timestamp}-${packet.direction}-${packet.hex}`}
                class={`packet ${packet.direction.toLowerCase()}`}
              >
                <div>
                  <strong>
                    {packet.direction} #{packetIndex}
                    {compilation && packet.direction === "TX"
                      ? packetIndex === 0
                        ? " · announce"
                        : ` · chunk ${packetIndex - 1}`
                      : ""}
                  </strong>
                  <Copy value={packet.hex} store={store} />
                </div>
                <code>{packet.hex || "(zero bytes)"}</code>
              </div>
            ))}
          </details>
        ) : (
          t.packets.map((packet) => (
            <div
              key={`${packet.timestamp}-${packet.hex}`}
              class={`packet ${packet.direction.toLowerCase()}`}
            >
              <div>
                <strong>{packet.direction} RAW HEX</strong>
                <Copy value={packet.hex} store={store} />
              </div>
              <code>{packet.hex || "(zero bytes)"}</code>
            </div>
          ))
        )}
        <div class="decoded">
          <div>
            <strong>Decoded response</strong>
            {t.decodedResponse?.payloadHex && (
              <Copy value={t.decodedResponse.payloadHex} store={store} />
            )}
          </div>
          <p>
            {t.decodedResponse?.summary ??
              "No decoded response. Raw bytes remain preserved above."}
          </p>
          {t.decodedResponse && (
            <code>{JSON.stringify(t.decodedResponse.fields, null, 2)}</code>
          )}
        </div>
        {t.error && <p class="notice error">{t.error}</p>}
      </div>
    </details>
  );
}
