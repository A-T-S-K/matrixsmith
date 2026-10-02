import { useEffect, useRef } from "preact/hooks";
import { ReviewPagination } from "../../components/ReviewPagination";
import { pageWindow } from "../../../presentation/review-pagination";
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
  const review = snapshot.review;
  const heading = useRef<HTMLHeadingElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const state = store.reviewState;
  useEffect(() => {
    if (review.selectedId) {
      heading.current?.focus();
    } else if (state.restoreFocus) {
      const row = [
        ...(list.current?.querySelectorAll<HTMLButtonElement>(
          "button[data-transaction]",
        ) ?? []),
      ].find((button) => button.dataset.transaction === state.origin);
      if (row) {
        row.focus({ preventScroll: true });
        window.scrollTo(0, state.scrollY);
      } else heading.current?.focus();
      state.restoreFocus = false;
    }
  }, [review.selectedId, snapshot.contextIdentity]);
  if (review.selectedId)
    return (
      <section>
        <button onClick={() => store.closeTransaction()}>
          Return to transactions
        </button>
        <h2 ref={heading} tabIndex={-1} data-review-detail-heading>
          Transaction detail
        </h2>
        {review.selected ? (
          <Transaction
            key={review.selectedId}
            transaction={review.selected}
            compilation={review.compilation}
            store={store}
          />
        ) : (
          <p class="notice">
            This transaction is no longer available. It may have been removed by
            capture retention. Return to the list or show latest records.
          </p>
        )}
      </section>
    );
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
        <h2 ref={heading} tabIndex={-1}>
          Transactions
        </h2>
        <p>Semantic operations correlated with exact TX/RX evidence.</p>
        <p>
          {review.matching} matching / {review.total} total · Newest first · 50
          per page.
        </p>
      </div>
      <div class="transaction-toolbar">
        <div class="filter-pills">
          {filters.map(([value, label]) => (
            <button
              key={value}
              aria-pressed={snapshot.transactionFilter === value}
              class={snapshot.transactionFilter === value ? "active" : ""}
              onClick={() => store.setTransactionFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <label>
          Search transactions
          <input
            type="search"
            aria-describedby="transaction-search-scope"
            placeholder="Search opcode, operation, hex, driver…"
            value={snapshot.transactionSearch}
            onInput={(event) =>
              store.setTransactionSearch(event.currentTarget.value)
            }
          />
        </label>
      </div>
      <p id="transaction-search-scope">
        Search all captured operations, drivers, decoded summaries, opcodes and
        exact packet hex; filters apply across the capture.
      </p>
      <p>
        New arrivals do not move this review window. Removed or changed records
        leave unavailable slots.
      </p>
      <button onClick={() => store.showLatest("transactions")}>
        Show latest{review.pending ? ` (${review.pending} new matches)` : ""}
      </button>
      <ReviewPagination
        window={review.transactions}
        label="Transactions"
        onPage={(page) => store.setReviewPage("transactions", page)}
      />
      <div class="transaction-list" ref={list}>
        <div class="transaction-head">
          <span>Timestamp</span>
          <span>Operation</span>
          <span>Source / result</span>
          <span>Duration</span>
        </div>
        {review.rows.map(({ id, transaction: t }) =>
          t ? (
            <button
              key={id}
              class="transaction-row"
              data-transaction={id}
              onClick={() => {
                state.scrollY = window.scrollY;
                store.openTransaction(id);
              }}
            >
              <time>
                {new Date(t.startedAt).toLocaleTimeString([], {
                  hour12: false,
                })}
              </time>
              <strong>{t.operation}</strong>
              <span>
                {t.source} · {transactionStatus(t)}
              </span>
              <small>{t.durationMs} ms</small>
            </button>
          ) : (
            <p key={id} class="notice">
              Record unavailable or no longer matches. Show latest to refresh
              the review window.
            </p>
          ),
        )}
        {!review.rows.length && (
          <p class="empty">
            {review.total === 0
              ? "This capture contains no transactions."
              : review.matching === 0
                ? "No matching transactions."
                : "Matching records are outside this review window. Show latest to review them."}
          </p>
        )}
        {(snapshot.transactionSearch ||
          snapshot.transactionFilter !== "all") && (
          <button
            onClick={() => {
              store.setTransactionSearch("");
              store.setTransactionFilter("all");
            }}
          >
            Reset search and filters
          </button>
        )}
      </div>
    </section>
  );
}
function transactionStatus(t: ProtocolTransaction): string {
  return t.error || t.responseTimedOut
    ? "Error"
    : t.deviceStateVerified
      ? "Operation response fulfilled"
      : t.protocolAcknowledged
        ? "Correlated acknowledgement"
        : t.hostAccepted
          ? "Host accepted"
          : "Not accepted";
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
  const packets = pageWindow(t.packets.length, store.reviewState.packetPage);
  return (
    <article class="transaction">
      <p>
        <strong>{t.operation}</strong> · {transactionStatus(t)} · {t.durationMs}{" "}
        ms
      </p>
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
            <dt>Correlated acknowledgement</dt>
            <dd>
              {t.protocolAcknowledged === null
                ? "Not recorded / not awaited"
                : String(t.protocolAcknowledged)}
            </dd>
          </div>
          <div>
            <dt>Operation response fulfilled</dt>
            <dd>{String(t.deviceStateVerified)}</dd>
          </div>
        </dl>
        <p>
          Host acceptance records the host write result. A correlated
          acknowledgement and an operation-fulfilling response are separate
          results. Physical appearance requires human observation; this flag is
          not separate readback.
        </p>
        <dl>
          <div>
            <dt>Started / completed</dt>
            <dd>
              {t.startedAt} / {t.completedAt}
            </dd>
          </div>
          <div>
            <dt>Response timeout</dt>
            <dd>{String(t.responseTimedOut)}</dd>
          </div>
          <div>
            <dt>Endpoint</dt>
            <dd>{JSON.stringify(t.endpoint)}</dd>
          </div>
          <div>
            <dt>Evidence source</dt>
            <dd>
              {t.sessionSource} / {t.source}
            </dd>
          </div>
          <div>
            <dt>Findings</dt>
            <dd>{t.findings.join(" · ") || "None recorded"}</dd>
          </div>
          <div>
            <dt>Physical observation references</dt>
            <dd>{t.observationIds.join(", ") || "None recorded"}</dd>
          </div>
        </dl>
        <h3>Exact packets ({t.packets.length})</h3>
        <ReviewPagination
          window={packets}
          label="Packets"
          onPage={(page) => store.setReviewPage("packets", page)}
        />
        {t.packets.slice(packets.start, packets.end).map((packet, offset) => {
          const packetIndex = packets.start + offset;
          return (
            <div
              key={packetIndex}
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
              <p>
                {packet.timestamp} ·{" "}
                {packet.relation ?? "No correlation relation recorded"}
              </p>
              <p>Endpoint: {JSON.stringify(packet.endpoint ?? t.endpoint)}</p>
              <p>
                Host accepted: {packet.hostAcceptedAt ?? "not recorded"} ·
                Scheduled delay: {packet.scheduledDelayMs ?? "not recorded"} ms
                · Measured gap: {packet.gapSincePreviousTxMs ?? "not recorded"}{" "}
                ms
              </p>
              <code>{packet.hex || "(zero bytes)"}</code>
            </div>
          );
        })}
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
    </article>
  );
}
