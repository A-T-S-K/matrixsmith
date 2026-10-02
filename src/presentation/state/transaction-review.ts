import type { ProtocolTransaction } from "../../diagnostics/transactions";
import type { ContentCompilationRecord } from "../../diagnostics/content-evidence";
import type { TraceEvent } from "../../diagnostics/trace";
import type { TransactionFilter } from "./types";
import { filterTransactions } from "./selectors";

/** Fixed presentation limit; evidence and report/export collections stay complete. */
export const REVIEW_PAGE_SIZE = 50;
export function pageWindow(length: number, requested: number) {
  const pages = Math.max(1, Math.ceil(length / REVIEW_PAGE_SIZE));
  const page = Math.max(0, Math.min(pages - 1, Math.trunc(requested) || 0));
  const start = page * REVIEW_PAGE_SIZE;
  return {
    page,
    pages,
    start,
    end: Math.min(length, start + REVIEW_PAGE_SIZE),
  };
}

/** One workspace's UI state, retained by capture/restore. No DOM or authority. */
export class TransactionReview {
  transactionPage = 0;
  rawPage = 0;
  packetPage = 0;
  selected: string | null = null;
  origin: string | null = null;
  scrollY = 0;
  restoreFocus = false;
  private window: string[] | null = null;
  private rawWindow: number[] | null = null;
  private transactionRevision = -1;
  private compilationRevision = -1;
  private rawRevision = -1;
  private pending = 0;
  private rawPending = 0;
  private query = "";
  private filter: TransactionFilter | null = null;
  private byId = new Map<string, ProtocolTransaction>();
  private compilations = new Map<string, ContentCompilationRecord>();
  private filtered: ProtocolTransaction[] = [];
  private matching = new Set<string>();
  private rawIds = new WeakMap<TraceEvent, number>();
  private nextRawId = 0;
  private rawById = new Map<number, TraceEvent>();
  // Deterministic work counters, useful for testing invalidation independently of time.
  readonly work = { transactions: 0, compilations: 0, filters: 0, raw: 0 };

  resetTransactions(): void {
    this.window = null;
    this.transactionPage = 0;
  }
  showLatestRaw(): void {
    this.rawWindow = null;
    this.rawPage = 0;
  }
  project(input: {
    transactions: readonly ProtocolTransaction[];
    compilations: readonly ContentCompilationRecord[];
    rawEvents: readonly TraceEvent[];
    revisions: { transactions: number; compilations: number; raw: number };
    search: string;
    filter: TransactionFilter;
    section?: "transactions" | "raw";
  }) {
    const changed = this.transactionRevision !== input.revisions.transactions;
    if (changed) {
      this.transactionRevision = input.revisions.transactions;
      this.byId = new Map(input.transactions.map((t) => [t.id, t]));
      this.work.transactions++;
    }
    if (
      changed ||
      this.query !== input.search ||
      this.filter !== input.filter
    ) {
      if (this.query !== input.search || this.filter !== input.filter)
        this.resetTransactions();
      this.query = input.search;
      this.filter = input.filter;
      this.filtered = filterTransactions(
        input.transactions,
        input.filter,
        input.search,
      );
      this.matching = new Set(this.filtered.map((t) => t.id));
      this.work.filters++;
    }
    if (this.compilationRevision !== input.revisions.compilations) {
      this.compilationRevision = input.revisions.compilations;
      this.compilations = new Map();
      // Preserve Array.find's first-compilation-wins behavior.
      for (const record of input.compilations)
        if (
          record.transactionId &&
          !this.compilations.has(record.transactionId)
        )
          this.compilations.set(record.transactionId, record);
      this.work.compilations++;
    }
    if (this.window === null && input.section === "transactions") {
      this.window = this.filtered.map((t) => t.id).reverse();
      this.pending = 0;
    } else if (changed && this.window !== null) {
      const ids = new Set(this.window);
      this.pending = this.filtered.filter((t) => !ids.has(t.id)).length;
    }
    if (this.rawRevision !== input.revisions.raw) {
      this.rawRevision = input.revisions.raw;
      this.rawById = new Map();
      for (const event of input.rawEvents) {
        let id = this.rawIds.get(event);
        if (id === undefined) {
          id = ++this.nextRawId;
          this.rawIds.set(event, id);
        }
        this.rawById.set(id, event);
      }
      if (this.rawWindow !== null) {
        const ids = new Set(this.rawWindow);
        this.rawPending = [...this.rawById.keys()].filter(
          (id) => !ids.has(id),
        ).length;
      }
      this.work.raw++;
    }
    if (this.rawWindow === null && input.section === "raw") {
      this.rawWindow = [...this.rawById.keys()].reverse();
      this.rawPending = 0;
    }
    const transactions = pageWindow(
      this.window?.length ?? 0,
      this.transactionPage,
    );
    const raw = pageWindow(this.rawWindow?.length ?? 0, this.rawPage);
    this.transactionPage = transactions.page;
    this.rawPage = raw.page;
    return {
      filtered: this.filtered,
      total: input.transactions.length,
      matching: this.filtered.length,
      transactions,
      rows: (this.window ?? [])
        .slice(transactions.start, transactions.end)
        .map((id) => ({
          id,
          transaction: this.matching.has(id)
            ? (this.byId.get(id) ?? null)
            : null,
        })),
      pending: this.pending,
      selected:
        this.selected === null ? null : (this.byId.get(this.selected) ?? null),
      selectedId: this.selected,
      compilation:
        this.selected === null
          ? null
          : (this.compilations.get(this.selected) ?? null),
      raw,
      rawTotal: input.rawEvents.length,
      rawPending: this.rawPending,
      events: (this.rawWindow ?? [])
        .slice(raw.start, raw.end)
        .map((id) => ({ id, event: this.rawById.get(id) ?? null })),
    };
  }
}
export type ReviewProjection = ReturnType<TransactionReview["project"]>;
