import { describe, expect, it } from "vitest";
import {
  pageWindow,
  TransactionReview,
} from "../../src/presentation/state/transaction-review";
import { ProtocolEvidenceService } from "../../src/application/services/protocol-evidence-service";
import { TraceRecorder, type TraceEvent } from "../../src/diagnostics/trace";
import type { ContentCompilationRecord } from "../../src/diagnostics/content-evidence";
import { INPUT_LIMITS } from "../../src/application/input-limits";
import { reviewTransaction } from "../helpers/review-fixtures";
import { filterTransactions } from "../../src/presentation/state/selectors";

function input(count = 101) {
  return {
    transactions: Array.from({ length: count }, (_, i) => reviewTransaction(i)),
    compilations: [] as ContentCompilationRecord[],
    rawEvents: [] as TraceEvent[],
    revisions: { transactions: 0, compilations: 0, raw: 0 },
    search: "",
    filter: "all" as const,
    section: "transactions" as "transactions" | "raw",
  };
}
describe("bounded review", () => {
  it.each([
    [0, 0, 0, 0, 1],
    [50, 0, 0, 50, 1],
    [51, 1, 50, 51, 2],
    [101, 99, 100, 101, 3],
    [101, -1, 0, 50, 3],
  ])("bounds length %i page %i", (length, page, start, end, pages) => {
    expect(pageWindow(length, page)).toMatchObject({ start, end, pages });
  });
  it("preserves search/filter semantics, bytes and resets queries to page one", () => {
    const owner = new TransactionReview();
    const values = input();
    owner.project(values);
    owner.transactionPage = 2;
    expect(owner.project(values).rows[0]?.id).toBe("review:0");
    for (const filter of [
      "all",
      "txrx",
      "queries",
      "probes",
      "diagnostics",
      "errors",
    ] as const)
      for (const search of [
        "",
        " GET ",
        "00 ab ff",
        "review-driver",
        "missing",
      ])
        expect(owner.project({ ...values, filter, search }).filtered).toEqual(
          filterTransactions(values.transactions, filter, search),
        );
    const result = owner.project({ ...values, search: "AB" });
    expect(result.transactions.page).toBe(0);
    expect(result.rows[0]?.transaction?.packets[0]?.hex).toBe("00 aB FF");
    expect(owner.project({ ...values, search: "missing" })).toMatchObject({
      matching: 0,
      total: 101,
      rows: [],
    });
    expect(new TransactionReview().project(input(0))).toMatchObject({
      matching: 0,
      total: 0,
      rows: [],
    });
  });
  it("invalidates in-place updates and same-length retention, never unrelated publications", () => {
    const owner = new TransactionReview();
    const values = input();
    owner.project(values);
    owner.transactionPage = 1;
    owner.selected = "review:50";
    for (let i = 0; i < 100; i++) owner.project(values);
    expect(owner.work).toEqual({
      transactions: 1,
      compilations: 1,
      filters: 1,
      raw: 1,
    });
    values.transactions[50] = {
      ...values.transactions[50]!,
      operation: "Changed",
    };
    values.revisions.transactions++;
    expect(owner.project(values).selected?.operation).toBe("Changed");
    values.transactions.splice(50, 1);
    values.transactions.push(reviewTransaction(102));
    values.revisions.transactions++;
    const retained = owner.project(values);
    expect(retained.transactions.page).toBe(1);
    expect(retained.rows[0]).toEqual({ id: "review:50", transaction: null });
    expect(retained.selectedId).toBe("review:50");
    expect(retained.selected).toBeNull();
    expect(retained.pending).toBe(1);
    expect(owner.work.compilations).toBe(2);
    owner.resetTransactions();
    expect(owner.project(values).rows[0]?.id).toBe("review:102");
  });
  it("preserves first compilation join and refreshes edited/replaced compilations", () => {
    const owner = new TransactionReview();
    const values = input(1);
    owner.selected = "review:0";
    const first = {
      id: "first",
      transactionId: "review:0",
    } as ContentCompilationRecord;
    const second = {
      id: "second",
      transactionId: "review:0",
    } as ContentCompilationRecord;
    values.compilations.push(first, second);
    expect(owner.project(values).compilation).toBe(first);
    values.compilations.splice(0, 1, { ...first, id: "replacement" });
    values.revisions.compilations++;
    expect(owner.project(values).compilation?.id).toBe("replacement");
    expect(owner.work.transactions).toBe(1);
    expect(owner.work.filters).toBe(1);
  });
  it("keeps incoming transactions outside an older page until show latest", () => {
    const owner = new TransactionReview();
    const values = input();
    owner.project(values);
    owner.transactionPage = 1;
    const before = owner.project(values).rows.map((row) => row.id);
    values.transactions.push(reviewTransaction(200));
    values.revisions.transactions++;
    expect(owner.project(values).rows.map((row) => row.id)).toEqual(before);
    expect(owner.project(values).pending).toBe(1);
    owner.resetTransactions();
    expect(owner.project(values).rows[0]?.id).toBe("review:200");
  });
  it("bounds ceiling fixtures and uses stable identities for duplicate raw timestamps/types", () => {
    const values = input(INPUT_LIMITS.transactions);
    const owner = new TransactionReview();
    expect(JSON.stringify(values).length).toBeLessThan(
      INPUT_LIMITS.diagnosticBundleBytes,
    );
    expect(owner.project(values).rows).toHaveLength(50);
    owner.transactionPage = 199;
    expect(owner.project(values).rows).toHaveLength(50);
    values.rawEvents = Array.from(
      { length: INPUT_LIMITS.traceEvents },
      (_, i) => ({
        timestamp: "same",
        type: "notification.raw",
        metadata: { index: i },
        rawBytes: Uint8Array.of(i % 256),
      }),
    );
    values.section = "raw";
    values.revisions.raw++;
    expect(JSON.stringify(values.rawEvents).length).toBeLessThan(
      INPUT_LIMITS.diagnosticBundleBytes,
    );
    const first = owner.project(values);
    expect(first.events).toHaveLength(50);
    expect(new Set(first.events.map(({ id }) => id)).size).toBe(50);
    owner.rawPage = 999;
    const older = owner.project(values);
    const evicted = older.events.at(-1)!;
    values.rawEvents.shift();
    values.rawEvents.push({
      timestamp: "same",
      type: "notification.raw",
      metadata: { index: 50000 },
    });
    values.revisions.raw++;
    const next = owner.project(values);
    expect(next.raw.page).toBe(999);
    expect(next.rawPending).toBe(1);
    expect(next.events.at(-1)).toEqual({ id: evicted.id, event: null });
    owner.showLatestRaw();
    expect(owner.project(values).events[0]?.event?.metadata.index).toBe(50000);
  });
});
it("mutation owners revision edits, retention, import and throw paths", () => {
  const evidence = new ProtocolEvidenceService({} as never);
  evidence.editTransactions((values) => values.push(reviewTransaction(1)));
  const revision = evidence.revisions.transactions;
  evidence.editTransactions((values) => {
    values[0] = reviewTransaction(2);
  });
  expect(evidence.revisions.transactions).toBe(revision + 1);
  expect(() =>
    evidence.editTransactions(() => {
      throw Error("partial edit");
    }),
  ).toThrow();
  expect(evidence.revisions.transactions).toBe(revision + 2);
  evidence.editTransactions((values) =>
    values.push(
      ...Array.from({ length: INPUT_LIMITS.transactions }, (_, i) =>
        reviewTransaction(i),
      ),
    ),
  );
  const beforeTrim = evidence.revisions.transactions;
  evidence._trimTransactions();
  expect(evidence.transactions).toHaveLength(INPUT_LIMITS.transactions);
  expect(evidence.revisions.transactions).toBe(beforeTrim + 1);
  evidence.editContentCompilations((values) => values.splice(0));
  expect(evidence.revisions.compilations).toBe(1);
  const trace = new TraceRecorder();
  trace.record("error");
  const before = trace.revision;
  trace.importSerialized([{ timestamp: "same", type: "error", metadata: {} }]);
  expect(trace.revision).toBe(before + 1);
});

it("bounds compilation joins to retained transactions and drops disposed evidence", () => {
  const owner = new TransactionReview();
  const values = input(1);
  values.compilations = [
    { id: "outside", transactionId: "review:2" } as ContentCompilationRecord,
    { id: "inside", transactionId: "review:0" } as ContentCompilationRecord,
  ];
  owner.selected = "review:0";
  expect(owner.project(values).compilation?.id).toBe("inside");
  values.transactions[0] = reviewTransaction(2);
  values.revisions.transactions++;
  owner.selected = "review:2";
  expect(owner.project(values).compilation?.id).toBe("outside");
  owner.dispose();
  expect(owner.project(input(0))).toMatchObject({
    rows: [],
    selected: null,
    compilation: null,
    events: [],
  });
});

it("an empty raw review window defers arrivals until explicit latest", () => {
  const owner = new TransactionReview();
  const values = input(0);
  values.section = "raw";
  expect(owner.project(values)).toMatchObject({ events: [], rawTotal: 0 });
  values.rawEvents.push({ timestamp: "same", type: "error", metadata: {} });
  values.revisions.raw++;
  expect(owner.project(values)).toMatchObject({
    events: [],
    rawTotal: 1,
    rawPending: 1,
  });
  owner.showLatestRaw();
  expect(owner.project(values).events).toHaveLength(1);
});
